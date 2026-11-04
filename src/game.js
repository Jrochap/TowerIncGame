// Tower Inc. — run simulation: waves, enemies, weapons, economy, death.
import * as THREE from 'three';
import {
  ENEMY_TYPES, TOWER_RADIUS, SPAWN_RADIUS, SHOP, shopCost,
  waveHpMult, waveDmgMult, waveCount, waveCogMult, spawnDuration, coresForRun,
} from './config.js';
import { computeStats } from './stats.js';
import { writeSave } from './save.js';
import { COLORS } from './world.js';
import { fmt } from './util.js';
import { sfx } from './audio.js';

const _v = new THREE.Vector3();
const MAX_ALIVE = 260;

export class Game {
  constructor(world, ui, save) {
    this.world = world; this.ui = ui; this.save = save;
    this.state = 'menu';            // menu | playing | dying | dead
    this.speed = 1; this.paused = false;
    this.enemies = []; this.projectiles = []; this.missiles = []; this.delayed = [];
    this.sorted = [];
    this.shop = {};
    this.onDeath = null;
    this.refreshMeta();
  }

  // Stats outside a run (menu / skill tree): tree only, so the tower model shows unlocked modules.
  refreshMeta() {
    if (this.state === 'playing') return;
    this.stats = computeStats(this.save.tree, {});
    this.world.applyModules(this.stats);
  }

  startRun() {
    this.clearEntities();
    this.world.resetTower();
    const base = computeStats(this.save.tree, {});
    this.shop = {};
    if (base.blueprint > 0) for (const id of ['dmg', 'rate', 'hp', 'regen']) this.shop[id] = base.blueprint;
    this.stats = null;
    this.recompute();
    this.hp = this.stats.maxHp;
    this.shield = this.stats.shieldMax;
    this.cogs = this.stats.startCogs;
    this.wave = 0; this.kills = 0; this.bossKills = 0; this.siphoned = 0;
    this.time = 0; this.lastHit = -99; this.lastStandUsed = false;
    this.fireTimer = 0; this.teslaTimer = 0; this.novaTimer = 2; this.missileTimer = 0.5;
    this.muzzleSide = 0; this.podSide = 0; this.laserState = [];
    this.spawnQueue = []; this.waveTimer = 0; this.waveDur = 1; this.breakTimer = 1.5; this.inWave = false;
    this.state = 'playing'; this.paused = false;
  }

  recompute() {
    const prev = this.stats;
    this.stats = computeStats(this.save.tree, this.shop);
    if (prev) {
      if (this.stats.maxHp > prev.maxHp) this.hp += this.stats.maxHp - prev.maxHp;
      this.hp = Math.min(this.hp, this.stats.maxHp);
      if (this.stats.shieldMax > prev.shieldMax) this.shield += this.stats.shieldMax - prev.shieldMax;
      this.shield = Math.min(this.shield, this.stats.shieldMax);
    }
    this.world.applyModules(this.stats);
  }

  clearEntities() {
    for (const e of this.enemies) if (!e.dead) this.releaseEnemy(e);
    for (const p of this.projectiles) this.world.releaseProjectile(p.mesh);
    for (const m of this.missiles) this.world.releaseMissile(m.mesh);
    this.enemies = []; this.projectiles = []; this.missiles = []; this.delayed = []; this.sorted = [];
    this.world.hideBeams();
    this.laserActive = false;
    this.ui.hideBoss();
  }

  toMenu() {
    this.clearEntities();
    this.state = 'menu';
    this.world.resetTower();
    this.refreshMeta();
  }

