import Phaser from 'phaser';
import { Boss } from './Boss';
import { Hitbox } from '../../combat/Hitbox';
import { UNPARRYABLE_TINT } from '../Enemy';
import type { Projectile } from '../Projectile';
import { sfx } from '../../systems/sfx';
import { playMusic, stopMusic } from '../../systems/music';
import { bus } from '../../core/events';
import { TILE, GAME_W } from '../../config';
import { save } from '../../systems/SaveSystem';
import { LEVELS } from '../../levels';
import { txt } from '../../ui/text';
import { overlaps, type HitInfo, type Rect } from '../../combat/types';
import type { GameScene } from '../../scenes/GameScene';
import {
  erratumWeights, pickMove, strikeSpans, glyphVolley, marginNote, heartsToSteal, letterboxGap, pushSample, sampleAt,
  act4Press, yesDrift, WINDUP_FLOOR, CREDITS,
  type ErratumMove as Move, type Glyph, type Sample, type Act4State,
} from '../../combat/erratumPlan';
import {
  PageEditor, FakeDialog, StrikeTarget, solidZone, textSlab, slabTo, destroySlab, scrawl,
  INK, INK_DARK, RED_INK, type Solid, type TextSlab,
} from './erratumProps';
import { banner } from './croupierProps';

/** Resize a rectangle only while it still exists (tweens can outlive an interrupted move). */
function sz(r: Phaser.GameObjects.Rectangle, w: number, h: number): void {
  if (r.active) r.setSize(w, h);
}

/** Arena (w4-6 is exactly one screen): floor row, inner columns. */
const FLOOR_ROW = 14;
const COL_L = 1;
const COL_R = 28;
const FLOOR_Y = FLOOR_ROW * TILE;

/** Timings (ms) per draft index 0..2. Holds are clamped up to WINDUP_FLOOR. */
const T = {
  after: [700, 560, 440],
  strikeTell: [950, 850, 750],
  strikeHold: [3200, 3000, 2800],
  inkSpeed: [150, 170, 190],
  insertHold: 4600,
  diveTell: [650, 560, 480],
  diveRecover: [1150, 1000, 900],
  glyphGap: [240, 200, 170],
  glyphFall: [190, 215, 240],
  typoTell: [950, 820, 700],
  dashSpeed: [290, 330, 370],
  dashRecover: [950, 850, 750],
  barSwing: 700,
  barStuck: 3400,
  heartsMs: 15000,
  rotateHold: 5200,
  letterTell: [1050, 950, 850],
  letterSlam: 240,
  crashMs: 6500,
  crashRecover: 2600,
  slabFall: 260,
  slabStay: 3800,
  hopTell: 520,
  hopMs: 380,
  mapRecover: 1300,
  creditGap: 1150,
  creditSpeed: 30,
  creditRecover: 2600,
  rewindTell: 700,
  embed: 1100,
} as const;

const NAMES = ['ERRATUM', 'ERRATUM (DRAFT 2)', 'ERRATUM (FINAL_FINAL_v3)'];

/** Light moves (no punish window) that can run inside another move's hold (rotation, act 4). */
type Light = 'ink' | 'glyphs';

interface Stolen {
  spr: Phaser.GameObjects.Sprite;
  target: StrikeTarget;
  a: number;
  home: { x: number; y: number };
}

interface GlyphShot {
  p: Projectile;
  g: Glyph;
}

/**
 * World 4-6: ERRATUM, THE UNWRITTEN. A typo that escaped the level files and knows it is in a game.
 * It fights with the map, then the HUD, then the program itself; the last act has no HP bar at all.
 *  Draft 1 "The Page": Strikethrough (erases floor columns into a pit, then restores them), Insert Line
 *    (writes ink platforms, dives from one), Falling Glyphs (the level's own ASCII: '#' block, '=' platform,
 *    '^' spikes, 'P' an ink copy of you, 'E' a fake exit; a parried '#' embeds in it), Typo (a margin note
 *    says which wall it dashes from; it may lie, the real wall drips ink).
 *  Draft 2 "The Frame": + its HP bar comes off the HUD as a flail (strike the stuck bar: bonus damage),
 *    Heart Theft (hearts orbit it; strike them home), Turn the Page (camera rotation), Letterbox Crush
 *    (bars slam shut except a scribbled gap). Notes are underlined when true.
 *  Draft 3 "The Engine": + a fake "not responding" window (strike Close before the cursor clicks Wait),
 *    the title menu falling as slabs, the world map as hop-stomp platforms, the credits as a rising
 *    climb (SPECIAL THANKS: YOU is the opening), Rewind Ink (copies replay your last 2 seconds).
 *  Act 4 "Save Over It": the HUD dissolves; a save prompt offers to delete your file. Strike NO three
 *    times, then save over ERRATUM. The real save is never touched: everything here is drawn in-canvas.
 * Random decisions live in src/combat/erratumPlan.ts.
 */
export class Erratum extends Boss {
  private history: Move[] = [];
  private usedOnce = new Set<Move>();
  private seq = 0;
  private temp: Phaser.GameObjects.GameObject[] = [];
  private boxes: Hitbox[] = [];
  private targets: StrikeTarget[] = [];
  private solids: Solid[] = [];
  private slabs: TextSlab[] = [];
  private counters: Phaser.Tweens.Tween[] = [];
  private page: PageEditor;
  private stolen: Stolen[] = [];
  private stolenUntil = 0;
  private glyphs: GlyphShot[] = [];
  private lies = 0;
  private samples: Sample[] = [];
  private nextSample = 0;
  private dialog: FakeDialog | null = null;
  private cursor: Phaser.GameObjects.Sprite | null = null;
  private grey: Phaser.FX.ColorMatrix | null = null;
  /** world copy of the HP bar while it's off the HUD */
  private bar: { box: Phaser.GameObjects.Graphics; chain: Phaser.GameObjects.Graphics; x: number; y: number; stuck: boolean; zone: Solid | null; target: StrikeTarget | null } | null = null;
  /** frame callbacks of running moves (credits, map, rewind...) */
  private tickers = new Map<string, (now: number, dt: number) => void>();
  private diving = false;
  private diveStart = 0;
  private dashUntil = 0;
  private hover = false;
  private act4 = false;
  private act4State: Act4State = { nos: 0, yeses: 0, done: false };
  private finaleStarted = false;
  private pendingStage: string | undefined;
  private rotated = false;

  constructor(gs: GameScene, x: number, y: number) {
    super(gs, x, y, 'erratum', NAMES[0], { hp: 170, bodyW: 22, bodyH: 34, contactDamage: 0, shards: 90 });
    this.thresholds = [0.66, 0.33];
    this.deathTint = INK;
    this.hearts = { periodicMs: 24000, maxOnField: 1, perParries: 4, onPhase: 1 };
    this.page = new PageEditor(gs, FLOOR_ROW, COL_L, COL_R);
    this.buildPage();
    // "Retry from Draft N": start straight in a later draft (the intro still plays)
    const st = gs.bossStage;
    if (st === 'd2' || st === 'd3' || st === 'act4') {
      const n = st === 'd2' ? 2 : 3;
      this.phase = n;
      this.hp = st === 'act4' ? 1 : Math.floor(this.maxHp * this.thresholds[n - 2]);
      this.bossName = NAMES[n - 1];
      bus.emit('boss', this.bossName, this.hp, this.maxHp);
      if (st === 'act4') this.pendingStage = 'act4';
    }
    this.once(Phaser.GameObjects.Events.DESTROY, () => this.cleanupFx());
    gs.events.once('shutdown', () => this.resetCamera());
  }

  /** The arena backdrop: a sheet of ruled paper behind the tiles. */
  private buildPage(): void {
    const gs = this.gs;
    if (!gs.textures.exists('err-page')) return;
    const img = gs.add.image(0, 0, 'err-page').setOrigin(0, 0).setDepth(-5).setAlpha(0);
    gs.tweens.add({ targets: img, alpha: 0.9, duration: 1200 });
    // a few doodles in the margin
    const doodles = ['fix me', 'TODO: boss', 'v0.1', '&?'];
    doodles.forEach((d, i) => txt(gs, 26 + (i % 2) * 6, 40 + i * 44, d, 8, '#8a4fc7', 0).setAlpha(0.35).setAngle(-80).setDepth(-4));
  }

  private get sheetKey(): string {
    return this.phase <= 1 ? 'erratum' : `erratum-p${Math.min(3, this.phase)}`;
  }

  private get ph(): number {
    return Math.min(3, this.phase) - 1;
  }

  private get floor(): number {
    return WINDUP_FLOOR[this.ph];
  }

  private hold(ms: number): number {
    return Math.max(this.floor, ms);
  }

  private get tricks(): boolean {
    return save.data.settings.tricks !== false;
  }

  protected animKey(): string {
    const s = this.sheetKey;
    if (this.texture.key === 'erratum-dot') return 'erratum-dot-idle';
    if (this.stunned) return s + '-stun';
    const pose = this.curPose;
    if (pose) return s + '-' + pose;
    if (!this.onGround && !this.hover) return s + '-air';
    return Math.abs(this.body.velocity.x) > 5 ? s + '-walk' : s + '-idle';
  }

  protected damageTakenMul(): number {
    if (this.act4) return 0;
    return super.damageTakenMul();
  }

  // ------------------------------------------------------------------ sequencing helpers (Croupier pattern)
  private step(ms: number, fn: () => void): void {
    const s = this.seq;
    this.later(ms, () => {
      if (s === this.seq && !this.transforming) fn();
    });
  }

