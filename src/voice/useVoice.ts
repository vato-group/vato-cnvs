// Voice capture orchestration: mic -> WAV segments -> OpenAI STT -> text.
// The caller decides what to do with the text (fill the bar, inject a terminal,
// or hand it to the spoken-command interpreter).
import { useCallback, useEffect, useRef, useState } from "react";
import { useStore } from "../store";
import { ptyIsAlive, ptyWrite, encodeUtf8 } from "../pty";
import { VoiceRecorder, listMicDevices, primeMicPermission, type MicDevice } from "./audio";
import { sttTranscribeOpenAI } from "./stt";

export type VoiceStatus = "idle" | "recording" | "transcribing" | "error";

/** Type `text` into a terminal's PTY (optionally pressing Enter). */
export async function injectToTerminal(id: string, text: string, submit = false): Promise<void> {
  const alive = await ptyIsAlive(id).catch(() => false);
  if (!alive) throw new Error("Terminal cible inactif (démarrez-le d'abord)");
  await ptyWrite(id, encodeUtf8(submit ? `${text}\r` : text));
}

export interface UseVoice {
  status: VoiceStatus;
  active: boolean;
  level: number;
  error: string | null;
  setError: (e: string | null) => void;
  /** True once an OpenAI key is set (the only thing the cloud engine needs). */
  ready: boolean;
  start: () => Promise<void>;
  stop: () => void;
  /** Available audio-input devices (labels populate after first mic grant). */
  devices: MicDevice[];
  /** Re-enumerate mics; pass `prompt` to request permission so labels appear. */
  refreshDevices: (prompt?: boolean) => Promise<void>;
}

export function useVoice(onText: (text: string) => void): UseVoice {
  const stt = useStore((s) => s.settings.stt);

  const [status, setStatus] = useState<VoiceStatus>("idle");
  const [active, setActive] = useState(false);
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [devices, setDevices] = useState<MicDevice[]>([]);

  const recorderRef = useRef<VoiceRecorder | null>(null);
  const queueRef = useRef<Promise<void>>(Promise.resolve());
  const onTextRef = useRef(onText);
  onTextRef.current = onText;
  const sttRef = useRef(stt);
  sttRef.current = stt;

  const ready = !!stt.openaiKey.trim();

  // Keep the device list fresh: enumerate on mount and whenever hardware is
  // plugged/unplugged. Labels stay blank until a mic grant has happened.
  const refreshDevices = useCallback(async (prompt = false) => {
    if (prompt) await primeMicPermission();
    setDevices(await listMicDevices());
  }, []);

  useEffect(() => {
    void refreshDevices();
    const md = navigator.mediaDevices;
    if (!md?.addEventListener) return;
    const onChange = () => void refreshDevices();
    md.addEventListener("devicechange", onChange);
    return () => md.removeEventListener("devicechange", onChange);
  }, [refreshDevices]);

  // Serialize transcriptions so overlapping segments don't pile onto the network.
  const transcribeSegment = useCallback((wavBase64: string) => {
    const cur = sttRef.current;
    setStatus("transcribing");
    queueRef.current = queueRef.current.then(async () => {
      try {
        console.log(`[voice] transcribe start (openai, lang ${cur.lang}, wav b64 ${wavBase64.length})`);
        const text = await sttTranscribeOpenAI({
          apiKey: cur.openaiKey,
          model: cur.openaiModel,
          lang: cur.lang,
          wavBase64,
        });
        console.log("[voice] transcribe result:", JSON.stringify(text));
        const clean = text.trim();
        if (clean) onTextRef.current(clean);
        else setError("Transcription vide — réessayez en parlant plus fort / plus longtemps.");
        setStatus(recorderRef.current ? "recording" : "idle");
      } catch (e) {
        console.error("[voice] transcribe error:", e);
        setError(String(e));
        setStatus("error");
      }
    });
  }, []);

  const stop = useCallback(() => {
    const rec = recorderRef.current;
    recorderRef.current = null;
    setActive(false);
    setLevel(0);
    rec?.stop(); // ptt: flushes the accumulated audio as one segment
    setStatus((s) => (s === "transcribing" ? s : "idle"));
  }, []);

  const start = useCallback(async () => {
    if (recorderRef.current) return;
    setError(null);
    const rec = new VoiceRecorder({
      mode: sttRef.current.mode,
      deviceId: sttRef.current.micDeviceId || undefined,
      onSegment: transcribeSegment,
      onLevel: setLevel,
      speechThreshold: sttRef.current.vadThreshold || undefined,
      onError: (m) => {
        setError(m);
        setStatus("error");
        setActive(false);
        setLevel(0);
        recorderRef.current = null;
      },
    });
    recorderRef.current = rec;
    setActive(true);
    setStatus("recording");
    await rec.start();
    // The grant during start() unlocks device labels — refresh the picker.
    void refreshDevices();
  }, [transcribeSegment, refreshDevices]);

  // Stop capturing if the component using the hook unmounts.
  useEffect(() => () => stop(), [stop]);

  return { status, active, level, error, setError, ready, start, stop, devices, refreshDevices };
}
