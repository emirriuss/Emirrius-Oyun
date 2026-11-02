import Phaser from 'phaser';
import { P, sheet } from './enemies';
import { registerWardenArt } from './warden';
import { registerMothArt } from './moth';
import { registerAurrenArt } from './aurren';
import { registerFromageArt } from './fromage';
import { registerCroupierArt } from './croupier';
import { registerErratumArt } from './erratum';
import { registerColossusArt } from './colossus';
import { registerCantorArt } from './cantor';
import { registerTumblarArt } from './tumblar';
import { registerUmbraArt } from './umbra';

// shared painter helpers for boss art modules (warden.ts / moth.ts)
export { P, sheet };

// ============================================================================
// Boss art (owner: Agent B). Painted with the shared enemy painter `P`.
// ============================================================================

/** Thick limb: union of discs along a segment, shaded with a ramp. */
export function limb(p: P, x0: number, y0: number, x1: number, y1: number, r: number, ramp: string): void {
  const dx = x1 - x0, dy = y1 - y0, len2 = dx * dx + dy * dy || 1;
  p.shape((x, y) => {
    const px = x + 0.5, py = y + 0.5;
    const t = Math.max(0, Math.min(1, ((px - x0) * dx + (py - y0) * dy) / len2));
    const cx = x0 + t * dx, cy = y0 + t * dy;
    return (px - cx) ** 2 + (py - cy) ** 2 <= r * r;
  }, ramp);
}

// ============================================================================
// GOLEM — cracked stone colossus with a pulsing gold core.
// Grid 46x50 (frame 48x52). Body 36x42 bottom-centred.
// ============================================================================
type GArm = 'down' | 'back' | 'forward' | 'up' | 'slam';
interface GolemPose { bob?: number; legs?: [number, number]; lift?: [number, number]; lean?: number; arm?: GArm; crouch?: number; core?: number; hot?: boolean; stun?: boolean }