  private finish(delay = 0): void {
    this.step(delay, () => {
      this.busy = false;
      this.cooldown = T.after[this.ph];
    });
  }

  private punish(ms: number, pose = 'dizzy'): void {
    this.body.setVelocityX(0);
    this.recover(ms, pose, T.after[this.ph]);
  }

  private begin(m: Move): void {
    this.busy = true;
    this.history.push(m);
    if (this.history.length > 4) this.history.shift();
    this.facePlayer();
    this.body.setVelocityX(0);
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

  private hurtBox(rect: () => Rect, ms: number, damage = 1, parryable = false): Hitbox {
    const box = new Hitbox(
      'enemy',
      rect,
      (t) => {
        const r = t.hurtRect(), a = rect();
        return { damage, kbX: (r.x + r.w / 2 >= a.x + a.w / 2 ? 1 : -1) * 170, kbY: -220, sourceX: a.x + a.w / 2, parryable, kind: parryable ? 'melee' : 'hazard' };
      },
      ms,
      (_t, res) => {
        if (res === 'blocked' && parryable && this.alive) this.onParried();
      },
    ).ownedBy(this);
    this.boxes = this.boxes.filter((b) => !b.dead);
    this.boxes.push(this.gs.damage.add(box));
    return box;
  }

  private target(rect: () => Rect, onStrike: (hit: HitInfo) => boolean): StrikeTarget {
    const t = new StrikeTarget(this.gs, rect, onStrike);
    this.targets = this.targets.filter((x) => x.alive);
    this.targets.push(t);
    return t;
  }

  private solid(x: number, y: number, w: number, h: number, oneWay = true, ms = 0): Solid {
    const z = solidZone(this.gs, x, y, w, h, oneWay);
    this.solids = this.solids.filter((s) => s.active);
    this.solids.push(z);
    if (ms > 0) this.gs.time.delayedCall(ms, () => z.active && z.destroy());
    return z;
  }

  private shot(x: number, y: number, tex: string, vx: number, vy: number, opts: { gravity?: number; lifeMs?: number; rotate?: boolean } = {}): Projectile {
    return this.gs.spawnProjectile(x, y, tex, vx, vy, 'enemy', { damage: 1, lifeMs: 3200, ...opts, owner: this });
  }

  private aimInk(x: number, y: number, speed: number, spread = 0): Projectile {
    const a = Math.atan2(this.player.y - y, this.player.x - x) + spread;
    return this.shot(x, y, 'err-ink', Math.cos(a) * speed, Math.sin(a) * speed);
  }

  private get playerCol(): number {
    return Phaser.Math.Clamp(Math.floor(this.player.x / TILE), COL_L, COL_R);
  }

  private note(text: string, ms: number, underline = false, x = GAME_W / 2, y = 52): void {
    bus.emit('hud-note', text, x, y, ms, underline);
  }

  /** Ink-blot vanish (body off: can't be hit), then reappear at (x, y) feet position. */
  private blink(x: number, feetY: number, ms: number, then: () => void): void {
    this.gs.juice.burst(this.x, this.y, INK, 14, 0.9);
    sfx.quill(200);
    this.gs.tweens.add({ targets: this, alpha: 0, duration: 120 });
    this.body.enable = false;
    this.step(ms, () => {
      const y = feetY - this.height / 2;
      this.body.enable = true;
      this.body.reset(x, y);
      this.setAlpha(1);
      this.gs.juice.burst(x, feetY - 10, INK, 14, 0.9);
      then();
    });
  }

  private setHover(on: boolean): void {
    this.hover = on;
    this.body.setAllowGravity(!on);
    if (on) this.body.setVelocity(0, 0);
  }

  /** Damage it takes from props (struck HP bar): goes through the phase logic like a real hit. */
  private selfDamage(n: number, sx: number, label = ''): void {
    if (!this.alive || this.act4 || this.transforming) return;
    this.hp = Math.max(0, this.hp - n);
    this.gs.juice.flash(this, 100, 0xffffff);
    this.gs.juice.burst(this.x, this.y, RED_INK, 10, 1);
    this.gs.juice.floatText(this.x, this.y - this.height / 2 - 4, label || String(n), '#ff8fb8');
    this.onHurt({ damage: n, kbX: 0, kbY: 0, sourceX: sx });
    if (this.hp <= 0 && !this.act4) this.die(true);
  }

  // ------------------------------------------------------------------ AI
  protected think(dt: number): void {
    if (this.pendingStage === 'act4') {
      this.pendingStage = undefined;
      this.enterAct4();
      return;
    }
    if (this.busy || this.act4) return;
    this.cooldown -= dt;
    this.facePlayer();
    const dx = Math.abs(this.dxToPlayer());
    const speed = [45, 55, 65][this.ph];
    let vx = 0;
    if (dx > 140) vx = this.facing * speed;
    else if (dx < 56) {
      const back = -this.facing;
      const room = back < 0 ? this.body.left - TILE : this.gs.worldWidth - TILE - this.body.right;
      if (room > 24) vx = back * speed * 0.7;
    }
    this.body.setVelocityX(vx);
    if (this.cooldown > 0 || !this.player.alive) return;
    const high = this.player.y < this.y - 2.5 * TILE;
    const m = pickMove(erratumWeights(this.phase, dx, high, this.usedOnce, this.tricks), this.history);
    if (!m) {
      this.cooldown = 250;
      return;
    }
    this.run(m);
  }

  private run(m: Move): void {
    switch (m) {
      case 'strike': this.strikethrough(); break;
      case 'insert': this.insertLine(); break;
      case 'glyphs': this.fallingGlyphs(); break;
      case 'typo': this.typo(); break;
      case 'bar': this.barFlail(); break;
      case 'hearts': this.heartTheft(); break;
      case 'rotate': this.turnThePage(); break;
      case 'letterbox': this.letterboxCrush(); break;
      case 'crash': this.fakeCrash(); break;
      case 'title': this.titleCard(); break;
      case 'map': this.mapStomp(); break;
      case 'credits': this.creditsRoll(); break;
      case 'rewind': this.rewindInk(); break;
    }
  }

  /** A light filler attack used inside other moves' holds. */
  private light(kind: Light): void {
    if (kind === 'ink') {
      const n = 3 + this.ph;
      for (let i = 0; i < n; i++)
        this.step(i * 220, () => {
          sfx.keyClack(1 + i * 0.05);
          this.aimInk(this.x + this.facing * 10, this.y - 14, T.inkSpeed[this.ph], (i - (n - 1) / 2) * 0.12);
        });
    } else this.dropGlyphs(glyphVolley(3, this.phase, Math.random), false);
  }

  // ================================================================== DRAFT 1: THE PAGE
  /** Strikethrough: dotted outlines over 1..3 floor spans, red line across, the columns vanish (a pit). */
  private strikethrough(): void {
    this.begin('strike');
    this.setPose('write', 700);
    this.setHover(true);
    this.gs.tweens.add({ targets: this, y: this.y - 10, duration: 300, ease: 'Sine.out' });
    const spans = strikeSpans(COL_L, COL_R, this.playerCol, this.phase, Math.random);
    const tell = this.hold(T.strikeTell[this.ph]);
    this.telegraph(tell, UNPARRYABLE_TINT, true);
    this.note('~~strike that~~', tell + 300);
    sfx.quill(tell * 0.6);
    for (const s of spans) {
      const x0 = s.c0 * TILE, w = (s.c1 - s.c0 + 1) * TILE;
      const g = this.keep(this.gs.add.graphics().setDepth(13));
      g.lineStyle(1, RED_INK, 1);
      for (let x = x0; x < x0 + w; x += 4) g.lineBetween(x, FLOOR_Y, x + 2, FLOOR_Y);
      for (let y = FLOOR_Y; y < this.gs.worldHeight; y += 4) {
        g.lineBetween(x0, y, x0, y + 2);
        g.lineBetween(x0 + w, y, x0 + w, y + 2);
      }
      this.gs.tweens.add({ targets: g, alpha: 0.35, yoyo: true, repeat: -1, duration: 110 });
      // the red line is drawn left -> right during the tell
      const line = this.keep(this.gs.add.rectangle(x0 - 4, FLOOR_Y - 2, 1, 2, RED_INK).setOrigin(0, 0.5).setDepth(13));
      this.tween01(tell * 0.8, 'Quad.out', (t) => sz(line, Math.max(1, (w + 8) * t), 2));
    }
    this.step(tell, () => {
      for (const o of this.temp) this.drop(o);
      this.temp = [];
      sfx.eraser();
      this.gs.juice.shake(0.008, 200);
      this.page.erase(spans);
      for (const s of spans) for (let c = s.c0; c <= s.c1; c += 2) this.gs.juice.burst(c * TILE + 8, FLOOR_Y + 4, 0xefe4c8, 4, 0.8);
      // while the page is open it flicks ink at you
      this.step(500, () => this.light('ink'));
      if (this.phase >= 2) this.step(1500, () => this.light('ink'));
      this.step(this.hold(T.strikeHold[this.ph]), () => {
        sfx.quill(250);
        this.page.restore();
        this.gs.juice.floatText(this.x, this.y - 36, 'stet.', '#e0443e');
        this.setHover(false);
        this.finish(200);
      });
    });
  }

  /** Insert Line: two ink lines written in the air (yours too), then it dives at you from the higher one. */
  private insertLine(): void {
    this.begin('insert');
    this.setPose('write', 900);
    const lines: { x: number; y: number }[] = [];
    const px = Phaser.Math.Clamp(this.player.x, 64, this.gs.worldWidth - 64);
    lines.push({ x: px, y: FLOOR_Y - 56 });
    const ox = Phaser.Math.Clamp(this.x + (this.x < GAME_W / 2 ? 90 : -90), 64, this.gs.worldWidth - 64);
    lines.push({ x: ox, y: FLOOR_Y - 92 });
    lines.forEach((l, i) =>
      this.step(i * 280, () => {
        sfx.quill(260);
        const g = this.keep(this.gs.add.graphics().setDepth(11));
        this.tween01(260, 'Quad.out', (t) => {
          g.clear();
          g.fillStyle(INK_DARK, 1).fillRect(l.x - 28, l.y - 3, 56 * t, 6);
          g.fillStyle(0x4a3f86, 1).fillRect(l.x - 28, l.y - 3, 56 * t, 1);
        });
        this.step(260, () => {
          const z = this.solid(l.x, l.y, 56, 6, true, T.insertHold);
          this.gs.tweens.add({ targets: g, alpha: 0, delay: T.insertHold - 300, duration: 300 });
          void z;
        });
      }),
    );
    // dive from the higher line
    const top = lines[1];
    this.step(800, () => {
      this.blink(top.x, top.y - 3, 260, () => {
        this.setHover(true);
        const tell = this.hold(T.diveTell[this.ph]);
        this.telegraph(tell, 0xffffff);
        this.setPose('windup', tell);
        this.facePlayer();
        const mark = this.keep(this.gs.add.rectangle(this.player.x, FLOOR_Y - 1, 24, 2, RED_INK, 0.8).setDepth(13));
        this.gs.tweens.add({ targets: mark, alpha: 0.2, yoyo: true, repeat: -1, duration: 90 });
        this.step(tell, () => {
          this.drop(mark);
          this.setHover(false);
          const tx = mark.x;
          this.body.setVelocity(Phaser.Math.Clamp((tx - this.x) / 0.62, -260, 260), -230);
          this.diving = true;
          this.diveStart = this.gs.time.now;
          this.meleeBox(-12, -9, 24, 34, 700, 1, true);
          sfx.dash();
        });
      });
    });
  }

  /** Landed after a dive (tick): shockwaves + punish window. */
  private landDive(): void {
    this.diving = false;
    this.body.setVelocityX(0);
    this.gs.juice.shake(0.012, 220);
    this.gs.juice.burst(this.x, this.body.bottom - 2, INK, 16, 1.2);
    sfx.heavyHit(0.7);
    this.shockwaves(160);
    this.punish(T.diveRecover[this.ph]);
  }

  /** Falling Glyphs: the level's ASCII drops from the ceiling; each glyph acts when it lands. */
  private fallingGlyphs(): void {
    this.begin('glyphs');
    this.setPose('cast', 700);
    sfx.keyClack();
    const n = 4 + this.ph;
    this.dropGlyphs(glyphVolley(n, this.phase, Math.random), true);
    this.finish(n * T.glyphGap[this.ph] + this.floor + 400);
  }

  private dropGlyphs(vol: Glyph[], aimFirst: boolean): void {
    const order: Glyph[] = ['#', '=', '^', 'P', 'E'];
    const used: number[] = [];
    vol.forEach((g, i) =>
      this.step(i * T.glyphGap[this.ph], () => {
        let col = 0;
        for (let t = 0; t < 10; t++) {
          col = aimFirst && i === 0 ? this.playerCol : Phaser.Math.Between(COL_L + 1, COL_R - 1);
          if (!used.some((u) => Math.abs(u - col) < 2)) break;
        }
        used.push(col);
        const x = col * TILE + TILE / 2;
        const red = g === '^';
        const marker = this.keep(this.gs.add.rectangle(x, TILE + 4, 10, 6, red ? RED_INK : 0x8a4fc7, 0.9).setDepth(40));
        this.gs.tweens.add({ targets: marker, alpha: 0.2, yoyo: true, repeat: -1, duration: 80 });
        sfx.keyClack(0.9 + Math.random() * 0.3);
        this.step(this.floor, () => {
          this.drop(marker);
          const p = this.shot(x, TILE + 8, 'err-glyph', 0, T.glyphFall[this.ph], { lifeMs: 2600 });
          p.setFrame(order.indexOf(g));
          if (red) p.setTint(0xff6a6a);
          p.setDepth(19);
          this.glyphs.push({ p, g });
          p.once(Phaser.GameObjects.Events.DESTROY, () => this.onGlyphGone(p, g));
        });
      }),
    );
  }

  private onGlyphGone(p: Projectile, g: Glyph): void {
    this.glyphs = this.glyphs.filter((x) => x.p !== p);
    if (!this.alive || !this.gs.sys.isActive()) return;
    const x = p.x, y = p.y;
    if (p.team === 'player') {
      // parried back: a '#' embeds in it (stun)
      if (g === '#' && Math.abs(x - this.x) < 30 && Math.abs(y - this.y) < 34 && !this.transforming && !this.act4) {
        this.gs.juice.floatText(this.x, this.y - 40, 'EMBEDDED', '#7fdbff');
        this.seq++;
        this.interruptFx(false);
        this.setHover(false);
        this.punish(T.embed, 'stun');
      }
      return;
    }
    if (y < FLOOR_Y - 28 || y > FLOOR_Y + 10) return; // hit you / a platform mid-air, or fell in a pit
    const fy = FLOOR_Y;
    switch (g) {
      case '#': {
        const z = this.solid(x, fy - 8, 16, 16, false, 3500);
        const box = this.gs.add.graphics().setDepth(11);
        box.fillStyle(INK_DARK, 1).fillRect(x - 8, fy - 16, 16, 16);
        box.fillStyle(0x4a3f86, 1).fillRect(x - 8, fy - 16, 16, 1);
        const lab = txt(this.gs, x, fy - 8, '#', 8, '#c2c3d6').setDepth(12);
        this.gs.tweens.add({ targets: [box, lab], alpha: 0, delay: 3100, duration: 400, onComplete: () => { box.destroy(); lab.destroy(); } });
        this.temp.push(box, lab);
        // don't trap the player inside a fresh block
        const pb = this.player.body;
        if (overlaps({ x: x - 8, y: fy - 16, w: 16, h: 16 }, { x: pb.x, y: pb.y, w: pb.width, h: pb.height })) z.destroy();
        break;
      }
      case '=': {
        this.solid(x, fy - 40, 40, 6, true, 4000);
        const g2 = this.gs.add.graphics().setDepth(11);
        g2.fillStyle(INK_DARK, 1).fillRect(x - 20, fy - 43, 40, 6);
        g2.fillStyle(0x9b92e6, 1).fillRect(x - 20, fy - 43, 40, 1);
        this.gs.tweens.add({ targets: g2, alpha: 0, delay: 3600, duration: 400, onComplete: () => g2.destroy() });
        this.temp.push(g2);
        break;
      }
      case '^': {
        const sp = this.gs.add.sprite(x, fy - 6, 'err-glyph-red', 2).setDepth(12);
        this.temp.push(sp);
        this.hurtBox(() => ({ x: x - 6, y: fy - 9, w: 12, h: 9 }), 2600);
        this.gs.tweens.add({ targets: sp, alpha: 0, delay: 2300, duration: 300, onComplete: () => sp.destroy() });
        break;
      }
      case 'P':
        this.inkCopy(x, fy);
        break;
      case 'E':
        this.fakeExit(x, fy);
        break;
    }
  }

  /** 'P' landed: an ink copy of the player shuffles toward you for 4s (one hit pops it). */
  private inkCopy(x: number, fy: number): void {
    const key = this.gs.textures.exists('player') ? 'player' : 'err-ink';
    const c = this.keep(this.gs.add.sprite(x, fy - 12, key).setTintFill(INK).setAlpha(0.85).setDepth(14));
    let alive = true;
    const end = () => {
      if (!alive) return;
      alive = false;
      tgt.kill();
      box.kill();
      this.tickers.delete(id);
      this.gs.juice.burst(c.x, c.y, INK, 10, 0.8);
      this.drop(c);
    };
    const rect = () => ({ x: c.x - 6, y: c.y - 10, w: 12, h: 22 });
    const box = this.hurtBox(rect, 4000);
    const tgt = this.target(rect, () => {
      end();
      return true;
    });
    const id = `copy${Math.random()}`;
    this.tickers.set(id, (_now, dt) => {
      if (!c.active) return end();
      const d = Math.sign(this.player.x - c.x);
      c.x += d * 62 * (dt / 1000);
      c.setFlipX(d < 0);
    });
    this.gs.time.delayedCall(4000, end);
  }

  /** 'E' landed: a fake exit portal; touching it throws you to the far wall. */
  private fakeExit(x: number, fy: number): void {
    const key = this.gs.textures.exists('exitPortal') ? 'exitPortal' : 'err-ink';
    const e = this.keep(this.gs.add.sprite(x, fy - 16, key).setTint(0x8a4fc7).setDepth(6));
    if (this.gs.anims.exists('exitPortal-swirl')) e.play('exitPortal-swirl');
    const id = `exit${Math.random()}`;
    let used = false;
    this.tickers.set(id, () => {
      if (!e.active) return this.tickers.delete(id);
      const pb = this.player.body;
      if (used || !overlaps({ x: x - 8, y: fy - 30, w: 16, h: 30 }, { x: pb.x, y: pb.y, w: pb.width, h: pb.height })) return;
      used = true;
      const tx = this.player.x < GAME_W / 2 ? this.gs.worldWidth - 40 : 40;
      this.player.setPosition(tx, FLOOR_Y - 14);
      this.player.body.reset(tx, FLOOR_Y - 14);
      sfx.pageFlip();
      this.gs.juice.floatText(tx, FLOOR_Y - 40, 'WRONG EXIT', '#b9a6ff');
      this.drop(e);
      this.tickers.delete(id);
    });
    this.gs.time.delayedCall(4000, () => {
      this.tickers.delete(id);
      this.drop(e);
    });
  }

  /** Typo: a margin note names the wall it will dash from (maybe a lie); the real wall drips ink. */
  private typo(): void {
    this.begin('typo');
    const n = marginNote(this.phase, this.lies, Math.random);
    this.lies = n.honest ? 0 : this.lies + 1;
    const claim = n.claim < 0 ? '<< FROM THE LEFT' : 'FROM THE RIGHT >>';
    const tell = this.hold(T.typoTell[this.ph]);
    // Draft 2 underlines the truth; drafts 1 and 3 never do
    this.note(claim, tell + 200, this.phase === 2 && n.honest);
    sfx.laugh();
    const wx = n.side < 0 ? TILE + 20 : this.gs.worldWidth - TILE - 20;
    // tell: ink runs down the real wall
    const drip = this.keep(this.gs.add.graphics().setDepth(12));
    const wallX = n.side < 0 ? TILE : this.gs.worldWidth - TILE - 3;
    this.tween01(tell, 'Linear', (t) => {
      drip.clear();
      drip.fillStyle(INK, 0.9);
      for (let k = 0; k < 4; k++) drip.fillRect(wallX + (k % 2), TILE + k * 9, 3, (FLOOR_Y - TILE) * Math.min(1, t * (1 + k * 0.3)));
    });
    this.blink(wx, FLOOR_Y, tell, () => {
      this.drop(drip);
      this.facing = n.side < 0 ? 1 : -1;
      this.setFlipX(this.facing < 0);
      this.telegraph(this.floor * 0.6, 0xffffff);
      this.setPose('windup', this.floor * 0.6);
      this.step(this.floor * 0.6, () => {
        const sp = T.dashSpeed[this.ph];
        const ms = ((this.gs.worldWidth - 2 * TILE - 40) / sp) * 1000;
        this.dashUntil = this.gs.time.now + ms;
        this.meleeBox(-14, -9, 28, 34, ms, 1, true);
        sfx.dash();
        this.step(ms, () => {
          this.dashUntil = 0;
          this.body.setVelocityX(0);
          this.punish(T.dashRecover[this.ph]);
        });
      });
    });
  }

  // ================================================================== DRAFT 2: THE FRAME
  /** Bar Flail: it pulls its own HP bar off the HUD, swings it twice, throws it into the page. */
  private barFlail(): void {
    this.begin('bar');
    this.setPose('cast', 600);
    bus.emit('hud-bar', false);
    sfx.pageFlip();
    this.note('mine, actually', 1200);
    const box = this.keep(this.gs.add.graphics().setDepth(42));
    const chain = this.keep(this.gs.add.graphics().setDepth(41));
    this.bar = { box, chain, x: GAME_W / 2, y: this.gs.worldHeight - 12, stuck: false, zone: null, target: null };
    const b = this.bar;
    // fly in from the bottom of the screen to its hand
    const sx = b.x, sy = b.y;
    this.tween01(420, 'Back.out', (t) => {
      b.x = Phaser.Math.Linear(sx, this.x + this.facing * 20, t);
      b.y = Phaser.Math.Linear(sy, this.y - 30, t);
    });
    const swing = (i: number, at: number) =>
      this.step(at, () => {
        this.facePlayer();
        const dir = this.facing;
        const tell = this.hold(500);
        this.telegraph(tell, UNPARRYABLE_TINT, true);
        this.setPose('windup', tell);
        // hold the bar overhead during the tell
        this.tween01(tell, 'Quad.out', (t) => {
          b.x = Phaser.Math.Linear(b.x, this.x - dir * 10, t * 0.3);
          b.y = Phaser.Math.Linear(b.y, this.y - 62, t * 0.3);
        });
        this.step(tell, () => {
          sfx.swing(0.6);
          this.setPose('cast', T.barSwing);
          const box2 = this.hurtBox(() => ({ x: b.x - 24, y: b.y - 6, w: 48, h: 12 }), T.barSwing);
          void box2;
          // arc: from overhead over to the floor in front, radius 64
          this.tween01(T.barSwing, 'Quad.in', (t) => {
            const a = -Math.PI / 2 + dir * t * (Math.PI * 0.62);
            b.x = this.x + Math.cos(a) * 64 * (dir > 0 ? 1 : 1);
            b.y = this.y - 6 + Math.sin(a) * 64;
            if (dir < 0) b.x = this.x - Math.abs(Math.cos(a)) * 64;
          });
          this.step(T.barSwing, () => {
            this.gs.juice.shake(0.008, 140);
            this.gs.juice.burst(b.x, b.y, RED_INK, 8, 0.9);
            if (i === 1) this.throwBar();
          });
        });
      });
    swing(0, 450);
    swing(1, 450 + this.hold(500) + T.barSwing + 250);
  }

  /** Throws the bar into the page above the player: a one-way ledge you can stand on and hit. */
  private throwBar(): void {
    const b = this.bar;
    if (!b) return;
    const tx = Phaser.Math.Clamp(this.player.x, 48, this.gs.worldWidth - 48);
    const ty = FLOOR_Y - 46;
    const fx = b.x, fy = b.y;
    sfx.swing(0.8);
    this.tween01(300, 'Quad.in', (t) => {
      b.x = Phaser.Math.Linear(fx, tx, t);
      b.y = Phaser.Math.Linear(fy, ty, t) - Math.sin(t * Math.PI) * 30;
    });
    this.step(300, () => {
      b.stuck = true;
      this.gs.juice.shake(0.01, 180);
      sfx.heavyHit(0.8);
      b.zone = this.solid(tx, ty - 1, 48, 6, true);
      let hot = 0;
      b.target = this.target(() => ({ x: b.x - 25, y: b.y - 6, w: 50, h: 12 }), (hit) => {
        const now = this.gs.time.now;
        if (now < hot) return false;
        hot = now + 260;
        this.selfDamage(Math.max(1, Math.round(hit.damage * 1.5)), b.x, "OW, MY HEALTH");
        return true;
      });
      this.note("don't touch that", 1400, false, b.x, Math.max(20, b.y - 40));
      this.punish(500, 'dizzy');
      this.step(T.barStuck, () => this.recallBar());
    });
  }

  private recallBar(): void {
    const b = this.bar;
    if (!b) return;
    b.zone?.destroy();
    b.target?.kill();
    b.zone = null;
    b.target = null;
    b.stuck = false;
    sfx.pageFlip();
    const fx = b.x, fy = b.y;
    this.tween01(320, 'Quad.in', (t) => {
      b.x = Phaser.Math.Linear(fx, GAME_W / 2, t);
      b.y = Phaser.Math.Linear(fy, this.gs.worldHeight + 20, t);
    }, () => this.homeBar());
  }

  private homeBar(): void {
    if (!this.bar) return;
    this.drop(this.bar.box);
    this.drop(this.bar.chain);
    this.bar.zone?.destroy();
    this.bar.target?.kill();
    this.bar = null;
    bus.emit('hud-bar', true);
  }

  private drawBar(): void {
    const b = this.bar;
    if (!b || !b.box.active) return;
    const f = Math.max(0, this.hp / this.maxHp);
    const g = b.box;
    g.clear();
    g.fillStyle(INK_DARK, 1).fillRect(b.x - 25, b.y - 6, 50, 12);
    g.fillStyle(0xffeec2, 1).fillRect(b.x - 24, b.y - 5, 48, 10);
    g.fillStyle(0x3b3554, 1).fillRect(b.x - 22, b.y - 3, 44, 6);
    g.fillStyle(RED_INK, 1).fillRect(b.x - 22, b.y - 3, Math.round(44 * f), 6);
    const c = b.chain;
    c.clear();
    if (!b.stuck) {
      c.lineStyle(2, INK, 1).lineBetween(this.x + this.facing * 8, this.y - 4, b.x, b.y);
    }
  }

  /** Heart Theft: up to 2 (3) of your hearts jump off the HUD and orbit it. Strike them to take them home. */
  private heartTheft(): void {
    this.begin('hearts');
    const n = heartsToSteal(this.player.hp, this.phase >= 3);
    if (n <= 0 || this.stolen.length) {
      this.light('ink');
      this.finish(900);
      return;
    }
    this.setPose('cast', 900);
    this.telegraph(this.hold(600), 0xff8fb8);
    this.note('<3 borrowing these', 1600);
    sfx.laugh();
    this.step(this.hold(600), () => {
      const cam = this.gs.cameras.main;
      for (let i = 0; i < n; i++) {
        const idx = this.player.hp - 1;
        const home = { x: cam.scrollX + 36 + (idx % 8) * 10, y: cam.scrollY + 10 + Math.floor(idx / 8) * 9 };
        this.player.hp -= 1;
        this.player.heal(0);
        const spr = this.gs.add.sprite(home.x, home.y, 'err-heart', 1).setDepth(43);
        const st: Stolen = { spr, a: (i / n) * Math.PI * 2, home, target: null as unknown as StrikeTarget };
        st.target = this.target(() => ({ x: spr.x - 8, y: spr.y - 8, w: 16, h: 16 }), () => {
          this.returnHeart(st, true);
          return true;
        });
        this.stolen.push(st);
        sfx.pickup(0.7 + i * 0.1);
      }
      this.stolenUntil = this.gs.time.now + T.heartsMs;
      this.finish(400);
    });
  }

  private returnHeart(st: Stolen, struck: boolean): void {
    this.stolen = this.stolen.filter((s) => s !== st);
    st.target.kill();
    if (!st.spr.active) return;
    if (struck) this.gs.juice.floatText(st.spr.x, st.spr.y - 10, 'RETURNED', '#ff8fb8');
    sfx.heal();
    const cam = this.gs.cameras.main;
    this.gs.tweens.add({
      targets: st.spr,
      x: cam.scrollX + st.home.x,
      y: cam.scrollY + st.home.y,
      duration: 380,
      ease: 'Quad.in',
      onComplete: () => {
        st.spr.destroy();
        if (this.player.alive) this.player.heal(1);
      },
    });
  }

  private returnAllHearts(instant = false): void {
    for (const st of [...this.stolen]) {
      if (instant) {
        this.stolen = this.stolen.filter((s) => s !== st);
        st.target.kill();
        st.spr.destroy();
        if (this.player.alive) this.player.heal(1);
      } else this.returnHeart(st, false);
    }
  }

  private orbitHearts(dt: number): void {
    if (!this.stolen.length) return;
    if (this.gs.time.now > this.stolenUntil) {
      this.gs.juice.floatText(this.x, this.y - 44, 'fine, keep them', '#ff8fb8');
      this.returnAllHearts();
      return;
    }
    for (const st of this.stolen) {
      st.a += dt * 0.0026;
      st.spr.setPosition(this.x + Math.cos(st.a) * 30, this.y - 12 + Math.sin(st.a) * 20);
    }
  }

  /** Turn the Page: the camera rotates (zooming out on 90 degrees so the whole page stays in view). */
  private turnThePage(): void {
    if (!this.tricks) return this.fallingGlyphs();
    this.begin('rotate');
    const deg = Phaser.Utils.Array.GetRandom([90, -90, 180]);
    const tell = this.hold(700);
    this.telegraph(tell, 0xffffff);
    this.setPose('cast', tell);
    this.note(deg === 180 ? 'upside down?' : 'turn the page', tell + 300);
    sfx.pageFlip();
    const cam = this.gs.cameras.main;
    // wobble tell
    this.tween01(tell, 'Linear', (t) => cam.setRotation(Math.sin(t * Math.PI * 6) * 0.03 * (1 - t)));
    this.step(tell, () => {
      this.rotated = true;
      // free the camera from the (unrotated) bounds and pin it to the page centre while turned
      cam.stopFollow();
      cam.removeBounds();
      cam.centerOn(this.gs.worldWidth / 2, this.gs.worldHeight / 2);
      const target = Phaser.Math.DegToRad(deg);
      const z = Math.abs(deg) === 90 ? this.gs.cameras.main.height / this.gs.worldWidth : 1;
      this.tween01(450, 'Cubic.inOut', (t) => {
        cam.setRotation(target * t);
        cam.setZoom(Phaser.Math.Linear(1, z, t));
      });
      this.step(600, () => this.light('ink'));
      this.step(1900, () => this.light('glyphs'));
      if (this.phase >= 3) this.step(3300, () => this.light('ink'));
      this.step(T.rotateHold, () => {
        sfx.pageFlip();
        this.tween01(400, 'Cubic.inOut', (t) => {
          cam.setRotation(target * (1 - t));
          cam.setZoom(Phaser.Math.Linear(z, 1, t));
        }, () => this.resetCamera());
        this.finish(450);
      });
    });
  }

  private resetCamera(): void {
    const wasRotated = this.rotated;
    this.rotated = false;
    const cam = this.gs.cameras?.main;
    if (!cam) return;
    cam.setRotation(0);
    cam.setZoom(1);
    if (wasRotated && this.gs.player?.active) {
      cam.setBounds(0, 0, this.gs.worldWidth, this.gs.worldHeight);
      cam.startFollow(this.gs.player, true, 0.12, 0.12);
    }
    if (this.grey) {
      try {
        cam.postFX?.remove(this.grey as unknown as Phaser.FX.Controller);
      } catch {
        /* renderer gone */
      }
      this.grey = null;
    }
  }

  /** Letterbox Crush: the cinematic bars slam down to the floor except over a scribbled gap. */
  private letterboxCrush(): void {
    this.begin('letterbox');
    this.setPose('cast', 600);
    this.setHover(true);
    this.gs.tweens.add({ targets: this, y: this.y - 8, duration: 300 });
    const slams = this.phase >= 3 ? 3 : 2;
    const gapW = 3;
    let at = 300;
    for (let i = 0; i < slams; i++) {
      const tell = this.hold(T.letterTell[this.ph]);
      this.step(at, () => this.slam(gapW, tell));
      at += tell + T.letterSlam + 520;
    }
    this.step(at, () => {
      this.setHover(false);
      this.punish(700, 'dizzy');
    });
  }

  private slam(gapW: number, tell: number): void {
    const c0 = letterboxGap(COL_L, COL_R, this.playerCol, gapW, Math.random);
    const gx0 = c0 * TILE, gx1 = (c0 + gapW) * TILE;
    const L = TILE, R = this.gs.worldWidth - TILE;
    const top = TILE;
    const left = this.keep(this.gs.add.rectangle(L, top, gx0 - L, 1, INK_DARK).setOrigin(0, 0).setDepth(50));
    const right = this.keep(this.gs.add.rectangle(gx1, top, R - gx1, 1, INK_DARK).setOrigin(0, 0).setDepth(50));
    const edgeL = this.keep(this.gs.add.rectangle(gx0 - 1, top, 1, 1, RED_INK).setOrigin(0, 0).setDepth(51));
    const edgeR = this.keep(this.gs.add.rectangle(gx1, top, 1, 1, RED_INK).setOrigin(0, 0).setDepth(51));
    // the scribbled gap marker on the floor
    const ring = this.keep(this.gs.add.graphics().setDepth(13));
    ring.lineStyle(2, RED_INK, 0.9).strokeEllipse((gx0 + gx1) / 2, FLOOR_Y - 10, gx1 - gx0 + 8, 26);
    const brk = this.keep(scrawl(this.gs, (gx0 + gx1) / 2, FLOOR_Y - 30, '[  here  ]', '#e0443e'));
    this.telegraph(tell, UNPARRYABLE_TINT, true);
    sfx.quill(300);
    const menace = 34;
    this.tween01(tell, 'Sine.out', (t) => {
      const h = menace * t;
      for (const r of [left, right]) sz(r, r.width, Math.max(1, h));
      sz(edgeL, 1, Math.max(1, h));
      sz(edgeR, 1, Math.max(1, h));
    });
    this.step(tell, () => {
      const full = FLOOR_Y - top;
      this.tween01(T.letterSlam * 0.4, 'Quad.in', (t) => {
        const h = menace + (full - menace) * t;
        for (const r of [left, right]) sz(r, r.width, h);
        sz(edgeL, 1, h);
        sz(edgeR, 1, h);
      });
      this.step(T.letterSlam * 0.4, () => {
        sfx.heavyHit(0.5);
        this.gs.juice.shake(0.014, 200);
        this.hurtBox(() => ({ x: L, y: top, w: gx0 - L, h: full }), T.letterSlam);
        this.hurtBox(() => ({ x: gx1, y: top, w: R - gx1, h: full }), T.letterSlam);
        this.step(T.letterSlam, () => {
          this.tween01(380, 'Quad.out', (t) => {
            const h = Math.max(1, full * (1 - t));
            for (const r of [left, right]) sz(r, r.width, h);
            sz(edgeL, 1, h);
            sz(edgeR, 1, h);
          }, () => {
            for (const o of [left, right, edgeL, edgeR, ring, brk]) this.drop(o);
          });
        });
      });
    });
  }

  // ================================================================== DRAFT 3: THE ENGINE
  /** The fake crash: a "not responding" window. Strike Close before the cursor clicks Wait. */
  private fakeCrash(): void {
    this.begin('crash');
    this.usedOnce.add('crash');
    const tricks = this.tricks;
    this.setPose('roar', 600);
    // tell: ink leaks from the top of the screen and the HUD glitches
    bus.emit('hud-glitch', 500);
    sfx.errorDing();
    for (let i = 0; i < 6; i++) {
      const x = 40 + i * 80 + Phaser.Math.Between(-10, 10);
      const d = this.keep(this.gs.add.rectangle(x, 0, 3, 1, INK).setOrigin(0.5, 0).setDepth(55));
      this.gs.tweens.add({ targets: d, height: Phaser.Math.Between(40, 120), duration: 500, ease: 'Quad.in' });
    }
    this.step(this.hold(600), () => {
      if (tricks) {
        stopMusic();
        const cam = this.gs.cameras.main;
        try {
          this.grey = cam.postFX?.addColorMatrix() ?? null;
          this.grey?.grayscale(0.85);
        } catch {
          this.grey = null;
        }
      }
      const veil = this.keep(this.gs.add.rectangle(0, 0, this.gs.worldWidth, this.gs.worldHeight, 0xffffff, tricks ? 0.28 : 0.12).setOrigin(0, 0).setDepth(54));
      void veil;
      // it hides inside the program
      this.gs.juice.burst(this.x, this.y, INK, 12, 0.8);
      this.setAlpha(0);
      this.body.enable = false;
      const cx = GAME_W / 2, cy = 146;
      const dlg = new FakeDialog(
        this.gs, cx, cy, 228, 78, 'Emirrius.exe',
        ['Emirrius is not responding.', 'If you close the program, you', 'might lose ERRATUM.'],
        [
          { id: 'wait', label: 'Wait', dx: -44, dy: 26 },
          { id: 'close', label: 'Close', dx: 44, dy: 26 },
        ],
        (id) => this.crashPick(id),
      );
      this.dialog = dlg;
      sfx.errorDing();
      // the cursor drifts toward Wait: it clicks when it arrives
      const cur = this.gs.add.sprite(cx + 150, cy - 70, 'err-cursor').setOrigin(0, 0).setDepth(60);
      this.cursor = cur;
      const wait = dlg.buttonPos('wait')!;
      this.tween01(T.crashMs, 'Sine.inOut', (t) => cur.setPosition(Phaser.Math.Linear(cx + 150, wait.x - 2, t), Phaser.Math.Linear(cy - 70, wait.y - 3, t)), () => {
        if (this.dialog === dlg && dlg.alive) {
          sfx.keyClack(0.6);
          this.crashPick('wait');
        }
      });
    });
  }

  private crashPick(id: string): void {
    const dlg = this.dialog;
    if (!dlg || !dlg.alive) return;
    for (const c of this.counters) c.stop();
    this.counters = [];
    const center = { x: dlg.cx, y: dlg.cy };
    const endCrash = () => {
      this.drop(this.cursor);
      this.cursor = null;
      dlg.destroy();
      this.dialog = null;
      this.resetCamera();
      for (const o of this.temp) this.drop(o);
      this.temp = [];
      if (this.tricks) playMusic(this.gs.bossTrack());
      this.setAlpha(1);
      this.body.enable = true;
    };
    if (id === 'close') {
      sfx.pageFlip();
      dlg.setTitle('ERRATUM.exe - End Task');
      endCrash();
      // it drops out of the window, dazed
      this.body.reset(center.x, center.y);
      this.gs.juice.floatText(center.x, center.y - 30, 'END TASK', '#7fdbff');
      this.gs.juice.burst(center.x, center.y, 0xffffff, 18, 1.2);
      this.punish(T.crashRecover, 'stun');
      return;
    }
    // Wait: a progress bar fills, then it bursts out of the window
    dlg.setTitle('Waiting for Emirrius...');
    dlg.setLines(['', '', '']);
    const pb = this.keep(this.gs.add.rectangle(center.x - 80, center.y + 4, 1, 8, 0x2d5fa8).setOrigin(0, 0.5).setDepth(59));
    this.tween01(this.floor + 200, 'Linear', (t) => sz(pb, Math.max(1, 160 * t), 8));
    this.step(this.floor + 200, () => {
      endCrash();
      this.body.reset(center.x, center.y);
      sfx.explode();
      this.gs.juice.shake(0.014, 260);
      this.gs.juice.ring(center.x, center.y, INK, 2.2);
      for (let k = 0; k < 12; k++) {
        const a = (k / 12) * Math.PI * 2;
        this.shot(center.x, center.y, 'err-ink', Math.cos(a) * 150, Math.sin(a) * 150, { lifeMs: 2400 });
      }
      this.gs.juice.floatText(center.x, center.y - 30, 'RESPONDING!', '#e0443e');
      this.finish(600);
    });
  }

  /** Title Card: the title menu's buttons fall in as slabs (red columns), then stand as a staircase. */
  private titleCard(): void {
    this.begin('title');
    this.setPose('cast', 900);
    const logo = this.keep(txt(this.gs, GAME_W / 2, 46, 'EMIRRIUS', 24, '#3a2c7a').setDepth(4).setAlpha(0));
    this.gs.tweens.add({ targets: logo, alpha: 0.55, duration: 400 });
    sfx.bell();
    const labels = ['CONTINUE', 'OPTIONS', 'QUIT'];
    const px = Phaser.Math.Clamp(this.player.x, 60, this.gs.worldWidth - 60);
    const xs = [px, px < GAME_W / 2 ? px + 120 : px - 120, GAME_W / 2 + (px < GAME_W / 2 ? 150 : -150)].map((x) => Phaser.Math.Clamp(x, 60, this.gs.worldWidth - 60));
    const ys = [FLOOR_Y - 34, FLOOR_Y - 66, FLOOR_Y - 98];
    labels.forEach((lab, i) => {
      const at = i * 360;
      this.step(at, () => {
        const x = xs[i];
        const col = this.keep(this.gs.add.rectangle(x, TILE, 76, ys[i] - TILE + 7, RED_INK, 0.16).setOrigin(0.5, 0).setDepth(12));
        this.gs.tweens.add({ targets: col, fillAlpha: 0.32, yoyo: true, repeat: -1, duration: 110 });
        const tell = this.hold(560);
        this.telegraph(Math.min(tell, 400), UNPARRYABLE_TINT, true);
        this.step(tell, () => {
          this.drop(col);
          const slab = textSlab(this.gs, x, TILE + 8, lab, { w: 72, h: 14, fill: 0x3b3554 });
          this.slabs.push(slab);
          const y0 = TILE + 8, y1 = ys[i];
          const fall = this.hurtBox(() => ({ x: slab.zone.x - 36, y: slab.zone.y - 7, w: 72, h: 14 }), T.slabFall);
          void fall;
          this.tween01(T.slabFall, 'Quad.in', (t) => slabTo(this.gs, slab, x, Phaser.Math.Linear(y0, y1, t)), () => {
            sfx.heavyHit(0.6);
            this.gs.juice.shake(0.006, 120);
            if (lab === 'QUIT') {
              this.target(() => ({ x: slab.zone.x - 36, y: slab.zone.y - 7, w: 72, h: 14 }), () => {
                this.gs.juice.floatText(slab.zone.x, slab.zone.y - 14, "you can't quit now", '#e0443e');
                return true;
              });
            }
            this.gs.time.delayedCall(T.slabStay, () => {
              if (!slab.zone.active) return;
              this.slabs = this.slabs.filter((s) => s !== slab);
              this.gs.tweens.add({ targets: [slab.plate, slab.label], alpha: 0, duration: 300, onComplete: () => destroySlab(slab) });
            });
          });
        });
      });
    });
    // from the top of the menu it rains ink while you climb
    this.step(3 * 360 + 800, () => this.light('ink'));
    this.step(3 * 360 + 1800, () => {
      this.gs.tweens.add({ targets: logo, alpha: 0, duration: 300 });
      this.finish(300);
    });
  }

  /** World Map Stomp: map nodes become platforms; it hops between them, "uncleaning" each one it lands on. */
  private mapStomp(): void {
    this.begin('map');
    this.setPose('cast', 800);
    sfx.pageFlip();
    const bg = this.keep(this.gs.add.rectangle(0, 0, this.gs.worldWidth, this.gs.worldHeight, 0x2a1f44, 0.55).setOrigin(0, 0).setDepth(3));
    void bg;
    // only bosses before this page (later levels haven't been written yet)
    const bossLv = LEVELS.slice(0, LEVELS.findIndex((l) => l.boss === 'erratum')).filter((l) => l.boss).slice(-5);
    const spots = [
      { x: 76, y: FLOOR_Y - 46 },
      { x: 160, y: FLOOR_Y - 86 },
      { x: 240, y: FLOOR_Y - 58 },
      { x: 320, y: FLOOR_Y - 96 },
      { x: 404, y: FLOOR_Y - 50 },
    ];
    // dotted path
    const path = this.keep(this.gs.add.graphics().setDepth(4));
    path.fillStyle(0xffd96a, 0.7);
    for (let i = 0; i < spots.length - 1; i++) {
      const a = spots[i], b = spots[i + 1];
      const len = Phaser.Math.Distance.Between(a.x, a.y, b.x, b.y);
      for (let t = 0; t < len; t += 7) path.fillRect(Math.round(a.x + ((b.x - a.x) * t) / len), Math.round(a.y + ((b.y - a.y) * t) / len), 2, 2);
    }
    const nodes = spots.map((s, i) => {
      const g = this.keep(this.gs.add.graphics().setDepth(5));
      g.fillStyle(INK_DARK, 1).fillCircle(s.x, s.y + 4, 11);
      g.fillStyle(0xffd96a, 1).fillCircle(s.x, s.y + 4, 9);
      g.fillStyle(0xf7b23b, 1).fillCircle(s.x, s.y + 6, 7);
      const id = bossLv[i]?.id.replace('w', '') ?? `${i + 1}`;
      const lab = this.keep(txt(this.gs, s.x, s.y + 4, id, 8, '#140c1c').setDepth(6));
      const zone = this.solid(s.x, s.y - 4, 24, 6, true);
      return { ...s, g, lab, zone, broken: false };
    });
    const hops = 4;
    let at = 600;
    let prev = -1;
    for (let k = 0; k < hops; k++) {
      this.step(at, () => {
        let i = Phaser.Math.Between(0, nodes.length - 1);
        for (let t = 0; t < 8 && (i === prev || nodes[i].broken); t++) i = Phaser.Math.Between(0, nodes.length - 1);
        prev = i;
        const n = nodes[i];
        const tell = this.hold(T.hopTell);
        // red X target on the node
        const x = this.keep(scrawl(this.gs, n.x, n.y - 16, 'X', '#e0443e', 16));
        this.telegraph(tell, 0xffffff);
        this.setPose('windup', tell);
        this.step(tell, () => {
          this.drop(x);
          this.hopTo(n.x, n.y - 7, () => {
            sfx.heavyHit(0.7);
            this.gs.juice.shake(0.01, 160);
            // two ink drops fall off each side of the node
            for (const d of [-1, 1]) this.shot(n.x + d * 10, n.y, 'err-ink', d * 70, -60, { gravity: 600, lifeMs: 2200 });
            // the node is "uncleared": ticks vanish, then it crumbles
            n.lab.setText('?').setColor('#e0443e');
            n.broken = true;
            this.gs.time.delayedCall(450, () => {
              if (!n.zone.active) return;
              n.zone.destroy();
              this.gs.tweens.add({ targets: [n.g, n.lab], alpha: 0, y: '+=10', duration: 300 });
            });
          });
        });
      });
      at += this.hold(T.hopTell) + T.hopMs + 260;
    }
    // last hop: back to the floor near the middle, then dazed
    this.step(at, () => {
      this.hopTo(GAME_W / 2 + Phaser.Math.Between(-60, 60), FLOOR_Y, () => {
        this.setHover(false);
        this.shockwaves(170);
        this.gs.juice.floatText(GAME_W / 2, 40, 'progress restored', '#7dffa0');
        for (const n of nodes) {
          n.zone.active && n.zone.destroy();
          this.drop(n.g);
          this.drop(n.lab);
        }
        this.drop(path);
        this.drop(bg);
        this.punish(T.mapRecover);
      });
    });
  }

  /** Scripted arc to a feet position (gravity off for the hop). */
  private hopTo(x: number, feetY: number, then: () => void): void {
    this.setHover(true);
    const x0 = this.x, y0 = this.y;
    const y1 = feetY - this.height / 2;
    sfx.jump();
    this.setPose('air', T.hopMs);
    this.tween01(T.hopMs, 'Linear', (t) => {
      const yy = Phaser.Math.Linear(y0, y1, t) - Math.sin(t * Math.PI) * 54;
      this.setPosition(Phaser.Math.Linear(x0, x, t), yy);
      this.body.updateFromGameObject();
    }, () => {
      this.body.reset(x, y1);
      then();
    });
  }

  /** Credits Roll: lines rise from the floor as platforms; it perches at the top; SPECIAL THANKS: YOU opens it up. */
  private creditsRoll(): void {
    this.begin('credits');
    this.usedOnce.add('credits');
    this.setPose('cast', 800);
    sfx.bell();
    const perch = { x: GAME_W / 2, feet: 64 };
    const dim = this.keep(this.gs.add.rectangle(0, 0, this.gs.worldWidth, this.gs.worldHeight, 0x000000, 0).setOrigin(0, 0).setDepth(3));
    this.gs.tweens.add({ targets: dim, fillAlpha: 0.55, duration: 500 });
    this.hopTo(perch.x, perch.feet, () => {
      this.setPose('idle', 0);
      this.note('roll credits', 1500);
    });
    const lines: { slab: TextSlab; thanks: boolean }[] = [];
    let flustered = false;
    CREDITS.forEach(([role, name], i) => {
      this.step(600 + i * T.creditGap, () => {
        const thanks = name === 'YOU';
        const x = i % 2 === 0 ? 150 + Phaser.Math.Between(-30, 20) : 330 + Phaser.Math.Between(-20, 30);
        const slab = textSlab(this.gs, x, FLOOR_Y - 8, `${role}   ${name}`, { w: 132, h: 13, fill: thanks ? 0xb8862b : 0x3b3554, color: thanks ? '#ffeec2' : '#c2c3d6' });
        slab.plate.setAlpha(0);
        slab.label.setAlpha(0);
        this.gs.tweens.add({ targets: [slab.plate, slab.label], alpha: 1, duration: 250 });
        this.slabs.push(slab);
        lines.push({ slab, thanks });
        // the perch throws ink at whoever is climbing
        if (!thanks) this.step(400, () => this.aimInk(this.x, this.y + 8, T.inkSpeed[this.ph] * 0.9));
      });
    });
    this.tickers.set('credits', (_now, dt) => {
      for (const l of [...lines]) {
        const z = l.slab.zone;
        if (!z.active) continue;
        const ny = z.y - T.creditSpeed * (dt / 1000);
        slabTo(this.gs, l.slab, z.x, ny);
        if (l.thanks && !flustered && ny < perch.feet + 46) {
          flustered = true;
          this.gs.juice.floatText(this.x, this.y - 44, '...thanks?', '#ffd96a');
          sfx.bell();
          this.punish(T.creditRecover, 'dizzy');
          this.step(T.creditRecover + 50, () => this.endCredits(lines.map((x) => x.slab), dim));
        }
        if (ny < TILE + 8) {
          lines.splice(lines.indexOf(l), 1);
          this.slabs = this.slabs.filter((s) => s !== l.slab);
          destroySlab(l.slab);
        }
      }
    });
    // safety: never stall if the thanks line somehow never arrives
    this.step(600 + CREDITS.length * T.creditGap + 6000, () => {
      if (!flustered) this.endCredits(lines.map((x) => x.slab), dim);
    });
  }

  private endCredits(slabs: TextSlab[], dim: Phaser.GameObjects.GameObject): void {
    if (!this.tickers.has('credits')) return;
    this.tickers.delete('credits');
    for (const s of slabs) {
      if (!s.zone.active) continue;
      this.slabs = this.slabs.filter((x) => x !== s);
      this.gs.tweens.add({ targets: [s.plate, s.label], alpha: 0, duration: 250, onComplete: () => destroySlab(s) });
    }
    this.drop(dim);
    this.setHover(false);
    this.busy = true;
    this.finish(600);
  }

  /** Rewind Ink: ink copies replay where you were over the last 2 seconds. */
  private rewindInk(): void {
    this.begin('rewind');
    if (this.samples.length < 6) {
      this.light('ink');
      this.finish(900);
      return;
    }
    this.setPose('cast', 800);
    this.note('<< REWIND', 1200);
    sfx.pageFlip();
    const copies = 2;
    for (let k = 0; k < copies; k++) {
      const buf = this.samples.slice();
      this.step(k * 650, () => this.replay(buf));
    }
    this.finish(650 * (copies - 1) + this.hold(T.rewindTell) + 2300);
  }

  private replay(buf: Sample[]): void {
    const start = buf[0];
    const key = this.gs.textures.exists('player') ? 'player' : 'err-ink';
    const c = this.keep(this.gs.add.sprite(start.x, start.y, key).setTintFill(0x5b2a86).setAlpha(0.45).setDepth(14));
    const tell = this.hold(T.rewindTell);
    this.gs.tweens.add({ targets: c, alpha: 0.85, duration: tell });
    const dur = buf[buf.length - 1].t - start.t;
    this.step(tell, () => {
      const t0 = this.gs.time.now;
      const rect = () => ({ x: c.x - 6, y: c.y - 10, w: 12, h: 20 });
      const box = this.hurtBox(rect, dur);
      const tgt = this.target(rect, () => {
        box.kill();
        this.tickers.delete(id);
        this.gs.juice.burst(c.x, c.y, 0x5b2a86, 10, 0.8);
        this.drop(c);
        return true;
      });
      const id = `rewind${Math.random()}`;
      let lastX = c.x;
      this.tickers.set(id, (now) => {
        if (!c.active) return this.tickers.delete(id);
        const pos = sampleAt(buf, now - t0);
        if (pos) {
          c.setPosition(pos.x, pos.y);
          if (Math.abs(pos.x - lastX) > 0.5) c.setFlipX(pos.x < lastX);
          lastX = pos.x;
        }
        if (now - t0 >= dur) {
          this.tickers.delete(id);
          tgt.kill();
          this.gs.tweens.add({ targets: c, alpha: 0, duration: 200, onComplete: () => c.destroy() });
        }
      });
    });
  }

  // ================================================================== ACT 4: SAVE OVER IT
  private enterAct4(): void {
    this.act4 = true;
    this.hp = 1;
    this.seq++;
    this.interruptFx(true);
    this.cancelRecover();
    this.busy = true;
    this.setHover(false);
    this.gs.bossStage = 'act4';
    bus.emit('boss-hide');
    bus.emit('hud-dissolve', true);
    bus.emit('hud-glitch', 900);
    stopMusic();
    this.setPose('roar', 1600);
    sfx.bossRoar();
    this.gs.juice.shake(0.016, 500);
    this.keep(banner(this.gs, GAME_W / 2, 60, 'FINAL DRAFT', '#e0443e', 1300));
    this.later(1700, () => {
      if (!this.alive) return;
      playMusic('erratum3');
      this.openSavePrompt();
      this.act4Loop(this.seq);
    });
  }

  private openSavePrompt(): void {
    const cleared = LEVELS.filter((l) => save.isCompleted(l.id)).length;
    const pct = Math.round((cleared / LEVELS.length) * 100);
    const dlg = new FakeDialog(
      this.gs, GAME_W / 2, 118, 250, 84, 'Save Manager',
      ['Delete EMIRRIUS-SAVE-V1?', `${cleared} stages, ${save.data.shards} shards, ${pct}%.`, 'This cannot be undone.'],
      [
        { id: 'yes', label: 'YES', dx: -56, dy: 30 },
        { id: 'no', label: 'NO', dx: 56, dy: 30 },
      ],
      (id) => this.savePress(id),
      RED_INK,
    );
    this.dialog = dlg;
    sfx.errorDing();
  }

  private savePress(id: string): void {
    const dlg = this.dialog;
    if (!dlg || !this.act4) return;
    if (id === 'final') return this.finale();
    this.act4State = act4Press(this.act4State, id === 'yes' ? 'yes' : 'no');
    const s = this.act4State;
    if (id === 'yes') {
      sfx.laugh();
      this.gs.juice.floatText(dlg.cx, dlg.cy - 54, 'HA! just kidding. nothing was deleted.', '#e0443e');
      this.note('nice try though', 1500);
      dlg.moveButton('yes', -56, 30);
      dlg.setLines(['Delete EMIRRIUS-SAVE-V1?', 'Are you SURE sure?', `(NO x${s.nos})`]);
      return;
    }
    sfx.keyClack(1.2);
    this.gs.juice.ring(dlg.cx, dlg.cy, 0xffffff, 1.2);
    if (s.done) {
      dlg.removeButton('yes');
      dlg.removeButton('no');
      dlg.setTitle('Save Manager');
      dlg.setLines(['Save over ERRATUM?', '', 'Overwrite the typo with the story.']);
      dlg.addButtonLater({ id: 'final', label: 'SAVE', dx: 0, dy: 30, w: 64 });
      this.note('wait. no. WAIT.', 2000);
      sfx.bell();
      return;
    }
    // NO hops somewhere else on the window; YES gets closer
    dlg.moveButton('no', Phaser.Math.Between(-90, 90), Phaser.Utils.Array.GetRandom([30, 30, 6]));
    dlg.setLines(['Delete EMIRRIUS-SAVE-V1?', `NO x${s.nos}`, s.nos === 1 ? 'Are you sure?' : 'Last chance!']);
  }

  /** Light attacks while the prompt is open, plus the drifting YES. */
  private act4Loop(seq: number): void {
    if (!this.alive || seq !== this.seq || this.finaleStarted) return;
    const dlg = this.dialog;
    if (dlg && !this.act4State.done) {
      // reduced-density echo of the earlier drafts
      const roll = Math.random();
      if (roll < 0.4) this.dropGlyphs(glyphVolley(3, 3, Math.random), true);
      else if (roll < 0.75) this.light('ink');
      else this.rewindEcho();
    }
    this.later(1700, () => this.act4Loop(seq));
  }

  private rewindEcho(): void {
    if (this.samples.length < 6) return this.light('ink');
    this.replay(this.samples.slice());
  }

  private driftYes(dt: number): void {
    const dlg = this.dialog;
    if (!dlg || !this.act4 || this.act4State.done || this.finaleStarted) return;
    const p = dlg.buttonPos('yes');
    if (!p) return;
    const sp = yesDrift(this.act4State.nos) * (dt / 1000);
    const tx = this.player.x, ty = Math.min(this.player.y - 18, FLOOR_Y - 30);
    const a = Math.atan2(ty - p.y, tx - p.x);
    const nx = Phaser.Math.Clamp(p.x + Math.cos(a) * sp - dlg.root.x, -200, 200);
    const ny = Phaser.Math.Clamp(p.y + Math.sin(a) * sp - dlg.root.y, -80, FLOOR_Y - 20 - dlg.root.y);
    dlg.moveButton('yes', nx, ny);
  }

  private finale(): void {
    if (this.finaleStarted) return;
    this.finaleStarted = true;
    this.seq++;
    const dlg = this.dialog;
    sfx.bell();
    this.gs.juice.slowmo(0.4, 600);
    if (dlg) {
      dlg.setLines(['Saving...', '', '']);
      this.gs.time.delayedCall(500, () => {
        dlg.destroy();
        if (this.dialog === dlg) this.dialog = null;
      });
    }
    // the typo corrects itself into a full stop
    this.later(650, () => {
      this.setTexture('erratum-dot', 0);
      this.play('erratum-dot-idle');
      this.gs.juice.ring(this.x, this.y, 0xffffff, 2.4);
      this.gs.juice.floatText(this.x, this.y - 30, '.', '#ffffff');
      this.note('corrected.', 1800, true);
      this.later(900, () => {
        bus.emit('hud-dissolve', false);
        this.act4 = false;
        this.hp = 0;
        this.die(true);
      });
    });
  }

  // ------------------------------------------------------------------ phases
  protected onHurt(hit: HitInfo): void {
    // Act 4 instead of death: the bar empties but the program doesn't close
    if (this.hp <= 0 && !this.act4 && !this.finaleStarted) {
      this.hp = 1;
      super.onHurt(hit);
      this.enterAct4();
      return;
    }
    super.onHurt(hit);
  }

  protected onPhase(n: number): void {
    this.seq++;
    this.interruptFx(true);
    this.setPose('roar', 1500);
    this.setHover(false);
    this.body.setVelocityX(0);
    this.transform(1500);
    this.bossName = NAMES[Math.min(3, n) - 1];
    bus.emit('boss', this.bossName, this.hp, this.maxHp);
    this.gs.bossStage = n === 2 ? 'd2' : 'd3';
    const s = this.seq;
    sfx.pageFlip();
    this.later(700, () => {
      if (s !== this.seq) return;
      if (n === 2) {
        this.keep(banner(this.gs, GAME_W / 2, 60, 'DRAFT 2', '#e0443e', 900));
        this.note('this time with feeling', 1600);
      } else {
        this.keep(banner(this.gs, GAME_W / 2, 60, 'FINAL_FINAL_v3', '#8a4fc7', 900));
        bus.emit('hud-glitch', 700);
        this.note('who wrote this??', 1600);
        playMusic('erratum3');
      }
      this.gs.juice.burst(this.x, this.y, INK, 22, 1.4);
      this.gs.juice.shake(0.012, 300);
      sfx.bossRoar();
    });
  }

  /** Drop all in-flight attack visuals/state (phase change / death / act 4). */
  private interruptFx(full: boolean): void {
    for (const tw of this.counters) tw.stop();
    this.counters = [];
    for (const b of this.boxes) b.kill();
    this.boxes = [];
    for (const t of this.targets) t.kill();
    this.targets = [];
    for (const o of this.temp) this.drop(o);
    this.temp = [];
    for (const z of this.solids) z.active && z.destroy();
    this.solids = [];
    for (const s of this.slabs) destroySlab(s);
    this.slabs = [];
    this.tickers.clear();
    this.page.restore();
    this.dialog?.destroy();
    this.dialog = null;
    this.drop(this.cursor);
    this.cursor = null;
    if (this.bar) this.homeBar();
    this.diving = false;
    this.dashUntil = 0;
    this.hover = false;
    this.body.setAllowGravity(true);
    this.body.enable = true;
    this.setAlpha(1);
    if (this.rotated || this.grey) this.resetCamera();
    if (this.grey === null && !this.act4) {
      /* music is restored by the phase change itself */
    }
    if (full) this.returnAllHearts(true);
  }

  private cleanupFx(): void {
    for (const o of this.temp) o.destroy();
    for (const t of this.targets) t.kill();
    for (const s of this.slabs) {
      s.zone.destroy();
      s.plate.destroy();
      s.label.destroy();
    }
    for (const st of this.stolen) {
      st.target.kill();
      st.spr.destroy();
    }
    this.dialog?.destroy(false);
    this.cursor?.destroy();
    this.bar?.box.destroy();
    this.bar?.chain.destroy();
  }

  die(reward = true): void {
    if (this.alive) {
      this.seq++;
      this.interruptFx(true);
      bus.emit('hud-dissolve', false);
      for (const p of [...this.gs.projectiles.getChildren()] as Projectile[]) {
        if (p.team !== 'enemy' || p.dead) continue;
        p.dead = true;
        p.hitbox.kill();
        this.gs.juice.burst(p.x, p.y, INK, 4, 0.5);
        p.destroy();
      }
    }
    super.die(reward);
  }

  // ------------------------------------------------------------------ per-frame
  tick(time: number, dt: number): void {
    // never let it fall through an erased page (Enemy.tick would kill it without a reward)
    if (this.alive && this.y > FLOOR_Y + 8 && !this.diving) {
      this.body.reset(GAME_W / 2, FLOOR_Y - 60);
      this.setHover(true);
      this.later(200, () => this.setHover(false));
    }
    if (this.dashUntil > 0 && this.alive) this.body.setVelocityX(this.facing * T.dashSpeed[this.ph]);
    super.tick(time, dt);
    if (!this.alive) return;
    const now = this.gs.time.now;
    if (this.hover) this.body.setVelocityY(0);
    if (this.diving && now - this.diveStart > 150 && this.onGround) this.landDive();
    if (this.page.active) this.page.fixRespawn();
    // record the player's path for Rewind Ink
    if (now >= this.nextSample && this.player.alive) {
      this.nextSample = now + 50;
      this.samples = pushSample(this.samples, { t: now, x: this.player.x, y: this.player.y });
    }
    this.orbitHearts(dt);
    this.drawBar();
    this.driftYes(dt);
    for (const f of [...this.tickers.values()]) f(now, dt);
  }
}
