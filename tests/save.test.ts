import { describe, it, expect } from 'vitest';
import { SaveSystem, SAVE_VERSION, computeRank, type Storage } from '../src/systems/SaveSystem';
import { buyUpgrade, computeStats, nextCost } from '../src/systems/Progression';
import { DEFAULT_KEYS, remapKey } from '../src/core/keys';

function mem(): Storage {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k) };
}

describe('save system', () => {
  it('round-trips through storage', () => {
    const st = mem();
    const a = new SaveSystem(st);
    a.addShards(50);
    a.completeLevel('w1-1', { rank: 'B', timeMs: 60000 });
    a.save();
    const b = new SaveSystem(st);
    expect(b.data.shards).toBe(50);
    expect(b.isCompleted('w1-1')).toBe(true);
  });
  it('keeps best record', () => {
    const s = new SaveSystem(mem());
    s.completeLevel('x', { rank: 'A', timeMs: 50000 });
    s.completeLevel('x', { rank: 'B', timeMs: 10000 });
    expect(s.data.records.x.rank).toBe('A');
    s.completeLevel('x', { rank: 'A', timeMs: 40000 });
    expect(s.data.records.x.timeMs).toBe(40000);
  });
  it('survives corrupt data', () => {
    const st = mem();
    st.setItem('emirrius-save-v1', '{nope');
    expect(new SaveSystem(st).data.shards).toBe(0);
  });
  it('ranks', () => {
    expect(computeRank(1000, 2000, 0, 1)).toBe('S');
    expect(computeRank(99999, 2000, 10, 0)).toBe('C');
    // fast + no damage but skipping every enemy is not an A
    expect(computeRank(1000, 2000, 0, 0)).toBe('B');
    expect(computeRank(1000, 2000, 2, 0.95)).toBe('A');
  });
  it('upgrades cost shards and change stats', () => {
    const s = new SaveSystem(mem());
    expect(buyUpgrade(s.data, 'maxHp')).toBe(false);
    s.addShards(1000);
    const before = computeStats(s.data).maxHp;
    expect(buyUpgrade(s.data, 'maxHp')).toBe(true);
    expect(computeStats(s.data).maxHp).toBe(before + 1);
    expect(s.data.shards).toBe(970);
    while (buyUpgrade(s.data, 'maxHp'));
    expect(nextCost(s.data, 'maxHp')).toBeNull();
  });
  it('shop upgrades have the expanded level counts', () => {
    const s = new SaveSystem(mem());
    s.addShards(100000);
    const levels = { maxHp: 5, damage: 5, stamina: 4, comboPlus: 1, energySlash: 3 } as const;
    for (const [id, max] of Object.entries(levels) as [keyof typeof levels, number][]) {
      let n = 0;
      while (buyUpgrade(s.data, id)) n++;
      expect(n).toBe(max);
      expect(nextCost(s.data, id)).toBeNull();
    }
    const st = computeStats(s.data);
    expect(st.damageMul).toBeCloseTo(2);
    expect(st.energySlashLvl).toBe(3);
  });
  it('wave edge level follows the save (legacy one-level saves become level 1)', () => {
    const s = new SaveSystem(mem());
    expect(computeStats(s.data).energySlashLvl).toBe(0);
    s.data.upgrades.energySlash = 1;
    expect(computeStats(s.data).energySlashLvl).toBe(1);
  });
});

