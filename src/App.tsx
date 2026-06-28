import { useEffect, useState } from "react";
import { Canvas } from "./canvas/Canvas";
import { TitleBar } from "./ui/TitleBar";
import { TopBar } from "./ui/TopBar";
import { LeftToolbar } from "./ui/LeftToolbar";
import { ShapeStylePanel } from "./ui/ShapeStylePanel";
import { ZoomControl } from "./ui/ZoomControl";
import { VoiceBar } from "./ui/VoiceBar";
import { GridOverview } from "./ui/GridOverview";
import { ControlCenter } from "./ui/ControlCenter";
import { BroadcastBar } from "./ui/BroadcastBar";
import { SettingsPanel } from "./ui/SettingsPanel";
import { ResumeDialog } from "./ui/ResumeDialog";
import { NewWorkspaceDialog } from "./ui/NewWorkspaceDialog";
import { Onboarding } from "./ui/Onboarding";
import { MinimizeIcon } from "./ui/icons";
import { useStore, countResumableAgents, focusGridWindows, useActiveWorkspace } from "./store";
import { useShortcuts } from "./canvas/shortcuts";
import { useAttentionWatch } from "./hooks/useAttentionWatch";
import { setFocusMode } from "./canvas/canvasState";
import { useT } from "./i18n";

