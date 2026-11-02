import Phaser from 'phaser';
import { Boss } from './Boss';
import { Hitbox } from '../../combat/Hitbox';
import type { HitInfo, Rect } from '../../combat/types';
import type { Projectile } from '../Projectile';
import type { GameScene } from '../../scenes/GameScene';
import { bus } from '../../core/events';
import { phaseCinematic } from '../../core/cinematics';
import { playMusic, stopMusic } from '../../systems/music';
import { sfx } from '../../systems/sfx';
import { addLight } from '../../core/Fx';
import { raysTexture } from '../../ui/Panel';
import { solidZone, movePlatform, type Solid } from './erratumProps';
import {
  pickColossusMove, slamTargets, debrisLayout, plateLayout, shrugSide, beamSweep, resumeState, fallProgress,
  COLOSSUS_NAMES, type ColossusMove, type Ledge,
} from '../../combat/colossusPlan';

/** floor top of w4-7 (row 17) */
const FLOOR = 272;
const THRESHOLDS = [0.66, 0.33];
/** hand sprite (origin bottom-centre): resting bottom, slumped (punish) bottom, hidden bottom */
const HAND_REST = FLOOR + 16;
const HAND_SLUMP = FLOOR + 44;
const HAND_HIDDEN = FLOOR + 140;
/** palm eye relative to the hand's bottom-centre */
const PALM_EYE = -59;
/** face sprite (origin top-centre): resting top y, and the eye relative to it */
const FACE_Y = 24;
const FACE_EYE = 87;
/** P3 core, half sunk into the split in its back */
const CORE_Y = FLOOR - 8;
const RUNE = 0x7fdbff;
const EYE_GOLD = 0xffd96a;

type Form = 1 | 2 | 3;

/** Exponential approach of `v` to `to` with time constant `tau` ms (frame-rate independent). */
const ease = (v: number, to: number, dt: number, tau: number) => v + (to - v) * (1 - Math.exp(-dt / tau));
type EyeState = 'open' | 'shut' | 'glare' | 'dark';

interface Ledgeful {
  z: Solid;
  img: Phaser.GameObjects.Image;
  base: Ledge;
  broken: boolean;
}

/**
 * World 4-7: ORRATH, THE BURIED COLOSSUS. A mountain that wakes up. Each phase change is a skippable
 * cinematic (core/cinematics.ts phaseCinematic) that reveals more of it; the boss sprite is always the
 * current weak point (palm eye -> brow eye -> core) and the rest is set dressing that attacks.
 *  P1 The Hand: Fist Slam x3 (shadows; the third leaves the palm slumped open = punish), Sweep (jump it),
 *     Pebble Flick (parryable lobs), Fist Quake (shockwaves + rock rain).
 *  T1 "The Mountain Wakes": the hand sinks, the camera pulls back, a head rises behind the range, its eye
 *     opens and the real name card plays; debris ledges rise out of the floor.
 *  P2 The Face: Eye Beam (sweeping, dash through it), Exhale (wind + rock spray), Hand Return (smashes a
 *     ledge), Headbutt (the head bows low afterwards = punish).
 *  T2 "The Fall": silence and a heartbeat, the ground gives way, slow-mo leap onto its back, white-out.
 *  P3 The Core: on its back as it falls (the ground rises with its HP). Plate Shrug (get on a plate),
 *     Swat (stay off the plates), Debris Rain, Core Pulse (parry it back). The core only opens to attack.
 * Retry from The Face / The Fall resumes at p2 / p3 (gs.bossStage). Rolls live in combat/colossusPlan.ts.
 */
export class Colossus extends Boss {
  /** the form on screen (the phase can be ahead of it while a cinematic is queued) */
  private form: Form = 1;
  private eye: EyeState = 'open';
  private coreOpen = false;
  private history: ColossusMove[] = [];
  /** bumped by abort(): pending steps of an interrupted attack are dropped */
  private seq = 0;
  private queue: number[] = [];
  private cine = false;
  private p2Built = false;
  private p3Built = false;
  private hand!: Phaser.GameObjects.Sprite;
  private swipe!: Phaser.GameObjects.Image;
  private face?: Phaser.GameObjects.Sprite;
  private faceLight?: Phaser.GameObjects.Image;
  private ledges: Ledgeful[] = [];
  private plates: Ledgeful[] = [];
  /** short-lived visuals of the current attack */
  private temp: Phaser.GameObjects.GameObject[] = [];
  /** cinematic beat visuals (dropped on skip) */
  private cineFx: Phaser.GameObjects.GameObject[] = [];
  private boxes: Hitbox[] = [];
  /** counter tweens of the current attack (stopped by abort()) */
  private counters: Phaser.Tweens.Tween[] = [];
  private windUntil = 0;
  private bob = 0;
  /** P3 backdrop */
  private land?: Phaser.GameObjects.Image;
  private streaks: Phaser.GameObjects.Rectangle[] = [];
  private streakSpeed = 1;
  private landY = 270;

  constructor(gs: GameScene, x: number, y: number) {
    const st = resumeState(gs.bossStage, THRESHOLDS);
    const form = (st?.phase ?? 1) as Form;
    const mid = gs.worldWidth / 2;
    const at = form === 1 ? { x, y: HAND_REST + PALM_EYE } : form === 2 ? { x: mid, y: FACE_Y + FACE_EYE } : { x: mid, y: CORE_Y };
    const tex = form === 1 ? 'colossus-eye' : form === 2 ? 'colossus-bigeye' : 'colossus-core';
    super(gs, at.x, at.y, tex, COLOSSUS_NAMES[form - 1], { hp: 190, bodyW: 18, bodyH: 12, gravity: false, contactDamage: 0, shards: 110 });
    void y;
    this.thresholds = THRESHOLDS;
    this.deathTint = RUNE;
    this.hearts = { periodicMs: 24000, maxOnField: 1, perParries: 4, onPhase: 1 };
    this.setDepth(16);

    this.hand = gs.add.sprite(x, HAND_HIDDEN, 'colossus-hand', 0).setOrigin(0.5, 1).setDepth(9);
    this.swipe = gs.add.image(-200, FLOOR - 17, 'colossus-swipe').setDepth(9).setVisible(false);

    if (st) {
      // "Retry from The Face / The Fall": start in that form, at that phase's HP
      this.phase = st.phase;
      this.hp = Math.floor(this.maxHp * st.hpFrac);
      if (form >= 2) this.commitP2();
      if (form === 3) this.commitP3();
      bus.emit('boss', this.bossName, this.hp, this.maxHp);
    } else {
      // the hand claws up out of the valley floor while the intro camera looks at it
      gs.tweens.add({ targets: this.hand, y: HAND_REST, duration: 1500, ease: 'Back.out' });
      gs.time.delayedCall(500, () => this.dust(x, 10, 1.2));
    }
    this.sync();
    gs.events.on(Phaser.Scenes.Events.UPDATE, this.updateWorld, this);
    gs.events.once(Phaser.Scenes.Events.SHUTDOWN, () => gs.events.off(Phaser.Scenes.Events.UPDATE, this.updateWorld, this));
  }

