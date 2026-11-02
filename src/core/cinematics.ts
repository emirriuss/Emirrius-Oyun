import Phaser from 'phaser';
import { bus } from './events';
import { sfx } from '../systems/sfx';
import { duckMusic, setMuffle } from '../systems/music';
import { raysTexture, sparkBurst } from '../ui/Panel';
import { C } from '../art/palette';
import type { GameScene } from '../scenes/GameScene';
import type { Enemy } from '../entities/Enemy';

/**
 * Short scripted camera moments in GameScene: boss intro, boss death, stage clear.
 * They drive the camera / HUD letterbox ('letterbox' bus event) and use GameScene.cinematic
 * to hold the player still. All waits are scene-time; real-time camera effects (pan/zoom/flash)
 * aren't affected by Juice.slowmo.
 */

export const CINE = {
  /** boss intro: pan to the boss, hold on it (name card shows on arrival), pan back */
  introPanMs: 520,
  introHoldMs: 760,
  introBackMs: 380,
  introZoom: 0.16,
  /** presses earlier than this don't skip (a held attack from before the arena) */
  introSkipAfterMs: 250,
  /** after a skip the boss stays idle this much longer so the player can get set */
  introSkipBossGraceMs: 800,
  /** boss death: zoom punch toward the boss (real ms) */
  deathPunch: 0.14,
  deathPunchMs: 900,
  /** stage clear: pose freeze before the beam-out */
  clearFreezeMs: 380,
};

type IntroBoss = Enemy & { bossName: string; endIntro(ms: number): void };

/** Camera target that makes startFollow's snap land exactly where we are. */
function followPoint(gs: GameScene): { x: number; y: number } {
  const cam = gs.cameras.main;
  return { x: gs.player.x - cam.followOffset.x, y: gs.player.y - cam.followOffset.y };
}

/**
 * Boss intro: letterbox in, music muffled, player held, camera pans + zooms to the boss, roar and
 * name card on arrival, then pans back and hands control over. Attack / Jump skips.
 */
export function bossIntro(gs: GameScene, boss: IntroBoss): void {
  const cam = gs.cameras.main;
  const baseZoom = cam.zoom;
  const t0 = gs.time.now;
  let cardShown = false;
  let done = false;
  let backing = false;
  const timers: Phaser.Time.TimerEvent[] = [];

  gs.setCinematic(true);
  bus.emit('letterbox', true);
  setMuffle('cine', true, 520);
  cam.stopFollow();
  cam.pan(boss.x, boss.y - 10, CINE.introPanMs, 'Sine.easeInOut', true);
  cam.zoomTo(baseZoom * (1 + CINE.introZoom), CINE.introPanMs, 'Sine.easeInOut', true);

  const showCard = () => {
    if (cardShown) return;
    cardShown = true;
    sfx.bossRoar();
    duckMusic(0.5, 600);
    gs.juice.shake(0.008, 500);
    gs.juice.rumble(0.4, 0.6, 350);
    bus.emit('boss-intro', boss.bossName);
  };

  const finish = () => {
    if (done) return;
    done = true;
    cleanup();
    cam.setZoom(baseZoom);
    // keep GameScene's look-ahead offset so startFollow's snap lands where the pan ended
    cam.startFollow(gs.player, true, 0.12, 0.12, cam.followOffset.x, cam.followOffset.y);
    gs.setCinematic(false);
    bus.emit('letterbox', false);
    setMuffle('cine', false);
  };

  const back = (ms: number) => {
    if (backing) return;
    backing = true;
    timers.forEach((t) => t.remove());
    const p = followPoint(gs);
    cam.pan(p.x, p.y, ms, 'Sine.easeInOut', true);
    cam.zoomTo(baseZoom, ms, 'Sine.easeInOut', true);
    timers.push(gs.time.delayedCall(ms + 20, finish));
  };

  timers.push(gs.time.delayedCall(CINE.introPanMs, showCard));
  timers.push(gs.time.delayedCall(CINE.introPanMs + CINE.introHoldMs, () => back(CINE.introBackMs)));

  const onUpdate = () => {
    if (done || backing) return;
    if (gs.time.now - t0 < CINE.introSkipAfterMs) return;
    if (gs.inp.justPressed('attack') || gs.inp.justPressed('jump')) {
      gs.inp.consume('attack');
      gs.inp.consume('jump');
      showCard();
      boss.endIntro(CINE.introSkipBossGraceMs);
      back(200);
    }
  };
  const onShutdown = () => {
    done = true;
    cleanup();
    setMuffle('cine', false);
  };
  function cleanup(): void {
    gs.events.off(Phaser.Scenes.Events.UPDATE, onUpdate);
    gs.events.off(Phaser.Scenes.Events.SHUTDOWN, onShutdown);
  }
  gs.events.on(Phaser.Scenes.Events.UPDATE, onUpdate);
  gs.events.once(Phaser.Scenes.Events.SHUTDOWN, onShutdown);
}

