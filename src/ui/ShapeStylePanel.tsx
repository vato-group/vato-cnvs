import { useMemo, type ReactNode } from "react";
import { FONT_FAMILY } from "@excalidraw/excalidraw";
import { useCanvasState } from "../canvas/canvasState";
import { useT, type TFn } from "../i18n";
import {
  applyStyle,
  commonVal,
  readSelection,
  CORNERED,
  FILLABLE,
  FILL_SWATCHES,
  STROKE_SWATCHES,
  STROKED,
  type StylePatch,
} from "./shapeStyle";

/* ------------------------------------------------------------------ icons -- */
const svg = (children: ReactNode) => (
  <svg viewBox="0 0 22 22" width={18} height={18} fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
    {children}
  </svg>
);
const Ico = {
  hachure: svg(<><path d="M4 14L10 5" /><path d="M9 17L16 7" /><path d="M14 18L19 11" /></>),
  cross: svg(<><path d="M4 13L11 4" /><path d="M11 18L18 9" /><path d="M4 9L13 18" /><path d="M9 4L18 13" /></>),
  solidFill: svg(<rect x="4" y="4" width="14" height="14" rx="1.5" fill="currentColor" stroke="none" />),
  zigzag: svg(<path d="M4 16L8 8L12 16L16 8L19 14" />),
  lineSolid: svg(<path d="M3 11h16" />),
  lineDashed: svg(<path d="M3 11h4M10 11h4M17 11h2" />),
  lineDotted: svg(<path strokeWidth={2.2} d="M4 11h.1M9 11h.1M14 11h.1M19 11h.1" />),
  wThin: svg(<path strokeWidth={1.3} d="M3 11h16" />),
  wMed: svg(<path strokeWidth={2.6} d="M3 11h16" />),
  wThick: svg(<path strokeWidth={4.2} d="M3 11h16" />),
  rough0: svg(<path d="M3 11h16" />),
  rough1: svg(<path d="M3 11q4-3 8 0t8 0" />),
  rough2: svg(<path d="M3 11q2-4 4 0t4 0 4 0 4 0" />),
  sharp: svg(<path d="M5 17V8a3 3 0 013-3h9" />),
  round: svg(<path d="M5 17V12a7 7 0 017-7h5" />),
  alignL: svg(<><path d="M4 6h14" /><path d="M4 11h9" /><path d="M4 16h12" /></>),
  alignC: svg(<><path d="M4 6h14" /><path d="M6 11h10" /><path d="M5 16h12" /></>),
  alignR: svg(<><path d="M4 6h14" /><path d="M9 11h9" /><path d="M6 16h12" /></>),
};

/** Tiny line-end glyphs for the arrowhead pickers. `flip` mirrors for "start". */
function Head({ kind, flip }: { kind: string | null; flip?: boolean }) {
  return (
    <svg viewBox="0 0 22 22" width={18} height={18} fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" style={flip ? { transform: "scaleX(-1)" } : undefined}>
      <path d="M3 11h13" />
      {kind === "arrow" && <path d="M12 6l5 5-5 5" />}
      {kind === "triangle" && <path d="M11 6l6 5-6 5z" fill="currentColor" />}
      {kind === "dot" && <circle cx="16" cy="11" r="3" fill="currentColor" stroke="none" />}
      {kind === "bar" && <path d="M16 5v12" />}
    </svg>
  );
}

/* -------------------------------------------------------------- option sets -- */
// `t` holds an i18n key resolved (as the button tooltip) at render time.
const FILL_STYLES = [
  { v: "hachure", t: "style.fillStyle.hachure", i: Ico.hachure },
  { v: "cross-hatch", t: "style.fillStyle.cross", i: Ico.cross },
  { v: "solid", t: "style.fillStyle.solid", i: Ico.solidFill },
  { v: "zigzag", t: "style.fillStyle.zigzag", i: Ico.zigzag },
];
const STROKE_STYLES = [
  { v: "solid", t: "style.line.solid", i: Ico.lineSolid },
  { v: "dashed", t: "style.line.dashed", i: Ico.lineDashed },
  { v: "dotted", t: "style.line.dotted", i: Ico.lineDotted },
];
const WIDTHS = [
  { v: 1, t: "style.w.thin", i: Ico.wThin },
  { v: 2, t: "style.w.med", i: Ico.wMed },
  { v: 4, t: "style.w.thick", i: Ico.wThick },
];
const ROUGHS = [
  { v: 0, t: "style.rough.net", i: Ico.rough0 },
  { v: 1, t: "style.rough.pencil", i: Ico.rough1 },
  { v: 2, t: "style.rough.sketch", i: Ico.rough2 },
];
const CORNER_OPTS = [
  { v: false, t: "style.corner.sharp", i: Ico.sharp },
  { v: true, t: "style.corner.round", i: Ico.round },
];
const ALIGNS = [
  { v: "left", t: "style.align.left", i: Ico.alignL },
  { v: "center", t: "style.align.center", i: Ico.alignC },
  { v: "right", t: "style.align.right", i: Ico.alignR },
];
const FONTS = [
  { v: FONT_FAMILY.Excalifont, t: "style.font.hand", l: "Main" },
  { v: FONT_FAMILY.Nunito, t: "style.font.normal", l: "Aa" },
  { v: FONT_FAMILY.Cascadia, t: "style.font.code", l: "</>" },
];
const SIZES = [
  { v: 16, l: "S" },
  { v: 20, l: "M" },
  { v: 28, l: "L" },
  { v: 36, l: "XL" },
];
const HEADS = [
  { v: null, t: "style.head.none" },
  { v: "arrow", t: "style.head.arrow" },
  { v: "triangle", t: "style.head.triangle" },
  { v: "dot", t: "style.head.dot" },
  { v: "bar", t: "style.head.bar" },
];

