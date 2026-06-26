import { useEffect, useRef, useState } from "react";
import { useStore } from "../store";
import { CLIS, CLI_ORDER } from "../data/clis";
import { cliCheck } from "../pty";
import { humanizeCombo } from "../canvas/shortcuts";
import { useT } from "../i18n";
import { selectTool, toggleFocusMode, useCanvasState, type ToolType } from "../canvas/canvasState";
import {
  ArrowTool,
  BrowserTool,
  DiamondTool,
  DrawTool,
  EllipseTool,
  EraserTool,
  HandTool,
  ImageTool,
  LineTool,
  RectTool,
  SelectTool,
  TerminalTool,
  TextTool,
} from "./toolIcons";
import { FocusIcon, PencilIcon } from "./icons";

interface ToolDef {
  type: ToolType;
  Icon: (p: { size?: number }) => React.ReactNode;
}

// Each tool's tooltip name comes from `tool.<type>`; its shortcut from the
// matching `tool.<type>` binding, appended live.
const TOOLS: ToolDef[] = [
  { type: "selection", Icon: SelectTool },
  { type: "hand", Icon: HandTool },
  { type: "rectangle", Icon: RectTool },
  { type: "diamond", Icon: DiamondTool },
  { type: "ellipse", Icon: EllipseTool },
  { type: "arrow", Icon: ArrowTool },
  { type: "line", Icon: LineTool },
  { type: "freedraw", Icon: DrawTool },
  { type: "text", Icon: TextTool },
  { type: "image", Icon: ImageTool },
  { type: "eraser", Icon: EraserTool },
];

/** Shortcut action id for spawning a given CLI from the flyout, if any. */
const cliShortcut = (id: string): string | undefined =>
  id === "antigravity" ? undefined : `agent.${id}`;

export function LeftToolbar() {
  const t = useT();
  const activeTool = useCanvasState((s) => s.activeTool);
  const focusMode = useStore((s) => s.focusMode);
  const addTerminal = useStore((s) => s.addTerminal);
  const addPane = useStore((s) => s.addPane);
  const shortcuts = useStore((s) => s.settings.shortcuts);

  const [cliOpen, setCliOpen] = useState(false);
  const [avail, setAvail] = useState<Record<string, boolean>>({});
  const wrapRef = useRef<HTMLDivElement>(null);

  // Humanized binding for an action id, or "" when unbound.
  const kbd = (id?: string) => (id && shortcuts[id] ? humanizeCombo(shortcuts[id]) : "");
  // Tooltip with its shortcut appended (e.g. "Selection · Ctrl V").
  const tip = (label: string, id?: string) => {
    const k = kbd(id);
    return k ? `${label} · ${k}` : label;
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const entries: Record<string, boolean> = {};
      for (const id of CLI_ORDER) entries[id] = await cliCheck(CLIS[id].program).catch(() => false);
      if (!cancelled) setAvail(entries);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!cliOpen) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setCliOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [cliOpen]);

  return (
    <div className="vato-toolbar" ref={wrapRef}>
      {TOOLS.map((tool) => (
        <button
          key={tool.type}
          className={`vato-tool ${activeTool === tool.type ? "on" : ""}`}
          title={tip(t(`tool.${tool.type}`), `tool.${tool.type}`)}
          onClick={() => selectTool(tool.type)}
        >
          <tool.Icon size={19} />
        </button>
      ))}

      <div className="vato-tool-sep" />

      <div style={{ position: "relative" }}>
        <button
          className={`vato-tool agent ${cliOpen ? "on" : ""}`}
          title={t("toolbar.newTerminalAgent")}
          onClick={() => setCliOpen((o) => !o)}
        >
          <TerminalTool size={19} />
        </button>
        {cliOpen && (
          <div className="vato-flyout">
            <div className="vato-menu-label">{t("toolbar.newAgent")}</div>
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
                    setCliOpen(false);
                  }}
                >
                  <span style={{ color: c.color, display: "flex" }}>
                    <c.Icon size={16} />
                  </span>
                  <span className="label">{c.label}</span>
                  {!ok ? (
                    <span className="muted">{t("common.unavailableShort")}</span>
                  ) : (
                    k && <span className="muted">{k}</span>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>

      <button
        className="vato-tool"
        title={tip(t("toolbar.browser"), "pane.browser")}
        onClick={() => addPane("browser")}
      >
        <BrowserTool size={19} />
      </button>

      <button className="vato-tool" title={t("toolbar.notes")} onClick={() => addPane("notes")}>
        <PencilIcon size={18} />
      </button>

      <div className="vato-tool-sep" />

      <button
        className={`vato-tool subtle ${focusMode ? "on" : ""}`}
        title={tip(focusMode ? t("toolbar.focusExit") : t("toolbar.focusEnter"), "view.focus")}
        onClick={() => toggleFocusMode()}
      >
        <FocusIcon size={18} />
      </button>
    </div>
  );
}
