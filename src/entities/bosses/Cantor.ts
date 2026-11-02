import Phaser from 'phaser';
import { Boss } from './Boss';
import { Hitbox } from '../../combat/Hitbox';
import type { Projectile } from '../Projectile';
import type { Rect } from '../../combat/types';
import { sfx } from '../../systems/sfx';
import { playMusic } from '../../systems/music';
import { bus } from '../../core/events';
import { txt } from '../../ui/text';
import { TILE } from '../../config';
import type { GameScene } from '../../scenes/GameScene';
import {
  CANTOR_HP, CANTOR_THRESHOLDS, CANTOR_HEARTS, CHAIN, SPEC, CARILLON_PUNISH, VESPERS_TAKEN, PUNISH_LAND,
  chooseMove, strikeTimes, windupMs, strikeGapMs, punishMs, idleMs, beatMs, delayToBeat, pealOrder, clapperX,
  type CantorMove as Move,
} from '../../combat/cantorPlan';

const BRONZE = 0xffb84d;
const GHOST = 0x9fd8ff;
const NAMES = ['CANTOR, THE TOLLING BELL', 'CANTOR (TERCE)', 'CANTOR (VESPERS)'];
const TRACKS = ['cantor', 'cantor2', 'cantor3'];
/** hovering: body bottom this far above the floor (one jump reaches it: openings are real) */
const HOVER_LIFT = 52;
/** peal column centres (x px) and half-width */
const PEAL_X = [96, 240, 384];
const PEAL_HALF = 28;
/** toll wave speed / swing reach per phase */
const WAVE_SPEED = [170, 185, 200];
/** synco lunge distance and duration */
const LUNGE_PX = 120;
const LUNGE_MS = 200;

/**
 * World 4-8: CANTOR, THE TOLLING BELL. The math-tuned boss: every timing comes from
 * combat/cantorPlan.ts, which derives it from combat/funMath.ts (Hick reaction floors, damage
 * budget, threat:opening rhythm, pick entropy) and is checked by a Monte Carlo sim
 * (tests/cantorSim.test.ts).
 *
 * The fight runs on a beat clock (100 / 115 / 130 BPM, matching the music): every strike lands on a
 * beat, the metronome ticks through each telegraph (accent = the strike), and every chain of
 * 2 / 3 / 4 moves gets a 2-beat count-in and ends with the bell slamming down next to you, dizzy.
 *  P1 Prime:   Swing (parryable rim swing), Toll (slams: jump the ring waves), Clapper (marked column drop)
 *  P2 Terce:   + Peal (three numbered bells ring down columns, one beat apart), Echo (last move, mirrored)
 *  P3 Vespers: + Syncopation (lunges on the off-beat, the one move that breaks the rule),
 *              Carillon (a hush, then toll / clapper / peal / heavy swing, then a long punish). Cracked: x1.15 damage taken.
 * First sighting of each move gets a x1.3 "tutorial" windup.
 */
export class Cantor extends Boss {
  private history: Move[] = [];
  private seen = new Set<Move>();
  /** last non-echo move (what Echo replays) */
  private lastPattern: Move = 'swing';
  private seq = 0;
  private chainLeft = 0;
  private chainFirst = true;
  /** beat clock: beats fall at origin + k * beat */
  private origin = 0;
  private lastBeat = -1;
  private tickUntil = 0;
  private accents: number[] = [];
  private temp: Phaser.GameObjects.GameObject[] = [];
  private boxes: Hitbox[] = [];
  private counters: Phaser.Tweens.Tween[] = [];

  constructor(gs: GameScene, x: number, y: number) {
    super(gs, x, y, 'cantor', NAMES[0], { hp: CANTOR_HP, bodyW: 28, bodyH: 32, gravity: false, contactDamage: 0, shards: 100 });
    this.thresholds = [...CANTOR_THRESHOLDS];
    this.deathTint = BRONZE;
    this.hearts = { ...CANTOR_HEARTS };
    this.origin = gs.time.now;
    // "Retry from Terce / Vespers": start straight in a later hour (the intro still plays)
    const st = gs.bossStage;
    if (st === 'p2' || st === 'p3') {
      const n = st === 'p2' ? 2 : 3;
      this.phase = n;
      this.hp = Math.floor(this.maxHp * this.thresholds[n - 2]);
      this.bossName = NAMES[n - 1];
      bus.emit('boss', this.bossName, this.hp, this.maxHp);
    }
    this.once(Phaser.GameObjects.Events.DESTROY, () => this.interruptFx());
  }

