import Phaser from 'phaser';
import { P, sheet } from './enemies';
import { limb } from './bosses';

// ============================================================================
// THE GILDED CROUPIER — a gaunt, gilded skeleton casino dealer with four arms,
// a green eyeshade visor, a crimson velvet vest and a glowing coin-slot sternum.
// Grid 46x46 (frame 48x48), art faces right, body ~26x40 bottom-centred (feet on row 45).
// Arms: upper pair holds cards (back = deck, front = fanned hand), lower pair holds
// dice (back) and a coin (front).
// Three sheets with identical frame layout / anim names:
//   'croupier'     P1: pristine vest, cyan eye glints
//   'croupier-p2'  P2: cracked gilding, torn vest flap dangling, amber eyes
//   'croupier-p3'  P3: vest gone (bare ribcage + spine), embers in the ribs, burning gold eyes
// Anims '<sheet>-<name>': idle walk (loop) | flip toss deal lever (2 frames, play once and
//   hold the release frame) | windup dizzy stun roar air (single frame)
// Extra textures (frame sizes include the 1px outline):
//   'croupier-coin' 12x12: 0-5 spin, 6 heads (crowned face), 7 tails (skull); anim 'croupier-coin-spin'
//   'croupier-die'  12x12: 0-5 faces with 1..6 pips, 6-9 tumble; anim 'croupier-die-tumble'
//   'croupier-card' 10x14: 0 back, 1 spade, 2 club, 3 diamond, 4 heart, 5 "2:1" back, 6 good (star), 7 bad (skull)
//   'croupier-reel' 16x16: 0 cherry, 1 bell, 2 seven, 3 skull; 'croupier-reel-blur' 16x16
//   'croupier-slot' 64x48 cabinet: windows 16x16 centred at texture (12,20) (28,20) (44,20); lever on the right
//   'croupier-ball' 6x6, 'croupier-wheel' 40x40 (rotate in code), 'croupier-chip' 8x8
//   projectiles (each animated one also gets a '<key>-fly' alias, which Projectile auto-plays):
//   'croupier-coinshot' 8x8 ('-spin'), 'croupier-pellet' 6x6, 'croupier-card-shot' 10x6,
//   'croupier-bomb' 10x10 ('-fuse'), 'croupier-curse' 10x10 ('-pulse'), 'croupier-ember' 8x8 ('-burn')
// ============================================================================

type Pt = [number, number];
type Item = 'fan' | 'deck' | 'dice' | 'coin' | 'coinE' | 'card' | 'fist' | 'none';
type Slot = 'bu' | 'bl' | 'fu' | 'fl';

interface CPose {
  by?: number; // torso drop (crouch) / bob
  lean?: number; // torso + head x shift
  headDy?: number;
  tilt?: number; // extra head x shift
  legs?: [number, number]; // ankle x offsets (back, front)
  lift?: [number, number]; // ankle lift
  bu: Pt; // back-upper hand
  bl: Pt; // back-lower hand
  fu: Pt; // front-upper hand
  fl: Pt; // front-lower hand
  items?: Partial<Record<Slot, Item>>;
  eyes?: 'on' | 'dim' | 'wide';
  jaw?: boolean; // mouth open
  fx?: (p: P) => void; // loose props (coin in the air, flying card, dice...)
}

const DEF_ITEMS: Record<Slot, Item> = { bu: 'deck', bl: 'dice', fu: 'fan', fl: 'coin' };

/** Small card standing up: 3x4, white face, suit pip of colour `pip`. */
function miniCard(p: P, x: number, y: number, pip: string): void {
  p.rect(x, y, 3, 4, 'w');
  p.line(x, y, x, y + 3, 'm');
  p.set(x + 1, y + 1, pip).set(x + 1, y + 2, pip);
}

function drawItem(p: P, item: Item, hx: number, hy: number): void {
  switch (item) {
    case 'fan':
      miniCard(p, hx - 3, hy - 4, 'x');
      miniCard(p, hx - 1, hy - 5, 'r');
      miniCard(p, hx + 1, hy - 4, 'x');
      break;
    case 'deck':
      p.rect(hx - 2, hy - 3, 4, 3, 'c');
      p.line(hx - 2, hy - 3, hx + 1, hy - 3, 'w');
      p.set(hx - 1, hy - 2, 'g');
      break;
    case 'card':
      miniCard(p, hx - 1, hy - 4, 'r');
      break;
    case 'dice':
      p.rect(hx - 1, hy - 3, 3, 3, 'w');
      p.line(hx + 1, hy - 3, hx + 1, hy - 1, 'm');
      p.set(hx, hy - 2, 'x');
      break;
    case 'coin':
      p.rect(hx, hy - 3, 2, 2, 'g').set(hx + 1, hy - 2, 'y').set(hx, hy - 3, 'e');
      break;
    case 'coinE':
      p.line(hx, hy - 3, hx + 1, hy - 3, 'y');
      break;
    default:
      break;
  }
}

