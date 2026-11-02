import Phaser from 'phaser';
import { drawSheet, drawCanvas, overlay, recolor, flipH, type Frame, type Palette } from './pixel';
import { C } from './palette';
import { GLYPHS } from './glyphs';
import { installTransitions } from '../ui/transition';

/**
 * UI kit art (owner: Agent D): icons, badges, node markers, cursor, key/mouse glyphs.
 * Every texture key starts with 'ui-' so it never collides with gameplay sprites.
 * Panels are painted on demand (any size) by `paintPanel`, used from `ui/Panel.ts`.
 */

/** Frame index of each upgrade icon in the 'ui-upg' sheet. */
export const UPGRADE_ICON: Record<string, number> = {
  maxHp: 0, damage: 1, stamina: 2, comboPlus: 3, energySlash: 4, doubleJump: 5, airDash: 6,
  parryWard: 7, fleetStep: 8, lodestone: 9, bloodPact: 10, secondWind: 11,
};
/** Frame index of each rank in 'ui-rank'. */
export const RANK_FRAME: Record<string, number> = { S: 0, A: 1, B: 2, C: 3 };
/** Arrow frames in 'ui-arrow'. */
export const ARROW = { right: 0, left: 1, up: 2, down: 3 } as const;

const blank = (w: number, h: number): Frame => Array.from({ length: h }, () => '.'.repeat(w));

