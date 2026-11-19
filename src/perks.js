// Run perks (chosen on level-up) and permanent Lab upgrades (bought with DNA between runs).

/** Player modifiers start from these and are changed by perks and lab upgrades. */
export function baseMods() {
  return {
    damage: 1, fireRate: 1, reload: 1, moveSpeed: 1, maxHp: 100, regen: 0, crit: 0.05,
    projectiles: 0, pierce: 0, magnet: 1, scrapGain: 1, xpGain: 1, lifeOnKill: 0, armor: 0,
    blades: 0, drones: 0, frost: 0, explosiveChance: 0, dashCooldown: 2.2,
  };
}

export const PERKS = [
  { id: "hollow", name: "Hollow Points", icon: "🩸", rarity: "common", max: 10, desc: "+15% damage", apply: (m) => { m.damage *= 1.15; } },
  { id: "trigger", name: "Trigger Finger", icon: "👆", rarity: "common", max: 8, desc: "+10% fire rate", apply: (m) => { m.fireRate *= 1.1; } },
  { id: "hands", name: "Quick Hands", icon: "✋", rarity: "common", max: 6, desc: "Reload 18% faster", apply: (m) => { m.reload *= 0.82; } },
  { id: "boots", name: "Running Shoes", icon: "👟", rarity: "common", max: 5, desc: "+8% move speed", apply: (m) => { m.moveSpeed *= 1.08; } },
  { id: "skin", name: "Thick Skin", icon: "🛡️", rarity: "common", max: 10, desc: "+25 max HP and heal 25", apply: (m) => { m.maxHp += 25; }, heal: 25 },
  { id: "magnet", name: "Magnet", icon: "🧲", rarity: "common", max: 5, desc: "+40% pickup range", apply: (m) => { m.magnet *= 1.4; } },
  { id: "greed", name: "Scavenger", icon: "🔩", rarity: "common", max: 6, desc: "+20% scrap from zombies", apply: (m) => { m.scrapGain *= 1.2; } },
  { id: "regen", name: "Regeneration", icon: "💚", rarity: "rare", max: 5, desc: "Regenerate 1.5 HP per second", apply: (m) => { m.regen += 1.5; } },
  { id: "crit", name: "Lucky Shot", icon: "🍀", rarity: "rare", max: 6, desc: "+8% chance to deal double damage", apply: (m) => { m.crit += 0.08; } },
  { id: "vamp", name: "Bloodlust", icon: "🧛", rarity: "rare", max: 5, desc: "Heal 1 HP per kill", apply: (m) => { m.lifeOnKill += 1; } },
  { id: "armor", name: "Kevlar", icon: "🦺", rarity: "rare", max: 5, desc: "Take 8% less damage", apply: (m) => { m.armor = 1 - (1 - m.armor) * 0.92; } },
  { id: "frost", name: "Frost Rounds", icon: "❄️", rarity: "rare", max: 3, desc: "Hits slow zombies by 30% for 1.5 s", apply: (m) => { m.frost += 1; } },
  { id: "pierce", name: "Penetrator", icon: "📌", rarity: "epic", max: 4, desc: "Bullets pierce +1 zombie", apply: (m) => { m.pierce += 1; } },
  { id: "blades", name: "Orbiting Blades", icon: "🌀", rarity: "epic", max: 6, desc: "+1 blade circling you, shredding zombies", apply: (m) => { m.blades += 1; } },
  { id: "drone", name: "Combat Drone", icon: "🛸", rarity: "epic", max: 4, desc: "+1 drone that shoots the nearest zombie", apply: (m) => { m.drones += 1; } },
  { id: "boom", name: "Explosive Rounds", icon: "💣", rarity: "epic", max: 4, desc: "+10% chance for hits to explode", apply: (m) => { m.explosiveChance += 0.1; } },
  { id: "multi", name: "Split Shot", icon: "🔱", rarity: "legendary", max: 3, desc: "+1 projectile per shot", apply: (m) => { m.projectiles += 1; } },
  { id: "dash", name: "Phase Step", icon: "💨", rarity: "legendary", max: 3, desc: "Dash cooldown −30%", apply: (m) => { m.dashCooldown *= 0.7; } },
];

export const RARITY_WEIGHT = { common: 60, rare: 26, epic: 11, legendary: 3 };

/** Pick `n` distinct perks the player can still take, weighted by rarity. */
export function rollPerks(taken, n = 3, luck = 0) {
  const pool = PERKS.filter((p) => (taken[p.id] || 0) < p.max).map((p) => ({
    perk: p,
    weight: RARITY_WEIGHT[p.rarity] * (p.rarity === "common" ? 1 : 1 + luck),
  }));
  const out = [];
  while (out.length < n && pool.length) {
    const total = pool.reduce((s, x) => s + x.weight, 0);
    let r = Math.random() * total;
    const idx = pool.findIndex((x) => (r -= x.weight) <= 0);
    out.push(pool.splice(idx === -1 ? pool.length - 1 : idx, 1)[0].perk);
  }
  return out;
}

/** XP required to go from `level` to `level + 1`. */
export function xpForLevel(level) {
  return Math.round(6 + level * 5 + level ** 1.6);
}

// ---------------------------------------------------------------- permanent lab upgrades
export const LAB = [
  { id: "vitality", name: "Vitality Serum", icon: "❤️", max: 10, cost: (l) => 20 + l * 15, desc: "+10 starting max HP",
    apply: (m, l) => { m.maxHp += 10 * l; } },
  { id: "firepower", name: "Firepower", icon: "🔥", max: 10, cost: (l) => 25 + l * 20, desc: "+5% damage",
    apply: (m, l) => { m.damage *= 1 + 0.05 * l; } },
  { id: "salvage", name: "Salvage Expert", icon: "🔩", max: 10, cost: (l) => 20 + l * 15, desc: "+8% scrap",
    apply: (m, l) => { m.scrapGain *= 1 + 0.08 * l; } },
  { id: "learning", name: "Fast Learner", icon: "📘", max: 10, cost: (l) => 20 + l * 15, desc: "+8% XP",
    apply: (m, l) => { m.xpGain *= 1 + 0.08 * l; } },
  { id: "budget", name: "War Chest", icon: "💰", max: 10, cost: (l) => 15 + l * 12, desc: "+60 starting scrap",
    startScrap: (l) => 60 * l },
  { id: "luck", name: "Rare Genes", icon: "🧬", max: 5, cost: (l) => 40 + l * 35, desc: "Rarer perks appear more often",
    luck: (l) => 0.25 * l },
  { id: "agility", name: "Agility", icon: "🏃", max: 5, cost: (l) => 30 + l * 25, desc: "+4% move speed",
    apply: (m, l) => { m.moveSpeed *= 1 + 0.04 * l; } },
  { id: "arsenal", name: "Arsenal Access", icon: "🗝️", max: 3, cost: (l) => 60 + l * 60, desc: "Start each run with a better weapon (SMG → Shotgun → Rifle)",
    startWeapon: (l) => ["pistol", "smg", "shotgun", "rifle"][l] },
];

export function labLevel(save, id) {
  return save.lab[id] || 0;
}

/** DNA earned at the end of a run. */
export function dnaForRun(wave, kills, bossesKilled) {
  return Math.floor(wave * 4 + kills / 12 + bossesKilled * 25);
}
