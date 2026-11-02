import Phaser from 'phaser';
import type { HitInfo } from '../../combat/types';
import { TILE } from '../../config';
import { txt, type PxText } from '../../ui/text';
import { nearestSafe, type Span } from '../../combat/erratumPlan';
import type { GameScene } from '../../scenes/GameScene';
import type { Enemy } from '../Enemy';
import { StrikeTarget } from './croupierProps';

export { StrikeTarget };

/** Ink + paper colours shared by the props. */
export const INK = 0x231b44;
export const INK_DARK = 0x0e0a1c;
export const PAPER = 0xefe4c8;
export const RED_INK = 0xe0443e;

// ---------------------------------------------------------------------------- platforms

export type Solid = Phaser.GameObjects.Zone & { body: Phaser.Physics.Arcade.Body };

/**
 * Invisible kinematic collider added to `gs.platforms` (the player, enemies and pickups collide with it).
 * `oneWay` = land on top only (like '=' tiles). Visuals are separate objects that follow it.
 */
export function solidZone(gs: GameScene, x: number, y: number, w: number, h: number, oneWay = true): Solid {
  const z = gs.add.zone(x, y, w, h) as Solid;
  gs.physics.add.existing(z);
  const b = z.body;
  b.setAllowGravity(false);
  b.setImmovable(true);
  b.moves = false;
  if (oneWay) {
    b.checkCollision.down = false;
    b.checkCollision.left = false;
    b.checkCollision.right = false;
  }
  gs.platforms.add(z);
  return z;
}

/** Move a kinematic platform and carry whoever stands on it by the same delta (as GameScene's movers do). */
export function movePlatform(gs: GameScene, z: Solid, nx: number, ny: number): void {
  if (!z.active) return;
  const mb = z.body;
  const riders: Phaser.Physics.Arcade.Sprite[] = [];
  if (gs.player.alive) riders.push(gs.player);
  for (const e of gs.enemies.getChildren() as Enemy[]) {
    const b = e.body as Phaser.Physics.Arcade.Body | null;
    if (e.alive && b?.enable && b.allowGravity) riders.push(e);
  }
  const on = riders.filter((r) => {
    const b = r.body as Phaser.Physics.Arcade.Body;
    return b.velocity.y > -120 && Math.abs(b.bottom - mb.top) < 4 && b.right > mb.left && b.left < mb.right;
  });
  const dx = nx - z.x, dy = ny - z.y;
  z.setPosition(nx, ny);
  mb.updateFromGameObject();
  for (const r of on) {
    r.x += dx;
    r.y += dy;
  }
}

/** Rect of a game object's top-left based box (x/y = centre). */
export function rectAround(x: number, y: number, w: number, h: number) {
  return { x: x - w / 2, y: y - h / 2, w, h };
}

// ---------------------------------------------------------------------------- live map edits

interface Erased {
  c: number;
  r: number;
  col: number;
  vis: number;
  deco: number;
}

/**
 * Strikethrough: erases floor columns from `floorRow` to the bottom of the map (collision + the visual
 * and decoration tile layers), so they become a pit; restore() writes them back. Tracks the player's
 * respawn point so a pit fall never respawns onto an erased column.
 */
export class PageEditor {
  private erased: Erased[] = [];
  private spans: Span[] = [];
  private fx: Phaser.GameObjects.GameObject[] = [];

  constructor(private gs: GameScene, readonly floorRow: number, readonly left: number, readonly right: number) {}

  get active(): boolean {
    return this.erased.length > 0;
  }

  get current(): readonly Span[] {
    return this.spans;
  }

  isErased(col: number): boolean {
    return this.spans.some((s) => col >= s.c0 && col <= s.c1);
  }

