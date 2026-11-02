/**
 * Pure rules for ORRATH, THE BURIED COLOSSUS (see bosses/Colossus.ts): move selection, slam targets,
 * arena layouts per stage and the "Retry from ..." resume state. Free of Phaser so it is unit-testable;
 * every roll takes an injected `rnd` (returns [0, 1)).
 */

export type Rnd = () => number;
export type HandMove = 'slam' | 'sweep' | 'flick' | 'quake';
export type FaceMove = 'beam' | 'exhale' | 'hand' | 'headbutt';
export type CoreMove = 'shrug' | 'debris' | 'pulse' | 'swat';
export type ColossusMove = HandMove | FaceMove | CoreMove;

/** Moves that end in a punish window. At most two other moves run in a row before one of these. */
export const HEAVY: ReadonlySet<ColossusMove> = new Set<ColossusMove>(['slam', 'headbutt', 'shrug']);

/** Horizontal distances (px) used by the weighting: "close" and "far" from the weak point. */
export const NEAR = 90;
export const FAR = 200;

/**
 * Weighted candidates per phase. P1 (the hand) favours Sweep when you crowd it and Flick when you keep
 * away; P2 (the face) favours Exhale when you are up on the debris; P3 (the core) is even.
 */
export function colossusWeights(phase: number, dx: number, playerHigh: boolean): [ColossusMove, number][] {
  const p = Math.min(3, Math.max(1, phase));
  if (p === 1) {
    return [
      ['slam', 3],
      ['sweep', dx < NEAR ? 4 : 2],
      ['flick', dx > FAR ? 4 : 2],
      ['quake', 2],
    ];
  }
  if (p === 2) {
    return [
      ['beam', 3],
      ['exhale', playerHigh ? 4 : 2],
      ['hand', 3],
      ['headbutt', 2],
    ];
  }
  return [
    ['shrug', 3],
    ['debris', 2],
    ['pulse', 3],
    ['swat', playerHigh ? 4 : 2],
  ];
}

/**
 * Weighted pick that never repeats the last move, and forces a heavy (punishable) move when the last
 * two were both light, so the player always gets an opening soon.
 */
export function pickColossusMove(phase: number, dx: number, playerHigh: boolean, history: readonly ColossusMove[], rnd: Rnd = Math.random): ColossusMove {
  let w = colossusWeights(phase, dx, playerHigh);
  const last = history[history.length - 1];
  w = w.filter(([m]) => m !== last);
  const recent = history.slice(-2);
  if (recent.length === 2 && recent.every((m) => !HEAVY.has(m))) {
    const heavy = w.filter(([m]) => HEAVY.has(m));
    if (heavy.length) w = heavy;
  }
  const total = w.reduce((s, [, n]) => s + n, 0);
  let r = rnd() * total;
  for (const [m, n] of w) if ((r -= n) < 0) return m;
  return w[w.length - 1][0];
}

/**
 * Three fist targets for the P1 slam: the first lands on the player, the next two step toward the side
 * with more room (alternating once) so the player has to keep moving. Targets stay inside [l, r] and are
 * at least `gap` apart from the previous one.
 */
export function slamTargets(playerX: number, l: number, r: number, rnd: Rnd, gap = 56): number[] {
  const clamp = (x: number) => Math.max(l, Math.min(r, x));
  const xs = [clamp(playerX)];
  let dir = xs[0] - l > r - xs[0] ? -1 : 1;
  for (let i = 1; i < 3; i++) {
    const step = gap + Math.floor(rnd() * 24);
    let x = xs[i - 1] + dir * step;
    if (x < l || x > r) {
      dir = -dir;
      x = xs[i - 1] + dir * step;
    }
    xs.push(clamp(x));
    if (rnd() < 0.35) dir = -dir;
  }
  return xs;
}

/** A floating platform: centre x, top y, width (px). */
export interface Ledge {
  x: number;
  y: number;
  w: number;
}

/** P2 debris ledges (world px for the 40x20 tile arena, floor top at y=272). */
export function debrisLayout(midX: number): Ledge[] {
  return [
    { x: midX - 148, y: 204, w: 56 },
    { x: midX, y: 158, w: 56 },
    { x: midX + 148, y: 204, w: 56 },
  ];
}

/** P3 armor plates on the colossus's back: two per side, clear of the core in the middle. */
export function plateLayout(midX: number): Ledge[] {
  return [
    { x: midX - 216, y: 222, w: 52 },
    { x: midX - 104, y: 214, w: 52 },
    { x: midX + 104, y: 214, w: 52 },
    { x: midX + 216, y: 222, w: 52 },
  ];
}

/** Which half the P3 shrug erupts on: the player's half (the core column itself never erupts). */
export function shrugSide(playerX: number, midX: number): -1 | 1 {
  return playerX < midX ? -1 : 1;
}

/** Beam sweep: starts beyond the player on the far side of the eye and sweeps past them. */
export function beamSweep(playerX: number, eyeX: number, l: number, r: number): { from: number; to: number } {
  const toward = playerX >= eyeX ? 1 : -1;
  const from = Math.max(l, Math.min(r, eyeX - toward * 40));
  const to = toward > 0 ? r : l;
  return { from, to };
}

/** Stages a run can resume from (GameOver "Retry from ..."), in fight order. */
export type ColossusStage = 'p2' | 'p3';
export const STAGE_NAMES: Record<ColossusStage, string> = { p2: 'The Face', p3: 'The Fall' };
/** Elapsed time charged when resuming, so a resumed run can't rank better than a full one. */
export const COLOSSUS_STAGE_MS: Record<ColossusStage, number> = { p2: 75000, p3: 150000 };

/** Phase and HP to start at for a resume stage (HP = the threshold that phase begins at). */
export function resumeState(stage: string | undefined, thresholds: readonly number[]): { phase: number; hpFrac: number } | null {
  if (stage === 'p2') return { phase: 2, hpFrac: thresholds[0] };
  if (stage === 'p3') return { phase: 3, hpFrac: thresholds[1] };
  return null;
}

/** The HP bar name per phase (the bar renames as more of the colossus is revealed). */
export const COLOSSUS_NAMES = ['THE HAND OF ORRATH', 'ORRATH, THE BURIED COLOSSUS', 'ORRATH, FALLING'] as const;

/**
 * P3: how far the ground has come up toward the falling colossus, 0 (just fell) .. 1 (impact), from
 * the boss's HP fraction and the P3 threshold.
 */
export function fallProgress(hpFrac: number, p3At: number): number {
  if (p3At <= 0) return 1;
  return Math.max(0, Math.min(1, 1 - hpFrac / p3At));
}

/**
 * Phase changes still owed after a hit, given the phase the fight is showing and the one HP says it is in.
 * One big hit across two thresholds queues both cinematics instead of skipping one.
 */
export function pendingPhases(shown: number, actual: number): number[] {
  const out: number[] = [];
  for (let p = shown + 1; p <= actual; p++) out.push(p);
  return out;
}
