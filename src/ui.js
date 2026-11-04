// Tower Inc. — DOM HUD: bars, resources, workshop, floating numbers, banners, end screens.
import { SHOP, shopLock } from './config.js';
import { NODES, nodeGated } from './skilltree.js';
import { fmt } from './util.js';
import { CHALLENGES, challengesUnlocked } from './challenges.js';
import { FOUNDRY, FOUNDRY_GROUPS, foundryCost, blueprintsFor, startWaveFor, BP_MIN_WAVE, HAZARDS, hazardBonus, hazardsUnlocked } from './foundry.js';

const $ = id => document.getElementById(id);

export class UI {
  constructor(world) {
    this.world = world;
    this.hpBar = document.querySelector('.bar.hp');
    this.hpFill = $('hp-fill'); this.hpText = $('hp-text');
    this.shBar = $('shield-bar'); this.shFill = $('shield-fill'); this.shText = $('shield-text');
    this.waveNum = $('wave-num'); this.waveFill = $('wave-fill');
    this.cogsEl = $('cogs'); this.coresEl = $('cores'); this.killsEl = $('kills');
    this.bossBar = $('boss-bar'); this.bossFill = $('boss-fill');
    this.bannerEl = $('banner'); this.toasts = $('toasts'); this.vig = $('vignette');
    this.shopList = $('shop-list'); this.statGrid = $('stat-grid'); this.pauseTag = $('pause-tag');

    this.tab = 'atk'; this.mode = 1;
    this.hurtV = 0; this.boss = null; this.shopT = 0; this.items = [];
    this.bannerTimer = null;

    this.layer = $('dmg-layer'); this.pool = []; this.nums = [];
    for (let i = 0; i < 90; i++) {
      const d = document.createElement('div');
      d.className = 'dmg'; d.style.display = 'none';
      this.layer.appendChild(d); this.pool.push(d);
    }

    this.statDefs = [
      ['DMG', s => fmt(s.damage)], ['RATE', s => s.fireRate.toFixed(2) + '/s'],
      ['RANGE', s => s.range.toFixed(1)], ['CRIT', s => `${Math.round(s.critChance * 100)}% ×${s.critMult.toFixed(2)}`],
      ['HP', s => fmt(s.maxHp)], ['REGEN', s => fmt(s.regen) + '/s'],
      ['DEF', s => Math.round(s.totalDR * 100) + '%'], ['SHIELD', s => fmt(s.shieldMax)],
    ];
    this.statCells = this.statDefs.map(([label]) => {
      const d = document.createElement('div');
      d.innerHTML = `<span>${label}</span><b></b>`;
      this.statGrid.appendChild(d);
      return d.querySelector('b');
    });
  }

  // ───────────────────────────── workshop ─────────────────────────────
  renderShop(game) {
    this.shopList.innerHTML = ''; this.items = [];
    for (const u of SHOP.filter(x => x.tab === this.tab)) {
      const b = document.createElement('button');
      b.className = 'upg'; b.dataset.id = u.id;
      b.innerHTML = `<div class="u-top"><span class="u-name">${u.name}</span><span class="u-right"><span class="u-auto" title="Let the Clockwork Clerk buy this">AUTO</span><span class="u-lvl"></span></span></div><div class="u-desc">${u.desc}</div><div class="u-cost"></div>`;
      this.shopList.appendChild(b);
      this.items.push({ u, b, lvl: b.querySelector('.u-lvl'), cost: b.querySelector('.u-cost'), auto: b.querySelector('.u-auto') });
    }
    this.updateShop(game);
  }

  updateShop(game) {
    const s = game.stats, ab = game.save.autobuy;
    this.updateAutoBar(s, ab);
    const showAuto = s.autoBuy > 0 && ab.mode === 'selected';
    for (const it of this.items) {
      const { u, b } = it;
      const lvl = game.shop[u.id] || 0, max = u.max ?? Infinity;
      const lock = shopLock(u, s);
      it.auto.classList.toggle('hidden', !showAuto || !!lock);
      it.auto.classList.toggle('on', !!ab.sel[u.id]);
      if (lock) {
        b.className = 'upg locked'; it.lvl.textContent = ''; it.cost.textContent = '🔒 ' + lock;
        continue;
      }
      it.lvl.textContent = max === Infinity ? `Lv ${lvl}` : `Lv ${lvl}/${max}`;
      if (lvl >= max) { b.className = 'upg maxed'; it.cost.textContent = 'MAXED'; continue; }
      const { n, cost } = game.previewBuy(u, this.mode);
      it.cost.textContent = `⚙ ${fmt(cost)}${this.mode !== 1 ? ` ×${n}` : ''}`;
      const afford = n > 0 && game.cogs >= cost;
      const cls = 'upg' + (afford ? ' afford' : '') + (b.classList.contains('bought') ? ' bought' : '');
      if (b.className !== cls) b.className = cls;
    }
    this.statDefs.forEach(([, f], i) => { this.statCells[i].textContent = f(s); });
  }

