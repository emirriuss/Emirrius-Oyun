// Central tunables. Units: pixels, pixels/sec, milliseconds.
import type { ImpactPreset } from './core/juiceMath';

/** Juice.impact kinds; presets live in JUICE.impact. */
export type ImpactKind = 'light' | 'heavy' | 'kill' | 'killBig' | 'parry' | 'bossHit' | 'land' | 'hurt' | 'slam' | 'crash' | 'explode';

export const GAME_W = 480;
export const GAME_H = 270;
export const TILE = 16;

export const PHYS = {
  gravity: 1400,
  maxFall: 520,
};

export const PLAYER = {
  runSpeed: 150,
  accelGround: 1800,
  accelAir: 1100,
  friction: 2200,
  jumpVel: 390,
  jumpCutMul: 0.45, // velocity multiplier when jump released early
  coyoteMs: 100,
  jumpBufferMs: 120,
  wallSlideMax: 70,
  // feel polish
  apexThreshold: 70, // |vy| below this near the jump apex => lighter gravity while jump held
  apexGravityMul: 0.5,
  fastFallGravity: 900, // extra gravity while holding down in the air
  fastFallMax: 680,
  cornerCorrectPx: 5, // nudge around ceiling corners when a jump clips them
  hurtMs: 220,
  hurtCancelMs: 130, // can dash/attack out of hurt after this

  wallJumpVelX: 190,
  wallJumpVelY: 360,
  wallJumpLockMs: 150,
  dashSpeed: 380,
  dashMs: 150,
  dashCooldownMs: 250,
  dashStamina: 25,
  maxStamina: 100,
  staminaRegen: 38, // per second
  maxHp: 5,
  hurtIframesMs: 900,
  dashIframes: true,
  // attacks
  comboWindowMs: 320, // time after an attack in which the next input chains
  attackMs: [200, 200, 300],
  attackDamage: [1, 1, 2],
  airAttackMs: 220,
  slamSpeed: 520,
  slamBounceVel: 400, // pogo launches straight up
  pogoFloatMs: 1000, // after a pogo, gravity is reduced for this long (hold down to cut it short)
  pogoGravityMul: 0.5,
  slamDamage: 1,
  slamSpeedX: 300, // diagonal dive: forward speed while slamming
  pogoRefreshMs: 220, // after a pogo, a new slam needs this long (falls back to an air attack)
  spikePogoSafeMs: 150, // spikes can't hurt you right after pogoing off them
  heavyChargeMs: 450,
  heavyDamage: 4,
  heavyStamina: 30,
  // parry = swinging into a parryable hit (no parry button)
  parryWindowMs: 110, // fresh, deliberate swing
  parryWindowChainMs: 50, // combo follow-up / mashing
  parryWindowHeavyMs: 180, // released charged heavy
  parryFreshGapMs: 250, // a swing this soon after the last one counts as chained
  parryStaminaRefund: 20,
  parrySpeedBuffMs: 500,
  parrySpeedBuffMul: 1.1,
  // movement during / out of attacks
  attackMoveMul: 0.6, // steering speed during ground combo swings
  chargeMoveMul: 0.4, // walking speed while charging a heavy
  runSlashSpeed: 200, // lunge speed of the running slash (attack at >= 80% run speed)
  cancelAfterMs: 80, // grounded/air swings can jump/dash-cancel after this (hitbox is out)
  airComboMs: 90, // second air swing may be buffered after this
  airComboChainMs: 150, // ...and comes out at this point of the first
  energySlashStamina: 45,
  energySlashStaminaL3: 35,
  energySlashCooldownMs: 700,
  energySlashLifeMs: 450,
};

