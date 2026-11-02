/**
 * Pure rules for MONSIEUR FROMAGE's "Wheel of Fate" (see bosses/Fromage.ts). Kept free of Phaser so it's unit-testable.
 *
 * Every attack starts with a spin of the wheel. The wedge that ends on top is the next move. Each player
 * hit during the spin advances the wheel one wedge (at most MAX_NUDGES per spin): the player can rig the show.
 */

export type FromageMove = 'roll' | 'crackers' | 'mice' | 'fondue' | 'grater' | 'bankrupt' | 'double';

/** Wedges per phase, in wheel order. Repeats act as weights. */
export const WHEELS: Record<1 | 2 | 3, readonly FromageMove[]> = {
  1: ['roll', 'crackers', 'mice', 'roll', 'crackers', 'mice'],
  2: ['roll', 'crackers', 'fondue', 'mice', 'grater', 'crackers', 'roll', 'fondue'],
  3: ['roll', 'bankrupt', 'crackers', 'grater', 'double', 'mice', 'fondue', 'crackers'],
};

/** Hits during one spin that may nudge the wheel. */
export const MAX_NUDGES = 2;
/** Shards BANKRUPT takes at most. */
export const BANKRUPT_MAX = 10;

export function wheelFor(phase: number): readonly FromageMove[] {
  const p = Math.min(3, Math.max(1, Math.floor(phase))) as 1 | 2 | 3;
  return WHEELS[p];
}

/** Proper modulo (wraps negatives too). */
export function wrap(i: number, len: number): number {
  return ((i % len) + len) % len;
}

/** Index the wheel stops on after `ticks` spin steps plus `nudges` player nudges from `start`. */
export function spinResult(len: number, start: number, ticks: number, nudges: number): number {
  return wrap(start + ticks + nudges, len);
}

export function nudgeAllowed(nudgesSoFar: number): boolean {
  return nudgesSoFar < MAX_NUDGES;
}

/** Shards BANKRUPT actually takes: never more than the player has, never negative. */
export function stealAmount(playerShards: number, max = BANKRUPT_MAX): number {
  return Math.max(0, Math.min(max, Math.floor(playerShards)));
}

/**
 * Number of ticks for the next spin: at least one full lap (it has to look like a spin), and the
 * landing move is never the same as the last two moves in a row (no 3x repeats) and never 'double'
 * twice in a row. `rnd` returns [0, 1).
 */
export function planSpin(wheel: readonly FromageMove[], start: number, history: readonly FromageMove[], rnd: () => number = Math.random): number {
  const len = wheel.length;
  const [a, b] = history.slice(-2);
  const banned = (m: FromageMove): boolean => (a === m && b === m) || (m === 'double' && b === 'double');
  const ok: number[] = [];
  for (let t = len; t < len * 2; t++) if (!banned(wheel[spinResult(len, start, t, 0)])) ok.push(t);
  if (!ok.length) return len;
  return ok[Math.min(ok.length - 1, Math.floor(rnd() * ok.length))];
}

/**
 * Delays (ms) between the spin's ticks: starts fast, slows down like a real wheel, sums to `totalMs`.
 */
export function tickDelays(ticks: number, totalMs: number): number[] {
  if (ticks <= 0) return [];
  const w: number[] = [];
  for (let i = 0; i < ticks; i++) w.push(1 + (i / ticks) ** 2 * 4);
  const sum = w.reduce((s, x) => s + x, 0);
  return w.map((x) => (x / sum) * totalMs);
}
