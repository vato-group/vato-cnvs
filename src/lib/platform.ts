/**
 * Coarse OS detection used for platform-specific defaults (shell program,
 * keyboard shortcuts). Evaluated once from the webview's user agent.
 */
const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";

export const IS_MAC = /mac|iphone|ipad/i.test(ua);
export const IS_WINDOWS = /win/i.test(ua);
export const IS_LINUX = !IS_MAC && !IS_WINDOWS;
