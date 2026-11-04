// Tower Inc. — DOM HUD: bars, resources, workshop, floating numbers, banners, end screens.
import { SHOP } from './config.js';
import { NODES } from './skilltree.js';
import { fmt } from './util.js';

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
      b.innerHTML = `<div class="u-top"><span class="u-name">${u.name}</span><span class="u-lvl"></span></div><div class="u-desc">${u.desc}</div><div class="u-cost"></div>`;
      this.shopList.appendChild(b);
      this.items.push({ u, b, lvl: b.querySelector('.u-lvl'), cost: b.querySelector('.u-cost') });
    }
    this.updateShop(game);
  }

  updateShop(game) {
    const s = game.stats;
    for (const it of this.items) {
      const { u, b } = it;
      const lvl = game.shop[u.id] || 0, max = u.max ?? Infinity;
      if (u.req && !s[u.req]) {
        b.className = 'upg locked'; it.lvl.textContent = ''; it.cost.textContent = '🔒 ' + u.lockText;
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

  showBoss(e) { this.boss = e; this.bossBar.classList.remove('hidden'); }
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
    const owned = NODES.filter(n => n.id !== 'core' && (save.tree[n.id] || 0) > 0).length;
    $('menu-stats').innerHTML = `
      <div>Best wave<b>${save.bestWave}</b></div>
      <div>Aether cores<b style="color:var(--cyan)">${fmt(save.cores)} ◈</b></div>
      <div>Matrix nodes<b>${owned}/${NODES.length - 1}</b></div>
      <div>Shifts worked<b>${save.runs}</b></div>`;
    $('btn-start').textContent = save.runs ? 'Begin Shift' : 'Begin First Shift';
  }

  renderDeath(info) {
    const m = Math.floor(info.time / 60), s = Math.floor(info.time % 60);
    $('death-stats').innerHTML = `
      <div class="ds-row"><span>Wave reached</span><b>${info.wave}${info.newBest ? '<em>NEW RECORD</em>' : ''}</b></div>
      <div class="ds-row"><span>Enemies scrapped</span><b>${fmt(info.kills)}</b></div>
      <div class="ds-row"><span>Leviathans felled</span><b>${info.bosses}</b></div>
      <div class="ds-row"><span>Shift length</span><b>${m}:${String(s).padStart(2, '0')}</b></div>
      ${info.siphoned ? `<div class="ds-row"><span>Cores siphoned mid-shift</span><b>+${fmt(info.siphoned)} ◈</b></div>` : ''}
      <div class="ds-row big"><span>Aether cores extracted</span><b>+${fmt(info.earned)} ◈</b></div>`;
  }
}
