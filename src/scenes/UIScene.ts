import Phaser from 'phaser';
import { GAME_W, GAME_H } from '../config';
import { bus } from '../core/events';
import { C } from '../art/palette';
import { txt, fmtTime, type PxText } from '../ui/text';
import { panel, panelTexture, Bar, sparkBurst } from '../ui/Panel';

/** height of each cinematic letterbox bar */
const LETTERBOX_H = 24;

/** Phase thresholds (fraction of max HP) per boss, used for bar ticks and phase pips. */
const BOSS_PHASES: Record<string, number[]> = {
  'IRON GOLEM': [0.5],
  'TWIN BLADES': [0.66, 0.33],
  'THE HOLLOW KING': [0.66, 0.33],
  'THE CHAINED WARDEN': [0.66, 0.33],
  'THE GILDED CROUPIER': [0.66, 0.33],
  'NOCTARA, THE ECLIPSE MOTH': [0.7, 0.4],
  'AURREN, THE FIRST BLADE': [0.66, 0.33],
  'AURREN, THE HOLLOW SUN': [0.5],
  // Fromage renames himself each phase (same bar, same ticks)
  'MONSIEUR FROMAGE': [0.66, 0.33],
  'MESSIEURS FROMAGE': [0.66, 0.33],
  'MONSIEUR FONDUE': [0.66, 0.33],
  // ERRATUM renames itself every draft
  'ERRATUM': [0.66, 0.33],
  'ERRATUM (DRAFT 2)': [0.66, 0.33],
  'ERRATUM (FINAL_FINAL_v3)': [0.66, 0.33],
  // ORRATH reveals more of itself (and renames the bar) every phase
  'THE HAND OF ORRATH': [0.66, 0.33],
  'ORRATH, THE BURIED COLOSSUS': [0.66, 0.33],
  'ORRATH, FALLING': [0.66, 0.33],
  // CANTOR renames itself with the canonical hours
  'CANTOR, THE TOLLING BELL': [0.66, 0.33],
  'CANTOR (TERCE)': [0.66, 0.33],
  'CANTOR (VESPERS)': [0.66, 0.33],
  // TUMBLAR renames itself for each lock it puts up
  'TUMBLAR, THE KEYLESS DOOR': [0.66, 0.33],
  'TUMBLAR (THE DIAL)': [0.66, 0.33],
  'TUMBLAR (THE WARDS)': [0.66, 0.33],
  'UMBRA, THE CAST SHADOW': [0.66, 0.33],
};
const BOSS_TITLES: Record<string, string> = {
  'IRON GOLEM': 'Warden of the Verdant Hollow',
  'TWIN BLADES': 'Duelists of the Iron Spire',
  'THE HOLLOW KING': 'Lord of the Crimson Throne',
  'THE CHAINED WARDEN': 'Jailer of the Hollow Deep',
  'THE GILDED CROUPIER': 'Keeper of the Last Wager',
  'NOCTARA, THE ECLIPSE MOTH': 'Devourer of the Last Light',
  'AURREN, THE FIRST BLADE': 'Guardian of the Sunless Core',
  'AURREN, THE HOLLOW SUN': 'The Light That Would Not Die',
  'MONSIEUR FROMAGE': 'Host of the Wheel of Fate',
  'ERRATUM': 'The Unwritten',
  'THE HAND OF ORRATH': 'Something Stirs Beneath the Range',
  'ORRATH, THE BURIED COLOSSUS': 'The Mountain That Woke',
  'ORRATH, FALLING': 'The Mountain That Fell',
  'CANTOR, THE TOLLING BELL': 'Every Hour Has Its Due',
  'TUMBLAR, THE KEYLESS DOOR': 'It Forgot What It Guards',
  'TUMBLAR (THE DIAL)': 'Listen for the Click',
  'TUMBLAR (THE WARDS)': 'The Last Lock Is You',
  'UMBRA, THE CAST SHADOW': 'Where the Light Falls Short',
};

