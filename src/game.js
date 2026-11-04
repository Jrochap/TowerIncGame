// Tower Inc. — run simulation: waves, enemies, weapons, economy, death.
import * as THREE from 'three';
import {
  ENEMY_TYPES, TOWER_RADIUS, SPAWN_RADIUS, SHOP, shopCost, shopLock,
  waveHpMult, waveDmgMult, waveCount, waveCogMult, spawnDuration, coresForRun,
} from './config.js';
import { computeStats } from './stats.js';
import { writeSave } from './save.js';
import { startWaveFor, blueprintsFor, rawBlueprints, hazardBonus } from './foundry.js';
import { CHALLENGE_MAP, tiersFor } from './challenges.js';
import { COLORS } from './world.js';
import { fmt } from './util.js';
import { sfx } from './audio.js';

const _v = new THREE.Vector3();
const MAX_ALIVE = 260;

// Approximate cogs a run earns from waves 1..n (kills ~2 cogs avg + wave bounty + boss), before cogMult.
function skippedCogs(n) {
  let c = 0;
  for (let w = 1; w <= n; w++) c += waveCount(w) * 2 * waveCogMult(w) + 6 + w * 2 + (w % 10 === 0 ? 80 * waveCogMult(w) : 0);
  return c * 0.8;
}

export class Game {
  constructor(world, ui, save) {
    this.world = world; this.ui = ui; this.save = save;
    this.state = 'menu';            // menu | playing | dying | dead
    this.speed = 1; this.paused = false;
    this.enemies = []; this.projectiles = []; this.missiles = []; this.delayed = []; this.drones = []; this.shells = [];
    this.sorted = [];
    this.shop = {}; this.hz = {}; this.challenge = null; this.nextChallenge = null;
    this.onDeath = null;
    this.refreshMeta();
  }

  // Stats outside a run (menu / skill tree): tree only, so the tower model shows unlocked modules.
  refreshMeta() {
    if (this.state === 'playing') return;
    this.stats = computeStats(this.save.tree, {}, this.save.foundry, this.save.challenges);
    this.world.applyModules(this.stats);
  }

  // challengeId: run under that challenge's rules (null = normal shift)
  startRun(challengeId = null) {
    this.clearEntities();
    this.world.resetTower();
    this.challenge = challengeId && CHALLENGE_MAP[challengeId] ? CHALLENGE_MAP[challengeId] : null;
    this.nextChallenge = challengeId;
    const base = computeStats(this.save.tree, {}, this.save.foundry, this.save.challenges, challengeId);
    this.shop = {};
    if (base.kitLevel > 0) for (const u of SHOP) if (!u.req || base[u.req]) this.shop[u.id] = Math.min(u.max ?? Infinity, base.kitLevel);
    if (base.blueprint > 0) for (const id of ['dmg', 'rate', 'hp', 'regen']) this.shop[id] = (this.shop[id] || 0) + base.blueprint;
    this.stats = null;
    this.recompute();
    this.hp = this.stats.maxHp;
    this.shield = this.stats.shieldMax;
    this.cogs = this.stats.startCogs;
    this.siege = 0; this.siegeWarned = false;
    this.wave = 0; this.kills = 0; this.bossKills = 0; this.siphoned = 0;
    this.time = 0; this.lastHit = -99; this.lastStandUsed = false;
    this.fireTimer = 0; this.teslaTimer = 0; this.novaTimer = 2; this.missileTimer = 0.5;
    this.muzzleSide = 0; this.podSide = 0; this.laserState = []; this.autoT = 1;
    this.spawnQueue = []; this.waveTimer = 0; this.waveDur = 1; this.breakTimer = 1.5; this.inWave = false;
    // Express Elevator: skip ahead, paid roughly what those waves would have earned
    const sw = this.challenge ? 1 : startWaveFor(this.save);
    if (sw > 1) {
      this.wave = sw - 1;
      this.cogs += skippedCogs(sw - 1) * this.stats.cogMult;
    }
    this.startWave = Math.max(1, sw);
    this.hz = this.save.reforges > 0 && !this.challenge ? { ...this.save.hazards } : {};
    this.chTier = this.challenge ? (this.save.challenges[this.challenge.id] || 0) : 0;
    this.state = 'playing'; this.paused = false;
  }

