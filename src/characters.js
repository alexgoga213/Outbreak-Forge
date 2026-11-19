// Procedural top-down humanoids: legs with a walk cycle, torso, arms, head, clothing.
// All drawn in local space where +x is the facing direction and the unit is the body radius r.

import { TAU, pick } from "./util.js";

const SHIRTS = ["#5b6e8a", "#8a4b3f", "#6b6b4a", "#3f5a4a", "#7a6a8a", "#9a8a6a", "#4a4a52", "#8a7a3f", "#3f4a6b"];
const PANTS = ["#2f3440", "#3b3226", "#2a2f2a", "#4a3f35", "#252a33"];
const HAIR = ["#2a1f18", "#4a3524", "#1a1a1a", "#7a6040", "#5a5a5a", null];

/** Characters are drawn a bit larger than their collision circle so they read well on screen. */
const VISUAL_SCALE = 1.2;

/** Random clothing for a new zombie. */
export function rollLook(type) {
  return {
    shirt: pick(SHIRTS),
    pants: pick(PANTS),
    hair: pick(HAIR),
    skin: { walker: "#8fa77a", runner: "#a3b386", exploder: "#b8b06a", brute: "#6f8460", spitter: "#86b08a", stalker: "#7d7394", boss: "#9a6a62" }[type],
    tear: Math.random(),
    hood: type === "runner",
  };
}

function ellipse(ctx, x, y, rx, ry, color, stroke) {
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, TAU);
  ctx.fillStyle = color;
  ctx.fill();
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
}

function limb(ctx, x0, y0, x1, y1, width, color) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
}

function legs(ctx, r, phase, color, stride = 0.55, spread = 0.38) {
  const s = Math.sin(phase) * r * stride;
  ellipse(ctx, s, -r * spread, r * 0.42, r * 0.24, color);
  ellipse(ctx, -s, r * spread, r * 0.42, r * 0.24, color);
  // shoes
  ellipse(ctx, s + r * 0.28, -r * spread, r * 0.16, r * 0.2, "#1b1b1b");
  ellipse(ctx, -s + r * 0.28, r * spread, r * 0.16, r * 0.2, "#1b1b1b");
}

function shadow(ctx, r, scale = 1) {
  ctx.fillStyle = "rgba(0,0,0,0.38)";
  ctx.beginPath();
  ctx.ellipse(r * 0.15, r * 0.25, r * 1.05 * scale, r * 0.85 * scale, 0, 0, TAU);
  ctx.fill();
}

