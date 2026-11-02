import Phaser from 'phaser';
import { Boss } from './Boss';
import { Hitbox } from '../../combat/Hitbox';
import { UNPARRYABLE_TINT } from '../Enemy';
import type { Projectile } from '../Projectile';
import { sfx } from '../../systems/sfx';
import { TILE } from '../../config';
import type { GameScene } from '../../scenes/GameScene';
import {
  croupierWeights, pickMove, diceCount, flipCoin, rollDice, nextLuckDice, dealCards, nextLuckDeal,
  spinRoulette, nextLuckRoulette, spinReels, reelPayout, stripeLayout, highCardDeck, newLuck, WINDUP_FLOOR,
  type CroupierMove as Move, type LuckState, type Coin, type Color, type Sym, type Suit,
} from '../../combat/croupierPlan';
import { SlotMachine, HighCardOffer, SYMS, CARD, SUIT_FRAME, STRIPE_COLOR, STRIPE_GLOW, COLOR_TEXT, banner, flipCard } from './croupierProps';

/** Timings (ms) per phase index 0..2. Every "hold" is clamped up to WINDUP_FLOOR (reveal -> damage). */
const T = {
  /** coin: spin in the air before it lands; hold on the revealed face; gap between volley coins */
  coinSpin: 650,
  coinHold: [550, 500, 450],
  coinGap: 260,
  coinSpeed: [190, 215, 240],
  /** dice: tumble across the floor; hold on the pips; pellets */
  diceRoll: 650,
  diceHold: [600, 520, 450],
  pelletSpeed: [120, 135, 150],
  diceDouble: [1100, 950, 850],
  emberMs: 1500,
  /** deal: cards fly out, flip one at a time */
  dealOut: 280,
  dealFlip: 250,
  spadeSpeed: [260, 290, 320],
  /** roulette: ball spin, winning colour glow, eruption length, recover */
  rouletteSpin: 1400,
  rouletteGlow: 600,
  eruptMs: 240,
  rouletteRecover: [1100, 1000, 900],
  /** reels: rise, spin before the first stop, gap between stops (L -> R), cycle speed */
  slotRise: 350,
  reelSpin: 900,
  reelGap: 400,
  reelCycle: [120, 105, 90],
  payGap: 380,
  reelsRecover: [850, 750, 650],
  jackpotRecover: 1600,
  bust: 2400,
  hasteMs: 2000,
  /** double or nothing: banner hold before the doubled attack; tails = long recover */
  doubleHold: 600,
  doubleFizzle: 1900,
  encoreGap: 350,
  /** High Card offer lifetime once the cards have landed */
  highCardMs: 5000,
  /** cooldown after a light move / a recover window */
  after: [650, 520, 420],
} as const;

const GOLD = 0xffd96a;

interface WheelState {
  wheel: Phaser.GameObjects.Sprite;
  ball: Phaser.GameObjects.Sprite;
  start: number;
  turns: number;
}

/**
 * World 4-2: THE GILDED CROUPIER. Ground-based luck boss: every roll is shown (coin face, dice pips,
 * card suits, roulette colour, reel symbols) and held for at least WINDUP_FLOOR before it can hurt.
 *  P1 Table Stakes: Coin Flip (volley from the wall the coin names) / Dice Toss (pip-count pellet fans,
 *     a double = bigger burst + recover) / Deal (3 cards flip: spade shot, club lob, diamond split, heart = heart pickup).
 *  P2 Raise: + Roulette Floor (winning colour's stripes erupt; red telegraph, can't parry)
 *     / Jackpot Reels (cherry bomb, bell shockwaves, seven coin rain, skull haste; triples = big version).
 *  P3 All In: Loaded Dice (3 dice, a 6 leaves an ember), Double or Nothing (x2 = next move runs twice,
 *     NOTHING = long recover), House Edge (a green stripe: if green wins, standing on it heals).
 *  Player wagers: strike a spinning reel to stop it on the showing symbol (3 skulls = the House busts),
 *     High Card at each phase change (3 face-down 2:1 cards; strike one).
 * All random outcomes come from src/combat/croupierPlan.ts (pity rules in `luck`).
 */
export class Croupier extends Boss {
  private history: Move[] = [];
  private luck: LuckState = newLuck();
  /** bumped on phase change / death: pending steps of the interrupted attack are dropped */
  private seq = 0;
  /** Double or Nothing: extra runs of the current move left */
  private encore = 0;
  private lastMove: Move = 'coin';
  private hasteUntil = 0;
  private nextHasteFx = 0;
  /** short-lived visuals of the current attack (removed on interrupt) */
  private temp: Phaser.GameObjects.GameObject[] = [];
  private boxes: Hitbox[] = [];
  private counters: Phaser.Tweens.Tween[] = [];
  private slot: SlotMachine | null = null;
  private spin: WheelState | null = null;
  private offer: HighCardOffer | null = null;

