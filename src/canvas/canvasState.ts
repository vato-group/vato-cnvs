import { create } from "zustand";
import { useStore } from "../store";

/** Excalidraw active-tool type names we drive from the custom toolbar. */
export type ToolType =
  | "selection"
  | "hand"
  | "rectangle"
  | "diamond"
  | "ellipse"
  | "arrow"
  | "line"
  | "freedraw"
  | "text"
  | "image"
  | "eraser";

interface CanvasState {
  /** Live Excalidraw viewport (scene <-> screen). Updated every onChange. */
  scrollX: number;
  scrollY: number;
  zoom: number;
  activeTool: ToolType;
  ready: boolean;
  /**
   * Tick bumped whenever the selection set, the selected elements' style, or the
   * "next shape" defaults change. The style panel subscribes to it and re-reads
   * everything from the Excalidraw API — cheap, and avoids mirroring the whole
   * element model into the store.
   */
  styleRev: number;

  setViewport: (v: { scrollX: number; scrollY: number; zoom: number }) => void;
  /** onChange path: bump styleRev iff the selection/style signature changed. */
  bumpStyle: (signature: string) => void;
  /** onChange path: mirror the live Excalidraw viewport into the store. */
  syncViewport: (scrollX: number, scrollY: number, zoom: number) => void;
  /** Reset the whiteboard viewport to origin / 100%. */
  resetCanvas: () => void;
  setActiveTool: (t: ToolType) => void;
  setReady: (r: boolean) => void;
}

/** Last computed selection/style signature (module-local — not reactive). */
let lastStyleSig = "";

/**
 * Cheap signature of "what the style panel should show": the selected element
 * ids + their versions (so canvas-side style edits are seen), or — when nothing
 * is selected — the "next shape" defaults. Bump styleRev only when this changes.
 */
export function selectionSignature(elements: readonly any[], appState: any): string {
  const ids: Record<string, boolean> = appState.selectedElementIds || {};
  const selIds = Object.keys(ids)
    .filter((id) => ids[id])
    .sort();
  if (selIds.length) {
    const ver = new Map<string, number>();
    for (const e of elements) if (ids[e.id]) ver.set(e.id, e.version);
    return "sel|" + selIds.map((id) => `${id}:${ver.get(id) ?? 0}`).join(",");
  }
  return (
    "def|" +
    [
      appState.currentItemStrokeColor,
      appState.currentItemBackgroundColor,
      appState.currentItemFillStyle,
      appState.currentItemStrokeWidth,
      appState.currentItemStrokeStyle,
      appState.currentItemRoughness,
      appState.currentItemOpacity,
      appState.currentItemRoundness,
      appState.currentItemFontFamily,
      appState.currentItemFontSize,
      appState.currentItemTextAlign,
      appState.currentItemStartArrowhead,
      appState.currentItemEndArrowhead,
    ].join(",")
  );
}

/**
 * Fast, NON-persisted store for the Excalidraw viewport + tool.
 * Kept separate from the persisted layout store so high-frequency
 * pan/zoom updates never thrash localStorage.
 */
export const useCanvasState = create<CanvasState>((set) => ({
  scrollX: 0,
  scrollY: 0,
  zoom: 1,
  // Hand (pan) is the default tool — the canvas is for moving around first,
  // drawing/selecting second. Excalidraw is set to match on mount.
  activeTool: "hand",
  ready: false,
  styleRev: 0,
  setViewport: (v) => set(v),
  bumpStyle: (signature) => {
    if (signature === lastStyleSig) return;
    lastStyleSig = signature;
    set((st) => ({ styleRev: st.styleRev + 1 }));
  },
  // The window overlay tracks the viewport exactly (translate + scale, coupled),
  // so mirroring scroll/zoom into the store is all that's needed.
  syncViewport: (scrollX, scrollY, zoom) => set({ scrollX, scrollY, zoom }),
  resetCanvas: () => set({ scrollX: 0, scrollY: 0, zoom: 1 }),
  setActiveTool: (t) => set({ activeTool: t }),
  setReady: (r) => set({ ready: r }),
}));

/**
 * Imperative bridge to the Excalidraw API instance (not React state —
 * the toolbar calls these directly). Set once Excalidraw mounts.
 */
type ExcalidrawAPI = any;
let excalidrawApi: ExcalidrawAPI | null = null;

