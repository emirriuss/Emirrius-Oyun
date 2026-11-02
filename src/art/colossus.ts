import Phaser from 'phaser';
import { P, sheet, EPAL } from './enemies';
import { drawCanvas, drawImage } from './pixel';
import { WORLD } from './palette';

// ============================================================================
// ORRATH, THE BURIED COLOSSUS: a mountain-sized stone titan with cyan rune veins and one gold eye.
// Everything here is big set dressing except the weak points (the boss sprite):
//   'colossus-hand'   (open, fist)     grid 72x124: P1 hand rising out of the ground, eye socket in the palm
//   'colossus-swipe'                    grid 128x36: flat side-on hand for the floor sweep / swat
//   'colossus-eye'    (open, shut, glare) grid 18x12: palm eye (P1 weak point)
//   'colossus-face'   (shut, roar)      grid 200x264: head + shoulders behind the arena (P2)
//   'colossus-bigeye' (dark, open, glare) grid 30x18: brow eye (P2 weak point)
//   'colossus-core'   (shut, open)      grid 28x22: heart in the back (P3 weak point)
//   'colossus-back'                     grid 640x60: its back, covering the arena floor in P3
//   'colossus-slab' / 'colossus-plate'  debris ledge (P2) / armor plate (P3)
//   'colossus-rock'   ('colossus-rock-fly') thrown / falling rock projectile
//   'colossus-sky' / 'colossus-land'    P3 backdrop (screen-fixed sky, distant ground rising)
// ============================================================================

const STONE = 'stam';
const DARK_STONE = 'nsta';
/** volumetric shading ramp without the highlight (big shapes get a blocky hotspot otherwise) */
const DARK_VOL = 'nst';

/** Deterministic pseudo-random for moss / crack scatter. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

/** Scatter moss on the top edge of filled pixels. */
function moss(p: P, seed: number, density = 0.25): void {
  const r = rng(seed);
  for (let x = 0; x < p.w; x++)
    for (let y = 1; y < p.h; y++) {
      if (p.get(x, y) === '.' || p.get(x, y - 1) !== '.') continue;
      if (r() < density) p.set(x, y, r() < 0.5 ? 'M' : 'P');
      break;
    }
}

/** Glowing rune vein: a jagged cyan line with teal edges. */
function vein(p: P, pts: [number, number][]): void {
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, y0] = pts[i], [x1, y1] = pts[i + 1];
    p.line(x0 + 1, y0, x1 + 1, y1, 'T');
    p.line(x0, y0, x1, y1, 'Q');
  }
}

// ---------------------------------------------------------------------------- the hand (P1)

function finger(p: P, x: number, w: number, top: number, bottom: number): void {
  p.box(x, top + 3, w, bottom - top - 3, STONE);
  p.ell(x + w / 2, top + 4, w / 2, 4, STONE);
  // knuckle creases
  const k1 = top + Math.round((bottom - top) * 0.35);
  const k2 = top + Math.round((bottom - top) * 0.68);
  p.line(x + 1, k1, x + w - 2, k1, 'n');
  p.line(x + 1, k2, x + w - 2, k2, 'n');
}

function forearm(p: P): void {
  p.box(22, 84, 28, 40, STONE);
  p.rect(22, 92, 28, 3, 'T');
  for (let x = 24; x < 50; x += 5) p.set(x, 93, 'Q');
  vein(p, [[28, 100], [31, 108], [29, 116], [33, 123]]);
  vein(p, [[43, 98], [41, 110], [45, 122]]);
}

function handOpen(): P {
  const p = new P(72, 124);
  forearm(p);
  p.ell(36, 64, 25, 25, STONE);
  finger(p, 12, 9, 16, 54);
  finger(p, 23, 10, 6, 50);
  finger(p, 35, 10, 8, 50);
  finger(p, 47, 9, 18, 54);
  // thumb, splayed out to the left
  p.poly([[16, 70], [6, 58], [2, 46], [6, 42], [12, 48], [22, 60]], STONE);
  p.line(5, 50, 12, 56, 'n');
  // palm lines + the eye socket (the eye sprite sits on top)
  p.line(18, 78, 30, 84, 'n');
  p.line(44, 84, 55, 74, 'n');
  p.ell(36, 66, 11, 8, 'xnnn');
  vein(p, [[20, 58], [16, 66], [18, 74]]);
  moss(p, 7, 0.3);
  return p;
}

