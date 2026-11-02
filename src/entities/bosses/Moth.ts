import Phaser from 'phaser';
import { Boss } from './Boss';
import { UNPARRYABLE_TINT } from '../Enemy';
import { Flyer } from '../enemies/Flyer';
import type { Projectile } from '../Projectile';
import { Hitbox } from '../../combat/Hitbox';
import type { HitInfo } from '../../combat/types';
import { TILE } from '../../config';
import { tone, noise } from '../../systems/sfx';
import { MOTH_EYES } from '../../art/moth';
import type { GameScene } from '../../scenes/GameScene';

type V = [number, number];
type Move = 'volley' | 'gust' | 'swoop' | 'pillars' | 'brood' | 'sweep';

/** Wind-ups / punish windows per phase [P1, P2, P3] (ms). See plan section 3. */
const T = {
  volleyTele: [550, 450, 420],
  volleyGap: [260, 230, 210],
  volleySpeed: [150, 165, 175],
  gustTele: [650, 600, 550],
  gustMs: 900,
  gustHold: 600,
  gustPush: [110, 120, 130],
  swoopTele: [750, 600, 480],
  swoop2Tele: 400, // eclipse: wind-up of the mirrored second swoop (P3 floor is 380)
  swoopDive: 720, // dive + skid ('land' path)
  swoopFull: 900, // full U ('pass' path, eclipse first swoop)
  grounded: [1400, 1200, 1000],
  pillarMarker: 800,
  pillarBeam: 400,
  pillarLowHover: 900,
  broodTele: 600,
  broodPose: 800,
  sweepMarker: 800,
  sweepStagger: 120,
  sweepMs: 2200,
  sweepGrounded: 1200,
  cooldown: [1000, 800, 650],
};

const PALE = 0xe6d7ff;
const GOLD = 0xffd96a;
/** sprite y is 11px above the 30x26 body's centre and 24px above its bottom */
const BODY_DY = 11;
const FEET_DY = 24;
const ECLIPSE_DEPTH = 35;
const ABOVE_DARK = 42;

interface Motion {
  t: number;
  dur: number;
  at: (u: number) => V;
  done?: () => void;
  swoop?: boolean;
}

interface Arc {
  g: Phaser.GameObjects.Graphics;
  pts: V[];
  start: number;
  ms: number;
  land?: V;
}

interface Column {
  x: number;
  w: number;
  live: boolean;
}

/**
 * World 4-2 (final): NOCTARA, THE ECLIPSE MOTH. Hovers; attacks from the air, then must land.
 *  P1: dust volley (parry/reflect = stun), wing gust (+ drifting motes), swoop (red, ends grounded).
 *  P2 (cocoon transform): + light pillars, moth brood.
 *  P3 (Eclipse transform): arena goes dark (lights around the player and her eyes), pillar sweep,
 *      every swoop is followed by a mirrored second swoop, grounded after the 2nd.
 */
export class Moth extends Boss {
  private t = 0;
  private gen = 0;
  private motion?: Motion;
  private swooping = false;
  private hist: Move[] = [];
  private side: 1 | -1 = 1;
  private sideTimer = 0;
  private gustUntil = 0;
  private gustDir = 1;
  private nextStreak = 0;
  private nextTrail = 0;
  private arcs: Arc[] = [];
  private columns = new Set<Column>();
  /** gust motes: swatting one just dissolves it (only reflected volley orbs stun her) */
  private motes = new Set<Projectile>();
  /** every visual this boss created, destroyed with her */
  private fx = new Set<Phaser.GameObjects.GameObject>();
  // arena (filled lazily from the tilemap)
  private arena?: { floor: number; ceil: number; l: number; r: number };
  // eclipse
  private dark?: Phaser.GameObjects.RenderTexture;
  private brush?: Phaser.GameObjects.Image;
  private darkAlpha = 0;
  private eyes: Phaser.GameObjects.Image;
  private eyeGlow: Phaser.GameObjects.Image;

