import type Phaser from 'phaser';
import { paintPanel } from '../../art/ui';
import { drawCanvas } from '../../art/pixel';
import { WORLD, C } from '../../art/palette';
import { STAGE, type World } from './layout';

/** Deterministic pseudo-random for decorations. */
export function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

export const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;

type Ctx = CanvasRenderingContext2D;
type Palette = (typeof WORLD)[World];

/** What makes each world's diorama look like that world. */
interface Scenery {
  /** silhouette height at column x */
  hill(x: number): number;
  /** one prop standing on the ground line at x; `s` scales it */
  prop(ctx: Ctx, x: number, groundY: number, r: () => number, P: Palette, s: number): void;
  /** optional sky feature, drawn behind the hills */
  sky?(ctx: Ctx, ix: number, iy: number, iw: number, P: Palette): void;
}

/** A tapered spike/stalagmite/pine of height h whose half-width grows to `w` at the base. */
function taper(ctx: Ctx, x: number, groundY: number, h: number, w: number): void {
  for (let y = 0; y < h; y++) {
    const half = Math.max(0, Math.floor(((y + 1) / h) * w));
    ctx.fillRect(x - half, groundY - h + y, half * 2 + 1, 1);
  }
}

const SCENERY: Record<World, Scenery> = {
  1: {
    hill: (x) => 8 + Math.round(5 * Math.sin(x * 0.05) + 3 * Math.sin(x * 0.13)),
    // pine trees
    prop(ctx, x, groundY, r, P, s) {
      const h = Math.round((8 + r() * 8) * s);
      ctx.fillStyle = hex(P.top[0]);
      taper(ctx, x, groundY, h, Math.round(4 * Math.sqrt(s)));
      ctx.fillStyle = hex(P.ground[0]);
      ctx.fillRect(x, groundY - 2, 1, 3);
    },
  },
  2: {
    hill: (x) => 6 + Math.round(2 * Math.sin(x * 0.07)),
    // spires with lit windows
    prop(ctx, x, groundY, r, P, s) {
      const h = Math.round((10 + r() * 18) * s);
      const bw = Math.round((3 + r() * 3) * Math.sqrt(s));
      ctx.fillStyle = hex(C.night);
      ctx.fillRect(x, groundY - h, bw, h);
      ctx.fillRect(x + Math.floor(bw / 2), groundY - h - 4, 1, 4);
      ctx.fillStyle = hex(P.accent);
      for (let k = 0; k < 3; k++) if (r() < 0.5) ctx.fillRect(x + 1 + Math.floor(r() * (bw - 2)), groundY - h + 3 + Math.floor(r() * (h - 6)), 1, 1);
    },
  },
  3: {
    hill: (x) => 5 + Math.round(3 * Math.abs(Math.sin(x * 0.04))),
    // jagged crimson spikes / ruined towers
    prop(ctx, x, groundY, r, _P, s) {
      const h = Math.round((6 + r() * 14) * s);
      ctx.fillStyle = hex(0x2a0a12);
      taper(ctx, x, groundY, h, Math.round(2 * Math.sqrt(s)));
      if (r() < 0.4) {
        ctx.fillStyle = hex(C.orange);
        ctx.fillRect(x, groundY - h - 1, 1, 1);
      }
    },
  },
  4: {
    hill: (x) => 3 + Math.round(2 * Math.abs(Math.sin(x * 0.06))),
    // pale crystal stalagmites in the dark, a few glinting gold
    prop(ctx, x, groundY, r, P, s) {
      const h = Math.round((5 + r() * 12) * s);
      ctx.fillStyle = hex(P.top[0]);
      taper(ctx, x, groundY, h, Math.round(2 * Math.sqrt(s)));
      ctx.fillStyle = hex(P.top[1]);
      ctx.fillRect(x, groundY - h + 1, 1, h - 1);
      if (r() < 0.35) {
        ctx.fillStyle = hex(P.accent);
        ctx.fillRect(x, groundY - h - 1, 1, 1);
      }
    },
    // eclipse: dark disc with a pale-gold rim
    sky(ctx, ix, iy, iw, P) {
      const ex = ix + iw - 60, ey = iy + 34, er = 12;
      for (let y = -er - 1; y <= er + 1; y++)
        for (let x = -er - 1; x <= er + 1; x++) {
          const d = Math.hypot(x, y);
          if (d > er + 1) continue;
          ctx.fillStyle = hex(d > er - 0.5 ? P.accent : P.sky[0]);
          ctx.fillRect(ex + x, ey + y, 1, 1);
        }
    },
  },
};

