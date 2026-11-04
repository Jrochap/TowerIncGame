// Tower Inc. — everything visual: renderer, scene, the tower model, city backdrop, enemies, effects.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { SPAWN_RADIUS, ENEMY_TYPES } from './config.js';

const TAU = Math.PI * 2;
const hdr = (hex, k = 2.2) => new THREE.Color(hex).multiplyScalar(k);

// HDR colours (>1) are what the bloom pass picks up.
export const COLORS = {
  cyan: hdr(0x22eeff), magenta: hdr(0xff2bd6), red: hdr(0xff2244), amber: hdr(0xffa21f),
  green: hdr(0x4dffb0), purple: hdr(0xb36bff, 2.6), gold: hdr(0xffd24d, 2.4), white: hdr(0xffffff, 1.6),
  steam: new THREE.Color(0.16, 0.15, 0.2),
};

const std = (color, metalness, roughness) => new THREE.MeshStandardMaterial({ color, metalness, roughness, envMapIntensity: 0.8 });
const glow = c => new THREE.MeshBasicMaterial({ color: c });
const MAT = {
  dark: std(0x1d1b26, 0.8, 0.45), steel: std(0x4a4a5a, 0.9, 0.3),
  brass: std(0xc9953f, 1, 0.3), copper: std(0xb4643a, 1, 0.36),
  cyan: glow(COLORS.cyan), magenta: glow(COLORS.magenta), red: glow(COLORS.red), amber: glow(COLORS.amber),
  green: glow(COLORS.green), purple: glow(COLORS.purple), gold: glow(COLORS.gold),
};

const ENEMY_DEATH_COLOR = {
  scrapper: COLORS.red, skitter: COLORS.magenta, juggernaut: COLORS.amber,
  swarm: COLORS.green, sniper: COLORS.purple, boss: COLORS.red,
};

function makeGear(r, teeth, depth, td, hole, spokes = 5) {
  const s = new THREE.Shape();
  const step = TAU / teeth;
  for (let i = 0; i < teeth; i++) {
    const a = i * step;
    const pts = [[a, r - td], [a + step * 0.18, r], [a + step * 0.5, r], [a + step * 0.68, r - td]];
    pts.forEach(([ang, rad], j) => {
      const x = Math.cos(ang) * rad, y = Math.sin(ang) * rad;
      if (i === 0 && j === 0) s.moveTo(x, y); else s.lineTo(x, y);
    });
  }
  s.closePath();
  const h = new THREE.Path(); h.absarc(0, 0, hole, 0, TAU, true); s.holes.push(h);
  const inner = r - td, mid = (hole + inner) / 2, sr = (inner - hole) * 0.28;
  if (spokes > 0 && sr > 0.05) {
    for (let i = 0; i < spokes; i++) {
      const a = i / spokes * TAU;
      const p = new THREE.Path(); p.absarc(Math.cos(a) * mid, Math.sin(a) * mid, sr, 0, TAU, true); s.holes.push(p);
    }
  }
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: true, bevelThickness: 0.04, bevelSize: 0.04, bevelSegments: 1, curveSegments: 10 });
  g.center();
  return g;
}

function softDotTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.3, 'rgba(255,255,255,0.7)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

