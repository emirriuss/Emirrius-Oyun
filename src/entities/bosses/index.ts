import type { GameScene } from '../../scenes/GameScene';
import type { BossId } from '../../levels/types';
import type { Enemy } from '../Enemy';
import { Golem } from './Golem';
import { Duelist } from './Duelist';
import { King } from './King';
import { Warden } from './Warden';
import { Croupier } from './Croupier';
import { Moth } from './Moth';
import { Aurren } from './Aurren';
import { Fromage } from './Fromage';
import { Erratum } from './Erratum';
import { Colossus } from './Colossus';
import { Cantor } from './Cantor';
import { Tumblar } from './Tumblar';
import { Umbra } from './Umbra';

type Ctor = new (gs: GameScene, x: number, y: number) => Enemy;

export const BOSS_TYPES: Record<BossId, Ctor> = {
  golem: Golem,
  duelist: Duelist,
  king: King,
  warden: Warden,
  croupier: Croupier,
  moth: Moth,
  aurren: Aurren,
  fromage: Fromage,
  erratum: Erratum,
  colossus: Colossus,
  cantor: Cantor,
  tumblar: Tumblar,
  umbra: Umbra,
};
