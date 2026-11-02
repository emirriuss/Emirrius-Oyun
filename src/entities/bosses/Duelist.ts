import Phaser from 'phaser';
import { Boss } from './Boss';
import { Enemy, UNPARRYABLE_TINT } from '../Enemy';
import { Hitbox } from '../../combat/Hitbox';
import type { HitInfo } from '../../combat/types';
import type { GameScene } from '../../scenes/GameScene';
import { glow } from '../../core/Fx';
import { sfx } from '../../systems/sfx';
import { TILE } from '../../config';
import {
  pickDuelistMove,
  duelistTimings,
  cutColumns,
  DUELIST_HIGH_PX,
  SHADOW_RESPAWN_MS,
  type DuelistMove,
  type DuelistTimings,
} from '../../combat/duelistPlan';

/** Delay helper that respects death / parry-stun (and, for the boss, move cancellation). */
type Wait = (ms: number, fn: () => void) => void;

/** Held poses that override the movement anims. */
const POSES = new Set(['throw', 'sheathe', 'draw', 'guard', 'rise', 'plunge', 'stuck', 'hurt']);

/** Visual only: duelist-style animation key for `sheet` ('duelist' / 'duelist-one' / 'duelist-shadow'). */
function duelistAnim(e: Enemy, sheet: string, pose: string): string {
  if (e.alpha < 0.3) return sheet + '-blink';
  if (e.stunned) return sheet + '-hurt';
  if (pose && POSES.has(pose)) return sheet + '-' + pose;
  if (e.telegraphing) return sheet + '-windup';
  if (Math.abs(e.body.velocity.x) > 200) return sheet + '-dash';
  if (!e.body.blocked.down) return sheet + '-air';
  return Math.abs(e.body.velocity.x) > 5 ? sheet + '-run' : sheet + '-idle';
}

/**
 * Shared dash-slash for the duelist and its shadow. White tell = parry it; `parryable=false`
 * gives the red tell (dodge / dash through).
 */
function dashSlash(e: Enemy, wait: Wait, tele: number, speed: number, then: () => void, parryable = true): void {
  e.body.setVelocityX(0);
  e.facePlayer();
  e.telegraph(tele, 0xffffff, !parryable);
  wait(tele, () => {
    e.body.setVelocityX(e.facing * speed);
    e.meleeBox(-4, -12, parryable ? 30 : 36, 24, 260, 1, parryable, 220);
    sfx.dash();
    const shadow = e.texture.key === 'duelist-shadow';
    const trail = e.gs.time.addEvent({
      delay: 25,
      repeat: 9,
      callback: () => {
        if (!e.active) return;
        const g = e.gs.add.image(e.x, e.y, e.texture.key, e.frame.name).setFlipX(e.flipX).setTintFill(shadow ? 0x5b2a86 : parryable ? 0xe63946 : UNPARRYABLE_TINT).setAlpha(0.45).setDepth(14);
        e.gs.tweens.add({ targets: g, alpha: 0, duration: 200, onComplete: () => g.destroy() });
      },
    });
    wait(280, () => {
      trail.remove();
      e.body.setVelocityX(0);
      then();
    });
  });
}

/** Hop + fan of `n` blades aimed at the player (angle offset `off` lets two fans interleave). */
function throwFan(e: Enemy, n: number, off = 0): void {
  const base = Math.atan2(e.player.y - e.y, e.player.x - e.x) + off;
  for (let i = 0; i < n; i++) {
    const a = base + (i - (n - 1) / 2) * 0.22;
    e.shoot('blade', Math.cos(a) * 210, Math.sin(a) * 210, { rotate: true });
  }
  sfx.shoot();
}

/** Phase-3 shadow twin: a weaker mirror fighter the boss can also direct (pincer, crossed fans). */
class Shadow extends Enemy {
  private cd = 2600;
  /** running its own or a commanded move */
  busy = false;
  /** stand still (boss is casting Thousand Cuts) */
  hold = false;
  private readonly wait: Wait = (ms, fn) => this.later(ms, fn);