/** Thin bone arm: shoulder -> auto elbow -> hand, with gold wrist cuff and an optional held item. */
function arm(p: P, sx: number, sy: number, hx: number, hy: number, front: boolean, item: Item): void {
  const dx = hx - sx, dy = hy - sy, len = Math.hypot(dx, dy) || 1;
  const bend = Math.max(1.4, (15 - len) * 0.45);
  const side = front ? 1 : -1;
  let px = -dy / len, py = dx / len;
  if (py + px * side * 0.8 < 0) { px = -px; py = -py; }
  const ex = (sx + hx) / 2 + px * bend, ey = (sy + hy) / 2 + py * bend;
  const ramp = front ? 'dew' : 'lde';
  if (front) {
    limb(p, sx, sy, ex, ey, 1.9, 'zzz');
    limb(p, ex, ey, hx, hy, 1.9, 'zzz');
  }
  limb(p, sx, sy, ex, ey, 1.2, ramp);
  limb(p, ex, ey, hx, hy, 1.05, ramp);
  p.set(ex, ey, ramp[2]);
  // gold cuff near the wrist
  const cx = ex + (hx - ex) * 0.65, cy = ey + (hy - ey) * 0.65;
  p.set(cx, cy, front ? 'g' : 'y').set(cx, cy + 1, front ? 'y' : 'o');
  drawItem(p, item, hx, hy);
  if (item === 'fist') p.ellV(hx, hy, 2.1, 2.1, ramp + 'w');
  else {
    p.ellV(hx, hy, 1.6, 1.6, ramp);
    p.set(hx + 1, hy - 1, ramp[2]); // thumb
  }
}

interface Stage { eye: string; eyeHi: string }
const STAGE: Record<1 | 2 | 3, Stage> = {
  1: { eye: 'Q', eyeHi: 'I' },
  2: { eye: 'y', eyeHi: 'g' },
  3: { eye: 'g', eyeHi: 'w' },
};

