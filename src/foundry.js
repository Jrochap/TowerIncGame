// Tower Inc. — the Foundry: prestige layer. Reforging wipes cores, the Skill Matrix and the best
// wave in exchange for Blueprints, which buy permanent upgrades here.
import { NODES, setTreeMods } from './skilltree.js';

export const FOUNDRY_GROUPS = [
  { id: 'prog', name: 'Acceleration', color: '#ffc94d' },
  { id: 'build', name: 'Reconstruction', color: '#4dabff' },
  { id: 'power', name: 'Hardening', color: '#ff4d6d' },
];

// apply(stats, level) runs after the Skill Matrix and before the Workshop.
// meta(m, level) writes values read outside stats (tree prices, run setup, Reforge rewards).
const fmtX = v => v < 10 ? v.toFixed(2) : v < 100 ? v.toFixed(1) : Math.round(v).toString();

export const FOUNDRY = [
  { id: 'f_cores', group: 'prog', icon: '◈', name: 'Aether Condenser', max: 20, cost: 2, g: 1.45,
    eff: l => `+${25 * l}% Aether cores`, apply: (s, l) => { s.coreMult *= 1 + 0.25 * l; } },
  { id: 'f_bp', group: 'prog', icon: '✎', name: 'Blueprint Press', max: 10, cost: 4, g: 1.6,
    eff: l => `+${10 * l}% Blueprints from Reforging`, meta: (m, l) => { m.bpMult *= 1 + 0.1 * l; } },
  { id: 'f_start', group: 'prog', icon: '⏫', name: 'Express Elevator', max: 5, cost: 5, g: 2.2,
    desc: 'Runs begin at a later wave with the cogs those waves would have paid. Never deeper than half your best wave since the last Reforge.',
    eff: l => `Start at wave ${10 * l}`, meta: (m, l) => { m.startWave = 10 * l; } },
  { id: 'f_kits', group: 'prog', icon: '⚒', name: 'Pre-Installed Kits', max: 5, cost: 3, g: 1.8,
    eff: l => `Every Workshop upgrade starts at Lv ${2 * l}`, apply: (s, l) => { s.kitLevel = 2 * l; } },
  { id: 'f_cogs', group: 'prog', icon: '⚙', name: 'Mint Charter', max: 10, cost: 2, g: 1.5,
    eff: l => `+${20 * l}% cog income`, apply: (s, l) => { s.cogMult *= 1 + 0.2 * l; } },

  { id: 'f_seed', group: 'build', icon: '❖', name: 'Seed Vault', max: 4, cost: 3, g: 2,
    eff: l => `Each Reforge starts with ${500 * Math.pow(4, l - 1)} cores`, meta: (m, l) => { m.seedCores = 500 * Math.pow(4, l - 1); } },
  { id: 'f_disc', group: 'build', icon: '✂', name: 'Bulk Procurement', max: 5, cost: 3, g: 1.8,
    eff: l => `−${8 * l}% Skill Matrix costs`, meta: (m, l) => { m.treeMult *= 1 - 0.08 * l; } },
  { id: 'f_caps', group: 'build', icon: '✪', name: 'Capstone Molds', max: 3, cost: 4, g: 2,
    eff: l => `−${25 * l}% capstone costs`, meta: (m, l) => { m.capMult *= 1 - 0.25 * l; } },
  { id: 'f_free', group: 'build', icon: '↺', name: 'Muscle Memory', max: 3, cost: 6, g: 2.5,
    desc: 'Capstones and one-off unlocks excluded.',
    eff: l => `${l > 1 ? `First ${l} levels` : 'First level'} of every multi-level node free and pre-installed`, meta: (m, l) => { m.freeLevels = l; } },
  { id: 'f_clerk', group: 'build', icon: '♺', name: 'Clerk Contract', max: 1, cost: 4, g: 1,
    eff: () => 'Clockwork Clerk always on at full speed (0.4s)', apply: s => { s.autoBuy = Math.max(s.autoBuy, 5); } },

  // compounding so Blueprints keep pace with exponential enemy scaling
  { id: 'f_dmg', group: 'power', icon: '✹', name: 'Forge Hammer', max: 25, cost: 2, g: 1.4,
    eff: l => `×${fmtX(Math.pow(1.2, l))} damage (all weapons)`, apply: (s, l) => { s.allDmgMult *= Math.pow(1.2, l); } },
  { id: 'f_hp', group: 'power', icon: '▦', name: 'Reinforced Foundations', max: 25, cost: 2, g: 1.4,
    eff: l => `×${fmtX(Math.pow(1.2, l))} max HP and regeneration`, apply: (s, l) => { const m = Math.pow(1.2, l); s.hpMult *= m; s.regenMult *= m; } },
  { id: 'f_rate', group: 'power', icon: '≫', name: 'Governor Removal', max: 10, cost: 3, g: 1.6,
    eff: l => `+${4 * l}% rate of all weapons`, apply: (s, l) => { s.allRateMult *= 1 + 0.04 * l; } },
];
export const FOUNDRY_MAP = Object.fromEntries(FOUNDRY.map(f => [f.id, f]));

