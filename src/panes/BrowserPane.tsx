import { useCallback, useRef, useState } from "react";
import { useStore } from "../store";
import type { WindowItem } from "../types";
import { useT } from "../i18n";
import { ArrowLeftIcon, ArrowRightIcon, RefreshIcon } from "../ui/icons";

function normalizeUrl(input: string): string {
  const v = input.trim();
  if (!v) return "";
  if (/^https?:\/\//i.test(v)) return v;
  if (/^(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(v)) return `http://${v}`;
  if (/^[\w-]+(\.[\w-]+)+(:\d+)?(\/|$)/.test(v)) return `https://${v}`;
  return `https://www.google.com/search?q=${encodeURIComponent(v)}`;
}

export function BrowserPane({ win }: { win: WindowItem }) {
  const t = useT();
  const updateWindow = useStore((s) => s.updateWindow);
  const [src, setSrc] = useState(() => normalizeUrl(win.url || "http://localhost:5173"));
  const [input, setInput] = useState(src);
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);
  const back = useRef<string[]>([]);
  const fwd = useRef<string[]>([]);

  const apply = useCallback(
    (u: string) => {
      setSrc(u);
      setInput(u);
      setLoading(true);
      setReloadKey((k) => k + 1);
      updateWindow(win.id, { url: u });
    },
    [updateWindow, win.id],
  );

  const navigate = useCallback(
    (raw: string) => {
      const u = normalizeUrl(raw);
      if (!u) return;
      if (u !== src) {
        back.current.push(src);
        fwd.current = [];
      }
      apply(u);
    },
    [apply, src],
  );

  const goBack = () => {
    const prev = back.current.pop();
    if (!prev) return;
    fwd.current.push(src);
    apply(prev);
  };
  const goFwd = () => {
    const next = fwd.current.pop();
    if (!next) return;
    back.current.push(src);
    apply(next);
  };
  const reload = () => {
    setLoading(true);
    setReloadKey((k) => k + 1);
  };

  return (
    <div className="vato-browser">
      <div className="vato-browser-bar vato-no-drag">
        <button className="vato-tb-btn" onClick={goBack} disabled={!back.current.length} title={t("browser.back")}>
          <ArrowLeftIcon size={15} />
        </button>
        <button className="vato-tb-btn" onClick={goFwd} disabled={!fwd.current.length} title={t("browser.forward")}>
          <ArrowRightIcon size={15} />
        </button>
        <button className="vato-tb-btn" onClick={reload} title={t("browser.reload")}>
          <RefreshIcon size={15} />
        </button>
        <form className="vato-browser-form" onSubmit={(e) => { e.preventDefault(); navigate(input); }}>
          <input
            className="vato-browser-input allow-select"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={t("browser.urlPlaceholder")}
            spellCheck={false}
          />
        </form>
        {loading && <span className="vato-browser-loading">…</span>}
      </div>
      <iframe
        key={reloadKey}
        src={src}
        title={`browser-${win.id}`}
        onLoad={() => setLoading(false)}
        className="vato-browser-frame"
        referrerPolicy="no-referrer"
        allow="clipboard-read; clipboard-write; microphone; camera; autoplay"
      />
    </div>
  );
}
