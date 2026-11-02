/**
 * Pure (Phaser-free) math behind the movement juice: camera look-ahead / down-look / landing settle,
 * landing strength, footfall detection and a capped object pool. Unit tested in tests/moveFx.test.ts.
 */

const clamp01 = (v: number) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);

/**
 * Frame-rate independent exponential approach: after `halfLifeMs` the remaining distance to
 * `target` is halved. halfLife <= 0 snaps.
 */
export function smoothTo(cur: number, target: number, halfLifeMs: number, dtMs: number): number {
  if (halfLifeMs <= 0 || !Number.isFinite(cur)) return target;
  return target + (cur - target) * Math.pow(0.5, Math.max(0, dtMs) / halfLifeMs);
}

export interface LookAheadCfg {
  lookAheadIdle: number;
  lookAheadRun: number;
  lookAheadDash: number;
}

/**
 * Horizontal camera look-ahead target (px, + = right). Standing: a little ahead of facing. Moving:
 * blends toward the velocity direction, reaching `lookAheadRun` at run speed (so a quick turn-around
 * without speed doesn't swing the camera). Dashing: `lookAheadDash` along facing.
 */
export function lookAheadTarget(facing: 1 | -1, vx: number, runSpeed: number, dashing: boolean, cfg: LookAheadCfg): number {
  if (dashing) return facing * cfg.lookAheadDash;
  const speed = clamp01(Math.abs(vx) / Math.max(1, runSpeed));
  const idle = facing * cfg.lookAheadIdle;
  const moving = Math.sign(vx) * cfg.lookAheadRun;
  return idle + (moving - idle) * speed;
}

/** Extra downward look (px) for a fall speed: 0 below `startVy`, `max` at `fullVy` and beyond. */
export function fallLookDown(vy: number, startVy: number, fullVy: number, max: number): number {
  if (fullVy <= startVy) return vy >= startVy ? max : 0;
  return max * clamp01((vy - startVy) / (fullVy - startVy));
}

/** Landing strength 0..1 from fall height (px from the jump peak to the ground). */
export function landStrength(fallHeight: number, fullHeight: number): number {
  return clamp01(fallHeight / Math.max(1, fullHeight));
}

/** Camera dip (px, down) for a landing at `vy`; 0 below `minVy`, `maxPx` at `fullVy`. Rounded. */
export function settlePx(vy: number, minVy: number, fullVy: number, maxPx: number): number {
  if (vy < minVy) return 0;
  return Math.round(maxPx * clamp01((vy - minVy) / Math.max(1, fullVy - minVy)));
}

/** Linear blend between two [sx, sy] squash pairs. */
export function lerpPair(a: readonly [number, number], b: readonly [number, number], t: number): [number, number] {
  const u = clamp01(t);
  return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u];
}

/** True when the run animation just advanced onto a foot-plant frame (frames are 1-based anim indices). */
export function isFootfall(prevFrame: number, curFrame: number, footFrames: readonly number[]): boolean {
  return curFrame !== prevFrame && footFrames.includes(curFrame);
}

/** True when the stick points against a fast ground velocity (a skid / turn-around). */
export function isSkid(vx: number, axisX: number, minSpeed: number): boolean {
  return axisX !== 0 && Math.abs(vx) >= minSpeed && Math.sign(vx) !== Math.sign(axisX);
}

/**
 * Fixed-capacity pool: `acquire` returns a free item, creates one while under the cap, and
 * otherwise recycles the oldest live one. Callers `release` items when their effect ends.
 */
export class CapPool<T> {
  private free: T[] = [];
  private live: T[] = [];
  constructor(
    readonly cap: number,
    private create: () => T,
    /** called on an item taken back from the live list before reuse (stop its tween, etc.) */
    private recycle: (item: T) => void = () => undefined,
  ) {}

  get liveCount(): number {
    return this.live.length;
  }
  get size(): number {
    return this.live.length + this.free.length;
  }

  acquire(): T {
    let item = this.free.pop();
    if (item === undefined) {
      if (this.live.length < this.cap) item = this.create();
      else {
        item = this.live.shift() as T;
        this.recycle(item);
      }
    }
    this.live.push(item);
    return item;
  }

  release(item: T): void {
    const i = this.live.indexOf(item);
    if (i < 0) return;
    this.live.splice(i, 1);
    this.free.push(item);
  }

  /** Forget everything (scene shutdown destroys the objects themselves). */
  clear(): void {
    this.free = [];
    this.live = [];
  }
}
