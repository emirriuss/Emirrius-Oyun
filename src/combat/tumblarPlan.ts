/**
 * Pure rules for TUMBLAR, THE KEYLESS DOOR (w4-9), a lock-picking puzzle boss. No Phaser imports:
 * unit-tested in tests/tumblarPlan.test.ts. Everything random takes an injectable `rnd`.
 *
 * The door's steel shell blocks every hit. Its keyhole core only opens when the current lock is
 * picked, which costs it a fixed chunk of HP (UNLOCK_CHUNK) and starts a punish window. Mistakes
 * on a lock cost time, never HP. Only its attacks hurt you.
 *
 *  Phase 1 THE TUMBLERS: five pin heads in five columns. Up-slash raises one a notch, slam lowers it.
 *    Line every head up with the key's bitting. Later locks add linked pins (moving a driver also
 *    moves its follower, the same way or the opposite way) and a spool pin (only counts as set when
 *    it is lowered into place).
 *  Phase 2 THE DIAL: a 12-number combination dial. Strike it from the left to turn it clockwise,
 *    from the right to turn it counter-clockwise (heavy = 3 numbers). A loud contact click marks the
 *    right number in the right direction. Reverse on that number to lock the digit in.
 *  Phase 3 THE WARDS: five bolts. Striking one flips it and its neighbours (1D "lights out").
 *    The door keeps re-keying (it presses a bolt itself). At 1 HP it throws its key: parry it home.
 */
import { pickMove } from './wardenPlan';

// ---------------------------------------------------------------------------- fight constants

export const TUMBLAR_HP = 150;
export const TUMBLAR_THRESHOLDS = [0.66, 0.33] as const;
export const TUMBLAR_HEARTS = { periodicMs: 24000, maxOnField: 1, perParries: 4, onPhase: 1 };
/** HP the door loses the moment a lock opens (before the punish window). ~3 locks per phase. */
export const UNLOCK_CHUNK = 16;
/** Punish window (core open) per phase, ms */
export const PUNISH_MS = [2600, 2400, 2200] as const;
/** Damage taken with the core shut (only reflected shots get through the shell) */
export const SHELL_MUL = 1;
/** Bar names per phase (each needs BOSS_PHASES / BOSS_TITLES entries in UIScene) */
export const TUMBLAR_NAMES = ['TUMBLAR, THE KEYLESS DOOR', 'TUMBLAR (THE DIAL)', 'TUMBLAR (THE WARDS)'] as const;

/** Stages a run can resume from (GameOver "Retry from ..."). */
export type TumblarStage = 'p2' | 'p3';
export const TUMBLAR_STAGE_NAMES: Record<TumblarStage, string> = { p2: 'The Dial', p3: 'The Wards' };
/** Run-timer charge when resuming, so a retry doesn't buy a better rank */
export const TUMBLAR_STAGE_MS: Record<TumblarStage, number> = { p2: 70000, p3: 140000 };

/** Phase and HP to start at for a resume stage (null = from the top). */
export function tumblarResume(stage: string | undefined): { phase: number; hpFrac: number } | null {
  if (stage === 'p2') return { phase: 2, hpFrac: TUMBLAR_THRESHOLDS[0] };
  if (stage === 'p3') return { phase: 3, hpFrac: TUMBLAR_THRESHOLDS[1] };
  return null;
}

const randInt = (rnd: () => number, lo: number, hi: number): number => lo + Math.floor(rnd() * (hi - lo + 1));

// ---------------------------------------------------------------------------- phase 1: pins

export const PINS = 5;
/** Notches per pin: 0 (lowest) .. NOTCHES-1 */
export const NOTCHES = 5;
/** Real keys never cut neighbouring depths too far apart (the "MACS" rule) */
export const MACS = 3;

/** Moving pin `from` by d also moves pin `to` by sign*d. Links are one-way and never share pins. */
export interface PinLink {
  from: number;
  to: number;
  sign: 1 | -1;
}

export interface PinLock {
  /** bitting: the notch each pin must sit at */
  target: number[];
  links: PinLink[];
  /** spool pin index (-1 = none): only set when it was lowered into place */
  spool: number;
}