const HEARTS_PER_ROW = 8;
const HEART_STEP = 10;
const BOSS_W = 300;

/**
 * HUD overlay: portrait + hearts, stamina/charge, shards, timer, level banner,
 * boss bar + intro card, sign dialog and toasts. Listens to the global bus.
 */
/** Sign dialog sits under the HUD so it never covers the player on the ground. */
const SIGN_Y = 60;

export class UIScene extends Phaser.Scene {
  private handlers: [string, (...a: never[]) => void][] = [];
  // vitals
  private plate!: Phaser.GameObjects.Image;
  private hearts: Phaser.GameObjects.Image[] = [];
  private hp = 0;
  private maxHp = 0;
  /** beyond two rows of hearts: one heart + "hp/max" counter */
  private heartText?: PxText;
  private bolt!: Phaser.GameObjects.Image;
  private stam!: Bar;
  private stamMax = 100;
  private stamFlash = 0;
  private charge!: Phaser.GameObjects.Rectangle;
  private chargeP = 0;
  // shards
  private shardPlate!: Phaser.GameObjects.Image;
  private shardIcon!: Phaser.GameObjects.Image;
  private shardText!: PxText;
  private shardShown = -1;
  private shardTarget = 0;
  private shardAcc = 0;
  // timer
  private timeText!: PxText;
  // boss
  private boss!: Phaser.GameObjects.Container;
  private bossBar!: Bar;
  private bossName!: PxText;
  private bossNamePlate!: Phaser.GameObjects.Image;
  private bossTicks: Phaser.GameObjects.Rectangle[] = [];
  private bossPips: Phaser.GameObjects.Image[] = [];
  private bossKey = '';
  private bossShown = false;
  /** ERRATUM pulled the bar off the HUD: values still update, but it stays hidden until handed back */
  private barAway = false;
  /** margin notes survive 'hud-dissolve' (they are the boss talking) */
  private notes: Phaser.GameObjects.GameObject[] = [];
  private dissolved = false;
  private glitchUntil = 0;
  // sign
  private signBox!: Phaser.GameObjects.Container;
  private signText!: PxText;
  private signArrow!: Phaser.GameObjects.Image;
  private signFull = '';
  private signPos = 0;
  private signAcc = 0;
  private toasts: Phaser.GameObjects.Container[] = [];

  constructor() {
    super('UI');
  }

