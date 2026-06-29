import { useStore } from "../store";
import { CLIS } from "../data/clis";
import type { Background, WindowItem, Workspace } from "../types";
import { useT } from "../i18n";
import { CloseIcon, EyeIcon, EyeOffIcon, FocusIcon, PlusIcon, TrashIcon } from "./icons";

function cardStyle(bg: Background): React.CSSProperties {
  if (bg.kind === "color") return { background: bg.value };
  if (bg.kind === "image")
    return { backgroundImage: `url("${bg.value}")`, backgroundSize: "cover", backgroundPosition: "center" };
  return { background: "#11151c" };
}

/** Accent colour of a pane, for the mini layout preview. */
function paneColor(win: WindowItem): string {
  if (win.kind === "browser") return "#5b8cff";
  if (win.kind === "notes") return "#d9b365";
  const id = win.runningCli ?? win.cli ?? "shell";
  return CLIS[id]?.color ?? "#9aa4b2";
}

/** A tiny mosaic that mirrors the workspace's tiled windows. */
function MiniPreview({ windows }: { windows: WindowItem[] }) {
  const n = windows.length;
  if (!n) return null;
  const cols = Math.ceil(Math.sqrt(n));
  return (
    <div className="vato-grid-card-preview" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
      {windows.map((w) => (
        <span
          key={w.id}
          className="tile"
          style={{ background: `${paneColor(w)}33`, borderColor: `${paneColor(w)}88` }}
        />
      ))}
    </div>
  );
}

function WorkspaceCard({ ws, active, focused, canDelete }: {
  ws: Workspace;
  active: boolean;
  focused: boolean;
  canDelete: boolean;
}) {
  const t = useT();
  const setActive = useStore((s) => s.setActive);
  const removeWorkspace = useStore((s) => s.removeWorkspace);
  const toggleWorkspaceHidden = useStore((s) => s.toggleWorkspaceHidden);
  const terminals = ws.windows.filter((x) => x.kind === "terminal").length;

  return (
    <div
      className={`vato-grid-card ${active ? "on" : ""} ${ws.hidden ? "hidden" : ""}`}
      style={cardStyle(ws.background)}
      role="button"
      tabIndex={0}
      onClick={() => setActive(ws.id)}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && setActive(ws.id)}
    >
      <div className="vato-grid-card-dim" />
      <MiniPreview windows={ws.windows} />

      {focused && (
        <span className="vato-grid-card-tag" title={t("grid.focusActive")}>
          <FocusIcon size={12} /> {t("grid.focusTag")}
        </span>
      )}
      {ws.hidden && (
        <span className="vato-grid-card-tag hidden" title={t("grid.hiddenActive")}>
          <EyeOffIcon size={12} /> {t("grid.hiddenTag")}
        </span>
      )}
      <div className="vato-grid-card-actions">
        <button
          className={`vato-grid-card-del hide ${ws.hidden ? "on" : ""}`}
          title={ws.hidden ? t("grid.unhide", { name: ws.name }) : t("grid.hide", { name: ws.name })}
          onClick={(e) => {
            e.stopPropagation();
            toggleWorkspaceHidden(ws.id);
          }}
        >
          {ws.hidden ? <EyeOffIcon size={14} /> : <EyeIcon size={14} />}
        </button>
        {canDelete && (
          <button
            className="vato-grid-card-del"
            title={t("grid.delete", { name: ws.name })}
            onClick={(e) => {
              e.stopPropagation();
              removeWorkspace(ws.id);
            }}
          >
            <TrashIcon size={14} />
          </button>
        )}
      </div>

      <div className="vato-grid-card-body">
        <div className="vato-grid-card-name">{ws.name}</div>
        <div className="vato-grid-card-meta">
          {t("grid.windows", { n: ws.windows.length })}
          {" · "}
          {t("grid.terminals", { n: terminals })}
        </div>
        {ws.cwd && <div className="vato-grid-card-cwd">{ws.cwd}</div>}
      </div>
    </div>
  );
}

export function GridOverview() {
  const t = useT();
  const workspaces = useStore((s) => s.workspaces);
  const activeId = useStore((s) => s.activeId);
  const focusByWorkspace = useStore((s) => s.focusByWorkspace);
  const toggleGrid = useStore((s) => s.toggleGrid);
  const openNewWorkspace = useStore((s) => s.openNewWorkspace);
  const canDelete = workspaces.length > 1;

  return (
    <div className="vato-grid-overlay">
      <div className="vato-grid-head">
        <span>Workspaces</span>
        <button className="vato-tb-btn" onClick={() => toggleGrid(false)} title={t("common.close")}>
          <CloseIcon size={16} />
        </button>
      </div>
      <div className="vato-grid">
        {workspaces.map((w) => (
          <WorkspaceCard
            key={w.id}
            ws={w}
            active={w.id === activeId}
            focused={!!focusByWorkspace[w.id]}
            canDelete={canDelete}
          />
        ))}
        <button className="vato-grid-card add" onClick={() => openNewWorkspace()} title="Nouveau workspace">
          <PlusIcon size={28} />
        </button>
      </div>
    </div>
  );
}
