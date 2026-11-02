import Phaser from 'phaser';
import { P, sheet, EPAL } from './enemies';
import { drawSheet } from './pixel';
import type { FromageMove } from '../combat/fromagePlan';

// ============================================================================
// MONSIEUR FROMAGE, THE WHEEL OF FATE: a giant wheel of aged cheese with a waxed
// mustache, a tiny top hat, white gloves and a microphone. Game-show host.
// Grid 38x38 (frame 40x40). The 34x34 physics body is centred in the frame so the
// sprite can rotate (spin / roll) around its middle.
// Sheets:
//   'fromage' / 'fromage-melt' (P3): idle toss laugh roll stun splat spin
//   'fromage-half' (P2, the two halves): idle toss laugh stun spin roll  + heckler: hidle htoss hstun
// Extras: 'fmouse' (+ '-run'), 'cracker' (+ '-fly'), 'coin' (+ '-fly'), 'grater', 'fbutton',
//   'wedges' (one card per FromageMove, frame = WEDGE_ORDER index), 'fondue' (tileable floor strip).
// ============================================================================

type Pose = 'idle0' | 'idle1' | 'toss' | 'laugh' | 'roll' | 'stun' | 'splat';

const HOLES: [number, number, number][] = [[10, 13, 2], [27, 27, 2.5], [11, 29, 1.8], [26, 11, 1.6], [19, 33, 1.5], [31, 19, 1.3]];

/** Face + hat + arms, shared by the whole and melted wheel. */
function wheel(pose: Pose, melt: boolean): P {
  const p = new P(38, 38);
  const ramp = melt ? 'ygew' : 'oyge';
  const splat = pose === 'splat';
  const cx = 19, cy = splat ? 31 : 21, rx = splat ? 18 : 16, ry = splat ? 6.5 : 16;
  p.ellV(cx, cy, rx, ry, ramp);
  // rind ring
  const inside = (x: number, y: number, k: number) => ((x + 0.5 - cx) / (rx - k)) ** 2 + ((y + 0.5 - cy) / (ry - k)) ** 2 <= 1;
  for (let y = 0; y < 38; y++) for (let x = 0; x < 38; x++) if (inside(x, y, 0) && !inside(x, y, 1.6)) p.set(x, y, x + y < cx + cy ? 'y' : 'o');
  // holes (concave: dark top-left)
  if (!splat) for (const [hx, hy, hr] of HOLES) p.ellV(hx, hy, hr, hr, melt ? 'gyo' : 'yol');
  else for (const hx of [8, 30]) p.ellV(hx, 31, 1.6, 1.2, 'yol');

  // ---- face
  const fy = splat ? 29 : 18;
  if (pose === 'stun' || splat) {
    for (const ex of [14, 24]) {
      p.line(ex - 2, fy - 2, ex + 2, fy + 2, 'x').line(ex - 2, fy + 2, ex + 2, fy - 2, 'x');
    }
  } else if (pose === 'laugh') {
    for (const ex of [14, 24]) p.line(ex - 2, fy, ex, fy - 2, 'x').line(ex, fy - 2, ex + 2, fy, 'x');
  } else {
    for (const ex of [14, 24]) {
      p.ell(ex, fy, 2.6, 3.2, 'mww');
      const look = pose === 'roll' ? 1 : 0;
      p.set(ex + look, fy + 1, 'x').set(ex + look, fy, 'x');
    }
    // raised showman eyebrow
    p.line(11, fy - 5, 16, fy - 4, 'b').line(22, fy - 5, 27, fy - 6, 'b');
  }
  // nose
  p.ellV(19, fy + 4, 2.2, 1.6, 'loy');
  // mouth
  const my = fy + 9;
  if (pose === 'laugh') {
    p.ell(19, my, 4, 3, 'xWW');
    p.rect(18, my + 1, 3, 1, 'r');
  } else if (pose === 'stun' || splat) {
    p.line(15, my - (splat ? 4 : 0), 23, my - (splat ? 4 : 0), 'W');
  } else if (pose === 'toss') {
    p.ell(19, my - 1, 2, 1.8, 'xWW');
  } else p.line(17, my - 1, 21, my - 1, 'W');
  // the waxed mustache
  const mY = fy + 6 - (splat ? 2 : 0);
  p.ell(15, mY, 4.2, 1.7, 'xnn').ell(23, mY, 4.2, 1.7, 'xnn');
  const droop = pose === 'stun' || splat ? 2 : 0;
  p.set(10, mY - 1 + droop, 'x').set(10, mY - 2 + droop, 'x').set(11, mY - 3 + droop * 2, 'x');
  p.set(28, mY - 1 + droop, 'x').set(28, mY - 2 + droop, 'x').set(27, mY - 3 + droop * 2, 'x');

  // ---- drips (melted P3)
  if (melt && !splat) {
    for (const [dx, len] of [[8, 4], [14, 3], [23, 5], [30, 3]] as const) {
      p.line(dx, 33, dx, 33 + len, 'g');
      p.set(dx, 34 + len, 'e');
    }
  }

  // ---- top hat (slides off-centre when melting)
  const hx = (melt ? 20 : 15) + (pose === 'laugh' ? 1 : 0) + (pose === 'stun' ? 3 : 0);
  const hy = splat ? 18 : pose === 'stun' ? 2 : 0;
  p.box(hx, hy, 8, 6, 'xnns');
  p.rect(hx, hy + 4, 8, 1, 'c');
  p.box(hx - 2, hy + 6, 12, 2, 'xxn');

  // ---- arms (rubber-hose, white gloves)
  if (pose !== 'roll' && !splat) {
    const glove = (x: number, y: number) => p.ellV(x, y, 1.9, 1.9, 'mww');
    const L: Record<string, [number, number]> = { idle0: [1, 30], idle1: [1, 28], toss: [1, 30], laugh: [7, 31], stun: [0, 33] };
    const R: Record<string, [number, number]> = { idle0: [36, 29], idle1: [35, 26], toss: [36, 9], laugh: [31, 31], stun: [37, 33] };
    const [lx, ly] = L[pose];
    const [rx2, ry2] = R[pose];
    p.line(4, 23, lx, ly - 1, 'x');
    p.line(34, 23, rx2, ry2 + 1, 'x');
    glove(lx, ly);
    glove(rx2, ry2);
    // the microphone, always in the right glove (except mid-toss)
    if (pose !== 'toss') {
      p.line(rx2, ry2 - 2, rx2, ry2 - 4, 'a');
      p.ellV(rx2, ry2 - 5, 1.6, 1.6, 'stm');
    }
  }
  return p;
}