  constructor(gs: GameScene, x: number, y: number) {
    super(gs, x, y, 'croupier', 'THE GILDED CROUPIER', { hp: 140, bodyW: 26, bodyH: 40, contactDamage: 0, shards: 80 });
    this.thresholds = [0.66, 0.33];
    this.deathTint = GOLD;
    this.hearts = { periodicMs: 26000, maxOnField: 1, perParries: 4, onPhase: 1 };
    this.once(Phaser.GameObjects.Events.DESTROY, () => this.cleanupFx());
  }

  private get sheetKey(): string {
    return this.phase <= 1 ? 'croupier' : `croupier-p${Math.min(3, this.phase)}`;
  }

  private get ph(): number {
    return Math.min(3, this.phase) - 1;
  }

  /** Reveal -> damage floor for this phase. */
  private get floor(): number {
    return WINDUP_FLOOR[this.ph];
  }

  private hold(ms: number): number {
    return Math.max(this.floor, ms);
  }

  protected animKey(): string {
    const s = this.sheetKey;
    if (this.stunned) return s + '-stun';
    const pose = this.curPose;
    if (pose) return s + '-' + pose;
    if (!this.onGround) return s + '-air';
    return Math.abs(this.body.velocity.x) > 5 ? s + '-walk' : s + '-idle';
  }

  // ------------------------------------------------------------------ sequencing helpers
  /** Delayed step of the current attack; dropped if a phase change / death interrupted it. */
  private step(ms: number, fn: () => void): void {
    const s = this.seq;
    this.later(ms, () => {
      if (s === this.seq && !this.transforming) fn();
    });
  }

  /** End a light attack (no punish window): free to act after `cd`. */
  private finish(cd: number, delay = 0): void {
    this.step(delay, () => {
      this.busy = false;
      this.cooldown = cd;
    });
  }

  private punish(ms: number, pose = 'dizzy'): void {
    this.encore = 0;
    this.body.setVelocityX(0);
    this.recover(ms, pose, T.after[this.ph]);
  }

  /** Light move ended: run it again if Double or Nothing paid out, else finish. */
  private done(delay = 0): void {
    if (this.encore > 0) return this.again(delay);
    this.finish(T.after[this.ph], delay);
  }

  /** Heavy move ended: run it again if Double or Nothing paid out, else the punish window. */
  private heavy(ms: number, pose = 'dizzy'): void {
    if (this.encore > 0) return this.again(0);
    this.punish(ms, pose);
  }

  private again(delay: number): void {
    this.encore--;
    this.step(delay + T.encoreGap, () => this.run(this.lastMove));
  }

  private begin(m: Move): void {
    this.busy = true;
    this.history.push(m);
    if (this.history.length > 4) this.history.shift();
    if (m !== 'double') this.lastMove = m;
    this.facePlayer();
    this.body.setVelocityX(0);
  }

  /** Track a warning / prop visual of the current attack. */
  private keep<O extends Phaser.GameObjects.GameObject>(o: O): O {
    this.temp = this.temp.filter((t) => t.active);
    this.temp.push(o);
    return o;
  }

  private drop(o: Phaser.GameObjects.GameObject | null | undefined): void {
    if (!o || !o.active) return;
    this.gs.tweens.killTweensOf(o);
    o.destroy();
  }

  /** 0..1 counter tween (tracked so an interrupt can stop it). */
  private tween01(ms: number, ease: string, update: (t: number) => void, done?: () => void): void {
    const tw = this.gs.tweens.addCounter({
      from: 0,
      to: 1,
      duration: ms,
      ease,
      onUpdate: (t) => update(t.getValue() ?? 0),
      onComplete: () => {
        this.counters = this.counters.filter((c) => c !== tw);
        done?.();
      },
    });
    this.counters.push(tw);
  }

  private hurtBox(rect: { x: number; y: number; w: number; h: number }, ms: number, damage = 1): void {
    const box = new Hitbox(
      'enemy',
      () => rect,
      (t) => {
        const r = t.hurtRect();
        return { damage, kbX: (r.x + r.w / 2 >= rect.x + rect.w / 2 ? 1 : -1) * 160, kbY: -220, sourceX: rect.x + rect.w / 2, parryable: false, kind: 'hazard' };
      },
      ms,
    ).ownedBy(this);
    this.boxes = this.boxes.filter((b) => !b.dead);
    this.boxes.push(this.gs.damage.add(box));
  }

  private get arenaL(): number {
    return TILE;
  }
  private get arenaR(): number {
    return this.gs.worldWidth - TILE;
  }
  private get floorY(): number {
    return this.body.bottom;
  }

  private shot(x: number, y: number, tex: string, vx: number, vy: number, opts: { gravity?: number; lifeMs?: number; explode?: boolean; rotate?: boolean; bounces?: number } = {}): Projectile {
    return this.gs.spawnProjectile(x, y, tex, vx, vy, 'enemy', { damage: 1, lifeMs: 3000, ...opts, owner: this });
  }

