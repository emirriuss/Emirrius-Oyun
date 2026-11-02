import Phaser from 'phaser';
import { drawCanvas, defineAnim, sheetRegistry } from './pixel';
import { C, WORLD } from './palette';
import { GAME_W, GAME_H, TILE } from '../config';
import { T } from '../levels/LevelLoader';

/**
 * Environment art (owner: Agent C): autotiled tilesets, decorations, parallax backdrops,
 * animated props, hazards and ambient particles. Everything is generated from code into
 * canvas textures at boot; level visuals are derived from the parsed tile grid at runtime.
 */

type W = 1 | 2 | 3 | 4;
const WORLDS: W[] = [1, 2, 3, 4];
/** worlds with hand-painted art; world 4 (The Hollow Deep) is world 3 recoloured by coldRemap() */
const PAINTED: W[] = WORLDS.filter((w) => w !== 4);
/** world whose painting branches a world uses */
const paintOf = (w: W): 1 | 2 | 3 => (w === 4 ? 3 : w);

// ============================================================================ colour + noise helpers

function mix(a: number, b: number, t: number): number {
  t = Math.max(0, Math.min(1, t));
  const r = ((a >> 16) & 255) + ((((b >> 16) & 255) - ((a >> 16) & 255)) * t);
  const g = ((a >> 8) & 255) + ((((b >> 8) & 255) - ((a >> 8) & 255)) * t);
  const bl = (a & 255) + (((b & 255) - (a & 255)) * t);
  return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(bl);
}
/** darken toward ink */
const dk = (c: number, t: number): number => mix(c, 0x0a0610, t);
/** lighten toward white */
const lt = (c: number, t: number): number => mix(c, 0xffffff, t);

function h2(x: number, y: number, s = 0): number {
  let n = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 1442695041);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  n ^= n >>> 16;
  return (n >>> 0) / 4294967296;
}
function seedFrom(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function mulberry(a: number): () => number {
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** periodic 1D noise over [0, period) made from integer-frequency sines (seamless). */
function ridge(x: number, period: number, waves: [number, number, number][]): number {
  let v = 0;
  for (const [f, a, p] of waves) v += a * Math.sin((Math.PI * 2 * f * x) / period + p);
  return v;
}

function hsl(h: number, s: number, l: number): number {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1))));
  return (f(0) << 16) | (f(8) << 8) | f(4);
}
const coldCache = new Map<number, number>();
/**
 * World 4 palette remap of world-3 colours: darks -> indigo, mids/glows -> teal, highlights -> pale gold.
 * Lightness is kept so the painted shading survives.
 */
function coldRemap(c: number): number {
  const hit = coldCache.get(c);
  if (hit !== undefined) return hit;
  const r = ((c >> 16) & 255) / 255;
  const g = ((c >> 8) & 255) / 255;
  const b = (c & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  let out: number;
  if (l > 0.6) out = hsl(46, Math.min(0.6, s * 0.7 + 0.15), l);
  else {
    const t = Math.max(0, Math.min(1, (l - 0.12) / 0.38));
    out = hsl(232 - 44 * t * t, Math.max(0.12, s * 0.75), l);
  }
  coldCache.set(c, out);
  return out;
}
/** runtime tint for a world: world 4 gets the cold remap */
const tintW = (w: W, c: number): number => (w === 4 ? coldRemap(c) : c);

/** RGBA pixel buffer with alpha compositing; flushed into a canvas texture. */
class Buf {
  d: Uint8ClampedArray<ArrayBuffer>;
  constructor(public w: number, public h: number) {
    this.d = new Uint8ClampedArray(w * h * 4);
  }
  set(x: number, y: number, c: number, a = 1, wrap = false): void {
    x = Math.floor(x);
    y = Math.floor(y);
    if (wrap) x = ((x % this.w) + this.w) % this.w;
    if (x < 0 || y < 0 || x >= this.w || y >= this.h || a <= 0) return;
    const i = (y * this.w + x) * 4;
    const d = this.d;
    const r = (c >> 16) & 255;
    const g = (c >> 8) & 255;
    const b = c & 255;
    if (a >= 1) {
      d[i] = r;
      d[i + 1] = g;
      d[i + 2] = b;
      d[i + 3] = 255;
      return;
    }
    const da = d[i + 3] / 255;
    const oa = a + da * (1 - a);
    d[i] = (r * a + d[i] * da * (1 - a)) / oa;
    d[i + 1] = (g * a + d[i + 1] * da * (1 - a)) / oa;
    d[i + 2] = (b * a + d[i + 2] * da * (1 - a)) / oa;
    d[i + 3] = oa * 255;
  }
  alpha(x: number, y: number): number {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return 0;
    return this.d[(y * this.w + x) * 4 + 3];
  }
  get(x: number, y: number): number {
    const i = (y * this.w + x) * 4;
    return (this.d[i] << 16) | (this.d[i + 1] << 8) | this.d[i + 2];
  }
  clear(x: number, y: number): void {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    this.d[(y * this.w + x) * 4 + 3] = 0;
  }
  rect(x: number, y: number, w: number, h: number, c: number, a = 1): void {
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) this.set(xx, yy, c, a);
  }
  /** Stamp a string grid. pal: char -> colour or [colour, alpha]. */
  stamp(ox: number, oy: number, rows: string[], pal: Record<string, number | [number, number]>, flip = false): void {
    rows.forEach((row, y) => {
      for (let x = 0; x < row.length; x++) {
        const ch = row[x];
        if (ch === '.' || ch === ' ') continue;
        const p = pal[ch];
        if (p === undefined) throw new Error(`env stamp: palette missing '${ch}'`);
        const xx = flip ? ox + row.length - 1 - x : ox + x;
        if (typeof p === 'number') this.set(xx, oy + y, p);
        else this.set(xx, oy + y, p[0], p[1]);
      }
    });
  }
  /** Write into a (new or replaced) canvas texture; optionally register uniform frames. */
  commit(scene: Phaser.Scene, key: string, frameW?: number, frameH?: number, gallery = false): void {
    drawCanvas(scene, key, this.w, this.h, (ctx) => ctx.putImageData(new ImageData(this.d, this.w, this.h), 0, 0));
    const tex = scene.textures.get(key);
    if (frameW && frameH) {
      let i = 0;
      for (let y = 0; y + frameH <= this.h; y += frameH)
        for (let x = 0; x + frameW <= this.w; x += frameW) tex.add(i++, 0, x, y, frameW, frameH);
      if (gallery) galleryRegister(key, i, frameW, frameH);
    } else if (gallery) {
      tex.add(0, 0, 0, 0, this.w, this.h);
      galleryRegister(key, 1, this.w, this.h);
    }
  }
}

/** Copies canvas texture `src` to `dst` with every colour passed through `f` (frames + gallery entry kept). */
function cloneRemap(scene: Phaser.Scene, src: string, dst: string, f: (c: number) => number): void {
  if (!scene.textures.exists(src)) return;
  const tex = scene.textures.get(src);
  const img = tex.getSourceImage() as HTMLCanvasElement;
  const ctx = img.getContext('2d');
  if (!ctx) return;
  const b = new Buf(img.width, img.height);
  b.d.set(ctx.getImageData(0, 0, img.width, img.height).data);
  for (let i = 0; i < b.d.length; i += 4) {
    if (!b.d[i + 3]) continue;
    const c = f((b.d[i] << 16) | (b.d[i + 1] << 8) | b.d[i + 2]);
    b.d[i] = (c >> 16) & 255;
    b.d[i + 1] = (c >> 8) & 255;
    b.d[i + 2] = c & 255;
  }
  b.commit(scene, dst);
  const out = scene.textures.get(dst);
  for (const name of tex.getFrameNames()) {
    if (name === '__BASE') continue;
    const fr = tex.get(name);
    out.add(name, 0, fr.cutX, fr.cutY, fr.cutWidth, fr.cutHeight);
  }
  const reg = sheetRegistry().find((r) => r.key === src);
  if (reg) galleryRegister(dst, reg.frames, reg.w, reg.h);
}

/** Adds a canvas texture to the dev gallery listing (same registry drawSheet uses). */
function galleryRegister(key: string, frames: number, w: number, h: number): void {
  const reg = sheetRegistry() as { key: string; frames: number; w: number; h: number; anims: string[] }[];
  const prev = reg.findIndex((r) => r.key === key);
  const entry = { key, frames, w, h, anims: prev >= 0 ? reg[prev].anims : [] };
  if (prev >= 0) reg[prev] = entry;
  else reg.push(entry);
}

// ============================================================================ tileset layout

/** Visual tile indices in the `envTiles{w}` tileset (16 columns × 5 rows of 16px). */
export const VT = {
  /** solid: variant * 16 + mask (mask bits: N=1 E=2 S=4 W=8 set when that neighbour is solid) */
  SOLID: 0,
  OW_SINGLE: 48,
  OW_L: 49,
  OW_M: 50,
  OW_R: 51,
  OW_M2: 52,
  SPIKE: 56,
  SPIKE2: 57,
  /** overhang drawn in the empty cell above a ground surface: 64..66 mid variants, 67 left end, 68 right end */
  OVER: 64,
  OVER_L: 67,
  OVER_R: 68,
  /** under-hang drawn in the empty cell below a ceiling: 72..74 */
  UNDER: 72,
} as const;

/** cumulative probabilities of interior variants 0 / 1 (rest = 2) per world */
const VARIANT_P: Record<W, [number, number]> = { 1: [0.6, 0.8], 2: [0.88, 0.95], 3: [0.8, 0.95], 4: [0.8, 0.95] };
const N = 1;
const E = 2;
const S = 4;
const Wm = 8;

// ---------------------------------------------------------------------------- interior materials

function soil(x: number, y: number, v: number): number {
  const n = h2(x, y, 11 + v * 7);
  const band = h2(x >> 2, y >> 1, 5 + v);
  let c = band > 0.7 ? mix(C.bark, C.umber, 0.25) : C.bark;
  if (n < 0.13) c = C.umber;
  else if (n < 0.2 && h2(x + 1, y, 11 + v * 7) < 0.4) c = mix(C.umber, C.bark, 0.4);
  else if (n > 0.95) c = C.clay;
  return c;
}

const BRICK_BASE = mix(C.slate, C.stone, 0.35);
function brick(x: number, y: number, v: number): number {
  const row = y >> 2;
  const off = row % 2 ? 4 : 0;
  const bx = (x + off) >> 3;
  if (y % 4 === 3 || (x + off) % 8 === 7) return mix(C.night, C.slate, 0.25);
  const hb = h2(bx + v * 3, row, 21);
  let c = mix(mix(C.slate, C.stone, 0.15), BRICK_BASE, hb);
  if (hb > 0.85) c = mix(c, 0x4a4060, 0.5);
  if (y % 4 === 0) c = lt(c, 0.08);
  if (y % 4 === 2) c = dk(c, 0.12);
  if (h2(x, y, 33 + v) > 0.93) c = dk(c, 0.15);
  return c;
}

/** periodic voronoi for obsidian facets: returns [d1, d2, cellIndex, dx, dy]. */
const VOR_SEEDS: [number, number][][] = [
  [[3, 4], [11, 2], [7, 10], [14, 12], [1, 14]],
  [[5, 3], [13, 6], [2, 10], [9, 13], [12, 0]],
  [[2, 2], [9, 5], [14, 10], [5, 12], [10, 15]],
];
function vor(x: number, y: number, v: number): [number, number, number, number, number, number] {
  let d1 = 99;
  let d2 = 99;
  let ci = 0;
  let ci2 = 0;
  let ddx = 0;
  let ddy = 0;
  VOR_SEEDS[v].forEach(([sx, sy], i) => {
    for (const ox of [-16, 0, 16])
      for (const oy of [-16, 0, 16]) {
        const dx = x + 0.5 - (sx + ox);
        const dy = y + 0.5 - (sy + oy);
        const d = Math.sqrt(dx * dx + dy * dy * 1.4);
        if (d < d1) {
          if (i !== ci) ci2 = ci;
          d2 = d1;
          d1 = d;
          ci = i;
          ddx = dx;
          ddy = dy;
        } else if (d < d2 && i !== ci) {
          d2 = d;
          ci2 = i;
        }
      }
  });
  return [d1, d2, ci, ddx, ddy, ci2];
}
const OBS = [0x1a0c13, 0x22101a, 0x2b1420, 0x331824];
function obsidian(x: number, y: number, v: number): number {
  const [d1, d2, ci, dx, dy, ci2] = vor(x, y, v);
  const edge = d2 - d1;
  const base = OBS[(ci + v) % 4];
  // one glowing ember seam (between facets 0 and 1) on variant 2; ember pockets on variant 1
  const hot = v === 2 && ci + ci2 === 1;
  if (edge < 0.9) {
    if (hot) return edge < 0.45 ? C.orange : C.crimson;
    return 0x12070d;
  }
  if (hot && edge < 1.7) return mix(base, C.wine, 0.6);
  if (v === 1) {
    const pk = (x - 9) ** 2 + (y - 7) ** 2;
    if (pk < 1.5) return C.amber;
    if (pk < 3) return C.orange;
    if (pk < 5.5) return mix(base, C.crimson, 0.5);
  }
  // facet highlight on the upper-left part of each facet
  if (dx < -1 && dy < -1 && d1 > 2.2 && d1 < 4) return mix(base, 0x4a2238, 0.55);
  if (h2(x, y, 41 + v) > 0.95) return mix(base, 0x5a2a40, 0.5);
  return base;
}

// ---------------------------------------------------------------------------- solid tile painter

