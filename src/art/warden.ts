import Phaser from 'phaser';
import { P, sheet } from './enemies';
import { limb } from './bosses';

// ============================================================================
// THE CHAINED WARDEN — huge armoured jailer swinging an iron anchor on a rusty chain.
// Grid 46x46 (frame 48x48), art faces right, body 30x40 bottom-centred (feet on row 45).
// Three sheets with identical frame layout / anim names:
//   'warden'     P1: shackled ankles (chain between the cuffs), cold cyan eye slit
//   'warden-p2'  P2: shackles broken (stubs dangling), amber eyes
//   'warden-p3'  P3: white-hot chain, burning eyes
// Anims '<sheet>-<name>': idle walk windup slam stuck coil sweep whirl dizzy crouch air land
//   stun hookwind throw reel roar
// Extra textures: 'hook' (thrown grapple, anim 'hook-fly'), 'warden-anchor' (loose anchor
// for the sweep / whirl fx, points right), 'warden-rock' (debris, anim 'warden-rock-fly').
// ============================================================================

type Pt = [number, number];
type Seg = [number, number, number, number, number]; // x0 y0 x1 y1 radius

/** Union of thick segments filled with one rim-shaded ramp (reads as one solid object). */
function segs(p: P, list: Seg[], ramp: string): void {
  p.shape((x, y) => {
    const px = x + 0.5, py = y + 0.5;
    for (const [x0, y0, x1, y1, r] of list) {
      const dx = x1 - x0, dy = y1 - y0, l2 = dx * dx + dy * dy || 1;
      const t = Math.max(0, Math.min(1, ((px - x0) * dx + (py - y0) * dy) / l2));
      if ((px - x0 - t * dx) ** 2 + (py - y0 - t * dy) ** 2 <= r * r) return true;
    }
    return false;
  }, ramp);
}

/**
 * Anchor: ring at (x, y), shank pointing along angle `a` (radians, 0 = right, PI/2 = down).
 * `len` = ring-to-crown length. Stock (crossbar) near the ring, curved arms + flukes at the crown.
 */
function anchor(p: P, x: number, y: number, a: number, len = 12): void {
  const c = Math.cos(a), s = Math.sin(a);
  const at = (u: number, v: number): Pt => [x + u * c - v * s, y + u * s + v * c];
  const S = (u0: number, v0: number, u1: number, v1: number, r: number): Seg => {
    const [ax, ay] = at(u0, v0), [bx, by] = at(u1, v1);
    return [ax, ay, bx, by, r];
  };
  const list: Seg[] = [];
  list.push(S(2, 0, len, 0, 1.3)); // shank
  list.push(S(3, -4.5, 3, 4.5, 1.0)); // stock
  // curved arms: arc centred on the shank
  const R = len * 0.48, cu = len - R;
  for (const side of [-1, 1]) {
    let prev = at(cu + R, 0);
    for (let k = 1; k <= 5; k++) {
      const th = (k / 5) * 1.75;
      const pt = at(cu + R * Math.cos(th), side * R * Math.sin(th));
      list.push([prev[0], prev[1], pt[0], pt[1], 1.25]);
      prev = pt;
    }
    // fluke: wedge pointing back toward the ring
    const tip = at(cu + R * Math.cos(1.75) - 2.6, side * (R * Math.sin(1.75) + 0.6));
    list.push([prev[0], prev[1], tip[0], tip[1], 1.6]);
  }
  segs(p, list, 'ubld');
  // ring (hollow)
  const [rx, ry] = at(0, 0);
  for (let k = 0; k < 8; k++) {
    const t = (k / 8) * Math.PI * 2;
    p.set(rx + Math.cos(t) * 1.6, ry + Math.sin(t) * 1.6, k % 2 ? 'b' : 'l');
  }
  // glint on the crown
  const [gx, gy] = at(len - 0.5, 0);
  p.set(gx, gy, 'e');
}

