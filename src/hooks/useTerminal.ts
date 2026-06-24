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
      fontSize: 13,
      lineHeight: 1.05,
      scrollback: 8000,
      theme: THEME,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon());
    term.open(el);

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
      ro.disconnect();
      dataSub.dispose();
      resizeSub.dispose();
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
    getTerm: () => termRef.current,
  };
}
