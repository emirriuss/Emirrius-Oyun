import Phaser from 'phaser';
import { GAME_W, GAME_H } from '../config';
import { C } from '../art/palette';

/**
 * Pixel wipe transitions. A tiny overlay scene ('Transition') is registered on first use
 * and kept on top of everything. It covers the screen with a diagonal sweep of growing
 * pixel blocks, runs the scene switch while covered, then uncovers.
 *
 *   transitionTo(this, 'WorldMap', { focus: 'w1-2' });
 *   transition(this, () => { this.scene.stop('Game'); this.scene.start('WorldMap'); });
 */

const KEY = 'Transition';
const CELL = 16;
const COVER_MS = 260;
const REVEAL_MS = 300;
/** accent colour on the moving edge of a wipe / iris */
const EDGE = C.violet;

let busy = false;
let busySince = 0;

/** True while a transition is running (use to ignore input). */
export function transitioning(): boolean {
  return busy;
}

class TransitionScene extends Phaser.Scene {
  private g!: Phaser.GameObjects.Graphics;
  private p = 0; // 0 = clear, 1 = covered
  private dir = 0; // +1 covering, -1 revealing
  private ms = COVER_MS;
  private onCovered?: () => void;
  private style: 'wipe' | 'iris' = 'wipe';
  private originX = GAME_W / 2;
  private originY = GAME_H / 2;

  constructor() {
    super({ key: KEY, active: false });
  }

  create(): void {
    this.g = this.add.graphics();
  }

  run(style: 'wipe' | 'iris', onCovered: () => void, ox?: number, oy?: number): void {
    this.style = style;
    this.onCovered = onCovered;
    this.originX = ox ?? GAME_W / 2;
    this.originY = oy ?? GAME_H / 2;
    this.p = 0;
    this.dir = 1;
    this.ms = COVER_MS;
  }

  update(_t: number, dt: number): void {
    // stay above scenes launched while we run (e.g. Game launches UI and brings it to top)
    const mgr = this.scene.manager;
    if (mgr.getIndex(KEY) !== mgr.scenes.length - 1) this.scene.bringToTop();
    if (this.dir === 0) return;
    this.p = Phaser.Math.Clamp(this.p + (this.dir * Math.min(dt, 34)) / this.ms, 0, 1);
    this.draw();
    if (this.dir > 0 && this.p >= 1) {
      this.dir = 0;
      const fn = this.onCovered;
      this.onCovered = undefined;
      try {
        fn?.();
      } finally {
        // give the new scene a frame to build before uncovering
        this.time.delayedCall(60, () => {
          this.dir = -1;
          this.ms = REVEAL_MS;
        });
      }
    } else if (this.dir < 0 && this.p <= 0) {
      this.dir = 0;
      this.g.clear();
      busy = false;
      this.scene.sleep();
    }
  }

  private draw(): void {
    const g = this.g.clear();
    g.fillStyle(C.ink, 1);
    const cols = Math.ceil(GAME_W / CELL);
    const rows = Math.ceil(GAME_H / CELL);
    const covering = this.dir >= 0;
    if (this.style === 'iris') {
      // blocky iris closing on (originX, originY)
      const maxR = Math.hypot(Math.max(this.originX, GAME_W - this.originX), Math.max(this.originY, GAME_H - this.originY)) + CELL;
      const r = (1 - this.p) * maxR;
      const cell = 8;
      for (let y = 0; y < GAME_H; y += cell)
        for (let x = 0; x < GAME_W; x += cell) {
          const d = Math.hypot(x + cell / 2 - this.originX, y + cell / 2 - this.originY);
          if (d > r + cell) g.fillRect(x, y, cell, cell);
          else if (d > r && r > 0) {
            // one-cell accent rim on the closing edge
            g.fillStyle(EDGE, 1).fillRect(x, y, cell, cell).fillStyle(C.ink, 1);
          }
        }
      return;
    }
    // diagonal sweep: cells further along the diagonal start later; each grows from its centre
    const spread = 0.55;
    for (let cy = 0; cy < rows; cy++)
      for (let cx = 0; cx < cols; cx++) {
        let d = (cx + cy) / (cols + rows - 2);
        if (!covering) d = 1 - d; // reveal continues the sweep in the same direction
        const local = Phaser.Math.Clamp(this.p * (1 + spread) - d * spread, 0, 1);
        const s = Math.round(Math.min(1, local * 1.6) * CELL);
        if (s <= 0) continue;
        const o = Math.floor((CELL - s) / 2);
        g.fillRect(cx * CELL + o, cy * CELL + o, s, s);
        // leading edge: a 2px accent core on cells still growing, so the sweep reads as a lit front
        if (s < CELL && s >= 6) {
          g.fillStyle(EDGE, 1).fillRect(cx * CELL + CELL / 2 - 1, cy * CELL + CELL / 2 - 1, 2, 2).fillStyle(C.ink, 1);
        }
      }
  }
}

/**
 * Registers the overlay scene. Called once at boot (from registerUiArt); adding a scene
 * while the manager is mid-update is deferred by Phaser, so it must exist before first use.
 */
export function installTransitions(game: Phaser.Game): void {
  if (game.scene.getScene(KEY) || installed.has(game)) return;
  installed.add(game);
  game.scene.add(KEY, TransitionScene, false);
}
const installed = new WeakSet<Phaser.Game>();

function overlay(game: Phaser.Game): TransitionScene | null {
  const s = game.scene.getScene(KEY) as TransitionScene | null;
  if (!s) installTransitions(game);
  return s;
}

/**
 * Cover the screen, call `fn` (do the scene switch there), then reveal.
 * Ignored while another transition is running. Returns false if ignored.
 */
export function transition(from: Phaser.Scene, fn: () => void, opts: { style?: 'wipe' | 'iris'; x?: number; y?: number } = {}): boolean {
  // a transition never takes this long; recover if one was interrupted (e.g. game blurred)
  if (busy && performance.now() - busySince < 2500) return false;
  busy = true;
  busySince = performance.now();
  const game = from.game;
  const sc = overlay(game);
  if (!sc) {
    // overlay not ready yet: switch instantly rather than block the game
    busy = false;
    fn();
    return true;
  }
  const go = () => sc.run(opts.style ?? 'wipe', fn, opts.x, opts.y);
  const sys = game.scene;
  if (sys.isSleeping(KEY)) {
    sys.wake(KEY);
    sys.bringToTop(KEY);
    go();
  } else if (sys.isActive(KEY)) {
    sys.bringToTop(KEY);
    go();
  } else {
    sc.events.once('create', go);
    sys.run(KEY);
    sys.bringToTop(KEY);
  }
  return true;
}

/** Pixel-wipe to another scene (stops `from`, like scene.start). */
export function transitionTo(from: Phaser.Scene, key: string, data?: object, opts: { style?: 'wipe' | 'iris'; x?: number; y?: number } = {}): boolean {
  return transition(
    from,
    () => {
      from.scene.start(key, data);
    },
    opts,
  );
}
