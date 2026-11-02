import Phaser from 'phaser';
import { drawSheet, defineAnim, flipH, type Frame, type Palette } from './pixel';
import { C } from './palette';

/**
 * Player hero: a hooded, caped swordsman in the cyan/blue ramp with a gold scarf.
 * Frames are built by a tiny "puppet" rasteriser (hand-drawn head/torso stamps +
 * procedural legs, arms, cape, scarf and sword) so every pose shares proportions.
 *
 * Frame layout (must match Player.ts): grid 32x34 -> 34x36 frame with outline.
 * Feet bottom edge sits at frame row 35; body centre at frame column 17.
 */
export const PLAYER_FRAME = { w: 34, h: 36, feetY: 35, originY: 25 / 36 };

const GW = 32;
const GH = 34;

const PAL: Palette = {
  K: C.night,
  N: C.navy,
  B: C.blue,
  S: C.sky,
  C: C.cyan,
  I: C.ice,
  W: C.white,
  E: C.white,
  G: C.gold,
  A: C.amber,
  O: C.orange,
  Q: C.cream,
  R: C.bark,
  U: C.umber,
  Y: C.clay,
  M: C.mist,
  L: C.slate,
  T: C.ash,
};

// ------------------------------------------------------------------ hand-drawn parts (facing right)
const HEAD: Frame = [
  '...NNNN...',
  '..NBBBBN..',
  '.NBBSSSBN.',
  'NBBSSSSSSB',
  'NBBSBKKKKS',
  'NBBBKKEKES',
  'NBBBKKKKKB',
  '.NBBBKKKB.',
  '..NNBBBB..',
];
/** Head turned toward the camera (used in spin/hurt). */
const HEAD_HURT: Frame = [
  '...NNNN...',
  '..NBBBBN..',
  '.NBBSSSBN.',
  'NBBSSSSSSB',
  'NBBSBKKKKS',
  'NBBBKEKKES',
  'NBBBKKKKKB',
  '.NBBBKKKB.',
  '..NNBBBB..',
];
const HEAD_BACK: Frame = [
  '...NNNN...',
  '..NBBBBN..',
  '.NBBSSSBN.',
  'NBBSSSSSBN',
  'NBBSSSSBBN',
  'NBBBSSBBBN',
  'NBBBBBBBBN',
  '.NBBBBBBN.',
  '..NNBBNN..',
];
const TORSO: Frame = [
  '.BSCCI.',
  'BSCCCIC',
  'BSCCCIC',
  'BSSCCCC',
  'RRRRRGR',
  'NBSSSSB',
  'NBBSSSB',
];

// ------------------------------------------------------------------ rasteriser
type Grid = string[][];
const newGrid = (): Grid => Array.from({ length: GH }, () => Array<string>(GW).fill('.'));
const toFrame = (g: Grid): Frame => g.map((r) => r.join(''));

function plot(g: Grid, x: number, y: number, c: string): void {
  const col = Math.round(x) + 16;
  const row = Math.round(y) + GH;
  if (row >= 0 && row < GH && col >= 0 && col < GW) g[row][col] = c;
}
function get(g: Grid, x: number, y: number): string {
  return g[Math.round(y) + GH]?.[Math.round(x) + 16] ?? '.';
}
function line(g: Grid, x0: number, y0: number, x1: number, y1: number, c: string, thick = 1): void {
  x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  const horiz = -dy < dx;
  let err = dx + dy;
  for (;;) {
    plot(g, x0, y0, c);
    if (thick > 1) horiz ? plot(g, x0, y0 + 1, c) : plot(g, x0 + 1, y0, c);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
}
function stamp(g: Grid, part: Frame, x: number, y: number): void {
  part.forEach((row, j) => {
    for (let i = 0; i < row.length; i++) if (row[i] !== '.') plot(g, x + i, y + j, row[i]);
  });
}
function fillPoly(g: Grid, pts: [number, number][], c: string): void {
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  for (let y = Math.floor(Math.min(...ys)); y <= Math.ceil(Math.max(...ys)); y++)
    for (let x = Math.floor(Math.min(...xs)); x <= Math.ceil(Math.max(...xs)); x++) {
      const px = x + 0.5, py = y + 0.5;
      let inside = false;
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const [xi, yi] = pts[i], [xj, yj] = pts[j];
        if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
      }
      if (inside) plot(g, x, y, c);
    }
}

