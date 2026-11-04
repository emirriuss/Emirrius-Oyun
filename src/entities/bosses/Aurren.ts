import Phaser from 'phaser';
import { Boss } from './Boss';
import { UNPARRYABLE_TINT } from '../Enemy';
import type { Projectile } from '../Projectile';
import { AurrenEcho } from './AurrenEcho';
import { SunKit } from './aurrenSun';
import { Hitbox } from '../../combat/Hitbox';
import type { HitInfo, Rect } from '../../combat/types';
import { PlayerReader, shouldCounter, pickWeighted, noteSwings, type Habit } from '../../combat/playerRead';
import { TILE } from '../../config';
import { bus } from '../../core/events';
import { sfx, tone, noise } from '../../systems/sfx';
import { playMusic, stopMusic } from '../../systems/music';
import { raysTexture } from '../../ui/Panel';
import type { GameScene } from '../../scenes/GameScene';

export type BMove = 'combo' | 'dash' | 'wave' | 'stance' | 'rise' | 'dive' | 'sunbreak';
type Form = 'blade' | 'sun' | 'last' | 'dead';
type V = [number, number];

export const BLADE_NAME = 'AURREN, THE FIRST BLADE';
export const SUN_NAME = 'AURREN, THE HOLLOW SUN';
export const GOLD = 0xffd96a;
export const PALE = 0xffeec2;
const STEEL = 0xc2c3d6;

/**
 * Wind-ups / punish windows (ms). Blade form arrays are [P1, P2, P3]; floors P1 >= 550, P2 >= 450,
 * P3 >= 380 for every opening wind-up (follow-up swings of a string use comboGap).
 */
export const T = {
  comboTele: [550, 470, 400],
  comboGap: [330, 300, 270],
  /** P3 held 4th swing / anti-dash delayed last swing (gold glint) */
  comboHold: 380,
  comboRecover: [800, 750, 650],
  /** extra punish time when an afterimage replays the string (P2+) */
  echoBonus: 500,
  dashTele: [600, 500, 420],
  dashSpeed: 420,
  dashRecover: [750, 650, 550],
  waveTele: [600, 500, 420],
  waveGap: 300,
  waveSpeed: [180, 195, 210],
  stanceMs: 1000,
  riposteTele: 340,
  guardBreak: 1500,
  loweredGuard: 800,
  riseTele: [600, 500, 420],
  riseRecover: [1000, 900, 800],
  diveTele: [550, 500, 450],
  diveLeap: 480,
  diveHang: 240,
  stuck: [1300, 1200, 1000],
  sunbreakTele: 650,
  sunbreakMarker: 750,
  sunbreakBeam: 380,
  sunbreakStagger: 260,
  plant: 1100,
  echoDelay: 650,
  cooldown: [900, 750, 600],
  transform: 1400,
};

/** rebirth cinematic beats (ms from the killing blow) */
const TR = {
  camIn: 700,
  wake: 1900,
  /** heartbeats, ms after `wake` (accelerating) */
  beats: [0, 650, 1150, 1550, 1850, 2080, 2260, 2400],
  pour: 2300,
  implode: 4500,
  blast: 4800,
  /** hold on the newborn sun (name card) before the camera returns */
  hold: 1100,
  back: 600,
};

const BLADE_HP = 110;
const SUN_HP = 100;
/** blade form: sprite centre is 24 px above the feet */
const FEET_DY = 24;

const TAUNT: Record<Habit, string> = {
  spam: 'TOO EAGER.',
  turtle: 'COME.',
  air: 'I SEE YOU.',
  dash: 'PREDICTABLE.',
  parry: 'I TAUGHT YOU THAT.',
  none: '',
};

interface Strike {
  kind: 'swing' | 'dash';
  t: number;
  x: number;
  y: number;
  dir: number;
  x1?: number;
  ms?: number;
}

/**
 * World 4-3 (post-game secret): AURREN, THE FIRST BLADE -> AURREN, THE HOLLOW SUN.
 *
 * Blade form (P1-P3): a ground duelist using the player's own moveset. A PlayerReader watches the
 * player's habits (spam / turtle / air / dash / parry); when one is read he may answer it with a
 * counter move, announced by a taunt.
 *  P1: Mirror Combo, Dash-Slash, Wave Edge, Counter Stance, Rising Slash (red).
 *  P2 "UNSHEATHED": + Pogo Dive (red), afterimages replay his strings a beat later (parryable).
 *  P3 "LAST DAWN": 5-hit strings with a held 4th swing, Sunbreak light columns (red).
 * At 0 HP he fakes death (bar hides, music stops, camera closes in), then the stolen
 * light floods into him and he is reborn as the Hollow Sun with a new bar (see SunKit, P4-P5).
 * When the sun falls: Last Clash, a 1 HP kneeling Aurren and one final, slow strike to parry.
 * Every committal move ends in recover(); nothing repeats 3x in a row.
 */
export class Aurren extends Boss {
  form: Form = 'blade';
  /** bumped by abort(): pending steps of an interrupted attack are dropped */
  gen = 0;
  t = 0;
  hist: string[] = [];
  readonly reader = new PlayerReader();
  private lastCounterAt = -1e9;
  private lastFsm: string | null = null;
  /** player's swingCount at the last read (-1 = not synced yet) */
  private lastSwing = -1;
  private nextSample = 0;
  private seenSlashes = new WeakSet<Projectile>();
  /** every visual this boss created, destroyed with him */
  private fx = new Set<Phaser.GameObjects.GameObject>();
  /** short-lived warning visuals of the current attack (removed by abort) */
  private temp = new Set<Phaser.GameObjects.GameObject>();
  private arena?: { floor: number; ceil: number; l: number; r: number };
  // blade-form motion
  motion?: { t: number; dur: number; at: (u: number) => V; done?: () => void };
  private run?: { vx: number; until: number; stopX?: number; done?: () => void };
  private onLand?: { after: number; fn: () => void };
  private dashing = false;
  private stance = false;
  private stanceAura?: Phaser.GameObjects.Image;
  private strikes: Strike[] = [];
  private strikeT0 = 0;
  private recording = false;
  private afterimage = false;
  private sheetStage = 1;
  // sun form
  sun?: SunKit;
  echo?: AurrenEcho;
  // finale
  private finishing = false;
  private lastNextStrike = 0;

  constructor(gs: GameScene, x: number, y: number) {
    const resume = gs.bossStage === 'sun';
    super(gs, x, y, resume ? 'aurren-sun' : 'aurren', resume ? SUN_NAME : BLADE_NAME, resume
      ? { hp: SUN_HP, bodyW: 40, bodyH: 44, gravity: false, contactDamage: 0, shards: 150 }
      : { hp: BLADE_HP, bodyW: 16, bodyH: 30, contactDamage: 0, shards: 150 });
    this.thresholds = [0.66, 0.33, -1, 0.5];
    this.deathTint = PALE;
    this.hearts = { periodicMs: 17000, maxOnField: 1, perParries: 3, onPhase: 1 };
    this.once(Phaser.GameObjects.Events.DESTROY, () => this.cleanup());
    if (resume) this.becomeSun(true);
  }

