import { TILE } from '../config';
import type { LevelDef, Spawn, SpawnType } from './types';

/** Tile indices in the generated `tilesN` strip texture. */
export const T = { EMPTY: -1, TOP: 0, BODY: 1, ONEWAY: 2, SPIKE: 3, LAVA: 4 } as const;

export interface ParsedLevel {
  width: number; // in tiles
  height: number;
  tiles: number[][];
  hazards: { x: number; y: number; w: number; h: number; damage: number; lava: boolean }[];
  spawns: Spawn[];
  player: { x: number; y: number };
}

const ENEMIES: Record<string, SpawnType> = { s: 'slime', c: 'charger', a: 'archer', f: 'flyer', k: 'knight', b: 'bomber' };
const PROPS: Record<string, SpawnType> = {
  '*': 'checkpoint', E: 'exit', o: 'shard', h: 'heart', '?': 'sign', '&': 'boss', '-': 'hplatform', '|': 'vplatform', X: 'crumble', r: 'breakable',
};

/** Pure parser: ASCII rows -> tile grid, hazards, spawn list. */
export function parseLevel(def: Pick<LevelDef, 'rows' | 'signs' | 'id'>): ParsedLevel {
  const rows = def.rows;
  const height = rows.length;
  const width = Math.max(...rows.map((r) => r.length));
  const tiles: number[][] = [];
  const hazards: ParsedLevel['hazards'] = [];
  const spawns: Spawn[] = [];
  let player = { x: TILE * 2, y: TILE * 2 };
  let signIdx = 0;
  const solid = (x: number, y: number) => y >= 0 && y < height && rows[y][x] === '#';

  for (let y = 0; y < height; y++) {
    const line: number[] = [];
    for (let x = 0; x < width; x++) {
      const ch = rows[y][x] ?? ' ';
      const cx = x * TILE + TILE / 2;
      const cy = y * TILE + TILE / 2;
      let t: number = T.EMPTY;
      if (ch === '#') t = solid(x, y - 1) ? T.BODY : T.TOP;
      else if (ch === '=') t = T.ONEWAY;
      else if (ch === '^') {
        t = T.SPIKE;
        hazards.push({ x: x * TILE + 2, y: y * TILE + 8, w: TILE - 4, h: 8, damage: 1, lava: false });
      } else if (ch === '~') {
        t = T.LAVA;
        hazards.push({ x: x * TILE, y: y * TILE + 6, w: TILE, h: TILE - 6, damage: 2, lava: true });
      } else if (ch === 'P') player = { x: cx, y: cy };
      else if (ENEMIES[ch.toLowerCase()] && /[a-zA-Z]/.test(ch) && ch !== 'E' && ch !== 'P' && ch !== 'X') {
        spawns.push({ type: ENEMIES[ch.toLowerCase()], x: cx, y: cy, elite: ch !== ch.toLowerCase() });
      } else if (PROPS[ch]) {
        const s: Spawn = { type: PROPS[ch], x: cx, y: cy };
        if (ch === '?') s.text = def.signs?.[signIdx++] ?? '...';
        spawns.push(s);
      } else if (ch !== ' ' && ch !== '.') {
        throw new Error(`Level ${def.id}: unknown tile '${ch}' at ${x},${y}`);
      }
      line.push(t);
    }
    tiles.push(line);
  }
  return { width, height, tiles, hazards, spawns, player };
}
