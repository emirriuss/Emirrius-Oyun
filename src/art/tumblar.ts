import Phaser from 'phaser';
import { P, sheet } from './enemies';

// ============================================================================
// TUMBLAR, THE KEYLESS DOOR — a riveted iron vault door that locked itself so long ago it forgot
// what it guards. Its keyhole is its eye; two rivet rows are its brows. No body, no limbs: it fights
// with its own lock parts (deadbolts, its key, the dial's numerals, tumbler gears).
// Grid 44x70 (frame 46x72), facing doesn't matter (symmetric), body ~36x64 bottom-centred.
// Three sheets, identical frame layout / anim names:
//   'tumblar'     P1 The Tumblers: sealed, a brass bitting plate under the keyhole
//   'tumblar-p2'  P2 The Dial: the dial has been pulled out, leaving a dark round socket
//   'tumblar-p3'  P3 The Wards: ajar, light spilling out of the gap on its hinge side
// Frames: 0-1 idle (hum), 2 windup (brows down, keyhole narrows), 3 strike (bolts out),
//         4 open (core open: keyhole blazing, the punish window), 5 stun, 6 roar
// Anims '<sheet>-<name>': idle (loop) | windup strike open stun roar (single)
// Props: 'tumblar-pin' 28x10 (0 plain, 1 set, 2 spool, 3 spool false-set, 4 spool set)
//        'tumblar-bolt' 16x30 (0 thrown, 1 drawn)   'tumblar-key' 26x12   'tumblar-num' 10x10
//        'tumblar-gear' 16x16 (2 frames)            'tumblar-hook' 12x12  'tumblar-dial' 64x64
// ============================================================================

interface Pose {
  /** keyhole: 0 = shut slit, 1 = normal, 2 = blazing open */
  eye?: 0 | 1 | 2;
  /** brow tilt (px, + = angry) */
  brow?: number;
  /** deadbolt stubs out of the edges */
  bolts?: boolean;
  /** vertical squash (px off the top) */
  squash?: number;
  stun?: boolean;
  /** hum flicker on the rivets */
  flick?: boolean;
}

const W = 44;
const H = 70;