describe('save migration', () => {
  const load = (obj: unknown) => {
    const st = mem();
    st.setItem('emirrius-save-v1', typeof obj === 'string' ? obj : JSON.stringify(obj));
    return new SaveSystem(st).data;
  };
  it('fills settings fields added after the save was written (music, fx)', () => {
    const d = load({ version: 1, completed: ['w1-1'], records: {}, shards: 12, upgrades: {}, settings: { volume: 0.3, difficulty: 'hard', shake: false } });
    expect(d.settings.music).toBe(true);
    expect(d.settings.fx).toBe(true);
    expect(d.settings.rumble).toBe(true);
    expect(d.settings.volume).toBe(0.3);
    expect(d.settings.difficulty).toBe('hard');
    expect(d.settings.shake).toBe(false);
    expect(d.completed).toEqual(['w1-1']);
    expect(d.shards).toBe(12);
  });
  it('keeps a saved rumble=false and fixes a bad rumble value', () => {
    expect(load({ settings: { rumble: false } }).settings.rumble).toBe(false);
    expect(load({ settings: { rumble: 'no' } }).settings.rumble).toBe(true);
  });
  it('drops the removed parry binding from old saved keymaps', () => {
    const keys = { ...DEFAULT_KEYS, attack: ['Q', 'J'], parry: ['V', 'L'] };
    const d = load({ version: 1, completed: [], records: {}, shards: 0, upgrades: {}, settings: { volume: 0.5, difficulty: 'normal', shake: true, keys } });
    expect('parry' in d.settings.keys).toBe(false);
    expect(Object.keys(d.settings.keys).sort()).toEqual(Object.keys(DEFAULT_KEYS).sort());
    expect(d.settings.keys.attack).toEqual(['Q', 'J']);
    expect(d.settings.keys.special).toEqual(DEFAULT_KEYS.special);
  });
  it('replaces wrong types per field instead of crashing later', () => {
    const d = load({ completed: null, records: 5, shards: 'lots', upgrades: [1], settings: { volume: 7, difficulty: 'nightmare', music: 'yes', keys: 'X' } });
    expect(d.completed).toEqual([]);
    expect(d.records).toEqual({});
    expect(d.shards).toBe(0);
    expect(d.upgrades).toEqual({});
    expect(d.settings.volume).toBe(1);
    expect(d.settings.difficulty).toBe('normal');
    expect(d.settings.music).toBe(true);
    expect(d.settings.keys).toEqual(DEFAULT_KEYS);
    expect(() => computeStats(d)).not.toThrow();
  });
  it('handles JSON that is not an object', () => {
    expect(load('null').shards).toBe(0);
    expect(load('42').completed).toEqual([]);
    expect(load('[1,2]').settings.keys).toEqual(DEFAULT_KEYS);
  });
  it('drops invalid records and unknown upgrades', () => {
    const d = load({ records: { 'w1-1': { rank: 'S', timeMs: 1000 }, 'w1-2': { rank: 'Z', timeMs: 5 }, 'w1-3': { rank: 'A' } }, upgrades: { maxHp: 2, bogus: 3, damage: -1 } });
    expect(Object.keys(d.records)).toEqual(['w1-1']);
    expect(d.upgrades).toEqual({ maxHp: 2 });
  });
  it('keeps the shrine passives added later', () => {
    const d = load({ upgrades: { parryWard: 2, fleetStep: 1, lodestone: 2, bloodPact: 3, secondWind: 1, bogus: 1 } });
    expect(d.upgrades).toEqual({ parryWard: 2, fleetStep: 1, lodestone: 2, bloodPact: 3, secondWind: 1 });
  });
  it('empty / partial key bindings fall back per action', () => {
    const d = load({ settings: { keys: { left: [], jump: ['Q'], attack: [3, 'J'], dash: 'C' } } });
    expect(d.settings.keys.left).toEqual(DEFAULT_KEYS.left);
    expect(d.settings.keys.jump).toEqual(['Q']);
    expect(d.settings.keys.attack).toEqual(['J']);
    expect(d.settings.keys.dash).toEqual(DEFAULT_KEYS.dash);
    expect(d.settings.keys.pause).toEqual(DEFAULT_KEYS.pause);
  });
  it('survives storage that throws', () => {
    const bad: Storage = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('quota'); }, removeItem: () => {} };
    const s = new SaveSystem(bad);
    expect(s.data.shards).toBe(0);
    expect(() => s.completeLevel('w1-1', { rank: 'A', timeMs: 1 })).not.toThrow();
    expect(s.isCompleted('w1-1')).toBe(true);
  });
});

