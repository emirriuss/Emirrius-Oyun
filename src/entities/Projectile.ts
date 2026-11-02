import Phaser from 'phaser';
import { Hitbox } from '../combat/Hitbox';
import type { Team } from '../combat/types';
import { sfx } from '../systems/sfx';
import type { GameScene } from '../scenes/GameScene';
import type { Enemy } from './Enemy';

export interface ProjectileOpts {
  damage?: number;
  gravity?: number;
  lifeMs?: number;
  explode?: boolean;
  rotate?: boolean;
  pierce?: boolean;
  owner?: Enemy;
  /** bounce off the floor this many times before dying (needs gravity) */
  bounces?: number;
}

/**
 * Collision sizes of the original placeholder textures. Bodies stay at 80% of these
 * so gameplay is unchanged when the art grows (pixel-art frames are larger).
 */
const BODY_SRC: Record<string, [number, number]> = {
  arrow: [10, 3],
  bomb: [8, 8],
  orb: [10, 10],
  shockwave: [16, 10],
  blade: [4, 16],
  energySlash: [20, 14],
};

/** Moving damage source. Enemy projectiles are reflected when the player parries (attacks into them). */
export class Projectile extends Phaser.Physics.Arcade.Sprite {
  declare body: Phaser.Physics.Arcade.Body;
  hitbox: Hitbox;
  dead = false;
  /** sent back by a parry (HitInfo.parried: e.g. passes Knight shields) */
  private reflected = false;
  /** floor contact last frame (counts each bounce once) */
  private wasDown = false;

  constructor(private gs: GameScene, x: number, y: number, texture: string, vx: number, vy: number, public team: Team, private o: ProjectileOpts) {
    super(gs, x, y, texture);
    gs.add.existing(this);
    gs.physics.add.existing(this);
    this.setDepth(18);
    this.body.setAllowGravity(!!o.gravity);
    if (o.gravity) this.body.setGravityY(o.gravity - gs.physics.world.gravity.y);
    this.body.setVelocity(vx, vy);
    const [bw, bh] = BODY_SRC[texture] ?? [this.width, this.height];
    this.body.setSize(bw * 0.8, bh * 0.8);
    if (gs.anims.exists(texture + '-fly')) this.play(texture + '-fly');
    this.setFlipX(vx < 0);
    if (o.bounces) this.body.setBounce(0, 0.6);
    this.hitbox = this.makeHitbox();
    gs.time.delayedCall(o.lifeMs ?? 3000, () => this.kill());
  }

  private makeHitbox(): Hitbox {
    return this.gs.damage.add(
      new Hitbox(
        this.team,
        () => ({ x: this.body.x, y: this.body.y, w: this.body.width, h: this.body.height }),
        () => ({ damage: this.o.damage ?? 1, kbX: Math.sign(this.body.velocity.x || 1) * 150, kbY: -140, sourceX: this.x - Math.sign(this.body.velocity.x) * 20, kind: 'projectile', parryable: true, parried: this.reflected }),
        this.o.lifeMs ?? 3000,
        (_t, res) => {
          if (res === 'blocked' && this.team === 'enemy') this.reflect();
          else if (!this.o.pierce) this.kill();
        },
      ),
    );
  }

  /** Parried: fly back as a player projectile. */
  reflect(): void {
    this.hitbox.kill();
    this.team = 'player';
    this.reflected = true;
    const target = this.o.owner?.alive ? this.o.owner : null;
    const speed = Math.max(220, this.body.velocity.length() * 1.3);
    if (target) {
      const a = Phaser.Math.Angle.Between(this.x, this.y, target.x, target.y);
      this.body.setVelocity(Math.cos(a) * speed, Math.sin(a) * speed);
    } else this.body.setVelocity(-this.body.velocity.x * 1.3, -Math.abs(this.body.velocity.y));
    this.body.setAllowGravity(false);
    this.body.setBounce(0, 0);
    this.setTint(0x7fdbff);
    this.o.damage = (this.o.damage ?? 1) * 2;
    this.hitbox = this.makeHitbox();
  }

  tick(): void {
    if (this.dead) return;
    if (this.o.rotate) this.rotation = Math.atan2(this.body.velocity.y, this.body.velocity.x);
    const down = this.body.blocked.down;
    if (down && (this.o.bounces ?? 0) > 0 && !this.reflected) {
      if (!this.wasDown) this.o.bounces = (this.o.bounces ?? 0) - 1;
      this.wasDown = true;
      if (this.body.blocked.left || this.body.blocked.right || this.body.blocked.up) this.kill();
      return;
    }
    this.wasDown = down;
    if (this.body.blocked.down || this.body.blocked.left || this.body.blocked.right || this.body.blocked.up) this.kill();
  }

  kill(): void {
    if (this.dead) return;
    this.dead = true;
    this.hitbox.kill();
    if (this.o.explode) {
      sfx.explode();
      this.gs.juice.burst(this.x, this.y, 0xff9f1c, 20, 1.3);
      this.gs.juice.ring(this.x, this.y, 0xff5400, 1.4);
      // shake + rumble, weaker the farther from the player
      const pl = this.gs.player;
      const dist = pl ? Phaser.Math.Distance.Between(this.x, this.y, pl.x, pl.y) : 0;
      this.gs.juice.impact('explode', this.x, this.y, -Math.PI / 2, Phaser.Math.Clamp(1 - dist / 320, 0.3, 1));
      const t = this.team;
      this.gs.damage.add(
        new Hitbox(t, () => ({ x: this.x - 20, y: this.y - 20, w: 40, h: 40 }), (tg) => {
          const r = tg.hurtRect();
          return { damage: this.o.damage ?? 1, kbX: (r.x + r.w / 2 > this.x ? 1 : -1) * 200, kbY: -200, sourceX: this.x, kind: 'hazard' };
        }, 80),
      );
    } else this.gs.juice.burst(this.x, this.y, 0xffffff, 4, 0.5);
    this.destroy();
  }
}