function golem(o: GolemPose): P {
  const p = new P(46, 50);
  const stone = 'stam';
  const dark = 'nstt';
  const by = (o.bob ?? 0) + (o.crouch ?? 0);
  const lean = o.lean ?? 0;
  const [la, lb] = o.legs ?? [0, 0];
  const [lfa, lfb] = o.lift ?? [0, 0];
  const arm = o.arm ?? 'down';
  const vein = o.hot ? 'o' : 'y';
  const fistR = 5;

  // ---- back arm (behind everything)
  const bsx = 12 + lean, bsy = 20 + by;
  const backFist: Record<GArm, [number, number]> = { down: [8, 37], back: [6, 34], forward: [10, 34], up: [12, 5], slam: [5, 44] };
  const [bfx, bfy] = backFist[arm];
  limb(p, bsx, bsy, bfx + lean * (arm === 'slam' ? 0 : 1), bfy + (arm === 'up' || arm === 'slam' ? 0 : by), 3.6, dark);
  p.ellV(bfx + lean * (arm === 'slam' ? 0 : 1), bfy + (arm === 'up' || arm === 'slam' ? 0 : by), fistR - 0.5, fistR - 0.5, dark);

  // ---- legs
  const leg = (x: number, lift: number, ramp: string) => {
    p.box(x, 38 + Math.min(by, 2), 8, 10 - lift - Math.min(by, 2), ramp);
    p.box(x - 1, 46 - lift, 10, 4, ramp);
    p.line(x, 46 - lift, x + 8, 46 - lift, ramp[0]);
  };
  leg(12 + la, lfa, dark);
  leg(25 + lb, lfb, stone);

  // ---- torso
  const tx = 22 + lean, ty = 27 + by;
  p.ellV(tx, ty, 14.5, 12.5, stone + 'w');
  // moss on the shoulders / top
  for (let x = 0; x < 46; x++) {
    let top = -1;
    for (let y = 0; y < 50; y++) if (p.get(x, y) !== '.' && Math.abs(x + 0.5 - tx) < 12) { top = y; break; }
    if (top < 0 || top > ty - 6) continue;
    p.set(x, top, x % 3 === 0 ? 'L' : 'M');
    if (x % 4 !== 1) p.set(x, top + 1, 'M');
    if (x % 5 === 2) p.set(x, top + 2, 'P');
  }
  // belly plate seam
  p.line(tx - 11, ty + 7, tx + 11, ty + 7, 's');
  // cracks
  p.line(tx - 8, ty - 7, tx - 6, ty - 2, 'n').line(tx - 6, ty - 2, tx - 8, ty + 3, 'n').line(tx - 8, ty + 3, tx - 6, ty + 6, 'n');
  p.line(tx + 8, ty + 4, tx + 11, ty + 9, 'n').line(tx + 9, ty + 6, tx + 7, ty + 9, 'n');
  p.line(tx - 3, ty + 8, tx - 1, ty + 11, 'n');
  // core socket + veins
  const cx = tx - 1, cy = ty - 1;
  const cr = [3.6, 4.2, 4.6][o.core ?? 1];
  p.ellV(cx, cy, cr + 1.3, cr + 1.3, 'nnn');
  p.line(cx - 4, cy + 1, tx - 6, ty - 2, vein).line(cx + 2, cy + 4, tx + 6, ty + 6, vein).line(cx - 1, cy - 4, cx - 3, cy - 8, vein);
  p.ellV(cx, cy, cr, cr, o.stun ? 'oyyg' : o.hot ? 'ygww' : 'oyge');
  // ---- head (sunk between shoulders)
  const hx = 30 + lean + (arm === 'up' ? -1 : 0), hy = 13 + by + (o.stun ? 2 : 0);
  p.ellV(hx, hy, 6, 5.5, stone + 'w');
  p.box(hx - 4, hy, 9, 4, stone);
  p.line(hx - 3, hy - 1, hx + 5, hy - 1, 'n'); // brow ridge
  p.line(hx - 2, hy - 2, hx + 4, hy - 2, 's');
  if (o.stun) {
    p.set(hx + 1, hy + 1, 'o').set(hx + 3, hy + 1, 'o');
  } else {
    p.rect(hx + 1, hy, 2, 2, o.hot ? 'w' : 'g').rect(hx + 4, hy, 1, 2, o.hot ? 'w' : 'g');
    p.set(hx + 1, hy, 'w');
  }
  p.line(hx - 1, hy + 3, hx + 4, hy + 3, 'n'); // jaw seam
  p.set(hx - 4, hy - 4, 'M').set(hx - 3, hy - 5, 'L').set(hx - 2, hy - 5, 'M');

  // ---- front arm
  const fsx = 31 + lean, fsy = 21 + by;
  const frontFist: Record<GArm, [number, number]> = { down: [36, 37], back: [15, 24], forward: [41, 24], up: [35, 5], slam: [40, 44] };
  let [ffx, ffy] = frontFist[arm];
  if (arm !== 'up' && arm !== 'slam') ffy += by;
  if (arm !== 'slam' && arm !== 'back') ffx += lean;
  // dark separation rim so the arm reads against the torso
  limb(p, fsx, fsy + 2, ffx, ffy, 4.8, 'nnn');
  p.ellV(ffx, ffy, fistR + 1, fistR + 1, 'nnn');
  p.ellV(fsx, fsy, 5, 4.5, stone); // shoulder boulder
  limb(p, fsx, fsy, ffx, ffy, 3.8, stone);
  p.ellV(ffx, ffy, fistR, fistR, stone + 'w');
  // knuckle lines
  p.line(ffx - 2, ffy + 1, ffx + 2, ffy + 1, 's');
  p.set(ffx + 1, ffy - 2, 'n');
  // shoulder crack + vein
  p.line(fsx - 1, fsy - 3, fsx + 1, fsy + 1, 'n').set(fsx, fsy - 1, vein);
  return p;
}

function registerGolem(scene: Phaser.Scene): void {
  const f = [
    golem({ core: 0 }), golem({ core: 2, bob: 1 }),                                                   // 0-1 idle
    golem({ legs: [-2, 2], lift: [0, 2] }), golem({ bob: 1 }), golem({ legs: [2, -2], lift: [2, 0] }), golem({ bob: 1 }), // 2-5 walk
    golem({ arm: 'back', lean: -2, hot: true, core: 2, legs: [-1, 1] }),                             // 6 punch wind-up
    golem({ arm: 'forward', lean: 2, hot: true, core: 1, legs: [-2, 2] }),                           // 7 punch
    golem({ arm: 'up', crouch: 3, hot: true, core: 2 }),                                             // 8 crouch / raise
    golem({ arm: 'up', bob: -1, lift: [3, 3], core: 1 }),                                            // 9 air
    golem({ arm: 'slam', crouch: 4, hot: true, core: 2, legs: [-2, 2] }),                            // 10 slam
    golem({ stun: true, crouch: 2, core: 0, lean: -1 }),                                             // 11 stunned
  ];
  sheet(scene, 'golem', f, [
    ['idle', [0, 1], 2], ['move', [2, 3, 4, 5], 5], ['windup', [6], 1], ['punch', [7], 1],
    ['crouch', [8], 1], ['air', [9], 1], ['slam', [10], 1], ['stun', [11], 1],
  ]);
}

