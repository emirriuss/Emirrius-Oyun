import Phaser from 'phaser';
import { drawCanvas } from './pixel';

/** Shared utility textures used by several domains. */
export function registerCommon(scene: Phaser.Scene): void {
  // soft radial light for additive glows (see core/Fx.addLight)
  drawCanvas(scene, 'light', 64, 64, (ctx) => {
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.35, 'rgba(255,255,255,0.45)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
  });
}
