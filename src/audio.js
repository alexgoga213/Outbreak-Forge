// Procedural sound engine (Web Audio API). No audio files: every sound is synthesised live.
//
// Building blocks: filtered noise bursts (gunshot "crack", explosions, breath), pitch-swept
// oscillators (body "thump", zaps, groans) and formant filters (zombie voices). A generated
// impulse response gives the city a reverb tail, sounds are panned and attenuated by their
// distance to the player, and a compressor on the master bus keeps loud fights from clipping.

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const rnd = (lo, hi) => lo + Math.random() * (hi - lo);

// Per-weapon gunshot recipes.
const SHOTS = {
  pistol: { crack: [2600, 1.1, 0.09, 0.5], thump: [190, 60, 0.09, 0.35], verb: 0.25, gap: 0.05 },
  smg: { crack: [3300, 1.4, 0.05, 0.36], thump: [230, 90, 0.05, 0.22], verb: 0.15, gap: 0.035 },
  shotgun: { crack: [1300, 0.6, 0.32, 0.85], thump: [120, 38, 0.3, 0.7], verb: 0.5, gap: 0.1, low: true },
  rifle: { crack: [2900, 1.2, 0.07, 0.46], thump: [165, 55, 0.11, 0.42], verb: 0.3, gap: 0.04 },
  sniper: { crack: [4200, 0.9, 0.13, 0.75], thump: [105, 28, 0.42, 0.85], verb: 0.9, gap: 0.1 },
  minigun: { crack: [3600, 1.6, 0.03, 0.26], thump: [260, 120, 0.03, 0.14], verb: 0.12, gap: 0.03 },
};

const VOICES = {
  walker: { f: 110, formants: [520, 1100], len: 1.0 },
  runner: { f: 175, formants: [650, 1400], len: 0.6 },
  exploder: { f: 85, formants: [380, 900], len: 1.1, gurgle: true },
  brute: { f: 68, formants: [420, 900], len: 1.3 },
  spitter: { f: 145, formants: [700, 1600], len: 0.8, gurgle: true },
  stalker: { f: 230, formants: [900, 2200], len: 0.7, hiss: true },
  boss: { f: 52, formants: [300, 700], len: 1.8 },
};

