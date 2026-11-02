import Phaser from 'phaser';
import { Boss } from './Boss';
import { Hitbox } from '../../combat/Hitbox';
import { UNPARRYABLE_TINT } from '../Enemy';
import type { Projectile } from '../Projectile';
import type { HitInfo, Rect } from '../../combat/types';
import { sfx } from '../../systems/sfx';
import { TILE } from '../../config';
import type { GameScene } from '../../scenes/GameScene';
import { wardenWeights, pickMove, type WardenMove as Move } from '../../combat/wardenPlan';

/** Wind-ups per phase (ms). Floors: P1 >= 500, P2 >= 450, P3 >= 400 (follow-ups may be shorter, see below). */
const T = {
  slam: [600, 480, 400],
  sweep: [620, 500, 420],
  hook: [500, 450, 400],
  leap: [550, 500, 450],
  whirl: [700, 620, 550],
  debris: [550, 500, 450],
  rake: [620, 560, 480],
  /** Twin Quake: second slam wind-up */
  quake2: 380,
  /** hook follow-ups: P3 re-throw after a miss / P3 whirl finisher */
  rethrow: 300,
  whirlHook: 250,
  /** Hook hit -> yank: reel time, then a slam wind-up of at least this (lands as hurt i-frames end) */
  yankReel: 400,
  yankSlamMin: 450,
  /** P2+ delayed slam: extra hold on the wind-up */
  slamHold: 250,
  /** punish windows */
  stuck: [1100, 900, 750],
  sweepRecover: 450,
  reel: 550,
  leapRecover: 750,
  dizzy: 1100,
  /** cooldown after a recover window ends */
  after: [550, 420, 320],
  comboGap: 240,
  whirlMs: 2200,
} as const;

/** How a thrown hook resolves (see updateHook). */
interface HookPlan {
  /** already a re-throw: no further re-throw */
  rethrown: boolean;
  /** 'dizzy' = thrown as the whirl finisher: every outcome ends in the dizzy punish */
  after: 'normal' | 'dizzy';
}

const WHIRL_R = 3 * TILE;
const SWEEP_BACK = 26;
const SWEEP_FRONT = 9 * TILE - SWEEP_BACK; // ~9 tiles total
const CHAIN = [0x6b4433, 0x9a6648, 0x3e2731];
const CHAIN_HOT = [0xf7b23b, 0xf4f1ea, 0xf27d2b];

/**
 * World 4-1: THE CHAINED WARDEN. Ground-based, slow and heavy: "bait, dodge, punish".
 *  Close: Anchor Slam (parryable P1/P2, red P3; P2+ sometimes holds the wind-up; anchor gets stuck = big window)
 *         / Chain Sweep (low, jump it) / Slam->Sweep combo (P2+).
 *  Mid:   Hook Throw (reflect it = yanked + stunned; a miss = reel-in window) / Chain Whirl (P2+, keep away)
 *         / Chain Rake (P2+: anchor planted at your feet, dragged back along the floor; jump it).
 *  Far:   Leap Crush (P2+, shockwaves, landing recovery) / Hook Throw / Chain Rake.
 *  Ledge: Hook (heavier the longer you camp) + Debris Fall (P2+).
 *  P2+:   a hook that hits drags you in for a slam.
 *  P3:    white-hot chain (sweep/whirl/rake deal 2), Debris Fall, Twin Quake (two red slams, shockwaves),
 *         a missed hook may be re-thrown once, the whirl ends with a hook throw.
 * Every heavy move ends in recover() (stars, x1.25 damage). Never the same move 3x in a row.
 */