// ============================================================================
// DUELIST — crimson/white twin-blade swordsman with cape.
// Grid 24x26 (frame 26x28). Body 12x22. Shadow = dark palette swap sheet.
// ============================================================================
type DPose = 'idle0' | 'idle1' | 'run0' | 'run1' | 'run2' | 'run3' | 'windup' | 'dash' | 'throw' | 'blink' | 'air' | 'hurt'
  | 'sheathe' | 'draw' | 'guard' | 'rise' | 'plunge' | 'stuck';
/** `twin` = second blade drawn (P2+ and the shadow); otherwise it rides sheathed on the hip. */
function duelist(pose: DPose, twin = true): P {
  const p = new P(24, 26);
  const coat = 'amw';
  const cape = 'Wcr';
  const run = pose.startsWith('run');
  const lean = pose === 'dash' || pose === 'draw' ? 2 : pose === 'hurt' ? -1 : run || pose === 'stuck' ? 1 : 0;
  const crouch = pose === 'windup' || pose === 'sheathe' ? 2 : pose === 'stuck' ? 3 : pose === 'dash' || pose === 'draw' || pose === 'guard' ? 1 : 0;
  const airy = pose === 'air' || pose === 'rise' || pose === 'plunge';
  const bob = (pose === 'idle1' || pose === 'run1' || pose === 'run3' ? 1 : 0) + crouch + (airy ? -1 : 0);
  const sx = 11 + lean; // shoulder/torso anchor
  // ---- cape (behind)
  const hem: Record<string, [number, number, number, number]> = {
    idle0: [4, 23, 9, 24], idle1: [3, 22, 9, 24], run: [1, 18, 6, 21], dash: [-1, 12, 3, 16], windup: [3, 21, 8, 23], air: [2, 15, 7, 19], hurt: [5, 22, 10, 24],
  };
  const HK: Partial<Record<DPose, string>> = { throw: 'idle1', blink: 'idle0', sheathe: 'windup', guard: 'windup', stuck: 'windup', draw: 'dash', rise: 'air', plunge: 'air' };
  const hk = run ? 'run' : HK[pose] ?? pose;
  const [h1x, h1y, h2x, h2y] = hem[hk] ?? hem.idle0;
  p.poly([[sx - 2, 8 + bob], [sx + 1, 8 + bob], [h2x + lean * 0.5, h2y], [h1x, h1y]], cape);
  // ---- back blade
  const blade = (x0: number, y0: number, x1: number, y1: number, front: boolean) => {
    p.line(x0, y0, x1, y1, front ? 'I' : 'a');
    p.set(x1, y1, 'w');
    p.set(x0, y0, 'c');
  };
  if (!twin) {
    // scabbard on the hip: dark sheath, red-wrapped hilt
    p.line(sx - 1, 16 + bob, sx - 8, 19 + bob, 'n').line(sx - 1, 15 + bob, sx - 8, 18 + bob, 'a');
    p.set(sx, 15 + bob, 'c').set(sx + 1, 15 + bob, 'r');
  } else if (pose === 'guard') blade(sx + 1, 6 + bob, sx + 9, 17 + bob, false);
  else if (pose === 'sheathe' || pose === 'stuck') blade(sx - 3, 14 + bob, sx - 9, 17 + bob, false);
  else if (pose === 'draw') blade(sx - 2, 13 + bob, sx - 9, 11 + bob, false);
  else if (pose === 'rise' || pose === 'plunge') blade(sx - 3, 12 + bob, sx - 9, 9 + bob, false);
  else if (pose === 'windup') blade(sx - 3, 13 + bob, sx - 9, 15 + bob, false);
  else if (pose === 'dash') blade(sx - 2, 13 + bob, sx - 9, 10 + bob, false);
  else if (pose === 'air') blade(sx - 3, 12 + bob, sx - 9, 9 + bob, false);
  else blade(sx - 2, 14 + bob, sx - 6, 20 + bob, false);
  // ---- legs
  const legs: Record<string, [number, number, number, number]> = {
    idle0: [9, 25, 14, 25], idle1: [9, 25, 14, 25], run0: [7, 25, 16, 24], run1: [10, 25, 13, 24], run2: [15, 25, 9, 24], run3: [12, 25, 11, 24],
    windup: [7, 25, 15, 25], dash: [6, 25, 18, 25], throw: [9, 25, 14, 25], blink: [9, 25, 14, 25], air: [8, 22, 14, 21], hurt: [8, 25, 13, 25],
    sheathe: [6, 25, 16, 25], draw: [5, 25, 19, 25], guard: [7, 25, 15, 25], rise: [9, 23, 13, 24], plunge: [8, 21, 14, 21], stuck: [6, 25, 17, 25],
  };
  const [bfx, bfy, ffx, ffy] = legs[pose];
  const hipY = 18 + bob;
  limb(p, sx - 1, hipY, bfx, bfy - 1, 1.2, 'nss');
  limb(p, sx + 1.5, hipY, ffx, ffy - 1, 1.2, 'nst');
  p.rect(bfx - 1, bfy - 1, 3, 1, 'x').rect(ffx - 1, ffy - 1, 3, 1, 'x');
  // ---- torso / coat
  p.box(sx - 2, 9 + bob, 7, 8, coat);
  p.poly([[sx - 2.5, 15 + bob], [sx + 5, 15 + bob], [sx + 5.5 - lean * 0.5, 20 + bob], [sx - 3.5 - lean * 0.5, 20 + bob]], coat);
  p.line(sx - 2, 10 + bob, sx + 3, 15 + bob, 'c').line(sx - 1, 10 + bob, sx + 4, 15 + bob, 'r'); // sash
  p.line(sx - 2, 16 + bob, sx + 4, 16 + bob, 'c');
  p.set(sx + 2, 16 + bob, 'g');
  // ---- head
  const hx = sx + 1, hy = 5 + bob;
  p.ellV(hx + 0.5, hy + 0.5, 3.3, 3.4, 'dde');
  for (let y = hy - 3; y <= hy + 3; y++)
    for (let x = hx - 3; x <= hx + 4; x++) {
      if (p.get(x, y) === '.') continue;
      if (y < hy - 0.5 || x < hx - 0.5) p.set(x, y, y < hy - 2 || x < hx - 2 ? 'n' : 's');
    }
  p.set(hx - 1, hy - 4, 'n').set(hx + 1, hy - 4, 'n').set(hx - 3, hy - 3, 'n'); // spiky hair
  // headband + tails
  p.line(hx - 3, hy - 1, hx + 3, hy - 1, 'r');
  const tail = run || pose === 'dash' ? [[hx - 4, hy - 1], [hx - 5, hy - 1], [hx - 6, hy - 2], [hx - 7, hy - 2]] : [[hx - 4, hy], [hx - 5, hy + 1], [hx - 5, hy + 2]];
  for (const [x, y] of tail) p.set(x, y, 'c');
  if (pose === 'hurt') p.set(hx + 2, hy + 1, 'x').set(hx + 3, hy + 1, 'x');
  else p.set(hx + 2, hy + 1, 'n').set(hx + 3, hy + 1, 'e');
  // ---- front arm + blade
  if (pose === 'sheathe') {
    // hand on the hilt of a sheathed blade; a glint on the guard
    limb(p, sx + 2, 11 + bob, sx + 3, 15 + bob, 1, coat);
    p.line(sx + 3, 16 + bob, sx - 6, 20 + bob, 'n').line(sx + 3, 15 + bob, sx - 6, 19 + bob, 'a');
    p.set(sx + 4, 15 + bob, 'c').set(sx + 5, 14 + bob, 'w');
  } else if (pose === 'draw') {
    // full extension: the cut has already happened
    limb(p, sx + 2, 11 + bob, sx + 7, 11 + bob, 1, coat);
    p.line(sx + 8, 11 + bob, 23, 10 + bob, 'I').set(23, 10 + bob, 'w').set(sx + 8, 11 + bob, 'c');
    p.line(sx + 9, 13 + bob, 22, 13 + bob, 'w');
  } else if (pose === 'guard') {
    // blades crossed in front: an X
    limb(p, sx + 2, 11 + bob, sx + 5, 12 + bob, 1, coat);
    blade(sx + 6, 17 + bob, sx + 8, 4 + bob, true);
  } else if (pose === 'rise') {
    limb(p, sx + 2, 11 + bob, sx + 4, 6 + bob, 1, coat);
    blade(sx + 4, 6 + bob, sx + 6, 0, true);
    p.set(sx + 7, 2, 'w').set(sx + 3, 1, 'w');
  } else if (pose === 'plunge') {
    limb(p, sx + 2, 11 + bob, sx + 4, 15 + bob, 1, coat);
    blade(sx + 4, 15 + bob, sx + 4, 25, true);
  } else if (pose === 'stuck') {
    // blade driven into the floor, both hands on it
    limb(p, sx + 2, 11 + bob, sx + 5, 17 + bob, 1, coat);
    blade(sx + 5, 17 + bob, sx + 7, 25, true);
    p.set(sx + 4, 25, 'w').set(sx + 9, 25, 'w');
  } else if (pose === 'windup') {
    limb(p, sx + 2, 11 + bob, sx - 2, 13 + bob, 1, coat);
    blade(sx - 3, 12 + bob, sx - 10, 9 + bob, true);
  } else if (pose === 'dash') {
    limb(p, sx + 2, 11 + bob, sx + 6, 12 + bob, 1, coat);
    blade(sx + 7, 12 + bob, sx + 13, 11 + bob, true);
    p.set(sx + 12, 9 + bob, 'w').set(sx + 9, 14 + bob, 'w');
  } else if (pose === 'throw') {
    limb(p, sx + 2, 11 + bob, sx + 7, 8 + bob, 1, coat);
    p.set(sx + 8, 7 + bob, 'd');
    p.set(sx + 10, 5 + bob, 'I').set(sx + 11, 4 + bob, 'w');
  } else if (pose === 'air') {
    limb(p, sx + 2, 11 + bob, sx + 6, 10 + bob, 1, coat);
    blade(sx + 6, 10 + bob, sx + 11, 6 + bob, true);
  } else {
    limb(p, sx + 2, 11 + bob, sx + 4, 14 + bob, 1, coat);
    blade(sx + 4, 15 + bob, sx + 9, 20 + bob, true);
  }
  if (pose === 'blink') {
    // dissolve: drop alternating rows, scatter sparks
    for (let y = 0; y < 26; y++)
      for (let x = 0; x < 24; x++) if (y % 2 === 0 || (x * 7 + y * 3) % 3 === 0) p.clear(x, y);
    for (const [x, y] of [[4, 6], [19, 9], [6, 18], [18, 21], [12, 1]]) p.set(x, y, 'r');
  }
  return p;
}

