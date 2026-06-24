import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useStore } from "../store";
import { CLIS, CLI_ORDER, buildCliArgs } from "../data/clis";
import { ACTION_DEFS, comboFromEvent, humanizeCombo } from "../canvas/shortcuts";
import type { Background, SttEngine, Workspace } from "../types";
import { homeDir } from "../pty";
import {
  sttDownload,
  sttInstallWhisper,
  sttPaths,
  sttStatus,
  onDownloadProgress,
  onInstallProgress,
  type EngineStatus,
  type SttPaths,
} from "../voice/stt";
import { TerminalTool } from "./toolIcons";
import {
  CloseIcon,
  FolderIcon,
  InfoIcon,
  KeyboardIcon,
  MicIcon,
  PaletteIcon,
  PlusIcon,
  RefreshIcon,
  TrashIcon,
} from "./icons";

const BG_PRESETS = [
  "radial-gradient(1200px 820px at 72% 8%, #1c2c4d 0%, #0b0d12 62%)",
  "linear-gradient(160deg, #0f2027, #203a43, #2c5364)",
  "radial-gradient(900px 720px at 30% 18%, #3a1c4d, #0b0d12 64%)",
  "linear-gradient(160deg, #1a1a2e, #16213e, #0f3460)",
  "radial-gradient(1000px 800px at 70% 14%, #14342b, #0b0d12 60%)",
  "linear-gradient(160deg, #2b1b17, #3a241b, #0b0d12)",
];

/** A picked background template (image or looping video). */
interface BgTemplate {
  label: string;
  kind: "image" | "video";
  /** Full-res url applied as the background. */
  value: string;
  /** Static thumbnail shown in the gallery. */
  thumb: string;
  /** Suggested dark overlay so foreground stays readable. */
  dim: number;
}

const uns = (id: string, w: number) =>
  `https://images.unsplash.com/photo-${id}?q=80&w=${w}&auto=format&fit=crop`;

/** Calm, low-distraction wallpapers (Unsplash, free to use). */
const BG_IMAGES: BgTemplate[] = (
  [
    ["Vallée brumeuse", "1506744038136-46273834b3fb", 0.2],
    ["Forêt", "1441974231531-c6227db76b6e", 0.25],
    ["Voie lactée", "1419242902214-272b3f66ee7a", 0.15],
    ["Aurore boréale", "1483347756197-71ef80e95f73", 0.2],
    ["Dégradé bleu", "1557683316-973673baf926", 0.1],
    ["Terre de nuit", "1451187580459-43490279c0fa", 0.15],
    ["Hautes terres", "1470071459604-3b5ec3a7fe05", 0.25],
    ["Côte turquoise", "1505142468610-359e7d316be0", 0.2],
    ["Arbre solitaire", "1502082553048-f009c37129b9", 0.2],
  ] as const
).map(([label, id, dim]) => ({
  label,
  kind: "image" as const,
  value: uns(id, 2400),
  thumb: uns(id, 480),
  dim,
}));

/** Looping ambient clips for a focused, alive background (Pexels, free to use). */
const BG_VIDEOS: BgTemplate[] = [
  {
    label: "Vagues",
    kind: "video",
    value: "https://videos.pexels.com/video-files/1409899/1409899-uhd_2560_1440_25fps.mp4",
    thumb: "https://images.pexels.com/videos/1409899/free-video-1409899.jpg",
    dim: 0.3,
  },
  {
    label: "Forêt vivante",
    kind: "video",
    value: "https://videos.pexels.com/video-files/2330708/2330708-hd_1920_1080_24fps.mp4",
    thumb: "https://images.pexels.com/videos/2330708/free-video-2330708.jpg",
    dim: 0.35,
  },
  {
    label: "Champ d'étoiles",
    kind: "video",
    value: "https://videos.pexels.com/video-files/2611250/2611250-hd_1920_1080_30fps.mp4",
    thumb: "https://images.pexels.com/videos/2611250/free-video-2611250.jpg",
    dim: 0.2,
  },
  {
    label: "Montagnes & brume",
    kind: "video",
    value: "https://videos.pexels.com/video-files/4763824/4763824-hd_1920_1080_24fps.mp4",
    thumb: "https://images.pexels.com/videos/4763824/4k-4k50fps-adventure-backpack-4763824.jpeg",
    dim: 0.3,
  },
  {
    label: "Côte sauvage",
    kind: "video",
    value: "https://videos.pexels.com/video-files/4205697/4205697-hd_1920_1080_30fps.mp4",
    thumb: "https://images.pexels.com/videos/4205697/bay-bay-area-beach-island-beach-shore-4205697.jpeg",
    dim: 0.3,
  },
];

