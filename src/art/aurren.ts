import Phaser from 'phaser';
import { P, sheet } from './enemies';
import { limb } from './bosses';
import { drawCanvas } from './pixel';

// ============================================================================
// AURREN, THE FIRST BLADE — the hollow hero who sealed the Hollow Deep.
// Blade form: grid 46x46 (frame 48x48), art faces right, body 16x30 bottom-centred
// (feet on grid row 45). Tarnished silver armour, a broken halo behind the helm, a long
// faded-gold scarf and a straight greatsword. Three sheets, same layout / anim names:
//   'aurren'     P1: cold cyan visor, dim halo, plain steel blade
//   'aurren-p2'  P2: blade ignited (amber/gold), amber visor
//   'aurren-p3'  P3: armour cracked with light, white visor, full gold halo
// Anims '<sheet>-<name>': idle run windup slash slash2 dash stance crouch rise dive stuck
//   plant kneel stun overhead
//
// Sun form 'aurren-sun' / 'aurren-sun-p5': grid 70x70 (frame 72x72), floating colossus,
// the sun core sits in the frame centre (body 40x44 centred on it).
// Anims: hover windup cast fall coreopen stun
//
// Extras: 'aurren-wave' (crescent, anim 'aurren-wave-fly'), 'aurren-sword' (orbit / thrown
// sword pointing right), 'sun-ember' (anim 'sun-ember-fly'), 'sun-disc' (additive halo),
// 'sun-flare' (horizontal beam profile, stretch to size).
// ============================================================================

type Pt = [number, number];

interface KPal {
  armor: string; // ramp dark,mid,light,hi
  dark: string; // back limbs
  cloth: string; // tabard / skirt
  scarf: string;
  blade: string;
  edge: string;
  hilt: string;
  eye: string;
  halo: string; // 1-2 chars: dim, bright
  haloFull: boolean;
  crack?: string;
}

const KPAL: Record<'p1' | 'p2' | 'p3', KPal> = {
  p1: { armor: 'Ztam', dark: 'zZht', cloth: 'NBSB', scarf: 'byge', blade: 'tamw', edge: 'w', hilt: 'ubl', eye: 'Q', halo: 'ja', haloFull: false },
  p2: { armor: 'Ztam', dark: 'zZht', cloth: 'NBSB', scarf: 'byge', blade: 'oyge', edge: 'w', hilt: 'ubl', eye: 'y', halo: 'yg', haloFull: false },
  p3: { armor: 'zhtm', dark: 'zZhH', cloth: 'WcrK', scarf: 'ygew', blade: 'ygew', edge: 'w', hilt: 'Wcy', eye: 'w', halo: 'ge', haloFull: true, crack: 'g' },
};

interface KPose {
  by?: number; // crouch / bob (torso drop)
  lean?: number; // torso + head shift
  legs?: [number, number]; // ankle x (back, front)
  lift?: [number, number]; // ankle lift
  back: Pt; // back hand
  front: Pt; // sword hand
  /** sword angle (radians, 0 = forward/right, PI/2 = down); len default 20 */
  sa: number;
  slen?: number;
  behind?: boolean;
  scarf?: number; // flutter phase 0..2; 3 = streaming straight back (dash)
  eye?: 'on' | 'hot' | 'dim' | 'x';
  kneel?: boolean;
  aura?: boolean; // stance: gold glints around the blade
}

