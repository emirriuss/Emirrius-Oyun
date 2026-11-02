export type Team = 'player' | 'enemy';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface HitInfo {
  damage: number;
  /** knockback velocity applied to the victim */
  kbX: number;
  kbY: number;
  /** heavy hits cause bigger hitstop / shake */
  heavy?: boolean;
  /** world-space x of the attacker, used for directional checks (e.g. shields) */
  sourceX: number;
  /** attack is a down-slam (player pogo) */
  slam?: boolean;
  /** attack is an up-slash (TUMBLAR's pins rise when struck from below) */
  up?: boolean;
  /** hit was a parry riposte / reflected projectile */
  parried?: boolean;
  /** can be parried by the player */
  parryable?: boolean;
  kind?: 'melee' | 'projectile' | 'hazard' | 'contact';
}

/** Anything that can receive hits. */
export interface Hurtable {
  team: Team;
  alive: boolean;
  hurtRect(): Rect;
  /** Returns 'hit' if damage was applied, 'blocked' if deflected, 'ignored' if i-frames etc. */
  receiveHit(hit: HitInfo): 'hit' | 'blocked' | 'ignored';
}

export function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

export function knockback(fromX: number, toX: number, force: number, lift: number): { kbX: number; kbY: number } {
  const dir = toX >= fromX ? 1 : -1;
  return { kbX: dir * force, kbY: -lift };
}
