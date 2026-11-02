import Phaser from 'phaser';
import { Boss } from './Boss';
import { sfx } from '../../systems/sfx';
import { Slime } from '../enemies/Slime';
import { Flyer } from '../enemies/Flyer';
import type { Enemy } from '../Enemy';
import { glow } from '../../core/Fx';
import type { GameScene } from '../../scenes/GameScene';

/**
 * World 3: The Hollow King — floats & teleports. Three phases.
 *  P1: aimed orb volleys (attack into them to parry / reflect = big damage) + summons.
 *  P2: adds golem-style ground slams with shockwaves and duelist dash-strikes
 *      (the 2-damage dash-strike is unparryable: red telegraph, dash through it).
 *  P3: orb rings, rain, faster everything. After big attacks he becomes "exhausted" and drops to the floor.
 */
export class King extends Boss {
  private home: { x: number; y: number };
  private t = 0;
  private exhausted = false;
  /** visual only: small orbs circling the king */
  private orbiters: Phaser.GameObjects.Sprite[] = [];

  constructor(gs: GameScene, x: number, y: number) {
    super(gs, x, y, 'king', 'THE HOLLOW KING', { hp: 75, bodyW: 26, bodyH: 34, gravity: false, contactDamage: 1 });
    this.thresholds = [0.66, 0.33];
    this.home = { x, y: y - 30 };
    this.deathTint = 0xd1478f;
    for (let i = 0; i < 3; i++) {
      const o = gs.add.sprite(x, y, 'king-orbit').setDepth(16).setAlpha(0);
      if (gs.anims.exists('king-orbit-spin')) o.play({ key: 'king-orbit-spin', startFrame: i % 2 });
      glow(o, 0xff8fb8, 1.5);
      gs.tweens.add({ targets: o, alpha: 1, duration: 600 });
      this.orbiters.push(o);
    }
    this.once(Phaser.GameObjects.Events.DESTROY, () => this.clearOrbiters());
  }

  private get sheetKey(): string {
    return this.phase <= 1 ? 'king' : `king-p${Math.min(3, this.phase)}`;
  }

  protected animKey(): string {
    const s = this.sheetKey;
    if (this.stunned) return s + '-stun';
    if (this.exhausted) return s + '-exhausted';
    if (this.telegraphing) return s + '-cast';
    if (this.body.velocity.length() > 300) return s + '-dive';
    return s + '-float';
  }

  tick(time: number, dt: number): void {
    super.tick(time, dt);
    if (!this.alive || !this.orbiters.length) return;
    const now = this.gs.time.now;
    const speed = this.phase === 1 ? 1 / 700 : this.phase === 2 ? 1 / 500 : 1 / 360;
    const r = this.exhausted ? 14 : 22;
    this.orbiters.forEach((o, i) => {
      const a = now * speed + (i / this.orbiters.length) * Math.PI * 2;
      const front = Math.sin(a) > 0;
      o.setPosition(this.x + Math.cos(a) * r, this.y - 4 + Math.sin(a) * r * 0.35 + (this.exhausted ? 10 : 0));
      o.setDepth(front ? 16 : 14).setScale(front ? 1 : 0.75);
      if (o.alpha >= 1 || this.exhausted) o.setAlpha(this.exhausted ? 0.35 : 1);
    });
  }

  private clearOrbiters(): void {
    for (const o of this.orbiters) o.destroy();
    this.orbiters = [];
  }

  die(reward = true): void {
    if (this.alive) {
      for (const o of this.orbiters) this.gs.juice.burst(o.x, o.y, 0xff8fb8, 6);
      this.clearOrbiters();
    }
    super.die(reward);
  }

  protected onPhase(n: number): void {
    this.gs.juice.floatText(this.x, this.y - 30, n === 2 ? 'ENRAGED' : 'DESPERATE', '#ff006e');
    const orbKey = n >= 3 ? 'king-orbit-p3' : 'king-orbit-p2';
    for (const o of this.orbiters) {
      o.setTexture(orbKey);
      if (this.scene.anims.exists(orbKey + '-spin')) o.play(orbKey + '-spin');
    }
    this.cooldown = 600;
  }

  protected think(dt: number): void {
    this.t += dt;
    if (this.busy || this.exhausted) return;
    this.cooldown -= dt;
    this.facePlayer();
    // hover around home, drifting toward player's x
    const tx = Phaser.Math.Linear(this.home.x, this.player.x, 0.35) + Math.sin(this.t / 900) * 40;
    const ty = this.home.y + Math.sin(this.t / 400) * 10;
    this.body.setVelocity((tx - this.x) * 2, (ty - this.y) * 2);
    if (this.cooldown > 0) return;

    const r = Math.random();
    const p = this.phase;
    if (p === 1) {
      if (r < 0.6) this.volley(3);
      else this.summon();
    } else if (p === 2) {
      if (r < 0.35) this.volley(5);
      else if (r < 0.7) this.groundSlam();
      else this.dashStrike();
    } else {
      if (r < 0.25) this.ringBurst();
      else if (r < 0.5) this.groundSlam();
      else if (r < 0.75) this.dashStrike();
      else this.storm();
    }
  }

