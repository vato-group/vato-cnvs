// Spoken replies. Two backends:
//   - "browser": the Web Speech API (window.speechSynthesis) — free, offline,
//     uses the OS voices. This is the default.
//   - "openai":  OpenAI cloud TTS — higher quality, needs the key, billed.
import { useStore } from "../store";
import { openaiTTS } from "./stt";
import { getLang } from "../i18n";

const TTS_MODEL = "gpt-4o-mini-tts";

/* ----------------------------- browser engine ---------------------------- */
// Map the app's UI language to a BCP-47 prefix so "auto" voice selection can
// prefer a voice in the user's language.
const LANG_PREFIX: Record<string, string> = { fr: "fr", en: "en", nl: "nl" };

const synth = (): SpeechSynthesis | null =>
  typeof window !== "undefined" && "speechSynthesis" in window ? window.speechSynthesis : null;

/** Whether the free browser engine is usable in this runtime. */
export function browserTtsSupported(): boolean {
  return synth() !== null;
}

/**
 * The system voices. The list loads asynchronously on first use, so we wait for
 * the `voiceschanged` event (with a short timeout fallback) before resolving.
 */
export function getBrowserVoices(): Promise<SpeechSynthesisVoice[]> {
  const s = synth();
  if (!s) return Promise.resolve([]);
  const now = s.getVoices();
  if (now.length) return Promise.resolve(now);
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve(s.getVoices());
    };
    s.addEventListener("voiceschanged", finish, { once: true });
    // Some engines never fire the event if voices are already cached late.
    window.setTimeout(finish, 1000);
  });
}

/** Pick the voice to speak with: the chosen `voiceURI`, else the best one for `lang`. */
function pickVoice(voices: SpeechSynthesisVoice[], voiceURI: string, lang: string): SpeechSynthesisVoice | null {
  if (voiceURI) {
    const exact = voices.find((v) => v.voiceURI === voiceURI);
    if (exact) return exact;
  }
  const prefix = LANG_PREFIX[lang] ?? lang;
  return (
    voices.find((v) => v.lang?.toLowerCase().startsWith(prefix) && v.default) ??
    voices.find((v) => v.lang?.toLowerCase().startsWith(prefix)) ??
    voices.find((v) => v.default) ??
    voices[0] ??
    null
  );
}

/** Speak `text` with the free browser engine. `voiceURI`/`lang` steer voice choice. */
export async function speakBrowser(text: string, voiceURI = "", lang = getLang()): Promise<void> {
  const s = synth();
  const clean = (text ?? "").trim();
  if (!s || !clean) return;
  const voices = await getBrowserVoices();
  const voice = pickVoice(voices, voiceURI, lang);
  s.cancel(); // stop whatever is currently speaking
  const u = new SpeechSynthesisUtterance(clean.slice(0, 1200));
  if (voice) {
    u.voice = voice;
    u.lang = voice.lang;
  }
  s.speak(u);
}

/* ------------------------------ entry point ------------------------------ */
let current: HTMLAudioElement | null = null;

/** Speak `text` aloud if TTS is enabled. Best-effort — failures are swallowed. */
export async function speak(text: string): Promise<void> {
  const stt = useStore.getState().settings.stt;
  const clean = (text ?? "").trim();
  if (!stt.tts || !clean) return;

  // Free, offline, no key — the default.
  if (stt.ttsEngine !== "openai") {
    try {
      await speakBrowser(clean, stt.ttsBrowserVoice);
    } catch {
      /* TTS is a nicety; never let it break the command flow. */
    }
    return;
  }

  // OpenAI cloud TTS — needs a key.
  if (!stt.openaiKey.trim()) return;
  try {
    const b64 = await openaiTTS(stt.openaiKey, TTS_MODEL, stt.ttsVoice || "alloy", clean.slice(0, 400));
    current?.pause();
    synth()?.cancel();
    current = new Audio(`data:audio/mp3;base64,${b64}`);
    await current.play().catch(() => {});
  } catch {
    /* TTS is a nicety; never let it break the command flow. */
  }
}

/** Stop any in-progress spoken reply (both engines). */
export function stopSpeaking() {
  current?.pause();
  synth()?.cancel();
}
