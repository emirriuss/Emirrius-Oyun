import Phaser from 'phaser';
import { JUICE, PHYS } from '../config';
import { isBigKill, squashAt } from '../core/juiceMath';
import { duckMusic } from '../systems/music';
import { Hitbox } from '../combat/Hitbox';
import type { HitInfo, Hurtable, Rect } from '../combat/types';
import { sfx } from '../systems/sfx';
import type { GameScene } from '../scenes/GameScene';

/** Telegraph flash colour for attacks that can't be parried (dodge / dash through them). */
export const UNPARRYABLE_TINT = 0xff1a1a;

export interface EnemyOpts {
  hp: number;
  bodyW: number;
  bodyH: number;
  /** offset of body inside texture; defaults to centered bottom */
  offX?: number;
  offY?: number;
  gravity?: boolean;
  contactDamage?: number;
  shards?: number;
  /** knockback resistance 0..1 */
  kbResist?: number;
  elite?: boolean;
  /** elite tint */
  eliteTint?: number;
}

/**
 * Base class for all enemies & bosses.
 * Subclasses implement `think(dt)` — called each frame when not stunned/knocked back.
 * Use helpers below (dirToPlayer, ledgeAhead, meleeBox, shoot, telegraph...) to build AI.
 */
export abstract class Enemy extends Phaser.Physics.Arcade.Sprite implements Hurtable {
  team = 'enemy' as const;
  alive = true;
  declare body: Phaser.Physics.Arcade.Body;
  hp: number;
  maxHp: number;
  contactDamage: number;
  shards: number;
  kbResist: number;
  elite: boolean;
  facing: 1 | -1 = -1;
  /** while > now, AI is suspended (knockback / stun) */
  stunUntil = 0;
  /** if true, enemy cannot be knocked back or stunned by normal hits (bosses) */
  superArmor = false;
  /** extra damage taken multiplier while stunned by parry */
  private parryStunned = false;
  isBoss = false;
  /** sheet key actually used ('slime' or 'slime-elite'); anims are `${art}-<name>` */
  protected art: string;
  /** fallback tint (only for elites without a dedicated elite sheet) */
  protected baseTint: number | null = null;
  /** colour of the death pop / burst */
  protected deathTint = 0xffffff;
  /** visual only: while > now the enemy is in a telegraph wind-up */
  protected teleUntil = 0;
  private alert?: Phaser.GameObjects.Sprite;

  /**
   * The enemy whose receiveHit ran last. DamageSystem calls receiveHit and then the hitbox's onHit
   * synchronously, so Player.onAttackHit reads this to know what it struck (boss? killed?).
   */
  static lastStruck: Enemy | null = null;
  /** game loop frame lastStruck was set on (stale values from other hitboxes are ignored) */
  static lastStruckFrame = -1;

  // visual-only transform (applied around rendering, so the physics body never changes size)
  private sq = { sx: 1, sy: 1, t: 0, ms: 0 };
  private recoil = { px: 0, t: 0, ms: 0 };
  /** resting visual scale multiplier (e.g. Slime breathing); visual only */
  protected breath = { x: 1, y: 1 };
  private visSaved: { x: number; y: number; sx: number; sy: number } | null = null;
  private wasGround = true;
  private prevVy = 0;
  /** hit that is killing this enemy (set right before die() by receiveHit) */
  private killBlow: HitInfo | null = null;

