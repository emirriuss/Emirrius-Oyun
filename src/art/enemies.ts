import Phaser from 'phaser';
import { drawSheet, defineAnim, type Frame, type Palette } from './pixel';
import { C } from './palette';

// ============================================================================
// Shared painter for enemy + boss art (owner: Agent B).
// Sprites are painted into a char grid with simple primitives and auto rim
// shading, then rasterised by drawSheet (which adds the 1px dark outline).
// ============================================================================

/** One char per palette colour; used by every enemy/boss sheet. */
export const EPAL: Palette = {
  x: C.ink, n: C.night, s: C.slate, t: C.stone, a: C.ash, m: C.mist, w: C.white,
  W: C.wine, c: C.crimson, r: C.red, o: C.orange, y: C.amber, g: C.gold, e: C.cream,
  u: C.umber, b: C.bark, l: C.clay, d: C.sand,
  P: C.pine, M: C.moss, L: C.leaf, i: C.lime,
  N: C.navy, B: C.blue, S: C.sky, Q: C.cyan, I: C.ice, T: C.teal,
  V: C.violet, p: C.purple, G: C.magenta, K: C.pink,
  // extra darks for shadow / hollow variants
  z: 0x0b0714, Z: 0x1c1430, h: 0x2c2244, H: 0x463a66, j: 0x6a5c94,
};

type Test = (x: number, y: number) => boolean;

export class P {
  g: string[][];
  constructor(readonly w: number, readonly h: number) {
    this.g = Array.from({ length: h }, () => Array<string>(w).fill('.'));
  }
  inb(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.w && y < this.h;
  }
  set(x: number, y: number, c: string): this {
    x = Math.round(x);
    y = Math.round(y);
    if (c !== '.' && c !== ' ' && this.inb(x, y)) this.g[y][x] = c;
    return this;
  }
  get(x: number, y: number): string {
    return this.inb(x, y) ? this.g[y][x] : '.';
  }
  clear(x: number, y: number): this {
    if (this.inb(x, y)) this.g[y][x] = '.';
    return this;
  }
  rect(x: number, y: number, w: number, h: number, c: string): this {
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) this.set(xx, yy, c);
    return this;
  }
  /** Bresenham line. */
  line(x0: number, y0: number, x1: number, y1: number, c: string): this {
    x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
    const dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1;
    const dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      this.set(x0, y0, c);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
    return this;
  }
  /** Fill a region with auto rim shading: ramp = dark,mid,light[,highlight]. */
  shape(test: Test, ramp: string, x0 = 0, y0 = 0, x1 = this.w, y1 = this.h): this {
    const [d, m, l = m, hi] = ramp;
    for (let y = y0; y < y1; y++)
      for (let x = x0; x < x1; x++) {
        if (!test(x, y)) continue;
        const dk = !test(x + 1, y) || !test(x, y + 1);
        const lt = !test(x - 1, y) || !test(x, y - 1);
        let c = dk ? d : lt ? l : m;
        if (hi && !dk && !test(x - 1, y) && !test(x, y - 1)) c = hi;
        this.set(x, y, c);
      }
    return this;
  }
  box(x: number, y: number, w: number, h: number, ramp: string): this {
    return this.shape((px, py) => px >= x && px < x + w && py >= y && py < y + h, ramp, x, y, x + w, y + h);
  }
  ellTest(cx: number, cy: number, rx: number, ry: number): Test {
    return (x, y) => ((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy) / ry) ** 2 <= 1;
  }
  ell(cx: number, cy: number, rx: number, ry: number, ramp: string): this {
    return this.shape(this.ellTest(cx, cy, rx, ry), ramp);
  }
  /** Volumetric ellipse shading (light from top-left): ramp dark,mid,light[,hi]. */
  ellV(cx: number, cy: number, rx: number, ry: number, ramp: string, bias = 0): this {
    const [d, m, l = m, hi] = ramp;
    for (let y = 0; y < this.h; y++)
      for (let x = 0; x < this.w; x++) {
        const nx = (x + 0.5 - cx) / rx, ny = (y + 0.5 - cy) / ry;
        if (nx * nx + ny * ny > 1) continue;
        const v = nx * 0.45 + ny * 0.75 + bias;
        let c = v > 0.42 ? d : v < -0.4 ? l : m;
        if (hi && Math.abs(nx + 0.42) < 0.2 && Math.abs(ny + 0.5) < 0.18) c = hi;
        this.set(x, y, c);
      }
    return this;
  }
  poly(pts: [number, number][], ramp: string): this {
    const test: Test = (x, y) => {
      const px = x + 0.5, py = y + 0.5;
      let inside = false;
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const [xi, yi] = pts[i], [xj, yj] = pts[j];
        if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
      }
      return inside;
    };
    return this.shape(test, ramp);
  }
  stamp(rows: Frame, x: number, y: number, flip = false): this {
    rows.forEach((r, yy) => {
      const s = flip ? [...r].reverse().join('') : r;
      for (let xx = 0; xx < s.length; xx++) this.set(x + xx, y + yy, s[xx]);
    });
    return this;
  }
  /** Replace chars inside the grid. */
  swap(map: Record<string, string>): this {
    for (const row of this.g) for (let x = 0; x < row.length; x++) if (map[row[x]]) row[x] = map[row[x]];
    return this;
  }
  rows(): Frame {
    return this.g.map((r) => r.join(''));
  }
}

