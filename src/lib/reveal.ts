// "Go to an agent" — the control center's jump action.
//
// Given a window id living in ANY workspace, switch to its workspace, bring the
// pane to the front, keyboard-focus its terminal, and warp the OS mouse cursor
// onto it. A jump behaves like a NORMAL workspace switch: `setActive` restores the
// target space's own focus mode (focusByWorkspace). So:
//   • target in FREE mode  → center the viewport on the pane (it floats at its
//     stored position).
//   • target in FOCUS mode → keep focus on; the pane is a grid tile already, just
//     widen the filter if it would hide this pane. We must NOT touch the viewport
//     here — an Excalidraw scroll/zoom change exits focus (Canvas onChange).
//
// A workspace switch unmounts/remounts the canvas + panes, so the cursor work is
// deferred a beat to let React and the Excalidraw API settle.

import { useStore, focusGridWindows } from "../store";
import { bus } from "./bus";
import { centerViewportOnWindow } from "../canvas/canvasState";
import { moveCursor } from "../pty";

/** Navigate to a window (terminal/agent/browser) wherever it lives. */
export function revealWindow(winId: string) {
  const s = useStore.getState();

  let targetWsId: string | undefined;
  let win: { id: string; kind: string; x: number; y: number; width: number; height: number } | undefined;
  for (const w of s.workspaces) {
    const found = w.windows.find((x) => x.id === winId);
    if (found) {
      targetWsId = w.id;
      win = found;
      break;
    }
  }
  if (!targetWsId || !win) return;
  const w = win;

  const switched = s.activeId !== targetWsId;
  // Like a normal switch: this restores the target space's own focus mode.
  if (switched) s.setActive(targetWsId);
  if (w.kind === "terminal") s.setLastActiveTerminal(winId);
  // Close the palette itself.
  s.toggleControlCenter(false);

  const apply = () => {
    const st = useStore.getState();
    st.bringToFront(winId);
    if (st.focusMode) {
      // Keep focus on (the space uses it). The pane is a grid tile; only widen the
      // filter when it would hide this pane. Touching the viewport would exit focus.
      const ws = st.workspaces.find((x) => x.id === targetWsId);
      if (ws && !focusGridWindows(ws).some((x) => x.id === winId)) st.setFocusFilter("all");
    } else {
      // Free mode: float the pane into the center so it's legible.
      centerViewportOnWindow(w);
    }
    // Let the layout settle, then focus the pane + drop the cursor on it.
    window.setTimeout(() => {
      bus.emit(`term:focus:${winId}`);
      const el = document.querySelector<HTMLElement>(`[data-win-id="${winId}"]`);
      if (!el) return;
      const r = el.getBoundingClientRect();
      void moveCursor(r.left + r.width / 2, r.top + r.height / 2);
      // A brief highlight pulse so the eye lands where the cursor was warped.
      el.classList.add("vato-reveal-pulse");
      window.setTimeout(() => el.classList.remove("vato-reveal-pulse"), 1200);
    }, 90);
  };

  // Same workspace → next frame is enough; a switch needs the remount to finish
  // (fresh ExcalidrawCanvas re-registers its API, panes re-attach their PTYs).
  if (switched) window.setTimeout(apply, 150);
  else window.requestAnimationFrame(apply);
}