function croupier(o: CPose, stage: 1 | 2 | 3): P {
  const p = new P(46, 46);
  const by = o.by ?? 0;
  const ln = o.lean ?? 0;
  const [la, lb] = o.legs ?? [0, 0];
  const [lfa, lfb] = o.lift ?? [0, 0];
  const it = { ...DEF_ITEMS, ...o.items };
  const tx = 23 + ln, sy = 16 + by;

  // shoulders: upper pair at the top corners of the vest, lower pair out of its sides
  const BU: Pt = [tx - 5, sy + 1], BL: Pt = [tx - 5, sy + 8], FU: Pt = [tx + 6, sy + 1], FL: Pt = [tx + 6, sy + 8];

  // ---- back arms (behind everything)
  arm(p, BU[0], BU[1], o.bu[0], o.bu[1], false, it.bu);
  arm(p, BL[0], BL[1], o.bl[0], o.bl[1], false, it.bl);

  // ---- legs: thin black trousers, a glimpse of ankle bone, patent shoes
  const hipY = 31 + by;
  const leg = (hx: number, ax: number, lift: number, ramp: string, shoe: string): void => {
    const ay = 43 - lift;
    const kx = (hx + ax) / 2 + 1 + Math.max(0, by) * 0.5, ky = (hipY + ay) / 2;
    limb(p, hx, hipY, kx, ky, 1.9, ramp);
    limb(p, kx, ky, ax, ay - 1, 1.7, ramp);
    p.set(ax, ay, 'e').set(ax + 1, ay, 'd');
    p.box(ax - 2, ay + 1, 6, 2, shoe);
    p.set(ax + 3, ay + 1, '.');
    p.set(ax + 2, ay + 1, shoe[2]);
  };
  leg(tx - 2, 20 + la + ln * 0.3, lfa, 'zzZ', 'zZh');
  leg(tx + 2, 27 + lb + ln * 0.3, lfb, 'zZh', 'zZH');
  p.rect(tx - 4, hipY - 1, 9, 2, 'Z');

  // ---- torso: dark ribcage cavity, bright rib bars, sternum with a glowing gold coin slot
  const cx = tx + 1, cy = sy + 6, crx = stage === 3 ? 6 : 5.5, cry = 8;
  const inCage = (x: number, y: number) => ((x + 0.5 - cx) / crx) ** 2 + ((y + 0.5 - cy) / cry) ** 2 <= 1;
  p.shape(inCage, stage === 3 ? 'WWc' : 'zzZ');
  for (let i = 0; i < 5; i++) {
    const ry = sy + i * 2;
    for (let x = cx - 7; x <= cx + 7; x++) {
      const dy = Math.abs(x + 0.5 - cx) > 3.5 ? 1 : 0; // ribs droop toward the flanks
      if (!inCage(x, ry + dy)) continue;
      p.set(x, ry + dy, x < cx - 3 ? 'd' : i === 0 || x < cx ? 'w' : 'e');
    }
  }
  if (stage === 3) {
    // embers smouldering between the ribs + spine and pelvis on show
    for (const [ex, ey, c] of [[cx - 3, sy + 3, 'o'], [cx + 3, sy + 5, 'y'], [cx - 2, sy + 7, 'g'], [cx + 4, sy + 9, 'o'], [cx - 4, sy + 9, 'y'], [cx + 2, sy + 11, 'o'], [cx - 1, sy + 11, 'g'], [cx + 3, sy + 1, 'o'], [cx - 3, sy + 13, 'o']] as [number, number, string][]) p.set(ex, ey, c);
    for (let y = sy + 9; y <= hipY - 1; y++) p.set(cx - 4, y, y % 2 ? 'd' : 'e');
    p.ellV(tx, hipY - 1, 4.5, 1.6, 'dew');
  }
  p.line(cx, sy - 1, cx, sy + 9, 'w'); // sternum
  p.box(cx - 1, sy + 2, 3, 6, 'oyg'); // coin-slot plate
  p.line(cx, sy + 3, cx, sy + 6, stage === 3 ? 'w' : 'e');
  p.set(cx, sy + 1, 'g').set(cx, sy + 8, 'g'); // glow spill

  // ---- vest (P1/P2): crimson velvet open over the ribs, purple lining, gold trim + buttons + watch chain
  if (stage !== 3) {
    const vest: Pt[] = [[tx - 6, sy - 1], [tx + 6, sy - 1], [tx + 7, sy + 13], [tx + 2, sy + 16], [tx - 6, sy + 15]];
    const gap: Pt[] = [[tx - 2, sy - 2], [tx + 4, sy - 2], [tx + 1, sy + 10]];
    const inPoly = (pts: Pt[]) => (x: number, y: number) => {
      const px = x + 0.5, py = y + 0.5;
      let inside = false;
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const [xi, yi] = pts[i], [xj, yj] = pts[j];
        if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
      }
      return inside;
    };
    const inVest = inPoly(vest), inGap = inPoly(gap);
    p.shape((x, y) => inVest(x, y) && !inGap(x, y), 'zWc');
    for (const [vx, vy] of [[tx - 4, sy + 2], [tx - 3, sy + 7], [tx - 5, sy + 11], [tx + 5, sy + 4], [tx + 4, sy + 12]] as Pt[]) p.set(vx, vy, 'r'); // velvet sheen
    // lapels: purple lining + gold trim along both edges of the V
    p.line(tx - 3, sy - 1, tx, sy + 9, 'V').line(tx + 5, sy - 1, tx + 2, sy + 9, 'V');
    p.line(tx - 2, sy - 1, tx + 1, sy + 10, 'g').line(tx + 4, sy - 1, tx + 1, sy + 10, 'y');
    p.line(tx - 6, sy + 15, tx + 2, sy + 16, 'y').line(tx + 2, sy + 16, tx + 6, sy + 14, 'y'); // hem trim
    p.set(tx + 2, sy + 12, 'g').set(tx + 2, sy + 14, 'g'); // buttons
    for (const [wx, wy] of [[tx - 4, sy + 11], [tx - 3, sy + 12], [tx - 2, sy + 13], [tx - 1, sy + 13], [tx, sy + 12], [tx + 1, sy + 12]] as Pt[]) p.set(wx, wy, 'y'); // watch chain
    if (stage === 2) {
      // cracked gilding: broken trim pixels
      for (const [kx, ky] of [[tx - 1, sy + 3], [tx + 3, sy + 2], [tx - 3, sy + 15], [tx + 4, sy + 15]] as Pt[]) p.set(kx, ky, 'u');
      // rip in the vest showing a rib
      p.line(tx - 5, sy + 5, tx - 3, sy + 7, 'z').set(tx - 4, sy + 6, 'd');
      // torn flap dangling from the back hem
      p.poly([[tx - 6, sy + 14], [tx - 3, sy + 15], [tx - 4, sy + 21], [tx - 7, sy + 19]], 'zWc');
      p.set(tx - 5, sy + 20, 'y').set(tx - 6, sy + 18, 'y').set(tx - 4, sy + 21, 'W');
    }
  } else {
    // shreds of vest left on the shoulders
    p.set(tx - 6, sy - 1, 'W').set(tx - 5, sy - 1, 'c').set(tx + 6, sy - 1, 'W');
  }

  // ---- neck vertebrae + bow tie
  const hx = 25 + ln + (o.tilt ?? 0), hy = 8 + by + (o.headDy ?? 0);
  for (let y = hy + 5; y <= sy; y++) p.set(cx - 1 + Math.round((hx - cx) * (sy - y) / Math.max(1, sy - hy - 5)), y, y % 2 ? 'd' : 'e');
  p.set(cx - 1, sy - 1, 'p').set(cx + 1, sy - 1, 'p').set(cx, sy - 1, 'G').set(cx - 2, sy - 2, 'p').set(cx + 2, sy - 2, 'p').set(cx - 2, sy - 1, 'V').set(cx + 2, sy - 1, 'V');

  // ---- head: skull (3/4 view, facing right) with a green eyeshade visor + gold band, gold tooth
  const st = STAGE[stage];
  const jo = o.jaw ? 2 : 0;
  p.ellV(hx, hy - 1, 5, 4.6, 'deww'); // cranium
  p.box(hx - 1, hy + 1, 7, 3, 'dew'); // cheek / maxilla
  p.box(hx - 2, hy + 4 + jo, 7, 2, 'lde'); // mandible
  p.set(hx - 3, hy + 3 + jo, 'd'); // jaw hinge
  if (jo) p.rect(hx, hy + 4, 5, jo, 'z');
  for (let x = hx; x <= hx + 4; x++) p.set(x, hy + 3, x % 2 ? 'w' : 'a'); // upper teeth
  for (let x = hx; x <= hx + 3; x++) p.set(x, hy + 4 + jo, x % 2 ? 'a' : 'w'); // lower teeth
  p.set(hx + 3, hy + 3, 'g'); // gold tooth
  p.set(hx + 5, hy + 1, 'z').set(hx + 5, hy + 2, 'z'); // nasal cavity
  p.set(hx - 1, hy + 2, 'l').set(hx, hy + 2, 'd'); // cheek hollow
  // eye sockets: big near socket + a sliver of the far one
  p.rect(hx + 1, hy - 1, 3, 3, 'z').set(hx + 2, hy + 2, 'z');
  p.set(hx + 5, hy - 1, 'z');
  const eyes = o.eyes ?? 'on';
  if (eyes === 'dim') p.set(hx + 2, hy + 1, 'h');
  else {
    p.set(hx + 2, hy, st.eye).set(hx + 2, hy + 1, stage === 3 ? 'o' : 'h');
    if (eyes === 'wide' || stage === 3) p.set(hx + 3, hy, st.eye).set(hx + 2, hy, st.eyeHi);
    if (stage === 3) p.set(hx + 1, hy - 1, 'o').set(hx + 1, hy, 'y').set(hx, hy - 1, 'r').set(hx + 5, hy - 1, 'g'); // flames licking back
  }
  // gilding on the cranium
  p.set(hx - 3, hy - 4, 'g').set(hx - 2, hy - 5, 'g').set(hx - 4, hy - 2, 'y');
  // visor: gold band round the skull + green translucent brim jutting forward
  p.line(hx - 5, hy - 3, hx + 1, hy - 3, 'y');
  p.poly([[hx - 1, hy - 6], [hx + 9, hy - 4], [hx + 9, hy - 2], [hx + 1, hy - 2]], 'PML');
  p.line(hx + 1, hy - 3, hx + 8, hy - 3, 'L');
  p.line(hx + 1, hy - 2, hx + 8, hy - 2, 'y');
  if (stage >= 2) {
    p.line(hx - 3, hy - 5, hx - 1, hy - 1, 'l'); // skull crack
    p.set(hx - 2, hy, 'l');
    p.set(hx - 3, hy - 3, 'u').set(hx + 5, hy - 2, 'u'); // cracked band
  }

  // ---- front arms (gold shoulder caps)
  arm(p, FL[0], FL[1], o.fl[0], o.fl[1], true, it.fl);
  p.ellV(FL[0], FL[1], 1.6, 1.6, 'oyg');
  arm(p, FU[0], FU[1], o.fu[0], o.fu[1], true, it.fu);
  p.ellV(FU[0], FU[1], 2, 2, stage === 2 ? 'uyg' : 'oyg');

  o.fx?.(p);
  return p;
}

