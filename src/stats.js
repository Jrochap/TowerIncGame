import { BASE_STATS, SHOP } from './config.js';
import { NODES } from './skilltree.js';
import { applyFoundry } from './foundry.js';
import { applyChallengeRewards, applyChallengeRule } from './challenges.js';

// Folds skill tree, Foundry and workshop levels into a final, ready-to-use stat block.
export function computeStats(tree, shop = {}, foundry = {}, chDone = {}, chActive = null) {
  const s = { ...BASE_STATS };
  for (const n of NODES) {
    const l = tree[n.id] || 0;
    if (l > 0) n.apply(s, l);
  }
  applyFoundry(s, foundry);
  applyChallengeRewards(s, chDone);
  for (const u of SHOP) {
    const l = shop[u.id] || 0;
    if (l > 0 && (!u.req || s[u.req])) u.apply(s, l);
  }

  const f = { ...s };
  // secondary weapons inherit half of the cannon's damage scaling so they stay relevant late
  const share = 1 + (s.dmgMult - 1) * 0.5;

  f.damage = s.damage * s.dmgMult * s.allDmgMult;
  f.fireRate = Math.min(25, s.fireRate * s.rateMult * s.allRateMult);
  f.range = Math.min(40, s.range * s.rangeMult);
  f.critChance = Math.min(1, s.critChance);
  f.multishot = Math.min(3, s.multishot);
  f.execute = Math.min(0.25, s.execute);

  f.maxHp = s.maxHp * s.hpMult;
  f.regen = (s.regen + s.regenPct * f.maxHp) * s.regenMult;
  f.armorDR = s.armor / (s.armor + 80);
  f.totalDR = Math.min(0.85, 1 - (1 - f.armorDR) * (1 - Math.min(0.45, s.dr)));
  f.shieldMax = s.shieldOn ? f.maxHp * s.shieldPct * s.shieldMult : 0;
  f.shieldRegen = f.shieldMax * 0.1 * s.shieldRegenMult;
  f.slowAura = Math.min(0.6, s.slowAura);

  f.teslaDamage = s.teslaDamage * s.teslaDmgMult * s.allDmgMult * share;
  f.teslaRate = s.teslaRate * s.teslaRateMult * s.allRateMult;
  f.teslaRange = s.teslaRange * s.teslaRangeMult;

  f.novaDamage = s.novaDamage * s.novaDmgMult * s.allDmgMult * share;
  f.novaRate = s.novaRate * s.novaRateMult * s.allRateMult;
  f.novaRadius = s.novaRadius * s.novaRadiusMult;

  f.missileDamage = s.missileDamage * s.missileDmgMult * s.allDmgMult * share;
  f.missileRate = s.missileRate * s.missileRateMult * s.allRateMult;
  f.missileRadius = s.missileRadius * s.missileRadiusMult;

  f.laserDps = s.laserDps * s.laserDmgMult * s.allDmgMult * share;

  f.droneDamage = s.droneDamage * s.droneDmgMult * s.allDmgMult * share;
  f.droneRate = s.droneRate * s.droneRateMult * s.allRateMult;
  f.droneCount = Math.min(8, s.droneCount);

  f.interest = Math.min(0.15, s.interest);
  f.shopDiscount = Math.min(0.6, s.shopDiscount);
  f.coreSiphon = Math.min(0.2, s.coreSiphon);
  f.waveSpeed = Math.min(0.5, s.waveSpeed);
  applyChallengeRule(f, chActive);
  f.autoInterval = f.autoBuy > 0 ? 2 / f.autoBuy : 0;
  return f;
}
