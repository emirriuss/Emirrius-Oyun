import Phaser from 'phaser';
import { Enemy } from '../Enemy';
import type { GameScene } from '../../scenes/GameScene';

/** Hovers on a sine path, then swoops at the player. */
export class Flyer extends Enemy {
  private home: { x: number; y: number };
  private mode: 'hover' | 'windup' | 'swoop' | 'return' = 'hover';
  private t = Math.random() * 1000;
  private swoopCd = 1500;
  constructor(gs: GameScene, x: number, y: number, elite = false) {
    super(gs, x, y, 'flyer', { hp: 2, bodyW: 12, bodyH: 10, shards: 2, elite, gravity: false });
    this.home = { x, y };
    this.deathTint = elite ? 0xe0443e : 0xd1478f;
  }
  protected animKey(): string {
    if (this.stunned) return this.anim('hurt');
    if (this.mode === 'windup') return this.anim('windup');
    if (this.mode === 'swoop') return this.anim('dive');
    return this.anim('fly');
  }
  protected think(dt: number): void {
    this.t += dt;
    this.swoopCd -= dt;
    switch (this.mode) {
      case 'hover': {
        const tx = this.home.x + Math.sin(this.t / 700) * 30;
        const ty = this.home.y + Math.sin(this.t / 350) * 8;
        this.body.setVelocity((tx - this.x) * 3, (ty - this.y) * 3);
        if (this.player.alive) this.facePlayer();
        if (this.swoopCd <= 0 && this.canSeePlayer(160)) {
          this.mode = 'windup';
          this.t = 0;
          this.telegraph(400, 0xff70a6);
        }
        break;
      }
      case 'windup':
        this.body.setVelocity(0, -20);
        if (this.t > 400) {
          const a = Phaser.Math.Angle.Between(this.x, this.y, this.player.x, this.player.y);
          const sp = this.elite ? 260 : 200;
          this.body.setVelocity(Math.cos(a) * sp, Math.sin(a) * sp);
          this.mode = 'swoop';
          this.t = 0;
        }
        break;
      case 'swoop':
        if (this.t > 700 || this.body.blocked.down || this.body.blocked.left || this.body.blocked.right) {
          this.mode = 'return';
          this.t = 0;
        }
        break;
      case 'return': {
        const a = Phaser.Math.Angle.Between(this.x, this.y, this.home.x, this.home.y);
        this.body.setVelocity(Math.cos(a) * 90, Math.sin(a) * 90);
        if (Phaser.Math.Distance.Between(this.x, this.y, this.home.x, this.home.y) < 8 || this.t > 2500) {
          this.mode = 'hover';
          this.swoopCd = this.elite ? 1200 : 2000;
          this.t = 0;
        }
        break;
      }
    }
  }
  tick(time: number, dt: number): void {
    super.tick(time, dt);
    // stop drifting after knockback
    if (this.alive && this.gs.time.now < this.stunUntil) this.body.velocity.scale(0.9);
  }
}
