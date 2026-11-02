import { describe, it, expect } from 'vitest';
import {
  SPEC, BPM, CHAIN, THREAT_RATIO, RHYTHM_FLOOR, CARILLON_PUNISH, TUTORIAL, COMBO_MS,
  floorMs, windupMs, strikeGapMs, strikeTimes, punishMs, idleMs, expectedChainMs, beatMs,
  cantorWeights, chooseMove, pickEntropy, delayToBeat, pealOrder, clapperX, type CantorMove,
} from '../src/combat/cantorPlan';
import { seeded, hickWindup } from '../src/combat/funMath';

const MOVES = Object.keys(SPEC) as CantorMove[];
const PH = [0, 1, 2];
const live = (m: CantorMove, ph: number) => ph + 1 >= SPEC[m].from && SPEC[m].strikes[ph] > 0;

describe('CANTOR timing (derived from funMath)', () => {
  it('every first strike gets at least its Hick floor, in every phase', () => {
    for (const m of MOVES) for (const ph of PH) if (live(m, ph)) expect(strikeTimes(m, ph)[0]).toBeGreaterThanOrEqual(hickWindup(SPEC[m].choices, SPEC[m].travel));
  });

  it('windups never grow from one phase to the next (escalation), and the tutorial instance is x1.3', () => {
    for (const m of MOVES) {
      for (const ph of [1, 2]) expect(windupMs(m, ph)).toBeLessThanOrEqual(windupMs(m, ph - 1));
      expect(windupMs(m, 0, true)).toBe(Math.round(windupMs(m, 0) * TUTORIAL));
      expect(floorMs(m)).toBe(hickWindup(SPEC[m].choices, SPEC[m].travel));
    }
  });

  it('follow-up strikes are one beat apart and never under the rhythm floor', () => {
    for (const ph of PH) {
      expect(strikeGapMs(ph)).toBeCloseTo(60000 / BPM[ph]);
      expect(strikeGapMs(ph)).toBeGreaterThanOrEqual(RHYTHM_FLOOR);
      for (const m of MOVES) {
        const t = strikeTimes(m, ph);
        for (let i = 1; i < t.length; i++) expect(t[i] - t[i - 1]).toBeGreaterThanOrEqual(RHYTHM_FLOOR);
      }
    }
  });

  it('tempo rises 100 -> 115 -> 130 BPM', () => {
    expect(BPM).toEqual([100, 115, 130]);
    expect(beatMs(0)).toBe(600);
  });

  it('strikes land on the beat: delayToBeat aligns now + delay + windup to the beat grid', () => {
    const rnd = seeded(5);
    for (let i = 0; i < 200; i++) {
      const ph = i % 3, origin = rnd() * 1000, now = origin + rnd() * 20000, w = 400 + rnd() * 600;
      const d = delayToBeat(now, origin, w, ph);
      expect(d).toBeGreaterThanOrEqual(0);
      expect(d).toBeLessThan(beatMs(ph) + 1e-6);
      const k = (now + d + w - origin) / beatMs(ph);
      expect(Math.abs(k - Math.round(k))).toBeLessThan(1e-6);
    }
  });

  it('only synco is off-beat (lands half a beat late)', () => {
    for (const m of MOVES) expect(!!SPEC[m].offbeat).toBe(m === 'synco');
    expect(strikeTimes('synco', 2)[0]).toBe(Math.round(windupMs('synco', 2) + beatMs(2) / 2));
  });

  it('punish windows fit a walk-in + full combo (>= 900 ms); carillon ends in 1500', () => {
    for (const ph of PH) expect(punishMs(ph)).toBeGreaterThanOrEqual(Math.max(900, COMBO_MS));
    expect(CARILLON_PUNISH).toBe(1500);
  });

  it('tension rhythm: threat : (threat + punish + idle) hits the phase target', () => {
    for (const ph of PH) {
      const threat = expectedChainMs(ph);
      const ratio = threat / (threat + punishMs(ph) + idleMs(ph));
      expect(ratio).toBeCloseTo(THREAT_RATIO[ph], 2);
    }
    expect(CHAIN).toEqual([2, 3, 4]);
  });

  it('never more than 2 threats at once, even when a lingering hazard overlaps the next move', () => {
    for (const a of MOVES)
      for (const b of MOVES)
        for (const ph of PH) {
          if (!live(a, ph) || !live(b, ph)) continue;
          expect(SPEC[a].threats).toBeLessThanOrEqual(2);
          if (!SPEC[b].clears && SPEC[a].linger > strikeTimes(b, ph)[0]) expect(SPEC[a].threats + SPEC[b].threats).toBeLessThanOrEqual(2);
        }
  });
});

describe('CANTOR move choice', () => {
  it('weights only offer moves unlocked in that phase', () => {
    for (const p of [1, 2, 3]) for (const [m] of cantorWeights(p, 150, false)) expect(SPEC[m].from).toBeLessThanOrEqual(p);
  });

  it('pick entropy stays in 1.4-2.2 bits in every situation (learnable but not rote)', () => {
    for (const p of [1, 2, 3]) for (const dx of [40, 150, 300]) for (const high of [false, true]) {
      const h = pickEntropy(p, dx, high);
      expect(h).toBeGreaterThanOrEqual(1.4);
      expect(h).toBeLessThanOrEqual(2.2);
    }
  });

  it('never the same move 3x in a row, never more than 2 of the last 4', () => {
    const rnd = seeded(11);
    for (const p of [1, 2, 3]) {
      const h: CantorMove[] = [];
      for (let i = 0; i < 2000; i++) {
        const m = chooseMove(p, 150, false, h.slice(-4), rnd);
        const last4 = [...h.slice(-3), m];
        expect(last4.filter((x) => x === m).length).toBeLessThanOrEqual(2);
        h.push(m);
      }
    }
  });

  it('peal never starts under the player and plays all 3 columns; echo mirrors it', () => {
    const rnd = seeded(3);
    for (let i = 0; i < 300; i++) {
      const pc = i % 3;
      const o = pealOrder(pc, rnd);
      expect(o[0]).not.toBe(pc);
      expect([...o].sort()).toEqual([0, 1, 2]);
    }
    const a = seeded(9), b = seeded(9);
    expect(pealOrder(0, a, true)).toEqual(pealOrder(0, b).map((c) => 2 - c));
  });

  it('clapper lands within 12 px of the player (one dash clears it) and inside the arena', () => {
    const rnd = seeded(1);
    for (let i = 0; i < 300; i++) {
      const x = clapperX(200, 24, 456, rnd);
      expect(Math.abs(x - 200)).toBeLessThanOrEqual(12);
    }
    expect(clapperX(10, 24, 456, rnd)).toBeGreaterThanOrEqual(24);
  });
});
