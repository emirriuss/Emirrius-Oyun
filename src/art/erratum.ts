import type Phaser from 'phaser';
import { drawSheet, drawCanvas, defineAnim, type Frame, type Palette } from './pixel';
import { C } from './palette';

// ============================================================================
// ERRATUM, THE UNWRITTEN — a typo that escaped the level files: a living ink
// ampersand. The counter (hole) of its upper loop is one bloodshot eye that
// tracks you, the lower counter is a mouth, and a quill is stuck through its
// head like a crown. It drips.
// Grid 32x48 (frame 34x50 with outline), art faces right, body ~24x36 bottom-centred.
// Sheets (same frame layout / anim names):
//   'erratum'     Draft 1: clean ink, cream quill
//   'erratum-p2'  Draft 2: red correction-ink splatter, eye glows
//   'erratum-p3'  Draft 3: chromatic misprint (cyan/magenta ghost edges), torn quill
//   'erratum-dot' the corrected full stop (death / ending card): frames 0-1 blink
// Frames: 0-1 idle, 2-3 walk, 4 write, 5 cast, 6 windup, 7 stun, 8 roar, 9 dizzy, 10 air
// Anims '<sheet>-<name>': idle walk (loop) | write cast windup stun roar dizzy air (single)
// Extra textures:
//   'err-glyph' 12x14 frames: 0 '#', 1 '=', 2 '^', 3 'P', 4 'E', 5 blot ('err-glyph-fly' n/a: static)
//   'err-ink' 7x7 ink drop (+ '-fly' wobble), 'err-heart' 11x10 ink heart (0 ink, 1 red/full)
//   'err-cursor' 11x15 mouse pointer, 'err-quill' 8x22 thrown quill (+ '-fly')
//   'err-page' 480x272 parchment page with ruled lines and the red margin rule (no outline)
// ============================================================================

const W = 32;
const H = 48;
/** glyph y offset inside the frame (room above for the quill) */
const OY = 8;

interface Pose {
  dy?: number; // bob / crouch (positive = down)
  lean?: number; // top shear in px (positive = forward)
  eye?: 'open' | 'wide' | 'x' | 'shut' | 'spiral';
  /** pupil x offset inside the eye (+ = forward) */
  look?: number;
  mouth?: 'line' | 'open' | 'grin';
  drip?: number; // drip length 0..4
  /** quill tip offset (dx, dy) from its rest position */
  quill?: [number, number];
  /** stubby ink arms: hand positions relative to the body (back, front) */
  arms?: [[number, number], [number, number]];
  splay?: number; // walking: drips/feet offset
}

type Grid = string[][];

function blank(): Grid {
  return Array.from({ length: H }, () => Array<string>(W).fill('.'));
}

function plot(g: Grid, x: number, y: number, c: string): void {
  const xi = Math.round(x), yi = Math.round(y);
  if (xi >= 0 && yi >= 0 && xi < W && yi < H) g[yi][xi] = c;
}

function disc(g: Grid, cx: number, cy: number, r: number, c: string): void {
  for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++)
    for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) if ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= r * r) plot(g, x, y, c);
}

function stroke(g: Grid, x0: number, y0: number, x1: number, y1: number, r: number, c: string): void {
  const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 2) + 1;
  for (let i = 0; i <= n; i++) disc(g, x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n, r, c);
}

/** Ring (ellipse band) between outer and inner radii; `test` returns the colour or null. */
function ellBand(g: Grid, cx: number, cy: number, rx: number, ry: number, irx: number, iry: number, shade: (x: number, y: number) => string, shear: (y: number) => number): void {
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const sx = x + 0.5 - shear(y + 0.5);
      const o = ((sx - cx) / rx) ** 2 + ((y + 0.5 - cy) / ry) ** 2;
      const i = ((sx - cx) / irx) ** 2 + ((y + 0.5 - cy) / iry) ** 2;
      if (o <= 1 && i > 1) g[y][x] = shade(sx - cx, y + 0.5 - cy);
    }
}

function fillEll(g: Grid, cx: number, cy: number, rx: number, ry: number, c: string, shear: (y: number) => number): void {
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const sx = x + 0.5 - shear(y + 0.5);
      if (((sx - cx) / rx) ** 2 + ((y + 0.5 - cy) / ry) ** 2 <= 1) g[y][x] = c;
    }
}