// loose props used by the pose fx
const flyCoin = (x: number, y: number) => (p: P) => {
  p.rect(x, y, 2, 3, 'g').set(x + 1, y + 1, 'y').set(x, y, 'e');
  p.set(x, y + 5, 'm').set(x + 1, y + 7, 'm');
};
const flyDie = (x: number, y: number) => (p: P) => {
  p.poly([[x + 1.5, y - 0.5], [x + 4, y + 1.5], [x + 2.5, y + 4], [x, y + 2]], 'mww');
  p.set(x + 2, y + 1, 'x').set(x + 2, y + 2, 'x');
  p.set(x - 2, y + 2, 'm').set(x - 4, y + 3, 'm');
};
const flyCard = (x: number, y: number) => (p: P) => {
  p.rect(x, y, 4, 2, 'c').set(x + 1, y, 'g').line(x, y + 1, x + 3, y + 1, 'W');
  p.line(x - 5, y, x - 2, y, 'm').line(x - 4, y + 2, x - 2, y + 2, 'a');
};

/** Frame list (index = frame). Keep anim table below in sync. */
const POSES: CPose[] = [
  // 0-1 idle: shuffling — fan of cards held up, coin rolling over the knuckles
  { bu: [13, 24], bl: [15, 31], fu: [33, 22], fl: [33, 30] },
  { by: 1, bu: [13, 25], bl: [15, 32], fu: [33, 22], fl: [33, 31], items: { fl: 'coinE' } },
  // 2-5 walk: a stiff, gliding strut
  { legs: [-3, 3], lift: [0, 2], bu: [14, 24], bl: [16, 31], fu: [33, 22], fl: [32, 30] },
  { by: 1, bu: [13, 25], bl: [15, 32], fu: [33, 23], fl: [33, 31] },
  { legs: [3, -3], lift: [2, 0], bu: [12, 24], bl: [14, 31], fu: [34, 22], fl: [34, 30] },
  { by: 1, bu: [13, 25], bl: [15, 32], fu: [33, 23], fl: [33, 31] },
  // 6-7 flip: coin cocked on the thumb, then flicked high into the air
  { by: 1, bu: [13, 25], bl: [15, 32], fu: [33, 22], fl: [31, 32], eyes: 'wide' },
  { by: -1, headDy: -1, bu: [13, 24], bl: [15, 31], fu: [33, 21], fl: [36, 21], items: { fl: 'none' }, fx: flyCoin(37, 3), eyes: 'wide' },
  // 8-9 toss: dice hand swung back low, then bowled forward along the floor
  { by: 3, lean: -2, legs: [-3, 3], bu: [12, 22], bl: [17, 36], fu: [31, 20], fl: [13, 37], items: { fl: 'dice', bl: 'none' }, eyes: 'wide' },
  { by: 4, lean: 3, legs: [-4, 4], bu: [10, 24], bl: [11, 33], fu: [36, 22], fl: [40, 38], items: { fl: 'none', bl: 'none' }, fx: flyDie(41, 33) },
  // 10-11 deal: card drawn to the chest, then flicked straight out
  { lean: -1, bu: [12, 22], bl: [15, 31], fu: [29, 19], fl: [32, 30], items: { fu: 'card' }, eyes: 'wide' },
  { lean: 2, bu: [13, 23], bl: [15, 31], fu: [41, 19], fl: [34, 30], items: { fu: 'none' }, fx: flyCard(42, 14) },
  // 12-13 lever: front fist raised high, then yanked down hard
  { lean: -1, legs: [-2, 2], bu: [11, 20], bl: [14, 30], fu: [34, 3], fl: [33, 29], items: { fu: 'fist' }, eyes: 'wide' },
  { by: 3, lean: 1, legs: [-3, 3], bu: [11, 24], bl: [14, 33], fu: [37, 30], fl: [34, 34], items: { fu: 'fist' }, eyes: 'wide', jaw: true },
  // 14 windup: crouched, all four arms spread
  { by: 3, legs: [-3, 3], bu: [7, 11], bl: [6, 28], fu: [39, 10], fl: [40, 28], eyes: 'wide' },
  // 15 dizzy: slumped, arms hanging, cards spilled at his feet
  { by: 4, lean: -1, headDy: 2, tilt: 1, bu: [15, 38], bl: [17, 40], fu: [31, 37], fl: [29, 39], items: { fu: 'none', bu: 'none' }, eyes: 'dim', jaw: true,
    fx: (p) => { p.rect(33, 44, 3, 1, 'w').set(35, 44, 'r'); p.rect(9, 44, 3, 1, 'w').set(10, 44, 'x'); p.rect(38, 43, 1, 2, 'm'); } },
  // 16 stun: knocked back, arms flung wide
  { by: 1, lean: -3, headDy: -1, legs: [-2, 2], bu: [4, 12], bl: [5, 23], fu: [38, 9], fl: [41, 21], eyes: 'dim', jaw: true },
  // 17 roar: arms raised, jaw dropped
  { by: -1, headDy: -1, legs: [-3, 3], bu: [7, 3], bl: [4, 17], fu: [38, 3], fl: [42, 17], items: { bu: 'none', fu: 'fan' }, eyes: 'wide', jaw: true },
  // 18 air: legs tucked, arms up and out
  { by: -2, lift: [4, 3], legs: [-1, 2], bu: [10, 12], bl: [10, 25], fu: [37, 11], fl: [38, 24], eyes: 'wide' },
];

