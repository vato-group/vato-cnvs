//! Découverte des sessions d'agents CLI sur le disque, pour la **reprise de
//! conversation** au redémarrage de l'app.
//!
//! Un PTY est un processus enfant : il meurt à la fermeture de l'app. On ne peut
//! donc pas « re-attacher » l'agent — on **relance le CLI avec son flag de
//! reprise** en pointant sur la conversation précédente. Pour Codex (et un
//! Claude lancé à la main dans un shell), l'ID de session n'est pas connu de
//! l'app : on le retrouve en scannant le stockage du CLI.
//!
//!   Claude : `~/.claude/projects/<cwd-encodé>/<uuid>.jsonl`
//!   Codex  : `~/.codex/sessions/AAAA/MM/JJ/rollout-…-<uuid>.jsonl`
//!            (1ʳᵉ ligne = `session_meta` avec `payload.id` + `payload.cwd`)
//!
//! Porté de vato-canvas (`agent_sessions.rs`), allégé de sa dépendance au module
//! `paths` : le frontend passe ici un `cwd` absolu.

use serde_json::Value;
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AgentSessionKind {
    Claude,
    Codex,
}

impl AgentSessionKind {
    pub fn parse(raw: &str) -> Option<Self> {
        match raw {
            "claude" => Some(Self::Claude),
            "codex" => Some(Self::Codex),
            _ => None,
        }
    }
}

/// `%USERPROFILE%` sur Windows, `$HOME` ailleurs (même résolution que
/// `home_dir` dans lib.rs).
fn home_path() -> Option<PathBuf> {
    std::env::var("USERPROFILE")
        .ok()
        .or_else(|| std::env::var("HOME").ok())
        .map(PathBuf::from)
}

fn modified_ms(path: &Path) -> Option<u64> {
    path.metadata()
        .ok()?
        .modified()
        .ok()?
        .duration_since(UNIX_EPOCH)
        .ok()
        .map(|d| d.as_millis() as u64)
}

fn normalize_cwd(cwd: &str) -> Option<String> {
    let trimmed = cwd.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

/// Encode le cwd comme Claude Code nomme ses dossiers de projets : tout
/// caractère non alphanumérique devient `-`. `/Users/x/app` → `-Users-x-app`,
/// et sur Windows `C:\Users\x\app` → `C--Users-x-app` (`:` et `\` compris —
/// remplacer seulement `/` laissait le chemin Windows intact et la session
/// restait introuvable).
fn encode_claude_cwd(cwd: &str) -> String {
    cwd.chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect()
}

fn claude_project_dir(home: &Path, cwd: &str) -> PathBuf {
    let projects = home.join(".claude/projects");
    let encoded = encode_claude_cwd(cwd);
    let exact = projects.join(&encoded);
    if exact.is_dir() {
        return exact;
    }
    // NTFS est insensible à la casse : le cwd résolu peut différer en casse de
    // celui vu par la CLI. On retombe sur le dossier dont le nom correspond
    // sans la casse plutôt que de rater la session.
    if let Ok(entries) = fs::read_dir(&projects) {
        for entry in entries.flatten() {
            let name = entry.file_name();
            if name.to_string_lossy().eq_ignore_ascii_case(&encoded) && entry.path().is_dir() {
                return entry.path();
            }
        }
    }
    exact
}

fn latest_claude_session_id(home: &Path, cwd: &str, started_after_ms: u64) -> Option<String> {
    let dir = claude_project_dir(home, cwd);
    let mut best: Option<(u64, String)> = None;
    for entry in fs::read_dir(dir).ok()?.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("jsonl") {
            continue;
        }
        let Some(modified) = modified_ms(&path) else {
            continue;
        };
        if modified + 2_000 < started_after_ms {
            continue;
        }
        let Some(id) = path.file_stem().map(|s| s.to_string_lossy().to_string()) else {
            continue;
        };
        if best.as_ref().map_or(true, |(m, _)| modified > *m) {
            best = Some((modified, id));
        }
    }
    best.map(|(_, id)| id)
}

