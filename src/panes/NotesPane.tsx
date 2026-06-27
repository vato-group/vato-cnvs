import { useEffect, useRef } from "react";
import type { WindowItem } from "../types";
import { useStore } from "../store";
import { useT } from "../i18n";

/**
 * A plain-text scratchpad pane. The textarea is uncontrolled (seeded from
 * `win.note` on mount/remount); edits are debounced into the store.
 */
export function NotesPane({ win }: { win: WindowItem }) {
  const t = useT();
  const updateWindow = useStore((s) => s.updateWindow);
  const ref = useRef<HTMLTextAreaElement>(null);
  const saveTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    return () => {
      window.clearTimeout(saveTimer.current);
    };
  }, []);

  const persist = (value: string) => {
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => updateWindow(win.id, { note: value }), 400);
  };

  return (
    <textarea
      ref={ref}
      className="vato-notes allow-select vato-no-drag"
      defaultValue={win.note ?? ""}
      placeholder={t("notes.placeholder")}
      spellCheck={false}
      onInput={(e) => persist((e.target as HTMLTextAreaElement).value)}
      onBlur={(e) => updateWindow(win.id, { note: e.currentTarget.value })}
    />
  );
}
