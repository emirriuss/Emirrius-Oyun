import { describe, it, expect } from 'vitest';
import { LEVELS } from '../src/levels';
import { parseLevel } from '../src/levels/LevelLoader';

/** Cells a character can stand on top of. */
const SUPPORT = new Set(['#', '=', 'X', '-', '|']);
/** Cells a character can occupy. */
const PASSABLE = (c: string) => !'#X'.includes(c);

/**
 * Coarse reachability: BFS over standable cells. From a standable cell you can reach another
 * standable cell up to `up` tiles higher within `reach` columns, or any lower one within reach+drop/2.
 * Ignores ceilings, so it can only catch impossible layouts (not prove possible ones).
 */
function reachable(rows: string[], up: number, reach: number): boolean {
  const H = rows.length;
  const W = rows[0].length;
  const at = (x: number, y: number) => (y < 0 || y >= H || x < 0 || x >= W ? '#' : rows[y][x]);
  const standable = (x: number, y: number) => PASSABLE(at(x, y)) && at(x, y) !== '^' && at(x, y) !== '~' && y + 1 < H && SUPPORT.has(at(x, y + 1));
  let start: [number, number] | null = null;
  let goal: [number, number] | null = null;
  rows.forEach((r, y) => [...r].forEach((c, x) => {
    if (c === 'P') start = [x, y];
    if (c === 'E') goal = [x, y];
  }));
  if (!start || !goal) return false;
  // drop P/E to their floor
  const settle = ([x, y]: [number, number]): [number, number] => {
    while (y < H - 1 && !standable(x, y)) y++;
    return [x, y];
  };
  const s = settle(start);
  const g = settle(goal);
  const seen = new Set<string>([s.join()]);
  const q: [number, number][] = [s];
  while (q.length) {
    const [x, y] = q.shift()!;
    if (Math.abs(x - g[0]) <= 1 && y === g[1]) return true;
    for (let ny = Math.max(0, y - up); ny < H; ny++) {
      const drop = ny - y;
      const r = drop > 0 ? reach + Math.ceil(drop / 2) : reach;
      for (let nx = x - r; nx <= x + r; nx++) {
        const k = `${nx},${ny}`;
        if (seen.has(k) || !standable(nx, ny)) continue;
        seen.add(k);
        q.push([nx, ny]);
      }
    }
  }
  return false;
}

describe('levels', () => {
  it('has unique ids in order', () => {
    const ids = LEVELS.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  for (const l of LEVELS) {
    describe(l.id, () => {
      it('parses and is rectangular with side walls', () => {
        const w = l.rows[0].length;
        l.rows.forEach((r, i) => {
          expect(r.length, `row ${i} length`).toBe(w);
          expect(r[0], `row ${i} left wall`).toBe('#');
          expect(r[w - 1], `row ${i} right wall`).toBe('#');
        });
        expect(() => parseLevel(l)).not.toThrow();
      });
      it('has exactly one P and one E', () => {
        const all = l.rows.join('');
        expect(all.split('P').length - 1).toBe(1);
        expect(all.split('E').length - 1).toBe(1);
      });
      it('boss config is consistent', () => {
        const amps = l.rows.join('').split('&').length - 1;
        expect(amps).toBe(l.boss ? 1 : 0);
      });
      it('signs count matches', () => {
        const q = l.rows.join('').split('?').length - 1;
        expect(q).toBe(l.signs?.length ?? 0);
      });
      it('breakables (r) sit on solid ground', () => {
        l.rows.forEach((r, y) =>
          [...r].forEach((c, x) => {
            if (c !== 'r') return;
            expect(l.rows[y + 1]?.[x], `breakable at ${x},${y} needs a floor`).toBe('#');
          }),
        );
        const parsed = parseLevel(l);
        const n = l.rows.join('').split('r').length - 1;
        expect(parsed.spawns.filter((s) => s.type === 'breakable').length).toBe(n);
      });
      it('exit is reachable (coarse check)', () => {
        // world 1 levels before the boss: single jump (3 tiles up). After W1 boss: double jump.
        const up = l.world === 1 ? 3 : 6;
        expect(reachable(l.rows, up, 5)).toBe(true);
      });
    });
  }
});