  constructor(gs: GameScene, x: number, y: number) {
    super(gs, x, y, gs.textures.exists('duelist-shadow') ? 'duelist-shadow' : 'duelist', { hp: 10, bodyW: 12, bodyH: 22, shards: 5, contactDamage: 0 });
    glow(this, 0xc77dff, 1.5); // purple rim so it reads on the dark brick wall
    if (this.art === 'duelist') {
      this.baseTint = 0x222244;
      this.setTint(this.baseTint);
    }
    this.setAlpha(0.85);
    this.deathTint = 0x8a4fc7;
  }

  private later(ms: number, fn: () => void): void {
    this.gs.time.delayedCall(ms, () => {
      if (!this.alive) return;
      if (this.stunned) this.later(this.stunUntil - this.gs.time.now + 10, fn);
      else fn();
    });
  }

  protected animKey(): string {
    return duelistAnim(this, this.art, '');
  }

  protected think(dt: number): void {
    if (this.busy) return;
    if (this.hold) {
      this.body.setVelocityX(0);
      return;
    }
    this.cd -= dt;
    this.facePlayer();
    const dx = Math.abs(this.dxToPlayer());
    this.body.setVelocityX(dx > 70 ? this.facing * 70 : dx < 40 ? -this.facing * 60 : 0);
    if (this.cd <= 0) {
      this.busy = true;
      dashSlash(this, this.wait, 520, 280, () => {
        this.busy = false;
        this.cd = 2600;
      });
    }
  }

  warpTo(x: number, y: number): void {
    this.gs.juice.burst(this.x, this.y, 0x8a4fc7, 10);
    this.body.reset(x, y);
    this.gs.juice.burst(this.x, this.y, 0x8a4fc7, 10);
  }

  /** Boss-directed dash-slash after `delay`. */
  cmdDash(delay: number, tele: number, speed: number): void {
    this.busy = true;
    this.body.setVelocityX(0);
    this.later(delay, () =>
      dashSlash(this, this.wait, tele, speed, () => {
        this.busy = false;
        this.cd = 2200;
      }),
    );
  }

  /** Boss-directed fan. */
  cmdFan(n: number, tele: number, off: number): void {
    this.busy = true;
    this.body.setVelocityX(0);
    if (this.body.blocked.down) this.body.setVelocityY(-280);
    this.telegraph(tele, 0xffffff);
    this.later(tele, () => {
      throwFan(this, n, off);
      this.later(400, () => {
        this.busy = false;
        this.cd = 2200;
      });
    });
  }
}

/**
 * World 2: TWIN BLADES, a samurai duelist. Rewards parrying, then mixes in red moves to dodge.
 *  P1 "One Blade"  (100-66%): dash combo, Iaido Draw (punish), Rising Cut vs ledges, fan, backstep.
 *  P2 "Twin Blades" (66-33%): draws the 2nd blade. Triple combo with a red thrust, Cross Cut,
 *     Mirror Guard (hit it and he counters; wait and it breaks), Falling Moon plunge, blink.
 *  P3 "Shadow Duet" (33-0%): the shadow twin joins: pincers, crossed fans, Thousand Cuts finisher.
 *     Killing the shadow staggers him; it returns after SHADOW_RESPAWN_MS.
 * Move choice and timings live in combat/duelistPlan.ts.
 */
export class Duelist extends Boss {
  private shadow?: Shadow;
  private shadowHandled = true;
  private shadowDownMs = 0;
  private hist: DuelistMove[] = [];
  /** bumped to cancel a running move chain (phase change, stagger, guard counter) */
  private gen = 0;
  /** arena floor (y of the boss's feet at spawn) */
  private readonly floorY: number;
  private sheetKey: string;
  private guarding = false;
  private cutting = false;
  private temp: Phaser.GameObjects.GameObject[] = [];
  private readonly wait: Wait = (ms, fn) => this.step(ms, fn);

