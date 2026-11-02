import Phaser from 'phaser';
import { UNPARRYABLE_TINT } from '../Enemy';
import { AurrenEcho } from './AurrenEcho';
import type { Aurren } from './Aurren';
import { Hitbox } from '../../combat/Hitbox';
import type { HitInfo, Rect } from '../../combat/types';
import { shouldCounter, pickWeighted, type Habit } from '../../combat/playerRead';
import { GAME_W, GAME_H } from '../../config';
import { sfx, tone, noise } from '../../systems/sfx';

type SMove = 'crown' | 'flare' | 'sunfall' | 'corona' | 'well' | 'echo' | 'rest';

const GOLD = 0xffd96a;
const PALE = 0xffeec2;
const FIRE = 0xff6a2a;
const OFF: Rect = { x: -9999, y: -9999, w: 1, h: 1 };

/** Sun form timings, arrays are [P4, P5]. Wind-up floors: P4 >= 500, P5 >= 420. */
export const S = {
  crownN: [5, 6],
  crownOrbit: [1100, 900],
  crownGap: [320, 250],
  crownSpeed: [210, 240],
  flareMarker: [800, 650],
  flareBeam: 420,
  sunfallRise: 450,
  sunfallTrack: [900, 750],
  sunfallLock: 320,
  sunfallCrash: 200,
  coreOpen: [1600, 1300],
  coronaTele: [700, 560],
  coronaSpeed: 130,
  coronaGap: 1.15, // radians
  wellTele: 650,
  wellMs: 2200,
  wellPull: 75,
  wellCore: 1000,
  crack: 1000,
  echoCooldown: 11000,
  cooldown: [950, 800],
  rest: 900,
  zenith: 1500,
};

interface Ring {
  cx: number;
  cy: number;
  r: number;
  gap: number;
  max: number;
  hb: Hitbox;
}

/**
 * The Hollow Sun (P4-P5): floating colossus, armour takes x0.5, the core opens after committal
 * moves (punish x1.25). Reflecting a Crown blade cracks the core open.
 *  Crown of Blades (white), Solar Flare (red, low = jump / high = stay down), Sunfall (red, main
 *  punish), Corona Pulse (red ring with a gap; dash through), P5: Gravity Well, Echo of the First
 *  Blade (white add; the sun only uses Crown while it lives).
 * Attack visuals are temp (removed on abort) and their hitboxes are killed with them.
 */
export class SunKit {
  zenith = false;
  private swords: Phaser.GameObjects.Image[] = [];
  private orbitA = 0;
  private rings: Ring[] = [];
  private ringG: Phaser.GameObjects.Graphics;
  private embers: { img: Phaser.GameObjects.Sprite; a: number }[] = [];
  private wellUntil = 0;
  private hbs = new Set<Hitbox>();
  private side: 1 | -1 = 1;
  private sideTimer = 0;
  private tracking?: Phaser.GameObjects.Ellipse;
  private disc: Phaser.GameObjects.Image;
  private warm: Phaser.GameObjects.Rectangle;
  private nextMote = 0;
  private nextClang = 0;
  private echoReadyAt = 0;
  private gone = false;

  constructor(private b: Aurren) {
    const gs = b.gs;
    this.ringG = b.track(gs.add.graphics().setDepth(17));
    this.disc = b.track(gs.add.image(b.x, b.y, 'sun-disc').setBlendMode(Phaser.BlendModes.ADD).setDepth(14).setAlpha(0).setScale(1.3));
    gs.tweens.add({ targets: this.disc, alpha: 0.7, duration: 1200 });
    this.warm = b.track(gs.add.rectangle(0, 0, GAME_W, GAME_H, 0xffb347, 0).setOrigin(0, 0).setScrollFactor(0).setBlendMode(Phaser.BlendModes.ADD).setDepth(29));
    gs.tweens.add({ targets: this.warm, fillAlpha: 0.08, duration: 1500 });
    this.echoReadyAt = gs.time.now + 4000;
  }

