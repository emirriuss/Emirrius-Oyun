import Phaser from 'phaser';
import { Boss } from './Boss';
import type { Projectile } from '../Projectile';
import type { HitInfo } from '../../combat/types';
import { bus } from '../../core/events';
import { sfx } from '../../systems/sfx';
import { playMusic } from '../../systems/music';
import { phaseCinematic } from '../../core/cinematics';
import { addLight, glow } from '../../core/Fx';
import { txt } from '../../ui/text';
import * as U from '../../combat/umbraPlan';
import { Lantern, DimOverlay, LAMP_DEPTH, type Hole } from './umbraProps';
import type { GameScene } from '../../scenes/GameScene';

/**
 * World 4-10: UMBRA, THE CAST SHADOW. A shadow with no one standing in it, cast by lanterns on a
 * ceiling rail. Swords pass straight through it, except where a lantern hangs almost straight above its
 * feet: there it condenses into a solid puddle that can be cut. Strike the lantern to move the light
 * (side hits slide it, up-slash hoists it, pogo lowers it); every rule lives in combat/umbraPlan.ts.
 *
 *  P1 "Lamplit": one lantern. Lean Strike (parryable claw whose reach is the length of the shadow
 *     leaning at you: keep the light between you), Dusk Sweep (floor wave: jump or parry), Snuff Wisp
 *     (a wisp that knocks the lantern away from it: parry it), Pounce (red; sprawls after: the punish,
 *     a full one if it lands under the light).
 *  P2 "Twin Lamps": a second lantern, two shadows from one body. + Cross-cast (a parryable claw, a glide
 *     under you, then a red claw from the other side) and Lamp Swap (the lanterns trade places).
 *  P3 "Lights Out" (skippable cinematic): one lantern left and the room goes dark; the caster steps out of
 *     its shadow and is solid from now on. Long Arm (parryable), Dusk Sweep both ways, Gutter (snuffs the
 *     lantern: hit it once to relight it; it takes less damage in the dark), Eclipse Grab (red lunge,
 *     then gorged: the punish).
 */

const SHADE_DEPTH = 14; // under the boss (15) and the player (20)
const DARK_DIM = 12; // P1/P2: the darkness only dims the room
const DARK_DEEP = 35; // P3: the darkness covers the actors; lamps, eyes and projectiles sit above it
const INK = 0xb9a6ff; // parryable telegraph flash (reads on a black shadow)
const VIOLET = 0x8b6bd6;

type Wisp = { p: Projectile; lamp: Lantern; action: 'push' | 'snuff' };

export class Umbra extends Boss {
  private hist: U.UmbraMove[] = [];
  private lamps: Lantern[] = [];
  private shades: Phaser.GameObjects.Sprite[] = [];
  private dark?: DimOverlay;
  private rail: Phaser.GameObjects.Graphics;
  private eyeGlow: Phaser.GameObjects.Image;
  /** violet pool of light under it while it is solid (works with Visual FX off) */
  private solidGlow: Phaser.GameObjects.Image;
  private temp: Phaser.GameObjects.GameObject[] = [];
  private wisps: Wisp[] = [];
  /** P1/P2: a lit lantern hangs close enough above it to make it solid */
  private condensed = false;
  private shownSolid = false;
  private passes = 0;
  private lastPass = 0;
  /** mid-pounce (contact damage while airborne) */
  private airborne = false;
  /** P3 arena built (the caster is out) */
  private p3 = false;