  constructor(public gs: GameScene, x: number, y: number, texture: string, o: EnemyOpts) {
    super(gs, x, y, o.elite && gs.textures.exists(texture + '-elite') ? texture + '-elite' : texture);
    this.art = this.texture.key;
    gs.add.existing(this);
    gs.physics.add.existing(this);
    this.elite = !!o.elite;
    const hpMul = gs.enemyHpMul * (this.elite ? 1.8 : 1);
    this.maxHp = this.hp = Math.max(1, Math.round(o.hp * hpMul));
    this.contactDamage = o.contactDamage ?? 1;
    this.shards = Math.round((o.shards ?? 2) * (this.elite ? 2.5 : 1));
    this.kbResist = o.kbResist ?? 0;
    const offX = o.offX ?? (this.width - o.bodyW) / 2;
    const offY = o.offY ?? this.height - o.bodyH;
    this.body.setSize(o.bodyW, o.bodyH).setOffset(offX, offY);
    this.body.setAllowGravity(o.gravity !== false);
    this.body.setMaxVelocityY(PHYS.maxFall);
    if (this.elite && this.art === texture) {
      this.baseTint = o.eliteTint ?? 0xff4d6d;
      this.setTint(this.baseTint);
    }
    this.once(Phaser.GameObjects.Events.DESTROY, () => this.alert?.destroy());
    gs.events.on(Phaser.Scenes.Events.PRE_RENDER, this.applyVisual, this);
    gs.events.on(Phaser.Scenes.Events.RENDER, this.restoreVisual, this);
    this.once(Phaser.GameObjects.Events.DESTROY, () => {
      gs.events.off(Phaser.Scenes.Events.PRE_RENDER, this.applyVisual, this);
      gs.events.off(Phaser.Scenes.Events.RENDER, this.restoreVisual, this);
    });
    this.setDepth(15);
    // spawn at cell bottom
    if (o.gravity !== false) this.y = y + 8 - this.height / 2;
    gs.damage.register(this);
  }

  // ------------------------------------------------------------- abstract AI
  protected abstract think(dt: number): void;

  /** per-frame update called by GameScene (skipped during hitstop) */
  tick(_time: number, dt: number): void {
    if (!this.alive) return;
    const now = this.gs.time.now;
    this.sq.t += dt;
    this.recoil.t += dt;
    if (now < this.stunUntil) {
      if (this.body.blocked.down) this.body.setVelocityX(this.body.velocity.x * 0.85);
    } else {
      this.parryStunned = false;
      this.think(dt);
    }
    this.setFlipX(this.facing < 0);
    this.updateAnim();
    this.groundSquash();
    this.alert?.setPosition(this.x, this.alertY());
    // contact damage
    const p = this.gs.player;
    if (this.contactDamage > 0 && p.alive) {
      const a = this.hurtRect();
      const b = p.hurtRect();
      if (a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y) {
        p.receiveHit({ damage: this.contactDamage, kbX: (p.x >= this.x ? 1 : -1) * 170, kbY: -170, sourceX: this.x, kind: 'contact' });
      }
    }
    // fell out of the world
    if (this.y > this.gs.worldHeight + 64) this.die(false);
  }

  // ------------------------------------------------------------- visuals
  /**
   * Animation to play this frame (e.g. 'slime-move'), or null to keep the static texture.
   * Override in subclasses; called every tick after AI. Gameplay must not depend on it.
   */
  protected animKey(): string | null {
    return null;
  }
  /** Animation key for this enemy's sheet, e.g. anim('idle') -> 'slime-elite-idle'. */
  protected anim(name: string): string {
    return `${this.art}-${name}`;
  }
  /** true during a telegraph() wind-up (visual only) */
  get telegraphing(): boolean {
    return this.gs.time.now < this.teleUntil;
  }
  /** Restore the resting tint after flashes. */
  protected restoreTint(): void {
    if (this.baseTint !== null) this.setTint(this.baseTint);
    else this.clearTint();
  }
  private alertY(): number {
    return (this.body ? this.body.top : this.y - this.height / 2) - 8;
  }
  /** Pops a blinking '!' above the head for `ms`. */
  private showAlert(ms: number): void {
    if (!this.scene.textures.exists('alert')) return;
    this.alert?.destroy();
    const a = this.gs.add.sprite(this.x, this.alertY(), 'alert').setDepth(41).setScale(0);
    if (this.scene.anims.exists('alert-blink')) a.play('alert-blink');
    this.alert = a;
    this.gs.tweens.add({ targets: a, scale: this.isBoss ? 1.5 : 1, duration: 140, ease: 'Back.out' });
    this.gs.time.delayedCall(Math.max(ms, 200), () => {
      if (this.alert === a) this.alert = undefined;
      if (!a.active) return;
      this.gs.tweens.add({ targets: a, alpha: 0, scale: 0.4, duration: 120, onComplete: () => a.destroy() });
    });
  }
  /** true while AI is suspended by knockback/stun (useful for a 'hurt' anim) */
  get stunned(): boolean {
    return this.gs.time.now < this.stunUntil;
  }
  private updateAnim(): void {
    const k = this.animKey();
    if (k && this.anims.currentAnim?.key !== k && this.scene.anims.exists(k)) this.play(k);
  }