  constructor(gs: GameScene, x: number, y: number) {
    const one = gs.textures.exists('duelist-one');
    super(gs, x, y, one ? 'duelist-one' : 'duelist', 'TWIN BLADES', { hp: 60, bodyW: 12, bodyH: 22, contactDamage: 0 });
    this.sheetKey = one ? 'duelist-one' : 'duelist';
    this.floorY = y + 8;
    this.thresholds = [0.66, 0.33];
    this.hearts = { periodicMs: 26000, maxOnField: 1, perParries: 4, onPhase: 1 };
    this.deathTint = 0xe0443e;
    this.once(Phaser.GameObjects.Events.DESTROY, () => this.clearTemp());
  }

  private get t(): DuelistTimings {
    return duelistTimings(this.phase);
  }

  protected animKey(): string {
    return duelistAnim(this, this.sheetKey, this.curPose);
  }

  // ------------------------------------------------------------------ plumbing
  /** later() that is dropped if the move chain was cancelled meanwhile. */
  private step(ms: number, fn: () => void): void {
    const g = this.gen;
    this.later(ms, () => {
      if (g === this.gen) fn();
    });
  }

  /** End the current move. */
  private finish(cd = this.t.cooldown): void {
    this.busy = false;
    this.cooldown = cd;
  }

  /** Kill any running chain and restore the physics state moves may have changed. */
  private cancelMove(): void {
    this.gen++;
    this.guarding = false;
    this.body.enable = true;
    this.body.setAllowGravity(true);
    this.body.checkCollision.none = false;
    this.setAlpha(1);
    if (this.cutting) this.endCuts();
    this.clearTemp();
  }

  /** Track a scene object this move owns (destroyed on cancel / death). */
  private keep<T extends Phaser.GameObjects.GameObject>(o: T): T {
    this.temp = this.temp.filter((x) => x.active);
    this.temp.push(o);
    return o;
  }

  private clearTemp(): void {
    for (const o of this.temp) o.destroy();
    this.temp = [];
  }

  private feetY(): number {
    return this.floorY - this.height / 2;
  }

  private clampX(x: number, pad = 18): number {
    return Phaser.Math.Clamp(x, TILE + pad, this.gs.worldWidth - TILE - pad);
  }

  protected filterHit(_hit: HitInfo): 'hit' | 'blocked' {
    if (!this.guarding) return 'hit';
    this.counter();
    return 'blocked';
  }

  // ------------------------------------------------------------------ phases
  protected onPhase(n: number): void {
    this.cancelMove();
    this.drawSecondBlade();
    this.setPose('guard', n === 2 ? 900 : 1200);
    if (n === 2) {
      this.gs.juice.floatText(this.x, this.y - 24, 'TWIN BLADES', '#ff8a8a');
      this.transform(900);
    } else if (n === 3) {
      this.gs.juice.floatText(this.x, this.y - 24, 'SHADOW DUET', '#c77dff');
      this.transform(1200, () => this.spawnShadow());
    }
  }

  private drawSecondBlade(): void {
    if (this.sheetKey === 'duelist') return;
    this.sheetKey = 'duelist';
    this.setTexture('duelist');
    this.gs.juice.burst(this.x, this.y - 4, 0xffffff, 10);
    sfx.iaido();
  }

  private spawnShadow(): void {
    if (this.shadow?.alive || !this.alive) return;
    const x = this.clampX(this.x - this.facing * 40);
    this.shadow = new Shadow(this.gs, x, this.floorY - 8);
    this.gs.enemies.add(this.shadow);
    this.gs.juice.ring(this.shadow.x, this.shadow.y, 0x8a4fc7, 2);
    this.shadowHandled = false;
    this.shadowDownMs = 0;
  }

  /** Phase 3 bookkeeping: stagger when the shadow falls, bring it back later. */
  private tickShadow(dt: number): void {
    if (this.phase < 3 || this.transforming) return;
    if (this.shadow?.alive) return;
    if (this.shadow && !this.shadowHandled) {
      this.shadowHandled = true;
      this.shadowDownMs = 0;
      if (!this.cutting) {
        this.cancelMove();
        this.gs.juice.floatText(this.x, this.y - 24, 'SHAKEN', '#ffd166');
        this.recover(1200, 'hurt', this.t.cooldown);
      }
      return;
    }
    this.shadowDownMs += dt;
    if (this.shadowDownMs >= SHADOW_RESPAWN_MS && !this.busy) this.spawnShadow();
  }

