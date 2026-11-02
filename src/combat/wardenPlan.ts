/**
 * Pure move-selection rules for THE CHAINED WARDEN (see bosses/Warden.ts). Kept free of Phaser so it's unit-testable.
 */

export type WardenMove = 'slam' | 'sweep' | 'hook' | 'leap' | 'whirl' | 'debris' | 'combo' | 'rake' | 'quake';

/** Close / mid range limits in px (horizontal distance to the player). */
export const WARDEN_CLOSE = 80;
export const WARDEN_MID = 180;
/** ms the player may camp a ledge before the Warden leans hard on the hook */
export const WARDEN_CAMP_MS = 3000;

/** Weighted candidate moves for the situation. `high` = player up on a ledge, `highMs` = for how long. */
export function wardenWeights(phase: number, dx: number, high: boolean, highMs: number): [WardenMove, number][] {
  const p = Math.min(3, Math.max(1, phase));
  const w: [WardenMove, number][] = [];
  if (high) {
    w.push(['hook', highMs > WARDEN_CAMP_MS ? 5 : 3]);
    if (p >= 2) w.push(['debris', p >= 3 ? 2 : 1]);
  } else if (dx < WARDEN_CLOSE) {
    w.push(['slam', p >= 3 ? 2 : 3], ['sweep', 2]);
    if (p >= 2) w.push(['combo', p >= 3 ? 3 : 1]);
    if (p >= 3) w.push(['quake', 2], ['debris', 1]);
  } else if (dx < WARDEN_MID) {
    w.push(['hook', 2]);
    if (p >= 2) w.push(['whirl', 2], ['rake', 2]);
    if (p >= 3) w.push(['quake', 1], ['debris', 1]);
  } else {
    w.push(['hook', 2]);
    if (p >= 2) w.push(['leap', 3], ['rake', 2]);
    if (p >= 3) w.push(['debris', 1]);
  }
  return w;
}

/** Weighted random pick; never the same move 3x in a row. `rnd` returns [0, 1). Generic so other bosses can reuse it. */
export function pickMove<M extends string>(w: [M, number][], history: readonly M[], rnd: () => number = Math.random): M | null {
  const [a, b] = history.slice(-2);
  const ok = w.filter(([m, n]) => n > 0 && !(a === m && b === m));
  const total = ok.reduce((s, [, n]) => s + n, 0);
  if (!total) return null;
  let r = rnd() * total;
  for (const [m, n] of ok) if ((r -= n) < 0) return m;
  return ok[ok.length - 1][0];
}
