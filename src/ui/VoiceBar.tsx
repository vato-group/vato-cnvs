import { useEffect, useMemo, useRef, useState } from "react";
import { useStore, useActiveWorkspace } from "../store";
import { CLIS } from "../data/clis";
import type { SttEngine, VoiceMode } from "../types";
import { useVoice, injectToTerminal } from "../voice/useVoice";
import { Dropdown } from "./Dropdown";
import { MicIcon, ChevronDownIcon, SendIcon, SettingsIcon } from "./icons";

const ENGINE_LABEL: Record<SttEngine, string> = {
  whisper: "Whisper turbo",
  parakeet: "Parakeet v2",
  openai: "OpenAI cloud",
};
const MODE_LABEL: Record<VoiceMode, string> = {
  ptt: "Maintenir pour parler",
  continuous: "Écoute continue",
};

export function VoiceBar() {
  const stt = useStore((s) => s.settings.stt);
  const setStt = useStore((s) => s.setStt);
  const openSettings = useStore((s) => s.openSettings);
  const lastActive = useStore((s) => s.lastActiveTerminalId);
  const ws = useActiveWorkspace();

  const terminals = useMemo(
    () => ws.windows.filter((w) => w.kind === "terminal"),
    [ws.windows],
  );

  const [targetId, setTargetId] = useState<string | null>(null);
  const [text, setText] = useState("");

  // Keep a valid target: prefer explicit pick, else last-active, else first terminal.
  useEffect(() => {
    const ids = terminals.map((t) => t.id);
    setTargetId((cur) => {
      if (cur && ids.includes(cur)) return cur;
      if (lastActive && ids.includes(lastActive)) return lastActive;
      return ids[0] ?? null;
    });
  }, [terminals, lastActive]);

  const target = terminals.find((t) => t.id === targetId) ?? null;
  const textRef = useRef(text);
  textRef.current = text;

  const voice = useVoice((segment) => {
    if (stt.directInsert && targetId) {
      injectToTerminal(targetId, `${segment} `, false).catch((e) => voice.setError(String(e)));
    } else {
      setText((prev) => (prev ? `${prev} ${segment}` : segment));
    }
  });

  const send = () => {
    const t = textRef.current.trim();
    if (!t || !targetId) return;
    injectToTerminal(targetId, t, true)
      .then(() => setText(""))
      .catch((e) => voice.setError(String(e)));
  };

  const isPtt = stt.mode === "ptt";
  const micActive = voice.active;
  const busy = voice.status === "transcribing";
  // The engine needs a model/binary before it can transcribe. Until then the
  // mic is gated: clicking it jumps to the Vocal settings to install one.
  const ready = !!voice.engine?.ready;
  const notReady = !ready;

  const micHandlers = notReady
    ? { onClick: () => openSettings("voice") }
    : isPtt
      ? {
          onPointerDown: () => voice.start(),
          onPointerUp: () => voice.stop(),
          onPointerLeave: () => micActive && voice.stop(),
        }
      : { onClick: () => (micActive ? voice.stop() : voice.start()) };

  const placeholder = notReady
    ? "Téléchargez d'abord un modèle — cliquez le micro pour ouvrir les réglages"
    : !target
      ? "Ouvrez un terminal pour y dicter…"
      : isPtt
        ? `Maintenez le micro et parlez → ${target.title}`
        : micActive
          ? `À l'écoute… → ${target.title}`
          : `Cliquez le micro pour parler → ${target.title}`;

  return (
    <div className="vato-voicebar">
      <button
        className={`vato-voice-mic ${micActive ? "live" : ""} ${busy ? "busy" : ""} ${
          notReady ? "needs-setup" : ""
        }`}
        title={
          notReady
            ? "Aucun modèle — ouvrir les réglages vocaux"
            : isPtt
              ? "Maintenir pour parler"
              : micActive
                ? "Arrêter l'écoute"
                : "Écoute continue"
        }
        style={{ ["--lvl" as string]: String(voice.level) } as React.CSSProperties}
        {...micHandlers}
      >
        <MicIcon size={16} />
        {micActive && <span className="vato-voice-ring" />}
      </button>

      {/* Target terminal selector */}
      <Dropdown
        align="left"
        direction="up"
        width={220}
        trigger={(open) => (
          <button className={`vato-voice-target ${open ? "on" : ""}`} title="Terminal cible">
            {target ? (
              <>
                {target.cli && (
                  <span style={{ color: CLIS[target.cli].color, display: "flex" }}>
                    {(() => {
                      const Icon = CLIS[target.cli].Icon;
                      return <Icon size={13} />;
                    })()}
                  </span>
                )}
                <span className="nm">{target.title}</span>
              </>
            ) : (
              <span className="nm dim">Aucun terminal</span>
            )}
            <ChevronDownIcon size={12} />
          </button>
        )}
      >
        {(close) => (
          <div className="vato-menu">
            <div className="vato-menu-label">Écrire dans…</div>
            {terminals.length === 0 && <div className="vato-menu-empty">Aucun terminal ouvert</div>}
            {terminals.map((t) => {
              const Icon = t.cli ? CLIS[t.cli].Icon : CLIS.shell.Icon;
              const color = t.cli ? CLIS[t.cli].color : CLIS.shell.color;
              return (
                <button
                  key={t.id}
                  className={`vato-menu-item ${t.id === targetId ? "on" : ""}`}
                  onClick={() => {
                    setTargetId(t.id);
                    close();
                  }}
                >
                  <span style={{ color, display: "flex" }}>
                    <Icon size={14} />
                  </span>
                  {t.title}
                </button>
              );
            })}
          </div>
        )}
      </Dropdown>

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
        <button className="vato-voice-send" title="Envoyer au terminal (Entrée)" onClick={send}>
          <SendIcon size={15} />
        </button>
      )}

      {voice.status === "transcribing" && <span className="vato-voice-tag">Transcription…</span>}

      {/* Engine / mode quick settings */}
      <Dropdown
        align="right"
        direction="up"
        width={248}
        trigger={(open) => (
          <button
            className={`vato-voice-gear ${open ? "on" : ""} ${notReady ? "warn" : ""}`}
            title="Réglages vocaux"
          >
            <SettingsIcon size={15} />
          </button>
        )}
      >
        <div className="vato-menu">
          <div className="vato-menu-label">Moteur</div>
          <div className="vato-seg">
            {(["whisper", "parakeet", "openai"] as SttEngine[]).map((e) => (
              <button
                key={e}
                className={`vato-seg-btn ${stt.engine === e ? "on" : ""}`}
                onClick={() => setStt({ engine: e })}
              >
                {ENGINE_LABEL[e]}
              </button>
            ))}
          </div>

          <div className="vato-menu-label">Déclenchement</div>
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

          <button
            className={`vato-menu-item toggle ${stt.directInsert ? "on" : ""}`}
            onClick={() => setStt({ directInsert: !stt.directInsert })}
          >
            <span className={`vato-tick ${stt.directInsert ? "on" : ""}`} />
            Insertion directe dans le terminal
          </button>

          <div className={`vato-voice-engine-state ${voice.engine?.ready ? "ok" : "warn"}`}>
            {voice.engine?.ready
              ? `${ENGINE_LABEL[stt.engine]} prêt`
              : voice.engine?.note ?? "Vérification du moteur…"}
          </div>

          <button className="vato-menu-item" onClick={() => openSettings("voice")}>
            <SettingsIcon size={14} /> Réglages vocaux complets…
          </button>
        </div>
      </Dropdown>

      {voice.error && (
        <div className="vato-voice-error" onClick={() => voice.setError(null)} title="Masquer">
          {voice.error}
        </div>
      )}
    </div>
  );
}
