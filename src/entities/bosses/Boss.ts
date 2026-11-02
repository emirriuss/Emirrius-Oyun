import Phaser from 'phaser';
import { Enemy, type EnemyOpts } from '../Enemy';
import type { Projectile } from '../Projectile';
import { bus } from '../../core/events';
import { sfx } from '../../systems/sfx';
import { bossIntro } from '../../core/cinematics';
import { duckMusic } from '../../systems/music';
import { JUICE, TILE } from '../../config';
import type { HitInfo } from '../../combat/types';
import { shouldSpawnHeart, parryDropsHeart, pickHeartX } from '../../combat/heartPlan';
import type { GameScene } from '../../scenes/GameScene';

/** Opt-in heart drops during a boss fight (all off by default). */
export interface HeartConfig {
  /** ms of active fight between ceiling hearts (only while the player is hurt); 0 = off */
  periodicMs: number;
  /** max hearts lying in the arena for periodic drops */
  maxOnField: number;
  /** every Nth parry pops a heart out of the boss; 0 = off */
  perParries: number;
  /** hearts dropped by transform() */
  onPhase: number;
}

/**
 * Boss base: super armor (no knockback), HP bar on the HUD, phase thresholds.
 * Subclasses pick attacks in `think` and react to `onPhase(n)`.
 */
export abstract class Boss extends Enemy {
  phase = 1;
  /** hp fractions at which next phase begins, e.g. [0.5] or [0.66, 0.33] */
  protected thresholds: number[] = [0.5];
  protected busy = false;
  protected cooldown = 1200;
  private introUntil: number;
  /** visual only: named pose shown by animKey() until poseUntil */
  protected pose = '';
  protected poseUntil = 0;
  /** punish window (recover()): takes x1.25 damage */
  protected vulnerable = false;
  /** phase change (transform()): immune, busy */
  protected transforming = false;
  /** true while a recover() is running (attack() won't clear busy early) */
  private recovering = false;
  private recoverId = 0;
  protected hearts: HeartConfig = { periodicMs: 0, maxOnField: 1, perParries: 0, onPhase: 0 };
  private heartTimer = 0;
  private heartsPending = 0;
  private parries = 0;
  private dizzy?: Phaser.GameObjects.Sprite;

  constructor(gs: GameScene, x: number, y: number, tex: string, public bossName: string, o: EnemyOpts) {
    super(gs, x, y, tex, { shards: 40, contactDamage: 1, ...o });
    this.isBoss = true;
    this.superArmor = true;
    // idle through the intro cinematic (camera pan + name card), a bit past the player's release
    this.introUntil = gs.time.now + 2400;
    this.setAlpha(0);
    gs.tweens.add({ targets: this, alpha: 1, duration: 600 });
    bus.emit('boss', bossName, this.hp, this.maxHp);
    // roar, shake and the 'boss-intro' name card are fired by the cinematic when the camera arrives
    bossIntro(gs, this);
    this.once(Phaser.GameObjects.Events.DESTROY, () => this.dizzy?.destroy());
  }

  /** Intro cinematic was skipped: start fighting within `ms` (never later than planned). */
  endIntro(ms: number): void {
    this.introUntil = Math.min(this.introUntil, this.gs.time.now + ms);
  }

  /** Visual only: hold a named pose (e.g. 'punch') for ms. */
  protected setPose(name: string, ms: number): void {
    this.pose = name;
    this.poseUntil = this.gs.time.now + ms;
  }
  /** Current visual pose or '' when expired. */
  protected get curPose(): string {
    return this.gs.time.now < this.poseUntil ? this.pose : '';
  }

  tick(time: number, dt: number): void {
    if (this.gs.time.now < this.introUntil) {
      this.body.setVelocityX(0);
      this.facePlayer();
      this.setFlipX(this.facing < 0);
      const k = this.animKey();
      if (k && this.anims.currentAnim?.key !== k && this.scene.anims.exists(k)) this.play(k);
      return;
    }
    super.tick(time, dt);
    if (!this.alive) return;
    if (this.hearts.periodicMs > 0 && this.player.alive) this.tickHearts(dt);
    this.dizzy?.setPosition(this.x, this.body.top - 6);
  }

