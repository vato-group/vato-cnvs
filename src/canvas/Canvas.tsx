import { useEffect, useReducer } from "react";
import { useActiveWorkspace, useStore } from "../store";
import { panCanvasBy, setFocusMode, useCanvasState, wheelDelta, zoomCanvasAtClient } from "./canvasState";
import { useDrag } from "./dragState";
import { computeTiles } from "./tiling";
import { ExcalidrawCanvas } from "./ExcalidrawCanvas";
import { WindowFrame, type Rect } from "../windows/WindowFrame";
import { BackgroundLayer } from "../ui/BackgroundLayer";

export function Canvas() {
  const ws = useActiveWorkspace();
  const fullscreenId = useStore((s) => s.fullscreenId);
  const focusMode = useStore((s) => s.focusMode);
  // Windows are COUPLED to the whiteboard viewport: they pan AND zoom with the
  // drawings (overlay = translate(scroll*zoom) scale(zoom)), so a 16% canvas
  // shows 16% terminals — "le zoom comme avec les dessins".
  const scrollX = useCanvasState((s) => s.scrollX);
  const scrollY = useCanvasState((s) => s.scrollY);
  const zoom = useCanvasState((s) => s.zoom);

  const draggingId = useDrag((s) => s.draggingId);
  const previewIds = useDrag((s) => s.previewIds);
  const previewIndex = useDrag((s) => s.previewIndex);

  // The focus grid is computed live from window.innerWidth/Height, so force a
  // re-render when the OS window resizes (scroll/zoom changes already re-render
  // via the canvasState subscription above).
  const [, rerender] = useReducer((x) => x + 1, 0);
  useEffect(() => {
    let t: number | undefined;
    const onResize = () => {
      window.clearTimeout(t);
      t = window.setTimeout(rerender, 120);
    };
    window.addEventListener("resize", onResize);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener("resize", onResize);
    };
  }, []);

  // Single wheel gesture for the whole canvas viewport. Capture phase so it wins
  // over xterm scrollback and Excalidraw's own wheel handler. Routing by target:
  //   • over a terminal body (.xterm)         → left alone = scrollback
  //   • over Excalidraw / our UI chrome        → left alone = native scroll
  //   • anywhere else (canvas, gaps, titlebars)→ plain wheel = zoom · shift = pan
  // The zoom/pan handlers live in one place (canvasState) and act through the
  // Excalidraw API, so the gesture works wherever a window doesn't own the wheel —
  // the old handler only fired over the bare <canvas>, which the tiled grid hides,
  // so the wheel felt dead. In focus mode any such gesture OUTSIDE the terminals
  // releases focus immediately ("bouger ou scroll débloque le mode focus").
  // Browser iframes swallow their own wheel (cross-origin) — expected blind spot.
  useEffect(() => {
    const onWheel = (e: WheelEvent) => {
      const t = e.target as HTMLElement | null;
      if (!t || typeof t.closest !== "function") return;
      if (t.closest(".xterm")) return; // terminal scrollback owns the wheel
      if (t.closest(".layer-ui__wrapper")) return; // Excalidraw panels/library
      // Toolbars / settings / dropdowns / voice bar sit outside the canvas layers
      // and keep native scrolling.
      if (!t.closest(".vato-excalidraw, .vato-overlay")) return;
      e.preventDefault();
      e.stopPropagation();
      setFocusMode(false); // guarded: no-op when already in free mode
      if (e.shiftKey) {
        panCanvasBy(wheelDelta(e.deltaX, e.deltaMode), wheelDelta(e.deltaY, e.deltaMode));
      } else {
        zoomCanvasAtClient(e.clientX, e.clientY, wheelDelta(e.deltaY, e.deltaMode));
      }
    };
    window.addEventListener("wheel", onWheel, { capture: true, passive: false });
    return () => window.removeEventListener("wheel", onWheel, { capture: true } as EventListenerOptions);
  }, []);

  // Free mode: couple the overlay to the viewport exactly (scene -> screen), so
  // windows pan + zoom in lock-step with the drawings.
  // Focus / fullscreen: identity, so the screen-space grid lands at fixed pixels.
  const overlayTransform = fullscreenId || focusMode
    ? "none"
    : `translate(${scrollX * zoom}px, ${scrollY * zoom}px) scale(${zoom})`;

  const n = ws.windows.length;
  const dragging = !!draggingId && !!previewIds; // grid reorder in progress (focus only)
  // Grid is active in focus mode (and is implied during a reorder drag). It is a
  // pure display transform — the windows' stored x/y (their free positions) are
  // never overwritten, so leaving focus restores them.
  const grid = focusMode || dragging;
  const tiles = grid ? computeTiles(n) : null;

  // Resolve a window's on-screen rect for the current mode:
  //  - free mode      -> its stored free position
  //  - focus (static) -> its grid slot, by array order
  //  - reorder drag   -> non-dragged windows animate to their preview slot; the
  //                      dragged one keeps its starting slot (react-rnd offsets it)
  const rectFor = (id: string, index: number, free: Rect): Rect => {
    if (!tiles) return free;
    if (!dragging) return tiles[index];
    if (id === draggingId) return tiles[index];
    const pIndex = previewIds!.indexOf(id);
    return pIndex >= 0 ? tiles[pIndex] : tiles[index];
  };

  const dropTile = dragging && tiles && previewIndex >= 0 ? tiles[previewIndex] : null;

  return (
    <div className="absolute inset-0 overflow-hidden">
      {/* 0: workspace background */}
      <BackgroundLayer bg={ws.background} />

      {/* 1: Excalidraw — the infinite whiteboard (drawings). */}
      <ExcalidrawCanvas key={ws.id} workspace={ws} />

      {/* 2: window overlay — coupled to the whiteboard viewport. */}
      <div
        className="vato-overlay"
        style={{
          position: "absolute",
          inset: 0,
          zIndex: 2,
          pointerEvents: "none",
          transform: overlayTransform,
          transformOrigin: "0 0",
        }}
      >
        {/* drop-zone frame (live preview of where the dragged window lands) */}
        {dropTile && !fullscreenId && (
          <div
            className="vato-drop-frame"
            style={{
              transform: `translate(${dropTile.x}px, ${dropTile.y}px)`,
              width: dropTile.width,
              height: dropTile.height,
            }}
          />
        )}

        {ws.windows.map((w, i) => (
          <WindowFrame
            key={w.id}
            win={w}
            rect={rectFor(w.id, i, { x: w.x, y: w.y, width: w.width, height: w.height })}
            zoom={zoom}
            focusMode={focusMode}
            fullscreen={fullscreenId === w.id}
            hidden={!!fullscreenId && fullscreenId !== w.id}
            isDragged={draggingId === w.id}
            animate={!fullscreenId}
          />
        ))}
      </div>
    </div>
  );
}