const SECTIONS = [
  { id: "agents", label: "Agents", Icon: TerminalTool },
  { id: "voice", label: "Vocal", Icon: MicIcon },
  { id: "shortcuts", label: "Raccourcis", Icon: KeyboardIcon },
  { id: "appearance", label: "Apparence", Icon: PaletteIcon },
  { id: "workspaces", label: "Workspaces", Icon: FolderIcon },
  { id: "about", label: "À propos", Icon: InfoIcon },
];

/* ----------------------------- Agents ----------------------------- */
function AgentsSection() {
  const settings = useStore((s) => s.settings);
  const setCliPreset = useStore((s) => s.setCliPreset);
  const setCliExtraArgs = useStore((s) => s.setCliExtraArgs);

  return (
    <>
      <div className="vato-set-h">Commande de lancement par agent</div>
      {CLI_ORDER.map((id) => {
        const def = CLIS[id];
        const cfg = settings.cli[id];
        const preview = `${def.program} ${buildCliArgs(def, cfg).join(" ")}`.trim();
        return (
          <div key={id} className="vato-set-cli">
            <div className="vato-set-cli-head">
              <span style={{ color: def.color, display: "flex" }}>
                <def.Icon size={17} />
              </span>
              <span className="name">{def.label}</span>
            </div>
            {def.presets && def.presets.length > 0 && (
              <div className="vato-set-presets">
                {def.presets.map((p) => {
                  const on = !!cfg?.presets?.[p.id];
                  return (
                    <button
                      key={p.id}
                      className={`vato-chip ${on ? "on" : ""}`}
                      title={p.flag}
                      onClick={() => setCliPreset(id, p.id, !on)}
                    >
                      {p.label}
                    </button>
                  );
                })}
              </div>
            )}
            <input
              className="vato-input allow-select"
              placeholder="Arguments supplémentaires…"
              spellCheck={false}
              value={cfg?.extraArgs ?? ""}
              onChange={(e) => setCliExtraArgs(id, e.target.value)}
            />
            <code className="vato-set-preview">{preview}</code>
          </div>
        );
      })}
    </>
  );
}

/* ----------------------------- Voice ------------------------------ */
interface WhisperModel {
  id: string;
  label: string;
  file: string;
  url: string;
  reco?: boolean;
}
const WHISPER_MODELS: WhisperModel[] = [
  {
    id: "turbo-q5",
    label: "Large v3 Turbo · q5 (~550 Mo)",
    file: "ggml-large-v3-turbo-q5_0.bin",
    url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q5_0.bin",
    reco: true,
  },
  {
    id: "turbo",
    label: "Large v3 Turbo · f16 (~1,6 Go)",
    file: "ggml-large-v3-turbo.bin",
    url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo.bin",
  },
  {
    id: "base",
    label: "Base · multilingue (~150 Mo)",
    file: "ggml-base.bin",
    url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin",
  },
  {
    id: "tiny",
    label: "Tiny · test rapide (~75 Mo)",
    file: "ggml-tiny.bin",
    url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.bin",
  },
];

const LANGS: [string, string][] = [
  ["auto", "Détection auto"],
  ["fr", "Français"],
  ["en", "Anglais"],
  ["es", "Espagnol"],
  ["de", "Allemand"],
  ["it", "Italien"],
  ["pt", "Portugais"],
  ["nl", "Néerlandais"],
  ["ja", "Japonais"],
  ["zh", "Chinois"],
];

