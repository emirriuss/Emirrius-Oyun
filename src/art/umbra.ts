import Phaser from 'phaser';
import { P, sheet } from './enemies';
import { limb } from './bosses';

// ============================================================================
// UMBRA, THE CAST SHADOW: a shadow with no one standing in it. A lanky, long-armed silhouette with
// clawed fingers, smoke for feet and two pink pinprick eyes. When a light hangs straight above it, it
// condenses into a solid puddle with eyes (the only form a sword can cut in P1/P2).
// Phase 3 reveals the thing that was casting it: a gaunt lamplight-eater in a soot cloak with a cracked
// porcelain mask and embers glowing through its ribs.
// Grid 30x46 (frame 32x48), art faces right, feet on the bottom row, body ~16x34 bottom-centred.
// Two sheets with the same frame layout and anim names:
//   'umbra'       the shadow (P1/P2; also drawn stretched / leaning by Umbra.ts as its cast shadows)
//   'umbra-body'  the caster (P3)
// Frames: 0-1 idle | 2-3 move | 4 windup | 5 lean (claw out) | 6 sweep (low swipe) | 7 pounce/grab
//         8 sprawl/gorged (punish) | 9 stun | 10-11 puddle (condensed) | 12 roar
// Extra textures: 'umbra-lantern' 14x18 (0 lit, 1 guttering, 2 out), 'umbra-wisp' 10x10,
//                 'umbra-wave' 24x10 (floor wave projectile)
// ============================================================================

interface Pose {
  /** neck lean (px, + = forward) */
  lean?: number;
  /** hips drop (px) */
  crouch?: number;
  /** front hand / back hand (grid coords) */
  front?: [number, number];
  back?: [number, number];
  /** foot offsets (x) */
  legs?: [number, number];
  /** eyes: open / wide / shut (stun) / dim (sprawl) */
  eyes?: 'open' | 'wide' | 'shut' | 'dim';
  /** lying flat (sprawl / gorged) */
  flat?: boolean;
  /** condensed puddle (bob px) */
  puddle?: number;
}

const W = 30;
const H = 46;
const FEET = 45;

/** palette ramps per sheet */
interface Skin {
  body: string;
  limb: string;
  head: string;
  eye: string;
  /** P3: porcelain mask + ember ribs */
  mask?: string;
  ember?: string;
}
const SHADOW: Skin = { body: 'zzZh', limb: 'zzZ', head: 'zzZh', eye: 'K' };
const CASTER: Skin = { body: 'zZhH', limb: 'zZh', head: 'zZh', eye: 'y', mask: 'ame', ember: 'oy' };

function claws(p: P, x: number, y: number, dir: number, c: string): void {
  p.line(x, y, x + dir * 3, y - 2, c).line(x, y, x + dir * 3, y, c).line(x, y, x + dir * 3, y + 2, c);
}

function eyes(p: P, x: number, y: number, o: Pose, skin: Skin): void {
  const e = o.eyes ?? 'open';
  if (e === 'shut') {
    p.line(x - 1, y - 1, x + 1, y + 1, 'j').line(x - 1, y + 1, x + 1, y - 1, 'j');
    p.line(x + 3, y - 1, x + 5, y + 1, 'j').line(x + 3, y + 1, x + 5, y - 1, 'j');
    return;
  }
  const c = e === 'dim' ? 'j' : skin.eye;
  p.set(x, y, c).set(x + 4, y, c);
  if (e === 'wide') p.set(x, y - 1, c).set(x + 4, y - 1, c).set(x + 1, y, c).set(x + 5, y, c);
}