  create(): void {
    this.scene.setVisible(true); // GameOver hides the HUD; restore on (re)start
    this.hearts = [];
    this.heartText = undefined;
    this.hp = 0;
    this.maxHp = 0;
    this.stamFlash = 0;
    this.chargeP = 0;
    this.shardShown = -1;
    this.bossShown = false;
    this.bossKey = '';
    this.barAway = false;
    this.notes = [];
    this.dissolved = false;
    this.glitchUntil = 0;
    this.cameras.main.setScroll(0, 0);
    this.toasts = [];
    this.letterbox = [];
    this.signFull = '';

    // --- vitals cluster (top-left)
    this.plate = this.add.image(2, 2, panelTexture(this, 40, 28, 'glass')).setOrigin(0, 0);
    panel(this, 15, 15, 24, 24, 'dark');
    this.add.image(15, 15, 'ui-portrait');
    this.bolt = this.add.image(34, 0, 'ui-bolt');
    this.stam = new Bar(this, 40, 0, 66, 9, C.leaf, C.cream);
    this.charge = this.add.rectangle(43, 0, 0, 1, C.gold).setOrigin(0, 0);
    this.layoutVitals(5);

    // --- shards (top-right)
    this.shardPlate = this.add.image(GAME_W - 2, 2, panelTexture(this, 44, 17, 'glass')).setOrigin(1, 0);
    this.shardIcon = this.add.image(GAME_W - 36, 11, 'ui-shard');
    this.shardText = txt(this, GAME_W - 27, 10, '0', 10, '#ffd96a', 0);

    // --- timer (top-centre)
    panel(this, GAME_W / 2, 10, 56, 15, 'glass');
    this.timeText = txt(this, GAME_W / 2, 9, '0:00.00', 8, '#c2c3d6');

    // --- boss bar (bottom)
    this.buildBossBar();

    // --- sign dialog
    const sw = 372;
    const sbg = panel(this, 0, 0, sw, 44, 'parch');
    this.signText = txt(this, -sw / 2 + 10, -14, '', 9, '#ffeec2', 0).setOrigin(0, 0);
    this.signText.setWordWrapWidth(sw - 24);
    this.signArrow = this.add.image(sw / 2 - 10, 14, 'ui-arrow', 3).setTint(C.gold);
    this.tweens.add({ targets: this.signArrow, y: 16, yoyo: true, repeat: -1, duration: 300, ease: 'Stepped', easeParams: [2] });
    this.signBox = this.add.container(GAME_W / 2, SIGN_Y, [sbg, this.signText, this.signArrow]).setVisible(false);

    // --- bus
    this.on('hp', (hp: number, max: number) => this.setHearts(hp, max));
    this.on('stamina', (v: number, max: number) => {
      if (max !== this.stamMax) {
        this.stamMax = max;
        this.stam.resize(Math.round(max * 0.6) + 6);
        this.layoutVitals(this.maxHp || 5);
      }
      this.stam.set(v / max);
    });
    this.on('stamina-fail', () => {
      this.stamFlash = 360;
    });
    this.on('charge', (p: number) => {
      this.chargeP = p;
    });
    this.on('shards', (n: number) => {
      this.shardTarget = n;
      if (this.shardShown < 0) this.setShardText(n);
    });
    this.on('time', (ms: number) => this.timeText.setText(fmtTime(ms)));
    this.on('level', (name: string) => this.levelBanner(name));
    this.on('boss', (name: string, hp: number, max: number) => this.setBoss(name, hp, max));
    this.on('boss-hide', () => this.hideBoss());
    this.on('boss-intro', (name: string) => this.bossIntro(name));
    this.on('letterbox', (on: boolean) => this.setLetterbox(on));
    this.on('sign', (text: string | null) => this.setSign(text));
    this.on('toast', (text: string) => this.toast(text));
    // ERRATUM (w4-6) HUD tricks
    this.on('hud-bar', (home: boolean) => this.setBarHome(home));
    this.on('hud-note', (text: string, x: number, y: number, ms: number, underline: boolean) => this.note(text, x, y, ms, underline));
    this.on('hud-dissolve', (on: boolean) => this.dissolve(on));
    this.on('hud-glitch', (ms: number) => {
      this.glitchUntil = this.time.now + ms;
    });

    this.events.once('shutdown', () => {
      this.handlers.forEach(([e, f]) => bus.off(e, f));
      this.handlers = [];
    });
  }

  private on(ev: string, fn: (...a: never[]) => void): void {
    bus.on(ev, fn);
    this.handlers.push([ev, fn]);
  }

  // ------------------------------------------------------------ vitals
  private compact(max: number): boolean {
    return max > HEARTS_PER_ROW * 2;
  }

  private rows(max: number): number {
    return max > HEARTS_PER_ROW && !this.compact(max) ? 2 : 1;
  }

  private layoutVitals(max: number): void {
    const rows = this.rows(max);
    const perRow = this.compact(max) ? 5 : Math.min(max, HEARTS_PER_ROW);
    this.heartText?.setPosition(43, 10);
    this.hearts.forEach((h, i) => {
      const r = Math.floor(i / HEARTS_PER_ROW);
      const c = i % HEARTS_PER_ROW;
      h.setPosition(36 + c * HEART_STEP, 10 + r * 9);
    });
    const barY = rows === 1 ? 18 : 27;
    this.bolt.setPosition(34, barY + 4);
    this.stam.place(40, barY);
    this.charge.setPosition(43, barY + 9);
    const contentW = Math.max(31 + perRow * HEART_STEP + 2, 40 + this.stam.w);
    const h = rows === 1 ? 30 : 39;
    this.plate.setTexture(panelTexture(this, contentW + 3, h, 'glass'));
  }

