import Phaser from 'phaser';
import { GAME_W, GAME_H } from '../config';
import { sheetRegistry } from '../art/pixel';
import { txt } from '../ui/text';
import { InputManager } from '../core/InputManager';

interface GalleryData {
  /** only show sheets whose key contains this substring */
  filter?: string;
  page?: number;
  /** pixel zoom for items */
  zoom?: number;
  /** background colour */
  bg?: number;
}

/**
 * DEV ONLY art gallery: every registered sheet, each animation looping, with labels.
 * Open from the menu with G, or: game.scene.start('Gallery', { filter: 'slime', zoom: 3 }).
 * Left/Right = page, B = cycle background, Esc = back.
 */
export class GalleryScene extends Phaser.Scene {
  private inp!: InputManager;
  private d: Required<GalleryData> = { filter: '', page: 0, zoom: 2, bg: 0x2a2a3a };
  private bgs = [0x2a2a3a, 0x8a8aa0, 0x10223a, 0x1a0610];
  constructor() {
    super('Gallery');
  }
  init(d: GalleryData): void {
    this.d = { filter: d.filter ?? '', page: d.page ?? 0, zoom: d.zoom ?? 2, bg: d.bg ?? 0x2a2a3a };
  }
  create(): void {
    this.cameras.main.setBackgroundColor(this.d.bg);
    this.inp = new InputManager(this);
    // one item per animation (or per sheet if it has none)
    const items: { label: string; sheet: string; anim?: string; w: number; h: number }[] = [];
    for (const s of sheetRegistry()) {
      if (this.d.filter && !s.key.includes(this.d.filter) && !s.anims.some((a) => a.includes(this.d.filter))) continue;
      if (s.anims.length) for (const a of s.anims) items.push({ label: a, sheet: s.key, anim: a, w: s.w, h: s.h });
      else items.push({ label: `${s.key}${s.frames > 1 ? ` [${s.frames}]` : ''}`, sheet: s.key, w: s.w, h: s.h });
    }
    const z = this.d.zoom;
    const pad = 6;
    let x = pad;
    let y = 18;
    let rowH = 0;
    const pages: (typeof items)[] = [[]];
    const layout: { x: number; y: number }[][] = [[]];
    for (const it of items) {
      const w = Math.max(it.w * z, 40);
      const h = it.h * z + 12;
      if (x + w > GAME_W - pad) {
        x = pad;
        y += rowH + 4;
        rowH = 0;
      }
      if (y + h > GAME_H - 4) {
        pages.push([]);
        layout.push([]);
        x = pad;
        y = 18;
        rowH = 0;
      }
      pages[pages.length - 1].push(it);
      layout[layout.length - 1].push({ x, y });
      x += w + pad;
      rowH = Math.max(rowH, h);
    }
    const page = Phaser.Math.Clamp(this.d.page, 0, pages.length - 1);
    txt(this, 4, 7, `GALLERY ${page + 1}/${pages.length}  ${items.length} items  filter:'${this.d.filter}'  <- -> page, B bg, Esc back`, 8, '#ffd96a', 0);
    pages[page].forEach((it, i) => {
      const { x: ix, y: iy } = layout[page][i];
      const w = Math.max(it.w * z, 40);
      const s = this.add.sprite(ix + w / 2, iy + (it.h * z) / 2, it.sheet, 0).setScale(z);
      if (it.anim) s.play(it.anim);
      txt(this, ix + w / 2, iy + it.h * z + 6, it.label, 8, '#ffffff');
    });
  }
  update(time: number): void {
    this.inp.update(time);
    if (this.inp.justPressed('right')) this.scene.restart({ ...this.d, page: this.d.page + 1 });
    else if (this.inp.justPressed('left')) this.scene.restart({ ...this.d, page: Math.max(0, this.d.page - 1) });
    else if (this.inp.justPressed('pause')) this.scene.start('Menu');
    else if (this.input.keyboard!.checkDown(this.input.keyboard!.addKey('B'), 300)) {
      const i = (this.bgs.indexOf(this.d.bg) + 1) % this.bgs.length;
      this.scene.restart({ ...this.d, bg: this.bgs[i] });
    }
  }
}