  erase(spans: readonly Span[]): void {
    this.restore();
    const gs = this.gs;
    const art = gs.levelArt;
    const rows = gs.level.height;
    for (const s of spans) {
      for (let c = s.c0; c <= s.c1; c++) {
        for (let r = this.floorRow - 1; r < rows; r++) {
          const t = gs.layer.getTileAt(c, r);
          const v = art?.visual.getTileAt(c, r);
          const d = art?.deco.getTileAt(c, r);
          if (r === this.floorRow - 1) {
            // only decoration (grass tufts) sits on the row above the floor
            if (d) {
              this.erased.push({ c, r, col: -1, vis: -1, deco: d.index });
              art!.deco.removeTileAt(c, r);
            }
            continue;
          }
          this.erased.push({ c, r, col: t ? t.index : -1, vis: v ? v.index : -1, deco: d ? d.index : -1 });
          if (t) gs.layer.removeTileAt(c, r);
          if (v) art!.visual.removeTileAt(c, r);
          if (d) art!.deco.removeTileAt(c, r);
        }
      }
      // torn paper edges + the red strike line across the gap
      const x0 = s.c0 * TILE, x1 = (s.c1 + 1) * TILE, y = this.floorRow * TILE;
      const g = gs.add.graphics().setDepth(12);
      g.fillStyle(INK_DARK, 1);
      for (let x = x0; x < x1; x += 3) g.fillRect(x, y + Phaser.Math.Between(-1, 2), 3, 2);
      g.fillStyle(RED_INK, 0.9);
      g.fillRect(x0 - 6, y - 2, x1 - x0 + 12, 2);
      this.fx.push(g);
    }
    this.spans = spans.slice();
    this.fixRespawn();
  }

  /** Write every erased tile back; anything standing inside the floor is popped on top of it. */
  restore(): void {
    if (!this.erased.length) return;
    const gs = this.gs;
    const art = gs.levelArt;
    for (const e of this.erased) {
      if (e.col >= 0) gs.layer.putTileAt(e.col, e.c, e.r);
      if (e.vis >= 0) art?.visual.putTileAt(e.vis, e.c, e.r);
      if (e.deco >= 0) art?.deco.putTileAt(e.deco, e.c, e.r);
    }
    const top = this.floorRow * TILE;
    const pop = (o: Phaser.Physics.Arcade.Sprite | null | undefined) => {
      const b = o?.body as Phaser.Physics.Arcade.Body | undefined;
      if (!o || !b || !o.active) return;
      const col = Math.floor(b.center.x / TILE);
      if (b.bottom > top + 1 && this.isErased(col) && b.top < gs.worldHeight) {
        o.y -= b.bottom - top + 1;
        b.updateFromGameObject();
        b.setVelocityY(Math.min(0, b.velocity.y));
      }
    };
    pop(gs.player);
    for (const e of gs.enemies.getChildren() as Enemy[]) pop(e);
    for (const p of gs.pickups.getChildren() as Phaser.Physics.Arcade.Sprite[]) pop(p);
    this.erased = [];
    this.spans = [];
    for (const f of this.fx) f.destroy();
    this.fx = [];
  }

  /** Called every frame while erased: keep the respawn point on intact floor. */
  fixRespawn(): void {
    if (!this.spans.length) return;
    const p = this.gs.player;
    const col = Math.floor(p.safePos.x / TILE);
    if (!this.isErased(col)) return;
    const c = nearestSafe(col, this.left, this.right, this.spans);
    p.safePos = { x: c * TILE + TILE / 2, y: this.floorRow * TILE - 14 };
  }

  destroy(): void {
    this.restore();
  }
}

// ---------------------------------------------------------------------------- fake OS dialog

export interface DialogButtonSpec {
  id: string;
  label: string;
  /** offset of the button centre from the dialog centre */
  dx: number;
  dy: number;
  w?: number;
}

interface Btn {
  spec: DialogButtonSpec;
  bg: Phaser.GameObjects.Graphics;
  label: PxText;
  target: StrikeTarget;
  x: number;
  y: number;
  w: number;
  h: number;
  hot: number;
}

/**
 * An in-canvas "program window" (never a real OS dialog): title bar, body text and buttons the player
 * strikes with their blade. Buttons are StrikeTargets; `onPress(id)` fires once per hit (with a short
 * re-arm so one swing doesn't double-press).
 */
export class FakeDialog {
  readonly root: Phaser.GameObjects.Container;
  private frame: Phaser.GameObjects.Graphics;
  private title: PxText;
  private body: PxText[] = [];
  private btns: Btn[] = [];
  alive = true;

