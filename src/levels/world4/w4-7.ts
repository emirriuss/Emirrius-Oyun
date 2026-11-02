import type { LevelDef } from '../types';

/**
 * ORRATH's valley: 40x20 tiles (640x320), a bare floor at row 17 (y=272) and open sky, taller than the
 * screen so the phase cinematics have room to pan up. Every ledge in the fight is spawned by the boss
 * (P2 debris, P3 armor plates), so the tile map stays flat.
 */
export const W4_7: LevelDef = {
  id: 'w4-7',
  name: 'The Sleeping Range',
  world: 4,
  region: 'margin',
  mapDeco: 'mountain',
  parMs: 300000,
  boss: 'colossus',
  rows: [
    '#                                      #',
    '#                                      #',
    '#                                      #',
    '#                                      #',
    '#                                      #',
    '#                                      #',
    '#                                      #',
    '#                                      #',
    '#                                      #',
    '#                                      #',
    '#                                      #',
    '#                                      #',
    '#                                      #',
    '#                                      #',
    '#                                      #',
    '#                                      #',
    '#   P               E     &            #',
    '########################################',
    '########################################',
    '########################################',
  ],
};