  // ───────────────────────────── workshop ─────────────────────────────
  previewBuy(u, mode) {
    const lvl = this.shop[u.id] || 0, max = u.max ?? Infinity, disc = this.stats.shopDiscount;
    if (mode === 1) return { n: 1, cost: shopCost(u, lvl, disc) };
    let c = 0, n = 0;
    if (mode === 10) {
      for (let i = 0; i < 10 && lvl + i < max; i++) { c += shopCost(u, lvl + i, disc); n++; }
      return { n, cost: c };
    }
    while (lvl + n < max && n < 1000) {
      const nc = shopCost(u, lvl + n, disc);
      if (c + nc > this.cogs) break;
      c += nc; n++;
    }
    return n === 0 ? { n: 1, cost: shopCost(u, lvl, disc) } : { n, cost: c };
  }

  buyShop(id, mode) {
    if (this.state !== 'playing') return 0;
    const u = SHOP.find(x => x.id === id);
    if (!u || (u.req && !this.stats[u.req])) return 0;
    const limit = mode === 'max' ? 1000 : mode;
    let n = 0;
    while (n < limit) {
      const lvl = this.shop[id] || 0;
      if (lvl >= (u.max ?? Infinity)) break;
      const c = shopCost(u, lvl, this.stats.shopDiscount);
      if (this.cogs < c) break;
      this.cogs -= c; this.shop[id] = lvl + 1; n++;
    }
    if (n > 0) this.recompute();
    return n;
  }

  // ───────────────────────────── main update ─────────────────────────────
  update(dt) {
    if (this.state === 'playing') {
      this.time += dt;
      this.updateWaves(dt);
      this.updateTower(dt);
      this.updateWeapons(dt);
      this.updateEnemies(dt, false);
      this.updateProjectiles(dt);
      this.updateMissiles(dt);
      this.updateDelayed(dt);
      this.enemies = this.enemies.filter(e => !e.dead);
    } else if (this.state === 'dying') {
      this.dyingT -= dt;
      this.updateEnemies(dt, true);
      this.updateProjectiles(dt);
      this.updateMissiles(dt);
      this.enemies = this.enemies.filter(e => !e.dead);
      if (this.dyingT <= 0) {
        this.state = 'dead';
        if (this.onDeath) this.onDeath(this.deathInfo);
      }
    }
  }

  // ───────────────────────────── waves ─────────────────────────────
  updateWaves(dt) {
    if (!this.inWave) {
      this.breakTimer -= dt;
      if (this.breakTimer <= 0) this.beginWave();
      return;
    }
    // Spawning stalls while the field is saturated, which keeps the entity count (and frame rate) sane.
    if (this.enemies.length < MAX_ALIVE) this.waveTimer += dt;
    while (this.spawnQueue.length && this.spawnQueue[0].t <= this.waveTimer) this.spawnGroup(this.spawnQueue.shift());
    // A wave ends when it's cleared, or 12s after the last spawn regardless — that's how the horde snowballs.
    if (this.spawnQueue.length === 0 && (this.enemies.length === 0 || this.waveTimer > this.waveDur + 12)) this.completeWave();
  }

  beginWave() {
    this.wave++;
    const w = this.wave;
    this.inWave = true; this.waveTimer = 0;
    const count = waveCount(w);
    const dur = spawnDuration(w) * (1 - this.stats.waveSpeed);
    this.waveDur = dur;
    const pool = Object.entries(ENEMY_TYPES).filter(([, d]) => d.weight > 0 && d.minWave <= w);
    const totalW = pool.reduce((a, [, d]) => a + d.weight, 0);
    const q = [];
    for (let i = 0; i < count;) {
      let r = Math.random() * totalW, key = pool[0][0];
      for (const [k, d] of pool) { r -= d.weight; if (r <= 0) { key = k; break; } }
      const n = ENEMY_TYPES[key].group || 1;
      q.push({ key, n, t: (i / count) * dur + Math.random() * 0.4 });
      i += n;
    }
    const bossWave = w % 10 === 0;
    if (bossWave) q.push({ key: 'boss', n: 1, t: dur * 0.35 });
    q.sort((a, b) => a.t - b.t);
    this.spawnQueue = q;
    sfx.play(bossWave ? 'bossAlarm' : 'wave');
    this.ui.banner(`WAVE ${w}`, bossWave ? '⚠ LEVIATHAN SIGNATURE DETECTED' : w === 1 ? 'Hold the line, engineer.' : '', bossWave);
  }

