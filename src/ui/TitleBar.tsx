import { getCurrentWindow } from "@tauri-apps/api/window";

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
  return (
    <div className="vato-titlebar-strip" data-tauri-drag-region>
      <div className="vato-traffic">
        <button className="tl tl-close" title="Fermer" aria-label="Fermer" onClick={() => win()?.close()} />
        <button className="tl tl-min" title="Réduire" aria-label="Réduire" onClick={() => win()?.minimize()} />
        <button className="tl tl-max" title="Agrandir" aria-label="Agrandir" onClick={() => win()?.toggleMaximize()} />
      </div>
    </div>
  );
}
