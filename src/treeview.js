// Tower Inc. — interactive Skill Matrix rendered on a 2D canvas (pan, zoom, hover, buy).
import { NODES, NODE_MAP, BRANCHES, SPACING, nodeCost, nodeState, ocLevel, canOverclock, nodeGated } from './skilltree.js';

// effect text at fractional-free but large levels can produce float noise (e.g. 8.800000001)
const tidy = t => t.replace(/\d+\.\d{3,}/g, m => String(Math.round(+m * 10) / 10));
import { fmt } from './util.js';

const TAU = Math.PI * 2;

function hexPath(g, r) {
  g.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = Math.PI / 6 + i * Math.PI / 3;
    if (i === 0) g.moveTo(Math.cos(a) * r, Math.sin(a) * r); else g.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  g.closePath();
}

export class TreeView {
  constructor(canvas, tip, opts) {
    this.c = canvas; this.g = canvas.getContext('2d'); this.tip = tip; this.opts = opts;
    this.zoom = 0.7; this.px = 0; this.py = 0;
    this.hover = null; this.running = false; this.drag = null; this.pops = []; this.t = 0;
    this.mx = -1e4; this.my = -1e4;

    canvas.addEventListener('pointerdown', e => {
      this.drag = { x: e.clientX, y: e.clientY, px: this.px, py: this.py, moved: 0 };
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointermove', e => {
      this.mx = e.clientX; this.my = e.clientY;
      if (this.drag) {
        const dx = e.clientX - this.drag.x, dy = e.clientY - this.drag.y;
        this.drag.moved = Math.max(this.drag.moved, Math.hypot(dx, dy));
        if (this.drag.moved > 5) { this.px = this.drag.px + dx; this.py = this.drag.py + dy; }
      }
      this.updateHover();
    });
    canvas.addEventListener('pointerup', e => {
      const d = this.drag; this.drag = null;
      this.mx = e.clientX; this.my = e.clientY;
      if (d && d.moved <= 5) { this.updateHover(); if (this.hover) this.tryBuy(this.hover); }
    });
    canvas.addEventListener('pointerleave', () => { if (!this.drag) { this.hover = null; this.tip.classList.add('hidden'); } });
    canvas.addEventListener('wheel', e => {
      e.preventDefault();
      const nz = Math.min(2.2, Math.max(0.25, this.zoom * Math.exp(-e.deltaY * 0.0012)));
      const cx = e.clientX - this.W / 2 - this.px, cy = e.clientY - this.H / 2 - this.py;
      this.px -= cx * (nz / this.zoom - 1); this.py -= cy * (nz / this.zoom - 1);
      this.zoom = nz;
      this.updateHover();
    }, { passive: false });
    window.addEventListener('resize', () => { if (this.running) this.resize(); });
  }