const ANIMS: [string, number[], number, number?][] = [
  ['idle', [0, 1], 2], ['walk', [2, 3, 4, 5], 6],
  ['flip', [6, 7], 7, 0], ['toss', [8, 9], 7, 0], ['deal', [10, 11], 9, 0], ['lever', [12, 13], 7, 0],
  ['windup', [14], 1], ['dizzy', [15], 1], ['stun', [16], 1], ['roar', [17], 1], ['air', [18], 1],
];

// ============================================================================
// PROPS
// ============================================================================

/** Coin face/spin: grid 10x10 (frame 12x12). `sx` = horizontal squash 0..1. */
function coin(sx: number): P {
  const p = new P(10, 10);
  if (sx < 0.2) {
    p.rect(4, 0, 2, 10, 'y');
    p.line(4, 1, 4, 8, 'g').set(5, 0, 'o').set(5, 9, 'o');
    return p;
  }
  const rx = 5 * sx;
  p.ellV(5, 5, rx, 5, 'ygge');
  if (rx > 2.5) p.shape((x, y) => {
    const nx = (x + 0.5 - 5) / (rx - 1.3), ny = (y + 0.5 - 5) / 3.7;
    return nx * nx + ny * ny <= 1 && nx * nx + ny * ny > 0.55;
  }, 'yyy');
  return p;
}

const COIN_HEADS = ['..........', '..........', '..b.bb.b..', '..bbbbbb..', '..........', '...b..b...', '..........', '...bbbb...', '..........', '..........'];
const COIN_TAILS = ['..........', '..........', '...uuuu...', '..uuuuuu..', '..u.uu.u..', '..uuuuuu..', '...uuuu...', '...u..u...', '..........', '..........'];

/** Die face: grid 10x10 (frame 12x12), n = 1..6 pips (2x2 each). */
function dieFace(n: number): P {
  const p = new P(10, 10);
  p.rect(0, 0, 10, 10, 'w');
  p.line(9, 1, 9, 9, 'm').line(1, 9, 9, 9, 'm').line(0, 0, 8, 0, 'e').line(0, 0, 0, 8, 'e');
  p.clear(0, 0).clear(9, 0).clear(0, 9).clear(9, 9);
  const L = 1, M = 4, R = 7;
  const pip = (x: number, y: number, c = 'x') => p.rect(x, y, 2, 2, c);
  const sets: Record<number, Pt[]> = {
    1: [[M, M]],
    2: [[L, L], [R, R]],
    3: [[L, L], [M, M], [R, R]],
    4: [[L, L], [R, L], [L, R], [R, R]],
    5: [[L, L], [R, L], [M, M], [L, R], [R, R]],
    6: [[L, L], [R, L], [L, M], [R, M], [L, R], [R, R]],
  };
  for (const [x, y] of sets[n]) pip(x, y, n === 1 ? 'c' : 'x');
  return p;
}

/** Tumbling die: rotated square with a couple of pips (k = 0..3). */
function dieTumble(k: number): P {
  const p = new P(10, 10);
  const a = (k * Math.PI) / 8 + 0.2;
  const c = Math.cos(a), s = Math.sin(a), r = 4.2;
  const pts: Pt[] = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([u, v]) => [5 + (u * c - v * s) * r, 5 + (u * s + v * c) * r]);
  p.poly(pts, 'mww');
  const pip = (u: number, v: number) => p.set(5 + (u * c - v * s) * 2.2 - 0.5, 5 + (u * s + v * c) * 2.2 - 0.5, 'x');
  if (k % 2 === 0) { pip(-1, -1); pip(0, 0); pip(1, 1); } else { pip(-1, -1); pip(1, 1); pip(-1, 1); pip(1, -1); }
  return p;
}

