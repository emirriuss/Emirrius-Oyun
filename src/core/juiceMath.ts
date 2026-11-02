/**
 * Pure (Phaser-free) math behind Juice: impact preset scaling, slowmo state and the
 * camera punch / kick envelopes. Kept separate so it can be unit tested.
 */

/** One row of `JUICE.impact` in config.ts. All fields are base values at mul = 1. */
export interface ImpactPreset {
  /** hitstop (physics + entity freeze), ms. 0 = none */
  hitstop: number;
  /** camera shake intensity (Phaser units, fraction of the view) and duration ms */
  shake: number;
  shakeMs: number;
  /** extra camera zoom for Juice.punch (0.06 = +6%). 0 = none */
  punch: number;
  /** camera nudge in px along the impact angle. 0 = none */
  kick: number;
  /** directional spark scale. 0 = no spark */
  spark: number;
  /** gamepad rumble motor strengths 0..1 and duration ms */
  rumbleWeak: number;
  rumbleStrong: number;
  rumbleMs: number;
  /** time scale while slowed (0.3 = 30% speed) and real-time duration ms. slowmoMs 0 = none */
  slowmo: number;
  slowmoMs: number;
}

/** Upper limits after `mul` scaling, so stacked combo multipliers can't lock the game up. */
export const IMPACT_LIMITS = {
  mul: 3,
  hitstop: 300,
  shake: 0.03,
  punch: 0.2,
  kick: 16,
  spark: 3,
  rumbleMs: 600,
  slowmoMin: 0.1,
  slowmoMs: 1200,
} as const;

const clamp = (v: number, lo: number, hi: number) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : lo);

/**
 * Scales a preset by `mul` (clamped to [0, IMPACT_LIMITS.mul]). Intensities and hitstop scale
 * linearly; shake/rumble/slowmo durations stay fixed; slowmo depth scales as 1 - (1 - scale) * mul.
 * Every output is clamped to IMPACT_LIMITS.
 */
export function resolveImpact(p: ImpactPreset, mul = 1): ImpactPreset {
  const m = clamp(mul, 0, IMPACT_LIMITS.mul);
  const L = IMPACT_LIMITS;
  return {
    hitstop: Math.round(clamp(p.hitstop * m, 0, Math.max(L.hitstop, p.hitstop))),
    shake: clamp(p.shake * m, 0, Math.max(L.shake, p.shake)),
    shakeMs: Math.max(0, p.shakeMs),
    punch: clamp(p.punch * m, 0, L.punch),
    kick: clamp(p.kick * m, 0, L.kick),
    spark: clamp(p.spark * m, 0, L.spark),
    rumbleWeak: clamp(p.rumbleWeak * m, 0, 1),
    rumbleStrong: clamp(p.rumbleStrong * m, 0, 1),
    rumbleMs: clamp(p.rumbleMs, 0, L.rumbleMs),
    slowmo: p.slowmoMs > 0 ? clamp(1 - (1 - p.slowmo) * m, L.slowmoMin, 1) : 1,
    slowmoMs: p.slowmoMs > 0 && m > 0 ? Math.round(clamp(p.slowmoMs, 0, L.slowmoMs)) : 0,
  };
}

// ------------------------------------------------------------------ slowmo

/** Slowmo state in real (unscaled) milliseconds. scale 1 = normal speed. */
export interface SlowmoState {
  scale: number;
  start: number;
  end: number;
}

export const SLOWMO_IDLE: SlowmoState = { scale: 1, start: 0, end: 0 };
/** Fraction of the slowmo duration spent easing back to 1 (the rest holds at full depth). */
export const SLOWMO_EASE_FRAC = 0.4;

/**
 * Merges a new slowmo request into the current state. While one is active the result keeps
 * the stronger (smaller) scale and the later end; the hold restarts from `now`.
 */
export function mergeSlowmo(cur: SlowmoState, now: number, scale: number, ms: number): SlowmoState {
  const s = clamp(scale, IMPACT_LIMITS.slowmoMin, 1);
  if (ms <= 0 || s >= 1) return cur;
  const end = now + ms;
  if (now >= cur.end) return { scale: s, start: now, end };
  return { scale: Math.min(cur.scale, s), start: now, end: Math.max(cur.end, end) };
}

/** Effective time scale at `now`: holds at state.scale, then smoothsteps back to exactly 1 at end. */
export function slowmoScaleAt(st: SlowmoState, now: number): number {
  if (now >= st.end || st.scale >= 1) return 1;
  const dur = Math.max(1, st.end - st.start);
  const t = clamp((now - st.start) / dur, 0, 1);
  const hold = 1 - SLOWMO_EASE_FRAC;
  if (t <= hold) return st.scale;
  const u = (t - hold) / SLOWMO_EASE_FRAC;
  return st.scale + (1 - st.scale) * u * u * (3 - 2 * u);
}

/**
 * Per-system values for a time scale. Arcade physics' timeScale is inverse (2 = half speed).
 * Hitstop is separate: it pauses the physics world and leaves these values alone, so the two
 * compose without either one restoring the other's state.
 */
export function timeScales(scale: number): { clock: number; tweens: number; anims: number; physics: number } {
  const s = clamp(scale, IMPACT_LIMITS.slowmoMin, 1);
  return { clock: s, tweens: s, anims: s, physics: 1 / s };
}

// ------------------------------------------------------------------ camera envelopes

