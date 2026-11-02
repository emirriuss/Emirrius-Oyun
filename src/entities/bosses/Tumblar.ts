import Phaser from 'phaser';
import { Boss } from './Boss';
import { Hitbox } from '../../combat/Hitbox';
import type { Projectile } from '../Projectile';
import type { HitInfo, Rect } from '../../combat/types';
import { sfx } from '../../systems/sfx';
import { playMusic } from '../../systems/music';
import { bus } from '../../core/events';
import { txt, type PxText } from '../../ui/text';
import { TILE } from '../../config';
import type { GameScene } from '../../scenes/GameScene';
import {
  TUMBLAR_HP, TUMBLAR_THRESHOLDS, TUMBLAR_HEARTS, TUMBLAR_NAMES, UNLOCK_CHUNK, PUNISH_MS, ATTACK_GAP, TELE, DEADBOLT_BANDS, HINT_AFTER,
  PINS, NOTCHES, applyPin, pinStatus, pinsSolved, solvePins, makePinLock, springPick, springPin,
  turnDial, relockDial, makeDial, BOLTS, pressBolt, solveBolts, makeBolts, rekeyPick,
  chooseTumblarMove, tumblarResume,
  type PinLock, type PinState, type DialLock, type DialState, type Dir, type TumblarMove as Move,
} from '../../combat/tumblarPlan';
import { PinHead, DialProp, BoltProp, BRASS, GOLD, LINK_SAME, LINK_OPP } from './tumblarProps';

const TRACKS = ['tumblar', 'tumblar2', 'tumblar3'];
/** lock-part columns (pins in P1, bolts in P3), x px */
const COL_X = [64, 128, 192, 256, 320];
/** pin head centre y above the floor at notch 0, and per notch */
const NOTCH0 = 26;
const NOTCH_STEP = 18;
/** the dial hangs here (centre, px above the floor) */
const DIAL_X = 200;
const DIAL_LIFT = 72;
const KEY_SPEED = [180, 200, 215];
const DEADBOLT_SPEED = 560;
const GEAR_SPEED = 150;

/**
 * World 4-9: TUMBLAR, THE KEYLESS DOOR. A lock-picking puzzle boss (rules in combat/tumblarPlan.ts).
 * The steel shell blocks every hit (reflected shots chip it). Picking the current lock opens the
 * keyhole core: a fixed UNLOCK_CHUNK of HP plus a punish window. Its attacks only pressure you.
 *  P1 The Tumblers: five pin heads (one-way ledges). Up-slash raises, slam lowers; match the gold marks.
 *                   Later locks: linked pins (a chain: blue = same way, pink = opposite) and a spool pin
 *                   (waisted; only sets when lowered into place). Attacks: Deadbolt, Key Toss, Spring Back.
 *  P2 The Dial:     strike from the left = turn right, from the right = turn left (heavy = 3). The
 *                   contact click marks the number; reverse on it to lock the digit in (R, L, R).
 *                   Attacks: + Numerals, Tumbler Gears, Relock (a hook flies at the dial: parry or block it).
 *  P3 The Wards:    five floor bolts; a strike flips a bolt and its neighbours. Re-key presses one for it.
 *                   At 1 HP: THE LAST KEY. It throws its key; parry it back into the keyhole to win.
 * After two moves in a row that don't bring a lock closer, the next right move glows (hint).
 */
export class Tumblar extends Boss {
  private seq = 0;
  private history: Move[] = [];
  private temp: Phaser.GameObjects.GameObject[] = [];
  private boxes: Hitbox[] = [];
  private counters: Phaser.Tweens.Tween[] = [];
  /** core open (a lock was picked): takes damage */
  private coreOpen = false;
  /** a lock is live and can be worked */
  private lockLive = false;
  /** locks opened this phase */
  private round = 0;
  /** moves in a row that didn't bring the lock closer */
  private stall = 0;
  private hint?: Phaser.GameObjects.GameObject;
  private tips = new Set<string>();
  /** when the current tip line clears (new tips queue behind it) */
  private tipFree = 0;
  // P1
  private pins: PinHead[] = [];
  private pinLock?: PinLock;
  private pinState?: PinState;
  private pinGfx?: Phaser.GameObjects.Graphics;
  // P2
  private dial?: DialProp;
  private dialLock?: DialLock;
  private dialState?: DialState;
  private pips?: PxText;
  private hook?: Projectile;
  private slips = 0;
  // P3
  private bolts: BoltProp[] = [];
  private boltBits = 0;
  // finale
  private finale = false;
  private finaleKey?: Projectile;
  private keyPending = false;
  /** player was mid-slam last frame (a slam that lands on a pin head lowers it) */
  private wasSlamming = false;
  /** the current slam already lowered a pin (one notch per slam, however it lands) */
  private slamSpent = false;

