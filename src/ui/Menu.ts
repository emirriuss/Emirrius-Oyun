import Phaser from 'phaser';
import { InputManager } from '../core/InputManager';
import { save } from '../systems/SaveSystem';
import { sfx } from '../systems/sfx';
import { txt, type PxText } from './text';
import { keycap, panelTexture } from './Panel';

export interface MenuItem {
  label: string | (() => string);
  /** right-aligned value text (needs `width` in MenuOpts) */
  value?: () => string;
  /** right-aligned key caps, e.g. ['Z', 'SPACE'] (needs `width`) */
  keys?: () => string[];
  onSelect?: () => void;
  /** left/right adjust (-1 / +1) */
  onAdjust?: (dir: number) => void;
  disabled?: () => boolean;
}

export interface MenuOpts {
  /** row width in px; defaults to the widest label + padding */
  width?: number;
  depth?: number;
  /** staggered scale-in of the rows on open (default true) */
  intro?: boolean;
}

const COL = { idle: '#c2c3d6', sel: '#ffd96a', dis: '#5d5b7a', value: '#7fdbff', valueSel: '#ffeec2' };

/**
 * Vertical keyboard/gamepad/mouse menu with a highlight bar and animated cursor.
 * Call `update(time)` each frame. Keyboard input comes from its own InputManager (no mouse
 * bindings); mouse clicks are handled by each row's hit zone, so a click never selects twice.
 */
export class Menu {
  index = 0;
  private texts: PxText[] = [];
  private values: (PxText | null)[] = [];
  private caps: (Phaser.GameObjects.Container[] | null)[] = [];
  private zones: Phaser.GameObjects.Zone[] = [];
  private hl: Phaser.GameObjects.Image;
  private cursor: Phaser.GameObjects.Image;
  private cursorR: Phaser.GameObjects.Image;
  private rowW: number;
  private lastSelect = -1000;
  private hlTween?: Phaser.Tweens.Tween;
  private capsSig: string[] = [];
  private shownIndex = -1;
  private hopTween?: Phaser.Tweens.Tween;
  private punching = false;
  inp: InputManager;
  enabled = true;

  constructor(
    private scene: Phaser.Scene,
    private x: number,
    private y: number,
    private items: MenuItem[],
    private spacing = 16,
    size = 10,
    opts: MenuOpts = {},
  ) {
    this.inp = new InputManager(scene, save.data.settings.keys);
    const hasValues = items.some((it) => it.value || it.keys);
    // highlight first so it renders behind the labels
    this.hl = scene.add.image(x, this.rowY(0), 'ui-px').setVisible(false);
    items.forEach((it, i) => {
      const t = txt(scene, x, this.rowY(i), '', size, COL.idle, hasValues ? 0 : 0.5);
      this.texts.push(t);
      this.values.push(it.value ? txt(scene, x, this.rowY(i), '', size, COL.value, 1) : null);
      this.caps.push(it.keys ? [] : null);
      this.capsSig.push('');
    });
    // measure labels for auto width
    items.forEach((it, i) => this.texts[i].setText(this.label(it)));
    const widest = Math.max(...this.texts.map((t) => t.width));
    this.rowW = Math.round(opts.width ?? widest + 36);
    if (this.rowW % 2) this.rowW++;
    const h = Math.max(11, Math.min(spacing, 15));
    this.hl.setTexture(panelTexture(scene, this.rowW, h, 'sel')).setVisible(true);
    this.cursor = scene.add.image(0, 0, 'ui-cursor');
    this.cursorR = scene.add.image(0, 0, 'ui-cursor').setFlipX(true);
    const left = Math.round(x - this.rowW / 2);
    items.forEach((_it, i) => {
      if (hasValues) this.texts[i].setX(left + 10);
      this.values[i]?.setX(left + this.rowW - 8);
      const z = scene.add.zone(x, this.rowY(i), this.rowW, spacing).setInteractive({ useHandCursor: true });
      z.on('pointerover', () => {
        if (!this.enabled || this.index === i) return;
        this.index = i;
        sfx.select();
        this.refresh();
      });
      z.on('pointerdown', (p: Phaser.Input.Pointer) => {
        if (!this.enabled || p.button !== 0) return;
        this.index = i;
        this.select();
      });
      this.zones.push(z);
    });
    if (opts.depth !== undefined) this.setDepth(opts.depth);
    this.refresh(true);
    if (opts.intro !== false) this.playIntro();
  }

  /** Rows pop in top to bottom (scaleY from 0, ~30ms apart). Input stays live throughout. */
  private playIntro(): void {
    const tw = this.scene.tweens;
    this.texts.forEach((t, i) => {
      const row: Phaser.GameObjects.Components.Transform[] = [t];
      const v = this.values[i];
      if (v) row.push(v);
      this.caps[i]?.forEach((c) => row.push(c));
      row.forEach((o) => {
        const go = o as unknown as Phaser.GameObjects.Components.Alpha & Phaser.GameObjects.Components.Transform;
        const sy = go.scaleY;
        go.setScale(go.scaleX, 0);
        go.setAlpha(0);
        tw.add({ targets: go, scaleY: sy, alpha: 1, delay: 40 + i * 30, duration: 150, ease: 'Back.out' });
      });
    });
    this.hl.setScale(0, 1);
    tw.add({ targets: this.hl, scaleX: 1, delay: 40, duration: 180, ease: 'Quad.out' });
  }

