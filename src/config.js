// Tower Inc. — balance tables and static definitions.

export const TOWER_RADIUS = 4.4;   // where melee enemies stop and start hitting
export const SPAWN_RADIUS = 42;

// Raw stats before any skill tree / workshop modifiers. computeStats() turns these into final values.
export const BASE_STATS = {
  // main cannon
  damage: 12, dmgMult: 1, fireRate: 1.3, rateMult: 1, range: 17, rangeMult: 1,
  projectiles: 1, multishot: 0, critChance: 0.05, critMult: 1.5, pierce: 0,
  execute: 0, bossDmg: 1, knockback: 0, projSpeed: 48,
  // hull
  maxHp: 100, hpMult: 1, regen: 1, regenPct: 0, regenMult: 1, armor: 0, dr: 0,
  shieldOn: 0, shieldPct: 0.3, shieldMult: 1, shieldRegenMult: 1,
  thorns: 0, lifesteal: 0, lastStand: 0, ventRegen: 0,
  slowAura: 0, slowRadius: 8,
  // tesla coil
  teslaOn: 0, teslaDamage: 16, teslaDmgMult: 1, teslaRate: 0.7, teslaRateMult: 1,
  teslaChains: 2, teslaRange: 14, teslaRangeMult: 1, teslaArcs: 1, teslaStun: 0, teslaShred: 0,
  // pressure nova
  novaOn: 0, novaDamage: 30, novaDmgMult: 1, novaRate: 1 / 7, novaRateMult: 1,
  novaRadius: 9, novaRadiusMult: 1, novaKnock: 2,
  // rocket pods
  missileOn: 0, missileDamage: 32, missileDmgMult: 1, missileRate: 0.4, missileRateMult: 1,
  missileRadius: 3.2, missileRadiusMult: 1, missileCount: 1, missileBurn: 0, missileCluster: 0,
  // prism laser
  laserOn: 0, laserDps: 22, laserDmgMult: 1, laserCount: 1, laserRamp: 0,
  // drone bay (Foundry prototype)
  droneOn: 0, droneCount: 2, droneDamage: 55, droneDmgMult: 1, droneRate: 0.6, droneRateMult: 1,
  droneRange: 30, droneSplash: 0.5, droneMark: 0, droneCogs: 0,
  // global
  allDmgMult: 1, allRateMult: 1,
  // economy
  cogMult: 1, startCogs: 0, waveBounty: 0, interest: 0, shopDiscount: 0,
  coreMult: 1, blueprint: 0, coreSiphon: 0, bossBounty: 0, passiveCogs: 0, waveSpeed: 0,
  autoBuy: 0,  // Clockwork Clerk level
  kitLevel: 0, // Foundry: starting level of every Workshop upgrade
};

// y = hover height of the mesh origin. bar = show a floating health bar.
export const ENEMY_TYPES = {
  scrapper:   { name: 'Scrapper',   hp: 12,  speed: 3.4, dmg: 3,   cogs: 2,   radius: 0.75, y: 0.75, minWave: 1,  weight: 10 },
  skitter:    { name: 'Skitter',    hp: 6,   speed: 6.2, dmg: 2.5, cogs: 1.5, radius: 0.6,  y: 2.6,  minWave: 3,  weight: 6, flying: true },
  juggernaut: { name: 'Juggernaut', hp: 60,  speed: 1.7, dmg: 14,  cogs: 6,   radius: 1.35, y: 1.3,  minWave: 6,  weight: 2.2, bar: true, atkRate: 1.4 },
  swarm:      { name: 'Swarmling',  hp: 4,   speed: 4.8, dmg: 1.5, cogs: 0.6, radius: 0.4,  y: 0.45, minWave: 8,  weight: 2.5, group: 6 },
  sniper:     { name: 'Arc Sniper', hp: 22,  speed: 2.6, dmg: 7,   cogs: 3,   radius: 0.75, y: 0.95, minWave: 12, weight: 1.8, ranged: 13, atkRate: 2.2, bar: true },
  boss:       { name: 'Leviathan',  hp: 500, speed: 1.0, dmg: 30,  cogs: 80,  radius: 2.8,  y: 3.2,  minWave: Infinity, weight: 0, bar: true, atkRate: 1.8, boss: true,
                title: 'LEVIATHAN-CLASS ENGINE', alert: 'LEVIATHAN SIGNATURE DETECTED' },
  // Parks at artillery range, lobs heavy shells and launches flying escorts: a range + defense check.
  dread:      { name: 'Dreadnought', hp: 1100, speed: 1.6, dmg: 32, cogs: 100, radius: 2.6, y: 1.6, minWave: Infinity, weight: 0, bar: true, atkRate: 3, boss: true,
                ranged: 27, artillery: true, escort: { every: 7, n: 3, key: 'skitter' },
                title: 'DREADNOUGHT-CLASS SIEGE BARGE', alert: 'DREADNOUGHT ON THE HORIZON · ARTILLERY INBOUND' },
};

