import Phaser from 'phaser';
import { paintPanel, ARROW, type PanelStyle } from '../art/ui';
import { drawCanvas } from '../art/pixel';
import { txt, type PxText } from './text';

export type { PanelStyle };

/** Texture key for a panel of the given style/size (painted once, then cached). */
export function panelTexture(scene: Phaser.Scene, w: number, h: number, style: PanelStyle): string {
  w = Math.max(4, Math.round(w));
  h = Math.max(4, Math.round(h));
  const key = `ui-pn-${style}-${w}x${h}`;
  if (!scene.textures.exists(key)) drawCanvas(scene, key, w, h, (ctx) => paintPanel(ctx, w, h, style));
  return key;
}

/**
 * Framed panel centred on (x, y). The top-left corner always lands on a whole pixel,
 * so panels stay crisp even with odd sizes. Origin is 0.5 so it can be scaled for pop-ins.
 */
export function panel(scene: Phaser.Scene, x: number, y: number, w: number, h: number, style: PanelStyle = 'dark'): Phaser.GameObjects.Image {
  w = Math.round(w);
  h = Math.round(h);
  const left = Math.round(x - w / 2);
  const top = Math.round(y - h / 2);
  return scene.add.image(left + w / 2, top + h / 2, panelTexture(scene, w, h, style));
}

/** Readable label for a Phaser key-code name. */
export function keyLabel(name: string): string {
  const map: Record<string, string> = {
    SPACE: 'SPACE', SHIFT: 'SHIFT', ESC: 'ESC', ENTER: 'ENTER', BACKSPACE: 'BKSP', CTRL: 'CTRL', ALT: 'ALT', TAB: 'TAB',
    COMMA: ',', PERIOD: '.', FORWARD_SLASH: '/', SEMICOLON: ';', QUOTES: "'", MINUS: '-', PLUS: '+',
    ZERO: '0', ONE: '1', TWO: '2', THREE: '3', FOUR: '4', FIVE: '5', SIX: '6', SEVEN: '7', EIGHT: '8', NINE: '9',
  };
  return map[name] ?? (name.startsWith('NUMPAD_') ? 'N' + name.slice(7, 8) : name);
}

const ARROW_KEYS: Record<string, number> = { LEFT: ARROW.left, RIGHT: ARROW.right, UP: ARROW.up, DOWN: ARROW.down };

/**
 * Keyboard key cap glyph. `name` is a Phaser key-code name ('Z', 'SPACE', 'LEFT', ...).
 * Returns a container whose left edge sits at x (vertically centred on y) and its width.
 */
export function keycap(scene: Phaser.Scene, x: number, y: number, name: string, color = '#f4f1ea'): { obj: Phaser.GameObjects.Container; w: number } {
  const arrow = ARROW_KEYS[name];
  let label: PxText | null = null;
  let w: number;
  if (arrow !== undefined) w = 11;
  else {
    label = txt(scene, 0, 0, keyLabel(name), 8, color);
    w = Math.max(11, Math.round(label.width) + 4);
    if ((w & 1) === 0) w++;
  }
  const h = 12;
  const left = Math.round(x);
  const top = Math.round(y - h / 2);
  const cap = scene.add.image(0, 0, panelTexture(scene, w, h, 'key')).setOrigin(0, 0);
  const parts: Phaser.GameObjects.GameObject[] = [cap];
  if (label) parts.push(label.setPosition(Math.floor(w / 2), 5));
  else parts.push(scene.add.image(3, 2, 'ui-arrow', arrow).setOrigin(0, 0).setTint(0xf4f1ea));
  const obj = scene.add.container(left, top, parts);
  return { obj, w };
}

/** Mouse glyph: 'L' / 'R' highlights that button. Left edge at x, centred on y. */
export function mouseGlyph(scene: Phaser.Scene, x: number, y: number, which: 'L' | 'R' | '' = ''): { obj: Phaser.GameObjects.Image; w: number } {
  const frame = which === 'L' ? 1 : which === 'R' ? 2 : 0;
  const img = scene.add.image(Math.round(x), Math.round(y - 7), 'ui-mouse', frame).setOrigin(0, 0);
  return { obj: img, w: 11 };
}

