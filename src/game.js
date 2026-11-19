// Core game: simulation (update) and drawing (render). UI screens live in ui.js.

import { BOSS_EVERY, ZOMBIES, hpScale, isBossWave, speedScale, wavePool, waveSize } from "./zombies.js";
import { LAB, PERKS, baseMods, dnaForRun, labLevel, rollPerks, xpForLevel } from "./perks.js";
import { MAX_WEAPON_LEVEL, WEAPONS, WEAPON_BY_ID, upgradeCost, weaponStats } from "./weapons.js";
import { SpatialGrid, TAU, angleTo, chance, clamp, dist2, fmt, fmtTime, lerp, rand, weightedPick } from "./util.js";
import { writeSave } from "./save.js";
import { City, lift, project } from "./city.js";
import { FlowField } from "./pathfinding.js";
import { drawPlayer, drawZombie, rollLook } from "./characters.js";
import { Lighting } from "./lighting.js";
import { drawIcon, drawWeapon } from "./weaponArt.js";

export const WORLD = 2400;
const MAX_ALIVE = 140;
const PERK_BY_ID = Object.fromEntries(PERKS.map((p) => [p.id, p]));

export class Game {
  constructor(canvas, input, audio, save) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.input = input;
    this.audio = audio;
    this.save = save;
    this.state = "menu";
    this.grid = new SpatialGrid(96);
    this._near = [];
    this.view = { w: 1, h: 1, zoom: 1 };
    this.cam = { x: WORLD / 2, y: WORLD / 2, shake: 0 };
    this.onStateChange = () => {};
    this.lighting = new Lighting();
    this.muzzleT = 0;
    this.menuT = 0;
    this.recoil = 0; // 0..1, drives the HUD weapon kick
    this.spin = 0; // minigun barrel rotation
    this.spinSpeed = 0;
    this.decals = document.createElement("canvas");
    this.decals.width = this.decals.height = WORLD;
    this.dctx = this.decals.getContext("2d");
    this.newRun(); // idle run behind the menu
    this.state = "menu";
  }

  // ------------------------------------------------------------------ run lifecycle
  newRun() {
    const startWeapon = LAB.find((l) => l.id === "arsenal").startWeapon(labLevel(this.save, "arsenal"));
    this.run = {
      wave: 0, time: 0, kills: 0, bossesKilled: 0, level: 1, xp: 0, pendingLevels: 0,
      scrap: LAB.find((l) => l.id === "budget").startScrap(labLevel(this.save, "budget")),
      perks: {}, owned: { pistol: 1 }, ammo: {}, current: "pistol", reloading: 0,
      fireCd: 0, toSpawn: 0, spawnCd: 0, bossPending: false, waveClearTimer: -1, damageDealt: 0,
    };
    if (startWeapon !== "pistol") {
      this.run.owned[startWeapon] = 1;
      this.run.current = startWeapon;
    }
    this.luck = LAB.find((l) => l.id === "luck").luck(labLevel(this.save, "luck"));
    this.player = { x: WORLD / 2, y: WORLD / 2, r: 16, hp: 100, angle: 0, invuln: 0, dashCd: 0, dashT: 0,
      dashX: 0, dashY: 0, droneCd: [], bladeAngle: 0, hurtFlash: 0 };
    this.boss = null;
    this.afterPerks = "playing";
    this.zombies = [];
    this.bullets = [];
    this.enemyShots = [];
    this.pickups = [];
    this.particles = [];
    this.texts = [];
    this.arcs = [];
    this.rings = [];
    this.dctx.clearRect(0, 0, WORLD, WORLD);
    // a fresh city every run + flow fields for small and large zombies
    this.city = new City(WORLD);
    this.flowSmall = new FlowField(this.city, WORLD, 30, 15);
    this.flowBig = new FlowField(this.city, WORLD, 30, 30);
    this.flowTimer = 0;
    this.recomputeMods();
    this.player.hp = this.mods.maxHp;
    for (const id of Object.keys(this.run.owned)) this.run.ammo[id] = this.stats(id).mag;
    this.cam.x = this.player.x;
    this.cam.y = this.player.y;
  }

  start() {
    this.newRun();
    this.save.runs += 1;
    this.setState("playing");
    this.nextWave();
  }

  setState(s) {
    this.state = s;
    this.onStateChange(s);
  }

  recomputeMods() {
    const m = baseMods();
    for (const lab of LAB) {
      const lv = labLevel(this.save, lab.id);
      if (lv && lab.apply) lab.apply(m, lv);
    }
    for (const [id, count] of Object.entries(this.run.perks)) {
      for (let i = 0; i < count; i++) PERK_BY_ID[id].apply(m);
    }
    this.mods = m;
    if (this.player) this.player.hp = Math.min(this.player.hp, m.maxHp);
  }

  stats(id) {
    return weaponStats(WEAPON_BY_ID[id], this.run.owned[id] || 1, this.mods);
  }

  nextWave() {
    const r = this.run;
    r.wave += 1;
    r.toSpawn = waveSize(r.wave);
    r.spawnCd = 1.0;
    r.bossPending = isBossWave(r.wave);
    r.waveClearTimer = -1;
    this.toast(r.bossPending ? `Wave ${r.wave}: BOSS INCOMING` : `Wave ${r.wave}`);
    this.audio.waveStart(r.bossPending);
    this.setState("playing");
  }

  endRun() {
    const r = this.run;
    const dna = dnaForRun(r.wave, r.kills, r.bossesKilled);
    const s = this.save;
    s.dna += dna;
    s.totalKills += r.kills;
    const newBest = r.wave > s.best.wave;
    s.best = { wave: Math.max(s.best.wave, r.wave), kills: Math.max(s.best.kills, r.kills), time: Math.max(s.best.time, r.time) };
    writeSave(s);
    this.lastRun = { wave: r.wave, kills: r.kills, time: r.time, level: r.level, dna, newBest, bosses: r.bossesKilled,
      damage: r.damageDealt };
    this.setState("gameover");
  }

  // ------------------------------------------------------------------ shop actions (called by the UI)
  buyWeapon(id) {
    const def = WEAPON_BY_ID[id];
    if (this.run.owned[id] || this.run.scrap < def.price) return false;
    this.run.scrap -= def.price;
    this.run.owned[id] = 1;
    this.run.ammo[id] = this.stats(id).mag;
    this.run.current = id;
    this.audio.buy();
    return true;
  }

  upgradeWeapon(id) {
    const lv = this.run.owned[id];
    if (!lv || lv >= MAX_WEAPON_LEVEL) return false;
    const cost = upgradeCost(WEAPON_BY_ID[id], lv);
    if (this.run.scrap < cost) return false;
    this.run.scrap -= cost;
    this.run.owned[id] = lv + 1;
    this.run.ammo[id] = this.stats(id).mag;
    this.audio.buy();
    return true;
  }

  healCost() {
    return 30 + this.run.wave * 8;
  }

  buyHeal() {
    const cost = this.healCost();
    if (this.run.scrap < cost || this.player.hp >= this.mods.maxHp) return false;
    this.run.scrap -= cost;
    this.player.hp = Math.min(this.mods.maxHp, this.player.hp + this.mods.maxHp * 0.5);
    this.audio.buy();
    return true;
  }

  equip(id) {
    if (!this.run.owned[id] || this.run.current === id) return;
    this.run.current = id;
    this.run.reloading = 0;
  }

  choosePerk(perk) {
    this.run.perks[perk.id] = (this.run.perks[perk.id] || 0) + 1;
    this.recomputeMods();
    if (perk.heal) this.player.hp = Math.min(this.mods.maxHp, this.player.hp + perk.heal);
    this.run.pendingLevels -= 1;
    if (this.run.pendingLevels > 0) this.offerPerks();
    else this.setState(this.afterPerks);
  }

  offerPerks() {
    this.perkChoices = rollPerks(this.run.perks, 3, this.luck);
    this.audio.levelUp();
    this.setState("levelup");
  }

  // ------------------------------------------------------------------ helpers
  toast(msg) {
    this.onToast?.(msg);
  }

  screenToWorld(sx, sy) {
    const { w, h, zoom } = this.view;
    return { x: (sx - w / 2) / zoom + this.cam.x, y: (sy - h / 2) / zoom + this.cam.y };
  }

  shake(amount) {
    this.cam.shake = Math.min(18, this.cam.shake + amount);
  }

  floatText(x, y, text, color = "#fff", size = 14) {
    if (this.texts.length > 120) return;
    this.texts.push({ x, y, text, color, size, life: 0.8, vy: -40 });
  }

  burst(x, y, color, n = 8, speed = 160, life = 0.5, size = 3, up = 0) {
    for (let i = 0; i < n && this.particles.length < 900; i++) {
      const a = rand(0, TAU), s = rand(0.3, 1) * speed;
      const q = { x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rand(0.5, 1) * life, max: life, color, size };
      if (up) { q.z = rand(2, 10); q.vz = rand(0.4, 1) * up; q.life = q.max = life * 1.6; }
      this.particles.push(q);
    }
  }

  /** Offset that makes things at height `h` lean away from the camera (fake 3D). */
  lean(o, h = 34) {
    const k = lift(h);
    return { x: (o.x - this.cam.x) * k, y: (o.y - this.cam.y) * k };
  }

  splat(x, y, r, color = "rgba(90,20,20,0.55)") {
    const d = this.dctx;
    d.fillStyle = color;
    for (let i = 0; i < 6; i++) {
      d.beginPath();
      d.arc(x + rand(-r, r), y + rand(-r, r), rand(r * 0.25, r * 0.7), 0, TAU);
      d.fill();
    }
  }

  // ------------------------------------------------------------------ main update
  update(dt) {
    if (this.state !== "playing") {
      this.audio.flame(false);
      this.audio.motor(0);
      this.updateEffects(dt * (this.state === "menu" ? 1 : 0));
      return;
    }
    this.audio.setListener(this.player.x, this.player.y);
    const r = this.run;
    r.time += dt;
    this.handleInput(dt);
    this.updateSpawning(dt);

    this.grid.clear();
    for (const z of this.zombies) this.grid.insert(z);

    this.flowTimer -= dt;
    if (this.flowTimer <= 0) {
      this.flowTimer = 0.25;
      this.flowSmall.update(this.player.x, this.player.y);
      this.flowBig.update(this.player.x, this.player.y);
    }
    this.muzzleT -= dt;
    this.recoil = Math.max(0, this.recoil - dt * 7);
    const firingMinigun = this.run.current === "minigun" && this.input.mouse.down && this.run.reloading <= 0;
    this.spinSpeed = lerp(this.spinSpeed, firingMinigun ? 40 : 0, Math.min(1, dt * 3));
    this.spin += this.spinSpeed * dt;
    this.audio.motor(this.spinSpeed / 40);
    this.audio.flame(this.run.current === "flamer" && this.input.mouse.down && this.run.reloading <= 0
      && (this.run.ammo.flamer ?? 1) > 0);

    this.updatePlayer(dt);
    this.updateWeapon(dt);
    this.updateZombies(dt);
    this.updateBullets(dt);
    this.updateEnemyShots(dt);
    this.updateCompanions(dt);
    this.updatePickups(dt);
    this.updateEffects(dt);

    if (r.toSpawn <= 0 && !r.bossPending && this.zombies.length === 0) {
      if (r.waveClearTimer < 0) {
        r.waveClearTimer = 1.4;
        const bonus = Math.round((20 + r.wave * 12) * this.mods.scrapGain);
        r.scrap += bonus;
        this.toast(`Wave ${r.wave} cleared! +${bonus} scrap`);
        this.audio.waveClear();
      }
      r.waveClearTimer -= dt;
      if (r.waveClearTimer <= 0) {
        // collect what is left on the ground
        for (const p of this.pickups) this.collect(p, true);
        this.pickups.length = 0;
        this.afterPerks = "shop";
        if (r.pendingLevels > 0) this.offerPerks();
        else this.setState("shop");
        return;
      }
    }

    if (r.pendingLevels > 0 && r.waveClearTimer < 0) {
      this.afterPerks = "playing";
      this.offerPerks();
    }
    if (this.player.hp <= 0) this.endRun();
  }

  handleInput() {
    const inp = this.input, r = this.run;
    const ids = WEAPONS.map((w) => w.id).filter((id) => r.owned[id]);
    const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"];
    keys.forEach((k, i) => {
      if (inp.hit(k) && ids[i]) this.equip(ids[i]);
    });
    if (inp.wheel) {
      const i = ids.indexOf(r.current);
      this.equip(ids[(i + inp.wheel + ids.length) % ids.length]);
    }
    if (inp.hit("r")) this.startReload();
    if (inp.hit("escape", "p")) this.setState("paused");
  }

  updateSpawning(dt) {
    const r = this.run;
    if (r.toSpawn <= 0 && !r.bossPending) return;
    r.spawnCd -= dt;
    if (r.spawnCd > 0 || this.zombies.length >= MAX_ALIVE) return;
    if (r.bossPending && r.toSpawn <= waveSize(r.wave) * 0.5) {
      this.spawnZombie("boss");
      r.bossPending = false;
    }
    const group = Math.min(r.toSpawn, 1 + Math.floor(Math.random() * (2 + r.wave / 4)));
    const pool = wavePool(r.wave);
    for (let i = 0; i < group; i++) this.spawnZombie(weightedPick(pool).type);
    r.toSpawn -= group;
    r.spawnCd = clamp(1.25 - r.wave * 0.035, 0.28, 1.25) * rand(0.7, 1.3);
  }

  spawnZombie(type, at = null) {
    const def = ZOMBIES[type];
    const wave = this.run.wave;
    const field = def.r > 22 ? this.flowBig : this.flowSmall;
    let x, y;
    if (at) {
      x = at.x + rand(-40, 40);
      y = at.y + rand(-40, 40);
    } else {
      ({ x, y } = this.findSpawnPoint(field));
    }
    const bossScale = def.boss ? 1 + (Math.floor(wave / BOSS_EVERY) - 1) * 0.9 : 1;
    const hp = def.hp * hpScale(wave) * bossScale;
    const z = {
      type, def, x, y, r: def.r, hp, maxHp: hp, speed: def.speed * speedScale(wave) * rand(0.9, 1.1),
      damage: def.damage * (1 + 0.05 * (wave - 1)), slow: 0, burn: 0, burnDps: 0, flash: 0, attackCd: 0,
      rangedCd: rand(1, 2), dashCd: rand(1, 3), dashT: 0, dashA: 0, summonCd: 3, chargeCd: 4, chargeT: 0,
      wobble: rand(0, TAU), bladeCd: 0, face: 0, walk: rand(0, TAU), look: rollLook(type), los: false, losT: 0,
    };
    this.zombies.push(z);
    if (def.boss) {
      this.boss = z;
      this.audio.roar(null);
    }
    return z;
  }

  /** A walkable point just off-screen from which the player is reachable. */
  findSpawnPoint(field) {
    const reachable = (x, y) => field.isWalkable(x, y) && field.dist[field.index(x, y)] < Infinity;
    const d = Math.hypot(this.view.w, this.view.h) / 2 / this.view.zoom + 60;
    for (let tries = 0; tries < 30; tries++) {
      const a = rand(0, TAU), dd = d * rand(1, 1.5);
      const x = clamp(this.player.x + Math.cos(a) * dd, 30, WORLD - 30);
      const y = clamp(this.player.y + Math.sin(a) * dd, 30, WORLD - 30);
      if (reachable(x, y)) return { x, y };
    }
    // fallback: any reachable cell that is far enough away
    for (let tries = 0; tries < 400; tries++) {
      const x = rand(40, WORLD - 40), y = rand(40, WORLD - 40);
      if (reachable(x, y) && dist2({ x, y }, this.player) > 450 * 450) return { x, y };
    }
    return { x: this.player.x + 500, y: this.player.y };
  }

  updatePlayer(dt) {
    const p = this.player, inp = this.input, m = this.mods;
    const mv = inp.moveVector();
    const w = WEAPON_BY_ID[this.run.current];
    let speed = 230 * m.moveSpeed;
    if (w.slow && inp.mouse.down) speed *= 1 - w.slow;

    p.dashCd -= dt;
    if (inp.hit("shift", " ") && p.dashCd <= 0) {
      const dir = mv.x || mv.y ? mv : { x: Math.cos(p.angle), y: Math.sin(p.angle) };
      p.dashX = dir.x;
      p.dashY = dir.y;
      p.dashT = 0.16;
      p.invuln = Math.max(p.invuln, 0.3);
      p.dashCd = m.dashCooldown;
      this.audio.dash();
      this.burst(p.x, p.y, "#cfe8ff", 10, 120, 0.3, 3);
    }
    if (p.dashT > 0) {
      p.dashT -= dt;
      for (let k = 0; k < 3; k++) { // sub-steps so a dash cannot tunnel through thin walls
        p.x += (p.dashX * 950 * dt) / 3;
        p.y += (p.dashY * 950 * dt) / 3;
        this.city.resolve(p);
      }
      if (Math.random() < 0.8) this.particles.push({ x: p.x, y: p.y, vx: 0, vy: 0, life: 0.25, max: 0.25, color: "#9be15d55", size: 12 });
    } else {
      p.x += mv.x * speed * dt;
      p.y += mv.y * speed * dt;
    }
    p.moving = p.dashT > 0 || mv.x !== 0 || mv.y !== 0;
    p.x = clamp(p.x, p.r, WORLD - p.r);
    p.y = clamp(p.y, p.r, WORLD - p.r);
    this.city.resolve(p);

    const mw = this.screenToWorld(inp.mouse.x, inp.mouse.y);
    p.angle = Math.atan2(mw.y - p.y, mw.x - p.x);
    p.invuln -= dt;
    p.hurtFlash -= dt;
    if (m.regen) p.hp = Math.min(m.maxHp, p.hp + m.regen * dt);
  }

  hurtPlayer(amount) {
    const p = this.player;
    if (p.invuln > 0) return;
    const dmg = amount * (1 - this.mods.armor);
    p.hp -= dmg;
    p.invuln = 0.12;
    p.hurtFlash = 0.25;
    this.shake(5);
    this.audio.hurt();
    this.floatText(p.x, p.y - 20, `-${Math.round(dmg)}`, "#ff5a5a", 16);
  }

  // ------------------------------------------------------------------ weapons
  startReload() {
    const r = this.run;
    const st = this.stats(r.current);
    if (r.reloading > 0 || r.ammo[r.current] >= st.mag) return;
    r.reloading = st.reload;
    this.audio.reload(r.current, st.reload);
  }

  updateWeapon(dt) {
    const r = this.run, p = this.player;
    const st = this.stats(r.current);
    r.fireCd -= dt;
    if (r.reloading > 0) {
      r.reloading -= dt;
      if (r.reloading <= 0) {
        r.reloading = 0;
        r.ammo[r.current] = st.mag;
      }
      return;
    }
    if (r.ammo[r.current] === undefined) r.ammo[r.current] = st.mag;
    if (r.ammo[r.current] <= 0) {
      if (this.input.mouse.down) this.audio.empty();
      this.startReload();
      return;
    }
    if (!this.input.mouse.down) return;
    let shots = 0;
    while (r.fireCd <= 0 && r.ammo[r.current] > 0 && shots < 4) {
      r.fireCd += 1 / st.fireRate;
      r.ammo[r.current] -= 1;
      this.fire(st, p.angle);
      shots++;
    }
    if (r.fireCd < 0) r.fireCd = 0;
  }

  fire(st, angle) {
    const p = this.player;
    const muzzle = { x: p.x + Math.cos(angle) * 26, y: p.y + Math.sin(angle) * 26 };
    this.audio.shoot(st.id);
    this.muzzleT = 0.06;
    this.recoil = st.fireRate > 10 ? Math.max(this.recoil, 0.7 + Math.random() * 0.3) : 1;
    this.muzzleColor = st.kind === "tesla" ? "rgba(140,210,255,0.35)" : st.id === "plasma" ? "rgba(200,140,255,0.35)"
      : st.kind === "flame" ? "rgba(255,140,40,0.4)" : "rgba(255,200,120,0.35)";
    if (st.kind === "tesla") {
      this.fireTesla(st, muzzle, angle);
      return;
    }
    const n = st.pellets;
    const extraSpread = n > 1 && st.id !== "shotgun" ? 0.12 : 0;
    for (let i = 0; i < n; i++) {
      const offset = n > 1 ? (i / (n - 1) - 0.5) * (st.id === "shotgun" ? st.spread : extraSpread * (n - 1)) : 0;
      const a = angle + offset + rand(-st.spread, st.spread) * (st.id === "shotgun" ? 0.35 : 0.5);
      const speed = st.speed * rand(0.92, 1.08);
      const flame = st.kind === "flame";
      this.bullets.push({
        x: muzzle.x, y: muzzle.y, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed,
        r: flame ? 8 : st.kind === "rocket" ? 6 : st.id === "sniper" ? 3 : 2.5,
        damage: st.damage, pierce: st.pierce, hit: new Set(), life: st.range / st.speed,
        kind: st.kind, color: st.color, blast: st.blast, crit: st.crit, id: st.id,
      });
    }
    if (st.kind !== "flame") {
      this.particles.push({ x: muzzle.x, y: muzzle.y, vx: 0, vy: 0, life: 0.05, max: 0.05, color: "#fff4c2", size: 9 });
      // ejected shell
      if (st.kind === "bullet") {
        const a = angle + Math.PI / 2 + rand(-0.3, 0.3);
        this.particles.push({ x: p.x, y: p.y, vx: Math.cos(a) * 90, vy: Math.sin(a) * 90, life: 0.7, max: 0.7, color: "#d9b24c", size: 2, z: 18, vz: 160 });
      }
    }
    if (st.id === "sniper" || st.kind === "rocket") this.shake(st.id === "plasma" ? 1.5 : 4);
  }

  fireTesla(st, from, angle) {
    // First target: closest zombie inside a cone in front of the player, else closest in range.
    let best = null, bestD = Infinity;
    for (const z of this.zombies) {
      const d = Math.sqrt(dist2(from, z));
      if (d > st.range || !this.city.lineOfSight(from, z, 24)) continue;
      let diff = Math.abs(((angleTo(from, z) - angle + Math.PI * 3) % TAU) - Math.PI);
      const score = d * (diff < 0.5 ? 1 : 3);
      if (score < bestD) {
        bestD = score;
        best = z;
      }
    }
    if (!best) {
      const end = { x: from.x + Math.cos(angle) * st.range * 0.6, y: from.y + Math.sin(angle) * st.range * 0.6 };
      this.arcs.push({ pts: this.jagged(from, end), life: 0.08 });
      return;
    }
    const hit = new Set();
    let prev = from, target = best, dmg = st.damage;
    for (let i = 0; i <= st.chains && target; i++) {
      hit.add(target);
      this.arcs.push({ pts: this.jagged(prev, target), life: 0.12 });
      this.damageZombie(target, dmg, { crit: st.crit });
      this.burst(target.x, target.y, "#bfe9ff", 4, 120, 0.25, 2);
      prev = target;
      dmg *= 0.85;
      let next = null, nd = 190 * 190;
      for (const z of this.grid.query(target.x, target.y, 190, this._near)) {
        if (hit.has(z) || z.hp <= 0) continue;
        const d = dist2(prev, z);
        if (d < nd) {
          nd = d;
          next = z;
        }
      }
      target = next;
    }
  }

  jagged(a, b) {
    const pts = [{ x: a.x, y: a.y }];
    const steps = 6;
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      pts.push({ x: lerp(a.x, b.x, t) + rand(-12, 12), y: lerp(a.y, b.y, t) + rand(-12, 12) });
    }
    pts.push({ x: b.x, y: b.y });
    return pts;
  }

  updateBullets(dt) {
    const out = [];
    for (const b of this.bullets) {
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.life -= dt;
      if (b.kind === "flame") {
        b.r += 26 * dt;
        b.vx *= 0.96;
        b.vy *= 0.96;
      }
      let alive = b.life > 0 && b.x > 0 && b.y > 0 && b.x < WORLD && b.y < WORLD;
      if (alive && this.city.solidAt(b.x, b.y)) {
        // hit a wall / car / barrel
        alive = false;
        if (b.kind === "rocket") this.explode(b.x, b.y, b.blast, b.damage, false, b.color);
        else if (b.kind !== "flame") {
          this.burst(b.x - b.vx * dt, b.y - b.vy * dt, "#ffd98a", 4, 140, 0.2, 2);
          this.audio.ricochet(b);
        }
        b.hit.add(this); // mark as "used" so it does not also explode at max range
      }
      if (alive) {
        for (const z of this.grid.query(b.x, b.y, b.r, this._near)) {
          if (b.hit.has(z) || z.hp <= 0) continue;
          if (dist2(b, z) > (b.r + z.r) ** 2) continue;
          b.hit.add(z);
          this.onBulletHit(b, z);
          if (b.pierce <= 0) {
            alive = false;
            break;
          }
          b.pierce -= 1;
        }
      }
      if (alive) out.push(b);
      // a rocket that reaches max range without hitting anything detonates where it is
      else if (b.kind === "rocket" && b.life <= 0 && b.hit.size === 0) this.explode(b.x, b.y, b.blast, b.damage * 0.6, false, b.color);
    }
    this.bullets = out;
  }

  onBulletHit(b, z) {
    const m = this.mods;
    if (b.kind === "flame") {
      z.burn = 2.2;
      z.burnDps = Math.max(z.burnDps, b.damage * 3.5);
      this.damageZombie(z, b.damage, { crit: b.crit, silent: true });
      return;
    }
    if (b.kind === "rocket") {
      this.explode(b.x, b.y, b.blast, b.damage, false, b.color);
      this.damageZombie(z, b.damage * 0.5, { crit: b.crit });
      return;
    }
    const knock = b.id === "shotgun" ? 9 : b.id === "sniper" ? 14 : 3;
    z.x += (b.vx / Math.hypot(b.vx, b.vy)) * knock;
    z.y += (b.vy / Math.hypot(b.vx, b.vy)) * knock;
    this.damageZombie(z, b.damage, { crit: b.crit, frost: m.frost });
    this.burst(b.x, b.y, z.def.color, 3, 110, 0.3, 2);
    if (m.explosiveChance && chance(m.explosiveChance)) this.explode(b.x, b.y, 65, b.damage * 0.8, false, "#ffb347");
  }

  damageZombie(z, amount, { crit = 0, frost = 0, silent = false } = {}) {
    if (z.hp <= 0) return;
    const isCrit = crit && chance(crit);
    const dmg = amount * (isCrit ? 2 : 1);
    z.hp -= dmg;
    z.flash = 0.08;
    this.run.damageDealt += dmg;
    if (frost) z.slow = Math.max(z.slow, 1.5);
    if (!silent || isCrit) {
      this.floatText(z.x + rand(-8, 8), z.y - z.r, fmt(Math.max(1, dmg)), isCrit ? "#ffd84a" : "#ffffff", isCrit ? 17 : 12);
      this.audio.hit(z);
    }
    if (z.hp <= 0) this.killZombie(z);
  }

  explode(x, y, radius, damage, hurtsPlayer, color = "#ff9a3c") {
    this.rings.push({ x, y, r: 10, max: radius, life: 0.3, color });
    this.burst(x, y, color, 22, radius * 3, 0.5, 4);
    this.burst(x, y, "#555", 14, radius * 1.6, 0.9, 5, 420);
    this.burst(x, y, "#ffb347", 8, radius * 1.2, 0.7, 3, 520);
    this.splat(x, y, radius * 0.45, "rgba(20,15,10,0.35)");
    this.shake(radius / 18);
    this.audio.explode({ x, y }, clamp(radius / 100, 0.6, 1.6));
    for (const z of this.grid.query(x, y, radius, [])) {
      const d = Math.sqrt(dist2({ x, y }, z));
      if (d > radius + z.r) continue;
      this.damageZombie(z, damage * (1 - 0.5 * (d / (radius + z.r))), { silent: false });
    }
    if (hurtsPlayer) {
      const d = Math.sqrt(dist2({ x, y }, this.player));
      if (d < radius + this.player.r) this.hurtPlayer(damage * (1 - 0.5 * d / radius));
    }
  }

  killZombie(z) {
    const r = this.run, m = this.mods;
    r.kills += 1;
    z.hp = 0;
    const scrap = Math.max(1, Math.round(z.def.scrap * m.scrapGain * (1 + r.wave * 0.04)));
    this.dropPickup(z.x, z.y, "scrap", scrap, z.def.boss ? 12 : 1);
    this.dropPickup(z.x, z.y, "xp", z.def.xp, z.def.boss ? 10 : 1);
    if (chance(z.def.boss ? 1 : 0.022)) this.dropPickup(z.x, z.y, "heal", z.def.boss ? 60 : 25, 1);
    this.splat(z.x, z.y, z.r * 0.9);
    this.burst(z.x, z.y, "#7a1d1d", 12, 150, 0.6, 3, 220);
    this.burst(z.x, z.y, z.def.color, 6, 120, 0.5, 3);
    this.audio.death(z.type, z);
    if (m.lifeOnKill) this.player.hp = Math.min(m.maxHp, this.player.hp + m.lifeOnKill);
    if (z.def.explode) this.explode(z.x, z.y, z.def.explode.radius, z.def.explode.damage * hpScale(r.wave) ** 0.5, true, "#d0a03c");
    if (z.def.boss) {
      r.bossesKilled += 1;
      this.boss = null;
      this.shake(16);
      this.toast("Abomination destroyed!");
    }
  }

  dropPickup(x, y, type, value, pieces) {
    for (let i = 0; i < pieces; i++) {
      const a = rand(0, TAU), s = rand(30, pieces > 1 ? 220 : 80);
      this.pickups.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, type, value: pieces > 1 ? Math.ceil(value / pieces) : value,
        r: type === "heal" ? 9 : type === "xp" ? 5 : 6, age: 0 });
    }
  }

  // ------------------------------------------------------------------ zombies
  updateZombies(dt) {
    const p = this.player;
    for (const z of this.zombies) {
      if (z.hp <= 0) continue;
      z.flash -= dt;
      z.attackCd -= dt;
      z.bladeCd -= dt;
      z.wobble += dt * 6;
      if (z.burn > 0) {
        z.burn -= dt;
        this.damageZombie(z, z.burnDps * dt, { silent: true });
        if (Math.random() < 0.3) this.particles.push({ x: z.x + rand(-z.r, z.r), y: z.y + rand(-z.r, z.r), vx: 0, vy: -50,
          life: 0.4, max: 0.4, color: "#ff8a2a", size: 4 });
        if (z.hp <= 0) continue;
      }
      let speed = z.speed * (z.slow > 0 ? 0.7 : 1);
      z.slow -= dt;
      const a = angleTo(z, p);
      const d = Math.sqrt(dist2(z, p));
      // Steering: straight at the player when there is a clear line of sight, otherwise follow
      // the flow field around buildings. LOS is re-checked a few times per second per zombie.
      z.losT -= dt;
      if (z.losT <= 0) {
        z.losT = rand(0.2, 0.35);
        z.los = d < 420 && this.city.lineOfSight(z, p, 20);
      }
      let mx = Math.cos(a), my = Math.sin(a);
      if (!z.los) {
        const dir = (z.r > 22 ? this.flowBig : this.flowSmall).direction(z.x, z.y);
        if (dir) { mx = dir.x; my = dir.y; }
      }
      const moveA = Math.atan2(my, mx);
      // turn smoothly instead of snapping
      let diff = ((moveA - z.face + Math.PI * 3) % TAU) - Math.PI;
      z.face += clamp(diff, -8 * dt, 8 * dt);
      z.walk += speed * dt * 0.09;
      if (d < 750 && Math.random() < dt * (z.def.boss ? 0.5 : 0.18)) this.audio.groan(z.type, z);

      const def = z.def;
      if (def.ranged) {
        z.rangedCd -= dt;
        if (z.los && d < def.ranged.range * 0.75) { mx = -mx * 0.6; my = -my * 0.6; }
        else if (z.los && d < def.ranged.range) { mx *= 0.15; my *= 0.15; }
        if (z.los && d < def.ranged.range && z.rangedCd <= 0) {
          z.rangedCd = def.ranged.cooldown;
          const s = def.ranged.projectileSpeed;
          this.audio.spit(z);
          this.enemyShots.push({ x: z.x, y: z.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, r: 7, life: 2.5,
            damage: def.ranged.damage * (1 + 0.05 * (this.run.wave - 1)) });
        }
      }
      if (def.dash) {
        z.dashCd -= dt;
        if (z.dashT > 0) { z.dashT -= dt; speed = def.dash.speed; mx = Math.cos(z.dashA); my = Math.sin(z.dashA); }
        else if (z.dashCd <= 0 && d < 380) { z.dashCd = def.dash.cooldown; z.dashT = def.dash.duration; z.dashA = a; this.audio.shriek(z); }
      }
      if (def.boss) {
        z.summonCd -= dt;
        z.chargeCd -= dt;
        if (z.summonCd <= 0) {
          z.summonCd = def.summon.cooldown;
          this.audio.roar(z);
          for (let i = 0; i < def.summon.count && this.zombies.length < MAX_ALIVE; i++) this.spawnZombie("walker", z);
        }
        if (z.chargeT > 0) {
          z.chargeT -= dt; speed = def.charge.speed; mx = Math.cos(z.dashA); my = Math.sin(z.dashA);
          if (Math.random() < dt * 6) this.audio.stomp(z);
        }
        else if (z.chargeCd <= 0 && d < 600) { z.chargeCd = def.charge.cooldown; z.chargeT = def.charge.duration; z.dashA = a; this.shake(3); }
      }

      z.x += mx * speed * dt;
      z.y += my * speed * dt;

      // separation from neighbours so the horde spreads out instead of stacking
      for (const o of this.grid.query(z.x, z.y, z.r * 2, this._near)) {
        if (o === z || o.hp <= 0) continue;
        const dx = z.x - o.x, dy = z.y - o.y;
        const dd = Math.hypot(dx, dy) || 0.01;
        const overlap = z.r + o.r - dd;
        if (overlap > 0) {
          const push = (overlap / dd) * (o.def.boss ? 0.9 : 0.5);
          z.x += dx * push;
          z.y += dy * push;
        }
      }
      z.x = clamp(z.x, z.r, WORLD - z.r);
      z.y = clamp(z.y, z.r, WORLD - z.r);
      this.city.resolve(z);

      // Safety net: a zombie that makes no progress for a while (wedged between props, or pushed
      // into an unreachable pocket by the crowd) is quietly moved to a fresh spawn point off-screen.
      z.progressT = (z.progressT ?? 0) + dt;
      if (z.progressT > 5) {
        if (d > 320 && z.lastD !== undefined && d > z.lastD - 40) {
          const field = z.r > 22 ? this.flowBig : this.flowSmall;
          Object.assign(z, this.findSpawnPoint(field));
        }
        z.lastD = d;
        z.progressT = 0;
      }

      // contact
      if (d < z.r + p.r + 2) {
        if (def.explode) {
          this.killZombie(z);
          continue;
        }
        if (z.attackCd <= 0) {
          z.attackCd = 0.8;
          this.audio.attack(z.type, z);
          this.hurtPlayer(z.damage);
        }
      }
    }
    this.zombies = this.zombies.filter((z) => z.hp > 0);
  }

  updateEnemyShots(dt) {
    const p = this.player;
    this.enemyShots = this.enemyShots.filter((s) => {
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.life -= dt;
      if (this.city.solidAt(s.x, s.y)) {
        this.splat(s.x, s.y, 8, "rgba(80,160,90,0.35)");
        return false;
      }
      if (dist2(s, p) < (s.r + p.r) ** 2) {
        this.hurtPlayer(s.damage);
        this.splat(s.x, s.y, 10, "rgba(80,160,90,0.4)");
        return false;
      }
      return s.life > 0;
    });
  }

  updateCompanions(dt) {
    const p = this.player, m = this.mods, wave = this.run.wave;
    // Orbiting blades
    p.bladeAngle += dt * 3.2;
    for (let i = 0; i < m.blades; i++) {
      const a = p.bladeAngle + (i / m.blades) * TAU;
      const bx = p.x + Math.cos(a) * 72, by = p.y + Math.sin(a) * 72;
      for (const z of this.grid.query(bx, by, 14, this._near)) {
        if (z.hp <= 0 || z.bladeCd > 0 || dist2({ x: bx, y: by }, z) > (14 + z.r) ** 2) continue;
        z.bladeCd = 0.3;
        this.damageZombie(z, (14 + wave * 2.2) * m.damage, { crit: m.crit });
      }
    }
    // Drones
    while (p.droneCd.length < m.drones) p.droneCd.push(rand(0, 0.5));
    for (let i = 0; i < m.drones; i++) {
      p.droneCd[i] -= dt;
      if (p.droneCd[i] > 0) continue;
      const pos = this.dronePos(i);
      let target = null, best = 460 * 460;
      for (const z of this.zombies) {
        const d = dist2(pos, z);
        if (d < best) { best = d; target = z; }
      }
      if (!target) continue;
      p.droneCd[i] = 0.55;
      const a = angleTo(pos, target);
      this.bullets.push({ x: pos.x, y: pos.y, vx: Math.cos(a) * 800, vy: Math.sin(a) * 800, r: 2.5,
        damage: (9 + wave * 1.6) * m.damage, pierce: 0, hit: new Set(), life: 0.7, kind: "bullet", color: "#9be15d",
        blast: 0, crit: m.crit, id: "drone" });
    }
  }

  dronePos(i) {
    const p = this.player;
    const a = this.run.time * 1.3 + (i / Math.max(1, this.mods.drones)) * TAU;
    return { x: p.x + Math.cos(a) * 42, y: p.y + Math.sin(a) * 42 };
  }

  updatePickups(dt) {
    const p = this.player;
    const magnet = 95 * this.mods.magnet;
    this.pickups = this.pickups.filter((k) => {
      k.age += dt;
      k.x += k.vx * dt;
      k.y += k.vy * dt;
      k.vx *= 0.9;
      k.vy *= 0.9;
      if (k.age < 1) this.city.resolve(k);
      const d = Math.sqrt(dist2(k, p));
      if (k.age > 0.3 && d < magnet) {
        const pull = 600 * (1 - d / magnet) + 200;
        k.x += ((p.x - k.x) / d) * pull * dt;
        k.y += ((p.y - k.y) / d) * pull * dt;
      }
      if (d < p.r + k.r) {
        this.collect(k);
        return false;
      }
      return k.age < 40;
    });
  }

  collect(k, silent = false) {
    const r = this.run, m = this.mods;
    if (k.type === "scrap") r.scrap += k.value;
    else if (k.type === "heal") {
      this.player.hp = Math.min(m.maxHp, this.player.hp + k.value);
      if (!silent) this.floatText(this.player.x, this.player.y - 24, `+${k.value} HP`, "#7dff9a", 15);
    } else {
      r.xp += k.value * m.xpGain;
      while (r.xp >= xpForLevel(r.level)) {
        r.xp -= xpForLevel(r.level);
        r.level += 1;
        r.pendingLevels += 1;
      }
    }
    if (!silent) this.audio.pickup(k.type);
  }

  updateEffects(dt) {
    this.particles = this.particles.filter((q) => {
      q.x += q.vx * dt;
      q.y += q.vy * dt;
      if (q.vz !== undefined) {
        // debris flies up, falls with gravity and bounces on the ground
        q.z += q.vz * dt;
        q.vz -= 980 * dt;
        if (q.z < 0) { q.z = 0; q.vz *= -0.35; q.vx *= 0.55; q.vy *= 0.55; }
        q.vx *= 0.995; q.vy *= 0.995;
      } else {
        q.vx *= 0.92;
        q.vy *= 0.92;
      }
      q.life -= dt;
      return q.life > 0;
    });
    this.texts = this.texts.filter((t) => {
      t.y += t.vy * dt;
      t.life -= dt;
      return t.life > 0;
    });
    this.arcs = this.arcs.filter((a) => (a.life -= dt) > 0);
    this.rings = this.rings.filter((r) => {
      r.life -= dt;
      r.r = lerp(r.r, r.max, 0.35);
      return r.life > 0;
    });
    this.cam.shake *= Math.pow(0.0015, dt);
  }

  // ------------------------------------------------------------------ rendering
  render(dt = 1 / 60) {
    const ctx = this.ctx, { w, h, zoom } = this.view, p = this.player;
    if (this.state === "menu") {
      // slow cinematic pan over the city behind the main menu
      this.menuT += dt;
      this.cam.x = WORLD / 2 + Math.cos(this.menuT * 0.07) * 520;
      this.cam.y = WORLD / 2 + Math.sin(this.menuT * 0.05) * 420;
    } else {
      // camera follows the player, slightly towards the mouse
      const look = this.state === "playing" ? this.screenToWorld(this.input.mouse.x, this.input.mouse.y) : p;
      this.cam.x = lerp(this.cam.x, lerp(p.x, look.x, 0.18), 0.12);
      this.cam.y = lerp(this.cam.y, lerp(p.y, look.y, 0.18), 0.12);
    }
    const sx = (Math.random() - 0.5) * this.cam.shake, sy = (Math.random() - 0.5) * this.cam.shake;

    const dpr = this.view.dpr || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#070806";
    ctx.fillRect(0, 0, w, h);
    const zs = zoom * dpr;
    const worldTransform = () =>
      ctx.setTransform(zs, 0, 0, zs, (w / 2 - this.cam.x * zoom + sx) * dpr, (h / 2 - this.cam.y * zoom + sy) * dpr);
    worldTransform();

    // city + decals (only the visible part of the big canvases is copied)
    const left = this.cam.x - w / 2 / zoom - 20, top = this.cam.y - h / 2 / zoom - 20;
    const vw = w / zoom + 40, vh = h / zoom + 40;
    const dx = clamp(left, 0, WORLD), dy = clamp(top, 0, WORLD);
    const dw = clamp(left + vw, 0, WORLD) - dx, dh = clamp(top + vh, 0, WORLD) - dy;
    if (dw > 0 && dh > 0) {
      ctx.drawImage(this.city.canvas, dx, dy, dw, dh, dx, dy, dw, dh);
      ctx.drawImage(this.decals, dx, dy, dw, dh, dx, dy, dw, dh);
    }
    const view = { x0: left, y0: top, x1: left + vw, y1: top + vh };
    const onScreen = (o, m = 60) => o.x > view.x0 - m && o.x < view.x1 + m && o.y > view.y0 - m && o.y < view.y1 + m;

    this.drawEnemyShots(ctx);
    for (const z of this.zombies) if (onScreen(z)) this.drawZombie(ctx, z);
    if (this.state !== "menu") this.drawPlayer(ctx);
    // 3D city: walls, roofs, wrecks, lamps and trees, sorted far-to-near around the camera
    const emissive = this.city.drawSolids(ctx, view, this.cam.x, this.cam.y, this.run.time + this.menuT);

    // ---- night lighting (screen space)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const S = (o) => ({ x: (o.x - this.cam.x) * zoom + w / 2, y: (o.y - this.cam.y) * zoom + h / 2 });
    const lights = [], glows = [];
    const t = this.run.time + this.menuT;
    if (this.state !== "menu") {
      const ps = S(p);
      lights.push({ ...ps, r: 170 * zoom, intensity: 0.95 });
      lights.push({ ...ps, intensity: 1, cone: { angle: p.angle, width: 0.45, length: 600 * zoom } });
      if (this.muzzleT > 0) {
        lights.push({ ...ps, r: 230 * zoom, intensity: 0.9 });
        glows.push({ ...ps, r: 120 * zoom, color: this.muzzleColor });
      }
    }
    for (const L of this.city.lamps) {
      if (L.broken || !onScreen(L, 200)) continue;
      const flicker = Math.sin(t * 13 + L.flicker) > 0.97 ? 0.4 : 1;
      const s = S(L);
      lights.push({ ...s, r: 190 * zoom, intensity: 0.85 * flicker });
      const head = S(L.top || L);
      glows.push({ ...head, r: 120 * zoom, color: `rgba(255,190,110,${0.14 * flicker})` });
      glows.push({ ...head, r: 22 * zoom, color: `rgba(255,230,180,${0.5 * flicker})` });
    }
    for (const F of this.city.fires) {
      if (!onScreen(F, 250)) continue;
      const fl = 0.85 + Math.sin(t * 17 + F.x) * 0.1 + Math.random() * 0.05;
      const s = S(F);
      lights.push({ ...s, r: 230 * zoom * fl, intensity: 0.9 });
      glows.push({ ...s, r: 140 * zoom * fl, color: "rgba(255,120,40,0.25)" });
    }
    for (const r of this.rings) {
      const s = S(r);
      lights.push({ ...s, r: r.max * 2.2 * zoom, intensity: clamp(r.life / 0.3, 0, 1) });
      glows.push({ ...s, r: r.max * 1.4 * zoom, color: "rgba(255,150,60,0.35)" });
    }
    let burning = 0;
    for (const z of this.zombies) {
      if (z.burn > 0 && burning++ < 16 && onScreen(z)) lights.push({ ...S(z), r: 70 * zoom, intensity: 0.7 });
    }
    for (const a of this.arcs) {
      const end = a.pts[a.pts.length - 1];
      lights.push({ ...S(end), r: 110 * zoom, intensity: 0.8 });
    }
    this.lighting.render(ctx, w, h, lights, glows);

    // ---- things that glow / must stay readable in the dark
    worldTransform();
    this.city.drawEmissive(ctx, emissive);
    this.drawFires(ctx, view, t);
    this.drawPickups(ctx);
    this.drawBullets(ctx);
    this.drawEffects(ctx);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (this.state !== "menu") this.drawHUD(ctx);
  }

  drawFires(ctx, view, t) {
    ctx.globalCompositeOperation = "lighter";
    for (const F of this.city.fires) {
      if (F.x < view.x0 - 60 || F.x > view.x1 + 60 || F.y < view.y0 - 60 || F.y > view.y1 + 60) continue;
      const P = project(F.x, F.y, F.h || 0, this.cam.x, this.cam.y);
      for (let k = 0; k < 7; k++) {
        const a = t * 3 + k * 0.9 + F.x;
        const rr = 8 + ((t * 40 + k * 13) % 18);
        ctx.fillStyle = k % 2 ? "rgba(255,140,40,0.35)" : "rgba(255,210,90,0.3)";
        ctx.beginPath();
        ctx.arc(P.x + Math.cos(a) * 10, P.y + Math.sin(a) * 8 - ((t * 30 + k * 7) % 20), rr * 0.7, 0, TAU);
        ctx.fill();
      }
    }
    ctx.globalCompositeOperation = "source-over";
  }

  drawPickups(ctx) {
    const t = this.run.time;
    for (const k of this.pickups) {
      const bob = Math.sin(t * 5 + k.x) * 1.5;
      if (k.type === "scrap") {
        ctx.fillStyle = "#f2c14e";
        ctx.save();
        ctx.translate(k.x, k.y + bob);
        ctx.rotate(t * 2 + k.y);
        ctx.fillRect(-k.r / 2, -k.r / 2, k.r, k.r);
        ctx.restore();
      } else if (k.type === "xp") {
        ctx.fillStyle = "#4ea8f2";
        ctx.beginPath();
        ctx.moveTo(k.x, k.y - k.r + bob);
        ctx.lineTo(k.x + k.r, k.y + bob);
        ctx.lineTo(k.x, k.y + k.r + bob);
        ctx.lineTo(k.x - k.r, k.y + bob);
        ctx.fill();
      } else {
        ctx.fillStyle = "#e8eedf";
        ctx.fillRect(k.x - 9, k.y - 9 + bob, 18, 18);
        ctx.fillStyle = "#e5484d";
        ctx.fillRect(k.x - 2.5, k.y - 6 + bob, 5, 12);
        ctx.fillRect(k.x - 6, k.y - 2.5 + bob, 12, 5);
      }
    }
  }

  drawEnemyShots(ctx) {
    ctx.fillStyle = "#86e06a";
    for (const s of this.enemyShots) {
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, TAU);
      ctx.fill();
    }
  }

  drawZombie(ctx, z) {
    const { r, def } = z;
    drawZombie(ctx, z, this.lean(z));
    // health bar for damaged or big zombies
    if ((z.hp < z.maxHp && !def.boss) || (def.hp >= 200 && !def.boss)) {
      const bw = r * 2;
      ctx.fillStyle = "rgba(0,0,0,0.6)";
      ctx.fillRect(z.x - bw / 2, z.y - r - 10, bw, 4);
      ctx.fillStyle = "#e5484d";
      ctx.fillRect(z.x - bw / 2, z.y - r - 10, bw * Math.max(0, z.hp / z.maxHp), 4);
    }
  }

  drawPlayer(ctx) {
    const p = this.player, m = this.mods;
    // blades
    for (let i = 0; i < m.blades; i++) {
      const a = p.bladeAngle + (i / m.blades) * TAU;
      ctx.save();
      ctx.translate(p.x + Math.cos(a) * 72, p.y + Math.sin(a) * 72);
      ctx.rotate(p.bladeAngle * 4);
      ctx.fillStyle = "#cfd8e3";
      ctx.beginPath();
      for (let k = 0; k < 3; k++) {
        const b = (k / 3) * TAU;
        ctx.moveTo(0, 0);
        ctx.lineTo(Math.cos(b) * 14, Math.sin(b) * 14);
        ctx.lineTo(Math.cos(b + 0.6) * 6, Math.sin(b + 0.6) * 6);
      }
      ctx.fill();
      ctx.restore();
    }
    // drones
    for (let i = 0; i < m.drones; i++) {
      const d = this.dronePos(i);
      ctx.fillStyle = "#2b3a24";
      ctx.strokeStyle = "#9be15d";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(d.x, d.y, 7, 0, TAU);
      ctx.fill();
      ctx.stroke();
    }
    drawPlayer(ctx, p, this.run.current, p.moving, this.run.time, p.invuln, this.lean(p));
  }

  drawBullets(ctx) {
    ctx.lineCap = "round";
    for (const b of this.bullets) {
      if (b.kind === "flame") continue;
      const sp = Math.hypot(b.vx, b.vy) || 1;
      const tail = b.kind === "rocket" ? 14 : b.id === "sniper" ? 40 : 16;
      ctx.strokeStyle = b.color;
      ctx.lineWidth = b.r * 2;
      ctx.beginPath();
      ctx.moveTo(b.x - (b.vx / sp) * tail, b.y - (b.vy / sp) * tail);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      if (b.kind === "rocket" && Math.random() < 0.6) {
        this.particles.push({ x: b.x, y: b.y, vx: rand(-20, 20), vy: rand(-20, 20), life: 0.35, max: 0.35, color: "#8a8a8a88", size: 5 });
      }
    }
    ctx.globalCompositeOperation = "lighter";
    for (const b of this.bullets) {
      if (b.kind !== "flame") continue;
      const t = 1 - b.life / (260 / 420);
      ctx.fillStyle = t < 0.4 ? "rgba(255,210,90,0.35)" : "rgba(255,110,30,0.25)";
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, TAU);
      ctx.fill();
    }
    ctx.globalCompositeOperation = "source-over";
  }

  drawEffects(ctx) {
    for (const q of this.particles) {
      ctx.globalAlpha = clamp(q.life / q.max, 0, 1);
      let px = q.x, py = q.y;
      if (q.z > 0.5) {
        ctx.fillStyle = "rgba(0,0,0,0.35)";
        ctx.fillRect(q.x - q.size / 2, q.y - q.size / 2, q.size, q.size);
        const k = lift(q.z);
        px += (q.x - this.cam.x) * k;
        py += (q.y - this.cam.y) * k - q.z * 0.35;
      }
      ctx.fillStyle = q.color;
      ctx.fillRect(px - q.size / 2, py - q.size / 2, q.size, q.size);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "lighter";
    for (const a of this.arcs) {
      ctx.strokeStyle = `rgba(150,220,255,${clamp(a.life * 10, 0, 1)})`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      a.pts.forEach((pt, i) => (i ? ctx.lineTo(pt.x, pt.y) : ctx.moveTo(pt.x, pt.y)));
      ctx.stroke();
    }
    for (const r of this.rings) {
      ctx.strokeStyle = r.color;
      ctx.globalAlpha = clamp(r.life / 0.3, 0, 1);
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.arc(r.x, r.y, r.r, 0, TAU);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    ctx.textAlign = "center";
    for (const t of this.texts) {
      ctx.globalAlpha = clamp(t.life / 0.5, 0, 1);
      ctx.font = `bold ${t.size}px Segoe UI, sans-serif`;
      ctx.fillStyle = "#000";
      ctx.fillText(t.text, t.x + 1, t.y + 1);
      ctx.fillStyle = t.color;
      ctx.fillText(t.text, t.x, t.y);
    }
    ctx.globalAlpha = 1;
  }

  drawHUD(ctx) {
    // The HUD is laid out for ~1150x700 and scaled down on smaller windows so panels never overlap.
    const s = clamp(Math.min(this.view.w / 1150, this.view.h / 700), 0.5, 1);
    ctx.save();
    ctx.scale(s, s);
    this._drawHUD(ctx, this.view.w / s, this.view.h / s);
    ctx.restore();
  }

  _drawHUD(ctx, w, h) {
    const r = this.run, p = this.player, m = this.mods;
    const st = this.stats(r.current);

    // low-HP vignette / hurt flash
    const hpFrac = clamp(p.hp / m.maxHp, 0, 1);
    if (hpFrac < 0.35 || p.hurtFlash > 0) {
      const a = Math.max(p.hurtFlash > 0 ? 0.35 : 0, (0.35 - hpFrac) * 1.4);
      const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.3, w / 2, h / 2, Math.max(w, h) * 0.7);
      g.addColorStop(0, "rgba(120,0,0,0)");
      g.addColorStop(1, `rgba(150,0,0,${a})`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    }

    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    // HP bar
    panel(ctx, 16, 16, 300, 64);
    bar(ctx, 28, 28, 276, 16, hpFrac, "#e5484d");
    text(ctx, `${Math.ceil(Math.max(0, p.hp))} / ${m.maxHp}`, 34, 36, 12, "#fff", "bold");
    // dash
    const dashFrac = clamp(1 - p.dashCd / m.dashCooldown, 0, 1);
    bar(ctx, 28, 54, 120, 8, dashFrac, dashFrac >= 1 ? "#9be15d" : "#55634d");
    text(ctx, dashFrac >= 1 ? "DASH ready [Shift]" : "dash", 156, 58, 11, "#93a089");
    text(ctx, `Lv ${r.level}`, 262, 58, 13, "#4ea8f2", "bold");

    // wave / scrap / kills (top centre)
    const remaining = r.toSpawn + this.zombies.length;
    panel(ctx, w / 2 - 170, 16, 340, 44);
    ctx.textAlign = "center";
    text(ctx, `WAVE ${r.wave}`, w / 2 - 95, 38, 18, "#e8eedf", "900");
    drawIcon(ctx, "zombie", w / 2 - 12, 38, 16, "#9bbf7a");
    text(ctx, `${remaining}`, w / 2 + 14, 38, 15, "#c9d6bd", "bold");
    drawIcon(ctx, "clock", w / 2 + 70, 38, 15, "#c9d6bd");
    text(ctx, fmtTime(r.time), w / 2 + 110, 38, 15, "#c9d6bd", "bold");

    // scrap top right
    ctx.textAlign = "right";
    panel(ctx, w - 196, 16, 180, 64);
    text(ctx, fmt(r.scrap), w - 30, 36, 20, "#f2c14e", "900");
    ctx.save(); ctx.font = "900 20px Segoe UI, sans-serif";
    drawIcon(ctx, "scrap", w - 44 - ctx.measureText(fmt(r.scrap)).width, 36, 18, "#f2c14e"); ctx.restore();
    text(ctx, `${fmt(r.kills)} kills`, w - 30, 62, 13, "#93a089", "bold");
    ctx.save(); ctx.font = "bold 13px Segoe UI, sans-serif";
    drawIcon(ctx, "skull", w - 42 - ctx.measureText(`${fmt(r.kills)} kills`).width, 61, 13, "#93a089"); ctx.restore();

    // weapon panel bottom left
    ctx.textAlign = "left";
    panel(ctx, 16, h - 150, 340, 122);
    drawWeapon(ctx, r.current, 260, h - 112, 170, {
      t: r.time, recoil: this.recoil, spin: this.spin,
      reload: r.reloading > 0 ? 1 - r.reloading / st.reload : -1,
    });
    text(ctx, st.name, 30, h - 128, 18, "#e8eedf", "bold");
    text(ctx, `Lv ${st.level}`, 30, h - 106, 13, "#9be15d", "bold");
    if (r.reloading > 0) {
      bar(ctx, 30, h - 66, 300, 10, 1 - r.reloading / st.reload, "#f2c14e");
      text(ctx, "RELOADING", 30, h - 46, 12, "#f2c14e", "bold");
    } else {
      const ammo = r.ammo[r.current] ?? st.mag;
      bar(ctx, 30, h - 66, 300, 10, ammo / st.mag, "#d9c9a3");
      text(ctx, `${ammo} / ${st.mag}   [R] reload`, 30, h - 46, 12, "#93a089", "bold");
    }

    // weapon slots
    const owned = WEAPONS.filter((wd) => r.owned[wd.id]);
    owned.forEach((wd, i) => {
      const x = 372 + i * 66, y = h - 74;
      ctx.fillStyle = wd.id === r.current ? "rgba(155,225,93,0.25)" : "rgba(18,22,17,0.8)";
      ctx.strokeStyle = wd.id === r.current ? "#9be15d" : "#2f3a2b";
      ctx.lineWidth = 2;
      roundRect(ctx, x, y, 60, 44, 8);
      ctx.fill();
      ctx.stroke();
      ctx.textAlign = "center";
      drawWeapon(ctx, wd.id, x + 31, y + 24, 54, { t: 0, spin: wd.id === r.current ? this.spin : 0 });
      text(ctx, `${(i + 1) % 10}`, x + 8, y + 9, 10, "#93a089", "bold");
    });

    // XP bar (bottom)
    const need = xpForLevel(r.level);
    ctx.fillStyle = "rgba(0,0,0,0.6)";
    ctx.fillRect(0, h - 10, w, 10);
    ctx.fillStyle = "#4ea8f2";
    ctx.fillRect(0, h - 10, w * clamp(r.xp / need, 0, 1), 10);

    // boss bar
    if (this.boss && this.boss.hp > 0) {
      const bw = Math.min(600, w - 40);
      ctx.textAlign = "center";
      panel(ctx, w / 2 - bw / 2 - 10, 70, bw + 20, 40);
      bar(ctx, w / 2 - bw / 2, 92, bw, 10, this.boss.hp / this.boss.maxHp, "#b33a3a");
      text(ctx, "ABOMINATION", w / 2, 81, 12, "#ff8a8a", "900");
    }

    // radar (top right under scrap)
    const R = 70, cx = w - 16 - R, cy = 96 + R;
    ctx.fillStyle = "rgba(10,14,9,0.75)";
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = "#2f3a2b";
    ctx.stroke();
    const scale = R / 900;
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, TAU);
    ctx.clip();
    ctx.fillStyle = "rgba(120,130,110,0.35)";
    for (const b of this.city.buildings) {
      ctx.fillRect(cx + (b.x - p.x) * scale, cy + (b.y - p.y) * scale, b.w * scale, b.h * scale);
    }
    ctx.restore();
    for (const z of this.zombies) {
      const zx = (z.x - p.x) * scale, zy = (z.y - p.y) * scale;
      if (zx * zx + zy * zy > R * R) continue;
      ctx.fillStyle = z.def.boss ? "#ff3b3b" : "#9be15d";
      ctx.fillRect(cx + zx - 1.5, cy + zy - 1.5, z.def.boss ? 6 : 3, z.def.boss ? 6 : 3);
    }
    ctx.fillStyle = "#fff";
    ctx.fillRect(cx - 2, cy - 2, 4, 4);
    ctx.textBaseline = "alphabetic";
  }
}