export class Warden extends Boss {
  private history: Move[] = [];
  /** ms the player has been up on a ledge (resets on the floor) */
  private highMs = 0;
  private hookPlan: HookPlan = { rethrown: false, after: 'normal' };
  /** bumped on phase change: pending steps of the interrupted attack are dropped */
  private seq = 0;
  private fx: Phaser.GameObjects.Graphics;
  private tip: Phaser.GameObjects.Sprite;
  /** chain fx state */
  private sweepTip: { x: number; y: number } | null = null;
  private whirl: { r: number; a: number; hot: boolean; ghost: boolean } | null = null;
  private hookProj: Projectile | null = null;
  private hookHpBefore = 0;
  private hookYanked = false;
  private reelSprite: Phaser.GameObjects.Sprite | null = null;
  private leaping = false;
  private whirlWalk: Phaser.Time.TimerEvent | null = null;
  private whirlBox: Hitbox | null = null;
  /** short-lived warning visuals of the current attack (removed on interrupt) */
  private temp: Phaser.GameObjects.GameObject[] = [];

  constructor(gs: GameScene, x: number, y: number) {
    super(gs, x, y, 'warden', 'THE CHAINED WARDEN', { hp: 130, bodyW: 30, bodyH: 40, contactDamage: 0, shards: 75 });
    this.thresholds = [0.66, 0.33];
    this.deathTint = 0xffeec2;
    this.hearts = { periodicMs: 26000, maxOnField: 1, perParries: 4, onPhase: 1 };
    this.fx = gs.add.graphics().setDepth(16);
    this.tip = gs.add.sprite(x, y, 'warden-anchor').setDepth(16).setVisible(false);
    this.once(Phaser.GameObjects.Events.DESTROY, () => this.cleanupFx());
  }

  private get sheetKey(): string {
    return this.phase <= 1 ? 'warden' : `warden-p${Math.min(3, this.phase)}`;
  }

  private get ph(): number {
    return Math.min(3, this.phase) - 1;
  }

  protected animKey(): string {
    const s = this.sheetKey;
    if (this.stunned) return s + '-stun';
    const pose = this.curPose;
    if (pose) return s + '-' + pose;
    if (!this.onGround) return s + '-air';
    return Math.abs(this.body.velocity.x) > 5 ? s + '-walk' : s + '-idle';
  }

  // ------------------------------------------------------------------ sequencing helpers
  /** Delayed step of the current attack; dropped if a phase change interrupted it. */
  private step(ms: number, fn: () => void): void {
    const s = this.seq;
    this.later(ms, () => {
      if (s === this.seq && !this.transforming) fn();
    });
  }

  /** End a light attack (no punish window): free to act after `cd`. */
  private finish(cd: number, delay = 0): void {
    this.step(delay, () => {
      this.busy = false;
      this.cooldown = cd;
    });
  }

  private punish(ms: number, pose: string): void {
    this.body.setVelocityX(0);
    this.recover(ms, pose, T.after[this.ph]);
  }

  private begin(m: Move): void {
    this.busy = true;
    this.history.push(m);
    if (this.history.length > 4) this.history.shift();
    this.facePlayer();
    this.body.setVelocityX(0);
  }

  // ------------------------------------------------------------------ AI
  protected think(dt: number): void {
    if (!this.leaping) this.contactDamage = 0; // contact damage only while airborne in Leap Crush
    this.highMs = this.playerHigh() ? this.highMs + dt : 0;
    if (this.busy) return;
    this.cooldown -= dt;
    this.facePlayer();
    const dx = Math.abs(this.dxToPlayer());
    const speed = [48, 60, 72][this.ph];
    this.body.setVelocityX(dx > 56 ? this.facing * speed : 0);
    if (this.cooldown > 0 || !this.player.alive) return;
    const m = this.choose(dx);
    if (!m) {
      this.cooldown = 250; // nothing fits: keep walking in
      return;
    }
    switch (m) {
      case 'slam': this.slam(false); break;
      case 'combo': this.slam(true); break;
      case 'sweep': this.sweep(); break;
      case 'hook': this.hook(); break;
      case 'leap': this.leap(); break;
      case 'whirl': this.whirlAttack(); break;
      case 'debris': this.debris(); break;
      case 'rake': this.rake(); break;
      case 'quake': this.quake(); break;
    }
  }