  private get i(): 0 | 1 {
    return this.zenith ? 1 : 0;
  }
  get cooldown(): number {
    return S.cooldown[this.i];
  }
  private get gs() {
    return this.b.gs;
  }
  private get p() {
    return this.b.player;
  }

  private hb(h: Hitbox): Hitbox {
    this.hbs.add(h);
    this.gs.damage.add(h.ownedBy(this.b));
    return h;
  }

  // ------------------------------------------------------------------ loop
  think(dt: number): void {
    const b = this.b;
    if (b.busyNow) {
      if (!b.motion && !this.tracking) b.body.setVelocity(0, b.isVulnerable || b.isTransforming ? 0 : Math.cos(b.t / 260) * 5);
      return;
    }
    b.cd -= dt;
    b.facePlayer();
    this.hover(dt);
    if (b.cd > 0 || !this.p.alive) return;
    this.pick();
  }

  /** Drifts beside the player, reachable by jump + up-slash or from the platforms. */
  private hover(dt: number): void {
    const b = this.b;
    const A = b.A;
    this.sideTimer -= dt;
    if (this.sideTimer <= 0) {
      this.sideTimer = 5000 + Math.random() * 3000;
      this.side = Math.random() < 0.5 ? 1 : -1;
    }
    const px = this.p.x;
    if (px + this.side * 90 < A.l + 40 || px + this.side * 90 > A.r - 40) this.side = this.side > 0 ? -1 : 1;
    const tx = b.clampX(px + this.side * 90 + Math.sin(b.t / 1300) * 24, 30);
    const ty = A.floor - 100 + Math.sin(b.t / 2400) * 10 + Math.sin(b.t / 500) * 3;
    b.body.setVelocity((tx - b.x) * 1.8, (ty - b.y) * 2.2);
  }

  update(now: number, dt: number): void {
    const b = this.b;
    if (this.gone) return;
    // radiance
    this.disc.setPosition(b.x, b.y).setRotation(b.t / 9000);
    this.disc.setScale((this.zenith ? 2 : 1.6) * (1 + Math.sin(b.t / 420) * 0.04));
    if (now >= this.nextMote) {
      this.nextMote = now + (this.zenith ? 90 : 150);
      const A = b.A;
      const m = b.track(this.gs.add.image(A.l + Math.random() * (A.r - A.l), A.floor - 2, 'light').setTint(GOLD).setScale(0.12).setAlpha(0.55).setBlendMode(Phaser.BlendModes.ADD).setDepth(13));
      this.gs.tweens.add({ targets: m, y: m.y - 50 - Math.random() * 50, x: m.x + (Math.random() - 0.5) * 20, alpha: 0, duration: 1400, onComplete: () => m.destroy() });
    }
    // orbiting swords
    this.orbitA += dt * (this.zenith ? 0.0045 : 0.0035);
    const n = this.swords.length;
    this.swords.forEach((s, j) => {
      if (!s.active) return;
      const a = this.orbitA + (j / n) * Math.PI * 2;
      s.setPosition(b.x + Math.cos(a) * 40, b.y + Math.sin(a) * 32).setRotation(a);
    });
    // embers
    for (const e of this.embers) {
      if (!e.img.active) continue;
      e.a += dt * 0.0024;
      e.img.setPosition(b.x + Math.cos(e.a) * 50, b.y + Math.sin(e.a) * 50);
    }
    // gravity well pull (a dash cuts free)
    if (now < this.wellUntil && this.p.alive && !this.p.fsm.is('dash')) {
      const dx = b.x - this.p.x;
      if (Math.abs(dx) > 18) {
        const dir = Math.sign(dx);
        const blocked = dir > 0 ? this.p.body.blocked.right : this.p.body.blocked.left;
        if (!blocked) this.p.x += (dir * S.wellPull * dt) / 1000;
      }
      if (Math.random() < 0.4) {
        const a = Math.random() * Math.PI * 2;
        const d = b.track(this.gs.add.image(b.x + Math.cos(a) * 90, b.y + Math.sin(a) * 70, 'light').setTint(0xc77dff).setScale(0.12).setBlendMode(Phaser.BlendModes.ADD).setDepth(17));
        this.gs.tweens.add({ targets: d, x: b.x, y: b.y, alpha: 0, duration: 380, onComplete: () => d.destroy() });
      }
    }
    // sunfall shadow tracking the player
    if (this.tracking) {
      const tx = b.clampX(this.p.x, 26);
      this.tracking.x += (tx - this.tracking.x) * Math.min(1, dt * 0.01);
      b.body.reset(b.x + (this.tracking.x - b.x) * Math.min(1, dt * 0.01), b.y);
    }
    this.updateRings(dt);
  }