export class Audio {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this._last = {};
    this.listener = { x: 0, y: 0 };
    this.loops = {};
  }

  /** Must be called from a user gesture (browser autoplay policy). */
  unlock() {
    if (this.ctx) {
      if (this.ctx.state === "suspended") this.ctx.resume();
      return;
    }
    try {
      const ctx = (this.ctx = new (window.AudioContext || window.webkitAudioContext)());
      this.comp = ctx.createDynamicsCompressor();
      this.comp.threshold.value = -16;
      this.comp.ratio.value = 6;
      this.master = ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.5;
      this.comp.connect(this.master).connect(ctx.destination);

      // reverb bus with a generated impulse response (decaying stereo noise)
      this.verb = ctx.createConvolver();
      const len = ctx.sampleRate * 1.6;
      const ir = ctx.createBuffer(2, len, ctx.sampleRate);
      for (let ch = 0; ch < 2; ch++) {
        const d = ir.getChannelData(ch);
        for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2);
      }
      this.verb.buffer = ir;
      this.verbGain = ctx.createGain();
      this.verbGain.gain.value = 0.5;
      this.verb.connect(this.verbGain).connect(this.comp);

      const nlen = ctx.sampleRate * 2;
      this.noise = ctx.createBuffer(1, nlen, ctx.sampleRate);
      const nd = this.noise.getChannelData(0);
      for (let i = 0; i < nlen; i++) nd[i] = Math.random() * 2 - 1;
      this.startAmbience();
    } catch {
      this.ctx = null;
    }
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 0.5, this.ctx.currentTime, 0.05);
  }

  setListener(x, y) {
    this.listener.x = x;
    this.listener.y = y;
  }

  // ------------------------------------------------------------------ plumbing
  _ok(name, minGap = 0.03) {
    if (this.muted || !this.ctx) return false;
    const now = this.ctx.currentTime;
    if (now - (this._last[name] || 0) < minGap) return false; // never stack 25 identical sounds per frame
    this._last[name] = now;
    return true;
  }

  /** Output node for a sound at world position `pos` (null = centred, full volume). */
  _out(pos, verbAmount = 0.2) {
    const ctx = this.ctx;
    const g = ctx.createGain();
    let vol = 1, pan = 0;
    if (pos) {
      const dx = pos.x - this.listener.x, dy = pos.y - this.listener.y;
      const d = Math.hypot(dx, dy);
      vol = clamp(1 / (1 + d / 350), 0, 1);
      pan = clamp(dx / 650, -1, 1);
      verbAmount += clamp(d / 1500, 0, 0.5); // far sounds are wetter
    }
    g.gain.value = vol;
    if (ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      g.connect(p).connect(this.comp);
      if (verbAmount > 0) {
        const s = ctx.createGain();
        s.gain.value = verbAmount;
        p.connect(s).connect(this.verb);
      }
    } else g.connect(this.comp);
    return g;
  }

  _noise(out, { t = 0, dur, freq, q = 1, gain, type = "bandpass", sweep = null, attack = 0.002 }) {
    const ctx = this.ctx, t0 = ctx.currentTime + t;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = rnd(0.9, 1.1);
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t0);
    if (sweep) f.frequency.exponentialRampToValueAtTime(sweep, t0 + dur);
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f).connect(g).connect(out);
    src.start(t0, Math.random() * 1.5);
    src.stop(t0 + dur + 0.05);
  }

  _tone(out, { t = 0, f0, f1 = f0, dur, gain, type = "sine", attack = 0.004, vibrato = 0, vibRate = 6 }) {
    const ctx = this.ctx, t0 = ctx.currentTime + t;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t0);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur);
    if (vibrato) {
      const lfo = ctx.createOscillator();
      const lg = ctx.createGain();
      lfo.frequency.value = vibRate;
      lg.gain.value = vibrato;
      lfo.connect(lg).connect(o.frequency);
      lfo.start(t0);
      lfo.stop(t0 + dur + 0.05);
    }
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(out);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
    return o;
  }

  _click(out, t = 0, freq = 3000, gain = 0.25) {
    this._noise(out, { t, dur: 0.025, freq, q: 3, gain, type: "bandpass" });
  }

  // ------------------------------------------------------------------ weapons
  shoot(id) {
    if (id === "flamer") return; // continuous loop, see flame()
    const rec = SHOTS[id];
    if (!this._ok("shot-" + id, rec ? rec.gap : 0.05)) return;
    if (rec) {
      const out = this._out(null, rec.verb);
      const [cf, cq, cd, cg] = rec.crack;
      this._noise(out, { dur: cd * rnd(0.9, 1.1), freq: cf * rnd(0.92, 1.08), q: cq, gain: cg });
      const [tf0, tf1, td, tg] = rec.thump;
      this._tone(out, { f0: tf0 * rnd(0.95, 1.05), f1: tf1, dur: td, gain: tg, type: "triangle" });
      if (rec.low) this._noise(out, { dur: 0.4, freq: 300, q: 0.5, gain: 0.5, type: "lowpass" });
      if (id === "shotgun") { this._click(out, 0.38, 1800, 0.3); this._click(out, 0.5, 1300, 0.3); } // pump
      if (id === "sniper") { this._click(out, 0.55, 2200, 0.25); this._click(out, 0.72, 1600, 0.25); } // bolt
      return;
    }
    const out = this._out(null, 0.3);
    if (id === "rocket") {
      this._noise(out, { dur: 0.6, freq: 300, sweep: 2400, q: 0.8, gain: 0.6 });
      this._tone(out, { f0: 90, f1: 40, dur: 0.35, gain: 0.5, type: "sawtooth" });
    } else if (id === "tesla") {
      this._tone(out, { f0: rnd(1600, 2100), f1: 180, dur: 0.16, gain: 0.16, type: "sawtooth" });
      for (let k = 0; k < 4; k++) this._noise(out, { t: k * 0.03, dur: 0.03, freq: rnd(3000, 7000), q: 4, gain: 0.18, type: "highpass" });
    } else if (id === "plasma") {
      this._tone(out, { f0: 1300, f1: 260, dur: 0.2, gain: 0.2, type: "sine" });
      this._tone(out, { f0: 420, f1: 110, dur: 0.14, gain: 0.14, type: "square" });
      this._noise(out, { dur: 0.12, freq: 5000, q: 2, gain: 0.08, type: "highpass" });
    }
  }

  /** Continuous flamethrower roar while `active`. Call every frame. */
  flame(active) {
    if (!this.ctx) return;
    let L = this.loops.flame;
    if (active && !L && !this.muted) {
      const ctx = this.ctx;
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      src.loop = true;
      const f = ctx.createBiquadFilter();
      f.type = "lowpass";
      f.frequency.value = 900;
      const lfo = ctx.createOscillator();
      const lg = ctx.createGain();
      lfo.frequency.value = 7;
      lg.gain.value = 300;
      lfo.connect(lg).connect(f.frequency);
      const g = ctx.createGain();
      g.gain.value = 0.0001;
      g.gain.setTargetAtTime(0.55, ctx.currentTime, 0.05);
      src.connect(f).connect(g).connect(this._out(null, 0.2));
      src.start();
      lfo.start();
      L = this.loops.flame = { src, lfo, g };
    } else if (!active && L) {
      L.g.gain.setTargetAtTime(0.0001, this.ctx.currentTime, 0.08);
      L.src.stop(this.ctx.currentTime + 0.4);
      L.lfo.stop(this.ctx.currentTime + 0.4);
      this.loops.flame = null;
    }
  }

  /** Minigun motor whine; `level` 0..1 follows the barrel spin speed. Call every frame. */
  motor(level) {
    if (!this.ctx) return;
    let L = this.loops.motor;
    if (level > 0.02 && !L && !this.muted) {
      const ctx = this.ctx;
      const o = ctx.createOscillator();
      o.type = "sawtooth";
      const f = ctx.createBiquadFilter();
      f.type = "lowpass";
      f.frequency.value = 1200;
      const g = ctx.createGain();
      g.gain.value = 0;
      o.connect(f).connect(g).connect(this._out(null, 0.1));
      o.start();
      L = this.loops.motor = { o, g };
    }
    if (!L) return;
    const t = this.ctx.currentTime;
    L.o.frequency.setTargetAtTime(60 + level * 260, t, 0.05);
    L.g.gain.setTargetAtTime(this.muted ? 0 : level * 0.12, t, 0.05);
    if (level <= 0.02) {
      L.g.gain.setTargetAtTime(0, t, 0.05);
      L.o.stop(t + 0.3);
      this.loops.motor = null;
    }
  }

  /** Reload foley timed to the reload duration: mag out, mag in, slide/charging handle. */
  reload(id, duration) {
    if (!this._ok("reload", 0.2)) return;
    const out = this._out(null, 0.1);
    const d = duration;
    if (id === "shotgun") {
      for (let k = 0; k < 5; k++) { this._click(out, 0.1 + k * (d * 0.15), 2100, 0.22); this._tone(out, { t: 0.1 + k * d * 0.15, f0: 500, f1: 300, dur: 0.04, gain: 0.08 }); }
      this._click(out, d * 0.85, 1500, 0.35); this._click(out, d * 0.93, 1100, 0.35);
    } else if (id === "rocket") {
      this._noise(out, { t: 0.1, dur: 0.2, freq: 600, q: 1, gain: 0.3 });
      this._tone(out, { t: d * 0.7, f0: 120, f1: 70, dur: 0.15, gain: 0.35, type: "triangle" });
      this._click(out, d * 0.9, 1400, 0.35);
    } else if (id === "tesla" || id === "plasma") {
      this._tone(out, { f0: 150, f1: id === "tesla" ? 1200 : 900, dur: d * 0.9, gain: 0.08, type: "sawtooth", attack: 0.05 });
      this._tone(out, { t: d * 0.9, f0: 1500, f1: 1800, dur: 0.08, gain: 0.1 });
    } else if (id === "flamer") {
      this._noise(out, { t: 0.1, dur: d * 0.6, freq: 500, q: 0.7, gain: 0.12, type: "lowpass", attack: 0.1 });
      this._click(out, d * 0.85, 1600, 0.3);
    } else {
      this._click(out, 0.05, 2600, 0.3); // mag release
      this._noise(out, { t: 0.08, dur: 0.08, freq: 900, q: 1.5, gain: 0.18 }); // mag drops
      this._noise(out, { t: d * 0.55, dur: 0.06, freq: 700, q: 1.5, gain: 0.28 }); // new mag in
      this._click(out, d * 0.58, 1800, 0.3);
      this._click(out, d * 0.85, 2400, 0.32); // slide / charging handle
      this._click(out, d * 0.92, 1500, 0.32);
    }
  }

  empty() {
    if (!this._ok("empty", 0.25)) return;
    this._click(this._out(null, 0), 0, 3500, 0.25);
  }

  // ------------------------------------------------------------------ impacts & world
  hit(pos) {
    if (!this._ok("hit", 0.04)) return;
    const out = this._out(pos, 0.05);
    this._noise(out, { dur: 0.06, freq: rnd(600, 1000), q: 1.2, gain: 0.3, type: "lowpass" }); // wet impact
  }

  ricochet(pos) {
    if (!this._ok("ric", 0.07) || Math.random() < 0.4) return;
    const out = this._out(pos, 0.3);
    const f = rnd(1800, 3200);
    this._tone(out, { f0: f, f1: f * 0.55, dur: rnd(0.12, 0.25), gain: 0.08, type: "sine" });
    this._noise(out, { dur: 0.03, freq: 4000, q: 2, gain: 0.15, type: "highpass" });
  }

  explode(pos, big = 1) {
    if (!this._ok("explode", 0.07)) return;
    const out = this._out(pos, 0.6);
    this._noise(out, { dur: 0.9 * big, freq: 500, sweep: 80, q: 0.6, gain: 0.9, type: "lowpass", attack: 0.004 });
    this._tone(out, { f0: 110, f1: 28, dur: 0.7 * big, gain: 0.6, type: "sine" });
    this._noise(out, { t: 0.05, dur: 1.2, freq: 3000, q: 0.5, gain: 0.08, type: "highpass" }); // debris rain
  }

  // ------------------------------------------------------------------ zombies
  _voice(out, type, { pitch = 1, len = 1, gain = 0.22, snarl = false } = {}) {
    const ctx = this.ctx, v = VOICES[type] || VOICES.walker;
    const t0 = ctx.currentTime, dur = v.len * len * rnd(0.8, 1.2);
    const o = ctx.createOscillator();
    o.type = snarl ? "sawtooth" : "triangle";
    const f0 = v.f * pitch * rnd(0.85, 1.15);
    o.frequency.setValueAtTime(f0 * (snarl ? 1.4 : 1), t0);
    o.frequency.linearRampToValueAtTime(f0 * rnd(1.05, 1.25), t0 + dur * 0.3);
    o.frequency.exponentialRampToValueAtTime(f0 * 0.65, t0 + dur);
    const lfo = ctx.createOscillator(), lg = ctx.createGain();
    lfo.frequency.value = rnd(4, 9);
    lg.gain.value = f0 * 0.06;
    lfo.connect(lg).connect(o.frequency);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.06);
    g.gain.setValueAtTime(gain, t0 + dur * 0.6);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    // two formant band-passes give the "mouth" / vowel colour
    for (const [i, fm] of v.formants.entries()) {
      const bp = ctx.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = fm * rnd(0.9, 1.1);
      bp.Q.value = 5;
      const fg = ctx.createGain();
      fg.gain.value = i === 0 ? 1.4 : 0.8;
      o.connect(bp).connect(fg).connect(g);
    }
    g.connect(out);
    o.start(t0); lfo.start(t0);
    o.stop(t0 + dur + 0.05); lfo.stop(t0 + dur + 0.05);
    // breath / gurgle / hiss layer
    const breath = v.hiss ? { freq: 4000, type: "highpass", gain: gain * 0.6 } : v.gurgle
      ? { freq: 300, type: "lowpass", gain: gain * 0.9 } : { freq: 1200, type: "bandpass", gain: gain * 0.35 };
    this._noise(out, { dur, freq: breath.freq, q: 1, gain: breath.gain, type: breath.type, attack: 0.05 });
  }

  /** Ambient moan of a zombie near the player. */
  groan(type, pos) {
    if (!this._ok("groan", 0.45)) return;
    this._voice(this._out(pos, 0.25), type, { gain: type === "boss" ? 0.4 : 0.2 });
  }

  attack(type, pos) {
    if (!this._ok("attack", 0.15)) return;
    const out = this._out(pos, 0.1);
    this._voice(out, type, { snarl: true, len: 0.35, pitch: 1.2, gain: 0.25 });
    this._noise(out, { t: 0.05, dur: 0.12, freq: 2500, sweep: 700, q: 1, gain: 0.2 }); // swipe
  }

  death(type, pos) {
    if (!this._ok("death", 0.05)) return;
    const out = this._out(pos, 0.15);
    if (type === "exploder") {
      this._noise(out, { dur: 0.25, freq: 250, q: 1, gain: 0.6, type: "lowpass" }); // wet pop (explosion plays too)
      return;
    }
    this._voice(out, type, { len: 0.45, pitch: 0.85, gain: type === "brute" || type === "boss" ? 0.35 : 0.2 });
    this._noise(out, { t: 0.05, dur: 0.18, freq: 420, q: 0.8, gain: 0.35, type: "lowpass" }); // squelch
    this._tone(out, { t: 0.12, f0: 90, f1: 50, dur: 0.12, gain: 0.25, type: "sine" }); // body hits the ground
  }

  spit(pos) {
    if (!this._ok("spit", 0.1)) return;
    const out = this._out(pos, 0.1);
    this._noise(out, { dur: 0.14, freq: 1600, sweep: 600, q: 2, gain: 0.3 });
    this._tone(out, { f0: 300, f1: 120, dur: 0.12, gain: 0.12, type: "triangle" });
  }

  shriek(pos) {
    if (!this._ok("shriek", 0.3)) return;
    const out = this._out(pos, 0.3);
    this._tone(out, { f0: 700, f1: 1500, dur: 0.45, gain: 0.12, type: "sawtooth", vibrato: 40, vibRate: 18 });
    this._noise(out, { dur: 0.45, freq: 3000, q: 1, gain: 0.12, type: "highpass" });
  }

  roar(pos) {
    if (!this._ok("roar", 0.8)) return;
    const out = this._out(pos, 0.6);
    this._voice(out, "boss", { len: 1, gain: 0.5, snarl: true, pitch: 0.9 });
    this._tone(out, { f0: 48, f1: 35, dur: 1.4, gain: 0.35, type: "sawtooth" });
  }

  stomp(pos) {
    if (!this._ok("stomp", 0.25)) return;
    const out = this._out(pos, 0.3);
    this._tone(out, { f0: 70, f1: 30, dur: 0.3, gain: 0.5, type: "sine" });
    this._noise(out, { dur: 0.2, freq: 200, q: 0.7, gain: 0.3, type: "lowpass" });
  }

  // ------------------------------------------------------------------ player & UI
  hurt() {
    if (!this._ok("hurt", 0.25)) return;
    const out = this._out(null, 0.05);
    this._tone(out, { f0: 170, f1: 110, dur: 0.18, gain: 0.25, type: "sawtooth", vibrato: 6 });
    this._noise(out, { dur: 0.1, freq: 800, q: 1, gain: 0.2, type: "lowpass" });
  }

  dash() {
    if (!this._ok("dash", 0.2)) return;
    this._noise(this._out(null, 0.05), { dur: 0.22, freq: 400, sweep: 2500, q: 1.5, gain: 0.25 });
  }

  pickup(type = "scrap") {
    if (!this._ok("pickup-" + type, 0.05)) return;
    const out = this._out(null, 0.05);
    if (type === "scrap") {
      this._tone(out, { f0: rnd(1700, 1900), dur: 0.06, gain: 0.06 });
      this._tone(out, { t: 0.04, f0: rnd(2400, 2700), dur: 0.08, gain: 0.05 });
    } else if (type === "xp") {
      this._tone(out, { f0: rnd(850, 950), f1: 1500, dur: 0.08, gain: 0.05, type: "triangle" });
    } else {
      [523, 659, 784].forEach((f, i) => this._tone(out, { t: i * 0.06, f0: f, dur: 0.25, gain: 0.08, type: "triangle" }));
    }
  }

  levelUp() {
    if (!this._ok("level", 0.3)) return;
    const out = this._out(null, 0.3);
    [392, 523, 659, 784, 1047].forEach((f, i) => this._tone(out, { t: i * 0.07, f0: f, dur: 0.3, gain: 0.1, type: "triangle" }));
  }

  waveStart(boss = false) {
    if (!this._ok("wave", 1)) return;
    const out = this._out(null, 0.7);
    // air-raid siren: slow rise and fall
    const o = this._tone(out, { f0: 300, f1: 300, dur: 2.6, gain: 0.09, type: "sawtooth", attack: 0.4 });
    const t = this.ctx.currentTime;
    o.frequency.cancelScheduledValues(t);
    o.frequency.setValueAtTime(300, t);
    o.frequency.linearRampToValueAtTime(820, t + 1.1);
    o.frequency.linearRampToValueAtTime(420, t + 2.6);
    if (boss) this.roar(null);
  }

  waveClear() {
    if (!this._ok("clear", 1)) return;
    const out = this._out(null, 0.4);
    [[523, 659, 784], [587, 740, 880]].forEach((chord, k) =>
      chord.forEach((f) => this._tone(out, { t: k * 0.22, f0: f, dur: 0.6, gain: 0.06, type: "triangle" })));
  }

  click() {
    if (!this._ok("click", 0.03)) return;
    this._click(this._out(null, 0), 0, 2500, 0.12);
  }

  buy() {
    if (!this._ok("buy", 0.05)) return;
    const out = this._out(null, 0.2);
    this._noise(out, { dur: 0.08, freq: 5000, q: 2, gain: 0.12, type: "highpass" });
    this._tone(out, { f0: 1200, dur: 0.12, gain: 0.08 });
    this._tone(out, { t: 0.08, f0: 1800, dur: 0.2, gain: 0.08 });
  }

  boss() {
    this.waveStart(true);
  }

  // ------------------------------------------------------------------ ambience
  startAmbience() {
    const ctx = this.ctx;
    const amb = ctx.createGain();
    amb.gain.value = 0.9;
    amb.connect(this.comp);
    // wind: looping noise through a wandering low-pass filter
    const wind = ctx.createBufferSource();
    wind.buffer = this.noise;
    wind.loop = true;
    const wf = ctx.createBiquadFilter();
    wf.type = "lowpass";
    wf.frequency.value = 380;
    const wl = ctx.createOscillator(), wlg = ctx.createGain();
    wl.frequency.value = 0.07;
    wlg.gain.value = 220;
    wl.connect(wlg).connect(wf.frequency);
    const wg = ctx.createGain();
    wg.gain.value = 0.06;
    wind.connect(wf).connect(wg).connect(amb);
    wind.start();
    wl.start();
    // dark drone pad
    for (const [f, gv] of [[55, 0.025], [82.4, 0.018], [110.5, 0.01]]) {
      const o = ctx.createOscillator();
      o.type = "sine";
      o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.value = gv;
      const l = ctx.createOscillator(), lg = ctx.createGain();
      l.frequency.value = rnd(0.03, 0.08);
      lg.gain.value = gv * 0.7;
      l.connect(lg).connect(g.gain);
      o.connect(g).connect(amb);
      o.start();
      l.start();
    }
    // distant sirens / metal clangs every now and then
    const scheduleDistant = () => {
      setTimeout(() => {
        if (this.ctx && !this.muted) {
          const out = this._out({ x: this.listener.x + rnd(-1, 1) * 2500, y: this.listener.y + 2500 }, 0.8);
          if (Math.random() < 0.5) {
            const o = this._tone(out, { f0: 600, f1: 600, dur: 3.5, gain: 0.05, type: "sine", attack: 0.8 });
            const t = this.ctx.currentTime;
            o.frequency.cancelScheduledValues(t);
            for (let k = 0; k < 4; k++) {
              o.frequency.setValueAtTime(600, t + k * 0.9);
              o.frequency.linearRampToValueAtTime(900, t + k * 0.9 + 0.45);
            }
          } else {
            this._tone(out, { f0: rnd(300, 500), f1: 200, dur: 1.2, gain: 0.05, type: "triangle" });
            this._noise(out, { dur: 0.4, freq: 2000, q: 3, gain: 0.05 });
          }
        }
        scheduleDistant();
      }, rnd(12000, 26000));
    };
    scheduleDistant();
  }
}
