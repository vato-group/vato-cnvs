import { fitCanvasToContent, setCanvasZoom, useCanvasState, zoomCanvasStep } from "../canvas/canvasState";
import { CrosshairIcon, MinusIcon, PlusIcon } from "./icons";

/**
 * Canvas zoom control: Recadrer (fit all content) | − / % / + . Drives the
 * coupled viewport (windows + drawings zoom together). Clicking the % resets to
 * 100%. Sits bottom-right, clear of the centred voice bar (which hides
 * Excalidraw's native "scroll back to content" button).
 */
export function ZoomControl() {
  const zoom = useCanvasState((s) => s.zoom);
  const pct = Math.round(zoom * 100);

  return (
    <div className="vato-zoom" role="group" aria-label="Zoom du canvas">
      <button
        className="vato-zoom-btn"
        title="Recadrer — tout ramener à l'écran"
        onClick={() => fitCanvasToContent()}
      >
        <CrosshairIcon size={16} />
      </button>
      <span className="vato-zoom-sep" />
      <button className="vato-zoom-btn" title="Dézoomer le canvas" onClick={() => zoomCanvasStep(-1)}>
        <MinusIcon size={16} />
      </button>
      <button className="vato-zoom-val" title="Réinitialiser le zoom à 100 %" onClick={() => setCanvasZoom(1)}>
        {pct} %
      </button>
      <button className="vato-zoom-btn" title="Zoomer le canvas" onClick={() => zoomCanvasStep(1)}>
        <PlusIcon size={16} />
      </button>
    </div>
  );
}
