import { memo, useRef, useState } from "react";
import { Rnd } from "react-rnd";
import { useStore } from "../store";
import type { AgentStatus, WindowItem } from "../types";
import { CLIS } from "../data/clis";
import { TerminalPane } from "../panes/TerminalPane";
import { BrowserPane } from "../panes/BrowserPane";
import { useDrag } from "../canvas/dragState";
import { nearestSlotIndex, reorderIds } from "../canvas/tiling";
import { CloseIcon, GlobeIcon, MaximizeIcon, MinimizeIcon } from "../ui/icons";

function ringClass(status?: AgentStatus): string {
  switch (status) {
    case "active":
    case "starting":
      return "vato-ring-active";
    case "finished":
      return "vato-ring-finished";
    case "error":
      return "vato-ring-error";
    default:
      return "";
  }
}

function shortUrl(u?: string): string {
  if (!u) return "";
  try {
    return new URL(u).host || u;
  } catch {
    return u;
  }
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Props {
  win: WindowItem;
  rect: Rect;
  /** Live canvas zoom — the window scales with it in free mode (coupled). */
  zoom: number;
  focusMode: boolean;
  fullscreen: boolean;
  hidden: boolean;
  isDragged: boolean;
  animate: boolean;
}

function WindowFrameImpl({ win, rect, zoom, focusMode, fullscreen, hidden, isDragged, animate }: Props) {
  const bringToFront = useStore((s) => s.bringToFront);
  const removeWindow = useStore((s) => s.removeWindow);
  const setFullscreen = useStore((s) => s.setFullscreen);
  const moveWindow = useStore((s) => s.moveWindow);

  const baseIds = useRef<string[]>([]);
  // True while the user is freely dragging this window (free mode) — kills the
  // position transition so it tracks the cursor instead of easing behind it.
  const [freeDragging, setFreeDragging] = useState(false);

  const isTerminal = win.kind === "terminal";
  // Prefer the agent detected running *inside* the pane over the spawn CLI,
  // so launching `claude` in a shell updates the icon/accent/label live.
  const cliId = isTerminal ? win.runningCli ?? win.cli : undefined;
  const cli = cliId ? CLIS[cliId] : null;

  const position = fullscreen ? { x: 0, y: 0 } : { x: rect.x, y: rect.y };
  const size = fullscreen
    ? { width: window.innerWidth, height: window.innerHeight }
    : { width: rect.width, height: rect.height };
  // Free mode: the overlay is scaled by `zoom`, so the window's coords/size are in
  // SCENE space and react-rnd must know the parent scale (drag math, position).
  // Focus + fullscreen render at fixed screen pixels (overlay identity) → scale 1.
  const scale = fullscreen || focusMode ? 1 : zoom;

  const onDragStart = () => {
    bringToFront(win.id);
    if (focusMode) {
      // Focus mode: dragging a titlebar reorders the grid (live preview).
      const s = useStore.getState();
      const ws = s.workspaces.find((w) => w.id === s.activeId);
      baseIds.current = ws ? ws.windows.map((w) => w.id) : [win.id];
      useDrag.getState().begin(win.id, baseIds.current);
    } else {
      // Free mode: dragging moves the window to an arbitrary canvas position.
      setFreeDragging(true);
    }
  };

  const onDrag = (_e: any, d: { x: number; y: number }) => {
    if (!focusMode) return; // free move is committed on stop
    const n = baseIds.current.length;
    if (n <= 1) return;
    // Use the displayed (grid-tile) size for the centre, not the stored free size.
    const cx = d.x + rect.width / 2;
    const cy = d.y + rect.height / 2;
    const idx = nearestSlotIndex(cx, cy, n);
    const ids = reorderIds(baseIds.current, win.id, idx);
    useDrag.getState().preview(ids, idx);
  };

  const onDragStop = (_e: any, d: { x: number; y: number }) => {
    if (focusMode) {
      const { previewIds } = useDrag.getState();
      if (previewIds) useStore.getState().reorderWindows(previewIds);
      useDrag.getState().end();
    } else {
      setFreeDragging(false);
      moveWindow(win.id, d.x, d.y);
    }
  };

  return (
    <Rnd
      scale={scale}
      position={position}
      size={size}
      disableDragging={fullscreen}
      enableResizing={false}
      dragHandleClassName="vato-titlebar"
      cancel=".vato-no-drag"
      onDragStart={onDragStart}
      onDrag={onDrag}
      onDragStop={onDragStop}
      style={{
        zIndex: fullscreen ? 9999 : isDragged || freeDragging ? 9000 : win.z,
        display: hidden ? "none" : undefined,
        pointerEvents: "auto",
        transition: animate && !isDragged && !freeDragging ? "transform 0.16s ease" : "none",
      }}
      onMouseDownCapture={() => bringToFront(win.id)}
    >
      <div
        className={`vato-window ${ringClass(isTerminal ? win.status : undefined)} ${isDragged ? "dragging" : ""}`}
        style={cli ? ({ ["--accent" as string]: cli.color } as React.CSSProperties) : undefined}
      >
        <div className="vato-titlebar">
          <span className="vato-tb-icon" style={cli ? { color: cli.color } : undefined}>
            {isTerminal && cli ? <cli.Icon size={16} /> : <GlobeIcon size={16} />}
          </span>
          <span className="vato-tb-title">{win.title}</span>
          {isTerminal && cli && <span className="vato-tb-sub">{cli.label}</span>}
          {win.kind === "browser" && <span className="vato-tb-sub">{shortUrl(win.url)}</span>}

          <div className="vato-tb-spacer" />

          {isTerminal && <span className={`vato-status-dot s-${win.status ?? "idle"}`} />}

          <button
            className="vato-tb-btn vato-no-drag"
            title={fullscreen ? "Quitter le plein écran" : "Plein écran"}
            onClick={() => setFullscreen(fullscreen ? null : win.id)}
          >
            {fullscreen ? <MinimizeIcon size={15} /> : <MaximizeIcon size={15} />}
          </button>
          <button
            className="vato-tb-btn vato-no-drag vato-close"
            title="Fermer"
            onClick={() => removeWindow(win.id)}
          >
            <CloseIcon size={15} />
          </button>
        </div>

        <div className="vato-body allow-select">
          {win.kind === "terminal" && <TerminalPane win={win} />}
          {win.kind === "browser" && <BrowserPane win={win} />}
        </div>
      </div>
    </Rnd>
  );
}

export const WindowFrame = memo(WindowFrameImpl);
