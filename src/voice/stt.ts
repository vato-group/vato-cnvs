// Typed wrappers around the OpenAI-backed Rust commands.
// (Transcription + the chat/completions proxy used by the command interpreter.)
import { invoke } from "@tauri-apps/api/core";

export interface OpenAiReq {
  apiKey: string;
  model: string;
  lang?: string;
  wavBase64: string;
}

/** Cloud transcription via OpenAI (done in Rust to avoid CORS + keep the key out of JS bundles). */
export const sttTranscribeOpenAI = (req: OpenAiReq) =>
  invoke<string>("stt_transcribe_openai", {
    args: {
      api_key: req.apiKey,
      model: req.model,
      lang: req.lang || null,
      wav_base64: req.wavBase64,
    },
  });

/**
 * Raw `POST /v1/chat/completions` proxy. `body` is the full request (model,
 * messages, tools…). Returns the response JSON as a string — the caller (the
 * voice-command interpreter) parses `tool_calls` and runs the loop.
 */
export const openaiChat = (apiKey: string, body: unknown): Promise<string> =>
  invoke<string>("openai_chat", { args: { api_key: apiKey, body } });

/** Text-to-speech via OpenAI → base64 MP3 bytes (played by the caller). */
export const openaiTTS = (apiKey: string, model: string, voice: string, input: string): Promise<string> =>
  invoke<string>("openai_tts", { args: { api_key: apiKey, model, voice, input } });

/** Ping OpenAI with a tiny chat request to check the key is valid/funded. */
export async function validateKey(apiKey: string, model: string): Promise<{ ok: boolean; error?: string }> {
  const key = apiKey.trim();
  if (!key) return { ok: false, error: "Aucune clé" };
  try {
    const raw = await openaiChat(key, {
      model: model || "gpt-4o-mini",
      messages: [{ role: "user", content: "ping" }],
    });
    const data = JSON.parse(raw);
    if (data?.error) return { ok: false, error: data.error?.message ?? "erreur" };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}