function door(o: Pose, ph: 1 | 2 | 3): P {
  const p = new P(W, H);
  const top = 4 + (o.squash ?? 0);
  const L = 4, R = W - 5;
  // ---- frame (dark stone jamb)
  p.box(L - 3, top - 3, R - L + 7, H - top + 3, 'xnh');
  // ---- slab (P3: ajar, shifted right with a lit gap on the hinge side)
  const sx = ph === 3 ? 3 : 0;
  if (ph === 3) {
    p.rect(L, top, 3, H - top, 'w');
    p.rect(L + 1, top, 1, H - top, 'e');
  }
  const metal = ph === 1 ? 'Nstm' : ph === 2 ? 'hstm' : 'Zsta';
  p.box(L + sx, top, R - L + 1 - sx, H - top, metal);
  // plank seams + rivets
  for (const fy of [0.22, 0.78]) {
    const y = Math.round(top + (H - top) * fy);
    p.line(L + 1 + sx, y, R - 1, y, 'n');
    for (let x = L + 3 + sx; x < R - 1; x += 5) p.set(x, y - 2, o.flick && x % 2 ? 'm' : 'a').set(x, y + 2, 'a');
  }
  // hinges (P3: on the lit side)
  for (const y of [top + 8, H - 10]) p.box(L + sx, y, 5, 4, 'xta');
  // ---- brows: rivet rows over the eye
  const cx = Math.round((L + sx + R) / 2) + 1;
  const ey = Math.round(top + (H - top) * 0.45);
  const b = o.brow ?? 0;
  for (let k = -1; k <= 1; k += 2) {
    p.line(cx + k * 3, ey - 11 + b, cx + k * 11, ey - 11 - b, 'x');
    p.line(cx + k * 3, ey - 12 + b, cx + k * 11, ey - 12 - b, 'a');
  }
  // ---- escutcheon (round boss plate) + keyhole
  p.ellV(cx, ey, 9, 9, ph === 2 ? 'xnh' : 'udyg');
  if (ph === 2) {
    // the dial's empty socket: a dark ring with screw holes
    p.ellV(cx, ey, 7, 7, 'zZh');
    for (let k = 0; k < 4; k++) p.set(cx + Math.sin((k * Math.PI) / 2) * 8, ey - Math.cos((k * Math.PI) / 2) * 8, 'a');
  }
  const eye = o.eye ?? 1;
  const hole = eye === 2 ? 'w' : 'x';
  if (o.stun) {
    p.line(cx - 3, ey - 3, cx + 3, ey + 3, 'x').line(cx - 3, ey + 3, cx + 3, ey - 3, 'x');
  } else if (eye === 0) {
    p.rect(cx - 3, ey, 7, 1, 'x');
  } else {
    p.ellV(cx, ey - 2, 2.6, 2.6, hole + hole);
    p.poly([[cx - 1.5, ey], [cx + 1.5, ey], [cx + 3, ey + 6], [cx - 3, ey + 6]], hole + hole);
    if (eye === 2) {
      p.set(cx, ey - 2, 'e');
      for (const [dx, dy] of [[-6, -6], [6, -6], [-7, 2], [7, 2], [0, 8]]) p.set(cx + dx, ey + dy, 'g');
    } else p.set(cx, ey - 3, ph === 3 ? 'K' : 'r');
  }
  // ---- P1 bitting plate (the key profile it wants, cut into brass)
  if (ph === 1) {
    const by = ey + 14;
    p.box(cx - 9, by, 19, 6, 'udy');
    for (let k = 0; k < 5; k++) p.rect(cx - 7 + k * 4, by + 1 + (k * 3) % 4, 2, 2, 'x');
  }
  // ---- P3 wards: brass bars across the gap
  if (ph === 3) for (const y of [top + 20, top + 34, top + 48]) p.rect(L, y, 3, 2, 'y');
  // ---- deadbolt stubs
  if (o.bolts) for (const y of [ey - 20, ey + 20]) p.box(0, y, L + 1, 4, 'sam');
  return p;
}

const POSES: Pose[] = [
  { eye: 1 }, // 0 idle
  { eye: 1, flick: true }, // 1 idle hum
  { eye: 0, brow: 3 }, // 2 windup
  { eye: 1, brow: 2, bolts: true }, // 3 strike
  { eye: 2, brow: -2 }, // 4 open (punish)
  { stun: true, brow: -1, squash: 1 }, // 5 stun
  { eye: 2, brow: 4, bolts: true }, // 6 roar
];

const ANIMS: [string, number[], number, number?][] = [
  ['idle', [0, 1], 2],
  ['windup', [2], 1, 0],
  ['strike', [3], 1, 0],
  ['open', [4], 1, 0],
  ['stun', [5], 1, 0],
  ['roar', [6], 1, 0],
];

/** Pin head: a brass driver pin lying sideways in its slot. */
function pin(kind: 'plain' | 'set' | 'spool' | 'false' | 'spoolset'): P {
  const p = new P(28, 10);
  const spool = kind === 'spool' || kind === 'false' || kind === 'spoolset';
  const ramp = kind === 'set' || kind === 'spoolset' ? 'yge' : kind === 'false' ? 'oyg' : 'uod';
  p.box(1, 1, 26, 8, ramp);
  if (spool) {
    // waisted middle: the spool's tell
    for (const x of [9, 10, 17, 18]) {
      p.set(x, 1, 'x').set(x, 8, 'x');
    }
    p.rect(11, 1, 6, 1, 'u').rect(11, 8, 6, 1, 'u');
  }
  // end caps
  p.rect(1, 2, 1, 6, 'u').rect(26, 2, 1, 6, 'u');
  return p;
}

