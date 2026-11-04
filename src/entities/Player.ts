import Phaser from 'phaser';
import { JUICE, MOVE_FX, PLAYER, PHYS } from '../config';
import { StateMachine } from '../core/StateMachine';
import type { InputManager } from '../core/InputManager';
import { Hitbox } from '../combat/Hitbox';
import { overlaps, type HitInfo, type Hurtable, type Rect } from '../combat/types';
import { sfx } from '../systems/sfx';
import { bus } from '../core/events';
import type { PlayerStats } from '../systems/Progression';
import type { GameScene } from '../scenes/GameScene';
import { addLight } from '../core/Fx';
import { PLAYER_FRAME } from '../art/player';
import { canParryHit, swingParryWindowMs } from '../combat/parryWindow';
import { ghostTrail, speedLine } from '../core/trails';
import { isFootfall, isSkid, landStrength, lerpPair, settlePx, smoothTo } from '../core/moveFx';
import { Enemy } from './Enemy';
import { hitImpactMul } from '../core/juiceMath';
import { duckMusic, setMuffle } from '../systems/music';
import { cheats } from '../systems/cheats';


const BODY_W = 10;
const BODY_H = 18;

export class Player extends Phaser.Physics.Arcade.Sprite implements Hurtable {
  team = 'player' as const;
  alive = true;
  declare body: Phaser.Physics.Arcade.Body;

  fsm: StateMachine<Player>;
  facing: 1 | -1 = 1;
  hp: number;
  stamina: number;
  stats: PlayerStats;

  // movement timers (ms timestamps / counters)
  private lastGroundedAt = -9999;
  private wasGrounded = false;
  private wallDir = 0;
  private lastWallAt = -9999;
  private wallJumpLockUntil = 0;
  private jumpHeld = false;
  private airJumps = 0;
  private airDashes = 0;
  private dashReadyAt = 0;
  private iframesUntil = 0;
  dropThroughUntil = 0;

  // combat
  private comboStep = 0;
  private _swingCount = 0;
  private lastAttackEndAt = -9999;
  private lastEnergySlashAt = -9999;
  private lastPogoAt = -9999;
  /** after a pogo: low gravity until this time, and the flip animation until pogoAnimUntil */
  private pogoFloatUntil = 0;
  private pogoAnimUntil = 0;
  private attackQueued = false;
  private slash?: Phaser.GameObjects.Sprite;
  private airComboStep = 0;
  /** current ground swing carries momentum (running/dash slash, finisher, spin) */
  private lunge = false;
  /** next ground swing is a dash-slash (set by the dash before entering attack) */
  private dashSlash = false;
  /** swing about to start is a buffered chain (gets the short parry window) */
  private swingFollowup = false;
  /** parry window opened by the current swing (there is no parry button) */
  parryActiveUntil = 0;
  private parryUpSlash = false;
  private riposteUntil = 0;
  private speedBuffUntil = 0;
  /** external slow (e.g. Fromage's fondue): run speed x slowMul until slowUntil */
  private slowUntil = 0;
  private slowMul = 1;
  damageTaken = 0;
  /** Second Wind already spent this level (a new Player is built per level/retry) */
  private secondWindUsed = false;
  /** last safe standing position for pit/spike respawn */
  safePos = { x: 0, y: 0 };