/** Rusty chain from (x0,y0) to (x1,y1) sagging by `sag` px; links alternate light/dark. */
function chain(p: P, x0: number, y0: number, x1: number, y1: number, sag = 0): void {
  const mx = (x0 + x1) / 2, my = (y0 + y1) / 2 + sag;
  const n = Math.max(2, Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 1.2));
  let last = '';
  for (let i = 0; i <= n; i++) {
    const t = i / n, it = 1 - t;
    const x = Math.round(it * it * x0 + 2 * it * t * mx + t * t * x1);
    const y = Math.round(it * it * y0 + 2 * it * t * my + t * t * y1);
    const key = x + ',' + y;
    if (key === last) continue;
    last = key;
    p.set(x, y, (x + y) % 3 === 0 ? 'u' : (x + y) % 3 === 1 ? 'l' : 'b');
  }
}

interface WPose {
  by?: number; // torso drop (crouch) / bob
  lean?: number; // torso + head x shift
  headDy?: number;
  legs?: [number, number]; // ankle x offsets (back, front)
  lift?: [number, number]; // ankle lift
  back: Pt; // back hand
  front: Pt; // front hand
  /** anchor ring x, y, angle; drawn behind the body when `behind` */
  anc?: [number, number, number];
  behind?: boolean;
  /** chain from the front hand to the anchor ring (default when anc set) or to this point */
  chainTo?: Pt;
  sag?: number;
  eyes?: 'on' | 'dim' | 'wide';
  dust?: Pt; // impact dust centre
}