  private volley(n: number): void {
    this.attack(400 + n * 250 + 300, this.phase === 1 ? 1200 : 800, () => {
      this.body.setVelocity(0, 0);
      this.telegraph(400, 0xff006e);
      for (let i = 0; i < n; i++) {
        this.later(400 + i * 250, () => {
          const a = Math.atan2(this.player.y - this.y, this.player.x - this.x);
          this.shoot('orb', Math.cos(a) * 170, Math.sin(a) * 170, { damage: 1, lifeMs: 3500 });
        });
      }
      // phase 1 punish window: he sinks to the floor after a volley so ground fighters can hit him
      if (this.phase === 1) this.later(400 + n * 250 + 150, () => this.exhaust(1300));
    });
  }

  private summon(): void {
    this.attack(900, 1200, () => {
      this.body.setVelocity(0, 0);
      this.telegraph(500, 0x9d4edd);
      this.later(500, () => {
        const alive = this.gs.enemies.getChildren().filter((e) => (e as Boss).alive && e !== this).length;
        if (alive >= 2) return;
        const cam = this.gs.cameras.main;
        for (const side of [-1, 1]) {
          const x = Phaser.Math.Clamp(this.x + side * 80, cam.scrollX + 40, cam.scrollX + cam.width - 40);
          const e: Enemy = Math.random() < 0.5 ? new Slime(this.gs, x, this.home.y + 60, true) : new Flyer(this.gs, x, this.home.y, false);
          e.shards = 0; // summons are infinite: no shard farming
          this.gs.enemies.add(e);
          this.gs.juice.ring(x, e.y, 0x9d4edd, 1.2);
        }
      });
    });
  }

  private groundSlam(): void {
    this.attack(1600, 600, () => {
      // rise above player, then drop
      const x = this.player.x;
      this.body.setVelocity(0, 0);
      this.gs.tweens.add({ targets: this, x, y: this.home.y - 20, duration: 450, ease: 'Sine.inOut' });
      this.later(450, () => this.telegraph(300, 0xffd166));
      this.later(750, () => {
        this.body.setVelocity(0, 520);
        this.dropCheck();
      });
    });
  }

  private dropCheck(tries = 0): void {
    const groundY = this.body.bottom + 2;
    if (!this.gs.isSolidAt(this.x, groundY) && tries < 40) {
      this.later(20, () => this.dropCheck(tries + 1));
      return;
    }
    this.body.setVelocity(0, 0);
    this.gs.juice.impact('slam', this.x, this.body.bottom, Math.PI / 2);
    sfx.slam();
    this.squash(1.3, 0.75, 180);
    this.shockwaves(this.phase >= 3 ? 220 : 170);
    if (this.phase >= 3) this.later(300, () => this.shockwaves(140));
    this.exhaust(this.phase >= 3 ? 900 : 1300);
  }

  private dashStrike(): void {
    this.attack(1200, 700, () => {
      this.body.setVelocity(0, 0);
      const side = this.player.x > this.x ? -1 : 1;
      this.body.reset(Phaser.Math.Clamp(this.player.x + side * 120, 30, this.gs.worldWidth - 30), this.player.y - 6);
      this.gs.juice.burst(this.x, this.y, 0x3c096c, 14);
      this.facePlayer();
      this.telegraph(380, 0xff006e, true);
      this.later(380, () => {
        this.body.setVelocity(this.facing * 360, 0);
        this.meleeBox(-6, -16, 36, 32, 350, 2, false, 260);
      });
      this.later(750, () => this.body.setVelocity(0, 0));
    });
  }

  private ringBurst(): void {
    this.attack(1500, 700, () => {
      this.body.setVelocity(0, 0);
      this.telegraph(450, 0xffffff);
      for (let w = 0; w < 2; w++) {
        this.later(450 + w * 500, () => {
          const n = 10;
          for (let i = 0; i < n; i++) {
            const a = (i / n) * Math.PI * 2 + w * 0.3;
            this.shoot('orb', Math.cos(a) * 130, Math.sin(a) * 130, { lifeMs: 3000 });
          }
        });
      }
    });
  }

  private storm(): void {
    this.attack(2200, 600, () => {
      this.body.setVelocity(0, 0);
      this.telegraph(500, 0xff006e);
      this.later(500, () => this.rain(12, 'orb', 420));
      this.later(1800, () => this.exhaust(1200));
    });
  }

  /** Falls to the floor, vulnerable. */
  private exhaust(ms: number): void {
    this.exhausted = true;
    this.body.setAllowGravity(true);
    this.later(ms, () => {
      this.exhausted = false;
      this.body.setAllowGravity(false);
    });
  }
}
