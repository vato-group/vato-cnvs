// Mic capture -> 16 kHz mono 16-bit PCM WAV (base64), fed to OpenAI transcription.
//
// Two modes:
//   - "ptt"        : accumulate from start() until stop(), then emit one segment.
//   - "continuous" : a simple RMS voice-activity detector cuts the stream into
//                    utterances on silence and emits a segment per utterance.
import type { VoiceMode } from "../types";

const TARGET_RATE = 16000;

/* --------------------------- Device discovery --------------------------- */

export interface MicDevice {
  /** "" for the system default; otherwise the MediaDeviceInfo deviceId. */
  deviceId: string;
  /** Human label — only populated after mic permission was granted once. */
  label: string;
}

/**
 * List available audio-input devices. Labels stay empty until mic permission
 * has been granted at least once (browser privacy rule), so call
 * `primeMicPermission()` first if you need named entries.
 */
export async function listMicDevices(): Promise<MicDevice[]> {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices
      .filter((d) => d.kind === "audioinput")
      // The "default"/"communications" pseudo-devices alias a real one; drop
      // them so the list is the actual hardware (we expose our own default).
      .filter((d) => d.deviceId && d.deviceId !== "default" && d.deviceId !== "communications")
      .map((d) => ({ deviceId: d.deviceId, label: d.label }));
  } catch {
    return [];
  }
}

/** Prompt for mic permission (so device labels populate), then release it. */
export async function primeMicPermission(): Promise<boolean> {
  try {
    const s = await navigator.mediaDevices.getUserMedia({ audio: true });
    s.getTracks().forEach((t) => t.stop());
    return true;
  } catch {
    return false;
  }
}

/** Turn a getUserMedia failure into a short, actionable French message. */
function micErrorMessage(e: unknown): string {
  const name = e instanceof Error ? e.name : "";
  switch (name) {
    case "NotAllowedError":
    case "SecurityError":
      return "Accès micro refusé. Autorisez le microphone pour l'application.";
    case "NotFoundError":
    case "OverconstrainedError":
      return "Aucun micro trouvé. Branchez un micro ou choisissez-en un autre dans les réglages vocaux.";
    case "NotReadableError":
      return "Micro occupé ou inaccessible (déjà utilisé par une autre application ?). Choisissez un autre micro.";
    default:
      return `Micro indisponible : ${String(e)}`;
  }
}

/* ----------------------------- WAV encoding ----------------------------- */

function resample(input: Float32Array, from: number, to: number): Float32Array {
  if (from === to) return input;
  const ratio = from / to;
  const outLen = Math.floor(input.length / ratio);
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const src = i * ratio;
    const i0 = Math.floor(src);
    const i1 = Math.min(i0 + 1, input.length - 1);
    const frac = src - i0;
    out[i] = input[i0] * (1 - frac) + input[i1] * frac;
  }
  return out;
}

function bytesToBase64(bytes: Uint8Array): string {
  let s = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    s += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(s);
}

const writeStr = (v: DataView, off: number, str: string) => {
  for (let i = 0; i < str.length; i++) v.setUint8(off + i, str.charCodeAt(i));
};

