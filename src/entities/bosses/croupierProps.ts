import type Phaser from 'phaser';
import type { HitInfo, Hurtable, Rect } from '../../combat/types';
import type { Color, Suit, Sym } from '../../combat/croupierPlan';
import { txt } from '../../ui/text';
import { sfx } from '../../systems/sfx';
import type { GameScene } from '../../scenes/GameScene';

/** Reel symbols in 'croupier-reel' frame order. */
export const SYMS: readonly Sym[] = ['cherry', 'bell', 'seven', 'skull'];
/** 'croupier-card' frames. */
export const CARD = { back: 0, spade: 1, club: 2, diamond: 3, heart: 4, high: 5, good: 6, bad: 7 } as const;
export const SUIT_FRAME: Record<Suit, number> = { spade: CARD.spade, club: CARD.club, diamond: CARD.diamond, heart: CARD.heart };
/** Roulette stripe paint / glow colours. */
export const STRIPE_COLOR: Record<Color, number> = { red: 0xc0283c, black: 0x2a1f3a, green: 0x2fa35a };
export const STRIPE_GLOW: Record<Color, number> = { red: 0xff4d5e, black: 0x8b6bd6, green: 0x7dffa0 };
export const COLOR_TEXT: Record<Color, string> = { red: '#ff4d5e', black: '#b9a6ff', green: '#7dffa0' };

/**
 * Something the player can strike that isn't an enemy (spinning reels, High Card cards).
 * Registered with the DamageSystem as an 'enemy'-team hurtable, so player melee boxes (and the player's
 * own projectiles, not reflected ones) hit it; enemy hitboxes skip it. `onStrike` returns false to let
 * the hit pass through ('ignored'), e.g. while another reel was just struck.
 */
export class StrikeTarget implements Hurtable {
  readonly team = 'enemy' as const;
  alive = true;

  constructor(private gs: GameScene, private rect: () => Rect, private onStrike: (hit: HitInfo) => boolean) {
    gs.damage.register(this);
  }

  hurtRect(): Rect {
    return this.rect();
  }

  receiveHit(hit: HitInfo): 'hit' | 'blocked' | 'ignored' {
    if (!this.alive) return 'ignored';
    const ok = hit.kind === 'melee' || (hit.kind === 'projectile' && !hit.parried);
    if (!ok) return 'ignored';
    return this.onStrike(hit) ? 'hit' : 'ignored';
  }

  kill(): void {
    if (!this.alive) return;
    this.alive = false;
    this.gs.damage.unregister(this);
  }
}

/** Big centred result banner (x2 / NOTHING / RED...) that pops in, holds and fades. */
export function banner(gs: GameScene, x: number, y: number, text: string, color: string, holdMs: number): Phaser.GameObjects.GameObject {
  const t = txt(gs, x, y, text, 24, color).setDepth(60);
  const base = t.scaleX;
  t.setScale(base * 1.8);
  gs.tweens.add({ targets: t, scale: base, duration: 160, ease: 'Back.out' });
  gs.tweens.add({ targets: t, alpha: 0, y: y - 10, delay: Math.max(200, holdMs), duration: 260, onComplete: () => t.destroy() });
  return t;
}

/** Card flip: squash to 0 width, swap the frame, open back up. */
export function flipCard(gs: GameScene, s: Phaser.GameObjects.Sprite, frame: number, ms = 120, done?: () => void): void {
  const sx = Math.abs(s.scaleX) || 1;
  gs.tweens.add({
    targets: s,
    scaleX: 0,
    duration: ms / 2,
    onComplete: () => {
      if (!s.active) return;
      s.setFrame(frame);
      gs.tweens.add({ targets: s, scaleX: sx, duration: ms / 2, onComplete: () => done?.() });
    },
  });
}

interface Reel {
  spr: Phaser.GameObjects.Sprite;
  /** index into SYMS currently showing */
  idx: number;
  stopped: boolean;
  target: StrikeTarget;
}

/**
 * Jackpot Reels cabinet: rises at `x` on the floor, then (spinUp) three strikeable reels cycle their symbols
 * every `cycleMs` until stop()ped, by the boss's schedule or by a player hit (Strike the Reels: stops on the
 * symbol showing). `onAllStopped(final)` fires once, when the third reel stops.
 */