/* ----------------------------------------------------------- sub-components -- */
function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="vato-style-section">
      <div className="vato-style-label">{label}</div>
      {children}
    </div>
  );
}

interface SegOpt {
  v: any;
  /** i18n key for the tooltip. */
  t?: string;
  i?: ReactNode;
  l?: string;
}
function Segmented({ opts, value, onPick }: { opts: SegOpt[]; value: any; onPick: (v: any) => void }) {
  const t = useT();
  return (
    <div className="vato-style-seg">
      {opts.map((o, k) => (
        <button
          key={k}
          className={`vato-style-segbtn ${o.v === value ? "on" : ""}`}
          title={o.t ? t(o.t) : undefined}
          onClick={() => onPick(o.v)}
        >
          {o.i ?? <span className="txt">{o.l ?? String(o.v)}</span>}
        </button>
      ))}
    </div>
  );
}

function Swatches({
  colors,
  value,
  onPick,
  t,
}: {
  colors: string[];
  value: string | undefined;
  onPick: (c: string) => void;
  t: TFn;
}) {
  const custom = value && value !== "transparent" && !colors.includes(value);
  return (
    <div className="vato-style-swatches">
      {colors.map((c) => (
        <button
          key={c}
          className={`vato-sw ${c === "transparent" ? "transp" : ""} ${c === value ? "on" : ""}`}
          style={c === "transparent" ? undefined : { background: c }}
          title={c === "transparent" ? t("style.none") : c}
          onClick={() => onPick(c)}
        />
      ))}
      <label className={`vato-sw custom ${custom ? "on" : ""}`} title={t("style.customColor")} style={custom ? { background: value } : undefined}>
        {!custom && <span>+</span>}
        <input
          type="color"
          value={value && value.startsWith("#") ? value : "#6ca0ff"}
          onChange={(e) => onPick(e.target.value)}
        />
      </label>
    </div>
  );
}