export function setExcalidrawApi(api: ExcalidrawAPI | null) {
  excalidrawApi = api;
}
export function getExcalidrawApi(): ExcalidrawAPI | null {
  return excalidrawApi;
}

/** Select a drawing tool in Excalidraw + reflect it in the store. */
export function selectTool(t: ToolType) {
  useCanvasState.getState().setActiveTool(t);
  excalidrawApi?.setActiveTool({ type: t });
}

/**
 * Focus mode toggle. Free mode couples the windows to the viewport (they pan AND
 * zoom with the drawings). Focus is a pure flag flip that does NOT touch the
 * viewport: it lays the windows out in a readable screen-pixel grid at 1:1 (the
 * stored scene x/y are untouched), so it doubles as the "make terminals legible"
 * escape from a zoomed-out canvas. Leaving focus drops the grid and the windows
 * spring back to their coupled positions at the current zoom.
 */
export function setFocusMode(on: boolean) {
  const store = useStore.getState();
  if (on === store.focusMode) return;
  store.setFocusMode(on);
}

/** Flip focus mode on/off. */
export function toggleFocusMode() {
  setFocusMode(!useStore.getState().focusMode);
}

/** Convert screen px (relative to canvas) -> Excalidraw scene coords. */
export function screenToScene(px: number, py: number) {
  const { scrollX, scrollY, zoom } = useCanvasState.getState();
  return { x: px / zoom - scrollX, y: py / zoom - scrollY };
}

// ---- Wheel-driven zoom / pan -------------------------------------------------
// Shared by the global canvas handler (Canvas.tsx) and the browser-iframe
// injection (BrowserPane.tsx) so the gesture model lives in one place:
//   wheel = zoom · shift+wheel = pan · ctrl+wheel = scroll content
const MIN_ZOOM = 0.1; //  10%  (matches Excalidraw)
const MAX_ZOOM = 30; // 3000%
const ZOOM_SENSITIVITY = 0.0015;

/** The Excalidraw container element — origin for screen<->scene math. */
let canvasContainer: HTMLElement | null = null;
export function setCanvasContainer(el: HTMLElement | null) {
  canvasContainer = el;
}

// ---- Pointer tracking --------------------------------------------------------
// Last seen pointer position (client coords). Used to spawn new windows next to
// whatever is under the cursor instead of dropping them at random — see
// spawnRectNear() in tiling.ts.
let pointerClient: { x: number; y: number } | null = null;
export function setPointerClient(x: number, y: number) {
  pointerClient = { x, y };
}
/** Last pointer position in scene coords, or null if the pointer is unknown. */
export function getPointerScene(): { x: number; y: number } | null {
  if (!pointerClient) return null;
  const rect = canvasContainer?.getBoundingClientRect();
  return screenToScene(pointerClient.x - (rect?.left ?? 0), pointerClient.y - (rect?.top ?? 0));
}

/** Normalize a wheel delta (line mode -> approx pixels). */
export function wheelDelta(d: number, mode: number) {
  return mode === 1 ? d * 16 : d;
}

/** Zoom around a point given in canvas-local px (keeps that point fixed). */
function zoomAround(px: number, py: number, deltaY: number) {
  if (!excalidrawApi) return;
  const app = excalidrawApi.getAppState();
  const zoom: number = app.zoom?.value ?? 1;
  const scrollX: number = app.scrollX ?? 0;
  const scrollY: number = app.scrollY ?? 0;

  const sceneX = px / zoom - scrollX;
  const sceneY = py / zoom - scrollY;
  const newZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom * Math.exp(-deltaY * ZOOM_SENSITIVITY)));
  if (newZoom === zoom) return;

  excalidrawApi.updateScene({
    appState: {
      zoom: { value: newZoom },
      scrollX: px / newZoom - sceneX,
      scrollY: py / newZoom - sceneY,
    },
  });
}

/** Zoom centered on a viewport point (clientX/clientY). */
export function zoomCanvasAtClient(clientX: number, clientY: number, deltaY: number) {
  const rect = canvasContainer?.getBoundingClientRect();
  zoomAround(clientX - (rect?.left ?? 0), clientY - (rect?.top ?? 0), deltaY);
}

/** Zoom centered on a window element's center (the "focus this window" feel). */
export function zoomCanvasOnElement(el: HTMLElement, deltaY: number) {
  const r = el.getBoundingClientRect();
  zoomCanvasAtClient(r.left + r.width / 2, r.top + r.height / 2, deltaY);
}