/**
 * Inline hint line made of key caps, mouse glyphs and text. Tokens:
 *  '[Z]' key cap, '[LEFT]' arrow cap, '{L}' / '{R}' mouse button, anything else = text.
 * Example: hintRow(scene, 240, 260, ['[Z]', 'Jump', '[X]', '{L}', 'Attack'])
 * Centred on x unless align = 0 (left) / 1 (right). Returns a container.
 */
export function hintRow(
  scene: Phaser.Scene,
  x: number,
  y: number,
  tokens: string[],
  opts: { color?: string; gap?: number; align?: 0 | 0.5 | 1 } = {},
): Phaser.GameObjects.Container {
  const color = opts.color ?? '#8b8ba8';
  const gap = opts.gap ?? 3;
  const parts: Phaser.GameObjects.GameObject[] = [];
  let cx = 0;
  for (const tok of tokens) {
    let w = 0;
    if (/^\[.+\]$/.test(tok)) {
      const k = keycap(scene, cx, 0, tok.slice(1, -1));
      parts.push(k.obj);
      w = k.w;
    } else if (/^\{[LR]?\}$/.test(tok)) {
      const m = mouseGlyph(scene, cx, 0, tok[1] === '}' ? '' : (tok[1] as 'L' | 'R'));
      parts.push(m.obj);
      w = m.w;
    } else if (tok === '|') {
      cx += 6;
      continue;
    } else {
      const t = txt(scene, cx, 0, tok, 8, color, 0);
      parts.push(t);
      w = Math.round(t.width);
    }
    cx += w + gap;
  }
  const total = Math.max(0, cx - gap);
  const align = opts.align ?? 0.5;
  const c = scene.add.container(Math.round(x - total * align), Math.round(y), parts);
  c.setSize(total, 14);
  return c;
}

/** Horizontal fill bar inside a slot frame. Call `set(fraction)` / `ghost(fraction)`. */
export class Bar {
  readonly frame: Phaser.GameObjects.Image;
  readonly fill: Phaser.GameObjects.Rectangle;
  readonly lag: Phaser.GameObjects.Rectangle;
  readonly shine: Phaser.GameObjects.Rectangle;
  private inner: number;
  private lagTween?: Phaser.Tweens.Tween;
  value = 1;

  constructor(
    private scene: Phaser.Scene,
    public x: number,
    public y: number,
    public w: number,
    public h: number,
    public color: number,
    lagColor = 0xffffff,
  ) {
    this.frame = scene.add.image(0, 0, panelTexture(scene, w, h, 'slot')).setOrigin(0, 0);
    this.inner = w - 6;
    this.lag = scene.add.rectangle(0, 0, this.inner, h - 6, lagColor).setOrigin(0, 0);
    this.fill = scene.add.rectangle(0, 0, this.inner, h - 6, color).setOrigin(0, 0);
    this.shine = scene.add.rectangle(0, 0, this.inner, 1, 0xffffff, 0.35).setOrigin(0, 0);
    this.place(x, y);
  }

  place(x: number, y: number): void {
    this.x = Math.round(x);
    this.y = Math.round(y);
    this.frame.setPosition(this.x, this.y);
    this.lag.setPosition(this.x + 3, this.y + 3);
    this.fill.setPosition(this.x + 3, this.y + 3);
    this.shine.setPosition(this.x + 3, this.y + 3);
  }

  /** Resize the frame (e.g. when max stamina grows). */
  resize(w: number): void {
    w = Math.round(w);
    if (w === this.w) return;
    this.w = w;
    this.inner = w - 6;
    this.frame.setTexture(panelTexture(this.scene, w, this.h, 'slot'));
    this.set(this.value, true);
  }

  /** Set fill fraction; the lag segment catches up after a short delay. */
  set(f: number, instant = false): void {
    f = Phaser.Math.Clamp(f, 0, 1);
    const prev = this.value;
    this.value = f;
    const px = Math.round(this.inner * f);
    this.fill.width = px;
    this.shine.width = px;
    if (instant || f >= prev) {
      // gains: the lag segment only ever trails losses
      if (instant || this.lag.width < px || !this.lagTween?.isPlaying()) {
        this.lagTween?.stop();
        this.lag.width = Math.max(px, instant ? px : Math.min(this.lag.width, this.inner));
      }
      return;
    }
    if (this.lagTween?.isPlaying()) {
      // already draining: retarget without restarting the delay
      this.lagTween.updateTo('width', px, true);
      return;
    }
    this.lagTween = this.scene.tweens.add({
      targets: this.lag,
      width: px,
      delay: 350,
      duration: 380,
      ease: 'Quad.in',
      onUpdate: () => (this.lag.width = Math.round(this.lag.width)),
    });
  }

