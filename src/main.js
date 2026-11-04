// Tower Inc. — bootstrap, screen flow, input and the main loop.
import { World } from './world.js';
import { UI } from './ui.js';
import { Game } from './game.js';
import { TreeView } from './treeview.js';
import { loadSave, writeSave, wipeSave, exportSave, parseSave } from './save.js';
import { buyNode, respec } from './skilltree.js';
import { fmt } from './util.js';
import { sfx } from './audio.js';

const $ = id => document.getElementById(id);

const save = loadSave();
const world = new World($('game'));
const ui = new UI(world);
const game = new Game(world, ui, save);

const tree = new TreeView($('tree-canvas'), $('tree-tip'), {
  getSave: () => save,
  onBuy: id => {
    if (!buyNode(save, id)) { sfx.play('deny'); return false; }
    sfx.play('treeBuy');
    writeSave(save);
    game.refreshMeta();
    $('tree-cores').textContent = fmt(save.cores);
    return true;
  },
});

let screen = 'menu';
let treeReturn = 'menu';

function setScreen(name) {
  screen = name;
  for (const id of ['menu', 'death', 'tree', 'esc-menu']) $(id).classList.toggle('hidden', id !== name);
  const playing = name === 'play' || name === 'esc-menu';
  $('hud').classList.toggle('hidden', !playing);
  $('shop').classList.toggle('hidden', !playing);
  world.controls.autoRotate = name === 'menu';
  if (name === 'tree') { tree.open(); $('tree-cores').textContent = fmt(save.cores); } else tree.close();
  if (name === 'menu') ui.renderMenu(save);
}

function startRun() {
  ui.clearNums();
  game.startRun();
  setSpeed(1);
  setScreen('play');
  ui.renderShop(game);
}

function setPaused(p) {
  game.paused = p;
  ui.setPaused(p && screen === 'play');
  $('pause-btn').classList.toggle('active', p);
}

function setSpeed(v) {
  game.speed = v;
  document.querySelectorAll('.speed [data-speed]').forEach(b => b.classList.toggle('active', Number(b.dataset.speed) === v));
  setPaused(false);
}

function openEscMenu() {
  if (screen !== 'play' || game.state !== 'playing') return;
  setPaused(true);
  setScreen('esc-menu');
  ui.setPaused(false);
}
function closeEscMenu() {
  setScreen('play');
  setPaused(false);
}

game.onDeath = info => {
  ui.renderDeath(info);
  setScreen('death');
};

// ── buttons ──
$('btn-start').onclick = startRun;
$('btn-retry').onclick = startRun;
$('btn-tree-deploy').onclick = startRun;
$('btn-tree-menu').onclick = () => { treeReturn = 'menu'; setScreen('tree'); };
$('btn-tree-death').onclick = () => { treeReturn = 'death'; setScreen('tree'); };
$('btn-tree-back').onclick = () => setScreen(treeReturn);
$('btn-menu').onclick = () => { game.toMenu(); setScreen('menu'); };
$('btn-resume').onclick = closeEscMenu;
$('btn-abandon').onclick = () => { setScreen('play'); setPaused(false); game.selfDestruct(); };
$('btn-respec').onclick = () => {
  if (!confirm('Refund every Skill Matrix node for its full core cost?')) return;
  respec(save); writeSave(save); game.refreshMeta();
  $('tree-cores').textContent = fmt(save.cores);
};
$('btn-export').onclick = () => exportSave(save);
$('btn-import').onclick = () => $('import-file').click();
$('import-file').onchange = async e => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  let imported;
  try {
    imported = parseSave(await file.text());
  } catch (err) {
    alert(`Couldn't import that file: ${err.message}`);
    return;
  }
  if (!confirm(`Replace your current progress with this save (best wave ${imported.bestWave}, ${fmt(imported.cores)} cores)?`)) return;
  writeSave(imported);
  location.reload();
};
$('btn-reset').onclick = () => {
  if (!confirm('Wipe all progress? This cannot be undone.')) return;
  wipeSave(); location.reload();
};