  constructor(
    private gs: GameScene,
    public cx: number,
    public cy: number,
    public w: number,
    public h: number,
    titleText: string,
    lines: string[],
    buttons: DialogButtonSpec[],
    private onPress: (id: string, hit: HitInfo) => void,
    accent = 0x2d5fa8,
  ) {
    this.root = gs.add.container(Math.round(cx), Math.round(cy)).setDepth(58);
    this.frame = gs.add.graphics();
    this.root.add(this.frame);
    this.drawFrame(accent);
    this.title = txt(gs, -w / 2 + 6, -h / 2 + 6, titleText, 8, '#ffffff', 0);
    this.root.add(this.title);
    // close glyph on the title bar (decorative)
    this.root.add(txt(gs, w / 2 - 7, -h / 2 + 6, 'x', 8, '#ffffff'));
    this.setLines(lines);
    for (const b of buttons) this.addButton(b);
    this.root.setScale(0.2).setAlpha(0);
    gs.tweens.add({ targets: this.root, scale: 1, alpha: 1, duration: 160, ease: 'Back.out' });
  }

  private drawFrame(accent: number): void {
    const g = this.frame, w = this.w, h = this.h;
    g.clear();
    g.fillStyle(INK_DARK, 0.5).fillRect(-w / 2 + 3, -h / 2 + 3, w, h); // drop shadow
    g.fillStyle(0xd8d4cc, 1).fillRect(-w / 2, -h / 2, w, h);
    g.fillStyle(0xffffff, 1).fillRect(-w / 2, -h / 2, w, 1).fillRect(-w / 2, -h / 2, 1, h);
    g.fillStyle(0x6a6a7a, 1).fillRect(-w / 2, h / 2 - 1, w, 1).fillRect(w / 2 - 1, -h / 2, 1, h);
    g.fillStyle(accent, 1).fillRect(-w / 2 + 2, -h / 2 + 2, w - 4, 10);
    // the warning icon: a hand-drawn ink '!'
    g.fillStyle(0xf7b23b, 1).fillTriangle(-w / 2 + 16, -h / 2 + 18, -w / 2 + 8, -h / 2 + 32, -w / 2 + 24, -h / 2 + 32);
    g.fillStyle(INK_DARK, 1).fillRect(-w / 2 + 15, -h / 2 + 22, 2, 5).fillRect(-w / 2 + 15, -h / 2 + 29, 2, 2);
  }

  setLines(lines: string[]): void {
    for (const t of this.body) t.destroy();
    this.body = lines.map((l, i) => {
      const t = txt(this.gs, -this.w / 2 + 30, -this.h / 2 + 22 + i * 10, l, 8, '#140c1c', 0);
      this.root.add(t);
      return t;
    });
  }

  setTitle(s: string): void {
    this.title.setText(s);
  }

  private addButton(spec: DialogButtonSpec): void {
    const w = spec.w ?? 40, h = 13;
    const bg = this.gs.add.graphics();
    const label = txt(this.gs, spec.dx, spec.dy - 1, spec.label, 8, '#140c1c');
    this.root.add([bg, label]);
    const btn: Btn = { spec, bg, label, w, h, x: spec.dx, y: spec.dy, hot: 0, target: null as unknown as StrikeTarget };
    btn.target = new StrikeTarget(
      this.gs,
      () => ({ x: this.root.x + btn.x - w / 2 - 2, y: this.root.y + btn.y - h / 2 - 3, w: w + 4, h: h + 6 }),
      (hit) => {
        if (!this.alive) return false;
        const now = this.gs.time.now;
        if (now < btn.hot) return false;
        btn.hot = now + 350;
        this.pressFx(btn);
        this.onPress(spec.id, hit);
        return true;
      },
    );
    this.paintButton(btn, false);
    this.btns.push(btn);
  }

  private paintButton(b: Btn, down: boolean): void {
    const g = b.bg;
    g.clear();
    g.fillStyle(down ? 0xb8b4ac : 0xe8e4dc, 1).fillRect(b.x - b.w / 2, b.y - b.h / 2, b.w, b.h);
    g.fillStyle(down ? 0x6a6a7a : 0xffffff, 1).fillRect(b.x - b.w / 2, b.y - b.h / 2, b.w, 1).fillRect(b.x - b.w / 2, b.y - b.h / 2, 1, b.h);
    g.fillStyle(down ? 0xffffff : 0x6a6a7a, 1).fillRect(b.x - b.w / 2, b.y + b.h / 2 - 1, b.w, 1).fillRect(b.x + b.w / 2 - 1, b.y - b.h / 2, 1, b.h);
    g.lineStyle(1, INK_DARK, 1).strokeRect(b.x - b.w / 2 - 1, b.y - b.h / 2 - 1, b.w + 2, b.h + 2);
  }