  constructor(gs: GameScene, x: number, y: number) {
    super(gs, x, y, 'umbra', U.BAR_NAME, { hp: U.HP, bodyW: 16, bodyH: 34, contactDamage: 0, shards: 100 });
    this.thresholds = [...U.THRESHOLDS];
    this.deathTint = VIOLET;
    this.hearts = { ...U.HEARTS };
    // the shadow form is drawn by its shades; the sprite itself only shows when solid
    gs.tweens.killTweensOf(this);
    this.setAlpha(0);

    this.rail = gs.add.graphics().setDepth(LAMP_DEPTH - 2);
    this.rail.fillStyle(0x2c2244, 1).fillRect(U.RAIL.min - 16, U.RAIL.y - 3, U.RAIL.max - U.RAIL.min + 32, 3);
    this.rail.fillStyle(0x6a5c94, 1);
    for (let rx = U.RAIL.min - 12; rx <= U.RAIL.max + 12; rx += 32) this.rail.fillRect(rx, U.RAIL.y - 3, 2, 1);
    this.eyeGlow = addLight(gs, x, y, 0xff8fb8, 14, 0).setDepth(DARK_DEEP + 2);
    this.solidGlow = addLight(gs, x, y, VIOLET, 26, 0).setDepth(SHADE_DEPTH);
    glow(this, VIOLET, 1.5); // rim so the puddle / caster reads on the dark floor
    this.dark = new DimOverlay(gs, DARK_DIM);

    // "Retry from Twin Lamps / Lights Out": start straight in a later phase (the intro still plays)
    const r = U.resumeState(gs.bossStage);
    if (r) {
      this.phase = r.phase;
      this.hp = Math.floor(this.maxHp * r.hpFrac);
      bus.emit('boss', this.bossName, this.hp, this.maxHp);
    }
    this.setLamps(U.lanternLayout(this.phase, x), false);
    if (this.phase >= 3) this.buildP3();
    else {
      this.dark.fadeTo(0.3, 1400);
      if (!r) this.hint();
    }
    this.once(Phaser.GameObjects.Events.DESTROY, () => this.cleanup());
  }

  private get ph(): 0 | 1 | 2 {
    return (Math.max(1, Math.min(3, this.phase)) - 1) as 0 | 1 | 2;
  }

  // ------------------------------------------------------------------ lanterns + shadows
  private setLamps(layout: U.LanternState[], dropIn: boolean): void {
    for (const l of this.lamps) l.destroy();
    for (const s of this.shades) s.destroy();
    this.lamps = [];
    this.shades = [];
    for (const st of layout) this.addLamp(st, dropIn);
  }

  private addLamp(st: U.LanternState, dropIn: boolean): void {
    this.lamps.push(new Lantern(this.gs, st, (l, _k, relit) => this.lampStruck(l, relit), dropIn));
    const shade = this.gs.add.sprite(this.x, this.body.bottom, 'umbra', 0).setOrigin(0.5, 1).setDepth(SHADE_DEPTH);
    glow(shade, VIOLET, 1.5); // violet rim: a black shadow on a dark room
    this.shades.push(shade);
  }

  private lampStruck(l: Lantern, relit: boolean): void {
    if (relit) this.gs.juice.floatText(l.lx, l.ly - 14, 'RELIT', '#ffd96a');
  }

  /** the lantern whose light currently condenses it (P1/P2) */
  private condensingLamp(): Lantern | undefined {
    return this.lamps.find((l) => l.lit && U.shadowGeom(l.lx, l.ly, this.x).condensed);
  }

  private lights(): { x: number; y: number; lit: boolean }[] {
    return this.lamps.map((l) => ({ x: l.lx, y: l.ly, lit: l.lit }));
  }

  private get lampOut(): boolean {
    return this.phase >= 3 && this.lamps.length > 0 && !this.lamps.some((l) => l.lit);
  }

  /** a lit lantern is close to condensing it (it would rather push the light away) */
  private lampNear(): boolean {
    return this.lamps.some((l) => l.lit && Math.abs(l.lx - this.x) < U.condenseHalfWidth(l.ly) + 40);
  }

  /** reach (px) of a claw toward the player: the shadow leaning at them */
  private reachToward(): number {
    const dir = Math.sign(this.dxToPlayer()) || this.facing;
    if (this.lampOut) return 56; // nothing to measure it by in the dark
    return Math.max(16, U.reachFor(U.stretchToward(this.lights(), this.x, dir)));
  }

  // ------------------------------------------------------------------ hits
  receiveHit(hit: HitInfo): 'hit' | 'blocked' | 'ignored' {
    if (!this.alive || !this.body?.enable) return 'ignored';
    if (this.phase < 3 && !this.transforming && !this.condensed && !this.vulnerable && !this.stunned) {
      // the blade passes through a shadow
      const now = this.gs.time.now;
      if (now - this.lastPass > 140) {
        this.lastPass = now;
        sfx.shadowPass();
        this.gs.juice.burst(this.x, this.y - 6, 0x463a66, 6, 0.6);
        if (this.passes++ < 3) this.gs.juice.floatText(this.x, this.y - 30, 'THROUGH', '#b9a6ff');
      }
      return 'ignored';
    }
    return super.receiveHit(hit);
  }

