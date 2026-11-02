import Phaser from 'phaser';
import { drawSheet, defineAnim, type Frame, type Palette } from './pixel';
import { C } from './palette';

/**
 * Combat VFX (owner: Agent A): slash smears, hit sparks, parry star, dust puffs,
 * charge aura and the energy-slash projectile. All pixel grids, no outline.
 * Every smear/spark frame is centred on its pivot so flipX/flipY and 90deg
 * rotations stay pixel exact.
 */

type Grid = string[][];
const grid = (w: number, h: number): Grid => Array.from({ length: h }, () => Array<string>(w).fill('.'));
const frame = (g: Grid): Frame => g.map((r) => r.join(''));
const put = (g: Grid, x: number, y: number, c: string) => {
  x = Math.round(x); y = Math.round(y);
  if (g[y] && x >= 0 && x < g[y].length) g[y][x] = c;
};
/** Deterministic hash noise 0..1. */
const hash = (x: number, y: number, s: number) => {
  const n = Math.sin(x * 127.1 + y * 311.7 + s * 74.7) * 43758.5453;
  return n - Math.floor(n);
};

const COOL: Palette = { W: C.white, I: C.ice, C: C.cyan, S: C.sky, B: C.blue };
const GOLD: Palette = { W: C.white, I: C.cream, C: C.gold, S: C.amber, B: C.orange };
const GREY: Palette = { W: 0xffffff, M: 0xd8d8e0, T: 0xa0a0b0 };

/**
 * Crescent smear on an ellipse around the grid centre.
 * head/len in degrees (0 = right, 90 = down), sweep sign = direction of motion.
 */
function crescent(w: number, h: number, rx: number, ry: number, thick: number, head: number, len: number, sign: 1 | -1, fade: number): Frame {
  const g = grid(w, h);
  const cx = w / 2, cy = h / 2;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const nx = (x + 0.5 - cx) / rx, ny = (y + 0.5 - cy) / ry;
      const r = Math.hypot(nx, ny);
      if (r > 1) continue;
      const th = (Math.atan2(ny, nx) * 180) / Math.PI;
      const d = ((((head - th) * sign) % 360) + 360) % 360;
      if (d > len) continue;
      const u = 1 - d / len; // 1 at the leading edge
      const wv = thick * (0.2 + 0.8 * Math.pow(u, 0.7)) * (1 - fade * 0.5);
      if (r < 1 - wv) continue;
      const depth = (1 - r) / wv; // 0 outer rim -> 1 inner edge
      let c: string;
      if (u < 0.18) c = depth < 0.5 ? 'S' : 'B';
      else if (depth < 0.3) c = u > 0.35 ? 'W' : 'I';
      else if (depth < 0.65) c = 'I';
      else c = u > 0.5 ? 'C' : 'S';
      if (fade > 0) c = ({ W: 'I', I: 'C', C: 'S', S: 'B', B: 'B' } as Record<string, string>)[c];
      if (fade > 0.5 && hash(x, y, head) < 0.2) continue;
      g[y][x] = c;
    }
  return frame(g);
}

/** Sweep presets: [head fraction, length fraction, fade] per frame. */
const SWEEP: [number, number, number][] = [
  [0.5, 0.5, 0],
  [1.0, 1.0, 0],
  [1.08, 0.6, 0.3],
  [1.12, 0.3, 0.8],
];
function smearSheet(w: number, h: number, rx: number, ry: number, thick: number, a0: number, arc: number, sign: 1 | -1): Frame[] {
  return SWEEP.map(([hf, lf, fade]) => crescent(w, h, rx, ry, thick, a0 + sign * arc * hf, arc * lf, sign, fade));
}

/** Downward thrust: speed lines + arrowhead below the sword tip. */
function downThrust(f: number): Frame {
  const w = 20, h = 32;
  const g = grid(w, h);
  const cx = 10;
  // streaks
  for (const [ox, base] of [[-6, 4], [-3, 0], [3, 2], [6, 6]] as const) {
    const len = 8 + Math.round(hash(ox, f, 3) * 10);
    const top = base + ((f * 5 + ox * 3 + 40) % 7);
    for (let y = top; y < Math.min(h - 6, top + len); y++) put(g, cx + ox - (ox > 0 ? 1 : 0), y, y - top < 3 ? 'S' : 'C');
  }
  // central beam
  for (let y = 2; y < h - 6; y++) {
    put(g, cx - 1, y, y < 8 ? 'C' : 'I');
    put(g, cx, y, y < 8 ? 'C' : 'I');
  }
  // arrowhead
  const tip = h - 2 - (f % 2);
  for (let i = 0; i < 6; i++) {
    const y = tip - i;
    for (let x = -i; x <= i - 1; x++) put(g, cx + x, y, Math.abs(x + 0.5) < i - 1.5 ? 'W' : 'C');
  }
  return frame(g);
}