  // ------------------------------------------------------------------ geometry
  private get mid(): number {
    return this.gs.worldWidth / 2;
  }
  private get L(): number {
    return 24;
  }
  private get R(): number {
    return this.gs.worldWidth - 24;
  }

  /** The weak point follows whatever it is part of (clamped above the kill plane). */
  private sync(): void {
    let x = this.x, y = this.y;
    if (this.form === 1) {
      x = this.hand.x;
      y = this.hand.y + PALM_EYE;
    } else if (this.form === 2 && this.face) {
      x = this.face.x;
      y = this.face.y + FACE_EYE;
    } else if (this.form === 3) {
      x = this.mid;
      y = CORE_Y;
    }
    this.setPosition(x, Math.min(y, this.gs.worldHeight + 30));
    this.faceLight?.setPosition(this.face?.x ?? x, (this.face?.y ?? 0) + FACE_EYE);
  }

  tick(time: number, dt: number): void {
    this.sync();
    super.tick(time, dt);
    this.sync();
  }

  hurtRect(): Rect {
    const hidden = !this.visible || (this.form === 1 && this.hand.y > FLOOR + 60);
    if (hidden) return { x: -9999, y: -9999, w: 0, h: 0 };
    const [w, h] = this.form === 1 ? [24, 18] : this.form === 2 ? [36, 24] : [30, 24];
    return { x: this.x - w / 2, y: this.y - h / 2, w, h };
  }

  protected filterHit(_hit: HitInfo): 'hit' | 'blocked' {
    if (this.form === 3) return this.coreOpen ? 'hit' : 'blocked';
    return this.eye === 'shut' || this.eye === 'dark' ? 'blocked' : 'hit';
  }

  protected animKey(): string {
    if (this.form === 3) return this.coreOpen ? 'colossus-core-open' : 'colossus-core-shut';
    const sheet = this.form === 1 ? 'colossus-eye' : 'colossus-bigeye';
    const st = this.form === 1 && this.eye === 'dark' ? 'shut' : this.eye;
    return `${sheet}-${this.stunned ? 'glare' : st}`;
  }

  // ------------------------------------------------------------------ sequencing helpers
  private step(ms: number, fn: () => void): void {
    const s = this.seq;
    this.later(ms, () => {
      if (s === this.seq && !this.transforming) fn();
    });
  }

  private finish(cd: number, delay = 0): void {
    this.step(delay, () => {
      this.busy = false;
      this.cooldown = cd;
    });
  }

  private begin(m: ColossusMove): void {
    this.busy = true;
    this.history.push(m);
    if (this.history.length > 4) this.history.shift();
  }

  private keep<O extends Phaser.GameObjects.GameObject>(o: O): O {
    this.temp = this.temp.filter((t) => t.active);
    this.temp.push(o);
    return o;
  }

  private dropCineFx(): void {
    for (const o of this.cineFx) if (o.active) {
      this.gs.tweens.killTweensOf(o);
      o.destroy();
    }
    this.cineFx = [];
  }

  private keepCine<O extends Phaser.GameObjects.GameObject>(o: O): O {
    this.cineFx = this.cineFx.filter((t) => t.active);
    this.cineFx.push(o);
    return o;
  }

  /** Red (can't parry) or white (parryable) damage box; `rect` is re-read every frame. */
  private hurtBox(rect: () => Rect, ms: number, parryable = false, damage = 1): Hitbox {
    const box = new Hitbox(
      'enemy',
      rect,
      (t) => {
        const r = rect();
        const tr = t.hurtRect();
        return { damage, kbX: (tr.x + tr.w / 2 >= r.x + r.w / 2 ? 1 : -1) * 170, kbY: -220, sourceX: r.x + r.w / 2, parryable, kind: 'melee' };
      },
      ms,
    ).ownedBy(this);
    this.boxes = this.boxes.filter((b) => !b.dead);
    this.boxes.push(this.gs.damage.add(box));
    return box;
  }

  private rock(x: number, y: number, vx: number, vy: number, gravity = 600, tint?: number): Projectile {
    const p = this.gs.spawnProjectile(x, y, 'colossus-rock', vx, vy, 'enemy', { damage: 1, gravity, lifeMs: 3200, rotate: true, owner: this });
    if (tint) p.setTint(tint);
    return p;
  }

  /** A rock lobbed from (x, y) to land at tx after `t` seconds. */
  private lob(x: number, y: number, tx: number, t: number, g = 700): Projectile {
    const vx = (tx - x) / t;
    const vy = (FLOOR - 6 - y - 0.5 * g * t * t) / t;
    return this.rock(x, y, vx, vy, g);
  }

  private dust(x: number, n = 6, speed = 0.8): void {
    for (let i = 0; i < n; i++) this.gs.juice.dust(x + (Math.random() - 0.5) * 50, FLOOR - 2, 2, speed, 0, 0xb7a6c8);
  }

  /** Floor shadow that grows in before something lands at x. */
  private shadow(x: number, w: number, ms: number, red = true): void {
    const s = this.keep(this.gs.add.ellipse(x, FLOOR - 1, w * 0.4, 4, red ? 0xff1a1a : 0x000000, 0.25).setDepth(12));
    this.gs.tweens.add({ targets: s, width: w, alpha: 0.65, duration: ms, ease: 'Quad.in', onComplete: () => s.destroy() });
  }

  /** Floor shockwaves rolling out from x. */
  private waves(x: number, speed = 170): void {
    for (const d of [-1, 1]) {
      const p = this.gs.spawnProjectile(x + d * 22, FLOOR - 5, 'shockwave', d * speed, 0, 'enemy', { damage: 1, lifeMs: 2600, owner: this });
      p.body.setAllowGravity(false);
    }
  }