function windowTexture() {
  const c = document.createElement('canvas'); c.width = 64; c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, 64, 256);
  for (let y = 4; y < 252; y += 6) {
    for (let x = 3; x < 61; x += 7) {
      if (Math.random() < 0.28) {
        const v = 120 + Math.random() * 135;
        g.fillStyle = `rgb(${v},${v},${v})`; g.fillRect(x, y, 4, 3);
      }
    }
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Simple CPU particle system on a single Points object; colour fades to black under additive blending.
class Particles {
  constructor(scene, max, size, tex) {
    this.max = max; this.cursor = 0;
    this.pos = new Float32Array(max * 3); this.col = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3); this.base = new Float32Array(max * 3);
    this.life = new Float32Array(max); this.maxLife = new Float32Array(max);
    this.grav = new Float32Array(max); this.drag = new Float32Array(max);
    for (let i = 0; i < max; i++) this.pos[i * 3 + 1] = -9999;
    const geo = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(this.pos, 3); this.colAttr = new THREE.BufferAttribute(this.col, 3);
    geo.setAttribute('position', this.posAttr); geo.setAttribute('color', this.colAttr);
    const mat = new THREE.PointsMaterial({ size, map: tex, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    this.points = new THREE.Points(geo, mat); this.points.frustumCulled = false;
    scene.add(this.points);
  }
  emit(x, y, z, vx, vy, vz, color, life, grav = 0, drag = 0) {
    const i = this.cursor; this.cursor = (this.cursor + 1) % this.max;
    const k = i * 3;
    this.pos[k] = x; this.pos[k + 1] = y; this.pos[k + 2] = z;
    this.vel[k] = vx; this.vel[k + 1] = vy; this.vel[k + 2] = vz;
    this.base[k] = color.r; this.base[k + 1] = color.g; this.base[k + 2] = color.b;
    this.life[i] = life; this.maxLife[i] = life; this.grav[i] = grav; this.drag[i] = drag;
  }
  update(dt) {
    const { pos, vel, col, base, life, maxLife, grav, drag } = this;
    for (let i = 0; i < this.max; i++) {
      if (life[i] <= 0) continue;
      const k = i * 3;
      life[i] -= dt;
      if (life[i] <= 0) { pos[k + 1] = -9999; col[k] = col[k + 1] = col[k + 2] = 0; continue; }
      const d = Math.max(0, 1 - drag[i] * dt);
      vel[k] *= d; vel[k + 1] = vel[k + 1] * d - grav[i] * dt; vel[k + 2] *= d;
      pos[k] += vel[k] * dt; pos[k + 1] += vel[k + 1] * dt; pos[k + 2] += vel[k + 2] * dt;
      if (pos[k + 1] < 0.05 && grav[i] > 0) { pos[k + 1] = 0.05; vel[k + 1] *= -0.3; }
      const f = life[i] / maxLife[i];
      col[k] = base[k] * f; col[k + 1] = base[k + 1] * f; col[k + 2] = base[k + 2] * f;
    }
    this.posAttr.needsUpdate = true; this.colAttr.needsUpdate = true;
  }
}

const MAX_LINE_PTS = 160;

export class World {
  constructor(container) {
    const r = this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    r.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    r.setSize(window.innerWidth, window.innerHeight);
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.05;
    container.appendChild(r.domElement);

    const S = this.scene = new THREE.Scene();
    S.background = new THREE.Color(0x06050d);
    S.fog = new THREE.FogExp2(0x0b0718, 0.0085);

    this.camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.5, 800);
    this.camera.position.set(0, 40, 48);
    const c = this.controls = new OrbitControls(this.camera, r.domElement);
    c.target.set(0, 3, 0);
    c.enableDamping = true; c.dampingFactor = 0.08; c.enablePan = false;
    c.minDistance = 16; c.maxDistance = 110; c.minPolarAngle = 0.25; c.maxPolarAngle = 1.38;
    c.rotateSpeed = 0.6; c.autoRotateSpeed = 0.5;

    const pmrem = new THREE.PMREMGenerator(r);
    S.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

    S.add(new THREE.HemisphereLight(0x6a4cff, 0x1a0f08, 0.7));
    const sun = new THREE.DirectionalLight(0xffc890, 1.6); sun.position.set(30, 50, 20); S.add(sun);
    const rim = new THREE.DirectionalLight(0x22eeff, 0.7); rim.position.set(-40, 20, -30); S.add(rim);

    this.composer = new EffectComposer(r);
    this.composer.addPass(new RenderPass(S, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.85, 0.55, 0.82);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    const dot = softDotTexture();
    this.sparks = new Particles(S, 5000, 0.45, dot);
    this.smoke = new Particles(S, 1600, 2.6, dot);

    this.geo = {
      box: new THREE.BoxGeometry(1, 1, 1), sphere: new THREE.SphereGeometry(1, 16, 12),
      octa: new THREE.OctahedronGeometry(1), dodeca: new THREE.DodecahedronGeometry(1),
      tetra: new THREE.TetrahedronGeometry(1), ico: new THREE.IcosahedronGeometry(1, 0),
      cyl: new THREE.CylinderGeometry(1, 1, 1, 12), cone: new THREE.ConeGeometry(1, 1, 8),
      torus: new THREE.TorusGeometry(1, 0.08, 8, 32), gearMid: makeGear(2.9, 24, 0.25, 0.3, 2.5, 0),
      bolt: new THREE.BoxGeometry(0.16, 0.16, 1.1),
      ring: new THREE.RingGeometry(0.88, 1, 96).rotateX(-Math.PI / 2),
      beam: new THREE.CylinderGeometry(1, 1, 1, 8, 1, true).rotateX(Math.PI / 2),
      barBg: new THREE.PlaneGeometry(1.06, 0.22), barFg: new THREE.PlaneGeometry(1, 0.14).translate(0.5, 0, 0),
    };
    this.critMat = glow(hdr(0xff3355, 3));
    this.barBgMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.65, depthWrite: false });
    this.barFgMat = glow(hdr(0xff3355, 1.5));
    this.barEliteMat = glow(hdr(0xffd24d, 1.6));

    this.enemyPools = {}; this.activeEnemies = new Set();
    this.barPool = []; this.activeBars = new Set();
    this.projPool = []; this.missilePool = []; this.linePool = []; this.ringPool = []; this.flashPool = [];
    this.fx = [];
    this.time = 0; this.gearT = 0; this.hitT = 0; this.destroyT = 0;
    this.turretYaw = 0; this.turretTarget = 0; this.recoil = [0, 0];
    this.chimneys = []; this.blinkers = []; this.blimps = [];

    this.buildEnvironment();
    this.buildTower();

    this.beams = [];
    for (let i = 0; i < 4; i++) {
      const g = new THREE.Group();
      const outer = new THREE.Mesh(this.geo.beam, new THREE.MeshBasicMaterial({ color: COLORS.amber, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }));
      const inner = new THREE.Mesh(this.geo.beam, glow(hdr(0xfff1c4, 3)));
      g.add(outer, inner); g.userData = { outer, inner }; g.visible = false; S.add(g);
      this.beams.push(g);
    }

    this._v = new THREE.Vector3(); this._p = new THREE.Vector3();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h); this.composer.setSize(w, h);
  }

  // ───────────────────────────── environment ─────────────────────────────
  buildEnvironment() {
    const S = this.scene;
    const ground = new THREE.Mesh(new THREE.CircleGeometry(320, 64), new THREE.MeshStandardMaterial({ color: 0x0d0b18, metalness: 0.5, roughness: 0.6 }));
    ground.rotation.x = -Math.PI / 2; S.add(ground);

    const grid = new THREE.GridHelper(260, 104, 0xff2bd6, 0x2b1850);
    grid.material.transparent = true; grid.material.opacity = 0.28; grid.material.depthWrite = false;
    grid.position.y = 0.01; S.add(grid);

    const flat = (geo, mat, y) => { const m = new THREE.Mesh(geo, mat); m.rotation.x = -Math.PI / 2; m.position.y = y; S.add(m); return m; };
    for (const rad of [10, 20, 30]) {
      flat(new THREE.RingGeometry(rad - 0.04, rad + 0.04, 128), new THREE.MeshBasicMaterial({ color: 0x22eeff, transparent: true, opacity: 0.1, depthWrite: false }), 0.02);
    }
    this.spawnRingMat = new THREE.MeshBasicMaterial({ color: hdr(0xff2244, 1.2), transparent: true, opacity: 0.55, depthWrite: false });
    flat(new THREE.RingGeometry(SPAWN_RADIUS - 0.15, SPAWN_RADIUS + 0.15, 180), this.spawnRingMat, 0.03);

    // hazard pylons on the spawn perimeter
    for (let i = 0; i < 16; i++) {
      const a = i / 16 * TAU, x = Math.cos(a) * (SPAWN_RADIUS + 2.5), z = Math.sin(a) * (SPAWN_RADIUS + 2.5);
      const p = new THREE.Mesh(this.geo.cyl, MAT.dark); p.scale.set(0.35, 3, 0.35); p.position.set(x, 1.5, z); S.add(p);
      const l = new THREE.Mesh(this.geo.sphere, glow(hdr(0xff2244, 2))); l.scale.setScalar(0.28); l.position.set(x, 3.2, z); S.add(l);
      this.blinkers.push({ m: l, off: i * 0.4 });
    }

    // range + slow aura indicators (scaled by stats)
    this.rangeRing = flat(new THREE.RingGeometry(0.985, 1, 160), new THREE.MeshBasicMaterial({ color: 0x22eeff, transparent: true, opacity: 0.45, depthWrite: false }), 0.04);
    this.rangeDisc = flat(new THREE.CircleGeometry(1, 96), new THREE.MeshBasicMaterial({ color: 0x22eeff, transparent: true, opacity: 0.03, depthWrite: false }), 0.035);
    this.slowRing = flat(new THREE.CircleGeometry(1, 96), new THREE.MeshBasicMaterial({ color: 0x5ab8ff, transparent: true, opacity: 0.07, depthWrite: false }), 0.045);
    this.slowRing.visible = false;

    // skyline
    const winTex = windowTexture();
    const bMats = [0x22eeff, 0xff2bd6, 0xffa21f].map(col => new THREE.MeshStandardMaterial({
      color: 0x100e18, metalness: 0.7, roughness: 0.5, emissive: new THREE.Color(col), emissiveMap: winTex, emissiveIntensity: 1.5, envMapIntensity: 0.4,
    }));
    const neonMats = [MAT.cyan, MAT.magenta, MAT.amber];
    for (let i = 0; i < 150; i++) {
      const a = Math.random() * TAU, rad = 78 + Math.random() * 90;
      const w = 4 + Math.random() * 9, d = 4 + Math.random() * 9, h = 8 + Math.pow(Math.random(), 1.6) * 65;
      const x = Math.cos(a) * rad, z = Math.sin(a) * rad, rot = Math.random() * Math.PI;
      const b = new THREE.Mesh(this.geo.box, bMats[i % 3]);
      b.scale.set(w, h, d); b.position.set(x, h / 2, z); b.rotation.y = rot; S.add(b);
      if (Math.random() < 0.3) {
        const n = new THREE.Mesh(this.geo.box, neonMats[i % 3]);
        n.scale.set(w * 1.02, 0.25, d * 1.02); n.position.set(x, h * (0.6 + Math.random() * 0.35), z); n.rotation.y = rot; S.add(n);
      }
      if (Math.random() < 0.18) {
        const ch = new THREE.Mesh(this.geo.cyl, MAT.copper);
        ch.scale.set(0.7, 6, 0.7); ch.position.set(x, h + 3, z); S.add(ch);
        this.chimneys.push(new THREE.Vector3(x, h + 6.2, z));
      }
      if (Math.random() < 0.12) {
        const an = new THREE.Mesh(this.geo.cyl, MAT.steel); an.scale.set(0.12, 8, 0.12); an.position.set(x, h + 4, z); S.add(an);
        const l = new THREE.Mesh(this.geo.sphere, glow(hdr(0xff2244, 2))); l.scale.setScalar(0.4); l.position.set(x, h + 8.2, z); S.add(l);
        this.blinkers.push({ m: l, off: Math.random() * 10 });
      }
    }

    // stars
    const starGeo = new THREE.BufferGeometry(); const sp = [];
    for (let i = 0; i < 700; i++) {
      const a = Math.random() * TAU, el = 0.15 + Math.random() * 1.3, R = 420;
      sp.push(Math.cos(a) * Math.cos(el) * R, Math.sin(el) * R, Math.sin(a) * Math.cos(el) * R);
    }
    starGeo.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
    S.add(new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0x9a8fc8, size: 1.3, sizeAttenuation: false, fog: false })));

    // steampunk airships with neon ad bands
    for (let i = 0; i < 3; i++) {
      const g = new THREE.Group();
      const body = new THREE.Mesh(this.geo.sphere, MAT.copper); body.scale.set(7, 2.2, 2.2); g.add(body);
      const band = new THREE.Mesh(this.geo.cyl, i % 2 ? MAT.magenta : MAT.cyan); band.scale.set(2.25, 0.35, 2.25); band.rotation.z = Math.PI / 2; band.position.x = 1.5; g.add(band);
      const gond = new THREE.Mesh(this.geo.box, MAT.dark); gond.scale.set(3.2, 0.9, 1.1); gond.position.y = -2.5; g.add(gond);
      const win = new THREE.Mesh(this.geo.box, MAT.amber); win.scale.set(2.6, 0.2, 1.15); win.position.y = -2.4; g.add(win);
      const finH = new THREE.Mesh(this.geo.box, MAT.brass); finH.scale.set(1.6, 0.15, 4.4); finH.position.set(-6, 0, 0); g.add(finH);
      const finV = new THREE.Mesh(this.geo.box, MAT.brass); finV.scale.set(1.6, 2.4, 0.15); finV.position.set(-6, 0, 0); g.add(finV);
      const prop = new THREE.Mesh(this.geo.box, MAT.steel); prop.scale.set(0.12, 2.6, 0.25); prop.position.x = -7.3; g.add(prop);
      S.add(g);
      this.blimps.push({ g, prop, r: 68 + i * 13, y: 30 + i * 6, speed: (0.025 + i * 0.008) * (i % 2 ? -1 : 1), a: Math.random() * TAU });
    }
  }

  // ───────────────────────────── the tower ─────────────────────────────
  buildTower() {
    const T = this.tower = new THREE.Group(); this.scene.add(T);
    const add = (geo, mat, x = 0, y = 0, z = 0, parent = T) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); parent.add(m); return m; };

    add(new THREE.CylinderGeometry(4.6, 5.2, 0.7, 8), MAT.dark, 0, 0.35, 0);
    add(new THREE.CylinderGeometry(4.0, 4.4, 0.25, 8), MAT.steel, 0, 0.8, 0);
    this.ringMat = new THREE.MeshBasicMaterial({ color: COLORS.cyan.clone() });
    add(new THREE.TorusGeometry(5.0, 0.07, 8, 64), this.ringMat, 0, 0.72, 0).rotation.x = Math.PI / 2;

    // brass boiler body with copper bands
    add(new THREE.CylinderGeometry(2.3, 2.8, 3.4, 16), MAT.brass, 0, 2.6, 0);
    for (const y of [1.2, 2.6, 4.0]) {
      const rad = 2.8 - (y - 0.9) / 3.4 * 0.5 + 0.03;
      add(new THREE.TorusGeometry(rad, 0.1, 8, 32), MAT.copper, 0, y, 0).rotation.x = Math.PI / 2;
    }
    // portholes
    for (let i = 0; i < 6; i++) {
      const a = i / 6 * TAU;
      const p = add(new THREE.CircleGeometry(0.28, 16), MAT.amber, Math.cos(a) * 2.62, 3.3, Math.sin(a) * 2.62);
      p.lookAt(Math.cos(a) * 10, 3.3, Math.sin(a) * 10);
    }

    // copper pipes that vent steam
    this.pipeTops = [];
    for (let i = 0; i < 6; i++) {
      const a = i / 6 * TAU + TAU / 12, px = Math.cos(a) * 3.05, pz = Math.sin(a) * 3.05;
      add(new THREE.CylinderGeometry(0.14, 0.14, 4.6, 8), MAT.copper, px, 3.0, pz);
      add(new THREE.CylinderGeometry(0.22, 0.18, 0.25, 8), MAT.brass, px, 5.35, pz);
      this.pipeTops.push(new THREE.Vector3(px, 5.5, pz));
    }

    // spinning gears
    this.gears = [];
    const sideGear = makeGear(1.0, 12, 0.25, 0.22, 0.25);
    const smallGear = makeGear(0.55, 8, 0.22, 0.16, 0.15, 0);
    for (let i = 0; i < 3; i++) {
      const a = i / 3 * TAU + Math.PI / 3, r = 2.8;
      const pivot = new THREE.Group(); pivot.position.set(Math.cos(a) * r, 2.3, Math.sin(a) * r);
      pivot.lookAt(Math.cos(a) * 10, 2.3, Math.sin(a) * 10); T.add(pivot);
      const g1 = new THREE.Mesh(sideGear, MAT.brass); pivot.add(g1);
      const g2 = new THREE.Mesh(smallGear, MAT.copper); g2.position.set(1.32, 0.9, -0.05); pivot.add(g2);
      this.gears.push({ m: g1, k: 1.4 }, { m: g2, k: -2.55 });
    }
    this.bigGear = add(makeGear(3.5, 36, 0.35, 0.3, 2.7, 0), MAT.copper, 0, 4.55, 0);
    this.bigGear.rotation.x = -Math.PI / 2;

    add(new THREE.CylinderGeometry(1.5, 2.1, 1.2, 16), MAT.dark, 0, 4.9, 0);
    add(new THREE.TorusGeometry(1.85, 0.08, 8, 48), MAT.magenta, 0, 4.75, 0).rotation.x = Math.PI / 2;

    // turret
    const tur = this.turret = new THREE.Group(); tur.position.y = 6.0; T.add(tur);
    add(new THREE.CylinderGeometry(1.5, 1.6, 0.5, 16), MAT.steel, 0, -0.35, 0, tur);
    add(new THREE.BoxGeometry(2.0, 1.1, 2.2), MAT.dark, 0, 0.2, 0, tur);
    add(new THREE.BoxGeometry(2.1, 0.15, 2.3), MAT.brass, 0, 0.8, 0, tur);
    add(new THREE.BoxGeometry(0.6, 0.18, 0.1), MAT.cyan, 0, 0.45, 1.11, tur);
    this.barrels = [];
    const barrelGeo = new THREE.CylinderGeometry(0.2, 0.24, 2.2, 12).rotateX(Math.PI / 2);
    const muzzleGeo = new THREE.TorusGeometry(0.22, 0.06, 8, 16);
    for (const s of [-1, 1]) {
      const b = new THREE.Group(); b.position.set(s * 0.5, 0.2, 0.9); tur.add(b);
      add(barrelGeo, MAT.brass, 0, 0, 1.1, b);
      add(muzzleGeo, MAT.amber, 0, 0, 2.2, b);
      this.barrels.push(b);
    }
    // missile pods
    this.pods = [];
    for (const s of [-1, 1]) {
      const p = new THREE.Group(); p.position.set(s * 1.45, 0.25, 0.1); tur.add(p);
      add(new THREE.BoxGeometry(0.75, 0.85, 1.3), MAT.brass, 0, 0, 0, p);
      for (const ox of [-0.18, 0.18]) for (const oy of [-0.2, 0.2]) {
        add(new THREE.CylinderGeometry(0.12, 0.12, 0.1, 10).rotateX(Math.PI / 2), MAT.green, ox, oy, 0.66, p);
      }
      p.visible = false; this.pods.push(p);
    }

    // floating aether core
    this.coreMat = new THREE.MeshBasicMaterial({ color: COLORS.cyan.clone() });
    this.core = add(new THREE.IcosahedronGeometry(0.75, 1), this.coreMat, 0, 8.6, 0);
    this.cage = add(new THREE.IcosahedronGeometry(1.2, 0), new THREE.MeshBasicMaterial({ color: COLORS.cyan, wireframe: true, transparent: true, opacity: 0.5 }), 0, 8.6, 0);
    this.halos = [];
    for (let i = 0; i < 2; i++) {
      const h = add(new THREE.TorusGeometry(1.75 + i * 0.25, 0.045, 8, 48), MAT.brass, 0, 8.6, 0);
      this.halos.push(h);
    }
    this.coreLight = new THREE.PointLight(0x22eeff, 40, 45, 1.5); this.coreLight.position.y = 8.6; T.add(this.coreLight);

    // tesla spire
    const tz = this.tesla = new THREE.Group(); tz.position.set(3.75, 0.9, 0); T.add(tz);
    add(new THREE.CylinderGeometry(0.4, 0.55, 0.5, 10), MAT.dark, 0, 0.25, 0, tz);
    add(new THREE.CylinderGeometry(0.08, 0.2, 3.4, 8), MAT.copper, 0, 2.0, 0, tz);
    for (let i = 0; i < 4; i++) add(new THREE.TorusGeometry(0.45 - i * 0.07, 0.06, 6, 20), MAT.copper, 0, 1.0 + i * 0.6, 0, tz).rotation.x = Math.PI / 2;
    this.teslaTop = add(new THREE.SphereGeometry(0.38, 16, 12), MAT.purple, 0, 3.9, 0, tz);
    tz.visible = false;

    // prism (laser)
    this.prism = add(new THREE.OctahedronGeometry(0.55), MAT.amber, 0, 10.7, 0);
    this.prism.visible = false;
    // nova emitter
    this.novaRing = add(new THREE.TorusGeometry(4.3, 0.13, 8, 64), MAT.purple, 0, 0.95, 0);
    this.novaRing.rotation.x = Math.PI / 2; this.novaRing.visible = false;
    // shield dome
    this.shieldMat = new THREE.MeshBasicMaterial({ color: hdr(0x40c8ff, 1.2), transparent: true, opacity: 0.1, wireframe: true, depthWrite: false, blending: THREE.AdditiveBlending });
    this.shield = add(new THREE.IcosahedronGeometry(6.4, 3), this.shieldMat, 0, 2.5, 0);
    this.shield.visible = false;
  }

  applyModules(s) {
    this.tesla.visible = !!s.teslaOn;
    this.pods.forEach(p => { p.visible = !!s.missileOn; });
    this.prism.visible = !!s.laserOn;
    this.novaRing.visible = !!s.novaOn;
    this.shield.visible = s.shieldMax > 0;
    this.rangeRing.scale.setScalar(s.range);
    this.rangeDisc.scale.setScalar(s.range);
    this.slowRing.visible = s.slowAura > 0;
    this.slowRing.scale.setScalar(s.slowRadius);
  }

  setShield(frac) {
    this.shieldMat.opacity = 0.03 + 0.13 * frac;
  }

  aimTurret(yaw) { this.turretTarget = yaw; }

  muzzlePos(side) {
    this.recoil[side] = 1;
    this.tower.updateMatrixWorld();
    return this.barrels[side].localToWorld(new THREE.Vector3(0, 0, 2.3));
  }
  coilTop() { return this.teslaTop.getWorldPosition(new THREE.Vector3()); }
  podPos(side) { return this.pods[side].getWorldPosition(new THREE.Vector3()); }
  prismPos() { return this.prism.getWorldPosition(new THREE.Vector3()); }

  towerHit() { this.hitT = 1; }

  towerDestroyed() {
    this.destroyT = 0.0001;
    const c = new THREE.Vector3(0, 4, 0);
    this.burst(c, 260, COLORS.amber, 22, 1.6, 9);
    this.burst(c, 160, COLORS.cyan, 16, 1.2, 4);
    this.flash(c, 14, COLORS.white, 0.6);
    for (let i = 0; i < 40; i++) this.smoke.emit((Math.random() - 0.5) * 6, 2 + Math.random() * 5, (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 3, 2 + Math.random() * 3, (Math.random() - 0.5) * 3, COLORS.steam, 3 + Math.random() * 2);
  }

  resetTower() {
    this.destroyT = 0;
    this.tower.position.set(0, 0, 0); this.tower.rotation.set(0, 0, 0);
    this.coreLight.intensity = 40;
  }

  // ───────────────────────────── enemies ─────────────────────────────
  buildEnemy(key) {
    const G = this.geo, g = new THREE.Group();
    const m = (geo, mat, sx, sy, sz, x = 0, y = 0, z = 0) => {
      const o = new THREE.Mesh(geo, mat); o.scale.set(sx, sy, sz); o.position.set(x, y, z); g.add(o); return o;
    };
    switch (key) {
      case 'scrapper':
        m(G.box, MAT.dark, 1.1, 0.6, 1.3);
        m(G.box, MAT.copper, 0.8, 0.25, 0.7, 0, 0.42, -0.1);
        m(G.box, MAT.red, 0.75, 0.12, 0.08, 0, 0.1, 0.66);
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) m(G.box, MAT.steel, 0.16, 0.55, 0.16, sx * 0.55, -0.4, sz * 0.45);
        break;
      case 'skitter': {
        m(G.octa, MAT.dark, 0.55, 0.4, 0.8);
        const ring = m(G.torus, MAT.magenta, 0.85, 0.85, 0.85); ring.rotation.x = Math.PI / 2;
        g.userData.spin = ring;
        m(G.sphere, MAT.magenta, 0.14, 0.14, 0.14, 0, 0, 0.75);
        break;
      }
      case 'juggernaut':
        m(G.dodeca, MAT.brass, 1.1, 1.0, 1.1);
        m(G.box, MAT.dark, 1.7, 0.45, 1.7, 0, -0.75, 0);
        m(G.sphere, MAT.amber, 0.42, 0.42, 0.42, 0, 0.15, 0.95);
        for (const sx of [-1, 1]) m(G.cone, MAT.steel, 0.25, 0.9, 0.25, sx * 0.85, 0.75, 0.1);
        break;
      case 'swarm':
        m(G.tetra, MAT.dark, 0.42, 0.42, 0.42);
        m(G.sphere, MAT.green, 0.15, 0.15, 0.15, 0, 0.05, 0.28);
        break;
      case 'sniper': {
        m(G.cyl, MAT.dark, 0.55, 1.1, 0.55);
        m(G.cyl, MAT.copper, 0.62, 0.15, 0.62, 0, 0.35, 0);
        const barrel = m(G.cyl, MAT.steel, 0.1, 1.8, 0.1, 0, 0.45, 0.7); barrel.rotation.x = Math.PI / 2;
        m(G.sphere, MAT.purple, 0.16, 0.16, 0.16, 0, 0.45, 1.6);
        m(G.box, MAT.purple, 0.5, 0.08, 0.05, 0, 0.1, 0.56);
        break;
      }
      case 'boss': {
        m(G.ico, MAT.dark, 2.2, 2.2, 2.2);
        m(G.sphere, MAT.red, 0.9, 0.9, 0.9, 0, 0.2, 1.75);
        const r1 = new THREE.Mesh(G.gearMid, MAT.brass); r1.rotation.x = Math.PI / 2; g.add(r1);
        const r2 = new THREE.Mesh(G.gearMid, MAT.copper); r2.scale.setScalar(0.85); r2.rotation.y = Math.PI / 2; g.add(r2);
        g.userData.spin = r1; g.userData.spin2 = r2;
        for (let i = 0; i < 6; i++) {
          const a = i / 6 * TAU;
          const s = m(G.cone, MAT.steel, 0.4, 1.4, 0.4, Math.cos(a) * 1.6, 1.5, Math.sin(a) * 1.6);
          s.rotation.z = -Math.cos(a) * 0.6; s.rotation.x = Math.sin(a) * 0.6;
        }
        break;
      }
    }
    return g;
  }

  acquireEnemy(key, elite) {
    const pk = key + (elite ? '_e' : '');
    const pool = this.enemyPools[pk] || (this.enemyPools[pk] = []);
    let m = pool.pop();
    if (!m) {
      m = this.buildEnemy(key);
      if (elite) {
        const h = new THREE.Mesh(this.geo.torus, MAT.gold);
        h.rotation.x = Math.PI / 2; h.scale.setScalar(ENEMY_TYPES[key].radius * 1.3);
        m.add(h); m.userData.halo = h;
      }
      m.userData.pk = pk;
    }
    this.scene.add(m); this.activeEnemies.add(m);
    return m;
  }

  // Hazard tells: barrier bubble, nanite ring, volatile ember. Created lazily per pooled mesh.
  setEnemyMarks(m, marks) {
    const u = m.userData;
    if (!marks.shield && !marks.regen && !marks.volatile && !u.marks) return;
    if (!u.marks) {
      const r = ENEMY_TYPES[u.pk.replace('_e', '')].radius;
      if (!this.shieldMat) {
        this.shieldMat = new THREE.MeshBasicMaterial({ color: COLORS.cyan.clone().multiplyScalar(0.6), transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false });
      }
      const shield = new THREE.Mesh(this.geo.sphere, this.shieldMat); shield.scale.setScalar(r * 1.45);
      const regen = new THREE.Mesh(this.geo.torus, MAT.green); regen.rotation.x = Math.PI / 2; regen.scale.setScalar(r * 1.05); regen.position.y = -r * 0.55;
      const volatile = new THREE.Mesh(this.geo.sphere, MAT.amber); volatile.scale.setScalar(0.14 + r * 0.08); volatile.position.y = r + 0.35;
      m.add(shield, regen, volatile);
      u.marks = { shield, regen, volatile };
    }
    for (const k of ['shield', 'regen', 'volatile']) u.marks[k].visible = !!marks[k];
  }

  // ───────────────────────────── drones ─────────────────────────────
  acquireDrone() {
    this.dronePool = this.dronePool || [];
    let m = this.dronePool.pop();
    if (!m) {
      m = new THREE.Group();
      const body = new THREE.Mesh(this.geo.sphere, MAT.brass); body.scale.set(0.42, 0.22, 0.55); m.add(body);
      const eye = new THREE.Mesh(this.geo.sphere, MAT.cyan); eye.scale.setScalar(0.13); eye.position.set(0, 0, 0.5); m.add(eye);
      const rotor = new THREE.Mesh(this.geo.torus, MAT.cyan); rotor.rotation.x = Math.PI / 2; rotor.scale.setScalar(0.5); rotor.position.y = 0.22; m.add(rotor);
      const mast = new THREE.Mesh(this.geo.box, MAT.dark); mast.scale.set(0.06, 0.2, 0.06); mast.position.y = 0.12; m.add(mast);
      m.userData.rotor = rotor;
    }
    this.scene.add(m); this.activeDrones = this.activeDrones || new Set(); this.activeDrones.add(m);
    return m;
  }
  releaseDrone(m) { this.scene.remove(m); this.activeDrones.delete(m); this.dronePool.push(m); }
  placeDrone(m, x, y, z, target, ox, oz) {
    m.position.set(x, y, z);
    if (target) m.lookAt(target.x, target.y, target.z);
    else m.rotation.set(0, Math.atan2(-oz, ox), 0); // tangent to the orbit
    if (target && Math.random() < 0.5) this.sparks.emit(x, y, z, 0, 0, 0, COLORS.cyan, 0.25, 3);
  }
  droneImpact(x, y, z) {
    const p = this._p.set(x, y, z);
    this.burst(p, 14, COLORS.cyan, 7, 0.4, 8);
    this.flash(p, 1.8, COLORS.cyan, 0.2);
  }

  releaseEnemy(m) {
    this.scene.remove(m); this.activeEnemies.delete(m);
    this.enemyPools[m.userData.pk].push(m);
  }

  acquireBar(width, gold) {
    let b = this.barPool.pop();
    if (!b) {
      b = new THREE.Group();
      const bg = new THREE.Mesh(this.geo.barBg, this.barBgMat);
      const fg = new THREE.Mesh(this.geo.barFg, this.barFgMat);
      fg.position.set(-0.5, 0, 0.01);
      b.add(bg, fg); b.userData.fg = fg;
    }
    b.userData.fg.material = gold ? this.barEliteMat : this.barFgMat;
    b.scale.set(width, 1, 1);
    this.scene.add(b); this.activeBars.add(b);
    return b;
  }
  updateBar(b, x, y, z, frac) {
    b.position.set(x, y, z);
    b.userData.fg.scale.x = Math.max(0.001, frac);
  }
  releaseBar(b) { this.scene.remove(b); this.activeBars.delete(b); this.barPool.push(b); }

  enemyDeath(e) {
    const col = ENEMY_DEATH_COLOR[e.key] || COLORS.red;
    const p = this._p.set(e.x, e.y, e.z);
    const n = e.boss ? 160 : e.elite ? 40 : Math.round(10 + e.radius * 10);
    this.burst(p, n, col, e.boss ? 18 : 9, 0.7, 10);
    this.burst(p, Math.round(n / 3), COLORS.amber, 6, 0.5, 12);
    if (e.boss || e.elite || e.key === 'juggernaut') this.flash(p, e.radius * 2.5, col, 0.3);
    for (let i = 0; i < (e.boss ? 20 : 2); i++) {
      this.smoke.emit(p.x, p.y, p.z, (Math.random() - 0.5) * 2, 1 + Math.random() * 1.5, (Math.random() - 0.5) * 2, COLORS.steam, 1.5 + Math.random());
    }
  }

  // ───────────────────────────── projectiles & effects ─────────────────────────────
  acquireProjectile(crit) {
    const m = this.projPool.pop() || new THREE.Mesh(this.geo.bolt, MAT.amber);
    m.material = crit ? this.critMat : MAT.amber;
    m.scale.setScalar(crit ? 1.4 : 1);
    this.scene.add(m);
    return m;
  }
  releaseProjectile(m) { this.scene.remove(m); this.projPool.push(m); }

  acquireMissile() {
    let m = this.missilePool.pop();
    if (!m) {
      m = new THREE.Group();
      const body = new THREE.Mesh(this.geo.cyl, MAT.steel); body.scale.set(0.14, 0.8, 0.14); body.rotation.x = Math.PI / 2; m.add(body);
      const tip = new THREE.Mesh(this.geo.cone, MAT.brass); tip.scale.set(0.14, 0.3, 0.14); tip.rotation.x = Math.PI / 2; tip.position.z = 0.55; m.add(tip);
      const tail = new THREE.Mesh(this.geo.sphere, MAT.green); tail.scale.setScalar(0.16); tail.position.z = -0.45; m.add(tail);
    }
    this.scene.add(m);
    return m;
  }
  releaseMissile(m) { this.scene.remove(m); this.missilePool.push(m); }

  missileTrail(p) {
    this.sparks.emit(p.x, p.y, p.z, (Math.random() - 0.5) * 0.6, (Math.random() - 0.5) * 0.6, (Math.random() - 0.5) * 0.6, COLORS.green, 0.3);
    if (Math.random() < 0.35) this.smoke.emit(p.x, p.y, p.z, 0, 0.4, 0, COLORS.steam, 0.9);
  }

  burst(p, n, color, speed = 8, life = 0.6, grav = 6) {
    for (let i = 0; i < n; i++) {
      const u = Math.random() * 2 - 1, th = Math.random() * TAU, s = speed * (0.3 + Math.random() * 0.7);
      const q = Math.sqrt(1 - u * u);
      this.sparks.emit(p.x, p.y, p.z, Math.cos(th) * q * s, Math.abs(u) * s * 0.9 + 1, Math.sin(th) * q * s, color, life * (0.5 + Math.random() * 0.8), grav, 1.5);
    }
  }

  flash(p, radius, color, dur = 0.25) {
    let m = this.flashPool.pop();
    if (!m) m = new THREE.Mesh(this.geo.sphere, new THREE.MeshBasicMaterial({ transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    m.material.color.copy(color); m.position.copy(p); m.scale.setScalar(0.1);
    this.scene.add(m);
    this.fx.push({ obj: m, pool: this.flashPool, t: 0, dur, update: k => { m.scale.setScalar(0.3 + radius * Math.sqrt(k)); m.material.opacity = 0.7 * (1 - k); } });
  }

  explosion(p, radius, color = COLORS.green) {
    this.flash(p, radius, color, 0.28);
    this.burst(p, Math.round(14 + radius * 4), color, radius * 3.5, 0.5, 8);
    this.burst(p, 8, COLORS.amber, radius * 2.5, 0.4, 8);
    this.smoke.emit(p.x, p.y + 0.5, p.z, 0, 1, 0, COLORS.steam, 1.4);
  }

  nova(radius) {
    let m = this.ringPool.pop();
    if (!m) m = new THREE.Mesh(this.geo.ring, new THREE.MeshBasicMaterial({ transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    m.material.color.copy(COLORS.purple); m.position.set(0, 0.6, 0);
    this.scene.add(m);
    this.fx.push({ obj: m, pool: this.ringPool, t: 0, dur: 0.45, update: k => { m.scale.setScalar(1 + (radius - 1) * Math.pow(k, 0.6)); m.material.opacity = 1 - k; } });
    for (let i = 0; i < 70; i++) {
      const a = Math.random() * TAU;
      this.sparks.emit(Math.cos(a) * 4, 0.8, Math.sin(a) * 4, Math.cos(a) * radius * 2.2, 1 + Math.random() * 2, Math.sin(a) * radius * 2.2, COLORS.purple, 0.45, 2, 2);
    }
  }

  lightning(points, color = COLORS.purple, jitter = 0.9, dur = 0.2) {
    let l = this.linePool.pop();
    if (!l) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX_LINE_PTS * 3), 3));
      l = new THREE.Line(g, new THREE.LineBasicMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
      l.frustumCulled = false;
    }
    const arr = l.geometry.attributes.position.array;
    let n = 0;
    const push = (x, y, z) => { if (n < MAX_LINE_PTS) { arr[n * 3] = x; arr[n * 3 + 1] = y; arr[n * 3 + 2] = z; n++; } };
    push(points[0].x, points[0].y, points[0].z);
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i], b = points[i + 1], segs = 6;
      for (let s = 1; s <= segs; s++) {
        const t = s / segs, j = s < segs ? jitter : 0;
        push(a.x + (b.x - a.x) * t + (Math.random() - 0.5) * j, a.y + (b.y - a.y) * t + (Math.random() - 0.5) * j, a.z + (b.z - a.z) * t + (Math.random() - 0.5) * j);
      }
      if (i > 0 || points.length === 2) this.burst(b, 5, color, 4, 0.25, 4);
    }
    l.geometry.setDrawRange(0, n);
    l.geometry.attributes.position.needsUpdate = true;
    l.material.color.copy(color);
    this.scene.add(l);
    this.fx.push({ obj: l, pool: this.linePool, t: 0, dur, update: k => { l.material.opacity = 1 - k * k; } });
  }

  setBeam(i, from, to) {
    const b = this.beams[i];
    const len = from.distanceTo(to);
    b.position.copy(from).lerp(to, 0.5);
    b.lookAt(to);
    const w = 0.85 + Math.random() * 0.3;
    b.userData.outer.scale.set(0.2 * w, 0.2 * w, len);
    b.userData.inner.scale.set(0.06, 0.06, len);
    b.visible = true;
    if (Math.random() < 0.5) this.sparks.emit(to.x, to.y, to.z, (Math.random() - 0.5) * 6, Math.random() * 5, (Math.random() - 0.5) * 6, COLORS.amber, 0.3, 8);
  }
  hideBeam(i) { this.beams[i].visible = false; }
  hideBeams() { this.beams.forEach(b => { b.visible = false; }); }

  updateFx(dt) {
    for (let i = this.fx.length - 1; i >= 0; i--) {
      const f = this.fx[i];
      f.t += dt;
      const k = f.t / f.dur;
      if (k >= 1) { this.scene.remove(f.obj); f.pool.push(f.obj); this.fx.splice(i, 1); continue; }
      f.update(k);
    }
  }

  project(x, y, z) {
    const p = this._p.set(x, y, z).project(this.camera);
    return { x: (p.x + 1) / 2 * window.innerWidth, y: (1 - p.y) / 2 * window.innerHeight, visible: p.z < 1 };
  }

  // ───────────────────────────── per-frame ─────────────────────────────
  update(dt, gdt, render = true) {
    this.time += dt; this.gearT += gdt;
    const t = this.time;

    for (const g of this.gears) g.m.rotation.z = this.gearT * g.k;
    this.bigGear.rotation.z = this.gearT * 0.25;
    this.core.rotation.x += dt * 0.7; this.core.rotation.y += dt * 1.1;
    this.cage.rotation.y -= dt * 0.4; this.cage.rotation.z += dt * 0.25;
    const bob = Math.sin(t * 1.6) * 0.25;
    this.core.position.y = this.cage.position.y = 8.6 + bob;
    this.halos[0].rotation.set(t * 0.8, t * 0.3, 0); this.halos[1].rotation.set(-t * 0.5, 0, t * 0.6);
    this.halos.forEach(h => { h.position.y = 8.6 + bob; });
    this.teslaTop.scale.setScalar(1 + Math.sin(t * 9) * 0.08);
    this.prism.rotation.y += dt * 1.5; this.prism.position.y = 10.7 + Math.sin(t * 2.1) * 0.2;
    this.novaRing.scale.setScalar(1 + Math.sin(t * 3) * 0.015);

    // turret yaw + barrel recoil
    let d = this.turretTarget - this.turretYaw;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    this.turretYaw += d * Math.min(1, gdt * 14);
    this.turret.rotation.y = this.turretYaw;
    for (let i = 0; i < 2; i++) {
      this.recoil[i] = Math.max(0, this.recoil[i] - gdt * 7);
      this.barrels[i].position.z = 0.9 - this.recoil[i] * 0.35;
    }

    // damage flash on the neon ring and core
    this.hitT = Math.max(0, this.hitT - dt * 3);
    this.ringMat.color.copy(COLORS.cyan).lerp(COLORS.red, this.hitT);
    this.coreMat.color.copy(COLORS.cyan).lerp(COLORS.red, this.hitT * 0.6);

    // destruction: the tower sinks, tilts and its core gutters out
    if (this.destroyT > 0) {
      this.destroyT += dt;
      const k = Math.min(1, this.destroyT / 3);
      this.tower.position.y = -k * k * 7;
      this.tower.rotation.z = k * 0.25; this.tower.rotation.x = k * 0.12;
      this.coreLight.intensity = 40 * (1 - k);
      if (Math.random() < 0.6) this.smoke.emit((Math.random() - 0.5) * 6, 1 + Math.random() * 3, (Math.random() - 0.5) * 6, 0, 2 + Math.random() * 2, 0, COLORS.steam, 2.5);
      if (Math.random() < 0.3) this.burst(new THREE.Vector3((Math.random() - 0.5) * 5, 2 + Math.random() * 4, (Math.random() - 0.5) * 5), 12, COLORS.amber, 8, 0.6, 9);
    } else {
      for (const p of this.pipeTops) {
        if (Math.random() < gdt * 1.6) this.smoke.emit(p.x, p.y, p.z, (Math.random() - 0.5) * 0.6, 2 + Math.random(), (Math.random() - 0.5) * 0.6, COLORS.steam, 2 + Math.random());
      }
    }
    for (const c of this.chimneys) {
      if (Math.random() < dt * 1.2) this.smoke.emit(c.x, c.y, c.z, 0.8, 2.5, 0.3, COLORS.steam, 5);
    }
    for (const b of this.blinkers) b.m.visible = Math.sin(t * 2.5 + b.off) > -0.3;
    this.spawnRingMat.opacity = 0.4 + Math.sin(t * 2) * 0.15;

    for (const b of this.blimps) {
      b.a += b.speed * dt;
      b.g.position.set(Math.cos(b.a) * b.r, b.y + Math.sin(t * 0.4 + b.r) * 1.5, Math.sin(b.a) * b.r);
      b.g.rotation.y = Math.atan2(-Math.cos(b.a), -Math.sin(b.a)) + (b.speed < 0 ? Math.PI : 0);
      b.prop.rotation.x += dt * 12;
    }

    for (const m of this.activeEnemies) {
      const u = m.userData;
      if (u.spin) u.spin.rotation.z += gdt * 3;
      if (u.spin2) u.spin2.rotation.z -= gdt * 2;
      if (u.halo) u.halo.rotation.z += gdt * 2;
    }
    if (this.activeDrones) for (const m of this.activeDrones) m.userData.rotor.rotation.z += gdt * 30;
    for (const b of this.activeBars) b.quaternion.copy(this.camera.quaternion);

    this.sparks.update(gdt);
    this.smoke.update(dt);
    this.updateFx(gdt);

    this.controls.update();
    if (render) this.composer.render();
  }
}