  // ------------------------------------------------------------------ damage hooks
  onHit(_hit: HitInfo): void {
    const now = this.gs.time.now;
    if (this.b.isVulnerable || this.b.stunned || now < this.nextClang) return;
    this.nextClang = now + 700;
    this.gs.juice.floatText(this.b.x, this.b.y - 34, 'CLANG', '#8b8ba8');
    sfx.parry();
  }

  /** Reflected blade / parry: the core cracks open. */
  crack(): void {
    const b = this.b;
    if (b.isVulnerable || b.isTransforming) return;
    b.abort();
    b.taunt('CORE CRACKED', '#7fdbff');
    this.gs.juice.ring(b.x, b.y, 0x7fdbff, 1.8);
    this.gs.juice.burst(b.x, b.y, PALE, 16, 1.1);
    tone(1200, 0.3, 'triangle', 0.08, 300);
    b.openWindow(S.crack, 'stun');
  }

  abort(): void {
    for (const h of this.hbs) h.kill();
    this.hbs.clear();
    for (const s of this.swords) s.destroy();
    this.swords = [];
    for (const e of this.embers) e.img.destroy();
    this.embers = [];
    for (const r of this.rings) r.hb.kill();
    this.rings = [];
    this.ringG.clear();
    this.wellUntil = 0;
    this.tracking?.destroy();
    this.tracking = undefined;
  }

  zenithTransform(): void {
    const b = this.b;
    b.abort();
    b.holdPose('cast', S.zenith);
    b.taunt('ZENITH', '#ffeec2');
    tone(147, 1.4, 'triangle', 0.08, 588);
    this.gs.tweens.add({ targets: this.disc, alpha: 0.75, duration: S.zenith });
    b.phaseChange(S.zenith, () => {
      this.zenith = true;
      this.gs.juice.burst(b.x, b.y, GOLD, 30, 1.6);
      this.gs.juice.ring(b.x, b.y, PALE, 3);
      this.gs.juice.shake(0.012, 400);
      this.gs.juice.punch(0.06, 240);
      this.gs.tweens.add({ targets: this.warm, fillAlpha: 0.1, duration: 600 });
      b.cd = 800;
    });
  }

  fadeOut(): void {
    this.gs.tweens.add({ targets: [this.disc], alpha: 0, duration: 900 });
    this.gs.tweens.add({ targets: this.warm, fillAlpha: 0, duration: 900 });
  }

  destroy(): void {
    if (this.gone) return;
    this.abort();
    this.gone = true;
    const d = this.disc, w = this.warm;
    if (d.active) this.gs.tweens.add({ targets: d, alpha: 0, duration: 600, onComplete: () => d.destroy() });
    if (w.active) this.gs.tweens.add({ targets: w, fillAlpha: 0, duration: 600, onComplete: () => w.destroy() });
    this.ringG.destroy();
  }

