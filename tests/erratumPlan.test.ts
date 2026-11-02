import { describe, it, expect } from 'vitest';
import {
  erratumWeights, pickMove, strikeSpans, longestSafe, nearestSafe, glyphVolley, marginNote, heartsToSteal,
  letterboxGap, pushSample, sampleAt, act4Press, yesDrift, takeLine, ACT4_NOS, WINDUP_FLOOR,
  type ErratumMove, type Sample,
} from '../src/combat/erratumPlan';

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const moves = (w: [ErratumMove, number][]) => w.map(([m]) => m);
const none = new Set<ErratumMove>();

describe('erratumWeights', () => {
  it('draft 1 is the page only', () => {
    for (const dx of [40, 200]) expect(moves(erratumWeights(1, dx, false, none)).sort()).toEqual(['glyphs', 'insert', 'strike', 'typo']);
  });
  it('draft 2 adds the HUD moves', () => {
    expect(moves(erratumWeights(2, 100, false, none))).toEqual(expect.arrayContaining(['bar', 'hearts', 'rotate', 'letterbox']));
  });
  it('draft 3 adds the engine moves; crash and credits are one-shots', () => {
    const m = moves(erratumWeights(3, 100, false, none));
    expect(m).toEqual(expect.arrayContaining(['crash', 'title', 'map', 'credits', 'rewind']));
    const used = new Set<ErratumMove>(['crash', 'credits']);
    const m2 = moves(erratumWeights(3, 100, false, used));
    expect(m2).not.toContain('crash');
    expect(m2).not.toContain('credits');
  });
  it('screen tricks off removes rotation (the crash stays, in its gentle in-arena form)', () => {
    for (const p of [2, 3]) expect(moves(erratumWeights(p, 100, false, none, false))).not.toContain('rotate');
    expect(moves(erratumWeights(3, 100, false, none, false))).toContain('crash');
  });
  it('never picks the same move three times in a row', () => {
    const rnd = mulberry32(7);
    for (const p of [1, 2, 3]) {
      const hist: ErratumMove[] = [];
      for (let i = 0; i < 400; i++) {
        const m = pickMove(erratumWeights(p, 100, i % 3 === 0, none), hist, rnd)!;
        expect(m).toBeTruthy();
        if (hist.length >= 2) expect(hist[hist.length - 1] === m && hist[hist.length - 2] === m).toBe(false);
        hist.push(m);
      }
    }
  });
  it('windup floors shrink but stay readable', () => {
    expect(WINDUP_FLOOR[0]).toBeGreaterThan(WINDUP_FLOOR[2]);
    expect(Math.min(...WINDUP_FLOOR)).toBeGreaterThanOrEqual(400);
  });
});

describe('strikeSpans', () => {
  const L = 1, R = 28;
  it('keeps the arena winnable for every seed, player position and draft', () => {
    for (let seed = 1; seed < 300; seed++) {
      const rnd = mulberry32(seed);
      for (const p of [1, 2, 3]) {
        const pc = L + Math.floor(rnd() * (R - L + 1));
        const s = strikeSpans(L, R, pc, p, rnd);
        expect(s.length).toBeGreaterThan(0);
        expect(s.length).toBeLessThanOrEqual(p);
        const erased = s.reduce((a, x) => a + x.c1 - x.c0 + 1, 0);
        expect(erased).toBeLessThanOrEqual(Math.floor((R - L + 1) * 0.4));
        expect(longestSafe(L, R, s)).toBeGreaterThanOrEqual(4);
        for (const x of s) {
          expect(x.c0).toBeGreaterThanOrEqual(L);
          expect(x.c1).toBeLessThanOrEqual(R);
        }
        for (let i = 1; i < s.length; i++) expect(s[i].c0 - s[i - 1].c1).toBeGreaterThan(3);
      }
    }
  });
  it('the first span is aimed near the player', () => {
    let near = 0;
    for (let seed = 1; seed < 200; seed++) {
      const s = strikeSpans(L, R, 14, 1, mulberry32(seed));
      if (s.some((x) => x.c0 - 3 <= 14 && x.c1 + 3 >= 14)) near++;
    }
    expect(near).toBeGreaterThan(180);
  });
  it('nearestSafe steps off erased columns', () => {
    const spans = [{ c0: 5, c1: 9 }];
    expect(nearestSafe(7, 1, 28, spans)).toSatisfy((c: number) => c === 4 || c === 10);
    expect(nearestSafe(12, 1, 28, spans)).toBe(12);
  });
});

