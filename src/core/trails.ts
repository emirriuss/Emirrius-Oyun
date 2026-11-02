import Phaser from 'phaser';
import { MOVE_FX } from '../config';
import { drawSheet } from '../art/pixel';
import { CapPool } from './moveFx';

/**
 * Movement trails: pooled afterimages (ghostTrail) and speed lines. One pool set per scene,
 * dropped on scene shutdown (the scene destroys the images itself).
 */

interface Pools {
  ghosts: CapPool<Phaser.GameObjects.Image>;
  lines: CapPool<Phaser.GameObjects.Image>;
}
const pools = new WeakMap<Phaser.Scene, Pools>();

const STREAK_KEY = 'fx-streak';

/** 1x7 vertical streak (bright head fading to a dim tail), generated once per texture manager. */
function ensureStreak(scene: Phaser.Scene): void {
  if (scene.textures.exists(STREAK_KEY)) return;
  drawSheet(scene, STREAK_KEY, [['W', 'W', 'M', 'M', 'T', 'T', 'T']], { W: 0xffffff, M: 0xb8c8e0, T: 0x6a7890 }, { outline: false });
}

function getPools(scene: Phaser.Scene): Pools {
  let p = pools.get(scene);
  if (p) return p;
  const stop = (img: Phaser.GameObjects.Image) => scene.tweens.killTweensOf(img);
  p = {
    ghosts: new CapPool(MOVE_FX.trails.ghostCap, () => scene.add.image(0, 0, '__DEFAULT'), stop),
    lines: new CapPool(MOVE_FX.trails.lineCap, () => scene.add.image(0, 0, '__DEFAULT'), stop),
  };
  pools.set(scene, p);
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
    p?.ghosts.clear();
    p?.lines.clear();
    pools.delete(scene);
  });
  return p;
}

export interface GhostOpts {
  /** starting alpha (default 0.55) */
  alpha?: number;
  /** depth offset from the source (default -1: behind it) */
  depthOffset?: number;
  /** extra scale growth over the fade (0.1 = +10%) */
  grow?: number;
  /** keep the source colours instead of a flat tint fill */
  keepColors?: boolean;
}

/**
 * Leaves an additive afterimage of `sprite`'s current frame that fades out over `ms`.
 * `tint` fills the silhouette (omit or pass keepColors to keep the sprite's own colours).
 * Pooled and capped (MOVE_FX.trails.ghostCap): at the cap the oldest ghost is recycled.
 */
export function ghostTrail(sprite: Phaser.GameObjects.Sprite, ms: number, tint?: number, opts: GhostOpts = {}): Phaser.GameObjects.Image | null {
  const scene = sprite.scene;
  if (!scene || !sprite.active || ms <= 0) return null;
  const pool = getPools(scene).ghosts;
  const g = pool.acquire();
  g.setTexture(sprite.texture.key, sprite.frame.name)
    .setPosition(sprite.x, sprite.y)
    .setOrigin(sprite.originX, sprite.originY)
    .setFlip(sprite.flipX, sprite.flipY)
    .setScale(sprite.scaleX, sprite.scaleY)
    .setAngle(sprite.angle)
    .setDepth(sprite.depth + (opts.depthOffset ?? -1))
    .setAlpha(opts.alpha ?? 0.55)
    .setBlendMode(Phaser.BlendModes.ADD)
    .setVisible(true)
    .setActive(true);
  if (tint !== undefined && !opts.keepColors) g.setTintFill(tint);
  else if (tint !== undefined) g.setTint(tint);
  else g.clearTint();
  const grow = opts.grow ?? 0;
  scene.tweens.add({
    targets: g,
    alpha: 0,
    scaleX: g.scaleX * (1 + grow),
    scaleY: g.scaleY * (1 + grow),
    duration: ms,
    onComplete: () => {
      g.setVisible(false).setActive(false);
      pool.release(g);
    },
  });
  return g;
}

/**
 * One speed-line streak near (x, y) that rushes `dir` (-1 = up, i.e. falling past it) and fades.
 * Pooled and capped (MOVE_FX.trails.lineCap).
 */
export function speedLine(scene: Phaser.Scene, x: number, y: number, dir: 1 | -1, ms = MOVE_FX.trails.lineMs, tint = 0xffffff, depth = 18): void {
  ensureStreak(scene);
  const pool = getPools(scene).lines;
  const l = pool.acquire();
  const len = 1 + Math.random() * 1.5;
  l.setTexture(STREAK_KEY)
    .setPosition(Math.round(x), Math.round(y))
    .setOrigin(0.5, dir < 0 ? 0 : 1)
    .setFlipY(dir > 0)
    .setScale(1, len)
    .setAngle(0)
    .setDepth(depth)
    .setAlpha(0.7)
    .setTint(tint)
    .setBlendMode(Phaser.BlendModes.ADD)
    .setVisible(true)
    .setActive(true);
  scene.tweens.add({
    targets: l,
    y: l.y + dir * (18 + Math.random() * 14),
    scaleY: len * 1.6,
    alpha: 0,
    duration: ms,
    ease: 'Quad.out',
    onComplete: () => {
      l.setVisible(false).setActive(false);
      pool.release(l);
    },
  });
}
