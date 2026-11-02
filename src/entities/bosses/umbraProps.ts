import Phaser from 'phaser';
import { StrikeTarget } from './croupierProps';
import { addLight } from '../../core/Fx';
import { sfx } from '../../systems/sfx';
import {
  RAIL, DROP_Y, LANTERN_HIT_COOLDOWN, PUSH_PX, clampRail, hitLantern, lanternHitKind,
  type LanternHit, type LanternState,
} from '../../combat/umbraPlan';
import type { GameScene } from '../../scenes/GameScene';

/** Lamps, chains and glows draw above the P3 darkness (Umbra DARK_DEEP = 35). */
export const LAMP_DEPTH = 37;
const WARM = 0xffd96a;

/**
 * A lantern on UMBRA's ceiling rail. The player strikes it to move the light (umbraPlan.hitLantern):
 * side hits slide it, up-slashes hoist it, pogos lower it, and a snuffed lantern is relit by any hit.
 * The displayed lamp eases toward its state and swings a little on its chain; `lx` / `ly` (the lamp)
 * is what casts the shadow.
 */
export class Lantern {
  st: LanternState;
  /** displayed anchor x on the rail and chain end y (eased toward st) */
  private ax: number;
  private ay: number;
  /** pendulum angle (rad) and its velocity (rad/s) */
  private swing = 0;
  private swingV = 0;
  private lastHit = -99999;
  private lamp: Phaser.GameObjects.Sprite;
  private chain: Phaser.GameObjects.Graphics;
  private glow: Phaser.GameObjects.Image;
  private target: StrikeTarget;
  private glowMul = 1;
  dead = false;

  constructor(
    private gs: GameScene,
    st: LanternState,
    /** after a player hit has changed the state (the boss reacts / plays its own feedback) */
    private onStruck: (l: Lantern, kind: LanternHit, relit: boolean) => void,
    dropIn = false,
  ) {
    this.st = { ...st };
    this.ax = st.x;
    this.ay = dropIn ? RAIL.y + 4 : DROP_Y[st.drop];
    this.chain = gs.add.graphics().setDepth(LAMP_DEPTH - 1);
    this.glow = addLight(gs, this.ax, this.ay, WARM, 60, st.lit ? 0.45 : 0).setDepth(LAMP_DEPTH - 1);
    this.lamp = gs.add.sprite(this.ax, this.ay, 'umbra-lantern', st.lit ? 0 : 2).setDepth(LAMP_DEPTH);
    this.target = new StrikeTarget(gs, () => ({ x: this.lx - 8, y: this.ly - 10, w: 16, h: 20 }), (hit) => this.struck(hit));
    this.draw();
  }

  /** the light's position (the lamp at the end of its swinging chain) */
  get lx(): number {
    return this.ax + Math.sin(this.swing) * (this.ay - RAIL.y);
  }
  get ly(): number {
    return RAIL.y + Math.cos(this.swing) * (this.ay - RAIL.y);
  }
  get lit(): boolean {
    return this.st.lit;
  }

  private struck(hit: Parameters<typeof lanternHitKind>[0]): boolean {
    if (this.dead) return false;
    const now = this.gs.time.now;
    if (now - this.lastHit < LANTERN_HIT_COOLDOWN) {
      sfx.lanternClang(0.6);
      return true;
    }
    this.lastHit = now;
    const kind = lanternHitKind(hit);
    const dir = Math.sign(hit.kbX) || (this.lx >= this.gs.player.x ? 1 : -1);
    const was = this.st;
    this.st = hitLantern(this.st, kind, dir);
    const relit = !was.lit && this.st.lit;
    if (relit) this.setLit(true);
    else if (kind === 'side') this.kick(dir);
    else this.swingV += (Math.random() - 0.5) * 2;
    sfx.lanternClang(1);
    this.gs.juice.burst(this.lx, this.ly, WARM, 6, 0.6);
    this.onStruck(this, kind, relit);
    return true;
  }

  /** knocked along the rail by something other than the player (a snuff wisp) */
  push(dir: number): void {
    if (this.dead) return;
    this.st = { ...this.st, x: clampRail(this.st.x + Math.sign(dir || 1) * PUSH_PX) };
    this.kick(dir);
    sfx.lanternClang(0.8);
  }

  /** slide to a rail position (Lamp Swap) */
  moveTo(x: number): void {
    const dir = Math.sign(x - this.st.x);
    this.st = { ...this.st, x: clampRail(x) };
    this.kick(dir);
  }

  /** the lamp lags behind a slide: swing back, then settle */
  private kick(dir: number): void {
    this.swingV -= Math.sign(dir || 1) * 2.6;
  }

