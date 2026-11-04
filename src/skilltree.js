// Tower Inc. — the Skill Matrix: permanent upgrades bought with Aether Cores between runs.
// Layout: five branches radiate from the Ignition Core. Each node sits at (depth, lateral) in its
// branch; synergy nodes sit between two neighbouring branches and accept a prerequisite from either.

export const SPACING = 120;

export const BRANCHES = {
  core: { name: 'Core',       color: '#f3ead0', angle: 0 },
  off:  { name: 'Ballistics', color: '#ff4d6d', angle: -90 },
  def:  { name: 'Bulwark',    color: '#4dabff', angle: -18 },
  eco:  { name: 'Commerce',   color: '#ffc94d', angle: 54 },
  volt: { name: 'Voltaics',   color: '#b36bff', angle: 126 },
  ord:  { name: 'Ordnance',   color: '#4dffb0', angle: 198 },
  syn:  { name: 'Synergy',    color: '#f3ead0', angle: 0 },
  drone: { name: 'Drone Bay',  color: '#7df9ff', angle: 234, gate: 'drones' },
};

const r1 = v => Math.round(v * 10) / 10;
const pct = v => `${r1(v * 100)}%`;

// effect helpers: each returns { apply(stats, level), eff(level) -> text }
const mul = (field, per, label) => ({ apply: (s, l) => { s[field] *= 1 + per * l; }, eff: l => `+${pct(per * l)} ${label}` });
const add = (field, per, label) => ({ apply: (s, l) => { s[field] += per * l; }, eff: l => `+${r1(per * l)} ${label}` });
const addPct = (field, per, label) => ({ apply: (s, l) => { s[field] += per * l; }, eff: l => `+${pct(per * l)} ${label}` });
const unlock = (field, label) => ({ apply: (s, l) => { if (l > 0) s[field] = 1; }, eff: () => label });
const custom = (apply, eff) => ({ apply, eff });

export const NODES = [];
const N = (id, branch, d, lat, name, max, cost, req, effect, o = {}) =>
  NODES.push({ id, branch, d, lat, name, max, cost, req, g: o.g ?? 1.45, icon: o.icon ?? '•', desc: o.desc, cap: !!o.cap, pos: o.pos, gate: o.gate, ...effect });

N('core', 'core', 0, 0, 'Ignition Core', 1, 0, [], custom(() => {}, () => 'The heart of Tower Inc.'),
  { icon: '✺', desc: 'Every empire starts with a single spark. All branches grow from here.' });

// ── Ballistics ────────────────────────────────────────────────────────────────
N('off_dmg',    'off', 1, 0,    'Calibrated Barrels',  10, 1,  ['core'],      mul('dmgMult', 0.08, 'cannon damage'), { icon: '✦' });
N('off_rate',   'off', 2, -0.6, 'Pneumatic Loader',    10, 2,  ['off_dmg'],   mul('rateMult', 0.06, 'fire rate'), { icon: '≫' });
N('off_crit',   'off', 2, 0.6,  'Targeting Lens',      10, 2,  ['off_dmg'],   addPct('critChance', 0.015, 'crit chance'), { icon: '◎' });
N('off_multi',  'off', 3, -1,   'Twin Chamber',        10, 4,  ['off_rate'],  addPct('multishot', 0.03, 'multishot chance'), { icon: '⁑' });
N('off_range',  'off', 3, 0,    'Long-Range Optics',   8,  3,  ['off_rate', 'off_crit'], mul('rangeMult', 0.05, 'range'), { icon: '⊙' });
N('off_critm',  'off', 3, 1,    'Brass Penetrators',   10, 3,  ['off_crit'],  addPct('critMult', 0.12, 'crit damage'), { icon: '✧' });
N('off_proj',   'off', 4, -1.2, 'Gatling Assembly',    3,  25, ['off_multi'], add('projectiles', 1, 'projectile(s) per volley'), { icon: '⋮', g: 3 });
N('off_pierce', 'off', 4, 0,    'Tungsten Cores',      3,  20, ['off_range'], add('pierce', 1, 'pierce'), { icon: '➹', g: 2.5, desc: 'Shells punch through and continue to the next enemy.' });
N('off_exec',   'off', 4, 1.2,  'Executioner Protocol', 5, 15, ['off_critm'], addPct('execute', 0.02, 'execute threshold'), { icon: '☠', g: 1.7, desc: 'Non-boss enemies below the threshold are destroyed instantly.' });
N('off_rate2',  'off', 5, -1.4, 'Clockwork Overdrive', 10, 18, ['off_proj'],  mul('rateMult', 0.08, 'fire rate'), { icon: '⟳', g: 1.35 });
N('off_dmg2',   'off', 5, 0,    'Overpressure Rounds', 15, 15, ['off_pierce'], mul('dmgMult', 0.15, 'cannon damage'), { icon: '✹', g: 1.3 });
N('off_boss',   'off', 5, 1.4,  'Titan Breaker',       10, 12, ['off_exec'],  mul('bossDmg', 0.1, 'damage vs elites & bosses'), { icon: '♜', g: 1.4 });
N('off_knock',  'off', 6, -0.7, 'Concussive Shells',   5,  20, ['off_rate2', 'off_dmg2'], add('knockback', 0.35, 'knockback per hit'), { icon: '↯', g: 1.5 });
N('off_crit2',  'off', 6, 0.7,  'Weak-Point Analyzer', 10, 25, ['off_boss', 'off_dmg2'],
  custom((s, l) => { s.critChance += 0.02 * l; s.critMult += 0.1 * l; }, l => `+${2 * l}% crit chance, +${10 * l}% crit damage`), { icon: '⌬', g: 1.35 });
