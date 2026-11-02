import { describe, it, expect } from 'vitest';
import {
  colossusWeights, pickColossusMove, slamTargets, debrisLayout, plateLayout, shrugSide, beamSweep,
  resumeState, fallProgress, pendingPhases, HEAVY, COLOSSUS_NAMES, type ColossusMove,
} from '../src/combat/colossusPlan';

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

const moves = (p: number) => colossusWeights(p, 120, false).map(([m]) => m).sort();

describe('colossusWeights', () => {
  it('each phase has its own move set', () => {
    expect(moves(1)).toEqual(['flick', 'quake', 'slam', 'sweep']);
    expect(moves(2)).toEqual(['beam', 'exhale', 'hand', 'headbutt']);
    expect(moves(3)).toEqual(['debris', 'pulse', 'shrug', 'swat']);
  });
  it('P1 sweeps more when close and flicks more when far', () => {
    const w = (dx: number, m: ColossusMove) => colossusWeights(1, dx, false).find(([x]) => x === m)![1];
    expect(w(40, 'sweep')).toBeGreaterThan(w(300, 'sweep'));
    expect(w(300, 'flick')).toBeGreaterThan(w(40, 'flick'));
  });
  it('every phase has a heavy (punishable) move', () => {
    for (const p of [1, 2, 3]) expect(colossusWeights(p, 100, false).some(([m]) => HEAVY.has(m))).toBe(true);
  });
});

describe('pickColossusMove', () => {
  for (const phase of [1, 2, 3]) {
    it(`P${phase}: never repeats, never 3 light moves in a row, uses every move`, () => {
      const rnd = mulberry32(phase * 7);
      const hist: ColossusMove[] = [];
      const seen = new Set<ColossusMove>();
      for (let i = 0; i < 400; i++) {
        const m = pickColossusMove(phase, 30 + (i % 5) * 80, i % 3 === 0, hist, rnd);
        if (hist.length) expect(m).not.toBe(hist[hist.length - 1]);
        const last3 = [...hist.slice(-2), m];
        if (last3.length === 3) expect(last3.some((x) => HEAVY.has(x))).toBe(true);
        hist.push(m);
        seen.add(m);
      }
      expect(seen.size).toBe(4);
    });
  }
});

describe('slamTargets', () => {
  it('first target is on the player, all inside the arena, spaced apart', () => {
    const rnd = mulberry32(3);
    for (let i = 0; i < 300; i++) {
      const px = 16 + rnd() * 608;
      const xs = slamTargets(px, 60, 580, rnd);
      expect(xs).toHaveLength(3);
      expect(xs[0]).toBe(Math.max(60, Math.min(580, px)));
      for (const x of xs) expect(x >= 60 && x <= 580).toBe(true);
      for (let k = 1; k < 3; k++) expect(Math.abs(xs[k] - xs[k - 1])).toBeGreaterThanOrEqual(56);
    }
  });
});

describe('layouts', () => {
  it('debris ledges are reachable steps between floor (272) and the eye (~114)', () => {
    for (const l of debrisLayout(320)) {
      expect(l.y).toBeLessThan(272 - 40);
      expect(l.y).toBeGreaterThan(114 + 20);
    }
  });
  it('plates keep the core column clear and stay in the arena', () => {
    for (const l of plateLayout(320)) {
      expect(Math.abs(l.x - 320)).toBeGreaterThan(40 + l.w / 2);
      expect(l.x - l.w / 2).toBeGreaterThan(16);
      expect(l.x + l.w / 2).toBeLessThan(624);
    }
  });
});

describe('aim helpers', () => {
  it('shrug erupts on the player side', () => {
    expect(shrugSide(100, 320)).toBe(-1);
    expect(shrugSide(500, 320)).toBe(1);
  });
  it('beam sweeps through the player', () => {
    for (const px of [40, 200, 330, 600]) {
      const { from, to } = beamSweep(px, 320, 24, 616);
      expect(Math.min(from, to)).toBeLessThanOrEqual(px);
      expect(Math.max(from, to)).toBeGreaterThanOrEqual(px);
    }
  });
});

describe('resume + phases', () => {
  it('resumes at the threshold HP of the stage', () => {
    expect(resumeState(undefined, [0.66, 0.33])).toBeNull();
    expect(resumeState('d2', [0.66, 0.33])).toBeNull();
    expect(resumeState('p2', [0.66, 0.33])).toEqual({ phase: 2, hpFrac: 0.66 });
    expect(resumeState('p3', [0.66, 0.33])).toEqual({ phase: 3, hpFrac: 0.33 });
  });
  it('fall progress runs 0 -> 1 across P3', () => {
    expect(fallProgress(0.33, 0.33)).toBe(0);
    expect(fallProgress(0, 0.33)).toBe(1);
    expect(fallProgress(0.165, 0.33)).toBeCloseTo(0.5);
    expect(fallProgress(0.9, 0.33)).toBe(0);
  });
  it('a hit across two thresholds queues both phase changes', () => {
    expect(pendingPhases(1, 1)).toEqual([]);
    expect(pendingPhases(1, 2)).toEqual([2]);
    expect(pendingPhases(1, 3)).toEqual([2, 3]);
  });
  it('one bar name per phase', () => {
    expect(COLOSSUS_NAMES).toHaveLength(3);
  });
});
