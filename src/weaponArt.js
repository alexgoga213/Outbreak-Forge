// Side-view weapon artwork drawn with canvas paths (original designs, no image files).
// Every weapon is designed in a 200 x 80 local box, muzzle pointing right, then scaled.
// drawWeapon() supports animation: idle bob, recoil kick, muzzle flash, reload tilt,
// spinning minigun barrels, flickering pilot flame and glowing energy weapons.

const ART_W = 200, ART_H = 80;

// ------------------------------------------------------------------ small drawing helpers
function metal(g, y0, y1, base = [70, 74, 80]) {
  const grad = g.createLinearGradient(0, y0, 0, y1);
  const [r, gg, b] = base;
  grad.addColorStop(0, `rgb(${r + 55},${gg + 55},${b + 55})`);
  grad.addColorStop(0.35, `rgb(${r + 15},${gg + 15},${b + 15})`);
  grad.addColorStop(1, `rgb(${Math.max(0, r - 35)},${Math.max(0, gg - 35)},${Math.max(0, b - 35)})`);
  return grad;
}

function poly(g, pts, fill, stroke = "rgba(0,0,0,0.55)") {
  g.beginPath();
  g.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
  g.closePath();
  g.fillStyle = fill;
  g.fill();
  if (stroke) {
    g.strokeStyle = stroke;
    g.lineWidth = 1.2;
    g.stroke();
  }
}

function box(g, x, y, w, h, fill, r = 2, stroke = "rgba(0,0,0,0.55)") {
  g.beginPath();
  if (g.roundRect) g.roundRect(x, y, w, h, r);
  else g.rect(x, y, w, h);
  g.fillStyle = fill;
  g.fill();
  if (stroke) {
    g.strokeStyle = stroke;
    g.lineWidth = 1.2;
    g.stroke();
  }
}

function lines(g, x0, y0, x1, y1, n, color = "rgba(0,0,0,0.45)", w = 1) {
  g.strokeStyle = color;
  g.lineWidth = w;
  g.beginPath();
  for (let i = 0; i < n; i++) {
    const x = x0 + ((x1 - x0) * i) / Math.max(1, n - 1);
    g.moveTo(x, y0);
    g.lineTo(x, y1);
  }
  g.stroke();
}

function wood(g, y0, y1) {
  const grad = g.createLinearGradient(0, y0, 0, y1);
  grad.addColorStop(0, "#a8723f");
  grad.addColorStop(0.5, "#7d4f27");
  grad.addColorStop(1, "#553417");
  return grad;
}

function glow(g, x, y, r, color) {
  const grad = g.createRadialGradient(x, y, 0, x, y, r);
  grad.addColorStop(0, color);
  grad.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = grad;
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.fill();
}