  completeWave() {
    const w = this.wave, s = this.stats;
    this.inWave = false;
    this.breakTimer = this.enemies.length === 0 ? 2.5 : 0.3;
    const bounty = (6 + w * 2 + s.waveBounty * (1 + w * 0.1)) * s.cogMult;
    const interest = Math.min(this.cogs * s.interest, 40 + w * 30);
    this.cogs += bounty + interest;
    sfx.play('clear');
    this.ui.toast(`Wave ${w} survived · +${fmt(bounty)} ⚙${interest >= 1 ? ` · interest +${fmt(interest)} ⚙` : ''}`);
  }

  spawnGroup(s) {
    const a = Math.random() * Math.PI * 2;
    for (let j = 0; j < s.n; j++) this.spawnEnemy(s.key, a + (j - (s.n - 1) / 2) * 0.05, j * 0.7);
  }

  spawnEnemy(key, angle, extraR = 0) {
    const def = ENEMY_TYPES[key], w = this.wave;
    const boss = key === 'boss';
    const elite = !boss && w >= 6 && Math.random() < Math.min(0.2, (w - 5) * 0.007);
    const scale = elite ? 1.3 : 1;
    const hp = def.hp * waveHpMult(w) * (elite ? 4 : 1);
    const r = SPAWN_RADIUS + Math.random() * 3 + extraR;
    const e = {
      key, def, boss, elite, scale,
      mesh: this.world.acquireEnemy(key, elite),
      x: Math.cos(angle) * r, z: Math.sin(angle) * r, y: def.y,
      hp, maxHp: hp,
      speed: def.speed * (1 + Math.min(0.5, w * 0.006)) * (elite ? 0.9 : 1),
      dmg: def.dmg * waveDmgMult(w) * (elite ? 2 : 1),
      radius: def.radius * scale,
      attacking: false, atkTimer: Math.random() * 0.5,
      stunT: 0, shredT: 0, burnT: 0, burnDps: 0, kx: 0, kz: 0, flash: 0,
      wobble: Math.random() * 10, dead: false, d2: 0,
    };
    if (def.bar || elite) {
      e.bar = this.world.acquireBar(boss ? 5 : 1.4 * scale * (def.radius / 0.75), elite || boss);
      e.barH = def.y * scale + e.radius + 0.7;
    }
    this.enemies.push(e);
    if (boss) this.ui.showBoss(e);
  }

  releaseEnemy(e) {
    this.world.releaseEnemy(e.mesh);
    if (e.bar) { this.world.releaseBar(e.bar); e.bar = null; }
  }

  // ───────────────────────────── tower ─────────────────────────────
  updateTower(dt) {
    const s = this.stats;
    let regen = s.regen;
    if (this.hp < s.maxHp * 0.3) regen *= 1 + s.ventRegen;
    this.hp = Math.min(s.maxHp, this.hp + regen * dt);
    if (s.shieldMax > 0 && this.time - this.lastHit > 2.5) this.shield = Math.min(s.shieldMax, this.shield + s.shieldRegen * dt);
    if (s.passiveCogs > 0) this.cogs += s.passiveCogs * (1 + this.wave * 0.1) * s.cogMult * dt;
    this.world.setShield(s.shieldMax > 0 ? this.shield / s.shieldMax : 0);
  }

