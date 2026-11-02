import { describe, it, expect } from 'vitest';
import { LEVELS, isUnlocked, levelOfBoss, bossOf } from '../src/levels';
import { PAGE_W, PANEL_TOP, STAGE, SHRINE_ID, layoutMap, pageX, type MapNode } from '../src/scenes/worldMap/layout';
import { neighbor, pageFocus, type Dir } from '../src/scenes/worldMap/nav';

/** Save stub with everything before `upTo` (a level id) completed; `null` = everything. */
function progress(upTo: string | null) {
  const n = upTo === null ? LEVELS.length : LEVELS.findIndex((l) => l.id === upTo);
  const done = new Set(LEVELS.slice(0, n).map((l) => l.id));
  return { isCompleted: (id: string) => done.has(id) };
}

function mapAt(upTo: string | null) {
  const save = progress(upTo);
  const open = (id: string) => isUnlocked(id, save);
  const { pages, nodes } = layoutMap(LEVELS, open);
  const unlocked = (i: number) => nodes[i].id === SHRINE_ID || open(nodes[i].id);
  const done = (i: number) => save.isCompleted(nodes[i].id);
  const at = (id: string) => nodes.findIndex((n) => n.id === id);
  const go = (from: string, dir: Dir) => nodes[neighbor(nodes, at(from), dir, unlocked, done)]?.id;
  return { pages, nodes, unlocked, done, at, go };
}

const labelBottom = (n: MapNode) => n.y + (n.level?.boss ? 19 : 16) + 6;

describe('world map layout', () => {
  const { pages, nodes } = mapAt(null);

  it('places the shrine then every level once, in play order', () => {
    expect(nodes[0].id).toBe(SHRINE_ID);
    expect(nodes.slice(1).map((n) => n.id)).toEqual(LEVELS.map((l) => l.id));
  });

  it('has a page per world, between the shrine and the margin', () => {
    expect(pages.map((p) => p.kind)).toEqual(['shrine', 'world', 'world', 'world', 'world', 'margin']);
    expect(pages.slice(1, 5).map((p) => p.world)).toEqual([1, 2, 3, 4]);
  });

  it('keeps every node inside its page stage, labels above the preview panel', () => {
    for (const n of nodes) {
      const lx = n.x - pageX(n.page);
      expect(lx - 12, n.id).toBeGreaterThanOrEqual(STAGE.x);
      expect(lx + 12, n.id).toBeLessThanOrEqual(STAGE.x + STAGE.w);
      expect(n.y - 24, n.id).toBeGreaterThanOrEqual(STAGE.y + 20); // below the title strip, room for rank badge + hero
      expect(labelBottom(n), n.id).toBeLessThan(PANEL_TOP);
    }
  });

  it('runs each page left to right in play order, nodes well apart', () => {
    for (let i = 1; i < nodes.length - 1; i++) {
      const a = nodes[i];
      const b = nodes[i + 1];
      if (a.page !== b.page) continue;
      expect(b.x - a.x, `${a.id} -> ${b.id}`).toBeGreaterThanOrEqual(60);
    }
  });

  it('puts each world on its own page and the post-game levels on the margin page', () => {
    for (const n of nodes.slice(1)) {
      const pg = pages[n.page];
      if (n.level!.region === 'margin') expect(pg.kind).toBe('margin');
      else expect(pg.world).toBe(n.level!.world);
      expect(n.x).toBeGreaterThanOrEqual(n.page * PAGE_W);
      expect(n.x).toBeLessThan((n.page + 1) * PAGE_W);
    }
    expect(nodes.filter((n) => n.level?.region === 'margin').map((n) => n.id)).toEqual(['w4-4', 'w4-5', 'w4-6', 'w4-7', 'w4-8', 'w4-9', 'w4-10']);
  });

  it('hides the margin until its levels unlock, without moving revealed nodes', () => {
    expect(mapAt('w4-3').pages.some((p) => p.kind === 'margin')).toBe(false);
    const part = mapAt('w4-5').nodes.filter((n) => n.level?.region);
    expect(part.map((n) => n.id)).toEqual(['w4-4', 'w4-5']);
    for (const n of part) expect(nodes.find((m) => m.id === n.id)).toMatchObject({ x: n.x, y: n.y });
  });
});

