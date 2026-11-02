/**
 * Pure decision logic for ERRATUM, the Unwritten (w4-6). No Phaser imports: unit-tested in
 * tests/erratumPlan.test.ts. Everything random takes an injectable `rnd` so runs are reproducible.
 */
import { pickMove } from './wardenPlan';

export { pickMove };

/** Reveal -> damage floor per draft (index 0..2). Every rule-bend is shown at least this long. */
export const WINDUP_FLOOR = [520, 460, 400] as const;

export type ErratumMove =
  // Draft 1 "The Page"
  | 'strike' // Strikethrough: erase floor columns
  | 'insert' // Insert Line: write ink one-way platforms, then dive from them
  | 'glyphs' // Falling Glyphs: the level's own ASCII rains down
  | 'typo' // Typo: lies about which way it's coming from
  // Draft 2 "The Frame"
  | 'bar' // grabs its HP bar off the HUD and swings it
  | 'hearts' // steals hearts out of the HUD
  | 'rotate' // turns the page (camera rotation)
  | 'letterbox' // cinematic bars slam shut, except a scribbled gap
  // Draft 3 "The Engine"
  | 'crash' // fake "not responding" dialog
  | 'title' // the title menu falls in as slabs
  | 'map' // world-map nodes as platforms, it stomps them
  | 'credits' // credits roll as climbing platforms
  | 'rewind'; // ink copies replay your last 2s

const has = (cond: boolean, w: number): number => (cond ? w : 0);

/**
 * Move weights for draft `phase` (1..3). `dx` = |boss - player| px, `high` = player well above it.
 * `once` = one-shot moves already used this fight (crash), `tricks` = false disables camera rotation
 * (Settings > Screen tricks; the crash then runs in its gentle in-arena form).
 */
export function erratumWeights(phase: number, dx: number, high: boolean, once: ReadonlySet<ErratumMove>, tricks = true): [ErratumMove, number][] {
  const p = Math.min(3, Math.max(1, phase));
  const w: [ErratumMove, number][] = [
    ['strike', p === 1 ? 4 : 2],
    ['insert', has(p <= 2, high ? 4 : 2)],
    ['glyphs', p === 1 ? 4 : 2],
    ['typo', has(p === 1 || p === 3, dx > 120 ? 3 : 2)],
    ['bar', has(p >= 2, p === 2 ? 4 : 2)],
    ['hearts', has(p === 2, 2)],
    ['rotate', has(p >= 2 && tricks, p === 2 ? 3 : 1)],
    ['letterbox', has(p >= 2, 3)],
    ['crash', has(p === 3 && !once.has('crash'), 6)],
    ['title', has(p === 3, 3)],
    ['map', has(p === 3, 3)],
    ['credits', has(p === 3 && !once.has('credits'), 4)],
    ['rewind', has(p === 3, 3)],
  ];
  return w.filter(([, n]) => n > 0);
}

// ---------------------------------------------------------------------------- Strikethrough

/** Floor columns (inclusive range) erased by one Strikethrough. */
export interface Span {
  c0: number;
  c1: number;
}

/**
 * Pick 1..3 floor spans to erase between columns [left, right] (inner floor, walls excluded).
 * Rules (tested): spans never overlap the walls, at most 40% of the floor goes, a run of at least
 * `minSafe` intact columns always remains, and spans are separated by >= 3 intact columns.
 * The first span is centred near the player so it reads as aimed.
 */
export function strikeSpans(left: number, right: number, playerCol: number, phase: number, rnd: () => number, minSafe = 4): Span[] {
  const width = right - left + 1;
  const budget = Math.floor(width * 0.4);
  const count = Math.min(3, phase);
  const spans: Span[] = [];
  let used = 0;
  for (let k = 0; k < count && used < budget; k++) {
    const len = Math.min(budget - used, 3 + Math.floor(rnd() * 3)); // 3..5
    if (len < 2) break;
    for (let tries = 0; tries < 12; tries++) {
      const centre = k === 0 && tries < 6 ? playerCol + Math.round((rnd() - 0.5) * 4) : left + Math.floor(rnd() * width);
      const c0 = Math.max(left, Math.min(right - len + 1, centre - Math.floor(len / 2)));
      const s = { c0, c1: c0 + len - 1 };
      if (spans.some((o) => s.c0 <= o.c1 + 3 && s.c1 >= o.c0 - 3)) continue;
      const next = [...spans, s];
      if (longestSafe(left, right, next) < minSafe) continue;
      spans.push(s);
      used += len;
      break;
    }
  }
  return spans.sort((a, b) => a.c0 - b.c0);
}

/** Longest run of intact columns in [left, right] given erased spans. */
export function longestSafe(left: number, right: number, spans: readonly Span[]): number {
  let best = 0;
  let run = 0;
  for (let c = left; c <= right; c++) {
    if (spans.some((s) => c >= s.c0 && c <= s.c1)) run = 0;
    else best = Math.max(best, ++run);
  }
  return best;
}

/** Nearest intact column to `col` (for moving the respawn point off an erased span). */
export function nearestSafe(col: number, left: number, right: number, spans: readonly Span[]): number {
  const erased = (c: number) => spans.some((s) => c >= s.c0 && c <= s.c1);
  for (let d = 0; d <= right - left; d++) {
    if (col - d >= left && !erased(col - d)) return col - d;
    if (col + d <= right && !erased(col + d)) return col + d;
  }
  return col;
}

// ---------------------------------------------------------------------------- Falling Glyphs

/** Characters from the level files, each with its own behaviour on landing. */
export type Glyph = '#' | '=' | '^' | 'P' | 'E';