// ------------------------------------------------------------------ zombies
export function drawZombie(ctx, z, lean = { x: 0, y: 0 }) {
  const r = z.r, L = z.look, type = z.type;
  const flash = z.flash > 0;
  const tint = flash ? "#ffffff" : z.burn > 0 ? "#ff9a4a" : z.slow > 0 ? "#bfe6ff" : null;
  const skin = tint || L.skin;
  const phase = z.walk;
  const lurch = Math.sin(phase * 0.5) * 0.12;

  ctx.save();
  ctx.translate(z.x, z.y);
  ctx.scale(VISUAL_SCALE, VISUAL_SCALE);
  shadow(ctx, r, type === "boss" ? 1.1 : 1);
  const ang = z.face + lurch;
  ctx.rotate(ang);
  const [lx, ly] = toLocal(lean, ang);

  if (type === "exploder") {
    legs(ctx, r, phase, L.pants, 0.35, 0.45);
    ctx.translate(lx * 0.6, ly * 0.6);
    // swollen body with glowing pustules
    ellipse(ctx, 0, 0, r * 0.95, r * 1.05, skin, "#6a6030");
    ctx.fillStyle = flash ? "#fff" : "#e7d36a";
    for (const [px, py, pr] of [[-0.3, -0.4, 0.22], [0.2, 0.45, 0.18], [-0.45, 0.3, 0.15], [0.35, -0.2, 0.14]]) {
      ctx.beginPath(); ctx.arc(px * r, py * r, pr * r, 0, TAU); ctx.fill();
    }
    limb(ctx, 0.2 * r, -0.85 * r, 0.75 * r, -0.95 * r, r * 0.26, skin);
    limb(ctx, 0.2 * r, 0.85 * r, 0.75 * r, 0.95 * r, r * 0.26, skin);
    ellipse(ctx, r * 0.55, 0, r * 0.32, r * 0.34, skin, "#55502a");
  } else if (type === "boss") {
    legs(ctx, r, phase, "#3a2a26", 0.4, 0.42);
    ctx.translate(lx * 0.8, ly * 0.8);
    // four arms: two huge forward claws, two smaller side tendrils
    const swing = Math.sin(phase) * 0.18;
    limb(ctx, 0.1 * r, -0.75 * r, (0.95 + swing) * r, -0.7 * r, r * 0.3, skin);
    limb(ctx, 0.1 * r, 0.75 * r, (0.95 - swing) * r, 0.7 * r, r * 0.3, skin);
    limb(ctx, -0.2 * r, -0.85 * r, 0.3 * r, -1.25 * r, r * 0.16, "#7a4a44");
    limb(ctx, -0.2 * r, 0.85 * r, 0.3 * r, 1.25 * r, r * 0.16, "#7a4a44");
    ctx.fillStyle = "#e8d8c0";
    for (const s of [-1, 1]) for (const k of [-0.12, 0, 0.12]) {
      ctx.beginPath();
      ctx.moveTo((1.05 + (s > 0 ? -swing : swing)) * r, s * 0.7 * r + k * r);
      ctx.lineTo((1.3 + (s > 0 ? -swing : swing)) * r, s * 0.7 * r + k * r * 1.6);
      ctx.lineTo((1.05 + (s > 0 ? -swing : swing)) * r, s * 0.7 * r + k * r + 3);
      ctx.fill();
    }
    ellipse(ctx, 0, 0, r * 0.75, r * 1.0, skin, "#4a2a26");
    // exposed ribs and spikes on the back
    ctx.strokeStyle = "rgba(240,220,200,0.6)";
    ctx.lineWidth = 3;
    for (let k = -2; k <= 2; k++) {
      ctx.beginPath(); ctx.arc(-r * 0.15, k * r * 0.22, r * 0.4, -0.9, 0.9); ctx.stroke();
    }
    ctx.fillStyle = "#3a2422";
    for (let k = -3; k <= 3; k++) {
      ctx.beginPath();
      ctx.moveTo(-r * 0.6, k * r * 0.22 - 5); ctx.lineTo(-r * 1.0, k * r * 0.24); ctx.lineTo(-r * 0.6, k * r * 0.22 + 5);
      ctx.fill();
    }
    ellipse(ctx, r * 0.45, 0, r * 0.32, r * 0.36, skin, "#4a2a26");
    ctx.fillStyle = "#ff3030";
    ctx.beginPath(); ctx.arc(r * 0.66, -r * 0.13, 4, 0, TAU); ctx.arc(r * 0.66, r * 0.13, 4, 0, TAU); ctx.arc(r * 0.58, 0, 3, 0, TAU); ctx.fill();
  } else {
    const body = {
      walker: [0.5, 0.95], runner: [0.45, 0.82], brute: [0.6, 1.2], spitter: [0.55, 0.9], stalker: [0.45, 0.85],
    }[type];
    const armLen = type === "stalker" ? 1.45 : type === "brute" ? 1.05 : 1.15;
    const armW = type === "brute" ? 0.36 : 0.24;
    legs(ctx, r, phase, L.pants, type === "runner" ? 0.7 : 0.5);
    ctx.translate(lx * 0.6, ly * 0.6);
    // arms reaching forward, swaying out of phase
    const sw = Math.sin(phase) * 0.18 * r;
    const shoulderY = body[1] * r * 0.82;
    if (type === "spitter") {
      limb(ctx, 0, -shoulderY, r * 0.5, -shoulderY * 1.1, r * armW, skin);
      limb(ctx, 0, shoulderY, r * 0.5, shoulderY * 1.1, r * armW, skin);
    } else {
      limb(ctx, 0, -shoulderY, r * armLen + sw, -shoulderY * 0.75, r * armW, tint || L.shirt);
      limb(ctx, 0, shoulderY, r * armLen - sw, shoulderY * 0.75, r * armW, tint || L.shirt);
      ellipse(ctx, r * armLen + sw, -shoulderY * 0.75, r * armW * 0.75, r * armW * 0.75, skin);
      ellipse(ctx, r * armLen - sw, shoulderY * 0.75, r * armW * 0.75, r * armW * 0.75, skin);
    }
    // torso with torn shirt
    const shirt = tint || (type === "stalker" ? "#2a2433" : type === "brute" ? "#4a4038" : L.shirt);
    ellipse(ctx, 0, 0, r * body[0], r * body[1], shirt, "rgba(0,0,0,0.45)");
    if (!tint) {
      ctx.fillStyle = "rgba(90,20,20,0.55)";
      ctx.beginPath(); ctx.arc(r * 0.1, (L.tear - 0.5) * r, r * 0.22, 0, TAU); ctx.fill();
      ctx.fillStyle = skin;
      ctx.beginPath(); ctx.arc(-r * 0.15, (0.5 - L.tear) * r * 0.9, r * 0.16, 0, TAU); ctx.fill();
    }
    if (L.hood) ellipse(ctx, -r * 0.05, 0, r * 0.5, r * 0.5, tint || shadeCss(L.shirt));
    // head (sits higher, so it leans further from the camera)
    ctx.translate(lx * 0.4, ly * 0.4);
    const hx = type === "spitter" ? r * 0.3 : r * 0.08;
    ellipse(ctx, hx, 0, r * 0.4, r * 0.42, skin, "rgba(0,0,0,0.4)");
    if (L.hair && !L.hood && !tint) {
      ctx.fillStyle = L.hair;
      ctx.beginPath(); ctx.arc(hx - r * 0.05, 0, r * 0.4, Math.PI * 0.55, Math.PI * 1.45); ctx.fill();
    }
    // eyes
    ctx.fillStyle = type === "stalker" ? "#d58bff" : "#e6ff7a";
    ctx.beginPath();
    ctx.arc(hx + r * 0.27, -r * 0.14, Math.max(1.5, r * 0.08), 0, TAU);
    ctx.arc(hx + r * 0.27, r * 0.14, Math.max(1.5, r * 0.08), 0, TAU);
    ctx.fill();
    if (type === "spitter") {
      ctx.fillStyle = "#86e06a";
      ctx.beginPath(); ctx.arc(hx + r * 0.45, 0, r * 0.16 + Math.sin(phase * 2) * 1.5, 0, TAU); ctx.fill();
    }
  }
  ctx.restore();
}

