import type { LevelDef } from '../types';

/**
 * UMBRA's lantern hall: exactly one screen (30x17 tiles = 480x272) like the belfry, so the lantern
 * rail (combat/umbraPlan.ts RAIL, x 56..424 under the ceiling) spans the room. Flat floor for the
 * shadow's floor waves and pounce, and two one-way ledges (row 9) to reach a hoisted lantern from.
 */
export const W4_10: LevelDef = {
  id: 'w4-10',
  name: 'The Lantern Hall',
  world: 4,
  region: 'margin',
  mapDeco: 'lantern',
  parMs: 240000,
  boss: 'umbra',
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
    '#  ====                ====  #',
    '#                            #',
    '#                            #',
    '#                            #',
    '#  P        E        &       #',
    '##############################',
    '##############################',
    '##############################',
  ],
};