  /** Player is up on a ledge. */
  private playerHigh(): boolean {
    return this.player.y < this.y - 2.5 * TILE;
  }

  /** Range-based weighted pick (src/combat/wardenPlan.ts); never the same move 3x in a row. */
  private choose(dx: number): Move | null {
    return pickMove(wardenWeights(this.phase, dx, this.playerHigh(), this.highMs), this.history);
  }

  // ------------------------------------------------------------------ Anchor Slam (+ P2+ Slam->Sweep combo)
  /** `teleMs` overrides the wind-up (follow-ups); otherwise P2+ sometimes holds it to catch early dodges. */
  private slam(combo: boolean, teleMs?: number): void {
    this.begin(combo ? 'combo' : 'slam');
    const hold = teleMs === undefined && !combo && this.phase >= 2 && Math.random() < 0.3 ? T.slamHold : 0;
    const tele = (teleMs ?? T.slam[this.ph]) + hold;
    const parryable = this.phase < 3;
    this.telegraph(tele, 0xffd96a, !parryable);
    this.setPose('windup', tele + 150);
    this.step(tele, () => {
      this.setPose('slam', combo ? T.comboGap + 100 : 300);
      sfx.heavyHit(0.6);
      this.meleeBox(-2, -22, 50, 46, 160, 2, parryable, 240);
      this.gs.juice.shake(0.01, 220);
      this.gs.juice.burst(this.x + this.facing * 26, this.body.bottom - 2, 0xc2c3d6, 14, 1.1);
      if (combo) {
        // anchor stays planted; he yanks the chain sideways along the floor
        this.step(T.comboGap, () => this.sweepWindup(() => this.punish(T.stuck[this.ph], 'stuck')));
      } else this.step(220, () => this.punish(T.stuck[this.ph], 'stuck'));
    });
  }

  // ------------------------------------------------------------------ Chain Sweep
  private sweep(): void {
    this.begin('sweep');
    this.sweepWindup(() => this.punish(T.sweepRecover, 'sweep'));
  }

  /** Red crouch wind-up, then a low chain arc ~9 tiles wide at floor height. */
  private sweepWindup(after: () => void): void {
    this.facePlayer();
    const dir = this.facing;
    this.floorChain(this.x - dir * SWEEP_BACK, this.x + dir * SWEEP_FRONT, T.sweep[this.ph], 280, 'coil', 'sweep', false, after);
  }

  /**
   * Unparryable floor-level chain: red wind-up with a warning strip from `fromX` to `toX`, then the anchor
   * tip travels fromX -> toX over `active` ms (jump it). `planted` shows the anchor lying at fromX during
   * the wind-up (Chain Rake). White-hot (P3) hits deal 2.
   */
  private floorChain(fromX: number, toX: number, tele: number, active: number, windPose: string, hitPose: string, planted: boolean, after: () => void): void {
    this.telegraph(tele, UNPARRYABLE_TINT, true);
    this.setPose(windPose, tele + 150);
    const bottom = this.body.bottom;
    const dir = toX >= fromX ? 1 : -1;
    const strip = this.gs.add.rectangle((fromX + toX) / 2, bottom - 1, Math.abs(toX - fromX), 2, UNPARRYABLE_TINT, 0.55).setDepth(14);
    this.gs.tweens.add({ targets: strip, alpha: 0.15, yoyo: true, repeat: -1, duration: 90 });
    this.temp = this.temp.filter((o) => o.active);
    this.temp.push(strip);
    if (planted) this.sweepTip = { x: fromX, y: bottom - 5 };
    this.step(tele, () => {
      strip.destroy();
      this.setPose(hitPose, active + 140);
      sfx.dash();
      const start = this.gs.time.now;
      const tipX = () => fromX + (toX - fromX) * Math.min(1, (this.gs.time.now - start) / active);
      this.sweepTip = { x: tipX(), y: bottom - 5 };
      const damage = this.phase >= 3 ? 2 : 1;
      this.gs.damage.add(
        new Hitbox(
          'enemy',
          () => {
            const x = tipX();
            if (this.sweepTip) this.sweepTip.x = x;
            return { x: x - 20, y: bottom - 12, w: 40, h: 12 };
          },
          () => ({ damage, kbX: dir * 200, kbY: -200, sourceX: this.x, parryable: false, kind: 'melee' }),
          active,
        ).ownedBy(this),
      );
      const puffs = Math.max(5, Math.round(active / 55));
      for (let i = 0; i < puffs; i++) this.step(i * 55, () => this.gs.juice.burst(tipX(), bottom - 2, 0xc2c3d6, 4, 0.6));
      this.step(active + 160, () => (this.sweepTip = null));
      this.step(active, after);
    });
  }