  // ------------------------------------------------------------- squash & recoil (visual only)
  /**
   * Squash/stretch: the sprite is drawn at (sx, sy) and eases back to rest over `ms` (scaled game time;
   * holds during hitstop). Ground enemies pivot at their feet. Never touches the physics body.
   */
  squash(sx: number, sy: number, ms = 120): void {
    if (this.isBoss) {
      const m = JUICE.bossFeedbackMul;
      sx = 1 + (sx - 1) * m;
      sy = 1 + (sy - 1) * m;
    }
    this.sq = { sx, sy, t: 0, ms };
  }
  /** Visual knock of `px` (signed, along x) that springs back over `ms`. */
  protected recoilBy(px: number, ms = 120): void {
    this.recoil = { px, t: 0, ms };
  }
  /** Jump stretch / landing squash from body motion (ground enemies only). */
  private groundSquash(): void {
    if (!this.body.allowGravity) return;
    const g = this.onGround;
    if (g && !this.wasGround && this.prevVy > 180) {
      const k = Phaser.Math.Clamp(this.prevVy / PHYS.maxFall, 0.3, 1);
      this.squash(1 + 0.3 * k, 1 - 0.25 * k, 140);
    } else if (!g && this.wasGround && this.body.velocity.y < -150) this.squash(0.8, 1.2, 160);
    this.wasGround = g;
    this.prevVy = this.body.velocity.y;
  }
  private applyVisual(): void {
    if (!this.active || this.visSaved) return;
    const q = squashAt(this.sq.sx, this.sq.sy, this.sq.t, this.sq.ms);
    const r = this.recoil;
    const off = r.t < r.ms ? r.px * (1 - r.t / r.ms) ** 2 : 0;
    const sx = q.x * this.breath.x, sy = q.y * this.breath.y;
    if (sx === 1 && sy === 1 && !off) return;
    this.visSaved = { x: this.x, y: this.y, sx: this.scaleX, sy: this.scaleY };
    // feet stay planted for ground enemies (sprite origin is centred)
    const dy = this.alive && this.body?.allowGravity ? ((1 - sy) * this.height) / 2 : 0;
    this.setScale(this.scaleX * sx, this.scaleY * sy);
    this.x += Math.round(off);
    this.y += dy;
  }
  private restoreVisual(): void {
    const v = this.visSaved;
    if (!v) return;
    this.visSaved = null;
    if (!this.active) return;
    this.x = v.x;
    this.y = v.y;
    this.setScale(v.sx, v.sy);
  }

  hurtRect(): Rect {
    const b = this.body;
    return { x: b.x, y: b.y, w: b.width, h: b.height };
  }

  /** Override for shields etc. Return 'blocked' to deflect. */
  protected filterHit(_hit: HitInfo): 'hit' | 'blocked' {
    return 'hit';
  }