export const JUICE = {
  hitstopLight: 55,
  hitstopHeavy: 110,
  shakeLight: 0.004,
  shakeHeavy: 0.01,
  /**
   * Juice.impact presets (see ImpactPreset in core/juiceMath.ts). hitstop/shake of light/heavy match the
   * values the call sites used before presets existed. spark = directional spark scale at the impact.
   * Rumble: light = weak/short, heavy/kill = medium, hurt = strong, parry = sharp & short,
   * slam/crash = long & low (strong motor), explode = medium.
   */
  impact: {
    light: { hitstop: 55, shake: 0.004, shakeMs: 120, punch: 0, kick: 2, spark: 1, rumbleWeak: 0.3, rumbleStrong: 0, rumbleMs: 40, slowmo: 1, slowmoMs: 0 },
    heavy: { hitstop: 110, shake: 0.01, shakeMs: 120, punch: 0.03, kick: 4, spark: 1.4, rumbleWeak: 0.45, rumbleStrong: 0.45, rumbleMs: 120, slowmo: 1, slowmoMs: 0 },
    kill: { hitstop: 70, shake: 0.006, shakeMs: 140, punch: 0.02, kick: 3, spark: 1.2, rumbleWeak: 0.4, rumbleStrong: 0.4, rumbleMs: 110, slowmo: 1, slowmoMs: 0 },
    // boss death: shake matches the old boss-defeated shake (Phaser ignores a 2nd shake while one runs)
    killBig: { hitstop: 250, shake: 0.015, shakeMs: 600, punch: 0.08, kick: 6, spark: 2, rumbleWeak: 0.6, rumbleStrong: 1, rumbleMs: 450, slowmo: 0.3, slowmoMs: 700 },
    parry: { hitstop: 110, shake: 0, shakeMs: 120, punch: 0.05, kick: 0, spark: 1, rumbleWeak: 0.9, rumbleStrong: 0.3, rumbleMs: 60, slowmo: 0.4, slowmoMs: 260 },
    bossHit: { hitstop: 70, shake: 0.006, shakeMs: 120, punch: 0.02, kick: 3, spark: 1.4, rumbleWeak: 0.3, rumbleStrong: 0.4, rumbleMs: 110, slowmo: 1, slowmoMs: 0 },
    land: { hitstop: 0, shake: 0.006, shakeMs: 120, punch: 0, kick: 3, spark: 0, rumbleWeak: 0.2, rumbleStrong: 0.35, rumbleMs: 90, slowmo: 1, slowmoMs: 0 },
    hurt: { hitstop: 110, shake: 0.01, shakeMs: 180, punch: 0, kick: 4, spark: 0, rumbleWeak: 0.6, rumbleStrong: 1, rumbleMs: 220, slowmo: 1, slowmoMs: 0 },
    // boss ground slams (Golem jump-slam, King drop)
    slam: { hitstop: 0, shake: 0.012, shakeMs: 250, punch: 0.02, kick: 4, spark: 0, rumbleWeak: 0.15, rumbleStrong: 0.75, rumbleMs: 380, slowmo: 1, slowmoMs: 0 },
    // Charger hitting a wall
    crash: { hitstop: 40, shake: 0.005, shakeMs: 150, punch: 0, kick: 3, spark: 1, rumbleWeak: 0.1, rumbleStrong: 0.55, rumbleMs: 280, slowmo: 1, slowmoMs: 0 },
    // bomb / explosive projectile (mul scaled by distance to the player)
    explode: { hitstop: 0, shake: 0.006, shakeMs: 150, punch: 0.015, kick: 2, spark: 0, rumbleWeak: 0.35, rumbleStrong: 0.6, rumbleMs: 180, slowmo: 1, slowmoMs: 0 },
  } satisfies Record<ImpactKind, ImpactPreset>,
  /** impact mul per ground combo step (1st..4th hit; air combo uses the first two) */
  comboMul: [1, 1.15, 1.3, 1.5],
  /** impact mul of a released charged heavy */
  chargedHeavyMul: 1.4,
  /** combo hit sound pitch rises by this per step */
  comboPitchStep: 0.07,
  /** last-enemy-on-screen kill is "big" only if another kill happened within this window (a cleared group) */
  bigKillGroupMs: 4000,
  /** victim squash on hit (scale, ms) and visual recoil away from the hit (px, ms); bosses use bossFeedbackMul */
  hitSquash: { light: 0.82, heavy: 0.7, ms: 140 },
  hitRecoil: { light: 2.5, heavy: 4, ms: 120 },
  bossFeedbackMul: 0.5,
  /** corpse launched along the killing blow: speeds px/s, spin rad/s, gravity, max airtime before it bursts */
  corpse: { speedX: 150, heavySpeedX: 220, speedY: 170, spin: 14, gravity: 900, burstAfterBounceMs: 160, maxAirMs: 650 },
  /** pixel chunks on the corpse burst: count range, pool cap, life (fades over the last fadeMs) */
  gibs: { min: 4, max: 8, cap: 80, lifeMs: 1500, fadeMs: 350, speed: 140, gravity: 700 },
  /** music duck (amount 0..1, ms) per event */
  duck: { kill: [0.35, 300], killBig: [0.6, 700], heavy: [0.2, 200], bossHit: [0.25, 250], parry: [0.4, 350] } as Record<string, [number, number]>,
  /** music lowpass while paused / at low HP (Hz); low-HP threshold */
  muffleHz: 700,
  lowHp: 1,
};