// ------------------------------------------------------------------ player
const GUNS = {
  pistol: { len: 14, w: 5, color: "#2a2d30" },
  smg: { len: 20, w: 6, color: "#2a2d30", mag: true },
  shotgun: { len: 26, w: 6, color: "#4a3626", double: true },
  rifle: { len: 30, w: 6, color: "#2f3a2a", mag: true },
  sniper: { len: 40, w: 5, color: "#3a3f30", scope: true },
  flamer: { len: 26, w: 9, color: "#5a3a22", tank: true },
  minigun: { len: 30, w: 12, color: "#3a3d42", barrels: true },
  rocket: { len: 34, w: 11, color: "#3f4a2f", tube: true },
  tesla: { len: 24, w: 9, color: "#2a3a4a", coil: true },
  plasma: { len: 30, w: 10, color: "#3a2a4a", glow: "#c58bff" },
};

export function drawPlayer(ctx, p, weaponId, moving, time, invuln, lean = { x: 0, y: 0 }) {
  const r = p.r;
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.scale(VISUAL_SCALE, VISUAL_SCALE);
  shadow(ctx, r);
  ctx.rotate(p.angle);
  const phase = moving ? time * 14 : 0;
  legs(ctx, r, phase, "#3b4030", 0.5);
  const [lx, ly] = toLocal(lean, p.angle);
  ctx.translate(lx * 0.6, ly * 0.6);

  const gun = GUNS[weaponId] || GUNS.pistol;
  const blink = invuln > 0 && Math.floor(invuln * 30) % 2 === 0;

  // backpack
  ctx.fillStyle = "#3a3324";
  ctx.fillRect(-r * 1.0, -r * 0.55, r * 0.5, r * 1.1);
  // arms holding the weapon
  const gx = r * 0.55;
  limb(ctx, 0, -r * 0.75, gx + 4, -2, r * 0.26, "#4a5a36");
  limb(ctx, 0, r * 0.75, gx + gun.len * 0.45, 2, r * 0.26, "#4a5a36");
  // weapon
  ctx.fillStyle = gun.color;
  ctx.fillRect(gx, -gun.w / 2, gun.len, gun.w);
  ctx.fillStyle = "rgba(255,255,255,0.12)";
  ctx.fillRect(gx, -gun.w / 2, gun.len, 2);
  if (gun.mag) { ctx.fillStyle = "#1e2022"; ctx.fillRect(gx + gun.len * 0.35, gun.w / 2, 5, 6); }
  if (gun.double) { ctx.fillStyle = "#1e2022"; ctx.fillRect(gx + 8, -1, gun.len - 8, 2); }
  if (gun.scope) { ctx.fillStyle = "#15181a"; ctx.fillRect(gx + 8, -gun.w / 2 - 3, 14, 3); }
  if (gun.tank) { ctx.fillStyle = "#b8452f"; ctx.beginPath(); ctx.arc(gx + 4, gun.w / 2 + 4, 5, 0, TAU); ctx.fill(); }
  if (gun.barrels) { ctx.fillStyle = "#1e2022"; for (const o of [-3.5, 0, 3.5]) ctx.fillRect(gx + 12, o - 1, gun.len - 10, 2); }
  if (gun.tube) { ctx.fillStyle = "#2a3320"; ctx.fillRect(gx + gun.len - 6, -gun.w / 2 - 1, 6, gun.w + 2); }
  if (gun.coil) {
    ctx.strokeStyle = `rgba(143,216,255,${0.6 + 0.4 * Math.sin(time * 30)})`;
    ctx.lineWidth = 2;
    for (let k = 0; k < 3; k++) { ctx.beginPath(); ctx.arc(gx + 8 + k * 6, 0, 5, 0, TAU); ctx.stroke(); }
  }
  if (gun.glow) {
    ctx.fillStyle = gun.glow;
    ctx.globalAlpha = 0.6 + 0.4 * Math.sin(time * 10);
    ctx.fillRect(gx + gun.len - 5, -gun.w / 2 + 2, 5, gun.w - 4);
    ctx.globalAlpha = 1;
  }
  // hands
  ellipse(ctx, gx + 4, -2, 3.5, 3.5, "#c9a27a");
  ellipse(ctx, gx + gun.len * 0.45, 2, 3.5, 3.5, "#c9a27a");

  // torso: tactical vest with pouches
  ellipse(ctx, 0, 0, r * 0.55, r * 0.95, blink ? "#ffffff" : "#5a6a42", "#2c3322");
  if (!blink) {
    ctx.fillStyle = "#6f7d52";
    ctx.fillRect(r * 0.05, -r * 0.55, r * 0.3, r * 0.35);
    ctx.fillRect(r * 0.05, r * 0.2, r * 0.3, r * 0.35);
  }
  // helmet + face
  ctx.translate(lx * 0.4, ly * 0.4);
  ellipse(ctx, r * 0.05, 0, r * 0.45, r * 0.45, blink ? "#ffffff" : "#3d4a2c", "#232a19");
  ctx.fillStyle = "rgba(255,255,255,0.1)";
  ctx.beginPath(); ctx.arc(-r * 0.05, -r * 0.12, r * 0.18, 0, TAU); ctx.fill();
  ctx.fillStyle = "#c9a27a";
  ctx.beginPath(); ctx.arc(r * 0.38, 0, r * 0.16, -1.2, 1.2); ctx.fill();
  ctx.restore();
}

/** Convert a world-space offset into the rotated, scaled local frame of a character. */
function toLocal(v, ang) {
  const c = Math.cos(-ang), s = Math.sin(-ang);
  return [(v.x * c - v.y * s) / VISUAL_SCALE, (v.x * s + v.y * c) / VISUAL_SCALE];
}

function shadeCss(hex) {
  const n = parseInt(hex.slice(1), 16);
  const c = (v) => Math.max(0, v - 25);
  return `rgb(${c(n >> 16)},${c((n >> 8) & 255)},${c(n & 255)})`;
}