function warden(o: WPose, stage: 1 | 2 | 3): P {
  const p = new P(46, 46);
  const by = o.by ?? 0;
  const ln = o.lean ?? 0;
  const [la, lb] = o.legs ?? [0, 0];
  const [lfa, lfb] = o.lift ?? [0, 0];
  const armour = 'nstm';
  const dark = 'Znst';

  // ---- shoulders
  const bsx = 13 + ln, bsy = 19 + by;
  const fsx = 31 + ln, fsy = 19 + by;

  // ---- back arm (behind everything)
  limb(p, bsx, bsy, o.back[0], o.back[1], 3, dark);
  p.ellV(o.back[0], o.back[1], 3, 3, 'Zns');

  // ---- anchor behind the body
  const drawAnchor = () => {
    if (!o.anc) return;
    anchor(p, o.anc[0], o.anc[1], o.anc[2]);
  };
  if (o.behind) drawAnchor();

  // ---- legs: thigh/shin limb + boot + ankle cuff
  const hipY = 32 + by;
  const leg = (hx: number, ax: number, lift: number, ramp: string): Pt => {
    const ay = 41 - lift;
    const kx = (hx + ax) / 2 + (by > 2 ? 2 : 0), ky = (hipY + ay) / 2 + (by > 2 ? -1 : 0);
    limb(p, hx, hipY, kx, ky, 3.6, ramp);
    limb(p, kx, ky, ax, ay, 3.3, ramp);
    p.box(ax - 4, ay + 1, 10, 4, 'Znsa'); // boot
    p.line(ax - 4, ay + 4, ax + 5, ay + 4, 'z');
    p.rect(ax - 3, ay - 1, 7, 2, 'a'); // cuff
    p.line(ax - 3, ay, ax + 3, ay, 't');
    p.set(ax, ay - 1, 'm');
    return [ax, ay];
  };
  const bk = leg(17 + ln * 0.5, 14 + la, lfa, dark);
  const fr = leg(27 + ln * 0.5, 30 + lb, lfb, armour);
  // shackles: P1 = chain between the cuffs; P2+ = broken stubs
  if (stage === 1) chain(p, bk[0] + 3, bk[1], fr[0] - 3, fr[1], 3);
  else {
    chain(p, bk[0] + 4, bk[1], bk[0] + 6, bk[1] + 3);
    chain(p, fr[0] - 4, fr[1], fr[0] - 5, fr[1] + 3);
  }

  // ---- torso: barrel breastplate
  const tx = 22 + ln, ty = 24 + by;
  p.ellV(tx, ty, 11.5, 10, armour + 'w');
  p.line(tx + 1, ty - 9, tx + 1, ty + 6, 's'); // centre ridge
  p.line(tx + 2, ty - 8, tx + 2, ty + 5, 'a');
  // plate seams + rivets
  p.line(tx - 10, ty - 1, tx - 4, ty - 2, 's');
  for (const [rx, ry] of [[tx - 6, ty - 6], [tx + 6, ty - 6], [tx - 8, ty + 3], [tx + 8, ty + 3]] as Pt[]) p.set(rx, ry, 'x');
  // belt + buckle + key ring
  p.rect(tx - 10, ty + 6, 21, 3, 'Z');
  p.line(tx - 10, ty + 6, tx + 10, ty + 6, 'h');
  p.rect(tx, ty + 6, 3, 3, 'y').set(tx + 1, ty + 7, 'Z');
  // tabard (crimson) between the legs
  const hem = Math.min(44, ty + 17);
  p.poly([[tx - 2, ty + 9], [tx + 5, ty + 9], [tx + 4 + ln * 0.3, hem], [tx - 1 + ln * 0.3, hem]], 'Wcr');
  p.line(tx, hem - 1, tx + 3, hem - 1, 'W');
  // keys on the belt (jailer)
  const kx = tx - 8, ky = ty + 9;
  p.set(kx, ky, 'y').set(kx - 1, ky + 1, 'y').set(kx + 1, ky + 1, 'y');
  p.line(kx, ky + 2, kx, ky + 4, 'g').set(kx + 1, ky + 4, 'y');

  // ---- back pauldron
  p.ellV(bsx, bsy - 1, 5.5, 4.5, 'nst');
  p.line(bsx - 4, bsy + 2, bsx + 3, bsy + 2, 'Z');

  // ---- head: bucket helm with barred visor + spike
  const hx = 25 + ln, hy = 9 + by + (o.headDy ?? 0);
  p.box(hx - 6, hy + 2, 12, 5, 'nst'); // neck guard / gorget
  p.ellV(hx, hy, 6.5, 6.5, armour + 'w');
  p.rect(hx - 5, hy - 1, 11, 1, 's'); // brow band
  p.line(hx - 5, hy - 2, hx + 5, hy - 2, 'a');
  p.line(hx, hy - 9, hx, hy - 7, 'a').set(hx, hy - 10, 'm'); // spike
  p.set(hx - 1, hy - 7, 's').set(hx + 1, hy - 7, 's');
  // visor: dark slit with eyes, bars below
  p.rect(hx - 1, hy, 7, 2, 'z');
  const eyes = o.eyes ?? 'on';
  const eyeC = stage === 3 ? 'w' : stage === 2 ? 'y' : 'Q';
  const eyeH = stage === 3 ? 'o' : stage === 2 ? 'o' : 'I';
  if (eyes === 'dim') p.set(hx + 1, hy + 1, 'h').set(hx + 4, hy + 1, 'h');
  else {
    p.set(hx + 1, hy, eyeC).set(hx + 4, hy, eyeC).set(hx + 1, hy + 1, eyeH).set(hx + 4, hy + 1, eyeH);
    if (eyes === 'wide') p.set(hx + 2, hy, eyeC).set(hx + 5, hy, eyeC);
  }
  for (let bx = hx; bx <= hx + 5; bx += 2) p.line(bx, hy + 2, bx, hy + 4, 'z');

  // ---- front pauldron (gold-trimmed) + front arm
  const drawFrontArm = () => {
    limb(p, fsx, fsy + 2, o.front[0], o.front[1], 3.9, 'zzz'); // dark separation rim
    limb(p, fsx, fsy, o.front[0], o.front[1], 3.1, armour);
    p.ellV(o.front[0], o.front[1], 3.4, 3.4, 'nsam'); // gauntlet
    p.set(o.front[0] + 1, o.front[1] - 1, 'w');
  };
  drawFrontArm();
  p.ellV(fsx, fsy - 1, 6, 5, armour + 'w');
  p.line(fsx - 5, fsy + 2, fsx + 5, fsy + 2, 'y');
  p.line(fsx - 4, fsy + 3, fsx + 4, fsy + 3, 'Z');
  p.set(fsx - 1, fsy - 3, 'x');

  // ---- chain + anchor in front
  if (!o.behind) drawAnchor();
  if (o.chainTo) chain(p, o.front[0], o.front[1], o.chainTo[0], o.chainTo[1], o.sag ?? 0);
  else if (o.anc) chain(p, o.front[0], o.front[1], o.anc[0], o.anc[1], o.sag ?? 0);

  // ---- impact dust / cracks
  if (o.dust) {
    const [dx, dy] = o.dust;
    for (const [ox, oy, c] of [[-5, 0, 'm'], [-4, -1, 'a'], [-2, -2, 'm'], [3, -2, 'm'], [5, -1, 'a'], [6, 0, 'm'], [-6, -2, 'a'], [7, -3, 'a']] as [number, number, string][]) p.set(dx + ox, dy + oy, c);
    p.line(dx - 3, 45, dx + 4, 45, 'z');
  }
  return p;
}

