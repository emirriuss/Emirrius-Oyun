// Pure parry rules (no Phaser): parrying happens by swinging into a parryable hit.
import { PLAYER } from '../config';
import type { HitInfo } from './types';

export interface SwingParryOpts {
  /** ms since the previous swing ended */
  sinceLastSwingEndMs: number;
  /** swing is a buffered combo follow-up (not a fresh, deliberate swing) */
  comboFollowup: boolean;
  /** released charged heavy */
  chargedHeavy: boolean;
  /** flat bonus added to whichever window applies (Mirror Guard upgrade) */
  bonusMs?: number;
}

/** Length of the parry window opened by a swing. Mashing/chaining gets a tiny window; deliberate swings a fair one. */
export function swingParryWindowMs(o: SwingParryOpts): number {
  const bonus = o.bonusMs ?? 0;
  if (o.chargedHeavy) return PLAYER.parryWindowHeavyMs + bonus;
  if (o.comboFollowup || o.sinceLastSwingEndMs < PLAYER.parryFreshGapMs) return PLAYER.parryWindowChainMs + bonus;
  return PLAYER.parryWindowMs + bonus;
}

/**
 * Whether a hit of `kind` arriving from sourceX can be parried by the current swing.
 * Normal swings cover the front (4px grace behind); the up-slash covers above, so any side.
 */
export function parryDirectionOk(kind: HitInfo['kind'], sourceX: number, playerX: number, facing: 1 | -1, isUpSlash: boolean): boolean {
  if (kind !== 'melee' && kind !== 'projectile') return false;
  if (isUpSlash) return true;
  return (sourceX - playerX) * facing >= -4;
}

/** Full eligibility check for a hit landing inside an open parry window. */
export function canParryHit(hit: Pick<HitInfo, 'kind' | 'parryable' | 'sourceX'>, playerX: number, facing: 1 | -1, isUpSlash: boolean): boolean {
  return !!hit.parryable && parryDirectionOk(hit.kind, hit.sourceX, playerX, facing, isUpSlash);
}