  updateAutoBar(s, ab) {
    const bar = document.getElementById('auto-bar');
    bar.classList.toggle('hidden', !(s.autoBuy > 0));
    if (!(s.autoBuy > 0)) return;
    bar.querySelectorAll('[data-auto-mode]').forEach(b => b.classList.toggle('active', b.dataset.autoMode === ab.mode));
    document.getElementById('auto-rate').textContent = ab.mode === 'off' ? '' : `every ${s.autoInterval.toFixed(1)}s`;
  }

  flashBought(id) {
    const it = this.items.find(x => x.u.id === id);
    if (!it) return;
    it.b.classList.remove('bought'); void it.b.offsetWidth; it.b.classList.add('bought');
    setTimeout(() => it.b.classList.remove('bought'), 320);
  }

  // ───────────────────────────── floating numbers ─────────────────────────────
  damageNumber(x, y, z, amount, crit, kind) {
    if (amount < 0.05) return;
    this.spawnText(x, y, z, fmt(amount) + (crit ? '!' : ''), (crit ? ' crit' : '') + (kind ? ' ' + kind : ''), crit ? 1.0 : 0.75, crit);
  }

  floatText(x, y, z, text, kind) { this.spawnText(x, y, z, text, ' ' + kind, 1.4, true); }

  spawnText(x, y, z, text, cls, dur, important) {
    let el = this.pool.pop();
    if (!el) {
      if (!important) return;
      const old = this.nums.shift(); el = old.el;
    }
    el.textContent = text;
    el.className = 'dmg' + cls;
    el.style.display = 'block';
    this.nums.push({ el, x, y, z, t: 0, dur, dx: (Math.random() - 0.5) * 30 });
  }

  updateNums(dt) {
    for (let i = this.nums.length - 1; i >= 0; i--) {
      const n = this.nums[i];
      n.t += dt;
      const k = n.t / n.dur;
      if (k >= 1) { n.el.style.display = 'none'; this.pool.push(n.el); this.nums.splice(i, 1); continue; }
      const p = this.world.project(n.x, n.y, n.z);
      if (!p.visible) { n.el.style.opacity = 0; continue; }
      const sc = k < 0.15 ? 0.6 + k / 0.15 * 0.6 : 1.2 - (k - 0.15) * 0.35;
      n.el.style.transform = `translate(${p.x + n.dx * k}px, ${p.y - k * 45}px) translate(-50%, -50%) scale(${sc})`;
      n.el.style.opacity = k > 0.6 ? (1 - k) / 0.4 : 1;
    }
  }

  clearNums() {
    for (const n of this.nums) { n.el.style.display = 'none'; this.pool.push(n.el); }
    this.nums = [];
  }

  // ───────────────────────────── feedback ─────────────────────────────
  banner(title, sub = '', alert = false) {
    const b = this.bannerEl;
    b.innerHTML = `<div class="b-title">${title}</div>${sub ? `<div class="b-sub">${sub}</div>` : ''}`;
    b.className = alert ? 'alert' : '';
    void b.offsetWidth;
    b.classList.add('show');
  }

  toast(msg) {
    const t = document.createElement('div');
    t.className = 'toast'; t.textContent = msg;
    this.toasts.appendChild(t);
    while (this.toasts.children.length > 4) this.toasts.firstChild.remove();
    setTimeout(() => t.remove(), 3300);
  }

  hurt(frac) { this.hurtV = Math.min(0.8, this.hurtV + 0.06 + frac * 3); }

  showBoss(e) {
    this.boss = e; this.bossBar.classList.remove('hidden');
    this.bossBar.querySelector('.boss-name').textContent = `⚠ ${e.def.title || e.def.name}`;
  }
  hideBoss() { this.boss = null; this.bossBar.classList.add('hidden'); }

  setPaused(p) { this.pauseTag.classList.toggle('hidden', !p); }