  recompute() {
    const prev = this.stats;
    this.stats = computeStats(this.save.tree, this.shop, this.save.foundry, this.save.challenges, this.challenge?.id);
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
    for (const d of this.drones) this.world.releaseDrone(d.mesh);
    for (const sh of this.shells) this.world.releaseProjectile(sh.mesh);
    this.drones = []; this.shells = [];
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
    if (!u || shopLock(u, this.stats)) return 0;
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

  // Clockwork Clerk: one purchase per tick. 'selected' buys the cheapest marked upgrade;
  // 'any' picks randomly among everything affordable, weighted toward cheaper upgrades.
  updateAutoBuy(dt) {
    const s = this.stats, ab = this.save.autobuy;
    if (!s.autoBuy || ab.mode === 'off') return;
    this.autoT -= dt;
    if (this.autoT > 0) return;
    this.autoT = s.autoInterval;
    const cands = [];
    for (const u of SHOP) {
      const lvl = this.shop[u.id] || 0;
      if (shopLock(u, s) || lvl >= (u.max ?? Infinity)) continue;
      if (ab.mode === 'selected' && !ab.sel[u.id]) continue;
      const cost = shopCost(u, lvl, s.shopDiscount);
      if (cost <= this.cogs) cands.push({ u, cost });
    }
    if (!cands.length) return;
    let pick = cands[0];
    if (ab.mode === 'selected') {
      for (const c of cands) if (c.cost < pick.cost) pick = c;
    } else {
      let r = Math.random() * cands.reduce((a, c) => a + 1 / c.cost, 0);
      for (const c of cands) { r -= 1 / c.cost; if (r <= 0) { pick = c; break; } }
    }
    if (this.buyShop(pick.u.id, 1)) this.ui.flashBought(pick.u.id);
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
      this.updateDrones(dt);
      this.updateShells(dt);
      this.updateDelayed(dt);
      this.updateAutoBuy(dt);
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
    // Saturation builds siege pressure (enemies hit harder) so a tower that can't clear still falls.
    if (this.enemies.length < MAX_ALIVE) {
      this.waveTimer += dt;
      this.siege = Math.max(0, this.siege - dt * 0.25);
    } else {
      this.siege += dt * 0.08;
      if (this.siege > 0.5 && !this.siegeWarned) { this.siegeWarned = true; this.ui.toast('⚠ The horde is massing: siege pressure rising'); }
    }
    while (this.spawnQueue.length && this.spawnQueue[0].t <= this.waveTimer) this.spawnGroup(this.spawnQueue.shift());
    // A wave ends when it's cleared, or 12s after the last spawn regardless — that's how the horde snowballs.
    if (this.spawnQueue.length === 0 && (this.enemies.length === 0 || this.waveTimer > this.waveDur + 12)) this.completeWave();
  }

  beginWave() {
    this.wave++;
    const w = this.wave;
    this.inWave = true; this.waveTimer = 0; this.siegeWarned = false;
    const count = Math.round(waveCount(w) * (this.stats.overtime ? 1.6 : 1));
    const dur = spawnDuration(w) * (1 - this.stats.waveSpeed) * (this.stats.overtime ? 0.5 : 1);
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
    const every = this.stats.bossEvery || 10, bossWave = w % every === 0;
    // bosses alternate: Leviathan on odd boss waves (10, 30, 50…), Dreadnought on even ones (20, 40…)
    const bossKey = (w / every) % 2 === 1 ? 'boss' : 'dread';
    if (bossWave) q.push({ key: bossKey, n: 1, t: dur * 0.35 });
    q.sort((a, b) => a.t - b.t);
    this.spawnQueue = q;
    sfx.play(bossWave ? 'bossAlarm' : 'wave');
    this.ui.banner(`WAVE ${w}`, bossWave ? `⚠ ${ENEMY_TYPES[bossKey].alert}` : w === 1 ? 'Hold the line, engineer.' : '', bossWave);
  }

  completeWave() {
    const w = this.wave, s = this.stats;
    this.inWave = false;
    this.breakTimer = (this.enemies.length === 0 ? 2.5 : 0.3) * (s.overtime ? 0.4 : 1);
    const bounty = (6 + w * 2 + s.waveBounty * (1 + w * 0.1)) * s.cogMult;
    const interest = Math.min(this.cogs * s.interest, 40 + w * 30);
    this.cogs += bounty + interest;
    sfx.play('clear');
    if (this.challenge) {
      const t = tiersFor(this.challenge, w);
      if (t > this.chTier) {
        this.chTier = t;
        this.save.challenges[this.challenge.id] = Math.max(this.save.challenges[this.challenge.id] || 0, t);
        writeSave(this.save);
        sfx.play('treeBuy');
        this.ui.banner(`TIER ${t} CLEARED`, `${this.challenge.name} · ${this.challenge.reward(t)}`);
      }
    }
    this.ui.toast(`Wave ${w} survived · +${fmt(bounty)} ⚙${interest >= 1 ? ` · interest +${fmt(interest)} ⚙` : ''}`);
  }

  spawnGroup(s) {
    const a = Math.random() * Math.PI * 2;
    for (let j = 0; j < s.n; j++) this.spawnEnemy(s.key, a + (j - (s.n - 1) / 2) * 0.05, j * 0.7);
  }

  spawnEnemy(key, angle, extraR = 0, at = null) {
    const def = ENEMY_TYPES[key], w = this.wave, hz = this.hz;
    const boss = !!def.boss;
    const elite = !at && !boss && w >= 6 && Math.random() < Math.min(0.2, (w - 5) * 0.007);
    const scale = elite ? 1.3 : 1;
    const hp = at ? at.hp : def.hp * waveHpMult(w) * (elite ? 4 : 1);
    const r = SPAWN_RADIUS + Math.random() * 3 + extraR;
    const e = {
      key, def, boss, elite, scale,
      mesh: this.world.acquireEnemy(key, elite),
      x: Math.cos(angle) * r, z: Math.sin(angle) * r, y: def.y,
      hp, maxHp: hp,
      speed: def.speed * (1 + Math.min(0.5, w * 0.006)) * (elite ? 0.9 : 1) * (hz.swift ? 1.45 : 1) * (this.stats.overtime ? 1.6 : 1),
      dmg: def.dmg * waveDmgMult(w) * (elite ? 2 : 1),
      radius: def.radius * scale,
      attacking: false, atkTimer: Math.random() * 0.5,
      stunT: 0, stunImm: 0, shredT: 0, knockCd: 0, markT: 0, burnT: 0, burnDps: 0, kx: 0, kz: 0, flash: 0,
      wobble: Math.random() * 10, dead: false, d2: 0,
      barrier: 0, hitT: -99, child: !!at, escortT: def.escort ? 3 : 0,
    };
    if (at) { e.x = at.x; e.z = at.z; }
    if (hz.shield && (boss || Math.random() < 0.5)) e.barrier = hp * (boss ? 0.5 : 1);
    this.world.setEnemyMarks(e.mesh, { shield: e.barrier > 0, regen: !!hz.regen, volatile: !!hz.volatile });
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
    const hzB = hazardBonus(this.hz);
    const earned = Math.floor(coresForRun(this.wave, this.kills, this.bossKills) * this.stats.coreMult * (1 + hzB));
    if (!this.challenge) this.save.cycleBp = Math.max(this.save.cycleBp || 0, rawBlueprints(this.wave, this.hz));
    const prevBest = this.save.bestWave;
    this.save.cores += earned;
    this.save.totalCores += earned + this.siphoned;
    if (!this.challenge) this.save.bestWave = Math.max(prevBest, this.wave);
    this.save.runs++;
    this.save.totalKills += this.kills;
    writeSave(this.save);
    this.deathInfo = { challenge: this.challenge, chTier: this.chTier, hazardBonus: hzB, reforgeBp: blueprintsFor(this.save), wave: this.wave, kills: this.kills, bosses: this.bossKills, earned, siphoned: this.siphoned, newBest: !this.challenge && this.wave > prevBest, time: this.time };
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
      if (s.cannonOff) this.fireTimer = Math.max(this.fireTimer, 0); // Iron Curtain: barrels stay cold
      while (!s.cannonOff && this.fireTimer <= 0 && guard++ < 6) {
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
              if (s.teslaStun > 0 && !cur.boss && !(cur.stunImm > 0)) { cur.stunT = Math.max(cur.stunT, s.teslaStun); cur.stunImm = s.teslaStun + 1.5; } // brief immunity after each stun: no permanent lock
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
            if (e.knockCd > 0) continue; // shares the shell knockback cooldown
            const d = Math.sqrt(e.d2) || 1, k = Math.min(8, s.novaKnock * 4) * (e.boss ? 0.15 : e.elite ? 0.5 : 1);
            e.kx += e.x / d * k; e.kz += e.z / d * k; e.knockCd = 1.5;
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
        // Shell knockback: one shove per enemy every 1.5s, capped (~1.2m), so a fast-firing cannon
        // can't pin the whole horde at the spawn ring forever.
        if (s.knockback > 0 && !t.boss && !(t.knockCd > 0)) {
          const d = Math.hypot(t.x, t.z) || 1, k = Math.min(6, s.knockback * 5) * (t.elite ? 0.4 : 1);
          t.kx += t.x / d * k; t.kz += t.z / d * k; t.knockCd = 1.5;
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

  // ───────────────────────────── dreadnought artillery ─────────────────────────────
  // Lobbed shells: visible ~1.3s arc from the barge to the hull, so the hit lands after the launch.
  fireShell(e) {
    const mesh = this.world.acquireProjectile(true);
    mesh.scale.setScalar(3);
    this.shells.push({ mesh, sx: e.x, sy: e.y + 2, sz: e.z, t: 0, dur: 1.3, dmg: e.dmg * (1 + this.siege), src: e });
    this.world.flash(_v.set(e.x, e.y + 2, e.z), 1.6, COLORS.amber, 0.2);
    sfx.play('launch');
  }

  updateShells(dt) {
    for (let i = this.shells.length - 1; i >= 0; i--) {
      const sh = this.shells[i];
      sh.t += dt;
      const k = Math.min(1, sh.t / sh.dur);
      const ex = sh.sx * 0.18, ez = sh.sz * 0.18, ey = 5;           // lands on the hull's outer ring
      const x = sh.sx + (ex - sh.sx) * k, z = sh.sz + (ez - sh.sz) * k;
      const y = sh.sy + (ey - sh.sy) * k + Math.sin(k * Math.PI) * 9;
      sh.mesh.position.set(x, y, z);
      if (Math.random() < 0.6) this.world.sparks.emit(x, y, z, 0, 0.5, 0, COLORS.amber, 0.35, 0);
      if (k >= 1) {
        this.world.releaseProjectile(sh.mesh);
        this.shells.splice(i, 1);
        this.world.explosion(_v.set(x, y, z), 3, COLORS.amber);
        sfx.play('explosion');
        this.damageTower(sh.dmg, null);
      }
    }
  }

  // ───────────────────────────── drone bay ─────────────────────────────
  // Each drone orbits the tower until something is in range, then dives, strikes (splash + paint) and
  // hovers above the strike point while it recharges, diving again from there. It only flies home to
  // its orbit slot when nothing is left in range, so dive rate (not flight time) sets its damage.
  updateDrones(dt) {
    const s = this.stats, W = this.world;
    const want = s.droneOn ? s.droneCount : 0;
    while (this.drones.length < want) {
      const i = this.drones.length;
      this.drones.push({ mesh: W.acquireDrone(), state: 'orbit', cd: 0.5 + i * 0.3, x: 0, y: 8, z: 0, target: null });
    }
    while (this.drones.length > want) W.releaseDrone(this.drones.pop().mesh);
    const n = this.drones.length;
    for (let i = 0; i < n; i++) {
      const d = this.drones[i];
      const a = this.time * 0.9 + i / n * Math.PI * 2;
      const ox = Math.cos(a) * 6.5, oz = Math.sin(a) * 6.5, oy = 8 + Math.sin(this.time * 2.3 + i) * 0.35;
      if (d.state === 'orbit') {
        d.x += (ox - d.x) * Math.min(1, dt * 6); d.y += (oy - d.y) * Math.min(1, dt * 6); d.z += (oz - d.z) * Math.min(1, dt * 6);
        d.cd -= dt;
        if (d.cd <= 0) {
          const t = this.pickDroneTarget(s.droneRange);
          if (t) { d.target = t; d.state = 'dive'; } else d.cd = 0.2;
        }
      } else if (d.state === 'dive') {
        let t = d.target;
        if (!t || t.dead) { t = d.target = this.findNearest(d.x, d.z, 12); if (!t) { d.state = 'return'; continue; } }
        const tx = t.x - d.x, ty = t.y - d.y, tz = t.z - d.z, dist = Math.hypot(tx, ty, tz) || 1;
        const step = 50 * dt;
        if (dist <= step + t.radius * 0.6) {
          this.droneStrike(t);
          d.state = 'hover'; d.target = null; d.cd = 1 / s.droneRate; d.hy = t.y + 3.5;
        } else { d.x += tx / dist * step; d.y += ty / dist * step; d.z += tz / dist * step; }
      } else if (d.state === 'hover') {
        d.y += (d.hy - d.y) * Math.min(1, dt * 5);
        d.cd -= dt;
        if (d.cd <= 0) {
          const t = this.pickDroneTarget(s.droneRange);
          if (t) { d.target = t; d.state = 'dive'; } else d.state = 'return';
        }
      } else { // return
        const tx = ox - d.x, ty = oy - d.y, tz = oz - d.z, dist = Math.hypot(tx, ty, tz);
        const step = 32 * dt;
        if (dist <= step) d.state = 'orbit';
        else { d.x += tx / dist * step; d.y += ty / dist * step; d.z += tz / dist * step; }
      }
      W.placeDrone(d.mesh, d.x, d.y, d.z, d.state === 'dive' && d.target ? d.target : null, ox, oz);
    }
  }

  // Random pick among the 10 healthiest enemies in range, so drones spread out and favour tough targets.
  pickDroneTarget(range) {
    const r2 = range * range, pool = [];
    for (const e of this.sorted) { if (e.d2 > r2) break; if (!e.dead) pool.push(e); }
    if (!pool.length) return null;
    pool.sort((a, b) => b.hp - a.hp);
    return pool[Math.floor(Math.random() * Math.min(10, pool.length))];
  }

  droneStrike(t) {
    const s = this.stats;
    const x = t.x, y = t.y, z = t.z;
    this.world.droneImpact(x, y, z);
    sfx.play('drone');
    t.markT = 3;
    this.damageEnemy(t, s.droneDamage, { kind: 'drone' });
    if (s.droneSplash > 0) {
      for (const e of this.enemies) {
        if (e.dead || e === t) continue;
        const dx = e.x - x, dz = e.z - z;
        if (dx * dx + dz * dz < 5) { e.markT = Math.max(e.markT, 1.5); this.damageEnemy(e, s.droneDamage * s.droneSplash, { kind: 'drone', silent: true }); }
      }
    }
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
    if (e.markT > 0) d *= 1 + s.droneMark;
    if (e.boss || e.elite) d *= s.bossDmg;
    const hz = this.hz;
    if (hz.plated) d = Math.max(d * 0.15, d - e.maxHp * (e.boss ? 0.003 : 0.015));
    e.hitT = this.time;
    if (e.barrier > 0) {
      const a = Math.min(e.barrier, d);
      e.barrier -= a; d -= a;
      if (e.barrier <= 0) this.world.setEnemyMarks(e.mesh, { shield: false, regen: !!hz.regen, volatile: !!hz.volatile });
      if (d <= 0) { e.flash = 1; return a; }
    }
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
    if (e.child) { // Mitosis splits: no bounty, no kill credit
      sfx.play('die'); this.world.enemyDeath(e); this.releaseEnemy(e); return;
    }
    this.kills++;
    let c = e.def.cogs * waveCogMult(this.wave) * s.cogMult;
    if (e.elite) c *= 4;
    if (e.elite || e.boss) c *= 1 + s.bossBounty;
    if (e.markT > 0) c *= 1 + s.droneCogs;
    this.cogs += c;
    if (e.boss) {
      this.bossKills++;
      this.ui.hideBoss();
      this.ui.toast(`${e.def.name} destroyed! +15 ◈ bonus on extraction`);
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
    const hz = this.hz;
    if (hz.split && !e.boss && !e.child && e.key !== 'swarm') {
      for (let i = 0; i < 2; i++) {
        const a = Math.random() * Math.PI * 2;
        this.spawnEnemy('swarm', 0, 0, { x: e.x + Math.cos(a) * 0.6, z: e.z + Math.sin(a) * 0.6, hp: e.maxHp * 0.35 });
      }
    }
    if (hz.volatile && Math.hypot(e.x, e.z) < 8 + TOWER_RADIUS) {
      this.world.flash(_v.set(e.x, e.y, e.z), 2.2 + e.radius, COLORS.amber, 0.25);
      this.damageTower(e.dmg * 0.6 * (1 + this.siege), null);
    }
  }

  enemyAttack(e) {
    if (e.def.artillery) { this.fireShell(e); return; }
    if (e.def.ranged) {
      sfx.play('zap');
      this.world.lightning([new THREE.Vector3(e.x, e.y + 0.45, e.z), new THREE.Vector3(e.x * 0.25, 3, e.z * 0.25)], COLORS.red, 0.25, 0.15);
      this.damageTower(e.dmg * (1 + this.siege), null);
    } else {
      this.damageTower(e.dmg * (1 + this.siege), e);
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
      if (e.knockCd > 0) e.knockCd -= dt;
      if (e.markT > 0) e.markT -= dt;
      if (def.escort && !frozen && this.state === 'playing' && Math.hypot(e.x, e.z) < SPAWN_RADIUS) {
        e.escortT -= dt;
        if (e.escortT <= 0) {
          e.escortT = def.escort.every;
          const ek = def.escort.key, ehp = ENEMY_TYPES[ek].hp * waveHpMult(this.wave);
          for (let i = 0; i < def.escort.n; i++) {
            const a = Math.random() * Math.PI * 2;
            this.spawnEnemy(ek, 0, 0, { x: e.x + Math.cos(a) * 2, z: e.z + Math.sin(a) * 2, hp: ehp });
          }
          this.world.flash(_v.set(e.x, e.y + 1.5, e.z), 2.5, COLORS.magenta, 0.25);
          sfx.play('launch');
        }
      }
      if (this.hz.regen && e.hp < e.maxHp && this.time - e.hitT > 1) e.hp = Math.min(e.maxHp, e.hp + e.maxHp * 0.08 * dt);
      if (e.stunImm > 0) e.stunImm -= dt;
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

      // small tolerance: stepping exactly (dist - stop) while wobbling sideways can leave an enemy a
      // floating-point hair outside its stop distance forever, so it would never start attacking
      if (dist > stop + 0.05) {
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