/** Draw a sheet from painter frames + register named anims ([name, frames, fps, repeat]). */
export function sheet(scene: Phaser.Scene, key: string, frames: P[], anims: [string, number[], number, number?][]): void {
  drawSheet(scene, key, frames.map((f) => f.rows()), EPAL);
  for (const [name, fr, fps, rep] of anims) defineAnim(scene, `${key}-${name}`, key, fr, fps, rep ?? -1);
}

/** 5-point crown stamp (5 wide, 3 tall). */
const CROWN = ['g.g.g', 'gygyg', 'ggrgg'];

// ============================================================================
// SLIME — gooey blob. Grid 18x14 (frame 20x16). Body 14x9 bottom-centred.
// ============================================================================
function slime(w: number, h: number, elite: boolean, o: { eyes?: 'open' | 'shut' | 'wide'; look?: number } = {}): P {
  const p = new P(18, 14);
  const cx = 9, bottom = 14;
  const cy = bottom - h / 2;
  const ramp = elite ? 'crKw' : 'VGKw'; // magenta: reads on green grass, purple stone and red rock
  const [d, m, l] = ramp;
  const test: Test = (x, y) => {
    const nx = (x + 0.5 - cx) / (w / 2), ny = (y + 0.5 - cy) / (h / 2);
    if (ny < -1 || ny > 1) return false;
    return ny < 0 ? nx * nx + ny * ny <= 1 : nx ** 4 + ny ** 4 <= 1;
  };
  for (let y = 0; y < 14; y++)
    for (let x = 0; x < 18; x++) {
      if (!test(x, y)) continue;
      const nx = (x + 0.5 - cx) / (w / 2), ny = (y + 0.5 - cy) / (h / 2);
      const v = nx * 0.45 + ny * 0.8;
      let c = v > 0.45 || !test(x, y + 1) ? d : v < -0.35 ? l : m;
      if (!test(x, y - 1) && c === m) c = l;
      p.set(x, y, c);
    }
  // glossy highlight
  const top = Math.ceil(bottom - h);
  p.set(cx - Math.round(w * 0.22), top + 1, 'w').set(cx - Math.round(w * 0.22) - 1, top + 2, 'w');
  // inner bubbles
  p.set(cx - 3, bottom - 3, l).set(cx + 3, bottom - 2, l);
  // eyes (facing right)
  const ey = Math.round(bottom - h * 0.58);
  const lx = cx + 1 + (o.look ?? 0), rx = cx + 4 + (o.look ?? 0);
  if (o.eyes === 'shut') {
    p.set(lx - 1, ey + 1, 'x').set(lx, ey + 1, 'x').set(rx, ey + 1, 'x').set(rx - 1, ey + 1, 'x');
  } else {
    p.set(lx, ey, 'x').set(lx, ey + 1, 'x').set(rx, ey, 'x').set(rx, ey + 1, 'x');
    p.set(lx, ey, 'w').set(rx, ey, 'w');
    if (o.eyes === 'wide') p.set(lx - 1, ey + 1, 'x').set(rx - 1, ey + 1, 'x');
  }
  // mouth
  p.set(cx + 2 + (o.look ?? 0), ey + 2, d).set(cx + 3 + (o.look ?? 0), ey + 2, d);
  if (elite) p.stamp(CROWN, cx - 2, top - 3);
  return p;
}

function registerSlime(scene: Phaser.Scene): void {
  for (const elite of [false, true]) {
    const f = [
      slime(14, 9, elite), slime(15, 8, elite),                                        // 0-1 idle
      slime(14, 9, elite, { look: 1 }), slime(13, 10, elite, { look: 1 }),           // 2-5 move
      slime(14, 9, elite, { look: 1 }), slime(16, 7, elite, { look: 1 }),
      slime(11, 12, elite, { eyes: 'wide', look: 1 }),                                // 6 hop
      slime(16, 7, elite, { eyes: 'shut' }),                                          // 7 hurt
      slime(17, 6, elite, { eyes: 'wide' }),                                          // 8 windup squash
    ];
    sheet(scene, elite ? 'slime-elite' : 'slime', f, [
      ['idle', [0, 1], 3], ['move', [2, 3, 4, 5], 8], ['hop', [6], 1], ['hurt', [7], 1], ['windup', [8, 0], 10],
    ]);
  }
}