  private get ph(): number {
    return Math.min(3, this.phase) - 1;
  }
  private get beat(): number {
    return beatMs(this.ph);
  }
  private get sheetKey(): string {
    return this.phase <= 1 ? 'cantor' : `cantor-p${Math.min(3, this.phase)}`;
  }

  protected animKey(): string {
    const s = this.sheetKey;
    if (this.stunned) return s + '-stun';
    const pose = this.curPose;
    return pose ? s + '-' + pose : s + '-idle';
  }

  protected damageTakenMul(): number {
    return super.damageTakenMul() * (this.phase >= 3 ? VESPERS_TAKEN : 1);
  }

  // ------------------------------------------------------------------ arena geometry
  private get arenaL(): number {
    return TILE;
  }
  private get arenaR(): number {
    return this.gs.worldWidth - TILE;
  }
  private get floorY(): number {
    return 14 * TILE;
  }
  private get ceilY(): number {
    return TILE;
  }
  /** sprite y that puts the body bottom at `bottom` */
  private yFor(bottom: number): number {
    return bottom - (this.body.bottom - this.y);
  }
  private clampX(x: number, pad = 20): number {
    return Phaser.Math.Clamp(x, this.arenaL + pad, this.arenaR - pad);
  }
  private mirrorX(x: number): number {
    return this.arenaL + this.arenaR - x;
  }

  // ------------------------------------------------------------------ sequencing helpers
  private step(ms: number, fn: () => void): void {
    const s = this.seq;
    this.later(ms, () => {
      if (s === this.seq && !this.transforming) fn();
    });
  }

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

  private tween01(ms: number, ease: string, update: (t: number) => void, done?: () => void): void {
    const tw = this.gs.tweens.addCounter({
      from: 0,
      to: 1,
      duration: Math.max(1, ms),
      ease,
      onUpdate: (t) => update(t.getValue() ?? 0),
      onComplete: () => {
        this.counters = this.counters.filter((c) => c !== tw);
        done?.();
      },
    });
    this.counters.push(tw);
  }

  /** Move the (gravity-free) body to (x, bottom) over ms. */
  private glide(x: number, bottom: number, ms: number, ease = 'Sine.inOut', done?: () => void): void {
    const x0 = this.x, y0 = this.y, y1 = this.yFor(bottom);
    this.body.setVelocity(0, 0);
    this.tween01(ms, ease, (t) => {
      if (!this.alive || this.stunned) return;
      this.body.reset(Phaser.Math.Linear(x0, x, t), Phaser.Math.Linear(y0, y1, t));
    }, done);
  }

  /** A timed hazard (unparryable) whose rect is read every frame. */
  private hazard(rect: () => Rect, ms: number, damage = 1): void {
    const box = new Hitbox(
      'enemy',
      rect,
      (t) => {
        const r = t.hurtRect(), c = rect();
        return { damage, kbX: (r.x + r.w / 2 >= c.x + c.w / 2 ? 1 : -1) * 170, kbY: -220, sourceX: c.x + c.w / 2, parryable: false, kind: 'hazard' };
      },
      ms,
    ).ownedBy(this);
    this.boxes = this.boxes.filter((b) => !b.dead);
    this.boxes.push(this.gs.damage.add(box));
  }

  private interruptFx(): void {
    for (const c of this.counters) c.stop();
    this.counters = [];
    for (const o of this.temp) this.drop(o);
    this.temp = [];
    for (const b of this.boxes) b.kill();
    this.boxes = [];
    this.tickUntil = 0;
    this.accents = [];
  }

  private clearEnemyShots(): void {
    for (const p of [...this.gs.projectiles.getChildren()] as Projectile[]) {
      if (p.team !== 'enemy' || p.dead) continue;
      p.dead = true;
      p.hitbox.kill();
      this.gs.juice.burst(p.x, p.y, BRONZE, 4, 0.5);
      p.destroy();
    }
  }

  // ------------------------------------------------------------------ beat clock
  /**
   * Schedule move `m` so its first strike lands on a beat (Syncopation: on the "and").
   * `times` = strike moments in ms after the telegraph starts; `fn` runs at the telegraph start.
   * The metronome ticks from now until the last strike, accenting each strike.
   */
  private cue(m: Move, times: number[], fn: () => void): void {
    const now = this.gs.time.now;
    const countIn = this.chainFirst ? 2 * this.beat : 0;
    this.chainFirst = false;
    const origin = SPEC[m].offbeat ? this.origin + this.beat / 2 : this.origin;
    const delay = countIn + delayToBeat(now + countIn, origin, times[0], this.ph);
    const start = now + delay;
    this.tickUntil = start + times[times.length - 1] + 20;
    this.accents = SPEC[m].offbeat ? [] : times.map((t) => start + t);
    this.step(delay, fn);
  }

