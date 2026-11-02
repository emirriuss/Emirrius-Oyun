import Phaser from 'phaser';
import { Boss } from './Boss';
import { Enemy } from '../Enemy';
import type { Projectile } from '../Projectile';
import { Hitbox } from '../../combat/Hitbox';
import type { HitInfo, Hurtable, Rect } from '../../combat/types';
import { overlaps } from '../../combat/types';
import { TILE } from '../../config';
import { bus } from '../../core/events';
import { sfx } from '../../systems/sfx';
import { save } from '../../systems/SaveSystem';
import { txt } from '../../ui/text';
import { wheelFor, planSpin, nudgeAllowed, stealAmount, tickDelays, type FromageMove } from '../../combat/fromagePlan';
import { WEDGE_ORDER, WEDGE_COLOR } from '../../art/fromage';
import type { GameScene } from '../../scenes/GameScene';

/** Wind-ups / timings per phase [P1, P2, P3] (ms, px/s). */
const T = {
  spinMs: [900, 780, 650],
  landPause: 380,
  rollTele: [650, 560, 480],
  rollSpeed: [210, 240, 270],
  rollBounces: [2, 2, 3],
  rollRecover: [1100, 950, 850],
  splatMs: 1600,
  crackerTele: [520, 460, 420],
  crackers: [3, 4, 5],
  miceTele: 520,
  mice: [2, 2, 3],
  maxMice: 4,
  fondueWarn: 750,
  fondueMs: 4000,
  fondueBurnMs: 1500,
  graterTele: [700, 620, 560],
  graterSpeed: 125,
  coinMs: 6000,
  buttonMs: 5000,
  spinStun: 1200,
  cooldown: [900, 750, 600],
  encoreCd: 250,
  heckleMs: [0, 2600, 0],
};

const NAMES = ['MONSIEUR FROMAGE', 'MESSIEURS FROMAGE', 'MONSIEUR FONDUE'];
const CHEESE = 0xf7b23b;
const CREAM = 0xffeec2;
const DARK_DEPTH = 35;
const LIFT = 37; // above the P3 spotlight darkness
const BITE_DMG = 6;
const GRATE_DMG = 8;
const HECKLE_GAP = 150;

const QUIPS: Record<FromageMove, string[]> = {
  roll: ['ROLL WITH IT!', 'WHEEEEL!', 'GOUDA GO FAST!'],
  crackers: ['CRACKERS! CATCH!', 'SNACK TIME!', 'FREE SAMPLES!'],
  mice: ['MES AMIS! ATTACK!', 'MY LITTLE FANS!', 'SQUEAK, BABIES!'],
  fondue: ['FONDUE TIME!', 'MIND THE FLOOR!', 'HOT HOT HOT!'],
  grater: ["IT'S GRATE TO SEE YOU!", 'SHRED-TACULAR!'],
  bankrupt: ['BANKRUPT!', 'THE HOUSE ALWAYS WINS!'],
  double: ['DOUBLE OR NOTHING!', 'FEELING LUCKY?'],
};

type Arena = { floor: number; ceil: number; l: number; r: number };

/**
 * World 4-4 (post-game encore, after Aurren): MONSIEUR FROMAGE, THE WHEEL OF FATE. A cheese-wheel game-show host.
 * Every attack starts with a spin: the wedge on top when he stops is the move (shown on a card above him).
 * Each hit during the spin nudges the wheel one wedge (max 2): rig the show. Parrying the spin dizzies him.
 *  P1: ROLL (red; pogo his rim = SPLAT), CRACKERS (parry back = stun), MICE (bonk them and they bite him).
 *  P2 (sliced in half): + FONDUE floor, GRATER; the other half heckles with crackers. Shared HP bar.
 *  P3 (melted, spotlights + studio audience): + BANKRUPT (steals shards; hit the coins back), DOUBLE OR
 *      NOTHING (button: he loses 15% HP, you drop to 1 HP); a quick encore spin follows most moves.
 */
export class Fromage extends Boss {
  private gen = 0;
  private fx = new Set<Phaser.GameObjects.GameObject>();
  private arena?: Arena;
  private hist: FromageMove[] = [];
  // the wheel
  private wheelIdx = 0;
  private wheel: readonly FromageMove[] = wheelFor(1);
  private spinning = false;
  private spinT = 0;
  private spinMsCur = 1;
  private nudges = 0;
  private spinBox?: Hitbox;
  private card: Phaser.GameObjects.Image;
  private smug = false;
  /** P3: the next spin is a quick encore; `encoreNow` = the current act came from one */
  private encoreNext = false;
  private encoreNow = false;
  private look: 'fromage' | 'fromage-half' | 'fromage-melt' = 'fromage';
  // roll
  private rolling = false;
  private rollDir: 1 | -1 = 1;
  private rollBounces = 0;
  private rollT = 0;
  private rollBox?: Hitbox;
  // hazards / props
  private fondue?: { strip: Phaser.GameObjects.TileSprite; until: number; standMs: number; nextBubble: number };
  private coins = new Set<Coin>();
  private coinAngle = 0;
  private button?: RedButton;
  heckler?: Heckler;
  private bubble?: Phaser.GameObjects.Container;
  // P3 show
  private dark?: Phaser.GameObjects.RenderTexture;
  private brush?: Phaser.GameObjects.Image;
  private darkAlpha = 0;
  private spots: Phaser.GameObjects.Image[] = [];
  private audience?: { groups: Phaser.GameObjects.Container[]; signs: Phaser.GameObjects.BitmapText[]; until: number };
  private lastPlayerHp: number;
  private laughAt = 0;

  constructor(gs: GameScene, x: number, y: number) {
    super(gs, x, y, 'fromage', NAMES[0], { hp: 160, bodyW: 34, bodyH: 34, offX: 3, offY: 3, contactDamage: 1, shards: 150 });
    this.thresholds = [0.66, 0.33];
    this.deathTint = CHEESE;
    this.hearts = { periodicMs: 16000, maxOnField: 1, perParries: 3, onPhase: 1 };
    this.card = this.track(gs.add.image(x, y, 'wedges', 0).setDepth(42).setVisible(false));
    this.lastPlayerHp = this.player.hp;
    this.later(2100, () => this.quip('BONSOIR! WELCOME TO... WHEEL OF FATE!', 2200));
    this.once(Phaser.GameObjects.Events.DESTROY, () => this.cleanup());
  }