describe('save migration v1 -> v2 (Moth moved w4-2 -> w4-3)', () => {
  const load = (obj: unknown) => {
    const st = mem();
    st.setItem('emirrius-save-v1', JSON.stringify(obj));
    return new SaveSystem(st).data;
  };
  it('moves an old w4-2 (Moth) clear and record to w4-3 and keeps w4-2 cleared', () => {
    const d = load({ version: 1, completed: ['w4-1', 'w4-2'], records: { 'w4-1': { rank: 'A', timeMs: 9 }, 'w4-2': { rank: 'S', timeMs: 123 } } });
    expect(d.version).toBe(SAVE_VERSION);
    expect(d.completed).toContain('w4-2');
    expect(d.completed).toContain('w4-3');
    expect(d.records['w4-3']).toEqual({ rank: 'S', timeMs: 123 });
    expect(d.records['w4-2']).toBeUndefined();
    expect(d.records['w4-1']).toEqual({ rank: 'A', timeMs: 9 });
  });
  it('shifts Aurren (w4-3 -> w4-4) and Fromage (w4-4 -> w4-5) too', () => {
    const d = load({
      version: 1,
      completed: ['w4-1', 'w4-2', 'w4-3', 'w4-4'],
      records: { 'w4-2': { rank: 'A', timeMs: 2 }, 'w4-3': { rank: 'S', timeMs: 3 }, 'w4-4': { rank: 'B', timeMs: 4 } },
    });
    expect([...d.completed].sort()).toEqual(['w4-1', 'w4-2', 'w4-3', 'w4-4', 'w4-5']);
    expect(d.records).toEqual({ 'w4-3': { rank: 'A', timeMs: 2 }, 'w4-4': { rank: 'S', timeMs: 3 }, 'w4-5': { rank: 'B', timeMs: 4 } });
  });
  it('treats a save without a version as v1', () => {
    const d = load({ completed: ['w4-2'], records: { 'w4-2': { rank: 'B', timeMs: 5 } } });
    expect([...d.completed].sort()).toEqual(['w4-2', 'w4-3']);
    expect(d.records).toEqual({ 'w4-3': { rank: 'B', timeMs: 5 } });
  });
  it('leaves a fresh save untouched', () => {
    const st = mem();
    const d = new SaveSystem(st).data;
    expect(d.version).toBe(SAVE_VERSION);
    expect(d.completed).toEqual([]);
    expect(d.records).toEqual({});
  });
  it('leaves an old save that never reached w4-2 untouched', () => {
    const d = load({ version: 1, completed: ['w4-1'], records: { 'w4-1': { rank: 'C', timeMs: 1 } } });
    expect(d.completed).toEqual(['w4-1']);
    expect(d.records).toEqual({ 'w4-1': { rank: 'C', timeMs: 1 } });
  });
  it('does not re-migrate an already migrated save', () => {
    // v2: w4-2 is the Croupier, cleared on its own; the Moth (w4-3) not yet beaten
    const d = load({ version: SAVE_VERSION, completed: ['w4-1', 'w4-2'], records: { 'w4-2': { rank: 'A', timeMs: 77 } } });
    expect(d.completed).toEqual(['w4-1', 'w4-2']);
    expect(d.records).toEqual({ 'w4-2': { rank: 'A', timeMs: 77 } });
  });
  it('round-trips: saving a migrated save and loading it again changes nothing', () => {
    const st = mem();
    st.setItem('emirrius-save-v1', JSON.stringify({ version: 1, completed: ['w4-2'], records: { 'w4-2': { rank: 'S', timeMs: 1 } } }));
    const a = new SaveSystem(st);
    a.save();
    const b = new SaveSystem(st).data;
    expect([...b.completed].sort()).toEqual(['w4-2', 'w4-3']);
    expect(b.records).toEqual({ 'w4-3': { rank: 'S', timeMs: 1 } });
  });
});

describe('key remap', () => {
  const REMAP = ['jump', 'attack', 'dash', 'special', 'left', 'right', 'up', 'down'] as const;
  it('moves a key off the action that had it', () => {
    const k = remapKey(DEFAULT_KEYS, 'jump', 'X', REMAP)!;
    expect(k.jump).toEqual(['X', 'Z']);
    expect(k.attack).toEqual(['J']);
    expect(DEFAULT_KEYS.attack).toEqual(['X', 'J']); // input not mutated
  });
  it('never leaves an action unbound', () => {
    let k = remapKey(DEFAULT_KEYS, 'attack', 'Q', REMAP)!; // attack = Q, X
    k = remapKey(k, 'attack', 'R', REMAP)!; // attack = R, Q (X dropped)
    k = { ...k, special: ['T'] };
    const r = remapKey(k, 'jump', 'T', REMAP)!; // special's only key is taken by jump
    expect(r.jump).toEqual(['T', 'Z']);
    expect(r.special.length).toBe(1);
    expect(r.special[0]).toBe('SPACE'); // the key jump just lost
    for (const a of REMAP) expect(r[a].length).toBeGreaterThan(0);
  });
  it('keeps keys unique across gameplay actions', () => {
    let k = DEFAULT_KEYS;
    for (const [a, key] of [['jump', 'X'], ['attack', 'Z'], ['dash', 'LEFT'], ['left', 'C'], ['special', 'X']] as const) k = remapKey(k, a, key, REMAP)!;
    const all = REMAP.flatMap((a) => k[a]);
    expect(new Set(all).size).toBe(all.length);
  });
  it('reserves pause keys (cancel)', () => {
    expect(remapKey(DEFAULT_KEYS, 'jump', 'ESC', REMAP)).toBeNull();
    expect(remapKey(DEFAULT_KEYS, 'jump', 'P', REMAP)).toBeNull();
  });
  it('rebinding to a key already on the action just reorders it', () => {
    const k = remapKey(DEFAULT_KEYS, 'jump', 'SPACE', REMAP)!;
    expect(k.jump).toEqual(['SPACE', 'Z']);
  });
});
