import { describe, it, expect } from 'vitest';
import {
  croupierWeights, diceCount, pickMove, flipCoin, newLuck, rollDice, nextLuckDice, dealCards, nextLuckDeal,
  spinRoulette, nextLuckRoulette, spinReels, reelPayout, stripeLayout, highCardDeck, HIGH_CARD_ODDS, WINDUP_FLOOR,
  type CroupierMove, type Color,
} from '../src/combat/croupierPlan';

/** Tiny seeded PRNG so runs are reproducible. */
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

const moves = (w: [CroupierMove, number][]) => w.map(([m]) => m);
const weightOf = (w: [CroupierMove, number][], m: CroupierMove) => w.find(([x]) => x === m)?.[1] ?? 0;
const RANGES = [40, 200, 400];

describe('croupierWeights', () => {
  it('P1 only has coin/dice/deal', () => {
    for (const dx of RANGES) for (const high of [false, true]) {
      expect(moves(croupierWeights(1, dx, high)).sort()).toEqual(['coin', 'deal', 'dice']);
    }
  });

  it('P2 adds roulette and reels, no double', () => {
    for (const dx of RANGES) {
      const m = moves(croupierWeights(2, dx, false));
      expect(m).toEqual(expect.arrayContaining(['roulette', 'reels']));
      expect(m).not.toContain('double');
    }
  });

  it('P3 always offers double with weight > 0', () => {
    for (const dx of RANGES) for (const high of [false, true]) {
      expect(weightOf(croupierWeights(3, dx, high), 'double')).toBeGreaterThan(0);
    }
  });

  it('no roulette when the player is high', () => {
    for (const p of [1, 2, 3]) for (const dx of RANGES) expect(moves(croupierWeights(p, dx, true))).not.toContain('roulette');
  });

  it('range flavour: close favours dice, far favours coin/deal, high favours coin & deal', () => {
    const close = croupierWeights(1, 40, false);
    expect(weightOf(close, 'dice')).toBeGreaterThan(weightOf(close, 'coin'));
    const far = croupierWeights(1, 400, false);
    expect(weightOf(far, 'coin')).toBeGreaterThan(weightOf(far, 'dice'));
    expect(weightOf(far, 'deal')).toBeGreaterThan(weightOf(far, 'dice'));
    const high = croupierWeights(1, 40, true);
    expect(weightOf(high, 'coin')).toBeGreaterThan(weightOf(high, 'dice'));
    expect(weightOf(high, 'deal')).toBeGreaterThan(weightOf(high, 'dice'));
  });

  it('clamps phases', () => {
    expect(croupierWeights(7, 40, false)).toEqual(croupierWeights(3, 40, false));
    expect(croupierWeights(0, 40, false)).toEqual(croupierWeights(1, 40, false));
  });

  it('diceCount: 2 before P3, 3 in P3', () => {
    expect(diceCount(1)).toBe(2);
    expect(diceCount(2)).toBe(2);
    expect(diceCount(3)).toBe(3);
  });

  it('WINDUP_FLOOR shrinks per phase', () => {
    expect(WINDUP_FLOOR).toEqual([500, 450, 400]);
  });
});

describe('determinism', () => {
  it('same seed -> same sequence of rolls', () => {
    const run = (seed: number) => {
      const r = mulberry32(seed);
      const luck = newLuck();
      return [flipCoin(r), rollDice(3, r, luck), dealCards(r, luck), spinRoulette(['red', 'black', 'green'], r, luck), spinReels(r), highCardDeck(r)];
    };
    expect(run(42)).toEqual(run(42));
    expect(run(1)).not.toEqual(run(2));
  });
});