export interface PinState {
  h: number[];
  /** the spool pin's last move was downward, into its target */
  spoolOk: boolean;
}

export interface PinMove {
  i: number;
  d: 1 | -1;
}

/** Apply a move (up-slash = +1, slam = -1). Returns null if a pin would leave its slot (the lock jams). */
export function applyPin(lock: PinLock, st: PinState, i: number, d: 1 | -1): PinState | null {
  const h = [...st.h];
  const delta = new Array(PINS).fill(0);
  delta[i] += d;
  for (const l of lock.links) if (l.from === i) delta[l.to] += l.sign * d;
  for (let k = 0; k < PINS; k++) {
    h[k] += delta[k];
    if (h[k] < 0 || h[k] >= NOTCHES) return null;
  }
  let spoolOk = st.spoolOk;
  const s = lock.spool;
  if (s >= 0 && delta[s] !== 0) spoolOk = delta[s] < 0 && h[s] === lock.target[s];
  return { h, spoolOk };
}

/** Per-pin read-out for the HUD: set, false set (spool at height but raised into it), or off. */
export function pinStatus(lock: PinLock, st: PinState, i: number): 'set' | 'false' | 'off' {
  if (st.h[i] !== lock.target[i]) return 'off';
  if (i === lock.spool && !st.spoolOk) return 'false';
  return 'set';
}

export function pinsSolved(lock: PinLock, st: PinState): boolean {
  for (let i = 0; i < PINS; i++) if (pinStatus(lock, st, i) !== 'set') return false;
  return true;
}

function pinMoves(lock: PinLock, st: PinState): [PinMove, PinState][] {
  const out: [PinMove, PinState][] = [];
  for (let i = 0; i < PINS; i++)
    for (const d of [1, -1] as const) {
      const n = applyPin(lock, st, i, d);
      if (n) out.push([{ i, d }, n]);
    }
  return out;
}

const PIN_STATES = NOTCHES ** PINS * 2;
const pinIndex = (st: PinState): number => {
  let n = 0;
  for (let i = PINS - 1; i >= 0; i--) n = n * NOTCHES + st.h[i];
  return n * 2 + (st.spoolOk ? 1 : 0);
};
const pinFromIndex = (n: number): PinState => {
  const spoolOk = (n & 1) === 1;
  let k = n >> 1;
  const h: number[] = [];
  for (let i = 0; i < PINS; i++) {
    h.push(k % NOTCHES);
    k = Math.floor(k / NOTCHES);
  }
  return { h, spoolOk };
};

/** Distance-to-open for every pin state of a lock: one reverse BFS from the solved states (cached per lock). */
const pinTables = new WeakMap<PinLock, Float64Array>();
function pinTable(lock: PinLock): Float64Array {
  const hit = pinTables.get(lock);
  if (hit) return hit;
  const rev: number[][] = Array.from({ length: PIN_STATES }, () => []);
  const dist = new Float64Array(PIN_STATES).fill(Infinity);
  let q: number[] = [];
  for (let n = 0; n < PIN_STATES; n++) {
    const s = pinFromIndex(n);
    if (pinsSolved(lock, s)) {
      dist[n] = 0;
      q.push(n);
    }
    for (const [, t] of pinMoves(lock, s)) rev[pinIndex(t)].push(n);
  }
  while (q.length) {
    const nq: number[] = [];
    for (const t of q)
      for (const s of rev[t])
        if (dist[s] === Infinity) {
          dist[s] = dist[t] + 1;
          nq.push(s);
        }
    q = nq;
  }
  pinTables.set(lock, dist);
  return dist;
}

/** Fewest moves to open the lock from `st`, and the first of them (the hint). */
export function solvePins(lock: PinLock, st: PinState): { dist: number; next: PinMove | null } {
  const t = pinTable(lock);
  const dist = t[pinIndex(st)];
  if (dist === 0 || dist === Infinity) return { dist, next: null };
  for (const [m, n] of pinMoves(lock, st)) if (t[pinIndex(n)] === dist - 1) return { dist, next: m };
  return { dist, next: null };
}