/** Punch zoom envelope: fast ease-in over the first 25%, then ease-out back to 0. t in [0,1]. */
export function punchEnvelope(t: number): number {
  if (t <= 0 || t >= 1) return 0;
  const attack = 0.25;
  if (t < attack) {
    const u = t / attack;
    return 1 - (1 - u) * (1 - u);
  }
  const u = (t - attack) / (1 - attack);
  return (1 - u) * (1 - u);
}

/** Kick envelope: snaps out over the first 20%, then springs back with a tiny overshoot. t in [0,1]. */
export function kickEnvelope(t: number): number {
  if (t <= 0 || t >= 1) return 0;
  if (t < 0.2) return t / 0.2;
  const u = (t - 0.2) / 0.8;
  return Math.cos(u * Math.PI * 1.25) * (1 - u);
}

// ------------------------------------------------------------------ combat feedback

/**
 * Impact multiplier for a player hit: ground combo step 0..3 (and air combo step) index `comboMul`,
 * a released charged heavy uses `chargedMul`. Other swings (up-slash, slam) are 1.
 */
export function hitImpactMul(
  state: string | null,
  comboStep: number,
  airStep: number,
  comboMul: readonly number[],
  chargedMul: number,
): number {
  const at = (i: number) => comboMul[Math.max(0, Math.min(comboMul.length - 1, Math.floor(i)))] ?? 1;
  if (state === 'attack') return at(comboStep);
  if (state === 'airAttack') return at(Math.max(0, airStep - 1));
  if (state === 'heavy') return chargedMul;
  return 1;
}

/**
 * Whether a kill gets the big (slowmo) treatment: a parry riposte kill, or clearing the last
 * non-boss enemy on screen after another recent kill (a cleared group, not a lone straggler),
 * and not while a boss is alive.
 */
export function isBigKill(o: { riposte: boolean; othersInView: number; msSinceLastKill: number; bossAlive: boolean; groupWindowMs: number }): boolean {
  if (o.riposte) return true;
  return !o.bossAlive && o.othersInView === 0 && o.msSinceLastKill <= o.groupWindowMs;
}

/** Squash/stretch envelope: scale goes from (sx, sy) back to 1 with a quad ease-out over `ms`. t = elapsed ms. */
export function squashAt(sx: number, sy: number, t: number, ms: number): { x: number; y: number } {
  if (ms <= 0 || t >= ms) return { x: 1, y: 1 };
  const u = Math.max(0, t) / ms;
  const k = (1 - u) * (1 - u);
  return { x: 1 + (sx - 1) * k, y: 1 + (sy - 1) * k };
}

// ------------------------------------------------------------------ debris (corpses / gibs)

/** Manually simulated tumbling debris: a point with a half-height that bounces on solid tiles. */
export interface Debris {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  /** rad/s */
  spin: number;
  halfH: number;
  bounces: number;
  maxBounces: number;
  /** vertical velocity kept on a bounce */
  restitution: number;
  /** horizontal velocity kept on a bounce */
  friction: number;
  settled: boolean;
}

export const DEBRIS_MAX_FALL = 600;

/**
 * Advances debris by dtMs. Walls reflect vx; a floor contact while falling either bounces (until
 * maxBounces, and only if fast enough) or settles on the tile top. Returns the contact event, if any.
 */
export function stepDebris(d: Debris, dtMs: number, gravity: number, solidAt: (x: number, y: number) => boolean, tile = 16): 'bounce' | 'settle' | null {
  if (d.settled || dtMs <= 0) return null;
  const dt = dtMs / 1000;
  d.vy = Math.min(d.vy + gravity * dt, DEBRIS_MAX_FALL);
  const nx = d.x + d.vx * dt;
  if (solidAt(nx, d.y)) d.vx = -d.vx * 0.5;
  else d.x = nx;
  let ny = d.y + d.vy * dt;
  if (d.vy > 0 && solidAt(d.x, ny + d.halfH)) {
    ny = Math.floor((ny + d.halfH) / tile) * tile - d.halfH;
    d.y = Math.min(ny, d.y + d.vy * dt);
    if (d.bounces < d.maxBounces && d.vy > 60) {
      d.bounces++;
      d.vy = -d.vy * d.restitution;
      d.vx *= d.friction;
      d.spin *= 0.6;
      return 'bounce';
    }
    d.vx = 0;
    d.vy = 0;
    d.spin = 0;
    d.settled = true;
    return 'settle';
  }
  if (d.vy < 0 && solidAt(d.x, ny - d.halfH)) {
    d.vy = 0;
    ny = d.y;
  }
  d.y = ny;
  d.rot += d.spin * dt;
  return null;
}

/**
 * Fixed-cap pool bookkeeping: `acquire` returns a free slot, or recycles the oldest live one once
 * `cap` are in use. Items are created lazily with `make`.
 */
export class CapPool<T> {
  private free: T[] = [];
  /** live items, oldest first */
  readonly live: T[] = [];
  constructor(readonly cap: number, private make: () => T) {}
  /** Returns [item, recycled] where recycled is true if a live item was taken over. */
  acquire(): [T, boolean] {
    if (this.live.length >= this.cap) {
      const it = this.live.shift()!;
      this.live.push(it);
      return [it, true];
    }
    const it = this.free.pop() ?? this.make();
    this.live.push(it);
    return [it, false];
  }
  release(it: T): void {
    const i = this.live.indexOf(it);
    if (i < 0) return;
    this.live.splice(i, 1);
    this.free.push(it);
  }
  /** Drops everything (e.g. scene shutdown, objects destroyed). */
  clear(): void {
    this.live.length = 0;
    this.free.length = 0;
  }
}