  private aimShot(x: number, y: number, tex: string, speed: number, spread = 0, opts: { lifeMs?: number; rotate?: boolean } = {}): Projectile {
    const a = Math.atan2(this.player.y - y, this.player.x - x) + spread;
    return this.shot(x, y, tex, Math.cos(a) * speed, Math.sin(a) * speed, opts);
  }

  // ------------------------------------------------------------------ AI
  protected think(dt: number): void {
    if (this.busy) return;
    const haste = this.gs.time.now < this.hasteUntil;
    this.cooldown -= dt * (haste ? 1.8 : 1);
    this.facePlayer();
    const dx = Math.abs(this.dxToPlayer());
    const speed = [45, 55, 65][this.ph] * (haste ? 1.7 : 1);
    // keeps mid-range: walks in when far, edges back when crowded (not into a wall)
    let vx = 0;
    if (dx > 150) vx = this.facing * speed;
    else if (dx < 64) {
      const back = -this.facing;
      const room = back < 0 ? this.body.left - this.arenaL : this.arenaR - this.body.right;
      if (room > 24) vx = back * speed * 0.7;
    }
    this.body.setVelocityX(vx);
    if (this.cooldown > 0 || !this.player.alive) return;
    const m = this.choose(dx, false);
    if (!m) {
      this.cooldown = 250;
      return;
    }
    this.run(m);
  }

  private playerHigh(): boolean {
    return this.player.y < this.y - 2.5 * TILE;
  }

  private choose(dx: number, noDouble: boolean): Move | null {
    let w = croupierWeights(this.phase, dx, this.playerHigh());
    if (noDouble) w = w.filter(([m]) => m !== 'double');
    return pickMove(w, this.history);
  }

  private run(m: Move): void {
    switch (m) {
      case 'coin': this.coinFlip(); break;
      case 'dice': this.diceToss(); break;
      case 'deal': this.deal(); break;
      case 'roulette': this.roulette(); break;
      case 'reels': this.reels(); break;
      case 'double': this.doubleOrNothing(); break;
    }
  }

  // ------------------------------------------------------------------ shared: the coin toss
  /** Flips the big coin over his head; `onLand(face, coin)` runs the moment the face is shown. */
  private tossCoin(face: Coin, onLand: (coin: Phaser.GameObjects.Sprite) => void): void {
    this.setPose('flip', T.coinSpin + 200);
    const cx = this.x + this.facing * 6, top = this.y - 70, rest = this.y - 44;
    const coin = this.keep(this.gs.add.sprite(cx, this.y - 16, 'croupier-coin').setDepth(17).setScale(2));
    coin.play('croupier-coin-spin');
    sfx.coinPing(0.8);
    this.tween01(T.coinSpin, 'Linear', (t) => {
      // up to `top` then settle at `rest`
      const y = t < 0.55 ? Phaser.Math.Linear(this.y - 16, top, Phaser.Math.Easing.Quadratic.Out(t / 0.55)) : Phaser.Math.Linear(top, rest, Phaser.Math.Easing.Quadratic.In((t - 0.55) / 0.45));
      coin.setPosition(cx, y);
    });
    this.step(T.coinSpin, () => {
      coin.stop();
      coin.setFrame(face === 'heads' ? 6 : 7);
      sfx.coinPing(face === 'heads' ? 1.2 : 0.9);
      this.gs.juice.ring(coin.x, coin.y, GOLD, 0.8);
      this.gs.juice.floatText(coin.x, coin.y - 16, face === 'heads' ? 'HEADS' : 'TAILS', '#ffd96a');
      onLand(coin);
    });
  }

  // ------------------------------------------------------------------ Coin Flip
  /** Heads: a 3-coin volley from the left wall. Tails: from the right wall. Parryable. */
  private coinFlip(): void {
    this.begin('coin');
    const face = flipCoin(Math.random);
    this.tossCoin(face, (coin) => {
      const hold = this.hold(T.coinHold[this.ph]);
      const left = face === 'heads';
      const wx = left ? this.arenaL + 6 : this.arenaR - 6;
      const fy = this.floorY;
      // the wall the coins come from glows for the whole hold
      const glow = this.keep(this.gs.add.rectangle(left ? this.arenaL + 2 : this.arenaR - 2, fy - 40, 4, 80, GOLD, 0.6).setDepth(14));
      this.gs.tweens.add({ targets: glow, alpha: 0.15, yoyo: true, repeat: -1, duration: 90 });
      this.telegraph(hold, GOLD);
      this.setPose('windup', hold);
      this.step(hold, () => {
        this.drop(glow);
        this.drop(coin);
        const ys = [fy - 12, fy - 40, fy - 22];
        ys.forEach((y, i) =>
          this.step(i * T.coinGap, () => {
            sfx.coinPing(1 + i * 0.1);
            this.aimShot(wx, y, 'croupier-coinshot', T.coinSpeed[this.ph], 0, { lifeMs: 3500 });
          }),
        );
        this.done(2 * T.coinGap + 200);
      });
    });
  }