N('off_cap',    'off', 7, 0,    'Singularity Barrel',  1, 400, ['off_knock', 'off_crit2'], mul('dmgMult', 1, 'cannon damage'),
  { icon: '✪', cap: true, desc: 'Capstone. A barrel forged around a captive singularity. Doubles cannon damage.' });

// ── Bulwark ───────────────────────────────────────────────────────────────────
N('def_hp',       'def', 1, 0,    'Riveted Plating',     10, 1,  ['core'],    mul('hpMult', 0.1, 'max HP'), { icon: '▤' });
N('def_regen',    'def', 2, -0.6, 'Steam Recyclers',     10, 2,  ['def_hp'],  add('regen', 0.6, 'HP/s regeneration'), { icon: '♨' });
N('def_armor',    'def', 2, 0.6,  'Brass Bulwark',       10, 2,  ['def_hp'],  add('armor', 4, 'armor'), { icon: '▣' });
N('def_slow',     'def', 3, -1,   'Cryo-Steam Vents',    10, 4,  ['def_regen'], addPct('slowAura', 0.04, 'slow near the tower'), { icon: '❄', desc: 'Enemies within 8m of the tower are slowed (max 60%).' });
N('def_shield',   'def', 3, 0,    'Aether Shield Emitter', 1, 10, ['def_regen', 'def_armor'], unlock('shieldOn', 'Energy shield (30% of max HP)'),
  { icon: '◍', desc: 'Projects a shield that absorbs damage. Recharges after 2.5s without being hit.' });
N('def_thorns',   'def', 3, 1,    'Barbed Gearwork',     10, 4,  ['def_armor'], addPct('thorns', 0.02, 'of attacker max HP reflected per hit'), { icon: '✶' });
N('def_shieldreg', 'def', 4, -1.2, 'Flux Recharger',     10, 8,  ['def_shield', 'def_slow'], mul('shieldRegenMult', 0.12, 'shield recharge'), { icon: '↺' });
N('def_shieldcap', 'def', 4, 0,   'Capacitor Banks',     10, 8,  ['def_shield'], mul('shieldMult', 0.1, 'shield capacity'), { icon: '⬢' });
N('def_life',     'def', 4, 1.2,  'Vampiric Coils',      10, 10, ['def_thorns'], addPct('lifesteal', 0.003, 'of damage dealt healed'), { icon: '♥' });
N('def_regen2',   'def', 5, -1.4, 'Perpetual Boiler',    10, 15, ['def_shieldreg'], addPct('regenPct', 0.002, 'max HP regenerated per second'), { icon: '⚗', g: 1.4 });
N('def_hp2',      'def', 5, 0,    'Dreadnought Frame',   15, 15, ['def_shieldcap'], mul('hpMult', 0.15, 'max HP'), { icon: '▦', g: 1.3 });
N('def_last',     'def', 5, 1.4,  'Last Stand Protocol', 1,  60, ['def_life'], unlock('lastStand', 'Once per run: survive lethal damage'),
  { icon: '⚑', desc: 'When the hull would break, emergency reserves restore 50% HP, blast enemies back and stun them.' });