  // ------------------------------------------------------------------ Chain Rake (P2+)
  /** Flings the anchor to plant it just past the player, then drags it back along the floor to himself. */
  private rake(): void {
    this.begin('rake');
    const dir = this.facing;
    const reach = 11 * TILE;
    const lo = TILE + 12, hi = this.gs.worldWidth - TILE - 12;
    const fromX = Phaser.Math.Clamp(Phaser.Math.Clamp(this.player.x + dir * 14, this.x - reach, this.x + reach), lo, hi);
    const toX = this.x + dir * 10;
    const active = Math.max(260, Math.abs(fromX - toX) / 0.75); // ~750 px/s drag
    sfx.shoot();
    this.floorChain(fromX, toX, T.rake[this.ph], active, 'throw', 'reel', true, () => this.punish(T.sweepRecover, 'sweep'));
  }

  // ------------------------------------------------------------------ Twin Quake (P3)
  /** Two red anchor slams (re-aims between them); the second sends shockwaves. Biggest punish of the fight. */
  private quake(): void {
    this.begin('quake');
    const strike = (tele: number, waves: boolean, next: () => void) => {
      this.facePlayer();
      this.telegraph(tele, UNPARRYABLE_TINT, true);
      this.setPose('windup', tele + 150);
      this.step(tele, () => {
        this.setPose('slam', 300);
        sfx.heavyHit(0.7);
        this.meleeBox(-2, -22, 50, 46, 160, 2, false, 240);
        this.gs.juice.shake(0.012, 240);
        this.gs.juice.burst(this.x + this.facing * 26, this.body.bottom - 2, 0xf7b23b, 14, 1.1);
        if (waves) this.shockwaves(225);
        this.step(220, next);
      });
    };
    strike(T.slam[this.ph], false, () => strike(T.quake2, true, () => this.punish(T.stuck[this.ph] + 150, 'stuck')));
  }

  // ------------------------------------------------------------------ Hook Throw
  private hook(): void {
    this.begin('hook');
    this.throwHook(T.hook[this.ph], { rethrown: false, after: 'normal' });
  }

  /** Wind-up + throw; the outcome is resolved in updateHook() according to `plan`. */
  private throwHook(tele: number, plan: HookPlan): void {
    this.hookPlan = plan;
    this.facePlayer();
    this.telegraph(tele, 0xffd96a);
    this.setPose('hookwind', tele + 150);
    this.step(tele, () => {
      this.setPose('throw', 1400);
      this.facePlayer();
      const hx = this.x + this.facing * 18, hy = this.y - 6;
      const a = Math.atan2(this.player.y - hy, this.player.x - hx);
      const sp = [290, 320, 350][this.ph];
      sfx.shoot();
      const proj = this.gs.spawnProjectile(hx, hy, 'hook', Math.cos(a) * sp, Math.sin(a) * sp, 'enemy', { damage: 1, lifeMs: 1100, rotate: true, owner: this });
      proj.body.setAllowGravity(false);
      this.hookProj = proj;
      this.hookHpBefore = this.player.hp;
      this.hookYanked = false;
    });
  }