  // ------------------------------------------------------------------ helpers
  private get ph(): number {
    return Math.min(3, this.phase) - 1;
  }

  private track<O extends Phaser.GameObjects.GameObject>(o: O): O {
    this.fx.add(o);
    o.once(Phaser.GameObjects.Events.DESTROY, () => this.fx.delete(o));
    return o;
  }

  /** later() bound to the current attack: dropped if a phase change aborted it */
  private step(ms: number, fn: () => void): void {
    const g = this.gen;
    this.later(ms, () => {
      if (g === this.gen) fn();
    });
  }

  /** End the current act. In P3 most acts chain straight into a quick encore spin. */
  private finish(cd = T.cooldown[this.ph]): void {
    this.busy = false;
    if (this.phase >= 3 && !this.encoreNow) {
      this.encoreNext = true;
      this.cooldown = T.encoreCd;
    } else this.cooldown = cd;
  }

  get A(): Arena {
    if (this.arena) return this.arena;
    const gs = this.gs;
    const x = this.x;
    let floor = this.y;
    while (floor < gs.worldHeight && !gs.isBlockAt(x, floor)) floor += 4;
    floor = Math.floor(floor / TILE) * TILE;
    let ceil = this.y - 20;
    while (ceil > 0 && !gs.isBlockAt(x, ceil)) ceil -= 4;
    ceil = Math.floor(ceil / TILE) * TILE + TILE;
    const yy = floor - 8;
    let l = x;
    while (l > 0 && !gs.isBlockAt(l, yy)) l -= 4;
    l = Math.floor(l / TILE) * TILE + TILE;
    let r = x;
    while (r < gs.worldWidth && !gs.isBlockAt(r, yy)) r += 4;
    r = Math.floor(r / TILE) * TILE;
    this.arena = { floor, ceil, l, r };
    return this.arena;
  }
  private clampX(x: number, pad = 24): number {
    return Phaser.Math.Clamp(x, this.A.l + pad, this.A.r - pad);
  }
  private aliveMice(): Mouse[] {
    return (this.gs.enemies.getChildren() as Enemy[]).filter((e): e is Mouse => e instanceof Mouse && e.alive);
  }

  /** Speech bubble over his head. */
  quip(s: string, ms = 1500, x = this.x, y = this.body ? this.body.top - 30 : this.y - 50): void {
    this.bubble?.destroy();
    // the pixel font has a dark outline baked in: light text on a dark bubble
    const t = txt(this.gs, 0, 0, s, 10, '#ffeec2');
    const w = Math.round(t.width) + 10;
    const bg = this.gs.add.graphics();
    bg.fillStyle(0x241a33, 0.95).fillRoundedRect(-w / 2, -8, w, 15, 4);
    bg.fillStyle(0xf7b23b, 1).fillTriangle(-3, 7, 3, 7, 0, 12);
    bg.lineStyle(1, 0xf7b23b, 1).strokeRoundedRect(-w / 2, -8, w, 15, 4);
    const cx = Phaser.Math.Clamp(x, this.gs.cameras.main.scrollX + w / 2 + 4, this.gs.cameras.main.scrollX + this.gs.cameras.main.width - w / 2 - 4);
    const c = this.track(this.gs.add.container(cx, y, [bg, t]).setDepth(43).setScale(0.2));
    this.bubble = c;
    this.gs.tweens.add({ targets: c, scale: 1, duration: 160, ease: 'Back.out' });
    this.gs.tweens.add({ targets: c, y: y - 6, alpha: 0, delay: ms, duration: 250, onComplete: () => c.destroy() });
  }
  private quipFor(m: FromageMove): void {
    const q = QUIPS[m];
    this.quip(q[Math.floor(Math.random() * q.length)]);
  }

  /** Lift a hazard above the P3 darkness so it stays readable. */
  private lift<O extends Phaser.GameObjects.Components.Depth>(o: O): O {
    if (this.dark) o.setDepth(LIFT);
    return o;
  }

  // ------------------------------------------------------------------ visuals
  /** true once the P3 spotlights are on (props get lifted above the darkness) */
  get showLit(): boolean {
    return !!this.dark;
  }

  protected animKey(): string {
    const s = this.look;
    if (this.rolling) return s + '-roll';
    if (this.stunned) return s + '-stun';
    if (this.spinning) return s + '-spin';
    const pose = this.curPose;
    if (pose) return `${s}-${pose}`;
    return s + '-idle';
  }

  tick(time: number, dt: number): void {
    super.tick(time, dt);
    if (!this.alive) return;
    const now = this.gs.time.now;
    // the card rides above his head
    this.card.setPosition(this.x, this.body.top - 16);
    // spin / roll rotation; settle upright otherwise
    if (this.spinning) {
      this.spinT += dt;
      const k = Math.max(0, 1 - this.spinT / this.spinMsCur);
      this.angle += dt * (0.25 + 1.6 * k * k);
    } else if (!this.rolling && this.angle !== 0) {
      const a = Phaser.Math.Angle.WrapDegrees(this.angle);
      this.angle = Math.abs(a) < 2 ? 0 : a * 0.8;
    }
    this.updateFondue(now, dt);
    this.updateCoins(dt);
    this.updateShow(now);
    // the studio audience laughs at you
    const p = this.player;
    if (p.hp < this.lastPlayerHp) {
      if (now > this.laughAt) {
        this.laughAt = now + 1500;
        sfx.laughTrack();
      }
      this.cheer('BOO!');
    }
    this.lastPlayerHp = p.hp;
  }

  // ------------------------------------------------------------------ damage hooks
  receiveHit(hit: HitInfo): 'hit' | 'blocked' | 'ignored' {
    const res = super.receiveHit(hit);
    // a cracker parried back into his face stuns him
    if (res === 'hit' && hit.kind === 'projectile' && hit.parried && this.alive && !this.transforming && !this.stunned) {
      this.gs.juice.floatText(this.x, this.body.top - 12, 'CRUNCH!', '#ffeec2');
      this.onParried();
    }
    return res;
  }