  damageTower(raw, src) {
    if (this.state !== 'playing') return;
    const s = this.stats;
    let d = raw * (1 - s.totalDR);
    if (this.shield > 0) { const a = Math.min(this.shield, d); this.shield -= a; d -= a; }
    this.hp -= d;
    this.lastHit = this.time;
    this.world.towerHit();
    sfx.play('hit');
    this.ui.hurt(d / s.maxHp);
    if (src && s.thorns > 0 && !src.dead) this.damageEnemy(src, src.maxHp * s.thorns * (src.boss ? 0.1 : 1), { silent: true });
    if (this.hp <= 0) {
      if (s.lastStand && !this.lastStandUsed) {
        this.lastStandUsed = true;
        this.hp = s.maxHp * 0.5;
        sfx.play('lastStand');
        this.ui.banner('LAST STAND', 'Emergency reserves engaged', true);
        this.world.nova(16);
        for (const e of this.enemies) {
          const dd = Math.hypot(e.x, e.z) || 1;
          e.kx += e.x / dd * 12; e.kz += e.z / dd * 12;
          if (!e.boss) e.stunT = 1.5;
        }
      } else {
        this.die();
      }
    }
  }

  die() {
    if (this.state !== 'playing') return;
    this.state = 'dying'; this.dyingT = 2.4; this.hp = 0;
    const earned = Math.floor(coresForRun(this.wave, this.kills, this.bossKills) * this.stats.coreMult);
    const prevBest = this.save.bestWave;
    this.save.cores += earned;
    this.save.totalCores += earned + this.siphoned;
    this.save.bestWave = Math.max(prevBest, this.wave);
    this.save.runs++;
    this.save.totalKills += this.kills;
    writeSave(this.save);
    this.deathInfo = { wave: this.wave, kills: this.kills, bosses: this.bossKills, earned, siphoned: this.siphoned, newBest: this.wave > prevBest, time: this.time };
    this.world.towerDestroyed();
    sfx.play('destroyed');
    this.laserActive = false;
    this.world.hideBeams();
    this.ui.hideBoss();
  }

  // ───────────────────────────── weapons ─────────────────────────────
  findNearest(x, z, maxDist, exclude) {
    let best = null, bd = maxDist * maxDist;
    for (const e of this.enemies) {
      if (e.dead || (exclude && exclude.has(e))) continue;
      const dx = e.x - x, dz = e.z - z, d2 = dx * dx + dz * dz;
      if (d2 < bd) { bd = d2; best = e; }
    }
    return best;
  }

  inRadius(r) {
    const r2 = r * r, out = [];
    for (const e of this.sorted) { if (e.d2 > r2) break; if (!e.dead) out.push(e); }
    return out;
  }