  /** Polled every frame while a hook is out. */
  private updateHook(): void {
    const h = this.hookProj;
    if (!h || (!h.dead && h.active)) return;
    this.hookProj = null;
    const plan = this.hookPlan;
    if (this.hookYanked) {
      // yanked off balance by the reflected hook: onParried() already stunned him
      this.setPose('', 0);
      this.finish(T.after[this.ph], 10);
      return;
    }
    const hitPlayer = this.player.hp < this.hookHpBefore;
    if (plan.after === 'dizzy') {
      // whirl finisher: whatever happened, he's spun out now
      this.reelIn(h.x, h.y, 400);
      this.punish(T.dizzy, 'dizzy');
    } else if (hitPlayer && this.phase >= 2 && this.player.alive) {
      // chain bites: drag the player in, then slam as their hurt i-frames run out (P2 slam is parryable)
      const toward = this.player.x >= this.x ? -1 : 1;
      if (Math.abs(this.dxToPlayer()) > 40) this.player.body.setVelocity(toward * 260, -160);
      this.setPose('reel', T.yankReel);
      this.reelIn(h.x, h.y, T.yankReel);
      this.step(T.yankReel, () => this.slam(false, Math.max(T.yankSlamMin, T.slam[this.ph])));
    } else if (hitPlayer) {
      this.setPose('reel', 400);
      this.reelIn(h.x, h.y, 400);
      this.finish(500, 400);
    } else if (this.phase >= 3 && !plan.rethrown && Math.random() < 0.4) {
      // P3: whips the hook back out once instead of reeling in
      this.reelIn(h.x, h.y, T.rethrow);
      this.step(T.rethrow, () => this.throwHook(T.rethrow, { rethrown: true, after: 'normal' }));
    } else {
      // missed: reel-in with his guard down
      this.reelIn(h.x, h.y, T.reel);
      this.punish(T.reel, 'reel');
    }
  }

  private reelIn(x: number, y: number, ms: number): void {
    this.reelSprite?.destroy();
    const s = this.gs.add.sprite(x, y, 'hook').setDepth(17);
    s.setFlipX(x > this.x);
    this.reelSprite = s;
    this.gs.tweens.add({
      targets: s,
      x: { getEnd: () => this.x + this.facing * 16 },
      y: this.y - 4,
      duration: ms,
      ease: 'Quad.in',
      onComplete: () => {
        s.destroy();
        if (this.reelSprite === s) this.reelSprite = null;
      },
    });
  }

  receiveHit(hit: HitInfo): 'hit' | 'blocked' | 'ignored' {
    const h = this.hookProj;
    const yank = hit.kind === 'projectile' && !!hit.parried && !!h && !h.dead && h.team === 'player';
    const res = super.receiveHit(hit);
    if (yank && res === 'hit' && this.alive && !this.transforming && !this.hookYanked) {
      this.hookYanked = true;
      this.onParried();
      this.gs.juice.floatText(this.x, this.y - 34, 'YANKED!', '#7fdbff');
      this.gs.juice.shake(0.008, 200);
    }
    return res;
  }

  // ------------------------------------------------------------------ Leap Crush (P2+)
  private leap(): void {
    this.begin('leap');
    const tele = T.leap[this.ph];
    this.telegraph(tele, UNPARRYABLE_TINT, true);
    this.setPose('crouch', tele + 150);
    this.step(tele, () => {
      this.facePlayer();
      const vy = -480;
      const flight = (2 * -vy) / 1400;
      const vx = Phaser.Math.Clamp(this.dxToPlayer() / flight, -300, 300);
      this.body.setVelocity(vx, vy);
      this.leaping = true;
      this.contactDamage = 1;
      this.setPose('air', 2000);
      this.gs.juice.burst(this.x, this.body.bottom, 0xc2c3d6, 10, 0.9);
      this.step(250, () => this.landCheck(0));
    });
  }

