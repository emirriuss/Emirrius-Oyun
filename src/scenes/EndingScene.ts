import Phaser from 'phaser';
import { GAME_W, GAME_H } from '../config';
import { txt, type PxText } from '../ui/text';
import { panel, hintRow, gradientTexture, starfield } from '../ui/Panel';
import { transitionTo } from '../ui/transition';
import { C } from '../art/palette';
import { InputManager } from '../core/InputManager';
import { save } from '../systems/SaveSystem';
import { LEVELS } from '../levels';
import { playMusic } from '../systems/music';

const STORY = [
  'Noctara folds her wings, and the eclipse breaks.',
  'In the Hollow Deep the last shards wake and rise,',
  'returning light to the Hollow, the Spire, the Throne.',
  '',
  'Your blade rests. For now.',
];

/** True ending, after Aurren (w4-4). */
const EPILOGUE = [
  'The First Blade kneels, and the stolen sun goes out.',
  'He sealed the Deep alone, an age ago, and waited',
  'for someone to finally take his place.',
  '',
  'The Core is quiet. Your blade can rest now.',
];

export class EndingScene extends Phaser.Scene {
  private inp!: InputManager;
  private ready = false;
  private leaving = false;
  private epilogue = false;
  constructor() {
    super('Ending');
  }
  init(d?: { epilogue?: boolean }): void {
    this.epilogue = !!d?.epilogue;
  }
  create(): void {
    this.ready = false;
    this.leaving = false;
    playMusic('menu');
    this.cameras.main.setBackgroundColor(0x05050a).fadeIn(1500);
    // eclipse night slowly warming to dawn
    this.add.image(0, 0, gradientTexture(this, 'ui-bg-end', GAME_W, GAME_H, [0x05050a, 0x141a3e, 0x1f4a5e, 0x7a5a6a, 0xf0dc96], 14)).setOrigin(0, 0).setAlpha(0.9);
    starfield(this, GAME_W, 140, 80, 0);
    const sun = this.add.image(GAME_W / 2, GAME_H + 30, 'light').setTint(C.amber).setScale(5).setAlpha(0).setBlendMode(Phaser.BlendModes.ADD);
    this.tweens.add({ targets: sun, alpha: 0.6, y: GAME_H, duration: 9000 });
    this.add.particles(0, 0, 'ui-shard', {
      x: { min: 0, max: GAME_W },
      y: -10,
      speedY: { min: 18, max: 40 },
      speedX: { min: -8, max: 8 },
      lifespan: 10000,
      alpha: { start: 0.9, end: 0 },
      frequency: 300,
    });
    // story, typed line by line
    (this.epilogue ? EPILOGUE : STORY).forEach((line, i) => {
      const t = txt(this, GAME_W / 2, 40 + i * 16, '', 10, '#ffeec2');
      this.time.delayedCall(800 + i * 1200, () => this.type(t, line));
    });
    // finale card
    const ranks = LEVELS.map((l) => save.data.records[l.id]?.rank);
    const s = ranks.filter((r) => r === 'S').length;
    const card = this.add.container(0, 0).setAlpha(0);
    const cy = 186;
    card.add(panel(this, GAME_W / 2, cy, 300, 70, 'gold'));
    card.add(txt(this, GAME_W / 2, cy - 22, this.epilogue ? 'THE TRUE END' : 'THE END', 16, '#7fdbff'));
    const step = 17;
    const x0 = Math.round(GAME_W / 2 - ((ranks.length - 1) * step) / 2);
    ranks.forEach((r, i) => {
      const x = x0 + i * step;
      if (r) card.add(this.add.image(x, cy + 2, `ui-rank-${r}`));
      else card.add(this.add.image(x, cy + 2, 'ui-pip', 0));
    });
    card.add(txt(this, GAME_W / 2, cy + 22, `S ranks  ${s} / ${LEVELS.length}`, 8, '#ffd96a'));
    this.tweens.add({ targets: card, alpha: 1, delay: 7500, duration: 1200, onComplete: () => this.showPrompt() });
    txt(this, GAME_W / 2, GAME_H - 32, 'Thanks for playing EMIRRIUS', 8, '#ffeec2');
    this.inp = new InputManager(this, save.data.settings.keys);
  }
  private type(t: PxText, line: string): void {
    let i = 0;
    if (!line) return;
    this.time.addEvent({ delay: 35, repeat: line.length - 1, callback: () => t.setText(line.slice(0, ++i)) });
  }
  private showPrompt(): void {
    this.ready = true;
    const h = hintRow(this, GAME_W / 2, GAME_H - 14, ['[ENTER]', 'Return to title'], { color: '#ffeec2' });
    this.tweens.add({ targets: h, alpha: 0.4, yoyo: true, repeat: -1, duration: 600 });
  }
  update(time: number): void {
    this.inp.update(time);
    if (this.ready && !this.leaving && (this.inp.justPressed('confirm') || this.inp.justPressed('attack'))) {
      this.leaving = true;
      if (!transitionTo(this, 'Menu')) this.leaving = false;
    }
  }
}
