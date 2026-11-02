import { describe, it, expect } from 'vitest';
import {
  IMPACT_LIMITS,
  SLOWMO_IDLE,
  kickEnvelope,
  mergeSlowmo,
  punchEnvelope,
  resolveImpact,
  slowmoScaleAt,
  timeScales,
} from '../src/core/juiceMath';
import { JUICE } from '../src/config';

describe('resolveImpact', () => {
  it('mul 1 returns the preset values', () => {
    const r = resolveImpact(JUICE.impact.heavy, 1);
    expect(r.hitstop).toBe(JUICE.impact.heavy.hitstop);
    expect(r.shake).toBeCloseTo(JUICE.impact.heavy.shake);
    expect(r.slowmoMs).toBe(0);
    expect(r.slowmo).toBe(1);
  });
  it('presets keep the pre-preset hitstop/shake values', () => {
    expect(JUICE.impact.light.hitstop).toBe(JUICE.hitstopLight);
    expect(JUICE.impact.light.shake).toBe(JUICE.shakeLight);
    expect(JUICE.impact.heavy.hitstop).toBe(JUICE.hitstopHeavy);
    expect(JUICE.impact.heavy.shake).toBe(JUICE.shakeHeavy);
  });
  it('only killBig and parry slow time by default', () => {
    const slowed = Object.entries(JUICE.impact).filter(([, p]) => p.slowmoMs > 0).map(([k]) => k).sort();
    expect(slowed).toEqual(['killBig', 'parry']);
  });
  it('scales intensities with mul', () => {
    const r = resolveImpact(JUICE.impact.light, 2);
    expect(r.hitstop).toBe(JUICE.impact.light.hitstop * 2);
    expect(r.rumbleWeak).toBeCloseTo(JUICE.impact.light.rumbleWeak * 2);
    expect(r.shakeMs).toBe(JUICE.impact.light.shakeMs); // durations don't scale
  });
  it('clamps huge / invalid multipliers', () => {
    for (const p of Object.values(JUICE.impact)) {
      const r = resolveImpact(p, 100);
      expect(r.hitstop).toBeLessThanOrEqual(Math.max(IMPACT_LIMITS.hitstop, p.hitstop));
      expect(r.punch).toBeLessThanOrEqual(IMPACT_LIMITS.punch);
      expect(r.kick).toBeLessThanOrEqual(IMPACT_LIMITS.kick);
      expect(r.rumbleStrong).toBeLessThanOrEqual(1);
      expect(r.slowmo).toBeGreaterThanOrEqual(IMPACT_LIMITS.slowmoMin);
      expect(r.slowmoMs).toBeLessThanOrEqual(IMPACT_LIMITS.slowmoMs);
    }
    const z = resolveImpact(JUICE.impact.killBig, -5);
    expect(z.hitstop).toBe(0);
    expect(z.slowmoMs).toBe(0);
    expect(z.slowmo).toBe(1);
    expect(resolveImpact(JUICE.impact.light, NaN).hitstop).toBe(0);
  });
  it('mul deepens slowmo', () => {
    const p = JUICE.impact.parry;
    expect(resolveImpact(p, 1.5).slowmo).toBeLessThan(resolveImpact(p, 1).slowmo);
    expect(resolveImpact(p, 0.5).slowmo).toBeGreaterThan(resolveImpact(p, 1).slowmo);
  });
});

describe('slowmo', () => {
  it('holds, eases, and releases to exactly 1', () => {
    const s = mergeSlowmo(SLOWMO_IDLE, 1000, 0.3, 500);
    expect(slowmoScaleAt(s, 1000)).toBe(0.3);
    expect(slowmoScaleAt(s, 1200)).toBe(0.3);
    const mid = slowmoScaleAt(s, 1400);
    expect(mid).toBeGreaterThan(0.3);
    expect(mid).toBeLessThan(1);
    expect(slowmoScaleAt(s, 1500)).toBe(1);
    expect(slowmoScaleAt(s, 99999)).toBe(1);
  });
  it('is monotonic while easing back', () => {
    const s = mergeSlowmo(SLOWMO_IDLE, 0, 0.2, 1000);
    let prev = 0;
    for (let t = 0; t <= 1000; t += 10) {
      const v = slowmoScaleAt(s, t);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
    expect(prev).toBe(1);
  });
  it('overlapping calls keep the stronger scale and the later end', () => {
    let s = mergeSlowmo(SLOWMO_IDLE, 0, 0.3, 500);
    s = mergeSlowmo(s, 100, 0.6, 200); // weaker and shorter
    expect(s.scale).toBe(0.3);
    expect(s.end).toBe(500);
    s = mergeSlowmo(s, 200, 0.5, 1000); // weaker but longer
    expect(s.scale).toBe(0.3);
    expect(s.end).toBe(1200);
    expect(slowmoScaleAt(s, 1200)).toBe(1);
  });
  it('a request after the previous one ended starts fresh', () => {
    let s = mergeSlowmo(SLOWMO_IDLE, 0, 0.2, 100);
    s = mergeSlowmo(s, 500, 0.7, 100);
    expect(s.scale).toBe(0.7);
    expect(s.start).toBe(500);
  });
  it('ignores no-op requests and clamps depth', () => {
    expect(mergeSlowmo(SLOWMO_IDLE, 0, 1, 500)).toBe(SLOWMO_IDLE);
    expect(mergeSlowmo(SLOWMO_IDLE, 0, 0.5, 0)).toBe(SLOWMO_IDLE);
    expect(mergeSlowmo(SLOWMO_IDLE, 0, 0, 100).scale).toBe(IMPACT_LIMITS.slowmoMin);
  });
  it('time scales: arcade physics is inverse, 1 is exact', () => {
    expect(timeScales(1)).toEqual({ clock: 1, tweens: 1, anims: 1, physics: 1 });
    const t = timeScales(0.5);
    expect(t.clock).toBe(0.5);
    expect(t.physics).toBe(2);
    expect(timeScales(0).physics).toBeCloseTo(1 / IMPACT_LIMITS.slowmoMin);
  });
});

describe('camera envelopes', () => {
  it('punch and kick start and end at 0', () => {
    for (const f of [punchEnvelope, kickEnvelope]) {
      expect(f(0)).toBe(0);
      expect(f(1)).toBe(0);
      expect(f(1.5)).toBe(0);
    }
    expect(punchEnvelope(0.25)).toBeCloseTo(1);
    expect(kickEnvelope(0.2)).toBeCloseTo(1);
  });
});