  protected damageTakenMul(): number {
    if (this.transforming) return 0;
    return U.damageMul({ phase: this.phase, condensed: this.condensed, recovering: this.vulnerable || this.stunned, lampOut: this.lampOut });
  }

  // ------------------------------------------------------------------ frame
  protected animKey(): string {
    const s = this.p3 ? 'umbra-body' : 'umbra';
    if (this.stunned) return s + '-stun';
    const pose = this.curPose;
    if (pose) return s + '-' + pose;
    if (!this.p3 && this.condensed) return 'umbra-puddle';
    return Math.abs(this.body.velocity.x) > 5 ? s + '-move' : s + '-idle';
  }

  /** the shadows always show the standing silhouette in the current pose */
  private shadeKey(): string {
    if (this.stunned) return 'umbra-stun';
    const pose = this.curPose;
    if (pose) return 'umbra-' + pose;
    return Math.abs(this.body.velocity.x) > 5 ? 'umbra-move' : 'umbra-idle';
  }

  tick(time: number, dt: number): void {
    super.tick(time, dt);
    if (!this.alive) return;
    if (this.lamps.length === 2) {
      // never let two lanterns stack (one swing would move both)
      const [a, b] = this.lamps;
      const [na, nb] = U.separateLamps(a.st.x, b.st.x);
      if (na !== a.st.x) a.moveTo(na);
      if (nb !== b.st.x) b.moveTo(nb);
    }
    for (const l of this.lamps) l.update(dt);
    this.contactDamage = this.airborne && !this.onGround ? 1 : 0;
    this.updateCondensed();
    this.updateWisps();
    this.updateVisuals(dt);
  }

  private updateCondensed(): void {
    const was = this.condensed;
    this.condensed = !this.p3 && !!this.condensingLamp();
    if (this.condensed && !was) {
      this.gs.juice.ring(this.x, this.body.bottom - 6, VIOLET, 1.2);
      sfx.slam();
      if (!this.shownSolid) {
        this.shownSolid = true;
        this.gs.juice.floatText(this.x, this.y - 44, 'SOLID!', '#ffd96a');
      }
    } else if (!this.condensed && was) this.gs.juice.burst(this.x, this.body.bottom - 4, 0x463a66, 6, 0.5);
  }

  private updateVisuals(dt: number): void {
    const solid = this.p3 || this.condensed || this.vulnerable || this.stunned || this.transforming;
    const k = Math.min(1, dt / 90);
    this.setAlpha(this.alpha + ((solid ? 1 : 0) - this.alpha) * k);

    const key = this.shadeKey();
    const feet = this.body.bottom;
    this.lamps.forEach((l, i) => {
      const s = this.shades[i];
      if (!s) return;
      const g = U.shadowGeom(l.lx, l.ly, this.x);
      // a condensed shadow IS the puddle (the sprite); P3 shadows are just shadows
      const show = l.lit && (this.p3 || !g.condensed);
      s.setVisible(show);
      if (!show) return;
      if (s.anims.currentAnim?.key !== key && this.scene.anims.exists(key)) s.play(key);
      s.setPosition(this.x, feet)
        .setScale(1 + (g.stretch - 1) * 0.12, g.stretch)
        .setRotation(g.lean)
        .setFlipX(this.flipX)
        .setAlpha(this.p3 ? 0.55 : 0.95);
      // telegraph / parry-stun flashes show on the shadows too
      if (this.isTinted) {
        if (this.tintFill) s.setTintFill(this.tintTopLeft);
        else s.setTint(this.tintTopLeft);
      } else s.clearTint();
    });

    const pulse = 0.32 + Math.sin(this.gs.time.now / 160) * 0.08;
    this.solidGlow.setPosition(this.x, feet - 6).setAlpha(!this.p3 && this.condensed ? pulse : 0);

    // eyes in the dark (P3)
    const eyeA = this.p3 && this.dark ? Math.min(1, this.dark.alpha / 0.6) * 0.7 : 0;
    this.eyeGlow.setPosition(this.x + this.facing * 2, this.y - 15).setAlpha(eyeA);

    if (!this.dark) return;
    const holes: Hole[] = [];
    for (const l of this.lamps) if (l.lit) holes.push({ x: l.lx, y: l.ly + 30, r: this.p3 ? 110 : 96, a: 1 });
    const p = this.player;
    if (this.p3) {
      holes.push({ x: p.x, y: p.y, r: 54, a: 1 }, { x: p.x, y: p.y, r: 30, a: 1 });
      const lit = this.telegraphing || this.vulnerable || this.curPose !== '';
      holes.push({ x: this.x, y: this.y, r: lit ? 44 : 28, a: lit ? 0.9 : 0.4 });
      for (const h of this.gs.pickups.getChildren() as Phaser.GameObjects.Sprite[]) {
        if (h.active && h.getData('kind') === 'heart') holes.push({ x: h.x, y: h.y, r: 22, a: 0.9 });
      }
    } else holes.push({ x: p.x, y: p.y, r: 40, a: 0.6 });
    this.dark.draw(holes);
  }