  private setHearts(hp: number, max: number): void {
    if (this.compact(max)) {
      if (!this.heartText) {
        this.hearts.forEach((h) => h.destroy());
        this.hearts = [this.add.image(0, 0, 'ui-heart', 0)];
        this.heartText = txt(this, 0, 0, '', 9, '#ffeec2', 0);
      }
      const lost = hp < this.hp;
      this.maxHp = max;
      this.hp = hp;
      this.hearts[0].setFrame(hp > 0 ? 0 : 1);
      this.heartText.setText(`${hp} / ${max}`);
      this.layoutVitals(max);
      if (lost) this.tweens.add({ targets: this.hearts[0], scale: 1.5, yoyo: true, duration: 90 });
      return;
    }
    if (this.heartText) {
      this.heartText.destroy();
      this.heartText = undefined;
      this.hearts.forEach((h) => h.destroy());
      this.hearts = [];
      this.maxHp = 0;
    }
    if (max !== this.maxHp) {
      while (this.hearts.length < max) this.hearts.push(this.add.image(0, 0, 'ui-heart', 0));
      while (this.hearts.length > max) this.hearts.pop()!.destroy();
      this.maxHp = max;
      this.layoutVitals(max);
      this.hearts.forEach((h, i) => h.setFrame(i < hp ? 0 : 1));
      this.hp = hp;
      return;
    }
    this.hearts.forEach((h, i) => {
      const full = i < hp;
      const was = i < this.hp;
      h.setFrame(full ? 0 : 1);
      if (was && !full) {
        // lost: white flash + pop + chips
        h.setTintFill(0xffffff);
        this.time.delayedCall(70, () => h.active && h.clearTint());
        this.tweens.add({ targets: h, scale: 1.6, yoyo: true, duration: 90 });
        sparkBurst(this, h.x, h.y, C.red, 6, 10);
      } else if (!was && full) {
        this.tweens.add({ targets: h, scale: 1.4, yoyo: true, duration: 120, delay: (i - this.hp) * 60 });
      }
    });
    this.hp = hp;
  }

  // ------------------------------------------------------------ shards
  private setShardText(n: number): void {
    this.shardShown = n;
    this.shardText.setText(String(n));
    const w = Math.max(44, Math.round(this.shardText.width) + 34);
    this.shardPlate.setTexture(panelTexture(this, w, 17, 'glass'));
    this.shardIcon.setX(GAME_W - w + 10);
    this.shardText.setX(GAME_W - w + 19);
  }

  private tickShards(dt: number): void {
    if (this.shardShown < 0 || this.shardShown === this.shardTarget) return;
    this.shardAcc += dt;
    const diff = this.shardTarget - this.shardShown;
    // one at a time for normal pickups (each tick bounces); chunked only for big jumps
    const big = Math.abs(diff) > 12;
    if (this.shardAcc < (big ? 40 : 55)) return;
    this.shardAcc = 0;
    const step = big ? Math.ceil(Math.abs(diff) / 10) : 1;
    const next = this.shardShown + Math.sign(diff) * Math.min(step, Math.abs(diff));
    this.setShardText(next);
    if (diff > 0) {
      this.tweens.killTweensOf([this.shardText, this.shardIcon]);
      this.shardText.setColor('#ffffff').setY(7);
      this.time.delayedCall(50, () => this.shardText.setColor('#ffd96a'));
      this.tweens.add({ targets: this.shardText, y: 10, duration: 160, ease: 'Bounce.out' });
      this.shardIcon.setScale(1.6, 1.3).setAngle(Phaser.Math.Between(-14, 14));
      this.tweens.add({ targets: this.shardIcon, scaleX: 1, scaleY: 1, angle: 0, duration: 180, ease: 'Back.out' });
    } else {
      this.shardText.setColor('#ef476f');
      this.time.delayedCall(50, () => this.shardText.setColor('#ffd96a'));
    }
  }