  // ------------------------------------------------------------------ AI
  protected think(dt: number): void {
    this.tickShadow(dt);
    if (this.busy) return;
    this.cooldown -= dt;
    this.facePlayer();
    const dx = Math.abs(this.dxToPlayer());
    const run = this.phase === 1 ? 110 : this.phase === 2 ? 130 : 140;
    // circle at mid range
    if (dx > 110) this.body.setVelocityX(this.facing * run);
    else if (dx < 50) this.body.setVelocityX(-this.facing * (run - 20));
    else this.body.setVelocityX(0);
    if (this.onGround && this.body.blocked.left !== this.body.blocked.right && Math.random() < 0.02) this.body.setVelocityY(-300);
    if (this.cooldown > 0 || !this.onGround) return;

    const m = pickDuelistMove(
      {
        phase: this.phase,
        dx,
        high: this.player.body.bottom < this.floorY - DUELIST_HIGH_PX,
        shadow: !!this.shadow?.alive && !this.shadow.busy,
      },
      this.hist,
    );
    this.hist.push(m);
    if (this.hist.length > 12) this.hist.shift();
    this.busy = true;
    this.moves[m]();
  }

  private readonly moves: Record<DuelistMove, () => void> = {
    combo: () => this.combo(2, false),
    triple: () => this.combo(3, true),
    iaido: () => this.iaido(),
    rising: () => this.rising(),
    fan: () => this.fan(),
    backstep: () => this.backstep(),
    crossCut: () => this.crossCut(),
    guard: () => this.guard(),
    fallingMoon: () => this.fallingMoon(),
    blink: () => this.blink(),
    pincer: () => this.pincer(),
    crossedFans: () => this.crossedFans(),
    thousandCuts: () => this.thousandCuts(),
  };

  // ------------------------------------------------------------------ P1 moves
  /** `hits` dash-slashes; `redLast` makes the finisher an unparryable thrust. */
  private combo(hits: number, redLast: boolean): void {
    const t = this.t;
    const go = (i: number) => {
      if (i >= hits) return this.step(140, () => this.finish());
      const red = redLast && i === hits - 1;
      dashSlash(this, this.wait, i === 0 ? t.dash : red ? t.thrust : t.chain, red ? 380 : 320, () => this.step(120, () => go(i + 1)), !red);
    };
    go(0);
  }

  /** Sheathe, glint, then an instant long cut. Parry or dodge it, then punish the follow-through. */
  private iaido(): void {
    const t = this.t;
    this.body.setVelocityX(0);
    this.facePlayer();
    this.setPose('sheathe', t.iaido + 40);
    sfx.sheathe();
    this.telegraph(t.iaido, 0xffffff);
    this.step(Math.max(0, t.iaido - 180), () => {
      const glint = this.keep(this.gs.add.star(this.x + this.facing * 5, this.y + 2, 4, 1, 5, 0xffffff).setDepth(41));
      this.gs.tweens.add({ targets: glint, scale: 2, alpha: 0, angle: 90, duration: 180, onComplete: () => glint.destroy() });
    });
    this.step(t.iaido, () => {
      const dir = this.facing;
      const x0 = this.x;
      const x1 = this.clampX(x0 + dir * 132);
      const left = Math.min(x0, x1) - 6;
      const w = Math.abs(x1 - x0) + 12;
      const top = this.y - 12;
      this.gs.damage.add(
        new Hitbox(
          'enemy',
          () => ({ x: left, y: top, w, h: 22 }),
          () => ({ damage: 1, kbX: dir * 240, kbY: -180, sourceX: x0, parryable: true, kind: 'melee' }),
          130,
          (_t, res) => {
            if (res === 'blocked' && this.alive) this.onParried();
          },
        ).ownedBy(this),
      );
      this.body.reset(x1, this.y);
      const streak = this.gs.add.rectangle(left + w / 2, this.y - 1, w, 2, 0xffffff).setDepth(16);
      this.gs.tweens.add({ targets: streak, alpha: 0, scaleY: 3, duration: 260, onComplete: () => streak.destroy() });
      this.gs.juice.burst(x1, this.y, 0xffffff, 8);
      this.gs.juice.shake(0.004, 90);
      sfx.iaido();
      this.setPose('draw', 200);
      this.step(150, () => this.recover(t.recoverIaido, 'draw', t.cooldown));
    });
  }