  snuff(): void {
    if (!this.st.lit) return;
    this.st = { ...this.st, lit: false };
    this.setLit(false);
    sfx.snuff();
    this.gs.juice.burst(this.lx, this.ly, 0x463a66, 10, 0.7);
  }

  private setLit(on: boolean): void {
    this.lamp.stop();
    this.lamp.setFrame(on ? 0 : 2);
    if (on) {
      sfx.relight();
      this.gs.juice.ring(this.lx, this.ly, WARM, 1.2);
    }
  }

  /** guttering flames before a Lamp Swap / snuff */
  flicker(ms: number): void {
    if (!this.st.lit) return;
    this.lamp.play('umbra-lantern-flicker');
    this.gs.time.delayedCall(ms, () => {
      if (!this.dead && this.st.lit) this.lamp.stop().setFrame(0);
    });
  }

  /** death: the light swells white and burns the shadow off, then the lantern is gone */
  flare(ms: number): void {
    if (this.dead) return;
    this.glowMul = 1;
    this.glow.setTint(0xffffff);
    this.gs.tweens.add({ targets: this.glow, alpha: 1, scale: 8, duration: ms, ease: 'Quad.in' });
    this.gs.tweens.add({ targets: this.glow, alpha: 0, delay: ms, duration: 500, onComplete: () => this.destroy() });
  }

  update(dt: number): void {
    if (this.dead) return;
    const k = Math.min(1, dt / 110);
    this.ax += (this.st.x - this.ax) * k;
    this.ay += (DROP_Y[this.st.drop] - this.ay) * Math.min(1, dt / 160);
    // damped pendulum (~1 Hz)
    const s = dt / 1000;
    this.swingV += (-40 * this.swing - 3 * this.swingV) * s;
    this.swing = Phaser.Math.Clamp(this.swing + this.swingV * s, -0.6, 0.6);
    this.draw();
  }

  private draw(): void {
    const x = this.lx, y = this.ly;
    this.lamp.setPosition(Math.round(x), Math.round(y)).setRotation(-this.swing * 0.5);
    const flick = this.st.lit ? 0.42 + Math.sin(this.gs.time.now / 90) * 0.03 + Math.sin(this.gs.time.now / 37) * 0.02 : 0;
    this.glow.setPosition(x, y + 2).setAlpha(Math.min(1, flick * this.glowMul)).setScale((60 * this.glowMul) / 32);
    const g = this.chain.clear();
    g.lineStyle(1, 0x2c2244, 1).lineBetween(this.ax, RAIL.y, x, y - 9);
    g.fillStyle(0x6a5c94, 1).fillRect(Math.round(this.ax) - 2, RAIL.y - 2, 4, 3);
  }

  destroy(): void {
    if (this.dead) return;
    this.dead = true;
    this.target.kill();
    this.lamp.destroy();
    this.chain.destroy();
    this.glow.destroy();
  }
}

/** A soft hole of light in the darkness: centre, radius (px), strength 0..1. */
export interface Hole {
  x: number;
  y: number;
  r: number;
  a: number;
}

/**
 * Darkness with holes punched where the light is (adapted from Moth's eclipse). Below the actors
 * (depth 12) it only dims the room; above them (P3) it hides everything the light doesn't reach.
 */
export class DimOverlay {
  private rt: Phaser.GameObjects.RenderTexture;
  private brush: Phaser.GameObjects.Image;
  alpha = 0;

  constructor(private gs: GameScene, depth: number) {
    this.rt = gs.add.renderTexture(0, 0, gs.worldWidth, gs.worldHeight + 32).setOrigin(0, 0).setDepth(depth);
    this.brush = gs.make.image({ key: 'light', add: false });
  }

  fadeTo(a: number, ms: number): void {
    this.gs.tweens.killTweensOf(this);
    this.gs.tweens.add({ targets: this, alpha: a, duration: ms, ease: 'Sine.inOut' });
  }

  setDepth(d: number): void {
    this.rt.setDepth(d);
  }

  draw(holes: readonly Hole[]): void {
    const rt = this.rt;
    rt.clear();
    if (this.alpha <= 0.01) return;
    rt.fill(0x05030c, this.alpha);
    for (const h of holes) {
      this.brush.setScale((h.r * 2) / 64).setAlpha(h.a);
      rt.erase(this.brush, h.x, h.y);
    }
  }

  /** fade the whole layer out (no more redraws needed), then free it */
  fadeOut(ms: number): void {
    this.gs.tweens.killTweensOf(this);
    this.gs.tweens.add({ targets: this.rt, alpha: 0, duration: ms, onComplete: () => this.destroy() });
  }

  destroy(): void {
    if (!this.rt.scene) return;
    this.rt.destroy();
    this.brush.destroy();
  }
}
