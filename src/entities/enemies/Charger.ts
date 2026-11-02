import { Enemy } from '../Enemy';
import { sfx } from '../../systems/sfx';
import type { GameScene } from '../../scenes/GameScene';

/** Spots player, telegraphs, then rushes. Stunned on hitting a wall. */
export class Charger extends Enemy {
  private mode: 'patrol' | 'windup' | 'charge' | 'recover' = 'patrol';
  private t = 0;
  constructor(gs: GameScene, x: number, y: number, elite = false) {
    super(gs, x, y, 'charger', { hp: 5, bodyW: 16, bodyH: 14, shards: 3, elite, kbResist: 0.3 });
    this.deathTint = elite ? 0xe0443e : 0x9a6648;
  }
  protected animKey(): string {
    if (this.stunned) return this.mode === 'recover' ? this.anim('dizzy') : this.anim('hurt');
    if (this.mode === 'windup') return this.anim('windup');
    if (this.mode === 'charge') return this.anim('charge');
    return Math.abs(this.body.velocity.x) > 8 ? this.anim('move') : this.anim('idle');
  }
  protected think(dt: number): void {
    this.t += dt;
    switch (this.mode) {
      case 'patrol':
        this.patrol(40);
        if (this.canSeePlayer(170) && Math.abs(this.dyToPlayer()) < 32) {
          this.facePlayer();
          this.mode = 'windup';
          this.t = 0;
          this.body.setVelocityX(0);
          this.telegraph(this.elite ? 300 : 450, 0xffaa00);
        }
        break;
      case 'windup':
        this.body.setVelocityX(0);
        if (this.t > (this.elite ? 300 : 450)) {
          this.mode = 'charge';
          this.t = 0;
        }
        break;
      case 'charge': {
        const speed = this.elite ? 300 : 230;
        this.body.setVelocityX(this.facing * speed);
        if (this.t % 50 < 17) this.gs.juice.burst(this.x - this.facing * 8, this.body.bottom, 0xbbbbbb, 1, 0.3);
        if (this.wallAhead()) {
          this.gs.juice.impact('crash', this.x + this.facing * 8, this.y, this.facing > 0 ? 0 : Math.PI);
          sfx.slam();
          this.squash(0.7, 1.25, 180);
          this.stunUntil = this.gs.time.now + 900;
          this.body.setVelocity(-this.facing * 80, -120);
          this.mode = 'recover';
          this.t = 0;
        } else if (this.ledgeAhead() || this.t > 1100) {
          this.mode = 'recover';
          this.t = 0;
        }
        break;
      }
      case 'recover':
        this.body.setVelocityX(this.body.velocity.x * 0.85);
        if (this.t > 600) this.mode = 'patrol';
        break;
    }
  }
}