  constructor(gs: GameScene, x: number, y: number) {
    super(gs, x, y, 'moth', 'NOCTARA, THE ECLIPSE MOTH', { hp: 140, bodyW: 30, bodyH: 26, gravity: false, contactDamage: 0, shards: 100 });
    this.thresholds = [0.7, 0.4];
    this.deathTint = PALE;
    this.hearts = { periodicMs: 18000, maxOnField: 1, perParries: 3, onPhase: 1 };
    // she flies through one-way platforms and is kept inside the arena by hand
    this.body.checkCollision.none = true;
    this.eyes = this.track(gs.add.image(x, y, 'moth-eyes').setDepth(ECLIPSE_DEPTH + 2).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0));
    this.eyeGlow = this.track(gs.add.image(x, y, 'light').setTint(GOLD).setScale(0.5).setDepth(ECLIPSE_DEPTH + 1).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0));
    this.once(Phaser.GameObjects.Events.DESTROY, () => this.cleanup(true));
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

  private finish(cd = T.cooldown[this.ph]): void {
    this.busy = false;
    this.cooldown = cd;
  }

  private get A(): { floor: number; ceil: number; l: number; r: number } {
    if (this.arena) return this.arena;
    const gs = this.gs;
    const x = this.x;
    let floor = this.y;
    while (floor < gs.worldHeight && !gs.isBlockAt(x, floor)) floor += 4;
    floor = Math.floor(floor / TILE) * TILE;
    let ceil = this.y;
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
  private get groundY(): number {
    return this.A.floor - FEET_DY;
  }
  private clampX(x: number, pad = 22): number {
    return Phaser.Math.Clamp(x, this.A.l + pad, this.A.r - pad);
  }

  // ------------------------------------------------------------------ visuals
  private get sheetKey(): string {
    return this.phase >= 3 ? 'moth-eclipse' : 'moth';
  }

  protected animKey(): string {
    const s = this.sheetKey;
    if (this.stunned) return s + '-stun';
    if (this.swooping) return s + '-swoop';
    const pose = this.curPose;
    if (pose) return `${s}-${pose}`;
    return s + '-hover';
  }

  tick(time: number, dt: number): void {
    super.tick(time, dt);
    if (!this.alive) return;
    const now = this.gs.time.now;
    this.updateArcs(now);
    this.updateGust(now, dt);
    for (const m of this.motes) {
      if (!m.active || m.dead) this.motes.delete(m);
      else if (m.team === 'player') {
        this.motes.delete(m);
        this.gs.juice.burst(m.x, m.y, PALE, 6, 0.6);
        m.kill();
      }
    }
    if (this.swooping && now >= this.nextTrail) {
      this.nextTrail = now + 34;
      const tr = this.track(this.gs.add.image(this.x, this.y + BODY_DY, 'light').setTint(this.phase >= 3 ? GOLD : PALE));
      tr.setScale(0.45).setAlpha(this.phase >= 3 ? 0.7 : 0.35).setBlendMode(Phaser.BlendModes.ADD).setDepth(ECLIPSE_DEPTH + 1);
      this.gs.tweens.add({ targets: tr, alpha: 0, scale: 0.15, duration: this.phase >= 3 ? 650 : 380, onComplete: () => tr.destroy() });
    }
    this.updateEclipse();
  }

  // ------------------------------------------------------------------ damage hooks
  receiveHit(hit: HitInfo): 'hit' | 'blocked' | 'ignored' {
    const res = super.receiveHit(hit);
    // a reflected dust orb knocks her out of the air for a moment
    if (res === 'hit' && hit.kind === 'projectile' && hit.parried && this.alive && !this.transforming && !this.stunned) this.onParried();
    return res;
  }

  onParried(): void {
    super.onParried();
    this.body.setVelocity(0, 0);
  }

  protected onPhase(n: number): void {
    this.abort();
    if (n === 2) {
      // cocoon: wraps up, then the wings burst open
      this.setPose('cocoon', 1500);
      this.gs.juice.floatText(this.x, this.y - 30, 'COCOON', '#e6d7ff');
      this.transform(1500, () => {
        this.gs.juice.burst(this.x, this.y + BODY_DY, PALE, 26, 1.4);
        this.gs.juice.burst(this.x, this.y + BODY_DY, GOLD, 10, 1);
        this.gs.juice.ring(this.x, this.y + BODY_DY, PALE, 2.2);
        this.gs.juice.shake(0.01, 300);
        this.setPose('cast', 400);
        this.cooldown = 700;
      });
    } else if (n === 3) {
      this.hearts.periodicMs = 14000;
      this.setPose('cast', 1500);
      this.gs.juice.floatText(this.x, this.y - 30, 'ECLIPSE', '#ffd96a');
      this.startEclipse(1500);
      this.transform(1500, () => {
        this.gs.juice.ring(this.x, this.y + BODY_DY, GOLD, 2.4);
        this.cooldown = 800;
      });
    }
  }

  /** Cancel the running attack (phase change / death). Self-timed pillars still finish. */
  private abort(): void {
    this.gen++;
    this.motion = undefined;
    this.swooping = false;
    this.gustUntil = 0;
    this.clearArcs();
    this.body.setVelocity(0, 0);
  }

  die(reward = true): void {
    if (this.alive) {
      this.abort();
      this.endEclipse();
      this.eyes.setAlpha(0);
      this.eyeGlow.setAlpha(0);
    }
    super.die(reward);
  }

  private cleanup(all: boolean): void {
    this.clearArcs();
    if (all) {
      for (const o of [...this.fx]) o.destroy();
      this.fx.clear();
      this.dark?.destroy();
      this.brush?.destroy();
      this.dark = undefined;
      this.brush = undefined;
    }
  }

  // ------------------------------------------------------------------ AI
  protected think(dt: number): void {
    this.t += dt;
    if (this.motion) {
      this.stepMotion(dt);
      return;
    }
    if (this.busy) {
      const still = this.vulnerable || this.transforming || this.curPose === 'grounded';
      this.body.setVelocity(0, still ? 0 : Math.cos(this.t / 260) * 5);
      return;
    }
    this.cooldown -= dt;
    this.facePlayer();
    this.hover(dt);
    if (this.cooldown > 0 || !this.player.alive) return;
    this.pick();
  }

  /** Drifts beside the player at a height reachable by a jump + up-slash (or from the platforms). */
  private hover(dt: number): void {
    const A = this.A;
    this.sideTimer -= dt;
    if (this.sideTimer <= 0) {
      this.sideTimer = 6000 + Math.random() * 3000;
      this.side = Math.random() < 0.5 ? 1 : -1;
    }
    const px = this.player.x;
    // flip side if that side is cramped against a wall
    if (px + this.side * 80 < A.l + 30 || px + this.side * 80 > A.r - 30) this.side = this.side > 0 ? -1 : 1;
    const tx = this.clampX(px + this.side * 80 + Math.sin(this.t / 1100) * 26);
    // body centre 80..112px above the floor (single jump + up-slash reaches ~107)
    const ty = A.floor - 96 - BODY_DY + Math.sin(this.t / 2600) * 16 + Math.sin(this.t / 420) * 4;
    this.body.setVelocity((tx - this.x) * 2, (ty - this.y) * 2.2);
  }

  private pick(): void {
    const p = this.phase;
    const adds = this.gs.enemies.getChildren().filter((e) => e !== this && (e as Boss).alive).length;
    const table: [Move, number][] =
      p === 1
        ? [['volley', 0.35], ['gust', 0.25], ['swoop', 0.4]]
        : p === 2
          ? [['volley', 0.2], ['gust', 0.15], ['swoop', 0.3], ['pillars', 0.2], ['brood', adds < 2 ? 0.15 : 0]]
          : [['volley', 0.15], ['gust', 0.15], ['swoop', 0.35], ['pillars', 0.1], ['sweep', 0.25]];
    // never the same move 3 times in a row
    const banned = this.hist.length >= 2 && this.hist[0] === this.hist[1] ? this.hist[0] : null;
    const opts = table.filter(([m, w]) => w > 0 && m !== banned);
    const total = opts.reduce((s, [, w]) => s + w, 0);
    let r = Math.random() * total;
    let move = opts[0][0];
    for (const [m, w] of opts) {
      r -= w;
      if (r <= 0) {
        move = m;
        break;
      }
    }
    this.hist.unshift(move);
    this.hist.length = Math.min(this.hist.length, 3);
    this.busy = true;
    this.body.setVelocity(0, 0);
    this[move]();
  }

  // ------------------------------------------------------------------ motion
  private stepMotion(dt: number): void {
    const m = this.motion!;
    m.t = Math.min(m.dur, m.t + dt);
    const [x, y] = m.at(m.t / m.dur);
    this.body.reset(x, y);
    if (m.t >= m.dur) {
      this.motion = undefined;
      this.swooping = false;
      m.done?.();
    }
  }

  private glide(tx: number, ty: number, ms: number, done?: () => void): void {
    const sx = this.x, sy = this.y;
    this.motion = {
      t: 0,
      dur: ms,
      at: (u) => {
        const e = u * u * (3 - 2 * u);
        return [sx + (tx - sx) * e, sy + (ty - sy) * e];
      },
      done,
    };
  }

  // ------------------------------------------------------------------ attacks
  /** 3 / 5 aimed dust orbs. Parry one back into her for a stun. */
  private volley(): void {
    const tele = T.volleyTele[this.ph];
    const n = this.phase === 1 ? 3 : 5;
    const gap = T.volleyGap[this.ph];
    this.setPose('windup', tele);
    this.telegraph(tele, PALE);
    for (let i = 0; i < n; i++) {
      this.step(tele + i * gap, () => {
        this.facePlayer();
        this.setPose('cast', gap + 60);
        const a = Math.atan2(this.player.y - (this.y + BODY_DY), this.player.x - this.x);
        const s = T.volleySpeed[this.ph];
        const pr = this.gs.spawnProjectile(this.x + Math.cos(a) * 10, this.y + BODY_DY - 4, 'dust', Math.cos(a) * s, Math.sin(a) * s, 'enemy', { damage: 1, lifeMs: 3500, owner: this });
        this.liftProjectile(pr);
        tone(520 + i * 40, 0.08, 'triangle', 0.08, 300);
      });
    }
    this.step(tele + n * gap + 250, () => this.finish());
  }

  /** Wings pulled back, then a gust shoves the player toward the wall and releases slow motes. */
  private gust(): void {
    const tele = T.gustTele[this.ph];
    this.facePlayer();
    this.setPose('windup', tele);
    this.telegraph(tele, 0xc2c3d6);
    // dust sucked in while she loads the gust
    for (let i = 0; i < 6; i++) {
      this.step((i * tele) / 7, () => {
        const a = Math.random() * Math.PI * 2;
        const d = this.track(this.gs.add.image(this.x + Math.cos(a) * 34, this.y + BODY_DY + Math.sin(a) * 26, 'mothmote').setDepth(ABOVE_DARK).setAlpha(0.8));
        this.gs.tweens.add({ targets: d, x: this.x, y: this.y + BODY_DY, alpha: 0, duration: 300, onComplete: () => d.destroy() });
      });
    }
    this.step(tele, () => {
      const dir = this.player.x >= this.x ? 1 : -1;
      this.facing = dir;
      this.gustDir = dir;
      this.gustUntil = this.gs.time.now + T.gustMs;
      this.setPose('gust', T.gustMs + T.gustHold);
      this.gs.juice.shake(0.004, 300);
      noise(0.7, 0.18, 700);
      const n = [4, 5, 6][this.ph];
      for (let i = 0; i < n; i++) {
        this.step(i * 90, () => {
          const y = this.y + BODY_DY + (i - (n - 1) / 2) * 13 + (Math.random() - 0.5) * 6;
          const pr = this.gs.spawnProjectile(this.x + dir * 18, y, 'mothmote', dir * (48 + Math.random() * 26), (Math.random() - 0.5) * 14, 'enemy', { damage: 1, lifeMs: 6000, owner: this });
          this.motes.add(pr);
          this.liftProjectile(pr);
        });
      }
    });
    this.step(tele + T.gustMs + T.gustHold, () => this.finish());
  }

  private updateGust(now: number, dt: number): void {
    if (now >= this.gustUntil) return;
    const p = this.player;
    const A = this.A;
    if (now >= this.nextStreak) {
      this.nextStreak = now + 45;
      const y = A.ceil + 8 + Math.random() * (A.floor - A.ceil - 12);
      const x0 = this.gustDir > 0 ? this.x + 10 : this.x - 10;
      const s = this.track(this.gs.add.rectangle(x0, y, 10 + Math.random() * 10, 1, PALE, 0.55).setDepth(ABOVE_DARK));
      this.gs.tweens.add({ targets: s, x: x0 + this.gustDir * (180 + Math.random() * 120), alpha: 0, duration: 320, onComplete: () => s.destroy() });
    }
    if (!p.alive || p.fsm.is('dash')) return; // dash cuts straight through the wind
    const blocked = this.gustDir > 0 ? p.body.blocked.right : p.body.blocked.left;
    if (!blocked) p.x += (this.gustDir * T.gustPush[this.ph] * dt) / 1000;
  }

  /**
   * Swoop: glide to a start point, show the dotted arc (red, unparryable), dive along it through
   * floor level and land grounded. In the Eclipse a mirrored second swoop follows the first.
   */
  private swoop(): void {
    const A = this.A;
    const px = this.player.x;
    const double = this.phase >= 3;
    // start ~130px to one side so the arc bottoms out under the player and has room to finish
    // on the far side (full U in the Eclipse, a short skid otherwise)
    const roomL = px - (A.l + 26), roomR = A.r - 26 - px;
    const reach = (s: number): number => {
      const near = s > 0 ? roomR : roomL, far = s > 0 ? roomL : roomR;
      let d = Math.min(130, near);
      if (double) d = Math.min(d, far);
      else if (far < 50) d = Math.min(d, 40);
      return d;
    };
    const cur = this.x >= px ? 1 : -1;
    const side = reach(cur) >= 90 || reach(cur) >= reach(-cur) ? cur : -cur;
    const sx = this.clampX(px + side * Math.max(50, reach(side)), 26);
    const sy = A.floor - 104 - BODY_DY;
    this.glide(sx, sy, 320, () => this.swoopWindup(double));
  }

  private swoopWindup(double: boolean): void {
    const tele = T.swoopTele[this.ph];
    const path = this.swoopPath(this.player.x, double ? 'pass' : 'land');
    this.facing = path.dir > 0 ? 1 : -1;
    this.setPose('windup', tele);
    this.telegraph(tele, UNPARRYABLE_TINT, true);
    this.showArc(path.at, tele, path.land);
    tone(180, tele / 1000, 'sawtooth', 0.05, 90);
    this.step(tele, () => this.runSwoop(path, double));
  }

  private runSwoop(path: { at: (u: number) => V; dur: number; dir: number; land?: V }, double: boolean): void {
    this.clearArcs();
    this.swooping = true;
    this.facing = path.dir > 0 ? 1 : -1;
    this.swoopHitbox(path.dur);
    noise(0.35, 0.16, 1400);
    this.motion = {
      t: 0,
      dur: path.dur,
      at: path.at,
      swoop: true,
      done: () => {
        if (double) {
          // mirrored second swoop: aims at the player again, from the other side
          const p2 = this.swoopPath(this.player.x, 'land', -path.dir);
          this.facing = p2.dir > 0 ? 1 : -1;
          this.setPose('windup', T.swoop2Tele);
          this.telegraph(T.swoop2Tele, UNPARRYABLE_TINT, true);
          this.showArc(p2.at, T.swoop2Tele, p2.land);
          this.step(T.swoop2Tele, () => this.runSwoop(p2, false));
          return;
        }
        this.land(T.grounded[this.ph]);
      },
    };
  }

  /** Red hitbox that follows her for the swoop (off while stunned). */
  private swoopHitbox(ms: number): void {
    const hb = new Hitbox(
      'enemy',
      () => (this.swooping && !this.stunned ? { x: this.x - 20, y: this.y - 6, w: 40, h: 30 } : { x: -9999, y: -9999, w: 1, h: 1 }),
      () => ({ damage: 2, kbX: this.facing * 220, kbY: -200, sourceX: this.x, parryable: false, kind: 'melee' }),
      ms + 60,
    ).ownedBy(this);
    this.gs.damage.add(hb);
  }

  /**
   * U-shaped path from her position. 'land': dive to floor level at bx then skid to a stop.
   * 'pass': full U, back up to the start height on the far side.
   */
  private swoopPath(bxWanted: number, mode: 'land' | 'pass', forceDir?: number): { at: (u: number) => V; dur: number; dir: number; land?: V } {
    const sx = this.x, sy = this.y;
    const gy = this.groundY;
    let dir = forceDir ?? (Math.sign(bxWanted - sx) || this.facing);
    let d = Phaser.Math.Clamp(Math.abs(bxWanted - sx), 70, 170);
    const room = (x: number) => (dir > 0 ? this.A.r - 24 - x : x - (this.A.l + 24));
    if (mode === 'pass') d = Math.min(d, room(sx) / 2);
    else d = Math.min(d, room(sx) - 50);
    if (d < 50) {
      dir = -dir;
      d = Phaser.Math.Clamp(Math.abs(bxWanted - sx), 70, 170);
      d = Math.min(d, mode === 'pass' ? room(sx) / 2 : room(sx) - 50);
    }
    d = Math.max(40, d);
    if (mode === 'pass') {
      return {
        dir,
        dur: T.swoopFull,
        at: (u) => [sx + dir * 2 * d * u, gy - (gy - sy) * (2 * u - 1) ** 2],
      };
    }
    const f = 0.72;
    const skid = Math.max(0, Math.min(50, room(sx + dir * d)));
    const bx = sx + dir * d;
    return {
      dir,
      dur: T.swoopDive,
      land: [bx + dir * skid, gy],
      at: (u) => {
        if (u < f) {
          const v = u / f;
          return [sx + dir * d * v, gy - (gy - sy) * (1 - v) ** 2];
        }
        const w = (u - f) / (1 - f);
        return [bx + dir * skid * (1 - (1 - w) ** 2), gy];
      },
    };
  }

  /** Hits the floor and lies there grounded: the main punish window. */
  private land(ms: number, cd = T.cooldown[this.ph]): void {
    this.body.reset(this.x, this.groundY);
    this.gs.juice.shake(0.008, 200);
    this.gs.juice.dust(this.x, this.A.floor, 10, 0.9);
    this.gs.juice.burst(this.x, this.A.floor - 4, PALE, 10, 0.8);
    tone(90, 0.18, 'sine', 0.3, 45);
    this.recover(ms, 'grounded', cd);
  }

  /** P2+: four columns marked on the floor, then light beams. She hovers low afterwards. */
  private pillars(): void {
    const A = this.A;
    const w = this.phase >= 3 ? 52 : 48;
    const spacing = (A.r - A.l) / 4;
    const off = Math.random() * spacing;
    this.setPose('cast', T.pillarMarker + T.pillarBeam);
    this.telegraph(450, GOLD);
    tone(660, 0.5, 'triangle', 0.07, 990);
    for (let k = 0; k < 4; k++) {
      const x = A.l + off + k * spacing;
      this.column(x, w, T.pillarMarker, T.pillarBeam, 0);
    }
    // afterwards she sinks low over the floor for a moment (open to ground attacks)
    this.step(T.pillarMarker + T.pillarBeam, () => {
      this.glide(this.clampX(this.x), A.floor - 48 - BODY_DY, 260, () => {
        this.step(T.pillarLowHover, () => this.finish());
      });
    });
  }

  /** P3: pillars sweep across the arena one after another; she lands grounded afterwards. */
  private sweep(): void {
    const A = this.A;
    const w = 44;
    const spacing = (A.r - A.l) / 4;
    const dir = Math.random() < 0.5 ? 1 : -1;
    // the leading column starts against the far wall, so nothing can pin the player there
    const lead = dir > 0 ? A.r - w / 2 + 6 : A.l + w / 2 - 6;
    const marker = T.sweepMarker + 3 * T.sweepStagger;
    this.setPose('cast', marker + T.sweepMs);
    this.telegraph(450, GOLD);
    tone(520, 0.6, 'triangle', 0.07, 1040);
    for (let k = 0; k < 4; k++) {
      const x = lead - dir * k * spacing;
      this.step(k * T.sweepStagger, () => this.column(x, w, marker - k * T.sweepStagger, T.sweepMs, (dir * spacing) / (T.sweepMs / 1000)));
    }
    this.step(marker + T.sweepMs + 80, () => {
      this.glide(this.x, this.groundY, 320, () => this.land(T.sweepGrounded));
    });
  }

  /**
   * One light column: floor marker strip + faint column ghost for `markerMs`, then a beam for
   * `beamMs` (unparryable). vx > 0 makes it travel. Self-timed: survives phase aborts, dies with her.
   */
  private column(x0: number, w: number, markerMs: number, beamMs: number, vx: number): void {
    const gs = this.gs;
    const A = this.A;
    const top = A.ceil, h = A.floor - A.ceil;
    const col: Column = { x: x0, w, live: false };
    const strip = this.track(gs.add.tileSprite(x0, A.floor - 2, w, 5, 'moth-marker').setDepth(ABOVE_DARK).setAlpha(0));
    const ghost = this.track(gs.add.rectangle(x0, top + h / 2, w, h, GOLD, 0.07).setStrokeStyle(1, GOLD, 0.35).setDepth(ABOVE_DARK).setAlpha(0));
    const arrows = vx ? this.track(gs.add.graphics().setDepth(ABOVE_DARK)) : undefined;
    if (arrows) {
      const d = Math.sign(vx);
      arrows.fillStyle(GOLD, 0.9);
      for (let i = -1; i <= 1; i++) {
        const ax = x0 + i * 10;
        arrows.fillTriangle(ax - d * 3, A.floor - 14, ax - d * 3, A.floor - 6, ax + d * 3, A.floor - 10);
      }
    }
    gs.tweens.add({ targets: [strip, ghost], alpha: 1, duration: 120 });
    gs.tweens.add({ targets: strip, alpha: 0.45, yoyo: true, repeat: -1, duration: 110, delay: 120 });
    const parts: Phaser.GameObjects.Components.Transform[] = [strip, ghost];
    gs.time.delayedCall(markerMs, () => {
      if (!this.alive || !strip.active) return;
      gs.tweens.killTweensOf(strip);
      strip.setAlpha(1);
      ghost.destroy();
      arrows?.destroy();
      const beam = this.track(gs.add.image(x0, top, 'moth-beam').setOrigin(0.5, 0).setDisplaySize(w, h).setDepth(ABOVE_DARK).setBlendMode(Phaser.BlendModes.ADD));
      const core = this.track(gs.add.rectangle(x0, top + h / 2, Math.max(4, w * 0.22), h, 0xffffff, 0.85).setDepth(ABOVE_DARK));
      beam.scaleX *= 0.2;
      gs.tweens.add({ targets: beam, scaleX: beam.scaleX * 5, duration: 70 });
      parts.length = 0;
      parts.push(strip, beam, core);
      col.live = true;
      this.columns.add(col);
      gs.juice.shake(0.004, 120);
      gs.juice.burst(x0, A.floor - 2, GOLD, 6, 0.7);
      noise(0.25, 0.1, 3000, 0, 1, 'highpass');
      gs.damage.add(
        new Hitbox(
          'enemy',
          () => ({ x: col.x - w / 2 + 3, y: top, w: w - 6, h }),
          () => ({ damage: 1, kbX: (this.player.x >= col.x ? 1 : -1) * 200, kbY: -200, sourceX: col.x, parryable: false, kind: 'melee' }),
          beamMs,
        ).ownedBy(this),
      );
      if (vx) {
        gs.tweens.add({
          targets: col,
          x: x0 + (vx * beamMs) / 1000,
          duration: beamMs,
          onUpdate: () => {
            for (const p of parts) p.x = col.x;
          },
        });
      }
      gs.time.delayedCall(beamMs, () => {
        col.live = false;
        this.columns.delete(col);
        if (!beam.active) return;
        gs.tweens.add({ targets: [strip, beam, core], alpha: 0, duration: 140, onComplete: () => [strip, beam, core].forEach((o) => o.destroy()) });
      });
    });
  }

  /** P2: two small moths (Flyers), no shards, at most 2 alive. Summon pose leaves her open. */
  private brood(): void {
    this.setPose('cast', T.broodTele + T.broodPose);
    this.telegraph(T.broodTele, 0x9d4edd);
    this.step(T.broodTele, () => {
      const alive = this.gs.enemies.getChildren().filter((e) => e !== this && (e as Boss).alive).length;
      const A = this.A;
      for (const s of [-1, 1]) {
        if (alive + (s > 0 ? 1 : 0) >= 2) break;
        const x = this.clampX(this.x + s * 60, 30);
        const f = new Flyer(this.gs, x, A.floor - 100, false);
        f.shards = 0; // infinite summons: no shard farming
        this.gs.enemies.add(f);
        this.gs.juice.ring(x, f.y, 0x9d4edd, 1.2);
        this.gs.juice.burst(x, f.y, PALE, 8, 0.6);
      }
    });
    this.step(T.broodTele + T.broodPose, () => this.finish());
  }

  /** Projectiles stay readable above the Eclipse darkness. */
  private liftProjectile(p: Projectile): void {
    if (this.dark) p.setDepth(ECLIPSE_DEPTH + 3);
  }

  // ------------------------------------------------------------------ arc preview
  private showArc(at: (u: number) => V, ms: number, land?: V): void {
    const pts: V[] = [];
    let last = at(0);
    pts.push([last[0], last[1] + BODY_DY]);
    for (let u = 0.004; u <= 1.0001; u += 0.004) {
      const p = at(u);
      if (Math.hypot(p[0] - last[0], p[1] - last[1]) >= 7) {
        pts.push([p[0], p[1] + BODY_DY]);
        last = p;
      }
    }
    const g = this.track(this.gs.add.graphics().setDepth(ABOVE_DARK));
    this.arcs.push({ g, pts, start: this.gs.time.now, ms, land: land ? [land[0], this.A.floor] : undefined });
  }

  private updateArcs(now: number): void {
    for (const a of this.arcs) {
      const k = (now - a.start) / a.ms;
      const n = Math.ceil(a.pts.length * Math.min(1, k / 0.45));
      const blink = k > 0.7 && Math.floor(now / 70) % 2 === 0;
      a.g.clear();
      a.g.fillStyle(UNPARRYABLE_TINT, blink ? 0.4 : 0.95);
      for (let i = 0; i < n; i++) a.g.fillRect(Math.round(a.pts[i][0]) - 1, Math.round(a.pts[i][1]) - 1, 2, 2);
      a.g.fillStyle(0xffffff, blink ? 0.3 : 0.8);
      for (let i = 0; i < n; i += 3) a.g.fillRect(Math.round(a.pts[i][0]), Math.round(a.pts[i][1]), 1, 1);
      if (a.land && k > 0.45) {
        const [x, y] = a.land;
        a.g.fillStyle(UNPARRYABLE_TINT, blink ? 0.4 : 0.95);
        a.g.fillRect(x - 6, y - 2, 12, 2);
        a.g.fillRect(x - 1, y - 6, 2, 4);
      }
    }
  }

  private clearArcs(): void {
    for (const a of this.arcs) a.g.destroy();
    this.arcs = [];
  }

  // ------------------------------------------------------------------ eclipse
  private startEclipse(fadeMs: number): void {
    if (this.dark) return;
    const gs = this.gs;
    this.dark = gs.add.renderTexture(0, 0, gs.worldWidth, gs.worldHeight + 32).setOrigin(0, 0).setDepth(ECLIPSE_DEPTH);
    this.brush = gs.make.image({ key: 'light', add: false });
    this.darkAlpha = 0;
    gs.tweens.add({ targets: this, darkAlpha: 0.8, duration: fadeMs, ease: 'Sine.in' });
    for (const p of gs.projectiles.getChildren() as Projectile[]) if (p.team === 'enemy') p.setDepth(ECLIPSE_DEPTH + 3);
  }

  private endEclipse(): void {
    if (!this.dark) return;
    const dark = this.dark;
    const brush = this.brush;
    this.dark = undefined;
    this.brush = undefined;
    this.gs.tweens.add({ targets: dark, alpha: 0, duration: 900, onComplete: () => { dark.destroy(); brush?.destroy(); } });
  }

  private hole(x: number, y: number, rx: number, ry: number, a: number): void {
    this.brush!.setScale((rx * 2) / 64, (ry * 2) / 64).setAlpha(a);
    this.dark!.erase(this.brush!, x, y);
  }

  private updateEclipse(): void {
    // eyes always track her; visible in the dark only
    const k = this.anims.currentAnim?.key ?? '';
    const pose = this.stunned ? 'stun' : this.swooping ? 'swoop' : k.replace(/^moth(-eclipse)?-/, '');
    const off = MOTH_EYES[pose] ?? MOTH_EYES.hover;
    const ex = this.x + (this.flipX ? -off[0] : off[0]);
    const ey = this.y + off[1];
    const ea = this.dark ? Math.min(1, this.darkAlpha / 0.6) : 0;
    this.eyes.setPosition(ex, ey).setAlpha(this.stunned ? ea * 0.3 : ea);
    this.eyeGlow.setPosition(ex, ey).setAlpha(ea * 0.6);
    if (!this.dark) return;
    const dark = this.dark;
    dark.clear();
    dark.fill(0x05030c, this.darkAlpha);
    const p = this.player;
    this.hole(p.x, p.y, 84, 78, 1);
    this.hole(p.x, p.y, 40, 40, 1);
    // her silhouette: dim normally, bright when winding up or lying grounded
    const lit = this.telegraphing || this.vulnerable || this.arcs.length > 0;
    this.hole(this.x, this.y + BODY_DY, lit ? 56 : 40, lit ? 48 : 34, lit ? 0.9 : 0.55);
    this.hole(ex, ey, 20, 16, 0.8);
    for (const c of this.columns) if (c.live) this.hole(c.x, (this.A.floor + this.A.ceil) / 2, c.w * 1.4, (this.A.floor - this.A.ceil) * 0.75, 0.85);
    for (const h of this.gs.pickups.getChildren() as Phaser.GameObjects.Sprite[]) {
      if (h.active && h.getData('kind') === 'heart') this.hole(h.x, h.y, 22, 22, 0.9);
    }
    for (const e of this.gs.enemies.getChildren() as Boss[]) if (e !== this && e.alive) this.hole(e.x, e.y, 22, 22, 0.7);
  }
}