const SHADOW_SWAP: Record<string, string> = {
  a: 'h', m: 'H', w: 'j', W: 'z', c: 'V', r: 'p', d: 'H', e: 'j', n: 'z', s: 'Z', t: 'h', I: 'K', g: 'G', x: 'z',
};

function registerDuelist(scene: Phaser.Scene): void {
  const poses: DPose[] = ['idle0', 'idle1', 'run0', 'run1', 'run2', 'run3', 'windup', 'dash', 'throw', 'blink', 'air', 'hurt',
    'sheathe', 'draw', 'guard', 'rise', 'plunge', 'stuck'];
  const anims: [string, number[], number, number?][] = [
    ['idle', [0, 1], 3], ['run', [2, 3, 4, 5], 10], ['windup', [6], 1], ['dash', [7], 1], ['throw', [8], 1],
    ['blink', [9, 0], 10], ['air', [10], 1], ['hurt', [11], 1],
    ['sheathe', [12], 1], ['draw', [13], 1], ['guard', [14], 1], ['rise', [15], 1], ['plunge', [16], 1], ['stuck', [17], 1],
  ];
  sheet(scene, 'duelist', poses.map((ps) => duelist(ps)), anims);
  // P1: second blade still sheathed
  sheet(scene, 'duelist-one', poses.map((ps) => duelist(ps, false)), anims);
  // Cross Cut wave: a spinning white/crimson X
  sheet(scene, 'duelist-x', [0, 1].map((k) => {
    const x = new P(14, 14);
    const a = k ? 'w' : 'I', b = k ? 'I' : 'w';
    x.line(1, 1, 12, 12, a).line(1, 12, 12, 1, b).line(2, 1, 12, 11, 'r').line(1, 11, 11, 1, 'r');
    x.set(6, 6, 'w').set(7, 7, 'w');
    return x;
  }), [['fly', [0, 1], 12]]);
  sheet(scene, 'duelist-shadow', poses.map((ps) => {
    const p = duelist(ps).swap(SHADOW_SWAP);
    // glowing eye
    for (let y = 0; y < 26; y++) for (let x = 0; x < 24; x++) if (p.get(x, y) === 'z' && p.get(x - 1, y) === 'H' && p.get(x + 1, y) === 'j') p.set(x + 1, y, 'K');
    return p;
  }), anims);
}