/** Ink shading: 'k' core, 'n' mid, 'v' rim light on the upper-left, 'g' specular. */
function inkShade(dx: number, dy: number, r: number): string {
  const d = (-dx - dy) / r;
  if (d > 0.95) return 'g';
  if (d > 0.45) return 'v';
  if (d < -0.55) return 'k';
  return 'n';
}

function body(o: Pose): Grid {
  const g = blank();
  const dy = (o.dy ?? 0) + OY;
  const lean = o.lean ?? 0;
  // shear: rows near the top lean forward, the base stays planted
  const shear = (y: number) => lean * Math.max(0, (H - y) / H) * 1.2;
  const ux = 14, uy = 10 + dy; // upper loop centre
  const lx = 13, ly = 28 + Math.min(dy, OY + 3); // lower loop centre (crouches less)

  // quill behind the head (stuck through the top loop)
  const [qdx, qdy] = o.quill ?? [0, 0];
  const qx0 = ux + 2 + shear(uy), qy0 = uy - 1;
  const qx1 = ux + 11 + qdx + shear(0), qy1 = Math.max(0, uy - 15 + qdy);
  stroke(g, qx0, qy0, qx1, qy1, 1.6, 'Q');
  stroke(g, qx0 + 0.6, qy0 - 0.6, qx1, qy1, 0.8, 'q');
  // barbs
  for (let t = 0.3; t < 0.95; t += 0.16) {
    const x = qx0 + (qx1 - qx0) * t, y = qy0 + (qy1 - qy0) * t;
    plot(g, x - 2, y - 1, 'q');
    plot(g, x + 2, y + 1, 'Q');
  }
  plot(g, qx1, qy1, 'q');

  // diagonal stroke of the ampersand (upper-left to lower-right foot)
  const diag = (y: number) => shear(y);
  stroke(g, ux - 5 + diag(uy + 5), uy + 5, lx + 11, ly + 9, 2.6, 'n');
  stroke(g, ux - 5.6 + diag(uy + 5), uy + 4.5, lx + 10.4, ly + 8.5, 1, 'v');
  // tail flick (up-right leg)
  stroke(g, lx + 6, ly - 2, lx + 13 + shear(ly - 8), ly - 8, 1.8, 'n');
  plot(g, lx + 13 + shear(ly - 8), ly - 9, 'v');

  // loops
  ellBand(g, ux, uy, 7.2, 7, 3.6, 3.4, (x, y) => inkShade(x, y, 7), shear);
  ellBand(g, lx, ly, 10.5, 9.2, 5.2, 4.4, (x, y) => inkShade(x, y, 10), shear);

  // eye in the upper counter
  const eye = o.eye ?? 'open';
  const ex = ux + shear(uy), ey = uy;
  if (eye === 'shut') {
    stroke(g, ex - 2.5, ey + 0.5, ex + 2.5, ey + 0.5, 0.6, 'k');
  } else {
    fillEll(g, ux, uy, eye === 'wide' ? 3.8 : 3.4, eye === 'wide' ? 3.6 : 3.2, 'e', shear);
    plot(g, ex - 2, ey - 2, 'b');
    plot(g, ex + 2, ey + 2, 'b');
    if (eye === 'x') {
      stroke(g, ex - 1.5, ey - 1.5, ex + 1.5, ey + 1.5, 0.5, 'p');
      stroke(g, ex - 1.5, ey + 1.5, ex + 1.5, ey - 1.5, 0.5, 'p');
    } else if (eye === 'spiral') {
      plot(g, ex, ey, 'p');
      plot(g, ex + 1, ey, 'p');
      plot(g, ex + 1, ey + 1, 'p');
      plot(g, ex - 1, ey + 1, 'p');
      plot(g, ex - 1, ey - 1, 'p');
      plot(g, ex + 1, ey - 1, 'p');
    } else {
      const px = ex + (o.look ?? 1);
      disc(g, px, ey, eye === 'wide' ? 1.1 : 1.5, 'p');
      plot(g, px, ey, 'k');
      plot(g, px - 1, ey - 1, 'e');
    }
  }

  // mouth in the lower counter
  const mx = lx + shear(ly), my = ly;
  const mouth = o.mouth ?? 'line';
  if (mouth === 'open' || mouth === 'grin') {
    fillEll(g, lx, ly + 0.5, 4.2, mouth === 'open' ? 3.6 : 2.4, 'm', shear);
    for (let x = -3; x <= 3; x += 2) {
      plot(g, mx + x, my - (mouth === 'open' ? 3 : 2) + 1, 'e');
      if (mouth === 'open') plot(g, mx + x + 1, my + 3, 'e');
    }
  } else {
    stroke(g, mx - 2.5, my + 1, mx + 2.5, my + 0.5, 0.5, 'k');
    plot(g, mx + 3, my, 'k');
  }

  // stubby ink arms
  const arms = o.arms ?? [[-12, 4], [12, 2]];
  const [b, f] = arms;
  stroke(g, lx - 8, ly - 3, lx + b[0], ly + b[1], 1.3, 'k');
  disc(g, lx + b[0], ly + b[1], 1.6, 'k');
  stroke(g, lx + 8, ly - 4, lx + f[0], ly + f[1], 1.3, 'n');
  disc(g, lx + f[0], ly + f[1], 1.7, 'n');
  plot(g, lx + f[0] - 1, ly + f[1] - 1, 'v');

  // drips + feet (bottom row is the floor)
  const drip = o.drip ?? 1;
  const sp = o.splay ?? 0;
  for (let y = 0; y < drip; y++) plot(g, lx - 4 + sp, ly + 9 + y, 'n');
  for (let y = 0; y < Math.max(0, drip - 1); y++) plot(g, lx + 5 - sp, ly + 9 + y, 'k');
  for (let x = -7; x <= 7; x++) plot(g, lx + x + (Math.abs(x) > 5 ? sp * Math.sign(x) : 0), H - 1, x % 3 === 0 ? 'k' : 'n');
  // puddle bridge from the loop down to the floor
  for (let y = Math.ceil(ly + 8); y < H - 1; y++) {
    plot(g, lx - 2, y, 'n');
    plot(g, lx - 1, y, 'n');
    plot(g, lx, y, 'k');
    plot(g, lx + 1, y, 'k');
  }
  return g;
}

