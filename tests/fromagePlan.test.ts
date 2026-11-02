import { describe, it, expect } from 'vitest';
import { wheelFor, spinResult, nudgeAllowed, stealAmount, planSpin, tickDelays, wrap, MAX_NUDGES, WHEELS } from '../src/combat/fromagePlan';

describe('wheelFor', () => {
  it('P1 has only the basic acts', () => {
    expect(new Set(wheelFor(1))).toEqual(new Set(['roll', 'crackers', 'mice']));
  });
  it('P2 adds fondue and the grater, no game-show tricks yet', () => {
    const w = wheelFor(2);
    expect(w).toContain('fondue');
    expect(w).toContain('grater');
    expect(w).not.toContain('bankrupt');
    expect(w).not.toContain('double');
  });
  it('P3 adds BANKRUPT and DOUBLE OR NOTHING; phases clamp', () => {
    expect(wheelFor(3)).toContain('bankrupt');
    expect(wheelFor(3)).toContain('double');
    expect(wheelFor(7)).toBe(WHEELS[3]);
    expect(wheelFor(0)).toBe(WHEELS[1]);
  });
});

describe('spin + nudges', () => {
  it('wraps around the wheel', () => {
    expect(spinResult(6, 4, 3, 0)).toBe(1);
    expect(spinResult(6, 0, 6, 0)).toBe(0);
    expect(wrap(-1, 6)).toBe(5);
  });
  it('each nudge advances the landing wedge by one', () => {
    const base = spinResult(8, 2, 9, 0);
    expect(spinResult(8, 2, 9, 1)).toBe((base + 1) % 8);
    expect(spinResult(8, 2, 9, 2)).toBe((base + 2) % 8);
  });
  it('caps nudges per spin', () => {
    expect(nudgeAllowed(0)).toBe(true);
    expect(nudgeAllowed(MAX_NUDGES - 1)).toBe(true);
    expect(nudgeAllowed(MAX_NUDGES)).toBe(false);
  });
});

describe('stealAmount', () => {
  it('never takes more than the player has, nor more than 10', () => {
    expect(stealAmount(0)).toBe(0);
    expect(stealAmount(3)).toBe(3);
    expect(stealAmount(250)).toBe(10);
    expect(stealAmount(-5)).toBe(0);
  });
});

describe('planSpin', () => {
  it('always spins at least one full lap', () => {
    for (const p of [1, 2, 3]) {
      const w = wheelFor(p);
      for (let i = 0; i < 20; i++) {
        const t = planSpin(w, i % w.length, [], () => i / 20);
        expect(t).toBeGreaterThanOrEqual(w.length);
        expect(t).toBeLessThan(w.length * 2);
      }
    }
  });
  it('never lands on the same move 3x in a row', () => {
    const w = wheelFor(1);
    for (let s = 0; s < w.length; s++)
      for (let r = 0; r < 1; r += 0.05) {
        const t = planSpin(w, s, ['roll', 'roll'], () => r);
        expect(w[spinResult(w.length, s, t, 0)]).not.toBe('roll');
      }
  });
  it('never offers DOUBLE OR NOTHING twice in a row', () => {
    const w = wheelFor(3);
    for (let s = 0; s < w.length; s++)
      for (let r = 0; r < 1; r += 0.05) {
        const t = planSpin(w, s, ['roll', 'double'], () => r);
        expect(w[spinResult(w.length, s, t, 0)]).not.toBe('double');
      }
  });
});

describe('tickDelays', () => {
  it('sums to the spin time and slows down', () => {
    const d = tickDelays(10, 900);
    expect(d.reduce((s, x) => s + x, 0)).toBeCloseTo(900, 5);
    expect(d[9]).toBeGreaterThan(d[0]);
    expect(tickDelays(0, 900)).toEqual([]);
  });
});