export const COLORS = {
  bg: 0x14142b,
  player: 0x7fdbff,
  playerDark: 0x2a6f97,
  slash: 0xffffff,
  shard: 0xffd166,
  heart: 0xef476f,
  checkpoint: 0x06d6a0,
  spike: 0xd9d9d9,
  lava: 0xff5400,
  exit: 0xf8f8f2,
};

/**
 * Movement feel (camera look-ahead/settle, squash & stretch, trails, footsteps, dust).
 * Pure math lives in core/moveFx.ts; trails/ghost pools in core/trails.ts.
 */
export const MOVE_FX = {
  camera: {
    lookAheadIdle: 14, // px ahead of facing while standing
    lookAheadRun: 30, // px ahead at full run speed (velocity-driven, toward the movement direction)
    lookAheadDash: 42, // px ahead while dashing
    lookHalfLifeMs: 260, // exponential smoothing half-life of the horizontal look-ahead
    baseOffsetY: 10, // followOffset y at rest (positive = player sits a bit low on screen)
    fallLookStartVy: 380, // fall speed where the extra downward look starts
    fallLookMax: 34, // px of extra downward look at fastFallMax / slam speed
    fallLookInHalfLifeMs: 120, // easing toward the down-look (fast)
    fallLookOutHalfLifeMs: 320, // easing back (slow, no snap after landing)
    settleMinVy: 330, // landings slower than this don't settle the camera
    settleMaxPx: 6, // downward camera dip (Juice.kick) at the hardest landing; off with Screen shake
    settleMs: 200,
  },
  squash: {
    jumpPre: [1.22, 0.8] as [number, number], // takeoff anticipation (shown for jumpPreMs)
    jumpPreMs: 40,
    jumpStretch: [0.76, 1.3] as [number, number],
    jumpOutMs: 140,
    landMin: [1.12, 0.9] as [number, number], // softest landing
    landMax: [1.42, 0.68] as [number, number], // hardest landing
    landMs: 130,
    float: [1.06, 0.95] as [number, number], // apex hang while holding jump (held pose)
    fastFall: [0.88, 1.14] as [number, number], // held pose while fast-falling
    wallSlide: [0.94, 1.05] as [number, number], // held pose while wall sliding
    wallHit: [0.78, 1.14] as [number, number], // first wall contact
    dashStart: [1.38, 0.74] as [number, number],
    dashEnd: [0.86, 1.12] as [number, number],
    poseHalfLifeMs: 60, // easing of held poses
  },
  trails: {
    ghostCap: 28, // max live afterimages per scene (oldest is recycled)
    lineCap: 24, // max live speed lines
    dashGhostMs: 200,
    dashTint: 0x7fdbff,
    slamGhostMs: 160,
    slamTint: 0xffe066,
    heavyGhostMs: 180,
    heavyTint: 0xffd96a,
    ghostEveryMs: 30, // spawn spacing for afterimages
    arcFadeMs: 140, // additive afterglow of each slash smear frame
    arcAlpha: 0.45,
    lineMinVy: 420, // fall speed where speed lines start
    lineEveryMs: 34,
    lineMs: 170,
  },
  feet: {
    runFootfallFrames: [1, 4], // 1-based frames of player-run where a foot plants
    stepMinSpeed: 60, // |vx| needed for footstep dust/sound
    skidMinSpeed: 95, // |vx| for a skid puff when the stick reverses
    skidEveryMs: 110,
    landFullHeight: 120, // fall height (px) that counts as a full-strength landing
    landDustMin: 2,
    landDustMax: 11,
  },
  /** dust puff tint per world (feet dust, skids, landings) */
  dustTint: { 1: 0xc8a97e, 2: 0xb9b8cc, 3: 0xc98a70, 4: 0xa8b4c8 } as Record<number, number>,
};