  private landCheck(tries: number): void {
    if (!this.onGround && tries < 60) {
      this.step(25, () => this.landCheck(tries + 1));
      return;
    }
    this.leaping = false;
    this.contactDamage = 0;
    this.body.setVelocityX(0);
    sfx.heavyHit(0.5);
    this.gs.juice.shake(0.014, 280);
    this.gs.juice.burst(this.x, this.body.bottom, 0xc2c3d6, 22, 1.3);
    this.shockwaves(this.phase >= 3 ? 225 : 185);
    this.punish(T.leapRecover, 'land');
  }

  // ------------------------------------------------------------------ Chain Whirl (P2+)
  private whirlAttack(): void {
    this.begin('whirl');
    const tele = T.whirl[this.ph];
    const hot = this.phase >= 3;
    this.telegraph(tele, UNPARRYABLE_TINT, true);
    this.setPose('whirl', tele + T.whirlMs);
    this.whirl = { r: 10, a: 0, hot, ghost: true };
    sfx.charge();
    this.gs.tweens.add({ targets: this.whirl, r: WHIRL_R, duration: tele, ease: 'Quad.in' });
    this.step(tele, () => {
      if (this.whirl) this.whirl.ghost = false;
      this.gs.juice.ring(this.x, this.y - 4, hot ? 0xffd96a : 0xc2c3d6, 1.6);
      // circular hitbox: the rect only exists while the player's hurt box touches the circle
      const box = this.gs.damage.add(
        new Hitbox(
          'enemy',
          (): Rect => {
            const cx = this.x, cy = this.y - 4;
            const b = this.player.hurtRect();
            const nx = Phaser.Math.Clamp(cx, b.x, b.x + b.w), ny = Phaser.Math.Clamp(cy, b.y, b.y + b.h);
            if ((nx - cx) ** 2 + (ny - cy) ** 2 > WHIRL_R * WHIRL_R) return { x: -9999, y: -9999, w: 0, h: 0 };
            return { x: cx - WHIRL_R, y: cy - WHIRL_R, w: WHIRL_R * 2, h: WHIRL_R * 2 };
          },
          () => ({ damage: hot ? 2 : 1, kbX: this.dirToPlayer() * 230, kbY: -220, sourceX: this.x, parryable: false, kind: 'melee' }),
          T.whirlMs,
        ).ownedBy(this),
      );
      const speed = [40, 50, 60][this.ph];
      const walk = this.gs.time.addEvent({
        delay: 50,
        repeat: Math.floor(T.whirlMs / 50) - 1,
        callback: () => {
          if (!this.alive || this.transforming || this.stunned || !this.whirl) return;
          this.facePlayer();
          this.body.setVelocityX(Math.abs(this.dxToPlayer()) > 6 ? this.facing * speed : 0);
        },
      });
      this.whirlWalk = walk;
      this.whirlBox = box;
      this.step(T.whirlMs, () => {
        this.stopWhirl();
        this.body.setVelocityX(0);
        // P3: comes out of the spin with a hook throw; the dizzy punish follows it (see updateHook)
        if (this.phase >= 3) this.throwHook(T.whirlHook, { rethrown: true, after: 'dizzy' });
        else this.punish(T.dizzy, 'dizzy');
      });
    });
  }

  // ------------------------------------------------------------------ Debris Fall (P3; P2 vs ledge campers)
  private debris(): void {
    this.begin('debris');
    const tele = T.debris[this.ph];
    this.telegraph(tele, 0xffffff);
    this.setPose('crouch', tele + 150);
    this.step(tele, () => {
      this.setPose('land', 400);
      sfx.heavyHit(0.5);
      this.gs.juice.shake(0.012, 600);
      this.gs.juice.burst(this.x, this.body.bottom, 0xc2c3d6, 16, 1.1);
      const cam = this.gs.cameras.main;
      const minX = Math.max(cam.scrollX, TILE) + 12, maxX = Math.min(cam.scrollX + cam.width, this.gs.worldWidth - TILE) - 12;
      const floor = this.body.bottom;
      const xs: number[] = [Phaser.Math.Clamp(this.player.x, minX, maxX)];
      const rocks = this.phase >= 3 ? 7 : 4;
      for (let tries = 0; xs.length < rocks && tries < 40; tries++) {
        const x = Phaser.Math.Between(minX, maxX);
        if (xs.every((o) => Math.abs(o - x) > 30)) xs.push(x);
      }
      xs.forEach((x, i) => this.step(i * 140, () => this.dropRock(x, cam.scrollY, floor)));
      // overlaps his next move: short cooldown
      this.finish([600, 500, 380][this.ph], 300);
    });
  }

