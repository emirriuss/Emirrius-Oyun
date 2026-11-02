import type { LevelDef } from '../types';

/**
 * CANTOR's belfry: exactly one screen (30x17 tiles = 480x272) so every dodge distance in
 * combat/cantorPlan.ts (travel px in the Hick floors) is bounded by the arena. Flat floor for the
 * toll waves, two short one-way ledges (another answer to a wave besides jumping), and three peal
 * columns centred at x = 96 / 240 / 384 (cols 6, 15, 24).
 */
export const W4_8: LevelDef = {
  id: 'w4-8',
  name: 'The Belfry',
  world: 4,
  region: 'margin',
  mapDeco: 'bell',
  parMs: 240000,
  boss: 'cantor',
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
    '#  P        E       &        #',
    '##############################',
    '##############################',
    '##############################',
  ],
};
