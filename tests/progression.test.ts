import { describe, it, expect } from 'vitest';
import { defaultSave, type UpgradeId } from '../src/systems/SaveSystem';
import { UPGRADES, buyUpgrade, computeStats, nextCost } from '../src/systems/Progression';

function withUpgrades(u: Partial<Record<UpgradeId, number>>) {
  const d = defaultSave();
  d.upgrades = u;
  return computeStats(d);
}

describe('shrine passives', () => {
  it('are all off on a fresh save', () => {
    const st = withUpgrades({});
    expect(st.parryBonusMs).toBe(0);
    expect(st.parryRefundBonus).toBe(0);
    expect(st.dashStaminaMul).toBe(1);
    expect(st.magnetMul).toBe(1);
    expect(st.killsPerHeal).toBe(0);
    expect(st.secondWind).toBe(false);
  });
  it('Mirror Guard widens parries, L2 adds refund', () => {
    expect(withUpgrades({ parryWard: 1 })).toMatchObject({ parryBonusMs: 25, parryRefundBonus: 0 });
    expect(withUpgrades({ parryWard: 2 })).toMatchObject({ parryBonusMs: 50, parryRefundBonus: 10 });
  });
  it('Fleet Step cuts dash cost', () => {
    expect(withUpgrades({ fleetStep: 1 }).dashStaminaMul).toBeCloseTo(0.8);
    expect(withUpgrades({ fleetStep: 2 }).dashStaminaMul).toBeCloseTo(0.6);
  });
  it('Lodestone grows the magnet', () => {
    expect(withUpgrades({ lodestone: 1 }).magnetMul).toBeCloseTo(1.6);
    expect(withUpgrades({ lodestone: 2 }).magnetMul).toBeCloseTo(2.4);
  });
  it('Blood Pact heals more often per level', () => {
    expect([1, 2, 3].map((l) => withUpgrades({ bloodPact: l }).killsPerHeal)).toEqual([20, 14, 10]);
  });
  it('Second Wind is a single purchase', () => {
    expect(withUpgrades({ secondWind: 1 }).secondWind).toBe(true);
  });
  it('can be bought up to their max level', () => {
    const d = defaultSave();
    d.shards = 100000;
    const levels = { parryWard: 2, fleetStep: 2, lodestone: 2, bloodPact: 3, secondWind: 1 } as const;
    for (const [id, max] of Object.entries(levels) as [keyof typeof levels, number][]) {
      let n = 0;
      while (buyUpgrade(d, id)) n++;
      expect(n).toBe(max);
      expect(nextCost(d, id)).toBeNull();
    }
  });
  it('shrine stock grew to 10 cards (boss rewards excluded)', () => {
    expect(UPGRADES.filter((u) => !u.bossReward)).toHaveLength(10);
  });
});
