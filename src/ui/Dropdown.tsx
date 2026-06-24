import { useState, type ReactNode } from "react";

interface Props {
  trigger: (open: boolean) => ReactNode;
  children: ReactNode | ((close: () => void) => ReactNode);
  align?: "left" | "right";
  /** Open below (default) or above the trigger — use "up" near the screen bottom. */
  direction?: "down" | "up";
  width?: number;
}

export function Dropdown({ trigger, children, align = "left", direction = "down", width }: Props) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  return (
    <div className="vato-dd">
      <div onClick={() => setOpen((o) => !o)}>{trigger(open)}</div>
      {open && (
        <>
          <div className="vato-dd-backdrop" onClick={close} />
          <div
            className={`vato-dd-panel ${align} ${direction}`}
            style={width ? { width } : undefined}
            onClick={(e) => e.stopPropagation()}
          >
            {typeof children === "function" ? children(close) : children}
          </div>
        </>
      )}
    </div>
  );
}
