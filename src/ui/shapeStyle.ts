import { newElementWith, CaptureUpdateAction, ROUNDNESS } from "@excalidraw/excalidraw";
import { getExcalidrawApi } from "../canvas/canvasState";
import type { ToolType } from "../canvas/canvasState";

/**
 * Logic layer for the custom shape-style panel (see ShapeStylePanel.tsx).
 *
 * Excalidraw's element model only renders a fixed set of style properties, so
 * this panel drives exactly those — and nothing it can't actually paint:
 *   strokeColor · backgroundColor · fillStyle · strokeWidth · strokeStyle ·
 *   roughness · roundness (sharp/round) · opacity · angle, plus the
 *   text (font) and arrow (arrowhead) specifics.
 * Drop-shadow / blur / arbitrary corner-radius are NOT part of the renderer,
 * so they're intentionally absent rather than faked.
 */

// ---- which property applies to which element type ---------------------------
export const STYLABLE = new Set(["rectangle", "diamond", "ellipse", "arrow", "line", "freedraw", "text", "image"]);
/** Closed shapes that actually paint a fill. */
export const FILLABLE = new Set(["rectangle", "diamond", "ellipse"]);
/** Shapes whose corners can be sharp/round. */
export const CORNERED = new Set(["rectangle", "diamond", "arrow", "line"]);
/** Shapes drawn with a rough stroke (width / dash / sloppiness apply). */
export const STROKED = new Set(["rectangle", "diamond", "ellipse", "arrow", "line", "freedraw"]);
/** Tools that, with nothing selected, still show the panel (edit next-shape defaults). */
export const SHAPE_TOOLS = new Set<ToolType>([
  "rectangle",
  "diamond",
  "ellipse",
  "arrow",
  "line",
  "freedraw",
  "text",
]);

// ---- palettes ---------------------------------------------------------------
export const STROKE_SWATCHES = [
  "#e9ecf1", // blanc cassé
  "#6ca0ff", // bleu accent
  "#e2814b", // orange accent
  "#54d98c", // vert
  "#f5c451", // jaune
  "#ff6b6b", // rouge
  "#c792ea", // violet
  "#1e1e1e", // noir
];
export const FILL_SWATCHES = [
  "transparent",
  "#6ca0ff",
  "#54d98c",
  "#f5c451",
  "#ff6b6b",
  "#c792ea",
  "#e9ecf1",
];

export type StyleType = string;

export interface SelInfo {
  /** Selected, stylable, non-deleted elements (empty in "defaults" / "none" mode). */
  elements: readonly any[];
  /** Effective element types the panel should show controls for. */
  types: Set<StyleType>;
  /** Number of selected stylable elements. */
  count: number;
  mode: "selection" | "defaults" | "none";
  /** Live Excalidraw appState (for reading currentItem* defaults). */
  app: any;
}

/** Read the current selection (or the active-tool defaults) from Excalidraw. */
export function readSelection(activeTool: ToolType): SelInfo {
  const api = getExcalidrawApi();
  if (!api) return { elements: [], types: new Set(), count: 0, mode: "none", app: {} };
  const app = api.getAppState();
  const ids: Record<string, boolean> = app.selectedElementIds || {};
  const sel = api.getSceneElements().filter((e: any) => ids[e.id] && !e.isDeleted && STYLABLE.has(e.type));
  if (sel.length) {
    return { elements: sel, types: new Set(sel.map((e: any) => e.type)), count: sel.length, mode: "selection", app };
  }
  if (SHAPE_TOOLS.has(activeTool)) {
    return { elements: [], types: new Set([activeTool]), count: 0, mode: "defaults", app };
  }
  return { elements: [], types: new Set(), count: 0, mode: "none", app };
}

/** Shared value across the selection, or `undefined` when mixed / empty. */
export function commonVal<T>(elements: readonly any[], get: (e: any) => T): T | undefined {
  if (!elements.length) return undefined;
  const first = get(elements[0]);
  for (let i = 1; i < elements.length; i++) {
    if (get(elements[i]) !== first) return undefined;
  }
  return first;
}

// ---- high-level patch -------------------------------------------------------
/** Normalized, type-agnostic patch the panel emits; translated per element below. */
export interface StylePatch {
  strokeColor?: string;
  backgroundColor?: string;
  fillStyle?: string;
  strokeWidth?: number;
  strokeStyle?: string;
  roughness?: number;
  opacity?: number;
  round?: boolean;
  angleDeg?: number;
  fontFamily?: number;
  fontSize?: number;
  textAlign?: string;
  startArrowhead?: string | null;
  endArrowhead?: string | null;
}

