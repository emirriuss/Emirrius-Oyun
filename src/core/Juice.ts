import Phaser from 'phaser';
import { save } from '../systems/SaveSystem';
import { txt } from '../ui/text';
import { JUICE, type ImpactKind } from '../config';
import { CapPool, SLOWMO_IDLE, stepDebris, type Debris, kickEnvelope, mergeSlowmo, punchEnvelope, resolveImpact, slowmoScaleAt, timeScales, type SlowmoState } from './juiceMath';

import { TILE } from '../config';
import { GIB_KEY, registerGibArt } from '../art/fx';
import { setMuffle } from '../systems/music';

/** One simulated debris object (corpse or gib). */
interface DebrisItem {
  d: Debris;
  obj: Phaser.GameObjects.Image | Phaser.GameObjects.Sprite;
  gravity: number;
  age: number;
  /** ms; 0 = lives until released by its owner */
  life: number;
  fadeMs: number;
  onContact?: (ev: 'bounce' | 'settle', it: DebrisItem) => void;
  onTick?: (it: DebrisItem) => void;
  gib: boolean;
}

type Vibration = { playEffect?: (type: string, params: Record<string, number>) => Promise<unknown> };

/**
 * Game-feel helpers: hitstop, slowmo, shake/punch/kick, rumble, flash, particles, floating text,
 * pixel VFX sprites. One instance per GameScene run; it hooks the scene's update/shutdown events.
 * All timing is real time (scene.time.now is the unscaled loop clock), so slowmo never stretches
 * hitstop, punch or kick.
 */
export class Juice {
  private stopUntil = 0;
  /** true while the physics world is paused by hitstop (so we only resume what we paused) */
  private worldPausedByUs = false;
  private slow: SlowmoState = SLOWMO_IDLE;
  private appliedScale = 1;
  private punchState = { amount: 0, start: 0, end: 0, base: 1 };
  private kickState = { dx: 0, dy: 0, start: 0, end: 0 };
  /** integer scroll offset currently added to the camera by kick */
  private kickApplied = { x: 0, y: 0 };
  particles: Phaser.GameObjects.Particles.ParticleEmitter;
  /** real time of the last enemy kill (for 'cleared a group' big kills) */
  lastKillAt = -1e9;
  private debris: DebrisItem[] = [];
  private gibPool: CapPool<DebrisItem>;

