import Phaser from 'phaser';
import type { HitInfo, Hurtable, Rect } from '../combat/types';
import { BREAKABLE_DUST } from '../art/environment';
import { sfx } from '../systems/sfx';
import type { GameScene } from '../scenes/GameScene';

/** Chance a smashed breakable drops a shard. */
export const BREAKABLE_SHARD_CHANCE = 0.3;

/**
 * Non-solid crate / urn (level legend 'r'). Registered with the DamageSystem on the enemy team so
 * only player hitboxes (melee, energy slash) affect it. Two light hits or one heavy hit smash it.
 */
export class Breakable implements Hurtable {
  readonly team = 'enemy' as const;
  alive = true;
  private hp = 2;
  readonly img: Phaser.GameObjects.Image;

  constructor(private gs: GameScene, x: number, y: number, private world: 1 | 2 | 3 | 4) {
    // spawn y is the cell centre; sprite is bottom-aligned on the cell floor
    this.img = gs.add.image(x, y + 8, `breakable${world}`, 0).setOrigin(0.5, 1).setDepth(11.5);
    gs.damage.register(this);
  }

  hurtRect(): Rect {
    return { x: this.img.x - 7, y: this.img.y - 13, w: 14, h: 13 };
  }

  receiveHit(hit: HitInfo): 'hit' | 'blocked' | 'ignored' {
    if (!this.alive || hit.kind === 'hazard' || hit.kind === 'contact') return 'ignored';
    this.hp -= hit.heavy || hit.slam ? 2 : Math.max(1, hit.damage);
    const dir = hit.sourceX <= this.img.x ? 1 : -1;
    if (this.hp <= 0) {
      this.smash(dir, !!hit.heavy);
      return 'hit';
    }
    // wobble + crack
    this.img.setFrame(1);
    this.gs.tweens.killTweensOf(this.img);
    this.img.setAngle(0).setScale(1);
    this.gs.tweens.add({ targets: this.img, angle: { from: dir * 14, to: 0 }, duration: 260, ease: 'Elastic.out' });
    this.gs.tweens.add({ targets: this.img, scaleX: 1.15, scaleY: 0.85, duration: 60, yoyo: true });
    this.gs.juice.dust(this.img.x, this.img.y, 2, 0.4, dir, BREAKABLE_DUST[this.world]);
    sfx.propHit();
    return 'hit';
  }

  private smash(dir: number, heavy: boolean): void {
    this.alive = false;
    this.gs.damage.unregister(this);
    const { x } = this.img;
    const cy = this.img.y - 7;
    const gs = this.gs;
    gs.tweens.killTweensOf(this.img);
    this.img.destroy();
    sfx.propBreak(this.world);
    gs.juice.dust(x, cy + 7, 5, 0.7, 0, BREAKABLE_DUST[this.world]);
    gs.juice.burst(x, cy, BREAKABLE_DUST[this.world], 8, 0.7);
    // debris chunks fly out (mostly away from the hit), bounce once, fade
    const n = 6 + (heavy ? 2 : 0);
    const floorY = cy + 7;
    for (let i = 0; i < n; i++) {
      const chunk = gs.add.image(x + Phaser.Math.Between(-4, 4), cy + Phaser.Math.Between(-4, 4), `breakDebris${this.world}`, i % 4).setDepth(16);
      const vx = (dir * Phaser.Math.Between(20, 120) + Phaser.Math.Between(-50, 50)) * (heavy ? 1.3 : 1);
      const peak = Phaser.Math.Between(10, 26);
      const land = floorY - 2 + Phaser.Math.Between(-1, 1);
      const dur = Phaser.Math.Between(280, 420);
      chunk.setRotation(Math.random() * Math.PI);
      gs.tweens.add({ targets: chunk, x: chunk.x + vx * (dur / 1000), angle: chunk.angle + Phaser.Math.Between(-360, 360), duration: dur, ease: 'Linear' });
      gs.tweens.add({
        targets: chunk,
        y: chunk.y - peak,
        duration: dur * 0.4,
        ease: 'Quad.out',
        onComplete: () => {
          gs.tweens.add({
            targets: chunk,
            y: land,
            duration: dur * 0.6,
            ease: 'Quad.in',
            onComplete: () => {
              gs.tweens.add({ targets: chunk, y: land - 3, duration: 90, yoyo: true, ease: 'Quad.out' });
              gs.tweens.add({ targets: chunk, alpha: 0, delay: 500 + Math.random() * 400, duration: 300, onComplete: () => chunk.destroy() });
            },
          });
        },
      });
    }
    gs.onBreakableSmashed(x, cy, dir);
  }
}
