import Phaser from 'phaser';
import { FONT, sanitize } from '../art/font';

/**
 * Pixel-font text object. BitmapText with a few Text-like conveniences so scenes can
 * treat it like the old Phaser.Text (setColor / setWordWrapWidth / setStroke no-op).
 */
export class PxText extends Phaser.GameObjects.BitmapText {
  constructor(scene: Phaser.Scene, x: number, y: number, s: string, scale: number) {
    super(scene, x, y, FONT, sanitize(s));
    this.setScale(scale);
    this.setCenterAlign();
  }
  setText(value: string | string[]): this {
    return super.setText(Array.isArray(value) ? value.map(sanitize) : sanitize(value));
  }
  /** css colour string or 0xRRGGBB */
  setColor(color: string | number): this {
    const c = typeof color === 'number' ? color : Phaser.Display.Color.HexStringToColor(color).color;
    return this.setTint(c);
  }
  setWordWrapWidth(w: number): this {
    return this.setMaxWidth(w / this.scaleX);
  }
  /** outline is baked into the font; kept for API compatibility */
  setStroke(_c?: string, _t?: number): this {
    return this;
  }
}

/** Map a legacy CSS-ish font size to an integer pixel scale (crisp pixels). */
export function scaleFor(size: number): number {
  if (size >= 36) return 5;
  if (size >= 24) return 3;
  if (size >= 14) return 2;
  return 1;
}

export function txt(scene: Phaser.Scene, x: number, y: number, s: string, size = 10, color = '#ffffff', origin = 0.5): PxText {
  const t = new PxText(scene, Math.round(x), Math.round(y), s, scaleFor(size));
  scene.add.existing(t);
  return t.setOrigin(origin, 0.5).setColor(color);
}

export function fmtTime(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const cs = Math.floor((ms % 1000) / 10);
  return `${m}:${String(s % 60).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}