  constructor(gs: GameScene, x: number, y: number) {
    super(gs, x, y, 'tumblar', TUMBLAR_NAMES[0], { hp: TUMBLAR_HP, bodyW: 36, bodyH: 64, contactDamage: 0, shards: 120 });
    this.thresholds = [...TUMBLAR_THRESHOLDS];
    this.deathTint = BRASS;
    this.hearts = { ...TUMBLAR_HEARTS };
    this.cooldown = 3200;
    // "Retry from The Dial / The Wards"
    const r = tumblarResume(gs.bossStage);
    if (r) {
      this.phase = r.phase;
      this.hp = Math.floor(this.maxHp * r.hpFrac);
      this.bossName = TUMBLAR_NAMES[r.phase - 1];
      bus.emit('boss', this.bossName, this.hp, this.maxHp);
    }
    this.pinGfx = gs.add.graphics().setDepth(11);
    this.setupPhase(this.phase);
    this.once(Phaser.GameObjects.Events.DESTROY, () => {
      this.interruptFx();
      this.teardown(true);
      this.pinGfx?.destroy();
    });
  }

  private get ph(): number {
    return Math.min(3, this.phase) - 1;
  }
  private get sheetKey(): string {
    return this.phase <= 1 ? 'tumblar' : `tumblar-p${Math.min(3, this.phase)}`;
  }
  private get floorY(): number {
    return 14 * TILE;
  }
  private get ceilY(): number {
    return TILE;
  }
  private get arenaL(): number {
    return TILE;
  }

  protected animKey(): string {
    const s = this.sheetKey;
    if (this.stunned) return s + '-stun';
    if (this.coreOpen) return s + '-open';
    const pose = this.curPose;
    return pose ? s + '-' + pose : s + '-idle';
  }

  // ------------------------------------------------------------------ shell / core
  protected filterHit(hit: HitInfo): 'hit' | 'blocked' {
    if (this.finale) return hit.parried && hit.kind === 'projectile' ? 'hit' : 'blocked';
    if (this.coreOpen || hit.parried) return 'hit';
    return 'blocked';
  }

  protected onHurt(hit: HitInfo): void {
    if (this.finale) {
      // the key went home
      if (hit.parried && hit.kind === 'projectile') this.hp = 0;
    } else if (this.phase >= 3 && this.hp <= 0) {
      // it never dies to a sword: at the last notch it throws its key
      this.hp = 1;
      this.startFinale();
    }
    super.onHurt(hit);
  }

  /** A picked lock costs the door a fixed chunk, straight through the shell. */
  private chunk(amount: number): void {
    this.hp -= amount;
    this.gs.juice.flash(this, 120, GOLD);
    this.gs.juice.floatText(this.x, this.y - 40, String(amount), '#ffd96a');
    this.onHurt({ damage: amount, kbX: 0, kbY: 0, sourceX: this.x, kind: 'melee' });
    if (this.hp <= 0 && this.alive) this.die(true);
  }