/** One half of the sliced wheel: flat cut face on the left, rind on the right (faces right). */
function half(pose: 'idle0' | 'idle1' | 'toss' | 'stun', monocle: boolean): P {
  const p = new P(38, 38);
  const cx = 11, cy = 21, r = 16;
  const inC = (x: number, y: number) => ((x + 0.5 - cx) / r) ** 2 + ((y + 0.5 - cy) / r) ** 2 <= 1 && x >= cx;
  p.shape(inC, 'oyge');
  // cut face: pale paste with holes
  for (let y = 0; y < 38; y++) for (let x = cx; x < cx + 3; x++) if (inC(x, y)) p.set(x, y, x === cx ? 'd' : 'e');
  for (const hy of [12, 22, 30]) p.ellV(cx + 1, hy, 1.4, 1.6, 'yol');
  for (const [hx, hy, hr] of [[22, 12, 1.6], [24, 28, 2.2], [17, 33, 1.4]] as const) p.ellV(hx, hy, hr, hr, 'yol');
  // one eye, half a mustache
  const ey = 18;
  if (pose === 'stun') p.line(19, ey - 2, 23, ey + 2, 'x').line(19, ey + 2, 23, ey - 2, 'x');
  else {
    p.ell(21, ey, 2.6, 3.2, 'mww');
    p.set(22, ey, 'x').set(22, ey + 1, 'x');
    p.line(18, ey - 5, 24, ey - (monocle ? 6 : 4), 'b');
  }
  if (monocle && pose !== 'stun') {
    for (let a = 0; a < Math.PI * 2; a += 0.3) p.set(21 + Math.cos(a) * 3.6, ey + Math.sin(a) * 3.8, 'g');
    p.line(24, ey + 3, 25, ey + 9, 'g');
  }
  p.ellV(25, ey + 4, 2, 1.5, 'loy');
  p.ell(20, ey + 6, 5, 1.7, 'xnn');
  p.set(26, ey + 5, 'x').set(27, ey + 4, 'x').set(27, ey + 3, 'x');
  p.line(17, ey + 9, 21, ey + 9, 'W');
  // hat (smaller, jaunty)
  p.box(14, 0, 7, 5, 'xnns');
  p.rect(14, 3, 7, 1, monocle ? 'B' : 'c');
  p.box(12, 5, 11, 2, 'xxn');
  // one arm on the rind side
  const arm: Record<string, [number, number]> = { idle0: [32, 29], idle1: [31, 26], toss: [33, 9], stun: [33, 33] };
  const [ax, ay] = arm[pose];
  p.line(26, 23, ax, ay + 1, 'x');
  p.ellV(ax, ay, 1.9, 1.9, 'mww');
  return p;
}