function handFist(): P {
  const p = new P(72, 124);
  forearm(p);
  p.ell(36, 62, 27, 26, STONE);
  // curled fingers: four stacked rolls across the front
  for (let i = 0; i < 4; i++) {
    p.box(12, 40 + i * 10, 46, 10, STONE);
    p.line(13, 49 + i * 10, 56, 49 + i * 10, 'n');
  }
  // thumb clamped across the rolls
  p.box(8, 66, 32, 9, STONE);
  p.line(9, 74, 39, 74, 'n');
  vein(p, [[50, 44], [54, 56], [50, 70]]);
  moss(p, 11, 0.3);
  return p;
}

function swipe(): P {
  const p = new P(128, 36);
  p.box(0, 9, 58, 20, STONE);
  p.rect(10, 9, 3, 20, 'T');
  vein(p, [[18, 14], [30, 18], [44, 15], [54, 20]]);
  p.ell(68, 19, 16, 14, STONE);
  // fingers, stretched forward
  [[6, 112], [13, 122], [20, 120], [27, 108]].forEach(([y, tip]) => {
    p.box(74, y, tip - 74, 6, STONE);
    p.ell(tip, y + 3, 4, 3, STONE);
    p.line(92, y + 1, 92, y + 4, 'n');
    p.line(106, y + 1, 106, y + 4, 'n');
  });
  // thumb along the top
  p.poly([[60, 8], [72, 1], [86, 2], [84, 6], [72, 8]], STONE);
  moss(p, 5, 0.2);
  return p;
}

// ---------------------------------------------------------------------------- eyes + core

function eye(w: number, h: number, kind: 'open' | 'shut' | 'glare' | 'dark'): P {
  const p = new P(w, h);
  const cx = w / 2, cy = h / 2;
  if (kind === 'dark') {
    p.ell(cx, cy, w / 2, h / 2, 'xZZ');
    p.set(Math.round(cx) - 3, Math.round(cy) - 1, 'h');
    return p;
  }
  if (kind === 'shut') {
    p.ell(cx, cy, w / 2, h / 2, STONE);
    p.line(1, Math.round(cy), w - 2, Math.round(cy), 'x');
    p.line(3, Math.round(cy) + 1, w - 4, Math.round(cy) + 1, 'n');
    return p;
  }
  p.ell(cx, cy, w / 2, h / 2, 'mewe');
  const ir = Math.max(3, Math.round(h * 0.36));
  p.ell(cx, cy, ir, ir + 0.5, kind === 'glare' ? 'cro' : 'ygg');
  p.ell(cx, cy, Math.max(1, ir * 0.4), ir * 0.75, 'xxx');
  p.set(Math.round(cx) - 2, Math.round(cy) - 2, 'w');
  return p;
}

function core(open: boolean): P {
  const p = new P(28, 22);
  if (open) {
    p.ell(14, 12, 12, 10, 'TQIw');
    p.ell(14, 12, 6, 5, 'QIww');
    // plates pulled apart to the sides
    p.poly([[0, 4], [6, 0], [8, 10], [3, 21]], STONE);
    p.poly([[27, 4], [21, 0], [19, 10], [24, 21]], STONE);
  } else {
    p.poly([[14, 0], [27, 9], [24, 21], [4, 21], [1, 9]], STONE);
    p.line(14, 1, 14, 20, 'n');
    p.line(2, 10, 26, 10, 'n');
    // light leaking through the seams
    p.set(14, 6, 'Q').set(14, 14, 'Q').set(8, 10, 'T').set(20, 10, 'T');
  }
  return p;
}

