import Phaser from 'phaser';
import { registerFont } from './font';
import { registerCommon } from './common';
import { registerPlayerArt } from './player';
import { registerEnemyArt } from './enemies';
import { registerBossArt } from './bosses';
import { registerEnvironmentArt } from './environment';
import { registerFxArt } from './fx';
import { registerUiArt } from './ui';

/**
 * Registers all generated art. Called once from BootScene AFTER the legacy
 * generateTextures(), so modules can override any legacy texture key.
 * Each domain module owns its own textures/animations (see plan Phase 1).
 */
export function registerAllArt(scene: Phaser.Scene): void {
  registerFont(scene);
  registerCommon(scene);
  registerEnvironmentArt(scene);
  registerPlayerArt(scene);
  registerEnemyArt(scene);
  registerBossArt(scene);
  registerFxArt(scene);
  registerUiArt(scene);
}
