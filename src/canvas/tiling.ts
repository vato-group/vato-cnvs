import { getPointerScene, useCanvasState } from "./canvasState";

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

export interface SpawnBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Gap (scene px) kept between a freshly spawned window and its neighbours. */
const SPAWN_GAP = 24;

/** Do two boxes (inflated by `gap`) overlap? */
function boxesOverlap(a: SpawnBox, b: SpawnBox, gap: number): boolean {
  return (
    a.x < b.x + b.width + gap &&
    a.x + a.width + gap > b.x &&
    a.y < b.y + b.height + gap &&
    a.y + a.height + gap > b.y
  );
}

/** Centre of the visible viewport in scene coords — the no-pointer fallback. */
function viewportCentreScene(width: number, height: number): { x: number; y: number } {
  const { scrollX, scrollY, zoom } = useCanvasState.getState();
  return {
    x: window.innerWidth / 2 / zoom - scrollX - width / 2,
    y: window.innerHeight / 2 / zoom - scrollY - height / 2,
  };
}

/**
 * Pick where a new window should land. Windows store SCENE coords (they pan +
 * zoom with the whiteboard), so everything here is in scene space.
 *
 * The goal ("se mettre à côté du truc le plus proche de ma souris sinon tout se
 * rentre dedans"): instead of dropping the window at random — which piles them
 * on top of each other — we anchor it to the window nearest the cursor and tuck
 * it against whichever side faces the cursor, never overlapping a neighbour. If
 * every side of the anchor is blocked we spiral outward on a step grid until a
 * free slot is found. With no windows yet, we centre it on the cursor.
 */
export function spawnRectNear(width: number, height: number, existing: SpawnBox[]): { x: number; y: number } {
  const mouse = getPointerScene();

  // No pointer info yet → centre on the viewport.
  if (!mouse) {
    const c = viewportCentreScene(width, height);
    if (!existing.length) return c;
    return placeAround({ x: c.x + width / 2, y: c.y + height / 2 }, width, height, existing);
  }

  // First window of the workspace → drop it centred on the cursor.
  if (!existing.length) return { x: mouse.x - width / 2, y: mouse.y - height / 2 };

  return placeAround(mouse, width, height, existing);
}

/** Find a non-overlapping slot near `mouse`, anchored to the nearest window. */
function placeAround(
  mouse: { x: number; y: number },
  width: number,
  height: number,
  existing: SpawnBox[],
): { x: number; y: number } {
  // Anchor = the window whose centre is nearest the cursor.
  let anchor = existing[0];
  let bestD = Infinity;
  for (const w of existing) {
    const dx = mouse.x - (w.x + w.width / 2);
    const dy = mouse.y - (w.y + w.height / 2);
    const d = dx * dx + dy * dy;
    if (d < bestD) {
      bestD = d;
      anchor = w;
    }
  }

  const gap = SPAWN_GAP;
  const fits = (x: number, y: number) =>
    !existing.some((w) => boxesOverlap({ x, y, width, height }, w, gap));
  // Prefer the candidate whose centre is closest to the cursor.
  const toMouse = (x: number, y: number) => {
    const cx = x + width / 2 - mouse.x;
    const cy = y + height / 2 - mouse.y;
    return cx * cx + cy * cy;
  };

  // The four sides of the anchor, edge-aligned — sorted so the side facing the
  // cursor wins.
  const sides = [
    { x: anchor.x + anchor.width + gap, y: anchor.y }, // right
    { x: anchor.x, y: anchor.y + anchor.height + gap }, // below
    { x: anchor.x - width - gap, y: anchor.y }, // left
    { x: anchor.x, y: anchor.y - height - gap }, // above
  ]
    .filter((c) => fits(c.x, c.y))
    .sort((a, b) => toMouse(a.x, a.y) - toMouse(b.x, b.y));
  if (sides.length) return sides[0];

  // Every side blocked → spiral outward on a step grid, taking the slot nearest
  // the cursor in the first ring that has any free slot.
  const stepX = width + gap;
  const stepY = height + gap;
  for (let ring = 1; ring <= 16; ring++) {
    const ringFits: { x: number; y: number }[] = [];
    for (let dy = -ring; dy <= ring; dy++) {
      for (let dx = -ring; dx <= ring; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue; // ring border only
        const x = anchor.x + dx * stepX;
        const y = anchor.y + dy * stepY;
        if (fits(x, y)) ringFits.push({ x, y });
      }
    }
    if (ringFits.length) {
      ringFits.sort((a, b) => toMouse(a.x, a.y) - toMouse(b.x, b.y));
      return ringFits[0];
    }
  }

  // Fully packed (very unlikely) → nudge off the anchor so it's at least visible.
  return { x: anchor.x + gap, y: anchor.y + gap };
}

/** Move id to targetIndex within the given id order. */
export function reorderIds(ids: string[], id: string, targetIndex: number): string[] {
  const others = ids.filter((x) => x !== id);
  const clamped = Math.max(0, Math.min(others.length, targetIndex));
  return [...others.slice(0, clamped), id, ...others.slice(clamped)];
}