fn collect_files(dir: &Path, out: &mut Vec<PathBuf>) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect_files(&path, out);
        } else if path.extension().and_then(|e| e.to_str()) == Some("jsonl") {
            out.push(path);
        }
    }
}

fn codex_session_meta(path: &Path) -> Option<(String, String)> {
    let file = fs::File::open(path).ok()?;
    let mut reader = BufReader::new(file);
    let mut line = String::new();
    reader.read_line(&mut line).ok()?;
    let value: Value = serde_json::from_str(&line).ok()?;
    if value.get("type")?.as_str()? != "session_meta" {
        return None;
    }
    let payload = value.get("payload")?;
    let id = payload.get("id")?.as_str()?.to_string();
    let cwd = payload.get("cwd")?.as_str()?.to_string();
    Some((id, cwd))
}

/// Deux chemins désignent-ils le même dossier ? Comparaison canonique quand les
/// deux existent (absorbe la casse NTFS et les séparateurs mêlés `/` `\`), sinon
/// textuelle après normalisation. L'égalité stricte ratait les sessions Codex
/// sur Windows.
fn same_dir(a: &str, b: &str) -> bool {
    if a == b {
        return true;
    }
    if let (Ok(ca), Ok(cb)) = (fs::canonicalize(a), fs::canonicalize(b)) {
        return ca == cb;
    }
    cfg!(windows) && a.replace('\\', "/").eq_ignore_ascii_case(&b.replace('\\', "/"))
}

fn latest_codex_session_id(home: &Path, cwd: &str, started_after_ms: u64) -> Option<String> {
    let mut files = Vec::new();
    collect_files(&home.join(".codex/sessions"), &mut files);

    let mut best: Option<(u64, String)> = None;
    for path in files {
        let Some(modified) = modified_ms(&path) else {
            continue;
        };
        if modified + 2_000 < started_after_ms {
            continue;
        }
        let Some((id, meta_cwd)) = codex_session_meta(&path) else {
            continue;
        };
        if !same_dir(&meta_cwd, cwd) {
            continue;
        }
        if best.as_ref().map_or(true, |(m, _)| modified > *m) {
            best = Some((modified, id));
        }
    }
    best.map(|(_, id)| id)
}

pub fn latest_agent_session_id_with_home(
    kind: AgentSessionKind,
    cwd: &str,
    started_after_ms: u64,
    home: &Path,
) -> Option<String> {
    let cwd = normalize_cwd(cwd)?;
    match kind {
        AgentSessionKind::Claude => latest_claude_session_id(home, &cwd, started_after_ms),
        AgentSessionKind::Codex => latest_codex_session_id(home, &cwd, started_after_ms),
    }
}

fn latest_agent_session_id(kind: &str, cwd: &str, started_after_ms: u64) -> Option<String> {
    let kind = AgentSessionKind::parse(kind)?;
    let home = home_path()?;
    latest_agent_session_id_with_home(kind, cwd, started_after_ms, &home)
}

/// Renvoie l'UUID de la session la plus récente d'un agent (`claude`/`codex`)
/// dans `cwd`, modifiée après `started_after_ms` (timestamp epoch en ms du
/// lancement du pane). `None` si rien trouvé.
#[tauri::command]
pub fn agent_session_id(kind: String, cwd: String, started_after_ms: u64) -> Option<String> {
    latest_agent_session_id(&kind, &cwd, started_after_ms)
}

