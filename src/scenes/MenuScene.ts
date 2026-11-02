import Phaser from 'phaser';
import { GAME_W, GAME_H } from '../config';
import { Menu } from '../ui/Menu';
import { txt } from '../ui/text';
import { panel, hintRow, gradientTexture, starfield } from '../ui/Panel';
import { transitionTo } from '../ui/transition';
import { save } from '../systems/SaveSystem';
import { playMusic } from '../systems/music';
import { buildParallax } from '../art/environment';
import { WORLD, C } from '../art/palette';

const VERSION = 'v0.1.0';
const DRIFT = 64;

export class MenuScene extends Phaser.Scene {
  private menu!: Menu;
  constructor() {
    super('Menu');
  }
  create(): void {
    const cam = this.cameras.main;
    cam.setBackgroundColor(0x0b0b14);
    cam.setScroll(0, 0);
    playMusic('menu');
    if (import.meta.env.DEV) this.input.keyboard!.once('keydown-G', () => this.scene.start('Gallery'));

    // --- backdrop: own sky + stars (always), environment parallax on top when available
    const w1 = WORLD[1];
    this.add.image(0, 0, gradientTexture(this, 'ui-bg-title', GAME_W, GAME_H, [0x0b0b14, w1.sky[0], w1.sky[1], w1.sky[2]], 14)).setOrigin(0, 0).setScrollFactor(0).setDepth(-200);
    starfield(this, GAME_W, 150, 70, -190).forEach((s) => s.setScrollFactor(0));
    const layers = buildParallax(this, 1, GAME_W + DRIFT, GAME_H);
    if (layers.length) {
      // subtle camera drift across the parallax
      cam.setBounds(0, 0, GAME_W + DRIFT, GAME_H);
      this.tweens.add({ targets: cam, scrollX: DRIFT, duration: 16000, yoyo: true, repeat: -1, ease: 'Sine.inOut' });
    } else {
      // fallback silhouettes so the title never sits on an empty sky
      this.fallbackHills();
    }
    // darken the lower half a touch so the menu reads
    this.add.rectangle(0, GAME_H, GAME_W, 120, C.ink, 0.35).setOrigin(0, 1).setScrollFactor(0).setDepth(5);
    this.add
      .particles(0, 0, 'ui-dot', {
        x: { min: 0, max: GAME_W },
        y: GAME_H + 4,
        speedY: { min: -18, max: -6 },
        speedX: { min: -4, max: 4 },
        lifespan: 14000,
        alpha: { start: 0.7, end: 0 },
        tint: [C.gold, C.cyan, C.cream],
        frequency: 260,
      })
      .setScrollFactor(0)
      .setDepth(6);

    // --- logo
    const lx = GAME_W / 2;
    const ly = 64;
    const glow = this.add.image(lx, ly, 'light').setTint(C.sky).setAlpha(0.35).setScale(7, 2.2).setBlendMode(Phaser.BlendModes.ADD).setScrollFactor(0).setDepth(9);
    this.tweens.add({ targets: glow, alpha: 0.2, yoyo: true, repeat: -1, duration: 1800, ease: 'Sine.inOut' });
    const shadow2 = txt(this, lx, ly + 10, 'EMIRRIUS', 40, '#140c1c').setScrollFactor(0).setDepth(10);
    const shadow = txt(this, lx, ly + 5, 'EMIRRIUS', 40, '#2d5fa8').setScrollFactor(0).setDepth(10);
    const logo = txt(this, lx, ly, 'EMIRRIUS', 40, '#7fdbff').setScrollFactor(0).setDepth(11);
    const hi = txt(this, lx, ly, 'EMIRRIUS', 40, '#c9f2ff').setScrollFactor(0).setDepth(12);
    // top half of the letters a lighter tone (pixel two-tone logo)
    const topMaskG = this.make.graphics({}, false).setScrollFactor(0);
    topMaskG.fillStyle(0xffffff).fillRect(0, ly - 30, GAME_W, 22);
    hi.setMask(topMaskG.createGeometryMask());
    // shine sweep
    const shine = txt(this, lx, ly, 'EMIRRIUS', 40, '#ffffff').setScrollFactor(0).setDepth(13);
    const band = this.make.graphics({}, false).setScrollFactor(0);
    const drawBand = (x: number) => {
      band.clear().fillStyle(0xffffff);
      band.beginPath();
      band.moveTo(x, ly - 30);
      band.lineTo(x + 14, ly - 30);
      band.lineTo(x - 6, ly + 30);
      band.lineTo(x - 20, ly + 30);
      band.closePath();
      band.fillPath();
    };
    drawBand(-100);
    shine.setMask(band.createGeometryMask());
    const sweep = { x: -60 };
    this.tweens.add({
      targets: sweep,
      x: GAME_W + 60,
      duration: 1100,
      delay: 900,
      repeatDelay: 3200,
      repeat: -1,
      ease: 'Quad.inOut',
      onUpdate: () => drawBand(Math.round(sweep.x)),
    });
    // intro drop
    const logoParts = [shadow2, shadow, logo, hi, shine];
    logoParts.forEach((o) => o.setY(o.y - 80));
    this.tweens.add({ targets: logoParts, y: '+=80', duration: 700, ease: 'Bounce.out', onUpdate: () => logoParts.forEach((o) => (o.y = Math.round(o.y))) });
    this.tweens.add({ targets: glow, scaleX: { from: 0, to: 7 }, duration: 700 });

    // subtitle with divider
    const sub = txt(this, lx, 102, 'a tale of blade and shard', 10, '#c2c3d6').setScrollFactor(0).setDepth(10);
    const half = Math.round(sub.width / 2) + 8;
    for (const s of [-1, 1]) {
      this.add.rectangle(lx + s * (half + 18), 102, 36, 1, C.amber).setScrollFactor(0).setDepth(10);
      this.add.image(lx + s * (half + 39), 102, 'ui-shard').setScrollFactor(0).setDepth(10).setScale(1);
    }
    sub.setAlpha(0);
    this.tweens.add({ targets: sub, alpha: 1, delay: 500, duration: 500 });

    // --- menu
    const hasSave = save.data.completed.length > 0 || save.data.shards > 0;
    const items = [
      { label: hasSave ? 'Continue' : 'New Game', onSelect: () => this.go('WorldMap') },
      {
        label: 'New Game (reset)',
        disabled: () => !hasSave,
        onSelect: () => {
          if (window.confirm('Erase progress and start over?')) {
            save.reset();
            this.go('WorldMap');
          }
        },
      },
      { label: 'Settings', onSelect: () => this.go('Settings', { from: 'Menu' }) },
      { label: 'Controls', onSelect: () => this.go('Controls') },
    ];
    const my = 152;
    const sp = 15;
    panel(this, lx, my + ((items.length - 1) * sp) / 2, 168, items.length * sp + 16, 'dark').setScrollFactor(0).setDepth(20);
    this.menu = new Menu(this, lx, my, items, sp, 10, { width: 140, depth: 21 });

    // --- footer
    hintRow(this, lx, GAME_H - 12, ['[LEFT]', '[RIGHT]', 'Move', '|', '[Z]', 'Jump', '|', '[X]', '{L}', 'Attack', '|', '[C]', 'Dash'], {
      color: '#8b8ba8',
    })
      .setScrollFactor(0)
      .setDepth(30);
    txt(this, GAME_W - 4, GAME_H - 30, VERSION, 8, '#5d5b7a', 1).setScrollFactor(0).setDepth(30);
    this.children.list.forEach((o) => {
      if (layers.includes(o)) return;
      (o as unknown as Phaser.GameObjects.Components.ScrollFactor).setScrollFactor?.(0);
    });
  }

  private fallbackHills(): void {
    const g = this.add.graphics().setScrollFactor(0).setDepth(-150);
    const ridge = (base: number, amp: number, freq: number, color: number, phase: number) => {
      g.fillStyle(color, 1);
      for (let x = 0; x < GAME_W; x += 2) {
        const h = Math.round(base - amp * (0.5 + 0.5 * Math.sin(x * freq + phase)) - amp * 0.4 * Math.sin(x * freq * 2.7 + phase * 2));
        g.fillRect(x, h, 2, GAME_H - h);
      }
    };
    ridge(200, 40, 0.012, 0x1d3a5a, 1);
    ridge(226, 30, 0.02, 0x16304a, 2.4);
    ridge(250, 22, 0.03, 0x10223a, 0.7);
  }

  private go(key: string, data?: object): void {
    this.menu.enabled = false;
    if (!transitionTo(this, key, data)) this.menu.enabled = true;
  }

  update(time: number): void {
    this.menu.update(time);
  }
}