  constructor(public gs: GameScene, x: number, y: number, private inp: InputManager, stats: PlayerStats) {
    super(gs, x, y, 'player');
    gs.add.existing(this);
    gs.physics.add.existing(this);
    this.stats = stats;
    this.hp = stats.maxHp;
    this.stamina = stats.maxStamina;
    // visual frame is bigger than the body: anchor y so the body keeps the exact same
    // placement relative to (x, y) as the legacy 12x20 sprite (offset - displayOrigin = -5, -8)
    this.setOrigin(0.5, PLAYER_FRAME.originY);
    this.body.setSize(BODY_W, BODY_H).setOffset(PLAYER_FRAME.w / 2 - 5, PLAYER_FRAME.feetY - BODY_H);
    this.body.setMaxVelocityY(PHYS.maxFall);
    this.setDepth(20);
    this.safePos = { x, y };

    this.fsm = new StateMachine<Player>(this);
    this.fsm
      .add('normal', { update: (p, dt) => p.updateNormal(dt) })
      .add('dash', { enter: (p) => p.enterDash(), update: (p) => p.updateDash(), exit: (p) => p.exitDash() })
      .add('attack', { enter: (p) => p.enterAttack(), update: (p, dt) => p.updateAttack(dt), exit: (p) => p.closeParry() })
      .add('airAttack', { enter: (p) => p.enterAirAttack(), update: (p, dt) => p.updateAirAttack(dt), exit: (p) => p.closeParry() })
      .add('upAttack', { enter: (p) => p.enterUpAttack(), update: (p, dt) => p.updateUpAttack(dt), exit: (p) => p.closeParry() })
      .add('slam', { enter: (p) => p.enterSlam(), update: (p) => p.updateSlam(), exit: (p, next) => p.exitSlam(next) })
      .add('charge', { enter: (p) => p.enterCharge(), update: (p, dt) => p.updateCharge(dt), exit: (p) => p.exitCharge() })
      .add('heavy', { enter: (p) => p.enterHeavy(), update: (p, dt) => p.updateHeavy(dt), exit: (p) => p.closeParry() })
      .add('hurt', { update: (p) => p.updateHurt() })
      .add('dead', { enter: (p) => p.enterDead() });
    this.fsm.set('normal');
    this.emitStats();
    // squash & stretch is applied for rendering only (see applyVisScale), so it never resizes the body
    gs.events.on(Phaser.Scenes.Events.PRE_RENDER, this.applyVisScale, this);
    gs.events.on(Phaser.Scenes.Events.PRE_UPDATE, this.removeVisScale, this);
    gs.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      gs.events.off(Phaser.Scenes.Events.PRE_RENDER, this.applyVisScale, this);
      gs.events.off(Phaser.Scenes.Events.PRE_UPDATE, this.removeVisScale, this);
    });
  }

  // ---------------------------------------------------------------- helpers
  get grounded(): boolean {
    return this.body.blocked.down || this.body.touching.down;
  }

  hurtRect(): Rect {
    const b = this.body;
    return { x: b.x, y: b.y, w: b.width, h: b.height };
  }

  private emitStats(): void {
    bus.emit('hp', this.hp, this.stats.maxHp);
    bus.emit('stamina', this.stamina, this.stats.maxStamina);
  }

  private useStamina(n: number): boolean {
    if (this.stamina < n) {
      bus.emit('stamina-fail');
      return false;
    }
    if (!cheats.infiniteStamina) this.stamina -= n;
    bus.emit('stamina', this.stamina, this.stats.maxStamina);
    return true;
  }

  /** Run speed multiplier (short buff after a parry). */
  private speedMul(): number {
    const now = this.gs.time.now;
    return (now < this.speedBuffUntil ? PLAYER.parrySpeedBuffMul : 1) * (now < this.slowUntil ? this.slowMul : 1);
  }

  /** Slow the run speed to x`mul` for `ms` (refreshed every call; e.g. wading through fondue). */
  slow(ms: number, mul: number): void {
    this.slowUntil = this.gs.time.now + ms;
    this.slowMul = mul;
  }

  /** Accelerate toward the held direction. `turn` = false keeps facing (mid-swing: hitbox/smear are locked to it). */
  private moveX(dt: number, mul = 1, turn = true): void {
    const ax = this.inp.axisX();
    const target = ax * PLAYER.runSpeed * mul * this.speedMul();
    const accel = this.grounded ? PLAYER.accelGround : PLAYER.accelAir;
    const vx = this.body.velocity.x;
    const rate = (ax === 0 ? (this.grounded ? PLAYER.friction : PLAYER.accelAir * 0.5) : accel) * (dt / 1000);
    this.body.setVelocityX(Phaser.Math.Clamp(target, vx - rate, vx + rate));
    if (turn && ax !== 0) this.face(ax > 0 ? 1 : -1);
  }

  /** Lunge momentum: exponential decay (half-life ms) toward the steered target speed. Keeps facing. */
  private glideX(dt: number, mul: number, halfLifeMs: number): void {
    const target = this.inp.axisX() * PLAYER.runSpeed * mul * this.speedMul();
    const vx = this.body.velocity.x;
    this.body.setVelocityX(target + (vx - target) * Math.pow(0.5, dt / halfLifeMs));
  }

  face(dir: 1 | -1): void {
    this.facing = dir;
    this.setFlipX(dir < 0);
  }

  // ---------------------------------------------------------------- squash & stretch (visual only)
  /** one-shot squash that springs back to 1 */
  private sq = { x: 1, y: 1 };
  private sqTween?: Phaser.Tweens.Tween;
  /** held pose (float / fast-fall / wall slide), eased every tick */
  private pose = { x: 1, y: 1 };
  /** what applyVisScale added this frame (removed again before physics runs) */
  private visApplied: { sx: number; sy: number; dy: number } | null = null;

  private squash(sx: number, sy: number, ms = 110): void {
    this.sqTween?.stop();
    this.sq.x = sx;
    this.sq.y = sy;
    this.sqTween = this.gs.tweens.add({ targets: this.sq, x: 1, y: 1, duration: ms, ease: 'Quad.out' });
  }

  /** Two-stage squash: show `a`, ease to `b` over inMs, then back to 1 over outMs (jump anticipation). */
  private squashSeq(a: readonly [number, number], b: readonly [number, number], inMs: number, outMs: number): void {
    this.sqTween?.stop();
    this.sq.x = a[0];
    this.sq.y = a[1];
    this.sqTween = this.gs.tweens.add({
      targets: this.sq,
      x: b[0],
      y: b[1],
      duration: inMs,
      ease: 'Quad.in',
      onComplete: () => {
        this.sqTween = this.gs.tweens.add({ targets: this.sq, x: 1, y: 1, duration: outMs, ease: 'Quad.out' });
      },
    });
  }

  /**
   * Render-time scale: multiplies the sprite's scale by squash * pose around the feet (so squashes
   * stay planted) right before rendering. Physics never sees it: removeVisScale undoes it on the next
   * PRE_UPDATE, before the Arcade body reads the sprite scale (a scaled sprite resizes its body).
   */
  private applyVisScale(): void {
    this.removeVisScale();
    if (!this.alive || !this.active) return;
    const sx = this.sq.x * this.pose.x;
    const sy = this.sq.y * this.pose.y;
    if (Math.abs(sx - 1) < 0.005 && Math.abs(sy - 1) < 0.005) return;
    const feet = (PLAYER_FRAME.feetY - PLAYER_FRAME.originY * PLAYER_FRAME.h) * this.scaleY;
    const dy = feet * (1 - sy);
    this.visApplied = { sx: this.scaleX, sy: this.scaleY, dy };
    this.setScale(this.scaleX * sx, this.scaleY * sy);
    this.y += dy;
  }
  private removeVisScale(): void {
    const v = this.visApplied;
    if (!v) return;
    this.visApplied = null;
    this.setScale(v.sx, v.sy);
    this.y -= v.dy;
  }

  private canJump(): boolean {
    return this.gs.time.now - this.lastGroundedAt <= PLAYER.coyoteMs;
  }

  private doJump(vy = PLAYER.jumpVel): void {
    this.body.setVelocityY(-vy);
    this.lastGroundedAt = -9999;
    this.jumpHeld = true;
    const q = MOVE_FX.squash;
    this.squashSeq(q.jumpPre, q.jumpStretch, q.jumpPreMs, q.jumpOutMs);
    sfx.jump();
    this.gs.juice.dust(this.x, this.body.bottom, 4, 0.4, 0, this.dustTint());
  }

  // ---------------------------------------------------------------- frame update
  tick(time: number, dt: number): void {
    if (!this.alive && !this.fsm.is('dead')) return;
    const g = this.grounded;
    if (g) {
      this.lastGroundedAt = time;
      this.airJumps = this.stats.doubleJump ? 1 : 0;
      this.airDashes = 1;
      this.airComboStep = 0;
      if (time - this.lastPogoAt > 100) this.endPogoFloat();
      if (!this.wasGrounded && !this.fsm.is('slam')) this.onLand();
      this.airPeak = this.body.bottom;
      // remember safe ground (not near hazards) for respawn
      if (this.body.blocked.down && !this.gs.nearHazard(this.x, this.body.bottom)) this.safePos = { x: this.x, y: this.y - 2 };
    }
    else this.airPeak = Math.min(this.airPeak, this.body.bottom);
    this.wasGrounded = g;

    // walls (only count when airborne)
    const touchingWall = this.body.blocked.left ? -1 : this.body.blocked.right ? 1 : 0;
    if (!g && touchingWall !== 0) {
      // first contact with a wall: a sideways squash (not every frame of a slide)
      if (time - this.lastWallAt > 120 && this.fsm.is('normal')) this.squash(MOVE_FX.squash.wallHit[0], MOVE_FX.squash.wallHit[1], 110);
      this.wallDir = touchingWall;
      this.lastWallAt = time;
    }

    // stamina regen (paused while dashing/charging)
    if (!this.fsm.is('dash', 'charge') && this.stamina < this.stats.maxStamina) {
      this.stamina = Math.min(this.stats.maxStamina, this.stamina + (this.stats.staminaRegen * dt) / 1000);
      bus.emit('stamina', this.stamina, this.stats.maxStamina);
    }

    // i-frame blink
    if (time < this.iframesUntil && !this.fsm.is('dash')) this.setAlpha(Math.floor(time / 60) % 2 ? 0.6 : 1); // 0.35 vanished on dark backgrounds
    else this.setAlpha(1);

    this.cornerCorrect();
    this.fsm.update(dt);
    this.updateGravity();
    this.runDust(time);
    this.airFx(time, dt);
    if (this.slash) this.positionSlash();
    this.prevVy = this.body.velocity.y;
    this.updateVisual();
    this.footsteps();
  }

  /** Visual-only: pick animation from state/velocity. */
  private visKey = '';
  private visStateTime = 0;
  private visGrounded = true;
  private landUntil = 0;
  private updateVisual(): void {
    const st = this.fsm.current;
    const b = this.body;
    const now = this.gs.time.now;
    const g = this.grounded;
    if (g && !this.visGrounded && st === 'normal') this.landUntil = now + 90;
    this.visGrounded = g;
    let k: string;
    switch (st) {
      case 'dead': k = 'dead'; break;
      case 'hurt': k = 'hurt'; break;
      case 'dash': k = 'dash'; break;
      case 'attack': k = `attack${Math.min(this.comboStep, 3) + 1}`; break;
      case 'airAttack': k = 'airattack'; break;
      case 'upAttack': k = 'upattack'; break;
      case 'slam': k = 'slam'; break;
      case 'charge': k = 'charge'; break;
      case 'heavy': k = 'heavy'; break;
      default:
        if (g) k = now < this.landUntil ? 'land' : Math.abs(b.velocity.x) > 25 ? 'run' : 'idle';
        else if (now < this.pogoAnimUntil && b.velocity.y < 0) k = 'pogo';
        else if (now - this.lastWallAt < 30 && this.wallDir !== 0 && this.inp.axisX() === this.wallDir && b.velocity.y > 0) k = 'wallslide';
        else k = b.velocity.y < -60 ? 'jump' : b.velocity.y < 70 ? 'apex' : 'fall';
    }
    // restart when the same action state is re-entered within one tick (e.g. airAttack -> normal -> airAttack)
    const reentered = st !== 'normal' && k === this.visKey && this.fsm.time < this.visStateTime;
    this.visStateTime = this.fsm.time;
    if (k !== this.visKey || reentered) {
      this.visKey = k;
      const key = `player-${k}`;
      if (this.scene.anims.exists(key)) this.play(key);
    }
    this.anims.timeScale = k === 'run' ? Phaser.Math.Clamp(Math.abs(b.velocity.x) / PLAYER.runSpeed, 0.6, 1.2) : 1;
    if (this.alive) this.setFlipX(this.facing < 0);
  }

  // ---------------------------------------------------------------- feel helpers
  private prevVy = 0;
  private lastDustAt = 0;
  private lastFacing: 1 | -1 = 1;

  /** highest point (smallest body.bottom) since leaving the ground, for landing strength */
  private airPeak = Number.POSITIVE_INFINITY;
  private lastRunFrame = 0;
  private stepFoot = 0;
  private lastGhostAt = 0;
  private lastLineAt = 0;
  private wasDashing = false;

  /** Feet dust colour for the current world. */
  private dustTint(): number {
    return MOVE_FX.dustTint[this.gs.def?.world] ?? 0xd8d0c4;
  }

  private dust(count: number, speed: number, dir = 0): void {
    this.gs.juice.dust(this.x - dir * 3, this.body.bottom, count, speed, dir, this.dustTint());
  }

  /** Landing: squash, dust and camera settle scaled by fall height / speed. */
  private onLand(): void {
    const f = MOVE_FX.feet;
    const fallH = Math.max(0, this.body.bottom - this.airPeak);
    const k = Math.max(landStrength(fallH, f.landFullHeight), Phaser.Math.Clamp(this.prevVy / PHYS.maxFall, 0, 1) * 0.6);
    const q = MOVE_FX.squash;
    const [sx, sy] = lerpPair(q.landMin, q.landMax, k);
    this.squash(sx, sy, q.landMs + k * 60);
    sfx.land();
    this.dust(Math.round(f.landDustMin + k * (f.landDustMax - f.landDustMin)), 0.25 + k * 0.7);
    const c = MOVE_FX.camera;
    const dip = settlePx(this.prevVy, c.settleMinVy, PLAYER.fastFallMax, c.settleMaxPx);
    if (dip > 0) this.gs.juice.kick(0, dip, c.settleMs); // no-op with Screen shake off
  }

  /** Skid puff when the stick reverses against a fast ground run. Step dust lives in footsteps(). */
  private runDust(time: number): void {
    if (!this.grounded || !this.fsm.is('normal')) {
      this.lastFacing = this.facing;
      return;
    }
    const vx = this.body.velocity.x;
    const f = MOVE_FX.feet;
    if (isSkid(vx, this.inp.axisX(), f.skidMinSpeed) && time - this.lastDustAt > f.skidEveryMs) {
      this.lastDustAt = time;
      const dir = Math.sign(vx) as 1 | -1;
      this.gs.juice.dust(this.x + dir * 4, this.body.bottom, 4, 0.5, dir, this.dustTint());
      if (this.facing !== this.lastFacing) {
        sfx.skid();
        this.squash(0.86, 1.08, 90);
      }
    }
    this.lastFacing = this.facing;
  }

  /** Step dust + soft step sound when the run animation plants a foot. */
  private footsteps(): void {
    const fr = this.visKey === 'run' ? this.anims.currentFrame?.index ?? 0 : 0;
    const prev = this.lastRunFrame;
    this.lastRunFrame = fr;
    if (!fr || !this.grounded || Math.abs(this.body.velocity.x) < MOVE_FX.feet.stepMinSpeed) return;
    if (!isFootfall(prev, fr, MOVE_FX.feet.runFootfallFrames)) return;
    this.stepFoot ^= 1;
    this.gs.juice.dust(this.x - this.facing * 3, this.body.bottom, 1, 0.15, -this.facing as 1 | -1, this.dustTint());
    sfx.step(this.stepFoot ? 1 : 0.9);
  }

  /** Held poses (float, fast-fall, wall slide), speed lines while falling fast, dash start/end squash. */
  private airFx(time: number, dt: number): void {
    const b = this.body;
    const q = MOVE_FX.squash;
    let target: readonly [number, number] = [1, 1];
    const st = this.fsm.current;
    if (!this.grounded && st === 'normal') {
      const wallSliding = time - this.lastWallAt < 30 && this.wallDir !== 0 && this.inp.axisX() === this.wallDir && b.velocity.y > 0;
      if (wallSliding) target = q.wallSlide;
      else if (this.inp.isDown('jump') && Math.abs(b.velocity.y) < PLAYER.apexThreshold) target = q.float;
      else if (this.inp.isDown('down') && b.velocity.y > PLAYER.apexThreshold) target = q.fastFall;
    }
    this.pose.x = smoothTo(this.pose.x, target[0], q.poseHalfLifeMs, dt);
    this.pose.y = smoothTo(this.pose.y, target[1], q.poseHalfLifeMs, dt);

    // speed lines while fast-falling / slamming
    const t = MOVE_FX.trails;
    const slamming = st === 'slam' && b.velocity.y > 0;
    if ((slamming || (!this.grounded && b.velocity.y >= t.lineMinVy)) && time - this.lastLineAt >= t.lineEveryMs) {
      this.lastLineAt = time;
      const n = slamming ? 2 : 1;
      for (let i = 0; i < n; i++) speedLine(this.gs, this.x + (Math.random() * 2 - 1) * 14, this.y + 4 + Math.random() * 10, -1, t.lineMs, slamming ? t.slamTint : 0xffffff);
    }

    // dash start / end
    const dashing = st === 'dash';
    if (dashing !== this.wasDashing) {
      if (dashing) this.squash(q.dashStart[0], q.dashStart[1], PLAYER.dashMs);
      else if (this.alive && st !== 'hurt') this.squash(q.dashEnd[0], q.dashEnd[1], 120);
      this.wasDashing = dashing;
    }
  }

  /** Afterimage every MOVE_FX.trails.ghostEveryMs (dash, slam, heavy). */
  private ghost(ms: number, tint: number): void {
    const now = this.gs.time.now;
    if (now - this.lastGhostAt < MOVE_FX.trails.ghostEveryMs) return;
    this.lastGhostAt = now;
    ghostTrail(this, ms, tint);
  }

  /** Apex hang while holding jump, fast-fall while holding down. */
  private updateGravity(): void {
    const b = this.body;
    let extra = 0;
    let maxFall = PHYS.maxFall;
    if (b.allowGravity && !this.grounded && this.fsm.is('normal', 'airAttack', 'upAttack')) {
      const fastFall = this.inp.isDown('down') && b.velocity.y > -20;
      if (fastFall) this.pogoFloatUntil = 0; // holding down cuts the post-pogo float short
      if (this.gs.time.now < this.pogoFloatUntil) extra = -PHYS.gravity * (1 - PLAYER.pogoGravityMul);
      else if (this.inp.isDown('jump') && Math.abs(b.velocity.y) < PLAYER.apexThreshold) extra = -PHYS.gravity * (1 - PLAYER.apexGravityMul);
      else if (fastFall) {
        extra = PLAYER.fastFallGravity;
        maxFall = PLAYER.fastFallMax;
      }
    }
    b.setGravityY(extra);
    b.setMaxVelocityY(this.fsm.is('slam') ? PLAYER.slamSpeed : maxFall);
  }

  /** If a rising jump clips a ceiling corner by a few px, slide around it and keep the jump. */
  private cornerCorrect(): void {
    const b = this.body;
    if (!b.blocked.up || this.prevVy > -80) return;
    const top = b.top - 2;
    const free = (dx: number) => !this.gs.isBlockAt(b.left + dx + 1, top) && !this.gs.isBlockAt(b.right + dx - 1, top);
    for (let i = 1; i <= PLAYER.cornerCorrectPx; i++) {
      for (const dx of [i, -i]) {
        if (free(dx)) {
          this.x += dx;
          b.x += dx;
          b.setVelocityY(this.prevVy);
          return;
        }
      }
    }
  }

  /** Face the held direction at the start of an attack (lets you turn and swing instantly). */
  private faceInput(): void {
    const ax = this.inp.axisX();
    if (ax !== 0) this.face(ax > 0 ? 1 : -1);
  }

  // ---------------------------------------------------------------- normal
  private updateNormal(dt: number): void {
    const now = this.gs.time.now;
    const inp = this.inp;
    if (now >= this.wallJumpLockUntil) this.moveX(dt);

    // drop through one-way
    if (inp.isDown('down') && inp.justPressed('jump') && this.grounded && this.gs.standingOnOneWay(this)) {
      this.dropThroughUntil = now + 220;
      inp.consume('jump');
      this.body.setVelocityY(40);
      return;
    }

    // wall slide
    const wallSliding = !this.grounded && now - this.lastWallAt < 30 && inp.axisX() === this.wallDir && this.body.velocity.y > 0;
    if (wallSliding) {
      this.body.setVelocityY(Math.min(this.body.velocity.y, PLAYER.wallSlideMax));
      this.face(this.wallDir > 0 ? -1 : 1);
      if (Math.random() < 0.12) this.gs.juice.dust(this.x + this.wallDir * 5, this.y + 2, 1, 0.1, -this.wallDir as 1 | -1, 0xaaaaaa);
    }

    // jump (buffered) — ground/coyote, wall jump, double jump
    if (inp.buffered('jump', PLAYER.jumpBufferMs)) {
      if (this.canJump()) {
        inp.consume('jump');
        this.doJump();
      } else if (now - this.lastWallAt < 110 && !this.grounded) {
        inp.consume('jump');
        this.doJump(PLAYER.wallJumpVelY);
        this.body.setVelocityX(-this.wallDir * PLAYER.wallJumpVelX);
        this.face(this.wallDir > 0 ? -1 : 1);
        this.wallJumpLockUntil = now + PLAYER.wallJumpLockMs;
        this.lastWallAt = -9999;
        if (this.stats.airDash) this.airDashes = 1;
      } else if (inp.justPressed('jump') && this.airJumps > 0) {
        inp.consume('jump');
        this.airJumps--;
        this.doJump(PLAYER.jumpVel * 0.9);
        this.gs.juice.ring(this.x, this.body.bottom, 0x7fdbff, 0.6);
      }
    }
    // variable jump height
    if (this.jumpHeld && !inp.isDown('jump')) {
      this.jumpHeld = false;
      if (this.body.velocity.y < 0) this.body.setVelocityY(this.body.velocity.y * PLAYER.jumpCutMul);
    }
    if (this.body.velocity.y >= 0) this.jumpHeld = false;

    this.checkActions();
  }

  /** Shared action transitions from normal state. */
  private checkActions(): boolean {
    const inp = this.inp;
    const now = this.gs.time.now;
    if (this.tryDash()) return true;
    const esLvl = this.stats.energySlashLvl;
    if (inp.justPressed('special') && esLvl > 0 && now - this.lastEnergySlashAt >= PLAYER.energySlashCooldownMs) {
      if (this.useStamina(esLvl >= 3 ? PLAYER.energySlashStaminaL3 : PLAYER.energySlashStamina)) {
        this.lastEnergySlashAt = now;
        this.gs.spawnEnergySlash(this.x + this.facing * 8, this.y - 1, this.facing);
        sfx.shoot();
        this.squash(1.2, 0.85);
        return false;
      }
    }
    if (inp.buffered('attack', 150)) {
      inp.consume('attack');
      if (!this.grounded && inp.isDown('down') && this.canSlam()) this.fsm.set('slam');
      else if (inp.isDown('up')) this.fsm.set('upAttack');
      else if (!this.grounded) this.fsm.set('airAttack');
      else {
        if (now < this.riposteUntil) this.comboStep = this.finisherStep();
        else if (now - this.lastAttackEndAt > PLAYER.comboWindowMs) this.comboStep = 0;
        this.riposteUntil = 0;
        this.fsm.set('attack');
      }
      return true;
    }
    return false;
  }

  private tryDash(): boolean {
    const inp = this.inp;
    if (!inp.buffered('dash', 120) || this.gs.time.now < this.dashReadyAt || !(this.grounded || this.airDashes > 0)) return false;
    inp.consume('dash');
    if (!this.useStamina(Math.round(PLAYER.dashStamina * this.stats.dashStaminaMul))) return false;
    if (!this.grounded) this.airDashes--;
    this.fsm.set('dash');
    return true;
  }

  /** Jump out of a swing: ground/coyote jump, else double jump. */
  private tryJumpCancel(): boolean {
    const inp = this.inp;
    if (!inp.buffered('jump', 80)) return false;
    if (this.canJump()) {
      inp.consume('jump');
      this.fsm.set('normal');
      this.doJump();
    } else if (!this.grounded && this.airJumps > 0) {
      inp.consume('jump');
      this.airJumps--;
      this.fsm.set('normal');
      this.doJump(PLAYER.jumpVel * 0.9);
      this.gs.juice.ring(this.x, this.body.bottom, 0x7fdbff, 0.6);
    } else return false;
    return true;
  }

  /** Swing cancels (jump and/or dash). Resets the combo when taken. */
  private trySwingCancel(jump: boolean): boolean {
    if (!((jump && this.tryJumpCancel()) || this.tryDash())) return false;
    this.lastAttackEndAt = this.gs.time.now;
    this.comboStep = 0;
    this.attackQueued = false;
    return true;
  }

  private finisherStep(): number {
    return Math.min(2, this.stats.comboLength - 1);
  }

  /** Standing on something (also during the gravity-less dash, where blocked.down may not report). */
  private nearGround(): boolean {
    return this.grounded || this.gs.isBlockAt(this.x, this.body.bottom + 2) || this.gs.standingOnOneWay(this);
  }

  // ---------------------------------------------------------------- dash
  private endPogoFloat(): void {
    this.pogoFloatUntil = 0;
    this.pogoAnimUntil = 0;
  }

  private enterDash(): void {
    this.endPogoFloat();
    const ax = this.inp.axisX();
    if (ax !== 0) this.face(ax > 0 ? 1 : -1);
    this.body.setAllowGravity(false);
    this.body.setVelocity(this.facing * PLAYER.dashSpeed, 0);
    this.iframesUntil = Math.max(this.iframesUntil, this.gs.time.now + PLAYER.dashMs);
    this.setTint(0xb8f2ff);
    sfx.dash();
  }
  private updateDash(): void {
    // afterimage trail
    this.ghost(MOVE_FX.trails.dashGhostMs, MOVE_FX.trails.dashTint);
    if (this.inp.buffered('attack', 80)) {
      // dash-slash: keeps the dash momentum (velocity set after exitDash ran)
      this.inp.consume('attack');
      if (this.nearGround()) {
        this.comboStep = 0;
        this.dashSlash = true;
        this.fsm.set('attack');
      } else if (this.inp.isDown('down') && this.canSlam()) this.fsm.set('slam');
      else {
        this.fsm.set('airAttack');
        this.body.setVelocityX(this.facing * PLAYER.runSlashSpeed * 1.2);
      }
      return;
    }
    if (this.fsm.time >= PLAYER.dashMs) this.fsm.set('normal');
    else if (this.inp.justPressed('jump') && this.canJump()) {
      // dash-jump keeps momentum
      this.fsm.set('normal');
      this.doJump();
      this.body.setVelocityX(this.facing * PLAYER.runSpeed * 1.3);
    }
  }
  private exitDash(): void {
    this.body.setAllowGravity(true);
    this.body.setVelocityX(this.facing * PLAYER.runSpeed);
    this.dashReadyAt = this.gs.time.now + PLAYER.dashCooldownMs;
    this.clearTint();
  }

  // ---------------------------------------------------------------- attacks
  /** Animated smear sprite (frame centred on the arc pivot) that follows the player. Visual only. */
  private showSlash(key: string, offX: number, offY: number, scale = 1, flipY = false): Phaser.GameObjects.Sprite {
    this.slash?.destroy();
    const s = this.gs.add.sprite(this.x, this.y, key).setDepth(21).setScale(scale).setFlipX(this.facing < 0).setFlipY(flipY);
    this.slash = s;
    this.slashOffset = { x: offX, y: offY };
    this.positionSlash();
    const done = () => {
      s.destroy();
      if (this.slash === s) this.slash = undefined;
    };
    if (this.gs.anims.exists(key)) {
      s.play(key);
      // additive arc trail: every smear frame leaves a fading afterglow in world space
      const t = MOVE_FX.trails;
      const glow = () => ghostTrail(s, t.arcFadeMs, undefined, { alpha: t.arcAlpha, depthOffset: -1, grow: 0.06 });
      glow();
      s.on(Phaser.Animations.Events.ANIMATION_UPDATE, glow);
      s.once(Phaser.Animations.Events.ANIMATION_COMPLETE, done);
    } else this.gs.tweens.add({ targets: s, alpha: 0, duration: 160, onComplete: done });
    return s;
  }
  private slashOffset = { x: 14, y: 0 };
  private positionSlash(): void {
    if (!this.slash) return;
    this.slash.setPosition(this.x + this.slashOffset.x * (this.slash.flipX ? -1 : 1), this.y + this.slashOffset.y);
  }

  /** Creates a hitbox relative to the player's facing. */
  private attackBox(offX: number, offY: number, w: number, h: number, ms: number, dmg: number, opts: Partial<HitInfo> & { kb?: number; lift?: number } = {}): Hitbox {
    const dir = this.facing;
    const box = new Hitbox(
      'player',
      () => ({ x: this.x + (dir > 0 ? offX : -offX - w), y: this.y + offY, w, h }),
      (t) => {
        const r = t.hurtRect();
        const d = r.x + r.w / 2 >= this.x ? 1 : -1;
        return {
          damage: dmg * this.stats.damageMul,
          kbX: d * (opts.kb ?? 140),
          kbY: -(opts.lift ?? 60),
          sourceX: this.x,
          heavy: opts.heavy,
          slam: opts.slam,
          kind: 'melee',
        };
      },
      ms,
      (t, res) => this.onAttackHit(res, opts, t),
    );
    return this.addMelee(box);
  }

  /** Player melee boxes die with the player and are cancelled when the player gets hit. */
  private meleeBoxes: Hitbox[] = [];
  private addMelee(box: Hitbox): Hitbox {
    this.meleeBoxes = this.meleeBoxes.filter((b) => !b.dead);
    this.meleeBoxes.push(box.ownedBy(this));
    return this.gs.damage.add(box);
  }
  private cancelMelee(): void {
    for (const b of this.meleeBoxes) b.kill();
    this.meleeBoxes = [];
  }

  private onAttackHit(res: 'hit' | 'blocked', opts: Partial<HitInfo>, struck?: Hurtable): void {
    if (!this.alive) return;
    // DamageSystem runs target.receiveHit right before this callback, so lastStruck is our target
    // (null for non-Enemy hurtables such as breakables: they get a plain light/heavy impact, no kill logic)
    // `struck` is passed by most hitboxes; fall back to lastStruck for callers that don't pass it
    const target = struck instanceof Enemy ? struck : struck ? null : Enemy.lastStruckFrame === this.gs.game.loop.frame ? Enemy.lastStruck : null;
    Enemy.lastStruck = null;
    const angle = opts.slam ? Math.PI / 2 : this.fsm.is('upAttack') ? -Math.PI / 2 : this.facing > 0 ? 0 : Math.PI;
    // impact point: where the swing meets the target's hurt box
    let ix = this.x + this.facing * 16, iy = this.y;
    if (target) {
      const r = target.hurtRect();
      ix = Phaser.Math.Clamp(ix, r.x, r.x + r.w);
      iy = Phaser.Math.Clamp(iy, r.y, r.y + r.h);
    }
    if (res === 'blocked') {
      sfx.parry();
      this.gs.juice.hitstop(JUICE.hitstopLight);
      this.gs.juice.spark(ix, iy, angle + Math.PI, 0xffe066, 0.8);
      this.gs.juice.rumble(0.3, 0.1, 50);
      this.body.setVelocityX(-this.facing * 160);
      return;
    }
    const heavy = !!opts.heavy;
    // escalate along the combo (1st..4th hit) and for a charged heavy
    const step = this.fsm.is('attack') ? this.comboStep : this.fsm.is('airAttack') ? Math.max(0, this.airComboStep - 1) : 0;
    const mul = hitImpactMul(this.fsm.current, this.comboStep, this.airComboStep, JUICE.comboMul, JUICE.chargedHeavyMul);
    const pitch = 1 + step * JUICE.comboPitchStep;
    if (target && !target.alive) {
      // killing blow: Enemy.die already fired the kill impact + kill sound; just the swing's crack
      if (heavy) sfx.heavyHit(pitch);
    } else if (target?.isBoss) {
      this.gs.juice.impact('bossHit', ix, iy, angle, heavy ? mul * 1.3 : mul);
      sfx.bossHit(pitch);
      duckMusic(...JUICE.duck.bossHit);
    } else {
      this.gs.juice.impact(heavy ? 'heavy' : 'light', ix, iy, angle, mul);
      if (heavy) {
        sfx.heavyHit(pitch);
        duckMusic(...JUICE.duck.heavy);
      } else sfx.hit(pitch);
    }
    if (this.stats.airDash) this.airDashes = 1;
    if (opts.slam) {
      // pogo only off targets ahead of the dive (no straight-down pogo); launches up, short lockout before the next slam
      if (struck && !this.isAhead(struck)) return;
      this.pogo();
    } else if (!this.grounded) {
      this.body.setVelocityY(Math.min(this.body.velocity.y, -120));
    } else {
      this.body.setVelocityX(-this.facing * 40);
    }
  }

  /** Opens this swing's parry window (attacking into a parryable hit parries it). */
  private openParry(upSlash: boolean, chargedHeavy = false): void {
    const now = this.gs.time.now;
    this.parryUpSlash = upSlash;
    this.parryActiveUntil = now + swingParryWindowMs({ sinceLastSwingEndMs: now - this.lastAttackEndAt, comboFollowup: this.swingFollowup, chargedHeavy, bonusMs: this.stats.parryBonusMs });
    this.swingFollowup = false;
  }
  private closeParry(): void {
    this.parryActiveUntil = 0;
  }

  /**
   * Swings started so far (ground/air/up attack, heavy, slam). Bumped on every state entry, so each
   * hit of a combo counts even though the FSM stays in 'attack' between hits. Read by Aurren.
   */
  get swingCount(): number {
    return this._swingCount;
  }

  private enterAttack(): void {
    this._swingCount++;
    this.faceInput();
    const step = this.comboStep;
    this.attackQueued = false;
    const fwd = this.body.velocity.x * this.facing; // momentum along facing
    const dashSlash = this.dashSlash;
    this.dashSlash = false;
    const runSlash = step === 0 && (dashSlash || (this.grounded && fwd >= PLAYER.runSpeed * 0.8));
    this.openParry(false);
    const dmg = PLAYER.attackDamage[Math.min(step, 2)];
    sfx.swing();
    this.lunge = runSlash || step >= 2;
    if (runSlash) {
      // running / dash slash: a lunge that keeps the run, slightly longer reach
      this.body.setVelocityX(this.facing * PLAYER.runSlashSpeed * (dashSlash ? 1.2 : 1));
      this.showSlash('fx-smear-h', 4, -1);
      this.attackBox(2, -12, 30, 22, 110, dmg, { kb: 160, lift: 50 });
      this.squash(1.2, 0.85, 90);
    } else if (step === 3) {
      // Flurry upgrade: spinning slash hits both sides
      this.body.setVelocityX(this.facing * Math.max(80, fwd));
      this.showSlash('fx-smear-spin', 0, -1);
      this.attackBox(-22, -14, 44, 28, 120, 2, { kb: 220, lift: 140, heavy: true });
      this.squash(1.3, 0.8);
    } else {
      if (step === 2) {
        this.body.setVelocityX(this.facing * Math.max(120, fwd));
        this.showSlash('fx-smear-fin', 2, -2);
      } else this.showSlash('fx-smear-h', 2, step === 1 ? 1 : -1, 1, step === 1);
      this.attackBox(2, -12, step === 2 ? 28 : 24, 22, 100, dmg, { kb: step === 2 ? 240 : 130, lift: step === 2 ? 120 : 50, heavy: step === 2 });
      this.squash(1.15, 0.9, 80);
    }
  }
  private updateAttack(dt: number): void {
    const step = this.comboStep;
    const dur = step >= 3 ? 300 : PLAYER.attackMs[step];
    const t = this.fsm.time;
    // steer while swinging; lunges keep their momentum and bleed it off gently
    if (this.lunge) this.glideX(dt, PLAYER.attackMoveMul, 150);
    else this.moveX(dt, PLAYER.attackMoveMul, false);
    if (this.inp.buffered('attack', 150) && t > 60) {
      this.attackQueued = true;
      this.inp.consume('attack');
    }
    // jump/dash cancel once the hitbox is out
    if (t > PLAYER.cancelAfterMs && this.trySwingCancel(true)) return;
    if (t >= dur) {
      const now = this.gs.time.now;
      this.lastAttackEndAt = now;
      const riposte = now < this.riposteUntil;
      if (this.attackQueued && (riposte || step + 1 < this.stats.comboLength)) {
        this.comboStep = riposte ? this.finisherStep() : step + 1;
        this.riposteUntil = 0;
        this.swingFollowup = true;
        this.fsm.set('attack');
      } else {
        this.comboStep = this.attackQueued ? 0 : (step + 1) % this.stats.comboLength;
        // holding attack through a swing (any combo step) charges a heavy
        if (this.inp.isDown('attack') && this.inp.holdTime('attack') > 120) this.fsm.set('charge');
        else this.fsm.set('normal');
      }
    }
  }

  private enterAirAttack(): void {
    this._swingCount++;
    // off a wall slide: swing away from the wall
    if (!this.grounded && this.wallDir !== 0 && this.gs.time.now - this.lastWallAt < 30) this.face(this.wallDir > 0 ? -1 : 1);
    else this.faceInput();
    const second = this.swingFollowup;
    this.airComboStep = second ? this.airComboStep + 1 : 1;
    this.attackQueued = false;
    this.openParry(false);
    sfx.swing();
    this.showSlash('fx-smear-h', 2, second ? 1 : -1, 1, second);
    this.attackBox(0, -14, 26, 26, 110, 1, { kb: 120, lift: 80 });
  }
  private updateAirAttack(dt: number): void {
    const t = this.fsm.time;
    this.moveX(dt, 0.8, false);
    if (t > PLAYER.airComboMs && this.inp.buffered('attack', 150)) {
      this.attackQueued = true;
      this.inp.consume('attack');
    }
    if (t > PLAYER.cancelAfterMs && this.trySwingCancel(true)) return;
    if (this.grounded) {
      this.lastAttackEndAt = this.gs.time.now;
      if (this.attackQueued || this.inp.buffered('attack', 150)) {
        // land straight into the ground combo
        this.inp.consume('attack');
        this.comboStep = Math.min(1, this.stats.comboLength - 1);
        this.swingFollowup = true;
        this.fsm.set('attack');
      } else this.fsm.set('normal');
      return;
    }
    // two-hit air chain
    if (this.attackQueued && this.airComboStep < 2 && t >= PLAYER.airComboChainMs) {
      this.lastAttackEndAt = this.gs.time.now;
      this.swingFollowup = true;
      this.fsm.set('airAttack');
      return;
    }
    if (t >= PLAYER.airAttackMs) {
      this.lastAttackEndAt = this.gs.time.now;
      this.fsm.set('normal');
    }
  }

  private slamBox?: Hitbox;
  private spikeSafeUntil = -9999;
  /** Pogo bounce off an enemy or spikes: launches up, floaty fall, short lockout before the next slam. */
  private pogo(): void {
    const now = this.gs.time.now;
    this.body.setVelocityY(-PLAYER.slamBounceVel);
    this.lastPogoAt = now;
    this.pogoFloatUntil = now + PLAYER.pogoFloatMs;
    this.pogoAnimUntil = now + 330;
    this.gs.juice.burst(this.x, this.body.bottom, 0xffe066, 8, 0.6);
    if (this.fsm.is('slam')) this.fsm.set('normal');
  }
  /** Slamming into spikes pogos off them instead of taking damage. */
  trySpikePogo(spike: Rect): boolean {
    if (!this.alive || !this.fsm.is('slam') || !this.slamBox || this.slamBox.dead) return false;
    if (!overlaps(this.slamBox.rect(), spike)) return false;
    this.spikeSafeUntil = this.gs.time.now + PLAYER.spikePogoSafeMs;
    this.gs.juice.impact('light', this.x + this.facing * 8, spike.y, Math.PI / 2);
    sfx.parry();
    if (this.stats.airDash) this.airDashes = 1;
    this.pogo();
    return true;
  }
  get spikeSafe(): boolean {
    return this.gs.time.now < this.spikeSafeUntil;
  }
  private canSlam(): boolean {
    return this.gs.time.now - this.lastPogoAt >= PLAYER.pogoRefreshMs;
  }
  /** Target's center is on the facing side, past the player's own half-width. */
  private isAhead(target: Hurtable): boolean {
    const r = target.hurtRect();
    return (r.x + r.w / 2 - this.x) * this.facing > this.body.width / 2;
  }
  private enterSlam(): void {
    this._swingCount++;
    this.body.setVelocity(0, -80);
    this.setTint(0xffe066);
    this.slamBox = undefined;
  }
  /** Leaving slam by any route (landing, pogo, timeout, hurt, death) ends its hitbox and looping smear. */
  private exitSlam(next: string): void {
    this.slamBox?.kill();
    this.slamBox = undefined;
    if (this.slash?.texture.key === 'fx-smear-down') {
      this.slash.destroy();
      this.slash = undefined;
    }
    // hurt/dead apply their own tint (hit flash / death tint) right around this call
    if (next !== 'hurt' && next !== 'dead') this.clearTint();
  }
  private updateSlam(): void {
    const t = this.fsm.time;
    if (t < 90) return; // short hang
    if (!this.slamBox) {
      sfx.swing();
      // diagonal dive: hitbox leans forward-down
      this.slamBox = this.attackBox(4, 4, 18, 20, 2000, PLAYER.slamDamage, { slam: true, kb: 60, lift: 0 });
      this.slash?.destroy();
      this.slash = this.gs.add
        .sprite(this.x, this.y + 10, 'fx-smear-down')
        .setDepth(21)
        .setAlpha(0.9)
        .setBlendMode(Phaser.BlendModes.ADD)
        .setFlipX(this.facing < 0)
        .setRotation((-this.facing * Math.PI) / 4);
      if (this.gs.anims.exists('fx-smear-down')) this.slash.play('fx-smear-down');
      this.slashOffset = { x: 8, y: 10 };
    }
    this.body.setVelocity(this.facing * PLAYER.slamSpeedX, PLAYER.slamSpeed);
    this.ghost(MOVE_FX.trails.slamGhostMs, MOVE_FX.trails.slamTint);
    if (this.grounded) {
      this.slamBox.kill();
      this.slash?.destroy();
      this.slash = undefined;
      this.clearTint();
      this.gs.juice.impact('land', this.x, this.body.bottom, Math.PI / 2);
      this.gs.juice.burst(this.x, this.body.bottom, 0xffe066, 12, 0.8);
      this.gs.juice.dust(this.x, this.body.bottom, 10, 1, 0, this.dustTint());
      sfx.land();
      this.squash(1.4, 0.7, 160);
      // small shockwave on landing
      this.addMelee(
        new Hitbox('player', () => ({ x: this.x - 24, y: this.body.bottom - 10, w: 48, h: 10 }), (tg) => {
          const r = tg.hurtRect();
          return { damage: 1 * this.stats.damageMul, kbX: (r.x + r.w / 2 > this.x ? 1 : -1) * 160, kbY: -120, sourceX: this.x, kind: 'melee' };
        }, 60),
      );
      this.fsm.set('normal');
    } else if (this.fsm.current === 'slam' && this.slamBox.dead) {
      this.clearTint();
      this.fsm.set('normal');
    }
  }

  // heavy: keep holding attack through a swing; walk slowly while charging
  private chargeFx?: Phaser.GameObjects.Sprite;
  private chargeLight?: Phaser.GameObjects.Image;
  private chargeP = 0;
  private enterCharge(): void {
    this.chargeP = 0;
    this.chargeFx = this.gs.add.sprite(this.x, this.y, 'fx-aura').setDepth(19).setScale(1.3).setAlpha(0.3).setBlendMode(Phaser.BlendModes.ADD);
    if (this.gs.anims.exists('fx-aura')) this.chargeFx.play('fx-aura');
    this.chargeLight = addLight(this.gs, this.x, this.y - 2, 0xffd96a, 22, 0.15);
    sfx.charge();
  }
  private updateCharge(dt: number): void {
    this.moveX(dt, PLAYER.chargeMoveMul);
    // remember progress while held; holdTime() is 0 on the frame the button is released
    if (this.inp.isDown('attack')) this.chargeP = Math.min(1, this.inp.holdTime('attack') / PLAYER.heavyChargeMs);
    const p = this.chargeP;
    bus.emit('charge', p);
    const pulse = p >= 1 ? 0.5 + 0.5 * Math.sin(this.gs.time.now / 50) : 0;
    this.chargeFx?.setPosition(this.x, this.y - 2).setScale(1.4 - p * 0.5 + pulse * 0.1).setAlpha(0.25 + p * 0.65);
    this.chargeLight?.setPosition(this.x, this.y - 2).setAlpha(0.12 + p * 0.35 + pulse * 0.15).setScale((18 + p * 14 + pulse * 4) / 32);
    if (p > 0.3 && Math.random() < p * 0.35) {
      const a = Math.random() * Math.PI * 2;
      const sp = this.gs.add.image(this.x + Math.cos(a) * 14, this.y - 2 + Math.sin(a) * 12, 'fx-px1').setTint(0xffd96a).setDepth(22).setBlendMode(Phaser.BlendModes.ADD);
      this.gs.tweens.add({ targets: sp, x: this.x + this.facing * -6, y: this.y - 4, alpha: 0.2, duration: 220, onComplete: () => sp.destroy() });
    }
    if (p >= 1 && this.fsm.time % 120 < 17) this.setTintFill(0xffe066);
    else this.clearTint();
    if (!this.inp.isDown('attack')) {
      if (p >= 1 && this.useStamina(PLAYER.heavyStamina)) this.fsm.set('heavy');
      else this.fsm.set('normal');
    } else if (this.inp.justPressed('dash') || this.inp.justPressed('jump')) {
      this.fsm.set('normal');
    }
  }
  private exitCharge(): void {
    this.chargeFx?.destroy();
    this.chargeFx = undefined;
    this.chargeLight?.destroy();
    this.chargeLight = undefined;
    this.clearTint();
    bus.emit('charge', 0);
  }
  private enterHeavy(): void {
    this._swingCount++;
    this.faceInput();
    sfx.heavyHit();
    this.body.setVelocityX(this.facing * 260);
    this.openParry(false, true);
    this.showSlash('fx-smear-fin', 4, -3, 1.3);
    this.attackBox(0, -18, 40, 32, 140, PLAYER.heavyDamage, { kb: 320, lift: 160, heavy: true });
    this.gs.juice.shake(JUICE.shakeLight);
  }
  private updateHeavy(dt: number): void {
    this.glideX(dt, 0.3, 90); // lunge with light steering
    if (this.fsm.time < 220) this.ghost(MOVE_FX.trails.heavyGhostMs, MOVE_FX.trails.heavyTint);
    if (this.fsm.time > 140 && this.trySwingCancel(false)) return;
    if (this.fsm.time > 360) {
      this.lastAttackEndAt = this.gs.time.now;
      this.comboStep = 0;
      this.fsm.set('normal');
    }
  }

  // ---------------------------------------------------------------- parry (by swinging)
  /** True during the opening of a swing: a parryable hit landing now is parried instead. */
  get parrying(): boolean {
    return this.gs.time.now <= this.parryActiveUntil && this.fsm.is('attack', 'airAttack', 'upAttack', 'heavy');
  }
  /** called on successful parry; the swing keeps going so its hitbox still lands */
  private onParrySuccess(): void {
    const now = this.gs.time.now;
    sfx.parry();
    duckMusic(...JUICE.duck.parry);
    this.gs.juice.impact('parry', this.x + this.facing * 10, this.y, this.facing > 0 ? 0 : Math.PI);
    this.gs.juice.ring(this.x + this.facing * 10, this.y, 0xffffff, 1.2);
    this.gs.juice.parryFlash(this.x + this.facing * 8, this.y - 4);
    this.gs.juice.burst(this.x + this.facing * 10, this.y, 0xffffff, 14, 1.2);
    this.gs.juice.floatText(this.x, this.y - 18, 'PARRY!', '#ffe066');
    this.stamina = Math.min(this.stats.maxStamina, this.stamina + PLAYER.parryStaminaRefund + this.stats.parryRefundBonus);
    bus.emit('stamina', this.stamina, this.stats.maxStamina);
    this.iframesUntil = Math.max(this.iframesUntil, now + 300);
    this.speedBuffUntil = now + PLAYER.parrySpeedBuffMs;
    // riposte: the next ground swing is a combo finisher. Window stays open (e.g. two arrows).
    this.riposteUntil = now + 600;
  }

  // ---------------------------------------------------------------- damage
  receiveHit(hit: HitInfo): 'hit' | 'blocked' | 'ignored' {
    if (!this.alive) return 'ignored';
    const now = this.gs.time.now;
    if (this.parrying && canParryHit(hit, this.x, this.facing, this.parryUpSlash)) {
      this.onParrySuccess();
      return 'blocked';
    }
    if (cheats.god) return 'ignored'; // pits still respawn the player (GameScene)
    if (now < this.iframesUntil && hit.kind !== 'hazard') return 'ignored';
    // dash i-frames last the whole dash state even when slowmo stretches it past its real-time iframesUntil
    if (PLAYER.dashIframes && this.fsm.is('dash') && hit.kind !== 'hazard') return 'ignored';
    if (hit.kind === 'hazard' && now < this.iframesUntil - PLAYER.hurtIframesMs + 200) return 'ignored';
    const dmg = Math.max(1, Math.round(hit.damage * this.stats.incomingDamageMul));
    this.hp = Math.max(0, this.hp - dmg);
    this.damageTaken += dmg;
    this.iframesUntil = now + PLAYER.hurtIframesMs;
    if (this.hp <= 0 && this.stats.secondWind && !this.secondWindUsed) this.triggerSecondWind(now);
    this.emitStats();
    this.updateLowHpMuffle();
    sfx.hurt();
    this.gs.juice.impact('hurt', this.x, this.y, hit.sourceX > this.x ? Math.PI : 0);
    this.gs.juice.flash(this, 90, 0xff4466);
    this.gs.juice.burst(this.x, this.y, 0xff4466, 10);
    this.gs.cameras.main.flash(80, 120, 0, 20);
    this.slash?.destroy();
    this.slash = undefined;
    this.cancelMelee();
    this.closeParry();
    this.body.setAllowGravity(true);
    if (this.hp <= 0) {
      this.fsm.set('dead');
      return 'hit';
    }
    this.endPogoFloat();
    // enter hurt first: exit hooks (e.g. exitDash) set velocity and would overwrite the knockback
    this.fsm.set('hurt');
    this.body.setVelocity(hit.kbX || (this.x >= hit.sourceX ? 160 : -160), hit.kbY || -180);
    return 'hit';
  }

  private updateHurt(): void {
    if (this.fsm.time > PLAYER.hurtCancelMs && (this.inp.buffered('dash', 100) || this.inp.buffered('attack', 100))) {
      this.fsm.set('normal');
      this.checkActions();
      return;
    }
    if (this.fsm.time > PLAYER.hurtMs) this.fsm.set('normal');
  }

  // ---------------------------------------------------------------- up attack
  private enterUpAttack(): void {
    this._swingCount++;
    sfx.swing();
    this.faceInput();
    this.openParry(true); // covers above, so parries from either side
    this.showSlash('fx-smear-up', 0, -12);
    const box = new Hitbox(
      'player',
      () => ({ x: this.x - 13, y: this.y - 38, w: 26, h: 30 }),
      () => ({ damage: 1 * this.stats.damageMul, kbX: this.facing * 40, kbY: -220, sourceX: this.x, kind: 'melee', up: true }),
      110,
      (_t, res) => this.onAttackHit(res, {}),
    );
    this.addMelee(box);
  }
  private updateUpAttack(dt: number): void {
    this.moveX(dt, this.grounded ? PLAYER.attackMoveMul : 0.8, false);
    if (this.fsm.time > 110 && this.trySwingCancel(false)) return;
    if (this.fsm.time >= 220) {
      this.lastAttackEndAt = this.gs.time.now;
      this.fsm.set('normal');
    }
  }

  /** Second Wind: a lethal hit leaves 1 hp and long iframes, once per level. */
  private triggerSecondWind(now: number): void {
    this.secondWindUsed = true;
    this.hp = 1;
    this.iframesUntil = now + 1400;
    sfx.heal();
    this.gs.juice.ring(this.x, this.y - 6, 0xffd96a, 1.6);
    this.gs.juice.burst(this.x, this.y - 6, 0xffd96a, 18, 1.3);
    this.gs.juice.floatText(this.x, this.y - 22, 'SECOND WIND!', '#ffd96a');
  }

  heal(n: number): void {
    this.hp = Math.min(this.stats.maxHp, this.hp + n);
    this.emitStats();
    this.updateLowHpMuffle();
  }

  /** Music is muffled while alive at <= JUICE.lowHp HP (cleared on heal, death and scene shutdown). */
  private updateLowHpMuffle(): void {
    setMuffle('lowhp', this.hp > 0 && this.hp <= JUICE.lowHp, JUICE.muffleHz);
  }

  /** Respawn at a position after falling in a pit / hazard (if still alive). */
  teleportSafe(): void {
    if (!this.alive) return;
    this.setPosition(this.safePos.x, this.safePos.y);
    this.body.reset(this.safePos.x, this.safePos.y);
    this.fsm.set('normal');
  }

  private enterDead(): void {
    this.alive = false;
    this.cancelMelee();
    this.body.setVelocity(0, -200);
    this.body.checkCollision.none = true;
    sfx.die();
    this.setTint(0xff4466);
    this.gs.tweens.add({ targets: this, alpha: 0.5, duration: 700 });
    this.gs.time.delayedCall(1100, () => this.gs.onPlayerDead());
  }
}
