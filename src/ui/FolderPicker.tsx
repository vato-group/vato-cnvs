import { useCallback, useEffect, useRef, useState } from "react";
import { listDir, type DirListing } from "../pty";
import { useT } from "../i18n";
import { ArrowLeftIcon, FolderIcon, RefreshIcon } from "./icons";

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

export interface FolderPickerProps {
  /** Folder to open on first render (falls back to the home directory). */
  initialCwd?: string;
  /** Notified on every successful navigation with the resolved path + listing. */
  onChange: (path: string, listing: DirListing | null) => void;
  /** Focus the `cd` command line on mount (default true). */
  autoFocus?: boolean;
}

/**
 * Terminal-flavoured filesystem folder picker — drill in by clicking sub-folders,
 * the breadcrumb, or by typing `cd`-style commands (`cd nom`, `cd ..`, `ls`, `~`,
 * or a full path). Pure navigation: the host decides what to do with the chosen
 * path (reported via `onChange`). Shared by the new-workspace dialog and the
 * first-run onboarding wizard.
 */
export function FolderPicker({ initialCwd, onChange, autoFocus = true }: FolderPickerProps) {
  const t = useT();
  const [path, setPath] = useState("");
  const [listing, setListing] = useState<DirListing | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cmd, setCmd] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // Keep the latest callback without re-running the mount effect when it changes.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const go = useCallback((target?: string) => {
    setLoading(true);
    setError(null);
    listDir(target)
      .then((l) => {
        setListing(l);
        setPath(l.path);
        onChangeRef.current(l.path, l);
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, []);

  // Open on the provided folder, falling back to the home directory.
  useEffect(() => {
    go(initialCwd);
    // Only run on mount: capture the initial cwd as it was when the picker opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [go]);

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

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

  const parent = listing?.parent ?? null;
  const segs = path ? crumbs(path) : [];

  return (
    <>
      {/* Breadcrumb of the current location. */}
      <div className="vato-newws-crumbs">
        {segs.map((c, i) => (
          <span key={c.target + i} className="crumb">
            <button onClick={() => go(c.target)}>{c.seg}</button>
            {i < segs.length - 1 && <span className="sep">{sepOf(path)}</span>}
          </span>
        ))}
        <button className="vato-newws-refresh" onClick={() => go(path)} title={t("newws.refresh")}>
          <RefreshIcon size={13} />
        </button>
      </div>

      {/* Directory listing (terminal-style). */}
      <div className="vato-newws-list">
        {parent && (
          <button className="vato-newws-row up" onClick={() => go(parent)}>
            <ArrowLeftIcon size={15} />
            <span className="nm">..</span>
            <span className="hint">{t("newws.parent")}</span>
          </button>
        )}
        {loading && <div className="vato-newws-empty">{t("newws.loading")}</div>}
        {error && <div className="vato-newws-err">{error}</div>}
        {!loading && !error && listing?.entries.length === 0 && (
          <div className="vato-newws-empty">{t("newws.noSubfolders")}</div>
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
          placeholder={t("newws.cmdPlaceholder")}
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
    </>
  );
}
