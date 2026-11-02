import { Enemy } from '../Enemy';
import { Hitbox } from '../../combat/Hitbox';
import { sfx } from '../../systems/sfx';
import type { GameScene } from '../../scenes/GameScene';

const PALE_GOLD = 0xffeec2;

/**
 * P5 add of the Hollow Sun: a pale ghost of Aurren's blade form. One move (2-swing combo or a
 * dash-slash, both white = parryable), then it fades. Any hit or parry dispels it. No shards.
 */
export class AurrenEcho extends Enemy {
  private pose = 'idle';
  private started = false;
  private approaching = 0;
  private dashing = false;
  private gone = false;

  constructor(gs: GameScene, x: number, y: number) {
    super(gs, x, y, 'aurren', { hp: 1, bodyW: 16, bodyH: 30, shards: 0, contactDamage: 0 });
    this.maxHp = this.hp = 1;
    this.deathTint = PALE_GOLD;
    this.baseTint = PALE_GOLD;
    this.setTint(PALE_GOLD);
    this.setAlpha(0);
    gs.tweens.add({ targets: this, alpha: 0.72, duration: 500 });
    gs.juice.ring(x, this.y, PALE_GOLD, 1.2);
    this.facePlayer();
    gs.time.delayedCall(700, () => {
      if (!this.alive) return;
      this.started = true;
      if (Math.random() < 0.5) this.approaching = 1500;
      else this.dash();
    });
    // never lingers
    gs.time.delayedCall(6500, () => this.vanish());
  }

  protected animKey(): string {
    if (this.stunned) return 'aurren-stun';
    if (this.approaching > 0 && Math.abs(this.body.velocity.x) > 5) return 'aurren-run';
    return `aurren-${this.pose}`;
  }

  protected think(dt: number): void {
    if (!this.started || this.gone) {
      this.body.setVelocityX(0);
      return;
    }
    if (this.approaching > 0) {
      this.approaching -= dt;
      this.facePlayer();
      if (Math.abs(this.dxToPlayer()) <= 44 || this.approaching <= 0) {
        this.approaching = 0;
        this.body.setVelocityX(0);
        this.combo();
      } else this.body.setVelocityX(this.facing * 115);
      return;
    }
    if (!this.dashing) this.body.setVelocityX(0);
  }

  private combo(): void {
    this.pose = 'windup';
    this.telegraph(560, 0xffffff);
    this.gs.time.delayedCall(560, () => this.swing('slash'));
    this.gs.time.delayedCall(560 + 340, () => {
      if (!this.alive) return;
      this.pose = 'windup';
      this.telegraph(340, 0xffffff);
    });
    this.gs.time.delayedCall(560 + 680, () => this.swing('slash2'));
    this.gs.time.delayedCall(560 + 680 + 450, () => this.vanish());
  }

  private swing(pose: string): void {
    if (!this.alive) return;
    this.facePlayer();
    this.pose = pose;
    sfx.swing(1.2);
    this.meleeBox(2, -14, 34, 26, 130, 1, true, 200);
  }

  private dash(): void {
    this.pose = 'crouch';
    this.facePlayer();
    this.telegraph(600, 0xffffff);
    this.gs.time.delayedCall(600, () => {
      if (!this.alive) return;
      const dir = this.facing;
      this.pose = 'dash';
      this.dashing = true;
      sfx.dash();
      this.body.setVelocityX(dir * 380);
      this.gs.damage.add(
        new Hitbox(
          'enemy',
          () => (this.dashing ? { x: this.x + (dir > 0 ? -8 : -22), y: this.y - 10, w: 30, h: 30 } : { x: -9999, y: -9999, w: 1, h: 1 }),
          () => ({ damage: 1, kbX: dir * 230, kbY: -170, sourceX: this.x, parryable: true, kind: 'melee' }),
          400,
          (_t, res) => {
            if (res === 'blocked' && this.alive) this.onParried();
          },
        ).ownedBy(this),
      );
      this.gs.time.delayedCall(380, () => {
        this.dashing = false;
        if (this.alive) this.body.setVelocityX(0);
        this.gs.time.delayedCall(250, () => this.vanish());
      });
    });
  }

  /** Parrying the ghost shatters it. */
  onParried(): void {
    if (this.alive) this.die(false);
  }

  /** Quiet fade-out (its move is spent); no kill pop. */
  vanish(): void {
    if (!this.alive || this.gone) return;
    this.gone = true;
    this.alive = false;
    this.dashing = false;
    this.gs.damage.unregister(this);
    this.body.enable = false;
    this.gs.tweens.add({ targets: this, alpha: 0, duration: 380, onComplete: () => this.destroy() });
  }
}
