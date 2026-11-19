// Small math helpers + a uniform-grid spatial hash for fast collision queries.

export const TAU = Math.PI * 2;
export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const rand = (lo, hi) => lo + Math.random() * (hi - lo);
export const randInt = (lo, hi) => Math.floor(rand(lo, hi + 1));
export const chance = (p) => Math.random() < p;
export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
export const dist2 = (a, b) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
export const angleTo = (a, b) => Math.atan2(b.y - a.y, b.x - a.x);

/** Weighted random choice: items = [{weight, ...}] */
export function weightedPick(items) {
  const total = items.reduce((s, it) => s + it.weight, 0);
  let r = Math.random() * total;
  for (const it of items) {
    if ((r -= it.weight) <= 0) return it;
  }
  return items[items.length - 1];
}

/** Compact number formatting: 1234 -> 1.2k */
export function fmt(n) {
  if (n >= 1e6) return (n / 1e6).toFixed(1) + "M";
  if (n >= 1e4) return (n / 1e3).toFixed(1) + "k";
  return Math.floor(n).toString();
}

export function fmtTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/**
 * Uniform grid spatial hash. Rebuilt every frame (cheap for a few hundred entities):
 * turns O(n*m) bullet-vs-zombie checks into roughly O(n + m).
 */
export class SpatialGrid {
  constructor(cellSize = 96) {
    this.cell = cellSize;
    this.map = new Map();
  }
  clear() {
    this.map.clear();
  }
  _key(cx, cy) {
    return (cx & 0xffff) | ((cy & 0xffff) << 16);
  }
  insert(obj) {
    const c = this.cell;
    const x0 = Math.floor((obj.x - obj.r) / c), x1 = Math.floor((obj.x + obj.r) / c);
    const y0 = Math.floor((obj.y - obj.r) / c), y1 = Math.floor((obj.y + obj.r) / c);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cy = y0; cy <= y1; cy++) {
        const k = this._key(cx, cy);
        let bucket = this.map.get(k);
        if (!bucket) this.map.set(k, (bucket = []));
        bucket.push(obj);
      }
    }
  }
  /** All objects whose cells overlap the circle (x, y, r). May contain duplicates-free results. */
  query(x, y, r, out = []) {
    out.length = 0;
    const c = this.cell;
    const seen = new Set();
    const x0 = Math.floor((x - r) / c), x1 = Math.floor((x + r) / c);
    const y0 = Math.floor((y - r) / c), y1 = Math.floor((y + r) / c);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cy = y0; cy <= y1; cy++) {
        const bucket = this.map.get(this._key(cx, cy));
        if (!bucket) continue;
        for (const o of bucket) {
          if (!seen.has(o)) {
            seen.add(o);
            out.push(o);
          }
        }
      }
    }
    return out;
  }
}