/** Lock difficulty by round within phase 1 (0-based): links, spool, and the min-move window of the start. */
export function pinRound(round: number): { links: number; spool: boolean; minMoves: number; maxMoves: number } {
  if (round <= 0) return { links: 0, spool: false, minMoves: 3, maxMoves: 6 };
  if (round === 1) return { links: 1, spool: false, minMoves: 4, maxMoves: 8 };
  return { links: 2, spool: true, minMoves: 5, maxMoves: 10 };
}

/** Random key bitting: depths 0..4, neighbours at most MACS apart, at least 3 distinct depths. */
export function makeBitting(rnd: () => number): number[] {
  for (;;) {
    const b = [randInt(rnd, 0, NOTCHES - 1)];
    while (b.length < PINS) {
      const prev = b[b.length - 1];
      b.push(randInt(rnd, Math.max(0, prev - MACS), Math.min(NOTCHES - 1, prev + MACS)));
    }
    if (new Set(b).size >= 3) return b;
  }
}

/** A fresh lock for `round` and the scrambled pins it starts from. */
export function makePinLock(round: number, rnd: () => number): { lock: PinLock; start: PinState } {
  const cfg = pinRound(round);
  for (;;) {
    const target = makeBitting(rnd);
    // disjoint driver -> follower pairs between neighbours-or-close pins
    const free = [0, 1, 2, 3, 4];
    const links: PinLink[] = [];
    for (let n = 0; n < cfg.links; n++) {
      const a = free.splice(randInt(rnd, 0, free.length - 1), 1)[0];
      const cands = free.filter((b) => Math.abs(b - a) <= 2);
      if (!cands.length) break;
      const b = cands[randInt(rnd, 0, cands.length - 1)];
      free.splice(free.indexOf(b), 1);
      links.push({ from: a, to: b, sign: rnd() < 0.5 ? 1 : -1 });
    }
    if (links.length < cfg.links) continue;
    // the spool is never a driver (its click must be about itself) and must be lowerable into place
    let spool = -1;
    if (cfg.spool) {
      const ok = [0, 1, 2, 3, 4].filter((i) => !links.some((l) => l.from === i) && target[i] < NOTCHES - 1);
      if (!ok.length) continue;
      spool = ok[randInt(rnd, 0, ok.length - 1)];
    }
    const lock: PinLock = { target, links, spool };
    for (let tries = 0; tries < 40; tries++) {
      const start: PinState = { h: Array.from({ length: PINS }, () => randInt(rnd, 0, NOTCHES - 1)), spoolOk: false };
      const { dist } = solvePins(lock, start);
      if (dist >= cfg.minMoves && dist <= cfg.maxMoves) return { lock, start };
    }
  }
}

/** Spring Back: which pin pops and where to. Prefers a pin you already set; never lands on its target. */
export function springPick(lock: PinLock, st: PinState, rnd: () => number): { i: number; to: number } {
  const set = [0, 1, 2, 3, 4].filter((i) => pinStatus(lock, st, i) === 'set');
  const pool = set.length ? set : [0, 1, 2, 3, 4];
  const i = pool[randInt(rnd, 0, pool.length - 1)];
  const opts = Array.from({ length: NOTCHES }, (_, v) => v).filter((v) => v !== lock.target[i] && v !== st.h[i]);
  return { i, to: opts[randInt(rnd, 0, opts.length - 1)] };
}

/** Pin `i` jumps to `to` on its own (links don't fire). A moved spool pin loses its set. */
export function springPin(lock: PinLock, st: PinState, i: number, to: number): PinState {
  const h = [...st.h];
  h[i] = to;
  return { h, spoolOk: i === lock.spool ? false : st.spoolOk };
}

// ---------------------------------------------------------------------------- phase 2: dial

export const DIAL_N = 12;
/** 1 = clockwise (numbers count up), -1 = counter-clockwise */
export type Dir = 1 | -1;

export interface DialLock {
  combo: number[];
  /** direction each digit must be dialled in: right, left, right */
  dirs: Dir[];
}

export interface DialState {
  pos: number;
  /** digits locked in so far */
  got: number;
  /** direction of the last turn (0 = none yet) */
  last: Dir | 0;
}