/** Framed stage canvas (STAGE size): `paint` gets the inner window. Returns its texture key. */
function stageCanvas(scene: Phaser.Scene, key: string, frame: 'dark' | 'gold', paint: (ctx: Ctx, ix: number, iy: number, iw: number, ih: number) => void): string {
  if (scene.textures.exists(key)) return key;
  drawCanvas(scene, key, STAGE.w, STAGE.h, (ctx) => {
    paintPanel(ctx, STAGE.w, STAGE.h, frame);
    ctx.clearRect(3, 3, STAGE.w - 6, STAGE.h - 6);
    paint(ctx, 3, 3, STAGE.w - 6, STAGE.h - 6);
  });
  return key;
}

/** Vertical banded gradient over the window. */
function bandedSky(ctx: Ctx, ix: number, iy: number, iw: number, ih: number, stops: readonly number[], bands = 12): void {
  for (let i = 0; i < bands; i++) {
    ctx.fillStyle = hex(stops[Math.min(stops.length - 1, Math.floor((i / bands) * stops.length))]);
    ctx.fillRect(ix, iy + Math.floor((i / bands) * ih), iw, Math.ceil(ih / bands) + 1);
  }
}

/** Ground strip from groundY to bottom, with a lit top edge and speckle. */
function groundStrip(ctx: Ctx, ix: number, groundY: number, iw: number, bottom: number, P: { ground: readonly number[]; top: readonly number[] }): void {
  ctx.fillStyle = hex(P.ground[1]);
  ctx.fillRect(ix, groundY, iw, bottom - groundY);
  ctx.fillStyle = hex(P.ground[0]);
  for (let y = groundY + 5, row = 0; y < bottom - 2; y += 6, row++)
    for (let x = ix + (row % 2 ? 2 : 0); x < ix + iw; x += 4) ctx.fillRect(x, y, 2, 1);
  ctx.fillRect(ix, bottom - 1, iw, 1);
  ctx.fillStyle = hex(P.top[1]);
  ctx.fillRect(ix, groundY, iw, 2);
  ctx.fillStyle = hex(P.top[2]);
  for (let x = ix; x < ix + iw; x += 3) ctx.fillRect(x, groundY, 1, 1);
  ctx.fillStyle = hex(P.top[0]);
  ctx.fillRect(ix, groundY + 2, iw, 1);
}

/** A world page's diorama: framed sky, two silhouette ranges, props and a ground strip. */
export function paintWorldStage(scene: Phaser.Scene, w: World): string {
  const P = WORLD[w];
  const S = SCENERY[w];
  return stageCanvas(scene, `ui-stage-${w}`, 'dark', (ctx, ix, iy, iw, ih) => {
    bandedSky(ctx, ix, iy, iw, ih, [P.sky[0], P.sky[1], P.sky[2]]);
    const r = rng(w * 977);
    const groundY = iy + ih - 24;
    S.sky?.(ctx, ix, iy, iw, P);
    // far range (taller, lighter), then the near range
    ctx.fillStyle = hex(P.sky[1]);
    for (let x = ix; x < ix + iw; x += 2) {
      const hgt = Math.round(S.hill(x * 0.6 + 40) * 3.4);
      ctx.fillRect(x, groundY - hgt, 2, hgt);
    }
    ctx.fillStyle = hex(P.sky[0]);
    for (let x = ix; x < ix + iw; x += 2) {
      const hgt = Math.round(S.hill(x) * 2);
      ctx.fillRect(x, groundY - hgt, 2, hgt);
    }
    for (let i = 0; i < 28; i++) S.prop(ctx, ix + 6 + Math.floor(r() * (iw - 12)), groundY, r, P, 1.5 + r());
    groundStrip(ctx, ix, groundY, iw, iy + ih, P);
  });
}