function VoiceSection() {
  const stt = useStore((s) => s.settings.stt);
  const setStt = useStore((s) => s.setStt);
  const [paths, setPaths] = useState<SttPaths | null>(null);
  const [status, setStatus] = useState<EngineStatus | null>(null);
  const [dl, setDl] = useState<{ file: string; pct: number; done: boolean; error: string | null } | null>(
    null,
  );
  const [install, setInstall] = useState<{ pct: number; done: boolean; error: string | null } | null>(
    null,
  );

  const refresh = useCallback(() => {
    const s = useStore.getState().settings.stt;
    if (s.engine === "openai") {
      const ok = !!s.openaiKey.trim();
      setStatus({
        engine: "openai",
        binary: null,
        binary_ready: ok,
        model: s.openaiModel,
        model_ready: true,
        ready: ok,
        note: ok ? null : "Clé API OpenAI manquante",
      });
      return;
    }
    const bin = s.engine === "whisper" ? s.whisperBinary : s.parakeetBinary;
    const model = s.engine === "whisper" ? s.whisperModel : "";
    sttStatus(s.engine, bin, model)
      .then(setStatus)
      .catch(() => setStatus(null));
  }, []);

  useEffect(() => {
    sttPaths().then(setPaths).catch(() => {});
  }, []);
  useEffect(() => {
    refresh();
  }, [
    refresh,
    stt.engine,
    stt.whisperBinary,
    stt.whisperModel,
    stt.parakeetBinary,
    stt.openaiKey,
    stt.openaiModel,
  ]);

  useEffect(() => {
    let un: (() => void) | undefined;
    onDownloadProgress((p) => {
      const file = decodeURIComponent(p.url.split("/").pop() || "");
      setDl((cur) => ({
        file,
        pct: p.done ? 100 : p.total ? Math.round((p.received / p.total) * 100) : cur?.pct ?? 0,
        done: p.done,
        error: p.error,
      }));
      if (p.done && !p.error) refresh();
    }).then((u) => (un = u));
    return () => un?.();
  }, [refresh]);

  useEffect(() => {
    let un: (() => void) | undefined;
    onInstallProgress((p) => {
      setInstall({
        pct: p.done ? 100 : p.total ? Math.round((p.received / p.total) * 100) : 0,
        done: p.done,
        error: p.error,
      });
      if (p.done && !p.error) refresh();
    }).then((u) => (un = u));
    return () => un?.();
  }, [refresh]);

  const installBinary = () => {
    setInstall({ pct: 0, done: false, error: null });
    sttInstallWhisper()
      .then(() => {
        setInstall({ pct: 100, done: true, error: null });
        refresh();
      })
      .catch((e) => setInstall({ pct: 0, done: true, error: String(e) }));
  };

  const download = (m: WhisperModel) => {
    if (!paths) return;
    const dest = `${paths.models_dir}\\${m.file}`;
    setDl({ file: m.file, pct: 0, done: false, error: null });
    sttDownload(m.url, dest)
      .then(() => {
        setStt({ whisperModel: dest });
        refresh();
      })
      .catch((e) => setDl({ file: m.file, pct: 0, done: true, error: String(e) }));
  };

  const activeModelFile = status?.model?.split(/[\\/]/).pop() ?? "";
  const downloading = dl && !dl.done ? dl : null;
  const installing = install && !install.done ? install : null;

  return (
    <>
      <div className="vato-set-h">Moteur de transcription</div>
      <div className="vato-seg" style={{ marginBottom: 12 }}>
        {(["whisper", "parakeet", "openai"] as SttEngine[]).map((e) => (
          <button
            key={e}
            className={`vato-seg-btn ${stt.engine === e ? "on" : ""}`}
            onClick={() => setStt({ engine: e })}
          >
            {e === "whisper" ? "Whisper (local)" : e === "parakeet" ? "Parakeet (local)" : "OpenAI (cloud)"}
          </button>
        ))}
      </div>

      <div className={`vato-stt-status ${status?.ready ? "ok" : "warn"}`}>
        <span className="dot" />
        <span className="txt">{status?.ready ? "Moteur prêt" : status?.note ?? "Vérification…"}</span>
        <button className="vato-mini-btn" style={{ flex: "0 0 auto" }} onClick={refresh} title="Revérifier">
          <RefreshIcon size={13} /> Revérifier
        </button>
      </div>

      {/* ---- Trigger mode (shared) ---- */}
      <div className="vato-menu-label" style={{ marginTop: 16 }}>
        Déclenchement
      </div>
      <div className="vato-seg">
        <button
          className={`vato-seg-btn ${stt.mode === "ptt" ? "on" : ""}`}
          onClick={() => setStt({ mode: "ptt" })}
        >
          Maintenir pour parler
        </button>
        <button
          className={`vato-seg-btn ${stt.mode === "continuous" ? "on" : ""}`}
          onClick={() => setStt({ mode: "continuous" })}
        >
          Écoute continue
        </button>
      </div>
      <button
        className={`vato-menu-item toggle ${stt.directInsert ? "on" : ""}`}
        style={{ marginTop: 8 }}
        onClick={() => setStt({ directInsert: !stt.directInsert })}
      >
        <span className={`vato-tick ${stt.directInsert ? "on" : ""}`} />
        Insertion directe — chaque phrase est écrite immédiatement dans le terminal
      </button>

      {stt.engine === "whisper" ? (
        <>
          <div className="vato-menu-label" style={{ marginTop: 16 }}>
            Langue de dictée
          </div>
          <select
            className="vato-input allow-select"
            value={stt.lang}
            onChange={(e) => setStt({ lang: e.target.value })}
          >
            {LANGS.map(([code, label]) => (
              <option key={code} value={code}>
                {label}
              </option>
            ))}
          </select>

          <div className="vato-set-h" style={{ marginTop: 18 }}>
            Modèles Whisper (GGUF)
          </div>
          {WHISPER_MODELS.map((m) => {
            const active = activeModelFile === m.file;
            const isDownloading = downloading?.file === m.file;
            return (
              <div key={m.id} className="vato-stt-model">
                <div className="vato-stt-model-row">
                  <span className="lbl">
                    {m.label}
                    {m.reco && <span className="vato-ws-badge" style={{ marginLeft: 8 }}>conseillé</span>}
                    {active && <span className="vato-ws-badge ok" style={{ marginLeft: 8 }}>actif</span>}
                  </span>
                  <button
                    className="vato-mini-btn"
                    disabled={!!downloading}
                    onClick={() => download(m)}
                  >
                    {isDownloading ? `${downloading?.pct ?? 0}%` : active ? "Re-télécharger" : "Télécharger"}
                  </button>
                </div>
                {isDownloading && (
                  <div className="vato-stt-bar">
                    <span style={{ transform: `scaleX(${(downloading?.pct ?? 0) / 100})` }} />
                  </div>
                )}
              </div>
            );
          })}
          {dl?.error && <div className="vato-stt-err">Échec : {dl.error}</div>}

          <div className="vato-set-h" style={{ marginTop: 18 }}>
            Binaire whisper-cli
          </div>
          <div className="vato-stt-model">
            <div className="vato-stt-model-row">
              <span className="lbl">
                Installation automatique (x64 + DLL)
                {status?.binary_ready && (
                  <span className="vato-ws-badge ok" style={{ marginLeft: 8 }}>
                    installé
                  </span>
                )}
              </span>
              <button className="vato-mini-btn" disabled={!!installing} onClick={installBinary}>
                {installing ? `${install?.pct ?? 0}%` : status?.binary_ready ? "Réinstaller" : "Installer"}
              </button>
            </div>
            {installing && (
              <div className="vato-stt-bar">
                <span style={{ transform: `scaleX(${(install?.pct ?? 0) / 100})` }} />
              </div>
            )}
          </div>
          {install?.error && <div className="vato-stt-err">Échec install : {install.error}</div>}

          <div className="vato-menu-label" style={{ marginTop: 16 }}>
            Chemin manuel (laisser vide = auto / PATH)
          </div>
          <input
            className="vato-input allow-select"
            placeholder={paths ? `${paths.whisper_dir}\\whisper-cli.exe` : "Chemin vers whisper-cli.exe"}
            spellCheck={false}
            value={stt.whisperBinary}
            onChange={(e) => setStt({ whisperBinary: e.target.value })}
          />
          <div className="vato-menu-label">Modèle (rempli au téléchargement)</div>
          <input
            className="vato-input allow-select"
            placeholder="Chemin vers un .bin GGUF"
            spellCheck={false}
            value={stt.whisperModel}
            onChange={(e) => setStt({ whisperModel: e.target.value })}
          />
          <div className="vato-stt-hint">
            « Installer » télécharge et extrait <code>whisper-cli.exe</code> + ses DLL (release whisper.cpp x64)
            dans <code>{paths?.whisper_dir ?? "…/stt/whisper"}</code>. Sinon, dépose-les manuellement à cet
            emplacement ou indique un chemin ci-dessus.
          </div>
        </>
      ) : stt.engine === "openai" ? (
        <>
          <div className="vato-menu-label" style={{ marginTop: 16 }}>
            Clé API OpenAI
          </div>
          <input
            className="vato-input allow-select"
            type="password"
            placeholder="sk-…"
            spellCheck={false}
            value={stt.openaiKey}
            onChange={(e) => setStt({ openaiKey: e.target.value })}
          />
          <div className="vato-menu-label">Modèle</div>
          <select
            className="vato-input allow-select"
            value={stt.openaiModel}
            onChange={(e) => setStt({ openaiModel: e.target.value })}
          >
            <option value="gpt-4o-mini-transcribe">gpt-4o-mini-transcribe (rapide, conseillé)</option>
            <option value="gpt-4o-transcribe">gpt-4o-transcribe (qualité max)</option>
            <option value="whisper-1">whisper-1</option>
          </select>
          <div className="vato-menu-label">Langue</div>
          <select
            className="vato-input allow-select"
            value={stt.lang}
            onChange={(e) => setStt({ lang: e.target.value })}
          >
            {LANGS.map(([code, label]) => (
              <option key={code} value={code}>
                {label}
              </option>
            ))}
          </select>
          <div className="vato-stt-hint">
            Transcription via <code>api.openai.com</code> (appel fait par le backend → pas de CORS). La clé est
            stockée <b>localement</b> et n'est jamais committée. Si elle a fuité, révoque-la sur
            platform.openai.com. Nécessite un compte avec du crédit, sinon erreur{" "}
            <code>insufficient_quota</code>.
          </div>
        </>
      ) : (
        <>
          <div className="vato-stt-hint" style={{ marginTop: 16 }}>
            Parakeet v2 est <b>anglais uniquement</b> et nécessite un sidecar externe (Python/ONNX) qui prend un
            fichier WAV en argument et imprime le texte. Placez l'exécutable dans{" "}
            <code>{paths?.parakeet_dir ?? "…/stt/parakeet"}</code> ou indiquez son chemin.
          </div>
          <div className="vato-menu-label" style={{ marginTop: 12 }}>
            Sidecar Parakeet
          </div>
          <input
            className="vato-input allow-select"
            placeholder="Chemin vers l'exécutable Parakeet"
            spellCheck={false}
            value={stt.parakeetBinary}
            onChange={(e) => setStt({ parakeetBinary: e.target.value })}
          />
        </>
      )}
    </>
  );
}

