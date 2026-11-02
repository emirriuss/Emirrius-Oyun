import Phaser from 'phaser';
import { GAME_W, GAME_H } from '../config';
import { Menu, type MenuItem } from '../ui/Menu';
import { txt, fmtTime, type PxText } from '../ui/text';
import { panel, gradientTexture, starfield, sparkBurst, raysTexture } from '../ui/Panel';
import { transitionTo } from '../ui/transition';
import { WORLD, C } from '../art/palette';
import { bossOf, getLevel, nextLevelId } from '../levels';
import { save } from '../systems/SaveSystem';
import { sfx } from '../systems/sfx';
import { stopMusic } from '../systems/music';

interface Result {
  levelId: string;
  rank: string;
  timeMs: number;
  kills: number;
  total: number;
  shards: number;
  damage: number;
  firstClear: boolean;
}

const RANK_TINT: Record<string, number> = { S: C.gold, A: C.lime, B: C.cyan, C: C.mist };

export class LevelCompleteScene extends Phaser.Scene {
  private menu?: Menu;
  private r!: Result;
  constructor() {
    super('LevelComplete');
  }

  create(r: Result): void {
    this.menu = undefined;
    this.r = r;
    stopMusic();
    const def = getLevel(r.levelId);
    const P = WORLD[def.world];
    // the save already holds this run if it was a record (GameScene saves before we start);
    // identical rank + exact ms time on a repeat clear means this run set the record
    const rec = save.data.records[r.levelId];
    const newRecord = !r.firstClear && !!rec && rec.rank === r.rank && rec.timeMs === Math.round(r.timeMs);

    this.cameras.main.setBackgroundColor(0x0b0b14);
    this.cameras.main.fadeIn(300, 255, 255, 255);
    this.add.image(0, 0, gradientTexture(this, `ui-bg-clear-${def.world}`, GAME_W, GAME_H, [0x0b0b14, P.sky[0], P.sky[1], P.sky[0]], 12)).setOrigin(0, 0).setDepth(-100);
    starfield(this, GAME_W, GAME_H, 50, -90);

    // header
    const cx = GAME_W / 2;
    const rib = panel(this, cx, 24, 220, 28, 'ribbon');
    const head = txt(this, cx, 23, 'STAGE CLEAR', 16, '#ffeec2');
    rib.setScale(0, 1);
    head.setAlpha(0);
    this.tweens.add({ targets: rib, scaleX: 1, duration: 280, ease: 'Back.out' });
    this.tweens.add({ targets: head, alpha: 1, delay: 150, duration: 200 });
    txt(this, cx, 48, `${def.id.toUpperCase()}  ·  ${def.name}`, 9, '#c2c3d6');

    // stats panel (left)
    const px = 150;
    const py = 108;
    panel(this, px, py, 236, 98, 'dark');
    const underPar = r.timeMs <= def.parMs;
    const rows: { label: string; from: number; to: number; fmt: (v: number) => string; color: string; sub?: string }[] = [
      { label: 'Time', from: 0, to: r.timeMs, fmt: (v) => fmtTime(v), color: underPar ? '#ffd96a' : '#f4f1ea', sub: `par ${fmtTime(def.parMs)}` },
      { label: 'Enemies', from: 0, to: r.kills, fmt: (v) => `${Math.round(v)} / ${r.total}`, color: r.kills >= r.total ? '#ffd96a' : '#f4f1ea' },
      { label: 'Damage taken', from: 0, to: r.damage, fmt: (v) => String(Math.round(v)), color: r.damage === 0 ? '#ffd96a' : '#f4f1ea' },
      { label: 'Shards', from: 0, to: r.shards, fmt: (v) => `+${Math.round(v)}`, color: '#ffd96a' },
    ];
    const left = px - 106;
    const right = px + 106;
    rows.forEach((row, i) => {
      const y = py - 34 + i * 20;
      const l = txt(this, left, y, row.label, 10, '#c2c3d6', 0).setAlpha(0);
      const v = txt(this, right, y, row.fmt(0), 10, row.color, 1).setAlpha(0);
      const finalW = Math.round(v.setText(row.fmt(row.to)).width);
      v.setText(row.fmt(0));
      const extras: (PxText | Phaser.GameObjects.Image)[] = [];
      if (row.sub) extras.push(txt(this, right - finalW - 8, y + 1, row.sub, 8, '#8b8ba8', 1).setAlpha(0));
      if (i < rows.length - 1) this.add.rectangle(left, y + 10, right - left, 1, C.slate).setOrigin(0, 0).setAlpha(0.6);
      if (row.label === 'Shards') extras.push(this.add.image(right - finalW - 7, y, 'ui-shard').setAlpha(0));
      const start = 250 + i * 190;
      this.tweens.add({ targets: [l, v, ...extras], alpha: 1, delay: start, duration: 120, onStart: () => sfx.select() });
      const c = { v: row.from };
      let lastTick = 0;
      this.tweens.add({
        targets: c,
        v: row.to,
        delay: start,
        duration: 320,
        ease: 'Quad.out',
        onUpdate: () => {
          const s = row.fmt(c.v);
          if (s !== v.text && this.time.now - lastTick > 45) {
            lastTick = this.time.now;
            sfx.tally();
          }
          v.setText(s);
        },
        onComplete: () => {
          v.setText(row.fmt(row.to));
          // settle pop: the final value hops and flashes white
          v.setTint(0xffffff);
          this.time.delayedCall(70, () => v.setColor(row.color));
          this.tweens.add({ targets: v, y: y - 2, duration: 60, yoyo: true, ease: 'Quad.out', onComplete: () => v.setY(y) });
        },
      });
    });

    // rank stamp (right)
    const rx = 372;
    const ry = 104;
    const tint = RANK_TINT[r.rank] ?? C.white;
    panel(this, rx, ry, 112, 98, 'dark');
    txt(this, rx, ry - 38, 'RANK', 8, '#8b8ba8');
    const rays = this.add.image(rx, ry + 4, raysTexture(this)).setTint(tint).setAlpha(0).setBlendMode(Phaser.BlendModes.ADD);
    const stamp = this.add.image(rx, ry + 4, `ui-rank-${r.rank}`).setScale(9).setAlpha(0);
    this.time.delayedCall(1050, () => {
      this.tweens.add({
        targets: stamp,
        scale: 4,
        alpha: 1,
        duration: 220,
        ease: 'Quad.in',
        onComplete: () => {
          const isS = r.rank === 'S';
          sfx.heavyHit();
          if (save.data.settings.shake) this.cameras.main.shake(isS ? 220 : 160, isS ? 0.018 : 0.012);
          sparkBurst(this, rx, ry + 4, tint, isS ? 28 : 20, isS ? 58 : 46);
          stamp.setTintFill(0xffffff);
          this.time.delayedCall(60, () => stamp.clearTint());
          // squash on impact, then settle
          stamp.setScale(4.8, 3.4);
          this.tweens.add({ targets: stamp, scaleX: 4, scaleY: 4, duration: 220, ease: 'Back.out' });
          const ring = this.add.image(rx, ry + 4, 'ring').setTint(tint).setScale(0.3).setAlpha(0.9).setBlendMode(Phaser.BlendModes.ADD);
          this.tweens.add({ targets: ring, scale: 3, alpha: 0, duration: 360, ease: 'Quad.out', onComplete: () => ring.destroy() });
          if (isS) this.sRankSparkle(rx, ry + 4, rays);
          this.tweens.add({ targets: rays, alpha: 0.5, duration: 200 });
          this.tweens.add({ targets: rays, angle: 360, duration: 24000, repeat: -1 });
          if (newRecord || r.firstClear) this.banner(rx, ry + 44, newRecord ? 'NEW RECORD!' : 'FIRST CLEAR!');
          this.showMenu();
        },
      });
    });
  }