  /** Rocks dropping from the top of the view near the player, each with a floor shadow first. */
  private rockRain(count: number, spread = 260, gap = 140): void {
    const cam = this.gs.cameras.main;
    for (let i = 0; i < count; i++) {
      this.step(i * gap, () => {
        const v = cam.worldView;
        const x = Phaser.Math.Clamp(this.player.x + (Math.random() - 0.5) * spread, v.x + 16, v.right - 16);
        this.shadow(x, 16, 520, false);
        this.step(520, () => this.rock(x, v.y - 8, 0, 120, 700));
      });
    }
  }

  private setEye(s: EyeState): void {
    this.eye = s;
    if (this.faceLight) this.faceLight.setAlpha(s === 'glare' ? 0.7 : s === 'open' ? 0.35 : 0);
  }

  // ------------------------------------------------------------------ world update (runs past death)
  private updateWorld(_t: number, delta: number): void {
    const dt = Math.min(delta, 50);
    this.bob += dt;
    if (this.p3Built) this.updateFall(dt);
    // P2 debris ledges bob gently
    for (const l of this.ledges) {
      if (l.broken || !l.z.active) continue;
      const ny = l.base.y + 6 + Math.sin(this.bob / 700 + l.base.x) * 2;
      movePlatform(this.gs, l.z, l.base.x, ny);
      l.img.setPosition(l.base.x, ny - 6);
    }
    // Exhale wind: pushes the player away from the mouth
    const p = this.gs.player;
    if (this.alive && this.gs.time.now < this.windUntil && p.alive && !p.fsm.is('dash')) {
      const dir = p.x >= this.mid ? 1 : -1;
      p.x = Phaser.Math.Clamp(p.x + dir * 70 * (dt / 1000), this.L, this.R);
    }
  }

  private updateFall(dt: number): void {
    const cam = this.gs.cameras.main;
    for (const s of this.streaks) {
      s.y -= (s.getData('v') as number) * this.streakSpeed * (dt / 1000);
      if (s.y < -40) {
        s.y = cam.height + 20 + Math.random() * 60;
        s.x = Math.random() * cam.width;
      }
    }
    if (this.alive) {
      const target = 270 - fallProgress(this.hp / this.maxHp, THRESHOLDS[1]) * 110;
      this.landY += (target - this.landY) * Math.min(1, dt / 600);
    }
    this.land?.setY(Math.round(this.landY));
    // armor plates shudder in the slipstream
    for (const pl of this.plates) {
      if (!pl.z.active) continue;
      const ny = pl.base.y + 6 + Math.sin(this.bob / 260 + pl.base.x) * 1.5;
      movePlatform(this.gs, pl.z, pl.base.x, ny);
      pl.img.setPosition(pl.base.x, ny - 6);
    }
  }

  // ------------------------------------------------------------------ AI
  protected think(dt: number): void {
    if (this.cine || this.busy || !this.player.alive) return;
    const px = this.player.x;
    if (this.form === 1) {
      // the hand drifts under the player (never fully on top of them)
      const tx = Phaser.Math.Clamp(px + (px < this.mid ? 70 : -70), this.L + 50, this.R - 50);
      this.hand.x += Phaser.Math.Clamp(tx - this.hand.x, -1, 1) * 30 * (dt / 1000);
      this.hand.y = ease(this.hand.y, HAND_REST + Math.sin(this.bob / 500) * 2, dt, 180);
    } else if (this.form === 2 && this.face) {
      this.face.y = ease(this.face.y, FACE_Y + Math.sin(this.bob / 900) * 2, dt, 260);
    }
    this.cooldown -= dt;
    if (this.cooldown > 0) return;
    const dx = Math.abs(px - this.x);
    const high = this.player.y < FLOOR - 40;
    this.run(pickColossusMove(this.form, dx, high, this.history));
  }

  private run(m: ColossusMove): void {
    this.begin(m);
    switch (m) {
      case 'slam': return this.slam();
      case 'sweep': return this.sweep(false);
      case 'flick': return this.flick();
      case 'quake': return this.quake();
      case 'beam': return this.beam();
      case 'exhale': return this.exhale();
      case 'hand': return this.handReturn();
      case 'headbutt': return this.headbutt();
      case 'shrug': return this.shrug();
      case 'debris': return this.debris();
      case 'pulse': return this.pulse();
      case 'swat': return this.sweep(true);
    }
  }

  // ------------------------------------------------------------------ P1: the hand
  /** Fist Slam x3: rises out of view, three shadowed slams, the last one leaves the palm open on the floor. */
  private slam(): void {
    const gs = this.gs;
    this.setEye('shut');
    this.hand.setFrame(1);
    sfx.telegraph();
    gs.tweens.add({ targets: this.hand, y: -30, duration: 600, ease: 'Back.in' });
    const xs = slamTargets(this.player.x, this.L + 40, this.R - 40, Math.random);
    xs.forEach((x, i) => this.step(650 + i * 720, () => this.fist(x, i === xs.length - 1)));
  }

  private fist(x: number, last: boolean): void {
    const gs = this.gs;
    this.hand.setPosition(x, -30);
    this.shadow(x, 56, 440);
    this.step(440, () => {
      gs.tweens.add({
        targets: this.hand, y: HAND_SLUMP, duration: 150, ease: 'Quad.in',
        onComplete: () => {
          if (!this.alive) return;
          gs.juice.impact('slam', x, FLOOR);
          sfx.rockCrumble();
          this.dust(x, 8, 1.1);
        },
      });
      const h = this.hand;
      this.hurtBox(() => ({ x: h.x - 26, y: h.y - 90, w: 52, h: 84 }), 280);
      if (!last) {
        this.step(420, () => gs.tweens.add({ targets: this.hand, y: -30, duration: 240, ease: 'Quad.in' }));
        return;
      }
      // the last fist uncurls on the floor: the eye is right there
      this.step(360, () => {
        this.hand.setFrame(0);
        this.setEye('open');
        this.recover(1700, 'slump', 700);
      });
    });
  }