// ============================================================================
// CHARGER — horned boar-beast. Grid 22x16 (frame 24x18). Body 16x14.
// ============================================================================
interface ChargerPose { legs?: number[]; bob?: number; head?: number; fwd?: number; crouch?: boolean; charge?: boolean; dizzy?: number; hurt?: boolean; eye?: string }
function charger(o: ChargerPose, elite: boolean): P {
  const p = new P(22, 16);
  const fur = elite ? 'Wcr' : 'ubl';
  const mane = elite ? 'g' : 'u';
  const horn = elite ? 'ygw' : 'dew';
  const bob = (o.bob ?? 0) + (o.crouch ? 1 : 0);
  const legs = o.legs ?? [0, 0, 0, 0];
  // legs: back pair, front pair (dx shift for gait)
  const lx = [4, 7, 13, 16];
  lx.forEach((x, i) => {
    const dx = legs[i];
    const lift = dx !== 0 && i % 2 === 1 ? 1 : 0;
    const top = 11 + Math.min(bob, 1);
    p.line(x, top, x + dx, 15 - lift, i % 2 ? fur[0] : 'u');
    p.line(x + 1, top, x + 1 + dx, 15 - lift, i % 2 ? fur[1] : fur[0]);
    p.set(x + dx, 15 - lift, 'n').set(x + 1 + dx, 15 - lift, 'n');
  });
  // tail
  p.set(2, 6 + bob, fur[0]).set(1, 5 + bob, fur[0]).set(1, 4 + bob, mane);
  // torso
  p.ellV(10, 8.5 + bob, 7.6, 4.4, fur);
  // belly
  for (let x = 6; x <= 13; x++) if (p.get(x, 12 + bob) !== '.') p.set(x, 12 + bob, elite ? 'W' : 'u');
  // mane spikes
  for (let x = 5; x <= 14; x++) {
    const top = [...Array(16).keys()].find((y) => p.get(x, y) !== '.') ?? 6;
    p.set(x, top, mane);
    if (x % 2 === 0) p.set(x, top - 1, mane);
  }
  // head
  const hx = 16.5 + (o.fwd ?? 0) + (o.charge ? 1 : 0);
  const hy = 8 + bob + (o.head ?? 0) + (o.charge ? 2 : 0);
  p.ellV(hx, hy, 3.4, 3.3, fur);
  for (let y = Math.round(hy) - 2; y <= Math.round(hy) + 2; y++) if (p.get(Math.round(hx) - 3, y) !== '.') p.set(Math.round(hx) - 3, y, fur[0]);
  // snout
  p.box(Math.round(hx) + 1, Math.round(hy), 3, 3, elite ? 'cKK' : 'llK');
  p.set(Math.round(hx) + 3, Math.round(hy), 'n');
  // tusk
  p.set(Math.round(hx) + 2, Math.round(hy) + 3, 'w').set(Math.round(hx) + 3, Math.round(hy) + 2, 'w');
  // eye
  const ex = Math.round(hx), ey = Math.round(hy) - 2;
  if (o.hurt) p.set(ex, ey, 'n').set(ex + 1, ey, 'n');
  else if (o.dizzy !== undefined) p.set(ex, ey, 'w').set(ex + 1, ey, 'n');
  else p.set(ex, ey, o.eye ?? (elite ? 'g' : 'g')).set(ex + 1, ey, 'n');
  // horns
  const bx = Math.round(hx) - 1, by = Math.round(hy) - 3;
  if (o.charge) {
    // horns lowered, pointing forward
    p.line(bx, by, bx + 4, by - 1, horn[1]).line(bx + 4, by - 1, bx + 6, by - 2, horn[2]);
    p.set(bx, by + 1, horn[0]).set(bx + 1, by, horn[0]);
  } else {
    p.set(bx - 2, by, horn[0]).set(bx - 2, by - 1, horn[0]).set(bx - 1, by - 2, horn[0]);
    p.line(bx, by, bx + 1, by - 2, horn[1]).set(bx + 2, by - 3, horn[1]).set(bx + 3, by - 3, horn[2]).set(bx + 4, by - 2, horn[2]);
    p.set(bx + 1, by, horn[0]);
  }
  if (elite) p.stamp(['g.g', 'ggg'], bx - 1, by - 3 + (o.charge ? 1 : 0));
  // dizzy stars
  if (o.dizzy !== undefined) {
    const pts = o.dizzy ? [[12, 1], [18, 0], [21, 3]] : [[13, 0], [16, 2], [20, 1]];
    for (const [x, y] of pts) p.set(x, y, 'g').set(x - 1, y, 'y').set(x + 1, y, 'y').set(x, y - 1, 'y').set(x, y + 1, 'y');
  }
  return p;
}