  /** S rank: counter-rotating second ray layer, a chime and twinkles that keep popping around the stamp. */
  private sRankSparkle(x: number, y: number, rays: Phaser.GameObjects.Image): void {
    sfx.rankSparkle();
    const rays2 = this.add.image(x, y, rays.texture.key).setTint(C.cream).setAlpha(0).setScale(0.7).setBlendMode(Phaser.BlendModes.ADD).setDepth(rays.depth);
    this.tweens.add({ targets: rays2, alpha: 0.35, duration: 300 });
    this.tweens.add({ targets: rays2, angle: -360, duration: 16000, repeat: -1 });
    this.tweens.add({ targets: rays, scale: 1.12, yoyo: true, repeat: -1, duration: 700, ease: 'Sine.inOut' });
    this.time.addEvent({
      delay: 160,
      loop: true,
      callback: () => {
        const a = Math.random() * Math.PI * 2;
        const d = 22 + Math.random() * 22;
        const s = this.add
          .image(Math.round(x + Math.cos(a) * d), Math.round(y + Math.sin(a) * d), 'ui-spark', Math.random() < 0.5 ? 0 : 1)
          .setTint(Math.random() < 0.4 ? 0xffffff : C.gold)
          .setScale(0)
          .setDepth(5);
        this.tweens.add({ targets: s, scale: 1, duration: 180, yoyo: true, hold: 120, ease: 'Quad.out', onComplete: () => s.destroy() });
      },
    });
  }