/** Hit spark: rays along a direction (straight or diagonal). */
function spark(diag: boolean, f: number): Frame {
  const n = 24;
  const g = grid(n, n);
  const c = 12;
  const d: [number, number] = diag ? [1, 1] : [1, 0];
  const p: [number, number] = diag ? [1, -1] : [0, 1];
  const mainL = [5, 10, 11, 9][f];
  const backL = [3, 5, 4, 2][f];
  const perpL = [3, 4, 3, 0][f];
  const gap = [0, 1, 4, 7][f];
  const ray = (dir: [number, number], L: number, thick: boolean) => {
    for (let t = gap; t <= L; t++) {
      const col = t < L * 0.45 ? 'W' : t < L * 0.8 ? 'M' : 'T';
      put(g, c + dir[0] * t, c + dir[1] * t, col);
      if (thick && t < L * 0.6) put(g, c + dir[0] * t + (diag ? 1 : 0), c + dir[1] * t + (diag ? 0 : 1), col === 'W' ? 'M' : 'T');
    }
  };
  ray(d, mainL, f < 3);
  ray([-d[0], -d[1]], backL, false);
  if (perpL) {
    ray(p, perpL, false);
    ray([-p[0], -p[1]], perpL, false);
  }
  if (f < 2) for (let y = -1; y <= 0; y++) for (let x = -1; x <= 0; x++) put(g, c + x, c + y, 'W');
  if (f === 3) for (let i = 0; i < 4; i++) put(g, c + Math.round((hash(i, f, 1) - 0.5) * 16), c + Math.round((hash(i, f, 2) - 0.5) * 12), 'T');
  return frame(g);
}

/** Parry: 4-point star + expanding dotted ring. */
function parryStar(f: number): Frame {
  const n = 36;
  const g = grid(n, n);
  const c = 18;
  const L = [6, 12, 15, 10, 4][f];
  for (let t = 0; t <= L; t++) {
    const col = t < L * 0.5 ? 'W' : t < L * 0.8 ? 'M' : 'T';
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) put(g, c + dx * t - (dx < 0 ? 1 : 0), c + dy * t - (dy < 0 ? 1 : 0), col);
    if (t < L * 0.4) for (const [dx, dy] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) put(g, c + dx * t - (dx < 0 ? 1 : 0), c + dy * t - (dy < 0 ? 1 : 0), 'M');
  }
  if (f < 3) for (let y = -2; y <= 1; y++) for (let x = -2; x <= 1; x++) if (Math.abs(x + 0.5) + Math.abs(y + 0.5) < 3) put(g, c + x, c + y, 'W');
  const R = [5, 9, 13, 16, 17][f];
  const steps = Math.round(R * 6);
  for (let i = 0; i < steps; i++) {
    if (f >= 3 && i % 3 === 0) continue;
    const a = (i / steps) * Math.PI * 2;
    put(g, c - 0.5 + Math.cos(a) * R, c - 0.5 + Math.sin(a) * R, f >= 3 ? 'T' : 'M');
  }
  return frame(g);
}

/** Dust puff: two soft blobs that grow then break up. */
function dust(f: number): Frame {
  const w = 14, h = 10;
  const g = grid(w, h);
  const blobs: [number, number, number][] = [[5, 6.5, [1.6, 2.6, 3.2, 3.4, 3.2][f]], [9, 7, [1.2, 2.0, 2.6, 2.8, 2.6][f]]];
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let best = 9;
      let lit = 0;
      for (const [bx, by, r] of blobs) {
        const d = Math.hypot(x + 0.5 - bx, (y + 0.5 - by) * 1.2 - f * 0.4) / r;
        if (d < best) { best = d; lit = (by - y) / r; }
      }
      if (best > 1) continue;
      if (f >= 3 && hash(x, y, f) < (f === 3 ? 0.3 : 0.6)) continue;
      g[y][x] = lit > 0.3 && f < 3 ? 'W' : best < 0.6 ? 'M' : 'T';
    }
  return frame(g);
}

/** Charge aura: rotating dashed ring with sparkles. */
function aura(f: number): Frame {
  const n = 30;
  const g = grid(n, n);
  const c = 15;
  const R = 12;
  const steps = 72;
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    const seg = Math.floor((i + f * 3) / 6) % 2;
    if (!seg) continue;
    put(g, c - 0.5 + Math.cos(a) * R, c - 0.5 + Math.sin(a) * R * 0.85, (i + f * 3) % 6 < 2 ? 'W' : 'C');
  }
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + f * 0.4;
    const x = c - 0.5 + Math.cos(a) * (R - 4), y = c - 0.5 + Math.sin(a) * (R - 4) * 0.85;
    put(g, x, y, 'W');
    put(g, x + 1, y, 'S'); put(g, x - 1, y, 'S'); put(g, x, y + 1, 'S'); put(g, x, y - 1, 'S');
  }
  return frame(g);
}