  updateWeapons(dt) {
    const s = this.stats, W = this.world;
    this.sorted = this.enemies.filter(e => !e.dead);
    for (const e of this.sorted) e.d2 = e.x * e.x + e.z * e.z;
    this.sorted.sort((a, b) => a.d2 - b.d2);

    // main cannon
    const targets = this.inRadius(s.range);
    this.fireTimer -= dt;
    if (targets.length) {
      W.aimTurret(Math.atan2(targets[0].x, targets[0].z));
      let guard = 0;
      while (this.fireTimer <= 0 && guard++ < 6) {
        this.fireTimer += 1 / s.fireRate;
        const shots = s.projectiles + Math.floor(s.multishot) + (Math.random() < s.multishot % 1 ? 1 : 0);
        for (let i = 0; i < shots; i++) this.fireProjectile(targets[i % targets.length]);
      }
    } else if (this.fireTimer < 0) this.fireTimer = 0;

    // tesla coil
    if (s.teslaOn) {
      this.teslaTimer -= dt;
      if (this.teslaTimer <= 0) {
        const cands = this.inRadius(s.teslaRange);
        if (cands.length) {
          this.teslaTimer = 1 / s.teslaRate;
          const origin = W.coilTop();
          for (let a = 0; a < s.teslaArcs; a++) {
            let cur = a === 0 ? cands[0] : cands[Math.floor(Math.random() * cands.length)];
            const pts = [origin], hit = new Set();
            let dmg = s.teslaDamage;
            for (let c = 0; c <= s.teslaChains && cur; c++) {
              hit.add(cur);
              pts.push(new THREE.Vector3(cur.x, cur.y, cur.z));
              if (s.teslaStun > 0 && !cur.boss) cur.stunT = Math.max(cur.stunT, s.teslaStun);
              if (s.teslaShred > 0) cur.shredT = 3;
              this.damageEnemy(cur, dmg, { kind: 'volt' });
              dmg *= 0.85;
              cur = this.findNearest(cur.x, cur.z, 7, hit);
            }
            W.lightning(pts);
            sfx.play('tesla');
          }
        } else this.teslaTimer = 0;
      }
    }

    // pressure nova
    if (s.novaOn) {
      this.novaTimer -= dt;
      if (this.novaTimer <= 0) {
        const cands = this.inRadius(s.novaRadius);
        if (cands.length) {
          this.novaTimer = 1 / s.novaRate;
          W.nova(s.novaRadius);
          sfx.play('nova');
          for (const e of cands) {
            this.damageEnemy(e, s.novaDamage, { kind: 'volt' });
            const d = Math.sqrt(e.d2) || 1, k = s.novaKnock * (e.boss ? 0.15 : e.elite ? 0.5 : 1) * 4;
            e.kx += e.x / d * k; e.kz += e.z / d * k;
          }
        } else this.novaTimer = 0;
      }
    }

    // rocket pods
    if (s.missileOn) {
      this.missileTimer -= dt;
      if (this.missileTimer <= 0) {
        const cands = this.inRadius(s.range * 1.5);
        if (cands.length) {
          this.missileTimer = 1 / s.missileRate;
          let strongest = cands[0];
          for (const e of cands) if (e.hp > strongest.hp) strongest = e;
          for (let i = 0; i < s.missileCount; i++) {
            this.launchMissile(i === 0 ? strongest : cands[Math.floor(Math.random() * cands.length)], i * 0.09);
          }
        } else this.missileTimer = 0;
      }
    }

    // prism laser
    // laserLocked / laserPitch feed the hum: a swell on each new lock, pitch rising with the burn
    this.laserActive = false;
    let burn = 0;
    if (s.laserOn && targets.length) {
      const byHp = targets.slice().sort((a, b) => b.hp - a.hp);
      const r2 = s.range * s.range;
      const from = W.prismPos();
      for (let i = 0; i < 4; i++) {
        if (i >= s.laserCount) { W.hideBeam(i); continue; }
        const st = this.laserState[i] || (this.laserState[i] = { target: null, ramp: 0, acc: 0, accT: 0 });
        let t = st.target && !st.target.dead && st.target.d2 <= r2 ? st.target : null;
        if (!t) { t = byHp[i] || null; st.target = t; st.ramp = 0; if (t) this.laserLocked = true; }
        if (!t) { W.hideBeam(i); continue; }
        st.ramp += dt;
        const dmg = s.laserDps * (1 + s.laserRamp * Math.min(st.ramp, 5)) * dt;
        const ty = t.y, tx = t.x, tz = t.z;
        st.acc += this.damageEnemy(t, dmg, { silent: true });
        st.accT += dt;
        if (st.accT > 0.35) { this.ui.damageNumber(tx, ty + 1, tz, st.acc, false, 'laser'); st.acc = 0; st.accT = 0; }
        W.setBeam(i, from, _v.set(tx, ty, tz));
        this.laserActive = true;
        burn = Math.max(burn, Math.min(st.ramp, 5) / 5);
      }
    } else W.hideBeams();
    // full bend with Thermal Lance (damage really ramps), a subtle one without
    this.laserPitch = burn * (s.laserRamp > 0 ? 1 : 0.3);
  }

