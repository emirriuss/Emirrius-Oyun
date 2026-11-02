import Phaser from 'phaser';
import { GAME_W, GAME_H } from '../config';
import { Menu } from '../ui/Menu';
import { txt } from '../ui/text';
import { panel, hintRow } from '../ui/Panel';
import { transition } from '../ui/transition';
import { C } from '../art/palette';
import { getLevel } from '../levels';
import { save } from '../systems/SaveSystem';
import { setMuffle } from '../systems/music';
import { JUICE } from '../config';

export class PauseScene extends Phaser.Scene {
  private menu!: Menu;
  private levelId = '';
  constructor() {
    super('Pause');
  }
  init(d: { levelId: string }): void {
    this.levelId = d.levelId;
  }
  create(): void {
    // overlay sits above the HUD scene
    this.scene.bringToTop();
    // music muffled while paused; any way out of the menu (resume, restart, settings, quit) stops this scene
    setMuffle('pause', true, JUICE.muffleHz);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => setMuffle('pause', false));
    const dim = this.add.rectangle(0, 0, GAME_W, GAME_H, C.ink, 0).setOrigin(0, 0);
    this.tweens.add({ targets: dim, fillAlpha: 0.7, duration: 120 });
    const cx = GAME_W / 2;
    const cy = 140;
    let name = '';
    try {
      const l = getLevel(this.levelId);
      name = `${l.id.toUpperCase()}  ·  ${l.name}`;
    } catch {
      name = '';
    }
    const box = this.add.container(0, 0, [
      panel(this, cx, cy, 200, 136, 'dark'),
      panel(this, cx, cy - 66, 112, 24, 'ribbon'),
      txt(this, cx, cy - 67, 'PAUSED', 16, '#ffeec2'),
      txt(this, cx, cy - 40, name, 8, '#8b8ba8'),
    ]);
    box.setAlpha(0).setY(6);
    this.tweens.add({ targets: box, alpha: 1, y: 0, duration: 140, ease: 'Quad.out', onUpdate: () => (box.y = Math.round(box.y)) });
    this.menu = new Menu(this, cx, cy - 18, [
      { label: 'Resume', onSelect: () => this.resume() },
      { label: 'Restart Level', onSelect: () => this.leave(() => this.scene.get('Game').scene.restart({ levelId: this.levelId })) },
      { label: 'Settings', onSelect: () => this.scene.start('Settings', { from: 'Pause', levelId: this.levelId }) },
      {
        label: 'Quit to Map',
        onSelect: () => {
          save.save();
          this.menu.enabled = false;
          const ok = transition(this, () => {
            this.scene.stop('Game');
            this.scene.stop('UI');
            this.scene.start('WorldMap', { focus: this.levelId });
          });
          if (!ok) this.leave(() => { this.scene.stop('Game'); this.scene.stop('UI'); this.scene.start('WorldMap'); });
        },
      },
    ], 15, 10, { width: 150 });
    this.menu.setDepth(5);
    hintRow(this, cx, cy + 54, ['[ESC]', 'Resume', '|', '[ENTER]', 'Select']).setDepth(5);
    // ignore the key press that opened the menu
    this.menu.inp.update(this.time.now);
  }
  private resume(): void {
    this.scene.stop();
    this.scene.resume('Game');
  }
  private leave(fn: () => void): void {
    save.save();
    this.scene.stop();
    fn();
  }
  update(time: number): void {
    if (this.menu.enabled && this.menu.inp.justPressed('pause')) {
      this.resume();
      return;
    }
    this.menu.update(time);
  }
}
