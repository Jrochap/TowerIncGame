# Tower Inc.

A cyberpunk/steampunk tower-defense × incremental game in Three.js. You run one fixed brass-and-neon
tower. Endless waves of scrap-bots attack it until it's overwhelmed. Between runs you spend Aether
Cores in a large Skill Matrix, then deploy again and get further.

**▶ Play it: https://jrochap.github.io/TowerIncGame/**

## Run it

It uses ES modules and a CDN import map, so it has to be served over HTTP. Opening `index.html`
directly from disk won't work.

```sh
cd towerdefense
python3 -m http.server 8000
# open http://localhost:8000
```

## How it plays

- **Cogs ⚙** come from kills and wave bounties. Spend them in the **Workshop** (right panel).
  Workshop upgrades reset when you die.
- **Aether Cores ◈** are awarded when the tower falls. The amount scales with the wave you reached,
  your kills, and bosses killed. Spend them in the **Skill Matrix** (82 nodes). These upgrades are
  permanent.
- If a wave isn't cleared within ~12s of its last spawn, the next wave starts anyway. Fall behind
  and the horde snowballs.
- Every 10th wave brings a **Leviathan** boss. From wave 6, gold-haloed **elites** start showing up.

### Skill Matrix branches
| Branch | Focus |
|---|---|
| Ballistics | cannon damage, fire rate, crits, multishot, pierce, execute, knockback |
| Bulwark | HP, regen, armor, energy shield, thorns, slow aura, lifesteal, Last Stand |
| Commerce | cog income, interest, discounts, core yield, blueprint head-starts, passive income |
| Voltaics | Tesla coil (chain lightning, stun, shred) and the Pressure Nova shockwave |
| Ordnance | homing rocket pods (burn, cluster bomblets) and the Prism Laser (multi-beam, ramping) |
| Synergy | five hybrid nodes between neighbouring branches |

Each branch ends in a 400-core capstone. Commerce also holds the **Clockwork Clerk**, which auto-buys
Workshop upgrades. It can buy only the rows you mark AUTO (cheapest first) or anything it can
afford (random, weighted toward cheaper upgrades). Each level makes it faster.

### Controls
`Space` pause · `1/2/3` 1×/2×/4× speed · `M` mute · `Esc` menu (self-destruct to bank cores) · drag to orbit · scroll to zoom

## Code map
| File | Role |
|---|---|
| `src/config.js` | base stats, enemy types, wave scaling curves, Workshop upgrades |
| `src/skilltree.js` | Skill Matrix nodes, layout, buy/respec |
| `src/stats.js` | folds tree and Workshop levels into final stats |
| `src/game.js` | run simulation: waves, enemies, weapons, economy |
| `src/world.js` | Three.js scene, tower model, city, pooled meshes, particles/effects, bloom |
| `src/audio.js` | procedural Web Audio sound effects (no asset files) and mute setting |
| `src/ui.js` | HUD, Workshop, floating numbers, end screens |
| `src/treeview.js` | canvas renderer for the Skill Matrix |
| `src/main.js` | bootstrap, screen flow, input, main loop |

Progress is saved in `localStorage`.
