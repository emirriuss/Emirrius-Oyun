import Phaser from 'phaser';
import { COLORS, TILE } from '../config';

/** World tile palettes: [top, body, bodyDark, oneWay] */
export const WORLD_PALETTES: Record<number, { top: number; body: number; dark: number; oneway: number; bg: number; bg2: number }> = {
  1: { top: 0x6ab04c, body: 0x5c4033, dark: 0x3e2a22, oneway: 0x9c7a54, bg: 0x1d2b3a, bg2: 0x2f4858 },
  2: { top: 0x9aa5b1, body: 0x4a5568, dark: 0x2d3748, oneway: 0x718096, bg: 0x2a1f3d, bg2: 0x44355b },
  3: { top: 0xc0392b, body: 0x3b1f2b, dark: 0x22111a, oneway: 0x8e3b46, bg: 0x1a0a10, bg2: 0x3d1220 },
  4: { top: 0x2f7a8a, body: 0x1a1e3a, dark: 0x0e1024, oneway: 0x46508a, bg: 0x080b1c, bg2: 0x161c40 },
};

type G = Phaser.GameObjects.Graphics;

function make(scene: Phaser.Scene, key: string, w: number, h: number, draw: (g: G) => void): void {
  if (scene.textures.exists(key)) return;
  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  draw(g);
  g.generateTexture(key, w, h);
  g.destroy();
}

/** Simple humanoid-ish block body with an eye, facing right. */
function body(g: G, w: number, h: number, col: number, dark: number, eye = 0xffffff): void {
  g.fillStyle(dark, 1).fillRoundedRect(0, 0, w, h, 3);
  g.fillStyle(col, 1).fillRoundedRect(1, 1, w - 2, h - 3, 3);
  g.fillStyle(eye, 1).fillRect(w - 5, 4, 3, 3);
}

