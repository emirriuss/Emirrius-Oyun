import Phaser from 'phaser';
import { P, sheet } from './enemies';

// ============================================================================
// CANTOR, THE TOLLING BELL — a floating bronze bell from a drowned clock tower.
// Its waist carries a clock dial (the "face": one minute hand that ticks with the beat),
// a yoke with a broken chain on top, and an iron clapper swinging below the rim.
// Grid 40x46 (frame 42x48), art faces right, body ~28x32 bottom-centred above the clapper.
// Three sheets, identical frame layout / anim names:
//   'cantor'     P1 Prime: polished bronze, cream dial
//   'cantor-p2'  P2 Terce: verdigris blooms, amber dial
//   'cantor-p3'  P3 Vespers: cracked through, pink glow in the cracks, red dial
// Frames: 0-1 idle (sway), 2 windup (rears back), 3 strike (lunges, clapper out),
//         4 slam (squashed, rim on the floor), 5 dizzy (tipped, punish), 6 stun, 7 roar
// Anims '<sheet>-<name>': idle (loop) | windup strike slam dizzy stun roar (single)
// Extra textures:
//   'cantor-clapper' 10x18 falling clapper   'cantor-minibell' 16x16 peal bell (frame 0 rest, 1 struck)
// ============================================================================

interface Pose {
  /** top shear (px, + = forward) */
  lean?: number;
  /** body drop */
  dy?: number;
  /** vertical squash (px taken off the top) */
  squash?: number;
  /** clapper x offset under the rim */
  clap?: number;
  /** dial hand angle (radians, 0 = 12 o'clock) */
  hand?: number;
  /** dial colour override */
  glow?: boolean;
  /** stun: X'd dial */
  stun?: boolean;
}

const W = 40;
const H = 46;

function bell(o: Pose, ph: 1 | 2 | 3): P {
  const p = new P(W, H);
  const lean = o.lean ?? 0;
  const dy = o.dy ?? 0;
  const top = 8 + dy + (o.squash ?? 0);
  const rim = 38 + dy;
  const span = rim - top;
  const cxAt = (y: number) => 20 + lean * (1 - (y - top) / span);
  const half = (y: number) => {
    const t = (y - top) / span;
    return 6.5 + 5 * t + 6.5 * t ** 4;
  };
  const metal = ph === 1 ? 'uoyg' : ph === 2 ? 'uoyd' : 'Wuoy';

  // ---- yoke + broken chain (behind the body top)
  const yx = cxAt(top);
  p.box(Math.round(yx - 4), top - 5, 8, 5, 'nsta');
  p.set(Math.round(yx), top - 6, 'a').set(Math.round(yx), top - 7, 's').set(Math.round(yx) + 1, top - 8, 'a');

  // ---- clapper (hangs under the rim)
  const kx = 20 + (o.clap ?? 0);
  p.line(20, rim - 4, kx, rim + 3, 'n');
  p.ellV(kx, rim + 4, 3, 3, 'nsa');

  // ---- body
  p.shape((x, y) => {
    if (y < top || y > rim) return false;
    const h = half(y + 0.5) + (y >= rim - 1 ? 1 : 0);
    return Math.abs(x + 0.5 - cxAt(y + 0.5)) <= h;
  }, metal);
  // mouth shadow under the rim lip
  for (let x = 0; x < W; x++) if (p.get(x, rim) !== '.' && Math.abs(x + 0.5 - 20) < half(rim) - 2) p.set(x, rim, 'n');
  // two raised bands
  for (const f of [0.18, 0.86]) {
    const y = Math.round(top + span * f);
    const hw = half(y + 0.5);
    const c = cxAt(y);
    p.line(Math.round(c - hw + 1), y, Math.round(c + hw - 1), y, ph === 1 ? 'g' : 'y');
  }

  // ---- verdigris / cracks
  if (ph >= 2) {
    const blooms: [number, number][] = [[-6, 0.35], [5, 0.6], [-2, 0.75], [7, 0.3]];
    for (const [ox, f] of blooms) {
      const y = Math.round(top + span * f);
      const x = Math.round(cxAt(y) + ox);
      p.set(x, y, 'T').set(x + 1, y, 'M').set(x, y + 1, 'T');
    }
  }
  if (ph === 3) {
    const y0 = top + 2;
    const pts: [number, number][] = [[cxAt(y0) - 2, y0], [cxAt(y0 + 7) + 1, y0 + 7], [cxAt(y0 + 12) - 3, y0 + 12], [cxAt(y0 + 20) - 1, y0 + 20], [cxAt(y0 + 26) - 4, y0 + 26]];
    for (let i = 0; i < pts.length - 1; i++) p.line(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], 'K');
    for (const [x, y] of pts) p.set(x + 1, y, 'x');
  }

  // ---- clock dial
  const dyc = Math.round(top + span * 0.5);
  const dxc = cxAt(dyc) + 1.5;
  const face = o.glow ? 'K' : ph === 1 ? 'e' : ph === 2 ? 'y' : 'r';
  p.ellV(dxc, dyc, 5.5, 5.5, 'n' + face + face);
  // hour ticks
  for (let k = 0; k < 4; k++) {
    const a = (k * Math.PI) / 2;
    p.set(dxc + Math.sin(a) * 4.2, dyc - Math.cos(a) * 4.2, 'x');
  }
  if (o.stun) {
    p.line(dxc - 2, dyc - 2, dxc + 2, dyc + 2, 'x').line(dxc - 2, dyc + 2, dxc + 2, dyc - 2, 'x');
  } else {
    const a = o.hand ?? 0;
    p.line(dxc, dyc, dxc + Math.sin(a) * 4, dyc - Math.cos(a) * 4, 'x');
    p.set(dxc, dyc, ph === 3 ? 'K' : 'c');
  }
  return p;
}