const KPOSES: Record<string, KPose> = {
  idle0: { back: [16, 31], front: [29, 30], sa: 0.95, scarf: 0 },
  idle1: { by: 1, back: [16, 32], front: [29, 31], sa: 0.95, scarf: 1 },
  run0: { lean: 2, legs: [13, 31], lift: [2, 0], back: [27, 27], front: [15, 28], sa: 2.7, scarf: 2, behind: true },
  run1: { lean: 2, by: 1, legs: [20, 25], lift: [0, 3], back: [26, 28], front: [17, 29], sa: 2.6, scarf: 0, behind: true },
  windup: { lean: -1, legs: [16, 28], back: [15, 22], front: [19, 14], sa: -2.35, scarf: 1, eye: 'hot' },
  slash: { lean: 3, legs: [13, 32], back: [15, 27], front: [36, 23], sa: 0.05, slen: 22, scarf: 3, eye: 'hot' },
  slash2: { lean: 2, legs: [14, 31], back: [16, 26], front: [33, 15], sa: -0.75, slen: 22, scarf: 2, eye: 'hot' },
  dash: { by: 4, lean: 5, legs: [9, 33], back: [13, 30], front: [38, 27], sa: 0.04, slen: 22, scarf: 3, eye: 'hot' },
  stance: { by: 2, legs: [14, 30], back: [27, 24], front: [30, 27], sa: -1.57, slen: 21, scarf: 1, eye: 'hot', aura: true },
  crouch: { by: 5, legs: [14, 30], back: [14, 33], front: [18, 34], sa: 2.5, scarf: 2, behind: true, eye: 'hot' },
  rise: { lean: 1, legs: [18, 26], lift: [5, 7], back: [16, 22], front: [28, 7], sa: -1.45, slen: 22, scarf: 3, eye: 'hot' },
  dive: { by: -2, legs: [19, 25], lift: [4, 4], back: [17, 22], front: [25, 34], sa: 1.57, slen: 21, scarf: 3, eye: 'hot' },
  stuck: { by: 5, lean: 3, legs: [12, 30], back: [21, 33], front: [29, 36], sa: 1.35, slen: 13, scarf: 0, eye: 'dim' },
  plant: { legs: [16, 28], back: [24, 27], front: [26, 27], sa: 1.57, slen: 17, scarf: 1, eye: 'hot' },
  kneel: { by: 8, lean: 2, legs: [14, 30], lift: [0, 0], back: [18, 38], front: [31, 38], sa: 1.2, slen: 7, scarf: 0, eye: 'dim', kneel: true },
  stun: { lean: -2, legs: [16, 29], back: [12, 30], front: [27, 33], sa: 1.25, scarf: 0, eye: 'x' },
  overhead: { lean: -1, legs: [15, 29], back: [20, 8], front: [22, 6], sa: -1.75, slen: 22, scarf: 2, eye: 'hot', aura: true },
};

