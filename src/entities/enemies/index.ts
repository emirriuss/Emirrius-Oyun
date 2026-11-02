import type { GameScene } from '../../scenes/GameScene';
import type { SpawnType } from '../../levels/types';
import type { Enemy } from '../Enemy';
import { Slime } from './Slime';
import { Charger } from './Charger';
import { Archer } from './Archer';
import { Flyer } from './Flyer';
import { Knight } from './Knight';
import { Bomber } from './Bomber';

type Ctor = new (gs: GameScene, x: number, y: number, elite?: boolean) => Enemy;

export const ENEMY_TYPES: Partial<Record<SpawnType, Ctor>> = {
  slime: Slime,
  charger: Charger,
  archer: Archer,
  flyer: Flyer,
  knight: Knight,
  bomber: Bomber,
};
