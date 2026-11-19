// Procedural ruined city: road grid, building blocks, parks, parking lots, wrecks and props.
// Everything static is painted ONCE into a world-sized canvas; obstacles are kept as simple
// axis-aligned rectangles and circles for collision, bullets and pathfinding.

import { TAU, clamp } from "./util.js";

export const ROAD_CENTERS = [300, 900, 1500, 2100];
export const ROAD_W = 140;
const SIDEWALK = 26;

/** Height of the virtual camera above the ground, in world px. Lower = stronger 3D effect. */
export const CAM_H = 1300;

/** Perspective factor for a point at height h: its screen position moves away from the camera by k. */
export function lift(h) {
  return h / (CAM_H - h);
}

/** Project world point (x, y) at height h for a camera above (cx, cy). */
export function project(x, y, h, cx, cy) {
  const k = lift(h);
  return { x: x + (x - cx) * k, y: y + (y - cy) * k };
}

/** Deterministic RNG so a seed always produces the same city. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ------------------------------------------------------------------ static obstacle grid
class ObstacleGrid {
  constructor(cell = 120) {
    this.cell = cell;
    this.map = new Map();
  }
  _add(o, x0, y0, x1, y1) {
    const c = this.cell;
    for (let cx = Math.floor(x0 / c); cx <= Math.floor(x1 / c); cx++) {
      for (let cy = Math.floor(y0 / c); cy <= Math.floor(y1 / c); cy++) {
        const k = cx * 1000 + cy;
        if (!this.map.has(k)) this.map.set(k, []);
        this.map.get(k).push(o);
      }
    }
  }
  add(o) {
    if (o.kind === "rect") this._add(o, o.x, o.y, o.x + o.w, o.y + o.h);
    else this._add(o, o.x - o.r, o.y - o.r, o.x + o.r, o.y + o.r);
  }
  near(x, y, r) {
    const c = this.cell, out = new Set();
    for (let cx = Math.floor((x - r) / c); cx <= Math.floor((x + r) / c); cx++) {
      for (let cy = Math.floor((y - r) / c); cy <= Math.floor((y + r) / c); cy++) {
        const b = this.map.get(cx * 1000 + cy);
        if (b) for (const o of b) out.add(o);
      }
    }
    return out;
  }
}

export class City {
  constructor(size, seed = (Math.random() * 1e9) | 0) {
    this.size = size;
    this.seed = seed;
    this.rng = mulberry32(seed);
    this.obstacles = [];
    this.grid = new ObstacleGrid();
    this.lamps = [];
    this.fires = [];
    this.trees = [];
    this.buildings = [];
    this.solids = []; // 3D objects drawn every frame with perspective
    this.canvas = document.createElement("canvas");
    this.canvas.width = this.canvas.height = size;
    this.ctx = this.canvas.getContext("2d");
    this._generate();
  }

  r(lo = 0, hi = 1) {
    return lo + this.rng() * (hi - lo);
  }
  pick(arr) {
    return arr[Math.floor(this.rng() * arr.length)];
  }

  addRect(x, y, w, h, tag) {
    const o = { kind: "rect", x, y, w, h, tag };
    this.obstacles.push(o);
    this.grid.add(o);
    return o;
  }
  addCircle(x, y, r, tag) {
    const o = { kind: "circle", x, y, r, tag };
    this.obstacles.push(o);
    this.grid.add(o);
    return o;
  }

  // ------------------------------------------------------------------ queries
  /** True if a circle of radius `pad` at (x, y) overlaps any obstacle or leaves the world. */
  blocked(x, y, pad = 0) {
    if (x < pad || y < pad || x > this.size - pad || y > this.size - pad) return true;
    for (const o of this.grid.near(x, y, pad + 4)) {
      if (o.kind === "rect") {
        if (x > o.x - pad && x < o.x + o.w + pad && y > o.y - pad && y < o.y + o.h + pad) {
          // rounded corners: exact distance test near corners
          const cx = clamp(x, o.x, o.x + o.w), cy = clamp(y, o.y, o.y + o.h);
          if ((x - cx) ** 2 + (y - cy) ** 2 < pad * pad || (cx === x && cy === y)) return true;
        }
      } else if ((x - o.x) ** 2 + (y - o.y) ** 2 < (o.r + pad) ** 2) return true;
    }
    return false;
  }

  /** Push a circular entity {x, y, r} out of every obstacle it overlaps. Returns true if it collided. */
  resolve(e) {
    let hit = false;
    for (const o of this.grid.near(e.x, e.y, e.r + 4)) {
      if (o.kind === "rect") {
        const cx = clamp(e.x, o.x, o.x + o.w), cy = clamp(e.y, o.y, o.y + o.h);
        let dx = e.x - cx, dy = e.y - cy;
        const d2 = dx * dx + dy * dy;
        if (d2 === 0) {
          // centre inside the rectangle: push out along the shortest axis
          const l = e.x - o.x, rr = o.x + o.w - e.x, t = e.y - o.y, b = o.y + o.h - e.y;
          const m = Math.min(l, rr, t, b);
          if (m === l) e.x = o.x - e.r; else if (m === rr) e.x = o.x + o.w + e.r;
          else if (m === t) e.y = o.y - e.r; else e.y = o.y + o.h + e.r;
          hit = true;
        } else if (d2 < e.r * e.r) {
          const d = Math.sqrt(d2);
          e.x = cx + (dx / d) * e.r;
          e.y = cy + (dy / d) * e.r;
          hit = true;
        }
      } else {
        const dx = e.x - o.x, dy = e.y - o.y, min = e.r + o.r;
        const d2 = dx * dx + dy * dy;
        if (d2 < min * min) {
          const d = Math.sqrt(d2) || 0.01;
          e.x = o.x + (dx / d) * min;
          e.y = o.y + (dy / d) * min;
          hit = true;
        }
      }
    }
    return hit;
  }

  /** Does a point hit solid geometry? Used for bullets. */
  solidAt(x, y) {
    return this.blocked(x, y, 0.5);
  }

  /** Line of sight test by sampling along the segment. */
  lineOfSight(a, b, step = 18) {
    const d = Math.hypot(b.x - a.x, b.y - a.y);
    const n = Math.ceil(d / step);
    for (let i = 1; i < n; i++) {
      const t = i / n;
      if (this.solidAt(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t)) return false;
    }
    return true;
  }

  // ------------------------------------------------------------------ generation
  /**
   * Register a 3D box: footprint (x, y, w, h), height H. `paintTop` draws its top face in world
   * coordinates; it is rendered once into a small canvas that is later drawn with perspective.
   */
  _solid(x, y, w, h, H, wall, paintTop, extra = {}) {
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.ceil(w));
    c.height = Math.max(1, Math.ceil(h));
    const g = c.getContext("2d");
    g.translate(-x, -y);
    const prev = this.ctx;
    this.ctx = g;
    paintTop(g);
    this.ctx = prev;
    // ground: moonlight shadow towards the bottom-right + dark footprint under the walls
    const gc = this.ctx, sh = Math.min(60, H * 0.35);
    gc.fillStyle = "rgba(0,0,0,0.42)";
    gc.beginPath();
    gc.moveTo(x + w, y); gc.lineTo(x + w + sh, y + sh); gc.lineTo(x + w + sh, y + h + sh);
    gc.lineTo(x + sh, y + h + sh); gc.lineTo(x, y + h); gc.lineTo(x + w, y + h);
    gc.closePath(); gc.fill();
    gc.fillStyle = wall;
    gc.fillRect(x, y, w, h);
    const o = { kind: "box", x, y, w, h, H, wall, top: c, seed: Math.floor(this.rng() * 1e6) + 1, ...extra };
    this.solids.push(o);
    return o;
  }

  _cylinder(x, y, r, H, side, top, rim) {
    const gc = this.ctx;
    gc.fillStyle = "rgba(0,0,0,0.4)";
    gc.beginPath(); gc.arc(x + H * 0.25, y + H * 0.25, r, 0, TAU); gc.fill();
    this.solids.push({ kind: "cyl", x, y, r, H, side, top, rim });
  }

  _blocks() {
    const edges = [0];
    for (const c of ROAD_CENTERS) edges.push(c - ROAD_W / 2, c + ROAD_W / 2);
    edges.push(this.size);
    const spans = [];
    for (let i = 0; i < edges.length; i += 2) spans.push([edges[i], edges[i + 1]]);
    const blocks = [];
    spans.forEach(([x0, x1], i) => spans.forEach(([y0, y1], j) => blocks.push({ x: x0, y: y0, w: x1 - x0, h: y1 - y0, i, j })));
    return blocks;
  }

  _generate() {
    const g = this.ctx, S = this.size;
    // asphalt everywhere first
    g.fillStyle = "#26282a";
    g.fillRect(0, 0, S, S);
    this._noise(0, 0, S, S, 9000, [22, 46]);

    this._roads();
    const mid = Math.floor(ROAD_CENTERS.length / 2);
    for (const b of this._blocks()) {
      this._sidewalk(b);
      const inner = { x: b.x + SIDEWALK, y: b.y + SIDEWALK, w: b.w - 2 * SIDEWALK, h: b.h - 2 * SIDEWALK };
      if (b.i === mid && b.j === mid) this._plaza(inner);
      else {
        const roll = this.rng();
        if (roll < 0.55) this._buildingBlock(inner);
        else if (roll < 0.7) this._parking(inner);
        else if (roll < 0.85) this._park(inner);
        else this._ruins(inner);
      }
    }
    this._roadProps();
    this._lamps();
    // world border wall
    g.strokeStyle = "#3a1f1c";
    g.lineWidth = 16;
    g.strokeRect(0, 0, S, S);
  }

  _noise(x, y, w, h, n, [lo, hi], alpha = [0.15, 0.5]) {
    const g = this.ctx;
    for (let i = 0; i < n; i++) {
      const v = Math.floor(this.r(lo, hi));
      g.fillStyle = `rgba(${v},${v},${v + 3},${this.r(...alpha)})`;
      g.fillRect(x + this.r(0, w), y + this.r(0, h), this.r(1, 3), this.r(1, 3));
    }
  }

  _roads() {
    const g = this.ctx, S = this.size;
    for (const c of ROAD_CENTERS) {
      // dashed centre lines
      g.strokeStyle = "rgba(220,200,120,0.55)";
      g.lineWidth = 4;
      g.setLineDash([34, 30]);
      g.beginPath();
      g.moveTo(0, c); g.lineTo(S, c);
      g.moveTo(c, 0); g.lineTo(c, S);
      g.stroke();
      g.setLineDash([]);
      // edge lines
      g.strokeStyle = "rgba(230,230,230,0.18)";
      g.lineWidth = 2;
      for (const off of [-ROAD_W / 2 + 8, ROAD_W / 2 - 8]) {
        g.beginPath();
        g.moveTo(0, c + off); g.lineTo(S, c + off);
        g.moveTo(c + off, 0); g.lineTo(c + off, S);
        g.stroke();
      }
    }
    // intersections: clear the lines, add crosswalks
    for (const cx of ROAD_CENTERS) for (const cy of ROAD_CENTERS) {
      g.fillStyle = "#27292b";
      g.fillRect(cx - ROAD_W / 2, cy - ROAD_W / 2, ROAD_W, ROAD_W);
      this._noise(cx - ROAD_W / 2, cy - ROAD_W / 2, ROAD_W, ROAD_W, 200, [22, 46]);
      g.fillStyle = "rgba(225,225,225,0.32)";
      for (let k = -ROAD_W / 2 + 12; k < ROAD_W / 2 - 12; k += 18) {
        g.fillRect(cx + k, cy - ROAD_W / 2 - 22, 10, 18);
        g.fillRect(cx + k, cy + ROAD_W / 2 + 4, 10, 18);
        g.fillRect(cx - ROAD_W / 2 - 22, cy + k, 18, 10);
        g.fillRect(cx + ROAD_W / 2 + 4, cy + k, 18, 10);
      }
    }
    // cracks, potholes, manholes
    for (let i = 0; i < 160; i++) {
      const along = this.r(0, S), c = this.pick(ROAD_CENTERS) + this.r(-ROAD_W / 2, ROAD_W / 2);
      const [x, y] = this.rng() < 0.5 ? [along, c] : [c, along];
      g.strokeStyle = "rgba(10,10,10,0.55)";
      g.lineWidth = 1.5;
      g.beginPath();
      g.moveTo(x, y);
      let px = x, py = y;
      for (let k = 0; k < 5; k++) { px += this.r(-14, 14); py += this.r(-14, 14); g.lineTo(px, py); }
      g.stroke();
    }
    for (let i = 0; i < 26; i++) {
      const along = this.r(60, S - 60), c = this.pick(ROAD_CENTERS) + this.r(-40, 40);
      const [x, y] = this.rng() < 0.5 ? [along, c] : [c, along];
      if (this.rng() < 0.5) {
        g.fillStyle = "#1b1c1d";
        g.beginPath(); g.arc(x, y, 13, 0, TAU); g.fill();
        g.strokeStyle = "#3a3c3e"; g.lineWidth = 2;
        g.beginPath(); g.arc(x, y, 13, 0, TAU); g.stroke();
        g.beginPath(); g.moveTo(x - 9, y); g.lineTo(x + 9, y); g.moveTo(x, y - 9); g.lineTo(x, y + 9); g.stroke();
      } else {
        g.fillStyle = "rgba(12,12,12,0.7)";
        g.beginPath(); g.ellipse(x, y, this.r(8, 18), this.r(6, 12), this.r(0, 3), 0, TAU); g.fill();
      }
    }
  }

  _sidewalk(b) {
    const g = this.ctx;
    g.fillStyle = "#4a4b47";
    g.fillRect(b.x, b.y, b.w, b.h);
    g.strokeStyle = "rgba(0,0,0,0.25)";
    g.lineWidth = 1;
    for (let x = b.x; x < b.x + b.w; x += 26) { g.beginPath(); g.moveTo(x, b.y); g.lineTo(x, b.y + SIDEWALK); g.moveTo(x, b.y + b.h - SIDEWALK); g.lineTo(x, b.y + b.h); g.stroke(); }
    for (let y = b.y; y < b.y + b.h; y += 26) { g.beginPath(); g.moveTo(b.x, y); g.lineTo(b.x + SIDEWALK, y); g.moveTo(b.x + b.w - SIDEWALK, y); g.lineTo(b.x + b.w, y); g.stroke(); }
    g.strokeStyle = "#5d5e59";
    g.lineWidth = 3;
    g.strokeRect(b.x + 1.5, b.y + 1.5, b.w - 3, b.h - 3);
  }

  // ------------------------------------------------------------------ block types
  _buildingBlock(a) {
    const vertical = a.w >= a.h ? this.rng() < 0.6 : this.rng() < 0.3;
    const len = vertical ? a.w : a.h;
    const parts = len > 300 ? (this.rng() < 0.5 ? 2 : 3) : len > 180 ? (this.rng() < 0.6 ? 2 : 1) : 1;
    const gap = 70;
    const sizes = [];
    let remaining = len - gap * (parts - 1);
    for (let i = 0; i < parts; i++) {
      const s = i === parts - 1 ? remaining : Math.round(remaining * this.r(0.35, 0.6));
      sizes.push(s);
      remaining -= s;
    }
    let off = 0;
    sizes.forEach((s, i) => {
      const inset = this.r(4, 14);
      const r = vertical
        ? { x: a.x + off + inset, y: a.y + inset, w: s - 2 * inset, h: a.h - 2 * inset }
        : { x: a.x + inset, y: a.y + off + inset, w: a.w - 2 * inset, h: s - 2 * inset };
      if (r.w > 50 && r.h > 50) this._building(r);
      // alley props (dumpsters, trash) between buildings
      if (i < parts - 1) {
        const ax = vertical ? a.x + off + s : a.x, ay = vertical ? a.y : a.y + off + s;
        this._alley(vertical ? { x: ax, y: ay, w: gap, h: a.h } : { x: ax, y: ay, w: a.w, h: gap }, vertical);
      }
      off += s + gap;
    });
  }

  _building(r) {
    this.addRect(r.x, r.y, r.w, r.h, "building");
    this.buildings.push(r);
    const palettes = [["#4b4f55", "#3a3d42"], ["#5a4b40", "#463a31"], ["#3f4a48", "#303a38"], ["#55524a", "#423f39"], ["#4a3f47", "#3a3138"]];
    const pal = this.pick(palettes);
    const H = Math.round(this.r(70, 175));
    this._solid(r.x, r.y, r.w, r.h, H, pal[1], () => this._roof(r, pal), { building: true, floors: Math.max(2, Math.floor(H / 34)) });
  }

  _roof(r, [roof, edge]) {
    const g = this.ctx;
    // roof
    g.fillStyle = edge;
    g.fillRect(r.x, r.y, r.w, r.h);
    g.fillStyle = roof;
    g.fillRect(r.x + 6, r.y + 6, r.w - 12, r.h - 12);
    this._noise(r.x + 6, r.y + 6, r.w - 12, r.h - 12, (r.w * r.h) / 90, [40, 90], [0.05, 0.25]);
    // roof details
    const n = Math.floor((r.w * r.h) / 9000) + 1;
    for (let i = 0; i < n; i++) {
      const w = this.r(16, 34), h = this.r(14, 28);
      const x = this.r(r.x + 12, r.x + r.w - 12 - w), y = this.r(r.y + 12, r.y + r.h - 12 - h);
      const kind = this.rng();
      if (kind < 0.45) { // AC unit
        g.fillStyle = "#6d7378"; g.fillRect(x, y, w, h);
        g.fillStyle = "#2c3034"; g.beginPath(); g.arc(x + w / 2, y + h / 2, Math.min(w, h) * 0.32, 0, TAU); g.fill();
        g.fillStyle = "rgba(0,0,0,0.35)"; g.fillRect(x + 3, y + h, w, 3);
      } else if (kind < 0.7) { // skylight
        g.fillStyle = "#24333a"; g.fillRect(x, y, w, h);
        g.strokeStyle = "#7f99a3"; g.lineWidth = 1.5; g.strokeRect(x, y, w, h);
        g.beginPath(); g.moveTo(x, y); g.lineTo(x + w, y + h); g.stroke();
      } else if (kind < 0.85) { // water tank
        g.fillStyle = "#5c4a3a"; g.beginPath(); g.arc(x + w / 2, y + h / 2, 13, 0, TAU); g.fill();
        g.strokeStyle = "#3a2e25"; g.lineWidth = 2; g.stroke();
      } else { // stairwell
        g.fillStyle = edge; g.fillRect(x, y, 26, 22);
        g.fillStyle = "rgba(0,0,0,0.3)"; g.fillRect(x + 26, y + 4, 5, 22);
      }
    }
    // vents / pipes
    g.strokeStyle = "rgba(20,20,20,0.5)";
    g.lineWidth = 3;
    g.beginPath();
    const py = this.r(r.y + 14, r.y + r.h - 14);
    g.moveTo(r.x + 10, py);
    g.lineTo(r.x + this.r(r.w * 0.3, r.w - 10), py);
    g.stroke();
  }

  _alley(a, vertical) {
    const g = this.ctx;
    g.fillStyle = "#2f302d";
    g.fillRect(a.x, a.y, a.w, a.h);
    this._noise(a.x, a.y, a.w, a.h, (a.w * a.h) / 60, [25, 55]);
    // a dumpster against one wall
    if (this.rng() < 0.75) {
      const w = vertical ? 30 : 56, h = vertical ? 56 : 30;
      const x = vertical ? a.x + (this.rng() < 0.5 ? 4 : a.w - w - 4) : this.r(a.x + 20, a.x + a.w - w - 20);
      const y = vertical ? this.r(a.y + 20, a.y + a.h - h - 20) : a.y + (this.rng() < 0.5 ? 4 : a.h - h - 4);
      this._dumpster(x, y, w, h);
    }
    for (let i = 0; i < 6; i++) this._trash(this.r(a.x + 6, a.x + a.w - 6), this.r(a.y + 6, a.y + a.h - 6));
  }

  _dumpster(x, y, w, h) {
    this.addRect(x, y, w, h, "dumpster");
    const col = this.pick(["#2f5a3a", "#2f4a6a", "#5a3a2f"]);
    this._solid(x, y, w, h, 34, shadeHex(col, -30), () => {
      const g = this.ctx;
      g.fillStyle = col; g.fillRect(x, y, w, h);
      g.strokeStyle = "rgba(0,0,0,0.45)"; g.lineWidth = 2;
      g.strokeRect(x + 1, y + 1, w - 2, h - 2);
      if (w > h) { g.beginPath(); g.moveTo(x + w / 2, y); g.lineTo(x + w / 2, y + h); g.stroke(); }
      else { g.beginPath(); g.moveTo(x, y + h / 2); g.lineTo(x + w, y + h / 2); g.stroke(); }
    });
  }

  _trash(x, y) {
    const g = this.ctx;
    g.fillStyle = this.pick(["#6b6250", "#4c5a63", "#7a3b30", "#d8d2c0", "#3b4a2f"]);
    g.save();
    g.translate(x, y);
    g.rotate(this.r(0, TAU));
    g.fillRect(-this.r(2, 5), -this.r(2, 4), this.r(4, 10), this.r(3, 7));
    g.restore();
  }

  _parking(a) {
    const g = this.ctx;
    g.fillStyle = "#2c2e30";
    g.fillRect(a.x, a.y, a.w, a.h);
    this._noise(a.x, a.y, a.w, a.h, (a.w * a.h) / 50, [25, 50]);
    const horizontal = a.w > a.h;
    g.strokeStyle = "rgba(220,220,220,0.35)";
    g.lineWidth = 2;
    const spot = 58;
    const rows = horizontal ? [a.y + 8, a.y + a.h - 98] : [a.x + 8, a.x + a.w - 98];
    for (const row of rows) {
      for (let k = (horizontal ? a.x : a.y) + 10; k < (horizontal ? a.x + a.w : a.y + a.h) - spot; k += spot) {
        g.beginPath();
        if (horizontal) { g.moveTo(k, row); g.lineTo(k, row + 90); } else { g.moveTo(row, k); g.lineTo(row + 90, k); }
        g.stroke();
        if (this.rng() < 0.45) {
          const cw = 40, ch = 78;
          if (horizontal) this._car(k + 9, row + 6, cw, ch, false);
          else this._car(row + 6, k + 9, ch, cw, false);
        }
      }
    }
  }

  _park(a) {
    const g = this.ctx;
    g.fillStyle = "#23301f";
    g.fillRect(a.x, a.y, a.w, a.h);
    for (let i = 0; i < (a.w * a.h) / 40; i++) {
      g.fillStyle = `rgba(${this.r(30, 60)},${this.r(55, 85)},${this.r(25, 45)},${this.r(0.2, 0.6)})`;
      g.fillRect(a.x + this.r(0, a.w), a.y + this.r(0, a.h), this.r(1, 3), this.r(2, 5));
    }
    // dirt path
    g.strokeStyle = "#4a4233";
    g.lineWidth = 22;
    g.lineCap = "round";
    g.beginPath();
    g.moveTo(a.x, a.y + this.r(a.h * 0.3, a.h * 0.7));
    g.quadraticCurveTo(a.x + a.w / 2, a.y + this.r(0, a.h), a.x + a.w, a.y + this.r(a.h * 0.3, a.h * 0.7));
    g.stroke();
    g.lineCap = "butt";
    const n = Math.floor((a.w * a.h) / 16000) + 2;
    for (let i = 0; i < n; i++) {
      const x = this.r(a.x + 40, a.x + a.w - 40), y = this.r(a.y + 40, a.y + a.h - 40);
      if (this.trees.some((t) => (t.x - x) ** 2 + (t.y - y) ** 2 < 90 * 90)) continue;
      this._tree(x, y);
    }
    for (let i = 0; i < 4; i++) { // bushes (decor)
      const x = this.r(a.x + 20, a.x + a.w - 20), y = this.r(a.y + 20, a.y + a.h - 20);
      g.fillStyle = "#2f4a26";
      g.beginPath(); g.arc(x, y, this.r(8, 14), 0, TAU); g.fill();
    }
  }

  _tree(x, y) {
    this.addCircle(x, y, 13, "tree");
    const g = this.ctx;
    g.fillStyle = "rgba(0,0,0,0.35)";
    g.beginPath(); g.arc(x + 22, y + 24, 40, 0, TAU); g.fill();
    g.fillStyle = "#3a2a1c";
    g.beginPath(); g.arc(x, y, 12, 0, TAU); g.fill();
    this.trees.push({ x, y, r: this.r(38, 50), hue: this.r(0, 1), H: this.r(95, 130) });
  }

  _ruins(a) {
    const g = this.ctx;
    g.fillStyle = "#3a3935";
    g.fillRect(a.x, a.y, a.w, a.h);
    this._noise(a.x, a.y, a.w, a.h, (a.w * a.h) / 30, [45, 85]);
    // building foundation outline with broken walls (solid segments)
    const fx = a.x + 30, fy = a.y + 30, fw = a.w - 60, fh = a.h - 60;
    const t = 14;
    const walls = [
      [fx, fy, fw * this.r(0.3, 0.6), t], [fx + fw * 0.7, fy, fw * 0.3, t],
      [fx, fy + fh - t, fw * this.r(0.4, 0.7), t],
      [fx, fy, t, fh * this.r(0.3, 0.5)], [fx + fw - t, fy + fh * 0.4, t, fh * 0.6],
    ];
    for (const [x, y, w, h] of walls) {
      if (this.rng() < 0.2) continue;
      this.addRect(x, y, w, h, "wall");
      this._solid(x, y, w, h, Math.round(this.r(35, 80)), "#4e4a43", () => {
        const g2 = this.ctx;
        g2.fillStyle = "#6a655c"; g2.fillRect(x, y, w, h);
        g2.fillStyle = "#57534b"; g2.fillRect(x + 2, y + 2, w - 4, h - 4);
      }, { brick: true });
    }
    // rubble
    for (let i = 0; i < (a.w * a.h) / 900; i++) {
      g.fillStyle = this.pick(["#77716a", "#5c5751", "#8a837a", "#4a4641"]);
      const s = this.r(3, 10);
      g.fillRect(this.r(a.x, a.x + a.w), this.r(a.y, a.y + a.h), s, s * this.r(0.5, 1));
    }
    for (let i = 0; i < 3; i++) this._crate(this.r(fx + 40, fx + fw - 60), this.r(fy + 40, fy + fh - 60));
  }

  _crate(x, y) {
    const s = 26;
    if (this.blocked(x + s / 2, y + s / 2, s)) return;
    this.addRect(x, y, s, s, "crate");
    this._solid(x, y, s, s, 26, "#5c4222", () => {
      const g = this.ctx;
      g.fillStyle = "#7a5a34"; g.fillRect(x, y, s, s);
      g.strokeStyle = "#4e391f"; g.lineWidth = 2; g.strokeRect(x + 1, y + 1, s - 2, s - 2);
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + s, y + s); g.moveTo(x + s, y); g.lineTo(x, y + s); g.stroke();
    }, { planks: true });
  }

  _plaza(a) {
    const g = this.ctx;
    g.fillStyle = "#57554f";
    g.fillRect(a.x, a.y, a.w, a.h);
    g.strokeStyle = "rgba(0,0,0,0.2)";
    g.lineWidth = 1;
    for (let x = a.x; x < a.x + a.w; x += 32) { g.beginPath(); g.moveTo(x, a.y); g.lineTo(x, a.y + a.h); g.stroke(); }
    for (let y = a.y; y < a.y + a.h; y += 32) { g.beginPath(); g.moveTo(a.x, y); g.lineTo(a.x + a.w, y); g.stroke(); }
    const cx = a.x + a.w / 2, cy = a.y + a.h / 2;
    g.strokeStyle = "rgba(200,190,160,0.25)";
    g.lineWidth = 6;
    g.beginPath(); g.arc(cx, cy, 120, 0, TAU); g.stroke();
    // planters at the corners (solid)
    for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const x = cx + sx * 150 - 26, y = cy + sy * 150 - 26;
      this.addRect(x, y, 52, 52, "planter");
      this._solid(x, y, 52, 52, 22, "#57534a", () => {
        const g2 = this.ctx;
        g2.fillStyle = "#6b675d"; g2.fillRect(x, y, 52, 52);
        g2.fillStyle = "#2c4424"; g2.fillRect(x + 6, y + 6, 40, 40);
        g2.fillStyle = "#3d5e2f";
        for (let k = 0; k < 6; k++) { g2.beginPath(); g2.arc(x + this.r(12, 40), y + this.r(12, 40), this.r(6, 11), 0, TAU); g2.fill(); }
      });
    }
    // sandbag barricade remains (decor, the player's last stand)
    g.fillStyle = "#7d6c4c";
    for (let k = 0; k < 9; k++) {
      const ang = -2.2 + k * 0.16;
      g.beginPath(); g.ellipse(cx + Math.cos(ang) * 60, cy + Math.sin(ang) * 60, 12, 7, ang + Math.PI / 2, 0, TAU); g.fill();
    }
  }

  _car(x, y, w, h, wrecked = true) {
    this.addRect(x, y, w, h, "car");
    const colors = ["#7a2b25", "#2b4a6b", "#5d5f61", "#c9c3b5", "#2f4b33", "#7a6a2b", "#1f2326"];
    const body = wrecked && this.rng() < 0.35 ? "#3b2a22" : this.pick(colors);
    const burning = wrecked && this.rng() < 0.3;
    const o = this._solid(x, y, w, h, 26, shadeHex(body, -35), () => this._carTop(x, y, w, h, wrecked, body, burning), { car: true });
    if (burning) this.fires.push({ x: x + w / 2, y: y + h / 2, h: 30 });
    return o;
  }

  _carTop(x, y, w, h, wrecked, body, burning) {
    const g = this.ctx;
    const vertical = h > w;
    g.fillStyle = body;
    roundRect(g, x, y, w, h, 7);
    g.fill();
    const L = vertical ? h : w, Wd = vertical ? w : h;
    const seg = (a, b, color) => {
      g.fillStyle = color;
      if (vertical) g.fillRect(x + 4, y + L * a, Wd - 8, L * (b - a));
      else g.fillRect(x + L * a, y + 4, L * (b - a), Wd - 8);
    };
    seg(0.22, 0.38, wrecked ? "#1a2226" : "#2a3a44");
    seg(0.38, 0.7, shadeHex(body, -18));
    seg(0.7, 0.8, wrecked ? "#1a2226" : "#2a3a44");
    g.fillStyle = "rgba(255,255,255,0.12)";
    if (vertical) g.fillRect(x + 5, y + 4, 3, h - 8); else g.fillRect(x + 4, y + 5, w - 8, 3);
    if (wrecked) {
      for (let i = 0; i < 6; i++) {
        g.fillStyle = this.pick(["rgba(120,60,30,0.6)", "rgba(20,20,20,0.6)", "rgba(200,220,230,0.5)"]);
        g.fillRect(x + this.r(0, w - 4), y + this.r(0, h - 4), this.r(2, 6), this.r(2, 6));
      }
      if (burning) {
        g.fillStyle = "rgba(10,10,10,0.65)";
        g.beginPath(); g.ellipse(x + w / 2, y + h / 2, w * 0.45, h * 0.45, 0, 0, TAU); g.fill();
      }
    }
  }

  _roadProps() {
    const S = this.size;
    const intersections = ROAD_CENTERS.map((c) => [c - ROAD_W / 2 - 40, c + ROAD_W / 2 + 40]);
    const inIntersection = (v) => intersections.some(([a, b]) => v > a && v < b);
    let cars = 0, tries = 0;
    while (cars < 22 && tries++ < 400) {
      const c = this.pick(ROAD_CENTERS);
      const along = this.r(80, S - 80);
      if (inIntersection(along)) continue;
      const lane = this.rng() < 0.5 ? -1 : 1;
      const horizontal = this.rng() < 0.5;
      const w = horizontal ? 80 : 40, h = horizontal ? 40 : 80;
      const x = horizontal ? along : c + lane * 32 - w / 2;
      const y = horizontal ? c + lane * 32 - h / 2 : along;
      if (this.blocked(x + w / 2, y + h / 2, 70)) continue;
      if (Math.hypot(x - S / 2, y - S / 2) < 260) continue;
      this._car(x, y, w, h, true);
      cars++;
    }
    // concrete barriers and barrel clusters
    for (let i = 0; i < 30; i++) {
      const c = this.pick(ROAD_CENTERS);
      const along = this.r(80, S - 80);
      if (inIntersection(along)) continue;
      const horizontal = this.rng() < 0.5;
      const off = this.r(-45, 45);
      const x = horizontal ? along : c + off, y = horizontal ? c + off : along;
      if (this.blocked(x, y, 60) || Math.hypot(x - S / 2, y - S / 2) < 260) continue;
      if (this.rng() < 0.5) this._barrels(x, y);
      else this._barrier(x, y, horizontal);
    }
  }

  _barrels(x, y) {
    const n = 1 + Math.floor(this.rng() * 3);
    for (let i = 0; i < n; i++) {
      const bx = x + i * 22 * (this.rng() < 0.5 ? 1 : -1) * 0.9, by = y + this.r(-8, 8);
      if (this.blocked(bx, by, 11)) continue;
      this.addCircle(bx, by, 11, "barrel");
      const col = this.pick(["#8a3b22", "#2f5a7a", "#6a6a2a", "#5a5a5a"]);
      this._cylinder(bx, by, 11, 30, shadeHex(col, -30), col, shadeHex(col, 25));
    }
  }

  _barrier(x, y, horizontal) {
    const w = horizontal ? 60 : 18, h = horizontal ? 18 : 60;
    this.addRect(x - w / 2, y - h / 2, w, h, "barrier");
    this._solid(x - w / 2, y - h / 2, w, h, 24, "#8a877d", () => {
      const g = this.ctx;
      g.fillStyle = "#b9b5a8"; g.fillRect(x - w / 2, y - h / 2, w, h);
      g.fillStyle = "#b8452f";
      for (let k = 0; k < 3; k++) {
        if (horizontal) g.fillRect(x - w / 2 + 8 + k * 18, y - h / 2 + 3, 8, h - 6);
        else g.fillRect(x - w / 2 + 3, y - h / 2 + 8 + k * 18, w - 6, 8);
      }
    }, { stripes: true });
  }

  _lamps() {
    const g = this.ctx;
    for (const cx of ROAD_CENTERS) for (const cy of ROAD_CENTERS) {
      for (const [sx, sy] of [[-1, -1], [1, 1]]) {
        const x = cx + sx * (ROAD_W / 2 + 12), y = cy + sy * (ROAD_W / 2 + 12);
        if (this.blocked(x, y, 8)) continue;
        this.addCircle(x, y, 6, "lamp");
        g.fillStyle = "rgba(0,0,0,0.4)"; g.beginPath(); g.arc(x, y, 7, 0, TAU); g.fill();
        const broken = this.rng() < 0.3;
        this.lamps.push({ x, y, broken, flicker: this.r(0, 10), H: 135 });
      }
    }
  }

  // ------------------------------------------------------------------ dynamic layer (3D)
  /**
   * Draw every visible solid with perspective for a camera above (cx, cy).
   * Objects far from the camera are drawn first so nearer ones overlap them correctly.
   * Returns emissive quads (lit windows) to draw after the darkness layer.
   */
  drawSolids(ctx, view, cx, cy, t) {
    const vis = [];
    const m = 220;
    for (const o of this.solids) {
      const ox = o.kind === "box" ? o.x + o.w / 2 : o.x, oy = o.kind === "box" ? o.y + o.h / 2 : o.y;
      const ext = o.kind === "box" ? Math.max(o.w, o.h) / 2 : o.r;
      if (ox + ext < view.x0 - m || ox - ext > view.x1 + m || oy + ext < view.y0 - m || oy - ext > view.y1 + m) continue;
      o._d = (ox - cx) ** 2 + (oy - cy) ** 2;
      vis.push(o);
    }
    for (const L of this.lamps) {
      if (L.x < view.x0 - m || L.x > view.x1 + m || L.y < view.y0 - m || L.y > view.y1 + m) continue;
      vis.push({ kind: "lamp", ref: L, _d: (L.x - cx) ** 2 + (L.y - cy) ** 2 });
    }
    for (const T of this.trees) {
      if (T.x < view.x0 - m || T.x > view.x1 + m || T.y < view.y0 - m || T.y > view.y1 + m) continue;
      vis.push({ kind: "tree", ref: T, _d: (T.x - cx) ** 2 + (T.y - cy) ** 2 - 1 });
    }
    vis.sort((a, b) => b._d - a._d);
    const emissive = [];
    for (const o of vis) {
      if (o.kind === "box") this._drawBox(ctx, o, cx, cy, emissive);
      else if (o.kind === "cyl") this._drawCyl(ctx, o, cx, cy);
      else if (o.kind === "lamp") this._drawLamp(ctx, o.ref, cx, cy);
      else this._drawTree(ctx, o.ref, cx, cy, t);
    }
    return emissive;
  }

  _drawBox(g, o, cx, cy, emissive) {
    const k = lift(o.H);
    const base = [[o.x, o.y], [o.x + o.w, o.y], [o.x + o.w, o.y + o.h], [o.x, o.y + o.h]];
    const top = base.map(([x, y]) => [x + (x - cx) * k, y + (y - cy) * k]);
    const normals = [[0, -1], [1, 0], [0, 1], [-1, 0]];
    for (let i = 0; i < 4; i++) {
      const a = base[i], b = base[(i + 1) % 4];
      const n = normals[i];
      const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
      if (n[0] * (cx - mx) + n[1] * (cy - my) <= 0) continue; // only walls facing the camera are visible
      const ta = top[i], tb = top[(i + 1) % 4];
      const shade = n[0] < 0 || n[1] < 0 ? 16 : -18; // moonlight comes from the top-left
      g.fillStyle = shadeCss(o.wall, shade);
      g.beginPath();
      g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.lineTo(tb[0], tb[1]); g.lineTo(ta[0], ta[1]);
      g.closePath();
      g.fill();
      g.strokeStyle = "rgba(0,0,0,0.35)";
      g.lineWidth = 1;
      g.stroke();
      // point on the wall: u along the edge, v from the ground (0) to the roof (1)
      const P = (u, v) => {
        const bx = a[0] + (b[0] - a[0]) * u, by = a[1] + (b[1] - a[1]) * u;
        const tx = ta[0] + (tb[0] - ta[0]) * u, ty = ta[1] + (tb[1] - ta[1]) * u;
        return [bx + (tx - bx) * v, by + (ty - by) * v];
      };
      if (o.building) this._windows(g, o, i, P, Math.hypot(b[0] - a[0], b[1] - a[1]), emissive);
      else if (o.car) {
        g.fillStyle = "rgba(15,20,25,0.85)";
        quad(g, P(0.2, 0.55), P(0.8, 0.55), P(0.8, 0.92), P(0.2, 0.92));
        g.fillStyle = "#111";
        quad(g, P(0.08, 0), P(0.26, 0), P(0.26, 0.38), P(0.08, 0.38));
        quad(g, P(0.74, 0), P(0.92, 0), P(0.92, 0.38), P(0.74, 0.38));
      } else if (o.brick) {
        g.strokeStyle = "rgba(0,0,0,0.25)";
        for (let v = 0.2; v < 1; v += 0.2) {
          const p0 = P(0, v), p1 = P(1, v);
          g.beginPath(); g.moveTo(p0[0], p0[1]); g.lineTo(p1[0], p1[1]); g.stroke();
        }
      } else if (o.stripes) {
        g.fillStyle = "#b8452f";
        for (let u = 0.12; u < 0.9; u += 0.3) quad(g, P(u, 0.2), P(u + 0.12, 0.2), P(u + 0.12, 0.8), P(u, 0.8));
      } else if (o.planks) {
        g.strokeStyle = "rgba(0,0,0,0.35)";
        const p0 = P(0, 0), p1 = P(1, 1), p2 = P(1, 0), p3 = P(0, 1);
        g.beginPath(); g.moveTo(p0[0], p0[1]); g.lineTo(p1[0], p1[1]); g.moveTo(p2[0], p2[1]); g.lineTo(p3[0], p3[1]); g.stroke();
      }
    }
    // roof / top face: the footprint rectangle scaled about the camera point
    g.drawImage(o.top, top[0][0], top[0][1], top[2][0] - top[0][0], top[2][1] - top[0][1]);
    if (o.building) {
      g.strokeStyle = "rgba(255,255,255,0.08)";
      g.lineWidth = 2;
      g.strokeRect(top[0][0], top[0][1], top[2][0] - top[0][0], top[2][1] - top[0][1]);
    }
  }

  _windows(g, o, side, P, len, emissive) {
    const floors = o.floors;
    const cols = Math.max(2, Math.floor(len / 26));
    let seed = (o.seed + side * 977) % 2147483647;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let f = 0; f < floors; f++) {
      const v0 = 0.1 + (f / floors) * 0.86, v1 = v0 + (0.86 / floors) * 0.55;
      for (let c = 0; c < cols; c++) {
        const u0 = (c + 0.25) / cols, u1 = (c + 0.75) / cols;
        const r = rnd();
        const q = [P(u0, v0), P(u1, v0), P(u1, v1), P(u0, v1)];
        const lit = r < 0.12;
        if (lit) emissive.push({ q, warm: rnd() < 0.7 });
        g.fillStyle = lit ? "#3a3020" : r < 0.2 ? "rgba(10,10,10,0.9)" : "rgba(20,26,32,0.85)";
        quad(g, ...q);
      }
    }
  }

  _drawCyl(g, o, cx, cy) {
    const k = lift(o.H);
    const tx = o.x + (o.x - cx) * k, ty = o.y + (o.y - cy) * k, tr = o.r * (1 + k);
    const dx = tx - o.x, dy = ty - o.y, d = Math.hypot(dx, dy) || 1;
    const px = -dy / d, py = dx / d;
    g.fillStyle = o.side;
    g.beginPath(); g.arc(o.x, o.y, o.r, 0, TAU); g.fill();
    g.beginPath();
    g.moveTo(o.x + px * o.r, o.y + py * o.r); g.lineTo(tx + px * tr, ty + py * tr);
    g.lineTo(tx - px * tr, ty - py * tr); g.lineTo(o.x - px * o.r, o.y - py * o.r);
    g.closePath(); g.fill();
    g.strokeStyle = "rgba(0,0,0,0.35)";
    g.lineWidth = 2;
    const a0 = Math.atan2(py, px);
    for (const v of [0.33, 0.66]) {
      g.beginPath(); g.arc(o.x + dx * v, o.y + dy * v, o.r * (1 + k * v), a0, a0 + Math.PI, true); g.stroke();
    }
    g.fillStyle = o.top;
    g.beginPath(); g.arc(tx, ty, tr, 0, TAU); g.fill();
    g.strokeStyle = o.rim;
    g.beginPath(); g.arc(tx, ty, tr * 0.65, 0, TAU); g.stroke();
  }

  _drawLamp(g, L, cx, cy) {
    const top = project(L.x, L.y, L.H, cx, cy);
    g.strokeStyle = "#1d1f21";
    g.lineWidth = 4;
    g.beginPath(); g.moveTo(L.x, L.y); g.lineTo(top.x, top.y); g.stroke();
    g.fillStyle = "#2a2c2e";
    g.beginPath(); g.arc(top.x, top.y, 7, 0, TAU); g.fill();
    if (!L.broken) {
      g.fillStyle = "#ffe2a8";
      g.beginPath(); g.arc(top.x, top.y, 3.5, 0, TAU); g.fill();
    }
    L.top = top;
  }

  _drawTree(g, T, cx, cy, t) {
    const trunkTop = project(T.x, T.y, T.H * 0.55, cx, cy);
    g.strokeStyle = "#4a3523";
    g.lineWidth = 9;
    g.lineCap = "round";
    g.beginPath(); g.moveTo(T.x, T.y); g.lineTo(trunkTop.x, trunkTop.y); g.stroke();
    const sway = Math.sin(t * 0.8 + T.x) * 2;
    // two canopy layers at different heights give the crown volume
    const dark = T.hue < 0.5 ? "rgba(32,56,30,0.85)" : "rgba(44,64,32,0.85)";
    const light = T.hue < 0.5 ? "rgba(48,80,42,0.85)" : "rgba(62,88,44,0.85)";
    for (const [hf, rf, col] of [[0.75, 1, dark], [1, 0.72, light]]) {
      const c = project(T.x + sway, T.y, T.H * hf, cx, cy);
      g.fillStyle = col;
      g.beginPath(); g.arc(c.x, c.y, T.r * rf * (1 + lift(T.H * hf)), 0, TAU); g.fill();
    }
    const hi = project(T.x - T.r * 0.3 + sway, T.y - T.r * 0.3, T.H, cx, cy);
    g.fillStyle = "rgba(110,140,70,0.35)";
    g.beginPath(); g.arc(hi.x, hi.y, T.r * 0.35, 0, TAU); g.fill();
  }

  /** Lit windows glow on top of the night darkness. */
  drawEmissive(g, emissive) {
    g.globalCompositeOperation = "lighter";
    for (const e of emissive) {
      g.fillStyle = e.warm ? "rgba(255,190,90,0.55)" : "rgba(150,200,255,0.4)";
      quad(g, ...e.q);
    }
    g.globalCompositeOperation = "source-over";
  }
}

function quad(g, a, b, c, d) {
  g.beginPath();
  g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.lineTo(c[0], c[1]); g.lineTo(d[0], d[1]);
  g.closePath();
  g.fill();
}

function shadeCss(color, amt) {
  if (!color.startsWith("#")) {
    const m = color.match(/\d+/g).map(Number);
    const c = (v) => clamp(v + amt, 0, 255);
    return `rgb(${c(m[0])},${c(m[1])},${c(m[2])})`;
  }
  return shadeHex(color, amt);
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  if (g.roundRect) g.roundRect(x, y, w, h, r);
  else g.rect(x, y, w, h);
}

function shadeHex(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const c = (v) => clamp(v + amt, 0, 255);
  return `rgb(${c(n >> 16)},${c((n >> 8) & 255)},${c(n & 255)})`;
}