  // ------------------------------------------------------------------ AI
  protected think(dt: number): void {
    if (this.busy) return;
    this.cooldown -= dt;
    this.facePlayer();
    this.walk();
    if (this.cooldown > 0) return;
    const m = U.pickUmbraMove({ phase: this.phase, dist: Math.abs(this.dxToPlayer()), lampNear: this.lampNear(), lampOut: this.lampOut }, this.hist);
    this.hist.push(m);
    if (this.hist.length > 8) this.hist.shift();
    this.body.setVelocityX(0);
    const moves: Record<U.UmbraMove, () => void> = {
      lean: () => this.leanStrike(),
      sweep: () => this.duskSweep(),
      wisp: () => this.snuffWisp('push'),
      pounce: () => this.pounce(),
      cross: () => this.crossCast(),
      swap: () => this.lampSwap(),
      longarm: () => this.leanStrike(true),
      gutter: () => this.snuffWisp('snuff'),
      grab: () => this.eclipseGrab(),
    };
    moves[m]();
  }

  private walk(): void {
    const speed = U.WALK[this.ph];
    const dx = this.dxToPlayer();
    const adx = Math.abs(dx);
    let v = 0;
    if (this.condensed) {
      // crawl out of the light
      const l = this.condensingLamp();
      const dir = (l && Math.sign(this.x - l.lx)) || -this.facing;
      v = dir * speed * U.CONDENSED_SPEED;
    } else {
      const [near, far] = this.p3 ? [46, 90] : [60, 120];
      const dir = Math.sign(dx) || 1;
      if (adx > far) v = dir * speed;
      else if (adx < near) v = -dir * speed * 0.6;
      // a shadow never walks into the light on purpose
      if (v !== 0 && !this.p3 && this.lightAhead(Math.sign(v))) v = 0;
    }
    const nx = this.x + Math.sign(v) * 20;
    if (nx < U.ARENA.left + 10 || nx > U.ARENA.right - 10) v = 0;
    this.body.setVelocityX(v);
  }

  private lightAhead(dir: number): boolean {
    const x = this.x + dir * 14;
    return this.lamps.some((l) => l.lit && Math.abs(x - l.lx) < U.condenseHalfWidth(l.ly) + 6 && Math.abs(x - l.lx) < Math.abs(this.x - l.lx));
  }

  // ------------------------------------------------------------------ moves
  /** Lean Strike / Long Arm: a parryable claw as long as the shadow leaning at the player. */
  private leanStrike(long = false): void {
    const tele = U.WINDUP[long ? 'longarm' : 'lean'][this.ph];
    this.attack(tele + 380, U.COOLDOWN[this.ph], () => {
      this.telegraph(tele, INK);
      this.setPose('windup', tele);
      this.later(tele, () => {
        this.facePlayer();
        const reach = this.reachToward() + (long ? 12 : 0);
        this.setPose('lean', 340);
        this.claw(reach, true);
      });
    });
  }

  /** claw hitbox + an ink smear the length of it */
  private claw(reach: number, parryable: boolean): void {
    this.meleeBox(6, -20, reach, 28, 160, parryable ? 1 : 2, parryable, 220);
    sfx.swing();
    const x0 = this.x + this.facing * 6;
    const smear = this.gs.add.rectangle(x0 + (this.facing * reach) / 2, this.y - 6, reach, 4, 0x1c1430).setDepth(19).setStrokeStyle(1, parryable ? INK : 0xff4d5e);
    this.temp.push(smear);
    this.gs.tweens.add({ targets: smear, alpha: 0, scaleY: 3, duration: 200, onComplete: () => smear.destroy() });
  }