  private onBeat(now: number): void {
    if (now >= this.tickUntil) return;
    const accent = this.accents.some((a) => Math.abs(a - now) < 40);
    sfx.tick(accent);
    this.squash(accent ? 1.1 : 1.04, accent ? 0.92 : 0.97, 90);
  }

  // ------------------------------------------------------------------ AI
  protected think(dt: number): void {
    if (this.busy) {
      if (!this.counters.length) this.body.setVelocity(0, 0);
      return;
    }
    this.cooldown -= dt;
    // hover above and beside the player, bobbing on the beat
    const p = this.player;
    const side = this.x < p.x ? -1 : 1;
    const tx = this.clampX(p.x + side * 70);
    const bob = Math.sin(((this.gs.time.now - this.origin) / this.beat) * Math.PI) * 4;
    const ty = this.yFor(this.floorY - HOVER_LIFT) + bob;
    this.body.setVelocity((tx - this.x) * 1.8, (ty - this.y) * 2.4);
    this.facePlayer();
    this.setFlipX(this.facing < 0);
    if (this.cooldown > 0 || !p.alive) return;
    this.chainLeft = CHAIN[this.ph];
    this.chainFirst = true;
    this.next();
  }

  private next(): void {
    if (this.chainLeft <= 0) return this.endChain(false);
    this.chainLeft--;
    const dx = Math.abs(this.dxToPlayer());
    const high = this.player.y < this.floorY - 3 * TILE;
    const m = chooseMove(this.phase, dx, high, this.history, Math.random);
    this.run(m);
  }

  private run(m: Move): void {
    this.busy = true;
    this.history.push(m);
    if (this.history.length > 4) this.history.shift();
    const first = !this.seen.has(m);
    this.seen.add(m);
    if (m !== 'echo') this.lastPattern = m;
    if (first) this.gs.juice.floatText(this.x, this.y - 34, m === 'synco' ? 'SYNCOPATION' : m.toUpperCase(), '#ffd96a');
    this.body.setVelocity(0, 0);
    switch (m) {
      case 'swing': return this.swing(strikeTimes('swing', this.ph, first), false);
      case 'toll': return this.toll(strikeTimes('toll', this.ph, first));
      case 'clapper': return this.clapper(strikeTimes('clapper', this.ph, first), false);
      case 'peal': return this.peal(strikeTimes('peal', this.ph, first), false);
      case 'echo': return this.echo(first);
      case 'synco': return this.synco(strikeTimes('synco', this.ph, first));
      case 'carillon': return this.carillon(strikeTimes('carillon', this.ph, first));
    }
  }

  /** A move finished: the next one in the chain, or the punish slam. */
  private moveDone(after: number, carillon = false): void {
    this.step(after, () => {
      this.setPose('', 0);
      if (carillon) return this.endChain(true);
      this.next();
    });
  }

  /** Chain over: slam down next to the player and sit there, dizzy (the punish window). */
  private endChain(carillon: boolean): void {
    this.busy = true;
    const side = this.x < this.player.x ? -1 : 1;
    const x = this.clampX(this.player.x + side * PUNISH_LAND[this.ph]);
    this.setPose('slam', 400);
    this.glide(x, this.floorY, 280, 'Quad.in', () => {
      if (!this.alive) return;
      sfx.clang();
      this.gs.juice.shake(0.006, 140);
      this.gs.juice.burst(this.x, this.floorY - 2, BRONZE, 10, 0.9);
      this.recover(carillon ? CARILLON_PUNISH : punishMs(this.ph), 'dizzy', idleMs(this.ph));
    });
  }