export class SlotMachine {
  readonly machine: Phaser.GameObjects.Sprite;
  readonly final: Sym[];
  reels: Reel[] = [];
  resolved = false;
  private nextTick = 0;
  private lastStrike = -1e9;

  constructor(private gs: GameScene, readonly x: number, private floorY: number, planned: readonly Sym[], riseMs: number, private cycleMs: number, private onAllStopped: (final: Sym[]) => void) {
    this.final = [...planned];
    this.machine = gs.add.sprite(x, floorY + 30, 'croupier-slot').setOrigin(0.5, 1).setDepth(14).setAlpha(0.3);
    gs.tweens.add({ targets: this.machine, y: floorY, alpha: 1, duration: riseMs, ease: 'Back.out' });
    gs.juice.dust(x, floorY, 6, 0.6);
  }

  /** Reels appear and start cycling (call once the cabinet has risen). */
  spinUp(): void {
    const fy = this.floorY;
    this.reels = [0, 1, 2].map((i): Reel => {
      const rx = this.x - 20 + i * 16, ry = fy - 28;
      const idx = (i * 2 + Math.floor(Math.random() * 4)) % SYMS.length;
      const spr = this.gs.add.sprite(rx, ry, 'croupier-reel', idx).setDepth(15);
      const target = new StrikeTarget(this.gs, () => ({ x: rx - 7, y: fy - 42, w: 14, h: 30 }), (hit) => this.strike(i, hit.sourceX));
      return { spr, idx, stopped: false, target };
    });
    this.nextTick = this.gs.time.now;
  }

  /** Player hit reel `i`: stop the spinning reel nearest the player (a swing can overlap two windows). */
  private strike(i: number, fromX: number): boolean {
    if (this.resolved) return false;
    const now = this.gs.time.now;
    if (now - this.lastStrike < 150) return false; // one reel per swing
    const free = this.reels.map((r, k) => ({ r, k })).filter(({ r, k }) => !r.stopped && Math.abs(k - i) <= 1);
    if (!free.length) return false;
    free.sort((a, b) => Math.abs(a.r.spr.x - fromX) - Math.abs(b.r.spr.x - fromX));
    const k = free[0].k;
    this.lastStrike = now;
    const r = this.reels[k];
    this.gs.juice.burst(r.spr.x, r.spr.y, 0xffffff, 6, 0.6);
    this.gs.juice.floatText(r.spr.x, r.spr.y - 14, 'STOP!', '#7fdbff');
    this.stop(k, r.idx);
    return true;
  }

  /** Lock reel `i` on SYMS[idx] (no-op if already stopped / not spun up). */
  stop(i: number, idx: number): void {
    const r = this.reels[i];
    if (this.resolved || !r || r.stopped) return;
    r.stopped = true;
    r.idx = idx;
    r.target.kill();
    this.final[i] = SYMS[idx];
    r.spr.setFrame(idx).setScale(1.3);
    this.gs.tweens.add({ targets: r.spr, scale: 1, duration: 140 });
    sfx.reelStop(1 + i * 0.12);
    if (this.reels.every((x) => x.stopped)) {
      this.resolved = true;
      this.onAllStopped([...this.final]);
    }
  }

  /** Cycle the spinning reels (per frame). */
  update(now: number): void {
    if (this.resolved || !this.reels.length || now < this.nextTick) return;
    this.nextTick = now + this.cycleMs;
    let ticked = false;
    for (const r of this.reels) {
      if (r.stopped || !r.spr.active) continue;
      r.idx = (r.idx + 1) % SYMS.length;
      r.spr.setFrame(r.idx);
      ticked = true;
    }
    if (ticked) sfx.reelTick(0.9 + Math.random() * 0.2);
  }

  /** Highlight reel `i` as it pays out (all reels when omitted). */
  flash(i?: number): void {
    for (const [k, r] of this.reels.entries()) {
      if (i !== undefined && k !== i) continue;
      this.gs.juice.ring(r.spr.x, r.spr.y, 0xffd96a, 0.5);
      this.gs.tweens.add({ targets: r.spr, alpha: 0.3, yoyo: true, repeat: i === undefined ? 3 : 0, duration: 80 });
    }
  }