  // ───────────────────────────── per frame ─────────────────────────────
  update(game, dt) {
    this.updateNums(dt);
    this.hurtV = Math.max(0, this.hurtV - dt * 2.5);
    this.vig.style.opacity = this.hurtV;
    if (game.state !== 'playing' && game.state !== 'dying') return;

    const s = game.stats;
    this.waveNum.textContent = game.wave;
    const ch = game.challenge, tag = $('chal-tag');
    tag.classList.toggle('hidden', !ch);
    if (ch) {
      const next = ch.tiers[game.chTier];
      const txt = `${ch.icon}︎ ${ch.name} · ${'★'.repeat(game.chTier)}${'☆'.repeat(ch.tiers.length - game.chTier)}${next ? ` · next: survive wave ${next}` : ' · complete'}`;
      if (tag.textContent !== txt) tag.textContent = txt;
    }
    const hpf = Math.max(0, game.hp / s.maxHp);
    this.hpFill.style.width = (hpf * 100) + '%';
    this.hpText.textContent = `${fmt(Math.max(0, game.hp))} / ${fmt(s.maxHp)}`;
    this.hpBar.classList.toggle('low', hpf < 0.3);
    this.shBar.classList.toggle('hidden', !(s.shieldMax > 0));
    if (s.shieldMax > 0) {
      this.shFill.style.width = (game.shield / s.shieldMax * 100) + '%';
      this.shText.textContent = `${fmt(game.shield)} / ${fmt(s.shieldMax)}`;
    }
    this.waveFill.style.width = (game.inWave ? Math.min(1, game.waveTimer / game.waveDur) * 100 : 100) + '%';
    this.cogsEl.textContent = fmt(game.cogs);
    this.coresEl.textContent = fmt(game.save.cores);
    this.killsEl.textContent = fmt(game.kills);
    if (this.boss) {
      if (this.boss.dead) this.hideBoss();
      else this.bossFill.style.width = (Math.max(0, this.boss.hp / this.boss.maxHp) * 100) + '%';
    }

    this.shopT -= dt;
    if (this.shopT <= 0) { this.shopT = 0.15; this.updateShop(game); }
  }

  // ───────────────────────────── screens ─────────────────────────────
  renderMenu(save) {
    const visible = NODES.filter(n => n.id !== 'core' && !nodeGated(n));
    const owned = visible.filter(n => (save.tree[n.id] || 0) > 0).length;
    const pres = save.reforges > 0 || save.blueprints > 0;
    $('menu-stats').innerHTML = `
      <div>Best wave<b>${save.bestWave}</b></div>
      ${pres ? `<div>Best ever<b>${save.bestEver}</b></div>` : ''}
      <div>Aether cores<b style="color:var(--cyan)">${fmt(save.cores)} ◈</b></div>
      ${pres ? `<div>Blueprints<b style="color:var(--bp)">${fmt(save.blueprints)} ✎</b></div>` : ''}
      <div>Matrix nodes<b>${owned}/${visible.length}</b></div>
      ${pres ? `<div>Reforges<b>${save.reforges}</b></div>` : ''}
      ${save.reforges > 0 && hazardBonus(save.hazards) > 0 ? `<div>Contracts<b style="color:#ff8a3d">+${Math.round(hazardBonus(save.hazards) * 100)}%</b></div>` : ''}
      <div>Shifts worked<b>${save.runs}</b></div>`;
    const sw = startWaveFor(save);
    $('btn-start').textContent = !save.runs ? 'Begin First Shift' : sw > 1 ? `Begin Shift · Wave ${sw}` : 'Begin Shift';
  }