  // ------------------------------------------------------------------ Swing
  /** Drops beside the player and swings its rim (parryable). P3: two swings, stepping in between. */
  private swing(times: number[], mirror: boolean): void {
    const p = this.player;
    let side = this.x < p.x ? -1 : 1;
    if (mirror) side = -side;
    const x = this.clampX(p.x + side * 52);
    this.glide(x, this.floorY, 260, 'Quad.out');
    this.cue('swing', times, () => {
      this.faceTo(p.x);
      this.setPose('windup', times[0]);
      this.telegraph(times[0], BRONZE);
      times.forEach((t, i) =>
        this.step(t, () => {
          this.setPose('strike', 220);
          sfx.toll(1.5);
          this.meleeBox(6, -20, 46, 40, 160, 1, true);
          this.gs.juice.burst(this.x + this.facing * 30, this.y, BRONZE, 6, 0.6);
          if (i < times.length - 1) this.glide(this.clampX(this.x + this.facing * 36), this.floorY, Math.min(240, strikeGapMs(this.ph) - 120));
        }),
      );
      this.moveDone(times[times.length - 1] + SPEC.swing.active);
    });
  }

  private faceTo(x: number): void {
    this.facing = x >= this.x ? 1 : -1;
    this.setFlipX(this.facing < 0);
  }

  // ------------------------------------------------------------------ Toll
  /** Slams the floor on the beat, 2-3 times: a ring wave runs each way from every slam. */
  private toll(times: number[]): void {
    const hover = this.floorY - 40;
    this.glide(this.x, hover, 240);
    this.cue('toll', times, () => {
      this.setPose('windup', times[0]);
      this.telegraph(times[0], BRONZE, true);
      times.forEach((t, i) => {
        this.step(Math.max(0, t - 120), () => this.glide(this.x, this.floorY, 120, 'Quad.in'));
        this.step(t, () => {
          this.setPose('slam', 200);
          sfx.toll(1);
          this.gs.juice.shake(0.005, 120);
          this.gs.juice.ring(this.x, this.floorY - 4, BRONZE, 1.4);
          this.shockwaves(WAVE_SPEED[this.ph], 1);
          if (i < times.length - 1) this.glide(this.x, hover, 180, 'Quad.out');
        });
      });
      this.moveDone(times[times.length - 1] + SPEC.toll.active);
    });
  }

  // ------------------------------------------------------------------ Clapper
  /** Marks 1-2 columns (both shown at once) and drops its clapper down each, on the beat. */
  private clapper(times: number[], mirror: boolean): void {
    this.setPose('windup', 300);
    this.cue('clapper', times, () => {
      let x0 = clapperX(this.player.x, this.arenaL + 12, this.arenaR - 12, Math.random);
      if (mirror) x0 = this.mirrorX(x0);
      const xs = [x0];
      for (let i = 1; i < times.length; i++) {
        const d = x0 < (this.arenaL + this.arenaR) / 2 ? 1 : -1;
        xs.push(this.clampX(x0 + d * 56 * i, 12));
      }
      this.telegraph(times[0], BRONZE, true);
      xs.forEach((x, i) => {
        const mark = this.keep(this.gs.add.rectangle(x, (this.ceilY + this.floorY) / 2, 18, this.floorY - this.ceilY, 0xff1a1a, 0.18).setDepth(14));
        this.gs.tweens.add({ targets: mark, alpha: 0.05, yoyo: true, repeat: -1, duration: 110 });
        const num = this.keep(txt(this.gs, x, this.floorY - 10, String(i + 1), 8, '#ff8080'));
        const fall = 160;
        this.step(times[i] - fall, () => {
          const c = this.keep(this.gs.add.sprite(x, this.ceilY + 8, 'cantor-clapper').setDepth(16));
          this.gs.tweens.add({ targets: c, y: this.floorY - 9, duration: fall, ease: 'Quad.in' });
        });
        this.step(times[i], () => {
          this.drop(mark);
          this.drop(num);
          sfx.toll(1.9);
          this.gs.juice.burst(x, this.floorY - 2, 0xd8d0c4, 8, 0.7);
          this.hazard(() => ({ x: x - 9, y: this.ceilY, w: 18, h: this.floorY - this.ceilY }), 120);
        });
      });
      this.moveDone(times[times.length - 1] + SPEC.clapper.active);
    });
  }

