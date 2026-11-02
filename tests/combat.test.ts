import { describe, it, expect } from 'vitest';
import { DamageSystem } from '../src/combat/DamageSystem';
import { Hitbox } from '../src/combat/Hitbox';
import { overlaps, knockback, type Hurtable, type HitInfo } from '../src/combat/types';

function dummy(team: 'player' | 'enemy', x: number, block = false): Hurtable & { hits: HitInfo[] } {
  const hits: HitInfo[] = [];
  return {
    team, alive: true, hits,
    hurtRect: () => ({ x, y: 0, w: 10, h: 10 }),
    receiveHit: (h) => { if (block) return 'blocked'; hits.push(h); return 'hit'; },
  };
}
const info = (): HitInfo => ({ damage: 1, kbX: 0, kbY: 0, sourceX: 0 });

describe('combat', () => {
  it('overlaps', () => {
    expect(overlaps({ x: 0, y: 0, w: 10, h: 10 }, { x: 9, y: 9, w: 5, h: 5 })).toBe(true);
    expect(overlaps({ x: 0, y: 0, w: 10, h: 10 }, { x: 10, y: 0, w: 5, h: 5 })).toBe(false);
  });
  it('knockback direction', () => {
    expect(knockback(0, 10, 100, 50)).toEqual({ kbX: 100, kbY: -50 });
    expect(knockback(10, 0, 100, 50).kbX).toBe(-100);
  });
  it('hitbox hits each target once, ignores own team, expires', () => {
    const ds = new DamageSystem();
    const e = dummy('enemy', 5);
    const ally = dummy('player', 5);
    ds.register(e);
    ds.register(ally);
    ds.add(new Hitbox('player', () => ({ x: 0, y: 0, w: 20, h: 20 }), info, 100));
    ds.update(16);
    ds.update(16);
    expect(e.hits.length).toBe(1);
    expect(ally.hits.length).toBe(0);
    ds.update(100);
    expect(ds.hitboxes.length).toBe(0);
  });
  it('reports blocked hits to onHit', () => {
    const ds = new DamageSystem();
    ds.register(dummy('enemy', 0, true));
    const results: string[] = [];
    ds.add(new Hitbox('player', () => ({ x: 0, y: 0, w: 20, h: 20 }), info, 100, (_t, r) => results.push(r)));
    ds.update(16);
    expect(results).toEqual(['blocked']);
  });
  it('owned hitboxes die with their owner and never hit afterwards', () => {
    const ds = new DamageSystem();
    const target = dummy('player', 0);
    ds.register(target);
    const owner = { alive: true };
    const onHit: string[] = [];
    const hb = ds.add(new Hitbox('enemy', () => ({ x: 100, y: 0, w: 20, h: 20 }), info, 1000, (_t, r) => onHit.push(r)).ownedBy(owner));
    ds.update(16);
    owner.alive = false;
    // target walks into the (now ownerless) hitbox
    (target as { hurtRect: () => { x: number; y: number; w: number; h: number } }).hurtRect = () => ({ x: 100, y: 0, w: 10, h: 10 });
    ds.update(16);
    expect(hb.dead).toBe(true);
    expect(target.hits.length).toBe(0);
    expect(onHit).toEqual([]);
    expect(ds.hitboxes.length).toBe(0);
  });
  it('unowned hitboxes (projectiles) outlive whoever spawned them', () => {
    const ds = new DamageSystem();
    const target = dummy('player', 0);
    ds.register(target);
    ds.add(new Hitbox('enemy', () => ({ x: 0, y: 0, w: 20, h: 20 }), info, 1000));
    ds.update(16);
    expect(target.hits.length).toBe(1);
  });
  it('stops hitting further targets once the owner died mid-update', () => {
    const ds = new DamageSystem();
    const owner = { alive: true };
    const a = dummy('enemy', 0);
    const b = dummy('enemy', 5);
    ds.register(a);
    ds.register(b);
    ds.add(new Hitbox('player', () => ({ x: 0, y: 0, w: 20, h: 20 }), info, 100, () => (owner.alive = false)).ownedBy(owner));
    ds.update(16);
    expect(a.hits.length + b.hits.length).toBe(1);
  });
});