/* ----------------------------------------------------------------- panel ----- */
export function ShapeStylePanel() {
  const t = useT();
  const styleRev = useCanvasState((s) => s.styleRev);
  const activeTool = useCanvasState((s) => s.activeTool);
  const ready = useCanvasState((s) => s.ready);

  // styleRev/activeTool/ready are the only re-render triggers; everything else is
  // read straight from the live Excalidraw scene.
  const info = useMemo(() => readSelection(activeTool), [styleRev, activeTool, ready]);

  if (info.mode === "none") return null;

  const { types, elements, app, mode, count } = info;
  const has = (set: Set<string>) => [...types].some((t) => set.has(t));

  // Current value of a property: the shared value across the selection, or — when
  // nothing is selected — the matching "next shape" default from appState.
  const pick = <T,>(get: (e: any) => T, appKey: string): T | undefined =>
    mode === "selection" ? commonVal(elements, get) : app[appKey];

  const apply = (p: StylePatch) => applyStyle(p);

  // ---- visibility ----
  const onlyText = types.size === 1 && types.has("text");
  const showColor = has(STROKED) || types.has("text");
  const showFill = has(FILLABLE);
  const showStroke = has(STROKED);
  const showCorners = has(CORNERED);
  const showText = types.has("text");
  const showArrow = types.has("arrow") || types.has("line");
  const showAngle = mode === "selection" && count === 1;

  const fillableEls = elements.filter((e: any) => FILLABLE.has(e.type));
  const hasFillColor =
    mode === "selection"
      ? fillableEls.some((e: any) => e.backgroundColor && e.backgroundColor !== "transparent")
      : app.currentItemBackgroundColor && app.currentItemBackgroundColor !== "transparent";

  // ---- current values ----
  const strokeColor = pick((e) => e.strokeColor, "currentItemStrokeColor");
  const bgColor = pick((e) => e.backgroundColor, "currentItemBackgroundColor");
  const fillStyle = pick((e) => e.fillStyle, "currentItemFillStyle");
  const strokeWidth = pick((e) => e.strokeWidth, "currentItemStrokeWidth");
  const strokeStyle = pick((e) => e.strokeStyle, "currentItemStrokeStyle");
  const roughness = pick((e) => e.roughness, "currentItemRoughness");
  const opacity = pick((e) => e.opacity, "currentItemOpacity") ?? 100;
  const round =
    mode === "selection"
      ? commonVal(elements.filter((e: any) => CORNERED.has(e.type)), (e: any) => !!e.roundness)
      : app.currentItemRoundness === "round";
  const fontFamily = pick((e) => e.fontFamily, "currentItemFontFamily");
  const fontSize = pick((e) => e.fontSize, "currentItemFontSize");
  const textAlign = pick((e) => e.textAlign, "currentItemTextAlign");
  const startHead = pick((e) => e.startArrowhead ?? null, "currentItemStartArrowhead");
  const endHead = pick((e) => e.endArrowhead ?? null, "currentItemEndArrowhead");
  const angle =
    showAngle && elements[0] ? Math.round(((elements[0].angle * 180) / Math.PI + 360) % 360) : 0;

  // A single known type shows its tool name; otherwise a generic count/label.
  const typeName = (ty: string) => (ty ? t(`tool.${ty}`) : t("style.element"));
  const headerName =
    mode === "defaults"
      ? t("style.defaults")
      : count === 1
        ? typeName([...types][0])
        : t("style.elements", { n: count });
  const headerSub = mode === "defaults" ? typeName(activeTool) : count > 1 ? t("style.selection") : "";

  return (
    <div className="vato-style-panel" onPointerDown={(e) => e.stopPropagation()}>
      <div className="vato-style-head">
        <span className="name">{headerName}</span>
        {headerSub && <span className="sub">{headerSub}</span>}
      </div>

      {showColor && (
        <Section label={onlyText ? t("style.textColor") : t("style.strokeColor")}>
          <Swatches colors={STROKE_SWATCHES} value={strokeColor} onPick={(c) => apply({ strokeColor: c })} t={t} />
        </Section>
      )}

      {showFill && (
        <Section label={t("style.fill")}>
          <Swatches colors={FILL_SWATCHES} value={bgColor} onPick={(c) => apply({ backgroundColor: c })} t={t} />
        </Section>
      )}

      {showFill && hasFillColor && (
        <Section label={t("style.fillStyle")}>
          <Segmented opts={FILL_STYLES} value={fillStyle} onPick={(v) => apply({ fillStyle: v })} />
        </Section>
      )}

      {showStroke && (
        <Section label={t("style.width")}>
          <Segmented opts={WIDTHS} value={strokeWidth} onPick={(v) => apply({ strokeWidth: v })} />
        </Section>
      )}

      {showStroke && (
        <Section label={t("style.strokeStyle")}>
          <Segmented opts={STROKE_STYLES} value={strokeStyle} onPick={(v) => apply({ strokeStyle: v })} />
        </Section>
      )}

      {showStroke && (
        <Section label={t("style.sloppiness")}>
          <Segmented opts={ROUGHS} value={roughness} onPick={(v) => apply({ roughness: v })} />
        </Section>
      )}

      {showCorners && (
        <Section label={t("style.corners")}>
          <Segmented opts={CORNER_OPTS} value={round} onPick={(v) => apply({ round: v })} />
        </Section>
      )}

      {showText && (
        <>
          <Section label={t("style.font")}>
            <Segmented opts={FONTS} value={fontFamily} onPick={(v) => apply({ fontFamily: v })} />
          </Section>
          <Section label={t("style.size")}>
            <Segmented opts={SIZES} value={fontSize} onPick={(v) => apply({ fontSize: v })} />
          </Section>
          <Section label={t("style.align")}>
            <Segmented opts={ALIGNS} value={textAlign} onPick={(v) => apply({ textAlign: v })} />
          </Section>
        </>
      )}

      {showArrow && (
        <Section label={t("style.arrowheads")}>
          <div className="vato-style-heads">
            <Segmented opts={HEADS.map((h) => ({ v: h.v, t: h.t, i: <Head kind={h.v} flip /> }))} value={startHead} onPick={(v) => apply({ startArrowhead: v })} />
            <Segmented opts={HEADS.map((h) => ({ v: h.v, t: h.t, i: <Head kind={h.v} /> }))} value={endHead} onPick={(v) => apply({ endArrowhead: v })} />
          </div>
        </Section>
      )}

      <Section label={t("style.opacity", { pct: Math.round(opacity) })}>
        <input
          className="vato-style-range"
          type="range"
          min={0}
          max={100}
          step={10}
          value={opacity}
          onChange={(e) => apply({ opacity: Number(e.target.value) })}
        />
      </Section>

      {showAngle && (
        <Section label={t("style.rotation", { deg: angle })}>
          <input
            className="vato-style-range"
            type="range"
            min={0}
            max={359}
            step={1}
            value={angle}
            onChange={(e) => apply({ angleDeg: Number(e.target.value) })}
          />
        </Section>
      )}
    </div>
  );
}
