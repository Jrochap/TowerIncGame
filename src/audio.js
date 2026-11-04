// Tower Inc. — procedural sound effects via Web Audio (no asset files).
// The AudioContext is created on the first user gesture (browser autoplay rules);
// until then, and while muted, every call is a cheap no-op.

const MUTE_KEY = 'towerinc.muted';
const MAX_VOICES = 36;

// Minimum real-time gap (ms) between repeats of a sound, so 4× speed doesn't turn into noise.
const GAPS = {
  shoot: 45, crit: 60, tesla: 70, launch: 80, explosion: 60, bomblet: 40, nova: 120,
  laserLock: 150, die: 30, bigDie: 60, hit: 90, zap: 100, buy: 40, deny: 120, click: 30, core: 80,
};

class Sfx {
  constructor() {
    this.ctx = null;
    this.voices = 0;
    this.last = {};
    this.volume = 0.55;
    try { this.muted = localStorage.getItem(MUTE_KEY) === '1'; } catch (e) { this.muted = false; }
  }

  unlock() {
    if (!this.ctx) {
      const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!AC) return;
      const c = this.ctx = new AC();
      this.master = c.createGain();
      this.master.gain.value = this.muted ? 0 : this.volume;
      const comp = c.createDynamicsCompressor();
      comp.threshold.value = -14; comp.ratio.value = 6;
      comp.attack.value = 0.008; // let explosion transients punch through before clamping
      this.master.connect(comp).connect(c.destination);
      this.noiseBuf = c.createBuffer(1, c.sampleRate, c.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      // soft-clip curve: saturates low sines into harmonics so booms read on laptop speakers too
      const curve = new Float32Array(1024);
      for (let i = 0; i < curve.length; i++) { const x = i / 511.5 - 1; curve[i] = Math.tanh(x * 3.2); }
      this.shaperCurve = curve;
      this.buildLaserHum();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  setMuted(m) {
    this.muted = m;
    try { localStorage.setItem(MUTE_KEY, m ? '1' : '0'); } catch (e) { /* ignore */ }
    if (this.ctx) this.master.gain.setTargetAtTime(m ? 0 : this.volume, this.ctx.currentTime, 0.02);
  }

  ready() { return this.ctx && !this.muted && this.ctx.state === 'running'; }

  // ───────────────────────────── primitives ─────────────────────────────
  voice(node, end) {
    this.voices++;
    node.onended = () => { this.voices--; };
    node.start(this.ctx.currentTime + (end.at || 0));
    node.stop(this.ctx.currentTime + (end.at || 0) + end.dur + 0.05);
  }

  env(vol, dur, at = 0, attack = 0.004) {
    const g = this.ctx.createGain(), t = this.ctx.currentTime + at;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    g.connect(this.master);
    return g;
  }

  tone(type, f0, f1, dur, vol, at = 0, attack) {
    const c = this.ctx, t = c.currentTime + at, o = c.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    o.connect(this.env(vol, dur, at, attack));
    this.voice(o, { at, dur });
  }

  noise(dur, vol, filter, f0, f1 = f0, q = 1, at = 0, attack) {
    const c = this.ctx, t = c.currentTime + at;
    const src = c.createBufferSource();
    src.buffer = this.noiseBuf; src.loop = true;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const bq = c.createBiquadFilter();
    bq.type = filter; bq.Q.value = q;
    bq.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) bq.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    src.connect(bq).connect(this.env(vol, dur, at, attack));
    this.voice(src, { at, dur });
  }

  // Kick-drum style thump: fast pitch dive from f0 to f1, run through a soft clipper.
  boom(f0, f1, dur, vol, at = 0) {
    const c = this.ctx, t = c.currentTime + at, o = c.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f1, t + Math.min(0.18, dur * 0.4));
    const sh = c.createWaveShaper(); sh.curve = this.shaperCurve;
    o.connect(sh).connect(this.env(vol, dur, at, 0.002));
    this.voice(o, { at, dur });
  }

