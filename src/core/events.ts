import Phaser from 'phaser';

/**
 * Global event bus between Game scene and UI/HUD.
 * Events:
 *  'hp' (hp, max) | 'stamina' (val, max) | 'shards' (total) | 'boss' (name, hp, max) | 'boss-hide'
 *  'toast' (text) | 'charge' (0..1) | 'stamina-fail' | 'time' (ms) | 'level' (name) | 'sign' (text|null)
 *  'boss-intro' (name) — emitted once by the boss intro cinematic when the camera reaches the boss; UI shows a name card
 *  'letterbox' (on) — cinematic bars in/out (core/cinematics.ts)
 *  ERRATUM (w4-6) HUD tricks: 'hud-bar' (home) boss bar pulled off / handed back | 'hud-note' (text, x, y, ms, underline)
 *    handwritten margin note in screen space | 'hud-dissolve' (on) whole HUD fades (notes stay) | 'hud-glitch' (ms) HUD jitter
 */
export const bus = new Phaser.Events.EventEmitter();