/** Energy slash projectile: 20x14 crescent with a flickering trail. Size must stay 20x14 (body = 80%). */
function energy(f: number): Frame {
  const w = 20, h = 14;
  const g = grid(w, h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const nx = (x + 0.5 - 7) / 12, ny = (y + 0.5 - 7) / 7;
      const r = Math.hypot(nx, ny);
      if (r > 1 || nx < 0) continue;
      const inner = Math.hypot((x + 0.5 - 2) / 10, ny * 1.05);
      if (inner < 1) {
        // trailing wisps behind the crescent
        if (x < 10 && Math.abs(y + 0.5 - 7) < 4 && hash(x, y, f) < 0.18 + x * 0.02) g[y][x] = 'S';
        continue;
      }
      const edge = 1 - r;
      g[y][x] = edge < 0.08 ? 'W' : edge < 0.2 ? 'I' : 'C';
      if (Math.abs(ny) > 0.8) g[y][x] = 'S';
    }
  // flicker: shimmer pixels along the rim
  for (let i = 0; i < 3; i++) {
    const y = 2 + Math.floor(hash(i, f, 9) * 10);
    for (let x = w - 1; x >= 0; x--) if (g[y][x] !== '.') { g[y][x] = 'W'; if (x > 0) g[y][x - 1] = 'W'; break; }
  }
  for (let i = 0; i < 3; i++) put(g, Math.floor(hash(i, f, 4) * 6), 3 + Math.floor(hash(i, f, 5) * 8), 'C');
  return frame(g);
}

export const FX_KEYS = {
  smearH: 'fx-smear-h',
  smearFin: 'fx-smear-fin',
  smearSpin: 'fx-smear-spin',
  smearUp: 'fx-smear-up',
  smearDown: 'fx-smear-down',
  spark: 'fx-spark',
  sparkD: 'fx-spark-d',
  parry: 'fx-parry',
  dust: 'fx-dust',
  aura: 'fx-aura',
} as const;

export function registerFxArt(scene: Phaser.Scene): void {
  const noOutline = { outline: false as const };
  const sheet = (key: string, frames: Frame[], pal: Palette, fps: number, repeat = 0, animKey = key) => {
    drawSheet(scene, key, frames, pal, noOutline);
    defineAnim(scene, animKey, key, frames.map((_, i) => i), fps, repeat);
  };
  // plain particle squares (the legacy 'px' key is now taken by the pixel font atlas)
  drawSheet(scene, 'fx-px', [['WW', 'WW']], { W: 0xffffff }, noOutline);
  drawSheet(scene, 'fx-px1', [['W']], { W: 0xffffff }, noOutline);
  // smears (pivot = arc centre = frame centre)
  sheet(FX_KEYS.smearH, smearSheet(56, 40, 25, 16, 0.45, -80, 150, 1), COOL, 24);
  sheet(FX_KEYS.smearFin, smearSheet(68, 48, 30, 20, 0.5, -85, 160, 1), GOLD, 22);
  sheet(FX_KEYS.smearSpin, [0, 1, 2, 3].map((f) => crescent(56, 36, 25, 15, 0.5, f * 100, 230, 1, f === 3 ? 0.4 : 0)), COOL, 18);
  sheet(FX_KEYS.smearUp, smearSheet(44, 56, 18, 25, 0.45, 15, 210, -1), COOL, 22);
  sheet(FX_KEYS.smearDown, [0, 1, 2].map(downThrust), COOL, 18, -1);
  // sparks & impacts (grey -> tinted at runtime)
  sheet(FX_KEYS.spark, [0, 1, 2, 3].map((f) => spark(false, f)), GREY, 30);
  sheet(FX_KEYS.sparkD, [0, 1, 2, 3].map((f) => spark(true, f)), GREY, 30);
  sheet(FX_KEYS.parry, [0, 1, 2, 3, 4].map(parryStar), GREY, 24);
  sheet(FX_KEYS.dust, [0, 1, 2, 3, 4].map(dust), GREY, 16);
  sheet(FX_KEYS.aura, [0, 1, 2, 3].map(aura), GOLD, 12, -1);
  // energy slash projectile: replaces the legacy 20x14 'energySlash' image (frame 0 stays valid)
  sheet('energySlash', [0, 1, 2].map(energy), COOL, 14, -1, 'energySlash-fly');
}

/**
 * Death gib chunks (owner: juice-combat): 4 small pixel chunks, light top-left / dark bottom-right,
 * drawn in greys and tinted with the enemy's deathTint at runtime. Frames picked at random.
 */
export const GIB_KEY = 'fx-gib';
export function registerGibArt(scene: Phaser.Scene): void {
  const frames: Frame[] = [
    ['WM.', 'MT.', '...'],
    ['WW.', 'MMT', '.T.'],
    ['W..', 'MT.', '...'],
    ['.W.', 'WMT', '.T.'],
  ];
  drawSheet(scene, GIB_KEY, frames, { W: 0xffffff, M: 0xc8c8d0, T: 0x8a8a98 }, { outline: false });
}