  // ------------------------------------------------------------------ picking
  private pick(): void {
    const b = this.b;
    const now = this.gs.time.now;
    const echoAlive = !!b.echo?.alive;
    const red = this.rings.length === 0 && !echoAlive;
    const z = this.zenith;

    const habit = b.reader.habit(now);
    if (shouldCounter(habit, b.counterAt, now, Math.random())) {
      const m = this.counterFor(habit);
      if (m && (red || m === 'crown')) {
        b.counterAt = now;
        b.taunt(b.tauntFor(habit));
        return this.begin(m);
      }
    }
    const table: [SMove, number][] = echoAlive
      ? [['crown', 0.6], ['rest', 0.4]]
      : [
          ['crown', z ? 0.22 : 0.3],
          ['flare', red ? (z ? 0.2 : 0.25) : 0],
          ['sunfall', red ? (z ? 0.23 : 0.3) : 0],
          ['corona', red ? (z ? 0.12 : 0.15) : 0],
          ['well', z ? 0.13 : 0],
          ['echo', z && now >= this.echoReadyAt ? 0.2 : 0],
        ];
    const m = pickWeighted(table, b.hist as SMove[], Math.random()) ?? 'crown';
    this.begin(m);
  }

  private counterFor(h: Habit): SMove | null {
    switch (h) {
      case 'air':
        return 'flare';
      case 'turtle':
        return 'crown';
      case 'spam':
        return 'corona';
      case 'dash':
        return this.zenith ? 'well' : 'crown';
      case 'parry':
        return 'sunfall';
      default:
        return null;
    }
  }

  private begin(m: SMove): void {
    const b = this.b;
    b.hist.unshift(m);
    b.hist.length = Math.min(b.hist.length, 3);
    b.busyNow = true;
    b.body.setVelocity(0, 0);
    switch (m) {
      case 'crown': return this.crown();
      case 'flare': return this.flare();
      case 'sunfall': return this.sunfall();
      case 'corona': return this.corona();
      case 'well': return this.well();
      case 'echo': return this.summonEcho();
      case 'rest':
        b.step(S.rest, () => b.finish(400));
        return;
    }
  }

  // ------------------------------------------------------------------ moves
  /** Crown of Blades: swords orbit (wind-up), then fly at the player one by one. Reflect = core crack. */
  private crown(): void {
    const b = this.b;
    const i = this.i;
    const n = S.crownN[i], orbit = S.crownOrbit[i], gap = S.crownGap[i];
    b.holdPose('cast', orbit + n * gap + 200);
    b.telegraph(Math.min(orbit, 700), 0xffffff);
    tone(990, orbit / 1000, 'triangle', 0.05, 1480);
    this.swords = [];
    for (let k = 0; k < n; k++) {
      const s = b.track(this.gs.add.image(b.x, b.y, 'aurren-sword').setDepth(17).setAlpha(0), true);
      this.gs.tweens.add({ targets: s, alpha: 1, duration: 250, delay: k * 60 });
      this.swords.push(s);
    }
    for (let k = 0; k < n; k++) {
      b.step(orbit + k * gap - 170, () => {
        const s = this.swords[k];
        if (s?.active) s.setTintFill(0xffffff);
      });
      b.step(orbit + k * gap, () => {
        const s = this.swords[k];
        if (!s?.active) return;
        const a = Math.atan2(this.p.y - s.y, this.p.x - s.x);
        const v = S.crownSpeed[i];
        this.gs.spawnProjectile(s.x, s.y, 'aurren-sword', Math.cos(a) * v, Math.sin(a) * v, 'enemy', { damage: 1, lifeMs: 3000, owner: b, rotate: true });
        noise(0.08, 0.1, 4000, 0, 1, 'highpass');
        s.destroy();
      });
    }
    b.step(orbit + n * gap + 250, () => {
      this.swords = [];
      b.finish();
    });
  }

