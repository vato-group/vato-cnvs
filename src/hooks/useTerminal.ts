import { useEffect, useRef } from "react";
import { Terminal, type ITheme } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import { CanvasAddon } from "@xterm/addon-canvas";
import "@xterm/xterm/css/xterm.css";

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
  /**
   * First crack at a keydown, before xterm sends anything to the PTY. Return
   * false to swallow the key (we handled it — e.g. accepting an autocomplete
   * suggestion on Tab); return true to let it through as normal.
   */
  onKeyEvent?: (e: KeyboardEvent) => boolean;
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

    // Ctrl/Cmd+V = paste. By default xterm ALSO emits the \x16 (SYN) control byte
    // for Ctrl+V on top of the browser's native paste. A plain shell (PSReadLine)
    // treats \x16 as "paste" so it looks fine, but TUI agents (Claude/Codex) read
    // it as quoted-insert and then mis-parse the bracketed-paste sequence that
    // follows → pasted text comes out corrupted/empty. Returning false here drops
    // the \x16 WITHOUT preventDefault, so the native paste still fires: xterm
    // pastes text, and the pane's image handler catches pasted images as before.
    term.attachCustomKeyEventHandler((e) => {
      // Let the pane intercept a keydown first (autocomplete accept/navigate).
      if (e.type === "keydown" && cb.current.onKeyEvent?.(e) === false) {
        return false;
      }
      if (e.type === "keydown" && (e.ctrlKey || e.metaKey) && (e.key === "v" || e.key === "V")) {
        return false;
      }
      // Ctrl/Cmd+C: copy the selection when there is one, otherwise fall through
      // as SIGINT (\x03) so a running command can still be interrupted. Returning
      // false drops the keystroke (no \x03 emitted) — used only when we copied;
      // with no selection we return true so the shell/agent gets the interrupt.
      if (e.type === "keydown" && (e.ctrlKey || e.metaKey) && (e.key === "c" || e.key === "C")) {
        const sel = term.getSelection();
        if (sel) {
          navigator.clipboard?.writeText(sel).catch(() => {});
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

    const ro = new ResizeObserver(() => {
      try {
        fit.fit();
      } catch {
        /* 0-size during drag/hidden */
      }
    });
    ro.observe(el);

    cb.current.onReady?.(term);

    return () => {
      window.clearTimeout(linkTimer);
      ro.disconnect();
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
    getTerm: () => termRef.current,
  };
}
