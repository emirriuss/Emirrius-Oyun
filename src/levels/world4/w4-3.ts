import type { LevelDef } from '../types';

/** The final boss (Noctara): unlocked by beating the Gilded Croupier (w4-2). */
export const W4_3: LevelDef = {
  id: 'w4-3',
  name: 'Eclipse Nest',
  world: 4,
  parMs: 270000,
  boss: 'moth',
  rows: [
    '##################################',
    '#                                #',
    '#                                #',
    '#                                #',
    '#                                #',
    '#                                #',
    '#                                #',
    '#                       &        #',
    '#                                #',
    '#     =====    ====    =====     #',
    '#                                #',
    '#                                #',
    '#                                #',
    '#  P            E                #',
    '##################################',
    '##################################',
    '##################################',
  ],
};
