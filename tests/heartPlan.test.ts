import { describe, it, expect } from 'vitest';
import { shouldSpawnHeart, parryDropsHeart, pickHeartX } from '../src/combat/heartPlan';

describe('shouldSpawnHeart', () => {
  const due = { elapsedSinceLast: 20000, periodicMs: 20000, playerHp: 3, playerMaxHp: 5, heartsOnField: 0, maxOnField: 1 };
  it('spawns when due, hurt and field has room', () => {
    expect(shouldSpawnHeart(due)).toBe(true);
  });
  it('waits for the period', () => {
    expect(shouldSpawnHeart({ ...due, elapsedSinceLast: 19999 })).toBe(false);
  });
  it('is off when periodicMs is 0', () => {
    expect(shouldSpawnHeart({ ...due, periodicMs: 0, elapsedSinceLast: 99999 })).toBe(false);
  });
  it('never spawns at full hp', () => {
    expect(shouldSpawnHeart({ ...due, playerHp: 5 })).toBe(false);
  });
  it('respects maxOnField', () => {
    expect(shouldSpawnHeart({ ...due, heartsOnField: 1 })).toBe(false);
    expect(shouldSpawnHeart({ ...due, heartsOnField: 1, maxOnField: 2 })).toBe(true);
  });
});

describe('parryDropsHeart', () => {
  it('drops on every Nth parry', () => {
    expect([1, 2, 3, 4, 5, 6].map((n) => parryDropsHeart(n, 3))).toEqual([false, false, true, false, false, true]);
  });
  it('is off when perParries is 0', () => {
    expect(parryDropsHeart(3, 0)).toBe(false);
    expect(parryDropsHeart(0, 3)).toBe(false);
  });
});

describe('pickHeartX', () => {
  it('picks the side far from the boss', () => {
    expect(pickHeartX(400, 0, 480)).toBeLessThan(240);
    expect(pickHeartX(60, 0, 480)).toBeGreaterThan(240);
  });
  it('stays inside the margins', () => {
    for (const bx of [0, 100, 240, 380, 480]) {
      const x = pickHeartX(bx, 0, 480, 24);
      expect(x).toBeGreaterThanOrEqual(24);
      expect(x).toBeLessThanOrEqual(456);
    }
  });
  it('falls back to the centre when the range is too small', () => {
    expect(pickHeartX(50, 40, 80, 24)).toBe(60);
  });
});
