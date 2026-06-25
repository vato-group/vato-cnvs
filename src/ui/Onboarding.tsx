import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useStore, baseName } from "../store";
import type { Background } from "../types";
import type { DirListing } from "../pty";
import { BG_IMAGES, BG_PRESETS, BG_VIDEOS, type BgTemplate } from "../data/backgrounds";
import { CLIS } from "../data/clis";
import { comboFromEvent, humanizeCombo } from "../canvas/shortcuts";
import { useT, useLang, LANGS, type TFn } from "../i18n";
import { BackgroundLayer } from "./BackgroundLayer";
import { FolderPicker } from "./FolderPicker";
import { TerminalTool } from "./toolIcons";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CrosshairIcon,
  FocusIcon,
  FolderIcon,
  GlobeIcon,
  GridIcon,
  KeyboardIcon,
  MaximizeIcon,
  MicIcon,
  PaletteIcon,
  PlusIcon,
  SettingsIcon,
} from "./icons";

type StepId = "language" | "folder" | "background" | "shortcuts" | "voice" | "tips" | "practice";

const STEP_ICON: Record<StepId, (p: { size?: number }) => ReactNode> = {
  language: GlobeIcon,
  folder: FolderIcon,
  background: PaletteIcon,
  shortcuts: KeyboardIcon,
  voice: MicIcon,
  tips: GridIcon,
  practice: CrosshairIcon,
};