  fireProjectile(target) {
    const s = this.stats;
    const crit = Math.random() < s.critChance;
    sfx.play(crit ? 'crit' : 'shoot');
    this.muzzleSide = 1 - this.muzzleSide;
    const mesh = this.world.acquireProjectile(crit);
    const p = this.world.muzzlePos(this.muzzleSide);
    mesh.position.copy(p);
    this.world.sparks.emit(p.x, p.y, p.z, 0, 1, 0, COLORS.amber, 0.12);
    this.projectiles.push({ mesh, target, dmg: s.damage * (crit ? s.critMult : 1), crit, pierce: s.pierce, hit: new Set(), life: 2.5, speed: s.projSpeed, done: false });
  }

  updateProjectiles(dt) {
    const s = this.stats;
    for (const p of this.projectiles) {
      if (p.done) continue;
      p.life -= dt;
      if (p.life <= 0) { p.done = true; continue; }
      const pos = p.mesh.position;
      let t = p.target;
      if (!t || t.dead) {
        t = p.target = this.findNearest(pos.x, pos.z, 12, p.hit);
        if (!t) { p.done = true; continue; }
      }
      _v.set(t.x - pos.x, t.y - pos.y, t.z - pos.z);
      const dist = _v.length(), step = p.speed * dt;
      if (dist <= step + t.radius * 0.6) {
        pos.set(t.x, t.y, t.z);
        this.damageEnemy(t, p.dmg, { crit: p.crit });
        if (s.knockback > 0 && !t.boss) {
          const d = Math.hypot(t.x, t.z) || 1, k = s.knockback * 5 * (t.elite ? 0.4 : 1);
          t.kx += t.x / d * k; t.kz += t.z / d * k;
        }
        this.world.burst(pos, p.crit ? 8 : 3, p.crit ? COLORS.red : COLORS.amber, 5, 0.25, 8);
        p.hit.add(t);
        if (p.pierce > 0) {
          p.pierce--;
          p.target = this.findNearest(t.x, t.z, 9, p.hit);
          if (!p.target) p.done = true;
        } else p.done = true;
      } else {
        _v.multiplyScalar(1 / dist);
        pos.addScaledVector(_v, step);
        p.mesh.lookAt(pos.x + _v.x, pos.y + _v.y, pos.z + _v.z);
      }
    }
    if (this.projectiles.some(p => p.done)) {
      this.projectiles = this.projectiles.filter(p => {
        if (p.done) { this.world.releaseProjectile(p.mesh); return false; }
        return true;
      });
    }
  }

  launchMissile(target, delay) {
    this.podSide = 1 - this.podSide;
    const start = this.world.podPos(this.podSide);
    const mesh = this.world.acquireMissile();
    sfx.play('launch');
    mesh.position.copy(start); mesh.visible = delay <= 0;
    this.missiles.push({
      mesh, start, target, delay, t: 0, done: false,
      end: new THREE.Vector3(target.x, target.y, target.z),
      dur: 0.6 + start.distanceTo(_v.set(target.x, target.y, target.z)) / 40,
      prev: start.clone(),
    });
  }

  updateMissiles(dt) {
    const s = this.stats;
    for (const m of this.missiles) {
      if (m.done) continue;
      if (m.delay > 0) { m.delay -= dt; if (m.delay <= 0) m.mesh.visible = true; continue; }
      if (m.target && !m.target.dead) m.end.set(m.target.x, m.target.y, m.target.z);
      m.t += dt / m.dur;
      const t = Math.min(1, m.t), it = 1 - t;
      const cx = (m.start.x + m.end.x) / 2, cz = (m.start.z + m.end.z) / 2;
      const cy = Math.max(m.start.y, m.end.y) + 5 + m.start.distanceTo(m.end) * 0.25;
      const pos = m.mesh.position;
      pos.set(
        it * it * m.start.x + 2 * it * t * cx + t * t * m.end.x,
        it * it * m.start.y + 2 * it * t * cy + t * t * m.end.y,
        it * it * m.start.z + 2 * it * t * cz + t * t * m.end.z,
      );
      _v.copy(pos).sub(m.prev);
      if (_v.lengthSq() > 1e-6) m.mesh.lookAt(pos.x + _v.x, pos.y + _v.y, pos.z + _v.z);
      m.prev.copy(pos);
      this.world.missileTrail(pos);
      if (m.t >= 1) {
        m.done = true;
        this.explode(m.end.clone(), s.missileRadius, s.missileDamage, true);
      }
    }
    if (this.missiles.some(m => m.done)) {
      this.missiles = this.missiles.filter(m => {
        if (m.done) { this.world.releaseMissile(m.mesh); return false; }
        return true;
      });
    }
  }