  private dropRock(x: number, camTop: number, floor: number): void {
    const warn = 650;
    // spawn under the arena ceiling, not above it (it would land on the ceiling and die)
    const top = this.gs.ceilingBelow(x, camTop);
    const col = this.gs.add.rectangle(x, (top + floor) / 2, 10, floor - top, 0xffffff, 0.06).setDepth(13);
    const mark = this.gs.add.ellipse(x, floor - 1, 18, 4, 0xff006e, 0.55).setDepth(14);
    const ceil = this.gs.add.rectangle(x, top + 4, 4, 8, 0xff006e).setDepth(40);
    this.gs.tweens.add({ targets: [mark, ceil], alpha: 0.2, yoyo: true, repeat: -1, duration: 110 });
    this.gs.time.delayedCall(warn, () => {
      col.destroy();
      ceil.destroy();
      this.gs.time.delayedCall(700, () => mark.destroy());
      if (!this.alive || this.transforming) {
        mark.destroy();
        return;
      }
      const r = this.gs.spawnProjectile(x, top > camTop ? top + 7 : top - 8, 'warden-rock', 0, 280, 'enemy', { damage: 1, lifeMs: 2500, owner: this });
      r.body.setAllowGravity(false);
    });
  }

  // ------------------------------------------------------------------ phases
  protected onPhase(n: number): void {
    this.seq++;
    this.interruptFx();
    this.setPose('roar', 1500);
    this.body.setVelocityX(0);
    this.transform(1500);
    this.later(700, () => {
      const feet = this.body.bottom - 4;
      if (n === 2) {
        // breaks his shackles: iron fragments burst off the ankles
        this.gs.juice.floatText(this.x, this.y - 36, 'SHACKLES BROKEN', '#ffd96a');
        for (const ox of [-8, 8]) {
          this.gs.juice.burst(this.x + ox, feet, 0x8b8ba8, 14, 1.2);
          this.gs.juice.burst(this.x + ox, feet, 0x9a6648, 8, 1);
        }
        this.gs.juice.ring(this.x, feet, 0xffd96a, 1.8);
      } else {
        this.gs.juice.floatText(this.x, this.y - 36, 'WHITE-HOT', '#f27d2b');
        this.gs.juice.burst(this.x, this.y, 0xf7b23b, 22, 1.4);
        this.gs.juice.burst(this.x, this.y, 0xf4f1ea, 10, 1);
        this.gs.juice.ring(this.x, this.y, 0xf27d2b, 2.4);
      }
      this.gs.juice.shake(0.012, 300);
      sfx.bossRoar();
    });
  }

  private stopWhirl(): void {
    this.whirlWalk?.remove();
    this.whirlWalk = null;
    this.whirlBox?.kill();
    this.whirlBox = null;
    this.whirl = null;
  }

  /** Drop all in-flight attack visuals/state (phase change / death). */
  private interruptFx(): void {
    this.sweepTip = null;
    this.stopWhirl();
    for (const o of this.temp) o.destroy();
    this.temp = [];
    this.leaping = false;
    this.contactDamage = 0;
    this.hookProj = null; // transform() clears the projectile itself
    this.reelSprite?.destroy();
    this.reelSprite = null;
    this.fx.clear();
    this.tip.setVisible(false);
  }

  private cleanupFx(): void {
    for (const o of this.temp) o.destroy();
    this.whirlWalk?.remove();
    this.reelSprite?.destroy();
    this.fx.destroy();
    this.tip.destroy();
  }

