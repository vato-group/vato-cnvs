import { useCanvasState } from "./canvasState";

export interface Tile {
  x: number;
  y: number;
  width: number;
  height: number;
}

// Focus-mode gutters. They're deliberately tight: in focus the chrome (top bar,
// left toolbar, voice bar, zoom) auto-hides toward its edge, so the grid reclaims
// that space and the windows grow ("tout devient plus grand"). `top` still clears
// the macOS traffic lights (top-left, ~38px); the bottom/left/right gutters double
// as the thin hover rails that bring the chrome back.
const TILE = { top: 46, left: 24, right: 24, bottom: 24, gap: 14 };

/**
 * Lay n windows over the visible viewport: cols=ceil(sqrt(n)); the last row
 * stretches to fill width (=> 1 full, 2 side by side, then a wide one below,
 * then 2x2…). Returns rects in SCREEN pixels — the focus grid is laid out at a
 * fixed on-screen size (windows never zoom), and the overlay is identity in
 * focus mode so these land exactly where computed.
 */
export function computeTiles(n: number): Tile[] {
  const w = window.innerWidth;
  const h = window.innerHeight;

  const sx0 = TILE.left;
  const sy0 = TILE.top;
  const sx1 = w - TILE.right;
  const sy1 = h - TILE.bottom;

  const cols = Math.max(1, Math.ceil(Math.sqrt(n)));
  const rows = Math.max(1, Math.ceil(n / cols));
  const rowH = (sy1 - sy0 - TILE.gap * (rows - 1)) / rows;

  const tiles: Tile[] = [];
  for (let i = 0; i < n; i++) {
    const row = Math.floor(i / cols);
    const col = i % cols;
    const itemsInRow = row < rows - 1 ? cols : n - cols * (rows - 1);
    const cellW = (sx1 - sx0 - TILE.gap * (itemsInRow - 1)) / itemsInRow;
    tiles.push({
      x: sx0 + col * (cellW + TILE.gap),
      y: sy0 + row * (rowH + TILE.gap),
      width: cellW,
      height: rowH,
    });
  }
  return tiles;
}

/** Index of the grid slot whose centre is nearest to a scene-space point. */
export function nearestSlotIndex(cx: number, cy: number, n: number): number {
  const tiles = computeTiles(n);
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < tiles.length; i++) {
    const t = tiles[i];
    const dx = cx - (t.x + t.width / 2);
    const dy = cy - (t.y + t.height / 2);
    const d = dx * dx + dy * dy;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

/**
 * A free, slightly-randomized spawn position for a new window, so it lands
 * "somewhere on screen" like a freshly drawn shape. Windows store SCENE coords
 * (they pan + zoom with the whiteboard), so we pick a random visible screen point
 * — accounting for the on-screen size being width*zoom — and convert it to scene
 * space via the live viewport.
 */
export function randomSpawnRect(width: number, height: number): { x: number; y: number } {
  const { scrollX, scrollY, zoom } = useCanvasState.getState();
  const margin = 48;
  const spanX = Math.max(0, window.innerWidth - width * zoom - margin * 2);
  const spanY = Math.max(0, window.innerHeight - height * zoom - margin * 2);
  const screenX = margin + Math.random() * spanX;
  const screenY = margin + Math.random() * spanY;
  return { x: screenX / zoom - scrollX, y: screenY / zoom - scrollY };
}

/** Move id to targetIndex within the given id order. */
export function reorderIds(ids: string[], id: string, targetIndex: number): string[] {
  const others = ids.filter((x) => x !== id);
  const clamped = Math.max(0, Math.min(others.length, targetIndex));
  return [...others.slice(0, clamped), id, ...others.slice(clamped)];
}