function registerCharger(scene: Phaser.Scene): void {
  for (const elite of [false, true]) {
    const f = [
      charger({}, elite), charger({ bob: 1, head: 0 }, elite),                                     // 0-1 idle
      charger({ legs: [1, -1, 1, -1] }, elite), charger({ legs: [0, 0, 0, 0], bob: 1 }, elite),    // 2-5 walk
      charger({ legs: [-1, 1, -1, 1] }, elite), charger({ legs: [0, 0, 0, 0], bob: 1 }, elite),
      charger({ crouch: true, head: 1, fwd: -1, eye: 'r', legs: [-1, 0, 0, 1] }, elite),           // 6-7 windup
      charger({ crouch: true, head: 2, fwd: -1, eye: 'r', legs: [-1, 0, 1, 2] }, elite),
      charger({ charge: true, legs: [-2, 1, 2, -1], eye: 'r' }, elite),                             // 8-9 charge
      charger({ charge: true, legs: [1, -2, -1, 2], bob: -1, eye: 'r' }, elite),
      charger({ dizzy: 0, bob: 1, head: 1 }, elite), charger({ dizzy: 1, bob: 1, head: 1 }, elite), // 10-11 dizzy
      charger({ hurt: true, fwd: -1, head: -1 }, elite),                                            // 12 hurt
    ];
    sheet(scene, elite ? 'charger-elite' : 'charger', f, [
      ['idle', [0, 1], 3], ['move', [2, 3, 4, 5], 8], ['windup', [6, 7], 10], ['charge', [8, 9], 14],
      ['dizzy', [10, 11], 5], ['hurt', [12], 1],
    ]);
  }
}

// ============================================================================
// ARCHER — hooded bowman. Grid 16x22 (frame 18x24). Body 10x18.
// ============================================================================
type ArcherPose = 'idle0' | 'idle1' | 'walk0' | 'walk1' | 'walk2' | 'walk3' | 'draw' | 'release' | 'hurt';
function archer(pose: ArcherPose, elite: boolean): P {
  const p = new P(16, 22);
  const cloak = elite ? 'Wcr' : 'PML';
  const trim = elite ? 'g' : 'L';
  const wood = elite ? 'yg' : 'bl';
  const lean = pose === 'hurt' ? -1 : 0;
  const bob = pose === 'idle1' || pose === 'walk1' || pose === 'walk3' ? 1 : 0;
  // legs
  const legOff: Record<string, [number, number]> = { walk0: [-1, 1], walk2: [1, -1] };
  const [la, lb] = legOff[pose] ?? [0, 0];
  p.box(5 + la, 17, 2, 5, 'ubb').box(8 + lb, 17, 2, 5, 'ubl');
  p.set(5 + la, 21, 'n').set(6 + la, 21, 'n').set(8 + lb, 21, 'n').set(9 + lb, 21, 'n').set(10 + lb, 21, 'n');
  const y0 = bob;
  // quiver on back
  p.box(2 + lean, 8 + y0, 2, 7, 'ubl');
  p.set(2 + lean, 7 + y0, 'm').set(3 + lean, 6 + y0, 'w').set(2 + lean, 6 + y0, 'r');
  // cloak
  p.poly([[4 + lean, 7 + y0], [11 + lean, 7 + y0], [12.5 + lean, 18], [3 + lean, 18]], cloak);
  for (let x = 3; x <= 12; x += 2) p.clear(x + lean, 17);
  p.line(4 + lean, 13 + y0, 11 + lean, 13 + y0, 'u'); // belt
  p.set(9 + lean, 13 + y0, elite ? 'g' : 'd');
  // hood
  p.ell(7.5 + lean, 4.6 + y0, 4.1, 4.2, cloak);
  p.set(4 + lean, 0 + y0, cloak[1]).set(4 + lean, 1 + y0, cloak[1]).set(3 + lean, 1 + y0, cloak[0]);
  // face opening
  p.ell(9.6 + lean, 5.2 + y0, 2.2, 2.1, 'nnn');
  if (pose === 'hurt') p.set(9 + lean, 5 + y0, 'x').set(11 + lean, 5 + y0, 'x');
  else p.set(9 + lean, 5 + y0, elite ? 'w' : 'g').set(11 + lean, 5 + y0, elite ? 'w' : 'g');
  p.line(6 + lean, 1 + y0, 9 + lean, 1 + y0, trim);
  if (elite) p.stamp(['g.g', 'ggg'], 6 + lean, -1 + y0);
  // bow + arms
  const bow = (bx: number, top: number, bot: number, stringX: number | null) => {
    const mid = (top + bot) / 2;
    for (let y = top; y <= bot; y++) {
      const k = Math.abs(y - mid) / ((bot - top) / 2);
      const x = bx + (k > 0.75 ? 0 : k > 0.35 ? 1 : 2);
      p.set(x, y, k < 0.2 ? wood[1] : wood[0]);
    }
    if (stringX === null) p.line(bx, top, bx, bot, 'm');
    else {
      p.line(bx, top, stringX, Math.round(mid), 'm').line(stringX, Math.round(mid), bx, bot, 'm');
    }
  };
  if (pose === 'draw') {
    bow(12 + lean, 6 + y0, 16 + y0, 8);
    p.line(8, 11 + y0, 15, 11 + y0, 'a').set(15, 11 + y0, 'w').set(8, 11 + y0, 'r');
    p.set(8, 10 + y0, 'd').set(12, 11 + y0, 'd'); // hands
  } else if (pose === 'release') {
    bow(13, 6 + y0, 16 + y0, null);
    p.line(9, 11 + y0, 12, 11 + y0, cloak[0]).set(13, 11 + y0, 'd');
    p.set(15, 9 + y0, 'w').set(15, 13 + y0, 'w');
  } else {
    bow(11 + lean, 7 + y0, 17 + y0, null);
    p.set(11 + lean, 12 + y0, 'd');
  }
  return p;
}