  // ------------------------------------------------------------------ Dice Toss / Loaded Dice (P3)
  /** 2 dice (3 in P3) tumble out and settle; each bursts into its pip count of pellets. Doubles: bigger + recover. */
  private diceToss(): void {
    this.begin('dice');
    const n = diceCount(this.phase);
    const dice = rollDice(n, Math.random, this.luck);
    this.luck = nextLuckDice(this.luck, dice);
    this.setPose('toss', 500);
    sfx.diceClack();
    const fy = this.floorY;
    const dir = this.facing;
    const sx = this.x + dir * 14, sy = this.y - 8;
    const sprites = dice.map((_, i) => {
      const tx = Phaser.Math.Clamp(this.x + dir * (52 + i * 50) + Phaser.Math.Between(-6, 6), this.arenaL + 12, this.arenaR - 12);
      const s = this.keep(this.gs.add.sprite(sx, sy, 'croupier-die', 6).setDepth(17).setScale(1.5));
      s.play('croupier-die-tumble');
      const rest = fy - 9;
      this.tween01(T.diceRoll + i * 60, 'Linear', (t) => {
        // two bounces: a big arc then a small hop
        const x = Phaser.Math.Linear(sx, tx, Phaser.Math.Easing.Quadratic.Out(t));
        let y: number;
        if (t < 0.6) {
          const u = t / 0.6;
          y = Phaser.Math.Linear(sy, rest, u) - 30 * Math.sin(Math.PI * u);
        } else y = rest - 10 * Math.sin(Math.PI * ((t - 0.6) / 0.4));
        s.setPosition(x, y);
      });
      return s;
    });
    const settle = T.diceRoll + (n - 1) * 60;
    this.step(settle, () => {
      sfx.diceClack();
      sprites.forEach((s, i) => {
        s.stop();
        s.setFrame(dice[i] - 1);
        this.gs.juice.burst(s.x, fy - 2, 0xd8d0c4, 4, 0.5);
      });
      const double = dice.some((d, i) => dice.indexOf(d) !== i);
      const total = dice.reduce((a, b) => a + b, 0);
      this.gs.juice.floatText(this.x, this.y - 36, double ? `DOUBLE ${total}!` : String(total), double ? '#ffd166' : '#ffffff');
      const hold = this.hold(T.diceHold[this.ph]);
      this.telegraph(hold, GOLD);
      this.setPose('windup', hold);
      this.step(hold, () => {
        sprites.forEach((s, i) => {
          this.pelletFan(s.x, fy - 9, dice[i], double);
          if (this.phase >= 3 && dice[i] === 6) {
            const e = this.shot(s.x, fy - 5, 'croupier-ember', 0, 0, { lifeMs: T.emberMs });
            e.body.setAllowGravity(false);
          }
          this.gs.juice.burst(s.x, s.y, 0xffffff, 8, 0.8);
          this.drop(s);
        });
        this.gs.juice.shake(0.005, 120);
        if (double) this.heavy(T.diceDouble[this.ph]);
        else this.done(300);
      });
    });
  }

  /** `pips` pellets in an even upward fan (a double adds 2 and speeds them up). */
  private pelletFan(x: number, y: number, pips: number, big: boolean): void {
    const n = pips + (big ? 2 : 0);
    const sp = T.pelletSpeed[this.ph] * (big ? 1.15 : 1);
    for (let k = 0; k < n; k++) {
      const deg = n === 1 ? -90 : -160 + (140 * k) / (n - 1);
      const a = Phaser.Math.DegToRad(deg);
      this.shot(x, y, 'croupier-pellet', Math.cos(a) * sp, Math.sin(a) * sp, { lifeMs: 2000 });
    }
  }

  // ------------------------------------------------------------------ Deal
  /** Three face-down cards fly out, then flip ~250ms apart; each acts on its suit after the floor. */
  private deal(): void {
    this.begin('deal');
    const suits = dealCards(Math.random, this.luck);
    this.luck = nextLuckDeal(this.luck, suits);
    const dir = this.facing;
    const total = T.dealOut + 2 * T.dealFlip + 120 + this.floor;
    this.setPose('deal', total);
    this.telegraph(total, GOLD);
    const hx = this.x + dir * 14, hy = this.y - 10;
    suits.forEach((suit, i) => {
      const tx = this.x + dir * (30 + i * 24), ty = this.y - 34 - (i === 1 ? 8 : 0);
      const card = this.keep(this.gs.add.sprite(hx, hy, 'croupier-card', CARD.back).setDepth(17).setScale(1.5));
      this.gs.tweens.add({ targets: card, x: tx, y: ty, duration: T.dealOut, ease: 'Quad.out' });
      sfx.cardFlip();
      const flipAt = T.dealOut + i * T.dealFlip;
      this.step(flipAt, () => {
        sfx.cardFlip();
        flipCard(this.gs, card, SUIT_FRAME[suit]);
      });
      // revealed at flipAt + 120 (flip done); acts a full floor later
      this.step(flipAt + 120 + this.floor, () => this.playCard(card, suit));
    });
    this.done(T.dealOut + 2 * T.dealFlip + 120 + this.floor + 250);
  }

