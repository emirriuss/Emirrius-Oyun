import { describe, it, expect } from 'vitest';
import {
  ARENA, RAIL, DROP_Y, PUSH_PX, CONDENSE_T, STRETCH, MOVES, HEAVY, WINDUP, THRESHOLDS,
  LAMP_GAP, separateLamps,
  shadowGeom, condenseHalfWidth, stretchToward, hitLantern, lanternHitKind, damageMul,
  pickUmbraMove, lanternLayout, resumeState, type UmbraMove, type LanternState,
} from '../src/combat/umbraPlan';
import { seeded } from '../src/combat/funMath';

describe('UMBRA shadow geometry', () => {
  it('condenses straight under the light', () => {
    const g = shadowGeom(200, DROP_Y[1], 200);
    expect(g.condensed).toBe(true);
    expect(g.stretch).toBe(STRETCH.min);
    expect(g.lean).toBe(0);
  });

  it('stretches with distance and caps', () => {
    const near = shadowGeom(200, DROP_Y[1], 260);
    const far = shadowGeom(RAIL.min, DROP_Y[0], ARENA.right);
    expect(near.condensed).toBe(false);
    expect(near.stretch).toBeGreaterThan(STRETCH.min);
    expect(far.stretch).toBe(STRETCH.max);
  });

  it('leans away from the light', () => {
    expect(shadowGeom(100, 108, 200).lean).toBeGreaterThan(0); // light to the left: falls right
    expect(shadowGeom(300, 108, 200).lean).toBeLessThan(0);
    expect(Math.abs(shadowGeom(RAIL.min, 80, ARENA.right).lean)).toBeLessThanOrEqual(0.5);
  });

  it('a higher light gives a wider condense zone', () => {
    expect(condenseHalfWidth(DROP_Y[0])).toBeGreaterThan(condenseHalfWidth(DROP_Y[2]));
    // the edge of the zone is the condense threshold
    const w = condenseHalfWidth(DROP_Y[1]);
    expect(shadowGeom(200, DROP_Y[1], 200 + w - 0.5).condensed).toBe(true);
    expect(shadowGeom(200, DROP_Y[1], 200 + w + 0.5).condensed).toBe(false);
    expect(CONDENSE_T).toBeGreaterThan(0);
  });

  it('only the shadow falling toward the player gives reach', () => {
    const lamp = [{ x: 100, y: 108, lit: true }];
    // boss at 200, lamp behind it (left): shadow falls right
    expect(stretchToward(lamp, 200, 1)).toBeGreaterThan(STRETCH.min);
    expect(stretchToward(lamp, 200, -1)).toBe(STRETCH.min);
    // snuffed lamps cast nothing
    expect(stretchToward([{ x: 100, y: 108, lit: false }], 200, 1)).toBe(STRETCH.min);
  });
});

describe('UMBRA lantern', () => {
  const s: LanternState = { x: 240, drop: 1, lit: true };

  it('classifies hits like the player sends them', () => {
    expect(lanternHitKind({ slam: true, kbX: 60, kbY: 0 })).toBe('slam');
    expect(lanternHitKind({ kbX: 40, kbY: -220 })).toBe('up'); // Player.enterUpAttack
    expect(lanternHitKind({ kbX: -160, kbY: -50 })).toBe('side');
    expect(lanternHitKind({ kbX: 320, kbY: -160 })).toBe('side'); // heavy
  });

  it('side hits slide it away and clamp to the rail', () => {
    expect(hitLantern(s, 'side', 1).x).toBe(240 + PUSH_PX);
    expect(hitLantern(s, 'side', -1).x).toBe(240 - PUSH_PX);
    let t = s;
    for (let i = 0; i < 20; i++) t = hitLantern(t, 'side', 1);
    expect(t.x).toBe(RAIL.max);
    for (let i = 0; i < 20; i++) t = hitLantern(t, 'side', -1);
    expect(t.x).toBe(RAIL.min);
  });

  it('up-slash hoists, pogo lowers, within three notches', () => {
    expect(hitLantern(s, 'up', 0).drop).toBe(0);
    expect(hitLantern(hitLantern(s, 'up', 0), 'up', 0).drop).toBe(0);
    expect(hitLantern(s, 'slam', 0).drop).toBe(2);
    expect(hitLantern(hitLantern(s, 'slam', 0), 'slam', 0).drop).toBe(2);
  });

  it('two lanterns never share a spot on the rail', () => {
    expect(separateLamps(100, 300)).toEqual([100, 300]);
    const [a, b] = separateLamps(RAIL.max, RAIL.max);
    expect(b - a).toBe(LAMP_GAP);
    expect(b).toBeLessThanOrEqual(RAIL.max);
    const [c, d] = separateLamps(RAIL.min + 4, RAIL.min);
    expect(c - d).toBe(LAMP_GAP); // order kept: the right one stays right
    expect(d).toBeGreaterThanOrEqual(RAIL.min);
  });

  it('a snuffed lantern is only relit', () => {
    const out = { ...s, lit: false };
    expect(hitLantern(out, 'side', 1)).toEqual({ ...s, lit: true });
  });
});