  receiveHit(hit: HitInfo): 'hit' | 'blocked' | 'ignored' {
    // body disabled = not physically present (e.g. Duelist mid-blink): its stale hurt rect must not take hits
    if (!this.alive || !this.body?.enable) return 'ignored';
    Enemy.lastStruck = this;
    Enemy.lastStruckFrame = this.gs.game.loop.frame;
    const dir = Math.sign(hit.kbX) || (this.x >= hit.sourceX ? 1 : -1);
    if (!this.parryStunned && this.filterHit(hit) === 'blocked') {
      this.gs.juice.burst(this.x - this.facing * -6, this.y, 0xffffff, 6);
      this.recoilBy(dir * 1.5, 80);
      return 'blocked';
    }
    let dmg = hit.damage * (this.parryStunned ? 1.5 : 1) * this.damageTakenMul();
    dmg = Math.round(dmg * 10) / 10;
    if (dmg <= 0) {
      // immune (e.g. boss transforming): still a 'hit' so the player gets feedback
      this.gs.juice.burst(this.x, this.y, 0xc2c3d6, 4, 0.6);
      this.gs.juice.floatText(this.x, this.y - this.height / 2 - 4, 'IMMUNE', '#8b8ba8');
      return 'hit';
    }
    this.hp -= dmg;
    this.gs.juice.flash(this, 80);
    this.gs.juice.burst(this.x, this.y, 0xffffff, 6);
    this.gs.juice.floatText(this.x, this.y - this.height / 2 - 4, String(Math.round(dmg * 10) / 10), hit.heavy ? '#ffd166' : '#ffffff');
    // victim squash (compressed along the hit) + a few px of visual recoil away from it
    const S = JUICE.hitSquash, R = JUICE.hitRecoil;
    const s = hit.heavy ? S.heavy : S.light;
    if (hit.slam) this.squash(2 - s, s, S.ms);
    else this.squash(s, 2 - s, S.ms);
    this.recoilBy(dir * (hit.heavy ? R.heavy : R.light) * (this.isBoss ? JUICE.bossFeedbackMul * 2 : 1), R.ms);
    // projectile hits (energy slash, reflected shots) don't go through Player.onAttackHit: spark here
    if (hit.kind === 'projectile') this.gs.juice.spark(this.x, this.y, dir > 0 ? 0 : Math.PI, 0xffffff, 0.8);
    this.onHurt(hit);
    if (this.hp <= 0) {
      this.killBlow = hit;
      this.die(true);
      return 'hit';
    }
    if (!this.superArmor) {
      const r = 1 - this.kbResist;
      this.body.setVelocity(hit.kbX * r, this.body.allowGravity ? hit.kbY * r : hit.kbY * r * 0.5);
      this.stunUntil = this.gs.time.now + (hit.heavy ? 380 : 220) * r;
    }
    return 'hit';
  }

  /** Multiplier on incoming damage (e.g. boss punish windows); 0 = immune. */
  protected damageTakenMul(): number {
    return 1;
  }

  /** Hook for subclasses (e.g. boss phase change). */
  protected onHurt(_hit: HitInfo): void {}

  /** Called by player's parry when this enemy's attack is parried. */
  onParried(): void {
    this.parryStunned = true;
    this.stunUntil = this.gs.time.now + (this.isBoss ? 900 : 1300);
    this.body.setVelocityX(-this.facing * 120);
    this.gs.juice.floatText(this.x, this.y - this.height / 2 - 10, 'STUN', '#7fdbff');
    this.setTint(0x7fdbff);
    this.gs.time.delayedCall(this.isBoss ? 900 : 1300, () => {
      if (this.active && this.alive) this.restoreTint();
    });
  }

  die(reward = true): void {
    if (!this.alive) return;
    const blow = this.killBlow;
    this.killBlow = null;
    // decide the kill's weight before this enemy leaves the alive set
    const big = blow && !this.isBoss ? this.isBigKill(blow) : false;
    this.alive = false;
    this.gs.damage.unregister(this);
    this.gs.onEnemyKilled(this, reward);
    this.body.enable = false;
    this.alert?.destroy();
    this.alert = undefined;
    this.anims.stop();
    this.setTintFill(0xffffff);
    if (this.isBoss) {
      // bosses keep their flicker-out (Boss.die fires the killBig impact)
      sfx.enemyDie();
      this.gs.juice.burst(this.x, this.y, this.deathTint, 18, 1.2);
      this.gs.juice.burst(this.x, this.y, 0xffffff, 8);
      if (reward) this.gs.dropShards(this.x, this.y, this.shards);
      this.deathPop(this.x, this.y);
      this.gs.tweens.add({ targets: this, alpha: { from: 1, to: 0.2 }, duration: 70, yoyo: true, repeat: 4 });
      this.gs.tweens.add({ targets: this, alpha: 0, duration: 200, delay: 700, onComplete: () => this.destroy() });
      return;
    }
    // fell out of the world: nothing to show
    if (this.y > this.gs.worldHeight + 32) {
      sfx.enemyDie();
      this.destroy();
      return;
    }
    const dirX = blow ? Math.sign(blow.kbX) || (this.x >= blow.sourceX ? 1 : -1) : Math.random() < 0.5 ? -1 : 1;
    if (blow) {
      const angle = blow.slam ? Math.PI / 2 : dirX > 0 ? 0 : Math.PI;
      this.gs.juice.impact(big ? 'killBig' : 'kill', this.x, this.y, angle);
      if (big) sfx.killBig();
      else sfx.kill(blow.heavy ? 0.85 : 1);
      const [amt, ms] = JUICE.duck[big ? 'killBig' : 'kill'];
      duckMusic(amt, ms);
    } else sfx.enemyDie();
    this.gs.juice.burst(this.x, this.y, 0xffffff, 8);
    this.gs.time.delayedCall(70, () => this.active && this.clearTint());
    this.launchCorpse(blow, dirX, reward);
  }