export type DialEvent = 'contact' | 'capture' | 'slip' | 'open';

const mod = (n: number, m: number) => ((n % m) + m) % m;

/** Steps from a to b turning in `dir`. */
export function dialSteps(a: number, b: number, dir: Dir): number {
  return mod((b - a) * dir, DIAL_N);
}

/**
 * Turn the dial `steps` in `dir`. Reversing direction while on the wanted number (after turning the
 * wanted way) locks that digit in ('capture'); reversing anywhere else is a 'slip' (no penalty, no
 * progress). Every step that lands on the wanted number in the wanted direction is a 'contact'.
 */
export function turnDial(lock: DialLock, st: DialState, dir: Dir, steps: number): { st: DialState; events: DialEvent[] } {
  const ev: DialEvent[] = [];
  let { pos, got } = st;
  if (got >= lock.combo.length) return { st, events: ev };
  if (st.last !== 0 && dir !== st.last && st.last === lock.dirs[got]) {
    if (pos === lock.combo[got]) {
      got++;
      ev.push('capture');
      if (got >= lock.combo.length) {
        ev.push('open');
        return { st: { pos, got, last: dir }, events: ev };
      }
    } else ev.push('slip');
  }
  for (let s = 0; s < steps; s++) {
    pos = mod(pos + dir, DIAL_N);
    if (dir === lock.dirs[got] && pos === lock.combo[got]) ev.push('contact');
  }
  return { st: { pos, got, last: dir }, events: ev };
}

/** Relock: the door yanks the last digit back out. */
export function relockDial(st: DialState): DialState {
  return { pos: st.pos, got: Math.max(0, st.got - 1), last: 0 };
}

/** A combination: right / left / right, every leg 3..8 numbers long, never starting on 0. */
export function makeDial(rnd: () => number): DialLock {
  const dirs: Dir[] = [1, -1, 1];
  const combo: number[] = [];
  let at = 0;
  for (const d of dirs) {
    const legLen = randInt(rnd, 3, 8);
    at = mod(at + d * legLen, DIAL_N);
    combo.push(at);
  }
  return { combo, dirs };
}

/** Fewest light hits that open the dial from rest at 0 (each leg + one reversing hit per digit). */
export function dialLightHits(lock: DialLock): number {
  let at = 0;
  let hits = 0;
  lock.combo.forEach((c, k) => {
    // after a capture the reversing hit already moved one step in this leg's direction
    const from = k === 0 ? at : mod(at + lock.dirs[k], DIAL_N);
    hits += dialSteps(from, c, lock.dirs[k]) + 1;
    at = c;
  });
  return hits;
}

// ---------------------------------------------------------------------------- phase 3: bolts

export const BOLTS = 5;
const ALL = (1 << BOLTS) - 1;

/** Strike bolt i: it and its neighbours flip (bit set = bolt thrown / locked). */
export function pressBolt(bits: number, i: number): number {
  let m = 1 << i;
  if (i > 0) m |= 1 << (i - 1);
  if (i < BOLTS - 1) m |= 1 << (i + 1);
  return (bits ^ m) & ALL;
}

/** Distance to all-open (0) for every state: one BFS from 0 (presses are their own inverse). */
const BOLT_DIST: number[] = (() => {
  const d = new Array(ALL + 1).fill(Infinity);
  d[0] = 0;
  let q = [0];
  while (q.length) {
    const nq: number[] = [];
    for (const s of q)
      for (let i = 0; i < BOLTS; i++) {
        const n = pressBolt(s, i);
        if (d[n] === Infinity) {
          d[n] = d[s] + 1;
          nq.push(n);
        }
      }
    q = nq;
  }
  return d;
})();

/** Fewest strikes to open every bolt, and the first of them. */
export function solveBolts(bits: number): { dist: number; next: number | null } {
  const dist = BOLT_DIST[bits & ALL];
  if (dist === 0 || dist === Infinity) return { dist, next: null };
  for (let i = 0; i < BOLTS; i++) if (BOLT_DIST[pressBolt(bits, i)] === dist - 1) return { dist, next: i };
  return { dist, next: null };
}