  /** Anti-air: jumping upward slash at a player on a ledge. */
  private rising(): void {
    const t = this.t;
    this.body.setVelocityX(0);
    this.facePlayer();
    this.telegraph(t.rising, 0xffffff);
    this.step(t.rising, () => {
      const dx = Phaser.Math.Clamp(this.player.x - this.x, -140, 140);
      this.body.setVelocity(dx * 1.8, -520);
      this.setPose('rise', 420);
      this.meleeBox(-6, -34, 26, 40, 380, 1, true, 200);
      sfx.swing();
      this.step(560, () => this.finish(t.cooldown + 150));
    });
  }

  private fan(): void {
    const t = this.t;
    this.body.setVelocityX(0);
    if (this.onGround) this.body.setVelocityY(-280);
    this.telegraph(t.fan, 0xffffff);
    this.step(t.fan, () => {
      this.setPose('throw', 300);
      throwFan(this, this.phase === 1 ? 3 : 5);
      this.step(450, () => this.finish());
    });
  }

  /** Hop away; the picker likes to follow it with an Iaido from range. */
  private backstep(): void {
    this.facePlayer();
    this.body.setVelocity(-this.facing * 230, -220);
    sfx.jump();
    this.step(380, () => {
      this.body.setVelocityX(0);
      this.finish(160);
    });
  }

  // ------------------------------------------------------------------ P2 moves
  /** X-shaped slash wave(s) along the floor. Jump it, or parry to send it back. */
  private crossCut(): void {
    const t = this.t;
    this.body.setVelocityX(0);
    this.facePlayer();
    this.setPose('sheathe', t.crossCut);
    this.telegraph(t.crossCut, 0xffffff);
    this.step(t.crossCut, () => {
      const dir = this.facing;
      const n = this.phase >= 3 ? 2 : 1;
      const tex = this.gs.textures.exists('duelist-x') ? 'duelist-x' : 'blade';
      for (let i = 0; i < n; i++) {
        this.step(i * 280, () => {
          this.setPose('draw', 220);
          sfx.iaido();
          const p = this.gs.spawnProjectile(this.x + dir * 12, this.floorY - 9, tex, dir * 200, 0, 'enemy', { damage: 1, lifeMs: 2600, owner: this });
          p.body.setAllowGravity(false);
        });
      }
      this.step(280 * n + 200, () => this.finish());
    });
  }

  /** Mirror Guard: a hit is blocked and answered by a red counter; waiting it out breaks the stance. */
  private guard(): void {
    const t = this.t;
    this.body.setVelocityX(0);
    this.facePlayer();
    this.guarding = true;
    this.setPose('guard', t.guard);
    sfx.guardUp();
    this.gs.juice.floatText(this.x, this.y - 24, 'GUARD', '#7fdbff');
    const pulses = Math.floor(t.guard / 300);
    for (let i = 0; i < pulses; i++) this.step(i * 300, () => this.gs.juice.ring(this.x, this.y, 0x7fdbff, 0.9));
    this.step(t.guard, () => {
      this.guarding = false;
      this.gs.juice.floatText(this.x, this.y - 24, 'OPEN', '#ffd166');
      this.recover(t.recoverGuard, 'stuck', t.cooldown);
    });
  }

  private counter(): void {
    const t = this.t;
    this.gen++; // drop the guard's timeout
    this.guarding = false;
    sfx.guardClang();
    this.facePlayer();
    this.setPose('guard', t.counter);
    this.telegraph(t.counter, 0xffffff, true);
    this.step(t.counter, () => {
      this.body.setVelocityX(this.facing * 300);
      this.meleeBox(-4, -14, 40, 28, 200, 1, false, 260);
      sfx.swing();
      this.step(220, () => {
        this.body.setVelocityX(0);
        this.finish();
      });
    });
  }