  protected onHurt(hit: HitInfo): void {
    super.onHurt(hit);
    if (!this.alive || this.hp <= 0) return;
    if (hit.kind !== 'hazard') this.cheer('APPLAUSE');
    // rig the wheel
    if (this.spinning && nudgeAllowed(this.nudges)) {
      this.nudges++;
      this.advance();
      sfx.nudge();
      this.gs.juice.floatText(this.x, this.body.top - 26, this.nudges >= 2 ? 'RIGGED!!' : 'RIGGED!', '#ffd96a');
      this.gs.juice.burst(this.card.x, this.card.y, 0xffd96a, 8, 0.7);
    }
    // pogo on the rim of the rolling wheel: SPLAT
    if (this.rolling && hit.slam) {
      this.endRoll();
      sfx.splat();
      this.gs.juice.shake(0.008, 250);
      this.gs.juice.floatText(this.x, this.body.top - 20, 'SPLAT!', '#ffeec2');
      this.gs.juice.burst(this.x, this.body.bottom, CHEESE, 14, 1);
      this.quip('MON DIEU!');
      this.recover(T.splatMs, 'splat', T.cooldown[this.ph]);
    }
  }

  onParried(): void {
    super.onParried();
    if (this.spinning) {
      // parried the spinning wheel: the show stops, he's dizzy
      this.abortSpin();
      this.gen++;
      this.quip('WHO PAUSED THE WHEEL?!');
      this.recover(T.spinStun, 'stun', T.cooldown[this.ph]);
    }
  }

  /** A fleeing mouse found him. Chomp. */
  takeBite(m: Mouse): void {
    if (!this.alive || this.transforming) return;
    sfx.squeak();
    this.gs.juice.floatText(m.x, m.y - 10, 'CHOMP!', '#ff8fb8');
    this.gs.juice.burst(m.x, m.y, CHEESE, 12, 0.8);
    m.die(false);
    this.receiveHit({ damage: BITE_DMG, kbX: 0, kbY: 0, sourceX: m.x, kind: 'hazard' });
    if (this.alive && Math.random() < 0.5) this.quip('OW! NOT THE RIND!');
  }

  // ------------------------------------------------------------------ AI
  protected think(dt: number): void {
    if (this.rolling) {
      this.updateRoll(dt);
      return;
    }
    if (this.onGround) this.body.setVelocityX(0);
    if (this.busy) return;
    this.cooldown -= dt;
    this.facePlayer();
    if (this.cooldown > 0 || !this.player.alive) return;
    void this.A; // scan the arena once he's landed
    this.spin();
  }

  // ------------------------------------------------------------------ the Wheel of Fate
  private spin(): void {
    this.busy = true;
    this.wheel = wheelFor(this.phase);
    this.wheelIdx %= this.wheel.length;
    const ticks = planSpin(this.wheel, this.wheelIdx, this.hist);
    this.encoreNow = this.encoreNext;
    this.encoreNext = false;
    let ms = T.spinMs[this.ph];
    if (this.smug) ms *= 0.75;
    if (this.encoreNow) ms *= 0.6;
    this.smug = false;
    this.spinning = true;
    this.spinT = 0;
    this.spinMsCur = ms;
    this.nudges = 0;
    this.showCard();
    if (this.encoreNow) this.quip('ENCORE! ENCORE!', 700);
    else if (Math.random() < 0.3) this.quip(Math.random() < 0.5 ? 'SPIN THE WHEEL!' : 'WHAT WILL IT BE?!', 900);
    // the spinning wheel hurts to touch; a well-timed swing parries it
    this.spinBox = this.meleeBox(-20, -20, 40, 40, ms, 1, true, 200);
    const delays = tickDelays(ticks, ms);
    const g = this.gen;
    let i = 0;
    const next = (): void => {
      if (g !== this.gen || !this.spinning) return;
      if (i >= delays.length) {
        this.land();
        return;
      }
      this.step(delays[i++], () => {
        this.advance();
        next();
      });
    };
    next();
  }

  /** One wedge forward (a spin tick or a player's nudge). */
  private advance(): void {
    this.wheelIdx = (this.wheelIdx + 1) % this.wheel.length;
    this.showCard();
    sfx.wheelTick();
  }

  private showCard(): void {
    const m = this.wheel[this.wheelIdx];
    this.card.setFrame(WEDGE_ORDER.indexOf(m)).setVisible(true).setAlpha(1).setScale(1);
  }

  private land(): void {
    this.spinning = false;
    this.spinBox?.kill();
    this.spinBox = undefined;
    const move = this.wheel[this.wheelIdx];
    this.hist.push(move);
    if (this.hist.length > 4) this.hist.shift();
    sfx.ding();
    this.gs.juice.ring(this.card.x, this.card.y, WEDGE_COLOR[move], 0.8);
    this.gs.tweens.add({ targets: this.card, scale: 1.5, duration: 120, yoyo: true });
    this.gs.tweens.add({ targets: this.card, alpha: 0, delay: T.landPause + 500, duration: 200, onComplete: () => this.card.setVisible(false) });
    this.quipFor(move);
    this.step(T.landPause, () => this.begin(move));
  }

  private abortSpin(): void {
    this.spinning = false;
    this.spinBox?.kill();
    this.spinBox = undefined;
    this.card.setVisible(false);
  }

  private begin(m: FromageMove): void {
    this.facePlayer();
    switch (m) {
      case 'roll': this.roll(); break;
      case 'crackers': this.crackers(); break;
      case 'mice': this.mice(); break;
      case 'fondue': this.fondueAct(); break;
      case 'grater': this.grater(); break;
      case 'bankrupt': this.bankrupt(); break;
      case 'double': this.double(); break;
    }
  }

  // ------------------------------------------------------------------ ROLL (red): wall to wall
  private roll(): void {
    const tele = T.rollTele[this.ph];
    this.setPose('roll', tele);
    this.telegraph(tele, 0, true);
    this.step(tele, () => {
      this.rolling = true;
      this.rollDir = this.facing;
      this.rollBounces = 0;
      this.rollT = 0;
      this.contactDamage = 0;
      // the top 10px are safe: pogo the rim
      this.rollBox = this.gs.damage.add(
        new Hitbox(
          'enemy',
          (): Rect => ({ x: this.body.x, y: this.body.y + 10, w: this.body.width, h: this.body.height - 10 }),
          () => ({ damage: 1, kbX: this.rollDir * 230, kbY: -200, sourceX: this.x, parryable: false, kind: 'melee' }),
          12000,
        ).ownedBy(this),
      );
    });
  }