/**
 * A volley of `n` glyphs. Always at least one '=' (a stepping stone) and never more than one 'P'
 * or 'E' (the copies / fake exits are the spice, not the meal).
 */
export function glyphVolley(n: number, phase: number, rnd: () => number): Glyph[] {
  const pool: [Glyph, number][] = [['#', 4], ['=', 3], ['^', phase >= 2 ? 3 : 2], ['P', 1], ['E', 1]];
  const out: Glyph[] = [];
  for (let i = 0; i < n; i++) {
    const ok = pool.filter(([g]) => !((g === 'P' || g === 'E') && out.includes(g)));
    const total = ok.reduce((s, [, w]) => s + w, 0);
    let r = rnd() * total;
    let pick: Glyph = ok[ok.length - 1][0];
    for (const [g, w] of ok) if ((r -= w) < 0) {
      pick = g;
      break;
    }
    out.push(pick);
  }
  if (n > 0 && !out.includes('=')) out[Math.floor(rnd() * n)] = '=';
  return out;
}

// ---------------------------------------------------------------------------- Margin notes / Typo

export type Side = -1 | 1;

/**
 * Typo / Margin Note: the side the attack really comes from, plus what the note claims.
 * Draft 1 lies half the time; Draft 2's notes are underlined when true and always honest at least
 * once every 3 notes (`liesInARow` is the running count of consecutive lies).
 */
export function marginNote(phase: number, liesInARow: number, rnd: () => number): { side: Side; claim: Side; honest: boolean } {
  const side: Side = rnd() < 0.5 ? -1 : 1;
  const lieChance = phase === 1 ? 0.5 : phase === 2 ? 0.45 : 0.6;
  const mustTell = liesInARow >= 2;
  const honest = mustTell || rnd() >= lieChance;
  return { side, claim: honest ? side : ((-side) as Side), honest };
}

// ---------------------------------------------------------------------------- Heart Theft

/** How many hearts it may lift: never the last one, never more than 2 (3 below a third of its hp). */
export function heartsToSteal(hp: number, desperate: boolean): number {
  return Math.max(0, Math.min(desperate ? 3 : 2, hp - 1));
}

// ---------------------------------------------------------------------------- Letterbox Crush

/**
 * Gap for the letterbox slam: `width` columns somewhere in [left, right], at least `minDist` columns
 * from the player's column (so standing still never works), clamped inside the arena.
 */
export function letterboxGap(left: number, right: number, playerCol: number, width: number, rnd: () => number, minDist = 6): number {
  const span = right - left - width + 1;
  for (let t = 0; t < 16; t++) {
    const c0 = left + Math.floor(rnd() * span);
    const mid = c0 + (width - 1) / 2;
    if (Math.abs(mid - playerCol) >= minDist) return c0;
  }
  // fall back to the far side of the arena
  return playerCol < (left + right) / 2 ? right - width + 1 : left;
}

// ---------------------------------------------------------------------------- Rewind Ink

export interface Sample {
  t: number;
  x: number;
  y: number;
}

/** Ring buffer of recent player positions (oldest first), at most `keepMs` old. */
export function pushSample(buf: Sample[], s: Sample, keepMs = 2200): Sample[] {
  const out = buf.concat([s]);
  while (out.length > 1 && s.t - out[0].t > keepMs) out.shift();
  return out;
}

/** Position on a recorded path `ms` after its first sample (linear between samples, clamped). */
export function sampleAt(buf: readonly Sample[], ms: number): { x: number; y: number } | null {
  if (!buf.length) return null;
  const t = buf[0].t + ms;
  if (t <= buf[0].t) return { x: buf[0].x, y: buf[0].y };
  for (let i = 1; i < buf.length; i++) {
    const a = buf[i - 1], b = buf[i];
    if (t <= b.t) {
      const u = b.t === a.t ? 1 : (t - a.t) / (b.t - a.t);
      return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u };
    }
  }
  const z = buf[buf.length - 1];
  return { x: z.x, y: z.y };
}

// ---------------------------------------------------------------------------- Act 4: Save Over It

/** NO presses needed to refuse the deletion. */
export const ACT4_NOS = 3;

export interface Act4State {
  nos: number;
  /** YES was struck this many times (each one resets the NO count and laughs at you) */
  yeses: number;
  done: boolean;
}

export function act4Press(s: Act4State, button: 'yes' | 'no'): Act4State {
  if (s.done) return s;
  if (button === 'yes') return { nos: 0, yeses: s.yeses + 1, done: false };
  const nos = s.nos + 1;
  return { nos, yeses: s.yeses, done: nos >= ACT4_NOS };
}

/** Speed (px/s) the YES button drifts toward the blade: creeps faster each time you refuse. */
export function yesDrift(nos: number): number {
  return 14 + nos * 9;
}

// ---------------------------------------------------------------------------- flavour

/** Retry screen line ("Draft 2, take 4"). */
export function takeLine(stage: string | undefined, deaths: number): string {
  const d = stage === 'act4' ? 'Final draft' : stage === 'd3' ? 'Draft 3' : stage === 'd2' ? 'Draft 2' : 'Draft 1';
  return `${d}, take ${Math.max(1, deaths + 1)}`;
}

/** Names that appear in the credits roll: every role is ERRATUM, except one. */
export const CREDITS: readonly [string, string][] = [
  ['DIRECTED BY', 'ERRATUM'],
  ['WRITTEN BY', 'ERRATUM'],
  ['LEVEL DESIGN', 'ERRATUM'],
  ['ART', 'ERRATUM'],
  ['MUSIC', 'ERRATUM'],
  ['QA', 'NOBODY'],
  ['SPECIAL THANKS', 'YOU'],
];
