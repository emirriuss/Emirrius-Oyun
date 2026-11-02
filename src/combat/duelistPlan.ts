/**
 * Pure rules for TWIN BLADES (see bosses/Duelist.ts): per-phase move sets, the move picker,
 * telegraph timings and the Thousand Cuts layout. No Phaser import so vitest can test it.
 *
 *  P1 "One Blade"   : learn the parry. Long tells, Iaido Draw is the punishable heavy.
 *  P2 "Twin Blades" : second blade drawn. Red finishers mixed into combos, Mirror Guard, Falling Moon.
 *  P3 "Shadow Duet" : the shadow twin joins. Pincers, crossed fans, Thousand Cuts finisher.
 */
import { pickMove } from './wardenPlan';

export type DuelistMove =
  | 'combo' // 2-3 dash-slashes (P1 2 hits, all parryable)
  | 'iaido' // sheathe → long instant draw cut (parryable), then a punish window
  | 'rising' // anti-air jumping slash at a player up on a ledge
  | 'fan' // hop + blade fan
  | 'backstep' // hop away (sets up an Iaido from range)
  | 'triple' // 2 parryable dash-slashes + red thrust finisher
  | 'crossCut' // X-shaped slash wave along the floor (parry reflects it)
  | 'guard' // Mirror Guard: blocks and red-counters hits; breaks if left alone
  | 'fallingMoon' // leap high, red plunge onto the player, blade stuck in the floor
  | 'blink' // vanish, reappear behind the player, slash
  | 'pincer' // P3: boss + shadow dash from both sides, staggered
  | 'crossedFans' // P3: boss + shadow throw crossing fans
  | 'thousandCuts'; // P3 finisher: sequenced red columns across the arena

/** Moves that end in a punish window (`recover()`). The picker forces one every HEAVY_EVERY moves. */
export const HEAVY_MOVES: readonly DuelistMove[] = ['iaido', 'guard', 'fallingMoon', 'thousandCuts'];
/** at most this many non-heavy moves in a row */
export const HEAVY_EVERY = 3;

/** Horizontal range bands (px). */
export const DUELIST_CLOSE = 60;
export const DUELIST_MID = 150;
/** Player is "high" when their feet are this far above the arena floor. */
export const DUELIST_HIGH_PX = 40;
/** Phase 3: ms before a slain shadow returns. */
export const SHADOW_RESPAWN_MS = 15000;

export interface DuelistCtx {
  phase: number;
  /** horizontal distance to the player */
  dx: number;
  /** player feet are well above the floor (on a ledge) */
  high: boolean;
  /** P3: the shadow twin is alive (pincer / crossed fans need it) */
  shadow: boolean;
}

/** Weighted candidate moves for the situation (before repeat / heavy rules). */
export function duelistWeights(c: DuelistCtx): [DuelistMove, number][] {
  const p = Math.min(3, Math.max(1, c.phase));
  const close = c.dx < DUELIST_CLOSE;
  const far = c.dx >= DUELIST_MID;
  const w: [DuelistMove, number][] = [];
  if (p === 1) {
    w.push(['combo', close ? 4 : 2], ['iaido', far ? 1 : 2], ['fan', far ? 3 : 1], ['backstep', close ? 2 : 0]);
    if (c.high) w.push(['rising', 5]);
  } else if (p === 2) {
    w.push(
      ['triple', close ? 4 : 2],
      ['crossCut', far ? 3 : 1],
      ['guard', close ? 2 : 1],
      ['fallingMoon', far ? 2 : 1],
      ['blink', far ? 2 : 1],
      ['iaido', 1],
    );
    if (c.high) w.push(['rising', 4], ['fallingMoon', 2]);
  } else {
    w.push(['triple', close ? 3 : 1], ['blink', 1], ['iaido', 1], ['thousandCuts', 2]);
    if (c.shadow) w.push(['pincer', 3], ['crossedFans', far ? 3 : 2]);
    else w.push(['crossCut', 2], ['guard', 1]);
    if (c.high) w.push(['rising', 3]);
  }
  // merge duplicate entries
  const out = new Map<DuelistMove, number>();
  for (const [m, n] of w) if (n > 0) out.set(m, (out.get(m) ?? 0) + n);
  return [...out];
}

/** Non-heavy moves since the last heavy (or since the start). */
export function sinceHeavy(history: readonly DuelistMove[]): number {
  let n = 0;
  for (let i = history.length - 1; i >= 0 && !HEAVY_MOVES.includes(history[i]); i--) n++;
  return n;
}