N('def_vent',     'def', 6, -0.7, 'Emergency Vents',     5,  25, ['def_regen2', 'def_hp2'], addPct('ventRegen', 0.4, 'regeneration while below 30% HP'), { icon: '⚠', g: 1.6 });
N('def_armor2',   'def', 6, 0.7,  'Adamant Lattice',     10, 25, ['def_hp2', 'def_last'], addPct('dr', 0.03, 'flat damage reduction'), { icon: '◆', g: 1.35 });
N('def_cap',      'def', 7, 0,    'Invincible Citadel',  1, 400, ['def_vent', 'def_armor2'],
  custom(s => { s.hpMult *= 2; s.regenMult *= 2; }, () => '×2 max HP, ×2 regeneration'), { icon: '♛', cap: true, desc: 'Capstone. The tower becomes a fortress-city unto itself.' });

// ── Commerce ──────────────────────────────────────────────────────────────────
N('eco_cogs',     'eco', 1, 0,    'Scrap Salvagers',     10, 1,  ['core'],     mul('cogMult', 0.1, 'cog income'), { icon: '⚙' });
N('eco_start',    'eco', 2, -0.6, 'Seed Capital',        10, 2,  ['eco_cogs'], add('startCogs', 30, 'starting cogs'), { icon: '¤' });
N('eco_wave',     'eco', 2, 0.6,  'Wave Contracts',      10, 2,  ['eco_cogs'], add('waveBounty', 4, 'cogs per wave (scales with wave)'), { icon: '✉' });
N('eco_cores',    'eco', 3, -1,   'Aether Distillery',   15, 4,  ['eco_start'], mul('coreMult', 0.08, 'cores on extraction'), { icon: '◈' });
N('eco_interest', 'eco', 3, 0,    'Compound Interest',   10, 5,  ['eco_start', 'eco_wave'], addPct('interest', 0.01, 'interest on banked cogs per wave'), { icon: '%' });
N('eco_disc',     'eco', 3, 1,    'Union Contracts',     10, 4,  ['eco_wave'], addPct('shopDiscount', 0.03, 'workshop discount'), { icon: '✂' });
N('eco_siphon',   'eco', 4, -1.2, 'Core Siphon',         10, 10, ['eco_cores'], addPct('coreSiphon', 0.004, 'chance per kill to siphon a core'), { icon: '⟁' });
N('eco_blue',     'eco', 4, 0,    'Schematic Archive',   5,  30, ['eco_interest'], add('blueprint', 1, 'starting level in Damage, Fire Rate, Hull, Regen'), { icon: '✎', g: 2 });
N('eco_bounty',   'eco', 4, 1.2,  'Bounty Hunter',       10, 8,  ['eco_disc'], addPct('bossBounty', 0.25, 'cogs from elites & bosses'), { icon: '$' });
N('eco_turbine',  'eco', 5, -1.4, 'Steam Turbines',      10, 15, ['eco_siphon'], add('passiveCogs', 1, 'cogs/s passive income (scales with wave)'), { icon: '≋', g: 1.4 });
N('eco_clerk',    'eco', 4.5, 0.6, 'Clockwork Clerk',    5,  40, ['eco_blue'],
  custom((s, l) => { s.autoBuy = l; }, l => `Auto-buys a Workshop upgrade every ${r1(2 / l)}s`),
  { icon: '♺', g: 1.8, desc: 'A brass automaton staffs the Workshop counter. Choose in the Workshop whether it buys only the upgrades you mark, or anything it can afford.' });
N('eco_cogs2',    'eco', 5, 0,    'Automated Foundry',   15, 15, ['eco_blue'], mul('cogMult', 0.12, 'cog income'), { icon: '⚒', g: 1.3 });
N('eco_accel',    'eco', 5, 1.4,  'Wave Accelerator',    5,  20, ['eco_bounty'],
  custom((s, l) => { s.waveSpeed += 0.08 * l; s.coreMult *= 1 + 0.1 * l; }, l => `Waves arrive ${8 * l}% faster, +${10 * l}% cores`), { icon: '⏩', g: 1.6 });