  open() {
    this.running = true;
    this.resize();
    // fit the whole visible matrix (unlocked prototype clusters sit outside the outer ring)
    const fitR = Math.max(SPACING * 8.75, ...NODES.filter(n => !nodeGated(n)).map(n => Math.hypot(n.x, n.y) + SPACING));
    this.zoom = Math.min(1, Math.min(this.W, this.H) / (fitR * 2));
    this.px = 0; this.py = 10;
    this.hover = null; this.tip.classList.add('hidden');
    this.renderLegend();
    const loop = () => { if (!this.running) return; this.draw(); requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  }

  close() { this.running = false; this.tip.classList.add('hidden'); }

  resize() {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.W = window.innerWidth; this.H = window.innerHeight;
    this.c.width = this.W * this.dpr; this.c.height = this.H * this.dpr;
  }

  renderLegend() {
    const el = document.getElementById('tree-legend');
    el.innerHTML = Object.entries(BRANCHES).filter(([k, b]) => k !== 'core' && !(b.gate && NODES.every(n => n.branch !== k || nodeGated(n))))
      .map(([, b]) => `<div><i style="background:${b.color}"></i>${b.name}</div>`).join('');
  }

  toWorld(x, y) { return [(x - this.W / 2 - this.px) / this.zoom, (y - this.H / 2 - this.py) / this.zoom]; }

  updateHover() {
    if (!this.running) return;
    const [wx, wy] = this.toWorld(this.mx, this.my);
    let hit = null;
    for (const n of NODES) if (!nodeGated(n) && Math.hypot(n.x - wx, n.y - wy) < n.size + 5) { hit = n; break; }
    this.hover = hit;
    if (!hit) { this.tip.classList.add('hidden'); return; }
    this.renderTip(hit);
    this.tip.classList.remove('hidden');
    const tw = this.tip.offsetWidth, th = this.tip.offsetHeight;
    let left = this.mx + 18, top = this.my + 18;
    if (left + tw > this.W - 8) left = this.mx - tw - 18;
    if (top + th > this.H - 8) top = this.H - th - 8;
    this.tip.style.left = Math.max(8, left) + 'px';
    this.tip.style.top = Math.max(8, top) + 'px';
  }

  renderTip(n) {
    const save = this.opts.getSave();
    const lvl = save.tree[n.id] || 0, b = BRANCHES[n.branch], st = nodeState(n, save.tree);
    const oc = ocLevel(n, save.tree), canOc = canOverclock(n, save.tree);
    let h = `<div class="tt-name" style="color:${b.color}">${n.name}</div>`;
    h += `<div class="tt-sub">${b.name}${n.cap ? ' · Capstone' : ''} · Lv ${Math.min(lvl, n.max)}/${n.max}${oc ? ` · <span class="tt-oc">Overclock +${oc}</span>` : ''}</div>`;
    if (n.desc) h += `<div class="tt-desc">${n.desc}</div>`;
    if (n.id !== 'core') {
      if (lvl > 0) h += `<div class="tt-eff"><span>Current</span>${tidy(n.eff(lvl))}</div>`;
      if (lvl < n.max || canOc) h += `<div class="tt-eff next"><span>${lvl >= n.max ? 'Overclock' : lvl ? 'Next' : 'Grants'}</span>${tidy(n.eff(lvl + 1))}</div>`;
    }
    if (canOc) {
      const cost = nodeCost(n, lvl), ok = save.cores >= cost;
      h += `<div class="tt-status ${ok ? 'oc' : 'no'}">◈ ${fmt(cost)} — ${ok ? 'click to overclock' : 'insufficient cores'}</div>`;
    } else if (st === 'max') h += `<div class="tt-status max">${n.id === 'core' ? 'ONLINE' : 'MAXED'}</div>`;
    else if (st === 'locked') h += `<div class="tt-status lock">Requires: ${n.req.map(id => NODE_MAP[id].name).join(' or ')}</div>`;
    else {
      const cost = nodeCost(n, lvl), ok = save.cores >= cost;
      h += `<div class="tt-status ${ok ? 'ok' : 'no'}">◈ ${fmt(cost)} — ${ok ? 'click to install' : 'insufficient cores'}</div>`;
    }
    this.tip.innerHTML = h;
  }

  // flash a set of nodes (after an Auto-Install)
  popMany(ids) {
    for (const id of ids) { const n = NODE_MAP[id]; this.pops.push({ x: n.x, y: n.y, t: 0, color: BRANCHES[n.branch].color, r: n.size }); }
  }

  tryBuy(n) {
    if (this.opts.onBuy(n.id)) {
      this.pops.push({ x: n.x, y: n.y, t: 0, color: BRANCHES[n.branch].color, r: n.size });
    } else {
      this.pops.push({ x: n.x, y: n.y, t: 0, color: '#ff3355', r: n.size, deny: true });
    }
    this.renderTip(n);
  }

  draw() {
    this.t += 1 / 60;
    const g = this.g, W = this.W, H = this.H, save = this.opts.getSave(), z = this.zoom;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const cx = W / 2 + this.px, cy = H / 2 + this.py;
    const bg = g.createRadialGradient(cx, cy, 0, cx, cy, Math.max(W, H) * 0.9);
    bg.addColorStop(0, '#1b1030'); bg.addColorStop(1, '#05040b');
    g.fillStyle = bg; g.fillRect(0, 0, W, H);

    g.save();
    g.translate(cx, cy); g.scale(z, z);

    // guide rings + slow-turning gear teeth on the outer rim
    for (let d = 1; d <= 7; d++) {
      g.strokeStyle = `rgba(201,149,63,${d === 7 ? 0.14 : 0.05})`; g.lineWidth = 1 / z;
      g.beginPath(); g.arc(0, 0, d * SPACING, 0, TAU); g.stroke();
    }
    g.save(); g.rotate(this.t * 0.02);
    g.strokeStyle = 'rgba(201,149,63,0.1)'; g.lineWidth = 10;
    g.setLineDash([14, 18]); g.beginPath(); g.arc(0, 0, SPACING * 7.6, 0, TAU); g.stroke();
    g.restore(); g.setLineDash([]);

    // branch titles
    g.textAlign = 'center'; g.textBaseline = 'middle';
    for (const [k, b] of Object.entries(BRANCHES)) {
      if (k === 'core' || k === 'syn') continue;
      if (b.gate && NODES.some(n => n.branch === k && nodeGated(n))) continue;
      const a = b.angle * Math.PI / 180, dist = b.gate ? 12.1 : 8.3;
      g.fillStyle = b.color; g.globalAlpha = 0.45;
      g.font = '900 30px Orbitron, sans-serif';
      g.fillText(b.name.toUpperCase(), Math.cos(a) * SPACING * dist, Math.sin(a) * SPACING * dist);
    }
    g.globalAlpha = 1;

    // connections
    for (const n of NODES) {
      if (nodeGated(n)) continue;
      const col = BRANCHES[n.branch].color, lo = (save.tree[n.id] || 0) > 0;
      for (const rid of n.req) {
        const r = NODE_MAP[rid], lr = (save.tree[rid] || 0) > 0;
        g.beginPath(); g.moveTo(r.x, r.y); g.lineTo(n.x, n.y);
        if (lo && lr) {
          g.strokeStyle = col; g.globalAlpha = 0.35; g.lineWidth = 5; g.stroke();
          g.globalAlpha = 0.95; g.lineWidth = 2.5; g.setLineDash([10, 10]); g.lineDashOffset = -this.t * 40; g.stroke(); g.setLineDash([]);
        } else if (lr) {
          g.strokeStyle = col; g.globalAlpha = 0.3; g.lineWidth = 2.5; g.stroke();
        } else {
          g.strokeStyle = '#ffffff'; g.globalAlpha = 0.06; g.lineWidth = 2; g.stroke();
        }
      }
    }
    g.globalAlpha = 1;

    for (const n of NODES) if (!nodeGated(n)) this.drawNode(g, n, save);

    // purchase / denial pops
    for (let i = this.pops.length - 1; i >= 0; i--) {
      const p = this.pops[i];
      p.t += 1 / 60;
      const k = p.t / 0.5;
      if (k >= 1) { this.pops.splice(i, 1); continue; }
      g.save(); g.translate(p.x + (p.deny ? Math.sin(k * 40) * 4 * (1 - k) : 0), p.y);
      hexPath(g, p.r + (p.deny ? 4 : 4 + k * 30));
      g.strokeStyle = p.color; g.globalAlpha = 1 - k; g.lineWidth = 3; g.stroke();
      g.restore();
    }
    g.restore();
  }

  drawNode(g, n, save) {
    const lvl = save.tree[n.id] || 0, col = BRANCHES[n.branch].color, st = nodeState(n, save.tree), r = n.size;
    const afford = (st === 'avail' || st === 'owned') && save.cores >= nodeCost(n, lvl);
    const oc = ocLevel(n, save.tree), ocAfford = canOverclock(n, save.tree) && save.cores >= nodeCost(n, lvl);
    g.save(); g.translate(n.x, n.y);

    hexPath(g, r);
    if (st === 'max') {
      g.shadowColor = col; g.shadowBlur = 22; g.fillStyle = col; g.fill(); g.shadowBlur = 0;
      g.fillStyle = 'rgba(10,6,18,0.55)'; hexPath(g, r * 0.8); g.fill();
      hexPath(g, r); g.strokeStyle = '#fff6'; g.lineWidth = 1.5; g.stroke();
      if (oc > 0 || ocAfford) { // overclock ring: rotating dashes, pulsing while one is affordable
        g.save(); g.rotate(this.t * 0.8);
        g.beginPath(); g.arc(0, 0, r + 8, 0, TAU);
        g.setLineDash([5, 6]); g.strokeStyle = '#fff2c0';
        g.globalAlpha = ocAfford ? 0.55 + 0.45 * Math.sin(this.t * 4) : 0.35; g.lineWidth = 2;
        if (ocAfford) { g.shadowColor = '#fff2c0'; g.shadowBlur = 12; }
        g.stroke(); g.restore();
      }
    } else if (st === 'owned') {
      g.fillStyle = '#1c1428'; g.fill(); g.strokeStyle = col; g.lineWidth = 3; g.stroke();
      g.beginPath(); g.arc(0, 0, r + 7, -Math.PI / 2, -Math.PI / 2 + TAU * lvl / n.max);
      g.strokeStyle = col; g.lineWidth = 3; g.stroke();
    } else if (st === 'avail') {
      g.fillStyle = '#130e1d'; g.fill();
      const pulse = afford ? 0.65 + 0.35 * Math.sin(this.t * 4) : 0.4;
      g.strokeStyle = col; g.globalAlpha = pulse; g.lineWidth = 2.5;
      if (afford) { g.shadowColor = col; g.shadowBlur = 16 * pulse; }
      g.stroke(); g.shadowBlur = 0; g.globalAlpha = 1;
    } else {
      g.fillStyle = '#0d0b14'; g.fill(); g.strokeStyle = '#2f2a3d'; g.lineWidth = 2; g.stroke();
    }
    if (n.cap) {
      hexPath(g, r + 9);
      g.strokeStyle = col; g.globalAlpha = st === 'locked' ? 0.18 : 0.7; g.lineWidth = 1.5; g.stroke(); g.globalAlpha = 1;
    }
    if (this.hover === n) { hexPath(g, r + 4); g.strokeStyle = '#ffffff'; g.lineWidth = 2; g.stroke(); }

    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = st === 'locked' ? '#4a4458' : st === 'max' ? '#ffffff' : col;
    g.font = `${Math.round(r * 0.9)}px "Apple Symbols", "Segoe UI Symbol", "Noto Sans Symbols 2", "DejaVu Sans", sans-serif`;
    g.fillText(n.icon + '︎', 0, 1);
    if (n.id !== 'core') {
      g.font = '12px "Share Tech Mono", monospace';
      g.fillStyle = st === 'locked' ? '#5a5468' : st === 'max' ? col : '#e8e2c8';
      g.fillText(st === 'max' && n.max === 1 ? 'ONLINE' : `${Math.min(lvl, n.max)}/${n.max}${oc ? ` +${oc}` : ''}`, 0, r + (n.cap ? 22 : 17));
    }
    g.restore();
  }
}