function registerArcher(scene: Phaser.Scene): void {
  const poses: ArcherPose[] = ['idle0', 'idle1', 'walk0', 'walk1', 'walk2', 'walk3', 'draw', 'release', 'hurt'];
  for (const elite of [false, true])
    sheet(scene, elite ? 'archer-elite' : 'archer', poses.map((ps) => archer(ps, elite)), [
      ['idle', [0, 1], 3], ['move', [2, 3, 4, 5], 8], ['draw', [6], 1], ['release', [7], 1], ['hurt', [8], 1],
    ]);
}

// ============================================================================
// FLYER — wisp-bat. Grid 18x14 (frame 20x16). Body 12x10.
// ============================================================================
type FlyerPose = 0 | 1 | 2 | 3 | 'windup' | 'dive' | 'hurt';
function flyer(pose: FlyerPose, elite: boolean): P {
  const p = new P(18, 14);
  const body = elite ? 'Wcr' : 'pGK';
  const wing = elite ? 'nWc' : 'nVp';
  const cx = 8.5, cy = 8.5;
  // wings: hand-drawn left wing per pose (shoulder at right edge), mirrored for the right wing
  const W: Record<string, [Frame, number]> = {
    up: [['p.......', 'Vp......', 'VVp.....', 'nVVp....', 'nVVVp...', '.nVVVpp.', '.n.nVVVp', '.....nVV'], 0],
    mid: [['ppp.....', 'VVVppp..', 'nVVVVVpp', 'nVnVVVVV', 'n.n.nVVV'], 4],
    down: [['......pp', '...ppVVV', '.pVVVVVV', 'pVVVnVVn', 'VVn.n.n.', 'Vn......', 'n.......'], 6],
    fold: [['...p....', '..pV....', '.pVV....', 'pVVn....', 'VVn.....'], 3],
  };
  const pick = pose === 0 || pose === 'windup' ? 'up' : pose === 2 || pose === 'hurt' ? 'down' : pose === 'dive' ? 'fold' : 'mid';
  const [wf, wy] = W[pick];
  const wingRows = wf.map((r) => r.replace(/n/g, wing[0]).replace(/V/g, wing[1]).replace(/p/g, wing[2]));
  const dy = pose === 'windup' ? -1 : 0;
  if (pick === 'fold') {
    p.stamp(wingRows.map((r) => r.replace(new RegExp(wing[2], 'g'), wing[0])), 3, wy - 1);
    p.stamp(wingRows, 1, wy);
  } else {
    p.stamp(wingRows, 0, wy + dy);
    p.stamp(wingRows, 10, wy + dy, true);
  }
  // body
  p.ellV(cx, cy, 3.9, 3.7, body + 'w');
  // ears / horns
  if (elite) {
    p.set(6, 4, 'g').set(5, 3, 'g').set(11, 4, 'g').set(12, 3, 'g');
  } else {
    p.set(6, 5, body[0]).set(6, 4, body[1]).set(11, 5, body[0]).set(11, 4, body[1]);
  }
  // face (looking right)
  const eye = pose === 'windup' || pose === 'dive' ? 'r' : elite ? 'g' : 'g';
  if (pose === 'hurt') p.set(9, 8, 'x').set(11, 8, 'x');
  else p.set(9, 8, eye).set(11, 8, eye).set(9, 7, 'x').set(11, 7, 'x');
  p.set(10, 10, 'w').set(11, 10, pose === 'windup' || pose === 'dive' ? 'w' : body[0]);
  return p;
}

function registerFlyer(scene: Phaser.Scene): void {
  const poses: FlyerPose[] = [0, 1, 2, 3, 'windup', 'dive', 'hurt'];
  for (const elite of [false, true])
    sheet(scene, elite ? 'flyer-elite' : 'flyer', poses.map((ps) => flyer(ps, elite)), [
      ['fly', [0, 1, 2, 3], 12], ['windup', [4, 1], 14], ['dive', [5], 1], ['hurt', [6], 1],
    ]);
}

