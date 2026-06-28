import { useEffect, useMemo, useRef, useState } from "react";
import { useActiveWorkspace, useStore } from "../store";
import { useSelection } from "../canvas/selectionState";
import { CLIS } from "../data/clis";
import { broadcastWrite, encodeUtf8 } from "../pty";
import { useT } from "../i18n";
import { CloseIcon, SendIcon } from "./icons";

/**
 * Broadcast bar: type one command / prompt and fire it at several agents at once
 * (the "say `continue` / `yes` / run the tests to all of them" case). Targets
 * default to the current marquee selection, else every agent in the active
 * workspace; toggle them with the chips. Enter sends (Shift+Enter = newline).
 */
export function BroadcastBar() {
  const t = useT();
  const ws = useActiveWorkspace();
  const close = useStore((s) => s.toggleBroadcast);
  const selectedIds = useSelection((s) => s.selectedIds);

  const terminals = useMemo(() => ws.windows.filter((w) => w.kind === "terminal"), [ws.windows]);
  const agentIds = useMemo(
    () => terminals.filter((w) => w.cli && w.cli !== "shell").map((w) => w.id),
    [terminals],
  );

  // Seed targets: the marquee selection (terminals only) if any, else all agents,
  // else — a shells-only workspace — all terminals.
  const [targets, setTargets] = useState<Set<string>>(() => {
    const sel = selectedIds.filter((id) => terminals.some((w) => w.id === id));
    if (sel.length) return new Set(sel);
    return new Set(agentIds.length ? agentIds : terminals.map((w) => w.id));
  });
  const [text, setText] = useState("");
  const taRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    taRef.current?.focus();
  }, []);

  const toggle = (id: string) =>
    setTargets((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

  const count = targets.size;
  const canSend = count > 0 && text.trim().length > 0;

  const send = () => {
    const ids = terminals.filter((w) => targets.has(w.id)).map((w) => w.id);
    if (!ids.length || !text.trim()) return;
    // Send the text plus a carriage return so each agent submits it immediately.
    void broadcastWrite(ids, encodeUtf8(text + "\r"));
    close(false);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      close(false);
    } else if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  return (
    <div className="vato-bcast-overlay" onMouseDown={() => close(false)}>
      <div className="vato-bcast" onMouseDown={(e) => e.stopPropagation()} onKeyDown={onKeyDown}>
        <div className="vato-bcast-head">
          <span className="vato-bcast-title">{t("bcast.title")}</span>
          <span className="vato-bcast-sub">{t("bcast.count", { n: count })}</span>
          <button className="vato-tb-btn vato-no-drag" onClick={() => close(false)} title={t("common.close")}>
            <CloseIcon size={16} />
          </button>
        </div>

        {terminals.length === 0 ? (
          <div className="vato-bcast-empty">{t("bcast.empty")}</div>
        ) : (
          <>
            <div className="vato-bcast-targets">
              {terminals.map((w) => {
                const c = CLIS[w.runningCli ?? w.cli ?? "shell"];
                const on = targets.has(w.id);
                return (
                  <button
                    key={w.id}
                    className={`vato-bcast-chip ${on ? "on" : ""}`}
                    style={{ ["--accent" as string]: c.color } as React.CSSProperties}
                    onClick={() => toggle(w.id)}
                  >
                    <span className="ic" style={{ color: c.color }}>
                      <c.Icon size={14} />
                    </span>
                    <span className="nm">{w.title}</span>
                  </button>
                );
              })}
            </div>

            <div className="vato-bcast-quick">
              <button onClick={() => setTargets(new Set(terminals.map((w) => w.id)))}>{t("common.all")}</button>
              <button onClick={() => setTargets(new Set(agentIds))}>{t("common.agents")}</button>
              <button onClick={() => setTargets(new Set())}>{t("bcast.none")}</button>
            </div>
          </>
        )}

        <textarea
          ref={taRef}
          className="vato-bcast-input"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={t("bcast.placeholder")}
          rows={2}
          spellCheck={false}
        />

        <div className="vato-bcast-foot">
          <span className="hint">{t("bcast.hint")}</span>
          <button className="vato-bcast-send" disabled={!canSend} onClick={send}>
            <SendIcon size={14} /> {t("bcast.send", { n: count })}
          </button>
        </div>
      </div>
    </div>
  );
}
