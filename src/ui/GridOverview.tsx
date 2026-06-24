import { useStore } from "../store";
import { CLIS } from "../data/clis";
import type { Background, WindowItem, Workspace } from "../types";
import { CloseIcon, FocusIcon, PlusIcon, TrashIcon } from "./icons";

function cardStyle(bg: Background): React.CSSProperties {
  if (bg.kind === "color") return { background: bg.value };
  if (bg.kind === "image")
    return { backgroundImage: `url("${bg.value}")`, backgroundSize: "cover", backgroundPosition: "center" };
  return { background: "#11151c" };
}

/** Accent colour of a pane, for the mini layout preview. */
function paneColor(win: WindowItem): string {
  if (win.kind === "browser") return "#5b8cff";
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
  const setActive = useStore((s) => s.setActive);
  const removeWorkspace = useStore((s) => s.removeWorkspace);
  const terminals = ws.windows.filter((x) => x.kind === "terminal").length;

  return (
    <div
      className={`vato-grid-card ${active ? "on" : ""}`}
      style={cardStyle(ws.background)}
      role="button"
      tabIndex={0}
      onClick={() => setActive(ws.id)}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && setActive(ws.id)}
    >
      <div className="vato-grid-card-dim" />
      <MiniPreview windows={ws.windows} />

      {focused && (
        <span className="vato-grid-card-tag" title="Mode focus actif dans cet espace">
          <FocusIcon size={12} /> focus
        </span>
      )}
      {canDelete && (
        <button
          className="vato-grid-card-del"
          title={`Supprimer « ${ws.name} »`}
          onClick={(e) => {
            e.stopPropagation();
            removeWorkspace(ws.id);
          }}
        >
          <TrashIcon size={14} />
        </button>
      )}

      <div className="vato-grid-card-body">
        <div className="vato-grid-card-name">{ws.name}</div>
        <div className="vato-grid-card-meta">
          {ws.windows.length} fenêtre{ws.windows.length > 1 ? "s" : ""}
          {" · "}
          {terminals} terminal{terminals > 1 ? "s" : ""}
        </div>
        {ws.cwd && <div className="vato-grid-card-cwd">{ws.cwd}</div>}
      </div>
    </div>
  );
}

export function GridOverview() {
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
        <button className="vato-tb-btn" onClick={() => toggleGrid(false)} title="Fermer">
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
