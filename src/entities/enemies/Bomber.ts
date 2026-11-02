import { Enemy } from '../Enemy';
import type { GameScene } from '../../scenes/GameScene';

/** Lobs arcing bombs at the player's position. */
export class Bomber extends Enemy {
  private cd = 1500;
  /** visual only: wind-up / throw pose timers */
  private throwAt = 0;
  constructor(gs: GameScene, x: number, y: number, elite = false) {
    super(gs, x, y, 'bomber', { hp: 4, bodyW: 12, bodyH: 18, shards: 4, elite });
    this.deathTint = elite ? 0xe0443e : 0x9ad152;
  }
  protected animKey(): string {
    if (this.stunned) return this.anim('hurt');
    const now = this.gs.time.now;
    if (now < this.throwAt) return this.anim('windup');
    if (now < this.throwAt + 300) return this.anim('throw');
    return Math.abs(this.body.velocity.x) > 5 ? this.anim('move') : this.anim('idle');
  }
  protected think(dt: number): void {
    this.cd -= dt;
    if (!this.canSeePlayer(230)) {
      this.patrol(20);
      return;
    }
    this.facePlayer();
    this.body.setVelocityX(0);
    if (this.cd <= 0) {
      this.telegraph(300, 0xff9f1c);
      this.throwAt = this.gs.time.now + 300;
      this.cd = this.elite ? 1400 : 2200;
      this.gs.time.delayedCall(300, () => {
        if (!this.alive) return;
        const throws = this.elite ? [0.8, 1, 1.2] : [1];
        for (const m of throws) {
          // ballistic: pick flight time from distance
          const dx = this.dxToPlayer() * m;
          const dy = this.dyToPlayer();
          const tFlight = Math.max(0.55, Math.min(1.1, Math.abs(dx) / 160));
          const g = 700;
          const vx = dx / tFlight;
          const vy = (dy - 0.5 * g * tFlight * tFlight) / tFlight;
          this.shoot('bomb', vx, vy, { gravity: g, explode: true, damage: 1, lifeMs: 2500, rotate: true });
        }
      });
    }
  }
}