// ------------------------------------------------------------------ puppet
type V4 = [number, number, number, number];
interface Sword {
  hand: 'F' | 'B';
  a: number; // degrees, 0 = forward, 90 = down, -90 = up
  len?: number;
  glow?: 0 | 1 | 2;
}
interface Pose {
  ux?: number; // upper body x shift
  uy?: number; // upper body y shift (positive = down)
  hy?: number; // hip y shift (defaults to uy)
  hx?: number;
  head?: Frame;
  hdx?: number;
  hdy?: number;
  legB: V4; // knee x,y  foot x,y (absolute local coords; foot y = boot bottom row)
  legF: V4;
  armB: V4; // elbow x,y hand x,y relative to the back shoulder
  armF: V4; // relative to the front shoulder
  sword?: Sword;
  cape?: [number, number]; // cape tip offset from rest
  capeFlap?: number;
  scarf?: { phase: number; drop: number; len?: number; amp?: number };
}

function drawLeg(g: Grid, hx: number, hy: number, l: V4, col: string): void {
  const [kx, ky, fx, fy] = l;
  line(g, hx, hy, kx, ky, col, 2);
  line(g, kx, ky, fx, fy - 2, col, 2);
  plot(g, fx, fy - 1, 'U'); plot(g, fx + 1, fy - 1, 'U');
  plot(g, fx, fy, 'U'); plot(g, fx + 1, fy, 'U'); plot(g, fx + 2, fy, 'R');
}
function drawArm(g: Grid, sx: number, sy: number, a: V4, sleeve: string, hand: string): [number, number] {
  const ex = sx + a[0], ey = sy + a[1], hx = sx + a[2], hy = sy + a[3];
  line(g, sx, sy, ex, ey, sleeve, 2);
  line(g, ex, ey, hx, hy, sleeve, 1);
  plot(g, hx, hy, hand);
  return [hx, hy];
}
function drawSword(g: Grid, hx: number, hy: number, s: Sword): void {
  const r = (s.a * Math.PI) / 180;
  const dx = Math.cos(r), dy = Math.sin(r);
  const len = s.len ?? 11;
  const edge = s.glow === 2 ? 'W' : s.glow === 1 ? 'Q' : 'W';
  const shade = s.glow === 2 ? 'G' : s.glow === 1 ? 'G' : 'M';
  const [ox, oy] = Math.abs(dx) > Math.abs(dy) ? [0, dx > 0 ? 1 : -1] : [dy > 0 ? -1 : 1, 0];
  // blade (shade first so the edge wins)
  const blade: [number, number][] = [];
  for (let t = 2; t <= len + 1; t++) blade.push([Math.round(hx + dx * t), Math.round(hy + dy * t)]);
  blade.forEach(([x, y], i) => { if (i < blade.length - 1) plot(g, x + ox, y + oy, shade); });
  blade.forEach(([x, y]) => plot(g, x, y, edge));
  // guard, grip, pommel
  const gx = Math.round(hx + dx * 1.2), gy = Math.round(hy + dy * 1.2);
  plot(g, gx, gy, 'G');
  plot(g, gx + Math.round(-dy), gy + Math.round(dx), 'A');
  plot(g, gx - Math.round(-dy), gy - Math.round(dx), 'G');
  plot(g, hx, hy, 'Y');
  plot(g, Math.round(hx - dx * 1.5), Math.round(hy - dy * 1.5), 'G');
}

function drawScarf(g: Grid, sx: number, sy: number, sc: NonNullable<Pose['scarf']>): void {
  const len = sc.len ?? 6;
  const amp = sc.amp ?? 1;
  for (let i = 0; i <= len; i++) {
    const x = sx - i;
    const y = sy + Math.round(Math.sin(sc.phase + i * 0.9) * amp * Math.min(1, i / 2) + sc.drop * i);
    plot(g, x, y, i < len - 1 ? 'G' : 'A');
    if (i < len - 3) plot(g, x, y + 1, 'A');
  }
}

