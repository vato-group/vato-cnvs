import { writeText as tauriWriteText } from "@tauri-apps/plugin-clipboard-manager";

/**
 * Copy plain text to the OS clipboard. Prefers Tauri's native clipboard, which
 * works in WebView2 regardless of document focus; `navigator.clipboard.writeText`
 * silently rejects when the webview isn't focused (e.g. right after a mouse
 * selection in a terminal), which is why Ctrl+C "copy selection" appeared to do
 * nothing. Falls back to the web API outside Tauri.
 */
export async function copyText(text: string): Promise<void> {
  try {
    await tauriWriteText(text);
    return;
  } catch {
    /* not in Tauri / plugin error → try the web API */
  }
  try {
    await navigator.clipboard?.writeText(text);
  } catch {
    /* clipboard unavailable */
  }
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onloadend = () => resolve(r.result as string);
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}

/**
 * Catch image paste (Ctrl+V) on `el`. Capture phase so we intercept the image
 * before xterm tries to paste it as (empty) text. Returns an unsubscribe fn.
 */
export function attachPasteImage(
  el: HTMLElement,
  onImage: (dataUrl: string, blob: Blob) => void,
): () => void {
  const handler = async (e: ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith("image/")) {
        e.preventDefault();
        e.stopPropagation();
        const blob = item.getAsFile();
        if (!blob) continue;
        onImage(await blobToDataUrl(blob), blob);
        return;
      }
    }
  };
  el.addEventListener("paste", handler, true);
  return () => el.removeEventListener("paste", handler, true);
}

/** Button-triggered fallback using the async Clipboard API. */
export async function readClipboardImage(): Promise<{ dataUrl: string; blob: Blob } | null> {
  if (!navigator.clipboard?.read) return null;
  try {
    const items = await navigator.clipboard.read();
    for (const item of items) {
      const type = item.types.find((t) => t.startsWith("image/"));
      if (type) {
        const blob = await item.getType(type);
        return { dataUrl: await blobToDataUrl(blob), blob };
      }
    }
  } catch {
    /* permission denied / not focused */
  }
  return null;
}