  /** Cabinet sinks back into the floor, then everything is destroyed. */
  sink(): void {
    this.killReels();
    const m = this.machine;
    if (!m.active) return;
    this.gs.tweens.killTweensOf(m);
    this.gs.tweens.add({ targets: m, y: m.y + 30, alpha: 0, duration: 300, onComplete: () => m.destroy() });
  }

  private killReels(): void {
    for (const r of this.reels) {
      r.target.kill();
      if (r.spr.active) {
        this.gs.tweens.killTweensOf(r.spr);
        r.spr.destroy();
      }
    }
    this.reels = [];
    this.resolved = true;
  }

  /** Immediate removal (interrupt / death). `tweens=false` during scene teardown. */
  destroy(tweens = true): void {
    for (const r of this.reels) {
      r.target.kill();
      if (tweens) this.gs.tweens.killTweensOf(r.spr);
      r.spr.destroy();
    }
    this.reels = [];
    this.resolved = true;
    if (tweens) this.gs.tweens.killTweensOf(this.machine);
    this.machine.destroy();
  }
}

/**
 * High Card wager (phase changes): three face-down "2:1" cards fly from (fromX, fromY) to `xs` on the floor.
 * Striking one flips all three; `onPick(good, x, y)` fires once. Unpicked cards vanish `lifeMs` after landing.
 */
export class HighCardOffer {
  private cards: Phaser.GameObjects.Sprite[] = [];
  private targets: StrikeTarget[] = [];
  private picked = false;
  private gone = false;

  constructor(private gs: GameScene, fromX: number, fromY: number, xs: readonly number[], floorY: number, private deck: readonly ('good' | 'bad')[], lifeMs: number, private onPick: (good: boolean, x: number, y: number) => void) {
    sfx.cardFlip();
    const ty = floorY - 11;
    xs.forEach((x, i) => {
      const card = gs.add.sprite(fromX, fromY, 'croupier-card', CARD.high).setDepth(16).setScale(1.6);
      this.cards.push(card);
      gs.tweens.addCounter({
        from: 0,
        to: 1,
        duration: 520 + i * 90,
        onUpdate: (tw) => {
          if (this.gone || !card.active) return;
          const t = tw.getValue() ?? 0;
          card.setPosition(fromX + (x - fromX) * t, fromY + (ty - fromY) * t - 60 * Math.sin(Math.PI * t));
          card.setRotation((1 - t) * 6);
        },
        onComplete: () => {
          if (this.gone || this.picked || !card.active) return;
          card.setRotation(0);
          sfx.cardFlip();
          gs.juice.dust(x, floorY, 3, 0.4);
          gs.tweens.add({ targets: card, y: ty - 2, yoyo: true, repeat: -1, duration: 500, ease: 'Sine.inOut' });
          this.targets.push(new StrikeTarget(gs, () => ({ x: x - 9, y: floorY - 24, w: 18, h: 24 }), () => this.pick(i)));
        },
      });
    });
    gs.time.delayedCall(700 + lifeMs, () => {
      if (!this.gone && !this.picked) this.fadeOut();
    });
  }

  get active(): boolean {
    return !this.gone;
  }

  private pick(i: number): boolean {
    if (this.picked || this.gone) return false;
    this.picked = true;
    for (const t of this.targets) t.kill();
    const card = this.cards[i];
    const { x, y } = card;
    this.cards.forEach((c, k) => {
      this.gs.tweens.killTweensOf(c);
      flipCard(this.gs, c, this.deck[k] === 'good' ? CARD.good : CARD.bad, 140);
      if (k !== i) c.setAlpha(0.5);
    });
    sfx.cardFlip();
    this.gs.time.delayedCall(1100, () => this.fadeOut());
    this.onPick(this.deck[i] === 'good', x, y);
    return true;
  }

  private fadeOut(): void {
    if (this.gone) return;
    for (const t of this.targets) t.kill();
    for (const c of this.cards) if (c.active) this.gs.tweens.add({ targets: c, alpha: 0, duration: 260 });
    this.gs.time.delayedCall(280, () => this.destroy());
  }

  /** Immediate removal. `tweens=false` during scene teardown. */
  destroy(tweens = true): void {
    if (this.gone) return;
    this.gone = true;
    for (const t of this.targets) t.kill();
    for (const c of this.cards) {
      if (tweens && c.active) this.gs.tweens.killTweensOf(c);
      c.destroy();
    }
  }
}