  // ------------------------------------------------------------ level banner
  private levelBanner(name: string): void {
    const y = 64;
    const label = txt(this, 0, -1, name, 16, '#ffeec2');
    const w = Math.max(160, Math.round(label.width) + 56);
    const rib = panel(this, 0, 0, w, 26, 'ribbon');
    const sub = txt(this, 0, -21, '- STAGE -', 8, '#ffd96a');
    const c = this.add.container(GAME_W / 2, y, [rib, label, sub]).setDepth(40);
    this.banner = c;
    rib.setScale(0, 1);
    label.setAlpha(0);
    sub.setAlpha(0);
    this.tweens.add({ targets: rib, scaleX: 1, duration: 260, ease: 'Back.out' });
    this.tweens.add({ targets: [label, sub], alpha: 1, delay: 160, duration: 200 });
    this.tweens.add({
      targets: c,
      alpha: 0,
      y: y - 10,
      delay: 2200,
      duration: 500,
      ease: 'Quad.in',
      onUpdate: () => (c.y = Math.round(c.y)),
      onComplete: () => c.destroy(),
    });
  }
  private banner?: Phaser.GameObjects.Container;

  // ------------------------------------------------------------ boss
  private buildBossBar(): void {
    const frame = panel(this, 0, 0, BOSS_W + 14, 17, 'plate');
    this.bossBar = new Bar(this, -BOSS_W / 2, -5, BOSS_W, 10, C.red, C.cream);
    this.bossNamePlate = panel(this, 0, -16, 120, 15, 'plate');
    this.bossName = txt(this, 0, -17, '', 9, '#ffeec2');
    this.boss = this.add.container(GAME_W / 2, GAME_H - 12, [frame, ...this.bossBar.objects(), this.bossNamePlate, this.bossName]);
    this.boss.setVisible(false);
  }

  private setBossLayout(name: string): void {
    this.bossKey = name;
    this.bossName.setText(name);
    const w = Math.round(this.bossName.width) + 28;
    this.bossNamePlate.setTexture(panelTexture(this, w, 15, 'plate'));
    this.bossNamePlate.setX(Math.round(-w / 2) + w / 2);
    this.bossTicks.forEach((t) => t.destroy());
    this.bossPips.forEach((p) => p.destroy());
    this.bossTicks = [];
    this.bossPips = [];
    const phases = BOSS_PHASES[name] ?? [];
    const inner = BOSS_W - 6;
    for (const f of phases) {
      const x = Math.round(-BOSS_W / 2 + 3 + inner * f);
      const t = this.add.rectangle(x, -2, 1, 4, C.ink).setOrigin(0, 0);
      const t2 = this.add.rectangle(x, -8, 1, 3, C.gold).setOrigin(0, 0);
      this.bossTicks.push(t, t2);
    }
    const n = phases.length + 1;
    for (let i = 0; i < n; i++) {
      const p = this.add.image(Math.round(w / 2) + 6 + i * 6, -17, 'ui-pip', 2);
      this.bossPips.push(p);
    }
    this.boss.add([...this.bossTicks, ...this.bossPips]);
  }

