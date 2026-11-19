// Zombie archetypes and wave composition.

export const ZOMBIES = {
  walker: { name: "Walker", hp: 30, speed: 72, damage: 10, r: 15, scrap: 3, xp: 1, color: "#6f9e4a", minWave: 1, weight: 10 },
  runner: { name: "Runner", hp: 18, speed: 155, damage: 7, r: 12, scrap: 3, xp: 1, color: "#b8c955", minWave: 3, weight: 6 },
  exploder: { name: "Bloater", hp: 34, speed: 100, damage: 0, r: 17, scrap: 5, xp: 2, color: "#d08a3c", minWave: 4, weight: 3,
    explode: { radius: 90, damage: 28 } },
  brute: { name: "Brute", hp: 240, speed: 52, damage: 26, r: 26, scrap: 14, xp: 5, color: "#4f6b3a", minWave: 5, weight: 2 },
  spitter: { name: "Spitter", hp: 42, speed: 64, damage: 0, r: 14, scrap: 7, xp: 3, color: "#7ac9a3", minWave: 7, weight: 2.5,
    ranged: { range: 330, cooldown: 2.2, projectileSpeed: 300, damage: 12 } },
  stalker: { name: "Stalker", hp: 70, speed: 120, damage: 14, r: 14, scrap: 9, xp: 4, color: "#6b5b8f", minWave: 10, weight: 2,
    dash: { cooldown: 3.5, speed: 520, duration: 0.35 } },
  boss: { name: "Abomination", hp: 1200, speed: 58, damage: 34, r: 52, scrap: 220, xp: 60, color: "#8e3b3b", minWave: 5, weight: 0,
    boss: true, summon: { cooldown: 5, count: 4 }, charge: { cooldown: 6, speed: 380, duration: 0.9 } },
};

export const BOSS_EVERY = 5;

/** Health multiplier for a wave: grows steadily so upgrades stay necessary. */
export function hpScale(wave) {
  return 1 + 0.12 * (wave - 1) + 0.0035 * (wave - 1) ** 2;
}

export function speedScale(wave) {
  return 1 + Math.min(0.35, 0.012 * (wave - 1));
}

/** How many zombies a wave spawns (boss not included). */
export function waveSize(wave) {
  return Math.round(10 + wave * 4 + wave ** 1.3);
}

/** Zombie types that can appear in a wave, with spawn weights. */
export function wavePool(wave) {
  return Object.entries(ZOMBIES)
    .filter(([, z]) => !z.boss && wave >= z.minWave)
    .map(([type, z]) => ({ type, weight: z.weight * (type === "walker" ? Math.max(0.35, 1 - wave * 0.04) : 1) }));
}

export function isBossWave(wave) {
  return wave % BOSS_EVERY === 0;
}