  /**
   * Sweep (P1, floor height: jump it) / Swat (P3, plate height: stay on the floor). The flat hand bursts
   * in from one wall and crosses the arena. Red: can't be parried.
   */
  private sweep(high: boolean): void {
    const gs = this.gs;
    const fromRight = this.player.x < this.mid;
    const dir = fromRight ? -1 : 1;
    const y = high ? 205 : FLOOR - 17;
    const startX = fromRight ? this.R + 90 : this.L - 90;
    if (!high) {
      this.setEye('shut');
      gs.tweens.add({ targets: this.hand, y: HAND_HIDDEN, duration: 380, ease: 'Quad.in' });
      this.dust(this.hand.x, 6);
    } else this.coreOpen = false;
    // warning: red glow along the swept band + a flash at the entry wall
    const band = this.keep(gs.add.rectangle(this.mid, y, this.R - this.L, high ? 40 : 28, 0xff1a1a, 0.12).setDepth(12));
    gs.tweens.add({ targets: band, alpha: 0.32, yoyo: true, repeat: 3, duration: 110 });
    const edge = this.keep(gs.add.rectangle(fromRight ? this.R : this.L, y, 6, 40, 0xff1a1a, 0.8).setDepth(40));
    gs.tweens.add({ targets: edge, alpha: 0.2, yoyo: true, repeat: 4, duration: 90 });
    gs.juice.rumble(0.3, 0.5, 600);
    sfx.telegraph();
    this.step(high ? 820 : 760, () => {
      band.destroy();
      edge.destroy();
      sfx.windRush();
      this.swipe.setPosition(startX, y).setFlipX(dir < 0).setVisible(true);
      gs.tweens.add({ targets: this.swipe, x: fromRight ? this.L - 90 : this.R + 90, duration: high ? 820 : 900, ease: 'Sine.inOut' });
      const s = this.swipe;
      this.hurtBox(() => ({ x: s.x - 58, y: high ? y - 22 : FLOOR - 28, w: 116, h: high ? 40 : 28 }), high ? 840 : 920);
      gs.juice.shake(0.006, 500);
      this.step(high ? 860 : 940, () => {
        this.swipe.setVisible(false);
        if (high) {
          this.openCore(1500);
          this.finish(600, 1500);
          return;
        }
        // the hand comes back up where the player isn't
        this.hand.x = Phaser.Math.Clamp(this.player.x < this.mid ? this.player.x + 140 : this.player.x - 140, this.L + 50, this.R - 50);
        this.dust(this.hand.x, 6);
        gs.tweens.add({ targets: this.hand, y: HAND_REST, duration: 450, ease: 'Back.out' });
        this.hand.setFrame(0);
        this.step(300, () => this.setEye('open'));
        this.finish(700, 500);
      });
    });
  }

  /** Pebble Flick: three parryable lobs from the fingertips (parry one back into the eye). */
  private flick(): void {
    const gs = this.gs;
    this.telegraph(520, 0xffffff);
    gs.tweens.add({ targets: this.hand, angle: -12, duration: 480, ease: 'Sine.out' });
    this.step(520, () => {
      gs.tweens.add({ targets: this.hand, angle: 0, duration: 140, ease: 'Back.out' });
      [-28, 0, 28].forEach((off, i) =>
        this.step(i * 180, () => {
          sfx.shoot();
          this.lob(this.hand.x, this.hand.y - 118, Phaser.Math.Clamp(this.player.x + off, this.L, this.R), 0.85);
        }),
      );
      this.finish(1000, 700);
    });
  }

  /** Fist Quake: lifts, slams in place: floor shockwaves and loose rocks from the cliffs. */
  private quake(): void {
    const gs = this.gs;
    this.setEye('shut');
    this.hand.setFrame(1);
    this.telegraph(700, 0xffffff, true);
    gs.tweens.add({ targets: this.hand, y: HAND_REST - 56, duration: 650, ease: 'Quad.out' });
    this.step(720, () => {
      gs.tweens.add({ targets: this.hand, y: HAND_SLUMP - 10, duration: 120, ease: 'Quad.in' });
      this.step(120, () => {
        gs.juice.impact('slam', this.hand.x, FLOOR);
        sfx.rockCrumble();
        this.dust(this.hand.x, 10, 1.3);
        this.waves(this.hand.x);
        this.rockRain(4);
      });
      this.step(800, () => {
        this.hand.setFrame(0);
        this.setEye('open');
        gs.tweens.add({ targets: this.hand, y: HAND_REST, duration: 400, ease: 'Sine.out' });
        this.recover(900, 'quake', 700);
      });
    });
  }

  // ------------------------------------------------------------------ P2: the face
  /** Eye Beam: charges (gold), then a red beam sweeps across the floor through the player. Dash through it. */
  private beam(): void {
    const gs = this.gs;
    this.setEye('glare');
    const ex = this.x, ey = this.y;
    const { from, to } = beamSweep(this.player.x, ex, this.L + 8, this.R - 8);
    const glow = this.keep(addLight(gs, ex, ey, EYE_GOLD, 40, 0.2).setDepth(17));
    gs.tweens.add({ targets: glow, alpha: 0.9, scale: 1.6, duration: 900 });
    sfx.charge();
    gs.juice.ring(ex, ey, 0xff1a1a, 1.2);
    const aim = this.keep(gs.add.line(0, 0, ex, ey, from, FLOOR, 0xff1a1a, 0.35).setOrigin(0, 0).setLineWidth(1).setDepth(17));
    this.step(900, () => {
      aim.destroy();
      const ray = this.keep(gs.add.line(0, 0, ex, ey, from, FLOOR, 0xfff0b0, 1).setOrigin(0, 0).setLineWidth(5).setDepth(17).setBlendMode(Phaser.BlendModes.ADD));
      const core = this.keep(gs.add.line(0, 0, ex, ey, from, FLOOR, 0xffffff, 1).setOrigin(0, 0).setLineWidth(2).setDepth(17));
      const state = { ix: from };
      sfx.windRush();
      gs.juice.shake(0.004, 1300);
      let lastDust = 0;
      this.counters.push(gs.tweens.add({
        targets: state, ix: to, duration: 1300, ease: 'Sine.inOut',
        onUpdate: () => {
          if (!ray.active || !core.active) return;
          ray.setTo(this.x, this.y, state.ix, FLOOR);
          core.setTo(this.x, this.y, state.ix, FLOOR);
          if (gs.time.now - lastDust > 60) {
            lastDust = gs.time.now;
            gs.juice.dust(state.ix, FLOOR - 2, 2, 0.6, 0, 0xffd96a);
          }
        },
      }));
      // the box sits on the beam where it's closest to the player, so any part of the beam can hit
      this.hurtBox(() => {
        const ax = this.x, ay = this.y, bx = state.ix, by = FLOOR;
        const pr = this.player.hurtRect();
        const px = pr.x + pr.w / 2, py = pr.y + pr.h / 2;
        const vx = bx - ax, vy = by - ay;
        const t = Phaser.Math.Clamp(((px - ax) * vx + (py - ay) * vy) / (vx * vx + vy * vy || 1), 0.25, 1);
        return { x: ax + vx * t - 7, y: ay + vy * t - 7, w: 14, h: 14 };
      }, 1300);
      this.step(1350, () => {
        ray.destroy();
        core.destroy();
        glow.destroy();
        this.setEye('open');
        this.finish(800, 300);
      });
    });
  }