  /** Leap high, track the player, red plunge, blade stuck in the floor. */
  private fallingMoon(): void {
    const t = this.t;
    this.body.setVelocityX(0);
    this.facePlayer();
    this.setPose('sheathe', 380);
    this.telegraph(380, 0xffffff, true);
    this.step(380, () => {
      const dur = 380;
      const tx = this.clampX(this.player.x);
      const ty = Math.max(TILE * 2 + 12, this.floorY - 150);
      this.body.setAllowGravity(false);
      this.body.checkCollision.none = true;
      this.body.setVelocity((tx - this.x) / (dur / 1000), (ty - this.y) / (dur / 1000));
      this.setPose('rise', dur);
      sfx.jump();
      this.step(dur, () => {
        this.body.setVelocity(0, 0);
        this.setPose('plunge', t.fallHover + 600);
        const marker = this.keep(this.gs.add.rectangle(this.x, this.floorY - 1, 24, 2, UNPARRYABLE_TINT).setDepth(40));
        const lockAt = this.gs.time.now + t.fallHover * 0.7;
        const track = () => {
          const lock = this.gs.time.now >= lockAt;
          this.body.setVelocityX(lock ? 0 : (this.clampX(this.player.x) - this.x) * 6);
          marker.setPosition(this.x, this.floorY - 1).setAlpha(lock ? (Math.floor(this.gs.time.now / 60) % 2 ? 1 : 0.3) : 0.8);
        };
        const hover = (left: number) => {
          track();
          if (left > 0) this.step(16, () => hover(left - 16));
          else this.dive(marker);
        };
        hover(t.fallHover);
      });
    });
  }

  private dive(marker: Phaser.GameObjects.Rectangle): void {
    const t = this.t;
    this.body.setVelocity(0, 720);
    this.meleeBox(-12, 0, 36, 20, 700, 1, false, 220);
    const end = this.gs.time.now + 900;
    const fall = () => {
      if (this.body.bottom < this.floorY - 1 && this.gs.time.now < end) return this.step(16, fall);
      this.body.setVelocity(0, 0);
      this.body.reset(this.x, this.feetY());
      this.body.setAllowGravity(true);
      this.body.checkCollision.none = false;
      marker.destroy();
      this.gs.juice.impact('slam', this.x, this.floorY, Math.PI / 2);
      this.shockwaves(this.phase >= 3 ? 170 : 150);
      this.recover(t.recoverFall, 'stuck', t.cooldown);
    };
    fall();
  }

  /** Vanish, reappear behind the player, slash. */
  private blink(): void {
    this.gs.juice.burst(this.x, this.y, 0xe63946, 14);
    this.setAlpha(0);
    this.body.enable = false;
    this.step(400, () => {
      const side = this.player.facing;
      this.body.enable = true;
      this.body.reset(this.clampX(this.player.x - side * 36, 6), this.player.y - 8);
      this.setAlpha(1);
      this.gs.juice.burst(this.x, this.y, 0xe63946, 14);
      dashSlash(this, this.wait, this.phase >= 3 ? 240 : 280, 260, () => this.step(150, () => this.finish()));
    });
  }

  // ------------------------------------------------------------------ P3 moves
  /** He and the shadow appear on both sides of the player and dash in, `pincerGap` apart. */
  private pincer(): void {
    const s = this.shadow;
    if (!s?.alive) return this.finish(200);
    const t = this.t;
    const px = this.player.x;
    const a = this.clampX(px - 110), b = this.clampX(px + 110);
    const [mine, theirs] = Math.abs(this.x - a) < Math.abs(this.x - b) ? [a, b] : [b, a];
    this.gs.juice.burst(this.x, this.y, 0xe63946, 10);
    this.body.reset(mine, this.feetY());
    this.gs.juice.burst(this.x, this.y, 0xe63946, 10);
    s.warpTo(theirs, this.floorY - s.height / 2);
    dashSlash(this, this.wait, t.dash + 100, 340, () => this.step(200, () => this.finish(t.cooldown + 200)));
    s.cmdDash(t.pincerGap, t.dash + 100, 340);
  }

