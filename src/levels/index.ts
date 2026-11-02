import type { BossId, LevelDef } from './types';
import type { SaveSystem } from '../systems/SaveSystem';
import { WORLD1 } from './world1';
import { WORLD2 } from './world2';
import { WORLD3 } from './world3';
import { WORLD4 } from './world4';

/**
 * All levels in play order. ids: w{world}-{n}; worlds 1-3 end in a boss arena, world 4 is all boss arenas.
 * Code that cares about a specific stage should key off its `boss` (see `levelOfBoss`), not its id.
 */
export const LEVELS: LevelDef[] = [...WORLD1, ...WORLD2, ...WORLD3, ...WORLD4];

export function getLevel(id: string): LevelDef {
  const l = LEVELS.find((x) => x.id === id);
  if (!l) throw new Error(`No level ${id}`);
  return l;
}

/** The level that hosts `b`, if any. */
export function levelOfBoss(b: BossId): LevelDef | undefined {
  return LEVELS.find((l) => l.boss === b);
}

/** The boss of level `id` (undefined for unknown ids and non-boss levels). */
export function bossOf(id: string): BossId | undefined {
  return LEVELS.find((l) => l.id === id)?.boss;
}

export function nextLevelId(id: string): string | null {
  const i = LEVELS.findIndex((l) => l.id === id);
  return i >= 0 && i < LEVELS.length - 1 ? LEVELS[i + 1].id : null;
}

/** A level is unlocked if it's the first, or the previous one is completed. */
export function isUnlocked(id: string, save: Pick<SaveSystem, 'isCompleted'>): boolean {
  const i = LEVELS.findIndex((l) => l.id === id);
  if (i <= 0) return i === 0;
  return save.isCompleted(LEVELS[i - 1].id);
}