  // Continuous buzzing hum for the prism laser; faded in/out by setLaser().
  buildLaserHum() {
    const c = this.ctx;
    this.laserGain = c.createGain(); this.laserGain.gain.value = 0;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900; lp.Q.value = 4;
    const lfo = c.createOscillator(), lfoGain = c.createGain();
    lfo.frequency.value = 7; lfoGain.gain.value = 300;
    lfo.connect(lfoGain).connect(lp.frequency);
    this.laserOscs = [110, 110.7, 220].map(f => {
      const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f;
      o.connect(lp); o.start();
      return o;
    });
    lfo.start();
    lp.connect(this.laserGain).connect(this.master);
    this.laserFilter = lp;
    this.laserOn = false; this.laserPitch = 0;
  }

  // pitch (0..1) bends the hum up to ~a fifth and brightens it as a burn goes on.
  setLaser(on, pitch = 0) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    if (on !== this.laserOn) {
      this.laserOn = on;
      if (on) this.laserLock();
      else { this.laserGain.gain.cancelScheduledValues(t); this.laserGain.gain.setTargetAtTime(0, t, 0.08); }
    }
    const p = on ? Math.round(pitch * 50) / 50 : 0;
    if (p !== this.laserPitch) {
      this.laserPitch = p;
      for (const o of this.laserOscs) o.detune.setTargetAtTime(p * 700, t, 0.15);
      this.laserFilter.frequency.setTargetAtTime(900 + p * 1100, t, 0.15);
    }
  }

  // Each new target lock swells the hum to full volume, then it settles to a quiet bed (~18%) over ~1s.
  laserLock() {
    if (!this.ctx || !this.laserOn) return;
    const g = this.laserGain.gain, t = this.ctx.currentTime;
    g.cancelScheduledValues(t);
    g.setTargetAtTime(0.05, t, 0.02);
    g.setTargetAtTime(0.009, t + 0.25, 0.3);
    this.play('laserLock');
  }

  // ───────────────────────────── sound bank ─────────────────────────────
  play(name) {
    if (!this.ready() || this.voices > MAX_VOICES) return;
    const gap = GAPS[name];
    if (gap) {
      const now = performance.now();
      if (now - (this.last[name] || 0) < gap) return;
      this.last[name] = now;
    }
    const r = (a, b) => a + Math.random() * (b - a);
    switch (name) {
      case 'shoot':
        this.tone('square', r(480, 560), 160, 0.07, 0.045);
        this.noise(0.04, 0.05, 'highpass', 3000);
        break;
      case 'crit':
        this.tone('square', 600, 150, 0.09, 0.05);
        this.tone('triangle', 1400, 700, 0.1, 0.06);
        break;
      case 'tesla':
        this.noise(0.16, 0.14, 'bandpass', r(2500, 3500), 1800, 3);
        this.tone('sawtooth', 90, 45, 0.14, 0.05);
        break;
      case 'laserLock': // charge-up zing
        this.tone('sine', 700, 2200, 0.16, 0.045);
        this.tone('triangle', 1400, 3200, 0.12, 0.02);
        break;
      case 'zap': // arc sniper bolt
        this.tone('sawtooth', 1000, 280, 0.12, 0.035);
        break;
      case 'launch':
        this.noise(0.3, 0.06, 'bandpass', 700, 2600, 2, 0, 0.03);
        break;
      case 'explosion':
        this.noise(0.5, 0.22, 'lowpass', 1400, 90);
        this.tone('sine', 95, 35, 0.4, 0.28);
        break;
      case 'bomblet':
        this.noise(0.22, 0.1, 'lowpass', 1800, 200);
        break;
      case 'nova':
        this.boom(130, 32, 0.7, 0.3);
        this.tone('sine', 220, 40, 0.6, 0.22);
        this.noise(0.55, 0.13, 'lowpass', 700, 100);
        this.noise(0.3, 0.05, 'highpass', 5000, 5000, 1, 0, 0.05);
        break;
      case 'die':
        this.tone('triangle', r(260, 380), 70, 0.1, 0.05);
        this.noise(0.07, 0.04, 'bandpass', r(1200, 2000), 600, 2);
        break;
      case 'bigDie':
        this.boom(r(140, 160), 40, 0.4, 0.28);
        this.noise(0.45, 0.2, 'lowpass', 1800, 90, 1.2);
        this.tone('square', 160, 50, 0.25, 0.05);
        break;
      case 'bossDie':
        this.noise(0.08, 0.22, 'bandpass', 3000, 1400, 1.2);
        this.boom(120, 28, 1.2, 0.5);
        this.boom(90, 30, 0.9, 0.35, 0.35);                                   // secondary blast
        this.noise(1.6, 0.32, 'lowpass', 2600, 45, 1.4, 0, 0.005);
        this.noise(0.9, 0.22, 'lowpass', 1800, 60, 1.2, 0.35, 0.005);
        this.tone('sine', 70, 25, 1.4, 0.3);
        [392, 494, 587, 784].forEach((f, i) => this.tone('triangle', f, f, 0.5, 0.06, 0.25 + i * 0.12));
        break;
      case 'hit': // metallic clank on the hull
        this.tone('square', 150, 90, 0.08, 0.05);
        this.noise(0.12, 0.06, 'bandpass', 2600, 2200, 9);
        break;
      case 'wave': // steam horn + hiss
        this.tone('sawtooth', 110, 108, 0.6, 0.05, 0, 0.06);
        this.tone('sawtooth', 165, 162, 0.6, 0.035, 0, 0.06);
        this.noise(0.5, 0.04, 'highpass', 4000, 4000, 1, 0.05, 0.08);
        break;
      case 'bossAlarm':
        for (let i = 0; i < 4; i++) this.tone('square', i % 2 ? 330 : 440, i % 2 ? 330 : 440, 0.22, 0.05, i * 0.28, 0.01);
        this.tone('sawtooth', 55, 50, 1.3, 0.08, 0, 0.1);
        break;
      case 'clear':
        [880, 1109, 1319].forEach((f, i) => this.tone('triangle', f, f, 0.25, 0.05, i * 0.07));
        break;
      case 'buy':
        this.tone('triangle', 660, 990, 0.08, 0.06);
        this.noise(0.03, 0.04, 'highpass', 6000);
        break;
      case 'deny':
        this.tone('square', 160, 120, 0.14, 0.05);
        break;
      case 'treeBuy':
        [523, 659, 784, 1047].forEach((f, i) => this.tone('sine', f, f, 0.3, 0.07, i * 0.06));
        this.tone('triangle', 2093, 2093, 0.4, 0.02, 0.24);
        break;
      case 'core':
        this.tone('sine', 1500, 2400, 0.16, 0.06);
        break;
      case 'lastStand':
        this.tone('sawtooth', 100, 900, 0.9, 0.06, 0, 0.05);
        this.tone('sine', 220, 40, 0.8, 0.3, 0.2);
        this.noise(0.7, 0.15, 'lowpass', 900, 100, 1, 0.2);
        break;
      case 'destroyed':
        this.boom(110, 24, 1.8, 0.55);
        this.noise(2.4, 0.38, 'lowpass', 2800, 40, 1.4, 0, 0.005);
        this.tone('sine', 65, 22, 2.0, 0.35);
        this.tone('sawtooth', 220, 30, 1.6, 0.05, 0.1);
        this.noise(1.6, 0.05, 'highpass', 3000, 1500, 1, 0.3, 0.2); // escaping steam
        break;
      case 'click':
        this.tone('square', 1800, 1200, 0.025, 0.025);
        break;
    }
  }
}

export const sfx = new Sfx();