function paintSolid(b: Buf, ox: number, oy: number, mask: number, v: number, w: W): void {
  const nE = !(mask & N); // exposed sides
  const eE = !(mask & E);
  const sE = !(mask & S);
  const wE = !(mask & Wm);
  const cut = w === 2 ? 1 : 2;
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      // rounded outer corners
      if (nE && wE && x + y < cut) continue;
      if (nE && eE && 15 - x + y < cut) continue;
      if (sE && wE && x + 15 - y < cut) continue;
      if (sE && eE && 30 - x - y < cut) continue;
      let c: number;
      if (w === 1) c = soil(x, y, v);
      else if (w === 2) c = brick(x, y, v);
      else c = obsidian(x, y, v);

      // interior features
      if (w === 1) {
        if (v === 1) {
          // pebbles
          for (const [px, py] of [[3, 9], [10, 4], [12, 12]] as const) {
            if (y === py && x >= px && x < px + 3) c = x === px ? C.clay : C.sand;
            if (y === py + 1 && x >= px && x < px + 3) c = x === px + 2 ? C.umber : C.clay;
            if (y === py + 2 && x >= px && x < px + 3) c = mix(C.umber, C.bark, 0.3);
          }
        } else if (v === 2) {
          // root strand
          const ry = Math.round(8 + 2.2 * Math.sin(x * 0.55 + 1));
          if (y === ry) c = mix(C.umber, C.clay, 0.15);
          if (y === ry - 1 && h2(x, 3) > 0.4) c = mix(C.bark, C.clay, 0.5);
          if (x === 11 && y > ry && y < ry + 4) c = mix(C.umber, C.clay, 0.15);
        } else if (h2(x, y, 77) > 0.985) c = C.sand;
      } else if (w === 2) {
        if (v === 1) {
          // crack with moss
          const cx = Math.round(4 + y * 0.5 + (h2(y, 1, 5) > 0.5 ? 1 : 0));
          if (x === cx) c = 0x150f20;
          if (x === cx + 1 && y % 3 === 0) c = 0x150f20;
          if ((x === cx - 1 || x === cx + 2) && (y === 3 || y === 7 || y === 11) && h2(x, y, 8) > 0.2) c = y === 7 ? C.leaf : C.moss;
          if (y % 4 === 3 && h2(x, y, 9) > 0.8) c = C.moss;
        } else if (v === 2) {
          // riveted iron plate
          if (x >= 3 && x <= 12 && y >= 4 && y <= 11) {
            const iron = mix(C.night, C.navy, 0.55);
            c = iron;
            if (y === 4 || x === 3) c = mix(iron, C.ash, 0.35);
            if (y === 11 || x === 12) c = dk(iron, 0.35);
            if ((x === 4 || x === 11) && (y === 5 || y === 10)) c = C.ash;
            if ((x === 5 || x === 12) && (y === 6 || y === 11)) c = dk(iron, 0.5);
          }
        }
      }

      // ---- edges
      if (w === 1) {
        const gh = 3 + (h2(x, 0, 7 + v) > 0.5 ? 1 : 0) + (h2(x, 1, 9 + v) > 0.82 ? 1 : 0);
        if (nE) {
          if (y < gh) c = y === 0 ? (h2(x, 2, v) > 0.25 ? C.lime : C.leaf) : y === 1 ? (h2(x, 4, v) > 0.5 ? C.lime : C.leaf) : y === gh - 1 ? C.moss : C.leaf;
          else if (y === gh) c = dk(c, 0.5);
          else if (y === gh + 1) c = dk(c, 0.25);
        }
        if (wE) {
          if (nE && y < gh + 3 - (x > 0 ? 2 : 0) && x < 2) c = x === 0 ? C.moss : C.leaf;
          else if (x === 0) c = dk(c, 0.45);
          else if (x === 1) c = dk(c, 0.2);
        }
        if (eE) {
          if (nE && y < gh + 3 - (x < 15 ? 2 : 0) && x > 13) c = x === 15 ? C.pine : C.moss;
          else if (x === 15) c = dk(c, 0.5);
          else if (x === 14) c = dk(c, 0.25);
        }
        if (sE) {
          if (y === 15) c = dk(c, 0.6);
          else if (y === 14) c = dk(c, 0.3);
        }
        if (nE && y === 0 && h2(x, 9, v) > 0.85 && x > 1 && x < 14) {
          b.clear(ox + x, oy + y);
          continue;
        }
      } else if (w === 2) {
        if (nE) {
          if (y === 0) c = C.mist;
          else if (y === 1) c = h2(x, 1, v) > 0.85 ? C.mist : C.ash;
          else if (y === 2) c = h2(x, 2, v) > 0.8 ? C.stone : C.ash;
          else if (y === 3) c = C.stone;
          else if (y === 4) c = 0x1a1326;
          else if (y === 5) c = dk(c, 0.2);
        }
        if (sE) {
          const iron = mix(C.night, C.navy, 0.45);
          if (y === 12) c = 0x150f20;
          else if (y === 13) c = mix(iron, C.ash, 0.3);
          else if (y === 14) c = (x % 6 === 2) ? C.ash : iron;
          else if (y === 15) c = dk(iron, 0.4);
        }
        if (wE) {
          if (x === 0) c = nE && y < 4 ? C.ash : 0x1a1326;
          else if (x === 1 && !(nE && y < 4)) c = lt(c, 0.1);
        }
        if (eE) {
          if (x === 15) c = nE && y < 4 ? C.stone : 0x120d1c;
          else if (x === 14 && !(nE && y < 4)) c = dk(c, 0.2);
        }
      } else {
        if (nE) {
          const jag = h2(x, 5, v) > 0.5 ? 1 : 0;
          if (y === 0) c = h2(x, 6, v) > 0.8 ? C.amber : mix(C.crimson, C.orange, 0.45);
          else if (y === 1) c = C.crimson;
          else if (y === 2) c = jag ? C.crimson : C.wine;
          else if (y === 3) c = jag ? C.wine : mix(C.wine, c, 0.5);
          else if (y === 4 && jag) c = mix(C.wine, c, 0.4);
          else if (y === 4 || y === 5) c = dk(c, 0.3);
        }
        if (wE) {
          if (x === 0) c = nE && y < 3 ? C.wine : 0x0e060b;
          else if (x === 1 && !(nE && y < 3)) c = mix(c, 0x4a2238, 0.3);
        }
        if (eE) {
          if (x === 15) c = nE && y < 3 ? C.wine : 0x0a0408;
          else if (x === 14) c = dk(c, 0.25);
        }
        if (sE) {
          if (y === 15) c = 0x0a0408;
          else if (y === 14) c = dk(c, 0.35);
        }
      }
      b.set(ox + x, oy + y, c);
    }
}

// ---------------------------------------------------------------------------- one-way / spikes / hangs

function paintOneWay(b: Buf, ox: number, oy: number, left: boolean, right: boolean, alt: boolean, w: W): void {
  if (w === 1) {
    for (let x = 0; x < 16; x++) {
      if (left && x === 0) {
        b.rect(ox, oy + 1, 1, 3, C.bark);
        continue;
      }
      if (right && x === 15) {
        b.rect(ox + 15, oy + 1, 1, 3, C.umber);
        continue;
      }
      b.set(ox + x, oy, C.sand);
      for (let y = 1; y <= 3; y++) b.set(ox + x, oy + y, h2(x, y, alt ? 3 : 4) > 0.82 ? C.bark : C.clay);
      b.set(ox + x, oy + 4, C.umber);
      if (!left && !right && x === 15) b.rect(ox + 15, oy, 1, 4, C.bark); // plank seam
    }
    if (alt) b.rect(ox + 6, oy + 2, 2, 1, C.umber); // knot
    const nail = (x: number) => b.set(ox + x, oy + 2, C.ash);
    if (left) {
      nail(3);
      // diagonal bracket
      for (let i = 0; i < 5; i++) b.rect(ox + 2 + i, oy + 5 + i, 2, 1, i % 2 ? C.bark : C.umber);
      b.rect(ox + 2, oy + 5, 1, 7, C.umber);
    }
    if (right) {
      nail(12);
      for (let i = 0; i < 5; i++) b.rect(ox + 12 - i, oy + 5 + i, 2, 1, i % 2 ? C.bark : C.umber);
      b.rect(ox + 13, oy + 5, 1, 7, C.umber);
    }
  } else if (w === 2) {
    const iron = mix(C.night, C.navy, 0.45);
    for (let x = 0; x < 16; x++) {
      b.set(ox + x, oy, C.mist);
      b.set(ox + x, oy + 1, C.ash);
      for (let y = 2; y <= 3; y++) b.set(ox + x, oy + y, x % 3 === 1 ? 0x120d1c : C.stone);
      b.set(ox + x, oy + 4, iron);
      b.set(ox + x, oy + 5, 0x120d1c);
    }
    if (left) {
      b.clear(ox, oy);
      b.rect(ox, oy + 1, 1, 4, iron);
      b.set(ox + 2, oy + 4, C.mist);
      // hanging support strut
      for (let y = 6; y < 10; y++) b.set(ox + 2, oy + y, y % 2 ? C.stone : iron);
    }
    if (right) {
      b.clear(ox + 15, oy);
      b.rect(ox + 15, oy + 1, 1, 4, iron);
      b.set(ox + 13, oy + 4, C.mist);
      for (let y = 6; y < 10; y++) b.set(ox + 13, oy + y, y % 2 ? C.stone : iron);
    }
    if (alt) b.set(ox + 8, oy + 4, C.ash);
  } else {
    for (let x = 0; x < 16; x++) {
      b.set(ox + x, oy, h2(x, 0, alt ? 1 : 2) > 0.7 ? C.orange : C.crimson);
      b.set(ox + x, oy + 1, C.wine);
      for (let y = 2; y <= 4; y++) b.set(ox + x, oy + y, OBS[(h2(x >> 2, y, 3) * 4) | 0]);
      b.set(ox + x, oy + 5, 0x0a0408);
    }
    if (alt) {
      b.set(ox + 7, oy + 3, C.orange);
      b.set(ox + 8, oy + 2, C.crimson);
    }
    const chain = (x: number) => {
      for (let y = 6; y < 13; y++) {
        const link = Math.floor((y - 6) / 2) % 2;
        b.set(ox + x + (link ? 0 : -1), oy + y, link ? C.stone : C.slate);
        if (!link) b.set(ox + x + 1, oy + y, C.slate);
      }
    };
    if (left) {
      b.clear(ox, oy);
      b.clear(ox, oy + 5);
      chain(3);
    }
    if (right) {
      b.clear(ox + 15, oy);
      b.clear(ox + 15, oy + 5);
      chain(12);
    }
  }
}

function paintSpikes(b: Buf, ox: number, oy: number, alt: boolean, w: W): void {
  const light = w === 3 ? 0xd8c8cc : C.mist;
  // W2 spikes get rusty iron so they don't read as stone railings
  const mid = w === 3 ? 0x8a6a78 : w === 2 ? 0xa8664a : C.ash;
  const dark = w === 3 ? 0x4a2a38 : w === 2 ? 0x5a2a2a : C.stone;
  const plate = w === 1 ? C.umber : w === 2 ? mix(C.night, C.navy, 0.45) : 0x2a0e18;
  // two large spikes per tile (1px tips, 7px bases) with small ones between on the alt variant
  const spike = (cx: number, top: number, base: number) => {
    for (let y = top; y <= 13; y++) {
      const hw = 0.5 + ((y - top) / (base - top)) * 3;
      for (let x = Math.floor(cx - 4); x <= cx + 4; x++) {
        const dx = x - cx;
        if (Math.abs(dx) > hw - 0.5 || x < 0 || x > 15) continue;
        let c = dx < 0 ? mid : dx === 0 ? light : dark;
        if (dx === -1 && y > top + 2) c = light;
        if (y <= top + 1) c = C.white;
        if (w === 3 && y === top + 2) c = C.amber;
        b.set(ox + x, oy + y, c);
      }
    }
  };
  if (alt) spike(7, 9, 13);
  spike(3, 4, 13);
  spike(11, alt ? 5 : 4, 13);
  b.rect(ox, oy + 14, 16, 1, w === 3 ? C.wine : mix(plate, C.ash, 0.4));
  b.rect(ox, oy + 15, 16, 1, plate);
  for (let x = 2; x < 16; x += 5) b.set(ox + x, oy + 14, C.mist);
}

function paintOverhang(b: Buf, ox: number, oy: number, variant: number, end: -1 | 0 | 1, w: W): void {
  if (w === 1) {
    for (let x = 0; x < 16; x++) {
      if (end === -1 && x < 3) continue;
      if (end === 1 && x > 12) continue;
      const r = h2(x, variant, 91);
      if (r < 0.35) continue;
      const bh = r > 0.9 ? 4 + ((h2(x, variant, 3) * 3) | 0) : 1 + ((h2(x, variant, 4) * 3) | 0);
      const lean = h2(x, variant, 5) > 0.5 ? 1 : -1;
      for (let i = 0; i < bh; i++) {
        const xx = x + (i >= 3 ? lean : 0);
        b.set(ox + xx, oy + 15 - i, i === bh - 1 ? C.lime : i === 0 ? C.moss : C.leaf);
      }
    }
  } else if (w === 3) {
    for (let x = 0; x < 16; x++) {
      if ((end === -1 && x < 2) || (end === 1 && x > 13)) continue;
      b.set(ox + x, oy + 15, C.orange, 0.22);
      b.set(ox + x, oy + 14, C.orange, 0.1);
      const r = h2(x, variant, 17);
      if (r > 0.86) {
        b.set(ox + x, oy + 15, C.crimson);
        if (r > 0.95) b.set(ox + x, oy + 14, C.wine);
      }
    }
  } else {
    // W2: thin dust/moss line on the coping
    for (let x = 0; x < 16; x++) {
      if ((end === -1 && x < 2) || (end === 1 && x > 13)) continue;
      const r = h2(x, variant, 23);
      if (r > 0.88) b.set(ox + x, oy + 15, C.moss);
      if (r > 0.96) b.set(ox + x, oy + 14, C.leaf);
    }
  }
}

function paintUnderhang(b: Buf, ox: number, oy: number, variant: number, w: W): void {
  const shadow = w === 1 ? C.umber : w === 2 ? 0x120d1c : 0x0a0408;
  for (let x = 0; x < 16; x++) {
    b.set(ox + x, oy, shadow, 0.35);
    b.set(ox + x, oy + 1, shadow, 0.15);
  }
  if (w === 1) {
    for (let k = 0; k < 3; k++) {
      const x = 1 + ((h2(k, variant, 31) * 14) | 0);
      const len = 2 + ((h2(k, variant, 32) * 6) | 0);
      for (let i = 0; i < len; i++) b.set(ox + x + (i > 3 ? 1 : 0), oy + i, i === len - 1 ? mix(C.umber, C.moss, 0.5) : mix(C.umber, C.pine, 0.25));
    }
    for (let x = 0; x < 16; x++) if (h2(x, variant, 33) > 0.75) b.set(ox + x, oy, C.moss);
  } else if (w === 2) {
    for (let k = 0; k < 2; k++) {
      const x = 2 + ((h2(k, variant, 41) * 12) | 0);
      if (h2(k, variant, 43) < 0.5) continue;
      const len = 1 + ((h2(k, variant, 42) * 3) | 0);
      for (let i = 0; i < len; i++) b.set(ox + x, oy + i, i === len - 1 ? C.leaf : C.moss);
    }
  } else {
    for (let k = 0; k < 3; k++) {
      const x = 1 + ((h2(k, variant, 51) * 13) | 0);
      const len = 2 + ((h2(k, variant, 52) * 4) | 0);
      for (let i = 0; i < len; i++) {
        const half = Math.max(0, Math.round((1 - i / len) * 1.2));
        for (let dx = -half; dx <= half; dx++) b.set(ox + x + dx, oy + i, dx < 0 ? 0x331824 : 0x1a0c13);
      }
      b.set(ox + x, oy + len, C.orange, 0.8);
    }
  }
}

function buildTileset(scene: Phaser.Scene, w: W): void {
  const b = new Buf(256, 80);
  for (let v = 0; v < 3; v++) for (let m = 0; m < 16; m++) paintSolid(b, m * 16, v * 16, m, v, w);
  const at = (i: number): [number, number] => [(i % 16) * 16, Math.floor(i / 16) * 16];
  paintOneWay(b, ...at(VT.OW_SINGLE), true, true, false, w);
  paintOneWay(b, ...at(VT.OW_L), true, false, false, w);
  paintOneWay(b, ...at(VT.OW_M), false, false, false, w);
  paintOneWay(b, ...at(VT.OW_R), false, true, false, w);
  paintOneWay(b, ...at(VT.OW_M2), false, false, true, w);
  paintSpikes(b, ...at(VT.SPIKE), false, w);
  paintSpikes(b, ...at(VT.SPIKE2), true, w);
  for (let i = 0; i < 3; i++) paintOverhang(b, ...at(VT.OVER + i), i, 0, w);
  paintOverhang(b, ...at(VT.OVER_L), 0, -1, w);
  paintOverhang(b, ...at(VT.OVER_R), 1, 1, w);
  for (let i = 0; i < 3; i++) paintUnderhang(b, ...at(VT.UNDER + i), i, w);
  b.commit(scene, `envTiles${w}`);
  buildTilePreview(scene, w, b);
}

