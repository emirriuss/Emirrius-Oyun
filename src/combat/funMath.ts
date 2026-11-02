/**
 * Fun math: a small, boss-agnostic model of what makes a boss fight feel fair and exciting.
 * Pure (no Phaser) so any boss plan can derive its timing tables from it and tests / the
 * Monte Carlo sim can check them. Used by CANTOR (combat/cantorPlan.ts, tests/cantorSim.test.ts).
 *
 *  - Reaction floor (Hick-Hyman): a telegraph must outlast human reaction + choice + travel.
 *  - Hit chance: logistic in the slack (windup - required time), plus a skill-dependent lapse rate.
 *  - Damage budget / fight length: TTK from DPS x uptime; hits taken vs HP + hearts.
 *  - Rhythm: threat:opening ratio per phase.
 *  - Variety: Shannon entropy of the move pick, and a repeat cap.
 */

/** Human timing constants (ms). Simple visual RT ~250 ms; Hick slope ~150 ms/bit; safety slack. */
export const HUMAN = { rt: 250, hickB: 150, slack: 80 } as const;

/** Player movement from PLAYER in config.ts: run 150 px/s; one dash = 380 px/s x 0.15 s = 57 px. */
export const REACH = { run: 150, dash: 57 } as const;

/** Time (ms) needed to move `px` to safety: free within one dash, then running speed. */
export function travelMs(px: number): number {
  return Math.max(0, px - REACH.dash) / REACH.run * 1000;
}

/**
 * Minimum fair telegraph (ms): reaction + Hick choice time for `choices` possible safe answers
 * + travel + slack. choices=1 -> 480 ms, choices=2 -> ~568 ms (no travel).
 */
export function hickWindup(choices: number, travelPx = 0): number {
  return Math.round(HUMAN.rt + HUMAN.hickB * Math.log2(Math.max(0, choices) + 1) + travelMs(travelPx) + HUMAN.slack);
}

/** A player profile for the model. */
export interface Skill {
  /** reaction-time offset vs HUMAN.rt (ms; + = slower) */
  rtShift: number;
  /** spread of the logistic hit curve (ms); smaller = more consistent */
  sigma: number;
  /** chance to be hit anyway (mis-input, panic) on any strike */
  lapse: number;
  /** fraction of a punish window spent landing hits */
  punishEff: number;
  /** fraction of the boss's idle/opening time spent landing hits */
  openEff: number;
  /** chance to parry a parryable strike (instead of dodging) */
  parry: number;
  /** player damage multiplier (Keen Edge, heavies, finishers) */
  dmgMul: number;
  /** max HP at this point in the game (base 5 + Vital Core) */
  maxHp: number;
  /** chance a dropped heart actually gets picked up */
  heartPickup: number;
}

/** Three reference players (calibrated once, boss-independent). */
export const SKILL: Record<'novice' | 'average' | 'expert', Skill> = {
  novice: { rtShift: 90, sigma: 90, lapse: 0.04, punishEff: 0.6, openEff: 0.12, parry: 0.05, dmgMul: 1.2, maxHp: 6, heartPickup: 0.75 },
  average: { rtShift: 30, sigma: 65, lapse: 0.033, punishEff: 0.75, openEff: 0.2, parry: 0.15, dmgMul: 1.4, maxHp: 7, heartPickup: 0.85 },
  expert: { rtShift: -10, sigma: 45, lapse: 0.024, punishEff: 0.9, openEff: 0.28, parry: 0.3, dmgMul: 1.6, maxHp: 8, heartPickup: 0.95 },
};
export type SkillName = keyof typeof SKILL;

/** Difficulty knobs, mirroring DIFFICULTY in systems/Progression.ts. */
export const DIFF = {
  easy: { hpMul: 0.75, dmgMul: 1, hpBonus: 3 },
  normal: { hpMul: 1, dmgMul: 1, hpBonus: 0 },
  hard: { hpMul: 1.3, dmgMul: 1.5, hpBonus: -1 },
} as const;
export type DiffName = keyof typeof DIFF;

/** Logistic 1 / (1 + e^x). */
const logistic = (x: number): number => 1 / (1 + Math.exp(x));

/** Time (ms) this player really needs to answer a telegraph (no slack). */
export function requiredMs(choices: number, travelPx: number, s: Skill): number {
  return HUMAN.rt + s.rtShift + HUMAN.hickB * Math.log2(Math.max(0, choices) + 1) + travelMs(travelPx);
}

/** Chance a telegraph of `windup` ms hits this player. */
export function hitProb(windup: number, choices: number, travelPx: number, s: Skill): number {
  const r = requiredMs(choices, travelPx, s);
  return s.lapse + (1 - s.lapse) * logistic((windup - r) / s.sigma);
}

/** Expected hits over a list of strikes (count x probability). */
export function expectedHits(strikes: { count: number; p: number }[]): number {
  return strikes.reduce((a, s) => a + s.count * s.p, 0);
}

/** Base player DPS: the 3-hit ground combo, 1+1+2 damage over 200+200+300 ms. */
export const COMBO_DPS = 4 / 0.7;

/** Seconds to kill `hp` at `dps` x `uptime` x `mul`. */
export function ttk(hp: number, dps: number, uptime: number, mul = 1): number {
  return hp / (dps * uptime * mul);
}

/** Shannon entropy (bits) of a weight list (normalised). */
export function entropyBits(weights: readonly number[]): number {
  const total = weights.reduce((a, b) => a + Math.max(0, b), 0);
  if (!total) return 0;
  let h = 0;
  for (const w of weights) if (w > 0) h -= (w / total) * Math.log2(w / total);
  return h;
}

/**
 * Repeat cap (a soft shuffle-bag): drop moves already used `max` times in the last `window` picks,
 * unless that would leave nothing.
 */
export function capRepeats<M extends string>(w: [M, number][], history: readonly M[], window = 4, max = 2): [M, number][] {
  const recent = history.slice(-window);
  const ok = w.filter(([m]) => recent.filter((h) => h === m).length < max);
  return ok.length ? ok : w;
}

/** Mulberry32: tiny seeded PRNG for reproducible sims / tests. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Median of a numeric list (0 for empty). */
export function median(xs: readonly number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