  /** Solar Flare: a full-width beam, low (jump it / stand on a platform) or high (stay on the floor). */
  private flare(): void {
    const b = this.b;
    const i = this.i;
    const p = this.p;
    const first: 'low' | 'high' = p.grounded && p.y > b.A.floor - 40 ? 'low' : 'high';
    const kinds: ('low' | 'high')[] = this.zenith ? [first, first === 'low' ? 'high' : 'low'] : [first];
    const one = S.flareMarker[i] + S.flareBeam + 150;
    b.holdPose('cast', kinds.length * one + 200);
    b.telegraph(450, UNPARRYABLE_TINT, true);
    kinds.forEach((k, j) => this.fireFlare(k, j * one));
    b.step(kinds.length * one + 200, () => b.finish());
  }

  private fireFlare(kind: 'low' | 'high', at: number): void {
    const b = this.b;
    const gs = this.gs;
    const A = b.A;
    const h = kind === 'low' ? 18 : 30;
    const y0 = kind === 'low' ? A.floor - 20 : A.floor - 76;
    const cy = y0 + h / 2;
    const w = A.r - A.l;
    const marker = S.flareMarker[this.i];
    b.step(at, () => {
      const band = b.track(gs.add.rectangle(A.l + w / 2, cy, w, h, UNPARRYABLE_TINT, 0.2).setStrokeStyle(1, UNPARRYABLE_TINT, 0.9).setDepth(41), true);
      const l = b.track(gs.add.rectangle(A.l + 4, cy, 8, h + 4, UNPARRYABLE_TINT).setDepth(41), true);
      const r = b.track(gs.add.rectangle(A.r - 4, cy, 8, h + 4, UNPARRYABLE_TINT).setDepth(41), true);
      // chevrons along the band, pointing away from the sun (the beam's direction of travel)
      const chev = b.track(gs.add.graphics().setDepth(41), true);
      chev.fillStyle(0xffffff, 0.9);
      for (let x = A.l + 24; x < A.r - 16; x += 36) {
        const d = x >= b.x ? 1 : -1;
        chev.fillTriangle(x - d * 3, cy - 4, x - d * 3, cy + 4, x + d * 3, cy);
      }
      gs.tweens.add({ targets: [band, l, r, chev], alpha: 0.4, yoyo: true, repeat: -1, duration: 100 });
      tone(kind === 'low' ? 330 : 660, marker / 1000, 'sawtooth', 0.04, kind === 'low' ? 220 : 990);
      b.step(marker, () => {
        band.destroy();
        l.destroy();
        r.destroy();
        chev.destroy();
        const beam = b.track(gs.add.image(A.l, cy, 'sun-flare').setOrigin(0, 0.5).setDisplaySize(w, h + 10).setBlendMode(Phaser.BlendModes.ADD).setDepth(17), true);
        const core = b.track(gs.add.rectangle(A.l + w / 2, cy, w, Math.max(3, h * 0.25), 0xffffff, 0.9).setDepth(17), true);
        beam.scaleY *= 0.2;
        gs.tweens.add({ targets: beam, scaleY: beam.scaleY * 5, duration: 70 });
        gs.juice.shake(0.006, 200);
        noise(0.35, 0.14, 2500, 0, 1, 'highpass');
        this.hb(new Hitbox('enemy', () => ({ x: A.l, y: y0, w, h }), () => ({ damage: 2, kbX: (this.p.x >= b.x ? 1 : -1) * 200, kbY: -200, sourceX: b.x, parryable: false, kind: 'melee' }), S.flareBeam));
        b.step(S.flareBeam, () => {
          gs.tweens.add({ targets: [beam, core], alpha: 0, duration: 140, onComplete: () => { beam.destroy(); core.destroy(); } });
        });
      });
    });
  }