  setVisible(v: boolean): this {
    [this.frame, this.fill, this.lag, this.shine].forEach((o) => o.setVisible(v));
    return this;
  }

  objects(): Phaser.GameObjects.GameObject[] {
    return [this.frame, this.lag, this.fill, this.shine];
  }
}

/** Burst of little pixel sparks (for stamps, purchases, pickups). */
export function sparkBurst(scene: Phaser.Scene, x: number, y: number, color: number, n = 14, radius = 40, depth = 50): void {
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + Math.random() * 0.3;
    const r = radius * (0.6 + Math.random() * 0.5);
    const s = scene.add
      .image(Math.round(x), Math.round(y), 'ui-spark', Math.random() < 0.5 ? 0 : 1)
      .setTint(i % 3 === 0 ? 0xffffff : color)
      .setDepth(depth);
    scene.tweens.add({
      targets: s,
      x: Math.round(x + Math.cos(a) * r),
      y: Math.round(y + Math.sin(a) * r),
      alpha: 0,
      duration: 420 + Math.random() * 200,
      ease: 'Quad.out',
      onComplete: () => s.destroy(),
    });
  }
}

/** Vertical gradient backdrop texture (cached). Colours top → bottom. */
export function gradientTexture(scene: Phaser.Scene, key: string, w: number, h: number, stops: number[], bands = 12): string {
  if (scene.textures.exists(key)) return key;
  drawCanvas(scene, key, w, h, (ctx) => {
    // banded (posterised) gradient — reads as pixel art rather than a smooth blend
    const lerp = (a: number, b: number, t: number) => Math.round(a + (b - a) * t);
    for (let i = 0; i < bands; i++) {
      const t = i / (bands - 1);
      const seg = Math.min(stops.length - 2, Math.floor(t * (stops.length - 1)));
      const lt = t * (stops.length - 1) - seg;
      const a = stops[seg];
      const b = stops[seg + 1];
      const r = lerp((a >> 16) & 255, (b >> 16) & 255, lt);
      const g = lerp((a >> 8) & 255, (b >> 8) & 255, lt);
      const bl = lerp(a & 255, b & 255, lt);
      ctx.fillStyle = `rgb(${r},${g},${bl})`;
      const y0 = Math.floor((i / bands) * h);
      const y1 = Math.floor(((i + 1) / bands) * h);
      ctx.fillRect(0, y0, w, y1 - y0);
    }
  });
  return key;
}

/** Twinkling star specks over an area. */
export function starfield(scene: Phaser.Scene, w: number, h: number, n: number, depth = -90, tint = 0xc2c3d6): Phaser.GameObjects.Image[] {
  const out: Phaser.GameObjects.Image[] = [];
  for (let i = 0; i < n; i++) {
    const s = scene.add
      .image(Math.floor(Math.random() * w), Math.floor(Math.random() * h), Math.random() < 0.15 ? 'ui-dot' : 'ui-px')
      .setOrigin(0, 0)
      .setTint(tint)
      .setAlpha(0.3 + Math.random() * 0.5)
      .setDepth(depth);
    scene.tweens.add({ targets: s, alpha: 0.1, yoyo: true, repeat: -1, duration: 800 + Math.random() * 1800, delay: Math.random() * 2000 });
    out.push(s);
  }
  return out;
}

/** Soft sunburst used behind the rank stamp. */
export function raysTexture(scene: Phaser.Scene): string {
  const key = 'ui-rays';
  if (!scene.textures.exists(key)) {
    drawCanvas(scene, key, 128, 128, (ctx) => {
      ctx.translate(64, 64);
      for (let i = 0; i < 12; i++) {
        ctx.rotate((Math.PI * 2) / 12);
        const g = ctx.createLinearGradient(0, 0, 64, 0);
        g.addColorStop(0, 'rgba(255,255,255,0.55)');
        g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(64, -9);
        ctx.lineTo(64, 9);
        ctx.closePath();
        ctx.fill();
      }
    });
  }
  return key;
}