// ------------------------------------------------------------------ weapon designs
// Each entry: draw(g, anim) in local coordinates + muzzle point + whether it has a magazine.
export const WEAPON_ART = {
  pistol: {
    muzzle: [152, 30],
    draw(g, a) {
      poly(g, [[58, 44], [90, 44], [84, 78], [56, 78]], metal(g, 44, 78, [40, 42, 46])); // grip
      lines(g, 60, 52, 82, 52, 1);
      g.strokeStyle = "rgba(255,255,255,0.08)";
      for (let y = 54; y < 76; y += 4) { g.beginPath(); g.moveTo(60, y); g.lineTo(84, y); g.stroke(); }
      g.strokeStyle = "#1c1d20"; g.lineWidth = 3;
      g.beginPath(); g.arc(100, 50, 9, 0, Math.PI); g.stroke(); // trigger guard
      box(g, 50, 38, 92, 9, metal(g, 38, 47, [45, 47, 52]), 2); // frame
      box(g, 40, 20, 112, 19, metal(g, 20, 39, [60, 63, 68]), 3); // slide
      lines(g, 46, 23, 62, 36, 6, "rgba(0,0,0,0.5)");
      box(g, 96, 23, 18, 6, "#15161a", 1, null); // ejection port
      box(g, 140, 16, 5, 5, "#222", 1, null); box(g, 46, 16, 6, 5, "#222", 1, null); // sights
      if (a.mag !== false) box(g, 62, 72, 22, 6, "#1a1b1e", 1);
    },
  },
  smg: {
    muzzle: [190, 34],
    draw(g, a) {
      g.strokeStyle = "#2a2c30"; g.lineWidth = 4; // folding wire stock
      g.beginPath(); g.moveTo(34, 30); g.lineTo(4, 30); g.lineTo(4, 50); g.lineTo(28, 42); g.stroke();
      if (a.mag !== false) poly(g, [[98, 44], [112, 44], [124, 76], [108, 79]], metal(g, 44, 79, [35, 36, 40]));
      poly(g, [[62, 44], [78, 44], [72, 72], [58, 72]], metal(g, 44, 72, [38, 40, 44]));
      g.strokeStyle = "#1c1d20"; g.lineWidth = 3;
      g.beginPath(); g.arc(86, 50, 7, 0, Math.PI); g.stroke();
      box(g, 32, 24, 120, 21, metal(g, 24, 45, [58, 61, 66]), 3);
      box(g, 150, 28, 34, 12, metal(g, 28, 40, [40, 42, 46]), 2); // suppressor
      lines(g, 154, 29, 180, 39, 6, "rgba(0,0,0,0.35)");
      box(g, 118, 30, 26, 12, "#222428", 2); // handguard
      box(g, 60, 18, 40, 6, "#2a2c30", 1); // top rail
      lines(g, 62, 18, 98, 24, 8, "rgba(0,0,0,0.5)");
    },
  },
  shotgun: {
    muzzle: [198, 30],
    draw(g, a) {
      const pump = a.pump || 0; // pump-action slide, 0..1
      poly(g, [[0, 30], [44, 26], [46, 44], [14, 58], [0, 56]], wood(g, 26, 58)); // stock
      box(g, 44, 24, 42, 21, metal(g, 24, 45, [55, 58, 62]), 3); // receiver
      g.strokeStyle = "#1c1d20"; g.lineWidth = 3;
      g.beginPath(); g.arc(68, 50, 7, 0, Math.PI); g.stroke();
      box(g, 84, 26, 114, 7, metal(g, 26, 33, [62, 64, 68]), 2); // barrel
      box(g, 84, 34, 96, 7, metal(g, 34, 41, [44, 46, 50]), 2); // tube magazine
      box(g, 112 - pump * 16, 33, 40, 14, wood(g, 33, 47), 4); // pump grip
      lines(g, 118 - pump * 16, 35, 146 - pump * 16, 45, 8, "rgba(0,0,0,0.35)");
      box(g, 192, 23, 4, 4, "#d9c27a", 1, null); // bead sight
    },
  },
  rifle: {
    muzzle: [199, 31],
    draw(g, a) {
      box(g, 6, 28, 36, 8, metal(g, 28, 36, [40, 42, 46]), 2); // buffer tube
      poly(g, [[0, 24], [26, 26], [26, 44], [2, 50]], metal(g, 24, 50, [48, 50, 54])); // stock
      if (a.mag !== false) poly(g, [[92, 38], [108, 38], [116, 70], [100, 73]], metal(g, 38, 73, [50, 46, 38]));
      poly(g, [[64, 38], [78, 38], [72, 64], [60, 62]], metal(g, 38, 64, [38, 40, 44])); // grip
      g.strokeStyle = "#1c1d20"; g.lineWidth = 3;
      g.beginPath(); g.arc(85, 44, 7, 0, Math.PI); g.stroke();
      box(g, 38, 22, 84, 17, metal(g, 22, 39, [62, 66, 60]), 2); // receiver
      box(g, 118, 24, 52, 15, metal(g, 24, 39, [50, 54, 48]), 2); // handguard
      for (let x = 122; x < 166; x += 7) box(g, x, 28, 4, 7, "#1c1e1c", 1, null);
      box(g, 168, 29, 24, 5, metal(g, 29, 34, [60, 62, 66]), 1); // barrel
      box(g, 190, 27, 9, 9, "#2a2c30", 1); // flash hider
      box(g, 46, 15, 96, 6, "#26282a", 1); // top rail
      lines(g, 48, 15, 140, 21, 16, "rgba(0,0,0,0.5)");
      box(g, 60, 9, 18, 7, "#1e2022", 2); // optic
      g.fillStyle = "rgba(255,80,60,0.8)"; g.fillRect(74, 11, 3, 3);
    },
  },
  sniper: {
    muzzle: [200, 32],
    draw(g, a) {
      poly(g, [[0, 26], [34, 26], [40, 44], [8, 56], [0, 52]], "#4a5238"); // stock
      box(g, 4, 40, 10, 12, "#1c1d1a", 2);
      g.strokeStyle = "#2a2c30"; g.lineWidth = 3; // bipod
      g.beginPath(); g.moveTo(150, 36); g.lineTo(138, 62); g.moveTo(152, 36); g.lineTo(166, 62); g.stroke();
      box(g, 32, 26, 66, 16, metal(g, 26, 42, [54, 58, 50]), 3); // body
      if (a.mag !== false) box(g, 64, 42, 16, 12, "#1e2022", 2);
      g.strokeStyle = "#1c1d20"; g.lineWidth = 3;
      g.beginPath(); g.arc(52, 48, 6, 0, Math.PI); g.stroke();
      box(g, 96, 29, 104, 6, metal(g, 29, 35, [58, 60, 64]), 2); // long barrel
      box(g, 186, 27, 14, 10, "#222", 2); // muzzle brake
      box(g, 50, 10, 70, 11, metal(g, 10, 21, [36, 38, 42]), 5); // scope
      box(g, 44, 8, 10, 15, "#1a1b1e", 3); box(g, 116, 8, 10, 15, "#1a1b1e", 3);
      g.fillStyle = "rgba(120,200,255,0.6)"; g.fillRect(124, 11, 2, 9);
      box(g, 70, 20, 6, 7, "#1a1b1e", 1, null); box(g, 96, 20, 6, 7, "#1a1b1e", 1, null);
      g.fillStyle = "#3a3c40"; g.beginPath(); g.arc(90, 46, 4, 0, Math.PI * 2); g.fill(); // bolt knob
    },
  },
  flamer: {
    muzzle: [196, 31],
    draw(g, a) {
      box(g, 18, 44, 62, 22, metal(g, 44, 66, [150, 50, 36]), 10); // fuel tank
      poly(g, [[49, 50], [55, 61], [43, 61]], "#f2d14e", "rgba(0,0,0,0.6)"); // hazard sign
      g.fillStyle = "#222"; g.fillRect(48.3, 53.5, 1.4, 4); g.fillRect(48.3, 58.5, 1.4, 1.4);
      g.strokeStyle = "#2a2c30"; g.lineWidth = 4; // hose
      g.beginPath(); g.moveTo(78, 54); g.quadraticCurveTo(100, 66, 112, 40); g.stroke();
      box(g, 40, 24, 110, 17, metal(g, 24, 41, [64, 58, 50]), 3);
      poly(g, [[70, 40], [84, 40], [80, 64], [68, 64]], metal(g, 40, 64, [40, 40, 42]));
      poly(g, [[124, 40], [136, 40], [134, 60], [124, 60]], metal(g, 40, 60, [40, 40, 42]));
      box(g, 148, 26, 40, 11, metal(g, 26, 37, [80, 82, 86]), 2); // nozzle
      lines(g, 150, 27, 170, 36, 5, "rgba(0,0,0,0.4)");
      box(g, 186, 25, 10, 13, "#2a2c30", 2);
      // pilot flame
      const f = 0.7 + 0.3 * Math.sin(a.t * 30) + 0.15 * Math.sin(a.t * 47);
      glow(g, 199, 31, 10 * f, "rgba(255,160,40,0.95)");
      glow(g, 199, 31, 4 * f, "rgba(170,220,255,0.9)");
    },
  },
  minigun: {
    muzzle: [198, 34],
    draw(g, a) {
      g.strokeStyle = "#7a6a3a"; g.lineWidth = 6; // ammo belt
      g.beginPath(); g.moveTo(60, 50); g.quadraticCurveTo(40, 76, 10, 74); g.stroke();
      g.strokeStyle = "rgba(0,0,0,0.4)"; g.lineWidth = 1;
      for (let i = 0; i < 9; i++) { g.beginPath(); g.moveTo(14 + i * 5, 70); g.lineTo(16 + i * 5, 78); g.stroke(); }
      box(g, 36, 18, 62, 32, metal(g, 18, 50, [52, 55, 60]), 6); // motor housing
      lines(g, 44, 22, 66, 46, 6, "rgba(0,0,0,0.35)");
      box(g, 50, 8, 34, 6, "#1e2022", 3); // carry handle
      // rotating barrel cluster: draw 3 visible barrels whose vertical positions cycle
      const spin = a.spin || 0;
      box(g, 96, 22, 12, 24, metal(g, 22, 46, [40, 42, 46]), 3);
      for (let k = 0; k < 6; k++) {
        const ang = spin + (k / 6) * Math.PI * 2;
        if (Math.cos(ang) < -0.2) continue; // back barrels hidden
        const y = 34 + Math.sin(ang) * 8;
        const shade = 50 + Math.cos(ang) * 30;
        box(g, 106, y - 2.5, 90, 5, `rgb(${shade},${shade + 2},${shade + 6})`, 2, "rgba(0,0,0,0.5)");
      }
      box(g, 150, 24, 8, 20, "#2a2c30", 2); box(g, 186, 24, 10, 20, "#2a2c30", 2); // barrel clamps
    },
  },
  rocket: {
    muzzle: [200, 32],
    draw(g, a) {
      box(g, 10, 20, 176, 24, metal(g, 20, 44, [70, 82, 52]), 8); // tube
      lines(g, 30, 21, 170, 43, 3, "rgba(0,0,0,0.25)", 3);
      box(g, 2, 18, 14, 28, "#2a3220", 4); // rear flare
      box(g, 180, 17, 10, 30, "#2a3220", 4); // front ring
      if (a.mag !== false) { // rocket warhead peeking out
        poly(g, [[188, 24], [198, 28], [200, 32], [198, 36], [188, 40]], metal(g, 24, 40, [120, 60, 40]));
      }
      box(g, 70, 8, 26, 12, "#1e2022", 2); // sight
      g.fillStyle = "rgba(255,80,60,0.8)"; g.fillRect(90, 11, 3, 3);
      poly(g, [[80, 44], [94, 44], [90, 66], [78, 66]], metal(g, 44, 66, [38, 40, 42]));
      poly(g, [[118, 44], [130, 44], [128, 60], [118, 60]], metal(g, 44, 60, [38, 40, 42]));
      g.fillStyle = "#f2d14e"; g.fillRect(140, 30, 22, 4);
    },
  },
  tesla: {
    muzzle: [196, 34],
    draw(g, a) {
      box(g, 26, 26, 110, 20, metal(g, 26, 46, [36, 50, 70]), 6);
      poly(g, [[56, 44], [70, 44], [66, 68], [54, 68]], metal(g, 44, 68, [30, 32, 38]));
      box(g, 80, 46, 30, 12, "#162030", 3); // power cell
      const pulse = 0.55 + 0.45 * Math.sin(a.t * 8);
      g.fillStyle = `rgba(120,210,255,${pulse})`; g.fillRect(84, 49, 22 * pulse, 6);
      // copper coils
      for (let k = 0; k < 5; k++) {
        const x = 136 + k * 10;
        g.strokeStyle = "#c0773a"; g.lineWidth = 4;
        g.beginPath(); g.ellipse(x, 35, 4, 12 - k, 0, 0, Math.PI * 2); g.stroke();
        g.strokeStyle = "rgba(255,210,160,0.5)"; g.lineWidth = 1;
        g.beginPath(); g.ellipse(x - 1, 33, 3, 10 - k, 0, 0, Math.PI); g.stroke();
      }
      box(g, 132, 32, 56, 6, "#22303e", 2, null);
      poly(g, [[186, 26], [198, 32], [186, 30]], "#c0c6cc"); poly(g, [[186, 42], [198, 36], [186, 38]], "#c0c6cc");
      glow(g, 196, 34, 12 * pulse, "rgba(140,220,255,0.9)");
      // little arcs between coils
      g.strokeStyle = `rgba(190,240,255,${pulse})`; g.lineWidth = 1.5;
      g.beginPath();
      let x = 138, y = 24 + Math.random() * 4;
      g.moveTo(x, y);
      for (let k = 0; k < 6; k++) { x += 8; y = 22 + Math.random() * 6; g.lineTo(x, y); }
      g.stroke();
    },
  },
  plasma: {
    muzzle: [198, 33],
    draw(g, a) {
      poly(g, [[0, 28], [40, 24], [44, 42], [10, 54], [0, 50]], metal(g, 24, 54, [58, 52, 70]));
      box(g, 40, 22, 120, 22, metal(g, 22, 44, [70, 66, 84]), 10);
      poly(g, [[60, 44], [74, 44], [70, 68], [58, 68]], metal(g, 44, 68, [40, 38, 48]));
      const pulse = 0.6 + 0.4 * Math.sin(a.t * 6);
      for (let k = 0; k < 4; k++) {
        g.fillStyle = `rgba(200,140,255,${0.35 + 0.5 * ((Math.sin(a.t * 6 - k) + 1) / 2)})`;
        g.fillRect(86 + k * 16, 30, 10, 6);
      }
      box(g, 156, 26, 36, 14, metal(g, 26, 40, [90, 86, 104]), 6); // emitter
      poly(g, [[176, 22], [198, 28], [198, 38], [176, 44]], metal(g, 22, 44, [60, 56, 74]));
      glow(g, 198, 33, 14 * pulse, "rgba(200,140,255,0.95)");
      box(g, 60, 14, 50, 8, "#2a2633", 4); // top sight
      g.fillStyle = "rgba(200,140,255,0.8)"; g.fillRect(100, 16, 6, 4);
    },
  },
};