/** Inline check mark for completed items (avoids touching the shared icon set). */
const CheckMark = ({ size = 14 }: { size?: number }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={3}
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

/* ----------------------------- Language step ------------------------- */
function LanguageStep() {
  const lang = useLang();
  const setLang = useStore((s) => s.setLang);
  return (
    <div className="vato-onb-scroll">
      <div className="vato-onb-langs">
        {LANGS.map((l) => (
          <button
            key={l.code}
            className={`vato-onb-lang ${lang === l.code ? "on" : ""}`}
            onClick={() => setLang(l.code)}
          >
            <span className="flag">{l.flag}</span>
            <span className="name">{l.label}</span>
            {lang === l.code && (
              <span className="tick">
                <CheckMark size={13} />
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

/* ------------------------- Rebindable key cap ------------------------- */
function RebindRow({ actionId, hintKey }: { actionId: string; hintKey: string }) {
  const t = useT();
  const combo = useStore((s) => s.settings.shortcuts[actionId]);
  const setShortcut = useStore((s) => s.setShortcut);
  const [rec, setRec] = useState(false);

  useEffect(() => {
    if (!rec) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") return setRec(false);
      const c = comboFromEvent(e);
      if (!c) return;
      setShortcut(actionId, c);
      setRec(false);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [rec, actionId, setShortcut]);

  return (
    <div className="vato-onb-srow">
      <div className="vato-onb-srow-text">
        <span className="label">{t(`action.${actionId}`)}</span>
        <span className="hint">{t(hintKey)}</span>
      </div>
      <button
        className={`vato-kbd ${rec ? "rec" : ""}`}
        onClick={() => setRec(true)}
        title={t("settings.shortcuts.recordHint")}
      >
        {rec ? t("settings.shortcuts.press") : humanizeCombo(combo ?? "")}
      </button>
    </div>
  );
}

/* ----------------------------- Tip card ------------------------------ */
function TipCard({
  Icon,
  color,
  labelKey,
  actionId,
}: {
  Icon: (p: { size?: number }) => ReactNode;
  color?: string;
  labelKey: string;
  /** Shortcut id whose live binding is shown as a key cap. */
  actionId: string;
}) {
  const t = useT();
  const combo = useStore((s) => s.settings.shortcuts[actionId]);
  return (
    <div className="vato-onb-tip">
      <span className="ico" style={color ? { color } : undefined}>
        <Icon size={17} />
      </span>
      <span className="lbl">{t(labelKey)}</span>
      {combo && <span className="vato-onb-key">{humanizeCombo(combo)}</span>}
    </div>
  );
}

/* ----------------------- Background gallery -------------------------- */
function BackgroundStep({ t }: { t: TFn }) {
  const workspaces = useStore((s) => s.workspaces);
  const activeId = useStore((s) => s.activeId);
  const setBackground = useStore((s) => s.setBackground);
  const ws = workspaces.find((w) => w.id === activeId);
  if (!ws) return null;

  const apply = (bg: Background) => setBackground(ws.id, bg);
  const pick = (tpl: BgTemplate) => apply({ kind: tpl.kind, value: tpl.value, dim: tpl.dim });
  const isTpl = (tpl: BgTemplate) => ws.background.kind === tpl.kind && ws.background.value === tpl.value;
  const isColor = (c: string) => ws.background.kind === "color" && ws.background.value === c;

  return (
    <div className="vato-onb-scroll">
      <div className="vato-menu-label">{t("onb.bg.colors")}</div>
      <div className="vato-bg-presets" style={{ marginBottom: 14 }}>
        {BG_PRESETS.map((p, i) => (
          <button
            key={i}
            className={`vato-bg-swatch ${isColor(p) ? "on" : ""}`}
            style={{ background: p, height: 44 }}
            onClick={() => apply({ kind: "color", value: p, dim: ws.background.dim ?? 0 })}
          />
        ))}
      </div>

      <div className="vato-menu-label">{t("settings.appearance.wallpapers")}</div>
      <div className="vato-bg-gallery">
        {BG_IMAGES.map((tpl) => (
          <button
            key={tpl.value}
            className={`vato-bg-tile ${isTpl(tpl) ? "on" : ""}`}
            title={t(tpl.labelKey)}
            onClick={() => pick(tpl)}
          >
            <img src={tpl.thumb} alt="" loading="lazy" draggable={false} />
            <span className="vato-bg-tile-label">{t(tpl.labelKey)}</span>
          </button>
        ))}
      </div>

      <div className="vato-menu-label" style={{ marginTop: 14 }}>
        {t("settings.appearance.videos")}
      </div>
      <div className="vato-bg-gallery">
        {BG_VIDEOS.map((tpl) => (
          <button
            key={tpl.value}
            className={`vato-bg-tile ${isTpl(tpl) ? "on" : ""}`}
            title={t(tpl.labelKey)}
            onClick={() => pick(tpl)}
          >
            <img src={tpl.thumb} alt="" loading="lazy" draggable={false} />
            <span className="vato-bg-tile-badge">▶</span>
            <span className="vato-bg-tile-label">{t(tpl.labelKey)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/* ----------------------------- Voice step ---------------------------- */
function VoiceStep({ t, want, setWant }: { t: TFn; want: boolean; setWant: (v: boolean) => void }) {
  const stt = useStore((s) => s.settings.stt);
  const setStt = useStore((s) => s.setStt);
  const micCombo = useStore((s) => s.settings.shortcuts["voice.mic"]);
  const ready = !!stt.openaiKey.trim();

  return (
    <div className="vato-onb-scroll">
      <div className="vato-onb-choice">
        <button className={`vato-onb-choice-btn ${want ? "on" : ""}`} onClick={() => setWant(true)}>
          <MicIcon size={18} />
          <span className="t">{t("onb.voice.yes")}</span>
          <span className="d">{t("onb.voice.yesDesc")}</span>
        </button>
        <button className={`vato-onb-choice-btn ${!want ? "on" : ""}`} onClick={() => setWant(false)}>
          <ArrowRightIcon size={18} />
          <span className="t">{t("onb.voice.later")}</span>
          <span className="d">{t("onb.voice.laterDesc")}</span>
        </button>
      </div>

      {want && (
        <div className="vato-onb-voice-form">
          <div className={`vato-stt-status ${ready ? "ok" : "warn"}`}>
            <span className="dot" />
            <span className="txt">
              {ready ? t("settings.voice.keyReady") : t("settings.voice.keyMissing")}
            </span>
          </div>

          <div className="vato-menu-label" style={{ marginTop: 12 }}>
            {t("settings.voice.keyH")}
          </div>
          <input
            className="vato-input allow-select"
            type="password"
            placeholder="sk-…"
            spellCheck={false}
            value={stt.openaiKey}
            onChange={(e) => setStt({ openaiKey: e.target.value })}
          />

          <div className="vato-menu-label" style={{ marginTop: 12 }}>
            {t("voice.trigger")}
          </div>
          <div className="vato-seg">
            <button
              className={`vato-seg-btn ${stt.mode === "ptt" ? "on" : ""}`}
              onClick={() => setStt({ mode: "ptt" })}
            >
              {t("voice.modePtt")}
            </button>
            <button
              className={`vato-seg-btn ${stt.mode === "continuous" ? "on" : ""}`}
              onClick={() => setStt({ mode: "continuous" })}
            >
              {t("voice.modeContinuous")}
            </button>
          </div>

          <div className="vato-stt-hint" style={{ marginTop: 12 }}>
            {t("onb.voice.note")}
            {micCombo && <> {t("onb.voice.micTrigger", { keys: humanizeCombo(micCombo) })}</>}
          </div>
        </div>
      )}
    </div>
  );
}

/* --------------------------- Practice step --------------------------- */
const PRACTICE_TASKS = [
  { id: "agent", actionId: "agent.claude", labelKey: "onb.practice.task.agent", Icon: CLIS.claude.Icon, color: CLIS.claude.color },
  { id: "terminal", actionId: "agent.shell", labelKey: "onb.practice.task.terminal", Icon: TerminalTool, color: CLIS.shell.color },
  { id: "browser", actionId: "pane.browser", labelKey: "onb.practice.task.browser", Icon: GlobeIcon },
  { id: "focus", actionId: "view.focus", labelKey: "onb.practice.task.focus", Icon: FocusIcon },
] as const;

/** Map a window's live runtime status to a localized badge (key drives colour). */
function statusBadge(t: TFn, status?: string): { key: string; label: string } {
  switch (status) {
    case "starting":
      return { key: "starting", label: t("onb.practice.st.starting") };
    case "active":
      return { key: "active", label: t("onb.practice.st.active") };
    case "finished":
      return { key: "finished", label: t("onb.practice.st.finished") };
    case "error":
      return { key: "error", label: t("onb.practice.st.error") };
    default:
      return { key: "ready", label: t("onb.practice.st.ready") };
  }
}

/**
 * The final, NON-blocking step: the wizard shrinks to a coach card pinned to the
 * edge while the real canvas stays live behind it. Global shortcuts are switched
 * back on (via `onboardingPractice`) so the user can genuinely trigger each
 * action. This is the "intelligent" step — it watches the store in real time:
 *   • a keystroke echo pulses the row the instant its shortcut fires;
 *   • a task ticks when its real window is actually born;
 *   • the row then shows the window's LIVE runtime status (starting / active /
 *     error), so the user sees not just "it triggered" but "it works".
 */
function PracticeStep({
  t,
  steps,
  step,
  onBack,
  onFinish,
}: {
  t: TFn;
  steps: StepId[];
  step: number;
  onBack: () => void;
  onFinish: () => void;
}) {
  const setOnboardingPractice = useStore((s) => s.setOnboardingPractice);
  useEffect(() => {
    setOnboardingPractice(true);
    return () => setOnboardingPractice(false);
  }, [setOnboardingPractice]);

  const active = useStore((s) => s.workspaces.find((w) => w.id === s.activeId));
  const focusMode = useStore((s) => s.focusMode);
  const shortcuts = useStore((s) => s.settings.shortcuts);

  const wins = active?.windows ?? [];
  const agentWins = wins.filter((w) => w.kind === "terminal" && w.cli !== "shell");
  const shellWins = wins.filter((w) => w.kind === "terminal" && w.cli === "shell");
  const browserWins = wins.filter((w) => w.kind === "browser");

  // Baseline captured once on mount: a task is "done" when a NEW matching window
  // appears (or, for focus, when it first turns on). The freshest window born
  // since then feeds the live runtime badge.
  const base = useRef({ a: agentWins.length, s: shellWins.length, b: browserWins.length });
  const [doneFocus, setDoneFocus] = useState(false);
  useEffect(() => {
    if (focusMode) setDoneFocus(true);
  }, [focusMode]);

  const fresh = {
    agent: agentWins.length > base.current.a ? agentWins[agentWins.length - 1] : null,
    terminal: shellWins.length > base.current.s ? shellWins[shellWins.length - 1] : null,
    browser: browserWins.length > base.current.b ? browserWins[browserWins.length - 1] : null,
  };
  const done: Record<string, boolean> = {
    agent: !!fresh.agent,
    terminal: !!fresh.terminal,
    browser: !!fresh.browser,
    focus: doneFocus,
  };

  // Live keystroke echo: pulse a row the instant its bound shortcut fires (the
  // event timestamp makes the value change on every press, re-arming the timer).
  const [flash, setFlash] = useState<string | null>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const combo = comboFromEvent(e);
      if (!combo) return;
      const tk = PRACTICE_TASKS.find((x) => shortcuts[x.actionId] === combo);
      if (tk) setFlash(`${tk.id}:${e.timeStamp}`);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [shortcuts]);
  useEffect(() => {
    if (!flash) return;
    const id = window.setTimeout(() => setFlash(null), 900);
    return () => window.clearTimeout(id);
  }, [flash]);
  const flashId = flash?.split(":")[0] ?? null;

  const liveBadge = (id: string): { key: string; label: string } | null => {
    if (!done[id]) return null;
    if (id === "focus")
      return focusMode
        ? { key: "active", label: t("onb.practice.st.active") }
        : { key: "ready", label: t("onb.practice.st.ready") };
    if (id === "browser") return { key: "ready", label: t("onb.practice.st.ready") };
    return statusBadge(t, (id === "agent" ? fresh.agent : fresh.terminal)?.status);
  };

  const doneCount = PRACTICE_TASKS.filter((tk) => done[tk.id]).length;
  const allDone = doneCount === PRACTICE_TASKS.length;
  const StepIcon = STEP_ICON.practice;

  return (
    <div className="vato-onb-coach">
      <header className="vato-onb-coach-head">
        <span className="vato-onb-step-ico">
          <StepIcon size={18} />
        </span>
        <div className="vato-onb-head-text">
          <div className="vato-onb-eyebrow">
            {t("onb.eyebrow", { step: step + 1, total: steps.length })}
            <span className="vato-onb-livetag">
              <span className="dot" />
              live
            </span>
          </div>
          <h2>{t("onb.practice.title")}</h2>
        </div>
      </header>
      <p className="vato-onb-coach-sub">{t("onb.practice.subtitle")}</p>

      <div className="vato-onb-checklist">
        {PRACTICE_TASKS.map((tk) => {
          const Icon = tk.Icon;
          const ok = done[tk.id];
          const combo = shortcuts[tk.actionId];
          const badge = liveBadge(tk.id);
          return (
            <div
              key={tk.id}
              className={`vato-onb-check ${ok ? "done" : ""} ${flashId === tk.id ? "flash" : ""}`}
            >
              <span className="box" style={!ok && "color" in tk ? { color: tk.color } : undefined}>
                {ok ? <CheckMark /> : <Icon size={15} />}
              </span>
              <span className="lbl">{t(tk.labelKey)}</span>
              {badge ? (
                <span className={`vato-onb-live ${badge.key}`}>{badge.label}</span>
              ) : (
                combo && <span className="vato-onb-key">{humanizeCombo(combo)}</span>
              )}
            </div>
          );
        })}
      </div>

      <div className={`vato-onb-coach-status ${allDone ? "done" : ""}`}>
        {allDone ? t("onb.practice.allDone") : t("onb.practice.hint")}
      </div>

      <footer className="vato-onb-coach-foot">
        <span className="prog">
          {doneCount} / {PRACTICE_TASKS.length}
        </span>
        <button className="vato-resume-btn" onClick={onBack}>
          <ArrowLeftIcon size={15} /> {t("onb.back")}
        </button>
        <button className={`vato-resume-btn primary ${allDone ? "glow" : ""}`} onClick={onFinish}>
          {t("onb.finish")}
        </button>
      </footer>
    </div>
  );
}

/* ------------------------------ Wizard ------------------------------- */
export function Onboarding() {
  const t = useT();
  const workspaces = useStore((s) => s.workspaces);
  const activeId = useStore((s) => s.activeId);
  const addWorkspace = useStore((s) => s.addWorkspace);
  const completeOnboarding = useStore((s) => s.completeOnboarding);

  // Decide the step list ONCE on mount: the folder step is only needed on a
  // truly first run (no workspace). Replaying from Settings keeps the cwd.
  const [includeFolder] = useState(() => useStore.getState().workspaces.length === 0);
  const steps = useMemo<StepId[]>(
    () => [
      "language",
      ...(includeFolder ? (["folder"] as StepId[]) : []),
      "background",
      "shortcuts",
      "voice",
      "tips",
      "practice",
    ],
    [includeFolder],
  );

  const [step, setStep] = useState(0);
  const [path, setPath] = useState("");
  const [, setListing] = useState<DirListing | null>(null);
  const [wantVoice, setWantVoice] = useState(() => !!useStore.getState().settings.stt.openaiKey.trim());

  const current = steps[step];
  const StepIcon = STEP_ICON[current];
  const active = workspaces.find((w) => w.id === activeId);

  const primaryDisabled = current === "folder" && !path;

  const handlePrimary = () => {
    if (current === "folder") {
      if (!path) return;
      addWorkspace({ cwd: path, name: baseName(path) ?? "workspace" });
    }
    // "practice" is always the final step and is handled by its own coach, so a
    // modal step never completes here — it only advances.
    setStep((s) => s + 1);
  };

  // Final step: hand off to the non-blocking practice coach over the live canvas.
  if (current === "practice") {
    return (
      <PracticeStep
        t={t}
        steps={steps}
        step={step}
        onBack={() => setStep((s) => s - 1)}
        onFinish={() => completeOnboarding()}
      />
    );
  }

  return (
    <div className="vato-onb-root">
      {/* Live preview of the chosen wallpaper, behind a readability scrim. */}
      {active && <BackgroundLayer bg={active.background} />}
      <div className="vato-onb-scrim" />

      <div className="vato-onb-card">
        <header className="vato-onb-head">
          <span className="vato-onb-step-ico">
            <StepIcon size={20} />
          </span>
          <div className="vato-onb-head-text">
            <div className="vato-onb-eyebrow">
              {t("onb.eyebrow", { step: step + 1, total: steps.length })}
            </div>
            <h2>{t(`onb.${current}.title`)}</h2>
            <p>{t(`onb.${current}.subtitle`)}</p>
          </div>
        </header>

        <div className="vato-onb-body">
          {current === "language" && <LanguageStep />}

          {current === "folder" && (
            <>
              <FolderPicker
                initialCwd={active?.cwd}
                onChange={(p, l) => {
                  setPath(p);
                  setListing(l);
                }}
              />
              <div className="vato-onb-folder-target">
                <span className="lbl">{t("onb.workspaceLabel")}</span>
                <code>{path ? baseName(path) : "—"}</code>
                {path && <span className="meta">{path}</span>}
              </div>
            </>
          )}

          {current === "background" && <BackgroundStep t={t} />}

          {current === "shortcuts" && (
            <div className="vato-onb-scroll">
              <RebindRow actionId="agent.claude" hintKey="onb.hint.claude" />
              <RebindRow actionId="view.focus" hintKey="onb.hint.focus" />
              <RebindRow actionId="pane.browser" hintKey="onb.hint.browser" />
              <RebindRow actionId="workspace.new" hintKey="onb.hint.newws" />
              <RebindRow actionId="settings.open" hintKey="onb.hint.settings" />
            </div>
          )}

          {current === "voice" && <VoiceStep t={t} want={wantVoice} setWant={setWantVoice} />}

          {current === "tips" && (
            <div className="vato-onb-scroll">
              <div className="vato-onb-tips">
                <TipCard Icon={CLIS.claude.Icon} color={CLIS.claude.color} labelKey="action.agent.claude" actionId="agent.claude" />
                <TipCard Icon={CLIS.codex.Icon} color={CLIS.codex.color} labelKey="action.agent.codex" actionId="agent.codex" />
                <TipCard Icon={CLIS.cursor.Icon} color={CLIS.cursor.color} labelKey="action.agent.cursor" actionId="agent.cursor" />
                <TipCard Icon={TerminalTool} color={CLIS.shell.color} labelKey="action.agent.shell" actionId="agent.shell" />
                <TipCard Icon={GlobeIcon} labelKey="toolbar.browser" actionId="pane.browser" />
                <TipCard Icon={FocusIcon} labelKey="action.view.focus" actionId="view.focus" />
                <TipCard Icon={PlusIcon} labelKey="action.workspace.new" actionId="workspace.new" />
                <TipCard Icon={ArrowRightIcon} labelKey="action.workspace.next" actionId="workspace.next" />
                <TipCard Icon={GridIcon} labelKey="action.workspace.overview" actionId="workspace.overview" />
                <TipCard Icon={MaximizeIcon} labelKey="action.window.fullscreen" actionId="window.fullscreen" />
                <TipCard Icon={MicIcon} labelKey="action.voice.mic" actionId="voice.mic" />
                <TipCard Icon={SettingsIcon} labelKey="action.settings.open" actionId="settings.open" />
              </div>
              <div className="vato-stt-hint" style={{ marginTop: 10 }}>
                {t("onb.tips.footer")}
              </div>
            </div>
          )}
        </div>

        <footer className="vato-onb-foot">
          <div className="vato-onb-dots">
            {steps.map((sid, i) => (
              <span key={sid} className={`vato-onb-dot ${i === step ? "on" : ""} ${i < step ? "done" : ""}`} />
            ))}
          </div>
          <div className="vato-onb-actions">
            <button className="vato-resume-btn ghost" onClick={() => completeOnboarding()}>
              {t("onb.skip")}
            </button>
            {step > 0 && (
              <button className="vato-resume-btn" onClick={() => setStep((s) => s - 1)}>
                <ArrowLeftIcon size={15} /> {t("onb.back")}
              </button>
            )}
            <button className="vato-resume-btn primary" disabled={primaryDisabled} onClick={handlePrimary}>
              {t("onb.continue")}
              <ArrowRightIcon size={15} />
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
