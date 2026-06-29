import { invoke } from "@tauri-apps/api/core";

type Stat = {
  n: number;
  total: number;
  min: number;
  max: number;
  last: number;
};

type Snapshot = {
  enabled: boolean;
  counters: Record<string, number>;
  stats: Record<string, Stat & { avg: number }>;
};

const counters = new Map<string, number>();
const stats = new Map<string, Stat>();
let lastFlush = typeof performance !== "undefined" ? performance.now() : Date.now();
let timer = 0;

function now(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

export function perfEnabled(): boolean {
  if (typeof localStorage === "undefined") return false;
  return localStorage.getItem("vato.perf") !== "0";
}

export function setPerfEnabled(on: boolean): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem("vato.perf", on ? "1" : "0");
}

function log(line: string): void {
  if (!perfEnabled()) return;
  // eslint-disable-next-line no-console
  console.info("[perf]", line);
  invoke("debug_log", { line: `[perf] ${line}` }).catch(() => {});
}

export function perfCount(name: string, n = 1): void {
  if (!perfEnabled()) return;
  counters.set(name, (counters.get(name) ?? 0) + n);
}

export function perfBytes(name: string, n: number): void {
  perfCount(`${name}_bytes`, n);
}

export function perfMeasure(name: string, ms: number): void {
  if (!perfEnabled() || !Number.isFinite(ms)) return;
  const cur = stats.get(name);
  if (!cur) {
    stats.set(name, { n: 1, total: ms, min: ms, max: ms, last: ms });
    return;
  }
  cur.n += 1;
  cur.total += ms;
  cur.min = Math.min(cur.min, ms);
  cur.max = Math.max(cur.max, ms);
  cur.last = ms;
}

export function perfTime<T>(name: string, fn: () => T): T {
  if (!perfEnabled()) return fn();
  const t0 = now();
  try {
    return fn();
  } finally {
    perfMeasure(name, now() - t0);
  }
}

export async function perfTimeAsync<T>(name: string, fn: () => Promise<T>): Promise<T> {
  if (!perfEnabled()) return fn();
  const t0 = now();
  try {
    return await fn();
  } finally {
    perfMeasure(name, now() - t0);
  }
}

export function perfEvent(name: string, fields?: Record<string, unknown>): void {
  if (!perfEnabled()) return;
  const suffix = fields ? ` ${JSON.stringify(fields)}` : "";
  log(`${name}${suffix}`);
}

export function perfSnapshot(): Snapshot {
  const statObj: Snapshot["stats"] = {};
  for (const [k, v] of stats) {
    statObj[k] = { ...v, avg: v.total / Math.max(1, v.n) };
  }
  return {
    enabled: perfEnabled(),
    counters: Object.fromEntries(counters),
    stats: statObj,
  };
}

export function perfDump(): string {
  const snap = perfSnapshot();
  const lines = [`enabled=${snap.enabled}`];
  const counterEntries = Object.entries(snap.counters).sort(([a], [b]) => a.localeCompare(b));
  if (counterEntries.length) {
    lines.push(`counters ${counterEntries.map(([k, v]) => `${k}=${Math.round(v)}`).join(" ")}`);
  }
  for (const [k, s] of Object.entries(snap.stats).sort(([a], [b]) => a.localeCompare(b))) {
    lines.push(`${k} n=${s.n} avg=${s.avg.toFixed(2)}ms max=${s.max.toFixed(2)}ms last=${s.last.toFixed(2)}ms`);
  }
  return lines.join("\n");
}

export function perfClear(): void {
  counters.clear();
  stats.clear();
  lastFlush = now();
}

function flushSummary(): void {
  if (!perfEnabled()) {
    perfClear();
    return;
  }
  const elapsed = Math.max(1, now() - lastFlush);
  const snap = perfSnapshot();
  const counterText = Object.entries(snap.counters)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${Math.round(v)}`)
    .join(" ");
  const statText = Object.entries(snap.stats)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, s]) => `${k}:n${s.n}/avg${s.avg.toFixed(1)}/max${s.max.toFixed(1)}`)
    .join(" ");
  if (counterText || statText) {
    log(`summary dt=${elapsed.toFixed(0)}ms ${counterText}${counterText && statText ? " | " : ""}${statText}`);
  }
  perfClear();
}

export function initPerfMonitor(): void {
  if (typeof window === "undefined") return;
  window.__vatoPerf = {
    on: () => setPerfEnabled(true),
    off: () => setPerfEnabled(false),
    enabled: perfEnabled,
    dump: () => {
      const text = perfDump();
      // eslint-disable-next-line no-console
      console.log(text);
      return text;
    },
    clear: perfClear,
    snapshot: perfSnapshot,
  };
  if (!timer) timer = window.setInterval(flushSummary, 5000);
}

declare global {
  interface Window {
    __vatoPerf?: {
      on: () => void;
      off: () => void;
      enabled: () => boolean;
      dump: () => string;
      clear: () => void;
      snapshot: () => Snapshot;
    };
  }
}