const PI = Math.PI;

/** Frame list (index = frame). Keep anim table below in sync. */
const POSES: WPose[] = [
  // 0-1 idle: anchor hangs at his side, resting on the floor
  { back: [11, 33], front: [35, 30], anc: [37, 33, PI / 2 + 0.05] },
  { by: 1, back: [11, 34], front: [35, 31], anc: [37, 33, PI / 2 + 0.08] },
  // 2-5 walk: anchor drags along
  { legs: [-3, 3], lift: [0, 2], back: [12, 32], front: [35, 30], anc: [38, 33, PI / 2 - 0.15] },
  { by: 1, back: [11, 34], front: [35, 31], anc: [37, 33, PI / 2] },
  { legs: [3, -3], lift: [2, 0], back: [10, 34], front: [35, 30], anc: [38, 33, PI / 2 + 0.15] },
  { by: 1, back: [11, 34], front: [35, 31], anc: [37, 33, PI / 2] },
  // 6 windup (slam): both arms overhead, anchor swung up behind the head
  { by: 1, lean: -2, headDy: 1, legs: [-2, 2], back: [21, 2], front: [24, 2], anc: [12, 5, PI - 0.35], behind: true, sag: -2, eyes: 'wide' },
  // 7 slam: lunge, anchor driven into the floor in front
  { by: 3, lean: 3, legs: [-3, 4], back: [32, 29], front: [36, 30], anc: [40, 33, PI / 2 - 0.12], dust: [41, 44], eyes: 'wide' },
  // 8-9 stuck: leaning back, hauling on the taut chain
  { by: 2, lean: -2, legs: [-3, 3], back: [30, 27], front: [33, 28], anc: [41, 34, PI / 2 - 0.3], dust: [42, 44] },
  { by: 3, lean: -3, legs: [-3, 3], back: [29, 28], front: [32, 29], anc: [41, 34, PI / 2 - 0.25], dust: [42, 44] },
  // 10 coil (sweep windup): low, arm cocked back, anchor dragged behind
  { by: 4, lean: -1, legs: [-4, 4], back: [33, 28], front: [9, 32], anc: [13, 37, PI - 0.15], behind: true, sag: 1, eyes: 'wide' },
  // 11 sweep: low lunge, arm flung forward, chain runs out of the frame (fx draws the rest)
  { by: 4, lean: 2, legs: [-4, 4], back: [8, 30], front: [40, 35], chainTo: [46, 40], eyes: 'wide' },
  // 12-13 whirl: arm up, chain spinning overhead (fx draws the circle)
  { legs: [-3, 3], back: [5, 24], front: [30, 2], chainTo: [36, 0], eyes: 'wide' },
  { by: 1, legs: [-3, 3], back: [5, 25], front: [29, 2], chainTo: [23, 0], eyes: 'wide' },
  // 14 dizzy: slumped, anchor dropped on its side
  { by: 3, lean: -1, headDy: 2, back: [12, 38], front: [33, 37], anc: [33, 40, -0.08], eyes: 'dim' },
  // 15 crouch (leap windup): deep crouch, anchor clutched to the chest
  { by: 5, lean: 1, legs: [-4, 4], back: [27, 30], front: [31, 29], anc: [33, 23, PI / 2], eyes: 'wide' },
  // 16 air: tucked, anchor raised overhead pointing down-forward
  { by: -2, lift: [4, 3], legs: [-1, 2], back: [24, 1], front: [27, 2], anc: [29, 3, 0.55], eyes: 'wide' },
  // 17 land: knees buckled, anchor buried beside him
  { by: 5, lean: 2, headDy: 1, legs: [-4, 4], back: [30, 33], front: [35, 33], anc: [38, 34, PI / 2 - 0.05], dust: [36, 44] },
  // 18 stun: knocked back, arms flung up
  { by: 1, lean: -3, headDy: -1, legs: [-2, 2], back: [4, 14], front: [38, 13], anc: [40, 18, PI / 2 + 0.25], eyes: 'dim' },
  // 19 hookwind: arm cocked back high, anchor swinging behind the shoulder
  { lean: -2, legs: [-3, 3], back: [30, 30], front: [12, 10], anc: [7, 18, PI / 2 + 0.3], behind: true, eyes: 'wide' },
  // 20 throw: arm thrust forward, chain flying out of the frame
  { lean: 2, legs: [-3, 4], back: [9, 30], front: [41, 20], chainTo: [46, 20], eyes: 'wide' },
  // 21-22 reel: leaning back, hauling the chain in hand over hand
  { lean: -3, legs: [-3, 3], back: [27, 25], front: [33, 26], chainTo: [46, 27], sag: 1 },
  { by: 1, lean: -2, legs: [-3, 3], back: [32, 26], front: [29, 25], chainTo: [46, 27], sag: 2 },
  // 23 roar: arms spread, head up, anchor dangling
  { by: -1, headDy: -1, legs: [-3, 3], back: [3, 10], front: [41, 10], anc: [42, 15, PI / 2], eyes: 'wide' },
];