  private playCard(card: Phaser.GameObjects.Sprite, suit: Suit): void {
    const { x, y } = card;
    this.drop(card);
    switch (suit) {
      case 'spade':
        sfx.shoot();
        this.aimShot(x, y, 'croupier-card-shot', T.spadeSpeed[this.ph], 0, { rotate: true });
        break;
      case 'club': {
        // lobbed arc that lands on the player's spot
        const g = 700, vy = -220;
        const dy = this.player.y - y;
        const t = (-vy + Math.sqrt(Math.max(0, vy * vy + 2 * g * dy))) / g;
        const vx = Phaser.Math.Clamp((this.player.x - x) / Math.max(0.3, t), -220, 220);
        this.shot(x, y, 'croupier-card-shot', vx, vy, { gravity: g, rotate: true });
        break;
      }
      case 'diamond':
        for (const s of [-0.22, 0.22]) this.aimShot(x, y, 'croupier-card-shot', T.spadeSpeed[this.ph] * 0.75, s, { rotate: true });
        this.gs.juice.burst(x, y, 0xff4d5e, 6, 0.6);
        break;
      case 'heart':
        this.gs.spawnHeart(x, y, 'pop');
        this.gs.juice.floatText(x, y - 10, 'LUCKY!', '#ff8fb8');
        sfx.pickup(1.2);
        break;
    }
  }

  // ------------------------------------------------------------------ Roulette Floor / House Edge (P2+)
  /**
   * The floor is painted red/black (+1 green in P3); a ball slows on a wheel behind him. The winning colour
   * glows, then all its stripes erupt (red telegraph: dodge, don't parry). Green wins: its stripe heals instead.
   */
  private roulette(): void {
    this.begin('roulette');
    const colors: Color[] = this.phase >= 3 ? ['red', 'black', 'green'] : ['red', 'black'];
    const stripes = stripeLayout(this.arenaL, this.arenaR, colors);
    const win = spinRoulette(colors, Math.random, this.luck);
    this.luck = nextLuckRoulette(this.luck, win);
    const fy = this.floorY;
    const glow = this.hold(T.rouletteGlow);
    const total = T.rouletteSpin + glow;
    this.telegraph(total, UNPARRYABLE_TINT, true);
    this.setPose('windup', total + 100);
    // painted stripes
    const paint = this.keep(this.gs.add.graphics().setDepth(14).setAlpha(0));
    for (const s of stripes) {
      paint.fillStyle(STRIPE_COLOR[s.color], 0.85);
      paint.fillRect(s.x0, fy - 2, s.x1 - s.x0, 4);
      paint.fillStyle(0xffd96a, 0.7);
      paint.fillRect(s.x0, fy - 2, 1, 4);
    }
    this.gs.tweens.add({ targets: paint, alpha: 1, duration: 250 });
    // wheel + ball behind him
    const wx = this.x, wy = this.y - 52;
    const wheel = this.keep(this.gs.add.sprite(wx, wy, 'croupier-wheel').setDepth(14).setAlpha(0));
    const ball = this.keep(this.gs.add.sprite(wx, wy - 15, 'croupier-ball').setDepth(14));
    this.gs.tweens.add({ targets: wheel, alpha: 1, duration: 200 });
    this.spin = { wheel, ball, start: this.gs.time.now, turns: 3 + Math.random() };
    sfx.rouletteRoll(T.rouletteSpin);
    this.step(T.rouletteSpin, () => {
      this.spin = null;
      this.gs.juice.ring(wx, wy, STRIPE_GLOW[win], 1.3);
      this.gs.juice.floatText(wx, wy - 26, win.toUpperCase(), COLOR_TEXT[win]);
      // winning stripes glow (columns over each)
      const cols = this.keep(this.gs.add.graphics().setDepth(14));
      for (const s of stripes) {
        if (s.color !== win) continue;
        cols.fillStyle(STRIPE_GLOW[win], 0.28);
        cols.fillRect(s.x0 + 1, fy - 30, s.x1 - s.x0 - 2, 30);
        cols.fillStyle(STRIPE_GLOW[win], 0.9);
        cols.fillRect(s.x0, fy - 3, s.x1 - s.x0, 3);
      }
      this.gs.tweens.add({ targets: cols, alpha: 0.35, yoyo: true, repeat: -1, duration: 90 });
      this.step(glow, () => {
        this.drop(cols);
        this.drop(wheel);
        this.drop(ball);
        const hit = stripes.filter((s) => s.color === win);
        if (win === 'green') this.houseEdge(hit[0], fy);
        else {
          sfx.explode();
          this.gs.juice.shake(0.01, 260);
          for (const s of hit) {
            this.hurtBox({ x: s.x0 + 2, y: fy - 26, w: s.x1 - s.x0 - 4, h: 26 }, T.eruptMs);
            const pillar = this.keep(this.gs.add.rectangle((s.x0 + s.x1) / 2, fy - 16, s.x1 - s.x0 - 4, 32, STRIPE_GLOW[win], 0.85).setDepth(16));
            this.gs.tweens.add({ targets: pillar, alpha: 0, scaleY: 1.4, duration: T.eruptMs + 120, onComplete: () => pillar.destroy() });
            for (let k = 0; k < 3; k++) this.gs.juice.burst(s.x0 + ((k + 0.5) * (s.x1 - s.x0)) / 3, fy - 4, STRIPE_GLOW[win], 5, 1.1);
          }
        }
        this.gs.tweens.add({ targets: paint, alpha: 0, delay: 200, duration: 300, onComplete: () => paint.destroy() });
        this.heavy(T.rouletteRecover[this.ph] + (win === 'green' ? 400 : 0));
      });
    });
  }