function knight(o: KPose, pal: KPal): P {
  const p = new P(46, 46);
  const by = o.by ?? 0;
  const ln = o.lean ?? 0;
  const [la, lb] = o.legs ?? [17, 27];
  const [lfa, lfb] = o.lift ?? [0, 0];
  const cx = 22 + ln;

  // ---- broken halo behind the helm
  const hx = cx - 1, hy = 11 + by;
  for (let k = 0; k < 28; k++) {
    const t = (k / 28) * Math.PI * 2;
    if (!pal.haloFull && (k % 9 === 3 || k % 9 === 4)) continue; // broken gaps
    p.set(hx + Math.cos(t) * 8.5, hy + Math.sin(t) * 8.5, k % 3 === 0 ? pal.halo[1] ?? pal.halo[0] : pal.halo[0]);
  }

  // ---- scarf trailing back from the neck
  const sc = o.scarf ?? 0;
  const nx = cx - 2, ny = 17 + by;
  for (let i = 0; i < 15; i++) {
    const u = i / 14;
    const wave = sc === 3 ? 0 : Math.sin(u * 5 + sc * 2.1) * 2 * u;
    const droop = sc === 3 ? u * 2 : u * u * 9;
    const x = nx - i * (sc === 3 ? 1.15 : 0.85);
    const y = ny + droop + wave;
    const c = pal.scarf[Math.min(pal.scarf.length - 1, i < 3 ? 1 : i % 4 === 0 ? 0 : 2)];
    p.set(x, y, c).set(x, y + 1, pal.scarf[0]);
  }

  const sword = () => {
    const len = o.slen ?? 20;
    const [fx, fy] = o.front;
    const c = Math.cos(o.sa), s = Math.sin(o.sa);
    // pommel + grip behind the hand
    p.line(fx - c * 3, fy - s * 3, fx, fy, pal.hilt[0]);
    p.set(fx - c * 4, fy - s * 4, pal.hilt[2] ?? pal.hilt[1]);
    // crossguard
    const gx = fx + c * 1.5, gy = fy + s * 1.5;
    p.line(gx - s * 3, gy + c * 3, gx + s * 3, gy - c * 3, pal.hilt[1]);
    // blade: 2 px wide, dark spine + light edge, bright tip
    for (let i = 2; i <= len; i++) {
      const x = fx + c * i, y = fy + s * i;
      p.set(x, y, pal.blade[1]);
      p.set(x - s * 1, y + c * 1, i % 5 === 0 ? pal.blade[3] : pal.blade[2]);
    }
    p.set(fx + c * (len + 1), fy + s * (len + 1), pal.edge);
    if (o.slen !== undefined && o.slen < 10) {
      // broken: jagged end
      p.set(fx + c * (len + 1) + s, fy + s * (len + 1) - c, pal.blade[0]);
    }
    if (o.aura) {
      for (const k of [6, 12, 18]) p.set(fx + c * k + s * 3, fy + s * k - c * 3, 'g').set(fx + c * k - s * 4, fy + s * k + c * 4, 'e');
    }
  };

  // ---- back arm (behind the body)
  const bsx = cx - 4, bsy = 19 + by;
  limb(p, bsx, bsy, o.back[0], o.back[1], 2.1, pal.dark);
  if (o.behind) sword();

  // ---- legs
  const hipY = 31 + by;
  const leg = (hx2: number, ax: number, lift: number, ramp: string, kneelDown: boolean) => {
    const ay = 42 - lift;
    if (kneelDown) {
      // knee on the ground, shin flat behind
      limb(p, hx2, hipY, hx2 + 1, 43, 2.6, ramp);
      limb(p, hx2 + 1, 43, hx2 - 6, 43, 2.2, ramp);
      return;
    }
    const kx = (hx2 + ax) / 2 + (by > 2 ? 2 : 0.5), ky = (hipY + ay) / 2 - (by > 2 ? 1 : 0);
    limb(p, hx2, hipY, kx, ky, 2.6, ramp);
    limb(p, kx, ky, ax, ay, 2.3, ramp);
    p.box(ax - 3, ay + 1, 7, 3, ramp.length >= 3 ? ramp.slice(0, 3) : ramp);
    p.line(ax - 3, ay + 3, ax + 3, ay + 3, 'z');
  };
  leg(cx - 3, la, lfa, pal.dark, !!o.kneel);
  leg(cx + 2, lb, lfb, pal.armor, false);

  // ---- tabard skirt
  p.poly([[cx - 6, hipY - 3], [cx + 6, hipY - 3], [cx + 7, hipY + 5], [cx + 1, hipY + 7], [cx - 7, hipY + 5]], pal.cloth);
  p.line(cx - 6, hipY - 2, cx + 6, hipY - 2, 'u');
  p.set(cx, hipY - 2, 'g');

  // ---- torso (breastplate)
  p.ellV(cx, 23 + by, 6.2, 7, pal.armor);
  p.line(cx - 2, 19 + by, cx + 1, 27 + by, pal.armor[0]);
  if (pal.crack) p.line(cx + 2, 20 + by, cx - 1, 24 + by, pal.crack).line(cx - 1, 24 + by, cx + 2, 28 + by, pal.crack).set(cx - 3, 21 + by, pal.crack);

  // ---- pauldrons
  p.ellV(cx - 5, 18 + by, 3.4, 3, pal.armor);
  p.ellV(cx + 5, 18 + by, 3.6, 3.2, pal.armor);

  // ---- helm
  const hdy = o.kneel ? 3 : 0;
  const hcx = cx + 1 + (o.kneel ? 1 : 0), hcy = 11 + by + hdy;
  p.ellV(hcx, hcy, 4.6, 5.2, pal.armor);
  p.line(hcx - 3, hcy - 5, hcx + 2, hcy - 6, pal.armor[2]); // crest
  // visor slit (faces right)
  const eye = o.eye ?? 'on';
  const ec = eye === 'dim' ? pal.armor[1] : eye === 'hot' ? 'w' : pal.eye;
  if (eye === 'x') p.set(hcx + 1, hcy - 1, pal.eye).set(hcx + 3, hcy + 1, pal.eye).set(hcx + 2, hcy, pal.eye).set(hcx + 3, hcy - 1, pal.eye).set(hcx + 1, hcy + 1, pal.eye);
  else {
    p.line(hcx, hcy, hcx + 4, hcy, 'z');
    p.line(hcx + 1, hcy, hcx + 3, hcy, ec);
    if (eye === 'hot') p.set(hcx + 4, hcy, pal.eye);
  }
  if (pal.crack) p.set(hcx - 2, hcy - 2, pal.crack).set(hcx - 1, hcy + 2, pal.crack);

  // ---- front arm + sword
  const fsx = cx + 5, fsy = 19 + by;
  limb(p, fsx, fsy, o.front[0], o.front[1], 2.2, pal.armor);
  if (!o.behind) sword();
  p.ellV(o.front[0], o.front[1], 1.8, 1.8, pal.dark);
  return p;
}