  // ------------------------------------------------------------------ helpers
  /** blade-form phase index 0..2 */
  get ph(): number {
    return Math.max(0, Math.min(3, this.phase) - 1);
  }

  track<O extends Phaser.GameObjects.GameObject>(o: O, temp = false): O {
    this.fx.add(o);
    if (temp) this.temp.add(o);
    o.once(Phaser.GameObjects.Events.DESTROY, () => {
      this.fx.delete(o);
      this.temp.delete(o);
    });
    return o;
  }

  /** later() bound to the current attack: dropped if abort() ran since */
  step(ms: number, fn: () => void): void {
    const g = this.gen;
    this.later(ms, () => {
      if (g === this.gen) fn();
    });
  }

  finish(cd?: number): void {
    this.busy = false;
    this.cooldown = cd ?? (this.form === 'sun' ? this.sun!.cooldown : T.cooldown[this.ph]);
  }

  /** public recover(): punish window (x1.25 damage, dizzy stars) */
  openWindow(ms: number, pose: string, cd?: number): void {
    this.recover(ms, pose, cd ?? (this.form === 'sun' ? this.sun!.cooldown : T.cooldown[this.ph]));
  }

  holdPose(name: string, ms: number): void {
    this.setPose(name, ms);
  }

  get poseNow(): string {
    return this.curPose;
  }

  get isVulnerable(): boolean {
    return this.vulnerable;
  }

  get isTransforming(): boolean {
    return this.transforming;
  }

  // bridge for SunKit (protected Boss members)
  get busyNow(): boolean {
    return this.busy;
  }
  set busyNow(v: boolean) {
    this.busy = v;
  }
  get cd(): number {
    return this.cooldown;
  }
  set cd(v: number) {
    this.cooldown = v;
  }
  waves(speed: number, dmg: number): void {
    this.shockwaves(speed, dmg);
  }
  phaseChange(ms: number, fn: () => void): void {
    this.transform(ms, fn);
  }
  get counterAt(): number {
    return this.lastCounterAt;
  }
  set counterAt(v: number) {
    this.lastCounterAt = v;
  }
  tauntFor(h: Habit): string {
    return TAUNT[h];
  }