describe('glyphVolley', () => {
  it('always gives a stepping stone and at most one P / E', () => {
    for (let seed = 1; seed < 300; seed++) {
      const v = glyphVolley(5, 1 + (seed % 3), mulberry32(seed));
      expect(v).toHaveLength(5);
      expect(v).toContain('=');
      expect(v.filter((g) => g === 'P').length).toBeLessThanOrEqual(1);
      expect(v.filter((g) => g === 'E').length).toBeLessThanOrEqual(1);
    }
  });
});

describe('marginNote', () => {
  it('is truthful when it says it is, and never lies 3 times in a row', () => {
    const rnd = mulberry32(3);
    for (const p of [1, 2, 3]) {
      let lies = 0;
      for (let i = 0; i < 500; i++) {
        const n = marginNote(p, lies, rnd);
        expect(n.honest).toBe(n.claim === n.side);
        lies = n.honest ? 0 : lies + 1;
        expect(lies).toBeLessThanOrEqual(2);
      }
    }
  });
});

describe('heartsToSteal', () => {
  it('never takes the last heart', () => {
    for (let hp = 0; hp <= 12; hp++) for (const d of [false, true]) {
      const n = heartsToSteal(hp, d);
      expect(n).toBeGreaterThanOrEqual(0);
      if (hp > 0) expect(hp - n).toBeGreaterThanOrEqual(1);
      expect(n).toBeLessThanOrEqual(d ? 3 : 2);
    }
  });
});

describe('letterboxGap', () => {
  it('stays inside the arena and away from the player', () => {
    for (let seed = 1; seed < 300; seed++) {
      const rnd = mulberry32(seed);
      const pc = 1 + Math.floor(rnd() * 28);
      const c0 = letterboxGap(1, 28, pc, 3, rnd);
      expect(c0).toBeGreaterThanOrEqual(1);
      expect(c0 + 2).toBeLessThanOrEqual(28);
    }
  });
});

describe('rewind buffer', () => {
  it('keeps ~2s and interpolates', () => {
    let b: Sample[] = [];
    for (let t = 0; t <= 5000; t += 100) b = pushSample(b, { t, x: t / 10, y: 0 });
    expect(b[b.length - 1].t - b[0].t).toBeLessThanOrEqual(2200);
    const p = sampleAt(b, 50)!;
    expect(p.x).toBeCloseTo(b[0].x + 5, 5);
    expect(sampleAt(b, 99999)!.x).toBe(500);
    expect(sampleAt([], 0)).toBeNull();
  });
});

describe('act 4', () => {
  it('needs ACT4_NOS NOs in a row; YES resets', () => {
    let s = { nos: 0, yeses: 0, done: false };
    s = act4Press(s, 'no');
    s = act4Press(s, 'yes');
    expect(s.nos).toBe(0);
    expect(s.yeses).toBe(1);
    for (let i = 0; i < ACT4_NOS; i++) s = act4Press(s, 'no');
    expect(s.done).toBe(true);
    expect(act4Press(s, 'yes')).toBe(s);
    expect(yesDrift(2)).toBeGreaterThan(yesDrift(0));
  });
  it('take line', () => {
    expect(takeLine('d2', 3)).toBe('Draft 2, take 4');
    expect(takeLine(undefined, 0)).toBe('Draft 1, take 1');
  });
});