const POSES: Pose[] = [
  { dy: 0, drip: 1 }, // 0 idle
  { dy: 1, drip: 3, look: 2 }, // 1 idle
  { dy: 0, lean: 2, splay: 1, drip: 2, arms: [[-11, 1], [13, 5]] }, // 2 walk
  { dy: 1, lean: 2, splay: -1, drip: 1, arms: [[-13, 5], [11, 1]] }, // 3 walk
  { dy: 0, lean: 4, quill: [4, 6], arms: [[-12, 2], [15, -6]], look: 2 }, // 4 write
  { dy: -1, eye: 'wide', mouth: 'grin', arms: [[-14, -10], [14, -12]], quill: [-1, -1] }, // 5 cast
  { dy: 3, lean: -2, mouth: 'grin', arms: [[-13, 6], [9, 6]], drip: 4 }, // 6 windup
  { dy: 2, eye: 'x', mouth: 'open', arms: [[-12, 8], [12, 8]], drip: 4, quill: [-3, 3] }, // 7 stun
  { dy: -1, eye: 'wide', mouth: 'open', lean: -1, arms: [[-15, -6], [15, -8]], drip: 0 }, // 8 roar
  { dy: 2, eye: 'spiral', mouth: 'line', arms: [[-12, 7], [12, 7]], drip: 3, quill: [-4, 4] }, // 9 dizzy
  { dy: -1, drip: 0, arms: [[-14, -2], [14, -3]], look: 0 }, // 10 air
];

const INK: Palette = {
  k: 0x0e0a1c,
  n: 0x231b44,
  v: 0x4a3f86,
  g: 0x9b92e6,
  e: C.white,
  b: 0xe8a0a0, // bloodshot veins
  p: C.red,
  m: 0x2a0d18, // mouth
  q: C.cream,
  Q: C.sand,
};

/** Splatter red correction ink over the body (Draft 2). */
function splatter(g: Grid, seed: number): void {
  let s = seed;
  const r = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let i = 0; i < 26; i++) {
    const x = Math.floor(r() * W), y = Math.floor(r() * H);
    if (g[y][x] === 'n' || g[y][x] === 'k') g[y][x] = r() < 0.7 ? 'r' : 'R';
  }
}

