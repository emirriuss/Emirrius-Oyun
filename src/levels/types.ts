import type { UpgradeId } from '../systems/SaveSystem';

export type BossId = 'golem' | 'duelist' | 'king' | 'warden' | 'croupier' | 'moth' | 'aurren' | 'fromage' | 'erratum' | 'colossus' | 'cantor' | 'tumblar' | 'umbra';

export interface LevelDef {
  id: string; // e.g. 'w1-1'
  name: string;
  world: 1 | 2 | 3 | 4;
  /** par time for S-rank, ms */
  parMs: number;
  /**
   * ASCII grid, every row same length. Legend:
   *  #  solid ground          =  one-way platform     X  crumbling block
   *  ^  spikes (1 dmg)        ~  lava (2 dmg)
   *  -  horizontal moving platform (spawned centered on this cell)
   *  |  vertical moving platform
   *  P  player start          *  checkpoint           E  exit door
   *  o  shard                 h  heart (heal 1)       ?  sign (text from `signs`, in order)
   *  s slime  c charger  a archer  f flyer  k shield-knight  b bomber
   *  UPPERCASE of an enemy letter = elite variant (S C A F K B)
   *  &  boss spawn point (requires `boss`)
   *  r  breakable crate/pot (non-solid; smashed by player attacks, may drop a shard; place on a floor cell)
   */
  rows: string[];
  signs?: string[];
  boss?: BossId;
  /** ability granted on first clear (boss levels) */
  reward?: UpgradeId;
  /**
   * Where the world map draws it. Default: on its world's band. 'margin': the post-game column
   * under the shrine (the node and its path stay hidden until unlocked).
   */
  region?: 'margin';
  /** doodle the world map draws behind its node */
  mapDeco?: 'ampersand' | 'mountain' | 'bell' | 'keyhole' | 'lantern';
}

export type SpawnType =
  | 'slime' | 'charger' | 'archer' | 'flyer' | 'knight' | 'bomber'
  | 'checkpoint' | 'exit' | 'shard' | 'heart' | 'sign' | 'boss' | 'hplatform' | 'vplatform' | 'crumble' | 'breakable';

export interface Spawn {
  type: SpawnType;
  /** world-space center of the cell */
  x: number;
  y: number;
  elite?: boolean;
  text?: string;
}
