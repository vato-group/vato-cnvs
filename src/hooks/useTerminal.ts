import { useEffect, useRef } from "react";
import { Terminal, type ITheme } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import { CanvasAddon } from "@xterm/addon-canvas";
import "@xterm/xterm/css/xterm.css";
import { copyText } from "../lib/clipboard";

let activeSelectionOwner: HTMLElement | null = null;

const THEME: ITheme = {
  background: "#0d1016",
  foreground: "#d7dbe4",
  cursor: "#e7e9ee",
  cursorAccent: "#0d1016",
  selectionBackground: "rgba(120,150,255,0.30)",
  black: "#0d1016",
  red: "#ff6b6b",
  green: "#5ef0a0",
  yellow: "#ffd166",
  blue: "#6ca0ff",
  magenta: "#c792ea",
  cyan: "#5ed4f0",
  white: "#d7dbe4",
  brightBlack: "#5a6273",
  brightRed: "#ff8787",
  brightGreen: "#8affc1",
  brightYellow: "#ffe29a",
  brightBlue: "#9cc0ff",
  brightMagenta: "#ddb6ff",
  brightCyan: "#9aecff",
  brightWhite: "#ffffff",
};

export interface UseTerminalOpts {
  onData?: (data: string) => void;
  onResize?: (size: { cols: number; rows: number }) => void;
  onReady?: (term: Terminal) => void;
  /**
   * Fired when the viewport scrolls. `atBottom` is false once the user has
   * scrolled up (there's content below the fold), true again when pinned to the
   * latest line. Drives the "scroll to bottom" arrow.
   */
  onScrollChange?: (atBottom: boolean) => void;
  /**
   * A link in the terminal was activated. `mode` is resolved from the click:
   *   • "inApp"    → plain single click or Ctrl/Cmd+click → open in our browser pane
   *   • "external" → double click → open in the real system browser
   */
  onOpenLink?: (uri: string, mode: "inApp" | "external") => void;
}

function isCopyShortcut(e: KeyboardEvent): boolean {
  return e.type === "keydown" && (e.ctrlKey || e.metaKey) && (e.key === "c" || e.key === "C");
}

function rootContainsNode(root: HTMLElement, node: Node | null): boolean {
  if (!node) return false;
  return root === node || root.contains(node);
}

function elementFromNode(node: Node | null): Element | null {
  if (!node) return null;
  return node instanceof Element ? node : node.parentElement;
}

function domSelectionText(root: HTMLElement): string {
  const sel = root.ownerDocument.getSelection();
  if (!sel || sel.isCollapsed) return "";
  if (!rootContainsNode(root, sel.anchorNode) && !rootContainsNode(root, sel.focusNode)) return "";
  return sel.toString();
}

function terminalSelectionText(term: Terminal, root: HTMLElement): string {
  return term.getSelection() || domSelectionText(root);
}

function eventTargetsRoot(root: HTMLElement, event: Event): boolean {
  return rootContainsNode(root, event.target instanceof Node ? event.target : null);
}

function canOwnCopyEvent(term: Terminal, root: HTMLElement, event: Event): boolean {
  const targetTerminal = elementFromNode(event.target instanceof Node ? event.target : null)?.closest(".xterm");
  if (targetTerminal && !rootContainsNode(root, targetTerminal)) return false;
  const activeTerminal = elementFromNode(root.ownerDocument.activeElement)?.closest(".xterm");
  if (activeTerminal && !rootContainsNode(root, activeTerminal)) return false;
  if (eventTargetsRoot(root, event)) return true;
  if (domSelectionText(root)) return true;
  return activeSelectionOwner === root && term.hasSelection();
}

function writeCopyEvent(e: ClipboardEvent, text: string): boolean {
  if (!e.clipboardData) return false;
  e.clipboardData.setData("text/plain", text);
  e.preventDefault();
  e.stopPropagation();
  return true;
}

function copyTerminalSelection(term: Terminal, root: HTMLElement): boolean {
  const text = terminalSelectionText(term, root);
  if (!text) return false;
  activeSelectionOwner = root;
  void copyText(text);
  return true;
}

