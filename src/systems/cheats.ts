import { LEVELS } from '../levels';
import { UPGRADES } from './Progression';
import type { SaveData } from './SaveSystem';

/** Session-only cheat toggles (not saved; reset when the game restarts). */
export const cheats = {
  god: false,
  infiniteStamina: false,
};

/** Every upgrade (shop and boss abilities) at its max level. */
export function maxAllUpgrades(data: SaveData): void {
  for (const u of UPGRADES) data.upgrades[u.id] = u.costs.length;
}

/** Marks every level cleared so the whole map is open, and grants the boss abilities. */
export function unlockAllLevels(data: SaveData): void {
  for (const l of LEVELS) if (!data.completed.includes(l.id)) data.completed.push(l.id);
  for (const u of UPGRADES) if (u.bossReward) data.upgrades[u.id] = Math.max(1, data.upgrades[u.id] ?? 0);
}

export function resetUpgrades(data: SaveData): void {
  data.upgrades = {};
}