  private updateRoll(dt: number): void {
    this.rollT += dt;
    const sp = T.rollSpeed[this.ph];
    this.body.setVelocityX(this.rollDir * sp);
    this.angle += ((this.rollDir * sp * dt) / 1000 / 17) * (180 / Math.PI);
    if (this.rollT % 60 < dt) this.gs.juice.burst(this.x - this.rollDir * 12, this.body.bottom, CHEESE, 1, 0.4);
    const hitWall = this.rollDir > 0 ? this.body.blocked.right : this.body.blocked.left;
    if (hitWall) {
      this.rollBounces++;
      sfx.boing();
      this.gs.juice.shake(0.006, 160);
      this.gs.juice.burst(this.x + this.rollDir * 16, this.y, CHEESE, 10, 0.8);
      this.rollDir = this.rollDir > 0 ? -1 : 1;
      this.body.setVelocityY(-120);
      if (this.rollBounces >= T.rollBounces[this.ph]) {
        this.endRoll();
        this.quip('WHERE AM I?');
        this.recover(T.rollRecover[this.ph], 'stun', T.cooldown[this.ph]);
        return;
      }
    }
    if (this.rollT > 7000) {
      this.endRoll();
      this.finish();
    }
  }

  private endRoll(): void {
    if (!this.rolling) return;
    this.rolling = false;
    this.rollBox?.kill();
    this.rollBox = undefined;
    this.contactDamage = 1;
    this.body.setVelocityX(0);
  }

  // ------------------------------------------------------------------ CRACKERS (parry them back)
  private crackers(): void {
    const tele = T.crackerTele[this.ph];
    const n = T.crackers[this.ph];
    this.setPose('toss', tele + n * 110 + 200);
    this.telegraph(tele, CREAM);
    this.step(tele, () => {
      for (let i = 0; i < n; i++) this.step(i * 110, () => throwCracker(this, this.x, this.body.top + 6, i, n));
    });
    this.step(tele + n * 110 + 300, () => this.finish());
  }

  // ------------------------------------------------------------------ MICE (bonk them back into him)
  private mice(): void {
    this.setPose('laugh', T.miceTele + 500);
    this.telegraph(T.miceTele, 0x9ad152);
    this.step(T.miceTele, () => {
      const n = Math.min(T.mice[this.ph], T.maxMice - this.aliveMice().length);
      for (let i = 0; i < n; i++) {
        const dir: 1 | -1 = i % 2 === 0 ? this.dirToPlayer() : this.dirToPlayer() > 0 ? -1 : 1;
        const m = new Mouse(this.gs, this.x + dir * 14, this.body.bottom - 8, this, dir);
        this.gs.enemies.add(m);
        this.lift(m);
        this.gs.juice.burst(m.x, m.y, 0xc2c3d6, 6, 0.6);
      }
      sfx.squeak();
    });
    this.step(T.miceTele + 500, () => this.finish());
  }

  // ------------------------------------------------------------------ FONDUE (the floor is cheese)
  private fondueAct(): void {
    const A = this.A;
    this.setPose('laugh', T.fondueWarn + 500);
    this.telegraph(T.fondueWarn, 0xf7b23b);
    const warn = this.track(this.gs.add.rectangle(A.l, A.floor - 2, A.r - A.l, 2, 0xf7b23b).setOrigin(0, 0).setDepth(LIFT));
    this.gs.tweens.add({ targets: warn, alpha: 0.2, yoyo: true, repeat: 4, duration: 75, onComplete: () => warn.destroy() });
    this.step(T.fondueWarn, () => this.startFondue());
    this.step(T.fondueWarn + 500, () => this.finish(T.cooldown[this.ph] + 500));
  }

  private startFondue(): void {
    const A = this.A;
    const now = this.gs.time.now;
    if (this.fondue) {
      this.fondue.until = now + T.fondueMs;
      return;
    }
    const strip = this.track(this.gs.add.tileSprite(A.l, A.floor, A.r - A.l, 6, 'fondue').setOrigin(0, 1).setDepth(LIFT).setScale(1, 0));
    this.gs.tweens.add({ targets: strip, scaleY: 1, duration: 300, ease: 'Back.out' });
    this.fondue = { strip, until: now + T.fondueMs, standMs: 0, nextBubble: 0 };
    this.gs.juice.shake(0.004, 200);
  }

  private updateFondue(now: number, dt: number): void {
    const f = this.fondue;
    if (!f) return;
    f.strip.tilePositionX += dt * 0.01;
    if (now >= f.until) {
      this.fondue = undefined;
      this.gs.tweens.add({ targets: f.strip, scaleY: 0, alpha: 0, duration: 400, onComplete: () => f.strip.destroy() });
      return;
    }
    const A = this.A;
    if (now >= f.nextBubble) {
      f.nextBubble = now + 90;
      this.gs.juice.burst(A.l + Math.random() * (A.r - A.l), A.floor - 4, CHEESE, 1, 0.35);
    }
    const p = this.player;
    if (p.alive && p.grounded && p.body.bottom >= A.floor - 3) {
      p.slow(150, 0.5);
      f.standMs += dt;
      if (f.standMs >= T.fondueBurnMs) {
        f.standMs = 0;
        p.receiveHit({ damage: 1, kbX: 0, kbY: -280, sourceX: p.x, kind: 'hazard' });
        this.gs.juice.burst(p.x, p.body.bottom, CHEESE, 12, 0.8);
      }
    } else f.standMs = Math.max(0, f.standMs - dt * 2);
  }

  // ------------------------------------------------------------------ GRATER (red): drops on you, slides
  private grater(): void {
    const A = this.A;
    const tele = T.graterTele[this.ph];
    const tx = this.clampX(this.player.x, 20);
    this.setPose('toss', tele);
    const mark = this.track(this.gs.add.rectangle(tx, A.floor - 1, 24, 2, 0xff1a1a).setDepth(LIFT));
    this.gs.tweens.add({ targets: mark, alpha: 0.25, yoyo: true, repeat: -1, duration: 70 });
    this.gs.juice.ring(tx, A.floor - 8, 0xff1a1a, 0.9);
    sfx.telegraph();
    this.step(tele, () => {
      mark.destroy();
      this.dropGrater(tx);
    });
    this.step(tele + 500, () => this.finish());
  }

