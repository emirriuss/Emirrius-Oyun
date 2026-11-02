/**
 * Pure rules for THE GILDED CROUPIER (see bosses/Croupier.ts): move selection, every "gamble" roll
 * and the pity rules that keep the luck fair. Kept free of Phaser so it's unit-testable; every roll
 * takes an injected `rnd` (returns [0, 1)) so tests can be deterministic.
 */
import { pickMove } from './wardenPlan';

export { pickMove };

export type CroupierMove = 'coin' | 'dice' | 'deal' | 'roulette' | 'reels' | 'double';
export type Rnd = () => number;
export type Coin = 'heads' | 'tails';
export type Suit = 'spade' | 'club' | 'diamond' | 'heart';
export type Color = 'red' | 'black' | 'green';
export type Sym = 'cherry' | 'bell' | 'seven' | 'skull';

/** Horizontal distance (px) under which the player counts as "close". */
export const CROUPIER_CLOSE = 110;
/** Minimum telegraph (ms) after an outcome is revealed before it hits, per phase index 0..2. */
export const WINDUP_FLOOR = [500, 450, 400];
/** Double-or-nothing card odds: 2 good cards, 1 bad. */
export const HIGH_CARD_ODDS = { good: 2, bad: 1 };

const SUITS: Suit[] = ['spade', 'club', 'diamond', 'heart'];
const SYMS: Sym[] = ['cherry', 'bell', 'seven', 'skull'];

const pick = <T>(arr: readonly T[], rnd: Rnd): T => arr[Math.min(arr.length - 1, Math.floor(rnd() * arr.length))];

/**
 * Weighted candidate moves. P1: coin/dice/deal; P2 adds roulette + reels; P3 adds double.
 * Close favours dice, far favours coin/deal; a player up high gets coin & deal (projectiles reach
 * ledges) and no roulette (it's a floor attack).
 */
export function croupierWeights(phase: number, dx: number, playerHigh: boolean): [CroupierMove, number][] {
  const p = Math.min(3, Math.max(1, phase));
  const close = dx < CROUPIER_CLOSE;
  const w: [CroupierMove, number][] = [];
  if (playerHigh) w.push(['coin', 3], ['dice', 1], ['deal', 3]);
  else if (close) w.push(['coin', 1], ['dice', 3], ['deal', 1]);
  else w.push(['coin', 2], ['dice', 1], ['deal', 2]);
  if (p >= 2) {
    if (!playerHigh) w.push(['roulette', close ? 2 : 3]);
    w.push(['reels', 2]);
  }
  if (p >= 3) w.push(['double', 2]);
  return w;
}

/** Dice thrown per Dice Toss: 3 in phase 3, otherwise 2. */
export function diceCount(phase: number): 2 | 3 {
  return phase >= 3 ? 3 : 2;
}

export function flipCoin(rnd: Rnd): Coin {
  return rnd() < 0.5 ? 'heads' : 'tails';
}

/** Pity bookkeeping carried between rolls. */
export interface LuckState {
  /** consecutive deals that contained no heart */
  dealsWithoutHeart: number;
  /** last (up to) 2 roulette results, oldest first */
  lastColors: Color[];
  /** consecutive "high" dice totals */
  highDiceStreak: number;
}

export function newLuck(): LuckState {
  return { dealsWithoutHeart: 0, lastColors: [], highDiceStreak: 0 };
}

/** A dice total is "high" when the average pip is >= 5. */
const isHigh = (dice: readonly number[]) => dice.reduce((s, d) => s + d, 0) >= 5 * dice.length;

/** Roll `n` d6. Pity: right after a high total, the next total is never high. */
export function rollDice(n: number, rnd: Rnd, luck?: LuckState): number[] {
  const roll = () => Array.from({ length: n }, () => 1 + Math.min(5, Math.floor(rnd() * 6)));
  let dice = roll();
  if (luck && luck.highDiceStreak >= 1) {
    for (let i = 0; i < 20 && isHigh(dice); i++) dice = roll();
    // Still high after the re-rolls (very unlikely): knock the biggest die down until it isn't.
    while (isHigh(dice)) {
      const i = dice.indexOf(Math.max(...dice));
      dice[i] -= 1;
    }
  }
  return dice;
}

