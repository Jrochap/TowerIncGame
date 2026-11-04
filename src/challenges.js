// Tower Inc. — Challenges: restricted runs with three wave targets each. Every tier cleared grants a
// permanent reward that survives Reforges. Unlocked after the first Reforge.
// Challenge runs start at wave 1, ignore hazard contracts and don't count toward best wave / Blueprints.

export const CHALLENGES = [
  { id: 'levi', icon: '♜', name: 'Leviathan Season', tiers: [40, 70, 100],
    rule: 'A Leviathan surfaces every 5 waves instead of every 10.',
    reward: t => `+${15 * t}% damage vs elites & bosses`,
    restrict: f => { f.bossEvery = 5; },
    apply: (s, t) => { s.bossDmg *= 1 + 0.15 * t; } },
  { id: 'iron', icon: '⊘', name: 'Iron Curtain', tiers: [40, 70, 90],
    rule: 'The main cannon is offline. Only secondary weapons fire.',
    reward: t => `+${15 * t}% damage for tesla, nova, missiles, laser and drones`,
    restrict: f => { f.cannonOff = 1; },
    apply: (s, t) => { const m = 1 + 0.15 * t; s.teslaDmgMult *= m; s.novaDmgMult *= m; s.missileDmgMult *= m; s.laserDmgMult *= m; s.droneDmgMult *= m; } },
  { id: 'bankrupt', icon: '¤', name: 'Bankruptcy', tiers: [25, 50, 70],
    rule: 'The Workshop is closed. No upgrades during the run (head-start levels still apply).',
    reward: t => `+${20 * t}% cog income`,
    restrict: f => { f.shopOff = 1; f.autoBuy = 0; },
    apply: (s, t) => { s.cogMult *= 1 + 0.2 * t; } },
  { id: 'blackout', icon: '☾', name: 'Blackout', tiers: [45, 70, 90],
    rule: 'Grid failure: no shield, tesla coil, pressure nova or drones, and −75% regeneration.',
    reward: t => `+${4 * t}% flat damage reduction`,
    restrict: f => { f.shieldMax = 0; f.shieldRegen = 0; f.teslaOn = 0; f.novaOn = 0; f.droneOn = 0; f.regen *= 0.25; },
    apply: (s, t) => { s.dr += 0.04 * t; } },
  { id: 'overtime', icon: '⏩', name: 'Overtime', tiers: [40, 70, 90],
    rule: 'Waves bring 60% more enemies, spawn twice as fast with short breaks, and enemies move 60% faster.',
    reward: t => `+${10 * t}% Blueprints from Reforging`,
    restrict: f => { f.overtime = 1; },
    bp: t => 1 + 0.1 * t },
];
export const CHALLENGE_MAP = Object.fromEntries(CHALLENGES.map(c => [c.id, c]));

export const challengesUnlocked = save => save.reforges > 0;

// Permanent rewards from cleared tiers (applied with the Skill Matrix / Foundry, before the Workshop).
export function applyChallengeRewards(s, done = {}) {
  for (const c of CHALLENGES) { const t = done[c.id] || 0; if (t > 0 && c.apply) c.apply(s, t); }
}

// The active challenge's restriction (applied to final stats).
export function applyChallengeRule(f, id) {
  const c = id && CHALLENGE_MAP[id];
  if (c) c.restrict(f);
}

export function challengeBpMult(done = {}) {
  let m = 1;
  for (const c of CHALLENGES) { const t = done[c.id] || 0; if (t > 0 && c.bp) m *= c.bp(t); }
  return m;
}

// Tiers cleared after surviving `survived` waves (target N is cleared when wave N is survived).
export const tiersFor = (c, survived) => c.tiers.filter(w => survived >= w).length;