  // ------------------------------------------------------------------ helpers
  private step(ms: number, fn: () => void): void {
    const s = this.seq;
    this.later(ms, () => {
      if (s === this.seq && !this.transforming && !this.finale) fn();
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
  }

  private clearEnemyShots(): void {
    for (const p of [...this.gs.projectiles.getChildren()] as Projectile[]) {
      if (p.team !== 'enemy' || p.dead) continue;
      p.dead = true;
      p.hitbox.kill();
      this.gs.juice.burst(p.x, p.y, BRASS, 4, 0.5);
      p.destroy();
    }
    this.hook = undefined;
  }

  /** One-time instruction line at the top of the screen; tips queue so they never overlap. */
  private tip(id: string, text: string, ms = 4200): void {
    if (this.tips.has(id)) return;
    this.tips.add(id);
    const now = this.gs.time.now;
    const delay = Math.max(0, this.tipFree - now);
    this.tipFree = now + delay + ms + 600;
    if (delay > 0) this.later(delay, () => this.showTip(text, ms));
    else this.showTip(text, ms);
  }

  private showTip(text: string, ms: number): void {
    // below the HUD panels; long tips wrap onto two lines at the triple space
    const lines = text.split('   ');
    const mid = Math.ceil(lines.length / 2);
    const two = lines.length > 1 && text.length > 44 ? [lines.slice(0, mid).join('   '), lines.slice(mid).join('   ')] : [lines.join('   ')];
    const t = this.keep(txt(this.gs, this.gs.worldWidth / 2, this.ceilY + 48, two.join('\n'), 8, '#ffd96a').setDepth(40).setAlpha(0));
    this.gs.tweens.add({ targets: t, alpha: 1, duration: 250, hold: ms, yoyo: true, onComplete: () => this.drop(t) });
  }

  /** Glow over the next right move. */
  private showHint(x: number, y: number, label: string): void {
    this.drop(this.hint);
    const t = this.keep(txt(this.gs, x, y, label, 8, '#ffd96a').setDepth(40));
    this.gs.tweens.add({ targets: t, y: y - 4, alpha: 0.3, yoyo: true, repeat: 3, duration: 220, onComplete: () => this.drop(t) });
    this.hint = t;
  }

  private progress(closer: boolean, hint: () => void): void {
    if (closer) {
      this.stall = 0;
      return;
    }
    if (++this.stall >= HINT_AFTER) {
      this.stall = 0;
      hint();
    }
  }

  // ------------------------------------------------------------------ phases + locks
  private setupPhase(n: number): void {
    if (n !== this.phase || !this.alive) return;
    this.teardown();
    this.round = 0;
    this.stall = 0;
    this.newLock();
  }

  /** Remove every lock part (phase change / death). */
  private teardown(quiet = false): void {
    this.lockLive = false;
    for (const p of this.pins) p.destroy(quiet);
    this.pins = [];
    this.pinLock = undefined;
    this.pinState = undefined;
    this.pinGfx?.clear();
    this.dial?.destroy(quiet);
    this.dial = undefined;
    this.dialLock = undefined;
    this.dialState = undefined;
    this.drop(this.pips);
    this.pips = undefined;
    for (const b of this.bolts) b.destroy();
    this.bolts = [];
    this.drop(this.hint);
  }

  /** Present the next lock of this phase. */
  private newLock(): void {
    if (!this.alive || this.finale) return;
    const r = this.round;
    sfx.tick(true);
    if (this.phase <= 1) {
      const { lock, start } = makePinLock(r, Math.random);
      this.pinLock = lock;
      this.pinState = start;
      if (!this.pins.length)
        COL_X.forEach((x, i) => this.pins.push(new PinHead(this.gs, i, x, this.notchY(start.h[i]), (k, d) => this.onPin(k, d))));
      this.pins.forEach((p, i) => p.moveTo(this.notchY(start.h[i]), 260, 'Sine.inOut'));
      this.refreshPins();
      this.tip('pins', 'UP-SLASH RAISES A PIN   SLAM LOWERS IT   MATCH THE GOLD MARKS');
      if (lock.links.length) this.tip('links', 'LINKED PINS MOVE TOGETHER   BLUE = SAME WAY   PINK = OPPOSITE');
      if (lock.spool >= 0) this.tip('spool', 'THE WAISTED PIN ONLY SETS WHEN YOU LOWER IT INTO PLACE');
    } else if (this.phase === 2) {
      this.dialLock = makeDial(Math.random);
      this.dialState = { pos: 0, got: 0, last: 0 };
      this.slips = 0;
      if (!this.dial) this.dial = new DialProp(this.gs, DIAL_X, this.floorY - DIAL_LIFT, this.ceilY, (d, s) => this.onDial(d, s));
      this.dial.showPos(0, 1, 0);
      if (!this.pips) this.pips = txt(this.gs, DIAL_X, this.floorY - DIAL_LIFT - 46, '', 8, '#ffd96a').setDepth(13);
      this.refreshPips();
      this.tip('dial', 'STRIKE FROM THE LEFT TO TURN R   LISTEN FOR THE CLICK   REVERSE TO LOCK IT IN');
    } else {
      this.boltBits = makeBolts(r, Math.random);
      if (!this.bolts.length) COL_X.forEach((x, i) => this.bolts.push(new BoltProp(this.gs, i, x, this.floorY, (k) => this.onBolt(k))));
      this.refreshBolts();
      this.tip('bolts', 'EVERY STRIKE FLIPS A BOLT AND ITS NEIGHBOURS   DRAW THEM ALL');
    }
    this.lockLive = true;
  }

  /** The lock is picked: chunk, core open, punish window, then the next lock. */
  private unlock(): void {
    if (!this.lockLive) return;
    this.lockLive = false;
    this.seq++;
    this.interruptFx();
    this.clearEnemyShots();
    this.drop(this.hint);
    sfx.unlock();
    this.gs.juice.ring(this.x, this.y, GOLD, 2.2);
    this.gs.juice.slowmo(0.4, 220);
    this.gs.juice.floatText(this.x, this.y - 50, 'UNLOCKED', '#ffd96a');
    this.round++;
    const phase = this.phase;
    this.coreOpen = true;
    this.chunk(UNLOCK_CHUNK);
    if (!this.alive || this.finale || this.phase !== phase) return; // onPhase / the finale took over
    const ms = PUNISH_MS[this.ph];
    this.recover(ms, 'open', 700);
    const s = this.seq;
    this.later(ms, () => {
      if (s !== this.seq || this.finale) return;
      this.coreOpen = false;
      sfx.clang();
      this.newLock();
    });
  }

  protected onPhase(n: number): void {
    this.seq++;
    this.interruptFx();
    this.clearEnemyShots();
    this.cancelRecover();
    this.teardown();
    this.coreOpen = false;
    this.setPose('roar', 1600);
    this.transform(1600, () => this.setupPhase(n));
    this.bossName = TUMBLAR_NAMES[Math.min(3, n) - 1];
    bus.emit('boss', this.bossName, Math.max(1, this.hp), this.maxHp);
    this.gs.bossStage = n === 2 ? 'p2' : 'p3';
    playMusic(TRACKS[Math.min(3, n) - 1]);
    sfx.unlock();
    this.gs.juice.floatText(this.x, this.y - 50, n === 2 ? 'THE DIAL' : 'THE WARDS', n === 2 ? '#7fdbff' : '#ff8fb8');
    this.cooldown = 2400;
  }

  // ------------------------------------------------------------------ P1 pins
  private notchY(k: number): number {
    return this.floorY - NOTCH0 - k * NOTCH_STEP;
  }

  private onPin(i: number, d: 1 | -1): void {
    if (!this.lockLive || !this.pinLock || !this.pinState) return;
    if (d < 0) {
      if (this.slamSpent) return;
      this.slamSpent = true;
    }
    const lock = this.pinLock;
    const before = solvePins(lock, this.pinState).dist;
    const next = applyPin(lock, this.pinState, i, d);
    if (!next) {
      sfx.jam();
      this.gs.juice.floatText(COL_X[i], this.pins[i].y - 12, 'JAMMED', '#8b8ba8');
      this.progress(false, () => this.pinHint());
      return;
    }
    const prev = this.pinState;
    this.pinState = next;
    for (let k = 0; k < PINS; k++) if (next.h[k] !== prev.h[k]) this.pins[k].moveTo(this.notchY(next.h[k]));
    const st = pinStatus(lock, next, i);
    if (st === 'set') sfx.pinSet(true);
    else if (st === 'false') {
      sfx.pinSet(false);
      this.gs.juice.floatText(COL_X[i], this.pins[i].y - 12, 'FALSE SET', '#ff9f1c');
    } else sfx.tick(false);
    this.refreshPins();
    if (pinsSolved(lock, next)) return this.unlock();
    this.progress(solvePins(lock, next).dist < before, () => this.pinHint());
  }

  /**
   * A slam stops dead on a pin head (it's a solid ledge), and the slam's hitbox dies the frame it lands,
   * often before it overlaps the head. So landing out of a slam on top of a head also counts as a slam
   * on it (the head's own cooldown stops a hitbox hit and the landing from counting twice).
   */
  private tickSlamLanding(): void {
    const p = this.player;
    const slamming = p.alive && p.fsm.is('slam');
    if (slamming && !this.wasSlamming) this.slamSpent = false;
    if (this.wasSlamming && !slamming && p.alive && p.grounded) {
      const b = p.body;
      const head = this.pins.find((h) => Math.abs(b.bottom - h.zone.body.top) < 4 && b.right > h.zone.body.left && b.left < h.zone.body.right);
      if (head) head.receiveHit({ damage: 0, kbX: 0, kbY: 0, sourceX: p.x, slam: true, kind: 'melee' });
    }
    this.wasSlamming = slamming;
  }

  private pinHint(): void {
    if (!this.pinLock || !this.pinState) return;
    const { next } = solvePins(this.pinLock, this.pinState);
    if (!next) return;
    const p = this.pins[next.i];
    this.showHint(p.x, p.y - 14, next.d > 0 ? 'UP-SLASH' : 'SLAM');
  }

  /** Head frames + the column rails, gold target marks, and link chains. */
  private refreshPins(): void {
    const lock = this.pinLock, st = this.pinState;
    if (!lock || !st) return;
    this.pins.forEach((p, i) => {
      const s = pinStatus(lock, st, i);
      const spool = i === lock.spool;
      p.setFrame(spool ? (s === 'set' ? 4 : s === 'false' ? 3 : 2) : s === 'set' ? 1 : 0);
    });
    this.drawPinGfx();
  }

  private drawPinGfx(): void {
    const g = this.pinGfx;
    const lock = this.pinLock;
    if (!g || !lock || !this.pins.length) return;
    g.clear();
    const top = this.notchY(NOTCHES - 1) - 8;
    COL_X.forEach((x, i) => {
      // rail + notch ticks
      g.fillStyle(0x1c1430, 0.9).fillRect(x - 1, top, 2, this.floorY - top);
      for (let k = 0; k < NOTCHES; k++) g.fillStyle(0x463a66, 1).fillRect(x - 3, this.notchY(k), 6, 1);
      // gold shear-line brackets at the target notch
      const ty = this.notchY(lock.target[i]);
      g.fillStyle(GOLD, 0.9);
      g.fillRect(x - 18, ty - 5, 2, 10).fillRect(x - 18, ty - 5, 4, 1).fillRect(x - 18, ty + 4, 4, 1);
      g.fillRect(x + 16, ty - 5, 2, 10).fillRect(x + 14, ty - 5, 4, 1).fillRect(x + 14, ty + 4, 4, 1);
      // spring under the head
      const hy = this.pins[i].y + 4;
      g.lineStyle(1, 0x9c7a54, 0.8);
      for (let y = hy; y < this.floorY - 3; y += 4) g.lineBetween(x - 3, y, x + 3, y + 2);
    });
    for (const l of lock.links) {
      const a = this.pins[l.from], b = this.pins[l.to];
      const c = l.sign > 0 ? LINK_SAME : LINK_OPP;
      g.lineStyle(1, c, 0.85).lineBetween(a.x + (b.x > a.x ? 14 : -14), a.y, b.x + (b.x > a.x ? -14 : 14), b.y);
      // driver mark (a filled pip) and follower ring
      g.fillStyle(c, 1).fillCircle(a.x, a.y - 7, 2);
      g.lineStyle(1, c, 1).strokeCircle(b.x, b.y - 7, 2.5);
    }
  }

  // ------------------------------------------------------------------ P2 dial
  private onDial(dir: Dir, steps: number): void {
    if (!this.lockLive || !this.dialLock || !this.dialState || !this.dial) return;
    const lock = this.dialLock;
    const gotBefore = this.dialState.got;
    const { st, events } = turnDial(lock, this.dialState, dir, steps);
    this.dialState = st;
    this.dial.showPos(st.pos, dir, steps);
    for (const e of events) {
      if (e === 'contact') {
        sfx.dialContact();
        this.gs.juice.spark(DIAL_X, this.floorY - DIAL_LIFT - 30, -Math.PI / 2, GOLD, 1);
        this.gs.juice.shake(0.002, 60);
        this.dial.flashNumber(lock.combo[st.got]);
      } else if (e === 'capture') {
        sfx.pinSet(true);
        this.gs.juice.floatText(DIAL_X, this.floorY - DIAL_LIFT - 56, 'LOCKED IN', '#ffd96a');
      } else if (e === 'slip') {
        sfx.jam();
        this.gs.juice.floatText(DIAL_X, this.floorY - DIAL_LIFT - 56, 'SLIP', '#8b8ba8');
        this.slips++;
      }
    }
    if (!events.length) sfx.tick(false);
    this.refreshPips();
    if (events.includes('open')) return this.unlock();
    if (st.got > gotBefore) this.slips = 0;
    if (this.slips >= HINT_AFTER) {
      this.slips = 0;
      const want = lock.combo[st.got];
      this.dial.flashNumber(want, '#ff8fb8', 1400);
      this.showHint(DIAL_X, this.floorY - DIAL_LIFT + 44, `TURN ${lock.dirs[st.got] > 0 ? 'R' : 'L'} TO ${want}`);
    }
  }

  private refreshPips(): void {
    if (!this.pips || !this.dialLock || !this.dialState) return;
    const { got } = this.dialState;
    const marks = this.dialLock.dirs.map((_d, k) => (k < got ? '■' : '□')).join(' ');
    const need = got < 3 ? (this.dialLock.dirs[got] > 0 ? '  TURN R' : '  TURN L') : '';
    this.pips.setText(marks + need);
  }

  // ------------------------------------------------------------------ P3 bolts
  private onBolt(i: number): void {
    if (!this.lockLive) return;
    const before = solveBolts(this.boltBits).dist;
    this.boltBits = pressBolt(this.boltBits, i);
    sfx.bolt();
    this.refreshBolts();
    if (this.boltBits === 0) return this.unlock();
    this.progress(solveBolts(this.boltBits).dist < before, () => {
      const { next } = solveBolts(this.boltBits);
      if (next !== null) this.showHint(COL_X[next], this.floorY - 38, 'HERE');
    });
  }

  private refreshBolts(): void {
    this.bolts.forEach((b, i) => b.setThrown(((this.boltBits >> i) & 1) === 1));
  }

  // ------------------------------------------------------------------ AI
  protected think(dt: number): void {
    this.body.setVelocityX(0);
    if (this.finale || this.busy) return;
    this.cooldown -= dt;
    if (this.cooldown > 0 || !this.player.alive || !this.lockLive) return;
    const progress =
      this.phase <= 1 && this.pinLock && this.pinState ? [0, 1, 2, 3, 4].filter((i) => pinStatus(this.pinLock!, this.pinState!, i) === 'set').length
      : this.phase === 2 ? this.dialState?.got ?? 0
      : solveBolts(this.boltBits).dist;
    const high = this.player.y < this.floorY - 3 * TILE;
    const m = chooseTumblarMove(this.phase, { progress, high }, this.history, Math.random);
    this.history.push(m);
    if (this.history.length > 4) this.history.shift();
    this[m]();
  }

  private gap(): number {
    return ATTACK_GAP[this.ph];
  }

  /** A bar slides out of the door across one height band (P2+: two bars, both bands). Red. */
  private deadbolt(): void {
    const tele = TELE.deadbolt[this.ph];
    const pHigh = this.player.y < this.floorY - 36;
    const first = pHigh ? 1 : 0;
    const bands = this.phase >= 2 ? [first, 1 - first] : [first];
    const total = tele + bands.length * 650 + 500;
    this.attack(total, this.gap(), () => {
      this.setPose('windup', tele);
      this.telegraph(tele, 0xff5400, true);
      bands.forEach((band, n) => {
        const [hi, lo] = DEADBOLT_BANDS[band];
        const y0 = this.floorY - hi, h = hi - lo;
        const x1 = this.body.left;
        const lane = this.keep(this.gs.add.rectangle((this.arenaL + x1) / 2, y0 + h / 2, x1 - this.arenaL, h, 0xff1a1a, 0.16).setDepth(14));
        this.gs.tweens.add({ targets: lane, alpha: 0.05, yoyo: true, repeat: -1, duration: 110 });
        this.step(tele + n * 650, () => {
          this.drop(lane);
          this.setPose('strike', 300);
          sfx.deadbolt();
          const reach = x1 - this.arenaL;
          const bar = this.keep(this.gs.add.rectangle(x1, y0 + h / 2, reach, h - 2, 0x8b8ba8).setOrigin(1, 0.5).setStrokeStyle(1, 0x2c2244).setDepth(15).setScale(0, 1));
          let tip = x1;
          const ms = (reach / DEADBOLT_SPEED) * 1000;
          this.hazard(() => ({ x: tip, y: y0 + 1, w: x1 - tip, h: h - 2 }), ms + 120);
          this.tween01(ms, 'Quad.in', (t) => {
            tip = x1 - reach * t;
            bar.setScale(t, 1);
          }, () => {
            this.gs.juice.shake(0.004, 90);
            this.gs.juice.burst(this.arenaL + 2, y0 + h / 2, 0xd8d0c4, 6, 0.6);
            this.tween01(260, 'Quad.out', (t) => bar.setScale(1 - t, 1), () => this.drop(bar));
          });
        });
      });
    });
  }

  /** Throws its key at you (P3: twice). Parryable: the reflection chips the shell. */
  private keytoss(): void {
    const tele = TELE.keytoss[this.ph];
    const n = this.phase >= 3 ? 2 : 1;
    this.attack(tele + n * 320 + 300, this.gap(), () => {
      this.setPose('windup', tele);
      this.telegraph(tele, GOLD);
      for (let k = 0; k < n; k++) this.step(tele + k * 320, () => this.throwKey(KEY_SPEED[this.ph]));
    });
  }

  private throwKey(speed: number): Projectile {
    this.setPose('strike', 240);
    sfx.swing();
    const y = this.y - 6;
    const a = Phaser.Math.Angle.Between(this.body.left, y, this.player.x, this.player.y - 4);
    return this.gs.spawnProjectile(this.body.left - 4, y, 'tumblar-key', Math.cos(a) * speed, Math.sin(a) * speed, 'enemy', { damage: 1, lifeMs: 4000, rotate: true, owner: this });
  }

  /** P1: a pin you set pops to a wrong notch (riders get bumped). */
  private spring(): void {
    if (!this.pinLock || !this.pinState) return this.keytoss();
    const tele = TELE.spring[this.ph];
    const { i, to } = springPick(this.pinLock, this.pinState, Math.random);
    this.attack(tele + 300, this.gap(), () => {
      this.setPose('windup', tele);
      this.telegraph(tele, 0xff5400, true);
      const p = this.pins[i];
      const mark = this.keep(this.gs.add.rectangle(p.x, p.y, 32, 12, 0xff1a1a, 0.35).setDepth(13));
      this.gs.tweens.add({ targets: mark, alpha: 0.1, yoyo: true, repeat: -1, duration: 100 });
      this.tween01(tele, 'Linear', () => mark.active && mark.setY(p.y));
      this.step(tele, () => {
        this.drop(mark);
        if (!this.lockLive || !this.pinLock || !this.pinState) return;
        this.pinState = springPin(this.pinLock, this.pinState, i, to);
        p.moveTo(this.notchY(to), 160, 'Back.out');
        sfx.spring();
        this.gs.juice.burst(p.x, p.y, BRASS, 6, 0.7);
        this.refreshPins();
      });
    });
  }

  /** Three numerals spat at you in a fan. Parryable. */
  private numbers(): void {
    const tele = TELE.numbers[this.ph];
    this.attack(tele + 600, this.gap(), () => {
      this.setPose('windup', tele);
      this.telegraph(tele, GOLD);
      this.step(tele, () => {
        this.setPose('strike', 300);
        const base = Phaser.Math.Angle.Between(this.body.left, this.y, this.player.x, this.player.y - 4);
        [-0.22, 0, 0.22].forEach((da, k) =>
          this.step(k * 110, () => {
            sfx.tick(true);
            this.gs.spawnProjectile(this.body.left - 4, this.y - 10, 'tumblar-num', Math.cos(base + da) * 175, Math.sin(base + da) * 175, 'enemy', { damage: 1, lifeMs: 3500, owner: this });
          }),
        );
      });
    });
  }

  /** Tumbler gears roll out along the floor. Red: jump them. */
  private gears(): void {
    const tele = TELE.gears[this.ph];
    const n = this.phase >= 3 ? 3 : 2;
    const spacing = 520;
    this.attack(tele + n * spacing + 200, this.gap(), () => {
      this.setPose('windup', tele);
      this.telegraph(tele, 0xff5400, true);
      const x1 = this.body.left;
      const lane = this.keep(this.gs.add.rectangle((this.arenaL + x1) / 2, this.floorY - 7, x1 - this.arenaL, 14, 0xff1a1a, 0.14).setDepth(14));
      this.step(tele, () => this.drop(lane));
      for (let k = 0; k < n; k++)
        this.step(tele + k * spacing, () => {
          sfx.spring();
          const g = this.keep(this.gs.add.sprite(x1, this.floorY - 8, 'tumblar-gear').setDepth(15));
          const reach = x1 - this.arenaL;
          const ms = (reach / GEAR_SPEED) * 1000;
          this.hazard(() => ({ x: g.x - 6, y: g.y - 6, w: 12, h: 12 }), ms);
          this.tween01(ms, 'Linear', (t) => {
            g.x = x1 - reach * t;
            g.rotation = -t * 30;
          }, () => {
            this.gs.juice.burst(g.x, g.y, 0xd8d0c4, 5, 0.5);
            this.drop(g);
          });
        });
    });
  }

  /** P2: a hook flies slowly at the dial. If it gets there, the last digit is yanked out. */
  private relock(): void {
    if (!this.dial || !this.dialState?.got) return this.numbers();
    const tele = TELE.relock[this.ph];
    this.attack(tele + 400, this.gap(), () => {
      this.setPose('windup', tele);
      this.telegraph(tele, GOLD);
      this.gs.juice.floatText(this.x, this.y - 46, 'RELOCK', '#ff8fb8');
      this.step(tele, () => {
        if (!this.dial) return;
        this.setPose('strike', 300);
        sfx.swing();
        const sx = this.body.left - 4, sy = this.y - 10;
        const a = Phaser.Math.Angle.Between(sx, sy, this.dial.x, this.dial.y);
        this.hook = this.gs.spawnProjectile(sx, sy, 'tumblar-hook', Math.cos(a) * 120, Math.sin(a) * 120, 'enemy', { damage: 1, lifeMs: 5000, owner: this });
      });
    });
  }

  /** The hook in flight: reaching the dial pulls a digit. */
  private tickHook(): void {
    const h = this.hook;
    if (!h) return;
    if (!h.active || h.dead || h.team !== 'enemy') {
      if (h.team === 'player') this.gs.juice.floatText(h.x, h.y - 10, 'PARRIED', '#7fdbff');
      this.hook = undefined;
      return;
    }
    if (!this.dial || !this.dialState) return;
    if (Phaser.Math.Distance.Between(h.x, h.y, this.dial.x, this.dial.y) < 22) {
      this.hook = undefined;
      h.kill();
      this.dialState = relockDial(this.dialState);
      sfx.jam();
      this.gs.juice.floatText(this.dial.x, this.dial.y - 46, 'DIGIT LOST', '#ff8fb8');
      this.gs.juice.shake(0.004, 120);
      this.refreshPips();
    }
  }

  /** P3: the door presses a bolt itself. */
  private rekey(): void {
    if (!this.bolts.length) return this.deadbolt();
    const tele = TELE.rekey[this.ph];
    const i = rekeyPick(this.boltBits, Math.random);
    this.attack(tele + 300, this.gap(), () => {
      this.setPose('windup', tele);
      this.telegraph(tele, GOLD);
      const marks: Phaser.GameObjects.Rectangle[] = [];
      for (let k = Math.max(0, i - 1); k <= Math.min(BOLTS - 1, i + 1); k++) {
        const m = this.keep(this.gs.add.rectangle(COL_X[k], this.floorY - 13, 20, 28, 0xff8fb8, k === i ? 0.4 : 0.15).setDepth(13));
        this.gs.tweens.add({ targets: m, alpha: 0.05, yoyo: true, repeat: -1, duration: 120 });
        marks.push(m);
      }
      this.step(tele, () => {
        marks.forEach((m) => this.drop(m));
        if (!this.lockLive) return;
        this.setPose('strike', 300);
        this.boltBits = pressBolt(this.boltBits, i);
        sfx.bolt();
        this.gs.juice.floatText(COL_X[i], this.floorY - 34, 'RE-KEYED', '#ff8fb8');
        this.refreshBolts();
      });
    });
  }

  // ------------------------------------------------------------------ finale: the last key
  private startFinale(): void {
    if (this.finale || !this.alive) return;
    this.finale = true;
    this.lockLive = false;
    this.seq++;
    this.interruptFx();
    this.clearEnemyShots();
    this.cancelRecover();
    this.coreOpen = false;
    this.busy = true;
    for (const b of this.bolts) b.destroy();
    this.bolts = [];
    this.drop(this.hint);
    this.setPose('roar', 1400);
    sfx.bossRoar();
    this.gs.juice.ring(this.x, this.y, GOLD, 3);
    this.gs.juice.floatText(this.x, this.y - 54, 'THE LAST KEY', '#ffd96a');
    this.keyPending = true;
    this.later(1400, () => this.finaleThrow());
  }

  private finaleThrow(): void {
    if (!this.alive || !this.finale) return;
    this.setPose('windup', 700);
    this.telegraph(700, GOLD);
    const t = this.keep(txt(this.gs, this.gs.worldWidth / 2, this.ceilY + 48, 'PARRY THE KEY BACK INTO THE LOCK', 8, '#ffd96a').setDepth(40));
    this.later(700, () => {
      this.drop(t);
      if (!this.alive) return;
      this.finaleKey = this.throwKey(150);
      this.keyPending = false;
    });
  }

  private tickFinale(): void {
    if (!this.finale || this.keyPending) return;
    const k = this.finaleKey;
    if (k && k.active && !k.dead) {
      if (k.team === 'player') this.gs.juice.burst(k.x, k.y, GOLD, 1, 0.2);
      return;
    }
    this.finaleKey = undefined;
    this.keyPending = true;
    this.later(1300, () => this.finaleThrow());
  }

  die(reward = true): void {
    if (this.alive) {
      this.seq++;
      this.interruptFx();
      this.clearEnemyShots();
      this.teardown();
      sfx.unlock();
      if (this.finale) {
        this.gs.juice.slowmo(0.25, 700);
        this.gs.juice.floatText(this.x, this.y - 54, 'OPEN', '#ffffff');
      }
    }
    super.die(reward);
  }

  tick(time: number, dt: number): void {
    super.tick(time, dt);
    if (!this.alive) return;
    this.tickHook();
    this.tickFinale();
    if (this.phase <= 1 && this.pins.length) {
      this.tickSlamLanding();
      this.drawPinGfx();
    }
  }
}