// ------------------------------------------------------------------ drawing helpers
function panel(ctx, x, y, w, h) {
  ctx.fillStyle = "rgba(14,18,13,0.78)";
  ctx.strokeStyle = "rgba(47,58,43,0.9)";
  ctx.lineWidth = 1;
  roundRect(ctx, x, y, w, h, 10);
  ctx.fill();
  ctx.stroke();
}

function bar(ctx, x, y, w, h, frac, color) {
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  roundRect(ctx, x, y, w, h, h / 2);
  ctx.fill();
  if (frac > 0) {
    ctx.fillStyle = color;
    roundRect(ctx, x, y, Math.max(h, w * clamp(frac, 0, 1)), h, h / 2);
    ctx.fill();
  }
}

function text(ctx, s, x, y, size, color, weight = "normal") {
  ctx.font = `${weight} ${size}px Segoe UI, system-ui, sans-serif`;
  ctx.fillStyle = color;
  ctx.fillText(s, x, y);
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect ? ctx.roundRect(x, y, w, h, r) : ctx.rect(x, y, w, h);
}

function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const c = (v) => clamp(v + amt, 0, 255);
  return `rgb(${c(n >> 16)},${c((n >> 8) & 255)},${c(n & 255)})`;
}

function mix(hex, hex2) {
  const a = parseInt(hex.slice(1), 16), b = parseInt(hex2.slice(1), 16);
  const ch = (s) => Math.round((((a >> s) & 255) + ((b >> s) & 255)) / 2);
  return `rgb(${ch(16)},${ch(8)},${ch(0)})`;
}
