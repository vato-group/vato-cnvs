// Attach deterministic autocomplete to any <textarea>. Pure DOM (no React) so it
// works for both our own Notes pane and Excalidraw's text-editing textarea, which
// we don't own. Renders a caret-anchored popup, accepts on Tab/Enter, navigates
// with the arrow keys, dismisses on Esc.
//
// Returns a detach function — call it on unmount / when the textarea goes away.

import { complete, currentToken, learn, type Suggestion } from "./engine";
import { caretCoords } from "./caret";

interface Opts {
  /** Optional gate — return false to suspend suggestions (e.g. feature off). */
  enabled?: () => boolean;
  /** How many suggestions to show. */
  limit?: number;
}

const escapeHtml = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

export function attachAutocomplete(el: HTMLTextAreaElement, opts: Opts = {}): () => void {
  const limit = opts.limit ?? 6;
  let suggestions: Suggestion[] = [];
  let active = 0;
  let tokenStart = 0;
  let tokenLen = 0;
  let pop: HTMLDivElement | null = null;

  const isOpen = () => suggestions.length > 0;

  function close(): void {
    suggestions = [];
    if (pop) {
      pop.remove();
      pop = null;
    }
  }

  function ensurePop(): HTMLDivElement {
    if (!pop) {
      pop = document.createElement("div");
      pop.className = "vato-ac-pop";
      document.body.appendChild(pop);
    }
    return pop;
  }

  function render(): void {
    if (!suggestions.length) return close();
    const p = ensurePop();
    p.innerHTML = "";
    suggestions.forEach((s, i) => {
      const item = document.createElement("div");
      item.className = "vato-ac-item" + (i === active ? " active" : "");
      const pre = escapeHtml(s.text.slice(0, tokenLen));
      const rest = escapeHtml(s.text.slice(tokenLen));
      item.innerHTML = `<b>${pre}</b>${rest}`;
      // mousedown (not click) so it fires before the textarea blurs.
      item.addEventListener("mousedown", (e) => {
        e.preventDefault();
        accept(i);
      });
      p.appendChild(item);
    });
    position(p);
  }

  function position(p: HTMLDivElement): void {
    const c = caretCoords(el, tokenStart);
    const r = el.getBoundingClientRect();
    let left = r.left + c.left - el.scrollLeft;
    let top = r.top + c.top - el.scrollTop + c.height + 2;
    // Clamp horizontally into the viewport.
    const pw = p.offsetWidth || 180;
    if (left + pw > window.innerWidth - 8) left = window.innerWidth - pw - 8;
    if (left < 4) left = 4;
    // Flip above the caret if it would overflow the bottom.
    const ph = p.offsetHeight || 0;
    if (top + ph > window.innerHeight - 8) top = r.top + c.top - el.scrollTop - ph - 2;
    p.style.left = Math.round(left) + "px";
    p.style.top = Math.round(top) + "px";
  }

  function update(): void {
    if (opts.enabled && !opts.enabled()) return close();
    const caret = el.selectionStart ?? el.value.length;
    // Only when there's a plain caret (no range selection).
    if (el.selectionEnd !== caret) return close();
    const before = el.value.slice(0, caret);
    const { token, start } = currentToken(before);
    const list = complete(token, limit);
    if (!list.length) return close();
    suggestions = list;
    active = 0;
    tokenStart = start;
    tokenLen = token.length;
    render();
  }

  function setValue(value: string, caret: number): void {
    // Use the native setter so frameworks watching the textarea (React/Excalidraw)
    // notice the change when we dispatch `input`.
    const desc = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value");
    desc?.set?.call(el, value);
    el.selectionStart = el.selectionEnd = caret;
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }

  function accept(i: number): void {
    const s = suggestions[i];
    if (!s) return;
    const caret = el.selectionStart ?? el.value.length;
    const before = el.value.slice(0, tokenStart);
    const after = el.value.slice(caret);
    const newCaret = (before + s.text).length;
    setValue(before + s.text + after, newCaret);
    learn(s.text);
    close();
    el.focus();
  }

  function onKeyDown(e: KeyboardEvent): void {
    if (!isOpen()) return;
    switch (e.key) {
      case "ArrowDown":
        active = (active + 1) % suggestions.length;
        e.preventDefault();
        e.stopImmediatePropagation();
        render();
        break;
      case "ArrowUp":
        active = (active - 1 + suggestions.length) % suggestions.length;
        e.preventDefault();
        e.stopImmediatePropagation();
        render();
        break;
      case "Tab":
      case "Enter":
        e.preventDefault();
        e.stopImmediatePropagation();
        accept(active);
        break;
      case "Escape":
        // Dismiss our popup but let the host (e.g. Excalidraw "commit text") also
        // see Escape — don't stop propagation.
        e.preventDefault();
        close();
        break;
      default:
        break;
    }
  }

  // Recompute after the value/caret settles (input covers typing + our own edits;
  // keyup covers caret moves via arrows/click without changing text).
  const onInput = () => update();
  const onKeyUp = (e: KeyboardEvent) => {
    if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) update();
  };
  const onBlur = () => window.setTimeout(close, 120);
  const onScroll = () => isOpen() && pop && position(pop);

  // keydown in capture phase so we intercept Tab/Enter/arrows BEFORE the host's
  // own handlers (critical for Excalidraw's textarea).
  el.addEventListener("keydown", onKeyDown, true);
  el.addEventListener("input", onInput);
  el.addEventListener("keyup", onKeyUp);
  el.addEventListener("blur", onBlur);
  window.addEventListener("scroll", onScroll, true);
  window.addEventListener("resize", onScroll);

  return () => {
    el.removeEventListener("keydown", onKeyDown, true);
    el.removeEventListener("input", onInput);
    el.removeEventListener("keyup", onKeyUp);
    el.removeEventListener("blur", onBlur);
    window.removeEventListener("scroll", onScroll, true);
    window.removeEventListener("resize", onScroll);
    close();
  };
}
