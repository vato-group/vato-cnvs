import { useEffect, useState, type ReactNode } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { useStore } from "../store";
import { CLIS, CLI_ORDER, buildCliArgs } from "../data/clis";
import { BG_IMAGES, BG_PRESETS, BG_VIDEOS, type BgTemplate } from "../data/backgrounds";
import { ACTION_DEFS, comboFromEvent, humanizeCombo } from "../canvas/shortcuts";
import { LANGS as APP_LANGS, useT } from "../i18n";
import type { Background, Workspace } from "../types";
import { homeDir } from "../pty";
import { validateKey } from "../voice/stt";
import { browserTtsSupported, getBrowserVoices, speak, speakBrowser } from "../voice/speak";
import { listMicDevices, primeMicPermission, type MicDevice } from "../voice/audio";
import { TerminalTool } from "./toolIcons";
import {
  CloseIcon,
  FolderIcon,
  GlobeIcon,
  InfoIcon,
  KeyboardIcon,
  MicIcon,
  PaletteIcon,
  PlusIcon,
  TrashIcon,
} from "./icons";

// Sidebar sections. Labels are looked up at render via `settings.sec.<id>` so
// the panel follows the app language.
const SECTIONS = [
  { id: "agents", Icon: TerminalTool },
  { id: "voice", Icon: MicIcon },
  { id: "language", Icon: GlobeIcon },
  { id: "shortcuts", Icon: KeyboardIcon },
  { id: "appearance", Icon: PaletteIcon },
  { id: "workspaces", Icon: FolderIcon },
  { id: "about", Icon: InfoIcon },
];

/* ----------------------------- Agents ----------------------------- */
function AgentsSection() {
  const t = useT();
  const settings = useStore((s) => s.settings);
  const setCliPreset = useStore((s) => s.setCliPreset);
  const setCliExtraArgs = useStore((s) => s.setCliExtraArgs);

  return (
    <>
      <div className="vato-set-h">{t("settings.agents.launchCmd")}</div>
      {CLI_ORDER.map((id) => {
        const def = CLIS[id];
        const cfg = settings.cli[id];
        const preview = `${def.program} ${buildCliArgs(def, cfg).join(" ")}`.trim();
        return (
          <div key={id} className="vato-set-cli">
            <div className="vato-set-cli-head">
              <span style={{ color: def.color, display: "flex" }}>
                <def.Icon size={17} />
              </span>
              <span className="name">{def.label}</span>
            </div>
            {def.presets && def.presets.length > 0 && (
              <div className="vato-set-presets">
                {def.presets.map((p) => {
                  const on = !!cfg?.presets?.[p.id];
                  return (
                    <button
                      key={p.id}
                      className={`vato-chip ${on ? "on" : ""}`}
                      title={p.flag}
                      onClick={() => setCliPreset(id, p.id, !on)}
                    >
                      {p.label}
                    </button>
                  );
                })}
              </div>
            )}
            <input
              className="vato-input allow-select"
              placeholder={t("settings.agents.extraArgs")}
              spellCheck={false}
              value={cfg?.extraArgs ?? ""}
              onChange={(e) => setCliExtraArgs(id, e.target.value)}
            />
            <code className="vato-set-preview">{preview}</code>
          </div>
        );
      })}
    </>
  );
}

/* ----------------------------- Voice ------------------------------ */
// Dictation/transcription language codes -> i18n key (distinct from the
// 3-language UI `LANGS`).
const DICTATION_LANGS: [string, string][] = [
  ["auto", "stt.auto"],
  ["fr", "lang.fr"],
  ["en", "lang.en"],
  ["es", "lang.es"],
  ["de", "lang.de"],
  ["it", "lang.it"],
  ["pt", "lang.pt"],
  ["nl", "lang.nl"],
  ["ja", "lang.ja"],
  ["zh", "lang.zh"],
];

const TTS_VOICES = ["alloy", "echo", "fable", "onyx", "nova", "shimmer", "coral", "sage"];