const RAD_PER_DEG = Math.PI / 180;

/** Translate a high-level patch into the concrete props for ONE element type. */
function elementUpdates(el: any, p: StylePatch): Record<string, any> {
  const u: Record<string, any> = {};
  if (p.strokeColor !== undefined) u.strokeColor = p.strokeColor;
  if (p.opacity !== undefined) u.opacity = p.opacity;
  if (p.angleDeg !== undefined) u.angle = p.angleDeg * RAD_PER_DEG;

  if (STROKED.has(el.type)) {
    if (p.strokeWidth !== undefined) u.strokeWidth = p.strokeWidth;
    if (p.strokeStyle !== undefined) u.strokeStyle = p.strokeStyle;
    if (p.roughness !== undefined) u.roughness = p.roughness;
  }
  if (FILLABLE.has(el.type)) {
    if (p.backgroundColor !== undefined) u.backgroundColor = p.backgroundColor;
    if (p.fillStyle !== undefined) u.fillStyle = p.fillStyle;
  }
  if (CORNERED.has(el.type) && p.round !== undefined) {
    u.roundness = p.round ? { type: ROUNDNESS.ADAPTIVE_RADIUS } : null;
  }
  if (el.type === "text") {
    if (p.fontFamily !== undefined) u.fontFamily = p.fontFamily;
    if (p.textAlign !== undefined) u.textAlign = p.textAlign;
    if (p.fontSize !== undefined && el.fontSize) {
      // Excalidraw recomputes the text bbox internally on its own font edits; we
      // can't call that helper (not exported), so scale the box by the size ratio
      // to keep the glyphs from clipping until the next real edit re-measures.
      const r = p.fontSize / el.fontSize;
      u.fontSize = p.fontSize;
      u.width = el.width * r;
      u.height = el.height * r;
    }
  }
  if (el.type === "arrow" || el.type === "line") {
    if (p.startArrowhead !== undefined) u.startArrowhead = p.startArrowhead;
    if (p.endArrowhead !== undefined) u.endArrowhead = p.endArrowhead;
  }
  return u;
}

/** The matching appState "next shape" defaults so new shapes inherit the change. */
function appStateUpdates(p: StylePatch): Record<string, any> {
  const a: Record<string, any> = {};
  if (p.strokeColor !== undefined) a.currentItemStrokeColor = p.strokeColor;
  if (p.backgroundColor !== undefined) a.currentItemBackgroundColor = p.backgroundColor;
  if (p.fillStyle !== undefined) a.currentItemFillStyle = p.fillStyle;
  if (p.strokeWidth !== undefined) a.currentItemStrokeWidth = p.strokeWidth;
  if (p.strokeStyle !== undefined) a.currentItemStrokeStyle = p.strokeStyle;
  if (p.roughness !== undefined) a.currentItemRoughness = p.roughness;
  if (p.opacity !== undefined) a.currentItemOpacity = p.opacity;
  if (p.round !== undefined) a.currentItemRoundness = p.round ? "round" : "sharp";
  if (p.fontFamily !== undefined) a.currentItemFontFamily = p.fontFamily;
  if (p.fontSize !== undefined) a.currentItemFontSize = p.fontSize;
  if (p.textAlign !== undefined) a.currentItemTextAlign = p.textAlign;
  if (p.startArrowhead !== undefined) a.currentItemStartArrowhead = p.startArrowhead;
  if (p.endArrowhead !== undefined) a.currentItemEndArrowhead = p.endArrowhead;
  return a;
}

/**
 * Apply a style patch: mutate every selected stylable element (immutably, via
 * newElementWith so versions bump and the canvas repaints) AND set the matching
 * next-shape defaults. With nothing selected, only the defaults change.
 */
export function applyStyle(p: StylePatch) {
  const api = getExcalidrawApi();
  if (!api) return;
  const app = api.getAppState();
  const ids: Record<string, boolean> = app.selectedElementIds || {};
  const all = api.getSceneElements();
  const hasSel = all.some((e: any) => ids[e.id] && !e.isDeleted && STYLABLE.has(e.type));
  const appState = appStateUpdates(p);

  if (hasSel) {
    const next = all.map((e: any) =>
      ids[e.id] && !e.isDeleted && STYLABLE.has(e.type) ? newElementWith(e, elementUpdates(e, p)) : e,
    );
    api.updateScene({ elements: next, appState, captureUpdate: CaptureUpdateAction.IMMEDIATELY });
  } else {
    api.updateScene({ appState, captureUpdate: CaptureUpdateAction.EVENTUALLY });
  }
}