/** Glyph from the pixel font as a frame of `ch` characters (5x7 body). */
function glyph(letter: string, ch: string): Frame {
  return GLYPHS[letter].split('|').slice(0, 7).map((r) => r.replace(/#/g, ch));
}

// ------------------------------------------------------------------ icons

const HEART: Frame = [
  '.rr...rr.',
  'rwrr.rrrr',
  'rwrrrrrrr',
  'rrrrrrrrr',
  '.rrrrrrd.',
  '..rrrrd..',
  '...rdd...',
  '....d....',
];
const HEART_PAL: Palette = { r: C.red, w: C.pink, d: C.crimson, e: C.night, f: C.slate };

const BOLT: Frame = [
  '....yyy',
  '...yyy.',
  '..yyy..',
  '.yyyyyy',
  'yyyyyy.',
  '..yyy..',
  '.yyy...',
  '.yy....',
  'y......',
];

const SHARD: Frame = [
  '...w...',
  '..wgg..',
  '.wggga.',
  'wgggaao',
  '.ggaao.',
  '..aao..',
  '...o...',
];
const SHARD_PAL: Palette = { w: C.cream, g: C.gold, a: C.amber, o: C.orange };

const SHIELD: Frame = [
  '.hhhhhhhhhhh.',
  'hllllllllllmh',
  'hlmmmmmmmmmdh',
  'hlmmmmmmmmmdh',
  'hlmmmmmmmmmdh',
  'hlmmmmmmmmmdh',
  'hlmmmmmmmmmdh',
  'hlmmmmmmmmmdh',
  'hlmmmmmmmmmdh',
  '.hlmmmmmmmdh.',
  '..hlmmmmmdh..',
  '...hlmmmdh...',
  '....hhmhh....',
  '.....hhh.....',
];

const RANK_COLS: Record<string, [number, number, number, number]> = {
  // border, light, mid, dark
  S: [C.orange, C.cream, C.gold, C.amber],
  A: [C.pine, C.lime, C.leaf, C.moss],
  B: [C.navy, C.cyan, C.sky, C.blue],
  C: [C.night, C.mist, C.ash, C.stone],
};

function upgradeIcons(): Frame[] {
  const maxHp = overlay(
    overlay(blank(12, 12), ['.rr..rr.', 'rwrrrrrr', 'rwrrrrrr', 'rrrrrrrr', '.rrrrrd.', '..rrdd..', '...dd...']),
    ['..gg..', '..gg..', 'gggggg', 'gggggg', '..gg..', '..gg..'],
    6,
    6,
  );
  const damage = [
    '..........ww',
    '.........wmw',
    '........wmm.',
    '.......wmm..',
    '......wmm...',
    '.....wmm....',
    '..g.wmm.....',
    '..ggmm......',
    '...gg.......',
    '..bbgg......',
    '.bb..g......',
    'bb..........',
  ];
  const stamina = [
    '.......lll..',
    '......lll...',
    '.....lll....',
    '....lll.....',
    '...lllllll..',
    '..lllllll...',
    '.....lll....',
    '....lll.....',
    '...lll......',
    '..ll........',
    '.l..........',
    '............',
  ];
  const combo = [
    '.......w..w.',
    '......wc.wc.',
    '..w..wc.wc..',
    '.wc.wc.wc...',
    '.c.wc.wc....',
    '..wc.wc.....',
    '.wc.wc......',
    '.c.wc.......',
    '..wc........',
    '.wc.........',
    '.c..........',
    '............',
  ];
  const wave = [
    '....cccc....',
    '......wccc..',
    '........wcc.',
    'ww.......wc.',
    '.........wcc',
    '.www......wc',
    '..........wc',
    '.www.....wcc',
    '.........wc.',
    'ww......wcc.',
    '......wccc..',
    '....cccc....',
  ];
  const djump = [
    '.....ww.....',
    '....wccw....',
    '...wccccw...',
    '..wcc..ccw..',
    '.wcc....ccw.',
    '.cc......cc.',
    '.....ww.....',
    '....wccw....',
    '...wccccw...',
    '..wcc..ccw..',
    '.wcc....ccw.',
    '.cc......cc.',
  ];
  const adash = [
    '............',
    '.......w....',
    '.......cw...',
    'mmm....ccw..',
    '...cccccccw.',
    '.mmcccccccc.',
    '...cccccccw.',
    'mmm....ccw..',
    '.......cw...',
    '.......w....',
    '............',
    '............',
  ];
  const guard = [
    '.mmmmmmmmmm.',
    '.mwwccccccm.',
    '.mwccccccmm.',
    '.mwcccwcccm.',
    '.mccwwwwccm.',
    '.mcccwcccmm.',
    '.mmcccccccm.',
    '..mcccccmm..',
    '..mmcccccm..',
    '...mmcccm...',
    '....mmmm....',
    '.....mm.....',
  ];
  const fleet = [
    '............',
    '.....bbb....',
    '.....bbb.w..',
    '.....bbbww..',
    '.....bbwwww.',
    '.....bbb.ww.',
    '.....bbb..w.',
    '....bbbb....',
    '..bbbbbb....',
    '.bbbbbbb....',
    '.ggggggg....',
    '............',
  ];
  const magnet = [
    '............',
    '...rrrrrr...',
    '..rrwrrrrr..',
    '.rrw....rrr.',
    '.rr......rr.',
    '.rr......rr.',
    '.rr......rr.',
    '.rr......rr.',
    '.mm......mm.',
    '.ww......ww.',
    '.mm......mm.',
    '............',
  ];
  const blood = [
    '.....rr.....',
    '.....rr.....',
    '....rrrr....',
    '....rrrr....',
    '...rrrrrr...',
    '..rwrrrrrr..',
    '..rwrrrrrr..',
    '.rwrrrrrrrd.',
    '.rrrrrrrrrd.',
    '..rrrrrrdd..',
    '...rddddd...',
    '....dddd....',
  ];
  const feather = [
    '.........ww.',
    '........wgg.',
    '.......wggg.',
    '......wgggg.',
    '.....wgggw..',
    '....wgggw...',
    '...wgggw....',
    '..wgggw.....',
    '..ggw.......',
    '.gw.........',
    '.g..........',
    'g...........',
  ];
  return [maxHp, damage, stamina, combo, wave, djump, adash, guard, fleet, magnet, blood, feather];
}
const UPG_PAL: Palette = {
  r: C.red, w: C.white, d: C.crimson, g: C.gold, m: C.mist, b: C.bark, l: C.lime, c: C.cyan,
};

const LOCK: Frame = [
  '..sssss..',
  '.s.....s.',
  '.s.....s.',
  '.s.....s.',
  'ggggggggg',
  'gyyyyyyyg',
  'gyyykyyyg',
  'gyyykyyyg',
  'gyyyyyyyg',
  'ggggggggg',
];

const MOUSE: Frame = [
  '..wwwww..',
  '.wLLwRRw.',
  'wLLLwRRRw',
  'wLLLwRRRw',
  'wLLLwRRRw',
  'wwwwwwwww',
  'wmmmmmmmw',
  'wmmmmmmmw',
  'wmmmmmmmw',
  'wmmmmmmmw',
  '.wmmmmmw.',
  '..wwwww..',
];

const ARROW_R: Frame = ['.w...', '.ww..', '.www.', '.ww..', '.w...'];
const ARROW_U: Frame = ['.....', '..w..', '.www.', 'wwwww', '.....'];

const CURSOR: Frame = [
  'gg.....',
  'gwgg...',
  'gwwwgg.',
  'gwwwwwg',
  'gwwwgga',
  'gwgga..',
  'gga....',
];

const SKULL: Frame = [
  '..wwwww..',
  '.wwwwwww.',
  'wwwwwwwww',
  'wkkwwwkkw',
  'wkkwwwkkw',
  '.wwwkwww.',
  '..wwwww..',
  '..wkwkw..',
];

const CROWN: Frame = [
  'g...g...g',
  'gg.ggg.gg',
  'ggggggggg',
  'gyrygyryg',
  'ggggggggg',
];

const NODE: Frame = [
  '...hhhhh...',
  '..hlllllh..',
  '.hllmmmmdh.',
  'hllmmmmmmdh',
  'hlmmmmmmmdh',
  'hlmmmmmmmdh',
  'hlmmmmmmmdh',
  'hmmmmmmmddh',
  '.hmmmmmddh.',
  '..hdddddh..',
  '...hhhhh...',
];

const BOSSNODE: Frame = [
  '......hhhhh......',
  '....hhlllllhh....',
  '...hllmmmmmmdh...',
  '..hlmmmmmmmmmdh..',
  '.hlmmmmmmmmmmmdh.',
  '.hlmmmmmmmmmmmdh.',
  'hlmmmmmmmmmmmmmdh',
  'hlmmmmmmmmmmmmmdh',
  'hlmmmmmmmmmmmmmdh',
  'hlmmmmmmmmmmmmmdh',
  'hmmmmmmmmmmmmmddh',
  '.hmmmmmmmmmmmddh.',
  '.hmmmmmmmmmmmddh.',
  '..hmmmmmmmmmddh..',
  '...hdmmmmmmddh...',
  '....hhdddddhh....',
  '......hhhhh......',
];

const HERO_IDLE: Frame = [
  '..hhh..',
  '.hcccb.',
  '.hcwcw.',
  '.hcccc.',
  '..bbb..',
  '.bsbbs.',
  '.bbbb..',
  '..b.b..',
  '..d.d..',
];
const HERO_WALK1: Frame = [
  '..hhh..',
  '.hcccb.',
  '.hcwcw.',
  '.hcccc.',
  '..bbb..',
  '.bsbbs.',
  '.bbbb..',
  '.b...b.',
  '.d...d.',
];
const HERO_WALK2: Frame = [
  '.......',
  '..hhh..',
  '.hcccb.',
  '.hcwcw.',
  '.hcccc.',
  '..bbb..',
  '.bsbbs.',
  '.bbbb..',
  '..dd...',
];
const HERO_PAL: Palette = { h: C.navy, c: C.blue, w: C.cyan, b: C.sky, s: C.ice, d: C.night };

const PORTRAIT: Frame = [
  '....hhhhhh....',
  '...hbbbbbbh...',
  '..hbbccccbbh..',
  '..hbcccccccbh.',
  '.hbcnnnnnnnch.',
  '.hbnnwnnnwnnh.',
  '.hbnnwnnnwnnh.',
  '.hbcnnnnnnnch.',
  '.hbbcccccccbh.',
  '..hbbbcccbbh..',
  '..sshbbbbhss..',
  '.ssssshhsssss.',
  'ssggsssssssggs',
  'sssssssssssss.',
];
const PORTRAIT_PAL: Palette = { h: C.navy, b: C.blue, c: C.sky, n: C.ink, w: C.cyan, s: C.slate, g: C.gold };

const SPARK: Frame[] = [
  ['..w..', '..w..', 'wwwww', '..w..', '..w..'],
  ['.....', '..w..', '.www.', '..w..', '.....'],
];

const PIP: Frame[] = [
  ['.ss.', 'sdds', 'sdds', '.ss.'],
  ['.gg.', 'gwgg', 'ggga', '.ga.'],
  ['.rr.', 'rwrr', 'rrrc', '.rc.'],
];
const PIP_PAL: Palette = { s: C.stone, d: C.night, g: C.gold, w: C.cream, a: C.amber, r: C.red, c: C.crimson };

const CRYSTAL: Frame = [
  '....w....',
  '...wcc...',
  '..wccci..',
  '..wccci..',
  '.wccccii.',
  '.wcccciib',
  'wcccccib.',
  '.wcccib..',
  '.wccib...',
  '..wcib...',
  '..wib....',
  '...ib....',
  '...b.....',
];
const CRYSTAL_PAL: Palette = { w: C.white, c: C.gold, i: C.amber, b: C.orange };

const PEDESTAL: Frame = [
  '..mmmmmmmmmmmmmmmmmm..',
  '.mwwwwwwwwwwwwwwwwwwm.',
  '.sssssssssssssssssssd.',
  '...msssssssssssssd....',
  '...mssgssssssgsssd....',
  '...msssssssssssssd....',
  '...mssssggggsssssd....',
  '...msssssssssssssd....',
  '..mmsssssssssssssdd...',
  '.mwwwwwwwwwwwwwwwwwwm.',
  'msssssssssssssssssssdd',
];
const PEDESTAL_PAL: Palette = { m: C.ash, w: C.mist, s: C.stone, d: C.slate, g: C.amber };

export function registerUiArt(scene: Phaser.Scene): void {
  installTransitions(scene.game);
  drawSheet(scene, 'ui-heart', [HEART, recolor(HEART, { r: 'e', w: 'f', d: 'e' })], HEART_PAL);
  drawSheet(scene, 'ui-bolt', [BOLT, recolor(BOLT, { y: 'n' })], { y: C.lime, n: C.slate });
  drawSheet(scene, 'ui-shard', [SHARD], SHARD_PAL);

  // rank badges S/A/B/C: shield + letter with a drop shadow
  const ranks = ['S', 'A', 'B', 'C'].map((r) => overlay(overlay(SHIELD, glyph(r, 'd'), 4, 4), glyph(r, 'w'), 4, 3));
  ['S', 'A', 'B', 'C'].forEach((r) => {
    const [h, l, m, d] = RANK_COLS[r];
    drawSheet(scene, `ui-rank-${r}`, [ranks[RANK_FRAME[r]]], { h, l, m, d, w: C.white });
  });
  drawRankSheet(scene, ranks);

  drawSheet(scene, 'ui-upg', upgradeIcons(), UPG_PAL);
  drawSheet(scene, 'ui-lock', [LOCK], { s: C.ash, g: C.amber, y: C.gold, k: C.ink });
  drawSheet(scene, 'ui-mouse', [MOUSE, recolor(MOUSE, { L: 'h' }), recolor(MOUSE, { R: 'h' })], { w: C.stone, m: C.mist, L: C.mist, R: C.mist, h: C.gold });
  const arrowL = flipH(ARROW_R);
  const arrowD = [...ARROW_U].reverse();
  drawSheet(scene, 'ui-arrow', [ARROW_R, arrowL, ARROW_U, arrowD], { w: C.white }, { outline: false });
  drawSheet(scene, 'ui-cursor', [CURSOR], { g: C.amber, w: C.gold, a: C.orange });
  drawSheet(scene, 'ui-skull', [SKULL], { w: C.white, k: C.ink });
  drawSheet(scene, 'ui-crown', [CROWN], { g: C.gold, y: C.cream, r: C.red });
  // node: locked / open / cleared
  paintFrames(scene, 'ui-node', NODE, [
    { h: C.night, l: C.stone, m: C.slate, d: C.night },
    { h: C.amber, l: C.white, m: C.cream, d: C.gold },
    { h: C.orange, l: C.cream, m: C.gold, d: C.amber },
  ]);
  paintFrames(scene, 'ui-bossnode', BOSSNODE, [
    { h: C.night, l: C.stone, m: C.slate, d: C.night },
    { h: C.wine, l: C.pink, m: C.red, d: C.crimson },
    { h: C.orange, l: C.cream, m: C.gold, d: C.amber },
  ]);
  drawSheet(scene, 'ui-hero', [HERO_IDLE, HERO_WALK1, HERO_WALK2], HERO_PAL);
  if (scene.anims.exists('ui-hero-walk')) scene.anims.remove('ui-hero-walk');
  scene.anims.create({ key: 'ui-hero-walk', frames: [1, 0, 2, 0].map((f) => ({ key: 'ui-hero', frame: f })), frameRate: 10, repeat: -1 });
  drawSheet(scene, 'ui-portrait', [PORTRAIT], PORTRAIT_PAL);
  drawSheet(scene, 'ui-spark', SPARK, { w: C.white }, { outline: false });
  drawSheet(scene, 'ui-pip', PIP, PIP_PAL);
  drawSheet(scene, 'ui-crystal', [CRYSTAL], CRYSTAL_PAL);
  drawSheet(scene, 'ui-pedestal', [PEDESTAL], PEDESTAL_PAL);
  // selection brackets (frame 0 contracted, 1 expanded) for map nodes
  drawSheet(scene, 'ui-sel', [selBox(17, 2), selBox(17, 0)], { g: C.gold });
  drawSheet(scene, 'ui-sel-big', [selBox(23, 2), selBox(23, 0)], { g: C.gold });
  // 2x2 white pixel for path dots / particles
  drawCanvas(scene, 'ui-dot', 2, 2, (ctx) => {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 2, 2);
  });
  // star field speck
  drawCanvas(scene, 'ui-px', 1, 1, (ctx) => {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 1, 1);
  });
}