/** Small autotiled terrain sample for the dev gallery ('tiles-w{n}'). */
function buildTilePreview(scene: Phaser.Scene, w: W, tiles: Buf): void {
  const grid = [
    '..........==..',
    '..##..........',
    '..##.....^^...',
    '#######.######',
    '#######.######',
    '##############',
  ];
  const Hh = grid.length;
  const Ww = grid[0].length;
  const b = new Buf(Ww * 16, Hh * 16);
  const sky = WORLD[w].sky[1];
  b.rect(0, 0, b.w, b.h, sky);
  const solid = (x: number, y: number) => x < 0 || x >= Ww || y >= Hh || (y >= 0 && grid[y][x] === '#');
  const blit = (idx: number, cx: number, cy: number, tint = 1) => {
    const sx = (idx % 16) * 16;
    const sy = Math.floor(idx / 16) * 16;
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++) {
        const a = tiles.alpha(sx + x, sy + y);
        if (a) b.set(cx * 16 + x, cy * 16 + y, mix(0, tiles.get(sx + x, sy + y), tint), a / 255);
      }
  };
  for (let y = 0; y < Hh; y++)
    for (let x = 0; x < Ww; x++) {
      const ch = grid[y][x];
      if (ch === '#') {
        const m = (solid(x, y - 1) && y > 0 ? N : 0) | (solid(x + 1, y) ? E : 0) | (solid(x, y + 1) ? S : 0) | (solid(x - 1, y) ? Wm : 0);
        const v = h2(x, y, 3) < 0.6 ? 0 : h2(x, y, 3) < 0.8 ? 1 : 2;
        blit(v * 16 + m, x, y, y >= 5 ? 0.75 : 1);
      } else if (ch === '=') blit(grid[y][x - 1] === '=' ? VT.OW_R : VT.OW_L, x, y);
      else if (ch === '^') blit(VT.SPIKE, x, y);
      else if (solid(x, y + 1)) blit(VT.OVER + (x % 3), x, y);
      else if (y > 0 && solid(x, y - 1)) blit(VT.UNDER + (x % 3), x, y);
    }
  b.commit(scene, `tiles-w${w}-preview`, undefined, undefined, true);
}

// ============================================================================ decoration tiles

/** Decoration tile indices in `envDeco{w}` (16 columns × 2 rows). */
const D = {
  // W1
  TUFT_A: 0, TUFT_B: 1, FERN: 2, FLOWER_P: 3, FLOWER_G: 4, FLOWER_C: 5, SHROOM_R: 6, SHROOM_C: 7, ROCK: 8,
  VINE_TOP: 9, VINE_MID: 10, VINE_END: 11, ROOTS: 12,
  // W2
  CHAIN_TOP: 0, CHAIN_MID: 1, CHAIN_END: 2, BANNER_TOP: 3, BANNER_BOT: 4, RUBBLE: 5, CANDLE: 6, WEB_L: 7, WEB_R: 8,
  WIN: 9, // 9..14 : 2x3 window (TL TR ML MR BL BR)
  // W3
  BONES: 0, SKULL: 1, CRYSTAL_S: 2, CRYSTAL_L: 3, VENT: 4, CHAIN3_TOP: 5, CHAIN3_MID: 6, CHAIN3_END: 7, STALAC: 8, CANDLE3: 9,
} as const;

const P1: Record<string, number> = { g: C.leaf, l: C.lime, m: C.moss, d: C.pine, p: C.pink, P: C.magenta, w: C.white, y: C.gold, Y: C.cream, r: C.red, R: C.crimson, k: C.sand, b: C.bark, u: C.umber, c: C.cyan, i: C.ice, t: C.teal, s: C.stone, a: C.ash, o: C.orange, n: C.navy, B: C.blue };

function bottom(b: Buf, idx: number, rows: string[], pal: Record<string, number | [number, number]> = P1): void {
  b.stamp((idx % 16) * 16, Math.floor(idx / 16) * 16 + 16 - rows.length, rows, pal);
}
function topA(b: Buf, idx: number, rows: string[], pal: Record<string, number | [number, number]> = P1): void {
  b.stamp((idx % 16) * 16, Math.floor(idx / 16) * 16, rows, pal);
}

function paintChain(b: Buf, idx: number, kind: 'top' | 'mid' | 'end', light: number, darkc: number): void {
  const ox = (idx % 16) * 16;
  const oy = Math.floor(idx / 16) * 16;
  const x = ox + 7;
  const y0 = kind === 'top' ? 3 : 0;
  if (kind === 'top') {
    b.rect(ox + 4, oy, 8, 2, darkc);
    b.rect(ox + 4, oy, 8, 1, light);
    b.set(ox + 5, oy + 1, C.mist);
    b.set(ox + 10, oy + 1, C.mist);
    b.rect(x, oy + 2, 2, 1, darkc);
  }
  const yEnd = kind === 'end' ? 9 : 16;
  for (let y = y0; y < yEnd; y++) {
    const ph = (y - y0) % 6;
    if (ph < 4) {
      // ring link seen face-on
      const edge = ph === 0 || ph === 3;
      if (edge) b.rect(x, oy + y, 2, 1, ph === 0 ? light : darkc);
      else {
        b.set(x - 1, oy + y, light);
        b.set(x + 2, oy + y, darkc);
      }
    } else b.rect(x, oy + y, 2, 1, ph === 4 ? light : darkc);
  }
  if (kind === 'end') {
    // hook
    b.rect(x, oy + 9, 2, 1, light);
    b.set(x + 1, oy + 10, light);
    b.set(x + 2, oy + 11, darkc);
    b.set(x + 2, oy + 12, darkc);
    b.set(x + 1, oy + 13, darkc);
    b.set(x, oy + 13, light);
    b.set(x - 1, oy + 12, light);
  }
}

function paintVine(b: Buf, idx: number, kind: 'top' | 'mid' | 'end', seed: number): void {
  const ox = (idx % 16) * 16;
  const oy = Math.floor(idx / 16) * 16;
  const yEnd = kind === 'end' ? 11 : 16;
  for (let y = 0; y < yEnd; y++) {
    const x = 7 + Math.round(1.3 * Math.sin((y + seed) * 0.5));
    b.set(ox + x, oy + y, y % 5 === 0 ? C.moss : mix(C.moss, C.pine, 0.4));
    if ((y + seed) % 4 === 1) {
      const side = (y + seed) % 8 === 1 ? -1 : 1;
      b.set(ox + x + side, oy + y, C.leaf);
      b.set(ox + x + side * 2, oy + y, C.leaf);
      b.set(ox + x + side * 2, oy + y + 1, C.lime);
      b.set(ox + x + side, oy + y + 1, C.moss);
    }
  }
  if (kind === 'top') {
    for (let x = 4; x < 12; x++) b.set(ox + x, oy, h2(x, 1, seed) > 0.4 ? C.moss : C.leaf);
  }
  if (kind === 'end') {
    const x = 7 + Math.round(1.3 * Math.sin((yEnd + seed) * 0.5));
    b.rect(ox + x - 1, oy + 11, 3, 2, C.leaf);
    b.set(ox + x, oy + 13, C.lime);
    b.set(ox + x + 1, oy + 11, C.pink);
  }
}

function buildDecoTiles(scene: Phaser.Scene, w: W): void {
  const b = new Buf(256, 32);
  if (w === 1) {
    bottom(b, D.TUFT_A, [
      '.....l....l.....',
      '..l..l...lg..l..',
      '..gl.gl..gm.lg..',
      '...gmgg.mgg.gm..',
      '..mgggggggggg...',
      '.mmgggmgggggmm..',
    ]);
    bottom(b, D.TUFT_B, [
      '.........l......',
      '....l..l.gl.....',
      '....gl.g.gm..l..',
      '...mgggggg..gm..',
      '...mgggmggmgm...',
    ]);
    bottom(b, D.FERN, [
      '.......l........',
      '.....l.g.l......',
      '....lg.g.gl.....',
      '...g..ggg..g....',
      '..g.l.ggg.l.g...',
      '..l..gggggg..l..',
      '......mggm......',
    ]);
    bottom(b, D.FLOWER_P, [
      '.....p.p........',
      '....pPwPp.......',
      '.....pPp........',
      '......g...l.....',
      '...l..g...g.....',
      '...gl.g..lg.....',
      '....gggg.gm.....',
      '...mggggggg.....',
    ]);
    bottom(b, D.FLOWER_G, [
      '.........y......',
      '...y....yYy.....',
      '..yYy....y......',
      '...y.....g......',
      '...g..l..g......',
      '...gl.g.lg......',
      '..mggggggm......',
    ]);
    bottom(b, D.FLOWER_C, [
      '......c.........',
      '.....cic........',
      '.....ctc...c....',
      '......g...cic...',
      '......g....g....',
      '...l..g..l.g....',
      '...mggggggggm...',
    ]);
    bottom(b, D.SHROOM_R, [
      '....RRRR........',
      '...RrwrrR.......',
      '..RrrrrwrR......',
      '..RwrrrrrR......',
      '...kkkkkk.......',
      '.....YY....rr...',
      '.....YY...rwrR..',
      '.....YY...RkkR..',
      '....mYYm...Y....',
    ]);
    bottom(b, D.SHROOM_C, [
      '.......tt.......',
      '......tcct......',
      '.....tciict.....',
      '......kkkk......',
      '..tt...YY.......',
      '.tcit..YY.......',
      '..kk...YY.......',
      '..Y...mYYm......',
    ]);
    bottom(b, D.ROCK, [
      '.....aaas.......',
      '...aaasssss.....',
      '..aasssssssu....',
      '.usssssssuuum...',
      'mmuuusuuuuumm...',
    ]);
    paintVine(b, D.VINE_TOP, 'top', 0);
    paintVine(b, D.VINE_MID, 'mid', 16);
    paintVine(b, D.VINE_END, 'end', 32);
    topA(b, D.ROOTS, [
      'mmuubbuuummbbuum',
      '.u.b..u..m.u..u.',
      '.u.b...u...u..b.',
      '..ub...u...b....',
      '...b...b...u....',
      '...u.......u....',
      '....u......b....',
      '....b...........',
    ]);
  } else if (w === 2) {
    const iron = mix(C.night, C.navy, 0.45);
    paintChain(b, D.CHAIN_TOP, 'top', C.ash, C.slate);
    paintChain(b, D.CHAIN_MID, 'mid', C.ash, C.slate);
    paintChain(b, D.CHAIN_END, 'end', C.ash, C.slate);
    const PB: Record<string, number> = { i: iron, a: C.ash, m: C.mist, r: C.crimson, R: C.wine, d: 0x3a0e22, y: C.gold, Y: C.amber, o: C.orange };
    topA(b, D.BANNER_TOP, [
      '.m............m.',
      'aiiiiiiiiiiiiiia',
      '..yrrrrrrrrrry..',
      '..yrrRrrrRrrry..',
      '..yrrRrrrRrrry..',
      '..yrrRrrrRrrry..',
      '..yrrRrrrRrrry..',
      '..yrrRrrrRrrry..',
      '..yrrRrryRrrry..',
      '..yrrRryYyrrry..',
      '..yrrRyYoYyrry..',
      '..yrryYoooYyry..',
      '..yrrRyYoYyrry..',
      '..yrrRryYyrrry..',
      '..yrrRrryRrrry..',
      '..yrrRrrrRrrry..',
    ], PB);
    topA(b, D.BANNER_BOT, [
      '..yrrRrrrRrrry..',
      '..yrrRrrrRrrry..',
      '..yrrRrrrRrrry..',
      '..yrrRrrrRrrry..',
      '..yrrRrrrRrrry..',
      '..yyyyyyyyyyyy..',
      '..yrrRrrrRrrry..',
      '..yrrRrrrRrrry..',
      '..yrrRr..Rrrry..',
      '..yrrR....rrry..',
      '..yrr......rry..',
      '..yr........ry..',
      '..y..........y..',
    ], PB);
    bottom(b, D.RUBBLE, [
      '..........a.....',
      '...am....ass....',
      '..asss..asssd...',
      '.asssdd.sssdd.a.',
    ], { a: C.ash, s: C.stone, d: C.slate, m: C.mist });
    bottom(b, D.CANDLE, [
      '.....y..........',
      '....yoy.........',
      '.....o.....y....',
      '....www...yoy...',
      '....wwm....o....',
      '....wwm...www...',
      '....wwm...wwm...',
      '...isssi.isssi..',
    ], { y: C.gold, o: C.orange, w: C.cream, m: C.sand, s: C.stone, i: iron });
    topA(b, D.WEB_L, [
      'mmmmmmmm........',
      'm.m..m..........',
      'mm..m...........',
      'm.mm............',
      'm.m.............',
      'mm..............',
      'm...............',
      'm...............',
    ].map((r) => r), { m: [C.mist, 0.35] });
    topA(b, D.WEB_R, [
      '........mmmmmmmm',
      '..........m..m.m',
      '...........m..mm',
      '............mm.m',
      '.............m.m',
      '..............mm',
      '...............m',
      '...............m',
    ], { m: [C.mist, 0.35] });
    // 2x3 arched window (32x48), split across 6 deco tiles
    const win = new Buf(32, 48);
    for (let y = 0; y < 48; y++)
      for (let x = 0; x < 32; x++) {
        const dx = x + 0.5 - 16;
        const inArch = (r: number) => (y >= 14 ? Math.abs(dx) < r : dx * dx + (y + 0.5 - 14) ** 2 < r * r);
        if (y > 44) continue;
        if (inArch(9)) {
          if (inArch(7)) {
            // glass: warm glow, brighter at bottom
            const t = y / 44;
            let c = mix(C.amber, C.gold, 0.2 + t * 0.6);
            if (h2(x >> 1, y >> 1, 4) > 0.85) c = lt(c, 0.25);
            if (Math.abs(dx) < 1) c = 0x150f20; // mullion
            if (y === 26 || y === 27 || y === 13) c = 0x150f20;
            if ((x === 11 || x === 20) && y > 13) c = mix(c, C.orange, 0.45);
            win.set(x, y, c);
          } else {
            const lit = dx < 0 || y < 8;
            win.set(x, y, lit ? C.ash : C.stone);
            if (y >= 14 && y % 6 === 0) win.set(x, y, 0x1a1326);
          }
        }
      }
    for (let x = 5; x < 27; x++) {
      win.set(x, 44, C.mist);
      win.set(x, 45, C.ash);
      win.set(x, 46, C.stone);
      win.set(x, 47, 0x1a1326);
    }
    for (let i = 0; i < 6; i++) {
      const tx = (i % 2) * 16;
      const ty = Math.floor(i / 2) * 16;
      const idx = D.WIN + i;
      for (let y = 0; y < 16; y++)
        for (let x = 0; x < 16; x++) {
          const a = win.alpha(tx + x, ty + y);
          if (a) b.set((idx % 16) * 16 + x, Math.floor(idx / 16) * 16 + y, win.get(tx + x, ty + y), a / 255);
        }
    }
  } else {
    const PB: Record<string, number> = { w: C.white, m: C.mist, a: C.ash, s: C.stone, k: C.ink, p: C.pink, P: C.magenta, v: C.violet, r: C.crimson, o: C.orange, y: C.amber, b: 0x1a0c13, B: 0x331824, n: C.wine };
    bottom(b, D.BONES, [
      '...........mm...',
      '.mm.......mwwm..',
      'mwwmmmmmmmwkwkm.',
      '.mmwwwwwwwwwwwm.',
      '.....aaaaa.mamm.',
      '..aaasa..aaa....',
    ], PB);
    bottom(b, D.SKULL, [
      '.....mmmm.......',
      '....mwwwwm......',
      '...mwwwwwwm.....',
      '...mwkkwkkm.....',
      '...mwkkwkkm.....',
      '....mwwkwm......',
      '....mwmwmm..a...',
      '..aa.mmmm..asa..',
    ], PB);
    bottom(b, D.CRYSTAL_S, [
      '.......p........',
      '......pP........',
      '......pP....p...',
      '..p...pPv..pP...',
      '..pP..pPv..pPv..',
      '..pPv.pPv..pPv..',
      '.BBBBBBBBBBBBBB.',
    ], PB);
    bottom(b, D.CRYSTAL_L, [
      '.....p..........',
      '....pP......p...',
      '....pPv....pP...',
      '....pPv..p.pPv..',
      '..p.pPv.pP.pPv..',
      '.pP.pPv.pPvpPv..',
      '.pPvpPv.pPvpPv..',
      '.pPvpPvvpPvpPv..',
      'BBBBBBBBBBBBBBB.',
    ], PB);
    bottom(b, D.VENT, [
      '......r..r......',
      '.....bryyrb.....',
      '...bbBroorBbb...',
      '..bBBBbrrbBBBb..',
      '.bBBBBBBBBBBBBb.',
    ], PB);
    paintChain(b, D.CHAIN3_TOP, 'top', C.stone, C.slate);
    paintChain(b, D.CHAIN3_MID, 'mid', C.stone, C.slate);
    paintChain(b, D.CHAIN3_END, 'end', C.stone, C.slate);
    topA(b, D.STALAC, [
      'bBBBBBBBBBBBBBb.',
      '.bBBpBBbBBBpBb..',
      '..bBpPbbBBpPb...',
      '..bBpPv.bBpPv...',
      '...bpPv..bpPv...',
      '....pPv...pP....',
      '....pP....pP....',
      '.....P.....P....',
      '.....p..........',
    ], PB);
    bottom(b, D.CANDLE3, [
      '.....y..........',
      '....yoy.........',
      '.....o..........',
      '....nrn.........',
      '....nrn.........',
      '...bBBBb........',
    ], PB);
  }
  // numbered 16x16 frames: reactive (swaying) decorations are spawned as images from these
  b.commit(scene, `envDeco${w}`, 16, 16);
}