  /** Exhale: the mouth opens, wind shoves you to the walls while rocks spray out in fans (parryable). */
  private exhale(): void {
    const gs = this.gs;
    if (!this.face) return this.finish(300);
    this.face.setFrame(1);
    this.telegraph(600, 0xffffff);
    sfx.windRush();
    this.step(600, () => {
      this.windUntil = gs.time.now + 1900;
      const mx = this.face!.x, my = this.face!.y + 154;
      for (let i = 0; i < 16; i++) {
        this.step(i * 110, () => {
          const s = this.keep(gs.add.rectangle(mx, my + (Math.random() - 0.5) * 40, 14, 1, 0xc9f2ff, 0.7).setDepth(17));
          gs.tweens.add({ targets: s, x: mx + (i % 2 ? -1 : 1) * 260, alpha: 0, duration: 500, onComplete: () => s.destroy() });
        });
      }
      [0, 600, 1200].forEach((at, k) =>
        this.step(at, () => {
          for (let j = -1; j <= 1; j++) {
            const side = this.player.x >= mx ? 1 : -1;
            const a = Math.atan2(FLOOR - my, (this.player.x - mx) || side) + j * 0.28 + (k - 1) * 0.08;
            this.rock(mx, my, Math.cos(a) * 170, Math.sin(a) * 170, 260);
          }
        }),
      );
      this.step(1950, () => {
        this.face?.setFrame(0);
        this.finish(900);
      });
    });
  }

  /** Hand Return: the P1 fist comes down from the sky on the player's column, smashing any ledge under it. */
  private handReturn(): void {
    const gs = this.gs;
    const x = Phaser.Math.Clamp(this.player.x, this.L + 30, this.R - 30);
    const col = this.keep(gs.add.rectangle(x, FLOOR / 2, 52, FLOOR, 0xff1a1a, 0.08).setDepth(12));
    gs.tweens.add({ targets: col, alpha: 0.22, yoyo: true, repeat: 3, duration: 100 });
    this.shadow(x, 56, 800);
    sfx.telegraph();
    this.hand.setFrame(1).setPosition(x, -30).setAngle(0);
    this.step(800, () => {
      col.destroy();
      const h = this.hand;
      gs.tweens.add({
        targets: h, y: HAND_SLUMP, duration: 170, ease: 'Quad.in',
        onComplete: () => {
          if (!this.alive) return;
          gs.juice.impact('slam', x, FLOOR);
          sfx.rockCrumble();
          this.dust(x, 8, 1.1);
          this.waves(x, 150);
        },
      });
      this.hurtBox(() => ({ x: h.x - 26, y: h.y - 90, w: 52, h: 84 }), 300);
      for (const l of this.ledges) if (!l.broken && Math.abs(l.base.x - x) < l.base.w / 2 + 26) this.step(80, () => this.breakLedge(l));
      this.step(900, () => gs.tweens.add({ targets: this.hand, y: HAND_HIDDEN, duration: 600, ease: 'Quad.in' }));
      this.finish(900, 700);
    });
  }

  /** Headbutt: rears back (red), slams its brow into the middle of the arena, then bows low = punish. */
  private headbutt(): void {
    const gs = this.gs;
    const face = this.face;
    if (!face) return this.finish(300);
    this.setEye('glare');
    this.telegraph(800, 0xffffff, true);
    gs.tweens.add({ targets: face, y: FACE_Y - 16, duration: 760, ease: 'Sine.out' });
    const zone = this.keep(gs.add.rectangle(this.mid, FLOOR - 60, 180, 120, 0xff1a1a, 0.1).setDepth(12));
    gs.tweens.add({ targets: zone, alpha: 0.28, yoyo: true, repeat: 3, duration: 100 });
    this.step(820, () => {
      zone.destroy();
      gs.tweens.add({ targets: face, y: FACE_Y + 96, duration: 180, ease: 'Quad.in' });
      this.hurtBox(() => ({ x: this.mid - 90, y: face.y + 60, w: 180, h: FLOOR - face.y - 60 }), 300);
      this.step(180, () => {
        gs.juice.impact('slam', this.mid, FLOOR, 0, 1.6);
        sfx.rockCrumble();
        sfx.bossRoar();
        for (const d of [-80, -30, 30, 80]) this.dust(this.mid + d, 6, 1.4);
        this.waves(this.mid - 70, 160);
        this.waves(this.mid + 70, 160);
        for (const l of this.ledges) if (!l.broken && Math.abs(l.base.x - this.mid) < 90) this.breakLedge(l);
        this.setEye('open');
        this.recover(2000, 'bow', 700);
      });
    });
  }

  // ------------------------------------------------------------------ P3: the core
  private openCore(ms: number): void {
    this.coreOpen = true;
    this.gs.juice.ring(this.x, this.y, RUNE, 1.2);
    this.step(ms, () => (this.coreOpen = false));
  }