// ============================================================================
// KNIGHT — armored spearman. Grid 30x24 (frame 32x26). Body 14x22.
// Shield is a separate texture ('shield' / 'shield-elite').
// ============================================================================
type KnightPose = 'idle0' | 'idle1' | 'walk0' | 'walk1' | 'walk2' | 'walk3' | 'windup' | 'thrust' | 'recover' | 'hurt';
function knight(pose: KnightPose, elite: boolean): P {
  const p = new P(30, 24);
  const steel = elite ? 'nstm' : 'samw';
  const tab = elite ? 'Wcr' : 'NBS';
  const plume = elite ? 'yg' : 'cr';
  const lean = pose === 'windup' || pose === 'hurt' ? -1 : pose === 'thrust' ? 1 : 0;
  const bob = pose === 'idle1' || pose === 'walk1' || pose === 'walk3' || pose === 'recover' ? 1 : 0;
  const legs: Record<string, [number, number]> = { walk0: [-1, 1], walk2: [1, -1], thrust: [-2, 2], windup: [-1, 0] };
  const [la, lb] = legs[pose] ?? [0, 0];
  // spear behind body when upright
  const spear = (x0: number, y0: number, x1: number, y1: number) => {
    p.line(x0, y0, x1, y1, elite ? 'b' : 'b');
    const dx = Math.sign(x1 - x0), dy = Math.sign(y1 - y0);
    p.set(x1 + dx, y1 + dy, steel[2]).set(x1 + 2 * dx, y1 + 2 * dy, 'w');
    if (dy === 0) p.set(x1 + dx, y1 - 1, steel[1]).set(x1 + dx, y1 + 1, steel[1]);
    else if (dx === 0) p.set(x1 - 1, y1 + dy, steel[1]).set(x1 + 1, y1 + dy, steel[1]);
    else p.set(x1, y1 + dy, steel[1]).set(x1 + dx, y1, steel[1]);
  };
  if (pose.startsWith('idle') || pose.startsWith('walk') || pose === 'hurt') spear(10 + lean, 21, 10 + lean, 2 + bob);
  // legs
  p.box(11 + la, 18, 3, 6, steel).box(16 + lb, 18, 3, 6, steel);
  if (elite) p.set(12 + la, 19, 'g').set(17 + lb, 19, 'g');
  p.rect(11 + la, 23, 4, 1, 'n').rect(16 + lb, 23, 4, 1, 'n');
  const y0 = bob;
  // torso
  p.box(10 + lean, 9 + y0, 10, 10, steel);
  // tabard
  p.box(12 + lean, 11 + y0, 6, 9 - y0, tab);
  p.line(11 + lean, 15 + y0, 18 + lean, 15 + y0, 'u').set(15 + lean, 15 + y0, elite ? 'g' : 'y');
  // shoulder
  p.ellV(12 + lean, 10 + y0, 2.8, 2.2, steel);
  // helmet
  const hy = (pose === 'recover' ? 1 : 0) + y0;
  p.ellV(15 + lean, 5.5 + hy, 4.2, 4.3, steel);
  p.box(11 + lean, 6 + hy, 8, 4, steel);
  p.line(15 + lean, 6 + hy, 18 + lean, 6 + hy, 'n');
  if (pose !== 'hurt') p.set(17 + lean, 6 + hy, elite ? 'g' : 'r').set(18 + lean, 6 + hy, elite ? 'w' : 'o');
  p.line(16 + lean, 8 + hy, 18 + lean, 8 + hy, steel[0]);
  // plume
  p.set(13 + lean, 1 + hy, plume[1]).set(12 + lean, 0 + hy, plume[1]).set(11 + lean, 0 + hy, plume[0]).set(10 + lean, 1 + hy, plume[0]).set(9 + lean, 2 + hy, plume[0]);
  p.set(14 + lean, 1 + hy, plume[1]).set(12 + lean, 1 + hy, plume[0]);
  if (elite) p.stamp(CROWN, 13 + lean, -1 + hy);
  // spear poses
  if (pose === 'windup') {
    spear(0, 12, 17, 12);
    p.set(11, 12, steel[1]).set(16, 12, steel[1]);
  } else if (pose === 'thrust') {
    spear(9, 12, 27, 12);
    p.set(13, 12, steel[1]).set(20, 12, steel[1]);
    p.set(29, 10, 'w').set(29, 14, 'w');
  } else if (pose === 'recover') {
    spear(11, 13, 25, 21);
    p.set(12, 13, steel[1]);
  }
  return p;
}

function shieldArt(elite: boolean): P {
  const p = new P(6, 16);
  const rim = elite ? 'yg' : 'sa';
  const face = elite ? 'Wcr' : 'NBS';
  const test: Test = (x, y) => {
    if (y < 0 || y > 15 || x < 0 || x > 5) return false;
    if (y >= 11) {
      const inset = Math.floor((y - 10) / 2);
      return x >= inset && x <= 5 - inset;
    }
    return true;
  };
  p.shape(test, rim[0] + rim[1] + rim[1]);
  p.shape((x, y) => test(x, y) && test(x - 1, y) && test(x + 1, y) && test(x, y - 1) && test(x, y + 1), face);
  const em = elite ? 'g' : 'm';
  p.line(2, 4, 2, 10, em).line(3, 4, 3, 10, em).line(1, 6, 4, 6, em);
  return p;
}

