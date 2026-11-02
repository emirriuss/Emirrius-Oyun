import Phaser from 'phaser';
import { save } from '../systems/SaveSystem';

/**
 * Post-processing + lighting helpers. Everything is WebGL-only and respects the
 * `settings.fx` toggle; callers never need to check either.
 */
/**
 * Note: Phaser's camera Bloom blurs the WHOLE frame and scales it by strength (no bright-pass),
 * which darkens/brightens everything and smears pixel art — so we don't use it. Glow comes from
 * additive lights (`addLight`) and per-sprite `glow()` instead.
 */
export interface WorldGrade {
  vignette: number; // 0..1 strength
  vignetteRadius: number;
  saturate: number; // ColorMatrix saturate amount (-1..1)
  contrast: number; // ColorMatrix contrast (-1..1)
  tint?: [number, number, number]; // multiplicative RGB grade (1 = unchanged)
}

/** Per-world grading. Tuned in Phase 2. Key 0 = menus. */
export const GRADES: Record<number, WorldGrade> = {
  0: { vignette: 0.25, vignetteRadius: 0.8, saturate: 0.05, contrast: 0.05 },
  1: { vignette: 0.3, vignetteRadius: 0.75, saturate: 0.1, contrast: 0.06, tint: [0.98, 1.02, 1.0] },
  2: { vignette: 0.35, vignetteRadius: 0.72, saturate: -0.05, contrast: 0.08, tint: [0.98, 0.97, 1.04] },
  3: { vignette: 0.28, vignetteRadius: 0.7, saturate: 0.12, contrast: 0.1, tint: [1.05, 0.97, 0.95] },
  4: { vignette: 0.4, vignetteRadius: 0.68, saturate: 0.02, contrast: 0.1, tint: [0.95, 0.99, 1.06] },
};

export function fxEnabled(scene: Phaser.Scene): boolean {
  return save.data.settings.fx && scene.game.renderer.type === Phaser.WEBGL;
}

/** Adds vignette + colour grade to a camera (replaces previous FX). */
export function applyCameraFx(camera: Phaser.Cameras.Scene2D.Camera, world: number): void {
  const scene = camera.scene;
  camera.postFX?.clear();
  if (!fxEnabled(scene)) return;
  const g = GRADES[world] ?? GRADES[0];
  const cm = camera.postFX.addColorMatrix();
  cm.saturate(g.saturate, true);
  cm.contrast(g.contrast, true);
  if (g.tint) {
    const [r, gg, b] = g.tint;
    cm.multiply([r, 0, 0, 0, 0, 0, gg, 0, 0, 0, 0, 0, b, 0, 0, 0, 0, 0, 1, 0]);
  }
  camera.postFX.addVignette(0.5, 0.5, g.vignetteRadius, g.vignette);
}

/** Outer glow on a sprite (preFX). No-op when FX disabled. */
export function glow(obj: Phaser.GameObjects.Sprite | Phaser.GameObjects.Image, color: number, strength = 2): void {
  if (!fxEnabled(obj.scene) || !obj.preFX) return;
  obj.preFX.setPadding(4);
  obj.preFX.addGlow(color, strength, 0, false, 0.1, 8);
}

/**
 * Additive soft light (works with FX off too — it's just a blended sprite).
 * Uses the generated 'light' radial gradient texture.
 */
export function addLight(scene: Phaser.Scene, x: number, y: number, color: number, radius = 32, alpha = 0.5): Phaser.GameObjects.Image {
  return scene.add
    .image(x, y, 'light')
    .setTint(color)
    .setAlpha(alpha)
    .setScale(radius / 32)
    .setBlendMode(Phaser.BlendModes.ADD)
    .setDepth(30);
}
