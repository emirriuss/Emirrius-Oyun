import { describe, it, expect } from 'vitest';
import { swingParryWindowMs, parryDirectionOk, canParryHit } from '../src/combat/parryWindow';
import { PLAYER } from '../src/config';

describe('swingParryWindowMs', () => {
  const fresh = { sinceLastSwingEndMs: 9999, comboFollowup: false, chargedHeavy: false };
  it('fresh swing gets the normal window', () => {
    expect(swingParryWindowMs(fresh)).toBe(PLAYER.parryWindowMs);
  });
  it('combo follow-up gets the chain window', () => {
    expect(swingParryWindowMs({ ...fresh, comboFollowup: true })).toBe(PLAYER.parryWindowChainMs);
  });
  it('swinging soon after the last swing gets the chain window', () => {
    expect(swingParryWindowMs({ ...fresh, sinceLastSwingEndMs: PLAYER.parryFreshGapMs - 1 })).toBe(PLAYER.parryWindowChainMs);
    expect(swingParryWindowMs({ ...fresh, sinceLastSwingEndMs: PLAYER.parryFreshGapMs })).toBe(PLAYER.parryWindowMs);
  });
  it('charged heavy wins over everything', () => {
    expect(swingParryWindowMs({ sinceLastSwingEndMs: 0, comboFollowup: true, chargedHeavy: true })).toBe(PLAYER.parryWindowHeavyMs);
  });
  it('bonusMs widens every window kind', () => {
    expect(swingParryWindowMs({ ...fresh, bonusMs: 25 })).toBe(PLAYER.parryWindowMs + 25);
    expect(swingParryWindowMs({ ...fresh, comboFollowup: true, bonusMs: 25 })).toBe(PLAYER.parryWindowChainMs + 25);
    expect(swingParryWindowMs({ ...fresh, chargedHeavy: true, bonusMs: 25 })).toBe(PLAYER.parryWindowHeavyMs + 25);
  });
  it('windows are ordered chain < normal < heavy', () => {
    expect(PLAYER.parryWindowChainMs).toBeLessThan(PLAYER.parryWindowMs);
    expect(PLAYER.parryWindowMs).toBeLessThan(PLAYER.parryWindowHeavyMs);
  });
});

describe('parryDirectionOk', () => {
  it('accepts melee/projectile from the front', () => {
    expect(parryDirectionOk('melee', 120, 100, 1, false)).toBe(true);
    expect(parryDirectionOk('projectile', 80, 100, -1, false)).toBe(true);
  });
  it('allows 4px grace behind, rejects further behind', () => {
    expect(parryDirectionOk('melee', 96, 100, 1, false)).toBe(true);
    expect(parryDirectionOk('melee', 95, 100, 1, false)).toBe(false);
    expect(parryDirectionOk('projectile', 120, 100, -1, false)).toBe(false);
  });
  it('up-slash accepts either side', () => {
    expect(parryDirectionOk('melee', 50, 100, 1, true)).toBe(true);
    expect(parryDirectionOk('projectile', 150, 100, -1, true)).toBe(true);
  });
  it('never parries hazards, contact or untyped hits', () => {
    expect(parryDirectionOk('hazard', 120, 100, 1, false)).toBe(false);
    expect(parryDirectionOk('contact', 120, 100, 1, true)).toBe(false);
    expect(parryDirectionOk(undefined, 120, 100, 1, false)).toBe(false);
  });
});

describe('canParryHit', () => {
  it('requires the parryable flag', () => {
    expect(canParryHit({ kind: 'melee', sourceX: 120, parryable: true }, 100, 1, false)).toBe(true);
    expect(canParryHit({ kind: 'melee', sourceX: 120, parryable: false }, 100, 1, false)).toBe(false);
    expect(canParryHit({ kind: 'melee', sourceX: 120 }, 100, 1, false)).toBe(false);
  });
  it('rejects parryable hits from behind on a normal swing', () => {
    expect(canParryHit({ kind: 'projectile', sourceX: 60, parryable: true }, 100, 1, false)).toBe(false);
  });
});
