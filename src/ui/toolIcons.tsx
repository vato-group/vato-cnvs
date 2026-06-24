type P = { size?: number };
const b = (size = 19) => ({
  width: size,
  height: size,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
});

export const SelectTool = ({ size }: P) => (
  <svg {...b(size)}>
    <path d="M5 3l6.5 16 2-6.5 6.5-2z" fill="currentColor" stroke="none" />
  </svg>
);
export const HandTool = ({ size }: P) => (
  <svg {...b(size)}>
    <path d="M8 12V6.5a1.5 1.5 0 0 1 3 0V11m0-1V5a1.5 1.5 0 0 1 3 0v6m0-1.5a1.5 1.5 0 0 1 3 0V15a5 5 0 0 1-5 5h-1.5a4 4 0 0 1-3-1.4L6 16c-.8-1-.2-2.2.8-2.4.6-.1 1.2.1 1.7.6L9.5 15" />
  </svg>
);
export const RectTool = ({ size }: P) => (
  <svg {...b(size)}>
    <rect x="4" y="5.5" width="16" height="13" rx="1.5" />
  </svg>
);
export const DiamondTool = ({ size }: P) => (
  <svg {...b(size)}>
    <path d="M12 3.5l8.5 8.5L12 20.5 3.5 12z" />
  </svg>
);
export const EllipseTool = ({ size }: P) => (
  <svg {...b(size)}>
    <circle cx="12" cy="12" r="8.2" />
  </svg>
);
export const ArrowTool = ({ size }: P) => (
  <svg {...b(size)}>
    <line x1="5" y1="19" x2="19" y2="5" />
    <path d="M11 5h8v8" />
  </svg>
);
export const LineTool = ({ size }: P) => (
  <svg {...b(size)}>
    <line x1="5" y1="19" x2="19" y2="5" />
  </svg>
);
export const DrawTool = ({ size }: P) => (
  <svg {...b(size)}>
    <path d="M4 17c2.5 0 2.5-9 5-9s2.5 9 5 9 2.5-6 4.5-6" />
  </svg>
);
export const TextTool = ({ size }: P) => (
  <svg {...b(size)}>
    <path d="M5 7V5h14v2M12 5v14M9 19h6" />
  </svg>
);
export const ImageTool = ({ size }: P) => (
  <svg {...b(size)}>
    <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
    <circle cx="8.5" cy="9.5" r="1.6" />
    <path d="M4 17l5-4.5 4 3.5 3-2.5 4 3.5" />
  </svg>
);
export const EraserTool = ({ size }: P) => (
  <svg {...b(size)}>
    <path d="M8.5 19H20M5 15.5l5-5 6.5 6.5-3 3a2 2 0 0 1-2.8 0L5 15.5a2 2 0 0 1 0-2.8l6-6a2 2 0 0 1 2.8 0l3.7 3.7" />
  </svg>
);
export const TerminalTool = ({ size }: P) => (
  <svg {...b(size)}>
    <rect x="3" y="4.5" width="18" height="15" rx="2" />
    <path d="M7 9.5l3 2.5-3 2.5M12.5 15h4" />
  </svg>
);
export const BrowserTool = ({ size }: P) => (
  <svg {...b(size)}>
    <circle cx="12" cy="12" r="8.5" />
    <line x1="3.5" y1="12" x2="20.5" y2="12" />
    <path d="M12 3.5a13 13 0 0 1 0 17 13 13 0 0 1 0-17" />
  </svg>
);
