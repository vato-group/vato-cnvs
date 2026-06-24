import { useEffect, useRef, useState } from "react";
import { useStore } from "../store";
import { CLIS, CLI_ORDER } from "../data/clis";
import { cliCheck } from "../pty";
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
import { FocusIcon } from "./icons";

interface ToolDef {
  type: ToolType;
  title: string;
  Icon: (p: { size?: number }) => React.ReactNode;
}

const TOOLS: ToolDef[] = [
  { type: "selection", title: "Sélection (V)", Icon: SelectTool },
  { type: "hand", title: "Déplacer le canvas (H)", Icon: HandTool },
  { type: "rectangle", title: "Rectangle (R)", Icon: RectTool },
  { type: "diamond", title: "Losange (D)", Icon: DiamondTool },
  { type: "ellipse", title: "Cercle (O)", Icon: EllipseTool },
  { type: "arrow", title: "Flèche (A)", Icon: ArrowTool },
  { type: "line", title: "Ligne (L)", Icon: LineTool },
  { type: "freedraw", title: "Dessin (P)", Icon: DrawTool },
  { type: "text", title: "Texte (T)", Icon: TextTool },
  { type: "image", title: "Image", Icon: ImageTool },
  { type: "eraser", title: "Gomme (E)", Icon: EraserTool },
];

export function LeftToolbar() {
  const activeTool = useCanvasState((s) => s.activeTool);
  const focusMode = useStore((s) => s.focusMode);
  const addTerminal = useStore((s) => s.addTerminal);
  const addPane = useStore((s) => s.addPane);

  const [cliOpen, setCliOpen] = useState(false);
  const [avail, setAvail] = useState<Record<string, boolean>>({});
  const wrapRef = useRef<HTMLDivElement>(null);

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
      {TOOLS.map((t) => (
        <button
          key={t.type}
          className={`vato-tool ${activeTool === t.type ? "on" : ""}`}
          title={t.title}
          onClick={() => selectTool(t.type)}
        >
          <t.Icon size={19} />
        </button>
      ))}

      <div className="vato-tool-sep" />

      <div style={{ position: "relative" }}>
        <button
          className={`vato-tool agent ${cliOpen ? "on" : ""}`}
          title="Nouveau terminal / agent"
          onClick={() => setCliOpen((o) => !o)}
        >
          <TerminalTool size={19} />
        </button>
        {cliOpen && (
          <div className="vato-flyout">
            <div className="vato-menu-label">Nouvel agent</div>
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
                    setCliOpen(false);
                  }}
                >
                  <span style={{ color: c.color, display: "flex" }}>
                    <c.Icon size={16} />
                  </span>
                  <span className="label">{c.label}</span>
                  {!ok && <span className="muted">indispo.</span>}
                </button>
              );
            })}
          </div>
        )}
      </div>

      <button className="vato-tool" title="Navigateur intégré" onClick={() => addPane("browser")}>
        <BrowserTool size={19} />
      </button>

      <div className="vato-tool-sep" />

      <button
        className={`vato-tool subtle ${focusMode ? "on" : ""}`}
        title={
          focusMode
            ? "Quitter le focus — disperser les fenêtres (Ctrl+0)"
            : "Focus — regrouper terminaux, agents et navigateurs en grille (Ctrl+0)"
        }
        onClick={() => toggleFocusMode()}
      >
        <FocusIcon size={18} />
      </button>
    </div>
  );
}
