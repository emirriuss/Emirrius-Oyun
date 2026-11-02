import { describe, it, expect } from 'vitest';
import {
  duelistWeights,
  pickDuelistMove,
  duelistTimings,
  cutColumns,
  sinceHeavy,
  HEAVY_MOVES,
  HEAVY_EVERY,
  type DuelistCtx,
  type DuelistMove,
} from '../src/combat/duelistPlan';

function mulberry32(a: number): () => number {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const RANGES = [30, 100, 220];
const ctx = (phase: number, dx: number, high = false, shadow = true): DuelistCtx => ({ phase, dx, high, shadow });
const movesOf = (phase: number, shadow = true) => {
  const s = new Set<DuelistMove>();
  for (const dx of RANGES) for (const high of [false, true]) for (const [m] of duelistWeights(ctx(phase, dx, high, shadow))) s.add(m);
  return s;
};

describe('duelistWeights', () => {
  it('each phase has its own kit', () => {
    expect([...movesOf(1)].sort()).toEqual(['backstep', 'combo', 'fan', 'iaido', 'rising']);
    for (const m of ['triple', 'crossCut', 'guard', 'fallingMoon', 'blink'] as const) expect(movesOf(2)).toContain(m);
    for (const m of ['pincer', 'crossedFans', 'thousandCuts'] as const) expect(movesOf(3)).toContain(m);
    expect(movesOf(1)).not.toContain('triple');
    expect(movesOf(2)).not.toContain('thousandCuts');
  });

  it('every phase has a heavy (punishable) move at every range', () => {
    for (const p of [1, 2, 3])
      for (const dx of RANGES) expect(duelistWeights(ctx(p, dx)).some(([m]) => HEAVY_MOVES.includes(m))).toBe(true);
  });

  it('shadow moves need a live shadow', () => {
    const solo = movesOf(3, false);
    expect(solo).not.toContain('pincer');
    expect(solo).not.toContain('crossedFans');
    expect(solo).toContain('thousandCuts');
  });

  it('answers ledge camping with the rising cut', () => {
    for (const p of [1, 2, 3]) expect(duelistWeights(ctx(p, 100, true)).map(([m]) => m)).toContain('rising');
    expect(duelistWeights(ctx(1, 100, false)).map(([m]) => m)).not.toContain('rising');
  });

  it('clamps phases', () => {
    expect(duelistWeights(ctx(7, 30))).toEqual(duelistWeights(ctx(3, 30)));
  });
});

describe('pickDuelistMove', () => {
  it('never repeats, forces a heavy every few moves and uses every move', () => {
    for (const p of [1, 2, 3]) {
      const rnd = mulberry32(p * 99);
      const hist: DuelistMove[] = [];
      for (let i = 0; i < 600; i++) {
        const c = ctx(p, RANGES[i % 3], i % 7 === 0, i % 11 !== 0);
        const m = pickDuelistMove(c, hist, rnd);
        expect(duelistWeights(c).map(([x]) => x)).toContain(m);
        if (hist.length) expect(m).not.toBe(hist[hist.length - 1]);
        hist.push(m);
        expect(sinceHeavy(hist)).toBeLessThanOrEqual(HEAVY_EVERY);
      }
      expect(new Set(hist)).toEqual(new Set([...movesOf(p, true), ...movesOf(p, false)]));
    }
  });

  it('follows a backstep with an iaido most of the time', () => {
    const rnd = mulberry32(7);
    let n = 0;
    for (let i = 0; i < 400; i++) if (pickDuelistMove(ctx(1, 100), ['combo', 'backstep'], rnd) === 'iaido') n++;
    expect(n / 400).toBeGreaterThan(0.6);
  });
});

describe('duelistTimings', () => {
  it('telegraphs shrink every phase but stay above a fair minimum', () => {
    for (const k of ['dash', 'iaido', 'rising', 'fan', 'crossCut', 'fallHover', 'thrust'] as const) {
      expect(duelistTimings(2)[k]).toBeLessThan(duelistTimings(1)[k]);
      expect(duelistTimings(3)[k]).toBeLessThan(duelistTimings(2)[k]);
      expect(duelistTimings(3)[k]).toBeGreaterThanOrEqual(190);
    }
  });
  it('the thousand cuts window is the longest punish', () => {
    const t = duelistTimings(3);
    expect(t.recoverCuts).toBeGreaterThan(Math.max(t.recoverFall, t.recoverIaido, t.recoverGuard));
  });
});

describe('cutColumns', () => {
  const L = 16, R = 464;
  it('stays inside the arena, sweeps in order and always leaves a gap', () => {
    for (let s = 0; s < 200; s++) {
      const fromLeft = s % 2 === 0;
      const cols = cutColumns(L, R, fromLeft, mulberry32(s));
      expect(cols.map((c) => c.order)).toEqual(cols.map((_, i) => i));
      for (const c of cols) {
        expect(c.x).toBeGreaterThanOrEqual(L - 0.001);
        expect(c.x + c.w).toBeLessThanOrEqual(R + 0.001);
      }
      const xs = cols.map((c) => c.x);
      expect(xs).toEqual([...xs].sort((a, b) => (fromLeft ? a - b : b - a)));
      // covered width < arena width → at least one safe slot of a full column width
      const slot = cols[0].w;
      const n = Math.round((R - L) / slot);
      expect(cols.length).toBeLessThan(n);
      expect(slot).toBeGreaterThanOrEqual(32);
      // outer columns are always cut (no hiding in the corners)
      expect(xs).toContain(L);
      expect(xs.some((x) => Math.abs(x + slot - R) < 0.01)).toBe(true);
    }
  });
});
