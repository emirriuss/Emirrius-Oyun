/**
 * Pure decision + timing logic for CANTOR, THE TOLLING BELL (w4-8). No Phaser imports.
 * Every timing here is DERIVED from combat/funMath.ts, not hand-tuned:
 *  - first-strike windup = max(Hick floor, design base x 0.88^phase), x1.3 the first time a move is seen
 *  - strikes land on the beat (tempo 100 / 115 / 130 BPM); follow-up strikes are one beat apart and
 *    only need RHYTHM_FLOOR (the rhythm is already revealed: no new decision, just a motor action)
 *  - every chain (2 / 3 / 4 moves) ends in a punish window long enough to walk in and land a full combo
 *  - the idle gap after it is solved from the phase's target threat:opening ratio
 * Tested in tests/cantorPlan.test.ts; whole fights simulated in combat/cantorSim.ts.
 */
import { pickMove } from './wardenPlan';
import { hickWindup, entropyBits, capRepeats, REACH } from './funMath';

export { pickMove };

export type CantorMove = 'swing' | 'toll' | 'clapper' | 'peal' | 'echo' | 'synco' | 'carillon';

export const CANTOR_HP = 240;
export const CANTOR_THRESHOLDS = [0.66, 0.33] as const;
/** Heart drops (Boss.hearts); the sim uses the same numbers. Scarcer than ERRATUM: hearts are part of the damage budget. */
export const CANTOR_HEARTS = { periodicMs: 32000, maxOnField: 1, perParries: 5, onPhase: 1 } as const;

/** Tempo per phase (index 0..2). */
export const BPM = [100, 115, 130] as const;
export const beatMs = (ph: number): number => 60000 / BPM[ph];

/** Windup shrink per phase. */
export const ESCALATE = 0.8;
/** First sighting of a move: windup x this (a "tutorial instance"). */
export const TUTORIAL = 1.3;
/** Shortest gap between two strikes of an already-revealed rhythm (the codebase's P3 wind-up floor). */
export const RHYTHM_FLOOR = 400;
/** Moves per chain before the punish window. */
export const CHAIN = [2, 3, 4] as const;
/** Target share of time the boss is threatening (rest = punish + idle). */
export const THREAT_RATIO = [0.65, 0.7, 0.75] as const;
/** Time to land the full 3-hit ground combo. */
export const COMBO_MS = 700;
/** Where the bell lands for its punish slam: px from the player (closer = more aggressive, same reachability). */
export const PUNISH_LAND = [60, 50, 30] as const;
/** Carillon (P3 finale chain) ends in this long punish. */
export const CARILLON_PUNISH = 1500;
/** P3 "Vespers": the bell's cracked, takes more damage (drama: comebacks are possible). */
export const VESPERS_TAKEN = 1.15;

export interface MoveSpec {
  /** first phase (1..3) it appears in */
  from: number;
  /** possible safe answers at the reveal (Hick n) */
  choices: number;
  /** px the player may have to cover to reach safety */
  travel: number;
  /** design windup in P1 (ms) before escalation; clamped up to the Hick floor */
  base: number;
  /** strikes per phase index 0..2 (each one can hit the player) */
  strikes: readonly [number, number, number];
  /** ms after the last strike until the move ends */
  active: number;
  /** damage per strike; `lastDmg` overrides the final strike */
  dmg: number;
  lastDmg?: number;
  parryable: boolean;
  /** distinct threats it puts on screen at once */
  threats: number;
  /** ms its hazards outlive the move (e.g. travelling shockwaves) */
  linger: number;
  /** clears lingering hazards when it starts (so they never stack with it) */
  clears?: boolean;
  /** the strike lands on the "and" (half beat) with no metronome tick */
  offbeat?: boolean;
}

export const SPEC: Record<CantorMove, MoveSpec> = {
  // the bell swoops down and swings its rim like a pendulum: step back or parry
  swing: { from: 1, choices: 1, travel: 0, base: 650, strikes: [1, 1, 2], active: 300, dmg: 1, parryable: true, threats: 1, linger: 0 },
  // slams the floor on the beat: a ring wave runs each way; jump it (2-3 slams in rhythm)
  toll: { from: 1, choices: 1, travel: 0, base: 700, strikes: [2, 3, 3], active: 350, dmg: 1, parryable: false, threats: 1, linger: 1400 },
  // drops its clapper on a marked column near you: left or right of it
  clapper: { from: 1, choices: 2, travel: 24, base: 760, strikes: [1, 2, 2], active: 300, dmg: 1, parryable: false, threats: 1, linger: 0 },
  // three hanging bells, numbered, ring down columns one beat apart
  peal: { from: 2, choices: 2, travel: 40, base: 820, strikes: [0, 3, 3], active: 400, dmg: 1, parryable: false, threats: 1, linger: 0 },
  // replays the last move, mirrored: a pattern you already know
  echo: { from: 2, choices: 1, travel: 0, base: 640, strikes: [0, 2, 2], active: 300, dmg: 1, parryable: false, threats: 1, linger: 0 },
  // the one off-beat move: a low skid across the floor on the "and", no tick, visual tell only
  synco: { from: 3, choices: 1, travel: 0, base: 560, strikes: [0, 0, 2], active: 300, dmg: 1, parryable: false, threats: 1, linger: 0, offbeat: true },
  // P3 finale: a hush (silences lingering waves), then toll, clapper, peal bell and a heavy swing (2 dmg);
  // ends the chain in a long punish
  carillon: { from: 3, choices: 2, travel: 24, base: 800, strikes: [0, 0, 4], active: 400, dmg: 1, lastDmg: 2, parryable: true, threats: 2, linger: 0, clears: true },
};