// ============================================================================ props & animated sprites

function buildProps(scene: Phaser.Scene): void {
  // ---- checkpoint (unlit / lit). 16x24, base on the bottom row; flame overlay is a separate anim.
  for (const lit of [false, true]) {
    const b = new Buf(16, 24);
    const pal: Record<string, number> = {
      s: C.stone, a: C.ash, m: C.mist, d: C.slate, k: C.night,
      f: lit ? 0x06d6a0 : 0x4a5a6a, F: lit ? 0x0b8f74 : 0x343c4c, g: lit ? C.ice : C.ash, i: mix(C.night, C.navy, 0.5), y: lit ? C.gold : C.stone,
    };
    b.stamp(0, 0, [
      '.....iyyi.......',
      '.....iaai.......',
      '......am........',
      '......amiiiiii..',
      '......amfffff...',
      '......amffgff...',
      '......amfgggf...',
      '......amffgff...',
      '......amffgfF...',
      '......amfffFF...',
      '......amffFF....',
      '......amfF.F....',
      '......amF.......',
      '......am........',
      '......am........',
      '......am........',
      '......am........',
      '......am........',
      '.....samd.......',
      '....ssaadd......',
      '...samaamdd.....',
      '..ssssssssdd....',
      '..saaaaaaasd....',
      '.ddddddddddkk...',
    ], pal);
    if (lit) {
      // glowing runes on the pedestal
      b.set(5, 22, C.cyan);
      b.set(7, 22, C.ice);
      b.set(9, 22, C.cyan);
    }
    b.commit(scene, lit ? 'checkpointOn' : 'checkpoint', 16, 24, true);
  }
  // spirit flame sitting in the brazier cup
  {
    const fw = 8;
    const fh = 12;
    const b = new Buf(fw * 4, fh);
    for (let f = 0; f < 4; f++)
      for (let y = 0; y < fh; y++)
        for (let x = 0; x < fw; x++) {
          const t = y / (fh - 1); // 0 top .. 1 bottom
          const sway = Math.sin(f * 1.6 + y * 0.6) * (1 - t) * 1.3;
          const hw = 0.5 + t * 2.8 * (0.85 + 0.15 * Math.sin(f * 2 + y));
          const dx = x + 0.5 - 4 - sway;
          if (Math.abs(dx) > hw || y < (f % 2)) continue;
          const core = Math.abs(dx) < hw * 0.45 && t > 0.35;
          b.set(f * fw + x, y, core ? C.white : t > 0.55 ? C.cyan : 0x06d6a0);
        }
    b.commit(scene, 'cpFlame', fw, fh, true);
    defineAnim(scene, 'cpFlame-burn', 'cpFlame', [0, 1, 2, 3], 10);
  }

  // ---- exit portal (16x32, 8 frames): stone arch + swirling vortex
  {
    const fw = 16;
    const fh = 32;
    const nF = 8;
    const b = new Buf(fw * nF, fh);
    for (let f = 0; f < nF; f++) {
      const ox = f * fw;
      for (let y = 0; y < fh; y++)
        for (let x = 0; x < fw; x++) {
          const dx = x + 0.5 - 8;
          const inside = (r: number) => (y >= 8 ? Math.abs(dx) < r : dx * dx + (y + 0.5 - 8) ** 2 < r * r);
          if (!inside(8)) continue;
          if (!inside(5.5)) {
            // stone arch blocks
            let c: number = dx < 0 ? C.ash : C.stone;
            if (y < 4) c = C.mist;
            if ((y + (dx < 0 ? 0 : 3)) % 6 === 0) c = C.slate;
            if (Math.abs(dx) > 7) c = C.slate;
            if (y === 1 && Math.abs(dx) < 1) c = C.cyan; // keystone gem
            b.set(ox + x, y, c);
            continue;
          }
          // vortex
          const cy = 18;
          const ry = y + 0.5 - cy;
          const r = Math.sqrt(dx * dx + (ry * 0.45) ** 2);
          const a = Math.atan2(ry * 0.45, dx);
          const sw = Math.sin(a * 2 + r * 1.3 - (f / nF) * Math.PI * 2);
          let c = mix(0x1a2a50, C.teal, 0.3);
          if (sw > 0.2) c = mix(C.teal, C.cyan, (sw - 0.2) * 1.2);
          if (sw > 0.8) c = C.ice;
          if (r < 1.2) c = C.white;
          b.set(ox + x, y, c);
        }
      // base step
      for (let x = 0; x < fw; x++) b.set(ox + x, fh - 1, x < 8 ? C.stone : C.slate);
    }
    b.commit(scene, 'exitPortal', fw, fh, true);
    defineAnim(scene, 'exitPortal-swirl', 'exitPortal', [0, 1, 2, 3, 4, 5, 6, 7], 10);
  }

  // ---- pickups (same frame size as the legacy textures, so physics bodies match)
  {
    const fw = 8;
    const fh = 10;
    const nF = 8;
    const b = new Buf(fw * nF, fh);
    for (let f = 0; f < nF; f++) {
      const sq = Math.abs(Math.cos((f / nF) * Math.PI)); // spin squash 1..0..1
      const hw = 0.6 + sq * 3.4;
      for (let y = 0; y < fh; y++) {
        const t = y < 5 ? y / 4.5 : (fh - 1 - y) / 4.5;
        const rw = hw * Math.min(1, t + 0.1);
        for (let x = 0; x < fw; x++) {
          const dx = x + 0.5 - 4;
          if (Math.abs(dx) > rw + 0.05) continue;
          let c: number = dx < 0 ? C.gold : C.amber;
          if (y >= 6) c = dx < 0 ? C.amber : C.orange;
          if (Math.abs(dx) > rw - 0.9) c = y < 5 ? C.amber : mix(C.orange, C.crimson, 0.3);
          if (dx < 0 && dx > -1.2 && y >= 2 && y <= 4 && sq > 0.3) c = C.cream;
          b.set(f * fw + x, y, c);
        }
      }
      if (f === 0 || f === 7) b.set(f * fw + 3, 1, C.white);
    }
    b.commit(scene, 'pickupShard', fw, fh, true);
    defineAnim(scene, 'pickupShard-spin', 'pickupShard', [0, 1, 2, 3, 4, 5, 6, 7], 10);
  }
  {
    const fw = 10;
    const fh = 9;
    const shapes = [
      ['.rr...rr..', 'rwrr.rRRr.', 'rwrrrrRRR.', 'rrrrrrRRR.', '.rrrrRRR..', '..rrRRR...', '...rRR....', '....R.....', '..........'],
      ['.rr..rr...', 'rwrrrrRr..', 'rwrrrrRRr.', 'rrrrrRRRr.', '.rrrRRRr..', '..rrRRr...', '...rRr....', '....r.....', '..........'],
      ['.pp...pp..', 'pwpp.pppp.', 'pwpppppppR', 'pppppppprR', '.ppppprrR.', '..ppprrR..', '...prrR...', '....rR....', '.....R....'],
    ];
    const order = [0, 0, 1, 2, 1, 0];
    const b = new Buf(fw * order.length, fh);
    order.forEach((s, f) => b.stamp(f * fw, 0, shapes[s], { r: C.red, R: C.crimson, w: C.white, p: C.pink }));
    b.commit(scene, 'pickupHeart', fw, fh, true);
    defineAnim(scene, 'pickupHeart-pulse', 'pickupHeart', [0, 1, 2, 3, 4, 5], 8);
  }
  // plain 2x2 particle dot (the legacy 'px' key is taken by the pixel font atlas)
  {
    const b = new Buf(2, 2);
    b.rect(0, 0, 2, 2, 0xffffff);
    b.commit(scene, 'envDot');
  }
  // twinkle particle
  {
    const b = new Buf(5, 5);
    b.stamp(0, 0, ['..w..', '..w..', 'wwWww', '..w..', '..w..'], { w: [C.cream, 0.8], W: C.white });
    b.commit(scene, 'twinkle');
  }

  // ---- wall torch (W2): 10x16, 4 frames
  {
    const fw = 10;
    const fh = 16;
    const b = new Buf(fw * 4, fh);
    const iron = mix(C.night, C.navy, 0.45);
    for (let f = 0; f < 4; f++) {
      const ox = f * fw;
      // bracket arm attached to the wall on the left
      b.stamp(ox, 8, [
        '..iaaai...',
        '..iyyyi...',
        '...iai....',
        'ii.ia.....',
        'aiiia.....',
        'ii..i.....',
        '....i.....',
        '..........',
      ], { i: iron, a: C.ash, y: C.bark });
      for (let y = 0; y < 8; y++)
        for (let x = 0; x < fw; x++) {
          const t = y / 7;
          const sway = Math.sin(f * 1.7 + y * 0.8) * (1 - t) * 1.2;
          const hw = 0.4 + t * 2.4 * (0.85 + 0.2 * Math.sin(f * 2.3 + y));
          const dx = x + 0.5 - 5 - sway;
          if (Math.abs(dx) > hw || y < (f % 2)) continue;
          const core = Math.abs(dx) < hw * 0.45 && t > 0.4;
          b.set(ox + x, y, core ? C.cream : t > 0.5 ? C.amber : C.orange);
        }
    }
    b.commit(scene, 'envTorch', fw, fh, true);
    defineAnim(scene, 'envTorch-burn', 'envTorch', [0, 1, 2, 3], 9);
  }

  // ---- lava surface (32x16 seamless) + additive shimmer layer
  {
    const b = new Buf(32, 16);
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 32; x++) {
        const surf = 4 + Math.round(Math.sin((x / 32) * Math.PI * 4) * 1.2);
        if (y < surf) continue;
        const d = y - surf;
        let c = d === 0 ? C.gold : d === 1 ? C.amber : d < 4 ? C.orange : mix(C.orange, C.crimson, Math.min(1, (d - 3) / 6));
        const blob = Math.sin((x / 32) * Math.PI * 2 * 2 + y * 0.7) + Math.sin((x / 32) * Math.PI * 2 * 3 - y * 0.4);
        if (d > 2 && blob > 1.3) c = C.amber;
        if (d > 4 && blob < -1.4) c = mix(C.crimson, C.wine, 0.5);
        b.set(x, y, c);
      }
    b.commit(scene, 'envLava');
    const s = new Buf(32, 16);
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 32; x++) {
        const v = Math.sin((x / 32) * Math.PI * 2 * 3 + y * 0.9) * Math.sin((x / 32) * Math.PI * 2 + y * 0.3);
        if (y >= 5 && v > 0.55) s.set(x, y, C.gold, 0.55);
        if (y === 4 && h2(x, 0, 2) > 0.7) s.set(x, y, C.cream, 0.6);
      }
    s.commit(scene, 'envLavaShimmer');
  }
  // vertical glow gradient (used above lava and for light shafts)
  drawCanvas(scene, 'envGlow', 16, 32, (ctx) => {
    const g = ctx.createLinearGradient(0, 0, 0, 32);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(1, 'rgba(255,255,255,1)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 16, 32);
  });
  // soft smoke puff for the volcano plume
  drawCanvas(scene, 'envSmoke', 32, 32, (ctx) => {
    const g = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
    g.addColorStop(0, 'rgba(255,255,255,0.9)');
    g.addColorStop(0.6, 'rgba(255,255,255,0.35)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 32, 32);
  });

  // ---- per world: moving platform (48x8), crumble block (16x16 x4 crack stages), sign (16x16)
  for (const w of PAINTED) {
    const p = new Buf(48, 8);
    if (w === 1) {
      for (let x = 0; x < 48; x++) {
        p.set(x, 0, C.sand);
        for (let y = 1; y < 6; y++) p.set(x, y, h2(x, y, 5) > 0.85 ? C.bark : C.clay);
        p.set(x, 6, C.bark);
        p.set(x, 7, C.umber);
        if (x % 12 === 11) for (let y = 0; y < 7; y++) p.set(x, y, C.bark);
      }
      for (const x of [3, 44]) {
        p.set(x, 2, C.ash);
        p.set(x, 4, C.ash);
      }
      // iron band
      for (const x0 of [8, 37]) for (let y = 0; y < 8; y++) p.rect(x0, y, 3, 1, y === 0 ? C.ash : mix(C.night, C.navy, 0.45));
    } else if (w === 2) {
      const iron = mix(C.night, C.navy, 0.45);
      for (let x = 0; x < 48; x++) {
        p.set(x, 0, C.mist);
        p.set(x, 1, C.ash);
        for (let y = 2; y < 6; y++) p.set(x, y, x % 4 === 1 ? 0x120d1c : C.stone);
        p.set(x, 6, iron);
        p.set(x, 7, 0x120d1c);
      }
      // gear hubs
      for (const cx of [8, 40]) {
        for (let y = 1; y < 8; y++)
          for (let x = cx - 4; x <= cx + 4; x++) {
            const d = Math.hypot(x + 0.5 - cx - 0.5, y + 0.5 - 4.5);
            const ang = Math.atan2(y - 4, x - cx);
            if (d < 3.6 + (Math.cos(ang * 6) > 0.3 ? 0.9 : 0)) p.set(x, y, d < 1.2 ? C.gold : d < 2.4 ? C.amber : mix(C.bark, C.amber, 0.4));
          }
      }
      for (const x of [2, 24, 45]) p.set(x, 3, C.mist);
    } else {
      for (let x = 0; x < 48; x++) {
        p.set(x, 0, h2(x, 0, 9) > 0.75 ? C.orange : C.crimson);
        p.set(x, 1, C.wine);
        for (let y = 2; y < 7; y++) p.set(x, y, OBS[(h2(x >> 2, y >> 1, 7) * 4) | 0]);
        p.set(x, 7, 0x0a0408);
      }
      // ember rune strip + chain anchors
      for (let x = 14; x < 34; x += 3) p.set(x, 4, x % 2 ? C.orange : C.amber);
      for (const x of [3, 44]) {
        p.rect(x - 1, 2, 3, 3, C.stone);
        p.set(x, 3, 0x0a0408);
      }
    }
    // rounded ends
    for (const [x, y] of [[0, 0], [47, 0], [0, 7], [47, 7]] as const) p.clear(x, y);
    p.commit(scene, `platform${w}`);

    // crumble block: 4 stages of cracking
    const cb = new Buf(64, 16);
    const cracks: [number, number][][] = [
      [],
      [[7, 0], [8, 1], [8, 2], [7, 3], [7, 4], [8, 5]],
      [[8, 6], [9, 7], [9, 8], [10, 9], [3, 5], [4, 6], [5, 6], [6, 7], [12, 2], [13, 3], [14, 3]],
      [[10, 10], [10, 11], [11, 12], [11, 13], [11, 14], [11, 15], [2, 8], [2, 9], [1, 10], [6, 8], [6, 9], [5, 10], [5, 11], [13, 6], [14, 7], [15, 8]],
    ];
    for (let f = 0; f < 4; f++) {
      const ox = f * 16;
      for (let y = 0; y < 16; y++)
        for (let x = 0; x < 16; x++) {
          if ((x === 0 || x === 15) && (y === 0 || y === 15)) continue;
          let c: number;
          if (w === 1) c = h2(x, y, 3) > 0.8 ? C.bark : C.clay;
          else if (w === 2) c = mix(brick(x, y, 0), C.clay, 0.35);
          else c = mix(obsidian(x, y, 0), C.wine, 0.4);
          if (y === 0) c = w === 1 ? C.sand : w === 2 ? C.sand : C.orange;
          if (x === 0 || y === 1) c = lt(c, 0.12);
          if (x === 15 || y === 15) c = dk(c, 0.45);
          if (x === 14 || y === 14) c = dk(c, 0.2);
          cb.set(ox + x, y, c);
        }
      const crackC = w === 3 ? C.orange : 0x120a12;
      if (f === 0) for (const [x, y] of cracks[1]) cb.set(ox + x, y, w === 3 ? C.crimson : dk(cb.get(ox + x, y), 0.35));
      for (let s = 1; s <= f; s++)
        for (const [x, y] of cracks[s]) {
          cb.set(ox + x, y, crackC);
          if (w === 3 && f >= 2) cb.set(ox + x + 1, y, C.crimson);
        }
      if (f === 3) {
        // chipped corners
        for (const [x, y] of [[1, 0], [0, 1], [14, 15], [15, 14], [15, 13]] as const) cb.clear(ox + x, y);
      }
      // little X marks so the block reads as "fragile" from the start
      if (w !== 3) {
        cb.set(ox + 3, 3, dk(cb.get(ox + 3, 3), 0.3));
        cb.set(ox + 12, 11, dk(cb.get(ox + 12, 11), 0.3));
      }
    }
    cb.commit(scene, `crumble${w}`, 16, 16, true);

    // sign post
    const sg = new Buf(16, 16);
    if (w === 1) {
      sg.stamp(0, 0, [
        '................',
        '................',
        '.uuuuuuuuuuuuuu.',
        'ukkkkkkkkkkkkkcu',
        'ukcuuucuuuuukccu',
        'ukcccccccccccccu',
        'ukcuuuucuuuccccu',
        'ukccccccccccccbu',
        'ucbbbbbbbbbbbbbu',
        '.uuuuuubbuuuuuu.',
        '.......bu.......',
        '.......bu.......',
        '.......bu.......',
        '.......bu.......',
        '......mbum......',
        '.....mmbumg.....',
      ], { u: C.umber, k: C.sand, c: C.clay, b: C.bark, m: C.moss, g: C.leaf });
    } else if (w === 2) {
      const iron = mix(C.night, C.navy, 0.45);
      sg.stamp(0, 0, [
        '................',
        '.......ii.......',
        '.iiiiiiaaiiiiii.',
        'iammmmmmmmmmmmai',
        'iasddddsdddddsai',
        'iassssssssssssai',
        'iasdddsddddsssai',
        'iassssssssssssai',
        'iaaaaaaaaaaaaaai',
        '.iiiiiiaaiiiiii.',
        '.......ai.......',
        '.......ai.......',
        '.......ai.......',
        '.......ai.......',
        '......iaai......',
        '.....iaaaai.....',
      ], { i: iron, a: C.ash, m: C.mist, s: C.stone, d: C.night });
    } else {
      sg.stamp(0, 0, [
        '.......mm.......',
        '......mwwm......',
        '.....mwkwkm.....',
        '..bbbbmwwmbbbb..',
        '.bBBBBBBBBBBBBb.',
        '.bBoooBoBooooBb.',
        '.bBBBBBBBBBBBBb.',
        '.bBooBooooBooBb.',
        '.bBBBBBBBBBBBBb.',
        '..bbbbbbbbbbbb..',
        '.......Bb.......',
        '.......Bb.......',
        '.......Bb.......',
        '.......Bb.......',
        '......bBBb......',
        '.....bBBBBb.....',
      ], { b: 0x0a0408, B: 0x331824, o: C.orange, m: C.mist, w: C.white, k: C.ink });
    }
    sg.commit(scene, `sign${w}`, 16, 16, true);
  }
}

// ============================================================================ breakables (crate / urn) + debris

/** Base colours of each world's breakable, used for debris tint / dust by the entity. */
export const BREAKABLE_DUST: Record<W, number> = { 1: 0x9a6648, 2: 0xb08a6a, 3: 0x5a2a3a, 4: coldRemap(0x5a2a3a) };

/**
 * `breakable{w}`: 16x16, frame 0 intact, frame 1 cracked (took a hit). Bottom-aligned.
 * `breakDebris{w}`: 6x6 chunks, 4 frames.
 * W1 wooden crate, W2 clay urn with an iron band, W3 obsidian urn with a glowing rune.
 */
function buildBreakables(scene: Phaser.Scene): void {
  for (const w of PAINTED) {
    const b = new Buf(32, 16);
    for (let f = 0; f < 2; f++) {
      const ox = f * 16;
      const cracked = f === 1;
      if (w === 1) {
        // crate: x 1..14, y 3..15
        for (let y = 3; y < 16; y++)
          for (let x = 1; x < 15; x++) {
            const rim = x === 1 || x === 14 || y === 3 || y === 15;
            const post = x === 2 || x === 13 || y === 4 || y === 14;
            const seam = !post && (y - 5) % 3 === 2;
            let c = rim ? C.umber : post ? C.bark : seam ? mix(C.bark, C.umber, 0.5) : (y - 5) % 3 === 0 ? C.sand : C.clay;
            if (!rim && !post && h2(x, y, 7) > 0.86) c = dk(c, 0.12); // grain
            // diagonal brace
            const onBrace = !rim && !post && Math.abs((x - 3) - (13 - y)) <= 0;
            const onBraceHi = !rim && !post && (x - 3) - (13 - y) === -1;
            if (onBrace) c = C.bark;
            else if (onBraceHi) c = mix(C.bark, C.sand, 0.4);
            if (x === 14 || y === 15) c = dk(c, 0.3);
            b.set(ox + x, y, c);
          }
        for (const [x, y] of [[2, 4], [13, 4], [2, 14], [13, 14]] as const) b.set(ox + x, y, C.ash); // nails
        if (cracked) {
          for (const [x, y] of [[8, 5], [8, 6], [9, 7], [9, 8], [8, 9], [10, 9], [11, 10], [5, 11], [6, 12], [6, 13]] as const) b.set(ox + x, y, C.ink);
          b.clear(ox + 1, 3);
          b.clear(ox + 2, 3);
          b.clear(ox + 1, 4);
        }
      } else {
        // urn: profile half-width per row (rows 1..15)
        const hw = [0, 4, 4, 3, 3, 4, 5, 6, 6, 6, 6, 6, 5, 5, 4, 4];
        const base = w === 2 ? C.clay : 0x331824;
        const hiC = w === 2 ? C.sand : 0x5a2a3a;
        const loC = w === 2 ? C.umber : 0x140810;
        for (let y = 1; y < 16; y++) {
          const h = hw[y];
          for (let x = 8 - h; x < 8 + h; x++) {
            const edge = x === 8 - h || x === 8 + h - 1 || y === 1 || y === 15 || (y === 3 && (x === 8 - h || x === 8 + h - 1));
            const t = (x - (8 - h)) / Math.max(1, 2 * h - 1); // 0 left .. 1 right
            let c = t < 0.3 ? hiC : t > 0.72 ? loC : base;
            if (y === 1 || y === 2) c = y === 1 ? hiC : base; // rim
            if (y === 3) c = loC; // neck shadow
            if (edge) c = C.ink;
            if (!edge && y === 8) c = w === 2 ? mix(C.night, C.navy, 0.45) : C.orange; // band / rune line
            if (!edge && y === 9 && w === 2) c = C.ash;
            if (!edge && w === 3 && ((y === 10 && x === 7) || (y === 11 && (x === 6 || x === 8)) || (y === 7 && x === 9))) c = C.amber;
            b.set(ox + x, y, c);
          }
        }
        if (cracked) {
          const crack = w === 3 ? C.gold : C.ink;
          for (const [x, y] of [[9, 2], [9, 3], [8, 4], [8, 5], [9, 6], [10, 7], [10, 10], [11, 11], [5, 12], [6, 13]] as const) b.set(ox + x, y, crack);
          b.clear(ox + 4, 1);
          b.clear(ox + 5, 1);
        }
      }
    }
    b.commit(scene, `breakable${w}`, 16, 16, true);

    // debris chunks (4 frames, 6x6)
    const d = new Buf(24, 6);
    const dc = w === 1 ? [C.clay, C.sand, C.umber] : w === 2 ? [C.clay, C.sand, C.umber] : [0x331824, 0x5a2a3a, C.orange];
    for (let f = 0; f < 4; f++) {
      const r = mulberry(seedFrom(`deb${w}${f}`));
      const cw = 3 + ((r() * 3) | 0);
      const ch = 2 + ((r() * 3) | 0);
      for (let y = 0; y < ch; y++)
        for (let x = 0; x < cw; x++) {
          if ((x === 0 || x === cw - 1) && (y === 0 || y === ch - 1) && r() < 0.6) continue;
          const c = y === 0 ? dc[1] : x === cw - 1 || y === ch - 1 ? dc[2] : dc[0];
          d.set(f * 6 + x + 1, y + 1, c);
        }
      if (w === 1 && f % 2 === 0) d.set(f * 6 + 2, 2, C.ash); // stray nail
    }
    d.commit(scene, `breakDebris${w}`, 6, 6, true);
  }
}

// ============================================================================ parallax backdrops

interface LayerSpec {
  key: string;
  /** horizontal scroll factor */
  sf: number;
  /** vertical scroll factor */
  sfy: number;
  /** screen-space top when the camera is at the bottom of the area */
  y: number;
  /** horizontal auto drift, px/s */
  drift?: number;
  alpha?: number;
  blend?: number;
}

const SKY_H = GAME_H;

function skyGradient(b: Buf, stops: [number, number][]): void {
  for (let y = 0; y < b.h; y++) {
    const t = y / (b.h - 1);
    let c = stops[0][1];
    for (let i = 0; i < stops.length - 1; i++) {
      const [t0, c0] = stops[i];
      const [t1, c1] = stops[i + 1];
      if (t >= t0 && t <= t1) c = mix(c0, c1, (t - t0) / (t1 - t0));
    }
    for (let x = 0; x < b.w; x++) {
      // ordered dither between bands to avoid flat banding
      const dither = ((x + y * 2) % 4) / 4 - 0.375;
      b.set(x, y, mix(c, dither > 0 ? 0xffffff : 0x000000, Math.abs(dither) * 0.03));
    }
  }
}
function stars(b: Buf, n: number, maxY: number, seed: number, col = 0xffffff): void {
  const r = mulberry(seed);
  for (let i = 0; i < n; i++) {
    const x = (r() * b.w) | 0;
    const y = (r() * maxY) | 0;
    const a = 0.25 + r() * 0.6 * (1 - y / maxY);
    b.set(x, y, col, a);
    if (r() > 0.93) {
      b.set(x + 1, y, col, a * 0.5);
      b.set(x - 1, y, col, a * 0.5);
      b.set(x, y + 1, col, a * 0.5);
      b.set(x, y - 1, col, a * 0.5);
    }
  }
}
function disc(b: Buf, cx: number, cy: number, r: number, c: number, a = 1): void {
  for (let y = Math.floor(cy - r); y <= cy + r; y++)
    for (let x = Math.floor(cx - r); x <= cx + r; x++) if ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= r * r) b.set(x, y, c, a);
}
function halo(b: Buf, cx: number, cy: number, r: number, c: number, a: number): void {
  for (let y = Math.floor(cy - r); y <= cy + r; y++)
    for (let x = Math.floor(cx - r); x <= cx + r; x++) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy) / r;
      if (d < 1) b.set(x, y, c, a * (1 - d) * (1 - d));
    }
}
/** Fill a silhouette below a height profile (periodic), with rim light and vertical haze to `haze`. */
function silhouette(b: Buf, prof: (x: number) => number, col: number, rim: number, haze: number, hazeAmt: number, rimW = 1): void {
  for (let x = 0; x < b.w; x++) {
    const top = Math.round(prof(x));
    const slope = prof(x + 1) - prof(x - 1);
    for (let y = Math.max(0, top); y < b.h; y++) {
      const t = (y - top) / Math.max(1, b.h - top);
      let c = mix(col, haze, t * hazeAmt);
      if (y - top < rimW && slope > -0.4) c = mix(c, rim, 0.6);
      b.set(x, y, c);
    }
  }
}

