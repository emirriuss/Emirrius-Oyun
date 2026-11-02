/**
 * UMBRA, THE CAST SHADOW (w4-10): pure rules, no Phaser import (tested in tests/umbraPlan.test.ts).
 *
 * UMBRA is a shadow cast by hanging lanterns. Swords pass through it unless a lantern hangs almost
 * straight above its feet: then the shadow condenses into something solid enough to cut. The player
 * moves the light by striking the lantern (side hits slide it along the ceiling rail, an up-slash
 * hoists it, a pogo lowers it). The shadow's reach toward the player comes from the shadow that leans
 * AT them, so keeping the light between you and it shortens its arms.
 */

/** Arena: one screen, 30x17 tiles of 16px (see levels/world4/w4-10.ts). */
export const ARENA = { left: 16, right: 464, floor: 224, ceil: 16 } as const;

/** The ceiling rail the lanterns hang from (anchor y) and the x range they can slide over. */
export const RAIL = { y: 22, min: 56, max: 424 } as const;
/** Lantern centre y per chain length: 0 = hoisted high, 2 = hanging low. */
export const DROP_Y = [80, 108, 136] as const;
export type Drop = 0 | 1 | 2;
/** px a side hit (or a snuff wisp) slides a lantern along the rail */
export const PUSH_PX = 48;
/** ms between lantern hits that count (more hits still clang, but don't move it) */
export const LANTERN_HIT_COOLDOWN = 250;

export interface LanternState {
  x: number;
  drop: Drop;
  lit: boolean;
}

export type LanternHit = 'side' | 'up' | 'slam';

/** Classify a player hit on a lantern from its HitInfo (up-slash: big lift, little push; pogo: slam). */
export function lanternHitKind(h: { slam?: boolean; kbX: number; kbY: number }): LanternHit {
  if (h.slam) return 'slam';
  if (h.kbY <= -200 && Math.abs(h.kbX) <= 60) return 'up';
  return 'side';
}

/**
 * New lantern state after a hit. Side hits slide it `PUSH_PX` in `dir` (away from the striker),
 * up-slashes hoist it one notch, pogos lower it one notch. An unlit lantern is only relit (it doesn't move).
 */
export function hitLantern(s: LanternState, kind: LanternHit, dir: number): LanternState {
  if (!s.lit) return { ...s, lit: true };
  if (kind === 'up') return { ...s, drop: Math.max(0, s.drop - 1) as Drop };
  if (kind === 'slam') return { ...s, drop: Math.min(2, s.drop + 1) as Drop };
  return { ...s, x: clampRail(s.x + Math.sign(dir || 1) * PUSH_PX) };
}

export function clampRail(x: number): number {
  return Math.max(RAIL.min, Math.min(RAIL.max, x));
}

/** min px between two lanterns on the rail (so one sword swing never moves both) */
export const LAMP_GAP = 32;

/** Two lantern rail positions pushed at least LAMP_GAP apart around their midpoint, kept on the rail (order kept). */
export function separateLamps(a: number, b: number, gap: number = LAMP_GAP): [number, number] {
  if (Math.abs(a - b) >= gap) return [a, b];
  let lo = (a + b) / 2 - gap / 2;
  lo = Math.max(RAIL.min, Math.min(RAIL.max - gap, lo));
  const hi = lo + gap;
  return a <= b ? [lo, hi] : [hi, lo];
}

// ------------------------------------------------------------------ shadow geometry

/** Shadow stretch range (1 = the sprite's natural height). */
export const STRETCH = { min: 0.35, max: 2.4 } as const;
/** horizontal offset / light height below which the shadow condenses */
export const CONDENSE_T = 0.32;
/** max lean of a shadow (radians) */
export const MAX_LEAN = 0.5;
/** reach (px) of a Lean Strike at stretch 1 */
export const BASE_REACH = 30;

