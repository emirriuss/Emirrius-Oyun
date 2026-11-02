import Phaser from 'phaser';
import { GAME_W, GAME_H } from '../config';
import { txt } from '../ui/text';
import { panel, hintRow, gradientTexture } from '../ui/Panel';
import { transitionTo } from '../ui/transition';
import { C } from '../art/palette';
import { InputManager } from '../core/InputManager';
import { save } from '../systems/SaveSystem';

export class ControlsScene extends Phaser.Scene {
  private inp!: InputManager;
  private leaving = false;
  constructor() {
    super('Controls');
  }
  create(): void {
    this.leaving = false;
    const k = save.data.settings.keys;
    const first = (a: keyof typeof k) => `[${k[a][0]}]`;
    const all = (a: keyof typeof k) => k[a].map((n) => `[${n}]`);
    const lines: [string, string[]][] = [
      ['Move', [first('left'), first('right'), ...(k.left[1] && k.right[1] ? ['/', `[${k.left[1]}]`, `[${k.right[1]}]`] : [])]],
      ['Jump  (hold = higher)', all('jump')],
      ['Attack  (x3 combo, even running)', [...all('attack'), '{L}']],
      ['Air combo  (2 hits)', ['air', first('attack'), first('attack')]],
      ['Heavy strike', ['hold', first('attack'), 'after a swing']],
      ['Up-slash', [first('up'), '+', first('attack')]],
      ['Slam  (pogo off enemies)', ['air', first('down'), '+', first('attack')]],
      ['Float / fast-fall', ['hold', first('jump'), '/', first('down')]],
      ['Dash  (i-frames)', all('dash')],
      ['Dash-slash', [first('attack'), 'during', first('dash')]],
      ['Cancel a swing', [first('jump'), '/', first('dash')]],
      ['Parry  (attack into a hit, time it!)', [first('attack'), '{L}', 'as it lands']],
      ['Special  (when unlocked)', [...all('special'), '{R}']],
      ['Drop through platform', [first('down'), '+', first('jump')]],
      ['Pause', all('pause')],
    ];
    this.cameras.main.setBackgroundColor(0x0b0b14);
    this.add.image(0, 0, gradientTexture(this, 'ui-bg-plain', GAME_W, GAME_H, [0x0b0b14, 0x10223a, 0x1d3a5a], 10)).setOrigin(0, 0);
    const cx = GAME_W / 2;
    panel(this, cx, 139, 420, 218, 'dark');
    panel(this, cx, 18, 132, 24, 'ribbon');
    txt(this, cx, 17, 'CONTROLS', 14, '#ffeec2');
    const left = cx - 196;
    const right = cx + 196;
    lines.forEach(([label, toks], i) => {
      const y = 42 + i * 14;
      if (i % 2 === 0) this.add.rectangle(left - 6, y - 7, right - left + 12, 14, C.slate, 0.18).setOrigin(0, 0);
      txt(this, left, y, label, 9, '#c2c3d6', 0);
      hintRow(this, right, y, toks, { align: 1, color: '#8b8ba8' });
    });
    hintRow(this, cx, GAME_H - 11, ['Gamepad supported', '|', 'Remap keys in Settings', '|', '[ESC]', 'Back']);
    this.inp = new InputManager(this, save.data.settings.keys);
    this.input.once('pointerdown', () => this.back());
  }
  private back(): void {
    if (this.leaving) return;
    this.leaving = true;
    if (!transitionTo(this, 'Menu')) this.leaving = false;
  }
  update(time: number): void {
    this.inp.update(time);
    if (this.inp.justPressed('pause') || this.inp.justPressed('confirm') || this.inp.justPressed('attack')) this.back();
  }
}