function buildParallaxTextures(scene: Phaser.Scene): void {
  const BW = 512;
  // ---------------------------------------------------------------- W1 Verdant Hollow (moonlit forest)
  {
    const sky = new Buf(GAME_W, SKY_H);
    skyGradient(sky, [[0, 0x0b1830], [0.45, 0x16324f], [0.8, 0x2c5a72], [1, 0x4b8090]]);
    stars(sky, 140, SKY_H * 0.55, 11, 0xdff6ff);
    halo(sky, 360, 62, 70, 0xbfe8e0, 0.18);
    disc(sky, 360, 62, 15, 0xe8f4e0);
    disc(sky, 355, 58, 4, 0xcfe0cc);
    disc(sky, 366, 68, 3, 0xd6e6d2);
    sky.commit(scene, 'bg1-sky');
    const far = new Buf(BW, 160);
    silhouette(far, (x) => 60 + ridge(x, BW, [[1, 18, 0.4], [3, 12, 1.2], [7, 5, 2.1], [13, 2, 0.3]]), 0x2a4f68, 0x6a9cb0, 0x4b8090, 0.85, 2);
    far.commit(scene, 'bg1-far');
    const mid = new Buf(BW, 160);
    silhouette(mid, (x) => 70 + ridge(x, BW, [[2, 14, 2.4], [5, 7, 0.2], [11, 3, 1.7]]), 0x1c3c48, 0x3f7a6a, 0x2c5a72, 0.6);
    // small distant trees on the hill tops
    for (let i = 0; i < 70; i++) {
      const tx = (i * 7.3 + h2(i, 0, 4) * 5) % BW;
      const base = 70 + ridge(tx, BW, [[2, 14, 2.4], [5, 7, 0.2], [11, 3, 1.7]]);
      const th = 6 + h2(i, 1, 4) * 8;
      for (let y = 0; y < th; y++) {
        const hw = (y / th) * 2.4;
        for (let x = -3; x <= 3; x++) if (Math.abs(x) <= hw) mid.set(tx + x, base - th + y + 1, 0x18343e, 1, true);
      }
    }
    mid.commit(scene, 'bg1-mid');
    const trees = new Buf(BW, 192);
    const treeTop = (x: number) => 64 + ridge(x, BW, [[3, 6, 0.7], [8, 3, 2.2]]);
    // ground band
    silhouette(trees, (x) => treeTop(x) + 30, 0x0f2428, 0x1f4a3a, 0x1a3a40, 0.3);
    for (let i = 0; i < 46; i++) {
      const tx = (i * (BW / 46) + h2(i, 0, 9) * 8) % BW;
      const base = treeTop(tx) + 34;
      const th = 34 + h2(i, 1, 9) * 34;
      const wd = 7 + h2(i, 2, 9) * 6;
      const pine = h2(i, 3, 9) > 0.35;
      for (let y = 0; y < th; y++) {
        const t = y / th;
        const ct = (t - 0.42) / 0.42;
        const hw = pine
          ? wd * t * (0.75 + 0.25 * Math.abs(Math.sin(y * 0.55)))
          : t > 0.84
            ? 0
            : wd * 1.1 * Math.sqrt(Math.max(0, 1 - ct * ct)) * (0.88 + 0.12 * Math.sin(y * 1.3 + i));
        for (let x = -Math.ceil(hw); x <= Math.ceil(hw); x++) {
          if (Math.abs(x) > hw) continue;
          const lit = x < -hw + 1.5 && y > 2;
          trees.set(tx + x, base - th + y, lit ? 0x24504a : y % 7 === 0 && pine ? 0x0b1c20 : 0x10282c, 1, true);
        }
      }
      trees.rect(Math.round(tx) - 1, Math.round(base) - 2, 2, 6, 0x0b1c20);
    }
    trees.commit(scene, 'bg1-trees');
    const mist = new Buf(BW, 64);
    for (let y = 0; y < 64; y++)
      for (let x = 0; x < BW; x++) {
        const t = y / 63;
        const n = 0.5 + 0.5 * ridge(x, BW, [[3, 0.5, 0.2], [7, 0.3, 1.1], [17, 0.2, 2.2]]);
        const a = Math.sin(t * Math.PI) * (0.25 + 0.35 * n);
        mist.set(x, y, 0x9fd6c8, a * 0.55);
      }
    mist.commit(scene, 'bg1-mist');
  }
  // ---------------------------------------------------------------- W2 Iron Spire (dusk castle)
  {
    const sky = new Buf(GAME_W, SKY_H);
    skyGradient(sky, [[0, 0x150f28], [0.4, 0x2e2148], [0.7, 0x5a3a66], [0.88, 0x9a5a6a], [1, 0xd08a6a]]);
    stars(sky, 90, SKY_H * 0.4, 21, 0xf0e0ff);
    halo(sky, 110, 210, 90, 0xffb070, 0.3);
    disc(sky, 110, 210, 20, 0xffc890);
    // cloud streaks
    for (let i = 0; i < 9; i++) {
      const cy = 120 + i * 11 + h2(i, 0, 3) * 6;
      const cx = h2(i, 1, 3) * GAME_W;
      const len = 60 + h2(i, 2, 3) * 120;
      for (let x = -len / 2; x < len / 2; x++) {
        const a = (1 - Math.abs(x) / (len / 2)) * 0.35;
        sky.set(cx + x, cy, 0xe0a0a0, a, true);
        sky.set(cx + x + 4, cy + 1, 0x6a3a5a, a * 0.8, true);
      }
    }
    sky.commit(scene, 'bg2-sky');
    // distant spires
    const towers = (b: Buf, n: number, seed: number, minH: number, maxH: number, col: number, rim: number, win: number, winA: number) => {
      for (let i = 0; i < n; i++) {
        const tx = Math.round((i * (b.w / n) + h2(i, 0, seed) * 14) % b.w);
        const th = minH + h2(i, 1, seed) * (maxH - minH);
        const tw = 6 + Math.round(h2(i, 2, seed) * 8);
        const top = b.h - th;
        const roof = 8 + h2(i, 3, seed) * 14;
        for (let y = Math.round(top - roof); y < b.h; y++) {
          let hw = tw / 2;
          if (y < top) hw = (tw / 2 + 1) * ((y - (top - roof)) / roof);
          for (let x = -Math.ceil(hw); x <= Math.ceil(hw); x++) {
            if (Math.abs(x) > hw) continue;
            b.set(tx + x, y, x <= -hw + 1 ? rim : col, 1, true);
          }
        }
        // battlement ring under the roof
        for (let x = -tw / 2 - 1; x <= tw / 2 + 1; x++) b.set(tx + x, top, col, 1, true);
        // lit windows
        for (let y = Math.round(top + 6); y < b.h - 8; y += 9)
          if (h2(i, y, seed) > 0.45) {
            b.set(tx, y, win, winA, true);
            b.set(tx, y + 1, win, winA, true);
          }
        // flag
        if (h2(i, 5, seed) > 0.6) {
          const fy = Math.round(top - roof);
          for (let y = fy - 5; y < fy; y++) b.set(tx, y, col, 1, true);
          for (let x = 1; x < 5; x++) b.set(tx + x, fy - 5 + (x > 2 ? 1 : 0), 0x7a2a4a, 1, true);
        }
      }
    };
    const far = new Buf(BW, 192);
    silhouette(far, (x) => 160 + ridge(x, BW, [[2, 6, 1], [5, 3, 0.3]]), 0x4a3560, 0x6a4a7a, 0x8a5a70, 0.5);
    towers(far, 14, 3, 70, 150, 0x4e3866, 0x6a4e82, 0xffc070, 0.6);
    far.commit(scene, 'bg2-far');
    const mid = new Buf(BW, 192);
    silhouette(mid, (x) => 150 + ridge(x, BW, [[3, 5, 2], [7, 2, 1]]), 0x2e2140, 0x45325a, 0x5a3a66, 0.4);
    towers(mid, 9, 7, 80, 165, 0x2e2140, 0x45345e, 0xffb050, 0.9);
    mid.commit(scene, 'bg2-mid');
    // castle wall with crenellations and lit arched windows
    const wall = new Buf(BW, 128);
    for (let y = 0; y < 128; y++)
      for (let x = 0; x < BW; x++) {
        const cren = y < 8 && (x % 16) >= 9;
        if (cren) continue;
        let c = 0x1e1630;
        const row = y >> 3;
        const off = row % 2 ? 8 : 0;
        if (y % 8 === 7 || (x + off) % 16 === 15) c = 0x171126;
        else if (y % 8 === 0) c = 0x241b38;
        if (y < 10 && y >= 8) c = 0x2a2040;
        wall.set(x, y, c);
      }
    for (let x = 0; x < BW; x++) if (x % 16 < 9) wall.set(x, 0, 0x34284c);
    for (let i = 0; i < 8; i++) {
      const wx = i * 64 + 26 + (i % 2) * 6;
      const lit = h2(i, 0, 71) > 0.3;
      for (let y = 20; y < 36; y++)
        for (let x = -3; x <= 3; x++) {
          const inArch = y >= 24 ? true : x * x + (y - 24) ** 2 < 12;
          if (!inArch) continue;
          const edge = Math.abs(x) === 3 || (y < 24 && x * x + (y - 24) ** 2 > 6);
          const glass = lit ? mix(mix(C.amber, C.orange, (y - 20) / 16), 0x1e1630, 0.35) : 0x2a2040;
          wall.set(wx + x, y, edge ? 0x120d1c : x === 0 ? 0x3a2418 : glass, 1, true);
        }
      for (let x = -4; x <= 4; x++) wall.set(wx + x, 36, 0x34284c, 1, true);
    }
    wall.commit(scene, 'bg2-wall');
    const fog = new Buf(BW, 64);
    for (let y = 0; y < 64; y++)
      for (let x = 0; x < BW; x++) {
        const n = 0.5 + 0.5 * ridge(x, BW, [[2, 0.6, 0.5], [9, 0.4, 2.0]]);
        fog.set(x, y, 0xb7a6d6, Math.sin((y / 63) * Math.PI) * (0.12 + 0.18 * n));
      }
    fog.commit(scene, 'bg2-fog');
  }
  // ---------------------------------------------------------------- W3 Crimson Throne (volcanic)
  {
    const sky = new Buf(GAME_W, SKY_H);
    skyGradient(sky, [[0, 0x12040a], [0.4, 0x2e0a16], [0.75, 0x5e1620], [1, 0x9a3024]]);
    // ash cloud bands
    for (let y = 30; y < 170; y++)
      for (let x = 0; x < GAME_W; x++) {
        const n = ridge(x + y * 3, GAME_W, [[2, 0.5, y * 0.05], [5, 0.3, y * 0.11], [11, 0.2, 0.3]]);
        const band = Math.sin(y * 0.09) * 0.5 + 0.5;
        if (n * band > 0.25) sky.set(x, y, 0x1a0610, 0.35 * band);
        else if (n * band > 0.18) sky.set(x, y, 0xa03a2a, 0.12);
      }
    halo(sky, 120, 70, 50, 0xff6040, 0.25);
    disc(sky, 120, 70, 14, 0x2a0810);
    for (let a = 0; a < 64; a++) {
      const ang = (a / 64) * Math.PI * 2;
      sky.set(120 + Math.cos(ang) * 14.5, 70 + Math.sin(ang) * 14.5, 0xff9060, 0.8);
    }
    stars(sky, 40, 90, 31, 0xffb0a0);
    sky.commit(scene, 'bg3-sky');
    // volcano (standalone, 320x200)
    const vol = new Buf(320, 200);
    const VC = 160;
    const volProf = (x: number) => {
      const ax = Math.abs(x - VC);
      return ax < 13 ? 22 + 4 * (1 - (ax / 13) ** 2) : 22 + 160 * Math.pow((ax - 13) / 147, 0.72) + Math.sin(x * 0.27) * 2 + Math.sin(x * 0.07) * 3;
    };
    for (let y = 0; y < 200; y++)
      for (let x = 0; x < 320; x++) {
        const dx = x - VC;
        const prof = volProf(x);
        if (y < prof) continue;
        const t = (y - 22) / 178;
        let c = mix(0x2e0c16, 0x1e0810, Math.min(1, t * 1.4));
        if (dx < 0 && y - prof < 2) c = 0x6a2028;
        else if (dx > 0 && y - prof < 2) c = 0x3a1018;
        // lava streams snaking down from the crater
        for (const [k, ph] of [[-1, 0.3], [1, 1.7], [-1, 2.9]] as const) {
          const sx = VC + k * (6 + (y - 22) * (0.32 + ph * 0.05)) + Math.sin(y * 0.09 + ph) * 5;
          const wv = Math.max(0.6, 1.8 - t * 1.2);
          if (y > 24 && y < 40 + ph * 50 && Math.abs(x - sx) < wv) c = mix(0x9a3a1e, 0x5a1420, Math.min(1, ((y - 24) / (16 + ph * 50)) * 1.2)); // dim: background lava must not read as a hazard
        }
        if (Math.abs(dx) < 13 && y - prof < 2.5) c = mix(0xc0602a, 0x8a2a1e, Math.abs(dx) / 13);
        else if (Math.abs(dx) < 13 && y - prof < 5) c = mix(C.orange, 0x2e0c16, (y - prof - 2.5) / 2.5);
        vol.set(x, y, c);
      }
    halo(vol, VC, 24, 40, 0xff7040, 0.18);
    vol.commit(scene, 'bg3-volcano');
    const far = new Buf(BW, 160);
    silhouette(far, (x) => 80 + ridge(x, BW, [[2, 16, 0.5], [5, 10, 1.4], [13, 4, 0.1], [29, 2, 1]]) - Math.abs(ridge(x, BW, [[9, 8, 0.2]])), 0x2a0a12, 0x6a2026, 0x5a1a20, 0.45);
    for (let x = 0; x < BW; x++) for (let y = 150; y < 160; y++) far.set(x, y, C.orange, ((y - 150) / 10) * 0.35);
    far.commit(scene, 'bg3-far');
    // ruined arches / colonnade
    const arch = new Buf(BW, 160);
    const archCol = 0x1e0a12;
    const rimC = 0x5a1a22;
    for (let i = 0; i < 4; i++) {
      const ax = i * 128;
      const broken = h2(i, 0, 5);
      const pillarTop = 40 + Math.round(h2(i, 1, 5) * 20);
      for (const px of [ax + 12, ax + 76]) {
        const ptop = px === ax + 76 && broken > 0.5 ? pillarTop + 30 : pillarTop;
        for (let y = ptop; y < 160; y++)
          for (let x = 0; x < 14; x++) {
            let c = x < 2 ? rimC : archCol;
            if (y % 18 === 0) c = 0x14060c;
            if (y === ptop && x > 0 && x < 13) c = rimC;
            arch.set(px + x, y, c, 1, true);
          }
        // capital
        arch.rect(px - 2, ptop, 18, 3, archCol);
        for (let x = 0; x < 18; x++) arch.set(px - 2 + x, ptop, rimC, 1, true);
      }
      // arch span between the two pillars (broken on some)
      const cx = ax + 51;
      for (let x = -39; x <= 39; x++)
        for (let y = 0; y <= 39; y++) {
          const r = Math.hypot(x, y);
          if (r > 39 || r < 25) continue;
          if (broken > 0.5 && x > 6 + h2(y, 0, i) * 4) continue;
          arch.set(cx + x, pillarTop + 2 - y, r > 37 ? rimC : y % 9 === 0 ? 0x14060c : archCol, 1, true);
        }
    }
    // rubble ground
    silhouette(arch, (x) => 140 + ridge(x, BW, [[6, 3, 0.4], [17, 2, 1.1]]), 0x160810, 0x3a1018, 0x2a0a10, 0.2);
    arch.commit(scene, 'bg3-arch');
  }
  // ---------------------------------------------------------------- W4 Hollow Deep: W3 recoloured
  for (const k of ['sky', 'volcano', 'far', 'arch']) cloneRemap(scene, `bg3-${k}`, `bg4-${k}`, coldRemap);
}