  protected damageTakenMul(): number {
    return this.transforming ? 0 : this.vulnerable ? 1.25 : 1;
  }

  /**
   * Punish window after a heavy attack: stands still for `ms` in `pose` with dizzy stars, takes x1.25
   * damage, then sets `cooldown`. Keeps `busy` even if the surrounding attack() timer ends first.
   */
  protected recover(ms: number, pose: string, cooldownAfter = 600): void {
    this.busy = true;
    this.recovering = true;
    this.vulnerable = true;
    if (this.body.allowGravity) this.body.setVelocityX(0);
    else this.body.setVelocity(0, 0);
    this.setPose(pose, ms);
    this.showDizzy();
    const id = ++this.recoverId;
    this.later(ms, () => {
      if (!this.recovering || id !== this.recoverId) return; // cut short by transform() or a newer recover()
      this.endRecover();
      this.busy = false;
      this.cooldown = cooldownAfter;
    });
  }

  /** Drop a running punish window without its timer releasing `busy` later (scripted cutscenes). */
  protected cancelRecover(): void {
    this.recoverId++;
    if (this.recovering) this.endRecover();
  }

  private endRecover(): void {
    this.recovering = false;
    this.vulnerable = false;
    this.dizzy?.destroy();
    this.dizzy = undefined;
  }

  private showDizzy(): void {
    this.dizzy?.destroy();
    const key = this.scene.textures.exists('dizzy-stars') ? 'dizzy-stars' : 'twinkle';
    const d = this.gs.add.sprite(this.x, this.body.top - 6, key).setDepth(41);
    if (key === 'twinkle') d.setTint(0xffd96a);
    else if (this.scene.anims.exists('dizzy-stars-spin')) d.play('dizzy-stars-spin');
    this.dizzy = d;
  }

  /**
   * Invulnerable phase change for `ms`: stops, clears enemy projectiles, drops `hearts.onPhase`
   * hearts, then runs `fn` (arena changes, new sheet...).
   */
  protected transform(ms: number, fn?: () => void): void {
    if (this.recovering) this.endRecover();
    this.transforming = true;
    this.busy = true;
    if (this.body.allowGravity) this.body.setVelocityX(0);
    else this.body.setVelocity(0, 0);
    for (const p of [...this.gs.projectiles.getChildren()] as Projectile[]) {
      if (p.team !== 'enemy' || p.dead) continue;
      p.dead = true;
      p.hitbox.kill();
      this.gs.juice.burst(p.x, p.y, 0xffffff, 4, 0.5);
      p.destroy();
    }
    for (let i = 0; i < this.hearts.onPhase; i++) this.gs.spawnHeart(this.x, this.y - 8, 'pop');
    this.gs.juice.ring(this.x, this.y, 0xffffff, 3);
    this.later(ms, () => {
      this.transforming = false;
      this.busy = false;
      this.cooldown = 500;
      fn?.();
    });
  }

  onParried(): void {
    super.onParried();
    this.parries++;
    if (parryDropsHeart(this.parries, this.hearts.perParries)) this.gs.spawnHeart(this.x, this.y - 8, 'pop');
  }

  /** Active-fight timer for periodic ceiling hearts. */
  private tickHearts(dt: number): void {
    const h = this.hearts;
    this.heartTimer = Math.min(h.periodicMs, this.heartTimer + dt);
    const p = this.player;
    const ok = shouldSpawnHeart({
      elapsedSinceLast: this.heartTimer,
      periodicMs: h.periodicMs,
      playerHp: p.hp,
      playerMaxHp: p.stats.maxHp,
      heartsOnField: this.gs.countPickups('heart') + this.heartsPending,
      maxOnField: h.maxOnField,
    });
    if (!ok) return;
    this.heartTimer = 0;
    this.ceilingHeart();
  }