describe('pity rules (10k seeded iterations)', () => {
  const N = 10_000;

  it('roulette never gives the same color 3x in a row', () => {
    const r = mulberry32(7);
    let luck = newLuck();
    const out: Color[] = [];
    for (let i = 0; i < N; i++) {
      const c = spinRoulette(['red', 'black', 'green'], r, luck);
      luck = nextLuckRoulette(luck, c);
      out.push(c);
      expect(luck.lastColors.length).toBeLessThanOrEqual(2);
    }
    for (let i = 2; i < N; i++) expect(out[i] === out[i - 1] && out[i] === out[i - 2]).toBe(false);
    expect(out).toContain('green');
  });

  it('never 3 consecutive deals without a heart', () => {
    const r = mulberry32(11);
    let luck = newLuck();
    let streak = 0;
    for (let i = 0; i < N; i++) {
      const suits = dealCards(r, luck);
      expect(suits).toHaveLength(3);
      luck = nextLuckDeal(luck, suits);
      streak = suits.includes('heart') ? 0 : streak + 1;
      expect(streak).toBeLessThan(3);
    }
  });

  it('never 2 consecutive high dice totals', () => {
    for (const n of [2, 3]) {
      const r = mulberry32(13 + n);
      let luck = newLuck();
      let prevHigh = false;
      let highs = 0;
      for (let i = 0; i < N; i++) {
        const dice = rollDice(n, r, luck);
        expect(dice).toHaveLength(n);
        for (const d of dice) expect(d >= 1 && d <= 6).toBe(true);
        const high = dice.reduce((s, d) => s + d, 0) >= 5 * n;
        expect(prevHigh && high).toBe(false);
        if (high) highs++;
        prevHigh = high;
        luck = nextLuckDice(luck, dice);
      }
      expect(highs).toBeGreaterThan(0);
    }
  });

  it('luck updates are pure', () => {
    const luck = newLuck();
    nextLuckRoulette(luck, 'red');
    nextLuckDeal(luck, ['spade']);
    nextLuckDice(luck, [6, 6]);
    expect(luck).toEqual(newLuck());
  });
});

describe('reels', () => {
  it('reelPayout detects triples', () => {
    expect(reelPayout(['seven', 'seven', 'seven'])).toEqual({ triple: 'seven', each: [] });
    expect(reelPayout(['skull', 'skull', 'skull'])).toEqual({ triple: 'skull', each: [] });
    expect(reelPayout(['cherry', 'bell', 'cherry'])).toEqual({ triple: null, each: ['cherry', 'bell', 'cherry'] });
  });

  it('spinReels returns 3 valid symbols', () => {
    const r = mulberry32(3);
    for (let i = 0; i < 500; i++) {
      const s = spinReels(r);
      expect(s).toHaveLength(3);
      for (const x of s) expect(['cherry', 'bell', 'seven', 'skull']).toContain(x);
    }
  });
});

describe('stripeLayout', () => {
  it('covers the range without gaps or overlap', () => {
    for (const [l, rr] of [[0, 480], [32, 800], [100, 137], [0, 1000], [16, 959]]) {
      for (const colors of [['red', 'black'], ['red', 'black', 'green']] as Color[][]) {
        const s = stripeLayout(l, rr, colors);
        expect(s[0].x0).toBe(l);
        expect(s[s.length - 1].x1).toBe(rr);
        for (let i = 1; i < s.length; i++) expect(s[i].x0).toBe(s[i - 1].x1);
        for (const st of s) expect(st.x1).toBeGreaterThan(st.x0);
      }
    }
  });

  it('alternates red/black without green', () => {
    const s = stripeLayout(0, 480, ['red', 'black']);
    expect(s.map((x) => x.color)).not.toContain('green');
    for (let i = 1; i < s.length; i++) expect(s[i].color).not.toBe(s[i - 1].color);
  });

  it('exactly one (middle) green stripe when requested', () => {
    for (const w of [96, 480, 500, 1000]) {
      const s = stripeLayout(0, w, ['red', 'black', 'green']);
      const greens = s.map((x, i) => (x.color === 'green' ? i : -1)).filter((i) => i >= 0);
      expect(greens).toEqual([Math.floor(s.length / 2)]);
    }
  });
});

describe('highCardDeck', () => {
  it('always 2 good and 1 bad', () => {
    const r = mulberry32(5);
    const badPos = new Set<number>();
    for (let i = 0; i < 1000; i++) {
      const d = highCardDeck(r);
      expect(d).toHaveLength(3);
      expect(d.filter((c) => c === 'good')).toHaveLength(HIGH_CARD_ODDS.good);
      expect(d.filter((c) => c === 'bad')).toHaveLength(HIGH_CARD_ODDS.bad);
      badPos.add(d.indexOf('bad'));
    }
    expect(badPos.size).toBe(3);
  });
});

describe('generic pickMove', () => {
  it('works with croupier moves and never repeats 3x', () => {
    const w = croupierWeights(3, 200, false);
    for (let i = 0; i < 200; i++) {
      const r = i / 200;
      const m: CroupierMove | null = pickMove(w, ['coin', 'coin'], () => r);
      expect(m).not.toBeNull();
      expect(m).not.toBe('coin');
    }
  });

  it('returns null when nothing is pickable', () => {
    expect(pickMove<CroupierMove>([['double', 0]], [])).toBeNull();
  });
});
