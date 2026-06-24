import { useEffect, useState } from "react";
import { useStore } from "../store";
import { CLIS, CLI_ORDER } from "../data/clis";
import { cliCheck } from "../pty";
import { Dropdown } from "./Dropdown";
import { ChevronDownIcon, FolderIcon, GridIcon, PlusIcon, SettingsIcon } from "./icons";

export function TopBar() {
  const workspaces = useStore((s) => s.workspaces);
  const activeId = useStore((s) => s.activeId);
  const active = workspaces.find((w) => w.id === activeId) ?? workspaces[0];
  const setActive = useStore((s) => s.setActive);
  const openNewWorkspace = useStore((s) => s.openNewWorkspace);
  const addTerminal = useStore((s) => s.addTerminal);
  const toggleGrid = useStore((s) => s.toggleGrid);
  const toggleSettings = useStore((s) => s.toggleSettings);
  const openSettings = useStore((s) => s.openSettings);

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
            <div className="vato-menu-label">Aller à</div>
            {workspaces.map((w) => (
              <button
                key={w.id}
                className={`vato-menu-item ${w.id === active.id ? "on" : ""}`}
                onClick={() => {
                  setActive(w.id);
                  close();
                }}
              >
                <FolderIcon size={15} />
                <span className="label">{w.name}</span>
                <span className="muted">{w.windows.length}</span>
              </button>
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
              <span className="label">Nouveau workspace</span>
            </button>
            <button
              className="vato-menu-item"
              onClick={() => {
                openSettings("workspaces");
                close();
              }}
            >
              <SettingsIcon size={15} />
              <span className="label">Gérer les workspaces…</span>
            </button>
          </div>
        )}
      </Dropdown>

      <div className="vato-ws-tabs">
        {workspaces
          .filter((w) => w.id !== activeId)
          .map((w) => (
            <button key={w.id} className="vato-ws-tab" onClick={() => setActive(w.id)} title={w.name}>
              {w.name}
            </button>
          ))}
        <button className="vato-ws-tab add" onClick={() => openNewWorkspace()} title="Nouveau workspace">
          <PlusIcon size={14} />
        </button>
      </div>

      <button className="vato-icon-btn" onClick={() => toggleGrid()} title="Vue d'ensemble des workspaces">
        <GridIcon size={16} />
      </button>

      <button className="vato-icon-btn" onClick={() => toggleSettings()} title="Réglages (Ctrl ,)">
        <SettingsIcon size={16} />
      </button>

      <Dropdown
        align="right"
        width={236}
        trigger={() => (
          <button className="vato-agent-btn">
            <PlusIcon size={15} /> Agent
          </button>
        )}
      >
        {(close) => (
          <div className="vato-menu">
            <div className="vato-menu-label">Nouvel agent / terminal</div>
            {CLI_ORDER.map((id) => {
              const c = CLIS[id];
              const ok = id === "shell" || avail[id];
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
                  {!ok && <span className="muted">indisponible</span>}
                </button>
              );
            })}
          </div>
        )}
      </Dropdown>
    </div>
  );
}
