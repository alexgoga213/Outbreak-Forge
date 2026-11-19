// Night-time lighting. A darkness layer the size of the screen is filled every frame, then
// light sources "erase" holes in it (destination-out). A warm additive glow is added on top.

import { TAU } from "./util.js";

export class Lighting {
  constructor() {
    this.canvas = document.createElement("canvas");
    this.ctx = this.canvas.getContext("2d");
    this.darkness = 0.66;
  }

  resize(w, h) {
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
  }

  /**
   * lights: [{x, y, r, intensity, cone?: {angle, width, length}}] in SCREEN pixels.
   * glows:  [{x, y, r, color}] additive coloured glow in screen pixels.
   */
  render(target, w, h, lights, glows) {
    this.resize(w, h);
    const g = this.ctx;
    g.globalCompositeOperation = "source-over";
    g.clearRect(0, 0, w, h);
    g.fillStyle = `rgba(4,7,14,${this.darkness})`;
    g.fillRect(0, 0, w, h);
    g.globalCompositeOperation = "destination-out";
    for (const L of lights) {
      if (L.cone) {
        const { angle, width, length } = L.cone;
        const grad = g.createRadialGradient(L.x, L.y, 0, L.x, L.y, length);
        grad.addColorStop(0, `rgba(0,0,0,${L.intensity})`);
        grad.addColorStop(0.7, `rgba(0,0,0,${L.intensity * 0.6})`);
        grad.addColorStop(1, "rgba(0,0,0,0)");
        g.fillStyle = grad;
        g.beginPath();
        g.moveTo(L.x, L.y);
        g.arc(L.x, L.y, length, angle - width, angle + width);
        g.closePath();
        g.fill();
      } else {
        const grad = g.createRadialGradient(L.x, L.y, 0, L.x, L.y, L.r);
        grad.addColorStop(0, `rgba(0,0,0,${L.intensity})`);
        grad.addColorStop(1, "rgba(0,0,0,0)");
        g.fillStyle = grad;
        g.beginPath();
        g.arc(L.x, L.y, L.r, 0, TAU);
        g.fill();
      }
    }
    target.drawImage(this.canvas, 0, 0, w, h);

    target.globalCompositeOperation = "lighter";
    for (const G of glows) {
      const grad = target.createRadialGradient(G.x, G.y, 0, G.x, G.y, G.r);
      grad.addColorStop(0, G.color);
      grad.addColorStop(1, "rgba(0,0,0,0)");
      target.fillStyle = grad;
      target.beginPath();
      target.arc(G.x, G.y, G.r, 0, TAU);
      target.fill();
    }
    target.globalCompositeOperation = "source-over";
  }
}