  // ------------------------------------------------------------------ Peal
  /** Three numbered bells: each rings its column down, one beat apart (the order is shown up front). */
  private peal(times: number[], mirror: boolean): void {
    this.setPose('roar', 400);
    const pcol = PEAL_X.reduce((best, x, i) => (Math.abs(x - this.player.x) < Math.abs(PEAL_X[best] - this.player.x) ? i : best), 0);
    const order = pealOrder(pcol, Math.random, mirror).slice(0, times.length);
    this.cue('peal', times, () => {
      this.telegraph(times[0], BRONZE, true);
      order.forEach((col, i) => {
        const x = PEAL_X[col];
        const bell = this.keep(this.gs.add.sprite(x, this.ceilY + 10, 'cantor-minibell', 0).setDepth(16));
        const num = this.keep(txt(this.gs, x, this.ceilY + 26, String(i + 1), 8, '#ffd96a'));
        const lane = this.keep(this.gs.add.rectangle(x, (this.ceilY + this.floorY) / 2 + 12, PEAL_HALF * 2, this.floorY - this.ceilY - 24, 0xff1a1a, i === 0 ? 0.2 : 0.08).setDepth(14));
        this.gs.tweens.add({ targets: lane, alpha: i === 0 ? 0.08 : 0.03, yoyo: true, repeat: -1, duration: 120 });
        this.step(times[i], () => {
          bell.setFrame(1);
          sfx.toll(2.2 - i * 0.25);
          this.drop(lane);
          this.drop(num);
          const blast = this.keep(this.gs.add.rectangle(x, (this.ceilY + this.floorY) / 2 + 12, PEAL_HALF * 2, this.floorY - this.ceilY - 24, 0xffd96a, 0.55).setDepth(15).setBlendMode(Phaser.BlendModes.ADD));
          this.gs.tweens.add({ targets: blast, alpha: 0, duration: 260, onComplete: () => this.drop(blast) });
          this.hazard(() => ({ x: x - PEAL_HALF, y: this.ceilY + 24, w: PEAL_HALF * 2, h: this.floorY - this.ceilY - 24 }), 140);
          this.step(300, () => this.drop(bell));
        });
      });
      this.moveDone(times[times.length - 1] + SPEC.peal.active);
    });
  }

  // ------------------------------------------------------------------ Echo
  /** Replays the last pattern mirrored, at Echo's shorter (already-learned) windup. */
  private echo(first: boolean): void {
    const m = this.lastPattern;
    const n = Math.max(1, SPEC[m].strikes[this.ph]);
    const w = windupMs('echo', this.ph, first);
    const times = Array.from({ length: n }, (_, i) => Math.round(w + i * strikeGapMs(this.ph)));
    this.setTint(GHOST);
    this.gs.juice.floatText(this.x, this.y - 22, 'ECHO', '#9fd8ff');
    this.step(times[n - 1] + 400, () => this.clearTint());
    switch (m) {
      case 'swing': return this.swing(times, true);
      case 'clapper': return this.clapper(times, true);
      case 'peal': return this.peal(times, true);
      default: return this.toll(times); // symmetric anyway
    }
  }

  // ------------------------------------------------------------------ Syncopation
  /** Lands, then lunges low along the floor twice, on the off-beats (no accent: watch, don't listen). */
  private synco(times: number[]): void {
    const p = this.player;
    const side = this.x < p.x ? -1 : 1;
    this.glide(this.clampX(p.x + side * 130), this.floorY, 260, 'Quad.out');
    this.cue('synco', times, () => {
      this.faceTo(p.x);
      this.setPose('windup', times[0]);
      this.telegraph(times[0], 0xff4d8a, true);
      times.forEach((t) =>
        this.step(t, () => {
          this.faceTo(this.player.x);
          this.setPose('strike', LUNGE_MS + 60);
          sfx.toll(1.25);
          const to = this.clampX(this.x + this.facing * LUNGE_PX);
          this.glide(to, this.floorY, LUNGE_MS, 'Quad.out');
          this.hazard(() => ({ x: this.body.left - 2, y: this.body.bottom - 22, w: this.body.width + 4, h: 22 }), LUNGE_MS);
          this.gs.juice.burst(this.x, this.floorY - 2, 0xff4d8a, 6, 0.6);
        }),
      );
      this.moveDone(times[times.length - 1] + LUNGE_MS + SPEC.synco.active);
    });
  }