  /** Green won: the green stripe erupts as a healing fountain; a player standing on it heals 1. */
  private houseEdge(s: { x0: number; x1: number } | undefined, fy: number): void {
    if (!s) return;
    sfx.heal();
    const f = this.keep(this.gs.add.rectangle((s.x0 + s.x1) / 2, fy - 20, s.x1 - s.x0 - 4, 40, STRIPE_GLOW.green, 0.7).setDepth(16));
    this.gs.tweens.add({ targets: f, alpha: 0, scaleY: 1.5, duration: 500, onComplete: () => f.destroy() });
    this.gs.juice.burst((s.x0 + s.x1) / 2, fy - 4, STRIPE_GLOW.green, 14, 1.1);
    const p = this.player;
    const onIt = p.alive && p.x >= s.x0 && p.x <= s.x1 && p.body.bottom >= fy - 6;
    if (onIt) {
      p.heal(1);
      this.gs.juice.floatText(p.x, p.y - 20, 'HOUSE EDGE +1', '#7dffa0');
    } else this.gs.juice.floatText((s.x0 + s.x1) / 2, fy - 30, 'HOUSE EDGE', '#7dffa0');
  }

  // ------------------------------------------------------------------ Jackpot Reels (P2+) + Strike the Reels
  /**
   * A slot rises in front of him; reels stop L -> R ~400ms apart (strike a spinning reel to stop it on the
   * symbol showing). After the last reveal + floor, each symbol pays out; triples pay one big version.
   */
  private reels(): void {
    this.begin('reels');
    this.setPose('lever', 600);
    sfx.reelStop(0.6);
    const sx = Phaser.Math.Clamp(this.x + this.facing * 56, this.arenaL + 34, this.arenaR - 34);
    const final = spinReels(Math.random);
    this.slot?.destroy(); // never orphan a cabinet
    const slot = new SlotMachine(this.gs, sx, this.floorY, final, T.slotRise, T.reelCycle[this.ph], (syms) => this.resolveReels(slot, syms));
    this.slot = slot;
    this.telegraph(T.reelSpin + 2 * T.reelGap + T.slotRise, GOLD);
    this.step(T.slotRise, () => {
      sfx.reelTick();
      slot.spinUp();
      for (let i = 0; i < 3; i++) this.step(T.reelSpin + i * T.reelGap, () => slot.stop(i, SYMS.indexOf(final[i])));
    });
  }

  /** All three symbols are showing: hold the floor, then pay out (triples: big version; 3 skulls: the House busts). */
  private resolveReels(slot: SlotMachine, syms: Sym[]): void {
    if (this.slot !== slot) return;
    const pay = reelPayout(syms);
    const hold = this.floor + 100;
    this.telegraph(hold, GOLD);
    this.setPose('windup', hold);
    if (pay.triple === 'skull') {
      sfx.jackpot();
      slot.flash();
      this.keep(banner(this.gs, this.x, this.y - 60, 'HOUSE BUST!', '#7fdbff', 900));
      this.step(250, () => {
        this.sinkSlot();
        this.gs.spawnHeart(this.x, this.y - 8, 'pop');
        this.gs.juice.burst(this.x, this.y, 0x7fdbff, 16, 1.2);
        this.punish(T.bust, 'stun');
      });
      return;
    }
    if (pay.triple) {
      const sym = pay.triple;
      sfx.jackpot();
      slot.flash();
      this.keep(banner(this.gs, this.x, this.y - 60, 'JACKPOT!', '#ffd96a', hold));
      this.step(hold, () => {
        this.payout(sym, true);
        this.step(600, () => {
          this.sinkSlot();
          this.punish(T.jackpotRecover);
        });
      });
      return;
    }
    this.step(hold, () => {
      pay.each.forEach((sym, i) =>
        this.step(i * T.payGap, () => {
          slot.flash(i);
          this.payout(sym, false);
        }),
      );
      this.step(2 * T.payGap + 300, () => {
        this.sinkSlot();
        this.heavy(T.reelsRecover[this.ph]);
      });
    });
  }