  /** Pink marker on the ceiling, then a heart drifts down far from the boss. */
  private ceilingHeart(): void {
    const gs = this.gs;
    const cam = gs.cameras.main;
    const minX = Math.max(cam.scrollX, TILE);
    const maxX = Math.min(cam.scrollX + cam.width, gs.worldWidth - TILE);
    const x = Math.round(pickHeartX(this.x, minX, maxX));
    const top = Math.max(gs.ceilingBelow(x, cam.scrollY), TILE);
    const marker = gs.add.rectangle(x, top + 3, 6, 4, 0xff8fb8).setDepth(40);
    gs.tweens.add({ targets: marker, alpha: 0.3, yoyo: true, repeat: 2, duration: 100, onComplete: () => marker.destroy() });
    this.heartsPending++;
    gs.time.delayedCall(600, () => {
      this.heartsPending--;
      gs.spawnHeart(x, top + 10, 'drift');
    });
  }

  protected onHurt(_hit: HitInfo): void {
    bus.emit('boss', this.bossName, Math.max(0, this.hp), this.maxHp);
    const frac = this.hp / this.maxHp;
    while (this.phase - 1 < this.thresholds.length && frac <= this.thresholds[this.phase - 1] && this.hp > 0) {
      this.phase++;
      sfx.bossRoar();
      // phase change = big beat: slowmo + heavy rumble (shake comes with the preset)
      this.gs.juice.impact('killBig', this.x, this.y, this.facing > 0 ? Math.PI : 0);
      duckMusic(...JUICE.duck.killBig);
      this.gs.juice.ring(this.x, this.y, 0xff006e, 2.5);
      this.onPhase(this.phase);
    }
  }

  protected onPhase(_n: number): void {}

  /** Run an attack: marks busy until `ms` then sets cooldown. */
  protected attack(ms: number, cooldown: number, fn: () => void): void {
    this.busy = true;
    fn();
    this.gs.time.delayedCall(ms, () => {
      if (this.recovering || this.transforming) return; // they clear busy themselves
      this.busy = false;
      this.cooldown = cooldown;
    });
  }

  /** schedule callback only if still alive */
  /** schedule callback only if still alive; steps due during a parry stun wait until it ends */
  protected later(ms: number, fn: () => void): void {
    this.gs.time.delayedCall(ms, () => {
      if (!this.alive) return;
      if (this.stunned) this.later(this.stunUntil - this.gs.time.now + 10, fn);
      else fn();
    });
  }

  /** Ground shockwave projectiles traveling left/right from x. */
  protected shockwaves(speed = 160, dmg = 1): void {
    const y = this.body.bottom - 5;
    for (const d of [-1, 1]) {
      const p = this.gs.spawnProjectile(this.x + d * 16, y, 'shockwave', d * speed, 0, 'enemy', { damage: dmg, lifeMs: 2500, owner: this });
      p.body.setAllowGravity(false);
    }
  }

  /** Projectiles falling from the top of the screen. */
  protected rain(count: number, tex = 'orb', spread = 400): void {
    const cam = this.gs.cameras.main;
    for (let i = 0; i < count; i++) {
      this.later(i * 120, () => {
        const x = Math.max(cam.scrollX + 24, Math.min(cam.scrollX + cam.width - 24, this.player.x + (Math.random() - 0.5) * spread));
        const top = this.gs.ceilingBelow(x, cam.scrollY);
        const marker = this.gs.add.rectangle(x, top + 4, 2, 8, 0xff006e).setDepth(40);
        this.gs.tweens.add({ targets: marker, alpha: 0, duration: 450, onComplete: () => marker.destroy() });
        // open sky: start just off-screen; under a ceiling: emerge from its underside
        const y = top > cam.scrollY ? top + 7 : top - 8;
        this.later(450, () => this.gs.spawnProjectile(x, y, tex, 0, 180, 'enemy', { damage: 1, lifeMs: 3000, owner: this }));
      });
    }
  }

  die(reward = true): void {
    if (!this.alive) return;
    this.dizzy?.destroy();
    this.gs.juice.impact('killBig', this.x, this.y);
    super.die(reward);
  }
}