  /** Sunfall: rises, its shadow hunts the player, locks, crashes down; lies there with the core open. */
  private sunfall(): void {
    const b = this.b;
    const i = this.i;
    const A = b.A;
    b.holdPose('fall', 5000);
    b.glide(b.clampX(this.p.x, 30), A.ceil + 36, S.sunfallRise, () => {
      const shadow = b.track(this.gs.add.ellipse(b.x, A.floor - 2, 56, 8, UNPARRYABLE_TINT, 0.85).setStrokeStyle(1, 0xffffff, 0.8).setDepth(41), true);
      this.tracking = shadow;
      tone(120, S.sunfallTrack[i] / 1000, 'sawtooth', 0.05, 240);
      b.step(S.sunfallTrack[i], () => {
        this.tracking = undefined;
        b.telegraph(S.sunfallLock, UNPARRYABLE_TINT, true);
        this.gs.tweens.add({ targets: shadow, alpha: 0.25, yoyo: true, repeat: -1, duration: 60 });
        b.step(S.sunfallLock, () => {
          const lx = shadow.x;
          noise(0.3, 0.16, 1200);
          b.glide(lx, A.floor - 22, S.sunfallCrash, () => this.sunfallLand(shadow));
          this.hb(new Hitbox('enemy', () => ({ x: b.x - 22, y: b.y - 22, w: 44, h: 44 }), () => ({ damage: 2, kbX: (this.p.x >= b.x ? 1 : -1) * 240, kbY: -240, sourceX: b.x, parryable: false, kind: 'melee' }), S.sunfallCrash + 60));
        });
      });
    });
  }

  private sunfallLand(shadow: Phaser.GameObjects.Ellipse): void {
    const b = this.b;
    shadow.destroy();
    this.gs.juice.impact('land', b.x, b.A.floor, Math.PI / 2, 2);
    this.gs.juice.dust(b.x, b.A.floor, 14, 1.2);
    this.gs.juice.burst(b.x, b.A.floor - 6, GOLD, 18, 1.2);
    this.gs.juice.ring(b.x, b.A.floor - 10, GOLD, 2);
    tone(70, 0.4, 'sine', 0.35, 35);
    b.waves(170, 1);
    b.openWindow(S.coreOpen[this.i], 'coreopen');
  }

  /** Corona Pulse: an expanding fire ring with one gap (dash through it or find the gap). */
  private corona(): void {
    const b = this.b;
    const i = this.i;
    const tele = S.coronaTele[i];
    b.holdPose('windup', tele);
    b.telegraph(tele, UNPARRYABLE_TINT, true);
    tone(200, tele / 1000, 'sawtooth', 0.05, 600);
    const count = this.zenith ? 2 : 1;
    b.step(tele, () => {
      b.holdPose('cast', 900);
      for (let k = 0; k < count; k++) b.step(k * 650, () => this.spawnRing());
    });
    const A = b.A;
    const max = Math.hypot(A.r - A.l, A.floor - A.ceil);
    b.step(tele + (count - 1) * 650 + ((max * 0.6) / S.coronaSpeed) * 1000, () => b.finish());
  }

  private spawnRing(): void {
    const b = this.b;
    const A = b.A;
    const toP = Math.atan2(this.p.y - b.y, this.p.x - b.x);
    const gap = toP + (Math.random() < 0.5 ? -1 : 1) * (0.5 + Math.random() * 0.5);
    const max = Math.hypot(A.r - A.l, A.floor - A.ceil);
    const ring: Ring = { cx: b.x, cy: b.y, r: 12, gap, max, hb: undefined as unknown as Hitbox };
    ring.hb = this.hb(new Hitbox('enemy', () => (this.ringHits(ring) ? this.p.hurtRect() : OFF), () => ({ damage: 1, kbX: (this.p.x >= ring.cx ? 1 : -1) * 200, kbY: -200, sourceX: ring.cx, parryable: false, kind: 'melee' }), ((max - 12) / S.coronaSpeed) * 1000));
    this.rings.push(ring);
    this.gs.juice.ring(b.x, b.y, FIRE, 1.4);
    noise(0.4, 0.12, 900);
  }