/** The post-game margin: a dark ruled page with a red margin line and scratched-out ink. */
export function paintMarginStage(scene: Phaser.Scene): string {
  return stageCanvas(scene, 'ui-stage-margin', 'dark', (ctx, ix, iy, iw, ih) => {
    bandedSky(ctx, ix, iy, iw, ih, [0x15121f, 0x1b1728, 0x211b31], 6);
    ctx.fillStyle = hex(0x2c2545);
    for (let y = iy + 26; y < iy + ih; y += 14) ctx.fillRect(ix, y, iw, 1);
    ctx.fillStyle = hex(0x6a2a3a);
    ctx.fillRect(ix + 30, iy, 1, ih);
    ctx.fillRect(ix + 33, iy, 1, ih);
    // punched holes down the left edge
    ctx.fillStyle = hex(C.ink);
    for (let y = iy + 30; y < iy + ih - 10; y += 50) ctx.fillRect(ix + 10, y, 6, 6);
    // scratched-out lines of text
    const r = rng(4242);
    ctx.fillStyle = hex(0x3a2f5c);
    for (let i = 0; i < 14; i++) {
      const x = ix + 44 + Math.floor(r() * (iw - 90));
      const y = iy + 26 + 14 * Math.floor(r() * ((ih - 30) / 14)) - 3;
      const len = 10 + Math.floor(r() * 30);
      for (let k = 0; k < len; k += 2) ctx.fillRect(x + k, y + ((k >> 1) % 2), 2, 1);
    }
  });
}

/** The shrine page: a quiet night sanctuary with two pillars and a stone dais. */
export function paintShrineStage(scene: Phaser.Scene): string {
  return stageCanvas(scene, 'ui-stage-shrine', 'gold', (ctx, ix, iy, iw, ih) => {
    bandedSky(ctx, ix, iy, iw, ih, [0x120e22, 0x1a1330, 0x2a1f44, 0x3b2c5a]);
    const r = rng(7);
    for (let i = 0; i < 50; i++) {
      ctx.fillStyle = hex(r() < 0.2 ? C.gold : C.ash);
      ctx.fillRect(ix + Math.floor(r() * iw), iy + Math.floor(r() * (ih - 70)), 1, 1);
    }
    const groundY = iy + ih - 24;
    const cx = Math.round(ix + iw / 2);
    for (const px of [cx - 76, cx + 68]) {
      ctx.fillStyle = hex(C.slate);
      ctx.fillRect(px, groundY - 80, 8, 80);
      ctx.fillStyle = hex(C.stone);
      ctx.fillRect(px, groundY - 80, 1, 80);
      ctx.fillRect(px - 2, groundY - 84, 12, 4);
      ctx.fillStyle = hex(C.ash);
      ctx.fillRect(px - 2, groundY - 84, 12, 1);
    }
    groundStrip(ctx, ix, groundY, iw, iy + ih, { ground: [C.ink, C.night], top: [C.slate, C.stone, C.ash] });
    // dais
    ctx.fillStyle = hex(C.stone);
    ctx.fillRect(cx - 26, groundY - 8, 52, 8);
    ctx.fillStyle = hex(C.mist);
    ctx.fillRect(cx - 26, groundY - 8, 52, 1);
    ctx.fillStyle = hex(C.slate);
    ctx.fillRect(cx - 16, groundY - 14, 32, 6);
    ctx.fillStyle = hex(C.ash);
    ctx.fillRect(cx - 16, groundY - 14, 32, 1);
  });
}