  private dropGrater(tx: number): void {
    const A = this.A;
    const gs = this.gs;
    const g = this.track(gs.add.image(tx, A.ceil + 16, 'grater').setDepth(17));
    this.lift(g);
    const rect = (): Rect => ({ x: g.x - 9, y: g.y - 14, w: 18, h: 29 });
    const box = gs.damage.add(
      new Hitbox('enemy', rect, () => ({ damage: 1, kbX: (this.player.x >= g.x ? 1 : -1) * 220, kbY: -200, sourceX: g.x, parryable: false, kind: 'melee' }), 8000).ownedBy(this),
    );
    g.once(Phaser.GameObjects.Events.DESTROY, () => box.kill());
    gs.tweens.add({
      targets: g,
      y: A.floor - 16,
      duration: 260,
      ease: 'Quad.in',
      onComplete: () => {
        if (!g.active) return;
        gs.juice.shake(0.008, 200);
        gs.juice.dust(g.x, A.floor, 8, 0.8);
        sfx.heavyHit(0.7);
        const dir = this.player.x >= g.x ? 1 : -1;
        const end = dir > 0 ? A.r - 10 : A.l + 10;
        let grated = false;
        gs.tweens.add({
          targets: g,
          x: end,
          duration: (Math.abs(end - g.x) / T.graterSpeed) * 1000,
          onUpdate: () => {
            if (Math.random() < 0.3) gs.juice.burst(g.x, A.floor - 2, 0xffeec2, 1, 0.3);
            // he's not immune to his own grater
            if (!grated && this.alive && !this.rolling && overlaps(rect(), this.hurtRect())) {
              grated = true;
              this.gs.juice.floatText(this.x, this.body.top - 20, 'GRATED!', '#ffeec2');
              this.gs.juice.burst(this.x, this.y, CREAM, 18, 1);
              this.receiveHit({ damage: GRATE_DMG, kbX: 0, kbY: 0, sourceX: g.x, kind: 'hazard' });
              if (this.alive) this.quip('SELF-GRATING?! NON!');
            }
          },
          onComplete: () => {
            if (!g.active) return;
            gs.juice.burst(g.x, g.y, 0xc2c3d6, 14, 1);
            g.destroy();
          },
        });
      },
    });
  }

  // ------------------------------------------------------------------ BANKRUPT: steals shards
  private bankrupt(): void {
    sfx.slotMachine();
    this.setPose('laugh', 1200);
    this.telegraph(600, 0xffd96a);
    this.step(600, () => {
      const n = stealAmount(save.data.shards);
      const p = this.player;
      if (n === 0) {
        this.quip('NO SHARDS? HOW TRAGIC.', 1600);
        this.step(600, () => this.finish());
        return;
      }
      save.data.shards -= n;
      save.save();
      bus.emit('shards', save.data.shards);
      this.gs.juice.floatText(p.x, p.y - 22, `-${n}`, '#ffd96a');
      for (let i = 0; i < n; i++) {
        const c = new Coin(this, p.x, p.y, (i / n) * Math.PI * 2);
        this.coins.add(c);
      }
      this.step(T.coinMs, () => this.swallowCoins());
      this.step(900, () => this.finish());
    });
  }

  private updateCoins(dt: number): void {
    if (!this.coins.size) return;
    this.coinAngle += dt * 0.0032;
    for (const c of this.coins) {
      if (!c.alive) {
        this.coins.delete(c);
        continue;
      }
      const a = this.coinAngle + c.phase;
      const tx = this.x + Math.cos(a) * 40;
      const ty = this.y + Math.sin(a) * 30;
      c.sprite.x += (tx - c.sprite.x) * 0.15;
      c.sprite.y += (ty - c.sprite.y) * 0.15;
    }
  }

  /** Coins not hit back in time are gone. */
  private swallowCoins(): void {
    if (!this.coins.size) return;
    let lost = 0;
    for (const c of this.coins) {
      if (!c.alive) continue;
      lost++;
      c.vanish(this.x, this.y);
    }
    this.coins.clear();
    if (lost) this.quip(`MERCI FOR THE ${lost}!`);
  }

  /** A coin knocked out of orbit: shard back, and a chip off the wheel. */
  coinHit(c: Coin): void {
    this.coins.delete(c);
    save.addShards(1);
    bus.emit('shards', save.data.shards);
    sfx.pickup(1 + Math.random() * 0.3);
    if (this.alive && !this.transforming) this.receiveHit({ damage: 1, kbX: 0, kbY: 0, sourceX: c.sprite.x, kind: 'melee' });
  }

  // ------------------------------------------------------------------ DOUBLE OR NOTHING
  private double(): void {
    this.setPose('toss', 600);
    this.step(400, () => {
      const A = this.A;
      const mid = (A.l + A.r) / 2;
      const x = this.clampX(this.x > mid ? A.l + 96 : A.r - 96);
      this.button?.remove();
      this.button = new RedButton(this, x, A.ceil + 10, A.floor);
    });
    this.step(600, () => this.finish());
  }

  /** Called by the button. */
  doubleOrNothing(pressed: boolean): void {
    this.button = undefined;
    if (!this.alive) return;
    if (pressed) {
      const p = this.player;
      sfx.slotMachine();
      this.gs.cameras.main.flash(200, 255, 40, 80);
      this.gs.juice.shake(0.012, 400);
      this.gs.juice.floatText(p.x, p.y - 24, 'ALL IN!', '#ff8fb8');
      if (p.alive && p.hp > 1) {
        p.hp = 1;
        p.heal(0); // refresh the HUD
      }
      this.receiveHit({ damage: Math.round(this.maxHp * 0.15), kbX: 0, kbY: 0, sourceX: this.x, kind: 'hazard', heavy: true });
      if (this.alive) this.quip('YOU MANIAC!', 1800);
    } else {
      this.smug = true;
      this.quip('COWARD! HA HA!', 1600);
      sfx.laughTrack();
    }
  }

  // ------------------------------------------------------------------ phases
  protected onPhase(n: number): void {
    this.abort();
    if (n === 2) {
      this.setPose('stun', 1500);
      this.quip('SACRE BLEU!', 1300);
      this.gs.time.delayedCall(650, () => {
        if (!this.alive) return;
        // the slice
        const top = this.A.ceil;
        const line = this.track(this.gs.add.rectangle(this.x, (top + this.A.floor) / 2, 2, this.A.floor - top, 0xffffff).setDepth(44));
        this.gs.tweens.add({ targets: line, alpha: 0, scaleX: 4, duration: 300, onComplete: () => line.destroy() });
        sfx.heavyHit(1.3);
        this.gs.juice.shake(0.012, 300);
        this.gs.juice.burst(this.x, this.y, CREAM, 24, 1.3);
      });
      this.transform(1500, () => this.split());
    } else if (n === 3) {
      this.hearts.periodicMs = 13000;
      this.setPose('laugh', 1700);
      this.quip('TOGETHER AGAIN! AND... MELTING?', 1600);
      const h = this.heckler;
      this.heckler = undefined;
      h?.rejoin(this.x, this.y);
      this.transform(1700, () => this.merge());
    }
  }

