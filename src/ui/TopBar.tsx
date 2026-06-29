import { useEffect, useState } from "react";
import { countAttention, useStore } from "../store";
import { CLIS, CLI_ORDER } from "../data/clis";
import { cliCheck } from "../pty";
import { humanizeCombo, runAction } from "../canvas/shortcuts";
import { useT } from "../i18n";
import { Dropdown } from "./Dropdown";
import { BellIcon, ChevronDownIcon, EyeIcon, EyeOffIcon, FocusIcon, FolderIcon, GridIcon, MonitorIcon, PlusIcon, SettingsIcon } from "./icons";

/** Shortcut action id for spawning a given CLI from the menu, if any. */
const cliShortcut = (id: string): string | undefined =>
  id === "antigravity" ? undefined : `agent.${id}`;

export function TopBar() {
  const t = useT();
  const workspaces = useStore((s) => s.workspaces);
  const activeId = useStore((s) => s.activeId);
  const active = workspaces.find((w) => w.id === activeId) ?? workspaces[0];
  const setActive = useStore((s) => s.setActive);
  const toggleWorkspaceHidden = useStore((s) => s.toggleWorkspaceHidden);
  const openNewWorkspace = useStore((s) => s.openNewWorkspace);
  const addTerminal = useStore((s) => s.addTerminal);
  const toggleGrid = useStore((s) => s.toggleGrid);
  const toggleControlCenter = useStore((s) => s.toggleControlCenter);
  const toggleSettings = useStore((s) => s.toggleSettings);
  const focusMode = useStore((s) => s.focusMode);
  const setFocusFilter = useStore((s) => s.setFocusFilter);
  const shortcuts = useStore((s) => s.settings.shortcuts);
  const attention = useStore(countAttention);
  const focusFilter = active?.focusFilter ?? "all";
  const focusLabel =
    focusFilter === "agents" ? t("common.agents") : focusFilter === "terminals" ? t("common.terminals") : t("common.all");

  const kbd = (id?: string) => (id && shortcuts[id] ? humanizeCombo(shortcuts[id]) : "");
  const tip = (label: string, id?: string) => {
    const k = kbd(id);
    return k ? `${label} · ${k}` : label;
  };

  const [avail, setAvail] = useState<Record<string, boolean>>({});
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const entries: Record<string, boolean> = {};
      for (const id of CLI_ORDER) {
        entries[id] = await cliCheck(CLIS[id].program).catch(() => false);
      }
      if (!cancelled) setAvail(entries);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="vato-topbar" data-tauri-drag-region>
      <img className="vato-brand-mark" src="/logo.png" alt="Vato Canvas" draggable={false} />

      <Dropdown
        align="left"
        width={232}
        trigger={() => (
          <button className="vato-ws-btn">
            <FolderIcon size={15} />
            <span>{active.name}</span>
            <ChevronDownIcon size={14} />
          </button>
        )}
      >
        {(close) => (
          <div className="vato-menu">
            <div className="vato-menu-label">{t("topbar.goTo")}</div>
            {workspaces.map((w) => (
              <div
                key={w.id}
                className={`vato-menu-item ${w.id === active.id ? "on" : ""} ${w.hidden ? "dim" : ""}`}
                role="button"
                tabIndex={0}
                onClick={() => {
                  setActive(w.id);
                  close();
                }}
                onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (setActive(w.id), close())}
              >
                <FolderIcon size={15} />
                <span className="label">{w.name}</span>
                <span className="muted">{w.windows.length}</span>
                {/* Eye toggle: hide a space from the next/prev cycle without
                    removing it (it stays reachable here). */}
                <button
                  className="vato-menu-eye"
                  title={w.hidden ? t("topbar.unhideWorkspace") : t("topbar.hideWorkspace")}
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleWorkspaceHidden(w.id);
                  }}
                >
                  {w.hidden ? <EyeOffIcon size={14} /> : <EyeIcon size={14} />}
                </button>
              </div>
            ))}
            <div className="vato-menu-sep" />
            <button
              className="vato-menu-item"
              onClick={() => {
                openNewWorkspace();
                close();
              }}
            >
              <PlusIcon size={15} />
              <span className="label">{t("topbar.newWorkspace")}</span>
              {kbd("workspace.new") && <span className="muted">{kbd("workspace.new")}</span>}
            </button>
            <button
              className="vato-menu-item"
              onClick={() => {
                toggleGrid(true);
                close();
              }}
            >
              <GridIcon size={15} />
              <span className="label">{t("topbar.manageWorkspaces")}</span>
              {kbd("workspace.overview") && <span className="muted">{kbd("workspace.overview")}</span>}
            </button>
          </div>
        )}
      </Dropdown>

      <button
        className="vato-icon-btn"
        onClick={() => toggleGrid()}
        title={tip(t("topbar.workspacesOverview"), "workspace.overview")}
      >
        <GridIcon size={16} />
      </button>

      <button
        className="vato-icon-btn"
        onClick={() => toggleControlCenter()}
        title={tip(t("cc.open"), "control.open")}
      >
        <MonitorIcon size={16} />
      </button>

      {attention > 0 && (
        <button
          className="vato-attn-btn"
          onClick={() => runAction("attention.next")}
          title={tip(t("topbar.attention", { n: attention }), "attention.next")}
        >
          <BellIcon size={15} />
          <span className="vato-attn-count">{attention}</span>
        </button>
      )}

      <button
        className="vato-icon-btn"
        onClick={() => toggleSettings()}
        title={tip(t("topbar.settings"), "settings.open")}
      >
        <SettingsIcon size={16} />
      </button>

      {/* Focus-mode pane filter — choose what the grid shows for THIS workspace.
          A compact dropdown (mirrors the workspace switcher), surfaced only in
          focus mode where it has an effect; persisted per space. */}
      {focusMode && (
        <Dropdown
          align="right"
          width={188}
          trigger={() => (
            <button className="vato-ws-btn" title={tip(t("topbar.focusFilter"), "view.focusFilter")}>
              <FocusIcon size={15} />
              <span>{focusLabel}</span>
              <ChevronDownIcon size={14} />
            </button>
          )}
        >
          {(close) => (
            <div className="vato-menu">
              <div className="vato-menu-label">{t("topbar.showInFocus")}</div>
              {([
                ["all", t("common.all")],
                ["agents", t("common.agents")],
                ["terminals", t("common.terminals")],
              ] as const).map(([value, label]) => (
                <button
                  key={value}
                  className={`vato-menu-item ${focusFilter === value ? "on" : ""}`}
                  onClick={() => {
                    setFocusFilter(value);
                    close();
                  }}
                >
                  <span className="label">{label}</span>
                  {focusFilter === value && <span className="muted">✓</span>}
                </button>
              ))}
            </div>
          )}
        </Dropdown>
      )}

      <Dropdown
        align="right"
        width={236}
        trigger={() => (
          <button className="vato-agent-btn">
            <PlusIcon size={15} /> {t("topbar.agent")}
          </button>
        )}
      >
        {(close) => (
          <div className="vato-menu">
            <div className="vato-menu-label">{t("topbar.newAgentTerminal")}</div>
            {CLI_ORDER.map((id) => {
              const c = CLIS[id];
              const ok = id === "shell" || avail[id];
              const k = kbd(cliShortcut(id));
              return (
                <button
                  key={id}
                  className="vato-menu-item"
                  disabled={!ok}
                  onClick={() => {
                    addTerminal(id);
                    close();
                  }}
                >
                  <span style={{ color: c.color, display: "flex" }}>
                    <c.Icon size={16} />
                  </span>
                  <span className="label">{c.label}</span>
                  {!ok ? (
                    <span className="muted">{t("common.unavailable")}</span>
                  ) : (
                    k && <span className="muted">{k}</span>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </Dropdown>
    </div>
  );
}
