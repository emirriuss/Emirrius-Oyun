import { Hitbox } from './Hitbox';
import { overlaps, type Hurtable } from './types';

/** Resolves hitboxes against hurtables each frame. Pure logic, no Phaser deps. */
export class DamageSystem {
  hitboxes: Hitbox[] = [];
  hurtables = new Set<Hurtable>();

  add(h: Hitbox): Hitbox {
    this.hitboxes.push(h);
    return h;
  }

  register(t: Hurtable): void {
    this.hurtables.add(t);
  }

  unregister(t: Hurtable): void {
    this.hurtables.delete(t);
  }

  update(dt: number): void {
    for (const hb of this.hitboxes) {
      if (hb.dead) continue;
      if (hb.owner && !hb.owner.alive) {
        hb.dead = true;
        continue;
      }
      const r = hb.rect();
      for (const t of this.hurtables) {
        if (!t.alive || t.team === hb.team || hb.hitSet.has(t)) continue;
        if (!overlaps(r, t.hurtRect())) continue;
        const res = t.receiveHit(hb.info(t));
        if (res === 'ignored') continue;
        hb.hitSet.add(t);
        hb.onHit?.(t, res);
        if (hb.dead || (hb.owner && !hb.owner.alive)) break;
      }
      hb.remaining -= dt;
      if (hb.remaining <= 0) hb.dead = true;
    }
    this.hitboxes = this.hitboxes.filter((h) => !h.dead);
  }

  clear(): void {
    this.hitboxes = [];
    this.hurtables.clear();
  }
}