/// Le fichier de session Claude `<cwd-encodé>/<session_id>.jsonl` existe-t-il ?
/// Claude n'écrit ce fichier qu'au PREMIER message de l'utilisateur : tant qu'il
/// n'existe pas, `claude --resume <id>` échoue avec « No conversation found ».
/// Le front s'en sert pour décider reprise (`--resume`) vs démarrage à neuf
/// (`--session-id`) au lancement.
#[tauri::command]
pub fn claude_session_exists(cwd: String, session_id: String) -> bool {
    let Some(cwd) = normalize_cwd(&cwd) else {
        return false;
    };
    let Some(home) = home_path() else {
        return false;
    };
    claude_project_dir(&home, &cwd)
        .join(format!("{session_id}.jsonl"))
        .is_file()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_home(name: &str) -> PathBuf {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = std::env::temp_dir().join(format!("vato-cnvs-sessions-{name}-{stamp}"));
        fs::create_dir_all(&path).unwrap();
        path
    }

    #[test]
    fn claude_project_dir_encode_le_cwd_comme_claude() {
        let dir = claude_project_dir(Path::new("/Users/Noah"), "/Users/Noah/Work/GitHub/app");
        assert_eq!(
            dir,
            PathBuf::from("/Users/Noah/.claude/projects/-Users-Noah-Work-GitHub-app")
        );
    }

    /// Régression Windows : `C:\…` doit être encodé comme Claude le fait
    /// (`:` et `\` → `-`), sinon le dossier projet n'est jamais trouvé.
    #[test]
    fn claude_project_dir_encode_un_cwd_windows() {
        let dir = claude_project_dir(
            Path::new("/Users/Noah"),
            r"C:\Users\Vato\Documents\GitHub\app",
        );
        assert_eq!(
            dir,
            PathBuf::from("/Users/Noah/.claude/projects/C--Users-Vato-Documents-GitHub-app")
        );
    }

    #[test]
    fn latest_claude_session_id_lit_le_nom_du_jsonl_recent() {
        let home = temp_home("claude");
        let cwd = home.join("Work/GitHub/app");
        fs::create_dir_all(&cwd).unwrap();
        let dir = claude_project_dir(&home, cwd.to_str().unwrap());
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("11111111-1111-4111-8111-111111111111.jsonl"), "{}\n").unwrap();

        assert_eq!(
            latest_agent_session_id_with_home(AgentSessionKind::Claude, cwd.to_str().unwrap(), 0, &home),
            Some("11111111-1111-4111-8111-111111111111".into())
        );
        let _ = fs::remove_dir_all(home);
    }

    #[test]
    fn latest_codex_session_id_lit_session_meta_du_cwd() {
        let home = temp_home("codex");
        let cwd = home.join("Work/GitHub/app");
        fs::create_dir_all(&cwd).unwrap();
        let dir = home.join(".codex/sessions/2026/06/23");
        fs::create_dir_all(&dir).unwrap();
        // `to_string` échappe les `\` des chemins Windows (sinon JSON invalide).
        let raw = format!(
            r#"{{"timestamp":"2026-06-23T00:00:00Z","type":"session_meta","payload":{{"id":"22222222-2222-4222-8222-222222222222","cwd":{}}}}}"#,
            serde_json::to_string(cwd.to_str().unwrap()).unwrap()
        );
        fs::write(dir.join("rollout.jsonl"), format!("{raw}\n")).unwrap();

        assert_eq!(
            latest_agent_session_id_with_home(AgentSessionKind::Codex, cwd.to_str().unwrap(), 0, &home),
            Some("22222222-2222-4222-8222-222222222222".into())
        );
        let _ = fs::remove_dir_all(home);
    }

    /// Le filtre temporel : une session antérieure au lancement (hors fenêtre de
    /// grâce de 2 s) est ignorée.
    #[test]
    fn latest_claude_session_id_ignore_les_sessions_trop_vieilles() {
        let home = temp_home("claude-old");
        let cwd = home.join("app");
        fs::create_dir_all(&cwd).unwrap();
        let dir = claude_project_dir(&home, cwd.to_str().unwrap());
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.jsonl"), "{}\n").unwrap();

        // started_after très loin dans le futur → tout est « trop vieux ».
        let far_future = u64::MAX / 2;
        assert_eq!(
            latest_agent_session_id_with_home(
                AgentSessionKind::Claude,
                cwd.to_str().unwrap(),
                far_future,
                &home
            ),
            None
        );
        let _ = fs::remove_dir_all(home);
    }
}
