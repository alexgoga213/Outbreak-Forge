// Keyboard + mouse state. Mouse position is in screen pixels; the game converts it to world space.

export class Input {
  constructor(canvas) {
    this.keys = new Set();
    this.pressed = new Set(); // keys pressed this frame (edge-triggered)
    this.mouse = { x: 0, y: 0, down: false };
    this.wheel = 0;

    window.addEventListener("keydown", (e) => {
      const k = e.key.toLowerCase();
      if (!this.keys.has(k)) this.pressed.add(k);
      this.keys.add(k);
      if (["arrowup", "arrowdown", "arrowleft", "arrowright", " ", "tab"].includes(k)) e.preventDefault();
    });
    window.addEventListener("keyup", (e) => this.keys.delete(e.key.toLowerCase()));
    window.addEventListener("blur", () => {
      this.keys.clear();
      this.mouse.down = false;
    });
    canvas.addEventListener("mousemove", (e) => {
      this.mouse.x = e.clientX;
      this.mouse.y = e.clientY;
    });
    canvas.addEventListener("mousedown", (e) => {
      if (e.button === 0) this.mouse.down = true;
    });
    window.addEventListener("mouseup", (e) => {
      if (e.button === 0) this.mouse.down = false;
    });
    canvas.addEventListener("wheel", (e) => {
      this.wheel += Math.sign(e.deltaY);
      e.preventDefault();
    }, { passive: false });
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
  }

  down(...names) {
    return names.some((n) => this.keys.has(n));
  }

  /** True once per key press. */
  hit(...names) {
    return names.some((n) => this.pressed.has(n));
  }

  /** Movement vector from WASD / arrows, normalised. */
  moveVector() {
    let x = 0, y = 0;
    if (this.down("a", "arrowleft")) x -= 1;
    if (this.down("d", "arrowright")) x += 1;
    if (this.down("w", "arrowup")) y -= 1;
    if (this.down("s", "arrowdown")) y += 1;
    const len = Math.hypot(x, y);
    return len ? { x: x / len, y: y / len } : { x: 0, y: 0 };
  }

  endFrame() {
    this.pressed.clear();
    this.wheel = 0;
  }
}