function mouse(frame: 0 | 1): P {
  const p = new P(14, 10);
  p.line(0, 3, 2, 6, 'K');
  p.ellV(6, 6, 4.5, 3, 'tam');
  p.ellV(10, 5, 2.8, 2.3, 'tam');
  p.ell(9, 2, 1.6, 1.6, 'KKK');
  p.set(11, 4, 'x').set(13, 5, 'K');
  const f = frame ? [[4, 9], [8, 9]] : [[3, 9], [9, 9]];
  for (const [x, y] of f) p.set(x, y, 'a');
  return p;
}

function cracker(frame: 0 | 1): P {
  const p = new P(11, 11);
  if (frame === 0) p.box(1, 1, 9, 9, 'ldde');
  else p.poly([[5.5, 0], [11, 5.5], [5.5, 11], [0, 5.5]], 'ldde');
  for (const [x, y] of [[3, 3], [7, 3], [5, 5], [3, 7], [7, 7]]) p.set(x, y, 'b');
  return p;
}

function coin(frame: 0 | 1 | 2): P {
  const p = new P(8, 8);
  const rx = [3.6, 2.2, 0.9][frame];
  p.ellV(4, 4, rx, 3.6, 'oyge');
  if (frame === 0) p.set(4, 4, 'o').set(4, 3, 'o');
  return p;
}

function grater(): P {
  const p = new P(20, 30);
  p.box(2, 5, 16, 25, 'satm');
  for (let y = 9; y < 28; y += 4) for (let x = 5; x < 16; x += 4) p.set(x, y, 'x').set(x + 1, y, 'x').set(x, y + 1, 'n');
  p.rect(6, 0, 8, 2, 'x').rect(6, 0, 2, 6, 'x').rect(12, 0, 2, 6, 'x');
  return p;
}

function button(pressed: boolean): P {
  const p = new P(22, 14);
  p.box(1, 9, 20, 5, 'stam');
  const top = pressed ? 9 : 4;
  p.shape((x, y) => ((x + 0.5 - 11) / 8) ** 2 + ((y + 0.5 - (top + 5)) / 5) ** 2 <= 1 && y < 10, 'Wcrr');
  if (!pressed) p.set(8, top + 2, 'w').set(9, top + 2, 'w');
  return p;
}

/** Wheel card order (frame index in the 'wedges' sheet). */
export const WEDGE_ORDER: readonly FromageMove[] = ['roll', 'crackers', 'mice', 'fondue', 'grater', 'bankrupt', 'double'];
/** Card colour per move, also used for the wheel's tick flashes. */
export const WEDGE_COLOR: Record<FromageMove, number> = {
  roll: 0xe0443e, crackers: 0x4ea0e0, mice: 0x4e9a45, fondue: 0x8a4fc7, grater: 0x5d5b7a, bankrupt: 0x241a33, double: 0xd1478f,
};