  /** Plate Shrug: the half of its back you stand on heaves up (red). Get onto a plate. Core opens after. */
  private shrug(): void {
    const gs = this.gs;
    const side = shrugSide(this.player.x, this.mid);
    const x0 = side < 0 ? this.L : this.mid + 28;
    const x1 = side < 0 ? this.mid - 28 : this.R;
    const warn = this.keep(gs.add.rectangle((x0 + x1) / 2, FLOOR - 6, x1 - x0, 12, 0xff1a1a, 0.15).setDepth(12));
    gs.tweens.add({ targets: warn, alpha: 0.45, yoyo: true, repeat: 4, duration: 90 });
    for (const pl of this.plates) if ((pl.base.x < this.mid) === side < 0) pl.img.setTint(0xffe0a0);
    this.telegraph(850, 0xffffff, true);
    gs.juice.rumble(0.3, 0.6, 800);
    this.step(880, () => {
      warn.destroy();
      for (const pl of this.plates) pl.img.clearTint();
      this.hurtBox(() => ({ x: x0, y: FLOOR - 36, w: x1 - x0, h: 36 }), 280);
      gs.juice.shake(0.012, 400);
      sfx.rockCrumble();
      for (let x = x0 + 12; x < x1; x += 28) {
        gs.juice.dust(x, FLOOR - 2, 3, 1.4, 0, 0xb7a6c8);
        const shard = this.keep(gs.add.image(x, FLOOR, 'colossus-rock').setDepth(17));
        gs.tweens.add({ targets: shard, y: FLOOR - 30 - Math.random() * 20, angle: 180, alpha: 0, duration: 380, ease: 'Quad.out', onComplete: () => shard.destroy() });
      }
      this.step(300, () => {
        this.openCore(1700);
        this.recover(1700, 'open', 600);
      });
    });
  }

  /** Debris Rain: three waves of rocks fall past it (shadows first); the core cracks open meanwhile. */
  private debris(): void {
    this.openCore(2600);
    this.rockRain(4, 300, 120);
    this.step(900, () => this.rockRain(4, 300, 120));
    this.step(1800, () => this.rockRain(3, 200, 120));
    this.finish(900, 2600);
  }

  /** Core Pulse: two rings of rune shots across the upper half (parry them back into the core). */
  private pulse(): void {
    const gs = this.gs;
    this.coreOpen = true;
    this.telegraph(600, 0xffffff);
    const glow = this.keep(addLight(gs, this.x, this.y, RUNE, 40, 0.2).setDepth(17));
    gs.tweens.add({ targets: glow, alpha: 0.8, scale: 1.5, duration: 600 });
    [0, 650].forEach((at, wave) =>
      this.step(600 + at, () => {
        sfx.shoot();
        gs.juice.ring(this.x, this.y, RUNE, 1.4);
        const n = 7;
        for (let i = 0; i < n; i++) {
          const a = Math.PI + ((i + 0.5 + (wave ? 0.5 : 0)) / (n + 1)) * Math.PI;
          const p = gs.spawnProjectile(this.x, this.y - 6, 'orb', Math.cos(a) * 130, Math.sin(a) * 130, 'enemy', { damage: 1, lifeMs: 2800, owner: this });
          p.setTint(RUNE);
        }
      }),
    );
    this.step(1500, () => glow.destroy());
    this.step(2300, () => (this.coreOpen = false));
    this.finish(700, 2300);
  }

  // ------------------------------------------------------------------ ledges / plates
  private makeLedge(l: Ledge, tex: string, riseFrom?: number): Ledgeful {
    const z = solidZone(this.gs, l.x, l.y + 6, l.w, 12);
    const img = this.gs.add.image(l.x, l.y, tex).setDepth(12);
    const out: Ledgeful = { z, img, base: l, broken: false };
    if (riseFrom !== undefined) {
      const st = { y: riseFrom };
      img.setY(riseFrom);
      this.gs.tweens.add({ targets: st, y: l.y, duration: 900, ease: 'Back.out', onUpdate: () => img.setY(st.y) });
    }
    return out;
  }

  private breakLedge(l: Ledgeful): void {
    if (l.broken) return;
    l.broken = true;
    const gs = this.gs;
    gs.juice.burst(l.img.x, l.img.y, 0x8b8ba8, 12, 1.1);
    sfx.rockCrumble();
    l.z.body.enable = false;
    l.img.setVisible(false);
    // rises again out of the floor
    gs.time.delayedCall(5000, () => {
      if (!l.z.active || this.form !== 2) return;
      l.broken = false;
      l.z.body.enable = true;
      l.img.setVisible(true).setY(FLOOR + 20);
      gs.tweens.add({ targets: l.img, y: l.base.y, duration: 700, ease: 'Back.out' });
    });
  }

  // ------------------------------------------------------------------ interrupts
  /** Drop the running attack: pending steps, its hitboxes and visuals; props back to a neutral pose. */
  private abort(): void {
    this.seq++;
    this.windUntil = 0;
    this.cancelRecover();
    this.stunUntil = 0;
    for (const b of this.boxes) b.kill();
    this.boxes = [];
    for (const o of this.temp) if (o.active) {
      this.gs.tweens.killTweensOf(o);
      o.destroy();
    }
    this.temp = [];
    for (const t of this.counters) t.stop();
    this.counters = [];
    if (this.face) this.gs.tweens.killTweensOf(this.face);
    this.gs.tweens.killTweensOf(this.hand);
    this.gs.tweens.killTweensOf(this.swipe);
    this.hand.setAngle(0);
    this.swipe.setVisible(false);
    for (const pl of this.plates) pl.img.clearTint();
  }

  /** Immune + busy for a cinematic; clears enemy shots and hitboxes, drops the phase hearts. */
  private freeze(): void {
    const gs = this.gs;
    this.transforming = true;
    this.busy = true;
    for (const p of [...gs.projectiles.getChildren()] as Projectile[]) {
      if (p.team !== 'enemy' || p.dead) continue;
      p.dead = true;
      p.hitbox.kill();
      gs.juice.burst(p.x, p.y, 0xffffff, 4, 0.5);
      p.destroy();
    }
    for (const hb of gs.damage.hitboxes) if (hb.team === 'enemy') hb.kill();
    const p = gs.player;
    for (let i = 0; i < this.hearts.onPhase; i++) gs.spawnHeart(Phaser.Math.Clamp(p.x + (p.x < this.mid ? 40 : -40), this.L, this.R), FLOOR - 40, 'pop');
  }

  protected onPhase(n: number): void {
    this.queue.push(n);
    if (!this.cine) this.nextCine();
  }

  private nextCine(): void {
    const n = this.queue.shift();
    if (n === undefined) return;
    this.cine = true;
    this.abort();
    this.freeze();
    if (n === 2) this.cineWake();
    else this.cineFall();
  }

  private cineDone(): void {
    this.cine = false;
    if (this.queue.length) return this.nextCine();
    this.transforming = false;
    this.busy = false;
    this.cooldown = 900;
  }

