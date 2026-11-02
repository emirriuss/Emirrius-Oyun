import Phaser from 'phaser';
import { Boss } from './Boss';
import { sfx } from '../../systems/sfx';
import { addLight } from '../../core/Fx';
import type { GameScene } from '../../scenes/GameScene';

/**
 * World 1: Iron Golem — slow, heavy. Punches, jump slams with shockwaves, rock rain in phase 2.
 * The punch is parryable in phase 1 (teaches parrying); in phase 2 it becomes an unparryable
 * haymaker with a red telegraph: dash through or jump it.
 */
export class Golem extends Boss {
  constructor(gs: GameScene, x: number, y: number) {
    super(gs, x, y, 'golem', 'IRON GOLEM', { hp: 40, bodyW: 36, bodyH: 42, contactDamage: 1 });
    this.deathTint = 0xffd96a;
    this.coreLight = addLight(gs, x, y, 0xffb43b, 26, 0.35).setDepth(16);
    this.once(Phaser.GameObjects.Events.DESTROY, () => this.coreLight.destroy());
  }
  /** visual: pulsing light over the chest core */
  private coreLight: Phaser.GameObjects.Image;

  protected animKey(): string {
    if (this.stunned) return 'golem-stun';
    const pose = this.curPose;
    if (pose) return 'golem-' + pose;
    if (!this.onGround) return 'golem-air';
    return Math.abs(this.body.velocity.x) > 5 ? 'golem-move' : 'golem-idle';
  }

  tick(time: number, dt: number): void {
    super.tick(time, dt);
    if (!this.coreLight.active) return;
    // core sits left of centre (art faces right), ~1px above centre
    const hot = this.telegraphing || this.curPose !== '';
    this.coreLight
      .setPosition(this.x - this.facing * 1, this.y - 1 + (this.curPose === 'slam' ? 4 : this.curPose === 'crouch' ? 3 : 0))
      .setAlpha(this.alpha * ((hot ? 0.45 : 0.22) + Math.sin(this.gs.time.now / 220) * 0.07))
      .setScale((hot ? 34 : 26) / 32);
  }

  protected think(dt: number): void {
    // only hurts on touch while airborne (jump-slam); walking into the player made melee range a damage trap
    this.contactDamage = this.onGround ? 0 : 1;
    if (this.busy) return;
    this.cooldown -= dt;
    this.facePlayer();
    const dx = Math.abs(this.dxToPlayer());
    const speed = this.phase === 1 ? 35 : 55;
    if (dx > 40) this.body.setVelocityX(this.facing * speed);
    else this.body.setVelocityX(0);
    if (this.cooldown > 0) return;

    const r = Math.random();
    if (dx < 56 && r < 0.6) this.punch();
    else if (this.phase >= 2 && r < 0.35) this.rockRain();
    else this.jumpSlam();
  }

  private punch(): void {
    const tele = this.phase === 1 ? 550 : 400;
    const parryable = this.phase === 1;
    this.attack(tele + 450, this.phase === 1 ? 900 : 600, () => {
      this.body.setVelocityX(0);
      this.telegraph(tele, 0xffd166, !parryable);
      this.setPose('windup', tele);
      this.later(tele, () => {
        this.setPose('punch', 380);
        this.body.setVelocityX(this.facing * 160);
        this.meleeBox(8, -10, 34, 26, 180, 2, parryable, 260);
        this.gs.juice.shake(0.004);
        this.gs.juice.rumble(0.2, 0.3, 120);
      });
      this.later(tele + 200, () => this.body.setVelocityX(0));
    });
  }

  private jumpSlam(): void {
    const tele = 500;
    const slams = this.phase === 1 ? 1 : 2;
    this.attack(tele + slams * 900, this.phase === 1 ? 1100 : 700, () => {
      this.body.setVelocityX(0);
      this.telegraph(tele, 0xff5400);
      this.setPose('crouch', tele);
      for (let i = 0; i < slams; i++) {
        this.later(tele + i * 900, () => {
          this.setPose('air', 600);
          this.facePlayer();
          const dx = this.dxToPlayer();
          this.body.setVelocity(Math.max(-180, Math.min(180, dx * 1.1)), -430);
        });
        this.later(tele + i * 900 + 650, () => this.landCheck());
      }
    });
  }

  private landCheck(tries = 0): void {
    if (!this.onGround && tries < 20) {
      this.later(30, () => this.landCheck(tries + 1));
      return;
    }
    this.body.setVelocityX(0);
    this.setPose('slam', 380);
    this.gs.juice.impact('slam', this.x, this.body.bottom, Math.PI / 2);
    sfx.slam();
    this.gs.juice.burst(this.x, this.body.bottom, 0xb0a99f, 20, 1.2);
    this.shockwaves(this.phase === 1 ? 150 : 200);
  }

  private rockRain(): void {
    this.attack(1800, 900, () => {
      this.body.setVelocityX(0);
      this.telegraph(500, 0xffffff);
      this.setPose('crouch', 500);
      this.later(500, () => {
        this.setPose('slam', 700);
        this.gs.juice.shake(0.008, 600);
        this.gs.juice.rumble(0.1, 0.45, 600);
        this.rain(8, 'bomb', 360);
      });
    });
  }
}