// ============================================================================
// KING — floating hollow king with crown and robe. Grid 32x42 (frame 34x44).
// Body 26x34. Phase sheets: king / king-p2 / king-p3.
// ============================================================================
type KPose = 'float0' | 'float1' | 'float2' | 'float3' | 'cast0' | 'cast1' | 'dive' | 'slump' | 'stun';
interface KPal { robe: string; lining: string; trim: string; eye: string; eyeHi: string; orb: string }
const KING_PAL: Record<1 | 2 | 3, KPal> = {
  1: { robe: 'hVp', lining: 'Wc', trim: 'yg', eye: 'G', eyeHi: 'K', orb: 'GKw' },
  2: { robe: 'VpK', lining: 'Wc', trim: 'yg', eye: 'o', eyeHi: 'g', orb: 'oyg' },
  3: { robe: 'zZh', lining: 'WG', trim: 'GK', eye: 'Q', eyeHi: 'w', orb: 'TQw' },
};

function king(pose: KPose, pal: KPal): P {
  const p = new P(32, 42);
  const fl = pose.startsWith('float') ? Number(pose[5]) : 0;
  const slump = pose === 'slump';
  const dive = pose === 'dive';
  const cast = pose.startsWith('cast');
  const by = (fl === 1 || fl === 2 ? 1 : 0) + (slump ? 5 : 0) + (cast ? -1 : 0);
  const lean = dive ? 3 : 0;
  const [rd, rm, rl] = pal.robe;
  // ---- scepter (behind, float/stun only)
  if (pose.startsWith('float') || pose === 'stun') {
    p.line(7, 20 + by, 7, 38, 'y').line(8, 20 + by, 8, 38, 'o');
    p.ellV(7.5, 18 + by, 2.4, 2.4, pal.orb);
    p.set(6, 16 + by, 'g').set(9, 16 + by, 'g');
  }
  // ---- robe
  const hemL = slump ? 1 : dive ? 0 : 4, hemR = slump ? 31 : dive ? 25 : 28;
  p.poly([[10 + lean, 14 + by], [22 + lean, 14 + by], [hemR, 39], [hemL, 39]], pal.robe);
  // tattered hem
  for (let x = hemL; x < hemR; x++) {
    const k = (x + fl * 2) % 5;
    const len = k < 2 ? 2 : (x + fl) % 3 === 0 ? 1 : 0;
    for (let i = 0; i < len; i++) p.set(x, 39 + i, i ? rd : rm);
  }
  if (dive) for (let i = 0; i < 4; i++) p.set(hemL + i * 2, 38 - i * 3, rd).set(hemL + i * 2 - 1, 38 - i * 3, rd); // streaming back
  // folds
  p.line(12 + lean, 20 + by, 9, 38, rd).line(15 + lean, 22 + by, 14, 38, rd);
  p.line(13 + lean, 20 + by, 11, 36, rl);
  // front opening with lining + gold trim
  p.poly([[18 + lean, 17 + by], [21 + lean, 17 + by], [hemR - 3, 39], [hemR - 9, 39]], pal.lining + pal.lining[1]);
  p.line(18 + lean, 17 + by, hemR - 9, 39, pal.trim[1]).line(21 + lean, 17 + by, hemR - 3, 39, pal.trim[0]);
  p.line(hemL + 1, 39, hemR - 1, 39, pal.trim[0]);
  // ---- back sleeve
  if (cast) {
    p.poly([[10, 16 + by], [13, 18 + by], [6, 9 + by], [3, 11 + by]], pal.robe);
    p.ellV(4, 8 + by, 1.8, 1.8, 'amw');
  } else if (dive) {
    p.poly([[12 + lean, 16 + by], [14 + lean, 19 + by], [4, 24 + by], [3, 21 + by]], pal.robe);
    p.set(3, 23 + by, 'm').set(2, 22 + by, 'm');
  } else {
    p.poly([[10, 16 + by], [13, 17 + by], [11, 28 + by], [6, 28 + by]], pal.robe);
    p.rect(7, 28 + by, 2, 2, 'm').set(8, 27 + by, 'a');
  }
  // ---- fur collar
  p.ellV(16.5 + lean, 15.5 + by, 7.5, 2.6, 'amw');
  for (const dx of [-5, -2, 2, 5]) p.set(16 + lean + dx, 16 + by, 'x');
  // ---- head (void with burning eyes)
  const hx = 16.5 + lean + (slump ? 1 : 0), hy = 10 + by + (slump ? 2 : 0);
  p.ellV(hx, hy, 4.4, 4.6, 'zzZ');
  const eyesY = Math.round(hy) + (slump ? 1 : 0);
  if (pose === 'stun') {
    p.set(Math.round(hx) + 1, eyesY, 'w').set(Math.round(hx) + 3, eyesY, 'w');
  } else if (slump) {
    p.set(Math.round(hx) + 1, eyesY, pal.eye).set(Math.round(hx) + 3, eyesY, pal.eye);
  } else {
    const ex = Math.round(hx) + 1;
    p.rect(ex, eyesY, 1, 2, pal.eye).rect(ex + 2, eyesY, 1, 2, pal.eye);
    p.set(ex, eyesY, pal.eyeHi).set(ex + 2, eyesY, pal.eyeHi);
    if (cast) p.set(ex - 1, eyesY - 1, pal.eyeHi).set(ex + 3, eyesY - 1, pal.eyeHi);
  }
  // ---- crown
  const cxo = Math.round(hx) - 6 + (slump ? 2 : 0) + (pose === 'stun' ? 1 : 0);
  const cy = Math.round(hy) - 5 + (slump ? 1 : 0);
  const crown = slump
    ? ['......g.....', '..g..gyg....', '.gyg.gyyg.g.', 'gyyggyrygyyg', 'oyyyyyyyyyyo', '.oooooooooo.']
    : ['..g...g...g..', '.gyg.gyg.gyg.', '.gyygyQygyyg.', 'gyryyyyyyyryg', 'oyyyyyyyyyyyo', '.ooooooooooo.'];
  p.stamp(crown, cxo, cy - 4 + (slump ? 1 : 0));
  // ---- front sleeve + hand
  if (cast) {
    p.poly([[20 + lean, 16 + by], [23 + lean, 15 + by], [29, 8 + by], [26, 6 + by]], pal.robe);
    p.line(21, 16 + by, 27, 7 + by, pal.trim[0]);
    p.ellV(28, 5 + by, 1.9, 1.9, 'amw');
    const spark = pose === 'cast0' ? [[28, 2], [31, 5], [25, 3]] : [[30, 2], [27, 1], [31, 7]];
    for (const [x, y] of spark) p.set(x, y + by, pal.eyeHi);
    p.set(4, 5 + by, pal.eyeHi).set(1, 8 + by, pal.eyeHi);
  } else if (dive) {
    p.poly([[20 + lean, 16 + by], [23 + lean, 18 + by], [12, 26 + by], [10, 23 + by]], pal.robe);
    p.line(21 + lean, 17 + by, 11, 25 + by, pal.trim[0]);
  } else {
    const sy = slump ? 3 : 0;
    p.poly([[20, 16 + by], [23, 16 + by], [27, 27 + by + sy], [21, 28 + by + sy]], pal.robe);
    p.line(21, 27 + by + sy, 27, 26 + by + sy, pal.trim[0]);
    p.rect(23, 28 + by + sy, 2, 2, 'm').set(25, 29 + by + sy, 'a').set(22, 29 + by + sy, 'a');
  }
  return p;
}

