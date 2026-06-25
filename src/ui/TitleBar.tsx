import { getCurrentWindow } from "@tauri-apps/api/window";
import { useT } from "../i18n";

const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

function win() {
  try {
    return isTauri ? getCurrentWindow() : null;
  } catch {
    return null;
  }
}

// macOS-style traffic-light controls for the frameless window (top-left).
export function TitleBar() {
  const t = useT();
  return (
    <div className="vato-titlebar-strip" data-tauri-drag-region>
      <div className="vato-traffic">
        <button className="tl tl-close" title={t("common.close")} aria-label={t("common.close")} onClick={() => win()?.close()} />
        <button className="tl tl-min" title={t("titlebar.minimize")} aria-label={t("titlebar.minimize")} onClick={() => win()?.minimize()} />
        <button className="tl tl-max" title={t("titlebar.maximize")} aria-label={t("titlebar.maximize")} onClick={() => win()?.toggleMaximize()} />
      </div>
    </div>
  );
}
