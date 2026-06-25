import { useCallback, useEffect, useRef, useState } from "react";
import { useStore } from "../store";
import type { VoiceMode } from "../types";
import { useVoice } from "../voice/useVoice";
import { runVoiceCommand } from "../voice/commands";
import { speak } from "../voice/speak";
import { stripWakeWord } from "../voice/wake";
import { bus } from "../lib/bus";
import { humanizeCombo } from "../canvas/shortcuts";
import { useT } from "../i18n";
import { Dropdown } from "./Dropdown";
import { MicIcon, SendIcon, SettingsIcon } from "./icons";

export function VoiceBar() {
  const t = useT();
  const stt = useStore((s) => s.settings.stt);
  const setStt = useStore((s) => s.setStt);
  const openSettings = useStore((s) => s.openSettings);
  const micCombo = useStore((s) => s.settings.shortcuts["voice.mic"]);

  const MODE_LABEL: Record<VoiceMode, string> = {
    ptt: t("voice.modePtt"),
    continuous: t("voice.modeContinuous"),
  };

  const [text, setText] = useState("");
  // Voice-command interpreter state.
  const [cmdBusy, setCmdBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  // The recognized phrase + the actions actually executed (feedback / debugging).
  const [heard, setHeard] = useState<string | null>(null);
  const [steps, setSteps] = useState<string[]>([]);

  const textRef = useRef(text);
  textRef.current = text;

  // Run a spoken/typed phrase through the command interpreter.
  const runCommand = (phrase: string) => {
    const p = phrase.trim();
    if (!p) return;
    setResult(null);
    setSteps([]);
    setHeard(p);
    setCmdBusy(true);
    voice.setError(null);
    runVoiceCommand(p)
      .then((r) => {
        setSteps(r.steps);
        if (r.error) voice.setError(r.error);
        else {
          const summary = r.summary || t("voice.done");
          setResult(summary);
          void speak(summary); // no-op unless TTS is enabled
        }
      })
      .catch((e) => voice.setError(String(e)))
      .finally(() => setCmdBusy(false));
  };

  // Spoken utterance → command. In continuous mode with a wake word required,
  // only act on utterances that start with it (strip it first); ambient speech
  // without the wake word is ignored. PTT always acts (the hold is the intent).
  const voice = useVoice((segment) => {
    if (stt.mode === "continuous" && stt.requireWakeWord) {
      const cmd = stripWakeWord(segment, stt.wakeWord);
      if (!cmd) return;
      runCommand(cmd);
    } else {
      runCommand(segment);
    }
  });

  // Auto-dismiss the result banner so the bar tucks back away in focus mode.
  useEffect(() => {
    if (!result) return;
    const timer = window.setTimeout(() => setResult(null), 6000);
    return () => window.clearTimeout(timer);
  }, [result]);

  // Fade the recognized transcript shortly after the command settles.
  useEffect(() => {
    if (!heard || cmdBusy) return;
    const timer = window.setTimeout(() => setHeard(null), 6000);
    return () => window.clearTimeout(timer);
  }, [heard, cmdBusy]);

  const send = () => {
    const t = textRef.current.trim();
    if (!t) return;
    runCommand(t);
    setText("");
  };

  const isPtt = stt.mode === "ptt";
  const micActive = voice.active;
  const busy = voice.status === "transcribing" || cmdBusy;
  // The cloud engine needs an OpenAI key. Until then the mic is gated: clicking
  // it jumps to the Vocal settings to paste one.
  const ready = voice.ready;
  const notReady = !ready;

  // Keyboard-shortcut entry point (voice.mic): a simple start/stop toggle in both
  // trigger modes — a key press can't model a "hold", so it acts as a switch.
  const toggleMic = useCallback(() => {
    if (notReady) return openSettings("voice");
    if (voice.active) voice.stop();
    else voice.start();
  }, [notReady, openSettings, voice]);
  const toggleRef = useRef(toggleMic);
  toggleRef.current = toggleMic;
  useEffect(() => bus.on("voice:toggle", () => toggleRef.current()), []);

  const micHandlers = notReady
    ? { onClick: () => openSettings("voice") }
    : isPtt
      ? {
          // Capture the pointer so the whole "hold" is one utterance: without it,
          // the mouse drifting off the button mid-sentence fires pointerleave and
          // cuts the command short. We stop ONLY on release.
          onPointerDown: (e: React.PointerEvent) => {
            e.currentTarget.setPointerCapture?.(e.pointerId);
            voice.start();
          },
          onPointerUp: (e: React.PointerEvent) => {
            e.currentTarget.releasePointerCapture?.(e.pointerId);
            voice.stop();
          },
        }
      : { onClick: () => (micActive ? voice.stop() : voice.start()) };

  const placeholder = notReady
    ? t("voice.placeholderNoKey")
    : cmdBusy
      ? t("voice.placeholderBusy")
      : micActive
        ? t("voice.placeholderListening")
        : t("voice.placeholderIdle");

  // Mic tooltip + its live keyboard shortcut.
  const micKbd = micCombo ? humanizeCombo(micCombo) : "";
  const micBase = notReady
    ? t("voice.micNoKey")
    : isPtt
      ? t("voice.modePtt")
      : micActive
        ? t("voice.micStop")
        : t("voice.modeContinuous");
  const micTitle = micKbd ? `${micBase} · ${micKbd}` : micBase;

  // In zen/focus mode the bar tucks to the bottom edge; force it on-screen while
  // anything voice-related is happening (or there's feedback to read).
  const reveal = micActive || busy || !!result || !!heard || !!voice.error;

  return (
    <div className={`vato-voicebar ${reveal ? "reveal" : ""}`}>
      <button
        className={`vato-voice-mic ${micActive ? "live" : ""} ${busy ? "busy" : ""} ${
          notReady ? "needs-setup" : ""
        }`}
        title={micTitle}
        style={{ ["--lvl" as string]: String(voice.level) } as React.CSSProperties}
        {...micHandlers}
      >
        <MicIcon size={16} />
        {micActive && <span className="vato-voice-ring" />}
      </button>

      <input
        className="vato-voice-input allow-select"
        value={text}
        spellCheck={false}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            send();
          }
        }}
        placeholder={placeholder}
      />

      {text.trim() && (
        <button className="vato-voice-send" title={`${t("voice.send")} · ${t("kbd.enter")}`} onClick={send}>
          <SendIcon size={15} />
        </button>
      )}

      {busy && (
        <span className="vato-voice-tag">{cmdBusy ? t("voice.tagCommand") : t("voice.tagTranscription")}</span>
      )}

      {/* Trigger-mode quick settings */}
      <Dropdown
        align="right"
        direction="up"
        width={248}
        trigger={(open) => (
          <button
            className={`vato-voice-gear ${open ? "on" : ""} ${notReady ? "warn" : ""}`}
            title={t("voice.settings")}
          >
            <SettingsIcon size={15} />
          </button>
        )}
      >
        <div className="vato-menu">
          <div className="vato-menu-label">{t("voice.trigger")}</div>
          <div className="vato-seg">
            {(["ptt", "continuous"] as VoiceMode[]).map((m) => (
              <button
                key={m}
                className={`vato-seg-btn ${stt.mode === m ? "on" : ""}`}
                onClick={() => setStt({ mode: m })}
              >
                {MODE_LABEL[m]}
              </button>
            ))}
          </div>

          <div className="vato-menu-label" style={{ marginTop: 10 }}>
            {t("voice.micDevice")}
          </div>
          <select
            className="vato-input allow-select"
            value={stt.micDeviceId}
            onClick={() => void voice.refreshDevices()}
            onChange={(e) => setStt({ micDeviceId: e.target.value })}
          >
            <option value="">{t("voice.micDefault")}</option>
            {voice.devices.map((d, i) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label || t("voice.micUnnamed", { n: i + 1 })}
              </option>
            ))}
          </select>

          <div className={`vato-voice-engine-state ${ready ? "ok" : "warn"}`}>
            {ready ? t("voice.engineReady") : t("voice.engineNoKey")}
          </div>

          <button className="vato-menu-item" onClick={() => openSettings("voice")}>
            <SettingsIcon size={14} /> {t("voice.fullSettings")}
          </button>
        </div>
      </Dropdown>

      {/* Recognized transcript — shows what the mic actually heard. */}
      {heard && (busy || result || voice.error) && (
        <div className="vato-voice-heard" title={heard}>
          🗣 {heard}
        </div>
      )}

      {result && !voice.error && (
        <div
          className="vato-voice-result"
          onClick={() => setResult(null)}
          title={steps.length ? steps.join(" · ") : t("voice.hide")}
        >
          {result}
        </div>
      )}

      {voice.error && (
        <div className="vato-voice-error" onClick={() => voice.setError(null)} title={t("voice.hide")}>
          {voice.error}
        </div>
      )}

      {/* Quick mic switch — surfaced on any mic error so the user can pick a
          working input without digging into settings. */}
      {voice.error && voice.devices.length > 0 && (
        <div className="vato-voice-micswitch" onClick={(e) => e.stopPropagation()}>
          <select
            className="vato-input allow-select"
            value={stt.micDeviceId}
            onClick={() => void voice.refreshDevices()}
            onChange={(e) => {
              setStt({ micDeviceId: e.target.value });
              voice.setError(null);
            }}
          >
            <option value="">{t("voice.micDefault")}</option>
            {voice.devices.map((d, i) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label || t("voice.micUnnamed", { n: i + 1 })}
              </option>
            ))}
          </select>
          <button
            className="vato-mini-btn"
            onClick={() => {
              voice.setError(null);
              void voice.start();
            }}
          >
            {t("voice.micRetry")}
          </button>
        </div>
      )}
    </div>
  );
}