/**
 * Boss death beat, layered on Boss.die's killBig impact (hitstop + slowmo + shake): a longer zoom
 * punch and camera kick toward the boss, letterbox, then a white-out flash once the boss has
 * flickered out (its sprite is destroyed), then `reveal` (reward toast, exit portal).
 */
export function bossDeath(gs: GameScene, boss: Enemy, reveal: () => void): void {
  const cam = gs.cameras.main;
  bus.emit('letterbox', true);
  sfx.bossFall();
  gs.juice.punch(CINE.deathPunch, CINE.deathPunchMs);
  const dx = Phaser.Math.Clamp((boss.x - cam.midPoint.x) * 0.5, -16, 16);
  const dy = Phaser.Math.Clamp((boss.y - cam.midPoint.y) * 0.5, -10, 10);
  gs.juice.kick(Math.round(dx), Math.round(dy), 700);
  let fired = false;
  const whiteOut = () => {
    if (fired || !gs.sys.isActive()) return;
    fired = true;
    cam.flash(480, 255, 250, 235, true);
    gs.juice.burst(boss.x, boss.y, 0xffffff, 16, 1.6);
    sfx.victory();
    gs.time.delayedCall(260, reveal);
    gs.time.delayedCall(900, () => bus.emit('letterbox', false));
  };
  if (!boss.active) whiteOut();
  // the boss is also destroyed on scene shutdown: don't schedule into a restarting scene's clock
  else boss.once(Phaser.GameObjects.Events.DESTROY, () => gs.sys.isActive() && gs.time.delayedCall(60, whiteOut));
}

/**
 * Stage-clear flourish: everything freezes on the player's pose, a radial ray burst and chime,
 * then `then` runs (the beam-out + scene switch).
 */
export function stageClear(gs: GameScene, then: () => void): void {
  const p = gs.player;
  p.body.setVelocity(0, 0);
  p.body.setAllowGravity(false);
  p.anims.pause();
  gs.juice.hitstop(CINE.clearFreezeMs);
  gs.juice.flash(p, 90, 0xffffff);
  gs.juice.punch(0.07, 420);
  duckMusic(0.6, 900);
  sfx.clearChime();
  const rays = gs.add.image(p.x, p.y - 4, raysTexture(gs)).setDepth(45).setTint(C.gold).setBlendMode(Phaser.BlendModes.ADD).setScale(0.1).setAlpha(0.9);
  gs.tweens.add({ targets: rays, scale: 2.4, angle: 50, alpha: 0, duration: 650, ease: 'Quad.out', onComplete: () => rays.destroy() });
  gs.juice.ring(p.x, p.y - 4, C.gold, 3);
  sparkBurst(gs, p.x, p.y - 4, C.gold, 16, 34, 46);
  gs.time.delayedCall(CINE.clearFreezeMs, then);
}

/** One timed step of a phase cinematic (ms from its start). Visual / audio work only. */
export interface CineBeat {
  at: number;
  run: () => void;
}

export interface PhaseCineScript {
  beats: CineBeat[];
  /**
   * The state change (arena, props, boss form). Runs once, at `commitAt` or immediately when skipped,
   * so it must leave everything in its final state on its own: a skip never leaves a half-built arena.
   */
  commit: () => void;
  commitAt: number;
  /** total length (ms); the camera starts pulling back `backMs` before it */
  length: number;
  backMs?: number;
  /** opening camera move: pan + zoom relative to the zoom it found */
  shot?: { x: number; y: number; zoom: number; ms: number };
  /** muffle the music while it plays (default true; scripts that stop the music can turn it off) */
  muffle?: boolean;
  /** removes transient beat visuals when skipped */
  cleanup?: () => void;
  /** runs once at the end (or after a skip): hand the fight back, e.g. restart the music */
  done?: () => void;
}