const POSES: Pose[] = [
  { hand: 0 }, // 0 idle
  { hand: Math.PI / 2, lean: 1, clap: 1, dy: 1 }, // 1 idle sway
  { lean: -4, clap: -3, hand: -Math.PI / 3, dy: -2 }, // 2 windup
  { lean: 5, clap: 5, hand: Math.PI / 3 }, // 3 strike
  { squash: 6, dy: 2, clap: 0, hand: Math.PI }, // 4 slam
  { lean: 7, dy: 2, clap: 6, hand: Math.PI * 0.75 }, // 5 dizzy (tipped)
  { lean: -2, stun: true, clap: -2 }, // 6 stun
  { glow: true, lean: 0, clap: 4, hand: Math.PI * 1.5, dy: -1 }, // 7 roar
];

const ANIMS: [string, number[], number, number?][] = [
  ['idle', [0, 1], 3],
  ['windup', [2], 1, 0],
  ['strike', [3], 1, 0],
  ['slam', [4], 1, 0],
  ['dizzy', [5], 1, 0],
  ['stun', [6], 1, 0],
  ['roar', [7], 1, 0],
];

function clapper(): P {
  const p = new P(10, 18);
  p.box(4, 0, 2, 11, 'nsa');
  p.ellV(5, 13, 4, 4, 'nsam');
  return p;
}

function minibell(struck: boolean): P {
  const p = new P(16, 16);
  p.box(6, 0, 4, 2, 'nst');
  p.shape((x, y) => {
    if (y < 2 || y > 12) return false;
    const t = (y - 2) / 10;
    return Math.abs(x + 0.5 - 8) <= 3 + 2.5 * t + 2 * t ** 4;
  }, struck ? 'oygd' : 'uoyg');
  p.ellV(8 + (struck ? 2 : 0), 14, 1.6, 1.6, 'nsa');
  return p;
}

export function registerCantorArt(scene: Phaser.Scene): void {
  sheet(scene, 'cantor', POSES.map((o) => bell(o, 1)), ANIMS);
  sheet(scene, 'cantor-p2', POSES.map((o) => bell(o, 2)), ANIMS);
  sheet(scene, 'cantor-p3', POSES.map((o) => bell(o, 3)), ANIMS);
  sheet(scene, 'cantor-clapper', [clapper()], []);
  sheet(scene, 'cantor-minibell', [minibell(false), minibell(true)], []);
}