/** Four L-shaped corner brackets in an n×n frame, inset by `inset` px. */
function selBox(n: number, inset: number): Frame {
  const g = Array.from({ length: n }, () => Array<string>(n).fill('.'));
  const a = inset;
  const b = n - 1 - inset;
  const L = 4;
  for (let i = 0; i < L; i++) {
    for (const [x, y] of [
      [a + i, a], [a, a + i], [b - i, a], [b, a + i],
      [a + i, b], [a, b - i], [b - i, b], [b, b - i],
    ]) g[y][x] = 'g';
  }
  return g.map((r) => r.join(''));
}

/** Same grid painted with several palettes → one sheet with a frame per palette. */
function paintFrames(scene: Phaser.Scene, key: string, frame: Frame, pals: Palette[]): void {
  // encode each palette under unique chars so one drawSheet call can hold them all
  const chars = Object.keys(pals[0]);
  const all: Palette = {};
  const frames = pals.map((p, i) => {
    const map: Record<string, string> = {};
    chars.forEach((ch, j) => {
      const code = String.fromCharCode(65 + i * chars.length + j); // A.. unique per palette entry
      map[ch] = code;
      all[code] = p[ch];
    });
    return recolor(frame, map);
  });
  drawSheet(scene, key, frames, all);
}

function drawRankSheet(scene: Phaser.Scene, ranks: Frame[]): void {
  const pals = ['S', 'A', 'B', 'C'].map((r) => {
    const [h, l, m, d] = RANK_COLS[r];
    return { h, l, m, d, w: C.white } as Palette;
  });
  const chars = ['h', 'l', 'm', 'd', 'w'];
  const all: Palette = {};
  const frames = ranks.map((f, i) => {
    const map: Record<string, string> = {};
    chars.forEach((ch, j) => {
      const code = String.fromCharCode(65 + i * chars.length + j);
      map[ch] = code;
      all[code] = pals[i][ch];
    });
    return recolor(f, map);
  });
  drawSheet(scene, 'ui-rank', frames, all);
}