N('eco_cores2',   'eco', 6, -0.7, 'Quantum Refinery',    10, 30, ['eco_turbine', 'eco_cogs2'], mul('coreMult', 0.12, 'cores on extraction'), { icon: '⬡', g: 1.4 });
N('eco_monop',    'eco', 6, 0.7,  'Monopoly Charter',    10, 30, ['eco_cogs2', 'eco_accel'],
  custom((s, l) => { s.cogMult *= 1 + 0.08 * l; s.shopDiscount += 0.01 * l; }, l => `+${8 * l}% cog income, +${l}% workshop discount`), { icon: '♚', g: 1.4 });
N('eco_cap',      'eco', 7, 0,    'Gilded Empire',       1, 400, ['eco_cores2', 'eco_monop'],
  custom(s => { s.cogMult *= 2; s.coreMult *= 1.5; }, () => '×2 cog income, ×1.5 cores'), { icon: '♔', cap: true, desc: 'Capstone. Tower Inc. buys the city. Then the next one.' });

// ── Voltaics ──────────────────────────────────────────────────────────────────
N('volt_tesla',   'volt', 1, 0,    'Tesla Coil',         1,  5,  ['core'], unlock('teslaOn', 'Tesla coil online'),
  { icon: 'ϟ', desc: 'Erects a copper spire that discharges chain lightning into nearby enemies.' });
N('volt_dmg',     'volt', 2, -0.6, 'High Voltage',       15, 2,  ['volt_tesla'], mul('teslaDmgMult', 0.15, 'tesla damage'), { icon: '⚡', g: 1.38 });
N('volt_chain',   'volt', 2, 0.6,  'Arc Splitter',       5,  6,  ['volt_tesla'], add('teslaChains', 1, 'chain jump(s)'), { icon: '⤳', g: 1.9 });
N('volt_rate',    'volt', 3, -1,   'Capacitor Cycling',  10, 5,  ['volt_dmg'], mul('teslaRateMult', 0.08, 'tesla discharge rate'), { icon: '⟲' });
N('volt_nova',    'volt', 3, 0,    'Pressure Nova',      1,  20, ['volt_dmg', 'volt_chain'], unlock('novaOn', 'Pressure nova online'),
  { icon: '✺', desc: 'Periodically vents a shockwave that damages and repels everything near the tower.' });
N('volt_range',   'volt', 3, 1,    'Ionized Air',        8,  5,  ['volt_chain'], mul('teslaRangeMult', 0.08, 'tesla range'), { icon: '⌇' });
N('volt_stun',    'volt', 4, -1.2, 'Neural Disruptor',   5,  12, ['volt_rate'],
  custom((s, l) => { s.teslaStun += 0.15 * l; }, l => `${r1(0.15 * l)}s stun on tesla hit`), { icon: '⊘' });
N('volt_novadmg', 'volt', 4, 0,    'Overcharged Nova',   15, 10, ['volt_nova'], mul('novaDmgMult', 0.15, 'nova damage'), { icon: '✷', g: 1.35 });
N('volt_novarad', 'volt', 4, 1.2,  'Shockwave Radius',   8,  10, ['volt_nova', 'volt_range'], mul('novaRadiusMult', 0.08, 'nova radius'), { icon: '◌' });
N('volt_shred',   'volt', 5, -1.4, 'Voltaic Shred',      10, 15, ['volt_stun'], addPct('teslaShred', 0.04, 'damage taken by electrified enemies'),
  { icon: '⌁', g: 1.4, desc: 'Tesla-struck enemies take extra damage from every source for 3s.' });
N('volt_twin',    'volt', 5, 0,    'Twin Coils',         2,  60, ['volt_novadmg'], add('teslaArcs', 1, 'extra arc(s) per discharge'), { icon: '⫘', g: 3 });
N('volt_novarate', 'volt', 5, 1.4, 'Rapid Venting',      10, 15, ['volt_novarad'], mul('novaRateMult', 0.06, 'nova frequency'), { icon: '⇶', g: 1.4 });
N('volt_amp',     'volt', 6, -0.7, 'Resonance Amplifier', 10, 30, ['volt_shred', 'volt_twin'],
  custom((s, l) => { s.teslaDmgMult *= 1 + 0.1 * l; s.novaDmgMult *= 1 + 0.1 * l; }, l => `+${10 * l}% tesla & nova damage`), { icon: '∿', g: 1.4 });