function figure(o: Pose, skin: Skin): P {
  const p = new P(W, H);
  if (o.puddle !== undefined) return puddle(p, o.puddle, skin);
  if (o.flat) return sprawl(p, o, skin);
  const lean = o.lean ?? 0;
  const cr = o.crouch ?? 0;
  const [la, lb] = o.legs ?? [0, 0];
  const hipX = 13, hipY = 29 + cr;
  const neckX = 14 + lean, neckY = 13 + cr;
  const shX = 14 + lean * 0.8, shY = 15 + cr;
  const front = o.front ?? [19 + lean, 30 + cr];
  const back = o.back ?? [8 + lean * 0.5, 30 + cr];

  // back arm + leg (behind)
  limb(p, shX - 1, shY, back[0], back[1], 1.3, 'zzz');
  claws(p, back[0], back[1], back[0] < shX ? -1 : 1, 'z');
  limb(p, hipX - 1, hipY, 10 + la, FEET - 1, 1.6, 'zzz');
  // torso: a tapered wedge from the hips up to the shoulders
  p.shape((x, y) => {
    if (y < neckY || y > hipY + 1) return false;
    const t = (y - neckY) / Math.max(1, hipY - neckY);
    const cx = neckX + (hipX - neckX) * t;
    const half = 4.2 - 1.6 * t;
    return Math.abs(x + 0.5 - cx) <= half;
  }, skin.body);
  // front leg + smoky foot
  limb(p, hipX + 1, hipY, 17 + lb, FEET - 1, 1.6, skin.limb);
  for (const fx of [10 + la, 17 + lb]) p.set(fx - 2, FEET, 'z').set(fx + 2, FEET, 'z').set(fx, FEET, 'z').set(fx - 1, FEET, 'Z');
  // head with two smoke horns
  const hx = neckX + 1, hy = neckY - 5;
  p.ellV(hx, hy, 4.2, 4.6, skin.head);
  p.line(hx - 3, hy - 4, hx - 4, hy - 8, 'z').line(hx + 2, hy - 4, hx + 4, hy - 8, 'z').set(hx + 4, hy - 9, 'Z');
  if (skin.mask) {
    // cracked porcelain mask on the face side
    p.shape((x, y) => ((x + 0.5 - (hx + 1.5)) / 2.8) ** 2 + ((y + 0.5 - hy) / 3.6) ** 2 <= 1, skin.mask);
    p.line(hx + 2, hy - 3, hx + 1, hy + 1, 's');
    // ember ribs
    for (let i = 0; i < 3; i++) p.line(neckX - 2, neckY + 5 + i * 3, neckX + 2, neckY + 4 + i * 3, i === 1 ? skin.ember![1] : skin.ember![0]);
  }
  eyes(p, hx, hy, o, skin);
  // front arm, long, with claws
  limb(p, shX + 1, shY, front[0], front[1], 1.3, skin.limb);
  claws(p, front[0], front[1], front[0] >= shX ? 1 : -1, skin.mask ? 'a' : 'Z');
  return p;
}

function puddle(p: P, bob: number, skin: Skin): P {
  p.ell(15, FEET - 2, 13, 3.5, skin.body);
  p.ellV(15, FEET - 6 - bob, 7, 6 + bob * 0.5, skin.head);
  // drips + reaching tendrils
  p.line(4, FEET - 2, 2, FEET - 4, 'z').line(26, FEET - 2, 28, FEET - 5, 'z');
  eyes(p, 13, FEET - 9 - bob, { eyes: 'wide' }, skin);
  return p;
}

function sprawl(p: P, o: Pose, skin: Skin): P {
  // flat on its back along the floor, arms flopped
  p.ellV(13, FEET - 3, 10, 3.2, skin.body);
  p.ellV(25, FEET - 4, 3.6, 3.4, skin.head);
  limb(p, 8, FEET - 3, 2, FEET - 1, 1.2, skin.limb);
  limb(p, 18, FEET - 4, 21, FEET - 9, 1.2, skin.limb);
  claws(p, 21, FEET - 9, 1, 'Z');
  if (skin.mask) p.shape((x, y) => ((x + 0.5 - 26) / 2.2) ** 2 + ((y + 0.5 - (FEET - 4)) / 2.6) ** 2 <= 1, skin.mask);
  eyes(p, 24, FEET - 5, { eyes: o.eyes ?? 'dim' }, skin);
  return p;
}

