// Pixel position of a caret offset inside a <textarea>, via the classic
// "mirror div" technique: clone the textarea's text + styles into an off-screen
// div, drop a marker span at the offset, and read its position. Good enough to
// anchor an autocomplete popup at the word being typed.

// Style properties that affect text layout and so must be copied to the mirror.
const COPIED: (keyof CSSStyleDeclaration)[] = [
  "boxSizing", "width", "height", "overflowX", "overflowY",
  "borderTopWidth", "borderRightWidth", "borderBottomWidth", "borderLeftWidth",
  "paddingTop", "paddingRight", "paddingBottom", "paddingLeft",
  "fontStyle", "fontVariant", "fontWeight", "fontStretch", "fontSize",
  "fontSizeAdjust", "lineHeight", "fontFamily", "textAlign", "textTransform",
  "textIndent", "textDecoration", "letterSpacing", "wordSpacing", "tabSize",
  "whiteSpace", "wordWrap", "wordBreak",
];

export interface CaretCoords {
  /** Pixel offset of the caret from the textarea's content box (pre-scroll). */
  left: number;
  top: number;
  /** Line height at the caret — add to `top` to sit a popup just below it. */
  height: number;
}

export function caretCoords(el: HTMLTextAreaElement, position: number): CaretCoords {
  const div = document.createElement("div");
  const style = div.style;
  const computed = window.getComputedStyle(el);

  style.position = "absolute";
  style.visibility = "hidden";
  style.whiteSpace = "pre-wrap";
  style.wordWrap = "break-word";
  style.top = "0";
  style.left = "-9999px";
  for (const prop of COPIED) {
    // @ts-expect-error indexing CSSStyleDeclaration by a string key
    style[prop] = computed[prop];
  }
  // A textarea always shows its scrollbar gutter; force the mirror to match so
  // wrapping lines up.
  style.overflow = "hidden";

  div.textContent = el.value.slice(0, position);
  const span = document.createElement("span");
  // The marker must have content or it collapses; use the next char (or a dot).
  span.textContent = el.value.slice(position) || ".";
  div.appendChild(span);
  document.body.appendChild(div);

  const coords: CaretCoords = {
    left: span.offsetLeft + parseInt(computed.borderLeftWidth || "0", 10),
    top: span.offsetTop + parseInt(computed.borderTopWidth || "0", 10),
    height: parseInt(computed.lineHeight || computed.fontSize || "16", 10) || 16,
  };
  document.body.removeChild(div);
  return coords;
}