// ------------------------------------------------------------------ panels

export type PanelStyle = 'dark' | 'gold' | 'red' | 'glass' | 'sel' | 'key' | 'keyDown' | 'slot' | 'parch' | 'plate' | 'card' | 'cardSel' | 'cardOff' | 'ribbon';

const hex = (c: number, a = 1) => `rgba(${(c >> 16) & 255},${(c >> 8) & 255},${c & 255},${a})`;

interface FrameSpec {
  outer: number; // outermost ring (corners cut)
  hi: number; // top/left light ring
  lo: number; // bottom/right shade ring
  inner: number; // inner dark ring
  fill: number;
  fillA: number;
  stud?: number; // corner accent
  top?: number; // highlight row under the inner ring
}

const SPECS: Partial<Record<PanelStyle, FrameSpec>> = {
  dark: { outer: C.ink, hi: C.stone, lo: C.slate, inner: C.ink, fill: C.night, fillA: 0.94, stud: C.amber, top: C.slate },
  gold: { outer: C.ink, hi: C.gold, lo: C.amber, inner: C.ink, fill: C.night, fillA: 0.96, stud: C.cream, top: C.slate },
  red: { outer: C.ink, hi: C.red, lo: C.crimson, inner: C.ink, fill: 0x2a0d1a, fillA: 0.95, stud: C.orange, top: C.wine },
  glass: { outer: C.ink, hi: C.slate, lo: C.night, inner: C.ink, fill: C.ink, fillA: 0.92 },
  parch: { outer: C.ink, hi: C.sand, lo: C.clay, inner: C.ink, fill: C.umber, fillA: 0.96, stud: C.gold, top: C.bark },
  plate: { outer: C.ink, hi: C.crimson, lo: C.wine, inner: C.ink, fill: C.ink, fillA: 0.95, stud: C.gold },
  card: { outer: C.ink, hi: C.slate, lo: C.night, inner: C.ink, fill: 0x1c1428, fillA: 0.96, top: C.night },
  cardSel: { outer: C.ink, hi: C.gold, lo: C.amber, inner: C.ink, fill: 0x2a2038, fillA: 0.98, stud: C.cream, top: C.slate },
  cardOff: { outer: C.ink, hi: C.night, lo: C.night, inner: C.ink, fill: 0x16101e, fillA: 0.9 },
  slot: { outer: C.ink, hi: C.night, lo: C.slate, inner: C.ink, fill: C.ink, fillA: 0.9 },
};