function registerKing(scene: Phaser.Scene): void {
  const poses: KPose[] = ['float0', 'float1', 'float2', 'float3', 'cast0', 'cast1', 'dive', 'slump', 'stun'];
  const anims: [string, number[], number, number?][] = [
    ['float', [0, 1, 2, 3], 5], ['cast', [4, 5], 10], ['dive', [6], 1], ['exhausted', [7], 1], ['stun', [8], 1],
  ];
  for (const ph of [1, 2, 3] as const) sheet(scene, ph === 1 ? 'king' : `king-p${ph}`, poses.map((ps) => king(ps, KING_PAL[ph])), anims);
  // small orbiting orbs
  const orbit = (k: number, pal: string): P => {
    const p = new P(6, 6);
    p.ellV(3, 3, k ? 2.6 : 3, k ? 2.6 : 3, pal + 'w');
    p.set(2, 2, 'w');
    return p;
  };
  for (const ph of [1, 2, 3] as const) {
    const key = ph === 1 ? 'king-orbit' : `king-orbit-p${ph}`;
    sheet(scene, key, [orbit(0, KING_PAL[ph].orb), orbit(1, KING_PAL[ph].orb)], [['spin', [0, 1], 6]]);
  }
}

// ============================================================================
// BOSS PROJECTILES: blade (spinning), shockwave (rolling)
// ============================================================================
function registerBossProjectiles(scene: Phaser.Scene): void {
  // blade — grid 12x12 (frame 14x14), 4-frame spin
  const blade = (k: number): P => {
    const p = new P(12, 12);
    const a = (k * Math.PI) / 4;
    const ux = Math.cos(a), uy = Math.sin(a);
    const c = 5.5;
    p.line(c - ux * 5, c - uy * 5, c + ux * 5, c + uy * 5, 'I');
    p.line(c - ux * 4 - uy * 0.9, c - uy * 4 + ux * 0.9, c + ux * 4 - uy * 0.9, c + uy * 4 + ux * 0.9, 'a');
    p.set(c + ux * 5, c + uy * 5, 'w').set(c - ux * 5, c - uy * 5, 'w');
    p.set(c, c, 'c').set(c + 1, c, 'r');
    return p;
  };
  sheet(scene, 'blade', [0, 1, 2, 3].map(blade), [['fly', [0, 1, 2, 3], 18]]);

  // shockwave — grid 16x10 (frame 18x12), curling crest rolling right
  const W0 = ['..........gww...', '........ggyygw..', '.......gyyoyyg..', '......gyyo..oyg.', '.....gyyo....oy.', '....gyyyo.....o.', '...gyyyyo.......', '.ggyyyyyyo......', 'gyyyyyyyyyo.....', 'oooooooooooo....'];
  const W1 = ['...........gww..', '.........ggyygw.', '........gyyoyyg.', '.......gyyo..oyg', '......gyyo....oy', '.....gyyyo.....o', '...ggyyyyo......', '.ggyyyyyyyo.....', 'gyyyyyyyyyyo....', 'ooooooooooooo...'];
  const W3 = ['................', '.........gwwg...', '........gyyyyg..', '.......gyyooyyg.', '.....ggyyo..oyg.', '....gyyyo....oy.', '...gyyyyo.....o.', '.ggyyyyyyo......', 'gyyyyyyyyyo.....', 'oooooooooooo....'];
  const wave = (k: number): P => {
    const p = new P(16, 10);
    p.stamp([W0, W1, W0, W3][k], 0, 0);
    const foam = [[[4, 6], [7, 4]], [[2, 7], [9, 4]], [[5, 6], [1, 7]], [[3, 7], [8, 3]]][k];
    for (const [x, y] of foam) p.set(x, y, 'e');
    return p;
  };
  sheet(scene, 'shockwave', [0, 1, 2, 3].map(wave), [['fly', [0, 1, 2, 3], 14]]);
}

