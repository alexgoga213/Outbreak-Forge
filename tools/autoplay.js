// Headless play-testing bot. Open the game, then in the browser console:
//   const { autoplay } = await import('./tools/autoplay.js');
//   await autoplay(window.__game, { seconds: 900 });
// It aims at the nearest zombie, kites away, spends scrap in the shop and takes the first perk offered.
// Used to balance waves and economy and to catch runtime errors without playing by hand.

import { WEAPONS } from "../src/weapons.js";

function botStep(g) {
  let best = null, bd = Infinity, nearest = Infinity;
  for (const z of g.zombies) {
    const d = (z.x - g.player.x) ** 2 + (z.y - g.player.y) ** 2;
    nearest = Math.min(nearest, d);
    if (d < bd && z.los) { bd = d; best = z; } // only shoot at zombies we can actually see
  }
  bd = Math.min(bd, nearest);
  const v = g.view;
  const tx = best ? best.x : g.player.x + 100, ty = best ? best.y : g.player.y;
  g.input.mouse.x = (tx - g.cam.x) * v.zoom + v.w / 2;
  g.input.mouse.y = (ty - g.cam.y) * v.zoom + v.h / 2;
  g.input.mouse.down = !!best;
  g.input.keys.clear();
  if (best && bd < 240 * 240) {
    g.input.keys.add(g.player.x > best.x ? "d" : "a");
    g.input.keys.add(g.player.y > best.y ? "s" : "w");
    if (bd < 60 * 60) g.input.pressed.add("shift");
  }
  const p = g.player;
  if (p.x < 300) { g.input.keys.delete("a"); g.input.keys.add("d"); }
  if (p.x > 2100) { g.input.keys.delete("d"); g.input.keys.add("a"); }
  if (p.y < 300) { g.input.keys.delete("w"); g.input.keys.add("s"); }
  if (p.y > 2100) { g.input.keys.delete("s"); g.input.keys.add("w"); }
}

function shopBot(g) {
  const r = g.run;
  const buyable = WEAPONS.filter((w) => !r.owned[w.id] && r.scrap >= w.price && w.price > 0).sort((a, b) => b.price - a.price);
  if (buyable.length) g.buyWeapon(buyable[0].id);
  for (let i = 0; i < 20 && g.upgradeWeapon(r.current); i++);
  if (g.player.hp < g.mods.maxHp * 0.5) g.buyHeal();
}

export async function autoplay(g, { seconds = 900, dt = 1 / 60 } = {}) {
  const log = [];
  let t = 0;
  if (g.state === "menu" || g.state === "gameover") g.start();
  while (t < seconds && g.state !== "gameover") {
    if (g.state === "playing") {
      botStep(g);
      g.update(dt);
      g.input.endFrame();
      t += dt;
    } else if (g.state === "levelup") g.choosePerk(g.perkChoices[0]);
    else if (g.state === "shop") {
      log.push({ wave: g.run.wave, hp: Math.round(g.player.hp), maxHp: g.mods.maxHp, scrap: g.run.scrap, level: g.run.level,
        weapon: `${g.run.current}:${g.run.owned[g.run.current]}`, time: Math.round(g.run.time) });
      shopBot(g);
      g.nextWave();
    } else if (g.state === "paused") g.setState("playing");
    else break;
  }
  return { simulated: Math.round(t), state: g.state, wave: g.run.wave, kills: g.run.kills, result: g.lastRun, log };
}