  /** One symbol's attack (big = the jackpot version). */
  private payout(sym: Sym, big: boolean): void {
    const fy = this.floorY;
    const ox = this.slot?.x ?? this.x + this.facing * 56;
    switch (sym) {
      case 'cherry': {
        sfx.shoot();
        const spreads = big ? [-70, 0, 70] : [0];
        for (const s of spreads) {
          const dx = this.player.x + s - ox;
          const vx = Phaser.Math.Clamp(dx / 1.1, -170, 170);
          this.shot(ox, fy - 44, 'croupier-bomb', vx, -260, { gravity: 700, explode: true, bounces: 2, lifeMs: 3200 });
        }
        break;
      }
      case 'bell':
        sfx.heavyHit(0.6);
        this.gs.juice.shake(0.008, 200);
        this.shockwaves(big ? 200 : 170);
        if (big) this.step(450, () => this.shockwaves(150));
        break;
      case 'seven':
        sfx.coinPing(1.3);
        this.coinRain(big ? 10 : 4, big ? 520 : 220);
        break;
      case 'skull':
        this.hasteUntil = this.gs.time.now + T.reelsRecover[this.ph] + T.hasteMs + (big ? 1500 : 0);
        this.gs.juice.floatText(this.x, this.y - 36, 'HASTE', '#ff4d5e');
        sfx.charge();
        break;
    }
  }

  /** Coins falling from the top of the screen near the player (pink marker first). Seq-guarded. */
  private coinRain(count: number, spread: number): void {
    const cam = this.gs.cameras.main;
    for (let i = 0; i < count; i++) {
      this.step(i * 120, () => {
        const x = Phaser.Math.Clamp(this.player.x + (Math.random() - 0.5) * spread, Math.max(cam.scrollX, this.arenaL) + 12, Math.min(cam.scrollX + cam.width, this.arenaR) - 12);
        const top = Math.max(cam.scrollY, TILE);
        const marker = this.keep(this.gs.add.rectangle(x, top + 4, 2, 8, 0xff006e).setDepth(40));
        this.gs.tweens.add({ targets: marker, alpha: 0, duration: 450, onComplete: () => marker.destroy() });
        this.step(450, () => this.shot(x, top - 4, 'croupier-coinshot', 0, 180, { lifeMs: 3000 }));
      });
    }
  }

  private sinkSlot(): void {
    this.slot?.sink();
    this.slot = null;
  }

  // ------------------------------------------------------------------ Double or Nothing (P3)
  /** Coin on his next attack: heads (x2) = it runs twice; tails (NOTHING) = fizzle into a long recover. */
  private doubleOrNothing(): void {
    this.begin('double');
    const face = flipCoin(Math.random);
    this.tossCoin(face, (coin) => {
      const hold = this.hold(T.doubleHold);
      if (face === 'heads') {
        this.keep(banner(this.gs, this.x, this.y - 64, 'x2', '#ffd96a', hold));
        sfx.jackpot();
        this.telegraph(hold, GOLD);
        this.setPose('windup', hold);
        this.step(hold, () => {
          this.drop(coin);
          const m = this.choose(Math.abs(this.dxToPlayer()), true) ?? 'coin';
          this.encore = 1;
          this.run(m);
        });
      } else {
        this.keep(banner(this.gs, this.x, this.y - 64, 'NOTHING', '#b9a6ff', hold));
        sfx.hurt();
        this.gs.juice.burst(coin.x, coin.y, 0x8b8ba8, 8, 0.6);
        this.drop(coin);
        this.punish(T.doubleFizzle);
      }
    });
  }

  // ------------------------------------------------------------------ High Card (phase changes)
  /** Three face-down 2:1 cards land on the floor; strike one. Good: -6% max HP + shards. Bad: a slow curse orb. */
  private highCard(): void {
    this.offer?.destroy();
    const L = this.arenaL, W = this.arenaR - this.arenaL;
    const xs = [0.25, 0.5, 0.75].map((f) => Math.round(L + W * f));
    const offer = new HighCardOffer(this.gs, this.x, this.y - 20, xs, this.floorY, highCardDeck(Math.random), T.highCardMs, (good, x, y) => {
      if (this.alive && this.offer === offer) this.onHighCard(good, x, y);
    });
    this.offer = offer;
    this.gs.juice.floatText(this.x, this.y - 50, 'HIGH CARD? 2:1', '#ffd96a');
  }

