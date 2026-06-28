import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "../store";
import { CLIS } from "../data/clis";
import type { CliId, WindowItem, Workspace } from "../types";
import { revealWindow } from "../lib/reveal";
import { useT } from "../i18n";
import { CloseIcon, MonitorIcon } from "./icons";

type Filter = "all" | "agents" | "terminals" | "running";

/** Status → i18n badge key. Idle agents get no badge (keeps the list clean). */
const ST_LABEL: Record<string, string> = {
  starting: "cc.st.starting",
  active: "cc.st.active",
  waiting: "cc.st.waiting",
  finished: "cc.st.finished",
  error: "cc.st.error",
};

interface Row {
  win: WindowItem;
  ws: Workspace;
  cliId: CliId;
  isAgent: boolean;
  running: boolean;
}

/**
 * Compact "control center" palette: a single spotlight listing EVERY terminal /
 * agent across ALL workspaces (not just the active one), with a search box and
 * filter chips. Picking a row "goes to" that agent — switches workspace, focuses
 * the pane and drops the OS cursor on it (see revealWindow). Opened via Ctrl/Cmd+K
 * or the top-bar monitor button.
 */
export function ControlCenter() {
  const t = useT();
  const workspaces = useStore((s) => s.workspaces);
  const activeId = useStore((s) => s.activeId);
  const close = useStore((s) => s.toggleControlCenter);

  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [active, setActive] = useState(0); // highlighted row
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Every terminal pane across all workspaces (browsers aren't "agents/terminals").
  const rows: Row[] = useMemo(() => {
    const out: Row[] = [];
    for (const ws of workspaces) {
      for (const win of ws.windows) {
        if (win.kind !== "terminal") continue;
        const cliId = (win.runningCli ?? win.cli ?? "shell") as CliId;
        out.push({
          win,
          ws,
          cliId,
          isAgent: CLIS[cliId]?.agent ?? false,
          running: win.status === "active" || win.status === "starting",
        });
      }
    }
    return out;
  }, [workspaces]);

  const counts = useMemo(() => {
    const agents = rows.filter((r) => r.isAgent).length;
    return { agents, terms: rows.length - agents, spaces: new Set(rows.map((r) => r.ws.id)).size };
  }, [rows]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (filter === "agents" && !r.isAgent) return false;
      if (filter === "terminals" && r.isAgent) return false;
      if (filter === "running" && !r.running) return false;
      if (!q) return true;
      const hay = `${r.win.title} ${CLIS[r.cliId]?.label ?? ""} ${r.ws.name} ${r.win.cwd ?? ""}`.toLowerCase();
      return hay.includes(q);
    });
  }, [rows, filter, query]);

  // Clamp the highlight whenever the filtered set shrinks.
  useEffect(() => {
    setActive((a) => Math.min(a, Math.max(0, filtered.length - 1)));
  }, [filtered.length]);

  // Keep the highlighted row visible (keyboard nav).
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-row="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const go = (r?: Row) => {
    if (r) revealWindow(r.win.id);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      go(filtered[active]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      close(false);
    }
  };

  const FILTERS: { id: Filter; label: string }[] = [
    { id: "all", label: t("common.all") },
    { id: "agents", label: t("common.agents") },
    { id: "terminals", label: t("common.terminals") },
    { id: "running", label: t("cc.running") },
  ];

  return (
    <div className="vato-cc-overlay" onMouseDown={() => close(false)}>
      <div className="vato-cc" onMouseDown={(e) => e.stopPropagation()} onKeyDown={onKeyDown}>
        <div className="vato-cc-head">
          <span className="vato-cc-title">
            <MonitorIcon size={16} /> {t("cc.title")}
          </span>
          <span className="vato-cc-summary">{t("cc.summary", counts)}</span>
          <button className="vato-tb-btn" onClick={() => close(false)} title={t("common.close")}>
            <CloseIcon size={16} />
          </button>
        </div>

        <input
          ref={inputRef}
          className="vato-cc-search"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          placeholder={t("cc.placeholder")}
          spellCheck={false}
        />

        <div className="vato-cc-filters">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              className={`vato-cc-chip ${filter === f.id ? "on" : ""}`}
              onClick={() => {
                setFilter(f.id);
                setActive(0);
              }}
            >
              {f.label}
            </button>
          ))}
        </div>

        <div className="vato-cc-list" ref={listRef}>
          {filtered.length === 0 ? (
            <div className="vato-cc-empty">
              <div className="t">{rows.length === 0 ? t("cc.empty") : t("cc.noResults")}</div>
              {rows.length === 0 && <div className="h">{t("cc.emptyHint")}</div>}
            </div>
          ) : (
            filtered.map((r, i) => {
              const c = CLIS[r.cliId];
              const here = r.ws.id === activeId;
              const status = r.win.status ?? "idle";
              const stKey = ST_LABEL[status];
              return (
                <button
                  key={r.win.id}
                  data-row={i}
                  className={`vato-cc-row ${i === active ? "active" : ""}`}
                  style={{ ["--accent" as string]: c?.color } as React.CSSProperties}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => go(r)}
                >
                  <span className="vato-cc-ic" style={{ color: c?.color }}>
                    {c ? <c.Icon size={16} /> : null}
                  </span>
                  <span className="vato-cc-name">{r.win.title}</span>
                  <span className="vato-cc-cli">{c?.label}</span>
                  <span className="vato-cc-spacer" />
                  {stKey && <span className={`vato-cc-st s-${status}`}>{t(stKey)}</span>}
                  <span className={`vato-cc-ws ${here ? "on" : ""}`}>{r.ws.name}</span>
                </button>
              );
            })
          )}
        </div>

        <div className="vato-cc-foot">{t("cc.nav")}</div>
      </div>
    </div>
  );
}