  // ------------------------------------------------------------------ T1: THE MOUNTAIN WAKES
  private ensureFace(): Phaser.GameObjects.Sprite {
    if (!this.face) {
      this.face = this.gs.add.sprite(this.mid, this.gs.worldHeight + 10, 'colossus-face', 0).setOrigin(0.5, 0).setDepth(-20).setTint(0xb4b4cc);
      this.faceLight = addLight(this.gs, this.mid, 0, EYE_GOLD, 46, 0).setDepth(-19);
    }
    return this.face;
  }

  /** P2 arena, idempotent: the head risen behind the range, eye awake, three debris ledges. */
  private commitP2(): void {
    if (this.p2Built) return;
    this.p2Built = true;
    const gs = this.gs;
    const face = this.ensureFace();
    gs.tweens.killTweensOf(face);
    face.setPosition(this.mid, FACE_Y).setAngle(0).setFrame(0).setVisible(true);
    gs.tweens.killTweensOf(this.hand);
    this.hand.setPosition(this.mid, HAND_HIDDEN).setFrame(0).setAngle(0);
    this.form = 2;
    this.setTexture('colossus-bigeye');
    this.setVisible(true).setAlpha(1);
    this.setEye('open');
    this.bossName = COLOSSUS_NAMES[1];
    bus.emit('boss', this.bossName, this.hp, this.maxHp);
    gs.bossStage = 'p2';
    this.ledges = debrisLayout(this.mid).map((l) => this.makeLedge(l, 'colossus-slab', FLOOR + 30));
    this.sync();
  }

  private cineWake(): void {
    const gs = this.gs;
    const cam = gs.cameras.main;
    const beats: { at: number; run: () => void }[] = [];
    // the hand clenches and drags itself under
    beats.push({
      at: 0,
      run: () => {
        stopMusic();
        this.setEye('shut');
        this.hand.setFrame(1);
        gs.tweens.add({ targets: this.hand, y: HAND_HIDDEN, duration: 900, ease: 'Quad.in' });
        sfx.titanRoar(0.5);
      },
    });
    // the valley shakes harder and harder
    for (let i = 0; i < 12; i++) {
      const k = i / 11;
      beats.push({
        at: 200 + i * 220,
        run: () => {
          gs.juice.shake(0.002 + k * 0.007, 240);
          gs.juice.rumble(0.2 + k * 0.4, 0.3 + k * 0.6, 200);
          this.dust(this.L + Math.random() * (this.R - this.L), 4, 0.6 + k);
          if (i % 2 === 0) sfx.rockCrumble();
          const v = cam.worldView;
          const peb = this.keepCine(gs.add.image(v.x + Math.random() * v.width, v.y - 6, 'colossus-rock').setDepth(17));
          gs.tweens.add({ targets: peb, y: FLOOR - 4, angle: 360, duration: 700, ease: 'Quad.in', onComplete: () => peb.destroy() });
        },
      });
    }
    // a head rises behind the range: the eye stays dark until it reaches the top
    beats.push({
      at: 900,
      run: () => {
        const face = this.ensureFace();
        face.setY(gs.worldHeight + 10);
        this.form = 2;
        this.setTexture('colossus-bigeye');
        this.setEye('dark');
        gs.tweens.add({ targets: face, y: FACE_Y, duration: 2300, ease: 'Sine.out' });
      },
    });
    // the eye opens
    beats.push({
      at: 3200,
      run: () => {
        this.setEye('glare');
        cam.flash(260, 255, 217, 106, true);
        sfx.titanRoar(1);
        gs.juice.shake(0.02, 900);
        gs.juice.rumble(0.8, 1, 700);
        gs.juice.ring(this.x, this.y, EYE_GOLD, 3);
        const rays = this.keepCine(gs.add.image(this.x, this.y, raysTexture(gs)).setTint(EYE_GOLD).setBlendMode(Phaser.BlendModes.ADD).setDepth(-19).setScale(0.2).setAlpha(0.9));
        gs.tweens.add({ targets: rays, scale: 2.6, angle: 60, alpha: 0, duration: 1400, ease: 'Quad.out', onComplete: () => rays.destroy() });
        this.face?.setFrame(1);
        gs.time.delayedCall(1100, () => this.face?.setFrame(0));
      },
    });
    beats.push({ at: 3700, run: () => bus.emit('boss-intro', COLOSSUS_NAMES[1]) });
    phaseCinematic(gs, {
      shot: { x: this.mid, y: 150, zoom: 0.85, ms: 1700 },
      muffle: false,
      beats,
      commitAt: 3500,
      commit: () => this.commitP2(),
      length: 5600,
      backMs: 700,
      cleanup: () => {
        this.dropCineFx();
        this.face?.setFrame(0);
      },
      done: () => {
        this.dropCineFx();
        if (!this.alive) return;
        playMusic('colossus');
        this.setEye('open');
        this.cineDone();
      },
    });
  }

  // ------------------------------------------------------------------ T2: THE FALL
  /** P3 arena, idempotent: on its back in open sky, armor plates, the core in the split of its spine. */
  private commitP3(): void {
    if (this.p3Built) return;
    this.p3Built = true;
    const gs = this.gs;
    const p = gs.player;
    // the player lands on its back (also undoes the cinematic leap if it was skipped mid-air)
    gs.tweens.killTweensOf(p);
    p.body.setAllowGravity(true);
    p.body.setVelocity(0, 0);
    p.setPosition(Phaser.Math.Clamp(p.x < this.mid ? this.mid - 150 : this.mid + 150, this.L + 20, this.R - 20), FLOOR - 16);
    // the cinematic's floor cracks belong to the old floor
    this.dropCineFx();
    // P2 props leave
    if (this.face) {
      gs.tweens.killTweensOf(this.face);
      this.face.setVisible(false);
    }
    this.faceLight?.setAlpha(0);
    for (const l of this.ledges) {
      l.z.destroy();
      l.img.destroy();
    }
    this.ledges = [];
    gs.tweens.killTweensOf(this.hand);
    this.hand.setPosition(this.mid, HAND_HIDDEN);
    // sky, ground far below, wind
    const cam = gs.cameras.main;
    // screen-fixed, scaled past the edges so the zoomed-out cinematic camera never sees around them
    gs.add.image(cam.width / 2, cam.height / 2, 'colossus-sky').setScrollFactor(0).setScale(1.3).setDepth(-30.5);
    this.landY = 270;
    this.land = gs.add.image(cam.width / 2, this.landY, 'colossus-land').setOrigin(0.5, 0).setScrollFactor(0).setScale(1.3, 1).setDepth(-30.4);
    for (let i = 0; i < 18; i++) {
      const s = gs.add.rectangle(Math.random() * cam.width, Math.random() * cam.height, 1, 10 + Math.random() * 18, 0xc9f2ff, 0.25 + Math.random() * 0.3).setScrollFactor(0).setDepth(-30.3);
      s.setData('v', 380 + Math.random() * 420);
      this.streaks.push(s);
    }
    gs.levelArt?.visual.setVisible(false);
    gs.levelArt?.deco.setVisible(false);
    gs.add.image(-1, FLOOR - 21, 'colossus-back').setOrigin(0, 0).setDepth(11.5);
    this.plates = plateLayout(this.mid).map((l) => this.makeLedge(l, 'colossus-plate'));
    // the core is the weak point now
    this.form = 3;
    this.coreOpen = false;
    this.setTexture('colossus-core');
    this.setVisible(true).setAlpha(1);
    this.bossName = COLOSSUS_NAMES[2];
    bus.emit('boss', this.bossName, this.hp, this.maxHp);
    gs.bossStage = 'p3';
    this.sync();
  }