// ============================================================================
// Sun form
// ============================================================================
interface SPal {
  armor: string;
  dark: string;
  robe: string; // light robe ramp
  core: string; // open core ramp
  seam: string;
  ray: string;
  eye: string;
}
const SPAL: Record<'p4' | 'p5', SPal> = {
  p4: { armor: 'ubld', dark: 'Zubl', robe: 'ygew', core: 'gew' + 'w', seam: 'g', ray: 'yg', eye: 'w' },
  p5: { armor: 'Wcoy', dark: 'zWco', robe: 'oyge', core: 'gew' + 'w', seam: 'e', ray: 'ge', eye: 'Q' },
};

interface SPose {
  back: Pt; // left hand
  front: Pt; // right hand
  bob?: number;
  core: 'closed' | 'open';
  eye?: 'on' | 'x' | 'dim';
  head?: number; // head drop
  robe?: number; // robe phase
}
const SPOSES: Record<string, SPose> = {
  hover0: { back: [16, 47], front: [54, 47], core: 'closed', robe: 0 },
  hover1: { back: [15, 46], front: [55, 46], bob: 1, core: 'closed', robe: 1 },
  hover2: { back: [16, 45], front: [54, 45], bob: 2, core: 'closed', robe: 2 },
  windup: { back: [14, 13], front: [56, 13], core: 'closed', robe: 1 },
  cast: { back: [5, 31], front: [65, 31], core: 'closed', robe: 2 },
  fall: { back: [27, 9], front: [43, 9], bob: -2, core: 'closed', robe: 0 },
  coreopen: { back: [21, 56], front: [49, 56], bob: 3, core: 'open', eye: 'dim', head: 2, robe: 1 },
  stun: { back: [18, 55], front: [52, 53], bob: 3, core: 'open', eye: 'x', head: 3, robe: 2 },
};