export interface ShadowGeom {
  /** |dx| / height of the light above the floor */
  t: number;
  /** height multiplier of the shadow */
  stretch: number;
  /** rotation (radians); + = top leans right (shadow falls away from the light) */
  lean: number;
  /** which way the shadow falls: +1 right, -1 left, 0 straight under the light */
  dir: number;
  condensed: boolean;
}

/** The shadow a light at (lx, ly) casts from feet at x = feetX on a floor at floorY. */
export function shadowGeom(lx: number, ly: number, feetX: number, floorY: number = ARENA.floor): ShadowGeom {
  const h = Math.max(8, floorY - ly);
  const dx = feetX - lx;
  const t = Math.abs(dx) / h;
  const dir = Math.abs(dx) < 0.5 ? 0 : Math.sign(dx);
  const stretch = Math.max(STRETCH.min, Math.min(STRETCH.max, STRETCH.min + t));
  const lean = dir * Math.min(MAX_LEAN, t * 0.4);
  return { t, stretch, lean, dir, condensed: t < CONDENSE_T };
}

/** Half-width (px) of the zone under a light where the shadow condenses. */
export function condenseHalfWidth(ly: number, floorY: number = ARENA.floor): number {
  return CONDENSE_T * Math.max(8, floorY - ly);
}

/**
 * Stretch of the longest shadow falling toward `dir` (+1 / -1), over all lit lights. A shadow that falls
 * the other way doesn't reach you, so with no light behind the boss its reach toward you is the minimum.
 */
export function stretchToward(lights: readonly { x: number; y: number; lit: boolean }[], feetX: number, dir: number, floorY: number = ARENA.floor): number {
  let best: number = STRETCH.min;
  for (const l of lights) {
    if (!l.lit) continue;
    const g = shadowGeom(l.x, l.y, feetX, floorY);
    if (g.dir === Math.sign(dir) && g.stretch > best) best = g.stretch;
  }
  return best;
}

export function reachFor(stretch: number): number {
  return Math.round(BASE_REACH * stretch);
}

// ------------------------------------------------------------------ damage rule

/**
 * Damage multiplier on a player hit.
 *  P1/P2 (shadow form): 0 = the hit passes straight through (not condensed, not sprawled).
 *    Sprawled after a heavy but not under a light: 0.6 (half there). Condensed: 1, x1.25 while sprawled.
 *  P3 (the body): always solid; 0.6 while its lantern is snuffed (at home in the dark), x1.25 sprawled.
 */
export function damageMul(o: { phase: number; condensed: boolean; recovering: boolean; lampOut?: boolean }): number {
  if (o.phase >= 3) return (o.lampOut ? 0.6 : 1) * (o.recovering ? 1.25 : 1);
  if (o.condensed) return o.recovering ? 1.25 : 1;
  return o.recovering ? 0.6 : 0;
}

// ------------------------------------------------------------------ moves

export type UmbraMove = 'lean' | 'sweep' | 'wisp' | 'pounce' | 'cross' | 'swap' | 'longarm' | 'gutter' | 'grab';

/** Moves per phase (index 0 = P1). The heavy is the punishable one. */
export const MOVES: readonly (readonly UmbraMove[])[] = [
  ['lean', 'sweep', 'wisp', 'pounce'],
  ['lean', 'sweep', 'wisp', 'cross', 'swap', 'pounce'],
  ['longarm', 'sweep', 'gutter', 'grab'],
];
export const HEAVY: readonly UmbraMove[] = ['pounce', 'pounce', 'grab'];

/** Wind-up (telegraph) ms per move per phase [P1, P2, P3]. Floors: P1 >= 550, P2 >= 450, P3 >= 380. */
export const WINDUP: Record<UmbraMove, readonly [number, number, number]> = {
  lean: [600, 480, 420],
  sweep: [650, 520, 440],
  wisp: [560, 460, 400],
  pounce: [850, 700, 600],
  cross: [620, 500, 440],
  swap: [700, 600, 500],
  longarm: [600, 520, 420],
  gutter: [620, 540, 460],
  grab: [820, 700, 600],
};
/** punish window (ms) after each phase's heavy */
export const RECOVER_MS = [1100, 1000, 1200] as const;
/** cooldown after a move (ms) per phase */
export const COOLDOWN = [900, 700, 560] as const;
/** walk speed (px/s) per phase; condensed shadows crawl at CONDENSED_SPEED of it */
export const WALK = [45, 55, 70] as const;
export const CONDENSED_SPEED = 0.4;