/** Encode mono Float32 [-1,1] samples at `rate` Hz into a base64 16 kHz WAV. */
export function encodeWavBase64(samples: Float32Array, rate: number): string {
  const pcm = resample(samples, rate, TARGET_RATE);
  const buffer = new ArrayBuffer(44 + pcm.length * 2);
  const view = new DataView(buffer);
  writeStr(view, 0, "RIFF");
  view.setUint32(4, 36 + pcm.length * 2, true);
  writeStr(view, 8, "WAVE");
  writeStr(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, TARGET_RATE, true);
  view.setUint32(28, TARGET_RATE * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits/sample
  writeStr(view, 36, "data");
  view.setUint32(40, pcm.length * 2, true);
  let off = 44;
  for (let i = 0; i < pcm.length; i++) {
    const s = Math.max(-1, Math.min(1, pcm[i]));
    view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    off += 2;
  }
  return bytesToBase64(new Uint8Array(buffer));
}

function concat(chunks: Float32Array[]): Float32Array {
  const len = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Float32Array(len);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

/* ------------------------------- Recorder ------------------------------- */

export interface RecorderOpts {
  mode: VoiceMode;
  /** Emitted once on stop() (ptt) or per detected utterance (continuous). */
  onSegment: (wavBase64: string) => void;
  /** 0..1 input level, for the UI meter. */
  onLevel?: (rms: number) => void;
  onError?: (msg: string) => void;
  /** Override the continuous-VAD speech threshold (RMS). Lower = more sensitive. */
  speechThreshold?: number;
  /** Pin capture to a specific input device; "" / undefined = system default. */
  deviceId?: string;
}

// Continuous-mode VAD tuning.
const SPEECH_RMS = 0.014; // default; above this = voice (overridable per recorder)
// End-of-TURN silence: a whole spoken command (with natural mid-sentence pauses)
// must stay ONE utterance, so we only cut after a long gap — otherwise a pause
// like "…à echo, <pause> et lui demander…" fires "part 1" as a command on its
// own. PTT stays the zero-latency option (one segment on release).
const SILENCE_MS = 1400; // trailing silence that ends an utterance
const MIN_SPEECH_MS = 250; // ignore blips shorter than this
const PREROLL_MS = 200; // keep audio just before speech onset

export class VoiceRecorder {
  private opts: RecorderOpts;
  private stream: MediaStream | null = null;
  private ctx: AudioContext | null = null;
  private node: ScriptProcessorNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private rate = TARGET_RATE;
  private stopped = false;

  // ptt: everything; continuous: current utterance.
  private buf: Float32Array[] = [];
  // continuous-mode state
  private speaking = false;
  private silenceRun = 0;
  private speechRun = 0;
  private preroll: Float32Array[] = [];
  private prerollSamples = 0;

  constructor(opts: RecorderOpts) {
    this.opts = opts;
  }

  private openStream(deviceId: string | undefined): Promise<MediaStream> {
    const audio: MediaTrackConstraints = {
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    };
    if (deviceId) audio.deviceId = { exact: deviceId };
    return navigator.mediaDevices.getUserMedia({ audio });
  }

  async start(): Promise<void> {
    this.stopped = false;
    let stream: MediaStream;
    try {
      stream = await this.openStream(this.opts.deviceId || undefined);
    } catch (e) {
      // A pinned device that's gone/unavailable: fall back to the default mic
      // rather than failing outright, so voice keeps working after unplugging.
      const recoverable =
        this.opts.deviceId &&
        e instanceof Error &&
        (e.name === "OverconstrainedError" || e.name === "NotFoundError" || e.name === "NotReadableError");
      if (recoverable) {
        try {
          stream = await this.openStream(undefined);
        } catch (e2) {
          this.opts.onError?.(micErrorMessage(e2));
          return;
        }
      } else {
        this.opts.onError?.(micErrorMessage(e));
        return;
      }
    }

    // stop() may have been called during the permission await (fast ptt tap).
    if (this.stopped) {
      stream.getTracks().forEach((t) => t.stop());
      return;
    }
    this.stream = stream;

    this.ctx = new AudioContext();
    this.rate = this.ctx.sampleRate;
    this.source = this.ctx.createMediaStreamSource(this.stream);
    this.node = this.ctx.createScriptProcessor(4096, 1, 1);
    this.reset();

    this.node.onaudioprocess = (ev) => this.onChunk(ev.inputBuffer.getChannelData(0));
    this.source.connect(this.node);
    // ScriptProcessor only fires while connected to the graph; route to a muted gain.
    const sink = this.ctx.createGain();
    sink.gain.value = 0;
    this.node.connect(sink);
    sink.connect(this.ctx.destination);

    // Chromium/WebView2 starts the context "suspended"; without resume the
    // ScriptProcessor never fires and we'd record pure silence (empty buffer).
    if (this.ctx.state !== "running") {
      try {
        await this.ctx.resume();
      } catch {
        /* noop */
      }
    }
    console.log(`[voice] capture started — ctx ${this.ctx.state} @ ${this.rate}Hz, mode ${this.opts.mode}`);
  }

  private reset() {
    this.buf = [];
    this.speaking = false;
    this.silenceRun = 0;
    this.speechRun = 0;
    this.preroll = [];
    this.prerollSamples = 0;
  }

  private onChunk(data: Float32Array) {
    // Copy: the source buffer is reused by the audio thread.
    const chunk = new Float32Array(data);
    let sum = 0;
    for (let i = 0; i < chunk.length; i++) sum += chunk[i] * chunk[i];
    const rms = Math.sqrt(sum / chunk.length);
    this.opts.onLevel?.(Math.min(1, rms * 6));

    const chunkMs = (chunk.length / this.rate) * 1000;

    if (this.opts.mode === "ptt") {
      this.buf.push(chunk);
      return;
    }

    // ---- continuous VAD ----
    const threshold = this.opts.speechThreshold ?? SPEECH_RMS;
    if (rms >= threshold) {
      if (!this.speaking) {
        // open an utterance with the pre-roll for a clean word start.
        this.speaking = true;
        this.buf = [...this.preroll];
        this.speechRun = 0;
      }
      this.buf.push(chunk);
      this.speechRun += chunkMs;
      this.silenceRun = 0;
    } else if (this.speaking) {
      this.buf.push(chunk);
      this.silenceRun += chunkMs;
      if (this.silenceRun >= SILENCE_MS) {
        if (this.speechRun >= MIN_SPEECH_MS) this.flush();
        this.speaking = false;
        this.buf = [];
        this.silenceRun = 0;
        this.speechRun = 0;
      }
    } else {
      // idle: keep a rolling pre-roll window.
      this.preroll.push(chunk);
      this.prerollSamples += chunk.length;
      const maxSamples = (PREROLL_MS / 1000) * this.rate;
      while (this.prerollSamples > maxSamples && this.preroll.length > 1) {
        this.prerollSamples -= this.preroll.shift()!.length;
      }
    }
  }

  private flush() {
    if (!this.buf.length) return;
    const samples = concat(this.buf);
    const secs = (samples.length / this.rate).toFixed(1);
    console.log(`[voice] segment: ${samples.length} samples (~${secs}s)`);
    this.opts.onSegment(encodeWavBase64(samples, this.rate));
  }

  /** Stop capturing. In ptt mode this emits the accumulated audio as one segment. */
  stop(): void {
    this.stopped = true;
    if (this.opts.mode === "ptt") {
      if (this.buf.length) this.flush();
      else this.opts.onError?.("Aucun son capté (micro muet, ou parole trop courte / silencieuse ?)");
    }
    this.teardown();
  }

  private teardown() {
    this.stopped = true;
    try {
      this.node?.disconnect();
      this.source?.disconnect();
    } catch {
      /* noop */
    }
    this.node && (this.node.onaudioprocess = null);
    this.stream?.getTracks().forEach((t) => t.stop());
    this.ctx?.close().catch(() => {});
    this.node = null;
    this.source = null;
    this.stream = null;
    this.ctx = null;
    this.reset();
    this.opts.onLevel?.(0);
  }
}