/**
 * Builds the layered parallax backdrop for a world into `scene` (depth < 0, scroll factors < 1).
 * Used by GameScene and also by menu scenes (title screen / world map) as an animated backdrop.
 * `width`/`height` = area the backdrop must cover in world pixels (camera may scroll within it).
 * Returns the created objects so callers can tween/destroy them.
 */
export function buildParallax(scene: Phaser.Scene, world: W, width: number, height: number): Phaser.GameObjects.GameObject[] {
  if (!scene.textures.exists('bg1-sky')) buildParallaxTextures(scene);
  const cam = scene.cameras.main;
  const vw = cam.width;
  const vh = cam.height;
  const maxSY = Math.max(0, height - vh);
  /** limit total vertical travel of a layer so tall levels don't push it off-screen */
  const vy = (sfy: number) => (maxSY > 0 ? Math.min(sfy, 90 / maxSY) : 0);
  const objs: Phaser.GameObjects.GameObject[] = [];
  const tiled: { ts: Phaser.GameObjects.TileSprite; sf: number; drift: number }[] = [];

  const sky = scene.add.image(0, 0, `bg${world}-sky`).setOrigin(0, 0).setScrollFactor(0).setDepth(-40);
  sky.setDisplaySize(vw, vh);
  objs.push(sky);

  const add = (l: LayerSpec, depth: number) => {
    const tex = scene.textures.get(l.key).getSourceImage() as HTMLCanvasElement;
    const sfy = vy(l.sfy);
    const ts = scene.add
      .tileSprite(0, l.y + maxSY * sfy, vw, tex.height, l.key)
      .setOrigin(0, 0)
      .setScrollFactor(0, sfy)
      .setDepth(depth);
    if (l.alpha !== undefined) ts.setAlpha(l.alpha);
    if (l.blend !== undefined) ts.setBlendMode(l.blend);
    tiled.push({ ts, sf: l.sf, drift: l.drift ?? 0 });
    objs.push(ts);
    return ts;
  };
  /** solid fill below a layer so tall levels never reveal a gap under it */
  const under = (l: LayerSpec, color: number, depth: number) => {
    const sfy = vy(l.sfy);
    const tex = scene.textures.get(l.key).getSourceImage() as HTMLCanvasElement;
    const r = scene.add.rectangle(0, l.y + maxSY * sfy + tex.height - 1, vw, 400, color).setOrigin(0, 0).setScrollFactor(0, sfy).setDepth(depth);
    objs.push(r);
  };

  const pw = paintOf(world);
  const tint = (c: number) => tintW(world, c);
  if (pw === 1) {
    const far = { key: 'bg1-far', sf: 0.06, sfy: 0.05, y: vh - 215 };
    const mid = { key: 'bg1-mid', sf: 0.14, sfy: 0.1, y: vh - 190 };
    const trees = { key: 'bg1-trees', sf: 0.28, sfy: 0.18, y: vh - 150 };
    add(far, -36);
    under(far, 0x4b8090, -36.5);
    add({ key: 'bg1-mist', sf: 0.1, sfy: 0.07, y: vh - 130, drift: 4, alpha: 0.7 }, -35);
    add(mid, -34);
    under(mid, 0x2c5a72, -34.5);
    add({ key: 'bg1-mist', sf: 0.2, sfy: 0.12, y: vh - 100, drift: -6, alpha: 0.6 }, -33);
    add(trees, -32);
    under(trees, 0x1a3a40, -32.5);
    add({ key: 'bg1-mist', sf: 0.45, sfy: 0.25, y: vh - 60, drift: 9, alpha: 0.45 }, -31);
  } else if (pw === 2) {
    const far = { key: 'bg2-far', sf: 0.06, sfy: 0.05, y: vh - 190 };
    const mid = { key: 'bg2-mid', sf: 0.14, sfy: 0.1, y: vh - 175 };
    const wall = { key: 'bg2-wall', sf: 0.3, sfy: 0.2, y: vh - 100 };
    add(far, -36);
    under(far, 0x8a5a70, -36.5);
    add({ key: 'bg2-fog', sf: 0.1, sfy: 0.07, y: vh - 90, drift: 3 }, -35);
    add(mid, -34);
    under(mid, 0x5a3a66, -34.5);
    add({ key: 'bg2-fog', sf: 0.22, sfy: 0.14, y: vh - 70, drift: -5, alpha: 0.8 }, -33);
    add(wall, -32);
    under(wall, 0x1e1630, -32.5);
  } else {
    const volX = vw * 0.62 + Math.max(0, width - vw) * 0.04 * 0.5;
    const volSfy = vy(0.04);
    const volY = vh - 205 + maxSY * volSfy;
    const vol = scene.add.image(volX, volY, `bg${world}-volcano`).setOrigin(0.5, 0).setScrollFactor(0.04, volSfy).setDepth(-37);
    objs.push(vol);
    // smoke plume from the crater
    const smoke = scene.add.particles(volX, volY + 20, 'envSmoke', {
      lifespan: 7000,
      frequency: 260,
      speedY: { min: -16, max: -9 },
      speedX: { min: 2, max: 7 },
      scale: { start: 0.35, end: 1.6 },
      alpha: { start: 0.55, end: 0 },
      tint: [0x6a3a40, 0x5a3038, 0x7a4440].map(tint),
      x: { min: -6, max: 6 },
    });
    smoke.setScrollFactor(0.04, volSfy).setDepth(-36.8);
    smoke.fastForward(7000);
    objs.push(smoke);
    const glowL = scene.add.image(volX, volY + 22, 'light').setScrollFactor(0.04, volSfy).setDepth(-36.9).setTint(tint(0xff6a30)).setBlendMode(Phaser.BlendModes.ADD).setScale(1.4, 0.8).setAlpha(0.5);
    scene.tweens.add({ targets: glowL, alpha: 0.25, yoyo: true, repeat: -1, duration: 1400, ease: 'Sine.inOut' });
    objs.push(glowL);
    const far = { key: `bg${world}-far`, sf: 0.1, sfy: 0.07, y: vh - 150 };
    const arch = { key: `bg${world}-arch`, sf: 0.26, sfy: 0.16, y: vh - 175 };
    add(far, -35);
    under(far, tint(0x4a1018), -35.5);
    add(arch, -33);
    under(arch, tint(0x160810), -33.5);
    // rising embers in the backdrop
    const emb = scene.add.particles(0, 0, 'envDot', {
      x: { min: 0, max: vw },
      y: vh + 4,
      lifespan: 6000,
      frequency: 140,
      speedY: { min: -30, max: -12 },
      speedX: { min: -6, max: 10 },
      scale: { min: 0.4, max: 0.9 },
      alpha: { start: 0.9, end: 0 },
      tint: [C.orange, C.amber, C.red].map(tint),
      blendMode: Phaser.BlendModes.ADD,
    });
    emb.setScrollFactor(0).setDepth(-32);
    emb.fastForward(6000);
    objs.push(emb);
  }

  const update = () => {
    if (!sky.active) {
      scene.events.off(Phaser.Scenes.Events.UPDATE, update);
      return;
    }
    const t = scene.time.now / 1000;
    for (const l of tiled) l.ts.tilePositionX = cam.scrollX * l.sf + t * l.drift;
  };
  update();
  scene.events.on(Phaser.Scenes.Events.UPDATE, update);
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => scene.events.off(Phaser.Scenes.Events.UPDATE, update));
  return objs;
}

