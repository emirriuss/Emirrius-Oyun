import Phaser from 'phaser';
import { GLYPHS, GLYPH_H, SPACE_W } from './glyphs';

/** Bitmap font key: white glyphs with a baked dark outline (tint to colour). */
export const FONT = 'pxfont';

/**
 * Builds the 'pxfont' BitmapText font from GLYPHS into a canvas texture.
 * Each glyph cell carries a 1px dark outline so text is readable on any background;
 * the white body takes the BitmapText tint, the outline stays dark.
 */
export function registerFont(scene: Phaser.Scene): void {
  if (scene.cache.bitmapFont.exists(FONT)) return;
  type Gl = { ch: string; rows: string[]; w: number };
  const glyphs: Gl[] = Object.entries(GLYPHS).map(([ch, s]) => {
    const rows = s.split('|');
    const width = Math.max(...rows.map((r) => r.length));
    // trim empty columns on left/right
    let l = 0;
    let r = width - 1;
    const colEmpty = (x: number) => rows.every((row) => row[x] !== '#');
    while (l < r && colEmpty(l)) l++;
    while (r > l && colEmpty(r)) r--;
    return { ch, rows: rows.map((row) => row.padEnd(width, '.').slice(l, r + 1)), w: r - l + 1 };
  });
  const cellH = GLYPH_H + 2;
  const perRow = 16;
  const cellW = 9;
  const texW = perRow * cellW;
  const texH = Math.ceil((glyphs.length + 1) / perRow) * cellH;
  if (scene.textures.exists(FONT)) scene.textures.remove(FONT);
  const tex = scene.textures.createCanvas(FONT, texW, texH)!;
  const ctx = tex.getContext();
  const chars: Record<number, unknown> = {};
  const add = (code: number, x: number, y: number, w: number, adv: number) => {
    chars[code] = {
      x, y, width: w, height: cellH,
      centerX: Math.floor(w / 2), centerY: Math.floor(cellH / 2),
      xOffset: 0, yOffset: 0, xAdvance: adv,
      data: {}, kerning: {},
      u0: x / texW, v0: y / texH, u1: (x + w) / texW, v1: (y + cellH) / texH,
    };
  };
  glyphs.forEach((g, i) => {
    const ox = (i % perRow) * cellW;
    const oy = Math.floor(i / perRow) * cellH;
    const on = (x: number, y: number) => g.rows[y]?.[x] === '#';
    // outline
    ctx.fillStyle = '#140c1c';
    for (let y = -1; y <= GLYPH_H; y++)
      for (let x = -1; x <= g.w; x++) {
        if (on(x, y)) continue;
        if (on(x + 1, y) || on(x - 1, y) || on(x, y + 1) || on(x, y - 1) || on(x + 1, y + 1) || on(x - 1, y - 1) || on(x + 1, y - 1) || on(x - 1, y + 1))
          ctx.fillRect(ox + x + 1, oy + y + 1, 1, 1);
      }
    ctx.fillStyle = '#ffffff';
    for (let y = 0; y < GLYPH_H; y++) for (let x = 0; x < g.w; x++) if (on(x, y)) ctx.fillRect(ox + x + 1, oy + y + 1, 1, 1);
    // glyph cell is w+2 wide (outline); advance w+1 so outlines overlap by 1px
    add(g.ch.charCodeAt(0), ox, oy, g.w + 2, g.w + 1);
  });
  add(32, 0, 0, 0, SPACE_W + 1);
  tex.refresh();
  scene.cache.bitmapFont.add(FONT, {
    data: { font: FONT, size: cellH, lineHeight: cellH + 1, retroFont: false, chars },
    texture: FONT,
    frame: null,
  });
}

/** Characters with no glyph are replaced so text never silently vanishes. */
export function sanitize(s: string): string {
  let out = '';
  for (const ch of s) {
    if (ch === '\n' || ch === ' ' || GLYPHS[ch]) out += ch;
    else if (GLYPHS[ch.toUpperCase()]) out += ch.toUpperCase();
    else if (ch === '—' || ch === '–') out += '-';
    else if (ch === '…') out += '...';
    else out += '?';
  }
  return out;
}