  die(reward = true): void {
    if (this.alive) {
      this.seq++;
      this.interruptFx();
    }
    super.die(reward);
  }

  // ------------------------------------------------------------------ per-frame fx
  tick(time: number, dt: number): void {
    super.tick(time, dt);
    if (!this.alive) return;
    this.updateHook();
    this.drawChainFx();
  }

  private handPos(): { x: number; y: number } {
    const pose = this.curPose;
    const f = this.facing;
    if (pose === 'sweep') return { x: this.x + f * 18, y: this.body.bottom - 13 };
    if (pose === 'whirl') return { x: this.x + f * 7, y: this.body.top - 4 };
    if (pose === 'throw') return { x: this.x + f * 19, y: this.y - 4 };
    return { x: this.x + f * 12, y: this.y + 2 };
  }

  private drawChainFx(): void {
    const g = this.fx;
    g.clear();
    this.tip.setVisible(false);
    const pal = this.phase >= 3 ? CHAIN_HOT : CHAIN;
    const hand = this.handPos();
    // hook line
    const h = this.hookProj?.active ? this.hookProj : this.reelSprite?.active ? this.reelSprite : null;
    if (h) this.links(g, hand.x, hand.y, h.x, h.y, pal);
    // sweep: chain along the floor to the anchor tip
    if (this.sweepTip) {
      const t = this.sweepTip;
      this.links(g, hand.x, hand.y, t.x, t.y, pal);
      const dir = t.x >= this.x ? 1 : -1;
      this.tip.setVisible(true).setPosition(t.x, t.y - 2).setFlipX(dir < 0).setRotation(0);
    }
    // whirl: chain circle with the anchor at its head
    const w = this.whirl;
    if (w) {
      const cx = this.x, cy = this.y - 4;
      const spin = w.ghost ? 0.012 : 0.022;
      w.a += spin * this.gs.game.loop.delta;
      if (w.ghost) {
        g.lineStyle(1, UNPARRYABLE_TINT, 0.35 + 0.2 * Math.sin(this.gs.time.now / 60));
        g.strokeCircle(cx, cy, WHIRL_R);
      }
      const n = Math.max(6, Math.round(w.r / 3));
      const trail = w.ghost ? 0.9 : 2.2; // radians of visible chain behind the head
      for (let i = 0; i < n; i++) {
        const a = w.a - (i / n) * trail;
        const px = Math.round(cx + Math.cos(a) * w.r), py = Math.round(cy + Math.sin(a) * w.r);
        g.fillStyle(pal[i % 3], 1 - (i / n) * 0.6);
        g.fillRect(px - 1, py - 1, 2, 2);
      }
      // spokes from the hand to the head
      const hx = cx + Math.cos(w.a) * w.r, hy = cy + Math.sin(w.a) * w.r;
      this.links(g, hand.x, hand.y, hx, hy, pal);
      if (!w.ghost) {
        g.lineStyle(1, w.hot ? 0xf7b23b : 0xc2c3d6, 0.25);
        g.strokeCircle(cx, cy, WHIRL_R);
      }
      this.tip.setVisible(true).setPosition(hx, hy).setFlipX(false).setRotation(w.a);
    }
  }

  /** Pixel chain links between two points. */
  private links(g: Phaser.GameObjects.Graphics, x0: number, y0: number, x1: number, y1: number, pal: readonly number[]): void {
    const d = Math.hypot(x1 - x0, y1 - y0);
    const n = Math.max(1, Math.floor(d / 3));
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const x = Math.round(x0 + (x1 - x0) * t), y = Math.round(y0 + (y1 - y0) * t);
      g.fillStyle(0x140c1c, 1);
      g.fillRect(x - 1, y - 1, 3, 3);
      g.fillStyle(pal[i % 2], 1);
      g.fillRect(x, y, i % 2 ? 1 : 2, i % 2 ? 2 : 1);
    }
  }
}