  private setBodyW(w: number): void {
    this.body.setSize(w, 34).setOffset((this.width - w) / 2, 3);
  }

  private rename(name: string): void {
    this.bossName = name;
    bus.emit('boss', name, Math.max(0, this.hp), this.maxHp);
  }

  private split(): void {
    this.look = 'fromage-half';
    this.setBodyW(17);
    this.rename(NAMES[1]);
    const A = this.A;
    const mid = (A.l + A.r) / 2;
    const side = this.x > mid ? -1 : 1;
    const h = new Heckler(this.gs, this.x + side * 12, this.body.bottom - 8, this);
    h.body.setVelocity(side * 160, -260);
    this.gs.enemies.add(h);
    this.heckler = h;
    this.quip('MEET MY BETTER HALF!', 1600);
    this.cooldown = 700;
  }

  private merge(): void {
    this.look = 'fromage-melt';
    this.setBodyW(34);
    this.rename(NAMES[2]);
    this.gs.juice.burst(this.x, this.y, CHEESE, 26, 1.4);
    this.gs.juice.ring(this.x, this.y, 0xffd96a, 2.4);
    this.startShow();
    this.quip("IT'S SHOWTIME, MON AMI!", 1600);
    this.cooldown = 700;
  }

  /** Cancel the running act (phase change / death). Hazards already out finish on their own. */
  private abort(): void {
    this.gen++;
    this.abortSpin();
    this.endRoll();
    this.encoreNext = this.encoreNow = false;
    this.body.setVelocityX(0);
  }

  // ------------------------------------------------------------------ P3: spotlights + audience
  private startShow(): void {
    if (this.dark) return;
    const gs = this.gs;
    this.dark = gs.add.renderTexture(0, 0, gs.worldWidth, gs.worldHeight + 32).setOrigin(0, 0).setDepth(DARK_DEPTH);
    this.brush = gs.make.image({ key: 'light', add: false });
    this.darkAlpha = 0;
    gs.tweens.add({ targets: this, darkAlpha: 0.55, duration: 1200 });
    for (const tint of [0xffd96a, 0xff8fb8, 0x7fdbff]) {
      this.spots.push(this.track(gs.add.image(this.x, this.A.floor, 'light').setTint(tint).setBlendMode(Phaser.BlendModes.ADD).setDepth(DARK_DEPTH + 1).setScale(1.6, 2.8).setAlpha(0.35)));
    }
    for (const o of [this.fondue?.strip, ...[...this.coins].map((c) => c.sprite), this.button?.sprite]) o?.setDepth(LIFT);
    // cardboard studio audience in both bottom corners (the HUD boss bar owns the middle)
    const cam = gs.cameras.main;
    const groups: Phaser.GameObjects.Container[] = [];
    const signs: Phaser.GameObjects.BitmapText[] = [];
    for (const gx of [42, cam.width - 42]) {
      const c = this.track(gs.add.container(gx, cam.height + 40).setScrollFactor(0).setDepth(44));
      const g = gs.add.graphics();
      for (const hx of [-26, -9, 9, 26]) g.fillStyle(0x1c1430, 1).fillCircle(hx, -9, 6).fillRoundedRect(hx - 8, -4, 16, 8, 3);
      g.fillStyle(0x6b4433, 1).fillRect(-1, -18, 2, 14);
      g.fillStyle(0x241a33, 1).fillRect(-30, -31, 60, 14);
      g.lineStyle(1, 0xffd96a, 1).strokeRect(-30, -31, 60, 14);
      const sign = txt(gs, 0, -24, 'APPLAUSE', 10, '#ffd96a');
      c.add([g, sign]);
      gs.tweens.add({ targets: c, y: cam.height, duration: 700, ease: 'Back.out' });
      groups.push(c);
      signs.push(sign);
    }
    this.audience = { groups, signs, until: 0 };
  }

  /** The audience holds up a sign. */
  private cheer(s: string): void {
    const a = this.audience;
    if (!a) return;
    for (const sign of a.signs) sign.setText(s).setTint(s === 'BOO!' ? 0xff8fb8 : 0xffd96a);
    a.until = this.gs.time.now + 900;
    if (s === 'APPLAUSE' && Math.random() < 0.15) sfx.applause();
  }

  private hole(x: number, y: number, rx: number, ry: number, a: number): void {
    this.brush!.setScale((rx * 2) / 64, (ry * 2) / 64).setAlpha(a);
    this.dark!.erase(this.brush!, x, y);
  }

  private updateShow(now: number): void {
    const a = this.audience;
    if (a && now < a.until + 100) a.groups.forEach((c, i) => (c.y = this.gs.cameras.main.height - (now < a.until ? Math.abs(Math.sin(now / 60 + i)) * 4 : 0)));
    if (!this.dark) return;
    const A = this.A;
    this.spots.forEach((s, i) => {
      s.x = (A.l + A.r) / 2 + Math.sin(now / (900 + i * 330) + i * 2) * (A.r - A.l) * 0.38;
      s.y = A.floor - 30;
    });
    const dark = this.dark;
    dark.clear();
    dark.fill(0x05030c, this.darkAlpha);
    const p = this.player;
    this.hole(p.x, p.y, 90, 80, 1);
    this.hole(this.x, this.y, 64, 56, 0.9);
    for (const s of this.spots) this.hole(s.x, s.y, 46, 70, 0.6);
    for (const e of this.gs.enemies.getChildren() as Enemy[]) if (e !== this && e.alive) this.hole(e.x, e.y, 22, 22, 0.8);
    for (const h of this.gs.pickups.getChildren() as Phaser.GameObjects.Sprite[]) if (h.active && h.getData('kind') === 'heart') this.hole(h.x, h.y, 22, 22, 0.9);
    if (this.button) this.hole(this.button.sprite.x, this.button.sprite.y, 40, 40, 0.9);
  }