N('volt_gale',    'volt', 6, 0.7,  'Gale Force',         5,  25, ['volt_novarate', 'volt_twin'], add('novaKnock', 1, 'nova knockback'), { icon: '≈', g: 1.5 });
N('volt_cap',     'volt', 7, 0,    'Storm Engine',       1, 400, ['volt_amp', 'volt_gale'],
  custom(s => { s.teslaDmgMult *= 2; s.novaDmgMult *= 2; s.teslaRateMult *= 1.5; }, () => '×2 tesla & nova damage, +50% tesla rate'),
  { icon: '☈', cap: true, desc: 'Capstone. Bottle a thunderstorm in the boiler room.' });

// ── Ordnance ──────────────────────────────────────────────────────────────────
N('ord_missile',  'ord', 1, 0,    'Rocket Pods',         1,  5,  ['core'], unlock('missileOn', 'Rocket pods online'),
  { icon: '➶', desc: 'Bolts homing rocket pods onto the turret. They bombard the toughest enemies.' });
N('ord_mdmg',     'ord', 2, -0.6, 'Shaped Charges',      15, 2,  ['ord_missile'], mul('missileDmgMult', 0.15, 'missile damage'), { icon: '✸', g: 1.38 });
N('ord_mrad',     'ord', 2, 0.6,  'Blast Radius',        8,  3,  ['ord_missile'], mul('missileRadiusMult', 0.08, 'blast radius'), { icon: '◉' });
N('ord_mcount',   'ord', 3, -1,   'Salvo Racks',         4,  15, ['ord_mdmg'], add('missileCount', 1, 'missile(s) per salvo'), { icon: '⫶', g: 2.2 });
N('ord_laser',    'ord', 3, 0,    'Prism Laser',         1,  25, ['ord_mdmg', 'ord_mrad'], unlock('laserOn', 'Prism laser online'),
  { icon: '◇', desc: 'A floating prism focuses a continuous beam on the toughest enemy in range.' });
N('ord_mrate',    'ord', 3, 1,    'Autoloaders',         10, 5,  ['ord_mrad'], mul('missileRateMult', 0.07, 'missile rate'), { icon: '⟳' });
N('ord_burn',     'ord', 4, -1.2, 'Incendiary Payload',  10, 10, ['ord_mcount'], addPct('missileBurn', 0.1, 'of blast damage dealt again as burn over 3s'), { icon: '⁂' });
N('ord_ldps',     'ord', 4, 0,    'Focusing Crystals',   15, 10, ['ord_laser'], mul('laserDmgMult', 0.15, 'laser damage'), { icon: '⟡', g: 1.35 });
N('ord_servo',    'ord', 4, 1.2,  'Overclocked Servos',  10, 10, ['ord_mrate'], mul('allRateMult', 0.04, 'rate of all weapons'), { icon: '⚙' });
N('ord_cluster',  'ord', 5, -1.4, 'Cluster Munitions',   3,  40, ['ord_burn'],
  custom((s, l) => { s.missileCluster += l; }, l => `${2 * l} bomblets per missile`), { icon: '⁘', g: 2.2 });
N('ord_lcount',   'ord', 5, 0,    'Prism Splitter',      3,  50, ['ord_ldps'], add('laserCount', 1, 'extra laser beam(s)'), { icon: '⋔', g: 2.5 });
N('ord_lramp',    'ord', 5, 1.4,  'Thermal Lance',       5,  20, ['ord_servo', 'ord_ldps'], addPct('laserRamp', 0.2, 'laser damage per second on the same target (5s max)'), { icon: '↗', g: 1.6 });
N('ord_mod',      'ord', 6, -0.7, 'Modular Turrets',     10, 30, ['ord_cluster', 'ord_lcount'], mul('allDmgMult', 0.04, 'damage (all weapons)'), { icon: '⊞', g: 1.4 });
N('ord_fire',     'ord', 6, 0.7,  'Integrated Targeting', 10, 30, ['ord_lcount', 'ord_lramp'],
  custom((s, l) => { s.missileDmgMult *= 1 + 0.1 * l; s.laserDmgMult *= 1 + 0.1 * l; }, l => `+${10 * l}% missile & laser damage`), { icon: '⌗', g: 1.4 });
