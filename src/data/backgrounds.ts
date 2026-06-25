/**
 * Shared workspace-background catalogue: flat colour/gradient presets, calm
 * still wallpapers, and looping ambient video clips. Consumed by both the
 * Settings → Apparence panel and the first-run onboarding wizard.
 */

export const BG_PRESETS = [
  "radial-gradient(1200px 820px at 72% 8%, #1c2c4d 0%, #0b0d12 62%)",
  "linear-gradient(160deg, #0f2027, #203a43, #2c5364)",
  "radial-gradient(900px 720px at 30% 18%, #3a1c4d, #0b0d12 64%)",
  "linear-gradient(160deg, #1a1a2e, #16213e, #0f3460)",
  "radial-gradient(1000px 800px at 70% 14%, #14342b, #0b0d12 60%)",
  "linear-gradient(160deg, #2b1b17, #3a241b, #0b0d12)",
];

/** A picked background template (image or looping video). */
export interface BgTemplate {
  /** French display name (fallback). */
  label: string;
  /** i18n key for the localized name (see `bg.*` in src/i18n). */
  labelKey: string;
  kind: "image" | "video";
  /** Full-res url applied as the background. */
  value: string;
  /** Static thumbnail shown in the gallery. */
  thumb: string;
  /** Suggested dark overlay so foreground stays readable. */
  dim: number;
}

const uns = (id: string, w: number, h?: number) =>
  `https://images.unsplash.com/photo-${id}?q=80&w=${w}${h ? `&h=${h}` : ""}&auto=format&fit=crop`;

/** Calm, low-distraction wallpapers (Unsplash, free to use). */
export const BG_IMAGES: BgTemplate[] = (
  [
    ["Vallée brumeuse", "bg.mistyValley", "1506744038136-46273834b3fb", 0.2],
    ["Forêt", "bg.forest", "1441974231531-c6227db76b6e", 0.25],
    ["Voie lactée", "bg.milkyWay", "1419242902214-272b3f66ee7a", 0.15],
    ["Aurore boréale", "bg.aurora", "1483347756197-71ef80e95f73", 0.2],
    ["Dégradé bleu", "bg.blueGradient", "1557683316-973673baf926", 0.1],
    ["Terre de nuit", "bg.earthNight", "1451187580459-43490279c0fa", 0.15],
    ["Hautes terres", "bg.highlands", "1470071459604-3b5ec3a7fe05", 0.25],
    ["Côte turquoise", "bg.turquoiseCoast", "1505142468610-359e7d316be0", 0.2],
    ["Arbre solitaire", "bg.lonelyTree", "1502082553048-f009c37129b9", 0.2],
  ] as const
).map(([label, labelKey, id, dim]) => ({
  label,
  labelKey,
  kind: "image" as const,
  value: uns(id, 2400),
  thumb: uns(id, 480, 300),
  dim,
}));

/** Looping ambient clips for a focused, alive background (Pexels, free to use). */
export const BG_VIDEOS: BgTemplate[] = [
  {
    label: "Vagues",
    labelKey: "bg.waves",
    kind: "video",
    value: "https://videos.pexels.com/video-files/1409899/1409899-uhd_2560_1440_25fps.mp4",
    thumb: "https://images.pexels.com/videos/1409899/free-video-1409899.jpg",
    dim: 0.3,
  },
  {
    label: "Forêt vivante",
    labelKey: "bg.livingForest",
    kind: "video",
    value: "https://videos.pexels.com/video-files/2330708/2330708-hd_1920_1080_24fps.mp4",
    thumb: "https://images.pexels.com/videos/2330708/free-video-2330708.jpg",
    dim: 0.35,
  },
  {
    label: "Champ d'étoiles",
    labelKey: "bg.starfield",
    kind: "video",
    value: "https://videos.pexels.com/video-files/2611250/2611250-hd_1920_1080_30fps.mp4",
    thumb: "https://images.pexels.com/videos/2611250/free-video-2611250.jpg",
    dim: 0.2,
  },
  {
    label: "Montagnes & brume",
    labelKey: "bg.mountainsMist",
    kind: "video",
    value: "https://videos.pexels.com/video-files/4763824/4763824-hd_1920_1080_24fps.mp4",
    thumb: "https://images.pexels.com/videos/4763824/4k-4k50fps-adventure-backpack-4763824.jpeg",
    dim: 0.3,
  },
  {
    label: "Côte sauvage",
    labelKey: "bg.wildCoast",
    kind: "video",
    value: "https://videos.pexels.com/video-files/4205697/4205697-hd_1920_1080_30fps.mp4",
    thumb: "https://images.pexels.com/videos/4205697/bay-bay-area-beach-island-beach-shore-4205697.jpeg",
    dim: 0.3,
  },
];
