import { describe, it, expect } from 'vitest';
import { wardenWeights, pickMove, WARDEN_CAMP_MS, type WardenMove } from '../src/combat/wardenPlan';

const moves = (w: [WardenMove, number][]) => w.map(([m]) => m);
const weightOf = (w: [WardenMove, number][], m: WardenMove) => w.find(([x]) => x === m)?.[1] ?? 0;
const ALL_RANGES = [40, 120, 260];

describe('wardenWeights', () => {
  it('P1 only has the basic kit', () => {
    for (const dx of ALL_RANGES) {
      for (const m of moves(wardenWeights(1, dx, false, 0))) expect(['slam', 'sweep', 'hook']).toContain(m);
    }
    expect(moves(wardenWeights(1, 40, true, 9999))).toEqual(['hook']);
  });

  it('P2 adds combo up close and rake at mid/far range', () => {
    expect(moves(wardenWeights(2, 40, false, 0))).toContain('combo');
    expect(moves(wardenWeights(2, 120, false, 0))).toEqual(expect.arrayContaining(['whirl', 'rake']));
    expect(moves(wardenWeights(2, 260, false, 0))).toEqual(expect.arrayContaining(['leap', 'rake']));
    expect(moves(wardenWeights(2, 40, false, 0))).not.toContain('quake');
  });

  it('P2 punishes ledge camping with debris', () => {
    expect(moves(wardenWeights(2, 40, true, 0))).toContain('debris');
  });

  it('P3 adds Twin Quake close and mid, and favours the combo', () => {
    expect(moves(wardenWeights(3, 40, false, 0))).toContain('quake');
    expect(moves(wardenWeights(3, 120, false, 0))).toContain('quake');
    expect(moves(wardenWeights(3, 260, false, 0))).not.toContain('quake');
    expect(weightOf(wardenWeights(3, 40, false, 0), 'combo')).toBeGreaterThan(weightOf(wardenWeights(2, 40, false, 0), 'combo'));
  });

  it('leans on the hook once the player camps a ledge', () => {
    const fresh = weightOf(wardenWeights(2, 40, true, 0), 'hook');
    const camped = weightOf(wardenWeights(2, 40, true, WARDEN_CAMP_MS + 1), 'hook');
    expect(camped).toBeGreaterThan(fresh);
  });

  it('clamps phases past 3', () => {
    expect(wardenWeights(5, 40, false, 0)).toEqual(wardenWeights(3, 40, false, 0));
  });
});

describe('pickMove', () => {
  it('never picks the same move 3x in a row', () => {
    const w = wardenWeights(3, 40, false, 0);
    for (let i = 0; i < 200; i++) {
      const r = i / 200;
      expect(pickMove(w, ['slam', 'slam'], () => r)).not.toBe('slam');
    }
  });

  it('allows a move twice in a row', () => {
    expect(pickMove([['hook', 1]], ['sweep', 'hook'], () => 0)).toBe('hook');
  });

  it('returns null when nothing is left', () => {
    expect(pickMove([['hook', 3]], ['hook', 'hook'])).toBeNull();
    expect(pickMove([], [])).toBeNull();
  });

  it('respects weights', () => {
    const w: [WardenMove, number][] = [['slam', 1], ['sweep', 3]];
    expect(pickMove(w, [], () => 0.1)).toBe('slam');
    expect(pickMove(w, [], () => 0.5)).toBe('sweep');
    expect(pickMove(w, [], () => 0.999)).toBe('sweep');
  });
});