// ---------------------------------------------------------------------------- the face (P2)

function face(roar: boolean): P {
  const p = new P(200, 264);
  // shoulders sinking into the ground (tall enough to reach below the arena floor)
  p.poly([[0, 263], [0, 192], [26, 170], [70, 178], [130, 178], [174, 170], [199, 192], [199, 263]], DARK_STONE);
  // mountain crown
  p.poly([[34, 70], [44, 30], [56, 44], [70, 8], [84, 34], [100, 0], [116, 30], [130, 10], [144, 42], [156, 28], [166, 70]], DARK_STONE);
  for (const [x, y] of [[70, 8], [100, 0], [130, 10], [44, 30], [156, 28]]) {
    for (let k = 0; k < 6; k++) p.line(x - k, y + k, x + k, y + k, k < 3 ? 'w' : 'm');
  }
  // head + jaw
  p.ellV(100, 104, 70, 76, DARK_VOL);
  p.ellV(100, 148, 54, 38, DARK_VOL, 0.1);
  // brow ridge with its overhang shadow
  p.box(30, 60, 140, 14, DARK_STONE);
  p.line(32, 74, 168, 74, 'x');
  p.line(36, 75, 164, 75, 'n');
  // the single eye socket (eye sprite sits on top)
  p.ell(100, 86, 21, 12, 'xxnn');
  // nose
  p.poly([[92, 98], [108, 98], [114, 128], [86, 128]], DARK_STONE);
  p.line(88, 128, 112, 128, 'x');
  // mouth
  if (roar) {
    p.ell(100, 154, 32, 14, 'xxZ');
    for (let x = 74; x <= 124; x += 8) p.rect(x, 141, 4, 4, 'a').rect(x + 2, 164, 4, 3, 'a');
    p.ell(100, 156, 14, 5, 'cWW');
  } else {
    p.rect(70, 152, 60, 3, 'x');
    p.line(66, 150, 70, 152, 'x');
    p.line(130, 152, 134, 150, 'x');
  }
  // cheek runes + cracks
  vein(p, [[56, 96], [52, 112], [58, 126], [54, 140]]);
  vein(p, [[144, 96], [148, 112], [142, 126], [146, 140]]);
  vein(p, [[100, 36], [96, 46], [102, 56]]);
  p.line(60, 40, 72, 58, 'x').line(140, 44, 128, 58, 'x').line(40, 196, 56, 214, 'x').line(160, 196, 146, 212, 'x');
  vein(p, [[20, 200], [34, 210], [30, 226], [36, 250]]);
  vein(p, [[180, 200], [168, 212], [174, 228], [166, 252]]);
  moss(p, 23, 0.35);
  return p;
}

// ---------------------------------------------------------------------------- props

function back(): P {
  const p = new P(640, 70);
  p.box(0, 14, 640, 56, DARK_STONE);
  // spinal ridge plates
  for (let x = 4; x < 640; x += 30) {
    if (Math.abs(x + 12 - 320) < 34) continue;
    p.poly([[x, 16], [x + 10, 2], [x + 22, 4], [x + 26, 16]], STONE);
    p.line(x + 10, 3, x + 13, 15, 'n');
  }
  // the split where the core sits
  p.ell(320, 20, 30, 12, 'xxnn');
  vein(p, [[0, 34], [80, 30], [160, 36], [250, 30], [300, 22]]);
  vein(p, [[340, 22], [400, 32], [480, 28], [560, 36], [639, 30]]);
  moss(p, 41, 0.2);
  return p;
}

function slab(): P {
  const p = new P(56, 14);
  p.poly([[0, 2], [10, 0], [30, 1], [48, 0], [55, 3], [52, 9], [40, 13], [20, 13], [6, 10]], STONE);
  vein(p, [[14, 6], [24, 8], [34, 6]]);
  moss(p, 3, 0.4);
  return p;
}

