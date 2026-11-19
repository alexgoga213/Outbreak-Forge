import { Audio } from "./audio.js";
import { Game } from "./game.js";
import { Input } from "./input.js";
import { loadSave } from "./save.js";
import { UI } from "./ui.js";

const canvas = document.getElementById("game");
const input = new Input(canvas);
const audio = new Audio();
const save = loadSave();
audio.muted = save.muted;

const game = new Game(canvas, input, audio, save);
const ui = new UI(game, audio);

function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.floor(window.innerWidth * dpr);
  canvas.height = Math.floor(window.innerHeight * dpr);
  game.view.w = window.innerWidth;
  game.view.h = window.innerHeight;
  game.view.dpr = dpr;
  game.view.zoom = Math.min(1.5, Math.max(0.8, Math.min(window.innerWidth / 1050, window.innerHeight / 680)));
}
window.addEventListener("resize", resize);
resize();

// Pause automatically when the tab is hidden.
document.addEventListener("visibilitychange", () => {
  if (document.hidden && game.state === "playing") game.setState("paused");
});

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000); // clamp: a lag spike must not teleport everything
  last = now;
  game.update(dt);
  game.render(dt);
  input.endFrame();
  requestAnimationFrame(frame);
}

ui.show("menu");
requestAnimationFrame(frame);

// Exposed for debugging / automated play-testing from the console.
window.__game = game;
