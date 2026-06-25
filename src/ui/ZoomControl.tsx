import { fitCanvasToContent, setCanvasZoom, useCanvasState, zoomCanvasStep } from "../canvas/canvasState";
import { useT } from "../i18n";
import { CrosshairIcon, MinusIcon, PlusIcon } from "./icons";

/**
 * Canvas zoom control: Recadrer (fit all content) | − / % / + . Drives the
 * coupled viewport (windows + drawings zoom together). Clicking the % resets to
 * 100%. Sits bottom-right, clear of the centred voice bar (which hides
 * Excalidraw's native "scroll back to content" button).
 */
export function ZoomControl() {
  const t = useT();
  const zoom = useCanvasState((s) => s.zoom);
  const pct = Math.round(zoom * 100);

  return (
    <div className="vato-zoom" role="group" aria-label={t("zoom.aria")}>
      <button
        className="vato-zoom-btn"
        title={t("zoom.fit")}
        onClick={() => fitCanvasToContent()}
      >
        <CrosshairIcon size={16} />
      </button>
      <span className="vato-zoom-sep" />
      <button className="vato-zoom-btn" title={t("zoom.out")} onClick={() => zoomCanvasStep(-1)}>
        <MinusIcon size={16} />
      </button>
      <button className="vato-zoom-val" title={t("zoom.reset")} onClick={() => setCanvasZoom(1)}>
        {pct} %
      </button>
      <button className="vato-zoom-btn" title={t("zoom.in")} onClick={() => zoomCanvasStep(1)}>
        <PlusIcon size={16} />
      </button>
    </div>
  );
}
