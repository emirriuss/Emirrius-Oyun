import type { LevelDef } from '../types';

/**
 * ERRATUM's page: exactly one screen (30x17 tiles = 480x272), so the boss can treat world space as
 * screen space for its HUD / dialog / credits tricks. A deep floor (rows 14-16) that Strikethrough
 * erases column by column (a pit while erased), two ledges it can also strike out.
 */
export const W4_6: LevelDef = {
  id: 'w4-6',
  name: 'The Margin',
  world: 4,
  region: 'margin',
  mapDeco: 'ampersand',
  parMs: 300000,
  boss: 'erratum',
  rows: [
    '##############################',
    '#                            #',
    '#                            #',
    '#                            #',
    '#                            #',
    '#                            #',
    '#                            #',
    '#                            #',
    '#    =====          =====    #',
    '#                            #',
    '#                            #',
    '#                            #',
    '#                            #',
    '#  P        E        &       #',
    '##############################',
    '##############################',
    '##############################',
  ],
};