/** One zoom notch around the viewport centre (the +/- buttons of the zoom UI). */
export function zoomCanvasStep(dir: 1 | -1) {
  // deltaY<0 zooms in, matching the wheel; ~240 ≈ a comfortable single step.
  zoomAround(window.innerWidth / 2, window.innerHeight / 2, dir * -240);
}

/** Set an absolute zoom (1 = 100%), keeping the viewport centre fixed. */
export function setCanvasZoom(value: number) {
  if (!excalidrawApi) return;
  const app = excalidrawApi.getAppState();
  const zoom: number = app.zoom?.value ?? 1;
  const scrollX: number = app.scrollX ?? 0;
  const scrollY: number = app.scrollY ?? 0;
  const px = window.innerWidth / 2;
  const py = window.innerHeight / 2;
  const sceneX = px / zoom - scrollX;
  const sceneY = py / zoom - scrollY;
  const nz = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value));
  excalidrawApi.updateScene({
    appState: { zoom: { value: nz }, scrollX: px / nz - sceneX, scrollY: py / nz - sceneY },
  });
}

interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * "Recadrer" — frame ALL content (windows + drawings) into view. Windows are now
 * scene-coordinate boxes (coupled model), so we union their rects with the
 * Excalidraw element bounds and pick the zoom/scroll that centres that box with a
 * comfortable margin (Excalidraw's own scrollToContent only sees drawings, never
 * the DOM windows — and its native button hides under the voice bar). Leaving
 * focus first, so the windows actually move to where the box says.
 */
export function fitCanvasToContent() {
  if (!excalidrawApi) return;
  setFocusMode(false);

  const boxes: Box[] = [];
  const st = useStore.getState();
  const ws = st.workspaces.find((w) => w.id === st.activeId);
  if (ws) {
    for (const w of ws.windows) {
      boxes.push({ minX: w.x, minY: w.y, maxX: w.x + w.width, maxY: w.y + w.height });
    }
  }
  const els: any[] = excalidrawApi.getSceneElements?.() ?? [];
  for (const e of els) {
    if (e?.isDeleted) continue;
    boxes.push({ minX: e.x, minY: e.y, maxX: e.x + (e.width ?? 0), maxY: e.y + (e.height ?? 0) });
  }

  // Nothing to frame → just go home (origin, 100%).
  if (!boxes.length) {
    excalidrawApi.updateScene({ appState: { zoom: { value: 1 }, scrollX: 0, scrollY: 0 } });
    return;
  }

  const minX = Math.min(...boxes.map((b) => b.minX));
  const minY = Math.min(...boxes.map((b) => b.minY));
  const maxX = Math.max(...boxes.map((b) => b.maxX));
  const maxY = Math.max(...boxes.map((b) => b.maxY));
  const bw = Math.max(1, maxX - minX);
  const bh = Math.max(1, maxY - minY);

  // Leave room for the chrome (top bar, left toolbar, voice bar) so framed
  // content doesn't tuck under them.
  const padX = 120;
  const padTop = 90;
  const padBottom = 130;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const zoom = Math.min(
    MAX_ZOOM,
    Math.max(MIN_ZOOM, Math.min((vw - padX * 2) / bw, (vh - padTop - padBottom) / bh)),
  );
  // Centre the box in the area between the top and bottom chrome.
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const scrollX = vw / 2 / zoom - cx;
  const scrollY = (padTop + (vh - padBottom)) / 2 / zoom - cy;
  excalidrawApi.updateScene({ appState: { zoom: { value: zoom }, scrollX, scrollY } });
}

/** Pan the viewport by a screen-space delta (used for shift+wheel). */
export function panCanvasBy(deltaX: number, deltaY: number) {
  if (!excalidrawApi) return;
  const app = excalidrawApi.getAppState();
  const zoom: number = app.zoom?.value ?? 1;
  const scrollX: number = app.scrollX ?? 0;
  const scrollY: number = app.scrollY ?? 0;
  excalidrawApi.updateScene({
    appState: { scrollX: scrollX - deltaX / zoom, scrollY: scrollY - deltaY / zoom },
  });
}

// This module owns the imperative Excalidraw API singleton (excalidrawApi).
// A hot-swap would re-run the module and reset it to null without remounting
// the canvas, leaving the toolbar (focus / select-tool) silently inert. Force
// a full reload on change instead so the API is always re-registered.
if (import.meta.hot) {
  import.meta.hot.accept(() => import.meta.hot!.invalidate());
}