function render(p: Pose): Frame {
  const g = newGrid();
  const ux = p.ux ?? 0, uy = p.uy ?? 0;
  const hy = -9 + (p.hy ?? uy), hx = p.hx ?? Math.round(ux / 2);
  const [cdx, cdy] = p.cape ?? [0, 0];
  // cape
  const flap = p.capeFlap ?? 0;
  const tipX = -7 + cdx + ux * 0.5, tipY = -5 + cdy + uy * 0.5;
  fillPoly(g, [
    [-1 + ux, -17 + uy], [-5 + ux, -16 + uy], [-6 + ux + cdx * 0.4, -11 + uy + cdy * 0.4],
    [tipX, tipY], [-4 + cdx * 0.8 + flap + ux * 0.5, -5 + cdy * 0.9 + uy * 0.5 + (flap ? 1 : 0)],
    [-1 + cdx * 0.5 + ux * 0.7, -7 + cdy * 0.6 + uy * 0.7], [1 + ux, -12 + uy],
  ], 'B');
  line(g, -3 + ux, -14 + uy, -3 + cdx * 0.7 + ux * 0.5, -7 + cdy * 0.8 + uy * 0.5, 'N');
  line(g, -5 + ux, -15 + uy, tipX + 1, tipY - 1, 'S');
  // scarf tail
  drawScarf(g, -3 + ux, -17 + uy, p.scarf ?? { phase: 0, drop: 0.6 });
  // back arm (+ sword)
  const [bhx, bhy] = drawArm(g, -2 + ux, -15 + uy, p.armB, 'N', 'R');
  if (p.sword?.hand === 'B') drawSword(g, bhx, bhy, p.sword);
  // legs
  drawLeg(g, -2 + hx, hy, p.legB, 'K');
  drawLeg(g, 0 + hx, hy, p.legF, 'N');
  // torso + head + scarf band
  stamp(g, TORSO, -3 + ux, -16 + uy);
  stamp(g, p.head ?? HEAD, -5 + ux + (p.hdx ?? 0), -25 + uy + (p.hdy ?? 0));
  for (let x = -3; x <= 2; x++) plot(g, x + ux, -17 + uy, x === 2 ? 'Q' : 'G');
  for (let x = -2; x <= 1; x++) plot(g, x + ux, -16 + uy, 'A');
  // front arm (+ sword)
  const [fhx, fhy] = drawArm(g, 1 + ux, -15 + uy, p.armF, 'S', 'Y');
  if (p.sword?.hand === 'F') drawSword(g, fhx, fhy, p.sword);
  void get;
  return toFrame(g);
}

/** Rotate a frame clockwise by quarter turns around its own pixel bounding-box centre (keeps pixels crisp). */
function rot90(f: Frame, turns: number): Frame {
  const t = ((turns % 4) + 4) % 4;
  if (t === 0) return f;
  let x0 = GW, x1 = -1, y0 = GH, y1 = -1;
  f.forEach((r, y) => [...r].forEach((c, x) => {
    if (c === '.') return;
    x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
  }));
  const cx = Math.round((x0 + x1) / 2), cy = Math.round((y0 + y1) / 2);
  const g = newGrid();
  f.forEach((r, y) => [...r].forEach((c, x) => {
    if (c === '.') return;
    let dx = x - cx, dy = y - cy;
    for (let i = 0; i < t; i++) [dx, dy] = [-dy, dx];
    const nx = cx + dx, ny = cy + dy;
    if (ny >= 0 && ny < GH && nx >= 0 && nx < GW) g[ny][nx] = c;
  }));
  return toFrame(g);
}

// ------------------------------------------------------------------ poses
const STAND_B: V4 = [-2, -5, -3, -1];
const STAND_F: V4 = [1, -5, 1, -1];
const idle = (bob: number, ph: number): Pose => ({
  uy: bob, hy: 0,
  legB: STAND_B, legF: STAND_F,
  armB: [-1, 3, -1, 5], armF: [1, 3, 2, 5 - bob * 0],
  sword: { hand: 'F', a: 35 },
  scarf: { phase: ph, drop: 0.7 },
});