// exponential with a gentle quadratic term so late waves ramp hard and runs stay a reasonable length
export const waveHpMult = w => Math.pow(1.1, w - 1) * (1 + (w - 1) * 0.05) * Math.pow(1.0005, (w - 1) * (w - 1));
export const waveDmgMult = w => Math.pow(1.075, w - 1) * Math.pow(1.0006, (w - 1) * (w - 1));
export const waveCogMult = w => 1 + (w - 1) * 0.12;
export const waveCount = w => Math.min(170, Math.floor(5 + w * 1.3 + Math.pow(w, 1.15) * 0.5));
export const spawnDuration = w => Math.min(18, 8 + w * 0.3);
export const coresForRun = (wave, kills, bosses) =>
  Math.pow(Math.max(0, wave - 1), 1.5) * 1.2 + kills / 20 + bosses * 15;

// Why a Workshop row can't be bought right now (null = buyable): challenge rules or a missing unlock.
export function shopLock(u, s) {
  if (s.shopOff) return 'Challenge: Workshop closed';
  if (u.cannon && s.cannonOff) return 'Challenge: cannon offline';
  if (u.req && !s[u.req]) return u.lockText;
  return null;
}

export const shopCost = (u, lvl, discount = 0) => Math.ceil(u.base * Math.pow(u.g, lvl) * (1 - discount));