/* --------------------------- Shortcuts ---------------------------- */
function ShortcutsSection() {
  const shortcuts = useStore((s) => s.settings.shortcuts);
  const setShortcut = useStore((s) => s.setShortcut);
  const resetShortcuts = useStore((s) => s.resetShortcuts);
  const [recording, setRecording] = useState<string | null>(null);

  useEffect(() => {
    if (!recording) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") return setRecording(null);
      const combo = comboFromEvent(e);
      if (!combo) return;
      setShortcut(recording, combo);
      setRecording(null);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [recording, setShortcut]);

  const groups = [...new Set(ACTION_DEFS.map((a) => a.group))];

  return (
    <>
      <div className="vato-set-h">
        Raccourcis clavier
        <button className="vato-mini-btn" style={{ flex: "0 0 auto" }} onClick={() => resetShortcuts()}>
          Réinitialiser
        </button>
      </div>
      {groups.map((g) => (
        <div key={g} className="vato-set-group">
          <div className="vato-menu-label">{g}</div>
          {ACTION_DEFS.filter((a) => a.group === g).map((a) => (
            <div key={a.id} className="vato-set-row">
              <span className="label">{a.label}</span>
              <button
                className={`vato-kbd ${recording === a.id ? "rec" : ""}`}
                onClick={() => setRecording(a.id)}
                title="Cliquer puis appuyer sur la nouvelle combinaison (Échap pour annuler)"
              >
                {recording === a.id ? "Appuyez…" : humanizeCombo(shortcuts[a.id] ?? "")}
              </button>
            </div>
          ))}
        </div>
      ))}
    </>
  );
}

/* --------------------------- Appearance --------------------------- */
function AppearanceSection() {
  const workspaces = useStore((s) => s.workspaces);
  const activeId = useStore((s) => s.activeId);
  const setBackground = useStore((s) => s.setBackground);
  const ws = workspaces.find((w) => w.id === activeId)!;
  const [url, setUrl] = useState(ws.background.kind !== "color" ? ws.background.value : "");
  const dim = ws.background.dim ?? 0;

  const apply = (bg: Background) => setBackground(ws.id, bg);
  const pick = (t: BgTemplate) => apply({ kind: t.kind, value: t.value, dim: t.dim });
  const isOn = (t: BgTemplate) => ws.background.kind === t.kind && ws.background.value === t.value;

  return (
    <>
      <div className="vato-set-h">Fond du workspace « {ws.name} »</div>
      <div className="vato-bg-presets" style={{ marginBottom: 12 }}>
        {BG_PRESETS.map((p, i) => (
          <button
            key={i}
            className="vato-bg-swatch"
            style={{ background: p, height: 44 }}
            onClick={() => apply({ kind: "color", value: p, dim })}
          />
        ))}
      </div>

      <div className="vato-menu-label">Wallpapers — calme & focus</div>
      <div className="vato-bg-gallery">
        {BG_IMAGES.map((t) => (
          <button
            key={t.value}
            className={`vato-bg-tile ${isOn(t) ? "on" : ""}`}
            style={{ backgroundImage: `url("${t.thumb}")` }}
            title={t.label}
            onClick={() => pick(t)}
          >
            <span className="vato-bg-tile-label">{t.label}</span>
          </button>
        ))}
      </div>

      <div className="vato-menu-label" style={{ marginTop: 12 }}>
        Vidéos en boucle — ambiance
      </div>
      <div className="vato-bg-gallery">
        {BG_VIDEOS.map((t) => (
          <button
            key={t.value}
            className={`vato-bg-tile ${isOn(t) ? "on" : ""}`}
            style={{ backgroundImage: `url("${t.thumb}")` }}
            title={t.label}
            onClick={() => pick(t)}
          >
            <span className="vato-bg-tile-badge">▶</span>
            <span className="vato-bg-tile-label">{t.label}</span>
          </button>
        ))}
      </div>

      <div className="vato-menu-label" style={{ marginTop: 12 }}>Image ou vidéo (URL)</div>
      <input
        className="vato-input allow-select"
        placeholder="https://… (.jpg, .png, .mp4)"
        value={url}
        spellCheck={false}
        onChange={(e) => setUrl(e.target.value)}
      />
      <div className="vato-bg-row">
        <button className="vato-mini-btn" onClick={() => url && apply({ kind: "image", value: url, dim: dim || 0.15 })}>
          Image
        </button>
        <button className="vato-mini-btn" onClick={() => url && apply({ kind: "video", value: url, dim: dim || 0.25 })}>
          Vidéo
        </button>
        <button className="vato-mini-btn" onClick={() => apply({ ...ws.background, kind: "color", value: BG_PRESETS[0] })}>
          Réinitialiser
        </button>
      </div>
      <div className="vato-menu-label" style={{ marginTop: 14 }}>
        Assombrir le fond — {Math.round(dim * 100)}%
      </div>
      <input
        type="range"
        min={0}
        max={0.7}
        step={0.05}
        value={dim}
        onChange={(e) => apply({ ...ws.background, dim: parseFloat(e.target.value) })}
        style={{ width: "100%" }}
      />
    </>
  );
}

/* --------------------------- Workspaces --------------------------- */
function WorkspaceCard({ ws, active }: { ws: Workspace; active: boolean }) {
  const setActive = useStore((s) => s.setActive);
  const renameWorkspace = useStore((s) => s.renameWorkspace);
  const setWorkspaceCwd = useStore((s) => s.setWorkspaceCwd);
  const removeWorkspace = useStore((s) => s.removeWorkspace);
  const canDelete = useStore((s) => s.workspaces.length > 1);

  useEffect(() => {
    if (!ws.cwd) homeDir().then((h) => h && setWorkspaceCwd(ws.id, h));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ws.id]);

  return (
    <div className={`vato-ws-card ${active ? "on" : ""}`}>
      <div className="vato-ws-card-top">
        <input
          className="vato-input"
          value={ws.name}
          onChange={(e) => renameWorkspace(ws.id, e.target.value)}
          style={{ marginBottom: 0 }}
        />
        {active ? (
          <span className="vato-ws-badge">actif</span>
        ) : (
          <button className="vato-mini-btn" onClick={() => setActive(ws.id)}>
            Activer
          </button>
        )}
        {canDelete && (
          <button className="vato-tb-btn vato-close" title="Supprimer" onClick={() => removeWorkspace(ws.id)}>
            <TrashIcon size={15} />
          </button>
        )}
      </div>
      <input
        className="vato-input allow-select"
        placeholder="Dossier de travail (cwd)…"
        value={ws.cwd ?? ""}
        spellCheck={false}
        onChange={(e) => setWorkspaceCwd(ws.id, e.target.value)}
        style={{ marginBottom: 0, marginTop: 8 }}
      />
      <div className="vato-ws-card-meta">
        {ws.windows.length} fenêtre{ws.windows.length > 1 ? "s" : ""}
      </div>
    </div>
  );
}

function WorkspacesSection() {
  const workspaces = useStore((s) => s.workspaces);
  const activeId = useStore((s) => s.activeId);
  const openNewWorkspace = useStore((s) => s.openNewWorkspace);
  const toggleSettings = useStore((s) => s.toggleSettings);

  return (
    <>
      <div className="vato-set-h">
        Workspaces
        <button
          className="vato-mini-btn"
          style={{ flex: "0 0 auto" }}
          onClick={() => {
            toggleSettings(false);
            openNewWorkspace();
          }}
        >
          <PlusIcon size={13} /> Nouveau
        </button>
      </div>
      {workspaces.map((w) => (
        <WorkspaceCard key={w.id} ws={w} active={w.id === activeId} />
      ))}
    </>
  );
}

/* ----------------------------- About ------------------------------ */
function AboutSection() {
  return (
    <>
      <div className="vato-set-h">À propos</div>
      <div className="vato-about">
        <img className="vato-about-logo" src="/logo.png" alt="Vato Canvas" draggable={false} />
        <div className="vato-about-title">Vato Canvas</div>
        <div className="vato-about-sub">
          Cockpit multi-agents sur canvas infini — pilotez plusieurs CLI d'IA, un navigateur intégré et un
          tableau blanc, en fenêtres tuilées.
        </div>
        <div className="vato-about-row"><span>Version</span><b>0.1.0</b></div>
        <div className="vato-about-row"><span>Stack</span><b>Tauri v2 · React · Excalidraw · xterm</b></div>
        <div className="vato-about-row"><span>Raccourci réglages</span><b>Ctrl ,</b></div>
      </div>
    </>
  );
}

const CONTENT: Record<string, () => ReactNode> = {
  agents: AgentsSection,
  voice: VoiceSection,
  shortcuts: ShortcutsSection,
  appearance: AppearanceSection,
  workspaces: WorkspacesSection,
  about: AboutSection,
};

export function SettingsPanel() {
  const toggleSettings = useStore((s) => s.toggleSettings);
  const section = useStore((s) => s.settingsSection);
  const setSection = (id: string) => useStore.setState({ settingsSection: id });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") toggleSettings(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleSettings]);

  const active = SECTIONS.find((s) => s.id === section) ?? SECTIONS[0];
  const Content = CONTENT[active.id] ?? AgentsSection;

  return (
    <div className="vato-settings-overlay" onMouseDown={() => toggleSettings(false)}>
      <div className="vato-settings" onMouseDown={(e) => e.stopPropagation()}>
        <aside className="vato-settings-side">
          <div className="vato-settings-brand">
            <img src="/logo.png" alt="" draggable={false} />
            <span>Réglages</span>
          </div>
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              className={`vato-side-item ${s.id === section ? "on" : ""}`}
              onClick={() => setSection(s.id)}
            >
              <s.Icon size={17} />
              <span>{s.label}</span>
            </button>
          ))}
        </aside>

        <main className="vato-settings-main">
          <div className="vato-settings-head">
            <span>{active.label}</span>
            <button className="vato-tb-btn" onClick={() => toggleSettings(false)} title="Fermer (Esc)">
              <CloseIcon size={16} />
            </button>
          </div>
          <div className="vato-settings-body">
            <Content />
          </div>
        </main>
      </div>
    </div>
  );
}