  private setBoss(name: string, hp: number, max: number): void {
    if (name !== this.bossKey) this.setBossLayout(name);
    const f = Math.max(0, hp) / max;
    if (this.barAway) {
      this.bossBar.set(f, true);
      return;
    }
    if (!this.bossShown) {
      this.bossShown = true;
      this.boss.setVisible(true).setAlpha(0).setY(GAME_H + 8);
      this.tweens.add({ targets: this.boss, y: GAME_H - 12, alpha: 1, duration: 350, ease: 'Back.out', onUpdate: () => (this.boss.y = Math.round(this.boss.y)) });
      this.bossBar.set(f, true);
    } else {
      const prev = this.bossBar.value;
      this.bossBar.set(f);
      if (f < prev) {
        this.bossBar.fill.setFillStyle(0xffffff);
        this.time.delayedCall(60, () => this.bossBar.fill.setFillStyle(C.red));
      }
    }
    // phase pips: lit = phases still to fight through
    const phases = BOSS_PHASES[name] ?? [];
    const passed = phases.filter((t) => f <= t).length;
    this.bossPips.forEach((p, i) => {
      const lit = i < this.bossPips.length - passed;
      const fr = lit ? 2 : 0;
      if (Number(p.frame.name) !== fr) {
        p.setFrame(fr);
        if (!lit) sparkBurst(this, this.boss.x + p.x, this.boss.y + p.y, C.red, 8, 12);
      }
    });
  }

  private hideBoss(): void {
    if (!this.bossShown) return;
    this.bossShown = false;
    this.tweens.add({ targets: this.boss, alpha: 0, y: GAME_H + 8, duration: 400, onComplete: () => this.boss.setVisible(false) });
  }

  /** ERRATUM grabs the bar (false) / gives it back (true). */
  private setBarHome(home: boolean): void {
    this.tweens.killTweensOf(this.boss);
    if (!home) {
      this.barAway = true;
      // yanked upward out of the frame, toward the arena
      this.tweens.add({ targets: this.boss, y: GAME_H - 60, alpha: 0, scaleX: 0.4, duration: 260, ease: 'Back.in', onComplete: () => this.boss.setVisible(false).setScale(1) });
      return;
    }
    this.barAway = false;
    if (!this.bossShown) return;
    this.boss.setVisible(true).setScale(1).setAlpha(0).setY(GAME_H - 60);
    this.tweens.add({ targets: this.boss, y: GAME_H - 12, alpha: 1, duration: 300, ease: 'Bounce.out', onUpdate: () => (this.boss.y = Math.round(this.boss.y)) });
  }

  /** Handwritten margin note (screen space: unaffected by the arena camera turning). */
  private note(text: string, x: number, y: number, ms: number, underline: boolean): void {
    const t = txt(this, x, y, text, 9, '#3a2c7a').setDepth(70).setAngle(Phaser.Math.Between(-5, 5));
    const back = this.add.rectangle(x, y, Math.round(t.width) + 10, 13, 0xefe4c8, 0.92).setDepth(69).setAngle(t.angle);
    const objs: Phaser.GameObjects.GameObject[] = [back, t];
    if (underline) objs.push(this.add.rectangle(x, y + 7, Math.round(t.width) + 4, 1, 0xe0443e).setDepth(70).setAngle(t.angle));
    this.notes.push(...objs);
    // written in: grows from the left
    t.setScale(t.scaleX * 0.2, t.scaleY);
    this.tweens.add({ targets: t, scaleX: t.scaleY, duration: 180, ease: 'Quad.out' });
    this.tweens.add({
      targets: objs,
      alpha: 0,
      delay: ms,
      duration: 250,
      onComplete: () => {
        for (const o of objs) o.destroy();
        this.notes = this.notes.filter((n) => n.active);
      },
    });
  }

  /** Act 4: the whole HUD dissolves into ink (notes stay). */
  private dissolve(on: boolean): void {
    if (on === this.dissolved) return;
    this.dissolved = on;
    const keep = new Set(this.notes);
    const all = this.children.list.filter((o) => !keep.has(o)) as unknown as (Phaser.GameObjects.GameObject & Phaser.GameObjects.Components.Alpha)[];
    this.tweens.killTweensOf(all);
    const from = all.map((o) => o.alpha);
    const to = on ? 0 : 1;
    // one counter drives every element (and a final hard set), so no stray tween can leave the HUD invisible
    this.tweens.addCounter({
      from: 0,
      to: 1,
      duration: on ? 900 : 400,
      ease: 'Quad.inOut',
      onUpdate: (t) => {
        const k = t.getValue() ?? 0;
        all.forEach((o, i) => o.active && o.setAlpha(from[i] + (to - from[i]) * k));
      },
      onComplete: () => all.forEach((o) => o.active && o.setAlpha(to)),
    });
  }

