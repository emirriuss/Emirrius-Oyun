import Phaser from 'phaser';
import { Enemy } from '../Enemy';
import type { HitInfo } from '../../combat/types';
import type { GameScene } from '../../scenes/GameScene';

/** Shield blocks frontal hits. Attack from behind, slam from above, or attack into its thrust to parry it. */
export class Knight extends Enemy {
  private shield: Phaser.GameObjects.Image;
  private mode: 'guard' | 'windup' | 'thrust' | 'recover' = 'guard';
  private t = 0;
  constructor(gs: GameScene, x: number, y: number, elite = false) {
    super(gs, x, y, 'knight', { hp: 6, bodyW: 14, bodyH: 22, shards: 5, elite, kbResist: 0.6 });
    this.shield = gs.add.image(x, y, elite && gs.textures.exists('shield-elite') ? 'shield-elite' : 'shield').setDepth(16);
    this.deathTint = elite ? 0xffd96a : 0xc2c3d6;
    this.once('destroy', () => this.shield.destroy());
  }
  protected animKey(): string {
    if (this.stunned) return this.anim('hurt');
    switch (this.mode) {
      case 'windup':
        return this.anim('windup');
      case 'thrust':
        return this.anim('thrust');
      case 'recover':
        return this.anim('recover');
      default:
        return Math.abs(this.body.velocity.x) > 5 ? this.anim('move') : this.anim('idle');
    }
  }
  protected filterHit(hit: HitInfo): 'hit' | 'blocked' {
    if (this.mode === 'recover' || hit.slam || hit.parried) return 'hit';
    const fromFront = (hit.sourceX - this.x) * this.facing > 0;
    return fromFront ? 'blocked' : 'hit';
  }
  protected think(dt: number): void {
    this.t += dt;
    const sees = this.canSeePlayer(180);
    switch (this.mode) {
      case 'guard':
        if (sees) {
          // turn slowly toward the player
          if (this.dirToPlayer() !== this.facing && this.t > 450) {
            this.facing = this.dirToPlayer();
            this.t = 0;
          }
          const dx = Math.abs(this.dxToPlayer());
          if (dx > 34 && !this.ledgeAhead()) this.body.setVelocityX(this.facing * (this.elite ? 50 : 35));
          else this.body.setVelocityX(0);
          if (dx <= 40 && Math.abs(this.dyToPlayer()) < 24 && this.dirToPlayer() === this.facing && this.t > 300) {
            this.mode = 'windup';
            this.t = 0;
            this.body.setVelocityX(0);
            this.telegraph(this.elite ? 350 : 500, 0xffa040); // orange: parryable (red is reserved for unparryable moves)
          }
        } else this.patrol(25);
        break;
      case 'windup':
        if (this.t > (this.elite ? 350 : 500)) {
          this.mode = 'thrust';
          this.t = 0;
          this.body.setVelocityX(this.facing * 200);
          this.meleeBox(4, -8, 26, 12, 160, 1, true, 220);
        }
        break;
      case 'thrust':
        this.body.setVelocityX(this.body.velocity.x * 0.85);
        if (this.t > 220) {
          this.mode = 'recover';
          this.t = 0;
        }
        break;
      case 'recover':
        // shield lowered: vulnerable
        if (this.t > 650) {
          this.mode = 'guard';
          this.t = 0;
        }
        break;
    }
  }
  tick(time: number, dt: number): void {
    super.tick(time, dt);
    if (!this.active) return;
    const lowered = this.mode === 'recover' || this.gs.time.now < this.stunUntil;
    this.shield.setPosition(this.x + this.facing * 8, this.y + 1 + (lowered ? 6 : 0)).setAngle(lowered ? this.facing * 50 : 0).setFlipX(this.facing < 0);
    if (this.mode === 'thrust') this.shield.x += this.facing * 2;
  }
  die(reward = true): void {
    this.shield.destroy();
    super.die(reward);
  }
}
