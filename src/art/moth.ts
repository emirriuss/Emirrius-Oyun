import Phaser from 'phaser';
import { P, sheet } from './enemies';
import { drawCanvas, drawImage } from './pixel';

// ============================================================================
// NOCTARA, THE ECLIPSE MOTH: a giant moth wraith of dust and pale light.
// Front view (symmetric, so flipX is harmless). Grid 62x46 (frame 64x48).
// The physics body (30x26) is the bottom-centre of the frame, so the grounded
// pose rests on the grid's last rows.
// Sheets 'moth' and 'moth-eclipse' (P3 palette), anims '<sheet>-<pose>':
//   hover windup gust swoop grounded cast cocoon stun
// Extras: projectile 'dust' ('dust-fly'), gust mote 'mothmote' ('mothmote-fly'),
// 'moth-eyes' (glowing eyes drawn above the Eclipse darkness), 'moth-beam' (light pillar),
// 'moth-marker' (floor glow strip, tiled).
// ============================================================================

type V = [number, number];
type MPose = 'hover0' | 'hover1' | 'hover2' | 'windup' | 'gust' | 'swoop' | 'grounded' | 'cast' | 'cocoon0' | 'cocoon1' | 'stun';

interface MPal {
  wing: string; // ramp dark,mid,light,hi
  inner: string; // furry wing root
  vein: string;
  edge: string; // dusty fringe along the wing edge
  ring: string; // eye-spot ring
  spot: string; // eye-spot centre
  pupil: string;
  fur: string; // thorax / abdomen ramp
  band: string; // abdomen segment bands
  collar: string;
  head: string;
  eye: string;
  eyeHi: string;
  ant: string; // antennae
  antTip: string;
  wisp: string; // trailing dust, 2 chars
  silk: string; // cocoon ramp
  crack: string;
}

const MOTH_PAL: Record<'base' | 'eclipse', MPal> = {
  base: {
    wing: 'jamw', inner: 'hja', vein: 'j', edge: 'w', ring: 'e', spot: 'h', pupil: 'g',
    fur: 'amew', band: 'a', collar: 'mew', head: 'hHj', eye: 'g', eyeHi: 'e', ant: 'm', antTip: 'e',
    wisp: 'ma', silk: 'amew', crack: 'g',
  },
  eclipse: {
    wing: 'zZhH', inner: 'zzZ', vein: 'H', edge: 'g', ring: 'y', spot: 'z', pupil: 'e',
    fur: 'ZhHj', band: 'z', collar: 'hHj', head: 'zZh', eye: 'e', eyeHi: 'w', ant: 'H', antTip: 'g',
    wisp: 'HG', silk: 'zZhH', crack: 'g',
  },
};

/** Forewing outline (right wing, shoulder at the origin, x outward, y down). */
const FORE: V[] = [[0, -1], [3, -6], [8, -11], [14, -15], [20, -18], [25, -19], [28, -17], [28, -13], [26, -9], [22, -5], [17, -1], [11, 2], [5, 3], [1, 3]];
/** Hindwing outline, with a short trailing tail. */
const HIND: V[] = [[0, 1], [5, 2], [11, 4], [16, 8], [18, 13], [16, 17], [13, 19], [13, 24], [11, 19], [8, 17], [4, 12], [1, 7]];
const FORE_VEINS: V[] = [[24, -17], [27, -12], [21, -5], [13, 1]];
const HIND_VEINS: V[] = [[16, 9], [15, 16], [9, 15]];

interface Wing { r: number; sx: number; sy: number }
interface PoseDef {
  sh: number; // shoulder y
  fore: [Wing, Wing]; // [left, right]
  hind: [Wing, Wing];
  body: 'up' | 'low' | 'dart';
  eyes: 'on' | 'hot' | 'dim' | 'x';
  wisp: number; // phase of the trailing dust, -1 = none
  marks?: boolean; // casting glyph sparks
}

const w = (r: number, sx = 1, sy = 1): Wing => ({ r, sx, sy });
const both = (x: Wing): [Wing, Wing] => [x, x];

