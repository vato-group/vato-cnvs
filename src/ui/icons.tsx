type P = { size?: number };
const base = (size = 18) => ({
  width: size,
  height: size,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
});

export const PlusIcon = ({ size }: P) => (
  <svg {...base(size)}><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
);
export const MinusIcon = ({ size }: P) => (
  <svg {...base(size)}><line x1="5" y1="12" x2="19" y2="12" /></svg>
);
export const CloseIcon = ({ size }: P) => (
  <svg {...base(size)}><line x1="6" y1="6" x2="18" y2="18" /><line x1="18" y1="6" x2="6" y2="18" /></svg>
);
export const MaximizeIcon = ({ size }: P) => (
  <svg {...base(size)}><path d="M8 3 H5 a2 2 0 0 0-2 2 v3 M16 3 h3 a2 2 0 0 1 2 2 v3 M21 16 v3 a2 2 0 0 1-2 2 h-3 M3 16 v3 a2 2 0 0 0 2 2 h3" /></svg>
);
export const MinimizeIcon = ({ size }: P) => (
  <svg {...base(size)}><path d="M8 3 v3 a2 2 0 0 1-2 2 H3 M21 8 h-3 a2 2 0 0 1-2-2 V3 M16 21 v-3 a2 2 0 0 1 2-2 h3 M3 16 h3 a2 2 0 0 1 2 2 v3" /></svg>
);
export const GlobeIcon = ({ size }: P) => (
  <svg {...base(size)}><circle cx="12" cy="12" r="9" /><line x1="3" y1="12" x2="21" y2="12" /><path d="M12 3 a14 14 0 0 1 0 18 a14 14 0 0 1 0-18" /></svg>
);
export const PencilIcon = ({ size }: P) => (
  <svg {...base(size)}><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" /></svg>
);
export const GridIcon = ({ size }: P) => (
  <svg {...base(size)}><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></svg>
);
export const FolderIcon = ({ size }: P) => (
  <svg {...base(size)}><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></svg>
);
export const ChevronDownIcon = ({ size }: P) => (
  <svg {...base(size)}><polyline points="6 9 12 15 18 9" /></svg>
);
export const MicIcon = ({ size }: P) => (
  <svg {...base(size)}><rect x="9" y="2" width="6" height="12" rx="3" /><path d="M5 11a7 7 0 0 0 14 0" /><line x1="12" y1="18" x2="12" y2="22" /></svg>
);
export const ImageIcon = ({ size }: P) => (
  <svg {...base(size)}><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="M21 15l-5-5L5 21" /></svg>
);
export const RefreshIcon = ({ size }: P) => (
  <svg {...base(size)}><path d="M21 12a9 9 0 1 1-3-6.7L21 8" /><path d="M21 3v5h-5" /></svg>
);
export const ArrowLeftIcon = ({ size }: P) => (
  <svg {...base(size)}><line x1="19" y1="12" x2="5" y2="12" /><polyline points="12 19 5 12 12 5" /></svg>
);
export const ArrowRightIcon = ({ size }: P) => (
  <svg {...base(size)}><line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" /></svg>
);
export const SettingsIcon = ({ size }: P) => (
  <svg {...base(size)}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>
);
export const CrosshairIcon = ({ size }: P) => (
  <svg {...base(size)}><circle cx="12" cy="12" r="9" /><line x1="12" y1="2" x2="12" y2="6" /><line x1="12" y1="18" x2="12" y2="22" /><line x1="2" y1="12" x2="6" y2="12" /><line x1="18" y1="12" x2="22" y2="12" /></svg>
);
export const FocusIcon = ({ size }: P) => (
  <svg {...base(size)}><path d="M4 8 V5 a1 1 0 0 1 1-1 h3" /><path d="M16 4 h3 a1 1 0 0 1 1 1 v3" /><path d="M20 16 v3 a1 1 0 0 1-1 1 h-3" /><path d="M8 20 H5 a1 1 0 0 1-1-1 v-3" /><circle cx="12" cy="12" r="2.5" /></svg>
);
export const TrashIcon = ({ size }: P) => (
  <svg {...base(size)}><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
);
export const SendIcon = ({ size }: P) => (
  <svg {...base(size)}><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></svg>
);
export const MonitorIcon = ({ size }: P) => (
  <svg {...base(size)}><rect x="2" y="3" width="20" height="14" rx="2" /><line x1="8" y1="21" x2="16" y2="21" /><line x1="12" y1="17" x2="12" y2="21" /></svg>
);
export const KeyboardIcon = ({ size }: P) => (
  <svg {...base(size)}><rect x="2" y="5" width="20" height="14" rx="2" /><line x1="6" y1="9" x2="6" y2="9" /><line x1="10" y1="9" x2="10" y2="9" /><line x1="14" y1="9" x2="14" y2="9" /><line x1="18" y1="9" x2="18" y2="9" /><line x1="6" y1="13" x2="6" y2="13" /><line x1="10" y1="13" x2="10" y2="13" /><line x1="14" y1="13" x2="14" y2="13" /><line x1="18" y1="13" x2="18" y2="13" /><line x1="8" y1="16.5" x2="16" y2="16.5" /></svg>
);
export const PaletteIcon = ({ size }: P) => (
  <svg {...base(size)}><path d="M12 3a9 9 0 1 0 0 18c1 0 1.6-.8 1.6-1.6 0-.5-.2-.9-.5-1.2-.3-.3-.5-.7-.5-1.2 0-.9.7-1.6 1.6-1.6H16a5 5 0 0 0 5-5c0-4.2-4-7.4-9-7.4z" /><circle cx="7.5" cy="11.5" r="1" fill="currentColor" stroke="none" /><circle cx="12" cy="8" r="1" fill="currentColor" stroke="none" /><circle cx="16.5" cy="11.5" r="1" fill="currentColor" stroke="none" /></svg>
);
export const BroadcastIcon = ({ size }: P) => (
  <svg {...base(size)}><circle cx="12" cy="12" r="2" /><path d="M16.24 7.76a6 6 0 0 1 0 8.49M7.76 16.24a6 6 0 0 1 0-8.49M19.07 4.93a10 10 0 0 1 0 14.14M4.93 19.07a10 10 0 0 1 0-14.14" /></svg>
);
export const BellIcon = ({ size }: P) => (
  <svg {...base(size)}><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.7 21a2 2 0 0 1-3.4 0" /></svg>
);
export const InfoIcon = ({ size }: P) => (
  <svg {...base(size)}><circle cx="12" cy="12" r="9" /><line x1="12" y1="11" x2="12" y2="16" /><line x1="12" y1="8" x2="12" y2="8" /></svg>
);