function plate(): P {
  const p = new P(52, 12);
  p.box(0, 0, 52, 10, STONE);
  p.rect(2, 10, 48, 2, 'n');
  for (const x of [4, 24, 46]) p.set(x, 4, 'Q');
  p.line(1, 1, 50, 1, 'm');
  return p;
}

function rock(k: number): P {
  const p = new P(10, 10);
  p.ellV(5, 5, 4.6, 4.6, STONE);
  const a = (k * Math.PI) / 2;
  p.set(5 + Math.cos(a) * 2, 5 + Math.sin(a) * 2, 'n');
  p.set(5 - Math.sin(a) * 2, 5 + Math.cos(a) * 2, 'Q');
  return p;
}

const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;

/** P3 backdrop: the open sky the colossus is falling through (screen-fixed). */
function paintSky(scene: Phaser.Scene): void {
  const [d, m, l] = WORLD[4].sky;
  drawCanvas(scene, 'colossus-sky', 480, 270, (ctx) => {
    const bands = [d, d, m, m, l, 0x2f6a7a, 0x4a8a92];
    bands.forEach((c, i) => {
      ctx.fillStyle = hex(c);
      ctx.fillRect(0, Math.round((i * 270) / bands.length), 480, Math.ceil(270 / bands.length) + 1);
    });
    const r = rng(9);
    ctx.fillStyle = '#c9f2ff';
    for (let i = 0; i < 40; i++) ctx.fillRect(Math.floor(r() * 480), Math.floor(r() * 130), 1, 1);
  });
}

/** Distant ground rushing up: ridges and a valley floor (screen-fixed, rises during P3). */
function paintLand(scene: Phaser.Scene): void {
  drawCanvas(scene, 'colossus-land', 480, 140, (ctx) => {
    const r = rng(13);
    const ridge = (base: number, amp: number, col: number) => {
      ctx.fillStyle = hex(col);
      let y = base;
      for (let x = 0; x < 480; x += 2) {
        y = Math.max(base - amp, Math.min(base + amp, y + (r() - 0.5) * 6));
        ctx.fillRect(x, Math.round(y), 2, 140 - Math.round(y));
      }
    };
    ridge(30, 18, 0x24284a);
    ridge(62, 14, 0x161a32);
    ridge(96, 10, 0x0c0e1e);
    ctx.fillStyle = '#2f7a8a';
    for (let i = 0; i < 30; i++) ctx.fillRect(Math.floor(r() * 480), 100 + Math.floor(r() * 36), 2, 1);
  });
}

export function registerColossusArt(scene: Phaser.Scene): void {
  sheet(scene, 'colossus-hand', [handOpen(), handFist()], [
    ['open', [0], 1],
    ['fist', [1], 1],
  ]);
  drawImage(scene, 'colossus-swipe', swipe().rows(), EPAL);
  sheet(scene, 'colossus-eye', [eye(18, 12, 'open'), eye(18, 12, 'shut'), eye(18, 12, 'glare')], [
    ['open', [0], 1],
    ['shut', [1], 1],
    ['glare', [2], 1],
    ['blink', [0, 1, 0], 10, 0],
  ]);
  sheet(scene, 'colossus-face', [face(false), face(true)], [
    ['shut', [0], 1],
    ['roar', [1], 1],
  ]);
  sheet(scene, 'colossus-bigeye', [eye(30, 18, 'dark'), eye(30, 18, 'open'), eye(30, 18, 'glare')], [
    ['dark', [0], 1],
    ['open', [1], 1],
    ['glare', [2], 1],
  ]);
  sheet(scene, 'colossus-core', [core(false), core(true)], [
    ['shut', [0], 1],
    ['open', [1], 1],
  ]);
  drawImage(scene, 'colossus-back', back().rows(), EPAL);
  drawImage(scene, 'colossus-slab', slab().rows(), EPAL);
  drawImage(scene, 'colossus-plate', plate().rows(), EPAL);
  sheet(scene, 'colossus-rock', [0, 1, 2, 3].map(rock), [['fly', [0, 1, 2, 3], 12]]);
  paintSky(scene);
  paintLand(scene);
}