function sunForm(o: SPose, pal: SPal): P {
  const p = new P(70, 70);
  const b = o.bob ?? 0;
  const cx = 35, cy = 35 + b; // core = frame centre
  const hd = o.head ?? 0;

  // ---- crown of rays (behind the helm)
  for (let k = 0; k < 9; k++) {
    const a = -Math.PI + 0.25 + (k / 8) * (Math.PI - 0.5);
    const len = k % 2 ? 9 : 13;
    const x0 = cx + Math.cos(a) * 9, y0 = cy - 16 + hd + Math.sin(a) * 8;
    p.line(x0, y0, x0 + Math.cos(a) * len, y0 + Math.sin(a) * len, pal.ray[k % 2]);
  }

  // ---- robe of light trailing below
  const rp = o.robe ?? 0;
  p.poly([[cx - 12, cy + 6], [cx + 12, cy + 6], [cx + 9, cy + 18], [cx + 4 + rp, cy + 30], [cx, cy + 34 - rp], [cx - 4 + rp, cy + 28], [cx - 9, cy + 18]], pal.robe);
  for (let i = 0; i < 6; i++) {
    const y = cy + 20 + i * 2.5;
    const x = cx + Math.sin(i * 1.7 + rp * 2) * 6;
    p.set(x, y, pal.robe[3]).set(x + 1, y + 1, pal.robe[2]);
  }

  // ---- arms (behind the pauldrons)
  const arm = (sx: number, sy: number, h: Pt) => {
    const ex = (sx + h[0]) / 2 + (h[1] < sy ? 0 : sx < cx ? -3 : 3);
    const ey = (sy + h[1]) / 2;
    limb(p, sx, sy, ex, ey, 3.6, pal.dark);
    limb(p, ex, ey, h[0], h[1] + b, 3.2, pal.armor);
    p.ellV(h[0], h[1] + b, 3.6, 3.6, pal.armor);
    p.set(h[0] - 1, h[1] + b - 1, pal.seam);
  };
  arm(cx - 13, cy - 7, o.back);
  arm(cx + 13, cy - 7, o.front);

  // ---- torso
  p.ellV(cx, cy, 13, 11, pal.armor);
  p.line(cx - 10, cy + 8, cx + 10, cy + 8, pal.armor[0]);

  // ---- core
  if (o.core === 'open') {
    // plates split apart, a blinding core
    p.ellV(cx, cy, 7, 6.5, 'yg' + 'ew');
    p.ellV(cx, cy, 4.5, 4.2, pal.core);
    p.rect(cx - 1, cy - 2, 3, 4, 'w');
    for (const [dx, dy] of [[-9, -6], [9, -6], [-10, 5], [10, 5]] as Pt[]) p.ellV(cx + dx, cy + dy, 3, 2.4, pal.dark);
  } else {
    // three plates with glowing seams
    p.ellV(cx, cy, 6.5, 6, pal.dark);
    p.line(cx, cy - 6, cx, cy + 6, pal.seam);
    p.line(cx - 6, cy + 1, cx + 6, cy - 1, pal.seam);
    p.set(cx, cy, 'w');
  }

  // ---- pauldrons
  p.ellV(cx - 13, cy - 8, 7, 5.5, pal.armor);
  p.ellV(cx + 13, cy - 8, 7, 5.5, pal.armor);
  p.line(cx - 18, cy - 6, cx - 9, cy - 4, pal.seam);
  p.line(cx + 9, cy - 4, cx + 18, cy - 6, pal.seam);

  // ---- helm
  const hy = cy - 17 + hd;
  p.ellV(cx, hy, 6.5, 7, pal.armor);
  p.line(cx, hy - 7, cx, hy - 2, pal.armor[3]);
  const eye = o.eye ?? 'on';
  if (eye === 'x') p.line(cx - 4, hy - 1, cx - 2, hy + 1, pal.eye).line(cx - 4, hy + 1, cx - 2, hy - 1, pal.eye).line(cx + 2, hy - 1, cx + 4, hy + 1, pal.eye).line(cx + 2, hy + 1, cx + 4, hy - 1, pal.eye);
  else {
    p.line(cx - 4, hy, cx + 4, hy, 'z');
    p.line(cx - 3, hy, cx + 3, hy, eye === 'dim' ? pal.armor[1] : pal.eye);
  }
  return p;
}

