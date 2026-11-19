// Flow-field pathfinding: one breadth-first search from the player's cell gives EVERY zombie
// its shortest route around buildings and wrecks. Cost is O(cells) per update, independent of
// how many zombies there are, so a horde of 140 is as cheap as a single zombie.

const DIRS = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, 1.414], [1, -1, 1.414], [-1, 1, 1.414], [-1, -1, 1.414],
];

export class FlowField {
  /**
   * @param city   City with blocked(x, y, pad)
   * @param size   world size in px
   * @param cell   grid resolution in px
   * @param pad    clearance radius: cells closer than this to an obstacle are not walkable
   */
  constructor(city, size, cell, pad) {
    this.cell = cell;
    this.n = Math.ceil(size / cell);
    const N = this.n * this.n;
    this.walkable = new Uint8Array(N);
    for (let gy = 0; gy < this.n; gy++) {
      for (let gx = 0; gx < this.n; gx++) {
        const x = (gx + 0.5) * cell, y = (gy + 0.5) * cell;
        this.walkable[gy * this.n + gx] = city.blocked(x, y, pad) ? 0 : 1;
      }
    }
    this.dist = new Float32Array(N);
    this.queue = new Int32Array(N * 2);
    this.target = -1;
  }

  index(x, y) {
    const gx = Math.min(this.n - 1, Math.max(0, Math.floor(x / this.cell)));
    const gy = Math.min(this.n - 1, Math.max(0, Math.floor(y / this.cell)));
    return gy * this.n + gx;
  }

  isWalkable(x, y) {
    return this.walkable[this.index(x, y)] === 1;
  }

  /** Recompute distances from the target position (Dijkstra-lite: BFS with diagonal costs). */
  update(tx, ty) {
    const n = this.n, dist = this.dist, walk = this.walkable;
    let start = this.index(tx, ty);
    if (!walk[start]) start = this._nearestWalkable(start);
    if (start === this.target) return;
    this.target = start;
    dist.fill(Infinity);
    dist[start] = 0;
    const q = this.queue;
    let head = 0, tail = 0;
    q[tail++] = start;
    while (head < tail) {
      const i = q[head++];
      if (head > q.length - 8) break;
      const x = i % n, y = (i / n) | 0, d0 = dist[i];
      for (const [dx, dy, c] of DIRS) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue;
        const j = ny * n + nx;
        if (!walk[j]) continue;
        if (dx && dy && (!walk[y * n + nx] || !walk[ny * n + x])) continue; // no corner cutting
        const nd = d0 + c;
        if (nd < dist[j] - 1e-6) {
          dist[j] = nd;
          if (tail < q.length) q[tail++] = j;
        }
      }
    }
  }

  _nearestWalkable(i) {
    const n = this.n, x0 = i % n, y0 = (i / n) | 0;
    for (let r = 1; r < 6; r++) {
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        const x = x0 + dx, y = y0 + dy;
        if (x >= 0 && y >= 0 && x < n && y < n && this.walkable[y * n + x]) return y * n + x;
      }
    }
    return i;
  }

  /** Unit vector pointing downhill (towards the target) from world position (x, y), or null. */
  direction(x, y) {
    const n = this.n, i = this.index(x, y);
    const gx = i % n, gy = (i / n) | 0;
    let best = this.dist[i], bx = 0, by = 0;
    for (const [dx, dy] of DIRS) {
      const nx = gx + dx, ny = gy + dy;
      if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue;
      const d = this.dist[ny * n + nx];
      if (d < best) {
        best = d;
        bx = dx;
        by = dy;
      }
    }
    if (bx === 0 && by === 0) return null;
    // aim at the centre of the next cell for smoother motion
    const tx = (gx + bx + 0.5) * this.cell - x, ty = (gy + by + 0.5) * this.cell - y;
    const len = Math.hypot(tx, ty) || 1;
    return { x: tx / len, y: ty / len };
  }
}