  /** Dusk Sweep: a shadow wave along the floor (jump it or parry it). P3 sends one each way. */
  private duskSweep(): void {
    const tele = U.WINDUP.sweep[this.ph];
    const speed = [170, 190, 210][this.ph];
    this.attack(tele + 500, U.COOLDOWN[this.ph], () => {
      this.telegraph(tele, INK);
      this.setPose('windup', tele);
      this.later(tele, () => {
        this.setPose('sweep', 420);
        this.gs.juice.shake(0.003, 150);
        const dirs = this.phase >= 3 ? [-1, 1] : [this.facing];
        for (const d of dirs) this.wave(d, speed);
        // P2: a second wave the other way a beat later
        if (this.phase === 2) this.later(380, () => this.wave(-this.facing, speed));
      });
    });
  }

  private wave(dir: number, speed: number): void {
    const p = this.gs.spawnProjectile(this.x + dir * 14, U.ARENA.floor - 6, 'umbra-wave', dir * speed, 0, 'enemy', { damage: 1, lifeMs: 3200, owner: this });
    p.body.setAllowGravity(false);
    if (this.p3) p.setDepth(DARK_DEEP + 3);
  }

  /** Snuff Wisp (push the lantern away) / Gutter (P3: put it out). The wisp can be parried back. */
  private snuffWisp(action: 'push' | 'snuff'): void {
    const lamp = this.lamps.filter((l) => l.lit).sort((a, b) => Math.abs(a.lx - this.x) - Math.abs(b.lx - this.x))[0];
    if (!lamp) return this.leanStrike(this.p3);
    const tele = U.WINDUP[action === 'snuff' ? 'gutter' : 'wisp'][this.ph];
    this.attack(tele + 400, U.COOLDOWN[this.ph], () => {
      this.telegraph(tele, INK);
      lamp.flicker(tele);
      this.setPose('roar', tele);
      this.later(tele, () => {
        if (lamp.dead || !lamp.lit) return;
        const p = this.gs.spawnProjectile(this.x, this.y - 16, 'umbra-wisp', 0, -60, 'enemy', { damage: 1, lifeMs: 3500, owner: this });
        p.body.setAllowGravity(false);
        if (this.p3) p.setDepth(DARK_DEEP + 3);
        this.wisps.push({ p, lamp, action });
        sfx.shoot();
      });
    });
  }

  /** wisps home on their lantern; parried ones (now the player's) fly back at UMBRA instead */
  private updateWisps(): void {
    this.wisps = this.wisps.filter((w) => {
      const { p, lamp } = w;
      if (p.dead || !p.active || p.team !== 'enemy' || lamp.dead) return false;
      const dx = lamp.lx - p.x, dy = lamp.ly - p.y;
      const d = Math.hypot(dx, dy);
      if (d < 9) {
        p.kill();
        if (w.action === 'snuff') lamp.snuff();
        else lamp.push(Math.sign(lamp.lx - this.x) || 1);
        return false;
      }
      const v = 150;
      p.body.setVelocity((dx / d) * v, (dy / d) * v);
      return true;
    });
  }

  /** Pounce (heavy, red): leaps at the player, lands, sprawls. Under the light that's a full punish. */
  private pounce(): void {
    const tele = U.WINDUP.pounce[this.ph];
    this.attack(tele + 1700, U.COOLDOWN[this.ph], () => {
      this.telegraph(tele, 0xffffff, true);
      this.setPose('windup', tele);
      this.later(tele, () => {
        this.facePlayer();
        this.setPose('pounce', 900);
        this.airborne = true;
        const dx = this.dxToPlayer();
        this.body.setVelocity(Phaser.Math.Clamp(dx * 1.2, -220, 220), -360);
        this.later(200, () => this.land());
      });
    });
  }

  private land(tries = 0): void {
    if (!this.onGround && tries < 40) {
      this.later(25, () => this.land(tries + 1));
      return;
    }
    this.airborne = false;
    this.body.setVelocityX(0);
    this.meleeBox(-22, -6, 44, 30, 140, 2, false, 240);
    this.gs.juice.impact('slam', this.x, this.body.bottom, Math.PI / 2);
    sfx.slam();
    this.gs.juice.burst(this.x, this.body.bottom, 0x1c1430, 16, 1.1);
    if (this.phase === 2) for (const d of [-1, 1]) this.wave(d, 150);
    this.recover(U.RECOVER_MS[this.ph], 'sprawl', U.COOLDOWN[this.ph]);
  }