function wedge(m: FromageMove): P {
  const p = new P(18, 18);
  const bg: Record<FromageMove, string> = { roll: 'Wcrr', crackers: 'NBSS', mice: 'PMLL', fondue: 'Vppp', grater: 'nstt', bankrupt: 'xznn', double: 'WGKK' };
  p.box(0, 0, 18, 18, bg[m]);
  switch (m) {
    case 'roll':
      p.ellV(10, 9, 5, 5, 'oyge');
      p.ellV(9, 8, 1.3, 1.3, 'yol').ellV(12, 11, 1.1, 1.1, 'yol');
      p.line(1, 6, 3, 6, 'w').line(1, 9, 4, 9, 'w').line(1, 12, 3, 12, 'w');
      break;
    case 'crackers':
      p.box(4, 4, 10, 10, 'ldde');
      for (const [x, y] of [[6, 6], [11, 6], [8, 9], [6, 11], [11, 11]]) p.set(x, y, 'b');
      break;
    case 'mice':
      p.ell(5, 6, 2.4, 2.4, 'KKK').ell(13, 6, 2.4, 2.4, 'KKK');
      p.ellV(9, 10, 4.5, 3.6, 'tam');
      p.set(7, 9, 'x').set(11, 9, 'x').set(9, 12, 'K');
      break;
    case 'fondue':
      p.line(14, 1, 10, 8, 'a');
      p.box(3, 9, 12, 7, 'xns');
      p.ell(9, 9, 6, 2, 'oyg');
      p.line(5, 10, 5, 13, 'y');
      break;
    case 'grater':
      p.box(5, 4, 8, 12, 'satm');
      for (let y = 6; y < 15; y += 3) for (let x = 7; x < 12; x += 3) p.set(x, y, 'x');
      p.rect(7, 1, 4, 1, 'x').rect(7, 1, 1, 3, 'x').rect(10, 1, 1, 3, 'x');
      break;
    case 'bankrupt':
      p.ellV(9, 9, 5.5, 5.5, 'oyge');
      p.set(9, 7, 'o').set(9, 8, 'o').set(9, 10, 'o').set(9, 11, 'o');
      for (let i = 0; i < 2; i++) p.line(3 + i, 15, 15 + i, 3, 'r');
      break;
    case 'double':
      p.box(3, 11, 12, 4, 'stam');
      p.shape((x, y) => ((x + 0.5 - 9) / 5) ** 2 + ((y + 0.5 - 11) / 4) ** 2 <= 1 && y < 12, 'Wcrr');
      p.line(3, 3, 5, 5, 'w').line(3, 5, 5, 3, 'w');
      p.line(8, 3, 9, 3, 'w').line(9, 3, 9, 4, 'w').line(8, 5, 9, 4, 'w').line(8, 5, 9, 5, 'w');
      break;
  }
  return p;
}

const FROMAGE_ANIMS: [string, number[], number, number?][] = [
  ['idle', [0, 1], 3], ['spin', [0], 1], ['toss', [2], 1], ['laugh', [3, 1], 8], ['roll', [4], 1], ['stun', [5], 1], ['splat', [6], 1],
];

export function registerFromageArt(scene: Phaser.Scene): void {
  const poses: Pose[] = ['idle0', 'idle1', 'toss', 'laugh', 'roll', 'stun', 'splat'];
  sheet(scene, 'fromage', poses.map((o) => wheel(o, false)), FROMAGE_ANIMS);
  sheet(scene, 'fromage-melt', poses.map((o) => wheel(o, true)), FROMAGE_ANIMS);
  const hp = ['idle0', 'idle1', 'toss', 'stun'] as const;
  sheet(scene, 'fromage-half', [...hp.map((o) => half(o, false)), ...hp.map((o) => half(o, true))], [
    ['idle', [0, 1], 3], ['spin', [0], 1], ['toss', [2], 1], ['laugh', [1, 0], 8], ['roll', [0], 1], ['stun', [3], 1], ['splat', [3], 1],
    ['hidle', [4, 5], 3], ['htoss', [6], 1], ['hstun', [7], 1],
  ]);
  sheet(scene, 'fmouse', [mouse(0), mouse(1)], [['run', [0, 1], 14]]);
  sheet(scene, 'cracker', [cracker(0), cracker(1)], [['fly', [0, 1], 12]]);
  sheet(scene, 'coin', [coin(0), coin(1), coin(2), coin(1)], [['fly', [0, 1, 2, 3], 10]]);
  sheet(scene, 'grater', [grater()], []);
  sheet(scene, 'fbutton', [button(false), button(true)], []);
  sheet(scene, 'wedges', WEDGE_ORDER.map(wedge), []);
  // tileable fondue strip (no outline)
  drawSheet(scene, 'fondue', [[
    '.gg....g....gg..',
    'gyyg..gyg..gyyg.',
    'yyyyggyyyggyyyyg',
    'yoyyyyyoyyyyyoyy',
    'oyyoyyyyyoyyyyyo',
    'oooyoooyoooyoooy',
  ]], EPAL, { outline: false });
}
