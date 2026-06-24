// Friendly random call-signs assigned to each spawned terminal (like the
// "Skye" / "Chase" panes in the reference cockpit).
const NAMES = [
  "Skye", "Chase", "Sage", "Nova", "Echo", "Orion", "Wren", "Vega", "Juno",
  "Atlas", "Iris", "Cleo", "Zephyr", "Lyra", "Kai", "Remy", "Pixel", "Onyx",
  "Cyan", "Ember", "Frost", "Indigo", "Jett", "Lumi", "Maple", "Nyx", "Opal",
  "Quill", "Reef", "Soren", "Talia", "Uma", "Vesper", "Wisp", "Yara", "Zane",
  "Aria", "Blaze", "Coral", "Dune", "Flint", "Gale", "Haze", "Koda",
];

/** Pick a name not already in `used`; falls back to the full pool when exhausted. */
export function randomName(used: Set<string>): string {
  const free = NAMES.filter((n) => !used.has(n));
  const pool = free.length ? free : NAMES;
  return pool[Math.floor(Math.random() * pool.length)];
}
