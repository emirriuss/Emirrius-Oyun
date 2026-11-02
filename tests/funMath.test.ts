import { describe, it, expect } from 'vitest';
import { hickWindup, travelMs, hitProb, requiredMs, expectedHits, ttk, entropyBits, capRepeats, seeded, median, SKILL, COMBO_DPS, REACH } from '../src/combat/funMath';

describe('funMath', () => {
  it('Hick floor: 480 ms for one answer, ~568 for two, 330 for an anticipated beat', () => {
    expect(hickWindup(1)).toBe(480);
    expect(hickWindup(2)).toBe(568);
    expect(hickWindup(3)).toBe(630);
    expect(hickWindup(0)).toBe(330);
  });

  it('travel is free within one dash, then costs running time', () => {
    expect(travelMs(REACH.dash)).toBe(0);
    expect(travelMs(REACH.dash + 150)).toBeCloseTo(1000);
    expect(hickWindup(1, REACH.dash + 75)).toBe(980);
  });

  it('hit chance: symmetric logistic around the required time, floored by the lapse rate', () => {
    const s = SKILL.average;
    const r = requiredMs(1, 0, s);
    expect(hitProb(r, 1, 0, s)).toBeCloseTo(s.lapse + (1 - s.lapse) * 0.5);
    const lo = hitProb(r - 100, 1, 0, s), hi = hitProb(r + 100, 1, 0, s);
    expect((lo - s.lapse) / (1 - s.lapse) + (hi - s.lapse) / (1 - s.lapse)).toBeCloseTo(1);
    expect(hitProb(5000, 1, 0, s)).toBeCloseTo(s.lapse);
  });

  it('better skill profiles get hit less by the same telegraph', () => {
    for (const w of [480, 600, 800]) {
      expect(hitProb(w, 1, 0, SKILL.novice)).toBeGreaterThan(hitProb(w, 1, 0, SKILL.average));
      expect(hitProb(w, 1, 0, SKILL.average)).toBeGreaterThan(hitProb(w, 1, 0, SKILL.expert));
    }
  });

  it('expected hits, TTK, combo DPS', () => {
    expect(expectedHits([{ count: 10, p: 0.1 }, { count: 4, p: 0.5 }])).toBeCloseTo(3);
    expect(COMBO_DPS).toBeCloseTo(5.714, 2);
    expect(ttk(120, 6, 0.25)).toBeCloseTo(80);
  });

  it('entropy: uniform over 4 = 2 bits, single = 0, skew lowers it', () => {
    expect(entropyBits([1, 1, 1, 1])).toBeCloseTo(2);
    expect(entropyBits([5])).toBe(0);
    expect(entropyBits([4, 1, 1, 1])).toBeLessThan(2);
    expect(entropyBits([])).toBe(0);
  });

  it('capRepeats drops a move used twice in the last 4, but never empties the list', () => {
    const w: ['a' | 'b', number][] = [['a', 1], ['b', 1]];
    expect(capRepeats(w, ['a', 'b', 'a']).map(([m]) => m)).toEqual(['b']);
    expect(capRepeats(w, ['a', 'a', 'b', 'b']).map(([m]) => m)).toEqual(['a', 'b']);
  });

  it('seeded rng is reproducible and in [0,1); median', () => {
    const a = seeded(42), b = seeded(42);
    const xs = Array.from({ length: 100 }, () => a());
    expect(xs).toEqual(Array.from({ length: 100 }, () => b()));
    expect(xs.every((x) => x >= 0 && x < 1)).toBe(true);
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
  });
});