export const foundryCost = (f, lvl) => Math.ceil(f.cost * Math.pow(f.g, lvl));

export function foundryMeta(foundry = {}) {
  const m = { bpMult: 1, startWave: 0, seedCores: 0, treeMult: 1, capMult: 1, freeLevels: 0 };
  for (const f of FOUNDRY) { const l = foundry[f.id] || 0; if (l > 0 && f.meta) f.meta(m, l); }
  return m;
}

export function applyFoundry(s, foundry = {}) {
  for (const f of FOUNDRY) { const l = foundry[f.id] || 0; if (l > 0 && f.apply) f.apply(s, l); }
}

// Blueprints for Reforging now. Nothing below wave 41; grows with depth.
export const BP_MIN_WAVE = 41;
export function blueprintsFor(save) {
  const w = save.bestWave;
  if (w < BP_MIN_WAVE) return 0;
  return Math.floor(Math.pow(w - 40, 1.5) / 13 * foundryMeta(save.foundry).bpMult);
}

// Wave a run starts at: Express Elevator level, capped at half the best wave since Reforging (rounded down to 10s).
export function startWaveFor(save) {
  const m = foundryMeta(save.foundry);
  return Math.min(m.startWave, Math.floor(save.bestWave / 20) * 10);
}

// Push Foundry discounts into Skill Matrix pricing and pre-install free levels. Call on load and after any change.
export function syncFoundry(save) {
  const m = foundryMeta(save.foundry);
  setTreeMods({ mult: m.treeMult, capMult: m.capMult, free: m.freeLevels });
  if (m.freeLevels > 0) {
    for (const n of NODES) if (n.max > 1 && !n.cap) save.tree[n.id] = Math.max(save.tree[n.id] || 0, Math.min(n.max, m.freeLevels));
  }
}

export function buyFoundry(save, id) {
  const f = FOUNDRY_MAP[id];
  const lvl = save.foundry[id] || 0;
  if (!f || lvl >= f.max) return false;
  const cost = foundryCost(f, lvl);
  if (save.blueprints < cost) return false;
  save.blueprints -= cost;
  save.foundry[id] = lvl + 1;
  syncFoundry(save);
  return true;
}

// The Reforge itself. Returns Blueprints gained (0 = not allowed yet).
export function reforge(save) {
  const bp = blueprintsFor(save);
  if (bp <= 0) return 0;
  save.blueprints += bp;
  save.totalBlueprints += bp;
  save.reforges++;
  save.bestEver = Math.max(save.bestEver, save.bestWave);
  save.bestWave = 0;
  save.tree = { core: 1 };
  save.cores = foundryMeta(save.foundry).seedCores;
  syncFoundry(save);
  return bp;
}
