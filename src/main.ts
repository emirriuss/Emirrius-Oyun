import Phaser from 'phaser';
import { GAME_W, GAME_H } from './config';
import { BootScene } from './scenes/BootScene';
import { MenuScene } from './scenes/MenuScene';
import { ControlsScene } from './scenes/ControlsScene';
import { SettingsScene } from './scenes/SettingsScene';
import { CheatScene } from './scenes/CheatScene';
import { WorldMapScene } from './scenes/WorldMapScene';
import { ShrineScene } from './scenes/ShrineScene';
import { GameScene } from './scenes/GameScene';
import { UIScene } from './scenes/UIScene';
import { PauseScene } from './scenes/PauseScene';
import { GameOverScene } from './scenes/GameOverScene';
import { LevelCompleteScene } from './scenes/LevelCompleteScene';
import { EndingScene } from './scenes/EndingScene';
import { GalleryScene } from './scenes/GalleryScene';
import { getAudio } from './systems/sfx';
import { installCheats } from './systems/cheatPanel';

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  width: GAME_W,
  height: GAME_H,
  pixelArt: true,
  disableContextMenu: true,
  backgroundColor: '#0b0b14',
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  physics: { default: 'arcade', arcade: { gravity: { x: 0, y: 1400 }, debug: false, tileBias: 20 } },
  input: { gamepad: true },
  fps: { target: 60 },
  scene: [BootScene, MenuScene, ControlsScene, SettingsScene, CheatScene, WorldMapScene, ShrineScene, GameScene, UIScene, PauseScene, GameOverScene, LevelCompleteScene, EndingScene, GalleryScene],
});

// browsers require a user gesture before audio can start
const unlock = () => getAudio();
window.addEventListener('keydown', unlock);
window.addEventListener('pointerdown', unlock);

// testing cheats panel (F9 toggles; visible by default in dev). In-game menu: Settings > Cheats
installCheats(game);

// expose for debugging / smoke tests
(window as unknown as { game: Phaser.Game }).game = game;

if (import.meta.env.DEV) {
  // dev hooks for smoke tests: inject temporary levels, inspect save
  void import('./levels').then((m) => ((window as unknown as Record<string, unknown>).__LEVELS = m.LEVELS));
  void import('./art/pixel').then((m) => ((window as unknown as Record<string, unknown>).__art = m));
  void import('./systems/SaveSystem').then((m) => ((window as unknown as Record<string, unknown>).__save = m.save));
}