  private pressFx(b: Btn): void {
    this.paintButton(b, true);
    b.label.setY(b.y);
    this.gs.time.delayedCall(140, () => {
      if (!this.alive || !b.bg.active) return;
      this.paintButton(b, false);
      b.label.setY(b.y - 1);
    });
  }

  /** World-space centre of a button. */
  buttonPos(id: string): { x: number; y: number } | null {
    const b = this.btns.find((x) => x.spec.id === id);
    return b ? { x: this.root.x + b.x, y: this.root.y + b.y } : null;
  }

  /** Move a button (offset from the dialog centre). */
  moveButton(id: string, dx: number, dy: number): void {
    const b = this.btns.find((x) => x.spec.id === id);
    if (!b) return;
    b.x = dx;
    b.y = dy;
    b.label.setPosition(Math.round(dx), Math.round(dy - 1));
    this.paintButton(b, false);
  }

  removeButton(id: string): void {
    const i = this.btns.findIndex((x) => x.spec.id === id);
    if (i < 0) return;
    const b = this.btns[i];
    b.target.kill();
    b.bg.destroy();
    b.label.destroy();
    this.btns.splice(i, 1);
  }

  addButtonLater(spec: DialogButtonSpec): void {
    this.addButton(spec);
  }

  /** Shatter into ink flecks (tweened) or just vanish (scene teardown). */
  destroy(animated = true): void {
    if (!this.alive) return;
    this.alive = false;
    for (const b of this.btns) b.target.kill();
    this.btns = [];
    if (!animated || !this.root.scene) {
      this.root.destroy();
      return;
    }
    this.gs.tweens.add({ targets: this.root, scaleX: 1.1, scaleY: 0, alpha: 0, duration: 180, ease: 'Quad.in', onComplete: () => this.root.destroy() });
  }
}

// ---------------------------------------------------------------------------- small helpers

/** A handwritten-looking label in world space (slight wobble). */
export function scrawl(gs: GameScene, x: number, y: number, s: string, color = '#231b44', size = 8): PxText {
  const t = txt(gs, x, y, s, size, color).setDepth(57);
  t.setAngle(Phaser.Math.Between(-4, 4));
  return t;
}

/** Text slab with a solid top (title menu items / credits lines). */
export interface TextSlab {
  zone: Solid;
  plate: Phaser.GameObjects.Graphics;
  label: PxText;
  w: number;
  h: number;
}

export function textSlab(gs: GameScene, x: number, y: number, text: string, opts: { w?: number; h?: number; fill?: number; color?: string; oneWay?: boolean; size?: number } = {}): TextSlab {
  const label = txt(gs, x, y, text, opts.size ?? 8, opts.color ?? '#ffeec2').setDepth(31);
  const w = opts.w ?? Math.max(40, Math.round(label.width) + 14);
  const h = opts.h ?? 14;
  const plate = gs.add.graphics().setDepth(30);
  const fill = opts.fill ?? INK;
  plate.fillStyle(INK_DARK, 1).fillRect(-w / 2 - 1, -h / 2 - 1, w + 2, h + 2);
  plate.fillStyle(fill, 1).fillRect(-w / 2, -h / 2, w, h);
  plate.fillStyle(0xffffff, 0.25).fillRect(-w / 2, -h / 2, w, 1);
  plate.setPosition(x, y);
  const zone = solidZone(gs, x, y, w, h, opts.oneWay ?? true);
  return { zone, plate, label, w, h };
}

export function slabTo(gs: GameScene, s: TextSlab, x: number, y: number): void {
  movePlatform(gs, s.zone, x, y);
  s.plate.setPosition(x, y);
  s.label.setPosition(Math.round(x), Math.round(y - 1));
}

export function destroySlab(s: TextSlab): void {
  s.zone.destroy();
  s.plate.destroy();
  s.label.destroy();
}