export function nextLuckDice(luck: LuckState, dice: readonly number[]): LuckState {
  return { ...luck, lastColors: [...luck.lastColors], highDiceStreak: isHigh(dice) ? luck.highDiceStreak + 1 : 0 };
}

/** Deal `count` uniform suits. Pity: after 2 heartless deals, this one has at least one heart. */
export function dealCards(rnd: Rnd, luck: LuckState, count = 3): Suit[] {
  const suits = Array.from({ length: count }, () => pick(SUITS, rnd));
  if (count > 0 && luck.dealsWithoutHeart >= 2 && !suits.includes('heart')) {
    suits[Math.min(count - 1, Math.floor(rnd() * count))] = 'heart';
  }
  return suits;
}

export function nextLuckDeal(luck: LuckState, suits: readonly Suit[]): LuckState {
  return { ...luck, lastColors: [...luck.lastColors], dealsWithoutHeart: suits.includes('heart') ? 0 : luck.dealsWithoutHeart + 1 };
}

/** Wheel weights: green is rare. */
const COLOR_WEIGHT: Record<Color, number> = { red: 4, black: 4, green: 1 };

/** Spin the wheel over `colors`. Pity: never the same color 3 times in a row. */
export function spinRoulette(colors: Color[], rnd: Rnd, luck: LuckState): Color {
  const [a, b] = luck.lastColors.slice(-2);
  const banned = a !== undefined && a === b ? a : null;
  let pool = colors.filter((c) => c !== banned);
  if (!pool.length) pool = colors;
  const total = pool.reduce((s, c) => s + COLOR_WEIGHT[c], 0);
  let r = rnd() * total;
  for (const c of pool) if ((r -= COLOR_WEIGHT[c]) < 0) return c;
  return pool[pool.length - 1];
}

export function nextLuckRoulette(luck: LuckState, c: Color): LuckState {
  return { ...luck, lastColors: [...luck.lastColors, c].slice(-2) };
}

/** Three uniform reel symbols. */
export function spinReels(rnd: Rnd): [Sym, Sym, Sym] {
  return [pick(SYMS, rnd), pick(SYMS, rnd), pick(SYMS, rnd)];
}

/** Triple = jackpot of that symbol (and `each` is empty); otherwise each symbol pays out on its own. */
export function reelPayout(s: readonly Sym[]): { triple: Sym | null; each: Sym[] } {
  if (s.length === 3 && s[0] === s[1] && s[1] === s[2]) return { triple: s[0], each: [] };
  return { triple: null, each: [...s] };
}

/**
 * Roulette floor stripes covering [left, right] exactly (no gaps/overlap; the last stripe absorbs the
 * remainder). Alternates red/black; with 'green' in `colors`, exactly the middle stripe is green.
 */
export function stripeLayout(left: number, right: number, colors: Color[], stripeW = 48): { x0: number; x1: number; color: Color }[] {
  const n = Math.max(1, Math.floor((right - left) / stripeW));
  const mid = Math.floor(n / 2);
  const green = colors.includes('green');
  const out: { x0: number; x1: number; color: Color }[] = [];
  for (let i = 0; i < n; i++) {
    const x0 = left + i * stripeW;
    const x1 = i === n - 1 ? right : x0 + stripeW;
    out.push({ x0, x1, color: green && i === mid ? 'green' : i % 2 === 0 ? 'red' : 'black' });
  }
  return out;
}

/** Shuffled 3-card deck for Double or Nothing: exactly 2 good, 1 bad. */
export function highCardDeck(rnd: Rnd): ('good' | 'bad')[] {
  const deck: ('good' | 'bad')[] = [
    ...Array<'good'>(HIGH_CARD_ODDS.good).fill('good'),
    ...Array<'bad'>(HIGH_CARD_ODDS.bad).fill('bad'),
  ];
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.min(i, Math.floor(rnd() * (i + 1)));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}