  /** Parry-riposte kill, or the last non-boss enemy on screen after a recent kill (see isBigKill). */
  private isBigKill(blow: HitInfo): boolean {
    const now = this.gs.time.now;
    const view = this.gs.cameras.main.worldView;
    let others = 0;
    let bossAlive = false;
    for (const c of this.gs.enemies.getChildren() as Enemy[]) {
      if (!c.alive || c === this) continue;
      if (c.isBoss) bossAlive = true;
      else if (view.contains(c.x, c.y)) others++;
    }
    const since = now - this.gs.juice.lastKillAt;
    this.gs.juice.lastKillAt = now;
    return isBigKill({ riposte: this.parryStunned || !!blow.parried, othersInView: others, msSinceLastKill: since, bossAlive, groupWindowMs: JUICE.bigKillGroupMs });
  }

  /**
   * Corpse: flies along the killing blow, spinning, bounces once on the terrain, then bursts into
   * pooled pixel gibs (tinted deathTint) and the shard drop.
   */
  private launchCorpse(blow: HitInfo | null, dirX: number, reward: boolean): void {
    const K = JUICE.corpse;
    const deathAt = { x: this.x, y: this.y };
    const halfH = Math.max(2, Math.min(this.height / 2, this.body.bottom - this.y));
    const vx = dirX * (blow?.heavy ? K.heavySpeedX : K.speedX) * (blow ? 1 : 0.4);
    const vy = blow?.slam ? 60 : -(K.speedY + Math.min(120, Math.abs(blow?.kbY ?? 0) * 0.3));
    let bouncedAt = -1;
    let done = false;
    const burst = () => {
      if (done) return;
      done = true;
      handle.remove();
      if (!this.active) return;
      const inWorld = this.y <= this.gs.worldHeight;
      const at = inWorld ? { x: this.x, y: this.y } : deathAt;
      if (inWorld) {
        const G = JUICE.gibs;
        this.gs.juice.gibs(at.x, at.y, this.deathTint, Phaser.Math.Between(G.min, G.max), dirX);
        this.gs.juice.burst(at.x, at.y, this.deathTint, 12, 1);
        this.deathPop(at.x, at.y);
        sfx.gibs();
      }
      if (reward) this.gs.dropShards(at.x, at.y, this.shards);
      this.destroy();
    };
    const handle = this.gs.juice.addDebris(
      this,
      { x: this.x, y: this.y, vx, vy, spin: dirX * K.spin * (0.8 + Math.random() * 0.4), halfH, maxBounces: 1, restitution: 0.35, friction: 0.6 },
      {
        gravity: K.gravity,
        onContact: (ev, it) => {
          if (ev === 'bounce') {
            bouncedAt = it.age;
            this.squash(1.3, 0.7, 120);
          } else burst();
        },
        onTick: (it) => {
          if ((bouncedAt >= 0 && it.age - bouncedAt > K.burstAfterBounceMs) || it.age > K.maxAirMs || it.d.y > this.gs.worldHeight + 32) burst();
        },
      },
    );
  }