function VoiceSection() {
  const t = useT();
  const stt = useStore((s) => s.settings.stt);
  const setStt = useStore((s) => s.setStt);
  const ready = !!stt.openaiKey.trim();
  const [test, setTest] = useState<{ state: "idle" | "testing" | "ok" | "bad"; msg?: string }>({ state: "idle" });
  const [devices, setDevices] = useState<MicDevice[]>([]);
  // System voices for the free browser engine (load asynchronously).
  const [sysVoices, setSysVoices] = useState<SpeechSynthesisVoice[]>([]);
  useEffect(() => {
    let alive = true;
    void getBrowserVoices().then((v) => alive && setSysVoices(v));
    return () => {
      alive = false;
    };
  }, []);

  // Enumerate mics on open and whenever hardware changes. Labels need a prior
  // permission grant; the "Détecter" button forces one.
  useEffect(() => {
    let alive = true;
    const refresh = () => listMicDevices().then((d) => alive && setDevices(d));
    refresh();
    navigator.mediaDevices?.addEventListener?.("devicechange", refresh);
    return () => {
      alive = false;
      navigator.mediaDevices?.removeEventListener?.("devicechange", refresh);
    };
  }, []);

  const detectMics = async () => {
    await primeMicPermission();
    setDevices(await listMicDevices());
  };

  const runTest = () => {
    setTest({ state: "testing" });
    validateKey(stt.openaiKey, stt.commandModel).then((r) =>
      setTest(r.ok ? { state: "ok" } : { state: "bad", msg: r.error }),
    );
  };

  const statusText =
    test.state === "testing"
      ? t("settings.voice.testing")
      : test.state === "ok"
        ? t("settings.voice.keyValid")
        : test.state === "bad"
          ? t("settings.voice.keyInvalid", { msg: test.msg ?? "" })
          : ready
            ? t("settings.voice.keyReady")
            : t("settings.voice.keyMissing");
  const statusOk = test.state === "ok" || (test.state === "idle" && ready);

  return (
    <>
      <div className="vato-set-h">{t("settings.voice.h")}</div>
      <div className="vato-stt-hint" style={{ marginTop: 2 }}>
        {t("settings.voice.cloudHint")}
      </div>

      <div className={`vato-stt-status ${statusOk ? "ok" : "warn"}`} style={{ marginTop: 14 }}>
        <span className="dot" />
        <span className="txt">{statusText}</span>
        <button
          className="vato-mini-btn"
          style={{ flex: "0 0 auto" }}
          onClick={runTest}
          disabled={test.state === "testing" || !ready}
        >
          {t("settings.voice.test")}
        </button>
      </div>

      <div className="vato-stt-hint" style={{ marginTop: 6 }}>
        {t("settings.voice.pilotHint")}
      </div>

      {/* ---- Microphone device ---- */}
      <div className="vato-menu-label" style={{ marginTop: 16 }}>
        {t("settings.voice.micDevice")}
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <select
          className="vato-input allow-select"
          style={{ flex: 1 }}
          value={stt.micDeviceId}
          onChange={(e) => setStt({ micDeviceId: e.target.value })}
        >
          <option value="">{t("voice.micDefault")}</option>
          {devices.map((d, i) => (
            <option key={d.deviceId} value={d.deviceId}>
              {d.label || t("voice.micUnnamed", { n: i + 1 })}
            </option>
          ))}
        </select>
        <button className="vato-mini-btn" style={{ flex: "0 0 auto" }} onClick={detectMics}>
          {t("settings.voice.micDetect")}
        </button>
      </div>
      <div className="vato-stt-hint" style={{ marginTop: 6 }}>
        {t("settings.voice.micDeviceHint")}
      </div>

      {/* ---- Trigger mode ---- */}
      <div className="vato-menu-label" style={{ marginTop: 16 }}>
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

      {/* ---- Continuous-only: wake word + mic sensitivity ---- */}
      {stt.mode === "continuous" && (
        <>
          <button
            className={`vato-menu-item toggle ${stt.requireWakeWord ? "on" : ""}`}
            style={{ marginTop: 8 }}
            onClick={() => setStt({ requireWakeWord: !stt.requireWakeWord })}
          >
            <span className={`vato-tick ${stt.requireWakeWord ? "on" : ""}`} />
            {t("settings.voice.wakeToggle")}
          </button>
          {stt.requireWakeWord && (
            <input
              className="vato-input allow-select"
              placeholder={t("settings.voice.wakePlaceholder")}
              spellCheck={false}
              value={stt.wakeWord}
              onChange={(e) => setStt({ wakeWord: e.target.value })}
              style={{ marginTop: 8 }}
            />
          )}
          <div className="vato-menu-label" style={{ marginTop: 12 }}>
            {t("settings.voice.micSensitivity", { threshold: stt.vadThreshold.toFixed(3) })}
          </div>
          <input
            type="range"
            min={0.005}
            max={0.04}
            step={0.001}
            value={stt.vadThreshold}
            onChange={(e) => setStt({ vadThreshold: parseFloat(e.target.value) })}
            style={{ width: "100%" }}
          />
        </>
      )}

      {/* ---- Spoken replies (TTS) ---- */}
      <button
        className={`vato-menu-item toggle ${stt.tts ? "on" : ""}`}
        style={{ marginTop: 12 }}
        onClick={() => setStt({ tts: !stt.tts })}
      >
        <span className={`vato-tick ${stt.tts ? "on" : ""}`} />
        {t("settings.voice.ttsToggle")}
      </button>
      {stt.tts && (
        <>
          {/* Engine: free system voices vs. OpenAI cloud. */}
          <div className="vato-seg" style={{ marginTop: 8 }}>
            <button
              className={`vato-seg-btn ${stt.ttsEngine !== "openai" ? "on" : ""}`}
              disabled={!browserTtsSupported()}
              onClick={() => setStt({ ttsEngine: "browser" })}
            >
              {t("settings.voice.ttsEngineBrowser")}
            </button>
            <button
              className={`vato-seg-btn ${stt.ttsEngine === "openai" ? "on" : ""}`}
              onClick={() => setStt({ ttsEngine: "openai" })}
            >
              {t("settings.voice.ttsEngineOpenai")}
            </button>
          </div>

          {stt.ttsEngine !== "openai" ? (
            <>
              <select
                className="vato-input allow-select"
                style={{ marginTop: 8 }}
                value={stt.ttsBrowserVoice}
                onChange={(e) => setStt({ ttsBrowserVoice: e.target.value })}
              >
                <option value="">{t("settings.voice.ttsVoiceAuto")}</option>
                {sysVoices.map((v) => (
                  <option key={v.voiceURI} value={v.voiceURI}>
                    {v.name} ({v.lang})
                  </option>
                ))}
              </select>
              <div className="vato-stt-hint" style={{ marginTop: 6 }}>
                {t("settings.voice.ttsBrowserHint")}
              </div>
            </>
          ) : (
            <>
              <select
                className="vato-input allow-select"
                style={{ marginTop: 8 }}
                value={stt.ttsVoice}
                onChange={(e) => setStt({ ttsVoice: e.target.value })}
              >
                {TTS_VOICES.map((v) => (
                  <option key={v} value={v}>
                    {t("settings.voice.ttsVoice", { name: v })}
                  </option>
                ))}
              </select>
              <div className="vato-stt-hint" style={{ marginTop: 6 }}>
                {t("settings.voice.ttsOpenaiHint")}
              </div>
            </>
          )}

          <button
            className="vato-mini-btn"
            style={{ marginTop: 8 }}
            onClick={() =>
              stt.ttsEngine === "openai"
                ? void speak(t("settings.voice.ttsSample"))
                : void speakBrowser(t("settings.voice.ttsSample"), stt.ttsBrowserVoice)
            }
          >
            {t("settings.voice.ttsTest")}
          </button>
        </>
      )}

      {/* ---- OpenAI credentials & models ---- */}
      <div className="vato-set-h" style={{ marginTop: 18 }}>
        {t("settings.voice.keyH")}
      </div>
      <input
        className="vato-input allow-select"
        type="password"
        placeholder="sk-…"
        spellCheck={false}
        value={stt.openaiKey}
        onChange={(e) => {
          setTest({ state: "idle" });
          setStt({ openaiKey: e.target.value });
        }}
      />

      <div className="vato-menu-label" style={{ marginTop: 12 }}>
        {t("settings.voice.transcriptionModel")}
      </div>
      <select
        className="vato-input allow-select"
        value={stt.openaiModel}
        onChange={(e) => setStt({ openaiModel: e.target.value })}
      >
        <option value="gpt-4o-mini-transcribe">gpt-4o-mini-transcribe ({t("settings.voice.fast")})</option>
        <option value="gpt-4o-transcribe">gpt-4o-transcribe ({t("settings.voice.maxQuality")})</option>
        <option value="whisper-1">whisper-1</option>
      </select>

      <div className="vato-menu-label" style={{ marginTop: 12 }}>
        {t("settings.voice.commandModel")}
      </div>
      <select
        className="vato-input allow-select"
        value={stt.commandModel}
        onChange={(e) => setStt({ commandModel: e.target.value })}
      >
        <option value="gpt-4o-mini">gpt-4o-mini ({t("settings.voice.fast")})</option>
        <option value="gpt-4o">gpt-4o ({t("settings.voice.maxReasoning")})</option>
        <option value="gpt-4.1-mini">gpt-4.1-mini</option>
        <option value="gpt-4.1">gpt-4.1</option>
      </select>

      <div className="vato-menu-label" style={{ marginTop: 12 }}>
        {t("settings.voice.dictationLang")}
      </div>
      <select
        className="vato-input allow-select"
        value={stt.lang}
        onChange={(e) => setStt({ lang: e.target.value })}
      >
        {DICTATION_LANGS.map(([code, key]) => (
          <option key={code} value={code}>
            {t(key)}
          </option>
        ))}
      </select>

      <div className="vato-stt-hint" style={{ marginTop: 14 }}>
        {t("settings.voice.backendHint")}
      </div>
    </>
  );
}