/** Run cycle: [backLeg, frontLeg, upper bob, back arm, front arm]. */
const RUN: [V4, V4, number, V4, V4][] = [
  [[-4, -5, -6, -3], [2, -6, 3, -1], 0, [1, 3, 3, 4], [-2, 3, -4, 4]],
  [[-3, -6, -4, -3], [1, -5, 0, -1], 1, [0, 3, 2, 5], [-1, 3, -2, 5]],
  [[0, -6, -1, -2], [-1, -5, -3, -1], 0, [-1, 3, -1, 5], [0, 3, 1, 5]],
  [[2, -6, 3, -1], [-4, -5, -6, -3], 0, [-2, 3, -4, 4], [1, 3, 3, 4]],
  [[1, -5, 0, -1], [-3, -6, -4, -3], 1, [-1, 3, -2, 5], [0, 3, 2, 5]],
  [[-1, -5, -3, -1], [0, -6, -1, -2], 0, [0, 3, 1, 5], [-1, 3, -1, 5]],
];
const run = (i: number): Pose => {
  const [lb, lf, bob, ab, af] = RUN[i];
  return {
    ux: 1, uy: bob, hy: bob,
    legB: lb, legF: lf, armB: ab, armF: [af[0], af[1], af[2], af[3]],
    sword: { hand: 'F', a: 160 + (i % 3) * 4 },
    cape: [-3, -2 - bob],
    capeFlap: i % 2,
    scarf: { phase: i * 1.1, drop: 0.1, len: 7 },
  };
};