/** presses earlier than this don't skip a phase cinematic (the hit that triggered it) */
const PHASE_SKIP_AFTER_MS = 400;

/**
 * Long, skippable phase-change cinematic: letterbox, player held, camera shot, timed beats, then one
 * `commit` that rebuilds the arena and a pan back to the player. Attack / Jump skips: pending beats are
 * dropped, `commit` runs if it hasn't, `cleanup` clears beat visuals and the camera snaps back.
 */
export function phaseCinematic(gs: GameScene, script: PhaseCineScript): { readonly running: boolean; skip(): void } {
  const cam = gs.cameras.main;
  // GameScene always rests at zoom 1. Reading cam.zoom here could capture the phase hit's zoom punch
  // (still running) or another camera move mid-way, and the fight would stay zoomed after the cinematic.
  gs.juice.settleZoom();
  const baseZoom = 1;
  const t0 = gs.time.now;
  const backMs = script.backMs ?? 600;
  const muffle = script.muffle !== false;
  const timers: Phaser.Time.TimerEvent[] = [];
  let committed = false;
  let backing = false;
  let done = false;

  gs.setCinematic(true);
  bus.emit('letterbox', true);
  if (muffle) setMuffle('cine', true, 520);
  cam.stopFollow();
  if (script.shot) {
    cam.pan(script.shot.x, script.shot.y, script.shot.ms, 'Sine.easeInOut', true);
    cam.zoomTo(baseZoom * script.shot.zoom, script.shot.ms, 'Sine.easeInOut', true);
  }

  const commit = () => {
    if (committed) return;
    committed = true;
    script.commit();
  };

  const finish = () => {
    if (done) return;
    done = true;
    cleanupListeners();
    cam.setZoom(baseZoom);
    cam.startFollow(gs.player, true, 0.12, 0.12, cam.followOffset.x, cam.followOffset.y);
    gs.setCinematic(false);
    bus.emit('letterbox', false);
    if (muffle) setMuffle('cine', false);
    script.done?.();
  };

  const back = (ms: number) => {
    if (backing) return;
    backing = true;
    const p = followPoint(gs);
    cam.pan(p.x, p.y, ms, 'Sine.easeInOut', true);
    cam.zoomTo(baseZoom, ms, 'Sine.easeInOut', true);
    timers.push(gs.time.delayedCall(ms + 20, finish));
  };

  for (const b of script.beats) timers.push(gs.time.delayedCall(b.at, b.run));
  timers.push(gs.time.delayedCall(script.commitAt, commit));
  timers.push(gs.time.delayedCall(Math.max(script.commitAt, script.length - backMs), () => back(backMs)));

  const skip = () => {
    if (done || backing) return;
    timers.forEach((t) => t.remove());
    timers.length = 0;
    commit();
    script.cleanup?.();
    back(220);
  };

  const onUpdate = () => {
    if (done || backing) return;
    if (gs.time.now - t0 < PHASE_SKIP_AFTER_MS) return;
    if (gs.inp.justPressed('attack') || gs.inp.justPressed('jump')) {
      gs.inp.consume('attack');
      gs.inp.consume('jump');
      skip();
    }
  };
  const onShutdown = () => {
    done = true;
    cleanupListeners();
    cam.setZoom(baseZoom);
    if (muffle) setMuffle('cine', false);
  };
  function cleanupListeners(): void {
    gs.events.off(Phaser.Scenes.Events.UPDATE, onUpdate);
    gs.events.off(Phaser.Scenes.Events.SHUTDOWN, onShutdown);
  }
  gs.events.on(Phaser.Scenes.Events.UPDATE, onUpdate);
  gs.events.once(Phaser.Scenes.Events.SHUTDOWN, onShutdown);

  return {
    get running() {
      return !done;
    },
    skip,
  };
}
