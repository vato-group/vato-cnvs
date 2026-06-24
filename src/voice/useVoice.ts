// Voice capture orchestration: mic -> WAV segments -> local STT -> text.
// The caller decides what to do with the text (fill the bar, inject a terminal).
import { useCallback, useEffect, useRef, useState } from "react";
import { useStore } from "../store";
import { ptyIsAlive, ptyWrite, encodeUtf8 } from "../pty";
import { VoiceRecorder } from "./audio";
import { sttStatus, sttTranscribe, sttTranscribeOpenAI, type EngineStatus } from "./stt";

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
  engine: EngineStatus | null;
  refreshStatus: () => void;
  start: () => Promise<void>;
  stop: () => void;
}

export function useVoice(onText: (text: string) => void): UseVoice {
  const stt = useStore((s) => s.settings.stt);

  const [status, setStatus] = useState<VoiceStatus>("idle");
  const [active, setActive] = useState(false);
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [engine, setEngine] = useState<EngineStatus | null>(null);

  const recorderRef = useRef<VoiceRecorder | null>(null);
  const queueRef = useRef<Promise<void>>(Promise.resolve());
  const onTextRef = useRef(onText);
  onTextRef.current = onText;
  const sttRef = useRef(stt);
  sttRef.current = stt;

  const binFor = (e: typeof stt) =>
    e.engine === "whisper" ? e.whisperBinary : e.parakeetBinary;
  const modelFor = (e: typeof stt) => (e.engine === "whisper" ? e.whisperModel : "");

  const refreshStatus = useCallback(() => {
    // OpenAI readiness is purely "is a key set" — no backend probe needed.
    if (stt.engine === "openai") {
      const ok = !!stt.openaiKey.trim();
      setEngine({
        engine: "openai",
        binary: null,
        binary_ready: ok,
        model: stt.openaiModel,
        model_ready: true,
        ready: ok,
        note: ok ? null : "Clé API OpenAI manquante",
      });
      return;
    }
    sttStatus(stt.engine, binFor(stt), modelFor(stt))
      .then(setEngine)
      .catch(() => setEngine(null));
  }, [
    stt.engine,
    stt.whisperBinary,
    stt.whisperModel,
    stt.parakeetBinary,
    stt.openaiKey,
    stt.openaiModel,
  ]);

  useEffect(() => {
    refreshStatus();
  }, [refreshStatus]);

  // Serialize transcriptions so overlapping segments don't pile onto the sidecar.
  const transcribeSegment = useCallback((wavBase64: string) => {
    const cur = sttRef.current;
    setStatus("transcribing");
    queueRef.current = queueRef.current.then(async () => {
      try {
        console.log(`[voice] transcribe start (${cur.engine}, lang ${cur.lang}, wav b64 ${wavBase64.length})`);
        const text =
          cur.engine === "openai"
            ? await sttTranscribeOpenAI({
                apiKey: cur.openaiKey,
                model: cur.openaiModel,
                lang: cur.lang,
                wavBase64,
              })
            : await sttTranscribe({
                engine: cur.engine,
                binary: binFor(cur),
                model: modelFor(cur),
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
      onSegment: transcribeSegment,
      onLevel: setLevel,
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
  }, [transcribeSegment]);

  // Stop capturing if the component using the hook unmounts.
  useEffect(() => () => stop(), [stop]);

  return { status, active, level, error, setError, engine, refreshStatus, start, stop };
}