  /** Cross-cast (P2): a parryable claw, a glide through the floor under the player, a red claw back. */
  private crossCast(): void {
    const tele = U.WINDUP.cross[this.ph];
    const tele2 = Math.max(450, tele - 80);
    const glideV = 360;
    const side = Math.sign(this.player.x - this.x) || this.facing;
    let target = this.player.x + side * 48;
    if (target < U.ARENA.left + 20 || target > U.ARENA.right - 20) target = this.player.x - side * 48;
    target = Phaser.Math.Clamp(target, U.ARENA.left + 20, U.ARENA.right - 20);
    const glideMs = Math.round((Math.abs(target - this.x) / glideV) * 1000);
    this.attack(tele + 300 + glideMs + tele2 + 380, U.COOLDOWN[this.ph], () => {
      this.telegraph(tele, INK);
      this.setPose('windup', tele);
      this.later(tele, () => {
        this.facePlayer();
        this.setPose('lean', 300);
        this.claw(this.reachToward(), true);
      });
      this.later(tele + 300, () => {
        const dir = Math.sign(target - this.x) || 1;
        this.setPose('move', glideMs);
        this.body.setVelocityX(dir * glideV);
        this.later(glideMs, () => {
          this.body.setVelocityX(0);
          this.facePlayer();
          this.telegraph(tele2, 0xffffff, true);
          this.setPose('windup', tele2);
          this.later(tele2, () => {
            this.facePlayer();
            this.setPose('lean', 300);
            this.claw(this.reachToward() + 8, false);
          });
        });
      });
    });
  }

  /** Lamp Swap (P2): both flames gutter, then the lanterns trade places on the rail. */
  private lampSwap(): void {
    if (this.lamps.length < 2) return this.leanStrike();
    const tele = U.WINDUP.swap[this.ph];
    this.attack(tele + 700, U.COOLDOWN[this.ph], () => {
      this.telegraph(tele, INK);
      this.setPose('roar', tele + 300);
      for (const l of this.lamps) l.flicker(tele);
      this.later(tele, () => {
        const [a, b] = this.lamps;
        const ax = a.st.x;
        a.moveTo(b.st.x);
        b.moveTo(ax);
        sfx.windRush();
      });
    });
  }

  /** Eclipse Grab (P3 heavy, red): a long lunge, then gorged on the floor. */
  private eclipseGrab(): void {
    const tele = U.WINDUP.grab[this.ph];
    this.attack(tele + 600, U.COOLDOWN[this.ph], () => {
      this.telegraph(tele, 0xffffff, true);
      this.setPose('windup', tele);
      this.later(tele, () => {
        this.facePlayer();
        this.setPose('grab', 300);
        this.body.setVelocityX(this.facing * 320);
        this.meleeBox(2, -22, 30, 34, 260, 2, false, 260);
        this.later(260, () => {
          this.body.setVelocityX(0);
          this.gs.juice.shake(0.004, 160);
          this.recover(U.RECOVER_MS[this.ph], 'gorged', U.COOLDOWN[this.ph]);
        });
      });
    });
  }

  // ------------------------------------------------------------------ phases
  protected onPhase(n: number): void {
    this.dropWisps();
    this.airborne = false;
    if (n === 2) {
      this.gs.bossStage = 'p2';
      // overkill straight past P2: build it now, the P3 cinematic follows immediately
      if (this.hp / this.maxHp <= this.thresholds[1]) return this.buildP2();
      this.setPose('roar', 1000);
      this.transform(1000, () => {
        if (this.phase === 2) this.buildP2();
      });
    } else if (n === 3) {
      this.gs.bossStage = 'p3';
      this.startP3();
    }
  }

  /** P2: a second lantern drops in at the far end of the rail. */
  private buildP2(): void {
    if (this.lamps.length >= 2 || this.p3) return;
    const mid = (U.RAIL.min + U.RAIL.max) / 2;
    const first = this.lamps[0]?.st.x ?? U.RAIL.min;
    this.addLamp({ x: first < mid ? U.RAIL.max - 40 : U.RAIL.min + 40, drop: 1, lit: true }, true);
    sfx.lanternClang(1);
  }

