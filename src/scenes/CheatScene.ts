import Phaser from 'phaser';
import { GAME_W, GAME_H } from '../config';
import { Menu, type MenuItem } from '../ui/Menu';
import { txt, type PxText } from '../ui/text';
import { panel, hintRow, gradientTexture } from '../ui/Panel';
import { C } from '../art/palette';
import { save } from '../systems/SaveSystem';
import { sfx } from '../systems/sfx';
import { cheats, maxAllUpgrades, unlockAllLevels, resetUpgrades } from '../systems/cheats';

/** Cheat menu, opened from Settings (main menu or pause). Returns to Settings with the same origin. */
export class CheatScene extends Phaser.Scene {
  private menu!: Menu;
  private from = 'Menu';
  private levelId?: string;
  private note!: PxText;
  constructor() {
    super('Cheats');
  }
  init(d: { from?: string; levelId?: string }): void {
    this.from = d.from ?? 'Menu';
    this.levelId = d.levelId;
  }
  create(): void {
    if (this.from === 'Pause') {
      this.scene.bringToTop();
      this.add.rectangle(0, 0, GAME_W, GAME_H, C.ink, 0.85).setOrigin(0, 0);
    } else {
      this.cameras.main.setBackgroundColor(0x0b0b14);
      this.add.image(0, 0, gradientTexture(this, 'ui-bg-plain', GAME_W, GAME_H, [0x0b0b14, 0x10223a, 0x1d3a5a], 10)).setOrigin(0, 0);
    }
    const cx = GAME_W / 2;
    panel(this, cx, 128, 260, 172, 'dark');
    panel(this, cx, 26, 120, 24, 'ribbon');
    txt(this, cx, 25, 'CHEATS', 14, '#ffeec2');
    const onOff = (v: boolean) => (v ? 'ON' : 'OFF');
    const items: MenuItem[] = [
      { label: 'God mode', value: () => onOff(cheats.god), onSelect: () => (cheats.god = !cheats.god), onAdjust: () => (cheats.god = !cheats.god) },
      {
        label: 'Infinite stamina',
        value: () => onOff(cheats.infiniteStamina),
        onSelect: () => (cheats.infiniteStamina = !cheats.infiniteStamina),
        onAdjust: () => (cheats.infiniteStamina = !cheats.infiniteStamina),
      },
      { label: '+1000 shards', value: () => String(save.data.shards), onSelect: () => this.apply(() => save.addShards(1000), '+1000 shards') },
      { label: 'Max all upgrades', onSelect: () => this.apply(() => maxAllUpgrades(save.data), 'All upgrades maxed') },
      { label: 'Unlock all levels', onSelect: () => this.apply(() => unlockAllLevels(save.data), 'All levels unlocked') },
      { label: 'Reset upgrades', onSelect: () => this.apply(() => resetUpgrades(save.data), 'Upgrades cleared') },
      { label: 'Back', onSelect: () => this.back() },
    ];
    this.menu = new Menu(this, cx, 60, items, 15, 10, { width: 220 });
    this.menu.inp.update(this.time.now);
    txt(this, cx, 196, 'Toggles last until you close the game', 8, '#8b8ba8');
    this.note = txt(this, cx, 230, '', 9, '#ffd96a').setAlpha(0);
    hintRow(this, cx, GAME_H - 11, ['[ENTER]', 'Select', '|', '[ESC]', 'Back']);
  }
  /** one-shot cheat: change the save, store it, flash a confirmation */
  private apply(fn: () => void, msg: string): void {
    fn();
    save.save();
    sfx.heal();
    this.note.setText(msg).setAlpha(1);
    this.tweens.killTweensOf(this.note);
    this.tweens.add({ targets: this.note, alpha: 0, delay: 900, duration: 400 });
  }
  private back(): void {
    this.scene.start('Settings', { from: this.from, levelId: this.levelId });
  }
  update(time: number): void {
    if (this.menu.inp.justPressed('pause')) {
      this.back();
      return;
    }
    this.menu.update(time);
  }
}