  // ------------------------------------------------------------------ death
  die(reward = true): void {
    if (this.alive) {
      this.abort();
      // the house gives back what's still in orbit
      let back = 0;
      for (const c of this.coins) if (c.alive) back++, c.vanish(this.player.x, this.player.y);
      this.coins.clear();
      if (back) {
        save.addShards(back);
        bus.emit('shards', save.data.shards);
      }
      this.button?.remove();
      this.heckler?.rejoin(this.x, this.y);
      this.card.setVisible(false);
      const gs = this.gs;
      sfx.applause();
      this.quip('FIN! GOODNIGHT, EVERYBODY!', 2400);
      this.cheer('BRAVO!');
      const colors = [0xff8fb8, 0xffd96a, 0x7fdbff, 0x9ad152, 0xd1478f, 0xf4f1ea];
      for (let i = 0; i < 8; i++)
        gs.time.delayedCall(i * 120, () => gs.juice.burst(this.x + (Math.random() - 0.5) * 120, this.y - 40 - Math.random() * 40, colors[i % colors.length], 14, 1.2));
      // he rolls off stage, still smiling
      const dir = this.x > (this.A.l + this.A.r) / 2 ? 1 : -1;
      gs.tweens.add({ targets: this, angle: dir * 540, x: this.x + dir * 70, duration: 900, ease: 'Quad.in' });
      if (this.dark) {
        const d = this.dark;
        const b = this.brush;
        this.dark = undefined;
        this.brush = undefined;
        gs.tweens.add({ targets: d, alpha: 0, duration: 900, onComplete: () => { d.destroy(); b?.destroy(); } });
      }
    }
    super.die(reward);
  }

  private cleanup(): void {
    for (const c of this.coins) c.dispose();
    this.coins.clear();
    this.button?.remove(true);
    for (const o of [...this.fx]) o.destroy();
    this.fx.clear();
    this.dark?.destroy();
    this.brush?.destroy();
  }
}

// ==================================================================== props & minions

/** Arcing cracker frisbee aimed around the player (spread by index). Parry it back for a stun. */
function throwCracker(owner: Enemy, x: number, y: number, i: number, n: number): void {
  const gs = owner.gs;
  const p = gs.player;
  const g = 420;
  const t = 0.85;
  const tx = p.x + (i - (n - 1) / 2) * 34;
  const ty = p.body.bottom - 6;
  const vx = Phaser.Math.Clamp((tx - x) / t, -260, 260);
  const vy = (ty - y - 0.5 * g * t * t) / t;
  const pr: Projectile = gs.spawnProjectile(x, y, 'cracker', vx, vy, 'enemy', { damage: 1, gravity: g, lifeMs: 2600, owner });
  const f = owner instanceof Fromage ? owner : owner instanceof Heckler ? owner.boss : null;
  if (f?.showLit) pr.setDepth(LIFT);
  sfx.swing(1.4);
}

/** Hungry mouse. Hunts you; bonk it and it flees, and a fleeing mouse that reaches Fromage bites him. */
export class Mouse extends Enemy {
  private mode: 'hunt' | 'flee' = 'hunt';
  private fleeUntil = 0;
  private nextSqueak = 0;

  constructor(gs: GameScene, x: number, y: number, private boss: Fromage, dir: 1 | -1) {
    super(gs, x, y, 'fmouse', { hp: 3, bodyW: 10, bodyH: 7, shards: 0, contactDamage: 1 });
    this.deathTint = 0x8b8ba8;
    this.facing = dir;
    this.body.setVelocity(dir * 120, -160);
  }

  protected animKey(): string {
    return 'fmouse-run';
  }

  receiveHit(hit: HitInfo): 'hit' | 'blocked' | 'ignored' {
    const res = super.receiveHit(hit);
    if (res === 'hit' && this.alive) {
      this.mode = 'flee';
      this.fleeUntil = this.gs.time.now + 3200;
      this.contactDamage = 0;
      this.facing = this.x >= hit.sourceX ? 1 : -1;
      this.setTint(0xc9f2ff);
      this.gs.juice.floatText(this.x, this.y - 10, 'EEK!', '#c9f2ff');
      sfx.squeak();
    }
    return res;
  }

  protected think(): void {
    const now = this.gs.time.now;
    if (now > this.nextSqueak) {
      this.nextSqueak = now + 900 + Math.random() * 1200;
      if (Math.random() < 0.4) sfx.squeak();
    }
    if (this.mode === 'hunt') {
      if (Math.abs(this.dxToPlayer()) > 6) this.facePlayer();
      this.body.setVelocityX(this.facing * 105);
    } else {
      this.body.setVelocityX(this.facing * 175);
      if (this.wallAhead()) this.facing = this.facing > 0 ? -1 : 1;
      const r = this.hurtRect();
      const b = this.boss;
      const target = b.alive && overlaps(r, b.hurtRect()) ? b : b.heckler?.alive && overlaps(r, b.heckler.hurtRect()) ? b.heckler : null;
      if (target) {
        b.takeBite(this);
        return;
      }
      if (now > this.fleeUntil) {
        this.mode = 'hunt';
        this.contactDamage = 1;
        this.restoreTint();
      }
    }
    if (this.onGround && this.wallAhead()) this.body.setVelocityY(-170);
  }
}

/** P2: the other half of the wheel (with a monocle). Heckles with crackers; hits on it hurt Fromage. */
export class Heckler extends Enemy {
  private next = 1800;
  private poseName = '';
  private poseUntil = 0;

  constructor(gs: GameScene, x: number, y: number, readonly boss: Fromage) {
    super(gs, x, y, 'fromage-half', { hp: 999, bodyW: 17, bodyH: 34, offX: 11.5, offY: 3, shards: 0, contactDamage: 1 });
    this.superArmor = true;
    this.deathTint = CHEESE;
  }

  protected animKey(): string {
    if (this.stunned) return 'fromage-half-hstun';
    if (this.gs.time.now < this.poseUntil) return 'fromage-half-' + this.poseName;
    return 'fromage-half-hidle';
  }

  receiveHit(hit: HitInfo): 'hit' | 'blocked' | 'ignored' {
    if (!this.alive || !this.boss.alive) return 'ignored';
    const res = this.boss.receiveHit(hit);
    if (res === 'hit') {
      this.gs.juice.flash(this, 80);
      this.gs.juice.burst(this.x, this.y, 0xffffff, 4);
    }
    return res;
  }

