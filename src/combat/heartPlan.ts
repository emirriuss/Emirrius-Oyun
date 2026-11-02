/**
 * Pure scheduling rules for boss-fight hearts (see Boss.hearts). Kept free of Phaser so it's unit-testable.
 */

export interface HeartState {
  /** ms of active fight since the last periodic heart */
  elapsedSinceLast: number;
  /** 0 = periodic hearts off */
  periodicMs: number;
  playerHp: number;
  playerMaxHp: number;
  /** hearts lying in the arena + ones announced but not yet spawned */
  heartsOnField: number;
  maxOnField: number;
}

/** A periodic heart is due, the player is hurt and the field isn't full. */
export function shouldSpawnHeart(s: HeartState): boolean {
  if (s.periodicMs <= 0) return false;
  if (s.elapsedSinceLast < s.periodicMs) return false;
  if (s.playerHp >= s.playerMaxHp) return false;
  return s.heartsOnField < s.maxOnField;
}

/** true when the `parryCount`-th parry earns a heart (every `perParries`-th; 0 = off). */
export function parryDropsHeart(parryCount: number, perParries: number): boolean {
  return perParries > 0 && parryCount > 0 && parryCount % perParries === 0;
}

/**
 * x for a falling heart: on the side of [minX, maxX] farther from the boss, 15% in from that edge
 * (after `margin`), so it never lands on the boss or inside a wall.
 */
export function pickHeartX(bossX: number, minX: number, maxX: number, margin = 24): number {
  const lo = minX + margin;
  const hi = maxX - margin;
  if (hi <= lo) return (minX + maxX) / 2;
  const inset = (hi - lo) * 0.15;
  return bossX - lo > hi - bossX ? lo + inset : hi - inset;
}