/**
 * Bolts for P3 lock `round`: a random solvable state 2..3 strikes from open (3 is the maximum for five
 * bolts). Picked from the distance table, not by scrambling: a fixed number of scramble presses only
 * reaches states of one press-parity.
 */
export function makeBolts(round: number, rnd: () => number): number {
  const lo = round <= 0 ? 2 : 3;
  const pool = BOLT_DIST.map((d, b) => [d, b]).filter(([d]) => d >= lo && d <= 3).map(([, b]) => b);
  return pool[randInt(rnd, 0, pool.length - 1)];
}

/** Re-key: the door presses a bolt itself (stays solvable), never opening the lock for you. */
export function rekeyPick(bits: number, rnd: () => number): number {
  const ok = [0, 1, 2, 3, 4].filter((i) => {
    const n = pressBolt(bits, i);
    return n !== 0 && BOLT_DIST[n] <= 3;
  });
  const pool = ok.length ? ok : [0, 1, 2, 3, 4];
  return pool[randInt(rnd, 0, pool.length - 1)];
}

// ---------------------------------------------------------------------------- moves

export type TumblarMove =
  | 'deadbolt' // a bar slides out of the door across one height band (red: jump it / duck it)
  | 'keytoss' // the key flies at you (parryable: the reflection chips the shell)
  | 'spring' // a pin you set pops to a wrong notch (P1)
  | 'numbers' // three numerals spat at you (parryable)
  | 'gears' // tumbler wheels roll along the floor (red: jump)
  | 'relock' // a hook flies at the dial; parry it or lose a digit (P2)
  | 'rekey'; // the door presses a bolt (P3)

export interface TumblarCtx {
  /** P1: pins currently set; P2: digits locked in; P3: strikes still needed */
  progress: number;
  /** player is up high (on a pin head / ledge) */
  high: boolean;
}

const has = (cond: boolean, w: number): number => (cond ? w : 0);

/** Move weights for phase 1..3. Pressure grows with your progress (the door fights back harder near an unlock). */
export function tumblarWeights(phase: number, ctx: TumblarCtx): [TumblarMove, number][] {
  const p = Math.min(3, Math.max(1, phase));
  const w: [TumblarMove, number][] = [
    ['deadbolt', p === 1 ? (ctx.high ? 4 : 3) : 2],
    ['keytoss', p === 2 ? 2 : 3],
    ['spring', has(p === 1 && ctx.progress >= 2, 2 + ctx.progress)],
    ['numbers', has(p >= 2, 3)],
    ['gears', has(p >= 2, ctx.high ? 1 : 3)],
    ['relock', has(p === 2 && ctx.progress >= 1, 2 + ctx.progress)],
    ['rekey', has(p === 3 && ctx.progress <= 2, 4)],
  ];
  return w.filter(([, n]) => n > 0);
}

/** Next attack: weighted, never the same move twice in a row. */
export function chooseTumblarMove(phase: number, ctx: TumblarCtx, history: readonly TumblarMove[], rnd: () => number = Math.random): TumblarMove {
  const last = history[history.length - 1];
  const w = tumblarWeights(phase, ctx).filter(([m]) => m !== last);
  return pickMove(w, history, rnd) ?? 'deadbolt';
}

/** Idle gap between attacks per phase (ms): room to work the lock. */
export const ATTACK_GAP = [2200, 1900, 1700] as const;
/** Telegraph per move per phase (ms) */
export const TELE: Record<TumblarMove, readonly [number, number, number]> = {
  deadbolt: [800, 700, 620],
  keytoss: [650, 560, 500],
  spring: [800, 800, 800],
  numbers: [600, 520, 460],
  gears: [700, 620, 560],
  relock: [700, 650, 600],
  rekey: [900, 900, 800],
};
/** Deadbolt bands: [top, bottom] px above the floor. Low = jump it, high = stay down. */
export const DEADBOLT_BANDS: readonly [number, number][] = [
  [18, 2],
  [64, 44],
];

/** Hints: after this many moves in a row that don't bring the lock closer, glow the next right move. */
export const HINT_AFTER = 2;
