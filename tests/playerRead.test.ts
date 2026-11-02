import { describe, it, expect } from 'vitest';
import { PlayerReader, READ, shouldCounter, pickWeighted } from '../src/combat/playerRead';

/** samples every 100 ms from t0 to t1 */
function fill(r: PlayerReader, t0: number, t1: number, air: (t: number) => boolean, dist = 60): void {
  for (let t = t0; t <= t1; t += 100) r.sample(t, air(t), dist);
}

describe('PlayerReader', () => {
  it('reads nothing from an empty history', () => {
    expect(new PlayerReader().habit(1000)).toBe('none');
  });

  it('detects attack spam only inside the spam window', () => {
    const r = new PlayerReader();
    for (let i = 0; i < READ.spamSwings; i++) r.note('swing', 10000 + i * 400);
    expect(r.habit(10000 + 4 * 400)).toBe('spam');
    // the same swings 4 s later no longer count as spam
    expect(r.habit(10000 + 4 * 400 + READ.spamMs + 1)).not.toBe('spam');
  });

  it('detects dash habit', () => {
    const r = new PlayerReader();
    for (let i = 0; i < READ.dashCount; i++) r.note('dash', 5000 + i * 900);
    expect(r.habit(5000 + 2 * 900)).toBe('dash');
  });

  it('parry habit outranks spam', () => {
    const r = new PlayerReader();
    for (let i = 0; i < 6; i++) r.note('swing', 1000 + i * 200);
    r.note('parry', 1500);
    r.note('parry', 2000);
    expect(r.habit(2100)).toBe('parry');
  });

  it('needs enough history before reading air time', () => {
    const r = new PlayerReader();
    fill(r, 0, 1000, () => true);
    expect(r.airFrac(1000)).toBe(0);
    fill(r, 1100, 4000, () => true);
    expect(r.habit(4000)).toBe('air');
  });

  it('mostly-grounded play is not air', () => {
    const r = new PlayerReader();
    fill(r, 0, 5000, (t) => t % 1000 < 300);
    expect(r.habit(5000)).not.toBe('air');
  });

  it('turtle = far away and passive', () => {
    const r = new PlayerReader();
    fill(r, 0, 4000, () => false, 220);
    expect(r.habit(4000)).toBe('turtle');
    r.note('swing', 4000);
    r.note('special', 4000);
    expect(r.habit(4000)).toBe('none');
  });

  it('forgets events older than the window', () => {
    const r = new PlayerReader();
    r.note('parry', 0);
    r.note('parry', 100);
    r.note('swing', READ.windowMs + 500); // prunes
    expect(r.count('parry', READ.windowMs + 500)).toBe(0);
  });

  it('reset clears everything', () => {
    const r = new PlayerReader();
    r.note('parry', 0);
    r.note('parry', 10);
    r.reset();
    expect(r.habit(20)).toBe('none');
  });
});

describe('shouldCounter', () => {
  it('never counters without a habit', () => {
    expect(shouldCounter('none', -1e9, 0, 0)).toBe(false);
  });
  it('respects the counter cooldown', () => {
    expect(shouldCounter('spam', 1000, 1000 + READ.counterCooldownMs - 1, 0)).toBe(false);
    expect(shouldCounter('spam', 1000, 1000 + READ.counterCooldownMs, 0)).toBe(true);
  });
  it('is a chance, not a certainty', () => {
    expect(shouldCounter('air', -1e9, 0, READ.counterChance - 0.01)).toBe(true);
    expect(shouldCounter('air', -1e9, 0, READ.counterChance)).toBe(false);
  });
});

describe('pickWeighted', () => {
  const table: ['a' | 'b' | 'c', number][] = [['a', 1], ['b', 1], ['c', 0]];
  it('picks by weight and skips zero weights', () => {
    expect(pickWeighted(table, [], 0)).toBe('a');
    expect(pickWeighted(table, [], 0.99)).toBe('b');
  });
  it('bans a third repeat', () => {
    expect(pickWeighted(table, ['a', 'a'], 0)).toBe('b');
    expect(pickWeighted(table, ['a', 'b'], 0)).toBe('a');
  });
  it('falls back when the ban would empty the table', () => {
    expect(pickWeighted([['a', 1]], ['a', 'a'], 0.5)).toBe('a');
  });
  it('returns null for an all-zero table', () => {
    expect(pickWeighted([['a', 0]], [], 0.5)).toBeNull();
  });
});