const POSES: Record<Exclude<MPose, 'cocoon0' | 'cocoon1'>, PoseDef> = {
  hover0: { sh: 22, fore: both(w(0)), hind: both(w(0)), body: 'up', eyes: 'on', wisp: 0 },
  hover1: { sh: 21, fore: both(w(-0.24, 0.98)), hind: both(w(-0.1)), body: 'up', eyes: 'on', wisp: 1 },
  hover2: { sh: 23, fore: both(w(0.28, 0.92, 0.95)), hind: both(w(0.18, 0.95)), body: 'up', eyes: 'on', wisp: 2 },
  // wings drawn up and back: a tall, narrow silhouette that reads as "loading"
  windup: { sh: 23, fore: both(w(-0.62, 0.78, 1.05)), hind: both(w(-0.4, 0.82)), body: 'up', eyes: 'hot', wisp: 0 },
  // wings slammed forward and down
  gust: { sh: 21, fore: both(w(0.6, 1, 0.8)), hind: both(w(0.45, 1, 0.9)), body: 'up', eyes: 'hot', wisp: 1 },
  // folded into a falling dart
  swoop: { sh: 24, fore: both(w(-1.2, 0.74, 0.9)), hind: both(w(-0.75, 0.6, 0.85)), body: 'dart', eyes: 'hot', wisp: -1 },
  // spread flat on the floor: wide, low, open
  grounded: { sh: 37, fore: both(w(0.34, 0.95, 0.5)), hind: both(w(0.25, 0.95, 0.45)), body: 'low', eyes: 'dim', wisp: -1 },
  cast: { sh: 22, fore: both(w(-0.36, 1.03)), hind: both(w(-0.15)), body: 'up', eyes: 'hot', wisp: 2, marks: true },
  stun: { sh: 25, fore: [w(0.55, 0.9, 0.9), w(0.2, 0.95)], hind: [w(0.5, 0.9), w(0.3, 0.9)], body: 'up', eyes: 'x', wisp: 1 },
};

const CX = 31;
/** grid pixel at the sprite origin (frame centre 32,24 minus the 1px outline pad) */
const ORIGIN: V = [31, 23];

/** Eye position relative to the sprite origin for each anim (for the Eclipse glow). */
export const MOTH_EYES: Record<string, V> = {};
for (const [k, d] of Object.entries(POSES)) {
  const key = k.startsWith('hover') ? 'hover' : k;
  const eyeY = d.body === 'low' ? d.sh - 2 : d.sh - 6;
  MOTH_EYES[key] = [CX + 0.5 - ORIGIN[0], eyeY + 0.5 - ORIGIN[1]];
}
MOTH_EYES.cocoon = [0.5, -12];

function tf(p: V, wg: Wing, side: number, sh: number): V {
  const x = p[0] * wg.sx, y = p[1] * wg.sy;
  const c = Math.cos(wg.r), s = Math.sin(wg.r);
  return [CX + side * (2 + x * c - y * s), sh + x * s + y * c];
}

function wing(p: P, outline: V[], veins: V[], spot: V, spotR: number, wg: Wing, side: number, sh: number, pal: MPal): void {
  const pts = outline.map((v) => tf(v, wg, side, sh));
  p.poly(pts, pal.wing);
  // furry root
  p.poly(outline.map((v) => tf([v[0] * 0.42, v[1] * 0.42], wg, side, sh)), pal.inner);
  // veins
  const root = tf([1, 0], wg, side, sh);
  for (const v of veins) {
    const e = tf(v, wg, side, sh);
    const m = tf([v[0] * 0.55, v[1] * 0.55], wg, side, sh);
    p.line(m[0], m[1], e[0], e[1], pal.vein);
    p.line(root[0], root[1], m[0], m[1], pal.inner[1]);
  }
  // eye-spot: an eclipse in every wing
  const [sx, sy] = tf(spot, wg, side, sh);
  const r = spotR * Math.min(1, (wg.sx + wg.sy) / 2);
  if (r >= 1.6) {
    p.ell(sx, sy, r, r * 0.85, pal.ring + pal.ring);
    p.ell(sx, sy, r - 1, (r - 1) * 0.85, pal.spot + pal.spot);
    p.set(sx - 0.5, sy - 0.5, pal.pupil);
  }
  // dusty fringe on the outer edge (every other outline point, and midpoints)
  for (let i = 1; i < outline.length - 1; i++) {
    const a = outline[i], b = outline[i + 1];
    if (a[0] < 6 && b[0] < 6) continue;
    const q = tf(a, wg, side, sh);
    p.set(q[0] - side * 0.5, q[1] + 0.5, pal.edge);
    if (i % 2) {
      const mq = tf([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], wg, side, sh);
      p.set(mq[0] - side * 0.5, mq[1] + 0.5, pal.edge);
    }
  }
}

function antenna(p: P, side: number, x0: number, y0: number, droop: number, pal: MPal): void {
  // feathery antenna: a curve with little barbs
  let px = x0, py = y0;
  for (let i = 0; i < 7; i++) {
    const nx = x0 + side * (i * 0.9 + i * i * 0.08), ny = y0 - i * 1.2 + droop * i * 0.5;
    p.line(px, py, nx, ny, pal.ant);
    if (i > 1 && i < 6 && i % 2 === 0) p.set(nx + side, ny + 1, pal.ant).set(nx - side, ny - 1, pal.ant);
    px = nx; py = ny;
  }
  p.set(px + side, py, pal.antTip);
}