// ============================================================================ level art (tilemap visuals, decorations, hazards, lights)

export interface LevelArt {
  /** visual tilemap layer (non-colliding) */
  visual: Phaser.Tilemaps.TilemapLayer;
  deco: Phaser.Tilemaps.TilemapLayer;
  /** per-frame visual update (lava flow, torch flicker, sparkles, foliage sway) */
  update(time: number): void;
  /** a body (center x,y, half extents) moving through foliage this frame; it leans with vx */
  touch(x: number, y: number, halfW: number, halfH: number, vx: number): void;
  /** a swing / blast inside `r` flicks foliage away from `originX` */
  push(r: { x: number; y: number; w: number; h: number }, originX: number, force?: number): void;
  /** torches / lava lights within `radius` flare brighter for a moment */
  flare(x: number, y: number, radius: number, amount?: number): void;
}

export interface LevelArtOpts {
  world: W;
  levelId: string;
  tiles: number[][];
  /** world-space points (prop spawns) around which decorations are suppressed */
  keepClear: { x: number; y: number }[];
}

/**
 * Builds all static/animated level visuals from the semantic tile grid. Collision is NOT touched:
 * the caller keeps its own (invisible) collision layer with the semantic indices.
 */
export function buildLevelArt(scene: Phaser.Scene, o: LevelArtOpts): LevelArt {
  const { tiles, world } = o;
  /** painting branch (4 -> 3); `world` still picks the texture keys */
  const w = paintOf(world);
  const tint = (c: number) => tintW(world, c);
  const H = tiles.length;
  const Wd = tiles[0].length;
  const seed = seedFrom(o.levelId);
  const rnd = mulberry(seed);
  const inB = (x: number, y: number) => x >= 0 && y >= 0 && x < Wd && y < H;
  const tAt = (x: number, y: number) => (inB(x, y) ? tiles[y][x] : T.BODY);
  const solid = (x: number, y: number) => {
    const t = tAt(x, y);
    return t === T.TOP || t === T.BODY;
  };
  const empty = (x: number, y: number) => inB(x, y) && tiles[y][x] === T.EMPTY;

  // ---- visual tile layer
  const vis: number[][] = [];
  for (let y = 0; y < H; y++) {
    const row: number[] = [];
    for (let x = 0; x < Wd; x++) {
      const t = tiles[y][x];
      let v = -1;
      if (t === T.TOP || t === T.BODY) {
        const m = (solid(x, y - 1) ? N : 0) | (solid(x + 1, y) ? E : 0) | (solid(x, y + 1) ? S : 0) | (solid(x - 1, y) ? Wm : 0);
        const r = h2(x, y, seed);
        const [p0, p1] = VARIANT_P[world];
        v = (r < p0 ? 0 : r < p1 ? 1 : 2) * 16 + m;
      } else if (t === T.ONEWAY) {
        const l = tAt(x - 1, y) === T.ONEWAY || solid(x - 1, y);
        const r = tAt(x + 1, y) === T.ONEWAY || solid(x + 1, y);
        v = !l && !r ? VT.OW_SINGLE : !l ? VT.OW_L : !r ? VT.OW_R : h2(x, y, seed + 1) > 0.75 ? VT.OW_M2 : VT.OW_M;
      } else if (t === T.SPIKE) {
        v = h2(x, y, seed + 2) > 0.5 ? VT.SPIKE2 : VT.SPIKE;
      } else if (t === T.EMPTY) {
        if (y + 1 < H && solid(x, y + 1)) {
          const l = solid(x - 1, y + 1);
          const r = solid(x + 1, y + 1);
          v = !l ? VT.OVER_L : !r ? VT.OVER_R : VT.OVER + ((h2(x, y, seed + 3) * 3) | 0);
        } else if (y > 0 && solid(x, y - 1)) v = VT.UNDER + ((h2(x, y, seed + 4) * 3) | 0);
      }
      row.push(v);
    }
    vis.push(row);
  }
  const vmap = scene.make.tilemap({ data: vis, tileWidth: TILE, tileHeight: TILE });
  const vts = vmap.addTilesetImage('env', `envTiles${world}`, TILE, TILE, 0, 0)!;
  const visual = vmap.createLayer(0, vts, 0, 0)!;
  visual.setDepth(10);
  // levels shorter than the view show a strip below the grid: fill it with deep ground colour
  const below = tint(w === 1 ? 0x150d12 : w === 2 ? 0x0e0a16 : 0x0a0408);
  scene.add.rectangle(0, H * TILE, Wd * TILE, 96, below).setOrigin(0, 0).setDepth(10);

  // depth shading: distance (in tiles) from open air, darkens deep solid mass
  const dist: number[][] = tiles.map((r) => r.map(() => 99));
  const q: [number, number][] = [];
  for (let y = 0; y < H; y++)
    for (let x = 0; x < Wd; x++)
      if (!solid(x, y)) {
        dist[y][x] = 0;
        q.push([x, y]);
      }
  for (let qi = 0; qi < q.length; qi++) {
    const [x, y] = q[qi];
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx;
      const ny = y + dy;
      if (!inB(nx, ny) || dist[ny][nx] <= dist[y][x] + 1) continue;
      dist[ny][nx] = dist[y][x] + 1;
      q.push([nx, ny]);
    }
  }
  const shadeFor = (d: number) => {
    if (d <= 1) return 0xffffff;
    const f = d === 2 ? 0.82 : d === 3 ? 0.66 : d === 4 ? 0.54 : 0.46;
    const v = Math.round(255 * f);
    return (v << 16) | (v << 8) | v;
  };
  visual.forEachTile((t) => {
    if (t.index >= 0 && t.index < 48) t.tint = shadeFor(dist[t.y][t.x]);
  });

  // ---- decorations
  const clear = new Set<string>();
  for (const p of o.keepClear) {
    const cx = Math.floor(p.x / TILE);
    const cy = Math.floor(p.y / TILE);
    for (let dy = -2; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) clear.add(`${cx + dx},${cy + dy}`);
  }
  const free = (x: number, y: number) => empty(x, y) && !clear.has(`${x},${y}`);
  const deco: number[][] = tiles.map((r) => r.map(() => -1));
  const floor = (x: number, y: number) => free(x, y) && y + 1 < H && solid(x, y + 1);
  const ceil = (x: number, y: number) => free(x, y) && y > 0 && solid(x, y - 1);
  const torches: { x: number; y: number; flip: boolean }[] = [];
  const vents: { x: number; y: number }[] = [];
  let lastBanner = -99;
  let lastTorch = -99;
  let lastWindow = -99;

  for (let x = 0; x < Wd; x++)
    for (let y = 0; y < H; y++) {
      const r = rnd();
      if (w === 1) {
        if (floor(x, y)) {
          if (r < 0.26) deco[y][x] = r < 0.14 ? D.TUFT_A : D.TUFT_B;
          else if (r < 0.31) deco[y][x] = D.FERN;
          else if (r < 0.38) deco[y][x] = [D.FLOWER_P, D.FLOWER_G, D.FLOWER_C][(rnd() * 3) | 0];
          else if (r < 0.42) deco[y][x] = rnd() < 0.5 ? D.SHROOM_R : D.SHROOM_C;
          else if (r < 0.45) deco[y][x] = D.ROCK;
        } else if (ceil(x, y) && !floor(x, y)) {
          if (r < 0.16) {
            let len = 1 + ((rnd() * 3) | 0);
            let yy = y;
            deco[yy][x] = D.VINE_TOP;
            while (len-- > 0 && free(x, yy + 1) && !floor(x, yy + 1)) deco[++yy][x] = D.VINE_MID;
            deco[yy][x] = yy === y ? D.VINE_END : D.VINE_END;
            if (yy === y) deco[y][x] = D.VINE_END;
          } else if (r < 0.26) deco[y][x] = D.ROOTS;
        }
      } else if (w === 2) {
        if (ceil(x, y) && !floor(x, y)) {
          if (r < 0.1 && x - lastBanner > 5 && free(x, y + 1) && !floor(x, y + 1) && free(x, y + 2)) {
            deco[y][x] = D.BANNER_TOP;
            deco[y + 1][x] = D.BANNER_BOT;
            lastBanner = x;
          } else if (r < 0.17) {
            let len = 1 + ((rnd() * 3) | 0);
            let yy = y;
            deco[yy][x] = D.CHAIN_TOP;
            while (len-- > 0 && free(x, yy + 1) && !floor(x, yy + 1) && free(x, yy + 2)) deco[++yy][x] = D.CHAIN_MID;
            if (yy > y) deco[yy][x] = D.CHAIN_END;
          } else if (solid(x - 1, y) && r < 0.6) deco[y][x] = D.WEB_L;
          else if (solid(x + 1, y) && r < 0.6) deco[y][x] = D.WEB_R;
        } else if (floor(x, y)) {
          if (r < 0.05) deco[y][x] = D.RUBBLE;
          else if (r < 0.075) deco[y][x] = D.CANDLE;
        }
        // wall torches: 2 cells above a floor, against a wall
        if (free(x, y) && free(x, y + 1) && y + 2 < H && solid(x, y + 2) && x - lastTorch > 9 && (solid(x - 1, y) || solid(x + 1, y)) && rnd() < 0.7) {
          torches.push({ x, y, flip: !solid(x - 1, y) });
          lastTorch = x;
        }
        // lit windows set into tall wall masses (2x3 solid, close to open air horizontally)
        if (x - lastWindow > 10 && y + 2 < H && x + 1 < Wd) {
          let ok = true;
          for (let dy = 0; dy < 3 && ok; dy++)
            for (let dx = 0; dx < 2 && ok; dx++) {
              const d = dist[y + dy][x + dx];
              if (!solid(x + dx, y + dy) || d < 2 || d > 3) ok = false;
            }
          const airSide = !solid(x - 2, y + 1) || !solid(x + 3, y + 1) || !solid(x - 3, y + 1) || !solid(x + 4, y + 1);
          const airAbove = !solid(x, y - 2) || !solid(x + 1, y - 2) || !solid(x, y - 3);
          if (ok && airSide && !airAbove && rnd() < 0.8) {
            for (let i = 0; i < 6; i++) deco[y + Math.floor(i / 2)][x + (i % 2)] = D.WIN + i;
            lastWindow = x;
          }
        }
      } else {
        if (floor(x, y)) {
          if (r < 0.04) deco[y][x] = D.BONES;
          else if (r < 0.06) deco[y][x] = D.SKULL;
          else if (r < 0.1) deco[y][x] = rnd() < 0.6 ? D.CRYSTAL_S : D.CRYSTAL_L;
          else if (r < 0.135 && tAt(x - 1, y + 1) !== T.LAVA && tAt(x + 1, y + 1) !== T.LAVA) {
            deco[y][x] = D.VENT;
            vents.push({ x: x * TILE + 8, y: y * TILE + 12 });
          } else if (r < 0.15) deco[y][x] = D.CANDLE3;
        } else if (ceil(x, y)) {
          if (r < 0.07 && !floor(x, y)) {
            let len = 1 + ((rnd() * 3) | 0);
            let yy = y;
            deco[yy][x] = D.CHAIN3_TOP;
            while (len-- > 0 && free(x, yy + 1) && !floor(x, yy + 1) && free(x, yy + 2)) deco[++yy][x] = D.CHAIN3_MID;
            if (yy > y) deco[yy][x] = D.CHAIN3_END;
          } else if (r < 0.16) deco[y][x] = D.STALAC;
        }
      }
    }
  // ---- reactive foliage: swaying pieces leave the tile layer and become images pivoting at their base
  // (floor plants) or their ceiling anchor (vines / chains / banners, one shared angle per hanging run)
  interface Sway { imgs: Phaser.GameObjects.Image[]; x: number; y0: number; y1: number; hang: boolean; max: number; a: number; v: number; target: number; touched: boolean; active: boolean }
  const FLOOR_SWAY: Record<W, number[]> = { 1: [D.TUFT_A, D.TUFT_B, D.FERN, D.FLOWER_P, D.FLOWER_G, D.FLOWER_C], 2: [], 3: [], 4: [] };
  const HANG_SWAY: Record<W, number[]> = {
    1: [D.VINE_TOP, D.VINE_MID, D.VINE_END],
    2: [D.BANNER_TOP, D.BANNER_BOT, D.CHAIN_TOP, D.CHAIN_MID, D.CHAIN_END],
    3: [D.CHAIN3_TOP, D.CHAIN3_MID, D.CHAIN3_END],
    4: [D.CHAIN3_TOP, D.CHAIN3_MID, D.CHAIN3_END], // world 4 reuses the world-3 deco sheet (recoloured)
  };
  const sways: Sway[] = [];
  const byCol: Sway[][] = Array.from({ length: Wd }, () => []);
  const decoKey = `envDeco${w}`;
  for (let x = 0; x < Wd; x++)
    for (let y = 0; y < H; y++) {
      const idx = deco[y][x];
      if (idx < 0) continue;
      if (FLOOR_SWAY[w].includes(idx)) {
        const img = scene.add.image(x * TILE + 8, (y + 1) * TILE, decoKey, idx).setOrigin(0.5, 1).setDepth(11);
        const s: Sway = { imgs: [img], x: x * TILE + 8, y0: y * TILE + 4, y1: (y + 1) * TILE, hang: false, max: 26, a: 0, v: 0, target: 0, touched: false, active: false };
        sways.push(s);
        byCol[x].push(s);
        deco[y][x] = -1;
      } else if (HANG_SWAY[w].includes(idx)) {
        const imgs: Phaser.GameObjects.Image[] = [];
        let yy = y;
        while (yy < H && HANG_SWAY[w].includes(deco[yy][x])) {
          imgs.push(scene.add.image(x * TILE + 8, y * TILE, decoKey, deco[yy][x]).setOrigin(0.5, -(yy - y)).setDepth(11));
          deco[yy][x] = -1;
          yy++;
        }
        const s: Sway = { imgs, x: x * TILE + 8, y0: y * TILE, y1: yy * TILE, hang: true, max: w === 1 ? 16 : 9, a: 0, v: 0, target: 0, touched: false, active: false };
        sways.push(s);
        byCol[x].push(s);
      }
    }
  const activeSways = new Set<Sway>();
  const forCols = (x0: number, x1: number, fn: (s: Sway) => void) => {
    const c0 = Math.max(0, Math.floor(x0 / TILE));
    const c1 = Math.min(Wd - 1, Math.floor(x1 / TILE));
    for (let c = c0; c <= c1; c++) for (const s of byCol[c]) fn(s);
  };
  const touch = (x: number, y: number, hw: number, hh: number, vx: number) => {
    if (!sways.length) return;
    forCols(x - hw - 6, x + hw + 6, (s) => {
      if (Math.abs(s.x - x) > hw + 5 || y + hh < s.y0 || y - hh > s.y1) return;
      const moving = Math.abs(vx) > 25;
      const dir = moving ? Math.sign(vx) : s.x >= x ? 1 : -1;
      const str = moving ? Math.min(1, 0.55 + Math.abs(vx) / 260) : 0.45;
      s.target = dir * s.max * str;
      s.touched = true;
      if (s.hang && moving && !s.active) s.v += dir * 40; // a little kick as you brush past
      s.active = true;
      activeSways.add(s);
    });
  };
  const push = (r: { x: number; y: number; w: number; h: number }, originX: number, force = 1) => {
    if (!sways.length) return;
    forCols(r.x - 4, r.x + r.w + 4, (s) => {
      if (s.x < r.x - 4 || s.x > r.x + r.w + 4 || r.y + r.h < s.y0 || r.y > s.y1) return;
      const dir = s.x >= originX ? 1 : -1;
      s.v += dir * force * (s.hang ? 160 : 420);
      s.active = true;
      activeSways.add(s);
    });
  };
  const stepSways = (dt: number) => {
    const t = dt / 1000;
    for (const s of activeSways) {
      const target = s.touched ? s.target : 0;
      s.touched = false;
      const k = s.hang ? 55 : 190;
      const c = s.hang ? 2.6 : 7.5;
      s.v += (k * (target - s.a) - c * s.v) * t;
      s.a += s.v * t;
      const lim = s.max * 1.5;
      if (s.a > lim) (s.a = lim), (s.v = Math.min(0, s.v));
      else if (s.a < -lim) (s.a = -lim), (s.v = Math.max(0, s.v));
      if (target === 0 && Math.abs(s.a) < 0.3 && Math.abs(s.v) < 3) {
        s.a = 0;
        s.v = 0;
        s.active = false;
        activeSways.delete(s);
      }
      for (const img of s.imgs) img.setAngle(s.a);
    }
  };

  const dmap = scene.make.tilemap({ data: deco, tileWidth: TILE, tileHeight: TILE });
  const dts = dmap.addTilesetImage('deco', `envDeco${world}`, TILE, TILE, 0, 0)!;
  const decoLayer = dmap.createLayer(0, dts, 0, 0)!;
  decoLayer.setDepth(11);
  // windows sit on solid mass; tint them like the wall around them but keep the glass warm
  decoLayer.forEachTile((t) => {
    if (w === 2 && t.index >= D.WIN && t.index < D.WIN + 6) t.tint = 0xe8e0e0;
  });

  // ---- animated pieces + lights
  const lights: { img: Phaser.GameObjects.Image; base: number; phase: number; speed: number; sx: number; sy: number; boost: number; flame?: Phaser.GameObjects.Sprite }[] = [];
  const light = (x: number, y: number, color: number, sx: number, sy: number, alpha: number, speed = 0.004) => {
    const img = scene.add.image(x, y, 'light').setTint(color).setAlpha(alpha).setScale(sx, sy).setBlendMode(Phaser.BlendModes.ADD).setDepth(30);
    lights.push({ img, base: alpha, phase: rnd() * 10, speed, sx, sy, boost: 0 });
    return img;
  };
  for (const t of torches) {
    const tx = t.x * TILE + (t.flip ? 11 : 5);
    const ty = t.y * TILE + 8;
    const flame = scene.add.sprite(tx, ty + 8, 'envTorch').setOrigin(0.5, 1).setFlipX(t.flip).setDepth(11).play({ key: 'envTorch-burn', startFrame: (rnd() * 4) | 0 });
    light(tx, ty - 4, 0xffa040, 1.5, 1.5, 0.32, 0.012);
    lights[lights.length - 1].flame = flame;
  }
  // lava runs: scrolling surface + shimmer + glow strip + merged light
  const lava: Phaser.GameObjects.TileSprite[] = [];
  const shimmer: Phaser.GameObjects.TileSprite[] = [];
  const lavaRuns: { x: number; y: number; w: number }[] = [];
  for (let y = 0; y < H; y++) {
    let x = 0;
    while (x < Wd) {
      if (tiles[y][x] !== T.LAVA) {
        x++;
        continue;
      }
      const x0 = x;
      while (x < Wd && tiles[y][x] === T.LAVA) x++;
      const n = x - x0;
      lavaRuns.push({ x: x0 * TILE, y: y * TILE, w: n * TILE });
      lava.push(scene.add.tileSprite(x0 * TILE, y * TILE, n * TILE, TILE, 'envLava').setOrigin(0, 0).setDepth(10.5).setTilePosition(x0 * 7, 0));
      shimmer.push(scene.add.tileSprite(x0 * TILE, y * TILE, n * TILE, TILE, 'envLavaShimmer').setOrigin(0, 0).setDepth(10.6).setBlendMode(Phaser.BlendModes.ADD));
      // heat glow rising above the surface
      scene.add.image(x0 * TILE + (n * TILE) / 2, y * TILE + 5, 'envGlow').setOrigin(0.5, 1).setDisplaySize(n * TILE + 8, 26).setTint(tint(0xff5a20)).setAlpha(0.35).setBlendMode(Phaser.BlendModes.ADD).setDepth(9);
      light(x0 * TILE + (n * TILE) / 2, y * TILE + 8, tint(0xff6a20), (n * TILE + 40) / 64, 1.0, 0.38, 0.003);
    }
  }
  // W3 lava/vent embers drift up from the hot spots (one emitter for all sources)
  const hot = [...vents, ...lavaRuns.map((r) => ({ x: r.x, y: r.y + 4, w: r.w }))];
  if (w === 3 && hot.length) {
    scene.add
      .particles(0, 0, 'envDot', {
        lifespan: { min: 900, max: 1800 },
        frequency: Math.max(40, 400 / hot.length),
        speedY: { min: -45, max: -20 },
        speedX: { min: -8, max: 8 },
        scale: { start: 0.9, end: 0.2 },
        alpha: { start: 1, end: 0 },
        tint: [C.amber, C.orange, C.gold].map(tint),
        blendMode: Phaser.BlendModes.ADD,
        emitZone: {
          type: 'random',
          source: {
            getRandomPoint: (p: Phaser.Types.Math.Vector2Like) => {
              const s = hot[(Math.random() * hot.length) | 0] as { x: number; y: number; w?: number };
              p.x = s.x + (s.w ? Math.random() * s.w : (Math.random() - 0.5) * 6);
              p.y = s.y;
              return p;
            },
          },
        } as Phaser.Types.GameObjects.Particles.EmitZoneData,
      })
      .setDepth(12);
    for (const v of vents) light(v.x, v.y, tint(0xff6a20), 0.6, 0.5, 0.35, 0.008);
  }

  let lastT = 0;
  const update = (time: number) => {
    const dt = lastT ? Math.min(50, time - lastT) : 16;
    lastT = time;
    for (let i = 0; i < lava.length; i++) {
      lava[i].tilePositionX += dt * 0.006;
      shimmer[i].tilePositionX -= dt * 0.012;
      shimmer[i].setAlpha(0.6 + 0.4 * Math.sin(time * 0.002 + i));
    }
    const decay = Math.exp(-dt / 260);
    for (const l of lights) {
      const f = Math.sin(time * l.speed + l.phase) * 0.5 + Math.sin(time * l.speed * 2.7 + l.phase * 2) * 0.25;
      if (l.boost > 0.01) {
        // flared: brighter, bigger, and flickering hard while it settles
        const jit = 1 + (Math.random() - 0.5) * 0.5 * l.boost;
        l.img.setAlpha(Math.min(1, l.base * (1 + f * 0.25) * (1 + l.boost * 1.6) * jit));
        l.img.setScale(l.sx * (1 + l.boost * 0.45), l.sy * (1 + l.boost * 0.45));
        l.flame?.setScale(1 + l.boost * 0.35 * jit, 1 + l.boost * 0.6 * jit);
        l.boost *= decay;
        if (l.boost <= 0.01) {
          l.boost = 0;
          l.img.setScale(l.sx, l.sy);
          l.flame?.setScale(1);
        }
      } else l.img.setAlpha(l.base * (1 + f * 0.25));
    }
    stepSways(dt);
  };

  const flare = (x: number, y: number, radius: number, amount = 1) => {
    for (const l of lights) {
      const d = Math.hypot(l.img.x - x, l.img.y - y);
      if (d > radius) continue;
      l.boost = Math.min(1.5, Math.max(l.boost, amount * (1 - (d / radius) * 0.6)));
    }
  };

  return { visual, deco: decoLayer, update, touch, push, flare };
}

