import Phaser from 'phaser';
import { takeLine } from '../combat/erratumPlan';
import { GAME_W, GAME_H } from '../config';
import { Menu, type MenuItem } from '../ui/Menu';
import { txt } from '../ui/text';
import { panel, hintRow } from '../ui/Panel';
import { transition } from '../ui/transition';
import { C } from '../art/palette';
import { STAGE_NAMES, type ColossusStage } from '../combat/colossusPlan';
import { bossOf } from '../levels';
import { TUMBLAR_STAGE_NAMES, type TumblarStage } from '../combat/tumblarPlan';
import { UMBRA_RETRY } from '../combat/umbraPlan';

/** ERRATUM resume points and their labels. */
const ERRATUM_RETRY: Record<string, string> = { d2: 'Draft 2', d3: 'Draft 3', act4: 'the Final Draft' };
/** CANTOR: retry from the hour you fell in */
const CANTOR_RETRY: Record<string, string> = { p2: 'Terce', p3: 'Vespers' };
/** deaths per ERRATUM stage this session (for the retake line) */
const erratumTakes: Record<string, number> = {};

export class GameOverScene extends Phaser.Scene {
  private menu!: Menu;
  private d!: { levelId: string; checkpoint?: { x: number; y: number }; bossStage?: string };
  constructor() {
    super('GameOver');
  }
  init(d: { levelId: string; checkpoint?: { x: number; y: number }; bossStage?: string }): void {
    this.d = d;
  }
  create(): void {
    // hide the HUD so it doesn't peek out under the letterbox bars
    this.scene.setVisible(false, 'UI');
    // overlay sits above the HUD scene
    this.scene.bringToTop();
    const cx = GAME_W / 2;
    const bg = this.add.rectangle(0, 0, GAME_W, GAME_H, 0x200008, 0).setOrigin(0, 0);
    this.tweens.add({ targets: bg, fillAlpha: 0.78, duration: 400 });
    // closing letterbox bars
    const barT = this.add.rectangle(0, 0, GAME_W, 26, C.ink).setOrigin(0, 1).setY(0);
    const barB = this.add.rectangle(0, GAME_H, GAME_W, 26, C.ink).setOrigin(0, 0);
    this.tweens.add({ targets: barT, y: 26, duration: 450, ease: 'Quad.out' });
    this.tweens.add({ targets: barB, y: GAME_H - 26, duration: 450, ease: 'Quad.out' });
    this.add.rectangle(0, 26, GAME_W, 1, C.crimson).setOrigin(0, 0).setAlpha(0.8);
    this.add.rectangle(0, GAME_H - 27, GAME_W, 1, C.crimson).setOrigin(0, 0).setAlpha(0.8);

    const shadow = txt(this, cx, 76 + 3, 'YOU FELL', 24, '#5a1a34').setAlpha(0);
    const t = txt(this, cx, 76, 'YOU FELL', 24, '#e0443e').setAlpha(0);
    // ERRATUM narrates its own retakes ("Draft 2, take 4")
    const boss = bossOf(this.d.levelId);
    const takes = boss === 'erratum' ? (erratumTakes[this.d.bossStage ?? 'd1'] = (erratumTakes[this.d.bossStage ?? 'd1'] ?? 0) + 1) : 0;
    const subText =
      boss === 'erratum' ? `${takeLine(this.d.bossStage, takes)}. Again, from the top.`
      : boss === 'cantor' ? 'The hour is not yet yours. Count it in again.'
      : boss === 'tumblar' ? 'The door holds. Every lock can be picked twice.'
      : boss === 'umbra' ? 'The light fell short. Move it closer.'
      : 'The Hollow is not done with you yet.';
    const sub = txt(this, cx, 102, subText, 8, '#c2c3d6').setAlpha(0);
    for (const o of [shadow, t]) {
      o.setY(o.y - 14);
      this.tweens.add({ targets: o, alpha: 1, y: o.y + 14, duration: 500, ease: 'Bounce.out', onUpdate: () => (o.y = Math.round(o.y)) });
    }
    this.tweens.add({ targets: sub, alpha: 1, delay: 400, duration: 400 });

    const items: MenuItem[] = [];
    // long two-form boss fight (Aurren): don't make the player redo the first form
    if (this.d.bossStage === 'sun') items.push({ label: 'Retry from Rebirth', onSelect: () => this.restart(undefined, 'sun') });
    const stage = boss === 'colossus' ? STAGE_NAMES[this.d.bossStage as ColossusStage] : undefined;
    if (stage) items.push({ label: `Retry from ${stage}`, onSelect: () => this.restart(undefined, this.d.bossStage) });
    const draft =
      boss === 'cantor' ? CANTOR_RETRY[this.d.bossStage ?? '']
      : boss === 'tumblar' ? TUMBLAR_STAGE_NAMES[this.d.bossStage as TumblarStage]
      : boss === 'erratum' ? ERRATUM_RETRY[this.d.bossStage ?? '']
      : boss === 'umbra' ? UMBRA_RETRY[this.d.bossStage ?? '']
      : undefined;
    if (draft) items.push({ label: `Retry from ${draft}`, onSelect: () => this.restart(undefined, this.d.bossStage) });
    if (this.d.checkpoint) items.push({ label: 'Retry from Checkpoint', onSelect: () => this.restart(this.d.checkpoint) });
    items.push({ label: 'Restart Level', onSelect: () => this.restart(undefined) });
    items.push({
      label: 'Quit to Map',
      onSelect: () => {
        this.menu.enabled = false;
        const go = () => {
          this.scene.stop('Game');
          this.scene.stop('UI');
          this.scene.start('WorldMap', { focus: this.d.levelId });
        };
        if (!transition(this, go)) go();
      },
    });
    const sp = 15;
    const my = 140;
    const box = panel(this, cx, my + ((items.length - 1) * sp) / 2, 196, items.length * sp + 18, 'red').setAlpha(0);
    this.tweens.add({ targets: box, alpha: 1, delay: 300, duration: 200 });
    this.menu = new Menu(this, cx, my, items, sp, 10, { width: 170 });
    this.menu.setDepth(5);
    this.menu.enabled = false;
    hintRow(this, cx, GAME_H - 13, ['[ENTER]', 'Select', '|', '[UP]', '[DOWN]', 'Choose']).setDepth(5);
    this.time.delayedCall(500, () => (this.menu.enabled = true));
  }
  private restart(checkpoint?: { x: number; y: number }, bossStage?: string): void {
    this.scene.stop();
    this.scene.get('Game').scene.restart({ levelId: this.d.levelId, checkpoint, bossStage });
  }
  update(time: number): void {
    this.menu.update(time);
  }
}
