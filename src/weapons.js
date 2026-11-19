// Weapon catalogue + stat scaling. Stats are recomputed from (base, level, player modifiers).

export const MAX_WEAPON_LEVEL = 10;

/**
 * kind:
 *   bullet  - travelling projectile
 *   rocket  - projectile that explodes on impact
 *   flame   - short-lived cone particles that set zombies on fire
 *   tesla   - instant chain lightning between nearby zombies
 */
export const WEAPONS = [
  { id: "pistol", name: "Pistol", price: 0, kind: "bullet", color: "#ffe9a8",
    damage: 14, fireRate: 3.2, mag: 12, reload: 1.0, speed: 760, spread: 0.04, pellets: 1, pierce: 0, range: 650,
    desc: "Reliable sidearm. Never runs out of charm." },
  { id: "smg", name: "SMG", price: 150, kind: "bullet", color: "#ffd27a",
    damage: 8, fireRate: 11, mag: 32, reload: 1.4, speed: 720, spread: 0.13, pellets: 1, pierce: 0, range: 560,
    desc: "Sprays lead. Great against crowds of walkers." },
  { id: "shotgun", name: "Shotgun", price: 320, kind: "bullet", color: "#ffb36b",
    damage: 10, fireRate: 1.5, mag: 6, reload: 1.8, speed: 680, spread: 0.38, pellets: 7, pierce: 0, range: 380,
    desc: "7 pellets per shell. Devastating up close." },
  { id: "rifle", name: "Assault Rifle", price: 650, kind: "bullet", color: "#fff1b8",
    damage: 19, fireRate: 8, mag: 30, reload: 1.6, speed: 900, spread: 0.06, pellets: 1, pierce: 1, range: 720,
    desc: "Accurate full-auto. Each round pierces one zombie." },
  { id: "sniper", name: "Sniper", price: 1000, kind: "bullet", color: "#d8f3ff",
    damage: 140, fireRate: 1.1, mag: 5, reload: 2.0, speed: 1700, spread: 0.005, pellets: 1, pierce: 6, range: 1300,
    desc: "One shot, a whole line of corpses. Pierces 6." },
  { id: "flamer", name: "Flamethrower", price: 1500, kind: "flame", color: "#ff8a2a",
    damage: 6, fireRate: 26, mag: 120, reload: 2.4, speed: 420, spread: 0.32, pellets: 1, pierce: 99, range: 260,
    desc: "Short range, burns everything. Fire spreads damage over time." },
  { id: "minigun", name: "Minigun", price: 2200, kind: "bullet", color: "#ffe08a",
    damage: 12, fireRate: 24, mag: 200, reload: 3.2, speed: 820, spread: 0.17, pellets: 1, pierce: 0, range: 640,
    slow: 0.35, desc: "Unstoppable wall of bullets. You move slower while firing." },
  { id: "rocket", name: "Rocket Launcher", price: 3200, kind: "rocket", color: "#ff6b4a",
    damage: 90, fireRate: 1.0, mag: 4, reload: 2.2, speed: 520, spread: 0.02, pellets: 1, pierce: 0, range: 900,
    blast: 120, desc: "Big boom. Explosion damages everything in 120 px." },
  { id: "tesla", name: "Tesla Coil", price: 4500, kind: "tesla", color: "#8fd8ff",
    damage: 34, fireRate: 4, mag: 40, reload: 1.8, speed: 0, spread: 0, pellets: 1, pierce: 0, range: 420,
    chains: 5, desc: "Lightning jumps between up to 5 zombies instantly." },
  { id: "plasma", name: "Plasma Cannon", price: 7000, kind: "rocket", color: "#c58bff",
    damage: 60, fireRate: 5, mag: 36, reload: 1.6, speed: 980, spread: 0.03, pellets: 1, pierce: 4, range: 900,
    blast: 70, desc: "Endgame tech. Piercing plasma bolts that burst on every hit." },
];

export const WEAPON_BY_ID = Object.fromEntries(WEAPONS.map((w) => [w.id, w]));

/** Price of upgrading a weapon from `level` to `level + 1`. */
export function upgradeCost(def, level) {
  const base = Math.round(def.price * 0.3 + 45);
  return Math.round(base * Math.pow(1.5, level - 1));
}

/**
 * Effective stats for a weapon at a given level with the player's modifiers.
 * mods: { damage, fireRate, reload, mag, projectiles, pierce, crit } (multipliers / additive bonuses)
 */
export function weaponStats(def, level, mods) {
  const lv = level - 1;
  const pellets = def.pellets + (def.kind === "bullet" || def.kind === "rocket" ? mods.projectiles : 0);
  return {
    ...def,
    level,
    damage: def.damage * (1 + 0.15 * lv) * mods.damage,
    fireRate: def.fireRate * (1 + 0.04 * lv) * mods.fireRate,
    mag: Math.round(def.mag * (1 + 0.1 * lv)),
    reload: def.reload * Math.pow(0.96, lv) * mods.reload,
    pellets,
    pierce: def.pierce + mods.pierce,
    chains: (def.chains || 0) + Math.floor(lv / 3),
    blast: def.blast ? def.blast * (1 + 0.04 * lv) : 0,
    crit: mods.crit,
  };
}

/** Rough damage-per-second figure for the shop UI. */
export function dps(stats) {
  const perShot = stats.damage * stats.pellets * (stats.kind === "tesla" ? Math.min(3, stats.chains) : 1);
  const cycle = stats.mag / stats.fireRate + stats.reload;
  return (perShot * stats.mag) / cycle;
}