const poses: Record<string, Pose[]> = {
  idle: [idle(0, 0), idle(0, 1.5), idle(1, 3), idle(1, 4.5)],
  run: [0, 1, 2, 3, 4, 5].map(run),
  jump: [{
    legB: [-3, -6, -4, -3], legF: [2, -7, 2, -3],
    armB: [-2, -2, -4, -4], armF: [2, 2, 4, 3],
    sword: { hand: 'F', a: 150 },
    cape: [1, 2], scarf: { phase: 0, drop: 0.8 },
  }],
  apex: [{
    legB: [-3, -6, -3, -2], legF: [1, -6, 2, -2],
    armB: [-2, 1, -4, 0], armF: [2, 2, 4, 1],
    sword: { hand: 'F', a: 170 },
    cape: [-2, -2], scarf: { phase: 1, drop: 0, len: 7 },
  }],
  fall: [0, 1].map((i) => ({
    legB: [-3, -5, -4, -1], legF: [1, -6, 2, -2],
    armB: [-2, -2, -4, -5 + i], armF: [2, -2, 4, -4 + i],
    sword: { hand: 'F' as const, a: -150 + i * 6 },
    cape: [-1, -6 - i], capeFlap: i,
    scarf: { phase: i * 2, drop: -0.7, len: 7 },
  })),
  land: [{
    uy: 3, hy: 3,
    legB: [-4, -4, -4, -1], legF: [3, -4, 2, -1],
    armB: [-2, 2, -3, 4], armF: [2, 2, 4, 3],
    sword: { hand: 'F', a: 20 },
    cape: [0, 3], scarf: { phase: 0, drop: 1 },
  }],
  wallslide: [{
    ux: 1, uy: 1, hy: 1,
    legB: [-1, -5, -1, -1], legF: [2, -6, 3, -3],
    armB: [-3, -1, -5, -3], armF: [2, 2, 4, 3],
    sword: { hand: 'F', a: 100 },
    cape: [3, -5], scarf: { phase: 0, drop: -0.8, len: 5 },
  }],
  dash: [{
    ux: 3, uy: 2, hy: 1,
    legB: [-4, -5, -7, -3], legF: [2, -5, 3, -1],
    armB: [-3, 2, -6, 3], armF: [-2, 3, -5, 4],
    sword: { hand: 'F', a: 175, len: 11 },
    cape: [-7, -5], scarf: { phase: 0, drop: -0.1, len: 9, amp: 0.4 },
  }],
  attack1: [
    { ux: -1, legB: [-3, -5, -4, -1], legF: [2, -5, 2, -1], armB: [-1, 3, 0, 5], armF: [-2, -2, -2, -5], sword: { hand: 'F', a: -135 }, scarf: { phase: 0, drop: 0.4 } },
    { ux: 2, uy: 1, legB: [-4, -4, -5, -1], legF: [3, -5, 4, -1], armB: [-2, 2, -4, 3], armF: [3, 0, 6, 0], sword: { hand: 'F', a: 0, len: 12 }, cape: [-3, -2], scarf: { phase: 1, drop: 0, len: 7 } },
    { ux: 2, uy: 1, legB: [-4, -4, -5, -1], legF: [3, -5, 4, -1], armB: [-2, 2, -4, 3], armF: [3, 2, 5, 4], sword: { hand: 'F', a: 45 }, cape: [-2, -1], scarf: { phase: 2, drop: 0.2, len: 7 } },
  ],
  attack2: [
    { ux: 1, uy: 1, legB: [-3, -5, -4, -1], legF: [2, -5, 3, -1], armB: [-2, 2, -4, 3], armF: [2, 3, 4, 4], sword: { hand: 'F', a: 30 }, scarf: { phase: 0, drop: 0.3 } },
    { ux: 1, legB: [-3, -5, -4, -1], legF: [2, -5, 3, -1], armB: [-2, 2, -4, 3], armF: [3, -2, 5, -4], sword: { hand: 'F', a: -45, len: 12 }, cape: [-2, -1], scarf: { phase: 1, drop: 0 } },
    { ux: 0, legB: [-3, -5, -4, -1], legF: [2, -5, 3, -1], armB: [-2, 2, -4, 3], armF: [1, -3, 0, -6], sword: { hand: 'F', a: -110 }, cape: [-1, -1], scarf: { phase: 2, drop: 0.2 } },
  ],
  attack3: [
    { ux: -1, uy: 1, legB: [-3, -5, -4, -1], legF: [2, -5, 3, -1], armB: [-1, -3, 0, -6], armF: [0, -3, 0, -6], sword: { hand: 'F', a: -100, len: 12 }, scarf: { phase: 0, drop: 0.5 } },
    { ux: 0, uy: -1, hy: 0, legB: [-3, -5, -4, -1], legF: [2, -5, 3, -1], armB: [0, -3, 2, -6], armF: [2, -3, 3, -6], sword: { hand: 'F', a: -60, len: 13, glow: 1 }, scarf: { phase: 1, drop: 0 } },
    { ux: 3, uy: 3, hy: 2, legB: [-5, -4, -6, -1], legF: [4, -5, 5, -1], armB: [1, 3, 3, 4], armF: [3, 2, 6, 3], sword: { hand: 'F', a: 20, len: 13, glow: 1 }, cape: [-4, -3], scarf: { phase: 2, drop: -0.2, len: 8 } },
    { ux: 3, uy: 3, hy: 2, legB: [-5, -4, -6, -1], legF: [4, -5, 5, -1], armB: [1, 3, 3, 4], armF: [3, 3, 5, 5], sword: { hand: 'F', a: 60, len: 12 }, cape: [-2, 0], scarf: { phase: 3, drop: 0.3, len: 7 } },
  ],
  airattack: [
    { legB: [-3, -6, -4, -3], legF: [2, -6, 2, -2], armB: [-2, 1, -4, 0], armF: [-1, -3, -2, -5], sword: { hand: 'F', a: -140 }, cape: [-1, -3], scarf: { phase: 0, drop: -0.3 } },
    { ux: 1, legB: [-3, -6, -4, -3], legF: [2, -6, 3, -3], armB: [-2, 2, -4, 2], armF: [3, 0, 6, 0], sword: { hand: 'F', a: 5, len: 12 }, cape: [-3, -3], scarf: { phase: 1, drop: -0.2, len: 7 } },
    { ux: 1, legB: [-3, -6, -4, -3], legF: [2, -6, 3, -2], armB: [-2, 2, -4, 3], armF: [3, 2, 5, 4], sword: { hand: 'F', a: 50 }, cape: [-2, -3], scarf: { phase: 2, drop: -0.2, len: 7 } },
  ],
  upattack: [
    { uy: 1, legB: [-3, -5, -4, -1], legF: [2, -5, 3, -1], armB: [-2, 2, -3, 4], armF: [2, 2, 4, 2], sword: { hand: 'F', a: 10 }, scarf: { phase: 0, drop: 0.5 } },
    { uy: -1, hy: 0, legB: [-2, -5, -3, -1], legF: [1, -5, 2, -1], armB: [-2, 2, -3, 4], armF: [1, -3, 1, -7], sword: { hand: 'F', a: -90, len: 13 }, cape: [0, 1], scarf: { phase: 1, drop: 0.6 } },
    { uy: 0, hy: 0, legB: [-2, -5, -3, -1], legF: [1, -5, 2, -1], armB: [-2, 2, -3, 4], armF: [-1, -3, -2, -6], sword: { hand: 'F', a: -130 }, cape: [0, 1], scarf: { phase: 2, drop: 0.6 } },
  ],
  slam: [
    { uy: -1, hy: -1, legB: [-3, -7, -4, -4], legF: [2, -7, 2, -4], armB: [-1, -3, 0, -6], armF: [1, -3, 1, -6], sword: { hand: 'F', a: -95, len: 12 }, cape: [1, 1], scarf: { phase: 0, drop: 0.6 } },
    { uy: 1, hy: -1, legB: [-3, -7, -4, -4], legF: [2, -7, 2, -4], armB: [-1, 3, 1, 5], armF: [2, 3, 2, 6], sword: { hand: 'F', a: 90, len: 12, glow: 1 }, cape: [1, -8], capeFlap: 1, scarf: { phase: 1, drop: -1, len: 7 } },
  ],
  charge: [0, 1].map((i) => ({
    ux: -1, uy: 2, hy: 2,
    legB: [-4, -4, -5, -1] as V4, legF: [3, -4, 3, -1] as V4,
    armB: [-2, 2, -3, 4] as V4, armF: [-1, 3, -2, 5] as V4,
    sword: { hand: 'F' as const, a: 160, len: 12, glow: (1 + i) as 1 | 2 },
    cape: [-1, i] as [number, number], capeFlap: i,
    scarf: { phase: i * 2, drop: -0.3, len: 7 },
  })),
  heavy: [
    { ux: -2, uy: 2, hy: 2, legB: [-4, -4, -5, -1], legF: [3, -4, 3, -1], armB: [-2, 2, -3, 4], armF: [-2, 2, -4, 3], sword: { hand: 'F', a: 170, len: 13, glow: 2 }, cape: [0, 0], scarf: { phase: 0, drop: 0 } },
    { ux: 4, uy: 3, hy: 2, legB: [-5, -4, -8, -1], legF: [5, -5, 6, -1], armB: [-1, 2, -4, 2], armF: [4, 0, 7, -1], sword: { hand: 'F', a: -5, len: 14, glow: 2 }, cape: [-7, -4], scarf: { phase: 1, drop: -0.1, len: 9, amp: 0.5 } },
    { ux: 4, uy: 3, hy: 2, legB: [-5, -4, -8, -1], legF: [5, -5, 6, -1], armB: [-1, 2, -4, 3], armF: [4, 2, 6, 4], sword: { hand: 'F', a: 35, len: 13, glow: 1 }, cape: [-4, -2], scarf: { phase: 2, drop: 0.2, len: 8 } },
  ],
  parry: [0, 1].map((i) => ({
    ux: -1, uy: 1, hy: 1,
    legB: [-4, -5, -5, -1] as V4, legF: [2, -5, 3, -1] as V4,
    armB: [0, 2, 2, 1] as V4, armF: [2, 1, 4, -1] as V4,
    sword: { hand: 'F' as const, a: -80, len: 12, glow: (i === 0 ? 2 : 0) as 0 | 2 },
    scarf: { phase: i, drop: 0.4 },
  })),
  hurt: [{
    ux: -2, uy: 1, hy: 0, head: HEAD_HURT, hdx: -1,
    legB: [-3, -5, -5, -1], legF: [2, -6, 3, -2],
    armB: [-3, -2, -5, -4], armF: [2, -3, 4, -5],
    sword: { hand: 'F', a: -60 },
    cape: [3, -2], scarf: { phase: 2, drop: -0.5 },
  }],
};