function body(p: P, d: PoseDef, pal: MPal): void {
  const sh = d.sh;
  if (d.body === 'low') {
    // lying in the dust: wide squashed thorax, head on the floor
    p.ellV(CX, sh + 5, 5, 3.5, pal.fur);
    p.ellV(CX, sh + 1, 5.5, 4, pal.fur);
    p.ellV(CX, sh - 2, 6.5, 2.5, pal.collar);
    p.ellV(CX, sh - 2, 3.5, 2.5, pal.head);
    antenna(p, -1, CX - 2, sh - 4, 2.2, pal);
    antenna(p, 1, CX + 2, sh - 4, 2.2, pal);
    eyes(p, sh - 2, d.eyes, pal);
    return;
  }
  const dart = d.body === 'dart';
  const abLen = dart ? 10 : 8;
  // abdomen with segment bands, tapering into dust
  p.ellV(CX, sh + 4 + abLen, dart ? 3 : 3.5, abLen, pal.fur);
  for (let k = 0; k < 4; k++) {
    const y = sh + 7 + k * 3;
    if (y > sh + 3 + abLen * 2 - 2) break;
    p.line(CX - 2, y, CX + 2, y, pal.band);
  }
  // thorax
  p.ellV(CX, sh + 1, 4.5, 4.5, pal.fur);
  // fluffy collar
  p.ellV(CX, sh - 3, 6.5, 3, pal.collar);
  for (const dx of [-6, -4, 4, 6]) p.set(CX + dx, sh - 1, pal.collar[1]);
  p.set(CX - 5, sh - 5, pal.collar[2]).set(CX + 5, sh - 5, pal.collar[2]);
  // head
  p.ellV(CX, sh - 6, 3.5, 3, pal.head);
  antenna(p, -1, CX - 2, sh - 9, dart ? 1.5 : 0, pal);
  antenna(p, 1, CX + 2, sh - 9, dart ? 1.5 : 0, pal);
  eyes(p, sh - 6, d.eyes, pal);
  // trailing dust wisp
  if (d.wisp >= 0) {
    const ys = sh + 4 + abLen * 2;
    for (let k = 0; k < 6; k++) {
      const x = CX + Math.round(Math.sin(k * 1.3 + d.wisp * 2.1) * 2);
      if (k % 2 === 0 || k < 2) p.set(x, ys + k, k < 3 ? pal.wisp[0] : pal.wisp[1]);
    }
  }
  if (d.marks) {
    for (const [x, y] of [[CX - 10, sh - 15], [CX + 10, sh - 15], [CX, sh - 19], [CX - 5, sh - 20], [CX + 5, sh - 20]] as V[]) {
      p.set(x, y, pal.eyeHi).set(x - 1, y, pal.pupil).set(x + 1, y, pal.pupil).set(x, y - 1, pal.pupil).set(x, y + 1, pal.pupil);
    }
  }
}

function eyes(p: P, y: number, mode: PoseDef['eyes'], pal: MPal): void {
  for (const side of [-1, 1]) {
    const x = side < 0 ? CX - 3 : CX + 2;
    if (mode === 'x') {
      p.set(x, y - 1, pal.ant).set(x + 1, y, pal.ant).set(x, y, pal.ant).set(x + 1, y - 1, pal.ant);
      continue;
    }
    if (mode === 'dim') {
      p.set(x, y, pal.eye).set(x + 1, y, pal.eye);
      continue;
    }
    p.rect(x, y - 1, 2, 2, pal.eye);
    p.set(side < 0 ? x : x + 1, y - 1, pal.eyeHi);
    if (mode === 'hot') p.set(side < 0 ? x - 1 : x + 2, y, pal.eye);
  }
}

function cocoon(pal: MPal, crack: boolean): P {
  const p = new P(62, 46);
  // silk thread up to the ceiling
  p.line(CX, 0, CX, 6, pal.silk[2]);
  p.line(CX - 1, 2, CX + 1, 5, pal.silk[1]);
  // wrapped wings form the spindle
  p.ellV(CX, 25, 9, 18, pal.silk);
  p.ellV(CX - 3, 24, 5, 15, pal.silk[0] + pal.silk[1] + pal.silk[2]);
  for (let y = 11; y < 41; y += 4) {
    p.line(CX - 8, y, CX + 7, y + 3, pal.silk[0]);
    p.line(CX - 7, y + 1, CX + 4, y + 3, pal.silk[3] ?? pal.silk[2]);
  }
  // dust flaking off the shell
  for (const [x, y] of [[CX - 11, 18], [CX + 11, 26], [CX - 10, 34], [CX + 12, 14]] as V[]) p.set(x, y, pal.edge);
  // eyes peeking through the wraps
  p.rect(CX - 3, 12, 2, 1, pal.eye).rect(CX + 2, 12, 2, 1, pal.eye);
  if (crack) {
    // light cracks: the wings are about to burst out
    p.line(CX - 1, 15, CX + 2, 22, pal.crack).line(CX + 2, 22, CX - 1, 28, pal.crack).line(CX - 1, 28, CX + 1, 34, pal.crack);
    p.line(CX - 6, 20, CX - 3, 24, pal.crack).line(CX + 6, 30, CX + 4, 33, pal.crack);
  }
  // tail of the cocoon
  p.line(CX, 43, CX, 45, pal.silk[1]);
  return p;
}