function registerKnight(scene: Phaser.Scene): void {
  const poses: KnightPose[] = ['idle0', 'idle1', 'walk0', 'walk1', 'walk2', 'walk3', 'windup', 'thrust', 'recover', 'hurt'];
  for (const elite of [false, true]) {
    sheet(scene, elite ? 'knight-elite' : 'knight', poses.map((ps) => knight(ps, elite)), [
      ['idle', [0, 1], 2], ['move', [2, 3, 4, 5], 6], ['windup', [6], 1], ['thrust', [7], 1], ['recover', [8], 1], ['hurt', [9], 1],
    ]);
    sheet(scene, elite ? 'shield-elite' : 'shield', [shieldArt(elite)], []);
  }
}

// ============================================================================
// BOMBER — goblin with bomb satchel. Grid 16x20 (frame 18x22). Body 12x18.
// ============================================================================
type BomberPose = 'idle0' | 'idle1' | 'walk0' | 'walk1' | 'walk2' | 'walk3' | 'windup0' | 'windup1' | 'throw' | 'hurt';
function bomber(pose: BomberPose, elite: boolean): P {
  const p = new P(16, 20);
  const skin = elite ? 'Wcr' : 'MLi';
  const tunic = elite ? 'nst' : 'ubl';
  const lean = pose === 'hurt' ? -1 : pose === 'throw' ? 1 : 0;
  const bob = pose === 'idle1' || pose === 'walk1' || pose === 'walk3' ? 1 : 0;
  const legs: Record<string, [number, number]> = { walk0: [-1, 1], walk2: [1, -1], throw: [-1, 1] };
  const [la, lb] = legs[pose] ?? [0, 0];
  p.box(5 + la, 16, 2, 4, 'unn').box(8 + lb, 16, 2, 4, 'unn');
  p.set(4 + la, 19, 'n').set(10 + lb, 19, 'n');
  const y0 = bob;
  // satchel with bombs
  p.box(1 + lean, 10 + y0, 4, 5, 'bld');
  p.ellV(2 + lean, 9.5 + y0, 1.6, 1.6, 'nst').ellV(4.3 + lean, 9.2 + y0, 1.5, 1.5, 'nst');
  p.set(4 + lean, 7 + y0, 'y').set(2 + lean, 7 + y0, 'd');
  // body
  p.ellV(7.5 + lean, 13.5 + y0, 3.7, 3.1, tunic);
  p.line(4 + lean, 14 + y0, 11 + lean, 14 + y0, elite ? 'g' : 'n');
  p.line(4 + lean, 9 + y0, 6 + lean, 14 + y0, elite ? 'g' : 'b'); // strap
  // head
  p.ellV(8.5 + lean, 6 + y0, 4.6, 3.9, skin);
  // ears
  p.line(1 + lean, 4 + y0, 4 + lean, 5 + y0, skin[1]).set(2 + lean, 5 + y0, skin[0]);
  p.line(12 + lean, 5 + y0, 15 + lean, 3 + y0, skin[1]).set(13 + lean, 5 + y0, skin[0]);
  // face
  if (pose === 'hurt') p.set(10 + lean, 5 + y0, 'x').set(11 + lean, 5 + y0, 'x');
  else p.set(10 + lean, 5 + y0, 'w').set(11 + lean, 5 + y0, 'x').set(10 + lean, 4 + y0, skin[0]).set(11 + lean, 4 + y0, skin[0]);
  p.set(12 + lean, 7 + y0, skin[2]).set(13 + lean, 7 + y0, skin[1]);
  p.set(10 + lean, 8 + y0, 'w').set(11 + lean, 8 + y0, 'x').set(12 + lean, 8 + y0, 'w');
  // hat / crown
  if (elite) p.stamp(CROWN, 6 + lean, 0 + y0);
  else p.line(6 + lean, 2 + y0, 10 + lean, 2 + y0, 'b').set(9 + lean, 1 + y0, 'b').set(8 + lean, 1 + y0, 'l');
  // arms
  if (pose === 'windup0' || pose === 'windup1') {
    p.line(10, 10 + y0, 12, 4, skin[1]);
    p.ellV(12.5, 2.5, 2, 2, 'nst');
    p.set(13, 0, pose === 'windup0' ? 'g' : 'w').set(14, 0, pose === 'windup0' ? 'o' : 'g');
    if (pose === 'windup1') p.set(15, 1, 'y').set(12, 0, 'y');
  } else if (pose === 'throw') {
    p.line(10 + lean, 11, 14, 10, skin[1]).set(15, 10, skin[2]);
  } else {
    p.line(10 + lean, 11 + y0, 11 + lean, 13 + y0, skin[1]);
  }
  return p;
}