export const HP = 130;
export const THRESHOLDS = [0.66, 0.33] as const;
export const HEARTS = { periodicMs: 24000, maxOnField: 1, perParries: 4, onPhase: 1 } as const;
export const BAR_NAME = 'UMBRA, THE CAST SHADOW';
export const BAR_TITLE = 'Where the Light Falls Short';

export interface PickCtx {
  phase: number;
  /** |dx| to the player */
  dist: number;
  /** a lit lantern hangs close enough to condense it soon (it wants to push the light away) */
  lampNear?: boolean;
  /** P3: its lantern is snuffed already */
  lampOut?: boolean;
}

function weight(m: UmbraMove, c: PickCtx): number {
  const close = c.dist < 70, far = c.dist > 150;
  switch (m) {
    case 'lean': return close ? 3 : far ? 0.5 : 2;
    case 'longarm': return close ? 2 : far ? 1 : 3;
    case 'sweep': return close ? 1 : 2;
    case 'wisp': return c.lampNear ? 3 : 0.8;
    case 'cross': return close ? 1 : 2;
    case 'swap': return 1;
    case 'gutter': return c.lampOut ? 0 : c.lampNear ? 2.5 : 1.2;
    case 'pounce':
    case 'grab': return far ? 1.5 : 1;
  }
}

/**
 * Next move: never the same twice in a row, and never more than two moves without the phase's heavy
 * (so every ~3 moves there is a punish window). Weighted by range and the lantern situation.
 */
export function pickUmbraMove(c: PickCtx, hist: readonly UmbraMove[], rnd: () => number = Math.random): UmbraMove {
  const ph = Math.max(0, Math.min(2, c.phase - 1));
  const heavy = HEAVY[ph];
  const last = hist[hist.length - 1];
  const recent = hist.slice(-2);
  if (recent.length === 2 && !recent.includes(heavy)) return heavy;
  const opts = MOVES[ph].filter((m) => m !== last).map((m) => [m, weight(m, c)] as const).filter(([, w]) => w > 0);
  const total = opts.reduce((s, [, w]) => s + w, 0);
  let r = rnd() * total;
  for (const [m, w] of opts) {
    r -= w;
    if (r < 0) return m;
  }
  return opts[opts.length - 1][0];
}

// ------------------------------------------------------------------ lantern layouts + resume

/** Lantern layout when a phase begins (P2 adds the second lamp on the far side; P3 keeps one). */
export function lanternLayout(phase: number, bossX: number): LanternState[] {
  const mid = (RAIL.min + RAIL.max) / 2;
  // P1: the lamp starts over the far half from the boss, so its first shadow is long and readable
  const away = bossX >= mid ? RAIL.min + 64 : RAIL.max - 64;
  if (phase <= 1) return [{ x: away, drop: 1, lit: true }];
  if (phase === 2) return [{ x: RAIL.min + 40, drop: 1, lit: true }, { x: RAIL.max - 40, drop: 1, lit: true }];
  return [{ x: mid, drop: 1, lit: true }];
}

/** "Retry from Twin Lamps / Lights Out": the phase and HP fraction to start at. */
export function resumeState(stage: string | undefined): { phase: number; hpFrac: number } | null {
  if (stage === 'p2') return { phase: 2, hpFrac: THRESHOLDS[0] };
  if (stage === 'p3') return { phase: 3, hpFrac: THRESHOLDS[1] };
  return null;
}

/** Retry labels per stage (GameOverScene). */
export const UMBRA_RETRY: Record<string, string> = { p2: 'Twin Lamps', p3: 'Lights Out' };