function moth(pose: MPose, pal: MPal): P {
  if (pose === 'cocoon0' || pose === 'cocoon1') return cocoon(pal, pose === 'cocoon1');
  const d = POSES[pose];
  const p = new P(62, 46);
  for (const [i, side] of [[0, -1], [1, 1]] as V[]) wing(p, HIND, HIND_VEINS, [10, 10], 2.6, d.hind[i], side, d.sh + 2, pal);
  for (const [i, side] of [[0, -1], [1, 1]] as V[]) wing(p, FORE, FORE_VEINS, [17, -10], 3.8, d.fore[i], side, d.sh, pal);
  body(p, d, pal);
  return p;
}

export function registerMothArt(scene: Phaser.Scene): void {
  const poses: MPose[] = ['hover0', 'hover1', 'hover2', 'windup', 'gust', 'swoop', 'grounded', 'cast', 'cocoon0', 'cocoon1', 'stun'];
  const anims: [string, number[], number, number?][] = [
    ['hover', [0, 1, 2, 1], 10], ['windup', [3], 1], ['gust', [4], 1], ['swoop', [5], 1], ['grounded', [6], 1],
    ['cast', [7], 1], ['cocoon', [8, 8, 9], 6], ['stun', [10], 1],
  ];
  sheet(scene, 'moth', poses.map((ps) => moth(ps, MOTH_PAL.base)), anims);
  sheet(scene, 'moth-eclipse', poses.map((ps) => moth(ps, MOTH_PAL.eclipse)), anims);

  // dust orb: grid 8x8 (frame 10x10), a pale puff with a bright core
  const dust = (k: number): P => {
    const p = new P(8, 8);
    p.ellV(4, 4, 3.6, 3.6, 'ammw');
    p.ellV(4, 4, 2, 2, 'mew' + 'w');
    p.set(4 - (k === 1 ? 1 : 0), 3, 'w');
    const sp: V[] = [[0, 2], [7, 5], [2, 7], [6, 0]];
    const [x, y] = sp[k % sp.length];
    p.set(x, y, 'e');
    return p;
  };
  sheet(scene, 'dust', [dust(0), dust(1), dust(2)], [['fly', [0, 1, 2], 10]]);

  // gust mote: a slow lilac dust clump (grid 6x6)
  const mote = (k: number): P => {
    const p = new P(6, 6);
    p.ellV(3, 3, 2.6, 2.2 + k * 0.4, 'jam');
    p.set(k ? 4 : 2, 2, 'w');
    p.set(k ? 0 : 5, k ? 5 : 0, 'm');
    return p;
  };
  sheet(scene, 'mothmote', [mote(0), mote(1)], [['fly', [0, 1], 5]]);

  // glowing eyes for the Eclipse (drawn above the darkness)
  drawImage(scene, 'moth-eyes', ['ee.ee', 'ew.we'], { e: 0xffd96a, w: 0xffffff }, { outline: false });

  // light pillar: horizontal profile stretched to the beam size
  drawCanvas(scene, 'moth-beam', 32, 4, (ctx) => {
    const g = ctx.createLinearGradient(0, 0, 32, 0);
    g.addColorStop(0, 'rgba(255,217,106,0)');
    g.addColorStop(0.18, 'rgba(255,217,106,0.55)');
    g.addColorStop(0.38, 'rgba(255,238,194,0.95)');
    g.addColorStop(0.5, 'rgba(255,255,255,1)');
    g.addColorStop(0.62, 'rgba(255,238,194,0.95)');
    g.addColorStop(0.82, 'rgba(255,217,106,0.55)');
    g.addColorStop(1, 'rgba(255,217,106,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 32, 4);
  });

  // floor marker: a tiling strip of pale-gold runes (8x5)
  drawImage(scene, 'moth-marker', ['gyyggyyg', 'yeyyyyey', 'ywyeeywy', 'yeyyyyey', 'gyyggyyg'], { g: 0xffd96a, y: 0xf7b23b, e: 0xffeec2, w: 0xffffff }, { outline: false });
}