/* --------------------------- Shortcuts ---------------------------- */
function ShortcutsSection() {
  const t = useT();
  const shortcuts = useStore((s) => s.settings.shortcuts);
  const setShortcut = useStore((s) => s.setShortcut);
  const resetShortcuts = useStore((s) => s.resetShortcuts);
  const [recording, setRecording] = useState<string | null>(null);

  useEffect(() => {
    if (!recording) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") return setRecording(null);
      const combo = comboFromEvent(e);
      if (!combo) return;
      setShortcut(recording, combo);
      setRecording(null);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [recording, setShortcut]);

  const groups = [...new Set(ACTION_DEFS.map((a) => a.group))];

  return (
    <>
      <div className="vato-set-h">
        {t("settings.shortcuts.h")}
        <button className="vato-mini-btn" style={{ flex: "0 0 auto" }} onClick={() => resetShortcuts()}>
          {t("common.reset")}
        </button>
      </div>
      {groups.map((g) => (
        <div key={g} className="vato-set-group">
          <div className="vato-menu-label">{t(`group.${g}`)}</div>
          {ACTION_DEFS.filter((a) => a.group === g).map((a) => (
            <div key={a.id} className="vato-set-row">
              <span className="label">{t(`action.${a.id}`)}</span>
              <button
                className={`vato-kbd ${recording === a.id ? "rec" : ""}`}
                onClick={() => setRecording(a.id)}
                title={t("settings.shortcuts.recordHint")}
              >
                {recording === a.id ? t("settings.shortcuts.press") : humanizeCombo(shortcuts[a.id] ?? "")}
              </button>
            </div>
          ))}
        </div>
      ))}
    </>
  );
}

/* --------------------------- Appearance --------------------------- */
function AppearanceSection() {
  const t = useT();
  const workspaces = useStore((s) => s.workspaces);
  const activeId = useStore((s) => s.activeId);
  const setBackground = useStore((s) => s.setBackground);
  const ws = workspaces.find((w) => w.id === activeId)!;
  const [url, setUrl] = useState(ws.background.kind !== "color" ? ws.background.value : "");
  const dim = ws.background.dim ?? 0;

  const apply = (bg: Background) => setBackground(ws.id, bg);
  const pick = (tpl: BgTemplate) => apply({ kind: tpl.kind, value: tpl.value, dim: tpl.dim });
  const isOn = (tpl: BgTemplate) => ws.background.kind === tpl.kind && ws.background.value === tpl.value;

  return (
    <>
      <div className="vato-set-h">{t("settings.appearance.bgOf", { name: ws.name })}</div>
      <div className="vato-bg-presets" style={{ marginBottom: 12 }}>
        {BG_PRESETS.map((p, i) => (
          <button
            key={i}
            className="vato-bg-swatch"
            style={{ background: p, height: 44 }}
            onClick={() => apply({ kind: "color", value: p, dim })}
          />
        ))}
      </div>

      <div className="vato-menu-label">{t("settings.appearance.wallpapers")}</div>
      <div className="vato-bg-gallery">
        {BG_IMAGES.map((tpl) => (
          <button
            key={tpl.value}
            className={`vato-bg-tile ${isOn(tpl) ? "on" : ""}`}
            title={t(tpl.labelKey)}
            onClick={() => pick(tpl)}
          >
            <img src={tpl.thumb} alt="" loading="lazy" draggable={false} />
            <span className="vato-bg-tile-label">{t(tpl.labelKey)}</span>
          </button>
        ))}
      </div>

      <div className="vato-menu-label" style={{ marginTop: 12 }}>
        {t("settings.appearance.videos")}
      </div>
      <div className="vato-bg-gallery">
        {BG_VIDEOS.map((tpl) => (
          <button
            key={tpl.value}
            className={`vato-bg-tile ${isOn(tpl) ? "on" : ""}`}
            title={t(tpl.labelKey)}
            onClick={() => pick(tpl)}
          >
            <img src={tpl.thumb} alt="" loading="lazy" draggable={false} />
            <span className="vato-bg-tile-badge">▶</span>
            <span className="vato-bg-tile-label">{t(tpl.labelKey)}</span>
          </button>
        ))}
      </div>

      <div className="vato-menu-label" style={{ marginTop: 12 }}>{t("settings.appearance.urlLabel")}</div>
      <input
        className="vato-input allow-select"
        placeholder="https://… (.jpg, .png, .mp4)"
        value={url}
        spellCheck={false}
        onChange={(e) => setUrl(e.target.value)}
      />
      <div className="vato-bg-row">
        <button className="vato-mini-btn" onClick={() => url && apply({ kind: "image", value: url, dim: dim || 0.15 })}>
          {t("settings.appearance.image")}
        </button>
        <button className="vato-mini-btn" onClick={() => url && apply({ kind: "video", value: url, dim: dim || 0.25 })}>
          {t("settings.appearance.video")}
        </button>
        <button className="vato-mini-btn" onClick={() => apply({ ...ws.background, kind: "color", value: BG_PRESETS[0] })}>
          {t("common.reset")}
        </button>
      </div>
      <div className="vato-menu-label" style={{ marginTop: 14 }}>
        {t("settings.appearance.dim", { pct: Math.round(dim * 100) })}
      </div>
      <input
        type="range"
        min={0}
        max={0.7}
        step={0.05}
        value={dim}
        onChange={(e) => apply({ ...ws.background, dim: parseFloat(e.target.value) })}
        style={{ width: "100%" }}
      />
    </>
  );
}

/* --------------------------- Workspaces --------------------------- */
function WorkspaceCard({ ws, active }: { ws: Workspace; active: boolean }) {
  const t = useT();
  const setActive = useStore((s) => s.setActive);
  const renameWorkspace = useStore((s) => s.renameWorkspace);
  const setWorkspaceCwd = useStore((s) => s.setWorkspaceCwd);
  const removeWorkspace = useStore((s) => s.removeWorkspace);
  const canDelete = useStore((s) => s.workspaces.length > 1);

  useEffect(() => {
    if (!ws.cwd) homeDir().then((h) => h && setWorkspaceCwd(ws.id, h));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ws.id]);

  return (
    <div className={`vato-ws-card ${active ? "on" : ""}`}>
      <div className="vato-ws-card-top">
        <input
          className="vato-input"
          value={ws.name}
          onChange={(e) => renameWorkspace(ws.id, e.target.value)}
          style={{ marginBottom: 0 }}
        />
        {active ? (
          <span className="vato-ws-badge">{t("settings.ws.active")}</span>
        ) : (
          <button className="vato-mini-btn" onClick={() => setActive(ws.id)}>
            {t("settings.ws.activate")}
          </button>
        )}
        {canDelete && (
          <button className="vato-tb-btn vato-close" title={t("settings.ws.delete")} onClick={() => removeWorkspace(ws.id)}>
            <TrashIcon size={15} />
          </button>
        )}
      </div>
      <input
        className="vato-input allow-select"
        placeholder={t("settings.ws.cwdPlaceholder")}
        value={ws.cwd ?? ""}
        spellCheck={false}
        onChange={(e) => setWorkspaceCwd(ws.id, e.target.value)}
        style={{ marginBottom: 0, marginTop: 8 }}
      />
      <div className="vato-ws-card-meta">{t("grid.windows", { n: ws.windows.length })}</div>
    </div>
  );
}

function WorkspacesSection() {
  const t = useT();
  const workspaces = useStore((s) => s.workspaces);
  const activeId = useStore((s) => s.activeId);
  const openNewWorkspace = useStore((s) => s.openNewWorkspace);
  const toggleSettings = useStore((s) => s.toggleSettings);

  return (
    <>
      <div className="vato-set-h">
        Workspaces
        <button
          className="vato-mini-btn"
          style={{ flex: "0 0 auto" }}
          onClick={() => {
            toggleSettings(false);
            openNewWorkspace();
          }}
        >
          <PlusIcon size={13} /> {t("common.new")}
        </button>
      </div>
      {workspaces.map((w) => (
        <WorkspaceCard key={w.id} ws={w} active={w.id === activeId} />
      ))}
    </>
  );
}

/* ----------------------------- About ------------------------------ */
function AboutSection() {
  const t = useT();
  const restartOnboarding = useStore((s) => s.restartOnboarding);
  const settingsCombo = useStore((s) => s.settings.shortcuts["settings.open"]);
  // Real app version from tauri.conf.json, fetched at runtime instead of hardcoded.
  const [version, setVersion] = useState("");
  useEffect(() => {
    getVersion().then(setVersion).catch(() => {});
  }, []);
  return (
    <>
      <div className="vato-set-h">{t("settings.sec.about")}</div>
      <div className="vato-about">
        <img className="vato-about-logo" src="/logo.png" alt="Vato Canvas" draggable={false} />
        <div className="vato-about-title">Vato Canvas</div>
        <div className="vato-about-sub">{t("settings.about.tagline")}</div>
        <div className="vato-about-row"><span>{t("settings.about.version")}</span><b>{version || "—"}</b></div>
        <div className="vato-about-row">
          <span>{t("settings.about.settingsShortcut")}</span>
          <b>{settingsCombo ? humanizeCombo(settingsCombo) : "—"}</b>
        </div>
      </div>

      <div className="vato-set-h" style={{ marginTop: 22 }}>{t("settings.about.onboardingH")}</div>
      <div className="vato-stt-hint" style={{ marginTop: 2 }}>{t("settings.about.onboardingHint")}</div>
      <button
        className="vato-resume-btn"
        style={{ marginTop: 12 }}
        onClick={() => restartOnboarding()}
      >
        <InfoIcon size={15} /> {t("settings.about.restartOnboarding")}
      </button>
    </>
  );
}

/* ---------------------------- Language ---------------------------- */
function LanguageSection() {
  const t = useT();
  const lang = useStore((s) => s.settings.lang);
  const setLang = useStore((s) => s.setLang);

  return (
    <>
      <div className="vato-set-h">{t("settings.language.h")}</div>
      <div className="vato-stt-hint" style={{ marginTop: 2 }}>
        {t("settings.language.hint")}
      </div>

      <div className="vato-seg" style={{ marginTop: 14 }}>
        {APP_LANGS.map((l) => (
          <button
            key={l.code}
            className={`vato-seg-btn ${lang === l.code ? "on" : ""}`}
            onClick={() => setLang(l.code)}
          >
            <span style={{ marginRight: 6 }}>{l.flag}</span>
            {l.label}
          </button>
        ))}
      </div>
    </>
  );
}

const CONTENT: Record<string, () => ReactNode> = {
  agents: AgentsSection,
  voice: VoiceSection,
  language: LanguageSection,
  shortcuts: ShortcutsSection,
  appearance: AppearanceSection,
  workspaces: WorkspacesSection,
  about: AboutSection,
};

export function SettingsPanel() {
  const t = useT();
  const toggleSettings = useStore((s) => s.toggleSettings);
  const section = useStore((s) => s.settingsSection);
  const setSection = (id: string) => useStore.setState({ settingsSection: id });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") toggleSettings(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleSettings]);

  const active = SECTIONS.find((s) => s.id === section) ?? SECTIONS[0];
  const Content = CONTENT[active.id] ?? AgentsSection;

  return (
    <div className="vato-settings-overlay" onMouseDown={() => toggleSettings(false)}>
      <div className="vato-settings" onMouseDown={(e) => e.stopPropagation()}>
        <aside className="vato-settings-side">
          <div className="vato-settings-brand">
            <img src="/logo.png" alt="" draggable={false} />
            <span>{t("settings.title")}</span>
          </div>
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              className={`vato-side-item ${s.id === section ? "on" : ""}`}
              onClick={() => setSection(s.id)}
            >
              <s.Icon size={17} />
              <span>{t(`settings.sec.${s.id}`)}</span>
            </button>
          ))}
        </aside>

        <main className="vato-settings-main">
          <div className="vato-settings-head">
            <span>{t(`settings.sec.${active.id}`)}</span>
            <button className="vato-tb-btn" onClick={() => toggleSettings(false)} title={t("settings.closeEsc")}>
              <CloseIcon size={16} />
            </button>
          </div>
          <div className="vato-settings-body">
            <Content />
          </div>
        </main>
      </div>
    </div>
  );
}