  /** Both throw fans at once; their blades interleave. */
  private crossedFans(): void {
    const s = this.shadow;
    if (!s?.alive) return this.finish(200);
    const t = this.t;
    s.cmdFan(3, t.fan + 120, 0.11);
    this.body.setVelocityX(0);
    if (this.onGround) this.body.setVelocityY(-280);
    this.telegraph(t.fan + 120, 0xffffff);
    this.step(t.fan + 120, () => {
      this.setPose('throw', 300);
      throwFan(this, 4, -0.11);
      this.step(450, () => this.finish());
    });
  }

  /**
   * Finisher: the room dims, red columns mark the floor, then they fire in a sweep. The gaps are
   * always safe. Afterwards he's open for the longest punish of the fight.
   */
  private thousandCuts(): void {
    const t = this.t;
    const gs = this.gs;
    this.cutting = true;
    if (this.shadow?.alive) {
      this.shadow.hold = true;
      this.shadow.body.setVelocityX(0);
    }
    this.body.setVelocityX(0);
    // step to the centre of the arena
    gs.juice.burst(this.x, this.y, 0xe63946, 12);
    this.body.reset(gs.worldWidth / 2, this.feetY());
    gs.juice.burst(this.x, this.y, 0xe63946, 12);
    this.setPose('sheathe', 3000);
    sfx.sheathe();
    const cam = gs.cameras.main;
    const dim = gs.add.rectangle(cam.width / 2, cam.height / 2, cam.width, cam.height, 0x000000, 0).setScrollFactor(0).setDepth(30);
    gs.tweens.add({ targets: dim, alpha: 0.35, duration: 300 });
    this.keep(dim);

    const top = TILE;
    const bottom = this.floorY;
    const cols = cutColumns(TILE, gs.worldWidth - TILE, this.player.x > gs.worldWidth / 2 ? false : true);
    const revealStep = 90;
    const reveal = cols.length * revealStep + 500;
    const fireStep = 170;
    this.telegraph(reveal, 0xffffff, true);
    const rects = cols.map((c) => {
      const r = gs.add.rectangle(c.x + c.w / 2, (top + bottom) / 2, c.w - 4, bottom - top, UNPARRYABLE_TINT, 0.16).setStrokeStyle(1, UNPARRYABLE_TINT, 0.9).setDepth(31).setVisible(false);
      this.keep(r);
      this.step(c.order * revealStep, () => {
        r.setVisible(true);
        sfx.telegraph();
      });
      return r;
    });
    this.step(reveal, () => {
      cols.forEach((c, i) =>
        this.step(c.order * fireStep, () => {
          const r = rects[i];
          r.setFillStyle(0xffffff, 0.85);
          gs.tweens.add({ targets: r, alpha: 0, scaleX: 0.2, duration: 160 });
          gs.damage.add(
            new Hitbox(
              'enemy',
              () => ({ x: c.x + 2, y: top, w: c.w - 4, h: bottom - top }),
              () => ({ damage: 1, kbX: (this.player.x > c.x + c.w / 2 ? 1 : -1) * 200, kbY: -200, sourceX: c.x + c.w / 2, parryable: false, kind: 'melee' }),
              110,
            ).ownedBy(this),
          );
          sfx.cut(1 + c.order * 0.04);
          gs.juice.shake(0.003, 60);
        }),
      );
      this.step(cols.length * fireStep + 200, () => {
        this.endCuts();
        this.setPose('stuck', t.recoverCuts);
        this.recover(t.recoverCuts, 'stuck', t.cooldown);
      });
    });
  }

  private endCuts(): void {
    this.cutting = false;
    this.clearTemp();
    if (this.shadow?.alive) this.shadow.hold = false;
  }

  die(reward = true): void {
    if (!this.alive) return;
    this.guarding = false;
    if (this.cutting) this.endCuts();
    this.clearTemp();
    if (this.shadow?.alive) this.shadow.die(false);
    super.die(reward);
  }
}
