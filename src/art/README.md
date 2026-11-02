# Art pipeline guide

All art is generated at runtime from code. Never add image or font files.

## Authoring sprites (`pixel.ts`)
```ts
import { drawSheet, defineAnim, mirrorH, shift, overlay, recolor, flipH } from './pixel';
import { C } from './palette';

const PAL = { a: C.ink, b: C.blue, c: C.cyan, d: C.white };    // char -> colour ('.'/' ' = transparent)
const idle0 = [
  '..bb..',
  '.bccb.',
  '.bcdb.',
];
drawSheet(scene, 'thing', [idle0, idle1, run0, ...], PAL);        // frames 0..n-1, auto 1px outline (OUTLINE colour)
defineAnim(scene, 'thing-idle', 'thing', [0, 1], 4);              // key, sheet, frames, fps, repeat(-1 loop / 0 once)
```
- All frames of a sheet share one size (the largest). Draw **feet on the bottom row** of the frame; entity bodies are bottom-aligned.
- `drawSheet` pads 1px on every side for the outline, so a 14×22 grid becomes a 16×24 frame. Pass `{ outline: false }` for tiles and backgrounds that tile seamlessly.
- Calling it with an existing key **replaces** that texture. That is how the new art overrides the legacy keys from `core/Textures.ts` ('player', 'slime', 'tiles1', …).
- `drawCanvas(scene, key, w, h, ctx => …)` handles free-form canvas work such as gradients and backgrounds.
- Helpers: `mirrorH` (symmetric halves), `flipH`, `shift`, `overlay` (compose parts), `recolor` (char swaps, e.g. elite variants).
- Use the shared palette `C` / `WORLD` from `palette.ts`.

## Animation hooks
- Enemies: override `protected animKey(): string | null` in the subclass. It is called every tick and plays the animation when the key changes. `this.stunned`, `this.onGround`, `this.body.velocity` and the subclass's own `mode` field are available. It is visual only: never change AI or numbers.
- Player: `Player.updateVisual()` runs at the end of every tick.

## Text
`txt(scene, x, y, str, size, color, originX)` in `ui/text.ts` returns a `PxText` (BitmapText with the 'pxfont' pixel font). `size` maps to an integer scale: under 14 → ×1, 14–23 → ×2, 24–35 → ×3, 36 and up → ×5. Missing glyphs render as '?'. To add a glyph, edit `art/glyphs.ts`.

## FX (`core/Fx.ts`)
- `applyCameraFx(camera, world)`: vignette and colour grade. It respects the Settings toggle and needs WebGL.
- `glow(sprite, color)`: preFX outer glow (no-op when FX is off).
- `addLight(scene, x, y, color, radius, alpha)`: additive soft light sprite that works with FX off. Remember to move or destroy it with its owner.

## Checking your work
- The dev gallery shows every sheet and animation: open the menu and press `G`, or run `game.scene.start('Gallery', { filter: 'slime', zoom: 3 })`.
- Scripts (run from `$CLAUDE_JOB_DIR/tmp/pw`, dev server on :5173):
  - `node gallery.mjs <outdir> [filter] [zoom] [page]`: gallery screenshot.
  - `node smoke.mjs <levelId> <outdir>`: level screenshots and console errors.
  - `node bodies.mjs`: collision body sizes; these must match `../bodies-before.json`.