N('ord_cap',      'ord', 7, 0,    'Doomsday Arsenal',    1, 400, ['ord_mod', 'ord_fire'],
  custom(s => { s.missileDmgMult *= 2; s.laserDmgMult *= 2; s.missileCount += 1; }, () => '×2 missile & laser damage, +1 missile'),
  { icon: '☢', cap: true, desc: 'Capstone. The board signs off on the unthinkable.' });

// ── Synergies (between branches) ──────────────────────────────────────────────
N('syn_od', 'syn', 0, 0, 'Reactive Plating', 10, 8, ['off_critm', 'def_slow'],
  custom((s, l) => { s.dmgMult *= 1 + 0.04 * l; s.hpMult *= 1 + 0.04 * l; }, l => `+${4 * l}% cannon damage & max HP`), { icon: '⚔', pos: [-54, 3.6] });
N('syn_de', 'syn', 0, 0, 'Insurance Policy', 10, 8, ['def_thorns', 'eco_cores'],
  custom((s, l) => { s.hpMult *= 1 + 0.05 * l; s.coreMult *= 1 + 0.04 * l; }, l => `+${5 * l}% max HP, +${4 * l}% cores`), { icon: '⚖', pos: [18, 3.6] });
N('syn_ev', 'syn', 0, 0, 'Patent Royalties', 10, 8, ['eco_disc', 'volt_rate'],
  custom((s, l) => { s.cogMult *= 1 + 0.05 * l; s.teslaDmgMult *= 1 + 0.06 * l; }, l => `+${5 * l}% cog income, +${6 * l}% tesla damage`), { icon: '℗', pos: [90, 3.6] });
N('syn_vo', 'syn', 0, 0, 'Arc Munitions', 10, 8, ['volt_range', 'ord_mcount'],
  custom((s, l) => { s.teslaDmgMult *= 1 + 0.06 * l; s.missileDmgMult *= 1 + 0.06 * l; }, l => `+${6 * l}% tesla & missile damage`), { icon: '✣', pos: [162, 3.6] });
N('syn_oo', 'syn', 0, 0, 'Integrated Fire Control', 10, 8, ['ord_mrate', 'off_multi'],
  mul('allRateMult', 0.03, 'rate of all weapons'), { icon: '⌖', pos: [234, 3.6] });

// ── Drone Bay (gated: needs the Foundry's Drone Bay prototype) ──────────────────
// Sits beyond the outer ring between Ordnance and Ballistics, rooted on Integrated Fire Control.
const DG = { gate: 'drones' };
N('drone_bay',   'drone', 0, 0, 'Drone Bay',          1,  60, ['syn_oo'], unlock('droneOn', 'Drone bay online (2 drones)'),
  { ...DG, icon: '⌬', pos: [234, 8.4], desc: 'Brass rotor-drones orbit the tower and dive-bomb enemies anywhere on the field, splashing nearby targets.' });
N('drone_dmg',   'drone', 0, 0, 'Shaped Warheads',    15, 20, ['drone_bay'], mul('droneDmgMult', 0.2, 'drone damage'), { ...DG, icon: '✸', g: 1.35, pos: [226, 9.3] });
N('drone_rate',  'drone', 0, 0, 'Hot-Swap Batteries', 10, 25, ['drone_bay'], mul('droneRateMult', 0.08, 'drone dive rate'), { ...DG, icon: '⟳', g: 1.4, pos: [242, 9.3] });
N('drone_count', 'drone', 0, 0, 'Hangar Expansion',   4,  80, ['drone_dmg', 'drone_rate'], add('droneCount', 1, 'drone(s)'), { ...DG, icon: '⁂', g: 2.2, pos: [234, 10.0] });
N('drone_mark',  'drone', 0, 0, 'Target Painter',     10, 30, ['drone_dmg'], addPct('droneMark', 0.04, 'damage taken from all sources by drone-marked enemies (3s)'),
  { ...DG, icon: '◎', g: 1.4, pos: [221, 10.3], desc: 'Every drone strike paints its target. Painted enemies take extra damage from everything.' });