describe('UMBRA damage rule', () => {
  it('passes through unless condensed or sprawled', () => {
    expect(damageMul({ phase: 1, condensed: false, recovering: false })).toBe(0);
    expect(damageMul({ phase: 2, condensed: false, recovering: true })).toBeCloseTo(0.6);
    expect(damageMul({ phase: 1, condensed: true, recovering: false })).toBe(1);
    expect(damageMul({ phase: 1, condensed: true, recovering: true })).toBe(1.25);
  });

  it('the P3 body is always solid, weaker while its lamp is out', () => {
    expect(damageMul({ phase: 3, condensed: false, recovering: false })).toBe(1);
    expect(damageMul({ phase: 3, condensed: false, recovering: false, lampOut: true })).toBeCloseTo(0.6);
    expect(damageMul({ phase: 3, condensed: false, recovering: true })).toBe(1.25);
  });
});

describe('UMBRA move picking', () => {
  it('each phase has its own move set with a heavy in it', () => {
    MOVES.forEach((ms, i) => {
      expect(ms).toContain(HEAVY[i]);
      expect(new Set(ms).size).toBe(ms.length);
    });
    expect(MOVES[2]).not.toEqual(MOVES[0]);
  });

  it('wind-ups respect the per-phase floors', () => {
    const floors = [550, 450, 380];
    for (const m of Object.keys(WINDUP) as UmbraMove[]) WINDUP[m].forEach((ms, i) => expect(ms).toBeGreaterThanOrEqual(floors[i]));
  });

  for (const phase of [1, 2, 3]) {
    it(`P${phase}: never repeats, uses every move, a heavy within every 3`, () => {
      const rnd = seeded(phase * 97);
      const hist: UmbraMove[] = [];
      const heavy = HEAVY[phase - 1];
      for (let i = 0; i < 600; i++) {
        const dist = [40, 100, 200][i % 3];
        const m = pickUmbraMove({ phase, dist, lampNear: i % 4 === 0, lampOut: phase === 3 && i % 5 === 0 }, hist, rnd);
        if (hist.length) expect(m).not.toBe(hist[hist.length - 1]);
        expect(MOVES[phase - 1]).toContain(m);
        hist.push(m);
        if (hist.length >= 3) expect(hist.slice(-3)).toContain(heavy);
      }
      for (const m of MOVES[phase - 1]) expect(hist).toContain(m);
    });
  }

  it('never snuffs a lamp that is already out', () => {
    const rnd = seeded(5);
    for (let i = 0; i < 300; i++) expect(pickUmbraMove({ phase: 3, dist: 100, lampOut: true }, ['grab'], rnd)).not.toBe('gutter');
  });
});

describe('UMBRA layouts and resume', () => {
  it('lanterns start on the rail, one / two / one', () => {
    for (const [phase, n] of [[1, 1], [2, 2], [3, 1]] as const) {
      const ls = lanternLayout(phase, 380);
      expect(ls).toHaveLength(n);
      for (const l of ls) {
        expect(l.x).toBeGreaterThanOrEqual(RAIL.min);
        expect(l.x).toBeLessThanOrEqual(RAIL.max);
      }
    }
  });

  it('P1 hangs its lamp away from the boss (a long first shadow)', () => {
    const [l] = lanternLayout(1, 380);
    expect(shadowGeom(l.x, DROP_Y[l.drop], 380).condensed).toBe(false);
  });

  it('resumes later phases at their thresholds', () => {
    expect(resumeState('p2')).toEqual({ phase: 2, hpFrac: THRESHOLDS[0] });
    expect(resumeState('p3')).toEqual({ phase: 3, hpFrac: THRESHOLDS[1] });
    expect(resumeState(undefined)).toBeNull();
    expect(resumeState('sun')).toBeNull();
  });
});