$('pause-btn').onclick = () => setPaused(!game.paused);
document.querySelectorAll('.speed [data-speed]').forEach(b => { b.onclick = () => setSpeed(Number(b.dataset.speed)); });

document.querySelectorAll('.tabs button').forEach(b => {
  b.onclick = () => {
    ui.tab = b.dataset.tab;
    document.querySelectorAll('.tabs button').forEach(x => x.classList.toggle('active', x === b));
    ui.renderShop(game);
  };
});
document.querySelectorAll('.buy-modes button').forEach(b => {
  b.onclick = () => {
    ui.mode = b.dataset.mode === 'max' ? 'max' : Number(b.dataset.mode);
    document.querySelectorAll('.buy-modes button').forEach(x => x.classList.toggle('active', x === b));
    ui.updateShop(game);
  };
});
$('shop-list').addEventListener('click', e => {
  const b = e.target.closest('.upg');
  if (!b) return;
  if (game.buyShop(b.dataset.id, ui.mode) > 0) { sfx.play('buy'); ui.flashBought(b.dataset.id); ui.updateShop(game); }
  else sfx.play('deny');
});

window.addEventListener('keydown', e => {
  if (e.repeat) return;
  if (e.key === 'm' || e.key === 'M') { toggleMute(); return; }
  if (screen === 'play' && game.state === 'playing') {
    if (e.code === 'Space') { e.preventDefault(); setPaused(!game.paused); }
    else if (e.key === '1') setSpeed(1);
    else if (e.key === '2') setSpeed(2);
    else if (e.key === '3') setSpeed(4);
    else if (e.key === 'Escape') openEscMenu();
  } else if (screen === 'esc-menu' && e.key === 'Escape') closeEscMenu();
  else if (screen === 'tree' && e.key === 'Escape') setScreen(treeReturn);
});

// ── sound ──
// Browsers only allow audio after a user gesture, so the context is created on first input.
window.addEventListener('pointerdown', () => sfx.unlock(), true);
window.addEventListener('keydown', () => sfx.unlock(), true);
function renderMute() {
  document.querySelectorAll('.btn-mute').forEach(b => {
    b.classList.toggle('active', !sfx.muted);
    if (b.classList.contains('small')) b.textContent = sfx.muted ? 'Sound: Off' : 'Sound: On';
    else b.textContent = sfx.muted ? '🔇' : '🔊';
  });
}
function toggleMute() { sfx.unlock(); sfx.setMuted(!sfx.muted); renderMute(); }
document.querySelectorAll('.btn-mute').forEach(b => { b.onclick = toggleMute; });
renderMute();
// generic click blip for menu buttons (workshop buttons have their own sounds)
document.addEventListener('click', e => {
  const b = e.target.closest('button');
  if (b && !b.classList.contains('upg') && !b.classList.contains('btn-mute')) sfx.play('click');
});

// ── main loop ──
let last = performance.now();
function frame(now) {
  const realDt = Math.min(0.1, (now - last) / 1000);
  last = now;
  const active = game.state === 'playing' || game.state === 'dying';
  const gdt = active ? (game.paused ? 0 : realDt * game.speed) : realDt;
  if (active && gdt > 0) {
    // fixed-ish substeps keep 4× speed stable
    let remaining = gdt, steps = 0;
    while (remaining > 1e-6 && steps++ < 10) {
      const d = Math.min(1 / 60, remaining);
      game.update(d);
      remaining -= d;
    }
  }
  sfx.setLaser(active && !game.paused && game.laserActive === true, game.laserPitch || 0);
  if (game.laserLocked) { game.laserLocked = false; sfx.laserLock(); }
  world.update(realDt, gdt, screen !== 'tree');
  ui.update(game, realDt);
  requestAnimationFrame(frame);
}

setScreen('menu');
requestAnimationFrame(frame);