/** Chromatic misprint (Draft 3): ghost edges in cyan (left) and magenta (right), a few torn rows. */
function misprint(g: Grid, seed: number): Grid {
  const out = g.map((row) => row.slice());
  const solid = (x: number, y: number) => g[y]?.[x] !== undefined && g[y][x] !== '.';
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      if (solid(x, y)) continue;
      if (solid(x + 1, y) && !solid(x + 2, y)) out[y][x] = 'c';
      else if (solid(x - 1, y) && !solid(x - 2, y)) out[y][x] = 'M';
    }
  // torn scanlines: shift 2 rows sideways
  for (const ty of [OY + 6 + (seed % 5), OY + 22 + (seed % 7)]) {
    if (ty >= H) continue;
    const row = out[ty];
    const shifted = row.map((_, x) => row[(x - 2 + W) % W]);
    out[ty] = shifted;
  }
  return out;
}

const toFrame = (g: Grid): Frame => g.map((r) => r.join(''));

const DOT_PAL: Palette = { ...INK };

function dotFrame(blink: boolean): Frame {
  const g = blank();
  disc(g, 16, H - 7, 6.5, 'n');
  disc(g, 14.5, H - 9, 2.2, 'v');
  plot(g, 13, H - 10, 'g');
  if (blink) stroke(g, 14, H - 7, 18, H - 7, 0.5, 'e');
  else {
    disc(g, 16.5, H - 7, 1.9, 'e');
    plot(g, 17, H - 7, 'p');
  }
  return toFrame(g);
}

// ---------------------------------------------------------------------------- glyphs (7x9 pixel letters on a tile)
const GLYPHS: Record<string, Frame> = {
  '#': ['.x.x.x.', 'xxxxxxx', '.x.x.x.', '.x.x.x.', 'xxxxxxx', '.x.x.x.', '.x.x.x.', 'xxxxxxx', '.x.x.x.'],
  '=': ['.......', '.......', 'xxxxxxx', 'xxxxxxx', '.......', 'xxxxxxx', 'xxxxxxx', '.......', '.......'],
  '^': ['...x...', '...x...', '..xxx..', '..xxx..', '.xx.xx.', '.xx.xx.', 'xx...xx', 'xx...xx', 'x.....x'],
  P: ['xxxxx..', 'xx..xx.', 'xx..xx.', 'xx..xx.', 'xxxxx..', 'xx.....', 'xx.....', 'xx.....', 'xx.....'],
  E: ['xxxxxxx', 'xx.....', 'xx.....', 'xxxxx..', 'xxxxx..', 'xx.....', 'xx.....', 'xx.....', 'xxxxxxx'],
};

function glyphTile(ch: string, fill: string): Frame {
  const rows: string[] = [];
  for (let y = 0; y < 12; y++) {
    let r = '';
    for (let x = 0; x < 10; x++) {
      const gy = y - 1, gx = x - 1;
      r += GLYPHS[ch]?.[gy]?.[gx] === 'x' ? fill : '.';
    }
    rows.push(r);
  }
  return rows;
}

function blot(): Frame {
  const g: string[][] = Array.from({ length: 12 }, () => Array<string>(10).fill('.'));
  const pts = [[5, 6, 4], [3, 4, 2], [7, 8, 2], [2, 9, 1.5], [8, 3, 1.4]];
  for (const [cx, cy, r] of pts)
    for (let y = 0; y < 12; y++) for (let x = 0; x < 10; x++) if ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= r * r) g[y][x] = 'x';
  return g.map((r) => r.join(''));
}