export default function App() {
  const t = useT();
  const fullscreenId = useStore((s) => s.fullscreenId);
  const focusMode = useStore((s) => s.focusMode);
  const activeWs = useActiveWorkspace();
  const activeId = useStore((s) => s.activeId);
  const showGrid = useStore((s) => s.showGrid);
  const showControlCenter = useStore((s) => s.showControlCenter);
  const showBroadcast = useStore((s) => s.showBroadcast);
  const showSettings = useStore((s) => s.showSettings);
  const newWorkspaceOpen = useStore((s) => s.newWorkspaceOpen);
  const setFullscreen = useStore((s) => s.setFullscreen);
  const toggleGrid = useStore((s) => s.toggleGrid);
  // No workspace yet (first launch / everything deleted): force the picker.
  const noWorkspace = useStore((s) => s.workspaces.length === 0);
  // First-run onboarding wizard (folder, background, shortcuts, voice, tips).
  const onboardingDone = useStore((s) => s.onboardingDone);
  // Show the resume prompt once at startup if last session left resumable agents.
  // The snapshot is taken ONCE at mount (persisted state is already rehydrated by
  // then): the prompt is strictly about agents from a PREVIOUS app session. Agents
  // launched this session flip `resumable` on their first output — on an empty
  // workspace that must NOT pop the prompt, so we gate on the startup snapshot.
  const [hadResumableAtStartup] = useState(() => countResumableAgents(useStore.getState()) > 0);
  const showResume = useStore(
    (s) => hadResumableAtStartup && !s.resumeDismissed && countResumableAgents(s) > 0,
  );
  // The voice bar is useless without an OpenAI key (cloud-only). Hide it until one
  // is configured — Settings stays reachable via the top bar / Ctrl+, to add it.
  const hasVoiceKey = useStore((s) => !!s.settings.stt.openaiKey.trim());

  useShortcuts();
  // Watch agents in non-active workspaces so they still raise the badge / notify.
  useAttentionWatch();

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

  // On a workspace switch the top bar carries the new space's name, but in focus
  // mode it's tucked away — and switching focus→focus never re-animates it, so the
  // name is never legible. Peek the chrome back for a beat on every switch, then
  // let it tuck away again via the bars' standard transition.
  const [peek, setPeek] = useState(false);
  useEffect(() => {
    setPeek(true);
    const id = window.setTimeout(() => setPeek(false), 1500);
    return () => window.clearTimeout(id);
  }, [activeId]);

  // First-run gate #1: onboarding on a brand-new install, before any workspace
  // exists. There is nothing to render behind yet (the canvas dereferences an
  // active workspace), so the wizard owns the screen for its language + folder
  // steps. Once it creates a workspace, the branch below mounts the live canvas
  // with the wizard layered on top (so the final "practice" step is interactive).
  if (!onboardingDone && noWorkspace) {
    return (
      <div className="vato-root">
        <TitleBar />
        <Onboarding />
      </div>
    );
  }

  // First-run gate #2: onboarding done but no workspace (e.g. it was skipped, or
  // every space was later deleted) — force the (non-dismissable) picker. The
  // canvas/top-bar would dereference an undefined active workspace otherwise.
  if (noWorkspace) {
    return (
      <div className="vato-root">
        <TitleBar />
        <NewWorkspaceDialog forced />
      </div>
    );
  }

  return (
    <div className={`vato-root ${zen ? "vato-focus" : ""} ${peek ? "vato-peek" : ""}`}>
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
          {hasVoiceKey && <VoiceBar />}
        </>
      )}

      {fullscreenId && (
        <button className="vato-exit-fs" onClick={() => setFullscreen(null)}>
          <MinimizeIcon size={15} /> {t("app.exitFullscreen")}
        </button>
      )}

      {/* Empty state: focus mode active but the current filter has no matching windows */}
      {focusMode && !fullscreenId && focusGridWindows(activeWs).length === 0 && (
        <div style={{
          position: "fixed",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 10,
          pointerEvents: "none",
        }}>
          <div style={{
            background: "rgba(15,18,28,0.75)",
            border: "1px solid rgba(255,255,255,0.12)",
            borderRadius: 12,
            padding: "18px 26px",
            textAlign: "center",
          }}>
            <div style={{ color: "rgba(255,255,255,0.7)", fontSize: 14, fontWeight: 500, marginBottom: 4 }}>
              {t(
                (activeWs.focusFilter ?? "all") === "agents"
                  ? "focus.emptyAgents"
                  : (activeWs.focusFilter ?? "all") === "terminals"
                  ? "focus.emptyTerminals"
                  : "focus.emptyAll",
              )}
            </div>
            <div style={{ color: "rgba(255,255,255,0.4)", fontSize: 12 }}>
              {t("focus.emptyHint")}
            </div>
          </div>
        </div>
      )}

      {/* Empty state: normal mode (not focus) and the workspace has no windows at
          all — no terminals, no agents, nothing on the canvas. */}
      {!focusMode && !fullscreenId && activeWs.windows.length === 0 && (
        <div style={{
          position: "fixed",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 1,
          pointerEvents: "none",
        }}>
          <div style={{
            background: "rgba(15,18,28,0.75)",
            border: "1px solid rgba(255,255,255,0.12)",
            borderRadius: 12,
            padding: "18px 26px",
            textAlign: "center",
          }}>
            <div style={{ color: "rgba(255,255,255,0.7)", fontSize: 14, fontWeight: 500, marginBottom: 4 }}>
              {t("canvas.emptyTitle")}
            </div>
            <div style={{ color: "rgba(255,255,255,0.45)", fontSize: 12, marginBottom: 2 }}>
              {t("canvas.emptyDesc")}
            </div>
            <div style={{ color: "rgba(255,255,255,0.4)", fontSize: 12 }}>
              {t("canvas.emptyHint")}
            </div>
          </div>
        </div>
      )}

      {showGrid && <GridOverview />}
      {showControlCenter && <ControlCenter />}
      {showBroadcast && <BroadcastBar />}
      {showSettings && <SettingsPanel />}
      {newWorkspaceOpen && <NewWorkspaceDialog />}
      {showResume && <ResumeDialog />}

      {/* Onboarding layered over the LIVE app: its early steps cover the canvas
          (modal), but the final "practice" step is a non-blocking coach so the
          user can trigger real shortcuts on the canvas behind it. */}
      {!onboardingDone && <Onboarding />}
    </div>
  );
}