  private cineFall(): void {
    const gs = this.gs;
    const cam = gs.cameras.main;
    const p = gs.player;
    const face = this.ensureFace();
    const beats: { at: number; run: () => void }[] = [];
    beats.push({
      at: 0,
      run: () => {
        stopMusic();
        this.setEye('glare');
        gs.tweens.add({ targets: face, y: FACE_Y + 40, angle: 4, duration: 2200, ease: 'Sine.in' });
      },
    });
    // silence and a heartbeat that speeds up
    [0, 520, 980, 1380, 1720, 2000].forEach((at, i) =>
      beats.push({
        at: 200 + at,
        run: () => {
          sfx.heartbeat(i / 5);
          gs.juice.shake(0.003 + i * 0.0015, 160);
          gs.juice.rumble(0.2 + i * 0.1, 0.3 + i * 0.12, 120);
          this.setTintFill(0xffffff);
          gs.time.delayedCall(70, () => this.active && this.restoreTint());
        },
      }),
    );
    // the floor splits
    for (let i = 0; i < 6; i++) {
      beats.push({
        at: 700 + i * 260,
        run: () => {
          const x = this.L + 40 + Math.random() * (this.R - this.L - 80);
          const crack = this.keepCine(gs.add.graphics().setDepth(12));
          crack.lineStyle(2, 0x0b0714, 1);
          crack.beginPath();
          crack.moveTo(x, FLOOR);
          let cx = x;
          for (let k = 1; k <= 4; k++) crack.lineTo((cx += (Math.random() - 0.5) * 16), FLOOR + k * 6);
          crack.strokePath();
          crack.lineStyle(1, RUNE, 0.8);
          crack.lineBetween(x - 6, FLOOR, x + 6, FLOOR);
          sfx.rockCrumble();
          this.dust(x, 5, 0.9);
        },
      });
    }
    // the ground gives way: slow motion, the leap onto its forearm, everything falls
    beats.push({
      at: 2300,
      run: () => {
        sfx.titanRoar(1.2);
        gs.juice.shake(0.025, 1200);
        gs.juice.rumble(1, 1, 900);
        gs.juice.slowmo(0.35, 1300);
        cam.flash(180, 255, 255, 255, true);
        p.body.setAllowGravity(false);
        p.body.setVelocity(0, 0);
        const tx = Phaser.Math.Linear(p.x, this.mid, 0.4);
        gs.tweens.add({ targets: p, x: tx, duration: 1100, ease: 'Sine.out' });
        gs.tweens.add({ targets: p, y: 120, duration: 1100, ease: 'Quad.out' });
        gs.tweens.add({ targets: face, y: gs.worldHeight + 120, angle: 12, duration: 1500, ease: 'Quad.in' });
        cam.pan(tx, 140, 1100, 'Sine.easeInOut', true);
        for (let i = 0; i < 16; i++) {
          const v = cam.worldView;
          const r = this.keepCine(gs.add.image(v.x + Math.random() * v.width, v.y + v.height * (0.4 + Math.random() * 0.6), 'colossus-rock').setDepth(17).setScale(0.6 + Math.random()));
          gs.tweens.add({ targets: r, y: r.y + 260, angle: 200, duration: 900 + Math.random() * 600, ease: 'Quad.in', onComplete: () => r.destroy() });
        }
      },
    });
    beats.push({ at: 3500, run: () => cam.flash(700, 255, 255, 255, true) });
    beats.push({
      at: 4100,
      run: () => {
        sfx.titanRoar(0.8);
        gs.juice.impact('slam', p.x, FLOOR);
        gs.juice.ring(this.x, this.y, RUNE, 3);
        bus.emit('boss-intro', COLOSSUS_NAMES[2]);
      },
    });
    phaseCinematic(gs, {
      shot: { x: this.mid, y: 150, zoom: 0.9, ms: 1300 },
      muffle: false,
      beats,
      commitAt: 3800,
      commit: () => this.commitP3(),
      length: 6200,
      backMs: 700,
      cleanup: () => this.dropCineFx(),
      done: () => {
        this.dropCineFx();
        if (!this.alive) return;
        playMusic('colossus3');
        this.cineDone();
      },
    });
  }

  // ------------------------------------------------------------------ death: it hits the ground
  die(reward = true): void {
    if (!this.alive) return;
    this.abort();
    const gs = this.gs;
    const wasFalling = this.p3Built;
    const x = this.x, y = this.y;
    super.die(reward);
    gs.juice.burst(x, y, RUNE, 24, 1.6);
    if (!wasFalling || !this.land) return;
    // the ground rushes up the rest of the way, then the impact
    this.streakSpeed = 2.5;
    const st = { y: this.landY };
    gs.tweens.add({
      targets: st, y: 120, duration: 1500, delay: 300, ease: 'Quad.in',
      onUpdate: () => (this.landY = st.y),
    });
    gs.time.delayedCall(1850, () => {
      this.streakSpeed = 0;
      for (const s of this.streaks) s.setVisible(false);
      gs.juice.shake(0.03, 1400);
      gs.juice.rumble(1, 1, 1000);
      sfx.rockCrumble();
      sfx.titanRoar(0.6);
      for (let i = 0; i < 12; i++) this.dust(this.L + (i / 11) * (this.R - this.L), 4, 1.6);
    });
  }
}