  private onHighCard(good: boolean, cx: number, cy: number): void {
    if (!good) {
      this.gs.juice.floatText(cx, cy - 16, 'CURSED', '#b9a6ff');
      sfx.hurt();
      // one slow, dodgeable orb after the reveal floor
      const s = this.seq;
      this.later(this.floor + 150, () => {
        if (s !== this.seq || !this.player.alive) return;
        const a = Math.atan2(this.player.y - (cy - 8), this.player.x - cx);
        this.gs.spawnProjectile(cx, cy - 8, 'croupier-curse', Math.cos(a) * 70, Math.sin(a) * 70, 'enemy', { damage: 1, lifeMs: 6000, owner: this });
      });
      return;
    }
    // good: the House pays (hp loss last: it may itself trigger a phase change)
    sfx.jackpot();
    this.gs.juice.floatText(cx, cy - 16, 'HIGH CARD!', '#ffd96a');
    this.gs.dropShards(cx, cy - 6, 8);
    const dmg = Math.max(1, Math.round(this.maxHp * 0.06));
    this.hp = Math.max(1, this.hp - dmg);
    this.gs.juice.flash(this, 120, GOLD);
    this.gs.juice.burst(this.x, this.y, GOLD, 16, 1.2);
    this.gs.juice.floatText(this.x, this.y - this.height / 2 - 4, `-${dmg}`, '#ffd166');
    this.onHurt({ damage: dmg, kbX: 0, kbY: 0, sourceX: cx });
  }

  // ------------------------------------------------------------------ phases
  protected onPhase(n: number): void {
    this.seq++;
    this.interruptFx();
    this.setPose('roar', 1500);
    this.body.setVelocityX(0);
    this.transform(1500);
    const s = this.seq;
    this.later(700, () => {
      if (s !== this.seq) return;
      if (n === 2) {
        this.gs.juice.floatText(this.x, this.y - 36, 'RAISE', '#ffd96a');
        this.gs.juice.burst(this.x, this.y, GOLD, 18, 1.2);
      } else {
        this.gs.juice.floatText(this.x, this.y - 36, 'ALL IN', '#f27d2b');
        this.gs.juice.burst(this.x, this.y, 0xf7b23b, 22, 1.4);
        this.gs.juice.ring(this.x, this.y, 0xf27d2b, 2.4);
      }
      this.gs.juice.shake(0.012, 300);
      sfx.bossRoar();
      this.highCard();
    });
  }

  /** Drop all in-flight attack visuals/state (phase change / death). */
  private interruptFx(): void {
    this.encore = 0;
    this.spin = null;
    this.slot?.destroy();
    this.slot = null;
    for (const tw of this.counters) tw.stop();
    this.counters = [];
    for (const b of this.boxes) b.kill();
    this.boxes = [];
    for (const o of this.temp) this.drop(o);
    this.temp = [];
    this.offer?.destroy();
    this.offer = null;
  }

  /** Scene teardown: destroy without touching the (possibly shut-down) tween manager. */
  private cleanupFx(): void {
    for (const o of this.temp) o.destroy();
    this.slot?.destroy(false);
    this.offer?.destroy(false);
  }

  die(reward = true): void {
    if (this.alive) {
      this.seq++;
      this.interruptFx();
      // no stray coins / pellets after the House folds
      for (const p of [...this.gs.projectiles.getChildren()] as Projectile[]) {
        if (p.team !== 'enemy' || p.dead) continue;
        p.dead = true;
        p.hitbox.kill();
        this.gs.juice.burst(p.x, p.y, GOLD, 4, 0.5);
        p.destroy();
      }
    }
    super.die(reward);
  }

  // ------------------------------------------------------------------ per-frame fx
  tick(time: number, dt: number): void {
    super.tick(time, dt);
    if (!this.alive) return;
    const now = this.gs.time.now;
    this.updateWheel(now);
    this.updateReels(now);
    if (now < this.hasteUntil && now >= this.nextHasteFx) {
      this.nextHasteFx = now + 140;
      this.gs.juice.burst(this.x, this.body.bottom - 4, 0xff4d5e, 2, 0.4);
    }
  }

  private updateWheel(now: number): void {
    const sp = this.spin;
    if (!sp || !sp.wheel.active) return;
    const t = Math.min(1, (now - sp.start) / T.rouletteSpin);
    const e = 1 - (1 - t) ** 3; // decelerating
    sp.wheel.setRotation(e * Math.PI * 2 * 1.5);
    const a = -Math.PI / 2 - e * Math.PI * 2 * sp.turns;
    const r = 15 - 4 * t;
    sp.ball.setPosition(sp.wheel.x + Math.cos(a) * r, sp.wheel.y + Math.sin(a) * r);
  }

  private updateReels(now: number): void {
    this.slot?.update(now);
  }
}
