import type { HitInfo, Hurtable, Rect, Team } from './types';

/**
 * A transient damage region. Each hitbox hits a given target at most once.
 * The rect is computed every frame from a callback so it follows its owner.
 */
export class Hitbox {
  readonly hitSet = new Set<Hurtable>();
  remaining: number;
  dead = false;
  /** if set, the hitbox dies as soon as its owner is no longer alive (no hits from corpses) */
  owner?: { alive: boolean };

  constructor(
    public team: Team,
    public rect: () => Rect,
    public info: (target: Hurtable) => HitInfo,
    lifetimeMs: number,
    public onHit?: (target: Hurtable, result: 'hit' | 'blocked') => void,
  ) {
    this.remaining = lifetimeMs;
  }

  /** Ties this hitbox's lifetime to `owner` being alive. */
  ownedBy(owner: { alive: boolean }): this {
    this.owner = owner;
    return this;
  }

  kill(): void {
    this.dead = true;
  }
}