  explode(pos, radius, dmg, primary) {
    const s = this.stats;
    this.world.explosion(pos, radius, primary ? COLORS.green : COLORS.amber);
    sfx.play(primary ? 'explosion' : 'bomblet');
    for (const e of this.enemies) {
      if (e.dead) continue;
      const dx = e.x - pos.x, dz = e.z - pos.z, rr = radius + e.radius * 0.5;
      if (dx * dx + dz * dz > rr * rr) continue;
      if (s.missileBurn > 0) { e.burnDps = Math.max(e.burnDps, dmg * s.missileBurn / 3); e.burnT = 3; }
      this.damageEnemy(e, dmg, { kind: 'ord' });
    }
    if (primary && s.missileCluster > 0) {
      for (let i = 0; i < s.missileCluster * 2; i++) {
        const a = Math.random() * Math.PI * 2, r = radius * (0.6 + Math.random() * 0.8);
        const p = new THREE.Vector3(pos.x + Math.cos(a) * r, 0.4, pos.z + Math.sin(a) * r);
        this.delayed.push({ t: 0.12 + Math.random() * 0.25, fn: () => this.explode(p, radius * 0.6, dmg * 0.4, false) });
      }
    }
  }

  updateDelayed(dt) {
    if (!this.delayed.length) return;
    const due = [];
    this.delayed = this.delayed.filter(d => { d.t -= dt; if (d.t <= 0) { due.push(d); return false; } return true; });
    for (const d of due) d.fn();
  }

  // ───────────────────────────── enemies ─────────────────────────────
  damageEnemy(e, amount, opts = {}) {
    if (e.dead) return 0;
    const s = this.stats;
    let d = amount;
    if (e.shredT > 0) d *= 1 + s.teslaShred;
    if (e.boss || e.elite) d *= s.bossDmg;
    e.hp -= d;
    e.flash = 1;
    if (s.lifesteal > 0 && this.state === 'playing') this.hp = Math.min(s.maxHp, this.hp + Math.min(d * s.lifesteal, s.maxHp * 0.02));
    if (!opts.silent) this.ui.damageNumber(e.x, e.y + e.radius + 0.4, e.z, d, opts.crit, opts.kind);
    if (e.hp <= 0 || (s.execute > 0 && !e.boss && e.hp < e.maxHp * s.execute)) this.killEnemy(e);
    return d;
  }

  killEnemy(e) {
    if (e.dead) return;
    e.dead = true;
    if (this.state !== 'playing') { this.world.enemyDeath(e); this.releaseEnemy(e); return; }
    const s = this.stats;
    this.kills++;
    let c = e.def.cogs * waveCogMult(this.wave) * s.cogMult;
    if (e.elite) c *= 4;
    if (e.elite || e.boss) c *= 1 + s.bossBounty;
    this.cogs += c;
    if (e.boss) {
      this.bossKills++;
      this.ui.hideBoss();
      this.ui.toast('Leviathan destroyed! +15 ◈ bonus on extraction');
    }
    if (s.coreSiphon > 0 && Math.random() < s.coreSiphon) {
      const n = 1 + Math.floor(this.wave / 25);
      this.siphoned += n; this.save.cores += n;
      this.ui.floatText(e.x, e.y + 1.5, e.z, `+${n} ◈`, 'core');
      sfx.play('core');
    }
    sfx.play(e.boss ? 'bossDie' : e.elite || e.key === 'juggernaut' ? 'bigDie' : 'die');
    this.world.enemyDeath(e);
    this.releaseEnemy(e);
  }

