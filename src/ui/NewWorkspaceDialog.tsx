import { useCallback, useEffect, useRef, useState } from "react";
import { useStore, baseName } from "../store";
import { listDir, type DirListing } from "../pty";
import { ArrowLeftIcon, CloseIcon, FolderIcon, RefreshIcon } from "./icons";

/** Path separator inferred from a path (Windows backslash vs POSIX slash). */
const sepOf = (p: string) => (p.includes("\\") ? "\\" : "/");

/** Join a child name onto a directory path using its own separator. */
function joinPath(base: string, name: string) {
  return base.replace(/[\\/]+$/, "") + sepOf(base) + name;
}

/** Is this an absolute path (drive letter, POSIX root, or UNC share)? */
const isAbsolute = (p: string) => /^[a-zA-Z]:/.test(p) || p.startsWith("/") || p.startsWith("\\\\");

/** Clickable breadcrumb segments, each carrying the path to navigate to. */
function crumbs(p: string): { seg: string; target: string }[] {
  const sep = sepOf(p);
  const unixRoot = p.startsWith("/");
  const parts = p.split(/[\\/]+/).filter(Boolean);
  return parts.map((seg, i) => {
    let target = parts.slice(0, i + 1).join(sep);
    if (unixRoot) target = "/" + target;
    // A bare drive letter ("C:") needs a trailing separator to resolve as a root.
    if (i === 0 && /^[a-zA-Z]:$/.test(seg)) target = seg + sep;
    return { seg, target };
  });
}

/**
 * "Nouveau workspace" — a terminal-flavoured folder picker. Drill into the
 * filesystem by clicking sub-folders, the breadcrumb, or by typing `cd`-style
 * commands (`cd nom`, `cd ..`, `ls`, `~`, or a full path). The chosen folder
 * becomes the workspace's cwd and its last segment becomes its name.
 */
export function NewWorkspaceDialog() {
  const addWorkspace = useStore((s) => s.addWorkspace);
  const close = useStore((s) => s.closeNewWorkspace);

  const [path, setPath] = useState("");
  const [listing, setListing] = useState<DirListing | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cmd, setCmd] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const go = useCallback((target?: string) => {
    setLoading(true);
    setError(null);
    listDir(target)
      .then((l) => {
        setListing(l);
        setPath(l.path);
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, []);

  // Open on the home directory.
  useEffect(() => {
    go();
  }, [go]);

  // Esc closes; keep the command line focused.
  useEffect(() => {
    inputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        close();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [close]);

  const runCmd = () => {
    const raw = cmd.trim();
    setCmd("");
    if (!raw) return;
    const lower = raw.toLowerCase();
    if (lower === "ls" || lower === "dir") return go(path);
    if (lower === "~" || lower === "home" || lower === "cd" || lower === "cd ~") return go(undefined);

    let target = lower.startsWith("cd ") ? raw.slice(3).trim() : raw;
    target = target.replace(/^["']|["']$/g, ""); // strip surrounding quotes
    if (target === "..") return go(listing?.parent ?? path);
    if (target === ".") return go(path);
    go(isAbsolute(target) ? target : joinPath(path, target));
  };

  const name = baseName(path) ?? "workspace";
  const parent = listing?.parent ?? null;
  const segs = path ? crumbs(path) : [];

  return (
    <div className="vato-newws-overlay" onMouseDown={() => close()}>
      <div className="vato-newws" onMouseDown={(e) => e.stopPropagation()}>
        <div className="vato-newws-head">
          <div>
            <h2>Nouveau workspace</h2>
            <p>Choisissez le dossier racine du projet — il donnera son nom au workspace.</p>
          </div>
          <button className="vato-tb-btn" onClick={() => close()} title="Fermer (Esc)">
            <CloseIcon size={16} />
          </button>
        </div>

        {/* Breadcrumb of the current location. */}
        <div className="vato-newws-crumbs">
          {segs.map((c, i) => (
            <span key={c.target + i} className="crumb">
              <button onClick={() => go(c.target)}>{c.seg}</button>
              {i < segs.length - 1 && <span className="sep">{sepOf(path)}</span>}
            </span>
          ))}
          <button className="vato-newws-refresh" onClick={() => go(path)} title="Rafraîchir">
            <RefreshIcon size={13} />
          </button>
        </div>

        {/* Directory listing (terminal-style). */}
        <div className="vato-newws-list">
          {parent && (
            <button className="vato-newws-row up" onClick={() => go(parent)}>
              <ArrowLeftIcon size={15} />
              <span className="nm">..</span>
              <span className="hint">dossier parent</span>
            </button>
          )}
          {loading && <div className="vato-newws-empty">Chargement…</div>}
          {error && <div className="vato-newws-err">{error}</div>}
          {!loading && !error && listing?.entries.length === 0 && (
            <div className="vato-newws-empty">Aucun sous-dossier ici.</div>
          )}
          {!loading &&
            !error &&
            listing?.entries.map((e) => (
              <button
                key={e.name}
                className="vato-newws-row"
                onClick={() => go(joinPath(path, e.name))}
                onDoubleClick={() => go(joinPath(path, e.name))}
              >
                <FolderIcon size={15} />
                <span className="nm">{e.name}</span>
              </button>
            ))}
        </div>

        {/* Fake `cd` command line. */}
        <div className="vato-newws-cmd">
          <span className="prompt">›</span>
          <input
            ref={inputRef}
            className="allow-select"
            placeholder="cd nom_du_dossier · cd .. · ls · ~ · chemin complet"
            spellCheck={false}
            autoComplete="off"
            value={cmd}
            onChange={(e) => setCmd(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                runCmd();
              }
            }}
          />
        </div>

        <div className="vato-newws-foot">
          <div className="vato-newws-target">
            <span className="lbl">Dossier&nbsp;:</span>
            <code>{path || "—"}</code>
            {listing && (
              <span className="meta">
                {listing.entries.length} dossier{listing.entries.length > 1 ? "s" : ""} ·{" "}
                {listing.file_count} fichier{listing.file_count > 1 ? "s" : ""}
              </span>
            )}
          </div>
          <div className="vato-newws-actions">
            <button className="vato-resume-btn ghost" onClick={() => close()}>
              Annuler
            </button>
            <button
              className="vato-resume-btn primary"
              disabled={!path || loading}
              onClick={() => addWorkspace({ cwd: path, name })}
            >
              Créer «&nbsp;{name}&nbsp;»
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