  private bossIntro(name: string): void {
    if (this.banner?.active) {
      this.tweens.killTweensOf(this.banner);
      this.banner.destroy();
    }
    // sits under the HUD, above the arena action; short so it never hides an attacking boss
    const y = 62;
    const band = this.add.rectangle(GAME_W / 2, y, GAME_W, 50, C.ink, 0.85);
    const lineT = this.add.rectangle(GAME_W / 2, y - 25, GAME_W, 1, C.crimson);
    const lineB = this.add.rectangle(GAME_W / 2, y + 25, GAME_W, 1, C.crimson);
    const title = txt(this, GAME_W / 2, y - 4, '', 24, '#ffeec2');
    const sub = txt(this, GAME_W / 2, y + 17, BOSS_TITLES[name] ?? '', 8, '#e0443e').setAlpha(0);
    const skullL = this.add.image(0, y - 4, 'ui-skull').setTint(C.red).setAlpha(0);
    const skullR = this.add.image(0, y - 4, 'ui-skull').setTint(C.red).setAlpha(0);
    const all = [band, lineT, lineB, title, sub, skullL, skullR];
    all.forEach((o) => o.setDepth(60));
    band.setScale(1, 0);
    lineT.setScale(0, 1);
    lineB.setScale(0, 1);
    this.tweens.add({ targets: band, scaleY: 1, duration: 200, ease: 'Quad.out' });
    this.tweens.add({ targets: [lineT, lineB], scaleX: 1, duration: 350, ease: 'Quad.out' });
    // letters type in
    let i = 0;
    const full = name;
    title.setText(full);
    const finalW = title.width;
    title.setText('');
    this.time.addEvent({
      delay: 45,
      repeat: full.length - 1,
      startAt: 0,
      callback: () => {
        i++;
        title.setText(full.slice(0, i));
        if (i === full.length) {
          skullL.setX(Math.round(GAME_W / 2 - finalW / 2 - 16));
          skullR.setX(Math.round(GAME_W / 2 + finalW / 2 + 15));
          this.tweens.add({ targets: [sub, skullL, skullR], alpha: 1, duration: 250 });
          // pulse the band edges instead of a full-screen flash (photosensitivity)
          this.tweens.add({ targets: [lineT, lineB], scaleY: 3, yoyo: true, duration: 90, repeat: 1 });
        }
      },
    });
    this.time.delayedCall(1700, () => {
      this.tweens.add({
        targets: all,
        alpha: 0,
        duration: 400,
        onComplete: () => all.forEach((o) => o.destroy()),
      });
    });
  }

  // ------------------------------------------------------------ letterbox (cinematics)
  private letterbox: Phaser.GameObjects.Rectangle[] = [];
  private setLetterbox(on: boolean): void {
    if (!this.letterbox.length) {
      // under the boss name card (60), over the HUD and toasts
      this.letterbox = [-1, 1].map((d) =>
        this.add
          .rectangle(0, d < 0 ? 0 : GAME_H, GAME_W, LETTERBOX_H, C.ink)
          .setOrigin(0, d < 0 ? 0 : 1)
          .setDepth(55)
          .setScale(1, 0),
      );
    }
    this.tweens.killTweensOf(this.letterbox);
    this.tweens.add({ targets: this.letterbox, scaleY: on ? 1 : 0, duration: on ? 220 : 280, ease: on ? 'Quad.out' : 'Quad.in' });
  }