/** Paints a panel of any size into ctx (top-left at 0,0). Pixel crisp. */
export function paintPanel(ctx: CanvasRenderingContext2D, w: number, h: number, style: PanelStyle): void {
  const px = (x: number, y: number, ww: number, hh: number, c: string) => {
    ctx.fillStyle = c;
    ctx.fillRect(x, y, ww, hh);
  };
  if (style === 'sel') {
    // menu highlight bar: soft gold band with bright end caps
    px(2, 0, w - 4, h, hex(C.gold, 0.14));
    px(1, 1, 1, h - 2, hex(C.gold, 0.14));
    px(w - 2, 1, 1, h - 2, hex(C.gold, 0.14));
    px(2, 0, w - 4, 1, hex(C.gold, 0.35));
    px(2, h - 1, w - 4, 1, hex(C.amber, 0.35));
    px(0, 2, 1, h - 4, hex(C.gold, 0.9));
    px(w - 1, 2, 1, h - 4, hex(C.gold, 0.9));
    return;
  }
  if (style === 'ribbon') {
    // banner with notched ends
    const n = Math.min(6, Math.floor(h / 2));
    px(0, 0, w, h, hex(C.ink));
    px(1, 1, w - 2, h - 2, hex(C.crimson));
    px(1, 1, w - 2, 1, hex(C.red));
    px(1, h - 2, w - 2, 1, hex(C.wine));
    px(3, 3, w - 6, h - 6, hex(C.crimson));
    px(3, 2, w - 6, 1, hex(C.gold, 0.6));
    px(3, h - 3, w - 6, 1, hex(C.gold, 0.6));
    // notches
    const mid = Math.floor(h / 2);
    for (let i = 0; i < n; i++) {
      ctx.clearRect(0, mid - (n - i) + 1, i + 1, (n - i) * 2 - 1);
      ctx.clearRect(w - i - 1, mid - (n - i) + 1, i + 1, (n - i) * 2 - 1);
    }
    return;
  }
  if (style === 'key' || style === 'keyDown') {
    // dark key cap: ink rim, stone face with ash top edge, slate lip (2px, 1px when pressed)
    const down = style === 'keyDown';
    const top = down ? 1 : 0;
    px(1, top, w - 2, h - top, hex(C.ink));
    px(0, top + 1, w, h - top - 2, hex(C.ink));
    px(1, top + 1, w - 2, h - top - 2, hex(C.slate));
    px(1, top + 1, w - 2, h - top - (down ? 3 : 4), hex(C.stone));
    px(2, top + 1, w - 4, 1, hex(C.ash));
    return;
  }
  const s = SPECS[style] ?? SPECS.dark!;
  // ring 0 (outer, corners cut)
  px(1, 0, w - 2, h, hex(s.outer));
  px(0, 1, w, h - 2, hex(s.outer));
  // ring 1 bevel
  px(1, 1, w - 2, h - 2, hex(s.lo));
  px(1, 1, w - 2, 1, hex(s.hi));
  px(1, 1, 1, h - 2, hex(s.hi));
  // ring 2 inner dark
  px(2, 2, w - 4, h - 4, hex(s.inner));
  // fill (cleared first so alpha works)
  ctx.clearRect(3, 3, w - 6, h - 6);
  px(3, 3, w - 6, h - 6, hex(s.fill, s.fillA));
  if (s.top !== undefined) px(3, 3, w - 6, 1, hex(s.top, Math.min(1, s.fillA)));
  if (s.stud !== undefined && w >= 12 && h >= 12) {
    for (const [x, y] of [
      [1, 1],
      [w - 3, 1],
      [1, h - 3],
      [w - 3, h - 3],
    ]) {
      px(x, y, 2, 2, hex(s.stud));
    }
  }
}
