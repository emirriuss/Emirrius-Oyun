/**
 * Pure "habit reader" for reactive boss AI (Aurren). The boss feeds it player events and periodic
 * samples; it reports which habit the player is leaning on so the boss can pick a counter.
 * Kept free of Phaser so it's unit-testable.
 */

export type Habit = 'spam' | 'turtle' | 'air' | 'dash' | 'parry' | 'none';
export type ReadEvent = 'swing' | 'dash' | 'parry' | 'special';

export const READ = {
  /** history kept, ms */
  windowMs: 6000,
  /** spam: >= swings within spamMs */
  spamSwings: 5,
  spamMs: 3000,
  /** dash habit: >= dashes within dashMs */
  dashCount: 3,
  dashMs: 4000,
  /** parry habit: >= parries on the boss within the whole window */
  parryCount: 2,
  /** air habit: fraction of sampled time airborne (needs airMinMs of samples) */
  airFrac: 0.45,
  airMinMs: 2500,
  /** turtle: average distance above this and at most turtleSwings swings in the window */
  turtleDist: 150,
  turtleSwings: 1,
  /** chance that a read habit actually triggers its counter (randomness always remains) */
  counterChance: 0.45,
  /** the same counter can't fire again for this long */
  counterCooldownMs: 8000,
} as const;

interface Sample {
  t: number;
  air: boolean;
  dist: number;
}

export class PlayerReader {
  private events: { t: number; e: ReadEvent }[] = [];
  private samples: Sample[] = [];

  note(e: ReadEvent, t: number): void {
    this.events.push({ t, e });
    this.prune(t);
  }

  sample(t: number, airborne: boolean, dist: number): void {
    this.samples.push({ t, air: airborne, dist });
    this.prune(t);
  }

  /** Forget everything (e.g. after a phase change so the new form reads afresh). */
  reset(): void {
    this.events = [];
    this.samples = [];
  }

  count(e: ReadEvent, t: number, ms: number = READ.windowMs): number {
    let n = 0;
    for (const x of this.events) if (x.e === e && t - x.t <= ms) n++;
    return n;
  }

  /** Fraction of samples airborne, or 0 when there isn't airMinMs of history yet. */
  airFrac(t: number): number {
    const s = this.samples.filter((x) => t - x.t <= READ.windowMs);
    if (s.length < 2 || t - s[0].t < READ.airMinMs) return 0;
    return s.filter((x) => x.air).length / s.length;
  }

  avgDist(t: number): number {
    const s = this.samples.filter((x) => t - x.t <= READ.windowMs);
    if (!s.length) return 0;
    return s.reduce((a, x) => a + x.dist, 0) / s.length;
  }

  /** Strongest habit right now, in priority order. */
  habit(t: number): Habit {
    if (this.count('parry', t) >= READ.parryCount) return 'parry';
    if (this.count('swing', t, READ.spamMs) >= READ.spamSwings) return 'spam';
    if (this.count('dash', t, READ.dashMs) >= READ.dashCount) return 'dash';
    if (this.airFrac(t) > READ.airFrac) return 'air';
    const enough = this.samples.length >= 2 && t - this.samples[0].t >= READ.airMinMs;
    if (enough && this.avgDist(t) > READ.turtleDist && this.count('swing', t) + this.count('special', t) <= READ.turtleSwings) return 'turtle';
    return 'none';
  }

  private prune(t: number): void {
    const cut = t - READ.windowMs;
    while (this.events.length && this.events[0].t < cut) this.events.shift();
    while (this.samples.length && this.samples[0].t < cut) this.samples.shift();
  }
}

/**
 * Feed the reader one 'swing' per new player swing. `count` is the player's running swing counter
 * (it grows on every swing, combo follow-ups included); `prev` is the last value seen, or a negative
 * number before the first read. The first read, or a counter that went backwards (a new player
 * object), only syncs without noting old swings. Returns the value to pass as `prev` next time.
 */
export function noteSwings(reader: PlayerReader, prev: number, count: number, now: number): number {
  if (prev >= 0 && count > prev) for (let i = prev; i < count; i++) reader.note('swing', now);
  return count;
}

/**
 * Should the boss answer `habit` with its counter now? Needs a habit, the counter off cooldown and a
 * roll under counterChance (`roll` in [0, 1), injected for tests).
 */
export function shouldCounter(habit: Habit, lastCounterAt: number, now: number, roll: number): boolean {
  if (habit === 'none') return false;
  if (now - lastCounterAt < READ.counterCooldownMs) return false;
  return roll < READ.counterChance;
}

/**
 * Weighted pick. Moves with weight <= 0 are skipped, and a move used for the last two picks in a row
 * (`hist[0] === hist[1]`) is banned so nothing repeats 3 times. `roll` in [0, 1).
 */
export function pickWeighted<M extends string>(table: [M, number][], hist: readonly M[], roll: number): M | null {
  const banned = hist.length >= 2 && hist[0] === hist[1] ? hist[0] : null;
  let opts = table.filter(([m, w]) => w > 0 && m !== banned);
  if (!opts.length) opts = table.filter(([, w]) => w > 0);
  if (!opts.length) return null;
  const total = opts.reduce((s, [, w]) => s + w, 0);
  let r = roll * total;
  for (const [m, w] of opts) {
    r -= w;
    if (r < 0) return m;
  }
  return opts[opts.length - 1][0];
}