export function generateTextures(scene: Phaser.Scene): void {
  // --- tiles per world: strip of [top, body, oneway, spike, lava, crumble] ---
  for (const [w, p] of Object.entries(WORLD_PALETTES)) {
    make(scene, `tiles${w}`, TILE * 6, TILE, (g) => {
      // 0 top
      g.fillStyle(p.body, 1).fillRect(0, 0, TILE, TILE);
      g.fillStyle(p.dark, 1).fillRect(3, 9, 3, 3).fillRect(10, 12, 2, 2);
      g.fillStyle(p.top, 1).fillRect(0, 0, TILE, 4);
      // 1 body
      g.fillStyle(p.body, 1).fillRect(TILE, 0, TILE, TILE);
      g.fillStyle(p.dark, 1).fillRect(TILE + 4, 4, 3, 3).fillRect(TILE + 11, 10, 2, 2).fillRect(TILE + 2, 12, 2, 2);
      // 2 one-way
      g.fillStyle(p.oneway, 1).fillRect(TILE * 2, 0, TILE, 4);
      g.fillStyle(p.dark, 1).fillRect(TILE * 2 + 2, 4, 2, 4).fillRect(TILE * 2 + 12, 4, 2, 4);
      // 3 spike (visual only)
      g.fillStyle(COLORS.spike, 1);
      for (let i = 0; i < 4; i++) g.fillTriangle(TILE * 3 + i * 4, TILE, TILE * 3 + i * 4 + 2, 6, TILE * 3 + i * 4 + 4, TILE);
      // 4 lava
      g.fillStyle(COLORS.lava, 1).fillRect(TILE * 4, 4, TILE, TILE - 4);
      g.fillStyle(0xffb000, 1).fillRect(TILE * 4, 4, TILE, 2).fillRect(TILE * 4 + 5, 9, 3, 2);
      // 5 crumble
      g.fillStyle(p.oneway, 1).fillRect(TILE * 5, 0, TILE, TILE);
      g.lineStyle(1, p.dark, 1).lineBetween(TILE * 5 + 3, 0, TILE * 5 + 8, 16).lineBetween(TILE * 5 + 12, 0, TILE * 5 + 9, 9);
    });
  }

  // --- player ---
  make(scene, 'player', 12, 20, (g) => {
    body(g, 12, 20, COLORS.player, COLORS.playerDark);
    g.fillStyle(0xffffff, 0.8).fillRect(2, 2, 3, 2); // highlight
    g.fillStyle(COLORS.playerDark, 1).fillRect(0, 11, 12, 2); // belt
  });
  make(scene, 'slash', 32, 24, (g) => {
    g.fillStyle(COLORS.slash, 0.9);
    g.beginPath();
    g.arc(4, 12, 26, -1.1, 1.1, false);
    g.arc(4, 12, 18, 1.0, -1.0, true);
    g.closePath();
    g.fillPath();
  });
  make(scene, 'slashDown', 24, 24, (g) => {
    g.fillStyle(COLORS.slash, 0.9);
    g.fillTriangle(0, 0, 24, 0, 12, 24);
  });
  make(scene, 'energySlash', 20, 14, (g) => {
    g.fillStyle(0x7fdbff, 1).fillEllipse(10, 7, 20, 14);
    g.fillStyle(0xffffff, 1).fillEllipse(12, 7, 10, 6);
  });

  // --- enemies ---
  make(scene, 'slime', 16, 12, (g) => {
    g.fillStyle(0x2e7d32, 1).fillEllipse(8, 8, 16, 10);
    g.fillStyle(0x66bb6a, 1).fillEllipse(8, 7, 14, 8);
    g.fillStyle(0xffffff, 1).fillRect(10, 5, 2, 2);
  });
  make(scene, 'charger', 18, 16, (g) => {
    body(g, 18, 16, 0xe76f51, 0x9d3b22);
    g.fillStyle(0xf4f1de, 1).fillTriangle(18, 6, 23, 8, 18, 10);
  });
  make(scene, 'archer', 12, 20, (g) => body(g, 12, 20, 0x9b5de5, 0x5a2a8f));
  make(scene, 'flyer', 16, 12, (g) => {
    g.fillStyle(0xf15bb5, 1).fillCircle(8, 6, 5);
    g.fillStyle(0x8a1c64, 1).fillTriangle(0, 2, 6, 6, 0, 10).fillTriangle(16, 2, 10, 6, 16, 10);
    g.fillStyle(0xffffff, 1).fillRect(9, 4, 2, 2);
  });
  make(scene, 'knight', 16, 22, (g) => body(g, 16, 22, 0x8d99ae, 0x2b2d42, 0xff3333));
  make(scene, 'shield', 5, 18, (g) => {
    g.fillStyle(0xedf2f4, 1).fillRoundedRect(0, 0, 5, 18, 2);
    g.fillStyle(0xef233c, 1).fillRect(1, 7, 3, 4);
  });
  make(scene, 'bomber', 14, 18, (g) => body(g, 14, 18, 0xffb703, 0xa0522d));
  make(scene, 'arrow', 10, 3, (g) => {
    g.fillStyle(0xe0e0e0, 1).fillRect(0, 1, 8, 1);
    g.fillTriangle(7, 0, 10, 1.5, 7, 3);
  });
  make(scene, 'bomb', 8, 8, (g) => {
    g.fillStyle(0x222222, 1).fillCircle(4, 4, 4);
    g.fillStyle(0xff5400, 1).fillRect(5, 0, 2, 2);
  });
  make(scene, 'orb', 10, 10, (g) => {
    g.fillStyle(0xff006e, 1).fillCircle(5, 5, 5);
    g.fillStyle(0xffffff, 1).fillCircle(4, 4, 2);
  });
  make(scene, 'shockwave', 16, 10, (g) => {
    g.fillStyle(0xffd166, 1).fillTriangle(0, 10, 8, 0, 16, 10);
  });

  // --- bosses ---
  make(scene, 'golem', 40, 44, (g) => {
    g.fillStyle(0x3d405b, 1).fillRoundedRect(0, 0, 40, 44, 5);
    g.fillStyle(0x6c757d, 1).fillRoundedRect(2, 2, 36, 38, 5);
    g.fillStyle(0x495057, 1).fillRect(6, 24, 28, 4);
    g.fillStyle(0xffd166, 1).fillRect(26, 9, 6, 5);
  });
  make(scene, 'duelist', 14, 24, (g) => {
    body(g, 14, 24, 0xf1faee, 0xe63946, 0x1d3557);
    g.fillStyle(0xe63946, 1).fillRect(0, 10, 14, 3).fillRect(0, 0, 3, 24);
  });
  make(scene, 'blade', 4, 16, (g) => {
    g.fillStyle(0xe0fbfc, 1).fillRect(0, 0, 4, 16);
  });
  make(scene, 'king', 30, 40, (g) => {
    g.fillStyle(0x10002b, 1).fillRoundedRect(0, 6, 30, 34, 4);
    g.fillStyle(0x3c096c, 1).fillRoundedRect(2, 8, 26, 28, 4);
    g.fillStyle(0xffd60a, 1).fillTriangle(4, 8, 8, 0, 12, 8).fillTriangle(11, 8, 15, 0, 19, 8).fillTriangle(18, 8, 22, 0, 26, 8);
    g.fillStyle(0xff006e, 1).fillRect(20, 16, 4, 4);
  });

  // --- pickups & props ---
  make(scene, 'shard', 8, 10, (g) => {
    g.fillStyle(COLORS.shard, 1).fillTriangle(4, 0, 8, 5, 4, 10).fillTriangle(4, 0, 0, 5, 4, 10);
    g.fillStyle(0xffffff, 0.8).fillRect(3, 2, 1, 3);
  });
  make(scene, 'heart', 10, 9, (g) => {
    g.fillStyle(COLORS.heart, 1).fillCircle(2.5, 2.5, 2.5).fillCircle(7.5, 2.5, 2.5).fillTriangle(0, 3, 10, 3, 5, 9);
  });
  make(scene, 'checkpoint', 10, 24, (g) => {
    g.fillStyle(0x888888, 1).fillRect(0, 0, 2, 24);
    g.fillStyle(0x666666, 1).fillTriangle(2, 1, 10, 4, 2, 7);
  });
  make(scene, 'checkpointOn', 10, 24, (g) => {
    g.fillStyle(0xcccccc, 1).fillRect(0, 0, 2, 24);
    g.fillStyle(COLORS.checkpoint, 1).fillTriangle(2, 1, 10, 4, 2, 7);
  });
  make(scene, 'exit', 16, 32, (g) => {
    g.fillStyle(0x000000, 0.6).fillRoundedRect(0, 0, 16, 32, 6);
    g.lineStyle(2, COLORS.exit, 1).strokeRoundedRect(1, 1, 14, 30, 6);
    g.fillStyle(0xb8f2e6, 0.5).fillRoundedRect(4, 4, 8, 26, 3);
  });
  make(scene, 'platform', 48, 8, (g) => {
    g.fillStyle(0xa47148, 1).fillRect(0, 0, 48, 8);
    g.fillStyle(0xd4a373, 1).fillRect(0, 0, 48, 3);
  });
  make(scene, 'shrine', 24, 32, (g) => {
    g.fillStyle(0x4a4e69, 1).fillRect(2, 12, 20, 20);
    g.fillStyle(0x9a8c98, 1).fillRect(0, 10, 24, 4);
    g.fillStyle(COLORS.shard, 1).fillTriangle(12, 0, 17, 6, 12, 12).fillTriangle(12, 0, 7, 6, 12, 12);
  });

  // --- fx ---
  make(scene, 'px', 2, 2, (g) => g.fillStyle(0xffffff, 1).fillRect(0, 0, 2, 2));
  make(scene, 'px4', 4, 4, (g) => g.fillStyle(0xffffff, 1).fillRect(0, 0, 4, 4));
  make(scene, 'ring', 32, 32, (g) => g.lineStyle(2, 0xffffff, 1).strokeCircle(16, 16, 14));
  make(scene, 'node', 14, 14, (g) => {
    g.fillStyle(0xffffff, 1).fillCircle(7, 7, 7);
  });
}