/** Reaction floor for a move's first strike. */
export function floorMs(m: CantorMove): number {
  const s = SPEC[m];
  return hickWindup(s.choices, s.travel);
}

/** First-strike windup (ms) for phase index `ph` (0..2); `first` = never seen this fight. */
export function windupMs(m: CantorMove, ph: number, first = false): number {
  const w = Math.max(floorMs(m), SPEC[m].base * ESCALATE ** ph);
  return Math.round(first ? w * TUTORIAL : w);
}

/** Gap between consecutive strikes of one move: one beat (always >= RHYTHM_FLOOR). */
export function strikeGapMs(ph: number): number {
  return Math.max(RHYTHM_FLOOR, beatMs(ph));
}

/** ms from the telegraph's start to the move's end (excluding the wait for the next beat). */
export function moveMs(m: CantorMove, ph: number, first = false): number {
  const s = SPEC[m];
  const n = Math.max(1, s.strikes[ph]);
  return windupMs(m, ph, first) + (n - 1) * strikeGapMs(ph) + (s.offbeat ? beatMs(ph) / 2 : 0) + s.active;
}

/** Punish window after a chain: walk in from where it lands + a full combo (>= 900 ms). */
export function punishMs(ph: number): number {
  return Math.max(900, Math.round(COMBO_MS + (PUNISH_LAND[ph] / REACH.run) * 1000));
}

/** Weights for phase `phase` (1..3). `dx` = |boss - player| px, `high` = player up on a ledge. */
export function cantorWeights(phase: number, dx: number, high: boolean): [CantorMove, number][] {
  const p = Math.min(3, Math.max(1, phase));
  const close = dx < 90;
  const w: [CantorMove, number][] =
    p === 1
      ? [['swing', close ? 4 : 3], ['toll', 3], ['clapper', high ? 4 : 3]]
      : p === 2
        ? [['swing', close ? 3 : 2], ['toll', 1], ['clapper', high ? 2 : 1], ['peal', 4], ['echo', 2]]
        : [['swing', close ? 3 : 2], ['toll', 1], ['peal', high ? 2 : 1], ['synco', 4], ['carillon', 2]];
  return w;
}

/** Pick the next move: weights, then the repeat cap (<= 2 of the last 4), then pickMove (never 3x in a row). */
export function chooseMove(phase: number, dx: number, high: boolean, history: readonly CantorMove[], rnd: () => number): CantorMove {
  const w = capRepeats(cantorWeights(phase, dx, high), history);
  return pickMove(w, history, rnd) ?? 'swing';
}

/** Move-pick entropy (bits) for a situation. */
export function pickEntropy(phase: number, dx: number, high: boolean): number {
  return entropyBits(cantorWeights(phase, dx, high).map(([, n]) => n));
}

/** Expected threat time (ms) of one chain in phase index `ph`, from the neutral weights (+ half a beat waiting for the downbeat). */
export function expectedChainMs(ph: number): number {
  const w = cantorWeights(ph + 1, 150, false);
  const total = w.reduce((a, [, n]) => a + n, 0);
  const perMove = w.reduce((a, [m, n]) => a + (n / total) * (moveMs(m, ph) + beatMs(ph) / 2), 0);
  return CHAIN[ph] * perMove;
}

/** Idle gap after the punish window, solved from THREAT_RATIO: threat / (threat + punish + idle) = r. */
export function idleMs(ph: number): number {
  const threat = expectedChainMs(ph);
  const r = THREAT_RATIO[ph];
  return Math.max(300, Math.round((threat * (1 - r)) / r - punishMs(ph)));
}

/** Strike moments (ms after the telegraph start) for move `m`: first lands at the windup, then one beat apart. */
export function strikeTimes(m: CantorMove, ph: number, first = false): number[] {
  const s = SPEC[m];
  const n = Math.max(1, s.strikes[ph]);
  const w = windupMs(m, ph, first) + (s.offbeat ? beatMs(ph) / 2 : 0);
  return Array.from({ length: n }, (_, i) => Math.round(w + i * strikeGapMs(ph)));
}

/**
 * Delay (ms) before starting a telegraph of `windup` ms so the strike lands exactly on a beat.
 * `now` and `origin` are clock times; beats fall at origin + k * beat.
 */
export function delayToBeat(now: number, origin: number, windup: number, ph: number): number {
  const beat = beatMs(ph);
  const land = now + windup;
  const k = Math.ceil((land - origin) / beat - 1e-6);
  return Math.max(0, origin + k * beat - land);
}

/** Peal column order: 3 columns (0 left, 1 mid, 2 right), never starting under the player, mirrored on echo. */
export function pealOrder(playerCol: number, rnd: () => number, mirror = false): number[] {
  const starts = [0, 1, 2].filter((c) => c !== playerCol);
  const first = starts[Math.floor(rnd() * starts.length)];
  const rest = [0, 1, 2].filter((c) => c !== first);
  if (rnd() < 0.5) rest.reverse();
  const order = [first, ...rest];
  return mirror ? order.map((c) => 2 - c) : order;
}

/** Clapper drop x: on the player's side of them, offset so one dash either way is safe. Clamped to the arena. */
export function clapperX(playerX: number, minX: number, maxX: number, rnd: () => number): number {
  const off = (rnd() - 0.5) * 24;
  return Math.max(minX, Math.min(maxX, playerX + off));
}
