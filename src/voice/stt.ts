// Typed wrappers around the Rust STT commands + the download-progress event.
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { SttEngine } from "../types";

export interface SttPaths {
  dir: string;
  models_dir: string;
  whisper_dir: string;
  parakeet_dir: string;
}

export interface EngineStatus {
  engine: string;
  binary: string | null;
  binary_ready: boolean;
  model: string | null;
  model_ready: boolean;
  ready: boolean;
  note: string | null;
}

export interface DownloadProgress {
  url: string;
  received: number;
  total: number;
  done: boolean;
  error: string | null;
}

export const sttPaths = () => invoke<SttPaths>("stt_paths");

export const sttStatus = (engine: SttEngine, binary?: string, model?: string) =>
  invoke<EngineStatus>("stt_status", {
    engine,
    binary: binary || null,
    model: model || null,
  });

export const sttDownload = (url: string, dest: string) =>
  invoke<void>("stt_download", { url, dest });

/** One-click: download + extract the whisper.cpp x64 binary into stt/whisper/. */
export const sttInstallWhisper = () => invoke<void>("stt_install_whisper");

export interface TranscribeReq {
  engine: SttEngine;
  binary?: string;
  model?: string;
  lang?: string;
  wavBase64: string;
}

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

export const sttTranscribe = (req: TranscribeReq) =>
  invoke<string>("stt_transcribe", {
    args: {
      engine: req.engine,
      binary: req.binary || null,
      model: req.model || null,
      lang: req.lang || null,
      wav_base64: req.wavBase64,
    },
  });

export const onDownloadProgress = (
  cb: (p: DownloadProgress) => void,
): Promise<UnlistenFn> => listen<DownloadProgress>("stt://download", (e) => cb(e.payload));

export const onInstallProgress = (
  cb: (p: DownloadProgress) => void,
): Promise<UnlistenFn> => listen<DownloadProgress>("stt://install", (e) => cb(e.payload));
