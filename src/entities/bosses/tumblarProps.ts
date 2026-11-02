import Phaser from 'phaser';
import type { HitInfo, Hurtable, Rect } from '../../combat/types';
import { DIAL_N, type Dir } from '../../combat/tumblarPlan';
import { txt, type PxText } from '../../ui/text';
import { sfx } from '../../systems/sfx';
import type { GameScene } from '../../scenes/GameScene';
import { solidZone, movePlatform, type Solid } from './erratumProps';

/** Lock-part colours */
export const BRASS = 0xffb84d;
export const GOLD = 0xffd96a;
export const STEEL = 0x8b8ba8;
export const LINK_SAME = 0x7fdbff;
export const LINK_OPP = 0xff8fb8;

const HEAD_W = 28;
const HEAD_H = 8;

/** Plain hits on a lock part: a soft "clink", throttled (the part didn't move). */
function clink(gs: GameScene, x: number, y: number, last: { t: number }): void {
  const now = gs.time.now;
  if (now - last.t < 350) return;
  last.t = now;
  sfx.tick(false);
  gs.juice.burst(x, y, STEEL, 3, 0.4);
}

// ---------------------------------------------------------------------------- pin heads (P1)

/**
 * One pin head: a one-way brass ledge in its column. Up-slash = raise, slam = lower; anything else
 * just clinks. The owner decides what actually moves (links can drag other heads, a jam moves none).
 */
export class PinHead implements Hurtable {
  readonly team = 'enemy' as const;
  alive = true;
  readonly img: Phaser.GameObjects.Sprite;
  readonly zone: Solid;
  private last = { t: 0 };
  private cool = 0;
  private moveTw?: Phaser.Tweens.Tween;

  constructor(private gs: GameScene, readonly i: number, readonly x: number, y: number, private onStrike: (i: number, d: 1 | -1) => void) {
    this.zone = solidZone(gs, x, y, HEAD_W, HEAD_H, true);
    this.img = gs.add.sprite(x, y, 'tumblar-pin', 0).setDepth(12);
    gs.damage.register(this);
  }

  get y(): number {
    return this.zone.y;
  }

  hurtRect(): Rect {
    return { x: this.x - HEAD_W / 2, y: this.zone.y - HEAD_H / 2 - 1, w: HEAD_W, h: HEAD_H + 2 };
  }

  receiveHit(hit: HitInfo): 'hit' | 'blocked' | 'ignored' {
    if (!this.alive || hit.kind === 'hazard' || hit.kind === 'contact') return 'ignored';
    const now = this.gs.time.now;
    if (hit.up || hit.slam) {
      if (now < this.cool) return 'ignored';
      this.cool = now + 140;
      this.onStrike(this.i, hit.up ? 1 : -1);
      return 'hit';
    }
    clink(this.gs, this.x, this.zone.y, this.last);
    return 'ignored';
  }

  /** Slide to `y` (riders carried). */
  moveTo(y: number, ms = 110, ease = 'Back.out'): void {
    this.moveTw?.stop();
    const from = this.zone.y;
    if (Math.abs(from - y) < 0.5) return;
    const o = { t: 0 };
    this.moveTw = this.gs.tweens.add({
      targets: o,
      t: 1,
      duration: ms,
      ease,
      onUpdate: () => {
        if (!this.alive) return;
        const ny = from + (y - from) * o.t;
        movePlatform(this.gs, this.zone, this.x, ny);
        this.img.setY(Math.round(ny));
      },
    });
  }

  setFrame(f: number): void {
    this.img.setFrame(f);
  }

  destroy(quiet = false): void {
    if (!this.alive) return;
    this.alive = false;
    this.moveTw?.stop();
    this.gs.damage.unregister(this);
    if (!quiet) this.gs.juice.burst(this.x, this.zone.y, BRASS, 6, 0.6);
    this.zone.destroy();
    this.img.destroy();
  }
}

// ---------------------------------------------------------------------------- dial (P2)

const DIAL_R = 31;
const NUM_R = 19;

/**
 * The combination dial, hanging on a chain. Strike it from the left = turn right (clockwise),
 * from the right = turn left; heavy = 3 numbers. Numbers orbit upright around the face; the number
 * under the gold pointer is `pos`.
 */
export class DialProp implements Hurtable {
  readonly team = 'enemy' as const;
  alive = true;
  readonly disk: Phaser.GameObjects.Sprite;
  private nums: PxText[] = [];
  private chain: Phaser.GameObjects.Rectangle;
  private pointer: Phaser.GameObjects.Graphics;
  private arrows: PxText[] = [];
  private angle = 0;
  private spin?: Phaser.Tweens.Tween;
  private cool = 0;
  private last = { t: 0 };

