import Phaser from 'phaser';

/**
 * Pixel-art pipeline. Sprites are authored as string grids:
 *   const frame = [
 *     '..aa..',
 *     '.abba.',
 *   ];
 * Each character maps to a colour through a Palette ('.' or ' ' = transparent).
 * Colours may be 0xRRGGBB or 0xAARRGGBB-style objects via `rgba()`.
 */
export type Color = number | { c: number; a: number };
export type Palette = Record<string, Color>;
export type Frame = string[];

export interface SheetOpts {
  /** Automatic 1px outline colour around opaque pixels (default: OUTLINE). `false` disables it. */
  outline?: number | false;
  /** Use 8-neighbour outline (corners too). Default false (4-neighbour = softer). */
  outlineCorners?: boolean;
}

/** Default outline colour (very dark purple-black). */
export const OUTLINE = 0x140c1c;

export function rgba(c: number, a: number): Color {
  return { c, a };
}

const registry: { key: string; frames: number; w: number; h: number; anims: string[] }[] = [];

/** All generated sheets, for the dev gallery. */
export function sheetRegistry(): readonly { key: string; frames: number; w: number; h: number; anims: string[] }[] {
  return registry;
}

function css(col: Color): string {
  const c = typeof col === 'number' ? col : col.c;
  const a = typeof col === 'number' ? 1 : col.a;
  return `rgba(${(c >> 16) & 255},${(c >> 8) & 255},${c & 255},${a})`;
}

/** Rasterise frames into a pixel matrix of colours (null = transparent), with optional outline + 1px padding. */
export function rasterize(frames: Frame[], palette: Palette, opts: SheetOpts = {}): { w: number; h: number; px: (Color | null)[][][] } {
  const outline = opts.outline === undefined ? OUTLINE : opts.outline;
  const pad = outline === false ? 0 : 1;
  const fw = Math.max(...frames.flatMap((f) => f.map((r) => r.length)));
  const fh = Math.max(...frames.map((f) => f.length));
  const w = fw + pad * 2;
  const h = fh + pad * 2;
  const px = frames.map((f) => {
    const grid: (Color | null)[][] = Array.from({ length: h }, () => Array<Color | null>(w).fill(null));
    f.forEach((row, y) => {
      for (let x = 0; x < row.length; x++) {
        const ch = row[x];
        if (ch === '.' || ch === ' ') continue;
        const col = palette[ch];
        if (col === undefined) throw new Error(`palette missing '${ch}'`);
        grid[y + pad][x + pad] = col;
      }
    });
    if (outline !== false) {
      const n4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
      const n8 = [...n4, [1, 1], [-1, 1], [1, -1], [-1, -1]];
      const ns = opts.outlineCorners ? n8 : n4;
      const marks: [number, number][] = [];
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          if (grid[y][x] !== null) continue;
          if (ns.some(([dx, dy]) => grid[y + dy]?.[x + dx] != null)) marks.push([x, y]);
        }
      for (const [x, y] of marks) grid[y][x] = outline;
    }
    return grid;
  });
  return { w, h, px };
}

/**
 * Draws all frames side-by-side into one canvas texture `key`, registering frames 0..n-1.
 * Returns the frame size (including outline padding).
 * If the key exists it is replaced (lets art modules override the old placeholder textures).
 */
export function drawSheet(scene: Phaser.Scene, key: string, frames: Frame[], palette: Palette, opts: SheetOpts = {}): { w: number; h: number } {
  const { w, h, px } = rasterize(frames, palette, opts);
  if (scene.textures.exists(key)) scene.textures.remove(key);
  const tex = scene.textures.createCanvas(key, w * frames.length, h)!;
  const ctx = tex.getContext();
  px.forEach((grid, i) => {
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const col = grid[y][x];
        if (col === null) continue;
        ctx.fillStyle = css(col);
        ctx.fillRect(i * w + x, y, 1, 1);
      }
    tex.add(i, 0, i * w, 0, w, h);
  });
  tex.refresh();
  const prev = registry.findIndex((r) => r.key === key);
  const entry = { key, frames: frames.length, w, h, anims: prev >= 0 ? registry[prev].anims : [] };
  if (prev >= 0) registry[prev] = entry;
  else registry.push(entry);
  return { w, h };
}

/** Single-image convenience. */
export function drawImage(scene: Phaser.Scene, key: string, frame: Frame, palette: Palette, opts: SheetOpts = {}): { w: number; h: number } {
  return drawSheet(scene, key, [frame], palette, opts);
}

/** Free-form canvas drawing (gradients, glows, backgrounds) registered as a texture. */
export function drawCanvas(scene: Phaser.Scene, key: string, w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void): void {
  if (scene.textures.exists(key)) scene.textures.remove(key);
  const tex = scene.textures.createCanvas(key, w, h)!;
  const ctx = tex.getContext();
  ctx.imageSmoothingEnabled = false;
  draw(ctx);
  tex.refresh();
}

/**
 * Create (or replace) an animation from frames of a sheet.
 * `frames` are frame indices into the sheet. repeat -1 = loop.
 */
export function defineAnim(scene: Phaser.Scene, key: string, sheet: string, frames: number[], frameRate: number, repeat = -1): void {
  if (scene.anims.exists(key)) scene.anims.remove(key);
  scene.anims.create({ key, frames: frames.map((f) => ({ key: sheet, frame: f })), frameRate, repeat });
  const entry = registry.find((r) => r.key === sheet);
  if (entry && !entry.anims.includes(key)) entry.anims.push(key);
}

// ---------------------------------------------------------------- authoring helpers

/** Mirror each row of a left half to build a symmetric sprite: 'ab' -> 'abba' (odd=true -> 'aba'). */
export function mirrorH(rows: Frame, odd = false): Frame {
  return rows.map((r) => r + [...r].reverse().join('').slice(odd ? 1 : 0));
}

/** Flip a frame horizontally. */
export function flipH(rows: Frame): Frame {
  return rows.map((r) => [...r].reverse().join(''));
}

/** Shift a frame by dx/dy, padding with '.', keeping size. */
export function shift(rows: Frame, dx: number, dy: number): Frame {
  const w = Math.max(...rows.map((r) => r.length));
  const blank = '.'.repeat(w);
  const out: Frame = [];
  for (let y = 0; y < rows.length; y++) {
    const src = rows[y - dy] ?? blank;
    let line = '';
    for (let x = 0; x < w; x++) line += src[x - dx] ?? '.';
    out.push(line);
  }
  return out;
}

/** Overlay `top` onto `base` (non-transparent chars of top win) at offset. */
export function overlay(base: Frame, top: Frame, ox = 0, oy = 0): Frame {
  const out = base.map((r) => r.split(''));
  top.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const ch = row[x];
      if (ch === '.' || ch === ' ') continue;
      const yy = y + oy;
      const xx = x + ox;
      if (out[yy] && xx >= 0 && xx < out[yy].length) out[yy][xx] = ch;
    }
  });
  return out.map((r) => r.join(''));
}

/** Replace characters (palette-swap at the grid level). */
export function recolor(rows: Frame, map: Record<string, string>): Frame {
  return rows.map((r) => [...r].map((c) => map[c] ?? c).join(''));
}