const POSES: Pose[] = [
  {}, // 0 idle
  { crouch: 1, front: [19, 31], back: [8, 31] }, // 1 idle sway
  { lean: 2, legs: [-2, 2], front: [21, 28], back: [6, 29] }, // 2 move
  { lean: 2, legs: [2, -2], front: [18, 31], back: [9, 28] }, // 3 move
  { lean: -3, crouch: 2, front: [6, 14], back: [3, 22], eyes: 'wide' }, // 4 windup (reared back, claw raised)
  { lean: 5, crouch: 1, legs: [-3, 3], front: [29, 17], back: [5, 27] }, // 5 lean strike
  { lean: 4, crouch: 6, legs: [-3, 4], front: [29, 40], back: [6, 34] }, // 6 sweep (low swipe)
  { lean: 3, crouch: 4, legs: [-2, 2], front: [25, 10], back: [4, 12], eyes: 'wide' }, // 7 pounce / grab
  { flat: true }, // 8 sprawl / gorged
  { lean: -2, crouch: 2, front: [17, 34], back: [10, 34], eyes: 'shut' }, // 9 stun
  { puddle: 0 }, // 10 puddle
  { puddle: 1 }, // 11 puddle bob
  { lean: -1, front: [24, 6], back: [3, 6], eyes: 'wide' }, // 12 roar (arms up)
];

const ANIMS: [string, number[], number, number?][] = [
  ['idle', [0, 1], 3],
  ['move', [2, 3], 6],
  ['windup', [4], 1, 0],
  ['lean', [5], 1, 0],
  ['sweep', [6], 1, 0],
  ['pounce', [7], 1, 0],
  ['grab', [7], 1, 0],
  ['sprawl', [8], 1, 0],
  ['gorged', [8], 1, 0],
  ['stun', [9], 1, 0],
  ['puddle', [10, 11], 4],
  ['roar', [12], 1, 0],
];

function lantern(state: 0 | 1 | 2): P {
  const p = new P(14, 18);
  // hanging ring + cap
  p.set(7, 0, 's').set(6, 1, 's').set(8, 1, 's');
  p.box(3, 2, 8, 2, 'nsa');
  // glass
  const glass = state === 0 ? 'oygd' : state === 1 ? 'uoy' : 'zZh';
  p.box(4, 4, 6, 9, glass);
  // flame
  if (state === 0) p.ellV(7, 9, 1.8, 2.8, 'ygw');
  else if (state === 1) p.ellV(7, 11, 1.2, 1.4, 'oy');
  // cage bars + base
  for (const x of [3, 10]) p.line(x, 4, x, 13, 'n');
  p.line(7, 4, 7, 5, 'n');
  p.box(3, 13, 8, 2, 'nsa');
  p.set(5, 15, 'n').set(9, 15, 'n');
  return p;
}

function wisp(): P {
  const p = new P(10, 10);
  p.ellV(5, 5, 4, 4, 'pVj');
  p.ellV(4, 4, 1.8, 1.8, 'jK');
  return p;
}

function wave(): P {
  const p = new P(24, 10);
  p.shape((x, y) => {
    const crest = 9 - 7 * Math.sin(Math.PI * Math.min(1, (x + 0.5) / 24)) ** 0.6;
    return y >= crest;
  }, 'zzZh');
  for (let x = 4; x < 20; x += 3) p.set(x, 9 - Math.round(6 * Math.sin((Math.PI * x) / 24)), 'j');
  return p;
}

export function registerUmbraArt(scene: Phaser.Scene): void {
  sheet(scene, 'umbra', POSES.map((o) => figure(o, SHADOW)), ANIMS);
  sheet(scene, 'umbra-body', POSES.map((o) => figure(o, CASTER)), ANIMS);
  sheet(scene, 'umbra-lantern', [lantern(0), lantern(1), lantern(2)], [['flicker', [0, 1, 0, 0, 1], 12]]);
  sheet(scene, 'umbra-wisp', [wisp()], []);
  sheet(scene, 'umbra-wave', [wave()], []);
}
