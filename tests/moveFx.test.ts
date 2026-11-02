import { describe, it, expect } from 'vitest';
import { CapPool, fallLookDown, isFootfall, isSkid, landStrength, lerpPair, lookAheadTarget, settlePx, smoothTo } from '../src/core/moveFx';
import { MOVE_FX, PLAYER } from '../src/config';

describe('smoothTo', () => {
  it('halves the distance every half-life, independent of frame splitting', () => {
    expect(smoothTo(0, 100, 100, 100)).toBeCloseTo(50);
    let v = 0;
    for (let i = 0; i < 10; i++) v = smoothTo(v, 100, 100, 10);
    expect(v).toBeCloseTo(50);
  });
  it('snaps with a zero half-life and holds with dt 0', () => {
    expect(smoothTo(3, 9, 0, 16)).toBe(9);
    expect(smoothTo(3, 9, 100, 0)).toBe(3);
  });
});

describe('lookAheadTarget', () => {
  const c = MOVE_FX.camera;
  it('looks a little ahead of facing when standing', () => {
    expect(lookAheadTarget(1, 0, PLAYER.runSpeed, false, c)).toBe(c.lookAheadIdle);
    expect(lookAheadTarget(-1, 0, PLAYER.runSpeed, false, c)).toBe(-c.lookAheadIdle);
  });
  it('follows the velocity direction at run speed', () => {
    expect(lookAheadTarget(-1, PLAYER.runSpeed, PLAYER.runSpeed, false, c)).toBe(c.lookAheadRun);
    expect(lookAheadTarget(1, -PLAYER.runSpeed * 2, PLAYER.runSpeed, false, c)).toBe(-c.lookAheadRun);
  });
  it('dash looks furthest along facing', () => {
    expect(lookAheadTarget(-1, 0, PLAYER.runSpeed, true, c)).toBe(-c.lookAheadDash);
  });
});

describe('fall look / landing', () => {
  it('fallLookDown ramps between start and full speed', () => {
    expect(fallLookDown(100, 400, 600, 30)).toBe(0);
    expect(fallLookDown(500, 400, 600, 30)).toBeCloseTo(15);
    expect(fallLookDown(900, 400, 600, 30)).toBe(30);
  });
  it('landStrength and settlePx are clamped', () => {
    expect(landStrength(-5, 100)).toBe(0);
    expect(landStrength(50, 100)).toBeCloseTo(0.5);
    expect(landStrength(500, 100)).toBe(1);
    expect(settlePx(100, 300, 600, 6)).toBe(0);
    expect(settlePx(600, 300, 600, 6)).toBe(6);
    expect(settlePx(2000, 300, 600, 6)).toBe(6);
  });
  it('lerpPair blends squash pairs', () => {
    expect(lerpPair([1, 1], [2, 0], 0.5)).toEqual([1.5, 0.5]);
    expect(lerpPair([1, 1], [2, 0], 3)).toEqual([2, 0]);
  });
});

describe('feet', () => {
  it('isFootfall fires only when entering a foot frame', () => {
    expect(isFootfall(6, 1, [1, 4])).toBe(true);
    expect(isFootfall(1, 1, [1, 4])).toBe(false);
    expect(isFootfall(1, 2, [1, 4])).toBe(false);
    expect(isFootfall(3, 4, [1, 4])).toBe(true);
  });
  it('isSkid needs speed against the stick', () => {
    expect(isSkid(140, -1, 95)).toBe(true);
    expect(isSkid(140, 1, 95)).toBe(false);
    expect(isSkid(60, -1, 95)).toBe(false);
    expect(isSkid(140, 0, 95)).toBe(false);
  });
});

describe('CapPool', () => {
  it('creates up to the cap, then recycles the oldest live item', () => {
    let n = 0;
    const recycled: number[] = [];
    const pool = new CapPool(2, () => ++n, (i) => recycled.push(i));
    expect(pool.acquire()).toBe(1);
    expect(pool.acquire()).toBe(2);
    expect(pool.acquire()).toBe(1); // recycled oldest
    expect(recycled).toEqual([1]);
    expect(pool.size).toBe(2);
    expect(pool.liveCount).toBe(2);
  });
  it('reuses released items before creating', () => {
    let n = 0;
    const pool = new CapPool(5, () => ++n);
    const a = pool.acquire();
    pool.release(a);
    pool.release(a); // double release is ignored
    expect(pool.acquire()).toBe(a);
    expect(pool.size).toBe(1);
  });
});