export function useTerminal(opts: UseTerminalOpts) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const cb = useRef(opts);
  cb.current = opts;

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const term = new Terminal({
      allowProposedApi: true,
      cursorBlink: true,
      fontFamily: '"Cascadia Code", "Cascadia Mono", Consolas, ui-monospace, monospace',
      fontSize: 11,
      lineHeight: 1.05,
      scrollback: 8000,
      theme: THEME,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);

    // Link clicks: route through onOpenLink instead of the addon's default
    // window.open (which Tauri blocks).
    //   single click / Ctrl+click → in-app browser pane
    //   double click              → real system browser
    // xterm doesn't reliably set MouseEvent.detail to 2 on the 2nd click, so we
    // detect the double-click ourselves by timing: the 1st click schedules an
    // in-app open after DBL_MS; a 2nd click on the same URL within that window
    // cancels it and opens the real browser instead. Hence a single click waits
    // ~DBL_MS before opening (the price of distinguishing it from a double).
    const DBL_MS = 400;
    let linkTimer: number | undefined;
    let lastClickAt = 0;
    let lastUri = "";
    const onLink = (event: MouseEvent, uri: string) => {
      if (event.ctrlKey || event.metaKey) {
        window.clearTimeout(linkTimer);
        lastClickAt = 0;
        cb.current.onOpenLink?.(uri, "inApp");
        return;
      }
      const now = Date.now();
      if (event.detail >= 2 || (uri === lastUri && now - lastClickAt < DBL_MS)) {
        // Second click of a double → cancel the pending in-app open, go external.
        window.clearTimeout(linkTimer);
        lastClickAt = 0;
        cb.current.onOpenLink?.(uri, "external");
        return;
      }
      // First click: wait to see whether a second one lands before opening in-app.
      lastClickAt = now;
      lastUri = uri;
      window.clearTimeout(linkTimer);
      linkTimer = window.setTimeout(() => {
        lastClickAt = 0;
        cb.current.onOpenLink?.(uri, "inApp");
      }, DBL_MS);
    };
    term.loadAddon(new WebLinksAddon(onLink));
    term.open(el);

    const updateSelectionOwner = () => {
      if (terminalSelectionText(term, el)) activeSelectionOwner = el;
      else if (activeSelectionOwner === el) activeSelectionOwner = null;
    };
    const selectionSub = term.onSelectionChange(updateSelectionOwner);

    const onCopy = (e: ClipboardEvent) => {
      if (!canOwnCopyEvent(term, el, e)) return;
      const text = terminalSelectionText(term, el);
      if (!text) return;
      activeSelectionOwner = el;
      writeCopyEvent(e, text);
    };
    const onWindowKeyDown = (e: KeyboardEvent) => {
      if (!isCopyShortcut(e) || !canOwnCopyEvent(term, el, e)) return;
      if (!copyTerminalSelection(term, el)) return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener("copy", onCopy, true);
    window.addEventListener("keydown", onWindowKeyDown, true);

    // Ctrl/Cmd+V = paste. By default xterm ALSO emits the \x16 (SYN) control byte
    // for Ctrl+V on top of the browser's native paste. A plain shell (PSReadLine)
    // treats \x16 as "paste" so it looks fine, but TUI agents (Claude/Codex) read
    // it as quoted-insert and then mis-parse the bracketed-paste sequence that
    // follows → pasted text comes out corrupted/empty. Returning false here drops
    // the \x16 WITHOUT preventDefault, so the native paste still fires: xterm
    // pastes text, and the pane's image handler catches pasted images as before.
    term.attachCustomKeyEventHandler((e) => {
      if (e.type === "keydown" && (e.ctrlKey || e.metaKey) && (e.key === "v" || e.key === "V")) {
        return false;
      }
      // Ctrl/Cmd+C: copy the selection when there is one, otherwise fall through
      // as SIGINT (\x03) so a running command can still be interrupted. Returning
      // false drops the keystroke (no \x03 emitted) — used only when we copied;
      // with no selection we return true so the shell/agent gets the interrupt.
      if (isCopyShortcut(e)) {
        if (copyTerminalSelection(term, el)) {
          return false;
        }
        return true;
      }
      return true;
    });

    // Renderer: WebGL first; fall back to canvas, then DOM. Load after open().
    try {
      const webgl = new WebglAddon();
      webgl.onContextLoss(() => webgl.dispose());
      term.loadAddon(webgl);
    } catch {
      try {
        term.loadAddon(new CanvasAddon());
      } catch {
        /* DOM renderer */
      }
    }

    try {
      fit.fit();
    } catch {
      /* container hidden */
    }
    termRef.current = term;
    fitRef.current = fit;

    const dataSub = term.onData((d) => cb.current.onData?.(d));
    const resizeSub = term.onResize((s) => cb.current.onResize?.(s));
    // Report scroll position so the pane can show its "jump to bottom" arrow.
    // viewportY is the top visible row; baseY is that row when pinned to the
    // newest line — equal means we're at the bottom.
    const scrollSub = term.onScroll(() => {
      const b = term.buffer.active;
      cb.current.onScrollChange?.(b.viewportY >= b.baseY);
    });

    // Coalesce fits into a single rAF. In focus mode every tile resizes at once
    // (free→focus, or adding/removing an agent reflows the whole grid), firing a
    // burst of ResizeObserver notifications. A synchronous fit() per notification
    // races the in-flight reflow: it can read a stale/intermediate box, compute
    // too many cols/rows, and — since .vato-body is overflow:hidden — clip the
    // text with no later fit to correct it ("texte coupé en focus"). Deferring to
    // rAF runs ONE fit after layout settles, on the final tile size. A second fit
    // next frame catches the case where the first ran a hair early.
    let refitRaf = 0;
    const refit = () => {
      cancelAnimationFrame(refitRaf);
      refitRaf = requestAnimationFrame(() => {
        try {
          fit.fit();
        } catch {
          /* 0-size during drag/hidden */
        }
        refitRaf = requestAnimationFrame(() => {
          try {
            fit.fit();
          } catch {
            /* noop */
          }
        });
      });
    };
    const ro = new ResizeObserver(refit);
    ro.observe(el);

    cb.current.onReady?.(term);

    return () => {
      window.clearTimeout(linkTimer);
      window.removeEventListener("copy", onCopy, true);
      window.removeEventListener("keydown", onWindowKeyDown, true);
      if (activeSelectionOwner === el) activeSelectionOwner = null;
      cancelAnimationFrame(refitRaf);
      ro.disconnect();
      selectionSub.dispose();
      dataSub.dispose();
      resizeSub.dispose();
      scrollSub.dispose();
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    containerRef,
    write: (d: string | Uint8Array) => termRef.current?.write(d),
    fit: () => {
      try {
        fitRef.current?.fit();
      } catch {
        /* noop */
      }
    },
    focus: () => termRef.current?.focus(),
    scrollToBottom: () => termRef.current?.scrollToBottom(),
    reset: () => termRef.current?.reset(),
    getTerm: () => termRef.current,
  };
}