  protected think(dt: number): void {
    const A = this.boss.A;
    this.facePlayer();
    // stay mirrored from his other half, and never closer than HECKLE_GAP
    const lo = A.l + 24, hi = A.r - 24;
    const bx = this.boss.x;
    let tx = Phaser.Math.Clamp(A.l + A.r - bx, lo, hi);
    if (Math.abs(tx - bx) < HECKLE_GAP) {
      const side = this.x >= bx ? 1 : -1;
      tx = bx + side * HECKLE_GAP;
      if (tx < lo || tx > hi) tx = bx - side * HECKLE_GAP;
      tx = Phaser.Math.Clamp(tx, lo, hi);
    }
    const dx = tx - this.x;
    if (this.onGround) {
      if (Math.abs(dx) > 10) {
        this.body.setVelocity(Math.sign(dx) * 70, -110); // happy little hops
      } else this.body.setVelocityX(0);
    }
    this.next -= dt;
    if (this.next <= 0 && this.player.alive) {
      this.next = T.heckleMs[1] + Math.random() * 800;
      this.telegraph(380, CREAM);
      this.poseName = 'htoss';
      this.poseUntil = this.gs.time.now + 650;
      this.gs.time.delayedCall(380, () => {
        if (!this.alive || this.stunned) return;
        throwCracker(this, this.x, this.body.top + 6, 0, 1);
        if (Math.random() < 0.35) this.boss.quip(Math.random() < 0.5 ? 'BOO! HISS!' : 'NICE HAIR, NOT!', 1100, this.x, this.body.top - 30);
      });
    }
  }

  /** Rolls back into the main wheel (P3 / death). */
  rejoin(x: number, y: number): void {
    if (!this.alive) return;
    this.alive = false;
    this.gs.damage.unregister(this);
    this.body.enable = false;
    this.gs.onEnemyKilled(this, false);
    this.gs.tweens.add({ targets: this, x, y, angle: 360, duration: 600, ease: 'Quad.in', onComplete: () => this.destroy() });
  }
}

/** BANKRUPT coin: orbits Fromage; hit it to get the shard back. */
class Coin implements Hurtable {
  team = 'enemy' as const;
  alive = true;
  sprite: Phaser.GameObjects.Sprite;

  constructor(private boss: Fromage, x: number, y: number, readonly phase: number) {
    const gs = boss.gs;
    this.sprite = gs.add.sprite(x, y, 'coin').setDepth(boss.depth + 2);
    this.sprite.play({ key: 'coin-fly', startFrame: Math.floor(Math.random() * 4) });
    gs.damage.register(this);
  }

  hurtRect(): Rect {
    return { x: this.sprite.x - 6, y: this.sprite.y - 6, w: 12, h: 12 };
  }

  receiveHit(hit: HitInfo): 'hit' | 'blocked' | 'ignored' {
    if (!this.alive || hit.kind === 'hazard') return 'ignored';
    const gs = this.boss.gs;
    this.alive = false;
    gs.damage.unregister(this);
    gs.juice.burst(this.sprite.x, this.sprite.y, 0xffd96a, 8, 0.6);
    gs.juice.floatText(this.sprite.x, this.sprite.y - 8, '+1', '#ffd96a');
    this.boss.coinHit(this);
    this.sprite.destroy();
    return 'hit';
  }

  /** Gone without a tween (scene shutdown). */
  dispose(): void {
    if (this.alive) {
      this.alive = false;
      this.boss.gs.damage.unregister(this);
    }
    this.sprite.destroy();
  }

  vanish(x: number, y: number): void {
    if (this.alive) {
      this.alive = false;
      this.boss.gs.damage.unregister(this);
    }
    const s = this.sprite;
    if (!s.active) return;
    s.scene.tweens.add({ targets: s, x, y, scale: 0.3, duration: 350, ease: 'Quad.in', onComplete: () => s.destroy() });
  }
}

/** DOUBLE OR NOTHING button: hit it and he loses 15% HP, but you drop to 1 HP. Ignore it and he gets smug. */
class RedButton implements Hurtable {
  team = 'enemy' as const;
  alive = true;
  sprite: Phaser.GameObjects.Sprite;
  private label: Phaser.GameObjects.BitmapText;
  private count: Phaser.GameObjects.BitmapText;
  private timer: Phaser.Time.TimerEvent;
  private left: number;

  constructor(private boss: Fromage, x: number, top: number, floor: number) {
    const gs = boss.gs;
    this.sprite = gs.add.sprite(x, top, 'fbutton', 0).setDepth(LIFT);
    this.label = txt(gs, x, floor - 40, 'PRESS ME?', 10, '#ff8fb8').setDepth(LIFT + 1).setAlpha(0);
    this.left = Math.round(T.buttonMs / 1000);
    this.count = txt(gs, x, floor - 30, String(this.left), 10, '#ffffff').setDepth(LIFT + 1).setAlpha(0);
    gs.tweens.add({
      targets: this.sprite,
      y: floor - 7,
      duration: 380,
      ease: 'Bounce.out',
      onComplete: () => {
        if (!this.alive) return;
        gs.damage.register(this);
        this.label.setAlpha(1);
        this.count.setAlpha(1);
        gs.tweens.add({ targets: this.label, y: this.label.y - 3, yoyo: true, repeat: -1, duration: 300 });
      },
    });
    this.timer = gs.time.addEvent({
      delay: 1000,
      repeat: this.left - 1,
      callback: () => {
        this.left--;
        this.count.setText(String(this.left));
        sfx.wheelTick();
        if (this.left <= 0) this.end(false);
      },
    });
  }

  hurtRect(): Rect {
    return { x: this.sprite.x - 10, y: this.sprite.y - 7, w: 20, h: 14 };
  }

  receiveHit(hit: HitInfo): 'hit' | 'blocked' | 'ignored' {
    if (!this.alive || hit.kind === 'hazard') return 'ignored';
    this.sprite.setFrame(1);
    this.end(true);
    return 'hit';
  }

  private end(pressed: boolean): void {
    if (!this.alive) return;
    this.remove();
    this.boss.doubleOrNothing(pressed);
  }

  /** Take it away without a verdict (`instant`: no fade, e.g. scene shutdown). */
  remove(instant = false): void {
    if (!this.alive) return;
    this.alive = false;
    const gs = this.boss.gs;
    gs.damage.unregister(this);
    this.timer.remove();
    this.label.destroy();
    this.count.destroy();
    const s = this.sprite;
    if (instant) {
      s.destroy();
      return;
    }
    gs.tweens.add({ targets: s, alpha: 0, delay: 300, duration: 300, onComplete: () => s.destroy() });
  }
}
