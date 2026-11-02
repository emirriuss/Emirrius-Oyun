import { PLAYER } from '../config';
import type { Difficulty, SaveData, UpgradeId } from './SaveSystem';

export interface UpgradeDef {
  id: UpgradeId;
  name: string;
  desc: string;
  costs: number[]; // cost per level; length = max level
  /** Optional text for the NEXT level to be bought (index = current level); falls back to desc. */
  levelDescs?: string[];
  /** Abilities granted by bosses are not sold at the shrine. */
  bossReward?: boolean;
}

export const UPGRADES: UpgradeDef[] = [
  { id: 'maxHp', name: 'Vital Core', desc: '+1 max health', costs: [30, 70, 140, 220, 320] },
  { id: 'damage', name: 'Keen Edge', desc: '+20% attack damage', costs: [40, 100, 180, 260, 360] },
  { id: 'stamina', name: 'Endurance', desc: '+25 stamina, faster regen', costs: [30, 80, 140, 210] },
  { id: 'comboPlus', name: 'Flurry', desc: '4th combo hit: spinning slash', costs: [70] },
  {
    id: 'energySlash',
    name: 'Wave Edge',
    desc: 'Special: fire a ranged energy slash',
    costs: [100, 160, 240],
    levelDescs: ['Special: fire a short energy slash', 'Energy slash deals double damage', 'Energy slash pierces, costs less stamina'],
  },
  {
    id: 'parryWard',
    name: 'Mirror Guard',
    desc: 'Wider parry windows',
    costs: [90, 200],
    levelDescs: ['Parry windows +25ms', 'Parry windows +50ms, parries restore more stamina'],
  },
  {
    id: 'fleetStep',
    name: 'Fleet Step',
    desc: 'Dashing costs less stamina',
    costs: [60, 140],
    levelDescs: ['Dash costs 20% less stamina', 'Dash costs 40% less stamina'],
  },
  {
    id: 'lodestone',
    name: 'Lodestone',
    desc: 'Shards fly to you from farther away',
    costs: [50, 120],
    levelDescs: ['Shard magnet range +60%', 'Shard magnet range x2.4'],
  },
  {
    id: 'bloodPact',
    name: 'Blood Pact',
    desc: 'Defeating enemies restores health',
    costs: [120, 220, 340],
    levelDescs: ['Heal 1 every 20 kills', 'Heal 1 every 14 kills', 'Heal 1 every 10 kills'],
  },
  { id: 'secondWind', name: 'Second Wind', desc: 'Once per level, survive a lethal hit', costs: [400] },
  { id: 'doubleJump', name: 'Golem Heart', desc: 'Double jump', costs: [0], bossReward: true },
  { id: 'airDash', name: 'Twin Wind', desc: 'Dash refreshes on wall-jump & enemy hit', costs: [0], bossReward: true },
];

export function upgradeDef(id: UpgradeId): UpgradeDef {
  return UPGRADES.find((u) => u.id === id)!;
}

export function nextCost(data: SaveData, id: UpgradeId): number | null {
  const lvl = data.upgrades[id] ?? 0;
  const def = upgradeDef(id);
  return lvl < def.costs.length ? def.costs[lvl] : null;
}

/** Attempts a purchase; mutates data and returns true on success. */
export function buyUpgrade(data: SaveData, id: UpgradeId): boolean {
  const cost = nextCost(data, id);
  if (cost === null || data.shards < cost) return false;
  data.shards -= cost;
  data.upgrades[id] = (data.upgrades[id] ?? 0) + 1;
  return true;
}

export interface PlayerStats {
  maxHp: number;
  damageMul: number;
  maxStamina: number;
  staminaRegen: number;
  comboLength: number;
  /** 0 = not owned; 1 short 1-dmg slash; 2 double damage; 3 pierce + cheaper */
  energySlashLvl: number;
  doubleJump: boolean;
  airDash: boolean;
  incomingDamageMul: number;
  /** added to every swing's parry window (Mirror Guard) */
  parryBonusMs: number;
  /** extra stamina restored by a parry */
  parryRefundBonus: number;
  /** multiplier on dash stamina cost (Fleet Step) */
  dashStaminaMul: number;
  /** multiplier on the shard magnet radius (Lodestone) */
  magnetMul: number;
  /** heal 1 hp every N rewarded kills; 0 = off (Blood Pact) */
  killsPerHeal: number;
  /** survive one lethal hit per level at 1 hp */
  secondWind: boolean;
}

const MAGNET_MUL = [1, 1.6, 2.4];
const KILLS_PER_HEAL = [0, 20, 14, 10];

export const DIFFICULTY: Record<Difficulty, { enemyHpMul: number; incomingMul: number; hpBonus: number }> = {
  easy: { enemyHpMul: 0.75, incomingMul: 1, hpBonus: 3 },
  normal: { enemyHpMul: 1, incomingMul: 1, hpBonus: 0 },
  hard: { enemyHpMul: 1.3, incomingMul: 1.5, hpBonus: -1 },
};

export function computeStats(data: SaveData): PlayerStats {
  const u = data.upgrades;
  return {
    maxHp: PLAYER.maxHp + (u.maxHp ?? 0) + DIFFICULTY[data.settings.difficulty].hpBonus,
    damageMul: 1 + 0.2 * (u.damage ?? 0),
    maxStamina: PLAYER.maxStamina + 25 * (u.stamina ?? 0),
    staminaRegen: PLAYER.staminaRegen * (1 + 0.2 * (u.stamina ?? 0)),
    comboLength: 3 + (u.comboPlus ?? 0),
    energySlashLvl: u.energySlash ?? 0,
    doubleJump: (u.doubleJump ?? 0) > 0,
    airDash: (u.airDash ?? 0) > 0,
    incomingDamageMul: DIFFICULTY[data.settings.difficulty].incomingMul,
    parryBonusMs: 25 * (u.parryWard ?? 0),
    parryRefundBonus: (u.parryWard ?? 0) >= 2 ? 10 : 0,
    dashStaminaMul: 1 - 0.2 * (u.fleetStep ?? 0),
    magnetMul: MAGNET_MUL[Math.min(u.lodestone ?? 0, MAGNET_MUL.length - 1)],
    killsPerHeal: KILLS_PER_HEAL[Math.min(u.bloodPact ?? 0, KILLS_PER_HEAL.length - 1)],
    secondWind: (u.secondWind ?? 0) > 0,
  };
}
