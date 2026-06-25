// Optional spoken confirmation of the assistant's reply (OpenAI TTS).
// No-op unless the user enabled `tts` and a key is set.
import { useStore } from "../store";
import { openaiTTS } from "./stt";

const TTS_MODEL = "gpt-4o-mini-tts";
let current: HTMLAudioElement | null = null;

/** Speak `text` aloud if TTS is enabled. Best-effort — failures are swallowed. */
export async function speak(text: string): Promise<void> {
  const stt = useStore.getState().settings.stt;
  const clean = (text ?? "").trim();
  if (!stt.tts || !stt.openaiKey.trim() || !clean) return;
  try {
    const b64 = await openaiTTS(stt.openaiKey, TTS_MODEL, stt.ttsVoice || "alloy", clean.slice(0, 400));
    current?.pause();
    current = new Audio(`data:audio/mp3;base64,${b64}`);
    await current.play().catch(() => {});
  } catch {
    /* TTS is a nicety; never let it break the command flow. */
  }
}