// card suits (6 wide) — dark 'x' / red 'r'
const SPADE = ['..xx..', '.xxxx.', 'xxxxxx', 'xxxxxx', 'x.xx.x', '..xx..', '.xxxx.'];
const CLUB = ['..xx..', '.xxxx.', '..xx..', 'xxxxxx', 'xxxxxx', '..xx..', '.xxxx.'];
const DIAMOND = ['..xx..', '.xxxx.', 'xxxxxx', 'xxxxxx', '.xxxx.', '..xx..'];
const HEART = ['xx..xx', 'xxxxxx', 'xxxxxx', '.xxxx.', '..xx..'];
const STAR = ['..xx..', '..xx..', 'xxxxxx', '.xxxx.', '.xxxx.', 'xx..xx'];
const SKULL = ['.xxxx.', 'xxxxxx', 'x.xx.x', 'xxxxxx', '.xxxx.', '.x..x.'];

/** Card: grid 8x12 (frame 10x14). */
function cardBlank(face: string, shade: string): P {
  const p = new P(8, 12);
  p.rect(0, 0, 8, 12, face);
  p.line(7, 1, 7, 11, shade).line(1, 11, 7, 11, shade);
  p.clear(0, 0).clear(7, 0).clear(0, 11).clear(7, 11);
  return p;
}
function cardFace(sym: string[], ink: string, hi?: string): P {
  const p = cardBlank('w', 'm');
  const y0 = Math.floor((12 - sym.length) / 2);
  sym.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) if (row[x] === 'x') p.set(1 + x, y0 + y, ink);
  });
  if (hi) p.set(2, y0 + (sym === HEART ? 0 : 2), hi);
  return p;
}
function cardBack(): P {
  const p = cardBlank('e', 'd');
  p.rect(1, 1, 6, 10, 'c');
  for (let y = 1; y < 11; y++) for (let x = 1; x < 7; x++) if ((x + y) % 3 === 0) p.set(x, y, 'W');
  p.set(3, 4, 'g').set(4, 4, 'g').set(2, 5, 'g').set(5, 5, 'g').set(2, 6, 'g').set(5, 6, 'g').set(3, 7, 'g').set(4, 7, 'g');
  p.set(3, 5, 'r').set(4, 6, 'r').set(3, 6, 'y').set(4, 5, 'y');
  return p;
}
/** High-Card back variant: red back with a gold plaque reading "2:1". */
function cardHigh(): P {
  const p = cardBack();
  p.rect(0, 3, 8, 7, 'g');
  p.line(0, 3, 7, 3, 'y').line(0, 9, 7, 9, 'o');
  // '2' (cols 0-2), ':' (col 4, rows 1+3), '1' (col 6)
  const glyph = ['xxx...x', '..x.x.x', 'xxx...x', 'x...x.x', 'xxx...x'];
  glyph.forEach((row, y) => { for (let x = 0; x < row.length; x++) if (row[x] === 'x') p.set(x, 4 + y, 'z'); });
  return p;
}

/** Reel symbol on an ivory drum: grid 14x14 (frame 16x16). */
function reelBase(): P {
  const p = new P(14, 14);
  p.rect(0, 0, 14, 14, 'e');
  p.line(0, 0, 13, 0, 'd').line(0, 13, 13, 13, 'd');
  p.line(0, 1, 13, 1, 'w');
  return p;
}
function reel(k: number): P {
  const p = reelBase();
  if (k === 0) {
    // cherry pair
    p.line(4, 8, 8, 3, 'M').line(10, 8, 8, 3, 'M').line(8, 3, 9, 2, 'M');
    p.poly([[9, 2], [12, 1], [12, 3], [10, 3]], 'PLi');
    p.ellV(4, 10, 2.6, 2.6, 'Wcr' + 'K');
    p.ellV(10, 10, 2.6, 2.6, 'Wcr' + 'K');
  } else if (k === 1) {
    // bell
    p.set(7, 2, 'o').set(6, 2, 'o');
    p.shape((x, y) => {
      const cx = x + 0.5 - 7;
      if (y < 3 || y > 10) return false;
      const half = y < 7 ? 2 + (y - 3) * 0.6 + Math.sqrt(Math.max(0, (y - 2.5) * 1.2)) : 4.5 + (y - 7) * 0.5;
      return Math.abs(cx) <= half;
    }, 'oyg' + 'e');
    p.line(2, 10, 11, 10, 'o');
    p.rect(6, 11, 2, 1, 'b');
  } else if (k === 2) {
    // red seven
    p.box(3, 2, 9, 3, 'Wcr');
    limb(p, 10, 4, 6.5, 12, 1.6, 'Wcr');
    p.set(4, 2, 'K').set(5, 2, 'K');
  } else {
    // purple skull
    p.ellV(7, 6, 4.5, 4.3, 'VppK');
    p.box(4, 9, 6, 3, 'Vpp');
    p.rect(4, 5, 2, 2, 'z').rect(8, 5, 2, 2, 'z');
    p.set(6, 8, 'z').set(7, 8, 'z');
    p.set(5, 11, 'z').set(7, 11, 'z');
  }
  return p;
}
function reelBlur(): P {
  const p = reelBase();
  // symbols smeared vertically into streaks
  for (let y = 1; y < 13; y++) {
    p.set(3, y, y % 4 === 0 ? 'r' : 'c').set(4, y, y % 3 ? 'c' : 'K');
    p.set(7, y, y % 2 ? 'y' : 'g').set(8, y, y % 3 ? 'o' : 'y');
    if (y % 5 !== 2) p.set(11, y, y % 3 ? 'p' : 'V');
    if (y % 2) p.set(1, y, 'm').set(12, y, 'm');
  }
  return p;
}

