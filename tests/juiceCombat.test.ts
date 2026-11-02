import { describe, it, expect } from 'vitest';
import { CapPool, hitImpactMul, isBigKill, resolveImpact, squashAt, stepDebris, type Debris } from '../src/core/juiceMath';
import { JUICE, TILE } from '../src/config';

describe('hitImpactMul', () => {
  const M = JUICE.comboMul;
  it('rises along the ground combo', () => {
    const muls = [0, 1, 2, 3].map((s) => hitImpactMul('attack', s, 0, M, JUICE.chargedHeavyMul));
    expect(muls).toEqual([1, 1.15, 1.3, 1.5]);
    for (let i = 1; i < muls.length; i++) expect(muls[i]).toBeGreaterThan(muls[i - 1]);
  });
  it('clamps out-of-range steps, handles air combo, heavy and other swings', () => {
    expect(hitImpactMul('attack', 9, 0, M, 1.4)).toBe(1.5);
    expect(hitImpactMul('attack', -2, 0, M, 1.4)).toBe(1);
    expect(hitImpactMul('airAttack', 0, 2, M, 1.4)).toBe(1.15);
    expect(hitImpactMul('heavy', 0, 0, M, 1.4)).toBe(1.4);
    expect(hitImpactMul('upAttack', 2, 0, M, 1.4)).toBe(1);
    expect(hitImpactMul(null, 2, 0, M, 1.4)).toBe(1);
  });
  it('max combo mul stays within impact limits', () => {
    const r = resolveImpact(JUICE.impact.heavy, Math.max(...M) * 1.3);
    expect(r.hitstop).toBeLessThanOrEqual(300);
  });
});

describe('isBigKill', () => {
  const base = { riposte: false, othersInView: 0, msSinceLastKill: 1000, bossAlive: false, groupWindowMs: 4000 };
  it('riposte kills are always big', () => {
    expect(isBigKill({ ...base, riposte: true, othersInView: 3, bossAlive: true })).toBe(true);
  });
  it('clearing the last enemy on screen after a recent kill is big', () => {
    expect(isBigKill(base)).toBe(true);
  });
  it('not big with enemies left, a lone straggler, or a boss alive', () => {
    expect(isBigKill({ ...base, othersInView: 1 })).toBe(false);
    expect(isBigKill({ ...base, msSinceLastKill: 9000 })).toBe(false);
    expect(isBigKill({ ...base, bossAlive: true })).toBe(false);
  });
});

describe('squashAt', () => {
  it('starts at the squash and eases back to exactly 1', () => {
    expect(squashAt(0.8, 1.2, 0, 100)).toEqual({ x: 0.8, y: 1.2 });
    const mid = squashAt(0.8, 1.2, 50, 100);
    expect(mid.x).toBeGreaterThan(0.8);
    expect(mid.x).toBeLessThan(1);
    expect(squashAt(0.8, 1.2, 100, 100)).toEqual({ x: 1, y: 1 });
    expect(squashAt(0.8, 1.2, 10, 0)).toEqual({ x: 1, y: 1 });
  });
});

describe('stepDebris', () => {
  // floor: every tile at row >= 10 (y >= 160) is solid
  const floor = (_x: number, y: number) => y >= 10 * TILE;
  const mk = (o: Partial<Debris> = {}): Debris => ({ x: 50, y: 100, vx: 100, vy: 0, rot: 0, spin: 5, halfH: 4, bounces: 0, maxBounces: 1, restitution: 0.4, friction: 0.5, settled: false, ...o });

  it('falls, bounces once, then settles on the tile top', () => {
    const d = mk();
    const events: string[] = [];
    for (let i = 0; i < 400 && !d.settled; i++) {
      const e = stepDebris(d, 16, 900, floor);
      if (e) events.push(e);
    }
    expect(events).toEqual(['bounce', 'settle']);
    expect(d.y + d.halfH).toBe(10 * TILE);
    expect(d.vx).toBe(0);
    expect(stepDebris(d, 16, 900, floor)).toBeNull();
  });
  it('reflects off walls', () => {
    const wall = (x: number) => x >= 60;
    const d = mk({ x: 58, vx: 300 });
    stepDebris(d, 16, 0, wall);
    expect(d.vx).toBeLessThan(0);
    expect(d.x).toBe(58);
  });
  it('never passes through the floor at max fall speed', () => {
    const d = mk({ vy: 600, y: 140, maxBounces: 0 });
    stepDebris(d, 50, 900, floor);
    expect(d.y + d.halfH).toBeLessThanOrEqual(10 * TILE);
  });
});

describe('CapPool (gib cap)', () => {
  it('never holds more than cap live items and recycles the oldest', () => {
    let made = 0;
    const pool = new CapPool(JUICE.gibs.cap, () => ({ id: made++ }));
    const first = pool.acquire()[0];
    for (let i = 0; i < JUICE.gibs.cap * 2; i++) pool.acquire();
    expect(pool.live.length).toBe(JUICE.gibs.cap);
    expect(made).toBe(JUICE.gibs.cap);
    expect(pool.live).toContain(first); // recycled back into use
  });
  it('reuses released items before making new ones', () => {
    let made = 0;
    const pool = new CapPool(3, () => ({ id: made++ }));
    const [a] = pool.acquire();
    pool.release(a);
    const [b, recycled] = pool.acquire();
    expect(b).toBe(a);
    expect(recycled).toBe(false);
    expect(made).toBe(1);
  });
});
