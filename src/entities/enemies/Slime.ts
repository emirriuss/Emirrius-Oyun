import { Enemy } from '../Enemy';
import type { GameScene } from '../../scenes/GameScene';

/** Patrols; elites hop toward the player. */
export class Slime extends Enemy {
  private hopAt = 0;
  constructor(gs: GameScene, x: number, y: number, elite = false) {
    super(gs, x, y, 'slime', { hp: 3, bodyW: 14, bodyH: 9, shards: 2, elite });
    this.deathTint = elite ? 0xff8fb8 : 0x9ad152;
  }
  protected animKey(): string {
    if (this.stunned) return this.anim('hurt');
    if (!this.onGround) return this.anim('hop');
    if (this.elite && this.playerNear(120, 48) && this.gs.time.now > this.hopAt - 160) return this.anim('windup');
    return Math.abs(this.body.velocity.x) > 5 ? this.anim('move') : this.anim('idle');
  }
  protected think(): void {
    const now = this.gs.time.now;
    if (this.elite && this.onGround && now > this.hopAt && this.playerNear(120, 48)) {
      this.facePlayer();
      this.body.setVelocity(this.facing * 110, -260);
      this.hopAt = now + 900;
      return;
    }
    if (this.onGround) this.patrol(this.elite ? 50 : 30);
    // breathing (visual only: drawn around render, so the physics body never resizes)
    this.breath.x = 1 + Math.sin(now / 120) * 0.06;
    this.breath.y = 1 - Math.sin(now / 120) * 0.06;
  }
}