  get A(): { floor: number; ceil: number; l: number; r: number } {
    if (this.arena) return this.arena;
    const gs = this.gs;
    const x = this.x;
    let floor = this.y;
    while (floor < gs.worldHeight && !gs.isBlockAt(x, floor)) floor += 4;
    floor = Math.floor(floor / TILE) * TILE;
    let ceil = Math.min(this.y, floor - 40);
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

  clampX(x: number, pad = 20): number {
    return Phaser.Math.Clamp(x, this.A.l + pad, this.A.r - pad);
  }

  private get groundY(): number {
    return this.A.floor - FEET_DY;
  }

  taunt(text: string, color = '#ffd96a'): void {
    if (text) this.gs.juice.floatText(this.x, this.y - 40, text, color);
  }

  // ------------------------------------------------------------------ visuals
  private get sheetKey(): string {
    if (this.form === 'sun') return (this.sun?.zenith ? 'aurren-sun-p5' : 'aurren-sun');
    if (this.form === 'last' || this.form === 'dead') return 'aurren-p3';
    return this.sheetStage <= 1 ? 'aurren' : `aurren-p${Math.min(3, this.sheetStage)}`;
  }

  protected animKey(): string {
    const s = this.sheetKey;
    const has = (k: string) => this.scene.anims.exists(k);
    if (this.form === 'sun') {
      if (this.stunned) return s + '-stun';
      const pose = this.curPose;
      return pose && has(`${s}-${pose}`) ? `${s}-${pose}` : s + '-hover';
    }
    if (this.stunned) return s + '-stun';
    const pose = this.curPose;
    if (pose && has(`${s}-${pose}`)) return `${s}-${pose}`;
    if (Math.abs(this.body.velocity.x) > 20) return s + '-run';
    return s + '-idle';
  }

  tick(time: number, dt: number): void {
    super.tick(time, dt);
    if (!this.alive) return;
    this.stanceAura?.setPosition(this.x, this.y - 2);
    this.sun?.update(this.gs.time.now, dt);
  }

  // ------------------------------------------------------------------ reading the player
  private readPlayer(): void {
    const p = this.player;
    const now = this.gs.time.now;
    const cur = p.fsm.current;
    // every swing counts, combo follow-ups included (the FSM stays in 'attack' between combo hits)
    this.lastSwing = noteSwings(this.reader, this.lastSwing, p.swingCount, now);
    if (cur !== this.lastFsm) {
      if (cur === 'dash') this.reader.note('dash', now);
      this.lastFsm = cur;
    }
    for (const pr of this.gs.projectiles.getChildren() as Projectile[]) {
      if (pr.team === 'player' && pr.texture.key === 'energySlash' && !this.seenSlashes.has(pr)) {
        this.seenSlashes.add(pr);
        this.reader.note('special', now);
      }
    }
    if (now >= this.nextSample) {
      this.nextSample = now + 100;
      this.reader.sample(now, !p.grounded, Math.abs(p.x - this.x));
    }
  }

  // ------------------------------------------------------------------ damage hooks
  protected damageTakenMul(): number {
    if (this.transforming || this.finishing) return 0;
    if (this.form === 'sun' && !this.vulnerable) return this.stunned ? 0.75 : 0.5;
    return super.damageTakenMul();
  }

  protected filterHit(hit: HitInfo): 'hit' | 'blocked' {
    if (!this.stance) return 'hit';
    // projectiles (energy slash, reflected wave) and pogo slams break the guard
    if (hit.kind === 'projectile' || hit.slam) {
      this.later(0, () => this.guardBreak());
      return 'hit';
    }
    this.riposte();
    return 'blocked';
  }

  receiveHit(hit: HitInfo): 'hit' | 'blocked' | 'ignored' {
    const wasStunned = this.stunned;
    const res = super.receiveHit(hit);
    if (res !== 'hit' || !this.alive || this.transforming || this.finishing) return res;
    if (this.form === 'sun') this.sun?.onHit(hit);
    // a reflected wave / sword knocks him off balance (stance handles its own break)
    if (hit.kind === 'projectile' && hit.parried && !wasStunned && !this.stance) {
      if (this.form === 'sun') this.sun?.crack();
      else if (this.form === 'blade') this.onParried();
    }
    return res;
  }

  onParried(): void {
    if (this.transforming || this.form === 'dead') return;
    if (this.form === 'last') {
      this.finisher();
      return;
    }
    this.reader.note('parry', this.gs.time.now);
    if (this.form === 'sun') {
      this.sun?.crack();
      return;
    }
    super.onParried();
    this.abort();
    // a parry inside a punish window (afterimage) keeps him in it; recover() releases him
    if (!this.vulnerable) {
      this.busy = false;
      this.cooldown = 700;
    }
  }

  protected onPhase(n: number): void {
    this.abort();
    this.reader.reset();
    if (n === 2 || n === 3) {
      const word = n === 2 ? 'UNSHEATHED' : 'LAST DAWN';
      this.setPose('plant', T.transform);
      this.taunt(word, n === 2 ? '#f7b23b' : '#ffeec2');
      tone(n === 2 ? 220 : 330, 0.9, 'sawtooth', 0.06, n === 2 ? 440 : 660);
      this.gs.juice.ring(this.x, this.y, GOLD, 2.2);
      this.transform(T.transform, () => {
        this.sheetStage = n;
        this.gs.juice.burst(this.x, this.y - 10, GOLD, 22, 1.3);
        this.gs.juice.burst(this.x, this.y - 10, PALE, 10, 1);
        this.gs.juice.ring(this.x, this.y - 10, PALE, 2);
        this.gs.juice.shake(0.01, 300);
        if (n === 3) this.gs.juice.punch(0.05, 220);
        this.cooldown = 700;
      });
    } else if (n === 5) this.sun?.zenithTransform();
  }

  /** Cancel the running attack (phase change / parry / death). */
  abort(): void {
    this.gen++;
    this.motion = undefined;
    this.run = undefined;
    this.onLand = undefined;
    this.dashing = false;
    this.recording = false;
    this.endStance();
    for (const o of [...this.temp]) o.destroy();
    this.temp.clear();
    this.sun?.abort();
    if (this.form === 'blade' || this.form === 'last') this.groundPhysics();
    this.body.setVelocity(0, 0);
  }

  private cleanup(): void {
    this.sun?.destroy();
    for (const o of [...this.fx]) o.destroy();
    this.fx.clear();
  }

  // ------------------------------------------------------------------ death, rebirth, finale
  die(reward = true): void {
    if (!this.alive) return;
    if (this.form === 'blade') return this.fakeDeath();
    if (this.form === 'sun') return this.lastClash();
    if (this.form === 'last') return this.finisher();
    super.die(reward);
  }

  /**
   * The first "kill" -> rebirth cinematic. Reads like a victory, then the stolen light pours into him
   * and he detonates into the Hollow Sun. Fully scripted: every pending attack, ghost, column and
   * hitbox is cancelled, the player is held and the camera frames him (see TR for the beats).
   */
  private fakeDeath(): void {
    if (this.transforming) return;
    const gs = this.gs;
    // ---- stop EVERYTHING he was doing (a punish window's timer would otherwise free the AI mid-scene)
    this.abort();
    this.cancelRecover();
    this.stunUntil = 0;
    this.afterimage = false;
    this.strikes = [];
    for (const o of [...this.fx]) o.destroy();
    this.fx.clear();
    this.temp.clear();
    for (const hb of gs.damage.hitboxes) if (hb.team === 'enemy') hb.kill();
    for (const e of gs.enemies.getChildren() as Boss[]) if ((e as unknown) !== this && e.alive) e.die(false);
    for (const p of [...gs.projectiles.getChildren()] as Projectile[]) if (p.team === 'enemy' && !p.dead) p.kill();
    this.transforming = true;
    this.busy = true;
    this.hp = 0;
    this.groundPhysics();
    this.body.setVelocity(0, 0);

    // ---- beat 1: the "victory"
    bus.emit('boss', this.bossName, 0, this.maxHp);
    bus.emit('boss-hide');
    stopMusic();
    gs.setCinematic(true);
    bus.emit('letterbox', true);
    gs.juice.impact('killBig', this.x, this.y);
    sfx.enemyDie();
    // the sword shatters
    gs.juice.burst(this.x + this.facing * 10, this.y, STEEL, 24, 1.4);
    gs.juice.burst(this.x, this.y, PALE, 12, 1);
    gs.juice.ring(this.x, this.y, STEEL, 2);
    this.setPose('kneel', TR.blast + 200);
    gs.time.delayedCall(450, () => sfx.victory());

    const cam = gs.cameras.main;
    let baseZoom = cam.zoom;
    const sunX = this.clampX(this.x, 40);
    const sunY = this.A.floor - 112;
    const focusY = (this.y + sunY) / 2;
    // camera drifts onto him once the kill punch has settled
    this.later(TR.camIn, () => {
      baseZoom = cam.zoom;
      cam.stopFollow();
      cam.pan(sunX, focusY, 1400, 'Sine.easeInOut', true);
      cam.zoomTo(baseZoom * 1.22, 1400, 'Sine.easeInOut', true);
    });

    // ---- beat 2: "NOT YET." + heartbeat, the world goes dark
    const dark = this.track(gs.add.rectangle(cam.width / 2, cam.height / 2, cam.width * 4, cam.height * 4, 0x07040f, 1).setScrollFactor(0).setDepth(14).setAlpha(0));
    this.later(TR.wake, () => {
      this.taunt('NOT YET.', '#ffd96a');
      tone(55, 1.8, 'sawtooth', 0.12, 110);
      noise(1.6, 0.12, 400);
      gs.tweens.add({ targets: dark, alpha: 0.72, duration: 1400, ease: 'Sine.out' });
    });
    TR.beats.forEach((at, i) => {
      this.later(TR.wake + at, () => {
        const k = i / (TR.beats.length - 1);
        tone(48 + k * 30, 0.22, 'sine', 0.22 + k * 0.08, 32);
        noise(0.12, 0.05 + k * 0.05, 180);
        gs.juice.shake(0.003 + k * 0.006, 160);
        gs.juice.rumble(0.2 + k * 0.4, 0.3 + k * 0.6, 120);
        gs.juice.ring(this.x, this.y, i % 2 ? GOLD : PALE, 0.8 + k * 1.6);
        this.setTintFill(PALE);
        this.later(70, () => this.restoreTint());
      });
    });

    // ---- beat 3: the stolen light pours in, he rises on a pillar of it
    const rise = TR.implode - TR.pour;
    const rays = this.track(gs.add.image(this.x, this.y, raysTexture(gs)).setTint(GOLD).setBlendMode(Phaser.BlendModes.ADD).setDepth(14.5).setScale(0.1).setAlpha(0));
    const pillar = this.track(gs.add.image(sunX, this.A.floor, 'moth-beam').setOrigin(0.5, 1).setTint(GOLD).setBlendMode(Phaser.BlendModes.ADD).setDepth(14.5).setAlpha(0));
    pillar.setDisplaySize(6, this.A.floor - this.A.ceil);
    this.later(TR.pour, () => {
      gs.tweens.add({ targets: rays, alpha: 0.8, scale: 1.6, angle: 140, duration: rise, ease: 'Sine.in' });
      gs.tweens.add({ targets: pillar, alpha: 0.9, displayWidth: 46, duration: rise, ease: 'Quad.in' });
      // rise to where the sun will hang
      this.groundPhysics(false);
      gs.tweens.add({ targets: this, x: sunX, y: sunY, duration: rise, ease: 'Sine.inOut' });
      tone(70, rise / 1000, 'sawtooth', 0.07, 280);
      noise(rise / 1000, 0.08, 900);
    });
    const streaks = 64;
    const span = rise - 520;
    for (let i = 0; i < streaks; i++) {
      this.later(TR.pour + (i / streaks) * span, () => {
        const v = cam.worldView;
        const side = Math.floor(Math.random() * 4);
        const sx = side === 0 ? v.x : side === 1 ? v.right : v.x + Math.random() * v.width;
        const sy = side === 2 ? v.y : side === 3 ? v.bottom : v.y + Math.random() * v.height;
        const m = this.track(gs.add.image(sx, sy, 'light').setTint(i % 3 ? GOLD : PALE).setScale(0.35).setBlendMode(Phaser.BlendModes.ADD).setDepth(45));
        gs.tweens.add({ targets: m, x: this.x, y: this.y - 20, scale: 0.1, duration: 520, ease: 'Quad.in', onComplete: () => m.destroy() });
        if (i % 6 === 0) gs.juice.shake(0.002 + (i / streaks) * 0.006, 220);
      });
    }
    // keep the rays glued to him while he rises
    const follow = () => {
      if (rays.active) rays.setPosition(this.x, this.y);
    };
    gs.events.on(Phaser.Scenes.Events.UPDATE, follow);
    this.once(Phaser.GameObjects.Events.DESTROY, () => gs.events.off(Phaser.Scenes.Events.UPDATE, follow));

    // ---- beat 4: everything is sucked in... a breath of silence
    this.later(TR.implode, () => {
      gs.tweens.killTweensOf(rays);
      gs.tweens.add({ targets: rays, scale: 0.05, alpha: 1, angle: rays.angle + 90, duration: TR.blast - TR.implode, ease: 'Back.in' });
      gs.tweens.add({ targets: pillar, displayWidth: 2, duration: TR.blast - TR.implode, ease: 'Quad.in' });
      this.setTintFill(0xffffff);
      tone(1760, (TR.blast - TR.implode) / 1000, 'sine', 0.06, 3520);
    });

    // ---- beat 5: DETONATION -> the Hollow Sun
    this.later(TR.blast, () => {
      gs.events.off(Phaser.Scenes.Events.UPDATE, follow);
      this.restoreTint();
      cam.flash(700, 255, 246, 220, true);
      gs.juice.hitstop(120);
      gs.juice.shake(0.022, 900);
      gs.juice.rumble(1, 1, 700);
      sfx.bossRoar();
      tone(40, 1.6, 'sawtooth', 0.16, 20);
      noise(1.4, 0.2, 1200);
      for (let i = 0; i < 4; i++) {
        this.later(i * 110, () => {
          gs.juice.ring(this.x, this.y, i % 2 ? PALE : GOLD, 3.8 - i * 0.6);
          gs.juice.burst(this.x, this.y, i % 2 ? PALE : GOLD, 22, 2 - i * 0.3);
        });
      }
      const glare = this.track(gs.add.image(this.x, this.y, 'light').setTint(PALE).setScale(1).setBlendMode(Phaser.BlendModes.ADD).setDepth(46));
      gs.tweens.add({ targets: glare, scale: 10, alpha: 0, duration: 900, ease: 'Quad.out', onComplete: () => glare.destroy() });
      // the blast hits the floor and races out to the walls
      const A = this.A;
      for (let k = 0; k < 10; k++) {
        this.later(k * 45, () => {
          for (const s of [-1, 1]) {
            const fx = sunX + s * (k + 1) * ((A.r - A.l) / 20);
            if (fx > A.l && fx < A.r) gs.juice.dust(fx, A.floor - 2, 3, 1, s, PALE);
          }
        });
      }
      rays.destroy();
      gs.tweens.add({ targets: pillar, alpha: 0, displayWidth: 120, duration: 500, ease: 'Quad.out', onComplete: () => pillar.destroy() });
      gs.tweens.add({ targets: dark, alpha: 0, duration: 1100, ease: 'Sine.in', onComplete: () => dark.destroy() });
      this.becomeSun(false);
      for (let i = 0; i < 2; i++) gs.spawnHeart(this.x + (i ? 20 : -20), this.y, 'pop');
    });

    // ---- hand control back
    this.later(TR.blast + TR.hold, () => {
      const p = gs.player;
      cam.pan(p.x - cam.followOffset.x, p.y - cam.followOffset.y, TR.back, 'Sine.easeInOut', true);
      cam.zoomTo(baseZoom, TR.back, 'Sine.easeInOut', true);
    });
    this.later(TR.blast + TR.hold + TR.back + 20, () => {
      cam.setZoom(baseZoom);
      cam.startFollow(gs.player, true, 0.12, 0.12, cam.followOffset.x, cam.followOffset.y);
      gs.setCinematic(false);
      bus.emit('letterbox', false);
      this.transforming = false;
      this.busy = false;
      this.cooldown = 1200;
    });
  }

  /** Switch body / texture / bar to the Hollow Sun. `instant` = resumed from GameOver. */
  private becomeSun(instant: boolean): void {
    const gs = this.gs;
    this.form = 'sun';
    this.phase = 4;
    this.bossName = SUN_NAME;
    this.groundPhysics(false);
    this.setPose('cast', instant ? 0 : 900);
    this.setTexture('aurren-sun');
    this.body.setSize(40, 44).setOffset((this.width - 40) / 2, (this.height - 44) / 2);
    this.body.setAllowGravity(false);
    this.body.checkCollision.none = true;
    const A = this.A;
    this.body.reset(instant ? this.clampX((A.l + A.r) / 2 + 60) : this.clampX(this.x, 40), A.floor - 112);
    this.maxHp = this.hp = Math.max(1, Math.round(SUN_HP * gs.enemyHpMul));
    this.deathTint = GOLD;
    this.hearts = { periodicMs: 15000, maxOnField: 1, perParries: 3, onPhase: 1 };
    this.reader.reset();
    this.hist = [];
    this.sun = new SunKit(this);
    gs.bossStage = 'sun';
    if (!instant) {
      bus.emit('boss', this.bossName, this.hp, this.maxHp);
      bus.emit('boss-intro', this.bossName);
      playMusic('sun');
    }
  }

  /** Sun HP gone: collapses back into a kneeling Aurren at 1 HP for one final exchange. */
  private lastClash(): void {
    if (this.transforming) return;
    const gs = this.gs;
    this.abort();
    this.echo?.vanish();
    this.transforming = true;
    this.busy = true;
    this.hp = 1;
    // just a man again: the bar drops the title
    this.bossName = 'AURREN';
    bus.emit('boss', this.bossName, 1, this.maxHp);
    gs.juice.slowmo(0.4, 1300);
    gs.juice.impact('heavy', this.x, this.y);
    stopMusic();
    tone(880, 1.4, 'triangle', 0.08, 110);
    this.sun?.fadeOut();
    this.setTintFill(PALE);
    gs.tweens.add({ targets: this, scale: 0.35, duration: 900, ease: 'Quad.in' });
    for (let i = 0; i < 4; i++) this.later(i * 200, () => gs.juice.ring(this.x, this.y, i % 2 ? GOLD : PALE, 2.6 - i * 0.4));
    this.later(950, () => {
      this.form = 'last';
      this.sun?.destroy();
      this.sun = undefined;
      this.setScale(1);
      this.restoreTint();
      this.setTexture('aurren-p3');
      this.body.setSize(16, 30).setOffset((this.width - 16) / 2, this.height - 30);
      this.groundPhysics();
      this.body.reset(this.clampX(this.x, 40), this.groundY);
      gs.juice.burst(this.x, this.y, PALE, 24, 1.2);
      gs.juice.shake(0.01, 300);
      this.setPose('kneel', 2200);
      this.later(2200, () => {
        this.taunt('ONE MORE.', '#ffeec2');
        this.transforming = false;
        this.busy = false;
        this.lastNextStrike = 0;
      });
    });
  }

  /** Last Clash: walk in slowly, one long golden overhead strike, repeated until answered. */
  private thinkLast(): void {
    if (this.busy) {
      this.body.setVelocityX(0);
      return;
    }
    const now = this.gs.time.now;
    this.facePlayer();
    if (Math.abs(this.dxToPlayer()) > 52 || now < this.lastNextStrike) {
      this.body.setVelocityX(Math.abs(this.dxToPlayer()) > 52 ? this.facing * 38 : 0);
      return;
    }
    this.busy = true;
    this.body.setVelocityX(0);
    this.setPose('overhead', 1000);
    this.telegraph(1000, GOLD);
    tone(440, 1, 'triangle', 0.07, 880);
    this.step(1000, () => {
      this.setPose('slash', 300);
      sfx.swing(0.8);
      this.meleeBox(2, -14, 34, 26, 160, 1, true, 220);
    });
    this.step(1400, () => {
      this.busy = false;
      this.lastNextStrike = this.gs.time.now + 1100;
    });
  }

  /** The killing blow (parry of the final strike, or any hit at 1 HP). */
  private finisher(): void {
    if (this.finishing) return;
    this.finishing = true;
    this.abort();
    this.busy = true;
    const gs = this.gs;
    gs.juice.impact('killBig', this.x, this.y, this.player.x < this.x ? 0 : Math.PI);
    gs.juice.parryFlash(this.x, this.y);
    gs.juice.ring(this.x, this.y, GOLD, 3);
    this.setPose('kneel', 4000);
    this.later(500, () => this.taunt('...THANK YOU.', '#ffeec2'));
    this.later(1700, () => {
      this.form = 'dead';
      this.finishing = false;
      this.die(true);
    });
  }

  // ------------------------------------------------------------------ AI
  protected think(dt: number): void {
    this.t += dt;
    if (this.player.alive) this.readPlayer();
    if (this.motion) {
      this.stepMotion(dt);
      return;
    }
    if (this.run) {
      this.stepRun();
      return;
    }
    if (this.onLand && this.body.blocked.down && this.gs.time.now >= this.onLand.after) {
      const f = this.onLand.fn;
      this.onLand = undefined;
      f();
      return;
    }
    if (this.form === 'last') return this.thinkLast();
    if (this.form === 'sun') return this.sun!.think(dt);
    if (this.busy) {
      if (this.body.blocked.down) this.body.setVelocityX(0);
      return;
    }
    this.cooldown -= dt;
    this.facePlayer();
    this.stalk();
    if (this.cooldown > 0 || !this.player.alive) return;
    this.pick();
  }

  /** Keeps a duelist's distance: closes in from afar, steps back when crowded. */
  private stalk(): void {
    const dx = Math.abs(this.dxToPlayer());
    const wallBehind = this.facing > 0 ? this.x - 30 < this.A.l : this.x + 30 > this.A.r;
    if (dx > 120) this.body.setVelocityX(this.facing * 75);
    else if (dx < 40 && !wallBehind) this.body.setVelocityX(-this.facing * 55);
    else this.body.setVelocityX(0);
  }

  private pick(): void {
    const p = this.player;
    const now = this.gs.time.now;
    const dx = Math.abs(this.dxToPlayer());
    const elevated = p.y < this.y - 40;
    const above = p.y < this.y - 30 && dx < 70;
    const ph = this.phase;

    // reactive counter (a chance, with cooldown; announced by a taunt)
    const habit = this.reader.habit(now);
    if (shouldCounter(habit, this.lastCounterAt, now, Math.random())) {
      const m = this.counterFor(habit, above);
      if (m) {
        this.lastCounterAt = now;
        this.taunt(TAUNT[habit]);
        return this.begin(m, habit === 'dash');
      }
    }

    let table: [BMove, number][];
    if (above) table = [['rise', 0.5], ['wave', 0.25], ['dive', ph >= 2 ? 0.25 : 0]];
    else if (elevated) table = [['wave', 0.45], ['dive', ph >= 2 ? 0.35 : 0], ['dash', 0.2]];
    else if (dx < 60) table = [['combo', 0.55], ['stance', 0.12], ['dash', 0.1], ['sunbreak', ph >= 3 ? 0.18 : 0], ['dive', ph >= 2 ? 0.05 : 0]];
    else if (dx < 140) table = [['dash', 0.35], ['combo', 0.25], ['wave', 0.2], ['dive', ph >= 2 ? 0.15 : 0], ['sunbreak', ph >= 3 ? 0.15 : 0]];
    else table = [['wave', 0.45], ['dash', 0.35], ['dive', ph >= 2 ? 0.25 : 0], ['sunbreak', ph >= 3 ? 0.1 : 0]];
    const m = pickWeighted(table, this.hist as BMove[], Math.random()) ?? 'wave';
    this.begin(m, false);
  }

  private counterFor(h: Habit, above: boolean): BMove | null {
    const ph = this.phase;
    switch (h) {
      case 'spam':
        return 'stance';
      case 'turtle':
        return Math.random() < 0.5 ? 'wave' : 'dash';
      case 'air':
        return above ? 'rise' : ph >= 2 ? 'dive' : 'wave';
      case 'dash':
        return 'combo';
      case 'parry':
        return ph >= 3 && Math.random() < 0.5 ? 'sunbreak' : ph >= 2 ? 'dive' : 'stance';
      default:
        return null;
    }
  }

  private begin(m: BMove, delayedLast: boolean): void {
    this.hist.unshift(m);
    this.hist.length = Math.min(this.hist.length, 3);
    this.busy = true;
    this.body.setVelocityX(0);
    switch (m) {
      case 'combo': return this.combo(delayedLast);
      case 'dash': return this.dashSlash();
      case 'wave': return this.waveEdge();
      case 'stance': return this.counterStance();
      case 'rise': return this.risingSlash();
      case 'dive': return this.pogoDive();
      case 'sunbreak': return this.sunbreak();
    }
  }

  // ------------------------------------------------------------------ motion
  private stepMotion(dt: number): void {
    const m = this.motion!;
    m.t = Math.min(m.dur, m.t + dt);
    const [x, y] = m.at(m.t / m.dur);
    this.body.reset(x, y);
    if (m.t >= m.dur) {
      this.motion = undefined;
      m.done?.();
    }
  }

  glide(tx: number, ty: number, ms: number, done?: () => void): void {
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

  private stepRun(): void {
    const r = this.run!;
    const now = this.gs.time.now;
    this.facing = r.vx > 0 ? 1 : -1;
    this.body.setVelocityX(r.vx);
    const passed = r.stopX !== undefined && (r.vx > 0 ? this.x >= r.stopX : this.x <= r.stopX);
    const wall = r.vx > 0 ? this.body.blocked.right || this.x > this.A.r - 14 : this.body.blocked.left || this.x < this.A.l + 14;
    if (now >= r.until || passed || wall) {
      this.run = undefined;
      this.body.setVelocityX(0);
      r.done?.();
    }
  }

  /** gravity + tile collision (blade / last form); off for leaps and the sun */
  private groundPhysics(on = true): void {
    this.body.setAllowGravity(on);
    this.body.checkCollision.none = !on;
  }

  // ------------------------------------------------------------------ afterimage (P2+)
  private startRecord(): void {
    this.strikes = [];
    this.strikeT0 = this.gs.time.now;
    this.recording = this.phase >= 2;
  }

  private record(s: Omit<Strike, 't'>): void {
    if (!this.recording) return;
    this.strikes.push({ ...s, t: this.gs.time.now - this.strikeT0 });
  }

  /** Replays the recorded strikes T.echoDelay later as a pale ghost (parryable, parry = stun him). */
  private replay(): boolean {
    this.recording = false;
    if (this.form !== 'blade' || this.phase < 2 || this.afterimage || !this.strikes.length) return false;
    const list = this.strikes.slice(-3);
    const base = list[0].t;
    const gs = this.gs;
    this.afterimage = true;
    const first = list[0];
    const sheet = this.sheetKey;
    const play = (o: Phaser.GameObjects.Sprite, name: string) => {
      if (this.scene.anims.exists(`${sheet}-${name}`)) o.play(`${sheet}-${name}`);
    };
    const ghost = this.track(gs.add.sprite(first.x, first.y, this.texture.key, this.frame.name).setFlipX(first.dir < 0).setTintFill(PALE).setAlpha(0).setDepth(14));
    gs.tweens.add({ targets: ghost, alpha: 0.5, duration: 200, delay: Math.max(0, T.echoDelay - 300) });
    let broken = false;
    const shatter = () => {
      if (broken) return;
      broken = true;
      gs.juice.burst(ghost.x, ghost.y, PALE, 14, 1);
      ghost.destroy();
      if (this.alive && !this.transforming && this.form === 'blade') this.onParried();
    };
    for (const s of list) {
      const at = T.echoDelay + s.t - base;
      // white flash before each ghost strike
      this.later(at - 220, () => {
        if (broken || !ghost.active) return;
        ghost.setPosition(s.x, s.y).setFlipX(s.dir < 0);
        play(ghost, s.kind === 'dash' ? 'crouch' : 'windup');
        gs.tweens.add({ targets: ghost, alpha: 0.85, yoyo: true, duration: 110 });
        sfx.telegraph();
      });
      this.later(at, () => {
        if (broken || !ghost.active || !this.alive) return;
        play(ghost, s.kind === 'dash' ? 'dash' : 'slash');
        sfx.swing(1.3);
        if (s.kind === 'swing') {
          const r: Rect = { x: s.x + (s.dir > 0 ? 2 : -36), y: s.y - 14, w: 34, h: 26 };
          gs.damage.add(new Hitbox('enemy', () => r, () => ({ damage: 1, kbX: s.dir * 200, kbY: -160, sourceX: s.x, parryable: true, kind: 'melee' }), 130, (_t, res) => {
            if (res === 'blocked') shatter();
          }).ownedBy(this));
        } else {
          const ms = s.ms ?? 300;
          gs.tweens.add({ targets: ghost, x: s.x1 ?? s.x, duration: ms });
          gs.damage.add(new Hitbox('enemy', () => ({ x: ghost.x + (s.dir > 0 ? -8 : -22), y: s.y - 10, w: 30, h: 30 }), () => ({ damage: 1, kbX: s.dir * 230, kbY: -170, sourceX: ghost.x, parryable: true, kind: 'melee' }), ms, (_t, res) => {
            if (res === 'blocked') shatter();
          }).ownedBy(this));
        }
      });
    }
    const end = T.echoDelay + list[list.length - 1].t - base + 400;
    this.later(end, () => {
      this.afterimage = false;
      if (!broken && ghost.active) gs.tweens.add({ targets: ghost, alpha: 0, duration: 250, onComplete: () => ghost.destroy() });
    });
    return true;
  }

  // ------------------------------------------------------------------ blade moves
  /** Mirror Combo: 3 swings (P3: 5, the 4th held). `delayedLast`: the last swing waits (beats dash spam). */
  private combo(delayedLast: boolean): void {
    const start = () => {
      const n = this.phase >= 3 ? 5 : 3;
      const tele = T.comboTele[this.ph];
      const gap = T.comboGap[this.ph];
      this.startRecord();
      this.facePlayer();
      this.setPose('windup', tele);
      this.telegraph(tele, 0xffffff);
      let at = tele;
      for (let i = 0; i < n; i++) {
        const last = i === n - 1;
        this.step(at, () => this.swing(i));
        if (!last) {
          // the next swing is held back (P3 4th swing / anti-dash last swing)
          const next = (this.phase >= 3 && i + 1 === 3) || (delayedLast && i + 1 === n - 1);
          const w = gap + (next ? T.comboHold : 0);
          this.step(at + 140, () => {
            this.facePlayer();
            this.setPose('windup', w - 140);
            this.telegraph(w - 140, next ? GOLD : 0xffffff);
            if (next) {
              // the gold glint is the tell: wait for it
              this.gs.juice.spark(this.x + this.facing * 8, this.y - 22, -Math.PI / 2, GOLD, 1.2);
              tone(1500, 0.12, 'triangle', 0.08, 1800);
            }
          });
          at += w;
        }
      }
      this.step(at + 160, () => {
        const echo = this.replay();
        this.openWindow(T.comboRecover[this.ph] + (echo ? T.echoBonus : 0), 'stuck');
      });
    };
    const dx = Math.abs(this.dxToPlayer());
    if (dx > 46) {
      // close the gap first (runs, doesn't attack while running)
      this.facePlayer();
      const stopX = this.player.x - this.facing * 34;
      this.run = { vx: this.facing * 190, until: this.gs.time.now + 700, stopX, done: start };
    } else start();
  }

  private swing(i: number): void {
    this.setPose(i % 2 ? 'slash2' : 'slash', 200);
    sfx.swing(1 - i * 0.04);
    this.body.setVelocityX(this.facing * 140);
    this.later(110, () => {
      if (this.body.blocked.down) this.body.setVelocityX(0);
    });
    this.meleeBox(2, -14, 34, 26, 130, 1, true, 200);
    this.record({ kind: 'swing', x: this.x, y: this.y, dir: this.facing });
  }

  /** Dash-Slash: crouch, cut through to the far side of the player, skid. Parryable. */
  private dashSlash(): void {
    const tele = T.dashTele[this.ph];
    this.facePlayer();
    this.setPose('crouch', tele);
    this.telegraph(tele, 0xffffff);
    this.step(tele, () => {
      this.startRecord();
      const dir = this.facing;
      const x0 = this.x;
      const px = this.player.x;
      const stopX = this.clampX(dir > 0 ? Math.max(px + 70, x0 + 60) : Math.min(px - 70, x0 - 60), 18);
      this.setPose('dash', 420);
      this.dashing = true;
      sfx.dash();
      const hb = new Hitbox(
        'enemy',
        () => (this.dashing && !this.stunned ? { x: this.x + (dir > 0 ? -8 : -22), y: this.y - 10, w: 30, h: 30 } : { x: -9999, y: -9999, w: 1, h: 1 }),
        () => ({ damage: 1, kbX: dir * 240, kbY: -170, sourceX: this.x, parryable: true, kind: 'melee' }),
        500,
        (_t, res) => {
          if (res === 'blocked' && this.alive) this.onParried();
        },
      ).ownedBy(this);
      this.gs.damage.add(hb);
      const trail = this.gs.time.addEvent({
        delay: 28,
        repeat: 14,
        callback: () => {
          if (!this.active || !this.dashing) return;
          const g = this.track(this.gs.add.image(this.x, this.y, this.texture.key, this.frame.name).setFlipX(this.flipX).setTintFill(this.phase >= 2 ? GOLD : STEEL).setAlpha(0.45).setDepth(14));
          this.gs.tweens.add({ targets: g, alpha: 0, duration: 220, onComplete: () => g.destroy() });
        },
      });
      const t0 = this.gs.time.now;
      this.run = {
        vx: dir * T.dashSpeed,
        until: t0 + 460,
        stopX,
        done: () => {
          trail.remove();
          this.dashing = false;
          hb.kill();
          this.gs.juice.dust(this.x, this.A.floor, 6, 0.7, -dir);
          this.record({ kind: 'dash', x: x0, y: this.y, dir, x1: this.x, ms: this.gs.time.now - t0 });
          const echo = this.replay();
          this.openWindow(T.dashRecover[this.ph] + (echo ? T.echoBonus : 0), 'stuck');
        },
      };
    });
  }

  /** Wave Edge: 1/2/3 crescents (aimed when the player is up high or for the P3 third). Reflect = stun. */
  private waveEdge(): void {
    const tele = T.waveTele[this.ph];
    const n = this.phase;
    this.facePlayer();
    this.setPose('windup', tele);
    this.telegraph(tele, 0xffffff);
    for (let i = 0; i < n; i++) {
      this.step(tele + i * T.waveGap, () => {
        this.facePlayer();
        this.setPose(i % 2 ? 'slash2' : 'slash', T.waveGap);
        const s = T.waveSpeed[this.ph];
        const sy = this.y - 6;
        const aim = this.player.y < this.y - 40 || i === 2;
        let vx = this.facing * s, vy = 0;
        if (aim) {
          const a = Math.atan2(this.player.y - sy, this.player.x - this.x);
          vx = Math.cos(a) * s;
          vy = Math.sin(a) * s;
        }
        this.gs.spawnProjectile(this.x + this.facing * 14, sy, 'aurren-wave', vx, vy, 'enemy', { damage: 1, lifeMs: 3500, owner: this, rotate: aim });
        sfx.swing(0.7);
        tone(700 + i * 120, 0.1, 'triangle', 0.07, 1100);
      });
    }
    this.step(tele + n * T.waveGap + 250, () => this.finish());
  }

  /** Counter Stance: hitting him = blocked + riposte; slash/slam = guard break; waiting = lowered guard. */
  private counterStance(): void {
    this.facePlayer();
    this.stance = true;
    this.setPose('stance', T.stanceMs);
    this.telegraph(300, GOLD);
    tone(1760, 0.5, 'triangle', 0.06, 1760);
    this.stanceAura = this.track(this.gs.add.image(this.x, this.y - 2, 'light').setTint(GOLD).setScale(0.9).setAlpha(0.5).setBlendMode(Phaser.BlendModes.ADD).setDepth(14), true);
    this.gs.tweens.add({ targets: this.stanceAura, scale: 1.1, alpha: 0.75, yoyo: true, repeat: -1, duration: 160 });
    this.step(T.stanceMs, () => {
      if (!this.stance) return;
      this.endStance();
      this.taunt('...', '#c2c3d6');
      this.openWindow(T.loweredGuard, 'stun');
    });
  }

  private endStance(): void {
    this.stance = false;
    this.stanceAura?.destroy();
    this.stanceAura = undefined;
  }

  private riposte(): void {
    this.endStance();
    this.gen++;
    this.busy = true;
    this.facePlayer();
    this.gs.juice.spark(this.x + this.facing * 10, this.y - 10, this.facing > 0 ? 0 : Math.PI, GOLD, 1.4);
    this.setPose('windup', T.riposteTele);
    this.telegraph(T.riposteTele, 0xffffff);
    this.step(T.riposteTele, () => {
      this.facePlayer();
      this.setPose('slash', 220);
      sfx.swing(0.9);
      this.body.setVelocityX(this.facing * 160);
      this.meleeBox(2, -14, 36, 26, 140, 1, true, 230);
    });
    this.step(T.riposteTele + 260, () => this.openWindow(550, 'stuck'));
  }

  private guardBreak(): void {
    if (!this.alive || this.transforming) return;
    this.endStance();
    this.gen++;
    this.taunt('GUARD BREAK', '#7fdbff');
    this.gs.juice.ring(this.x, this.y, 0x7fdbff, 1.6);
    this.gs.juice.burst(this.x, this.y - 6, GOLD, 12, 1);
    sfx.parry();
    this.openWindow(T.guardBreak, 'stun');
  }

  /** Rising Slash (red): anti-air pillar cut, lands open. */
  private risingSlash(): void {
    const tele = T.riseTele[this.ph];
    this.facePlayer();
    this.setPose('crouch', tele);
    this.telegraph(tele, UNPARRYABLE_TINT, true);
    this.step(tele, () => {
      this.facePlayer();
      this.setPose('rise', 650);
      noise(0.25, 0.16, 2400);
      this.body.setVelocity(this.facing * 50, -470);
      this.gs.damage.add(
        new Hitbox(
          'enemy',
          () => ({ x: this.x - 13, y: this.y - 48, w: 26, h: 62 }),
          () => ({ damage: 2, kbX: this.dirToPlayer() * 160, kbY: -260, sourceX: this.x, parryable: false, kind: 'melee' }),
          380,
        ).ownedBy(this),
      );
      this.onLand = {
        after: this.gs.time.now + 200,
        fn: () => {
          this.gs.juice.dust(this.x, this.A.floor, 6, 0.6);
          this.openWindow(T.riseRecover[this.ph], 'stuck');
        },
      };
    });
  }

  /** Pogo Dive (P2+, red): leaps over the player, locks a floor marker, plunges, sword stuck. */
  private pogoDive(): void {
    const tele = T.diveTele[this.ph];
    const A = this.A;
    this.facePlayer();
    this.setPose('crouch', tele);
    this.telegraph(tele, UNPARRYABLE_TINT, true);
    const marker = this.track(this.gs.add.rectangle(this.player.x, A.floor - 2, 32, 5, UNPARRYABLE_TINT).setStrokeStyle(1, 0xffffff, 0.8).setDepth(41).setAlpha(0), true);
    const glow = this.track(this.gs.add.image(marker.x, A.floor - 6, 'light').setTint(UNPARRYABLE_TINT).setScale(0.6, 0.3).setBlendMode(Phaser.BlendModes.ADD).setDepth(41).setAlpha(0), true);
    let locked = false;
    const follow = this.gs.time.addEvent({
      delay: 16,
      loop: true,
      callback: () => {
        if (!marker.active) {
          glow.destroy();
          return follow.remove();
        }
        if (!locked) marker.x = this.clampX(this.player.x, 16);
        glow.x = marker.x;
      },
    });
    this.step(tele, () => {
      marker.setAlpha(0.9);
      glow.setAlpha(0.8);
      this.gs.tweens.add({ targets: marker, alpha: 0.35, yoyo: true, repeat: -1, duration: 90 });
      this.groundPhysics(false);
      this.setPose('rise', T.diveLeap);
      noise(0.2, 0.12, 1800);
      const sx = this.x, sy = this.y;
      const ty = A.floor - 120;
      this.motion = {
        t: 0,
        dur: T.diveLeap,
        at: (u) => {
          const tx = marker.x;
          return [sx + (tx - sx) * u, sy + (ty - sy) * (1 - (1 - u) ** 2)];
        },
        done: () => {
          locked = true;
          this.gs.tweens.killTweensOf(marker);
          marker.setAlpha(1).setFillStyle(UNPARRYABLE_TINT);
          this.setPose('dive', T.diveHang + 300);
          tone(240, 0.2, 'sawtooth', 0.06, 120);
          this.step(T.diveHang, () => {
            const lx = marker.x;
            this.glide(lx, this.groundY, 170, () => this.diveLand(marker));
            this.gs.damage.add(
              new Hitbox(
                'enemy',
                () => ({ x: this.x - 12, y: this.y - 12, w: 24, h: 40 }),
                () => ({ damage: 2, kbX: this.dirToPlayer() * 220, kbY: -220, sourceX: this.x, parryable: false, kind: 'melee' }),
                200,
              ).ownedBy(this),
            );
          });
        },
      };
    });
  }

  private diveLand(marker: Phaser.GameObjects.Rectangle): void {
    marker.destroy();
    this.groundPhysics();
    this.body.reset(this.x, this.groundY);
    this.gs.juice.impact('land', this.x, this.A.floor, Math.PI / 2, 1.5);
    this.gs.juice.dust(this.x, this.A.floor, 10, 1);
    this.gs.juice.burst(this.x, this.A.floor - 4, GOLD, 10, 0.9);
    tone(80, 0.25, 'sine', 0.3, 40);
    this.shockwaves(170, 1);
    this.openWindow(T.stuck[this.ph], 'stuck');
  }

  /** Sunbreak (P3, red columns): sword planted, light erupts in rings away from him. Hugging him is safe. */
  private sunbreak(): void {
    const A = this.A;
    this.setPose('plant', T.sunbreakTele + T.sunbreakMarker + 2 * T.sunbreakStagger + T.sunbreakBeam + 100);
    this.telegraph(T.sunbreakTele, GOLD);
    tone(330, 0.7, 'triangle', 0.07, 990);
    this.gs.juice.ring(this.x, this.y, GOLD, 1.4);
    this.step(T.sunbreakTele, () => {
      this.gs.juice.shake(0.005, 200);
      for (let k = 1; k <= 3; k++) {
        for (const s of [-1, 1]) {
          const x = this.x + s * k * 58;
          if (x < A.l + 10 || x > A.r - 10) continue;
          this.column(x, 30, T.sunbreakMarker + (k - 1) * T.sunbreakStagger, T.sunbreakBeam);
        }
      }
    });
    const end = T.sunbreakTele + T.sunbreakMarker + 2 * T.sunbreakStagger + T.sunbreakBeam + 60;
    this.step(end, () => this.openWindow(T.plant, 'plant'));
  }

  /** One red-marked light column (marker for markerMs, then an unparryable beam). Self-timed. */
  column(x: number, w: number, markerMs: number, beamMs: number): void {
    const gs = this.gs;
    const A = this.A;
    const top = A.ceil, h = A.floor - A.ceil;
    const strip = this.track(gs.add.tileSprite(x, A.floor - 2, w, 5, 'moth-marker').setTint(UNPARRYABLE_TINT).setDepth(16).setAlpha(0));
    const ghost = this.track(gs.add.rectangle(x, top + h / 2, w, h, UNPARRYABLE_TINT, 0.06).setStrokeStyle(1, UNPARRYABLE_TINT, 0.4).setDepth(16).setAlpha(0));
    gs.tweens.add({ targets: [strip, ghost], alpha: 1, duration: 120 });
    gs.tweens.add({ targets: strip, alpha: 0.4, yoyo: true, repeat: -1, duration: 100, delay: 120 });
    gs.time.delayedCall(markerMs, () => {
      if (!this.alive || !strip.active) return;
      gs.tweens.killTweensOf(strip);
      ghost.destroy();
      strip.setAlpha(1).clearTint();
      const beam = this.track(gs.add.image(x, top, 'moth-beam').setOrigin(0.5, 0).setDisplaySize(w, h).setDepth(16).setBlendMode(Phaser.BlendModes.ADD));
      const core = this.track(gs.add.rectangle(x, top + h / 2, Math.max(4, w * 0.22), h, 0xffffff, 0.85).setDepth(16));
      beam.scaleX *= 0.2;
      gs.tweens.add({ targets: beam, scaleX: beam.scaleX * 5, duration: 70 });
      gs.juice.burst(x, A.floor - 2, GOLD, 6, 0.7);
      noise(0.2, 0.08, 3000, 0, 1, 'highpass');
      gs.damage.add(
        new Hitbox(
          'enemy',
          () => ({ x: x - w / 2 + 3, y: top, w: w - 6, h }),
          () => ({ damage: 1, kbX: (this.player.x >= x ? 1 : -1) * 200, kbY: -200, sourceX: x, parryable: false, kind: 'melee' }),
          beamMs,
        ).ownedBy(this),
      );
      gs.time.delayedCall(beamMs, () => {
        if (!beam.active) return;
        gs.tweens.add({ targets: [strip, beam, core], alpha: 0, duration: 140, onComplete: () => [strip, beam, core].forEach((o) => o.destroy()) });
      });
    });
  }
}