  // ───────────────────────────── foundry ─────────────────────────────
  renderFoundry(save) {
    $('f-bp').textContent = fmt(save.blueprints);
    const bp = blueprintsFor(save);
    $('rf-info').innerHTML = bp > 0
      ? `Best wave this cycle <b>${save.bestWave}</b> → Reforge now for <b>+${fmt(bp)} ✎</b>`
      : `<span class="no">Reach wave ${BP_MIN_WAVE} or deeper to earn Blueprints (best this cycle: ${save.bestWave}).</span>`;
    $('btn-reforge').disabled = bp <= 0;
    const chOn = challengesUnlocked(save);
    $('challenges').classList.toggle('hidden', !chOn);
    if (chOn) {
      $('ch-list').innerHTML = CHALLENGES.map(c => {
        const t = save.challenges[c.id] || 0;
        const stars = c.tiers.map((w, i) => `<span class="${i < t ? 'on' : ''}" title="Survive wave ${w}">★<i>${w}</i></span>`).join('');
        return `<div class="ch${t >= c.tiers.length ? ' done' : ''}">
          <div class="ch-head"><span class="ch-ico">${c.icon}︎</span><span class="ch-name">${c.name}</span><span class="ch-stars">${stars}</span></div>
          <div class="ch-rule">${c.rule}</div>
          <div class="ch-rew">${t ? `<span>Reward</span> ${c.reward(t)}` : ''}${t < c.tiers.length ? ` <i>→ ${c.reward(t + 1)} at wave ${c.tiers[t]}</i>` : ' <b>COMPLETE</b>'}</div>
          <button class="small ch-go" data-ch="${c.id}">${t >= c.tiers.length ? 'Replay' : 'Start'} ▶</button>
        </div>`;
      }).join('');
    }
    const hzOn = hazardsUnlocked(save);
    $('hazards').classList.toggle('hidden', !hzOn);
    if (hzOn) {
      const tot = hazardBonus(save.hazards);
      $('hz-total').innerHTML = tot > 0 ? `+${Math.round(tot * 100)}% cores &amp; Blueprints` : 'No contracts signed';
      $('hz-list').innerHTML = HAZARDS.map(h => `
        <button class="hz${save.hazards[h.id] ? ' on' : ''}" data-hz="${h.id}">
          <span class="hz-ico">${h.icon}︎</span>
          <span class="hz-name">${h.name}<b>+${Math.round(h.bonus * 100)}%</b></span>
          <span class="hz-desc">${h.desc}</span>
        </button>`).join('');
    }
    const wrap = $('foundry-groups');
    wrap.innerHTML = '';
    for (const g of FOUNDRY_GROUPS) {
      const col = document.createElement('div');
      col.className = 'f-group panel';
      col.innerHTML = `<h3 style="color:${g.color}">${g.name}</h3>`;
      for (const f of FOUNDRY.filter(x => x.group === g.id)) {
        const lvl = save.foundry[f.id] || 0, maxed = lvl >= f.max, cost = foundryCost(f, lvl);
        const b = document.createElement('button');
        b.className = 'f-node' + (maxed ? ' maxed' : save.blueprints >= cost ? ' afford' : '');
        b.dataset.id = f.id; b.style.setProperty('--gc', g.color);
        b.innerHTML = `<span class="f-ico">${f.icon}︎</span>
          <span class="f-name">${f.name}<span class="f-lvl">${lvl}/${f.max}</span></span>
          <span class="f-eff">${lvl ? f.eff(lvl) : '—'}${maxed ? '' : ` <i>→ ${f.eff(lvl + 1)}</i>`}</span>
          ${f.desc ? `<span class="f-desc">${f.desc}</span>` : ''}
          <span class="f-cost">${maxed ? 'MAXED' : `✎ ${fmt(cost)}`}</span>`;
        col.appendChild(b);
      }
      wrap.appendChild(col);
    }
  }

  popFoundry(id) {
    const b = document.querySelector(`.f-node[data-id="${id}"]`);
    if (b) { b.classList.remove('pop'); void b.offsetWidth; b.classList.add('pop'); }
  }

  renderDeath(info) {
    const m = Math.floor(info.time / 60), s = Math.floor(info.time % 60);
    $('death-stats').innerHTML = `
      <div class="ds-row"><span>Wave reached</span><b>${info.wave}${info.newBest ? '<em>NEW RECORD</em>' : ''}</b></div>
      <div class="ds-row"><span>Enemies scrapped</span><b>${fmt(info.kills)}</b></div>
      <div class="ds-row"><span>Leviathans felled</span><b>${info.bosses}</b></div>
      <div class="ds-row"><span>Shift length</span><b>${m}:${String(s).padStart(2, '0')}</b></div>
      ${info.siphoned ? `<div class="ds-row"><span>Cores siphoned mid-shift</span><b>+${fmt(info.siphoned)} ◈</b></div>` : ''}
      <div class="ds-row big"><span>Aether cores extracted</span><b>+${fmt(info.earned)} ◈</b></div>
      ${info.challenge ? `<div class="ds-row"><span>Challenge · ${info.challenge.name}</span><b style="color:#7df9ff">${'★'.repeat(info.chTier)}${'☆'.repeat(info.challenge.tiers.length - info.chTier)}</b></div>` : ''}
      ${info.hazardBonus > 0 ? `<div class="ds-row"><span>Hazard contracts</span><b style="color:#ff8a3d">+${Math.round(info.hazardBonus * 100)}%</b></div>` : ''}
      ${info.reforgeBp > 0 ? `<div class="ds-row"><span>Reforge value (The Foundry)</span><b style="color:var(--bp)">${fmt(info.reforgeBp)} ✎</b></div>` : ''}`;
  }
}