describe('world map navigation', () => {
  it('walks levels in play order with left/right, across page edges', () => {
    const { go } = mapAt(null);
    expect(go('w1-1', 'right')).toBe('w1-2');
    expect(go('w1-2', 'left')).toBe('w1-1');
    expect(go('w1-1', 'left')).toBe(SHRINE_ID);
    expect(go(SHRINE_ID, 'right')).toBe('w1-1');
    expect(go('w1-5', 'right')).toBe('w2-1');
    expect(go('w2-1', 'left')).toBe('w1-5');
    expect(go('w4-3', 'right')).toBe('w4-4');
    expect(go('w4-8', 'right')).toBe('w4-9');
    expect(go('w4-9', 'right')).toBe('w4-10');
    expect(go('w4-10', 'right')).toBeUndefined();
  });

  it('jumps worlds with up/down, landing on the first uncleared level', () => {
    const { go } = mapAt('w2-3');
    expect(go('w1-2', 'down')).toBe('w2-3');
    expect(go('w2-3', 'up')).toBe('w1-5'); // world 1 all cleared: its last level
    expect(go('w1-5', 'up')).toBe(SHRINE_ID);
    expect(go(SHRINE_ID, 'up')).toBeUndefined();
    expect(go('w2-3', 'down')).toBeUndefined(); // world 3 still locked
  });

  it('skips locked levels', () => {
    const { go, nodes, unlocked } = mapAt('w1-3');
    expect(go('w1-2', 'right')).toBe('w1-3');
    expect(unlocked(nodes.findIndex((n) => n.id === 'w1-4'))).toBe(false);
    expect(go('w1-3', 'right')).toBeUndefined();
    expect(go('w1-3', 'down')).toBeUndefined();
  });

  it('finds a focus on every reachable page and none on locked ones', () => {
    const { pages, nodes, unlocked, done } = mapAt('w2-3');
    const focus = pages.map((_, p) => pageFocus(nodes, p, unlocked, done));
    expect(focus.map((i) => nodes[i]?.id)).toEqual([SHRINE_ID, 'w1-5', 'w2-3', undefined, undefined]);
  });

  it('can reach every unlocked node from the shrine', () => {
    for (const upTo of ['w1-1', 'w2-3', 'w4-2', 'w4-6', null]) {
      const { nodes, unlocked, done } = mapAt(upTo);
      const seen = new Set([0]);
      const queue = [0];
      while (queue.length) {
        const i = queue.shift()!;
        for (const d of ['up', 'down', 'left', 'right'] as Dir[]) {
          const j = neighbor(nodes, i, d, unlocked, done);
          if (j < 0) continue;
          expect(unlocked(j)).toBe(true);
          if (!seen.has(j)) {
            seen.add(j);
            queue.push(j);
          }
        }
      }
      const open = nodes.map((_, i) => i).filter(unlocked);
      expect([...seen].sort((a, b) => a - b), `progress ${upTo}`).toEqual(open);
    }
  });
});

describe('boss-keyed level lookups', () => {
  it('finds stage levels by boss, not id', () => {
    expect(levelOfBoss('moth')?.id).toBe('w4-3');
    expect(levelOfBoss('aurren')?.id).toBe('w4-4');
    expect(levelOfBoss('erratum')?.mapDeco).toBe('ampersand');
    expect(levelOfBoss('colossus')?.mapDeco).toBe('mountain');
    expect(levelOfBoss('cantor')?.mapDeco).toBe('bell');
    expect(levelOfBoss('umbra')?.mapDeco).toBe('lantern');
    expect(bossOf('w1-1')).toBeUndefined();
    expect(bossOf('nope')).toBeUndefined();
  });
});