const ANIMS: [string, number[], number, number?][] = [
  ['idle', [0, 1], 2], ['walk', [2, 3, 4, 5], 5], ['windup', [6], 1], ['slam', [7], 1], ['stuck', [8, 9], 4],
  ['coil', [10], 1], ['sweep', [11], 1], ['whirl', [12, 13], 10], ['dizzy', [14], 1], ['crouch', [15], 1],
  ['air', [16], 1], ['land', [17], 1], ['stun', [18], 1], ['hookwind', [19], 1], ['throw', [20], 1],
  ['reel', [21, 22], 6], ['roar', [23], 1],
];

const HOT: Record<string, string> = { u: 'o', b: 'y', l: 'w' };

export function registerWardenArt(scene: Phaser.Scene): void {
  sheet(scene, 'warden', POSES.map((o) => warden(o, 1)), ANIMS);
  sheet(scene, 'warden-p2', POSES.map((o) => warden(o, 2)), ANIMS);
  sheet(scene, 'warden-p3', POSES.map((o) => warden(o, 3).swap(HOT)), ANIMS);

  // loose anchor for fx (sweep tip / whirl head) — grid 16x16, crown points right
  const loose = new P(16, 16);
  anchor(loose, 2, 8, 0, 12);
  sheet(scene, 'warden-anchor', [loose], []);

  // hook projectile — small grapple anchor, crown points right. Grid 14x12 (frame 16x14)
  const hook = (k: number): P => {
    const p = new P(14, 12);
    anchor(p, 2, 6, 0, 10);
    p.set(0, 6, k ? 'l' : 'b').set(1, 5, k ? 'b' : 'l');
    if (k) p.set(11, 6, 'w');
    return p;
  };
  sheet(scene, 'hook', [hook(0), hook(1)], [['fly', [0, 1], 10]]);

  // debris rock — grid 10x10 (frame 12x12), tumbling
  const rock = (k: number): P => {
    const p = new P(10, 10);
    const pts: Pt[][] = [
      [[1, 3], [4, 0], [8, 1], [9, 6], [6, 9], [2, 8]],
      [[0, 5], [3, 1], [7, 0], [9, 4], [7, 9], [2, 9]],
    ];
    p.poly(pts[k], 'hHja');
    p.set(4 + k, 4, 'h').set(5 + k, 5, 'h').set(3, 2 + k, 'm');
    return p;
  };
  sheet(scene, 'warden-rock', [rock(0), rock(1)], [['fly', [0, 1], 8]]);
}