  private ringHits(r: Ring): boolean {
    const pr = this.p.hurtRect();
    const px = pr.x + pr.w / 2, py = pr.y + pr.h / 2;
    const d = Math.hypot(px - r.cx, py - r.cy);
    if (Math.abs(d - r.r) > 4 + pr.h / 2) return false;
    const diff = Phaser.Math.Angle.Wrap(Math.atan2(py - r.cy, px - r.cx) - r.gap);
    return Math.abs(diff) > S.coronaGap / 2;
  }

  private updateRings(dt: number): void {
    const g = this.ringG;
    g.clear();
    if (!this.rings.length) return;
    this.rings = this.rings.filter((r) => {
      r.r += (S.coronaSpeed * dt) / 1000;
      if (r.r >= r.max) {
        r.hb.kill();
        return false;
      }
      return true;
    });
    for (const r of this.rings) {
      const a0 = r.gap + S.coronaGap / 2, a1 = r.gap - S.coronaGap / 2 + Math.PI * 2;
      g.lineStyle(5, FIRE, 0.85);
      g.beginPath();
      g.arc(r.cx, r.cy, r.r, a0, a1, false);
      g.strokePath();
      g.lineStyle(1, 0xffffff, 0.95);
      g.beginPath();
      g.arc(r.cx, r.cy, r.r, a0, a1, false);
      g.strokePath();
      // gap edge sparks
      g.fillStyle(GOLD, 1);
      for (const a of [a0, a1]) g.fillRect(r.cx + Math.cos(a) * r.r - 2, r.cy + Math.sin(a) * r.r - 2, 4, 4);
    }
  }

  /** Gravity Well (P5): sinks low, pulls the player in, embers orbit (parryable); ends core-open. */
  private well(): void {
    const b = this.b;
    const A = b.A;
    b.holdPose('windup', 2000);
    b.glide(b.clampX(b.x, 60), A.floor - 64, 350, () => {
      b.telegraph(S.wellTele, 0xffffff);
      tone(110, (S.wellTele + S.wellMs) / 1000, 'sine', 0.12, 55);
      b.step(S.wellTele, () => {
        b.holdPose('cast', S.wellMs);
        this.wellUntil = this.gs.time.now + S.wellMs;
        for (let k = 0; k < 3; k++) {
          const img = b.track(this.gs.add.sprite(b.x, b.y, 'sun-ember').setDepth(17), true);
          img.play('sun-ember-fly');
          const e = { img, a: (k / 3) * Math.PI * 2 };
          this.embers.push(e);
          this.hb(new Hitbox('enemy', () => (img.active ? { x: img.x - 4, y: img.y - 4, w: 8, h: 8 } : OFF), () => ({ damage: 1, kbX: (this.p.x >= img.x ? 1 : -1) * 170, kbY: -170, sourceX: img.x, parryable: true, kind: 'melee' }), S.wellMs, () => {
            this.gs.juice.burst(img.x, img.y, GOLD, 8, 0.8);
            img.destroy();
          }));
        }
      });
      b.step(S.wellTele + S.wellMs, () => {
        for (const e of this.embers) e.img.destroy();
        this.embers = [];
        this.wellUntil = 0;
        b.openWindow(S.wellCore, 'coreopen');
      });
    });
  }

  /** Echo of the First Blade (P5): a ghost of his old self fights beside the sun. */
  private summonEcho(): void {
    const b = this.b;
    const gs = this.gs;
    b.holdPose('cast', 800);
    b.telegraph(500, PALE);
    b.step(500, () => {
      const A = b.A;
      const side = this.p.x < b.x ? -1 : 1;
      const ex = b.clampX(this.p.x + side * 60, 24);
      const echo = new AurrenEcho(gs, ex, A.floor - 8);
      gs.enemies.add(echo);
      b.echo = echo;
      this.echoReadyAt = gs.time.now + S.echoCooldown;
      b.taunt('REMEMBER ME.', '#ffeec2');
    });
    b.step(800, () => b.finish());
  }
}