  private banner(x: number, y: number, text: string): void {
    const label = txt(this, 0, -1, text, 9, '#ffeec2');
    const w = Math.round(label.width) + 30;
    const c = this.add.container(x, y, [panel(this, 0, 0, w, 18, 'ribbon'), label]).setDepth(20);
    c.setScale(0);
    this.tweens.add({ targets: c, scale: 1, duration: 260, ease: 'Back.out' });
    this.tweens.add({ targets: label, alpha: 0.6, yoyo: true, repeat: -1, duration: 400, delay: 300 });
    this.time.delayedCall(200, () => sparkBurst(this, x, y, C.gold, 12, w / 2 + 6));
  }

  /** ERRATUM, corrected, signs the results page in the margin. */
  private erratumSignature(): void {
    const t = txt(this, GAME_W - 70, 160, 'proofread by', 8, '#8a4fc7').setAngle(-8).setAlpha(0);
    const sig = txt(this, GAME_W - 66, 174, '. (formerly &)', 9, '#b9a6ff').setAngle(-8).setAlpha(0);
    this.tweens.add({ targets: [t, sig], alpha: 1, delay: 300, duration: 600 });
  }

  private showMenu(): void {
    if (this.menu) return;
    const r = this.r;
    const boss = bossOf(r.levelId);
    if (boss === 'erratum') this.erratumSignature();
    const next = nextLevelId(r.levelId);
    const items: MenuItem[] = [];
    const go = (key: string, data?: object) => {
      if (this.menu) this.menu.enabled = false;
      if (!transitionTo(this, key, data) && this.menu) this.menu.enabled = true;
    };
    if (boss === 'moth' && r.firstClear) items.push({ label: 'Continue', onSelect: () => go('Ending') });
    else if (boss === 'aurren' && r.firstClear) items.push({ label: 'Continue', onSelect: () => go('Ending', { epilogue: true }) });
    else if (next) items.push({ label: 'Next Stage', onSelect: () => go('Game', { levelId: next }) });
    items.push({ label: 'World Map', onSelect: () => go('WorldMap', { focus: next ?? r.levelId }) });
    items.push({ label: 'Retry', onSelect: () => go('Game', { levelId: r.levelId }) });
    const sp = 14;
    const my = 186;
    panel(this, GAME_W / 2, my + ((items.length - 1) * sp) / 2, 168, items.length * sp + 16, 'dark');
    this.menu = new Menu(this, GAME_W / 2, my, items, sp, 10, { width: 140 });
    this.menu.setDepth(5);
  }

  update(time: number): void {
    this.menu?.update(time);
    void GAME_H;
  }
}