  // ------------------------------------------------------------------ Carillon
  /** P3 finale: a hush, then toll / clapper / peal / heavy swing on four beats, then a long punish. */
  private carillon(times: number[]): void {
    const p = this.player;
    // the hush: every lingering wave is silenced, so it never stacks with this
    this.clearEnemyShots();
    this.gs.juice.floatText(this.x, this.y - 34, 'CARILLON', '#ff8fb8');
    const side = this.x < p.x ? -1 : 1;
    this.glide(this.clampX(p.x + side * 56), this.floorY - 30, 300, 'Quad.out');
    this.cue('carillon', times, () => {
      this.faceTo(p.x);
      this.setPose('roar', times[0]);
      this.telegraph(times[0], 0xff8fb8, false);
      const cx = this.clampX(p.x, 12);
      const pcol = PEAL_X.reduce((best, x, i) => (Math.abs(x - p.x) < Math.abs(PEAL_X[best] - p.x) ? i : best), 0);
      const px = PEAL_X[pcol];
      // everything is marked at the reveal
      const mark = this.keep(this.gs.add.rectangle(cx, (this.ceilY + this.floorY) / 2, 18, this.floorY - this.ceilY, 0xff1a1a, 0.15).setDepth(14));
      const lane = this.keep(this.gs.add.rectangle(px, (this.ceilY + this.floorY) / 2 + 12, PEAL_HALF * 2, this.floorY - this.ceilY - 24, 0xff1a1a, 0.06).setDepth(14));
      // 1: toll slam
      this.step(Math.max(0, times[0] - 120), () => this.glide(this.x, this.floorY, 120, 'Quad.in'));
      this.step(times[0], () => {
        this.setPose('slam', 200);
        sfx.toll(0.9);
        this.gs.juice.ring(this.x, this.floorY - 4, BRONZE, 1.6);
        this.shockwaves(WAVE_SPEED[this.ph], 1);
      });
      // 2: clapper down the marked column
      this.step(times[1] - 160, () => {
        const c = this.keep(this.gs.add.sprite(cx, this.ceilY + 8, 'cantor-clapper').setDepth(16));
        this.gs.tweens.add({ targets: c, y: this.floorY - 9, duration: 160, ease: 'Quad.in' });
      });
      this.step(times[1], () => {
        this.drop(mark);
        sfx.toll(1.9);
        this.hazard(() => ({ x: cx - 9, y: this.ceilY, w: 18, h: this.floorY - this.ceilY }), 120);
      });
      // 3: one peal column
      this.step(times[2], () => {
        this.drop(lane);
        sfx.toll(2.2);
        const blast = this.keep(this.gs.add.rectangle(px, (this.ceilY + this.floorY) / 2 + 12, PEAL_HALF * 2, this.floorY - this.ceilY - 24, 0xffd96a, 0.55).setDepth(15).setBlendMode(Phaser.BlendModes.ADD));
        this.gs.tweens.add({ targets: blast, alpha: 0, duration: 260, onComplete: () => this.drop(blast) });
        this.hazard(() => ({ x: px - PEAL_HALF, y: this.ceilY + 24, w: PEAL_HALF * 2, h: this.floorY - this.ceilY - 24 }), 140);
        this.setPose('windup', times[3] - times[2]);
      });
      // 4: the heavy swing (2 damage, parryable) from where it slammed
      this.step(times[3], () => {
        this.setPose('strike', 260);
        sfx.toll(0.8);
        this.gs.juice.shake(0.008, 160);
        this.meleeBox(6, -24, 54, 44, 180, SPEC.carillon.lastDmg ?? 2, true, 240);
      });
      this.moveDone(times[3] + SPEC.carillon.active, true);
    });
  }

  // ------------------------------------------------------------------ phases
  protected onPhase(n: number): void {
    this.seq++;
    this.interruptFx();
    this.chainLeft = 0;
    this.cancelRecover();
    this.setPose('roar', 1500);
    this.body.setVelocity(0, 0);
    this.transform(1500);
    this.bossName = NAMES[Math.min(3, n) - 1];
    bus.emit('boss', this.bossName, Math.max(0, this.hp), this.maxHp);
    this.gs.bossStage = n === 2 ? 'p2' : 'p3';
    sfx.toll(0.7);
    this.gs.juice.floatText(this.x, this.y - 36, n === 2 ? 'TERCE' : 'VESPERS', n === 2 ? '#ffd96a' : '#ff8fb8');
    // the music changes tempo; the beat clock restarts with it
    playMusic(TRACKS[Math.min(3, n) - 1]);
    this.origin = this.gs.time.now + 100;
    this.lastBeat = -1;
  }

  die(reward = true): void {
    if (this.alive) {
      this.seq++;
      this.interruptFx();
      this.clearEnemyShots();
      sfx.toll(0.6);
    }
    super.die(reward);
  }

  tick(time: number, dt: number): void {
    super.tick(time, dt);
    if (!this.alive) return;
    const now = this.gs.time.now;
    const k = Math.floor((now - this.origin) / this.beat);
    if (k !== this.lastBeat) {
      this.lastBeat = k;
      this.onBeat(now);
    }
  }
}
