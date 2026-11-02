import Phaser from 'phaser';
import { generateTextures, WORLD_PALETTES } from '../core/Textures';
import { registerAllArt } from '../art';
import { TILE } from '../config';
import { LEVELS } from '../levels';
import { save } from '../systems/SaveSystem';

export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }
  create(): void {
    generateTextures(this);
    // register tile frames for crumble blocks etc.
    for (const w of Object.keys(WORLD_PALETTES)) {
      const tex = this.textures.get(`tiles${w}`);
      for (let i = 0; i < 6; i++) tex.add(i, 0, i * TILE, 0, TILE, TILE);
    }
    // new pixel-art modules override legacy textures by key
    registerAllArt(this);
    // dev: ?level=w4-1 jumps straight into a level, with the abilities earned before it (in memory)
    const jump = import.meta.env.DEV ? new URLSearchParams(window.location.search).get('level') : null;
    const i = jump ? LEVELS.findIndex((l) => l.id === jump) : -1;
    if (i >= 0) {
      for (const l of LEVELS.slice(0, i)) if (l.reward && !save.data.upgrades[l.reward]) save.data.upgrades[l.reward] = 1;
      // dev: &stage=d3 resumes a boss mid-fight (ERRATUM d2/d3/act4, Aurren sun)
      const stage = new URLSearchParams(window.location.search).get('stage') ?? undefined;
      this.scene.start('Game', { levelId: LEVELS[i].id, bossStage: stage });
      return;
    }
    this.scene.start('Menu');
  }
}
