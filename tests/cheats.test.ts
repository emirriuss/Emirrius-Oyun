import { describe, it, expect } from 'vitest';
import { defaultSave } from '../src/systems/SaveSystem';
import { UPGRADES, nextCost, computeStats } from '../src/systems/Progression';
import { LEVELS, isUnlocked } from '../src/levels';
import { maxAllUpgrades, unlockAllLevels, resetUpgrades } from '../src/systems/cheats';

describe('cheats', () => {
  it('max all upgrades leaves nothing to buy', () => {
    const d = defaultSave();
    maxAllUpgrades(d);
    for (const u of UPGRADES) expect(nextCost(d, u.id)).toBeNull();
    expect(computeStats(d).doubleJump).toBe(true);
  });
  it('unlock all levels opens every level and grants boss abilities', () => {
    const d = defaultSave();
    unlockAllLevels(d);
    const s = { isCompleted: (id: string) => d.completed.includes(id) };
    for (const l of LEVELS) expect(isUnlocked(l.id, s)).toBe(true);
    expect(computeStats(d)).toMatchObject({ doubleJump: true, airDash: true });
  });
  it('reset clears upgrades', () => {
    const d = defaultSave();
    maxAllUpgrades(d);
    resetUpgrades(d);
    expect(d.upgrades).toEqual({});
  });
});
