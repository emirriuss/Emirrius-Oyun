import type { LevelDef } from '../types';

/** The Gilded Croupier's table: a wide flat floor for the roulette stripes, two short ledges. */
export const W4_2: LevelDef = {
  id: 'w4-2',
  name: 'The Sunken Table',
  world: 4,
  parMs: 220000,
  boss: 'croupier',
  rows: [
    '####################################',
    '#                                  #',
    '#                                  #',
    '#                                  #',
    '#                                  #',
    '#                                  #',
    '#                                  #',
    '#     ====                ====     #',
    '#                                  #',
    '#                                  #',
    '#                                  #',
    '#                       &          #',
    '#  P            E                  #',
    '####################################',
    '####################################',
    '####################################',
  ],
};
