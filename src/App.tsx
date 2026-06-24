import { useEffect } from "react";
import { Canvas } from "./canvas/Canvas";
import { TitleBar } from "./ui/TitleBar";
import { TopBar } from "./ui/TopBar";
import { LeftToolbar } from "./ui/LeftToolbar";
import { ShapeStylePanel } from "./ui/ShapeStylePanel";
import { ZoomControl } from "./ui/ZoomControl";
import { VoiceBar } from "./ui/VoiceBar";
import { GridOverview } from "./ui/GridOverview";
import { SettingsPanel } from "./ui/SettingsPanel";
import { ResumeDialog } from "./ui/ResumeDialog";
import { NewWorkspaceDialog } from "./ui/NewWorkspaceDialog";
import { MinimizeIcon } from "./ui/icons";
import { useStore, countResumableAgents } from "./store";
import { useShortcuts } from "./canvas/shortcuts";
import { setFocusMode } from "./canvas/canvasState";

export default function App() {
  const fullscreenId = useStore((s) => s.fullscreenId);
  const focusMode = useStore((s) => s.focusMode);
  const showGrid = useStore((s) => s.showGrid);
  const showSettings = useStore((s) => s.showSettings);
  const newWorkspaceOpen = useStore((s) => s.newWorkspaceOpen);
  const setFullscreen = useStore((s) => s.setFullscreen);
  const toggleGrid = useStore((s) => s.toggleGrid);
  // Show the resume prompt once at startup if last session left resumable agents.
  const showResume = useStore((s) => !s.resumeDismissed && countResumableAgents(s) > 0);

  useShortcuts();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (fullscreenId) setFullscreen(null);
        else if (showGrid) toggleGrid(false);
        else if (focusMode) setFocusMode(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fullscreenId, focusMode, showGrid, setFullscreen, toggleGrid]);

  // Focus = "zen" mode: the chrome tucks away toward its edge so the window grid
  // grows, and slides back on a smooth hover of the matching edge rail.
  const zen = focusMode && !fullscreenId;

  return (
    <div className={`vato-root ${zen ? "vato-focus" : ""}`}>
      <Canvas />

      <TitleBar />

      {!fullscreenId && (
        <>
          {/* Edge hover rails — sit in the grid gutters, reveal the hidden chrome.
              Rendered before the bars so the CSS `~` reveal selectors can reach them. */}
          {zen && (
            <>
              <div className="vato-hot vato-hot-top" />
              <div className="vato-hot vato-hot-left" />
              <div className="vato-hot vato-hot-bottom" />
            </>
          )}
          <TopBar />
          <LeftToolbar />
          <ShapeStylePanel />
          <ZoomControl />
          <VoiceBar />
        </>
      )}

      {fullscreenId && (
        <button className="vato-exit-fs" onClick={() => setFullscreen(null)}>
          <MinimizeIcon size={15} /> Quitter le plein écran (Esc)
        </button>
      )}

      {showGrid && <GridOverview />}
      {showSettings && <SettingsPanel />}
      {newWorkspaceOpen && <NewWorkspaceDialog />}
      {showResume && <ResumeDialog />}
    </div>
  );
}
