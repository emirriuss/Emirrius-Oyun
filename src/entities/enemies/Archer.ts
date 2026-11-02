import { Enemy } from '../Enemy';
import type { GameScene } from '../../scenes/GameScene';

/** Keeps distance and fires arrows (attack into one to parry / reflect it). */
export class Archer extends Enemy {
  private cooldown = 1200;
  private aiming = 0;
  /** visual only: release pose until */
  private releaseUntil = 0;
  constructor(gs: GameScene, x: number, y: number, elite = false) {
    super(gs, x, y, 'archer', { hp: 3, bodyW: 10, bodyH: 18, shards: 3, elite });
    this.deathTint = elite ? 0xe0443e : 0x4e9a45;
  }
  protected animKey(): string {
    if (this.stunned) return this.anim('hurt');
    if (this.aiming > 0) return this.anim('draw');
    if (this.gs.time.now < this.releaseUntil) return this.anim('release');
    return Math.abs(this.body.velocity.x) > 5 ? this.anim('move') : this.anim('idle');
  }
  protected think(dt: number): void {
    this.cooldown -= dt;
    const sees = this.canSeePlayer(240);
    if (!sees) {
      this.body.setVelocityX(0);
      this.aiming = 0;
      return;
    }
    this.facePlayer();
    const dx = Math.abs(this.dxToPlayer());
    // back off if too close
    if (dx < 70 && this.onGround) {
      this.facing = this.facing > 0 ? -1 : 1;
      if (!this.ledgeAhead() && !this.wallAhead()) this.body.setVelocityX(this.facing * 60);
      else this.body.setVelocityX(0);
      this.facePlayer();
    } else this.body.setVelocityX(0);

    if (this.cooldown <= 0) {
      if (this.aiming === 0) this.telegraph(350, 0xc77dff);
      this.aiming += dt;
      if (this.aiming >= 350) {
        const shots = this.elite ? 3 : 1;
        for (let i = 0; i < shots; i++) {
          this.gs.time.delayedCall(i * 140, () => {
            if (!this.alive) return;
            const a = Math.atan2(this.player.y - this.y, this.player.x - this.x);
            this.shoot('arrow', Math.cos(a) * 220, Math.sin(a) * 220, { rotate: true });
          });
        }
        this.cooldown = this.elite ? 1300 : 1900;
        this.releaseUntil = this.gs.time.now + (this.elite ? 450 : 250);
        this.aiming = 0;
      }
    }
  }
}