function registerBomber(scene: Phaser.Scene): void {
  const poses: BomberPose[] = ['idle0', 'idle1', 'walk0', 'walk1', 'walk2', 'walk3', 'windup0', 'windup1', 'throw', 'hurt'];
  for (const elite of [false, true])
    sheet(scene, elite ? 'bomber-elite' : 'bomber', poses.map((ps) => bomber(ps, elite)), [
      ['idle', [0, 1], 3], ['move', [2, 3, 4, 5], 7], ['windup', [6, 7], 12], ['throw', [8], 1], ['hurt', [9], 1],
    ]);
}

// ============================================================================
// PROJECTILES (enemy-side): arrow, bomb, orb + shared FX (death pop, '!' alert)
// ============================================================================
function registerProjectiles(scene: Phaser.Scene): void {
  // arrow — grid 12x3 (frame 14x5)
  const arrow = (flutter: number): P => {
    const p = new P(12, 3);
    p.line(2, 1, 9, 1, 'l');
    p.set(10, 1, 'm').set(11, 1, 'w').set(10, 0, 'a').set(10, 2, 'a');
    p.set(0, flutter ? 0 : 1, 'r').set(1, 0, 'w').set(1, 2, flutter ? 'r' : 'w').set(0, 2, flutter ? '.' : 'r');
    return p;
  };
  sheet(scene, 'arrow', [arrow(0), arrow(1)], [['fly', [0, 1], 12]]);

  // bomb — grid 10x11 (frame 12x13): fuse sparkle
  const bomb = (k: number): P => {
    const p = new P(10, 11);
    // light steel body that blinks red so it reads on dark W2/W3 backgrounds
    p.ellV(4.5, 6.5, 4, 4, k === 1 ? 'Wcrw' : 'samw');
    p.box(3, 1, 3, 2, 'tam');
    p.set(6, 1, 'd').set(7, 0, 'd');
    const spark = [['g', 'w', 'o'], ['w', 'g', 'y'], ['o', 'y', 'g']][k];
    p.set(8, 0, spark[0]).set(9, 0, spark[2]).set(8, 1, spark[1]);
    if (k === 1) p.set(9, 1, 'y');
    if (k === 2) p.set(7, 1, 'o');
    p.set(6, 8, 'r').set(5, 9, 'r');
    return p;
  };
  sheet(scene, 'bomb', [bomb(0), bomb(1), bomb(2)], [['fly', [0, 1, 2], 14]]);

  // orb — grid 10x10 (frame 12x12): pulsing hex orb
  const orb = (k: number): P => {
    const p = new P(10, 10);
    const r = [4.6, 4.9, 4.6, 4.2][k];
    p.ellV(5, 5, r, r, 'WGKw');
    p.ellV(5, 5, r - 1.8, r - 1.8, 'GKww');
    p.set(5, 5, 'w');
    return p;
  };
  sheet(scene, 'orb', [orb(0), orb(1), orb(2), orb(3)], [['fly', [0, 1, 2, 3], 12]]);

  // death pop (no outline, white shades -> tinted per enemy). 24x24
  const pop = (k: number): P => {
    const p = new P(24, 24);
    const c = 11.5;
    if (k === 0) p.ellV(c + 0.5, c + 0.5, 4, 4, 'mww');
    else if (k === 1) {
      p.ellV(c + 0.5, c + 0.5, 7, 7, 'amw');
      p.ellV(c + 0.5, c + 0.5, 4, 4, 'www');
    } else {
      const R = [0, 0, 8, 9.5, 10.5, 11][k];
      const rr = [0, 0, 3, 2.4, 1.6, 0.9][k];
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2 + k * 0.2;
        const x = c + 0.5 + Math.cos(a) * R * (i % 2 ? 0.8 : 1);
        const y = c + 0.5 + Math.sin(a) * R * (i % 2 ? 0.8 : 1);
        p.ellV(x, y, rr, rr, k < 4 ? 'amw' : 'mmw');
      }
      if (k === 2) p.ellV(c + 0.5, c + 0.5, 3, 3, 'mww');
    }
    return p;
  };
  drawSheet(scene, 'enemy-pop', [0, 1, 2, 3, 4, 5].map((k) => pop(k).rows()), EPAL, { outline: false });
  defineAnim(scene, 'enemy-pop', 'enemy-pop', [0, 1, 2, 3, 4, 5], 18, 0);

  // '!' telegraph alert — grid 3x8 (frame 5x10)
  drawSheet(scene, 'alert', [['ggg', 'ggg', 'gyg', '.g.', '.y.', '...', 'ggg', 'yyy'], ['rrr', 'rrr', 'ror', '.r.', '.o.', '...', 'rrr', 'ooo']], EPAL);
  defineAnim(scene, 'alert-blink', 'alert', [0, 1], 12);
}

/** Enemy sheets + animations (owner: Agent B). */
export function registerEnemyArt(scene: Phaser.Scene): void {
  registerSlime(scene);
  registerCharger(scene);
  registerArcher(scene);
  registerFlyer(scene);
  registerKnight(scene);
  registerBomber(scene);
  registerProjectiles(scene);
}