  /** Newly selected row: a 2px hop and a quick squash of the highlight bar. */
  private bounce(i: number): void {
    const t = this.texts[i];
    const y = this.rowY(i);
    this.hopTween?.stop();
    this.texts.forEach((o, j) => o.setY(this.rowY(j)));
    this.hopTween = this.scene.tweens.add({ targets: t, y: y - 2, duration: 55, yoyo: true, ease: 'Quad.out', onComplete: () => t.active && t.setY(y) });
    if (this.hl.scaleX === 1) {
      this.hl.setScale(1.04, 1.3);
      this.scene.tweens.add({ targets: this.hl, scaleX: 1, scaleY: 1, duration: 110, ease: 'Quad.out' });
    }
  }

  /** Confirm: tiny camera zoom punch (skipped when Screen shake is off or the camera is zoomed). */
  private punch(): void {
    const cam = this.scene.cameras.main;
    if (this.punching || !save.data.settings.shake || cam.zoom !== 1) return;
    this.punching = true;
    this.scene.tweens.add({
      targets: cam,
      zoom: 1.03,
      duration: 50,
      yoyo: true,
      ease: 'Quad.out',
      onComplete: () => {
        cam.setZoom(1);
        this.punching = false;
      },
    });
  }

  private rowY(i: number): number {
    return Math.round(this.y + i * this.spacing);
  }

  private label(it: MenuItem): string {
    return typeof it.label === 'function' ? it.label() : it.label;
  }

  setDepth(d: number): this {
    [...this.texts, ...this.values.filter(Boolean) as PxText[], this.cursor, this.cursorR].forEach((o) => o.setDepth(d + 1));
    this.caps.forEach((c) => c?.forEach((o) => o.setDepth(d + 1)));
    this.hl.setDepth(d);
    return this;
  }

  /** Re-read labels / values and move the highlight. */
  refresh(instant = false): void {
    this.items.forEach((it, i) => {
      const t = this.texts[i];
      t.setText(this.label(it));
      const dis = it.disabled?.() ?? false;
      const sel = i === this.index;
      t.setColor(dis ? COL.dis : sel ? COL.sel : COL.idle);
      const v = this.values[i];
      if (v && it.value) v.setText(it.value()).setColor(dis ? COL.dis : sel ? COL.valueSel : COL.value);
      if (it.keys) this.drawCaps(i, it.keys());
    });
    const y = this.rowY(this.index);
    if (!instant && this.shownIndex !== this.index) this.bounce(this.index);
    this.shownIndex = this.index;
    this.hlTween?.stop();
    if (instant) this.hl.setPosition(this.x, y);
    else {
      this.hl.setX(this.x);
      this.hlTween = this.scene.tweens.add({ targets: this.hl, y, duration: 70, ease: 'Quad.out', onUpdate: () => (this.hl.y = Math.round(this.hl.y)) });
    }
  }

  private drawCaps(i: number, keys: string[]): void {
    const sig = keys.join(',');
    if (sig === this.capsSig[i]) return;
    this.capsSig[i] = sig;
    this.caps[i]!.forEach((c) => c.destroy());
    const right = Math.round(this.x + this.rowW / 2 - 8);
    // lay out right-to-left
    const made: Phaser.GameObjects.Container[] = [];
    let cx = right;
    [...keys].reverse().forEach((k) => {
      const tmp = keycap(this.scene, 0, this.rowY(i), k);
      cx -= tmp.w;
      tmp.obj.setX(cx);
      cx -= 3;
      made.push(tmp.obj);
    });
    const d = this.texts[i].depth;
    made.forEach((m) => m.setDepth(d));
    this.caps[i] = made;
  }

  private select(): void {
    const it = this.items[this.index];
    // one activation per press, whichever device it came from
    const now = this.scene.time.now;
    if (now - this.lastSelect < 180) return;
    this.lastSelect = now;
    if (it.disabled?.()) {
      sfx.select();
      this.scene.tweens.add({ targets: this.texts[this.index], x: this.texts[this.index].x + 2, yoyo: true, repeat: 1, duration: 40 });
      return;
    }
    sfx.confirm();
    this.punch();
    const t = this.texts[this.index];
    const baseY = this.rowY(this.index);
    t.setY(baseY + 1);
    this.scene.time.delayedCall(70, () => t.active && t.setY(baseY));
    this.hl.setTintFill(0xffffff);
    this.scene.time.delayedCall(50, () => this.hl.active && this.hl.clearTint());
    it.onSelect?.();
    if (this.scene.sys.isActive()) this.refresh();
  }

  update(time: number): void {
    // animated cursor (runs even when disabled so it never freezes mid-bob)
    const bob = Math.round(Math.sin(time / 140) * 1.5);
    const y = Math.round(this.hl.y);
    this.cursor.setPosition(Math.round(this.x - this.rowW / 2) - 6 + bob, y);
    this.cursorR.setPosition(Math.round(this.x + this.rowW / 2) + 5 - bob, y);
    // selected bar breathes
    this.hl.setAlpha(0.88 + 0.12 * Math.sin(time / 170));
    if (!this.enabled) return;
    this.inp.update(time);
    const n = this.items.length;
    if (this.inp.justPressed('down')) {
      this.index = (this.index + 1) % n;
      sfx.select();
      this.refresh();
    } else if (this.inp.justPressed('up')) {
      this.index = (this.index - 1 + n) % n;
      sfx.select();
      this.refresh();
    } else if (this.inp.justPressed('left') || this.inp.justPressed('right')) {
      const it = this.items[this.index];
      if (it.onAdjust) {
        it.onAdjust(this.inp.justPressed('left') ? -1 : 1);
        sfx.select();
        this.refresh();
      }
    } else if (this.inp.justPressed('confirm') || this.inp.justPressed('attack')) {
      this.select();
    }
  }
}