/** Spin (attack4): front swing, back view, then the mirrored pair. */
const SPIN_A: Pose = { ux: 1, uy: 1, legB: [-3, -5, -4, -1], legF: [2, -5, 3, -1], armB: [-2, 2, -4, 3], armF: [3, 0, 6, 1], sword: { hand: 'F', a: 10, len: 12 }, cape: [-4, -2], scarf: { phase: 0, drop: 0, len: 8 } };
const SPIN_B: Pose = { uy: 1, head: HEAD_BACK, legB: [-2, -5, -3, -1], legF: [1, -5, 2, -1], armB: [-3, 1, -6, 1], armF: [-2, 1, -5, 1], sword: { hand: 'B', a: 180, len: 12 }, cape: [2, -2], scarf: { phase: 1, drop: 0, len: 7 } };

/** Pogo bounce: a kick-off "spring" pose, then a tucked front flip (rotated in quarter turns). */
const POGO_SPRING: Pose = {
  uy: -1, hy: -2,
  legB: [-3, -8, -5, -5], legF: [2, -9, 3, -6],
  armB: [-2, -2, -4, -4], armF: [2, -3, 4, -6],
  sword: { hand: 'F', a: -60, len: 12, glow: 1 },
  cape: [1, 4], scarf: { phase: 0, drop: 0.9, len: 7 },
};
const POGO_TUCK: Pose = {
  uy: 2, hy: -2,
  legB: [5, -14, 3, -9], legF: [6, -12, 4, -7],
  armB: [2, 2, 4, 3], armF: [3, 1, 5, 2],
  sword: { hand: 'F', a: -160, len: 9 },
  cape: [2, -2], capeFlap: 1, scarf: { phase: 1, drop: -0.4, len: 6 },
};