/**
 * Pick the next move. Rules: never the same move twice in a row; after HEAVY_EVERY non-heavy
 * moves only heavies are allowed; a backstep strongly favours an Iaido from range.
 */
export function pickDuelistMove(c: DuelistCtx, history: readonly DuelistMove[], rnd: () => number = Math.random): DuelistMove {
  const last = history[history.length - 1];
  let w = duelistWeights(c).filter(([m]) => m !== last);
  if (last === 'backstep') w = w.map(([m, n]) => [m, m === 'iaido' ? n * 4 + 4 : n] as [DuelistMove, number]);
  if (sinceHeavy(history) >= HEAVY_EVERY) {
    const heavy = w.filter(([m]) => HEAVY_MOVES.includes(m));
    if (heavy.length) w = heavy;
  }
  // pickMove only bans 3x repeats; we already removed `last`, so pass an empty history
  return pickMove(w, [], rnd) ?? (c.phase >= 2 ? 'triple' : 'combo');
}

/** Telegraph / timing table per phase (ms). Shorter every phase. */
export interface DuelistTimings {
  dash: number; // first dash-slash of a combo
  chain: number; // follow-up dash-slashes
  thrust: number; // red finisher of the triple
  iaido: number; // sheathe before the draw
  rising: number;
  fan: number;
  crossCut: number;
  fallHover: number; // Falling Moon: hover over the marked spot
  guard: number; // Mirror Guard: how long the stance holds
  counter: number; // red counter tell after a blocked hit
  pincerGap: number; // P3: delay between the boss's and the shadow's dash
  /** punish windows */
  recoverIaido: number;
  recoverFall: number;
  recoverGuard: number;
  recoverCuts: number;
  /** cooldown after a normal move */
  cooldown: number;
}

const TIMINGS: Record<1 | 2 | 3, DuelistTimings> = {
  1: { dash: 420, chain: 240, thrust: 420, iaido: 750, rising: 380, fan: 380, crossCut: 420, fallHover: 600, guard: 1400, counter: 320, pincerGap: 300, recoverIaido: 950, recoverFall: 1100, recoverGuard: 900, recoverCuts: 1500, cooldown: 900 },
  2: { dash: 340, chain: 210, thrust: 380, iaido: 600, rising: 330, fan: 330, crossCut: 360, fallHover: 520, guard: 1300, counter: 280, pincerGap: 280, recoverIaido: 800, recoverFall: 1000, recoverGuard: 850, recoverCuts: 1450, cooldown: 650 },
  3: { dash: 300, chain: 190, thrust: 340, iaido: 520, rising: 300, fan: 300, crossCut: 320, fallHover: 460, guard: 1200, counter: 260, pincerGap: 260, recoverIaido: 750, recoverFall: 950, recoverGuard: 800, recoverCuts: 1400, cooldown: 550 },
};

export function duelistTimings(phase: number): DuelistTimings {
  return TIMINGS[Math.min(3, Math.max(1, phase)) as 1 | 2 | 3];
}

/** One vertical cut column of Thousand Cuts. `order` 0 fires first. */
export interface CutColumn {
  x: number;
  w: number;
  order: number;
}

/**
 * Thousand Cuts layout: split [left, right] into equal slots of about `slotW`, leave `gaps` slots
 * uncut (never two adjacent, never the outer ones), and cut the rest in a sweep starting from
 * `fromLeft ? left : right`. Standing in a gap is always safe; quick players can also dash
 * behind the sweep.
 */
export function cutColumns(left: number, right: number, fromLeft: boolean, rnd: () => number = Math.random, slotW = 40, gaps = 2): CutColumn[] {
  const n = Math.max(3, Math.floor((right - left) / slotW));
  const w = (right - left) / n;
  const free = new Set<number>();
  const inner = Array.from({ length: n - 2 }, (_, i) => i + 1);
  for (let tries = 0; free.size < gaps && tries < 64; tries++) {
    const i = inner[Math.floor(rnd() * inner.length)];
    if (free.has(i) || free.has(i - 1) || free.has(i + 1)) continue;
    free.add(i);
  }
  if (!free.size) free.add(Math.floor(n / 2));
  const cols: CutColumn[] = [];
  const idx = Array.from({ length: n }, (_, i) => i).filter((i) => !free.has(i));
  if (!fromLeft) idx.reverse();
  idx.forEach((i, order) => cols.push({ x: left + i * w, w, order }));
  return cols;
}