// In-run Workshop upgrades, paid with cogs. `req` names a stat flag that must be unlocked in the Skill Matrix.
export const SHOP = [
  { id: 'dmg',    tab: 'atk', cannon: 1, name: 'Barrel Damage',  base: 8,  g: 1.15, desc: '+10% cannon damage',      apply: (s, l) => { s.dmgMult *= 1 + 0.10 * l; } },
  { id: 'rate',   tab: 'atk', cannon: 1, name: 'Fire Rate',      base: 10, g: 1.18, max: 60, desc: '+5% fire rate',   apply: (s, l) => { s.rateMult *= 1 + 0.05 * l; } },
  { id: 'range',  tab: 'atk', cannon: 1, name: 'Range',          base: 15, g: 1.25, max: 15, desc: '+4% range',       apply: (s, l) => { s.rangeMult *= 1 + 0.04 * l; } },
  { id: 'crit',   tab: 'atk', cannon: 1, name: 'Crit Chance',    base: 14, g: 1.2,  max: 40, desc: '+1% crit chance', apply: (s, l) => { s.critChance += 0.01 * l; } },
  { id: 'critm',  tab: 'atk', cannon: 1, name: 'Crit Damage',    base: 14, g: 1.18, desc: '+10% crit damage',          apply: (s, l) => { s.critMult += 0.1 * l; } },
  { id: 'multi',  tab: 'atk', cannon: 1, name: 'Multishot',      base: 25, g: 1.24, max: 30, desc: '+2% chance for an extra shot', apply: (s, l) => { s.multishot += 0.02 * l; } },

  { id: 'hp',     tab: 'def', name: 'Hull Plating',   base: 8,  g: 1.15, desc: '+12% max HP',               apply: (s, l) => { s.hpMult *= 1 + 0.12 * l; } },
  { id: 'regen',  tab: 'def', name: 'Steam Regen',    base: 10, g: 1.17, desc: '+0.6 HP/s and +0.05% max HP/s', apply: (s, l) => { s.regen += 0.6 * l; s.regenPct += 0.0005 * l; } },
  { id: 'armor',  tab: 'def', name: 'Armor Plating',  base: 12, g: 1.18, desc: '+4 armor (diminishing reduction)', apply: (s, l) => { s.armor += 4 * l; } },
  { id: 'thorns', tab: 'def', name: 'Spiked Rivets',  base: 20, g: 1.22, max: 25, desc: 'Attackers take +1% of their max HP per hit', apply: (s, l) => { s.thorns += 0.01 * l; } },
  { id: 'shield', tab: 'def', name: 'Shield Capacity', base: 20, g: 1.2, req: 'shieldOn', lockText: 'Skill Matrix: Aether Shield Emitter', desc: '+10% shield capacity', apply: (s, l) => { s.shieldMult *= 1 + 0.1 * l; } },

  { id: 'tesla',  tab: 'tech', name: 'Tesla Voltage', base: 20, g: 1.17, req: 'teslaOn',   lockText: 'Skill Matrix: Tesla Coil',   desc: '+12% tesla damage',   apply: (s, l) => { s.teslaDmgMult *= 1 + 0.12 * l; } },
  { id: 'teslar', tab: 'tech', name: 'Coil Cycling',  base: 25, g: 1.22, max: 25, req: 'teslaOn', lockText: 'Skill Matrix: Tesla Coil', desc: '+4% tesla rate', apply: (s, l) => { s.teslaRateMult *= 1 + 0.04 * l; } },
  { id: 'missile', tab: 'tech', name: 'Warheads',     base: 20, g: 1.17, req: 'missileOn', lockText: 'Skill Matrix: Rocket Pods',  desc: '+12% missile damage', apply: (s, l) => { s.missileDmgMult *= 1 + 0.12 * l; } },
  { id: 'missiler', tab: 'tech', name: 'Pod Reload',  base: 25, g: 1.22, max: 25, req: 'missileOn', lockText: 'Skill Matrix: Rocket Pods', desc: '+4% missile rate', apply: (s, l) => { s.missileRateMult *= 1 + 0.04 * l; } },
  { id: 'laser',  tab: 'tech', name: 'Lens Polish',   base: 25, g: 1.17, req: 'laserOn',   lockText: 'Skill Matrix: Prism Laser',  desc: '+12% laser damage',   apply: (s, l) => { s.laserDmgMult *= 1 + 0.12 * l; } },
  { id: 'nova',   tab: 'tech', name: 'Nova Pressure', base: 25, g: 1.17, req: 'novaOn',    lockText: 'Skill Matrix: Pressure Nova', desc: '+12% nova damage',   apply: (s, l) => { s.novaDmgMult *= 1 + 0.12 * l; } },
  { id: 'drone',  tab: 'tech', name: 'Drone Payloads', base: 25, g: 1.17, req: 'droneOn', lockText: 'Foundry: Drone Bay', desc: '+12% drone damage', apply: (s, l) => { s.droneDmgMult *= 1 + 0.12 * l; } },
  { id: 'droner', tab: 'tech', name: 'Rotor Tuning',   base: 30, g: 1.22, max: 25, req: 'droneOn', lockText: 'Foundry: Drone Bay', desc: '+4% drone dive rate', apply: (s, l) => { s.droneRateMult *= 1 + 0.04 * l; } },

  { id: 'cogs',   tab: 'util', name: 'Salvage Yield', base: 15, g: 1.2,  max: 40, desc: '+6% cog income',          apply: (s, l) => { s.cogMult *= 1 + 0.06 * l; } },
  { id: 'interest', tab: 'util', name: 'Vault Interest', base: 30, g: 1.3, max: 10, desc: '+0.5% interest on banked cogs each wave', apply: (s, l) => { s.interest += 0.005 * l; } },
  { id: 'bounty', tab: 'util', name: 'Wave Bounty',   base: 20, g: 1.2,  desc: '+5 cogs per wave (scales with wave)', apply: (s, l) => { s.waveBounty += 5 * l; } },
];