/**
 * Draw a weapon centred at (cx, cy), `width` px wide.
 * anim: { t, recoil 0..1, reload 0..1 (progress, or <0 when not reloading), spin, pump }
 */
export function drawWeapon(g, id, cx, cy, width, anim = {}) {
  const art = WEAPON_ART[id];
  if (!art) return;
  const s = width / ART_W;
  const t = anim.t || 0;
  const recoil = anim.recoil || 0;
  const reloading = anim.reload !== undefined && anim.reload >= 0;
  const rp = reloading ? anim.reload : 0;
  g.save();
  g.translate(cx, cy + Math.sin(t * 2.2) * 1.2 * s * 3);
  // reload: tilt the weapon up, then back; magazine disappears in the middle of the motion
  const tilt = reloading ? -0.45 * Math.sin(Math.PI * rp) : 0;
  g.rotate(tilt - recoil * 0.12);
  g.translate(-recoil * 10 * s, 0);
  g.scale(s, s);
  g.translate(-ART_W / 2, -ART_H / 2);
  const magOut = reloading && rp > 0.25 && rp < 0.75;
  art.draw(g, { ...anim, t, mag: !magOut, pump: anim.pump ?? (reloading ? Math.sin(Math.PI * rp) : recoil) });
  // muzzle flash on the recoil peak
  if (recoil > 0.55 && id !== "tesla" && id !== "flamer") {
    const [mx, my] = art.muzzle;
    const big = id === "rocket" || id === "sniper" || id === "shotgun" ? 1.6 : 1;
    const color = id === "plasma" ? "rgba(210,150,255,0.95)" : "rgba(255,215,120,0.95)";
    glow(g, mx + 8, my, 22 * big * recoil, color);
    g.fillStyle = "rgba(255,250,220,0.9)";
    g.beginPath();
    for (let k = 0; k < 8; k++) {
      const ang = (k / 8) * Math.PI * 2;
      const rr = (k % 2 ? 6 : 16) * big * recoil;
      g.lineTo(mx + 8 + Math.cos(ang) * rr * 1.4, my + Math.sin(ang) * rr * 0.7);
    }
    g.fill();
  }
  g.restore();
}