  enemyAttack(e) {
    if (e.def.ranged) {
      sfx.play('zap');
      this.world.lightning([new THREE.Vector3(e.x, e.y + 0.45, e.z), new THREE.Vector3(e.x * 0.25, 3, e.z * 0.25)], COLORS.red, 0.25, 0.15);
      this.damageTower(e.dmg, null);
    } else {
      this.damageTower(e.dmg, e);
      this.world.sparks.emit(e.x * 0.85, e.y, e.z * 0.85, (Math.random() - 0.5) * 4, 3, (Math.random() - 0.5) * 4, COLORS.amber, 0.3, 8);
    }
  }

  updateEnemies(dt, frozen) {
    const s = this.stats;
    for (const e of this.enemies) {
      if (e.dead) continue;
      const def = e.def;
      if (e.stunT > 0) e.stunT -= dt;
      if (e.shredT > 0) e.shredT -= dt;
      if (e.burnT > 0) {
        e.burnT -= dt;
        this.damageEnemy(e, e.burnDps * dt, { silent: true });
        if (e.dead) continue;
        if (Math.random() < dt * 8) this.world.sparks.emit(e.x, e.y, e.z, 0, 2, 0, COLORS.amber, 0.4);
      }
      // knockback impulse decays exponentially
      e.x += e.kx * dt; e.z += e.kz * dt;
      const decay = Math.exp(-5 * dt);
      e.kx *= decay; e.kz *= decay;

      const dist = Math.hypot(e.x, e.z) || 0.001;
      const stop = def.ranged ? def.ranged : TOWER_RADIUS + e.radius * 0.8;
      let sp = e.speed;
      if (s.slowAura > 0 && dist < s.slowRadius + e.radius) sp *= 1 - s.slowAura;
      if (e.stunT > 0 || frozen) sp = 0;

      if (dist > stop) {
        e.attacking = false;
        const nx = -e.x / dist, nz = -e.z / dist;
        const wob = Math.sin(this.time * 1.7 + e.wobble) * (def.flying ? 0.7 : 0.3);
        const step = Math.min(sp * dt, dist - stop);
        e.x += (nx - nz * wob) * step;
        e.z += (nz + nx * wob) * step;
      } else {
        if (dist < stop - 0.3) { e.x = e.x / dist * stop; e.z = e.z / dist * stop; }
        e.attacking = true;
        if (!frozen && e.stunT <= 0) {
          e.atkTimer -= dt;
          if (e.atkTimer <= 0) { e.atkTimer += def.atkRate || 1; this.enemyAttack(e); if (this.state !== 'playing') frozen = true; }
        }
      }

      e.y = def.y * e.scale + (def.flying ? Math.sin(this.time * 3 + e.wobble) * 0.3 : 0);
      const m = e.mesh;
      let lunge = 0;
      if (e.attacking && !def.ranged && !frozen) lunge = Math.max(0, Math.sin((1 - e.atkTimer / (def.atkRate || 1)) * Math.PI * 2)) * 0.35;
      const len = Math.hypot(e.x, e.z) || 1;
      m.position.set(e.x - e.x / len * lunge, e.y, e.z - e.z / len * lunge);
      m.rotation.y = Math.atan2(-e.x, -e.z);
      e.flash *= Math.exp(-12 * dt);
      m.scale.setScalar(e.scale * (1 + e.flash * 0.15));
      if (e.bar) this.world.updateBar(e.bar, e.x, e.y + e.barH, e.z, e.hp / e.maxHp);
    }
  }

  selfDestruct() {
    if (this.state === 'playing') this.die();
  }
}