// ============================================================================ ambient particles

/** World-appropriate ambient particles around the camera view (fireflies / dust motes / embers). */
export function buildAmbient(scene: Phaser.Scene, world: W, worldW: number, worldH: number): Phaser.GameObjects.Particles.ParticleEmitter[] {
  const cam = scene.cameras.main;
  const rx = () => Phaser.Math.Clamp(cam.scrollX - 40 + Math.random() * (cam.width + 80), 0, worldW);
  const ry = () => Phaser.Math.Clamp(cam.scrollY - 20 + Math.random() * (cam.height + 40), 0, worldH);
  const out: Phaser.GameObjects.Particles.ParticleEmitter[] = [];
  const tint = (c: number) => tintW(world, c);
  const pw = paintOf(world);
  if (pw === 1) {
    // fireflies: glowing dots that blink while wandering
    const ff = scene.add.particles(0, 0, 'light', {
      x: { onEmit: rx },
      y: { onEmit: ry },
      lifespan: { min: 4000, max: 7000 },
      frequency: 260,
      speedX: { min: -10, max: 10 },
      speedY: { min: -8, max: 6 },
      scale: { min: 0.07, max: 0.12 },
      alpha: {
        onEmit: () => 0,
        onUpdate: (p: Phaser.GameObjects.Particles.Particle, _k: string, t: number) => Math.max(0, Math.sin(t * Math.PI)) * (0.55 + 0.45 * Math.sin(p.lifeCurrent * 0.006 + p.x)),
      },
      tint: [C.lime, C.gold, 0xc8ff80],
      blendMode: Phaser.BlendModes.ADD,
    });
    ff.setDepth(12);
    out.push(ff);
    // drifting pollen
    const pollen = scene.add.particles(0, 0, 'envDot', {
      x: { onEmit: rx },
      y: { onEmit: ry },
      lifespan: 6000,
      frequency: 300,
      speedX: { min: 3, max: 10 },
      speedY: { min: 1, max: 5 },
      scale: 0.5,
      alpha: { start: 0, end: 0.5, ease: 'Sine.inOut' },
      tint: 0xe8f0c0,
    });
    pollen.setDepth(12);
    out.push(pollen);
  } else if (pw === 2) {
    const dust = scene.add.particles(0, 0, 'envDot', {
      x: { onEmit: rx },
      y: { onEmit: ry },
      lifespan: 7000,
      frequency: 150,
      speedX: { min: -4, max: 5 },
      speedY: { min: -3, max: 4 },
      scale: { min: 0.4, max: 0.7 },
      alpha: { onEmit: () => 0, onUpdate: (_p: Phaser.GameObjects.Particles.Particle, _k: string, t: number) => Math.sin(t * Math.PI) * 0.45 },
      tint: [C.mist, 0xe0d0b0],
    });
    dust.setDepth(12);
    out.push(dust);
  } else {
    const ember = scene.add.particles(0, 0, 'envDot', {
      x: { onEmit: rx },
      y: { onEmit: () => Math.min(worldH, cam.scrollY + cam.height + 10) - Math.random() * 60 },
      lifespan: { min: 3000, max: 5000 },
      frequency: 110,
      speedY: { min: -40, max: -15 },
      speedX: { min: -10, max: 14 },
      scale: { min: 0.4, max: 0.9 },
      alpha: { onEmit: () => 1, onUpdate: (p: Phaser.GameObjects.Particles.Particle, _k: string, t: number) => (1 - t) * (0.6 + 0.4 * Math.sin(p.lifeCurrent * 0.02)) },
      tint: [C.orange, C.amber, C.red].map(tint),
      blendMode: Phaser.BlendModes.ADD,
    });
    ember.setDepth(12);
    out.push(ember);
    const ash = scene.add.particles(0, 0, 'envDot', {
      x: { onEmit: rx },
      y: { onEmit: () => cam.scrollY - 5 },
      lifespan: 8000,
      frequency: 260,
      speedY: { min: 6, max: 14 },
      speedX: { min: -6, max: 3 },
      scale: 0.5,
      alpha: { start: 0.35, end: 0 },
      tint: tint(0x8a7a80),
    });
    ash.setDepth(12);
    out.push(ash);
  }
  return out;
}

// ============================================================================ registration

export function registerEnvironmentArt(scene: Phaser.Scene): void {
  for (const w of PAINTED) {
    buildTileset(scene, w);
    buildDecoTiles(scene, w);
  }
  buildProps(scene);
  buildBreakables(scene);
  buildParallaxTextures(scene);
  // world 4: every world-keyed texture is the world-3 one recoloured
  for (const [src, dst] of [['envTiles3', 'envTiles4'], ['envDeco3', 'envDeco4'], ['tiles-w3-preview', 'tiles-w4-preview'], ['platform3', 'platform4'], ['crumble3', 'crumble4'], ['sign3', 'sign4'], ['breakable3', 'breakable4'], ['breakDebris3', 'breakDebris4']])
    cloneRemap(scene, src, dst, coldRemap);
}