export function registerErratumArt(scene: Phaser.Scene): void {
  const base = POSES.map((p) => body(p));
  const names: [string, number[], number, number?][] = [
    ['idle', [0, 1], 3],
    ['walk', [2, 3], 6],
    ['write', [4], 1, 0],
    ['cast', [5], 1, 0],
    ['windup', [6], 1, 0],
    ['stun', [7], 1, 0],
    ['roar', [8], 1, 0],
    ['dizzy', [9], 1, 0],
    ['air', [10], 1, 0],
  ];
  const sheets: [string, Frame[], Palette][] = [
    ['erratum', base.map(toFrame), INK],
    [
      'erratum-p2',
      base.map((g, i) => {
        const c = g.map((r) => r.slice());
        splatter(c, 77 + i * 13);
        return toFrame(c);
      }),
      { ...INK, r: C.red, R: C.crimson, p: 0xff2a2a, g: 0xffb8c8 },
    ],
    ['erratum-p3', base.map((g, i) => toFrame(misprint(g, i * 3 + 1))), { ...INK, c: 0x3ef0ff, M: 0xff3ec8, p: 0xffffff, q: 0xb9a6ff, Q: 0x5b2a86 }],
  ];
  for (const [key, frames, pal] of sheets) {
    drawSheet(scene, key, frames, pal);
    for (const [n, f, fps, rep] of names) defineAnim(scene, `${key}-${n}`, key, f, fps, rep ?? -1);
  }
  drawSheet(scene, 'erratum-dot', [dotFrame(false), dotFrame(true)], DOT_PAL);
  defineAnim(scene, 'erratum-dot-idle', 'erratum-dot', [0, 0, 0, 0, 1], 5);

  // glyph tiles: ink letters (x) with a pale paper back so they read against the dark arena
  const order = ['#', '=', '^', 'P', 'E'];
  drawSheet(scene, 'err-glyph', [...order.map((ch) => glyphTile(ch, 'x')), blot()], { x: 0x231b44 });
  drawSheet(scene, 'err-glyph-red', order.map((ch) => glyphTile(ch, 'x')), { x: C.red });

  drawSheet(scene, 'err-ink', [
    ['..k..', '.knk.', 'knvnk', 'knnnk', '.kkk.'],
    ['.....', '..k..', '.knk.', 'knvnk', '.kkk.'],
  ], { k: 0x0e0a1c, n: 0x231b44, v: 0x9b92e6 });
  defineAnim(scene, 'err-ink-fly', 'err-ink', [0, 1], 10);

  drawSheet(scene, 'err-heart', [
    ['.kk.kk..', 'knnknnk.', 'knvnnnk.', 'knnnnnk.', '.knnnk..', '..knk...', '...k....'],
    ['.rr.rr..', 'rRRrRRr.', 'rRwRRRr.', 'rRRRRRr.', '.rRRRr..', '..rRr...', '...r....'],
  ], { k: 0x0e0a1c, n: 0x231b44, v: 0x9b92e6, r: C.crimson, R: C.red, w: C.white });

  drawSheet(scene, 'err-cursor', [[
    'k........',
    'kk.......',
    'kwk......',
    'kwwk.....',
    'kwwwk....',
    'kwwwwk...',
    'kwwwwwk..',
    'kwwwwwwk.',
    'kwwwwkkkk',
    'kwwkwk...',
    'kwk.kwk..',
    'kk..kwk..',
    '.....kwk.',
  ]], { k: 0x0e0a1c, w: C.white });

  drawSheet(scene, 'err-quill', [
    ['...q', '..qQ', '..qQ', '.qQ.', '.qQ.', 'qQ..', 'qQ..', 'qQ..', 'm...', 'm...'],
  ], { q: C.cream, Q: C.sand, m: C.mist });
  defineAnim(scene, 'err-quill-fly', 'err-quill', [0], 1);

  // the page: parchment, ruled lines, red margin rule, a coffee ring
  drawCanvas(scene, 'err-page', 480, 272, (ctx) => {
    ctx.fillStyle = '#efe4c8';
    ctx.fillRect(0, 0, 480, 272);
    // grain
    let s = 99;
    const r = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
    for (let i = 0; i < 1400; i++) {
      ctx.fillStyle = r() < 0.5 ? 'rgba(160,130,90,0.10)' : 'rgba(255,255,255,0.18)';
      ctx.fillRect(Math.floor(r() * 480), Math.floor(r() * 272), 1, 1);
    }
    ctx.fillStyle = 'rgba(78,160,224,0.35)';
    for (let y = 24; y < 272; y += 16) ctx.fillRect(0, y, 480, 1);
    ctx.fillStyle = 'rgba(224,68,62,0.55)';
    ctx.fillRect(40, 0, 1, 272);
    ctx.fillRect(42, 0, 1, 272);
    ctx.strokeStyle = 'rgba(120,80,40,0.16)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(400, 70, 26, 0.3, Math.PI * 1.85);
    ctx.stroke();
    // binder holes
    ctx.fillStyle = 'rgba(40,30,30,0.35)';
    for (const y of [60, 136, 212]) {
      ctx.beginPath();
      ctx.arc(18, y, 5, 0, Math.PI * 2);
      ctx.fill();
    }
  });
}