  /** P3 cinematic: the lanterns gutter, one dies, the dark comes, the caster steps out of its shadow. */
  private startP3(): void {
    const gs = this.gs;
    this.cancelRecover();
    this.transforming = true;
    this.busy = true;
    this.body.setVelocityX(0);
    for (const p of [...gs.projectiles.getChildren()] as Projectile[]) {
      if (p.team !== 'enemy' || p.dead) continue;
      p.kill();
    }
    for (let i = 0; i < this.hearts.onPhase; i++) gs.spawnHeart(this.x, this.y - 8, 'pop');
    this.setPose('roar', 4200);
    phaseCinematic(gs, {
      shot: { x: this.x, y: this.y - 24, zoom: 1.2, ms: 900 },
      beats: [
        { at: 200, run: () => this.lamps.forEach((l) => l.flicker(1500)) },
        { at: 1500, run: () => { this.lamps.slice(1).forEach((l) => l.snuff()); this.dark?.fadeTo(0.6, 700); } },
        { at: 2200, run: () => { sfx.bossRoar(); gs.juice.shake(0.006, 400); } },
      ],
      commitAt: 2600,
      commit: () => this.buildP3(),
      length: 3800,
      done: () => {
        if (!this.alive) return;
        this.buildP3();
        playMusic('umbra3');
        this.transforming = false;
        this.busy = false;
        this.cooldown = 900;
      },
    });
  }

  /** P3 arena, idempotent: one lantern over the middle, deep darkness, the caster is solid. */
  private buildP3(): void {
    if (this.p3) return;
    this.p3 = true;
    // keep the lantern nearest the middle, lose the rest
    const mid = (U.RAIL.min + U.RAIL.max) / 2;
    if (!this.lamps.length) this.setLamps(U.lanternLayout(3, this.x), false);
    const keep = [...this.lamps].sort((a, b) => Math.abs(a.st.x - mid) - Math.abs(b.st.x - mid))[0];
    this.lamps.forEach((l, i) => {
      if (l === keep) return;
      l.destroy();
      this.shades[i]?.destroy();
    });
    const si = this.lamps.indexOf(keep);
    this.shades = [this.shades[si]];
    this.lamps = [keep];
    if (!keep.lit) keep.st = { ...keep.st, lit: true };
    this.dark?.setDepth(DARK_DEEP);
    this.dark?.fadeTo(0.85, 900);
    this.setAlpha(1);
    this.gs.juice.burst(this.x, this.y, 0x1c1430, 24, 1.3);
  }

  // ------------------------------------------------------------------ misc
  /** P1 opener: tell the player what to hit */
  private hint(): void {
    const l = this.lamps[0];
    if (!l) return;
    const t = txt(this.gs, l.st.x, U.DROP_Y[l.st.drop] + 18, 'STRIKE THE LIGHT', 8, '#b9a6ff').setDepth(60).setAlpha(0);
    this.temp.push(t);
    this.gs.tweens.add({ targets: t, alpha: 1, delay: 2600, duration: 400, hold: 4200, yoyo: true, onComplete: () => t.destroy() });
  }

  private dropWisps(): void {
    for (const w of this.wisps) if (!w.p.dead) w.p.kill();
    this.wisps = [];
  }

  die(reward = true): void {
    if (!this.alive) return;
    this.dropWisps();
    // the light swells white and burns the shadow off
    for (const l of this.lamps) l.flare(700);
    this.lamps = [];
    for (const s of this.shades) this.gs.tweens.add({ targets: s, alpha: 0, scaleY: 0.1, duration: 600, onComplete: () => s.destroy() });
    this.shades = [];
    this.dark?.fadeOut(1000);
    this.dark = undefined;
    this.eyeGlow.setAlpha(0);
    this.solidGlow.setAlpha(0);
    super.die(reward);
  }

  private cleanup(): void {
    this.dropWisps();
    for (const l of this.lamps) l.destroy();
    this.lamps = [];
    for (const s of this.shades) s.destroy();
    this.shades = [];
    this.dark?.destroy();
    this.dark = undefined;
    for (const o of this.temp) o.destroy();
    this.temp = [];
    this.rail.destroy();
    this.eyeGlow.destroy();
    this.solidGlow.destroy();
  }
}