/**
 * Slot machine cabinet: grid 62x46 (frame 64x48).
 * Window centres in TEXTURE pixels (incl. the 1px outline pad): (12,20) (28,20) (44,20), each 16x16
 * (texture x 4..19 / 20..35 / 36..51, y 12..27). Lever on the right: knob around (59,8), pivot (58,31).
 */
function slotMachine(): P {
  const p = new P(62, 46);
  // cabinet body
  p.box(0, 6, 54, 34, 'WcrK');
  // marquee arch on top with bulbs
  p.poly([[2, 7], [6, 1], [48, 1], [52, 7]], 'oyg');
  p.rect(10, 3, 34, 3, 'V');
  for (let x = 12; x < 43; x += 4) p.set(x, 4, x % 8 === 4 ? 'w' : 'e');
  for (let x = 4; x < 52; x += 3) p.set(x, 7, (x / 3) % 2 ? 'g' : 'e');
  // gold window frame + three dark windows (grid x 3..50, y 11..26)
  p.box(1, 9, 52, 20, 'oyg');
  for (let i = 0; i < 3; i++) {
    const wx = 3 + i * 16;
    p.rect(wx, 11, 16, 16, 'z');
    p.line(wx, 11, wx + 15, 11, 'Z');
    p.line(wx + 1, 12, wx + 14, 12, 'h');
    p.set(wx + 7, 26, 'h').set(wx + 8, 26, 'h');
  }
  p.line(18, 11, 18, 26, 'y').line(34, 11, 34, 26, 'y'); // dividers (hidden under reels)
  // payline arrows
  p.set(1, 18, 'w').set(1, 19, 'w').set(52, 18, 'w').set(52, 19, 'w');
  // lower panel: coin slot, payout tray
  p.box(4, 30, 46, 8, 'zWc');
  p.box(23, 31, 8, 3, 'oyg');
  p.line(25, 32, 28, 32, 'z');
  p.box(10, 35, 34, 4, 'oyg');
  p.rect(12, 36, 30, 2, 'z');
  p.set(15, 37, 'g').set(16, 37, 'y').set(30, 37, 'g').set(35, 37, 'y'); // coins in the tray
  // base
  p.box(0, 40, 54, 6, 'zZh');
  p.line(0, 40, 53, 40, 'y');
  // lever: mount, shaft, knob
  p.box(52, 28, 5, 6, 'oyg');
  limb(p, 58, 31, 58, 8, 1.1, 'amw');
  p.ellV(58, 6, 3, 3, 'WcrK');
  return p;
}

/** Roulette wheel: grid 38x38 (frame 40x40). Rotated in code; the green zero shows the spin. */
function wheel(): P {
  const p = new P(38, 38);
  const c = 19, N = 18;
  for (let y = 0; y < 38; y++)
    for (let x = 0; x < 38; x++) {
      const dx = x + 0.5 - c, dy = y + 0.5 - c, d = Math.hypot(dx, dy);
      if (d > 18.9) continue;
      const lit = -(dx + dy) / (d || 1); // light from the top-left
      let col: string;
      if (d > 16.8) col = lit > 0.5 ? 'g' : lit < -0.5 ? 'o' : 'y';
      else if (d > 11.5) {
        const a = (Math.atan2(dy, dx) + Math.PI * 2) % (Math.PI * 2);
        const f = (a / (Math.PI * 2)) * N, seg = Math.floor(f);
        if (f - seg < 0.12 * (12 / d) || d > 15.9) col = 'y';
        else col = seg === 0 ? 'M' : seg % 2 ? 'c' : 'z';
      } else if (d > 10.4) col = 'g';
      else if (d > 3.6) col = lit > 0.3 ? 'l' : lit < -0.4 ? 'u' : 'b';
      else col = d > 2.4 ? 'y' : 'g';
      p.set(x, y, col);
    }
  // hub spokes (turret cross)
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as Pt[]) {
    p.line(c + dx * 3, c + dy * 3, c + dx * 8, c + dy * 8, 'y');
    p.set(c + dx * 9, c + dy * 9, 'g');
  }
  p.set(c - 1, c - 1, 'e');
  return p;
}