export function registerAurrenArt(scene: Phaser.Scene): void {
  // ---- blade form
  const kNames = ['idle0', 'idle1', 'run0', 'run1', 'windup', 'slash', 'slash2', 'dash', 'stance', 'crouch', 'rise', 'dive', 'stuck', 'plant', 'kneel', 'stun', 'overhead'];
  const ki = (n: string) => kNames.indexOf(n);
  const kAnims: [string, number[], number, number?][] = [
    ['idle', [ki('idle0'), ki('idle1')], 3],
    ['run', [ki('run0'), ki('run1')], 8],
    ...(['windup', 'slash', 'slash2', 'dash', 'stance', 'crouch', 'rise', 'dive', 'stuck', 'plant', 'kneel', 'stun', 'overhead'].map((n) => [n, [ki(n)], 1] as [string, number[], number])),
  ];
  for (const [key, pal] of [['aurren', KPAL.p1], ['aurren-p2', KPAL.p2], ['aurren-p3', KPAL.p3]] as const) {
    sheet(scene, key, kNames.map((n) => knight(KPOSES[n], pal)), kAnims);
  }

  // ---- sun form
  const sNames = ['hover0', 'hover1', 'hover2', 'windup', 'cast', 'fall', 'coreopen', 'stun'];
  const si = (n: string) => sNames.indexOf(n);
  const sAnims: [string, number[], number, number?][] = [
    ['hover', [si('hover0'), si('hover1'), si('hover2'), si('hover1')], 6],
    ...(['windup', 'cast', 'fall', 'coreopen', 'stun'].map((n) => [n, [si(n)], 1] as [string, number[], number])),
  ];
  sheet(scene, 'aurren-sun', sNames.map((n) => sunForm(SPOSES[n], SPAL.p4)), sAnims);
  sheet(scene, 'aurren-sun-p5', sNames.map((n) => sunForm(SPOSES[n], SPAL.p5)), sAnims);

  // ---- wave edge crescent (grid 12x16, faces right)
  const wave = (k: number): P => {
    const p = new P(12, 16);
    p.shape((x, y) => {
      const a = ((x + 0.5 - 2) / 8) ** 2 + ((y + 0.5 - 8) / 7.5) ** 2 <= 1;
      const b = ((x + 0.5 - 0) / 7) ** 2 + ((y + 0.5 - 8) / 6) ** 2 <= 1;
      return a && !b;
    }, 'ygew');
    p.set(9, 8, 'w').set(8, 4 + k, 'w').set(8, 11 - k, 'e');
    return p;
  };
  sheet(scene, 'aurren-wave', [wave(0), wave(1)], [['fly', [0, 1], 12]]);

  // ---- orbit / thrown sword (grid 22x7, points right)
  const sw = new P(22, 7);
  sw.line(0, 3, 4, 3, 'u').set(0, 3, 'y');
  sw.line(5, 0, 5, 6, 'y').line(6, 1, 6, 5, 'g');
  for (let x = 7; x <= 20; x++) sw.set(x, 3, 'e').set(x, 2, x % 4 ? 'g' : 'w').set(x, 4, 'y');
  sw.set(21, 3, 'w');
  sheet(scene, 'aurren-sword', [sw], [['fly', [0], 1]]);

  // ---- ember (gravity well orbiters)
  const ember = (k: number): P => {
    const p = new P(8, 8);
    p.ellV(4, 4, 3.6, 3.6, 'oyge');
    p.ellV(4, 4, 1.8, 1.8, 'eww' + 'w');
    p.set(k ? 1 : 6, k ? 6 : 1, 'g');
    return p;
  };
  sheet(scene, 'sun-ember', [ember(0), ember(1)], [['fly', [0, 1], 8]]);

  // ---- sun disc: soft radial glow with rays (additive, behind the colossus)
  drawCanvas(scene, 'sun-disc', 128, 128, (ctx) => {
    const g = ctx.createRadialGradient(64, 64, 4, 64, 64, 64);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.18, 'rgba(255,238,194,0.95)');
    g.addColorStop(0.42, 'rgba(255,217,106,0.55)');
    g.addColorStop(0.7, 'rgba(247,178,59,0.18)');
    g.addColorStop(1, 'rgba(242,125,43,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
    ctx.fillStyle = 'rgba(255,238,194,0.35)';
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      const r0 = 24, r1 = k % 2 ? 50 : 62;
      ctx.beginPath();
      ctx.moveTo(64 + Math.cos(a - 0.05) * r0, 64 + Math.sin(a - 0.05) * r0);
      ctx.lineTo(64 + Math.cos(a) * r1, 64 + Math.sin(a) * r1);
      ctx.lineTo(64 + Math.cos(a + 0.05) * r0, 64 + Math.sin(a + 0.05) * r0);
      ctx.fill();
    }
  });

  // ---- flare beam: vertical profile, stretched horizontally to the beam size
  drawCanvas(scene, 'sun-flare', 4, 32, (ctx) => {
    const g = ctx.createLinearGradient(0, 0, 0, 32);
    g.addColorStop(0, 'rgba(242,125,43,0)');
    g.addColorStop(0.2, 'rgba(247,178,59,0.6)');
    g.addColorStop(0.4, 'rgba(255,238,194,0.95)');
    g.addColorStop(0.5, 'rgba(255,255,255,1)');
    g.addColorStop(0.6, 'rgba(255,238,194,0.95)');
    g.addColorStop(0.8, 'rgba(247,178,59,0.6)');
    g.addColorStop(1, 'rgba(242,125,43,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 4, 32);
  });
}
