// Thin wrapper over the Tauri notification plugin used by the attention router:
// when an agent finishes / asks for input / errors while the app is in the
// background, ping the OS so the user can delegate and walk away. Permission is
// requested lazily on first use and cached. Every call is best-effort — a failure
// (no permission, runtime without the plugin) is swallowed so it can never break
// the terminal flow.
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import { attnLog } from "./attnLog";

let granted: boolean | null = null;

async function ensurePermission(): Promise<boolean> {
  if (granted !== null) return granted;
  try {
    granted = await isPermissionGranted();
    if (!granted) granted = (await requestPermission()) === "granted";
  } catch {
    granted = false;
  }
  return granted;
}

/** Fire an OS notification (best-effort, no-op on failure). */
export async function notify(title: string, body: string): Promise<void> {
  try {
    if (!(await ensurePermission())) {
      attnLog("notify", "blocked", { reason: "no-permission", title, body });
      return;
    }
    attnLog("notify", "sent", { title, body });
    sendNotification({ title, body });
  } catch (e) {
    attnLog("notify", "error", { title, err: String(e) });
    /* swallow — notifications must never break the caller */
  }
}