  constructor(private scene: Phaser.Scene) {
    this.particles = scene.add.particles(0, 0, scene.textures.exists('fx-px') ? 'fx-px' : 'px', {
      speed: { min: 40, max: 160 },
      lifespan: { min: 200, max: 450 },
      scale: { start: 1.2, end: 0 },
      gravityY: 400,
      emitting: false,
    });
    this.particles.setDepth(50);
    if (!scene.textures.exists(GIB_KEY)) registerGibArt(scene);
    this.gibPool = new CapPool<DebrisItem>(JUICE.gibs.cap, () => ({
      d: { x: 0, y: 0, vx: 0, vy: 0, rot: 0, spin: 0, halfH: 1, bounces: 0, maxBounces: 2, restitution: 0.4, friction: 0.6, settled: false },
      obj: scene.add.image(0, 0, GIB_KEY, 0).setDepth(47).setVisible(false),
      gravity: JUICE.gibs.gravity,
      age: 0,
      life: JUICE.gibs.lifeMs,
      fadeMs: JUICE.gibs.fadeMs,
      gib: true,
    }));
    const ev = scene.events;
    const cam = scene.cameras.main;
    ev.on(Phaser.Scenes.Events.PRE_UPDATE, this.removeKick, this);
    ev.on(Phaser.Scenes.Events.UPDATE, this.update, this);
    ev.on(Phaser.Scenes.Events.POST_UPDATE, this.postUpdate, this);
    ev.on(Phaser.Scenes.Events.PAUSE, this.onPause, this);
    cam.on(Phaser.Cameras.Scene2D.Events.FOLLOW_UPDATE, this.applyKick, this);
    ev.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.reset();
      // scene objects are destroyed with the scene: just drop the bookkeeping
      this.debris = [];
      this.gibPool.clear();
      // leaving the level (game over, level exit, restart, quit) restores the music
      setMuffle('lowhp', false);
      ev.off(Phaser.Scenes.Events.PRE_UPDATE, this.removeKick, this);
      ev.off(Phaser.Scenes.Events.UPDATE, this.update, this);
      ev.off(Phaser.Scenes.Events.POST_UPDATE, this.postUpdate, this);
      ev.off(Phaser.Scenes.Events.PAUSE, this.onPause, this);
      cam.off(Phaser.Cameras.Scene2D.Events.FOLLOW_UPDATE, this.applyKick, this);
    });
  }

  private get now(): number {
    return this.scene.time.now;
  }

  /** True while hitstop is active; entities skip their update. */
  get frozen(): boolean {
    return this.now < this.stopUntil;
  }

  /** Current slowmo factor (1 = normal speed, 0.3 = 30% speed). Hitstop is not included. */
  get timeScale(): number {
    return this.appliedScale;
  }

  /** Freezes physics and entity updates for `ms` real ms. Overlapping calls keep the later end. */
  hitstop(ms: number): void {
    if (ms <= 0) return;
    const world = this.scene.physics.world;
    this.stopUntil = Math.max(this.stopUntil, this.now + ms);
    if (!world.isPaused) {
      world.pause();
      this.worldPausedByUs = true;
    }
  }

  /**
   * Slow motion: scales the scene clock, tweens, animations and Arcade physics by `scale`
   * (0.3 = 30% speed) for `ms` real ms, holding then easing back to exactly 1. Overlapping calls keep
   * the stronger scale and the later end. Cleared on scene pause and shutdown. Entity logic driven by
   * time.now / dt is NOT slowed (only physics motion, timers, tweens and anims are).
   */
  slowmo(scale: number, ms: number): void {
    this.slow = mergeSlowmo(this.slow, this.now, scale, ms);
    this.applyScale(slowmoScaleAt(this.slow, this.now));
  }

  /** Camera shake. No-op when the Screen shake setting is off. */
  shake(intensity: number, ms = 120): void {
    if (!save.data.settings.shake) return;
    this.scene.cameras.main.shake(ms, intensity);
  }

  /**
   * Quick camera zoom-in by `zoom` (0.06 = +6%) that eases back to the base zoom over `ms` real ms.
   * A new punch replaces a weaker running one. No-op when Screen shake is off.
   */
  punch(zoom = 0.06, ms = 140): void {
    if (!save.data.settings.shake || zoom <= 0 || ms <= 0) return;
    const p = this.punchState;
    const now = this.now;
    const running = now < p.end;
    if (running && p.amount * punchEnvelope((now - p.start) / (p.end - p.start)) > zoom) return;
    if (!running) p.base = this.scene.cameras.main.zoom;
    Object.assign(p, { amount: zoom, start: now, end: now + ms });
  }

  /** Ends a running zoom punch at its base zoom (before a scripted camera move takes the zoom over). */
  settleZoom(): void {
    const p = this.punchState;
    if (p.end <= 0) return;
    this.scene.cameras.main.setZoom(p.base);
    p.end = 0;
  }

  /**
   * Directional camera nudge of (dx, dy) px that springs back over `ms` real ms. It is added on top of
   * the camera's follow/scroll after follow runs (and removed before the next frame), so it composes
   * with GameScene's followOffset look-ahead and doesn't upset the deadzone. No-op when Screen shake is off.
   */
  kick(dx: number, dy: number, ms = 90): void {
    if (!save.data.settings.shake || ms <= 0) return;
    Object.assign(this.kickState, { dx, dy, start: this.now, end: this.now + ms });
  }

  /**
   * Gamepad rumble on pad1 ('dual-rumble'); weak/strong are motor magnitudes 0..1.
   * No-op without a pad / vibration support, or when the Rumble setting is off.
   */
  rumble(weak: number, strong: number, ms: number): void {
    if (!save.data.settings.rumble || ms <= 0 || (weak <= 0 && strong <= 0)) return;
    try {
      let act = this.scene.input.gamepad?.pad1?.vibration as Vibration | undefined | null;
      if (!act?.playEffect && typeof navigator !== 'undefined' && navigator.getGamepads) {
        const pad = Array.from(navigator.getGamepads()).find((g) => g?.connected && (g as unknown as { vibrationActuator?: Vibration }).vibrationActuator);
        act = (pad as unknown as { vibrationActuator?: Vibration } | undefined)?.vibrationActuator;
      }
      if (!act?.playEffect) return;
      const c = (v: number) => Math.min(1, Math.max(0, v));
      void act.playEffect('dual-rumble', { startDelay: 0, duration: Math.round(ms), weakMagnitude: c(weak), strongMagnitude: c(strong) })?.catch?.(() => undefined);
    } catch {
      /* unsupported */
    }
  }

  /**
   * Preset impact (JUICE.impact[kind]): hitstop, shake, punch, kick along `angle` (radians, 0 = right),
   * spark, rumble and slowmo in one call. `mul` scales intensities (clamped, see resolveImpact).
   */
  impact(kind: ImpactKind, x: number, y: number, angle = 0, mul = 1): void {
    const r = resolveImpact(JUICE.impact[kind], mul);
    if (r.hitstop > 0) this.hitstop(r.hitstop);
    if (r.shake > 0) this.shake(r.shake, r.shakeMs);
    if (r.punch > 0) this.punch(r.punch);
    if (r.kick > 0) this.kick(Math.cos(angle) * r.kick, Math.sin(angle) * r.kick);
    if (r.spark > 0) this.spark(x, y, angle, 0xffffff, r.spark);
    if (r.rumbleMs > 0) this.rumble(r.rumbleWeak, r.rumbleStrong, r.rumbleMs);
    if (r.slowmoMs > 0) this.slowmo(r.slowmo, r.slowmoMs);
  }

  // ---------------------------------------------------------------- per-frame

  private update(_time: number, delta: number): void {
    const now = this.now;
    if (!this.frozen && this.debris.length) this.updateDebris(Math.min(delta, 50) * this.appliedScale);
    // hitstop release (real time, unaffected by slowmo)
    const world = this.scene.physics.world;
    if (this.worldPausedByUs && now >= this.stopUntil) {
      this.worldPausedByUs = false;
      if (world.isPaused) world.resume();
    }
    // slowmo
    if (this.appliedScale !== 1 || now < this.slow.end) this.applyScale(slowmoScaleAt(this.slow, now));
    // punch
    const p = this.punchState;
    if (p.end > 0) {
      const cam = this.scene.cameras.main;
      if (now >= p.end) {
        cam.setZoom(p.base);
        p.end = 0;
      } else cam.setZoom(p.base * (1 + p.amount * punchEnvelope((now - p.start) / (p.end - p.start))));
    }
  }

  private applyScale(scale: number): void {
    if (scale === this.appliedScale) return;
    this.appliedScale = scale;
    const t = timeScales(scale);
    this.scene.time.timeScale = t.clock;
    this.scene.tweens.timeScale = t.tweens;
    this.scene.anims.globalTimeScale = t.anims;
    this.scene.physics.world.timeScale = t.physics;
  }

  private kickOffset(): { x: number; y: number } {
    const k = this.kickState;
    const now = this.now;
    if (now >= k.end) return { x: 0, y: 0 };
    const e = kickEnvelope((now - k.start) / (k.end - k.start));
    return { x: Math.round(k.dx * e), y: Math.round(k.dy * e) };
  }

  /** Adds the kick offset on top of the scroll the camera just computed (integer px, clamped to bounds). */
  private applyKick(): void {
    const cam = this.scene.cameras.main;
    this.removeKick();
    const o = this.kickOffset();
    if (!o.x && !o.y) return;
    const sx = cam.clampX(cam.scrollX + o.x);
    const sy = cam.clampY(cam.scrollY + o.y);
    this.kickApplied = { x: sx - cam.scrollX, y: sy - cam.scrollY };
    cam.scrollX = sx;
    cam.scrollY = sy;
  }

  /** Takes the kick offset back out so camera follow/deadzone see the real scroll. */
  private removeKick(): void {
    const a = this.kickApplied;
    if (!a.x && !a.y) return;
    this.kickApplied = { x: 0, y: 0 };
    const cam = this.scene.cameras.main;
    if (!cam) return; // camera already torn down (scene shutdown)
    cam.scrollX -= a.x;
    cam.scrollY -= a.y;
  }

  /** Cameras that don't follow never emit FOLLOW_UPDATE: apply the kick here instead. */
  private postUpdate(): void {
    if (this.scene.cameras.main && !(this.scene.cameras.main as unknown as { _follow: unknown })._follow) this.applyKick();
  }

  private onPause(): void {
    // slowmo is real-time: drop it rather than have it end (or stick) across the pause
    this.slow = SLOWMO_IDLE;
    this.applyScale(1);
  }

  /** Restores every time scale, the camera zoom/scroll and a hitstop-paused world. */
  reset(): void {
    this.slow = SLOWMO_IDLE;
    this.appliedScale = 1;
    // set unconditionally: a restarted scene keeps its Clock / World time scales
    const t = timeScales(1);
    this.scene.time.timeScale = t.clock;
    this.scene.tweens.timeScale = t.tweens;
    this.scene.anims.globalTimeScale = t.anims;
    const world = this.scene.physics.world;
    if (world) {
      world.timeScale = t.physics;
      if (this.worldPausedByUs && world.isPaused) world.resume();
    }
    this.worldPausedByUs = false;
    this.stopUntil = 0;
    this.removeKick();
    this.kickState.end = 0;
    if (this.punchState.end > 0) this.scene.cameras.main?.setZoom(this.punchState.base);
    this.punchState.end = 0;
  }

  flash(target: Phaser.GameObjects.Sprite, ms = 70, color = 0xffffff): void {
    target.setTintFill(color);
    this.scene.time.delayedCall(ms, () => target.active && target.clearTint());
  }

  burst(x: number, y: number, color: number, count = 10, speed = 1): void {
    this.particles.setParticleTint(color);
    this.particles.setParticleSpeed(40 * speed, 160 * speed);
    this.particles.explode(count, x, y);
  }

  // ---------------------------------------------------------------- debris: corpses & gibs

  private solidAt = (x: number, y: number): boolean => {
    const s = this.scene as unknown as { isSolidAt?: (x: number, y: number) => boolean };
    return s.isSolidAt ? s.isSolidAt(x, y) : false;
  };

  /**
   * Simulates `obj` as tumbling debris (gravity, spin, wall/floor bounces against the level tiles)
   * until `release(obj)`-style removal via the returned handle. Paused by hitstop, slowed by slowmo.
   */
  addDebris(
    obj: Phaser.GameObjects.Image | Phaser.GameObjects.Sprite,
    d: Omit<Debris, 'bounces' | 'settled' | 'rot'>,
    o: { gravity: number; onContact?: DebrisItem['onContact']; onTick?: DebrisItem['onTick'] },
  ): { remove: () => void; age: () => number } {
    const it: DebrisItem = { d: { ...d, rot: obj.rotation, bounces: 0, settled: false }, obj, gravity: o.gravity, age: 0, life: 0, fadeMs: 0, onContact: o.onContact, onTick: o.onTick, gib: false };
    this.debris.push(it);
    return { remove: () => this.removeDebris(it), age: () => it.age };
  }

  private removeDebris(it: DebrisItem): void {
    const i = this.debris.indexOf(it);
    if (i >= 0) this.debris.splice(i, 1);
  }

  /**
   * Bursts `count` pixel chunks tinted `tint` from (x, y), biased along dirX (-1/0/1). Pooled and capped
   * at JUICE.gibs.cap (the oldest chunks are recycled); they bounce, settle and fade after lifeMs.
   */
  gibs(x: number, y: number, tint: number, count: number, dirX = 0, speedMul = 1): void {
    const G = JUICE.gibs;
    for (let i = 0; i < count; i++) {
      const [it, recycled] = this.gibPool.acquire();
      if (recycled) this.removeDebris(it);
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.2 + dirX * 0.5;
      const sp = G.speed * speedMul * (0.5 + Math.random() * 0.7);
      Object.assign(it.d, {
        x: x + (Math.random() - 0.5) * 8,
        y: y + (Math.random() - 0.5) * 6,
        vx: Math.cos(a) * sp + dirX * 40,
        vy: Math.sin(a) * sp,
        rot: 0,
        spin: (Math.random() - 0.5) * 24,
        halfH: 1,
        bounces: 0,
        maxBounces: 2,
        restitution: 0.4,
        friction: 0.6,
        settled: false,
      });
      it.age = 0;
      it.life = G.lifeMs * (0.85 + Math.random() * 0.3);
      // a few shades of the tint so chunks read as separate pieces
      const shade = 0.75 + Math.random() * 0.25;
      const r = ((tint >> 16) & 0xff) * shade, g = ((tint >> 8) & 0xff) * shade, b = (tint & 0xff) * shade;
      (it.obj as Phaser.GameObjects.Image)
        .setFrame(Math.floor(Math.random() * 4))
        .setTint((Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(b))
        .setPosition(Math.round(it.d.x), Math.round(it.d.y))
        .setRotation(0)
        .setAlpha(1)
        .setVisible(true)
        .setActive(true);
      this.debris.push(it);
    }
  }

  private updateDebris(dt: number): void {
    for (const it of [...this.debris]) {
      if (!it.obj.active && !it.gib) {
        this.removeDebris(it);
        continue;
      }
      it.age += dt;
      const ev = stepDebris(it.d, dt, it.gravity, this.solidAt, TILE);
      it.obj.setPosition(Math.round(it.d.x), Math.round(it.d.y));
      // gibs snap rotation to 90deg steps (stay pixel-crisp); corpses rotate smoothly
      it.obj.setRotation(it.gib ? Math.round(it.d.rot / (Math.PI / 2)) * (Math.PI / 2) : it.d.rot);
      if (ev) it.onContact?.(ev, it);
      it.onTick?.(it);
      if (it.gib) {
        const left = it.life - it.age;
        if (left <= 0 || it.d.y > this.scene.physics.world.bounds.bottom + 32) {
          it.obj.setVisible(false).setActive(false);
          this.removeDebris(it);
          this.gibPool.release(it);
        } else if (left < it.fadeMs) it.obj.setAlpha(left / it.fadeMs);
      }
    }
  }

  /** Live gib count (for debugging / tests in the browser). */
  get gibCount(): number {
    return this.gibPool.live.length;
  }

  ring(x: number, y: number, color = 0xffffff, scale = 1): void {
    const r = this.scene.add.image(x, y, 'ring').setTint(color).setScale(0.2).setDepth(49);
    this.scene.tweens.add({ targets: r, scale, alpha: 0, duration: 250, onComplete: () => r.destroy() });
  }

  /** Plays a one-shot animation sprite and destroys it when done. */
  private oneShot(key: string, x: number, y: number, depth = 51): Phaser.GameObjects.Sprite | null {
    if (!this.scene.anims.exists(key)) return null;
    const s = this.scene.add.sprite(Math.round(x), Math.round(y), key).setDepth(depth);
    s.play(key);
    s.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => s.destroy());
    return s;
  }

  /**
   * Directional hit spark. Angle is snapped to 8 directions (straight / diagonal
   * sheets rotated by multiples of 90deg, so pixels stay crisp).
   */
  spark(x: number, y: number, angle: number, color = 0xffffff, scale = 1): void {
    const i = ((Math.round(angle / (Math.PI / 4)) % 8) + 8) % 8;
    const s = this.oneShot(i % 2 ? 'fx-spark-d' : 'fx-spark', x, y);
    if (!s) return;
    s.setAngle(Math.floor(i / 2) * 90).setTint(color).setScale(scale).setBlendMode(Phaser.BlendModes.ADD);
    // a second, untinted core keeps the centre white for coloured sparks
    if (color !== 0xffffff) {
      const c = this.oneShot(i % 2 ? 'fx-spark-d' : 'fx-spark', x, y);
      c?.setAngle(Math.floor(i / 2) * 90).setScale(scale * 0.6).setBlendMode(Phaser.BlendModes.ADD);
    }
  }

  /** White star + ring for a successful parry. */
  parryFlash(x: number, y: number): void {
    this.oneShot('fx-parry', x, y, 52)?.setBlendMode(Phaser.BlendModes.ADD);
  }

  /**
   * Dust puffs at a feet position. dir = 0 spreads puffs both ways, otherwise they drift that way.
   */
  dust(x: number, y: number, count = 3, speed = 0.4, dir = 0, color = 0xd8d0c4): void {
    if (!this.scene.anims.exists('fx-dust')) {
      this.burst(x, y, color, count, speed);
      return;
    }
    const n = Math.max(1, Math.min(6, Math.ceil(count / 2)));
    for (let i = 0; i < n; i++) {
      const d = dir || (i % 2 ? 1 : -1);
      const s = this.scene.add.sprite(Math.round(x + d * (2 + i * 2)), Math.round(y - 4), 'fx-dust').setDepth(19).setTint(color);
      s.setFlipX(d < 0).setAlpha(0.9).setScale(0.7 + Math.min(1, speed) * 0.5);
      s.play({ key: 'fx-dust', frameRate: 14 + Math.random() * 6 });
      this.scene.tweens.add({ targets: s, x: s.x + d * (6 + speed * 22 + i * 3), y: s.y - 2 - Math.random() * 3, duration: 380, ease: 'Quad.out' });
      s.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => s.destroy());
    }
  }

  floatText(x: number, y: number, text: string, color = '#ffffff'): void {
    const heavy = color.toLowerCase() === '#ffd166' || color.toLowerCase() === '#ffe066';
    const t = txt(this.scene, x, y, text, heavy ? 14 : 10, color).setDepth(60);
    const base = t.scaleX;
    t.setScale(base * (heavy ? 1.8 : 1.6));
    this.scene.tweens.add({ targets: t, scale: base, duration: 120, ease: 'Back.out' });
    this.scene.tweens.add({ targets: t, y: y - (heavy ? 22 : 18), duration: 650, ease: 'Cubic.out' });
    this.scene.tweens.add({ targets: t, alpha: 0, delay: 380, duration: 270, onComplete: () => t.destroy() });
  }
}