function bolt(thrown: boolean): P {
  const p = new P(16, 30);
  // floor slot
  p.box(0, 25, 16, 5, 'xnh');
  if (thrown) {
    // a tall red-iron bar standing out of its slot, gold bands, rounded cap: locked
    p.box(3, 4, 10, 22, 'Wcr');
    p.rect(3, 9, 10, 2, 'g').rect(3, 17, 10, 2, 'g');
    p.ellV(8, 4, 5, 3, 'Wcr');
    p.set(6, 3, 'K');
  } else {
    // drawn: a flush brass cap with a gold ring (open)
    p.box(3, 22, 10, 4, 'uoy');
    p.rect(4, 22, 8, 1, 'g');
  }
  return p;
}

function key(): P {
  const p = new P(26, 12);
  // bow (ring)
  p.ellV(5, 6, 5, 5, 'udyg');
  for (let y = 4; y <= 8; y++) for (let x = 3; x <= 7; x++) if ((x - 5) ** 2 + (y - 6) ** 2 <= 4) p.clear(x, y);
  // shaft + bitting
  p.box(10, 5, 15, 3, 'udy');
  for (const [x, d] of [[13, 2], [16, 3], [19, 1], [22, 3]]) p.rect(x, 8, 2, d, 'u');
  return p;
}

function numeral(): P {
  const p = new P(10, 10);
  p.ellV(5, 5, 4.5, 4.5, 'udyg');
  p.rect(4, 2, 2, 6, 'x');
  p.set(3, 3, 'x');
  return p;
}

function gear(f: number): P {
  const p = new P(16, 16);
  p.ellV(8, 8, 5.5, 5.5, 'stam');
  for (let k = 0; k < 8; k++) {
    const a = (k * Math.PI) / 4 + (f ? Math.PI / 8 : 0);
    const x = 8 + Math.cos(a) * 6.5, y = 8 + Math.sin(a) * 6.5;
    p.rect(Math.round(x - 1), Math.round(y - 1), 2, 2, 'a');
  }
  p.ellV(8, 8, 2, 2, 'xx');
  return p;
}

function hook(): P {
  const p = new P(12, 12);
  p.line(2, 10, 2, 3, 's').line(3, 10, 3, 3, 'a');
  p.line(3, 2, 8, 2, 'a').line(9, 3, 9, 6, 'a').line(8, 7, 7, 7, 'a');
  p.set(8, 7, 'r');
  return p;
}

/** The combination dial: brass rim, dark face, 12 ticks (the numbers are upright text orbiting on top). */
function dial(): P {
  const p = new P(62, 62);
  p.ellV(31, 31, 30, 30, 'udyg');
  p.ellV(31, 31, 26, 26, 'xNh');
  for (let k = 0; k < 12; k++) {
    const a = (k * Math.PI) / 6;
    p.set(31 + Math.sin(a) * 28, 31 - Math.cos(a) * 28, k % 3 === 0 ? 'e' : 'u');
  }
  p.ellV(31, 31, 6, 6, 'uoy');
  p.ellV(31, 31, 2, 2, 'xx');
  return p;
}

export function registerTumblarArt(scene: Phaser.Scene): void {
  sheet(scene, 'tumblar', POSES.map((o) => door(o, 1)), ANIMS);
  sheet(scene, 'tumblar-p2', POSES.map((o) => door(o, 2)), ANIMS);
  sheet(scene, 'tumblar-p3', POSES.map((o) => door(o, 3)), ANIMS);
  sheet(scene, 'tumblar-pin', [pin('plain'), pin('set'), pin('spool'), pin('false'), pin('spoolset')], []);
  sheet(scene, 'tumblar-bolt', [bolt(true), bolt(false)], []);
  sheet(scene, 'tumblar-key', [key()], []);
  sheet(scene, 'tumblar-num', [numeral()], []);
  sheet(scene, 'tumblar-gear', [gear(0), gear(1)], [['spin', [0, 1], 12]]);
  sheet(scene, 'tumblar-hook', [hook()], []);
  sheet(scene, 'tumblar-dial', [dial()], []);
}
