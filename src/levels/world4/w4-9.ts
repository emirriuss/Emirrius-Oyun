import type { LevelDef } from '../types';

/**
 * TUMBLAR's vault: exactly one screen (30x17 tiles = 480x272) with a bare floor at row 14 (y = 224).
 * The door stands at the right wall (col 27). Every ledge in the fight is a lock part the boss spawns
 * (P1 pin heads in five columns at x = 64..320, P2 a hanging dial, P3 floor bolts), so the map stays flat.
 */
export const W4_9: LevelDef = {
  id: 'w4-9',
  name: 'The Vault',
  world: 4,
  region: 'margin',
  mapDeco: 'keyhole',
  parMs: 300000,
  boss: 'tumblar',
  rows: [
    '##############################',
    '#                            #',
    '#                            #',
    '#                            #',
    '#                            #',
    '#                            #',
    '#                            #',
    '#                            #',
    '#                            #',
    '#                            #',
    '#                            #',
    '#                            #',
    '#                            #',
    '# P           E           &  #',
    '##############################',
    '##############################',
    '##############################',
  ],
};