/** Static image of a weapon as a data URL (for the HTML shop). Cached. */
const urlCache = new Map();
export function weaponImageURL(id, width = 220) {
  const key = `${id}:${width}`;
  if (urlCache.has(key)) return urlCache.get(key);
  const c = document.createElement("canvas");
  const h = Math.round((width * ART_H) / ART_W);
  c.width = width * 2;
  c.height = h * 2;
  const g = c.getContext("2d");
  g.scale(2, 2);
  drawWeapon(g, id, width / 2, h / 2, width * 0.94, { t: 0 });
  const url = c.toDataURL("image/png");
  urlCache.set(key, url);
  return url;
}

// ------------------------------------------------------------------ HUD icons (replace emoji)
export function drawIcon(g, name, x, y, s, color = "#e8eedf") {
  g.save();
  g.translate(x, y);
  g.scale(s / 20, s / 20);
  g.fillStyle = color;
  g.strokeStyle = color;
  g.lineWidth = 2;
  if (name === "scrap") { // hex nut
    g.beginPath();
    for (let k = 0; k < 6; k++) { const a = (k / 6) * Math.PI * 2 + Math.PI / 6; g.lineTo(Math.cos(a) * 9, Math.sin(a) * 9); }
    g.closePath(); g.fill();
    g.fillStyle = "rgba(0,0,0,0.55)"; g.beginPath(); g.arc(0, 0, 3.6, 0, Math.PI * 2); g.fill();
  } else if (name === "skull") {
    g.beginPath(); g.arc(0, -2, 8, Math.PI * 0.9, Math.PI * 2.1); g.lineTo(5, 7); g.lineTo(-5, 7); g.closePath(); g.fill();
    g.fillStyle = "rgba(0,0,0,0.7)";
    g.beginPath(); g.arc(-3.3, -1.5, 2.4, 0, Math.PI * 2); g.arc(3.3, -1.5, 2.4, 0, Math.PI * 2); g.fill();
    g.fillRect(-1, 3, 2, 3);
  } else if (name === "clock") {
    g.beginPath(); g.arc(0, 0, 8, 0, Math.PI * 2); g.stroke();
    g.beginPath(); g.moveTo(0, 0); g.lineTo(0, -5); g.moveTo(0, 0); g.lineTo(4, 2); g.stroke();
  } else if (name === "zombie") { // head with arms
    g.beginPath(); g.arc(0, -3, 5, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.moveTo(-8, 9); g.quadraticCurveTo(0, 0, 8, 9); g.fill();
    g.fillStyle = "#e6ff7a"; g.fillRect(-3, -4, 2, 2); g.fillRect(1, -4, 2, 2);
  } else if (name === "heart") {
    g.beginPath(); g.moveTo(0, 8); g.bezierCurveTo(-12, -2, -6, -10, 0, -4); g.bezierCurveTo(6, -10, 12, -2, 0, 8); g.fill();
  } else if (name === "dna") {
    g.lineWidth = 2;
    g.beginPath();
    for (let k = -9; k <= 9; k++) g.lineTo(Math.sin(k * 0.4) * 5, k);
    g.stroke();
    g.beginPath();
    for (let k = -9; k <= 9; k++) g.lineTo(-Math.sin(k * 0.4) * 5, k);
    g.stroke();
  }
  g.restore();
}