  // ------------------------------------------------------------ sign
  private setSign(text: string | null): void {
    if (!text) {
      if (this.signBox.visible) {
        this.tweens.add({
          targets: this.signBox,
          alpha: 0,
          duration: 120,
          onComplete: () => this.signBox.setVisible(false),
        });
      }
      this.signFull = '';
      return;
    }
    this.signFull = text;
    this.signPos = 0;
    this.signAcc = 0;
    this.signText.setText('');
    this.signArrow.setVisible(false);
    this.tweens.killTweensOf(this.signBox);
    this.signBox.setVisible(true).setAlpha(0).setY(SIGN_Y - 6);
    this.tweens.add({ targets: this.signBox, alpha: 1, y: SIGN_Y, duration: 160, ease: 'Quad.out', onUpdate: () => (this.signBox.y = Math.round(this.signBox.y)) });
  }

  private tickSign(dt: number): void {
    if (!this.signFull || this.signPos >= this.signFull.length) return;
    this.signAcc += dt;
    while (this.signAcc >= 16 && this.signPos < this.signFull.length) {
      this.signAcc -= 16;
      this.signPos++;
    }
    this.signText.setText(this.signFull.slice(0, this.signPos));
    if (this.signPos >= this.signFull.length) this.signArrow.setVisible(true);
  }

  // ------------------------------------------------------------ toast
  private toast(text: string): void {
    const label = txt(this, 0, -1, text, 9, '#ffeec2');
    const w = Math.round(label.width) + 30;
    const bg = panel(this, 0, 0, w, 19, 'gold');
    const sh = this.add.image(-w / 2 + 9, 0, 'ui-spark', 0).setTint(C.gold);
    const sh2 = this.add.image(w / 2 - 9, 0, 'ui-spark', 0).setTint(C.gold);
    const slot = this.toasts.length;
    const ty = 44 + slot * 22;
    const c = this.add.container(GAME_W / 2, -16, [bg, label, sh, sh2]).setDepth(50);
    this.toasts.push(c);
    this.tweens.add({ targets: c, y: ty, duration: 300, ease: 'Back.out', onUpdate: () => (c.y = Math.round(c.y)) });
    this.time.delayedCall(320, () => sparkBurst(this, GAME_W / 2, ty, C.gold, 10, w / 2));
    this.tweens.add({
      targets: c,
      alpha: 0,
      y: ty - 8,
      delay: 3000,
      duration: 350,
      onComplete: () => {
        c.destroy();
        this.toasts = this.toasts.filter((t) => t !== c);
      },
    });
  }

  update(time: number, dt: number): void {
    // stamina fail flash
    if (this.stamFlash > 0) {
      this.stamFlash -= dt;
      const on = Math.floor(this.stamFlash / 60) % 2 === 1;
      this.stam.fill.setFillStyle(on ? C.red : C.leaf);
      this.stam.frame.setTint(on ? 0xff6a6a : 0xffffff);
      this.stam.place(40 + (on ? 1 : 0), this.stam.y);
      this.bolt.setFrame(on ? 1 : 0);
    } else if (this.stamFlash > -1000) {
      this.stamFlash = -1000;
      this.stam.fill.setFillStyle(C.leaf);
      this.stam.frame.clearTint();
      this.stam.place(40, this.stam.y);
      this.bolt.setFrame(0);
    }
    // charge meter under the stamina bar
    const inner = this.stam.w - 6;
    this.charge.width = Math.round(inner * this.chargeP);
    this.charge.setFillStyle(this.chargeP >= 1 ? (Math.floor(time / 70) % 2 ? 0xffffff : C.gold) : C.amber);
    this.tickShards(dt);
    this.tickSign(dt);
    // ERRATUM glitch: the HUD camera jitters in whole pixels
    const cam = this.cameras.main;
    if (time < this.glitchUntil) cam.setScroll(Phaser.Math.Between(-3, 3), Phaser.Math.Between(-2, 2));
    else if (cam.scrollX !== 0 || cam.scrollY !== 0) cam.setScroll(0, 0);
  }
}
