import type { LevelDef } from '../types';

/** Post-game encore (unlocked by clearing w4-4): Monsieur Fromage's game-show stage. Side platforms + a centre one escape the fondue. */
export const W4_5: LevelDef = {
  id: 'w4-5',
  name: 'The Grand Gouda Gala',
  world: 4,
  region: 'margin',
  parMs: 240000,
  boss: 'fromage',
  rows: [
    '##################################',
    '#                                #',
    '#                                #',
    '#                                #',
    '#                                #',
    '#                                #',
    '#                                #',
    '#                                #',
    '#                                #',
    '#    =====     ======     =====  #',
    '#                                #',
    '#                                #',
    '#                       &        #',
    '#  P            E                #',
    '##################################',
    '##################################',
    '##################################',
  ],
};
