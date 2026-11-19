// DOM overlay screens: menu, lab, shop, level-up, pause, game over.

import { LAB, PERKS, labLevel } from "./perks.js";

const PERK_BY_ID = Object.fromEntries(PERKS.map((p) => [p.id, p]));
import { MAX_WEAPON_LEVEL, WEAPONS, WEAPON_BY_ID, dps, upgradeCost, weaponStats } from "./weapons.js";
import { fmt, fmtTime } from "./util.js";
import { weaponImageURL } from "./weaponArt.js";

// small inline icon used instead of an emoji for scrap
const NUT = `<svg class="nut" viewBox="-10 -10 20 20" aria-hidden="true"><polygon points="7.8,4.5 0,9 -7.8,4.5 -7.8,-4.5 0,-9 7.8,-4.5" fill="#f2c14e"/><circle r="3.6" fill="#1d241b"/></svg>`;
const weaponPic = (id) => `<div class="weapon-frame"><img class="weapon-img" src="${weaponImageURL(id)}" alt=""></div>`;
import { resetSave, writeSave } from "./save.js";

export class UI {
  constructor(game, audio) {
    this.game = game;
    this.audio = audio;
    this.el = document.getElementById("overlay");
    this.toastEl = document.getElementById("toast");
    this.screen = null;
    this.shopTab = "arsenal";

    game.onStateChange = (s) => this.show(s);
    game.onToast = (msg) => this.toast(msg);

    this.el.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-action]");
      if (!btn || btn.disabled) return;
      this.audio.unlock();
      if (!["buy", "upgrade", "heal", "lab-buy"].includes(btn.dataset.action)) this.audio.click();
      this.handle(btn.dataset.action, btn.dataset.id);
    });

    window.addEventListener("keydown", (e) => {
      const k = e.key.toLowerCase();
      if (this.screen === "levelup" && ["1", "2", "3"].includes(k)) {
        const perk = this.game.perkChoices[Number(k) - 1];
        if (perk) this.game.choosePerk(perk);
      } else if (this.screen === "shop" && k === "enter") {
        this.game.nextWave();
      } else if (this.screen === "paused" && (k === "escape" || k === "p")) {
        this.game.setState("playing");
      } else if (this.screen === "menu" && k === "enter") {
        this.handle("play");
      }
    });
  }

  handle(action, id) {
    const g = this.game;
    switch (action) {
      case "play": this.audio.unlock(); g.start(); break;
      case "menu": g.setState("menu"); break;
      case "lab": this.show("lab"); break;
      case "lab-buy": this.buyLab(id); break;
      case "reset":
        if (confirm("Delete all DNA, lab upgrades and records?")) {
          g.save = resetSave();
          this.show("lab");
        }
        break;
      case "resume": g.setState("playing"); break;
      case "next": g.nextWave(); break;
      case "buy": g.buyWeapon(id); this.show("shop"); break;
      case "upgrade": g.upgradeWeapon(id); this.show("shop"); break;
      case "equip": g.equip(id); this.show("shop"); break;
      case "heal": g.buyHeal(); this.show("shop"); break;
      case "tab": this.shopTab = id; this.show("shop"); break;
      case "perk": g.choosePerk(g.perkChoices[Number(id)]); break;
      case "mute":
        this.audio.setMuted(!this.audio.muted);
        g.save.muted = this.audio.muted;
        writeSave(g.save);
        this.show(this.screen);
        break;
    }
  }

  buyLab(id) {
    const s = this.game.save;
    const lab = LAB.find((l) => l.id === id);
    const lv = labLevel(s, id);
    if (lv >= lab.max || s.dna < lab.cost(lv)) return;
    s.dna -= lab.cost(lv);
    s.lab[id] = lv + 1;
    writeSave(s);
    this.audio.buy();
    this.show("lab");
  }

  toast(msg) {
    this.toastEl.textContent = msg;
    this.toastEl.classList.remove("hidden");
    clearTimeout(this._toastT);
    this._toastT = setTimeout(() => this.toastEl.classList.add("hidden"), 2200);
  }

  show(screen) {
    this.screen = screen;
    if (screen === "playing") {
      this.el.classList.add("hidden");
      this.el.innerHTML = "";
      return;
    }
    const render = {
      menu: () => this.menu(), lab: () => this.lab(), shop: () => this.shop(), levelup: () => this.levelUp(),
      paused: () => this.paused(), gameover: () => this.gameOver(),
    }[screen];
    if (!render) return;
    this.el.innerHTML = render();
    this.el.classList.remove("hidden");
  }

  // ------------------------------------------------------------------ screens
  menu() {
    const s = this.game.save;
    return `
      <div class="panel" style="max-width:640px">
        <h1 class="title">OUTBREAK FORGE</h1>
        <p class="subtitle">Hold the line. Forge deadlier weapons. Evolve.</p>
        <div class="menu-buttons">
          <button class="primary big" data-action="play">▶ Play</button>
          <button data-action="lab">🧬 Laboratory <span class="dna">(${fmt(s.dna)} DNA)</span></button>
          <button data-action="mute">${this.audio.muted ? "🔇 Sound off" : "🔊 Sound on"}</button>
        </div>
        <div class="stats-line">
          <span>Best wave <b>${s.best.wave}</b></span>
          <span>Most kills <b>${fmt(s.best.kills)}</b></span>
          <span>Runs <b>${s.runs}</b></span>
          <span>Total kills <b>${fmt(s.totalKills)}</b></span>
        </div>
        <div class="controls">
          <kbd>WASD</kbd><span>move</span>
          <kbd>Mouse</kbd><span>aim · hold left click to shoot</span>
          <kbd>Shift</kbd><span>dash (brief invulnerability)</span>
          <kbd>1-0 / wheel</kbd><span>switch weapon</span>
          <kbd>R</kbd><span>reload</span>
          <kbd>Esc</kbd><span>pause</span>
        </div>
      </div>`;
  }

  lab() {
    const s = this.game.save;
    const cards = LAB.map((l) => {
      const lv = labLevel(s, l.id);
      const maxed = lv >= l.max;
      const cost = l.cost(lv);
      return `
        <div class="card ${lv ? "owned" : ""}">
          <div class="between"><span class="icon">${l.icon}</span><span class="meta">Lv ${lv}/${l.max}</span></div>
          <div class="name">${l.name}</div>
          <div class="desc">${l.desc}${l.max > 1 ? " per level" : ""}</div>
          <div class="bar"><span style="width:${(lv / l.max) * 100}%"></span></div>
          <button data-action="lab-buy" data-id="${l.id}" ${maxed || s.dna < cost ? "disabled" : ""}>
            ${maxed ? "MAXED" : `Upgrade · <span class="dna">${cost} DNA</span>`}</button>
        </div>`;
    }).join("");
    return `
      <div class="panel">
        <div class="between">
          <div><h2>🧬 Laboratory</h2><div class="meta" style="color:var(--muted)">Permanent upgrades, kept between runs. DNA is earned when a run ends.</div></div>
          <div class="dna" style="font-size:24px">${fmt(s.dna)} DNA</div>
        </div>
        <h3>Upgrades</h3>
        <div class="grid">${cards}</div>
        <div class="between" style="margin-top:20px">
          <button data-action="reset" style="color:var(--danger)">Reset progress</button>
          <button class="primary" data-action="menu">← Back</button>
        </div>
      </div>`;
  }

  shop() {
    const g = this.game, r = g.run;
    const tab = this.shopTab;
    const stat = (label, v) => `<span>${label} <b style="color:var(--text)">${v}</b></span>`;

    const owned = WEAPONS.filter((w) => r.owned[w.id]);
    const locked = WEAPONS.filter((w) => !r.owned[w.id]);

    const arsenal = owned.map((w) => {
      const lv = r.owned[w.id];
      const st = g.stats(w.id);
      const next = lv < MAX_WEAPON_LEVEL ? weaponStats(w, lv + 1, g.mods) : null;
      const cost = upgradeCost(w, lv);
      const equipped = r.current === w.id;
      return `
        <div class="card owned ${equipped ? "equipped" : ""}">
          ${weaponPic(w.id)}
          <div class="between"><span class="meta">Level</span><span class="meta">Lv ${lv}/${MAX_WEAPON_LEVEL}</span></div>
          <div class="name">${w.name}</div>
          <div class="meta" style="display:flex;gap:10px;flex-wrap:wrap">
            ${stat("DPS", fmt(dps(st)))}${next ? `<span style="color:var(--accent)">→ ${fmt(dps(next))}</span>` : ""}
            ${stat("Mag", st.mag)}${stat("Dmg", fmt(st.damage))}
          </div>
          <div class="bar"><span style="width:${(lv / MAX_WEAPON_LEVEL) * 100}%"></span></div>
          <div class="row" style="justify-content:stretch">
            <button style="flex:1" data-action="upgrade" data-id="${w.id}" ${!next || r.scrap < cost ? "disabled" : ""}>
              ${next ? `⬆ <span class="currency">${fmt(cost)}</span>` : "MAXED"}</button>
            <button data-action="equip" data-id="${w.id}" ${equipped ? "disabled" : ""}>${equipped ? "✓" : "Equip"}</button>
          </div>
        </div>`;
    }).join("");

    const armory = locked.map((w) => {
      const st = weaponStats(w, 1, g.mods);
      return `
        <div class="card">
          ${weaponPic(w.id)}
          <div class="between"><span class="meta">Price</span><span class="currency">${NUT} ${fmt(w.price)}</span></div>
          <div class="name">${w.name}</div>
          <div class="desc">${w.desc}</div>
          <div class="meta" style="display:flex;gap:10px;flex-wrap:wrap">${stat("DPS", fmt(dps(st)))}${stat("Mag", st.mag)}${stat("Range", w.range)}</div>
          <button data-action="buy" data-id="${w.id}" ${r.scrap < w.price ? "disabled" : ""}>Buy</button>
        </div>`;
    }).join("") || `<div class="meta">You own every weapon. Upgrade them to max level!</div>`;

    const healCost = g.healCost();
    const hpFull = g.player.hp >= g.mods.maxHp;
    const perks = Object.entries(r.perks);
    const perkList = perks.length
      ? perks.map(([id, n]) => `${PERK_BY_ID[id].icon} ${PERK_BY_ID[id].name} ×${n}`).join(" · ")
      : "";

    return `
      <div class="panel">
        <div class="between">
          <div><h2>Wave ${r.wave} survived</h2>
            <div style="color:var(--muted)">❤️ ${Math.ceil(g.player.hp)}/${g.mods.maxHp} · Lv ${r.level} · ☠ ${fmt(r.kills)} kills · ⏱ ${fmtTime(r.time)}</div></div>
          <div class="currency" style="font-size:28px">${NUT} ${fmt(r.scrap)}</div>
        </div>
        <div class="tabs">
          <button class="${tab === "arsenal" ? "active" : ""}" data-action="tab" data-id="arsenal">Your arsenal (${owned.length})</button>
          <button class="${tab === "armory" ? "active" : ""}" data-action="tab" data-id="armory">Armory (${locked.length})</button>
        </div>
        <div class="grid">${tab === "arsenal" ? arsenal : armory}</div>
        <h3>Supplies</h3>
        <div class="row" style="justify-content:flex-start">
          <button data-action="heal" ${r.scrap < healCost || hpFull ? "disabled" : ""}>🩹 Medkit: heal 50% · <span class="currency">${fmt(healCost)}</span></button>
        </div>
        ${perkList ? `<h3>Perks</h3><div class="meta" style="color:var(--muted)">${perkList}</div>` : ""}
        <div class="between" style="margin-top:22px">
          <span class="meta" style="color:var(--muted)">Next: wave ${r.wave + 1}${(r.wave + 1) % 5 === 0 ? " ☠️ boss" : ""}</span>
          <button class="primary big" data-action="next">Next wave ▶ <span style="font-size:12px;opacity:.7">[Enter]</span></button>
        </div>
      </div>`;
  }

  levelUp() {
    const g = this.game;
    const cards = g.perkChoices.map((p, i) => {
      const have = g.run.perks[p.id] || 0;
      return `
        <div class="card perk ${p.rarity}" data-action="perk" data-id="${i}">
          <div class="icon">${p.icon}</div>
          <div class="rarity">${p.rarity}</div>
          <div class="name">${p.name}</div>
          <div class="desc">${p.desc}</div>
          <div class="key">${have ? `owned ×${have} · ` : ""}press ${i + 1}</div>
        </div>`;
    }).join("");
    return `
      <div class="panel" style="max-width:860px">
        <h2 style="text-align:center;color:var(--rare)">LEVEL ${g.run.level - g.run.pendingLevels + 1}!</h2>
        <p class="subtitle" style="margin-bottom:0">Choose a mutation</p>
        <div class="perk-cards">${cards}</div>
      </div>`;
  }

  paused() {
    return `
      <div class="panel" style="max-width:420px;text-align:center">
        <h2>Paused</h2>
        <div class="menu-buttons" style="margin-top:18px">
          <button class="primary" data-action="resume">Resume [Esc]</button>
          <button data-action="mute">${this.audio.muted ? "🔇 Sound off" : "🔊 Sound on"}</button>
          <button data-action="menu">Quit to menu</button>
        </div>
      </div>`;
  }

  gameOver() {
    const r = this.game.lastRun;
    return `
      <div class="panel" style="max-width:560px;text-align:center">
        <h1 class="title" style="color:var(--danger);text-shadow:0 4px 0 #3d1416">YOU DIED</h1>
        ${r.newBest ? `<p style="color:var(--accent-2);font-weight:700">🏆 New record!</p>` : ""}
        <div class="stats-line" style="font-size:18px">
          <span>Wave <b>${r.wave}</b></span><span>Kills <b>${fmt(r.kills)}</b></span>
          <span>Level <b>${r.level}</b></span><span>Time <b>${fmtTime(r.time)}</b></span>
        </div>
        <div class="stats-line"><span>Bosses <b>${r.bosses}</b></span><span>Damage dealt <b>${fmt(r.damage)}</b></span></div>
        <p style="font-size:22px;margin:22px 0">+<span class="dna">${r.dna} DNA</span></p>
        <div class="menu-buttons">
          <button class="primary big" data-action="play">↻ Play again</button>
          <button data-action="lab">🧬 Spend DNA in the Laboratory</button>
          <button data-action="menu">Main menu</button>
        </div>
      </div>`;
  }
}