// dead frame 2: lying down (hand drawn)
const DEAD_LIE: Frame = (() => {
  const g = newGrid();
  const rows = [
    '......NNNN..............',
    '..RR.NBBSSN.NBSSSB.NN...',
    'UUNKKBBBBBBRRBSSSBBBSBN.',
    'UUNNNNNNNBBRGBSSSKKWEBN.',
    '.MMMMMMMMWWGNNNBBBKKKBN.',
  ];
  rows.forEach((r, j) => { for (let i = 0; i < r.length; i++) if (r[i] !== '.') plot(g, i - 13, -5 + j, r[i]); });
  return toFrame(g);
})();

export function registerPlayerArt(scene: Phaser.Scene): void {
  const frames: Frame[] = [];
  const idx: Record<string, number[]> = {};
  const add = (name: string, fs: Frame[]) => {
    idx[name] = fs.map((f) => frames.push(f) - 1);
  };
  for (const [name, ps] of Object.entries(poses)) add(name, ps.map(render));
  add('attack4', [render(SPIN_A), render(SPIN_B), flipH(render(SPIN_A)), flipH(render(SPIN_B))]);
  const kneel: Pose = { uy: 5, hy: 5, hdy: 1, legB: [-4, -2, -6, -1], legF: [3, -3, 2, -1], armB: [-1, 3, 0, 6], armF: [2, 3, 3, 6], sword: { hand: 'F', a: 95, len: 11 }, cape: [0, 4], scarf: { phase: 0, drop: 1 } };
  add('dead', [render(kneel), DEAD_LIE]);
  const tuck = render(POGO_TUCK);
  add('pogo', [render(POGO_SPRING), tuck, rot90(tuck, 1), rot90(tuck, 2), rot90(tuck, 3), tuck]);

  drawSheet(scene, 'player', frames, PAL);

  const A = (k: string, fps: number, repeat = -1, sel?: number[]) =>
    defineAnim(scene, `player-${k}`, 'player', sel ?? idx[k], fps, repeat);
  A('idle', 5);
  A('run', 12);
  A('jump', 1, 0);
  A('apex', 1, 0);
  A('fall', 8);
  A('land', 12, 0);
  A('wallslide', 1, 0);
  A('dash', 1, 0);
  A('attack1', 16, 0);
  A('attack2', 16, 0);
  A('attack3', 14, 0);
  A('attack4', 16, 0);
  A('airattack', 15, 0);
  A('upattack', 15, 0);
  A('slam', 10, 0);
  A('pogo', 18, 0);
  A('charge', 8);
  A('heavy', 10, 0);
  A('parry', 6, 0);
  A('hurt', 1, 0);
  A('dead', 3, 0);
}
