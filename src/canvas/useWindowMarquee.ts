import { useEffect } from "react";
import { useStore } from "../store";
import { getExcalidrawApi, screenToScene, useCanvasState } from "./canvasState";
import { useSelection } from "./selectionState";

/** Windows of the active workspace (scene-coordinate boxes). */
function activeWindows() {
  const s = useStore.getState();
  const ws = s.workspaces.find((w) => w.id === s.activeId);
  return ws?.windows ?? [];
}

function intersects(
  r: { minX: number; minY: number; maxX: number; maxY: number },
  w: { x: number; y: number; width: number; height: number },
) {
  return !(r.maxX < w.x || r.minX > w.x + w.width || r.maxY < w.y || r.minY > w.y + w.height);
}

/** True when a keystroke should reach a terminal / input instead of the canvas. */
function isTextEntry(): boolean {
  const el = document.activeElement as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA") return true;
  if (el.isContentEditable) return true;
  if (el.closest?.(".xterm")) return true;
  return false;
}

/**
 * Marquee multi-selection of windows. With the Selection tool active (free mode),
 * dragging a box on the empty whiteboard selects the windows it touches; Shift
 * adds to the current set. A bare click clears. Delete/Backspace closes the
 * selection; Escape clears it. Runs through window-level capture listeners so it
 * coexists with Excalidraw's own drawing marquee (drawings + windows both react).
 */
export function useWindowMarquee() {
  useEffect(() => {
    let startScene: { x: number; y: number } | null = null;
    let lastScene: { x: number; y: number } | null = null;
    let moved = false;
    let additive = false;
    let baseIds: string[] = [];
    let baseElementIds: Record<string, boolean> = {};

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      if (useCanvasState.getState().activeTool !== "selection") return;
      if (useStore.getState().focusMode) return;
      // Only start on the empty whiteboard (a <canvas>), never over a window/UI.
      if (!(e.target instanceof HTMLCanvasElement)) return;
      startScene = screenToScene(e.clientX, e.clientY);
      lastScene = startScene;
      moved = false;
      additive = e.shiftKey;
      baseIds = additive ? [...useSelection.getState().selectedIds] : [];
      baseElementIds = additive ? { ...(getExcalidrawApi()?.getAppState().selectedElementIds ?? {}) } : {};
    };

    const boxOf = (a: { x: number; y: number }, b: { x: number; y: number }) => ({
      minX: Math.min(a.x, b.x),
      minY: Math.min(a.y, b.y),
      maxX: Math.max(a.x, b.x),
      maxY: Math.max(a.y, b.y),
    });

    const onMove = (e: PointerEvent) => {
      if (!startScene) return;
      const cur = screenToScene(e.clientX, e.clientY);
      lastScene = cur;
      if (!moved && Math.abs(cur.x - startScene.x) < 3 && Math.abs(cur.y - startScene.y) < 3) return;
      moved = true;
      const r = boxOf(startScene, cur);
      const hit = activeWindows()
        .filter((w) => intersects(r, w))
        .map((w) => w.id);
      useSelection.getState().setSelected(additive ? Array.from(new Set([...baseIds, ...hit])) : hit);
    };

    const onUp = () => {
      if (startScene && !moved && !additive) {
        // A bare click on the empty canvas clears windows AND drawings.
        useSelection.getState().clear();
        getExcalidrawApi()?.updateScene({ appState: { selectedElementIds: {} } });
      } else if (startScene && moved && lastScene) {
        // The same box also selects the Excalidraw drawings/images/text it covers.
        // Done here (deferred past Excalidraw's own pointerup) so it's reliable even
        // when the drag crossed the DOM windows, which break Excalidraw's marquee.
        const r = boxOf(startScene, lastScene);
        const api = getExcalidrawApi();
        if (api) {
          const ids: Record<string, boolean> = { ...baseElementIds };
          for (const el of api.getSceneElements() as any[]) {
            if (el?.isDeleted) continue;
            if (intersects(r, { x: el.x, y: el.y, width: el.width ?? 0, height: el.height ?? 0 })) {
              ids[el.id] = true;
            }
          }
          window.setTimeout(() => api.updateScene({ appState: { selectedElementIds: ids } }), 0);
        }
      }
      startScene = null;
      lastScene = null;
    };

    const onKey = (e: KeyboardEvent) => {
      if (!useSelection.getState().selectedIds.length) return;
      if (e.key === "Escape") {
        useSelection.getState().clear();
        return;
      }
      if (e.key !== "Delete" && e.key !== "Backspace") return;
      if (isTextEntry()) return;
      e.preventDefault();
      const remove = useStore.getState().removeWindow;
      for (const id of useSelection.getState().selectedIds) remove(id);
      useSelection.getState().clear();
    };

    const opts = { capture: true } as const;
    window.addEventListener("pointerdown", onDown, opts);
    window.addEventListener("pointermove", onMove, opts);
    window.addEventListener("pointerup", onUp, opts);
    window.addEventListener("keydown", onKey, opts);
    return () => {
      window.removeEventListener("pointerdown", onDown, opts as EventListenerOptions);
      window.removeEventListener("pointermove", onMove, opts as EventListenerOptions);
      window.removeEventListener("pointerup", onUp, opts as EventListenerOptions);
      window.removeEventListener("keydown", onKey, opts as EventListenerOptions);
    };
  }, []);

  // Selection is meaningless in the focus grid and per-workspace — drop it when
  // focus toggles on or the workspace changes.
  const focusMode = useStore((s) => s.focusMode);
  const activeId = useStore((s) => s.activeId);
  useEffect(() => {
    useSelection.getState().clear();
  }, [focusMode, activeId]);
}