// ============================================================================
// DIZZY STARS — 3 stars circling over a boss head during a recover() window.
// Grid 20x8 (frame 22x10), 4-frame loop. Played as 'dizzy-stars-spin'.
// ============================================================================
function registerDizzyStars(scene: Phaser.Scene): void {
  const frame = (k: number): P => {
    const p = new P(20, 8);
    for (let i = 0; i < 3; i++) {
      const a = ((k / 4 + i / 3) % 1) * Math.PI * 2;
      const x = 10 + Math.cos(a) * 7.5;
      const y = 4 + Math.sin(a) * 2;
      const front = Math.sin(a) > 0;
      const c = front ? 'g' : 'y';
      p.set(x, y, front ? 'w' : 'g').set(x - 1, y, c).set(x + 1, y, c).set(x, y - 1, c).set(x, y + 1, c);
    }
    return p;
  };
  sheet(scene, 'dizzy-stars', [0, 1, 2, 3].map(frame), [['spin', [0, 1, 2, 3], 10]]);
}

/** Boss sheets + animations (owner: Agent B). */
export function registerBossArt(scene: Phaser.Scene): void {
  registerGolem(scene);
  registerDuelist(scene);
  registerKing(scene);
  registerWardenArt(scene);
  registerMothArt(scene);
  registerAurrenArt(scene);
  registerFromageArt(scene);
  registerCroupierArt(scene);
  registerErratumArt(scene);
  registerColossusArt(scene);
  registerCantorArt(scene);
  registerTumblarArt(scene);
  registerUmbraArt(scene);
  registerBossProjectiles(scene);
  registerDizzyStars(scene);
}