  /** Pop/dissolve sprite(s) on death, tinted with deathTint. */
  private deathPop(x: number, y: number): void {
    if (!this.scene.anims.exists('enemy-pop')) return;
    const { gs, deathTint: tint, isBoss } = this;
    const bw = this.body.width, bh = this.body.height;
    const n = isBoss ? 7 : 1;
    const big = Math.max(1, Math.min(1.6, Math.max(bw, bh) / 18));
    for (let i = 0; i < n; i++) {
      const spawn = () => {
        const ox = n > 1 ? (Math.random() - 0.5) * bw : 0;
        const oy = n > 1 ? (Math.random() - 0.5) * bh : 0;
        const s = gs.add.sprite(x + ox, y + oy, 'enemy-pop').setDepth(48).setTint(tint).setScale(isBoss ? 1.4 + Math.random() * 0.8 : big);
        s.setRotation(Math.floor(Math.random() * 4) * (Math.PI / 2));
        s.play('enemy-pop');
        s.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => s.destroy());
      };
      if (i === 0) spawn();
      else gs.time.delayedCall(i * 110, spawn);
    }
  }

  // ------------------------------------------------------------- AI helpers
  get player() {
    return this.gs.player;
  }
  get onGround(): boolean {
    return this.body.blocked.down;
  }
  dxToPlayer(): number {
    return this.player.x - this.x;
  }
  dyToPlayer(): number {
    return this.player.y - this.y;
  }
  dirToPlayer(): 1 | -1 {
    return this.player.x >= this.x ? 1 : -1;
  }
  distToPlayer(): number {
    return Phaser.Math.Distance.Between(this.x, this.y, this.player.x, this.player.y);
  }
  facePlayer(): void {
    this.facing = this.dirToPlayer();
  }
  /** player within a box in front/around (dx absolute, dy absolute) and alive */
  playerNear(dx: number, dy: number): boolean {
    return this.player.alive && Math.abs(this.dxToPlayer()) <= dx && Math.abs(this.dyToPlayer()) <= dy;
  }
  /** line of sight to player (no solid tiles between) */
  canSeePlayer(maxDist = 220): boolean {
    if (!this.player.alive || this.distToPlayer() > maxDist) return false;
    return this.gs.lineOfSight(this.x, this.y, this.player.x, this.player.y);
  }
  /** true if there's no ground ahead in facing direction */
  ledgeAhead(): boolean {
    const x = this.facing > 0 ? this.body.right + 2 : this.body.left - 2;
    return !this.gs.isSolidAt(x, this.body.bottom + 4);
  }
  wallAhead(): boolean {
    return this.facing > 0 ? this.body.blocked.right : this.body.blocked.left;
  }
  /** Patrol helper: walks and turns at walls/ledges. */
  patrol(speed: number): void {
    if (this.onGround && (this.ledgeAhead() || this.wallAhead())) this.facing = this.facing > 0 ? -1 : 1;
    this.body.setVelocityX(this.facing * speed);
  }

  /**
   * Flash/shake to warn of an incoming attack. `unparryable` overrides the colour with
   * UNPARRYABLE_TINT and adds a red ring, so moves that can't be parried read differently.
   */
  telegraph(ms: number, color = 0xffffff, unparryable = false): void {
    sfx.telegraph();
    if (unparryable) {
      color = UNPARRYABLE_TINT;
      this.gs.juice.ring(this.x, this.y, UNPARRYABLE_TINT, 1.1);
    }
    this.teleUntil = this.gs.time.now + ms;
    this.showAlert(ms);
    this.squash(1.12, 0.88, Math.min(ms, 320)); // wind-up crouch
    const ev = this.gs.time.addEvent({
      delay: 60,
      repeat: Math.floor(ms / 60) - 1,
      callback: () => {
        if (!this.active || !this.alive) return;
        if ((ev.repeatCount ?? 0) % 2 === 0) this.setTintFill(color);
        else this.restoreTint();
      },
    });
    this.gs.time.delayedCall(ms, () => {
      if (!this.active || !this.alive) return;
      this.restoreTint();
    });
  }

  /** Melee hitbox relative to facing. Parryable by default. */
  meleeBox(offX: number, offY: number, w: number, h: number, ms: number, damage = 1, parryable = true, kb = 180): Hitbox {
    const dir = this.facing;
    this.squash(1.2, 0.85, 140); // strike stretch
    return this.gs.damage.add(
      new Hitbox(
        'enemy',
        () => ({ x: this.x + (dir > 0 ? offX : -offX - w), y: this.y + offY, w, h }),
        () => ({ damage, kbX: dir * kb, kbY: -160, sourceX: this.x, parryable, kind: 'melee' }),
        ms,
        (_t, res) => {
          if (res === 'blocked' && parryable && this.alive) this.onParried();
        },
      ).ownedBy(this),
    );
  }

  /** Fire a projectile. */
  shoot(texture: string, vx: number, vy: number, opts: { damage?: number; gravity?: number; lifeMs?: number; explode?: boolean; rotate?: boolean } = {}) {
    this.squash(0.88, 1.12, 110);
    return this.gs.spawnProjectile(this.x, this.y, texture, vx, vy, 'enemy', { ...opts, owner: this });
  }
}