function registerProps(scene: Phaser.Scene): void {
  // coin: 0-5 spin, 6 heads, 7 tails
  const spin = [1, 0.75, 0.4, 0, 0.4, 0.75].map(coin);
  const heads = coin(1).stamp(COIN_HEADS, 0, 0);
  const tails = coin(1).stamp(COIN_TAILS, 0, 0);
  sheet(scene, 'croupier-coin', [...spin, heads, tails], [['spin', [0, 1, 2, 3, 4, 5], 16]]);

  // die: 0-5 faces (frame i shows i+1 pips), 6-9 tumble
  sheet(scene, 'croupier-die', [1, 2, 3, 4, 5, 6].map(dieFace).concat([0, 1, 2, 3].map(dieTumble)), [['tumble', [6, 7, 8, 9], 14]]);

  // cards
  sheet(scene, 'croupier-card', [
    cardBack(),
    cardFace(SPADE, 'x'),
    cardFace(CLUB, 'x'),
    cardFace(DIAMOND, 'r', 'K'),
    cardFace(HEART, 'r', 'K'),
    cardHigh(),
    (() => { const p = cardBlank('w', 'm'); p.shape((x, y) => STAR[y - 3]?.[x - 1] === 'x', 'oyg'); return p; })(),
    (() => { const p = cardBlank('w', 'm'); p.shape((x, y) => SKULL[y - 3]?.[x - 1] === 'x', 'Vpp'); p.set(2, 5, 'G'); p.set(5, 5, 'G'); return p; })(),
  ], []);

  // slot reels + machine
  sheet(scene, 'croupier-reel', [0, 1, 2, 3].map(reel), []);
  sheet(scene, 'croupier-reel-blur', [reelBlur()], []);
  sheet(scene, 'croupier-slot', [slotMachine()], []);

  // roulette
  const ball = new P(4, 4);
  ball.ellV(2, 2, 2, 2, 'mww').set(1, 1, 'w');
  sheet(scene, 'croupier-ball', [ball], []);
  sheet(scene, 'croupier-wheel', [wheel()], []);

  // chip: grid 6x6 (frame 8x8)
  const chip = new P(6, 6);
  chip.ellV(3, 3, 3, 3, 'oyg');
  chip.set(3, 0, 'w').set(0, 3, 'w').set(5, 2, 'e').set(2, 5, 'e');
  chip.rect(2, 2, 2, 2, 'y').set(2, 2, 'g');
  sheet(scene, 'croupier-chip', [chip], []);
}

/** Animated projectile: registers '<key>-<name>' and the '<key>-fly' alias Projectile auto-plays. */
function projSheet(scene: Phaser.Scene, key: string, frames: P[], name: string, fps: number): void {
  const fr = frames.map((_, i) => i);
  sheet(scene, key, frames, [[name, fr, fps], ['fly', fr, fps]]);
}

function registerProjectiles(scene: Phaser.Scene): void {
  // coinshot: grid 6x6 (frame 8x8), 4-frame spin
  const shot = (k: number): P => {
    const p = new P(6, 6);
    const rx = [3, 2, 0.6, 2][k];
    if (rx < 1) p.rect(2, 0, 2, 6, 'y').line(2, 0, 2, 5, 'g');
    else p.ellV(3, 3, rx, 3, 'ygge');
    return p;
  };
  projSheet(scene, 'croupier-coinshot', [0, 1, 2, 3].map(shot), 'spin', 16);

  // ivory pip pellet: grid 4x4 (frame 6x6)
  const pel = new P(4, 4);
  pel.ellV(2, 2, 2, 2, 'dew').set(1, 1, 'w');
  sheet(scene, 'croupier-pellet', [pel], []);

  // card in flight (sideways): grid 8x4 (frame 10x6)
  const cs = new P(8, 4);
  cs.rect(0, 0, 8, 4, 'e');
  cs.rect(1, 1, 6, 2, 'c');
  cs.set(3, 1, 'g').set(4, 2, 'g').set(5, 1, 'W').set(2, 2, 'W');
  cs.line(1, 3, 7, 3, 'd');
  sheet(scene, 'croupier-card-shot', [cs], []);

  // cherry bomb: grid 8x8 (frame 10x10), 3-frame fuse spark
  const bomb = (k: number): P => {
    const p = new P(8, 8);
    p.ellV(3.5, 5, 3, 3, 'WcrK');
    p.line(4, 2, 5, 1, 'b').set(3, 1, 'L').set(2, 1, 'M');
    const sp: [number, number, string][][] = [[[6, 0, 'w'], [7, 1, 'g']], [[6, 0, 'g'], [5, 0, 'o'], [7, 0, 'y']], [[6, 0, 'y'], [7, 1, 'o'], [6, 1, 'w']]];
    for (const [x, y, c] of sp[k]) p.set(x, y, c);
    return p;
  };
  projSheet(scene, 'croupier-bomb', [0, 1, 2].map(bomb), 'fuse', 12);

  // curse orb: grid 8x8 (frame 10x10), 3-frame pulse
  const curse = (k: number): P => {
    const p = new P(8, 8);
    const r = [3, 3.5, 4][k];
    p.ellV(4, 4, r, r, 'VppK');
    p.set(3, 4, 'G').set(5, 4, 'G').set(3, 3, 'z').set(5, 3, 'z');
    if (k === 2) p.set(0, 1, 'G').set(7, 6, 'G');
    if (k === 0) p.set(7, 1, 'K').set(0, 6, 'K');
    return p;
  };
  projSheet(scene, 'croupier-curse', [0, 1, 2].map(curse), 'pulse', 10);

  // ember: grid 6x6 (frame 8x8), 3-frame flicker
  const FL = [
    ['..o...', '..oo..', '.oyo..', '.oygo.', '.ygwgo', '..yyo.'],
    ['...o..', '..oo..', '..oyo.', '.oygo.', 'oygwy.', '.oyyo.'],
    ['......', '..o...', '.ooyo.', '.oygo.', '.ygwgo', '.oyyo.'],
  ];
  projSheet(scene, 'croupier-ember', FL.map((rows) => new P(6, 6).stamp(rows, 0, 0)), 'burn', 12);
}

/** Boss sheets for THE GILDED CROUPIER (all three phases) + props + projectiles. */
export function registerCroupierArt(scene: Phaser.Scene): void {
  sheet(scene, 'croupier', POSES.map((o) => croupier(o, 1)), ANIMS);
  sheet(scene, 'croupier-p2', POSES.map((o) => croupier(o, 2)), ANIMS);
  sheet(scene, 'croupier-p3', POSES.map((o) => croupier(o, 3)), ANIMS);
  registerProps(scene);
  registerProjectiles(scene);
}