N('drone_salv',  'drone', 0, 0, 'Salvage Claws',      10, 25, ['drone_rate'], addPct('droneCogs', 0.1, 'cogs from painted enemies'), { ...DG, icon: '$', g: 1.4, pos: [247, 10.3] });
N('drone_cap',   'drone', 0, 0, 'Swarm Directive',    1, 600, ['drone_count'],
  custom(s => { s.droneDmgMult *= 3; s.droneCount += 2; s.droneSplash += 0.3; }, () => '×3 drone damage, +2 drones, stronger splash'),
  { ...DG, icon: '✺', cap: true, pos: [234, 11.1], desc: 'Capstone. The hangar doors never close.' });

// ── layout ────────────────────────────────────────────────────────────────────
export const NODE_MAP = {};
for (const n of NODES) {
  NODE_MAP[n.id] = n;
  if (n.pos) {
    const a = n.pos[0] * Math.PI / 180;
    n.x = Math.cos(a) * n.pos[1] * SPACING;
    n.y = Math.sin(a) * n.pos[1] * SPACING;
  } else {
    const a = BRANCHES[n.branch].angle * Math.PI / 180;
    const dx = Math.cos(a), dy = Math.sin(a);
    n.x = (dx * n.d - dy * n.lat) * SPACING;
    n.y = (dy * n.d + dx * n.lat) * SPACING;
  }
  n.size = n.id === 'core' ? 34 : n.cap ? 32 : n.max === 1 ? 28 : 24;
}

// ── Overclock: maxed multi-level nodes keep levelling past their max at a much steeper price.
// Overclock levels are stored as tree levels above n.max, so stats/respec handle them for free.
// Excluded: one-off unlocks/capstones and nodes whose effect is a whole-number count.
const NO_OC = new Set(['drone_count', 'off_knock', 'volt_stun', 'volt_gale', 'off_proj', 'off_pierce', 'eco_blue', 'volt_chain', 'volt_twin', 'ord_mcount', 'ord_cluster', 'ord_lcount']);
for (const n of NODES) n.oc = n.max > 1 && !NO_OC.has(n.id);
const OC_STEEP = 0.3; // extra growth per overclock level on top of the node's own curve

// Foundry price modifiers (set by syncFoundry): global multiplier, capstone multiplier, free leading levels.
const mods = { mult: 1, capMult: 1, free: 0, drones: false };
// gated nodes (Foundry prototypes) are invisible and unbuyable until their gate is open
export const nodeGated = n => !!n.gate && !mods[n.gate];
export function setTreeMods(m) { Object.assign(mods, m); }

export function nodeCost(n, lvl) {
  if (n.max > 1 && !n.cap && lvl < mods.free) return 0;
  const raw = lvl < n.max
    ? n.cost * Math.pow(n.g, lvl)
    : n.cost * Math.pow(n.g, n.max) * Math.pow(n.g + OC_STEEP, lvl - n.max);
  return Math.ceil(raw * mods.mult * (n.cap ? mods.capMult : 1));
}
export const ocLevel = (n, tree) => Math.max(0, (tree[n.id] || 0) - n.max);
export const canOverclock = (n, tree) => n.oc && (tree[n.id] || 0) >= n.max;
export const nodeAvailable = (n, tree) => !nodeGated(n) && (n.req.length === 0 || n.req.some(id => (tree[id] || 0) > 0));

export function nodeState(n, tree) {
  const lvl = tree[n.id] || 0;
  if (lvl >= n.max) return 'max';
  if (!nodeAvailable(n, tree)) return 'locked';
  return lvl > 0 ? 'owned' : 'avail';
}

export function buyNode(save, id) {
  const n = NODE_MAP[id];
  if (!n) return false;
  const lvl = save.tree[id] || 0;
  if ((lvl >= n.max && !n.oc) || !nodeAvailable(n, save.tree)) return false;
  const cost = nodeCost(n, lvl);
  if (save.cores < cost) return false;
  save.cores -= cost;
  save.tree[id] = lvl + 1;
  return true;
}

export function respec(save) {
  let refund = 0;
  for (const n of NODES) {
    if (n.id === 'core') continue;
    const lvl = save.tree[n.id] || 0;
    for (let i = 0; i < lvl; i++) refund += nodeCost(n, i);
  }
  save.cores += refund;
  save.tree = { core: 1 };
  return refund;
}