  constructor(private gs: GameScene, readonly x: number, readonly y: number, ceilY: number, private onTurn: (dir: Dir, steps: number) => void) {
    this.chain = gs.add.rectangle(x, (ceilY + y - DIAL_R) / 2, 2, y - DIAL_R - ceilY, STEEL).setDepth(11);
    this.disk = gs.add.sprite(x, y, 'tumblar-dial').setDepth(12);
    for (let k = 0; k < DIAL_N; k++) this.nums.push(txt(gs, x, y, String(k), 8, '#c2c3d6').setDepth(13));
    this.pointer = gs.add.graphics().setDepth(13);
    this.pointer.fillStyle(GOLD, 1).fillTriangle(x - 4, y - DIAL_R - 6, x + 4, y - DIAL_R - 6, x, y - DIAL_R + 1);
    this.arrows.push(txt(gs, x - DIAL_R - 9, y, 'R>', 8, '#7fdbff').setDepth(13));
    this.arrows.push(txt(gs, x + DIAL_R + 9, y, '<L', 8, '#ff8fb8').setDepth(13));
    this.layout();
    gs.damage.register(this);
  }

  hurtRect(): Rect {
    return { x: this.x - DIAL_R + 3, y: this.y - DIAL_R + 3, w: DIAL_R * 2 - 6, h: DIAL_R * 2 - 6 };
  }

  receiveHit(hit: HitInfo): 'hit' | 'blocked' | 'ignored' {
    if (!this.alive || hit.kind === 'hazard' || hit.kind === 'contact') return 'ignored';
    const now = this.gs.time.now;
    const dx = hit.sourceX - this.x;
    if (Math.abs(dx) < 5) {
      clink(this.gs, this.x, this.y + DIAL_R, this.last);
      return 'ignored';
    }
    if (now < this.cool) return 'ignored';
    this.cool = now + 120;
    this.onTurn(dx < 0 ? 1 : -1, hit.heavy ? 3 : 1);
    return 'hit';
  }

  /** Rotate so `pos` sits under the pointer (numbers laid out counter-clockwise: + = clockwise turn). */
  showPos(pos: number, dir: Dir, steps: number): void {
    this.spin?.stop();
    const target = this.angle + dir * steps * ((Math.PI * 2) / DIAL_N);
    this.spin = this.gs.tweens.add({
      targets: this,
      angle: target,
      duration: 70 + steps * 50,
      ease: 'Quad.out',
      onUpdate: () => this.layout(),
      onComplete: () => {
        // snap to the exact angle for pos (no float drift over a long fight)
        this.angle = (pos * Math.PI * 2) / DIAL_N;
        this.layout();
      },
    });
  }

  private layout(): void {
    if (!this.alive) return;
    this.disk.setRotation(this.angle);
    this.nums.forEach((t, k) => {
      const a = this.angle - (k * Math.PI * 2) / DIAL_N;
      t.setPosition(Math.round(this.x + Math.sin(a) * NUM_R), Math.round(this.y - Math.cos(a) * NUM_R));
    });
  }

  /** Briefly light one number (contact click / hint). */
  flashNumber(k: number, color = '#ffd96a', ms = 260): void {
    const t = this.nums[((k % DIAL_N) + DIAL_N) % DIAL_N];
    if (!t?.active) return;
    t.setColor(color);
    this.gs.time.delayedCall(ms, () => t.active && t.setColor('#c2c3d6'));
  }

  destroy(quiet = false): void {
    if (!this.alive) return;
    this.alive = false;
    this.spin?.stop();
    this.gs.damage.unregister(this);
    if (!quiet) this.gs.juice.burst(this.x, this.y, BRASS, 12, 0.9);
    for (const o of [this.disk, this.chain, this.pointer, ...this.nums, ...this.arrows]) o.destroy();
  }
}

// ---------------------------------------------------------------------------- bolts (P3)

/** A floor bolt: thrown (sticking up, locked) or drawn (flush). Any strike flips it and its neighbours. */
export class BoltProp implements Hurtable {
  readonly team = 'enemy' as const;
  alive = true;
  readonly img: Phaser.GameObjects.Sprite;
  private cool = 0;

  constructor(private gs: GameScene, readonly i: number, readonly x: number, private floorY: number, private onStrike: (i: number) => void) {
    this.img = gs.add.sprite(x, floorY + 5, 'tumblar-bolt', 1).setOrigin(0.5, 1).setDepth(12);
    gs.damage.register(this);
  }

  hurtRect(): Rect {
    return { x: this.x - 9, y: this.floorY - 26, w: 18, h: 26 };
  }

  receiveHit(hit: HitInfo): 'hit' | 'blocked' | 'ignored' {
    if (!this.alive || hit.kind === 'hazard' || hit.kind === 'contact') return 'ignored';
    const now = this.gs.time.now;
    if (now < this.cool) return 'ignored';
    this.cool = now + 160;
    this.onStrike(this.i);
    return 'hit';
  }

  setThrown(on: boolean, animate = true): void {
    if (!this.alive) return;
    const f = on ? 0 : 1;
    if (Number(this.img.frame.name) === f) return;
    this.img.setFrame(f);
    if (animate) {
      this.gs.tweens.killTweensOf(this.img);
      this.img.setScale(1, on ? 0.6 : 1.3);
      this.gs.tweens.add({ targets: this.img, scaleY: 1, duration: 140, ease: 'Back.out' });
      this.gs.juice.burst(this.x, this.floorY - 4, on ? 0xff6a5a : GOLD, 4, 0.5);
    }
  }

  destroy(): void {
    if (!this.alive) return;
    this.alive = false;
    this.gs.damage.unregister(this);
    this.gs.tweens.killTweensOf(this.img);
    this.img.destroy();
  }
}
