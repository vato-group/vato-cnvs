import { useEffect, useState } from "react";
import { useStore, baseName } from "../store";
import type { DirListing } from "../pty";
import type { FocusFilter } from "../types";
import { useT } from "../i18n";
import { FolderPicker } from "./FolderPicker";
import { CloseIcon } from "./icons";

/**
 * "Nouveau workspace" — wraps the shared {@link FolderPicker} with the workspace
 * chrome (name preview, default focus filter, create action). The chosen folder
 * becomes the workspace's cwd and its last segment becomes its name.
 */
export function NewWorkspaceDialog({ forced = false }: { forced?: boolean }) {
  const t = useT();
  const addWorkspace = useStore((s) => s.addWorkspace);
  const close = useStore((s) => s.closeNewWorkspace);
  // Start from the active workspace's folder so the picker opens where you are
  // (undefined on first run when there is no workspace yet → falls back to home).
  const activeCwd = useStore((s) => s.workspaces.find((w) => w.id === s.activeId)?.cwd);

  const [path, setPath] = useState("");
  const [listing, setListing] = useState<DirListing | null>(null);
  // Default focus-mode pane filter for the new space (changeable later in focus).
  const [focusFilter, setFocusFilter] = useState<FocusFilter>("all");

  // Esc closes. When forced (first run), the dialog can't be dismissed.
  useEffect(() => {
    if (forced) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        close();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [close, forced]);

  const name = baseName(path) ?? "workspace";

  return (
    <div className="vato-newws-overlay" onMouseDown={() => !forced && close()}>
      <div className="vato-newws" onMouseDown={(e) => e.stopPropagation()}>
        <div className="vato-newws-head">
          <div>
            <h2>{forced ? t("newws.welcomeTitle") : t("newws.title")}</h2>
            <p>{forced ? t("newws.welcomeDesc") : t("newws.desc")}</p>
          </div>
          {!forced && (
            <button className="vato-tb-btn" onClick={() => close()} title={t("settings.closeEsc")}>
              <CloseIcon size={16} />
            </button>
          )}
        </div>

        <FolderPicker
          initialCwd={activeCwd}
          onChange={(p, l) => {
            setPath(p);
            setListing(l);
          }}
        />

        {/* Default focus-mode pane filter for this space (per workspace, editable later). */}
        <div className="vato-newws-focus">
          <span className="lbl">{t("newws.focusLabel")}</span>
          <div className="vato-focus-filter" role="group" aria-label={t("newws.focusAria")}>
            {([
              ["all", t("common.all")],
              ["agents", t("common.agents")],
              ["terminals", t("common.terminals")],
            ] as const).map(([value, label]) => (
              <button
                key={value}
                type="button"
                className={`vato-seg ${focusFilter === value ? "on" : ""}`}
                onClick={() => setFocusFilter(value as FocusFilter)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="vato-newws-foot">
          <div className="vato-newws-target">
            <span className="lbl">{t("newws.folder")}</span>
            <code>{path || "—"}</code>
            {listing && (
              <span className="meta">
                {t("newws.dirs", { n: listing.entries.length })} ·{" "}
                {t("newws.files", { n: listing.file_count })}
              </span>
            )}
          </div>
          <div className="vato-newws-actions">
            {!forced && (
              <button className="vato-resume-btn ghost" onClick={() => close()}>
                {t("common.cancel")}
              </button>
            )}
            <button
              className="vato-resume-btn primary"
              disabled={!path}
              onClick={() => addWorkspace({ cwd: path, name, focusFilter })}
            >
              {t("newws.create", { name })}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
