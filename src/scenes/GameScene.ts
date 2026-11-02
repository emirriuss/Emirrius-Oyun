import Phaser from 'phaser';
import { COLORS, PHYS, PLAYER, TILE } from '../config';
import { InputManager } from '../core/InputManager';
import { Juice } from '../core/Juice';
import { bus } from '../core/events';
import { WORLD_PALETTES } from '../core/Textures';
import { DamageSystem } from '../combat/DamageSystem';
import { overlaps, type Rect, type Team } from '../combat/types';
import { Player } from '../entities/Player';
import type { Enemy } from '../entities/Enemy';
import { Projectile, type ProjectileOpts } from '../entities/Projectile';
import { ENEMY_TYPES } from '../entities/enemies';
import { Breakable, BREAKABLE_SHARD_CHANCE } from '../entities/Breakable';
import { BOSS_TYPES } from '../entities/bosses';
import { parseLevel, T, type ParsedLevel } from '../levels/LevelLoader';
import { getLevel } from '../levels';
import type { LevelDef } from '../levels/types';
import { save, computeRank } from '../systems/SaveSystem';
import { computeStats, DIFFICULTY } from '../systems/Progression';
import { sfx, setVolume } from '../systems/sfx';
import { applyCameraFx, addLight } from '../core/Fx';
import { buildParallax, buildLevelArt, buildAmbient, type LevelArt } from '../art/environment';
import { playMusic, stopMusic, setMusicEnabled } from '../systems/music';
import { MOVE_FX } from '../config';
import { fallLookDown, lookAheadTarget, smoothTo } from '../core/moveFx';
import { CINE, bossDeath, stageClear } from '../core/cinematics';
import { COLOSSUS_STAGE_MS, type ColossusStage } from '../combat/colossusPlan';
import { TUMBLAR_STAGE_MS, type TumblarStage } from '../combat/tumblarPlan';

/** shard pickup chime chain: pentatonic semitone steps, reset after a gap */
const SHARD_CHAIN_STEPS = [0, 2, 4, 7, 9, 12, 14, 16];
const SHARD_CHAIN_GAP_MS = 600;
/** shard magnet: grab radius, min age, homing speed ramp */
const MAGNET = { radius: 64, minAge: 350, v0: 70, accel: 1100, vMax: 460, steer: 0.3 };

/** ERRATUM resume points ("Retry from Draft N"): time charged so the rank isn't cheaper */
const ERRATUM_STAGE_MS: Record<string, number> = { d2: 70000, d3: 140000, act4: 210000 };
/** CANTOR "Retry from Terce / Vespers": the run timer resumes at the sim's median phase start (combat/cantorSim.ts) */
const CANTOR_STAGE_MS: Record<string, number> = { p2: 38000, p3: 88000 };
/** UMBRA "Retry from Twin Lamps / Lights Out" (hand-tuned estimate of the earlier phases' length) */
const UMBRA_STAGE_MS: Record<string, number> = { p2: 45000, p3: 100000 };

/** dust colour when a crumble block breaks, per world */
const CRUMBLE_DUST: Record<number, number> = { 1: 0x9c7a54, 2: 0x8b8ba8, 3: 0xa8253d, 4: 0x5a6aa8 };

export interface GameData {
  levelId: string;
  checkpoint?: { x: number; y: number };
  /** boss fight resume point (Aurren: 'sun' = start directly in the reborn form) */
  bossStage?: string;
}

interface MovingPlatform {
  img: Phaser.Physics.Arcade.Image;
  origin: { x: number; y: number };
  axis: 'x' | 'y';
  range: number;
  period: number;
}

export class GameScene extends Phaser.Scene {
  def!: LevelDef;
  level!: ParsedLevel;
  player!: Player;
  inp!: InputManager;
  juice!: Juice;
  damage!: DamageSystem;
  layer!: Phaser.Tilemaps.TilemapLayer;
  enemies!: Phaser.GameObjects.Group;
  projectiles!: Phaser.GameObjects.Group;
  pickups!: Phaser.GameObjects.Group;
  platforms!: Phaser.GameObjects.Group;
  private moving: MovingPlatform[] = [];
  /** level-local platform clock (ms): stops during hitstop, follows slow-mo, starts at 0 each load */
  private platformClock = 0;
  private crumbles: { img: Phaser.Physics.Arcade.Image; state: 'idle' | 'shaking' | 'gone'; t: number }[] = [];
  private checkpoints: { img: Phaser.GameObjects.Image; on: boolean }[] = [];
  private signs: { x: number; y: number; text: string }[] = [];
  private exit?: Phaser.GameObjects.Sprite;
  // environment visuals (no gameplay effect)
  private art?: LevelArt;
  /** visual / decoration tile layers (bosses that rewrite the map edit them alongside `layer`) */
  get levelArt(): LevelArt | undefined {
    return this.art;
  }
  private cpFx: { flame: Phaser.GameObjects.Sprite; light: Phaser.GameObjects.Image; lit: boolean }[] = [];
  private exitFx?: { light: Phaser.GameObjects.Image; motes: Phaser.GameObjects.Particles.ParticleEmitter };
  private twinkles?: Phaser.GameObjects.Particles.ParticleEmitter;
  private nextTwinkle = 0;
  private exitOpen = true;
  private breakables: Breakable[] = [];
  private shardChain = 0;
  private lastShardAt = -99999;
  /** hitboxes that already flicked the foliage */
  private pushedBoxes = new WeakSet<object>();
  boss?: Enemy;
  /** furthest resume point reached in this boss fight (passed to GameOver for "Retry from Rebirth") */
  bossStage?: string;
  enemyHpMul = 1;
  worldHeight = 0;
  worldWidth = 0;

  private data0!: GameData;
  private elapsed = 0;
  private totalEnemies = 0;
  private kills = 0;
  /** rewarded kills since the last Blood Pact heal */
  private killsSinceHeal = 0;
  /** enemies that count toward the kill ratio (level spawns + boss; not summons / shadow) */
  private counted = new Set<Enemy>();
  private shardsThisRun = 0;
  private finished = false;
  /** a pit/hazard respawn (fade + teleport) is pending */
  private respawning = false;
  private activeSign = -1;
  private lookAhead = 0;
  private lookDown = 0;
  /** cinematic hold (core/cinematics.ts): the player stands still and ignores input */
  private cinematic = false;

  constructor() {
    super('Game');
  }

  init(data: GameData): void {
    this.data0 = data;
    this.moving = [];
    this.platformClock = 0;
    this.crumbles = [];
    this.checkpoints = [];
    this.signs = [];
    this.exit = undefined;
    this.art = undefined;
    this.cpFx = [];
    this.exitFx = undefined;
    this.twinkles = undefined;
    this.nextTwinkle = 0;
    this.exitOpen = true;
    this.breakables = [];
    this.shardChain = 0;
    this.lastShardAt = -99999;
    this.pushedBoxes = new WeakSet();
    this.boss = undefined;
    this.cinematic = false;
    this.bossStage = data.bossStage;
    // resuming a boss mid-fight skips its first form: charge that time so the rank isn't cheaper
    // ORRATH and CANTOR both use p2 / p3 stage keys: look them up per boss
    const st = data.bossStage ?? '';
    this.elapsed =
      st === 'sun' ? 150000
      : getLevel(data.levelId).boss === 'cantor' ? CANTOR_STAGE_MS[st] ?? 0
      : getLevel(data.levelId).boss === 'tumblar' ? TUMBLAR_STAGE_MS[st as TumblarStage] ?? 0
      : getLevel(data.levelId).boss === 'umbra' ? UMBRA_STAGE_MS[st] ?? 0
      : ERRATUM_STAGE_MS[st] ?? COLOSSUS_STAGE_MS[st as ColossusStage] ?? 0;
    this.kills = 0;
    this.killsSinceHeal = 0;
    this.counted = new Set();
    this.totalEnemies = 0;
    this.shardsThisRun = 0;
    this.finished = false;
    this.respawning = false;
    this.activeSign = -1;
  }

  create(): void {
    this.def = getLevel(this.data0.levelId);
    this.level = parseLevel(this.def);
    const pal = WORLD_PALETTES[this.def.world];
    this.worldWidth = this.level.width * TILE;
    this.worldHeight = this.level.height * TILE;
    this.enemyHpMul = DIFFICULTY[save.data.settings.difficulty].enemyHpMul;
    setVolume(save.data.settings.volume);
    setMusicEnabled(save.data.settings.music);
    if (this.def.boss) stopMusic();
    else playMusic(String(this.def.world));

    this.physics.world.gravity.y = PHYS.gravity;
    this.physics.world.setBounds(0, 0, this.worldWidth, this.worldHeight + 200);
    this.physics.world.setBoundsCollision(true, true, false, false);
    this.cameras.main.setBackgroundColor(pal.bg);

    this.buildBackground();

    // tilemap: semantic collision layer (invisible) + autotiled visual layers from environment art
    const map = this.make.tilemap({ data: this.level.tiles, tileWidth: TILE, tileHeight: TILE });
    const tileset = map.addTilesetImage('tiles', `tiles${this.def.world}`, TILE, TILE, 0, 0)!;
    this.layer = map.createLayer(0, tileset, 0, 0)!;
    this.layer.setDepth(10);
    map.setCollision([T.TOP, T.BODY]);
    this.layer.forEachTile((t) => {
      if (t.index === T.ONEWAY) t.setCollision(false, false, true, false);
    });
    this.layer.setVisible(false);
    this.art = buildLevelArt(this, {
      world: this.def.world,
      levelId: this.def.id,
      tiles: this.level.tiles,
      keepClear: this.level.spawns.filter((s) => s.type === 'checkpoint' || s.type === 'exit' || s.type === 'sign' || s.type === 'boss').concat([{ type: 'checkpoint', ...this.level.player }]),
    });

    this.damage = new DamageSystem();
    this.juice = new Juice(this);
    this.hookEnvReactions();
    this.inp = new InputManager(this, save.data.settings.keys, true);
    this.enemies = this.add.group();
    this.projectiles = this.add.group();
    this.pickups = this.add.group();
    this.platforms = this.add.group();

    const start = this.data0.checkpoint ?? this.level.player;
    this.player = new Player(this, start.x, start.y, this.inp, computeStats(save.data));
    this.damage.register(this.player);

    this.spawnAll();

    // colliders
    this.physics.add.collider(this.player, this.layer, undefined, (_p, t) => this.oneWayFilter(t as Phaser.Tilemaps.Tile), this);
    this.physics.add.collider(this.player, this.platforms);
    this.physics.add.collider(this.enemies, this.layer);
    this.physics.add.collider(this.enemies, this.platforms);
    // projectiles pass through one-way platforms (standing under one made you immune to orbs/rain)
    this.physics.add.collider(this.projectiles, this.layer, undefined, (_p, t) => (t as Phaser.Tilemaps.Tile).index !== T.ONEWAY, this);
    this.physics.add.collider(this.pickups, this.layer);
    this.physics.add.collider(this.pickups, this.platforms);

    // camera
    const cam = this.cameras.main;
    cam.setBounds(0, 0, this.worldWidth, this.worldHeight);
    cam.startFollow(this.player, true, 0.12, 0.12);
    cam.setDeadzone(24, 40);
    cam.setRoundPixels(true);
    cam.fadeIn(250);
    applyCameraFx(cam, this.def.world);

    // UI overlay
    if (!this.scene.isActive('UI')) this.scene.launch('UI');
    else this.scene.get('UI').scene.restart();
    this.scene.bringToTop('UI');
    this.time.delayedCall(30, () => {
      bus.emit('shards', save.data.shards);
      bus.emit('hp', this.player.hp, this.player.stats.maxHp);
      bus.emit('stamina', this.player.stamina, this.player.stats.maxStamina);
      bus.emit('level', this.def.name);
    });

    // key bindings / music may have been changed from the pause menu's Settings
    const onResume = () => {
      this.inp.setKeyMap(save.data.settings.keys);
      // upgrades may have been changed from the pause menu's Cheats
      this.player.stats = computeStats(save.data);
      this.player.heal(0);
      const track = this.def.boss ? (this.boss?.alive ? this.bossTrack() : null) : String(this.def.world);
      if (save.data.settings.music && track) playMusic(track); // no-op if already playing
    };
    this.events.on('resume', onResume);
    this.events.once('shutdown', () => {
      this.events.off('resume', onResume);
      this.damage.clear();
      bus.emit('boss-hide');
      bus.emit('sign', null);
    });
  }

  // ------------------------------------------------------------------ build
  private buildBackground(): void {
    buildParallax(this, this.def.world, this.worldWidth, this.worldHeight);
    buildAmbient(this, this.def.world, this.worldWidth, this.worldHeight);
    this.twinkles = this.add.particles(0, 0, 'twinkle', {
      emitting: false,
      lifespan: 420,
      scale: { start: 0.9, end: 0 },
      alpha: { start: 1, end: 0.2 },
      rotate: { min: 0, max: 45 },
      blendMode: Phaser.BlendModes.ADD,
    });
    this.twinkles.setDepth(13);
  }

  private spawnAll(): void {
    for (const s of this.level.spawns) {
      const Ctor = ENEMY_TYPES[s.type];
      if (Ctor) {
        const e = new Ctor(this, s.x, s.y, s.elite);
        this.enemies.add(e);
        this.counted.add(e);
        this.totalEnemies++;
        continue;
      }
      switch (s.type) {
        case 'checkpoint': {
          const img = this.add.image(s.x, s.y + 8 - 12, 'checkpoint').setDepth(5);
          const on = !!this.data0.checkpoint && Math.abs(this.data0.checkpoint.x - s.x) < 2;
          if (on) img.setTexture('checkpointOn');
          this.checkpoints.push({ img, on });
          const flame = this.add.sprite(img.x - 1, img.y - 11, 'cpFlame').setOrigin(0.5, 1).setDepth(6).setVisible(false).play('cpFlame-burn');
          const light = addLight(this, img.x - 1, img.y - 14, 0x3ef0c0, 30, 0.4).setVisible(false);
          this.cpFx.push({ flame, light, lit: false });
          break;
        }
        case 'exit':
          this.exit = this.add.sprite(s.x, s.y + 8 - 16, 'exitPortal').setDepth(5).play('exitPortal-swirl');
          this.exitFx = {
            light: addLight(this, s.x, s.y - 10, 0x7fdbff, 44, 0.4),
            motes: this.add
              .particles(s.x, s.y - 8, 'envDot', {
                x: { min: -4, max: 4 },
                y: { min: -10, max: 8 },
                lifespan: 1100,
                frequency: 120,
                speedY: { min: -26, max: -10 },
                scale: { start: 0.8, end: 0 },
                alpha: { start: 0.9, end: 0 },
                tint: [0x7fdbff, 0xc9f2ff, 0xffffff],
                blendMode: Phaser.BlendModes.ADD,
              })
              .setDepth(6),
          };
          break;
        case 'shard':
          this.spawnPickup(s.x, s.y, 'shard', false);
          break;
        case 'heart':
          this.spawnPickup(s.x, s.y, 'heart', false);
          break;
        case 'sign': {
          this.add.image(s.x, s.y, `sign${this.def.world}`).setDepth(4);
          this.signs.push({ x: s.x, y: s.y, text: s.text ?? '' });
          break;
        }
        case 'hplatform':
        case 'vplatform': {
          const img = this.physics.add.image(s.x, s.y, `platform${this.def.world}`).setDepth(9).setImmovable(true);
          img.body.setAllowGravity(false);
          img.body.checkCollision.down = false;
          img.body.checkCollision.left = false;
          img.body.checkCollision.right = false;
          // kinematic: updatePlatforms sets the position each frame and carries riders itself.
          // moves = false: the body just follows the sprite with zero velocity, so Arcade neither
          // runs its own ride-along (which re-applied the frame's movement on every physics sub-step
          // and made riders slide) nor flings riders upward with the platform's velocity.
          img.body.moves = false;
          this.platforms.add(img);
          this.moving.push({
            img,
            origin: { x: s.x, y: s.y },
            axis: s.type === 'hplatform' ? 'x' : 'y',
            range: s.type === 'hplatform' ? 48 : 40,
            period: 3200,
          });
          break;
        }
        case 'breakable':
          this.breakables.push(new Breakable(this, s.x, s.y, this.def.world));
          break;
        case 'crumble': {
          const img = this.physics.add.image(s.x, s.y, `crumble${this.def.world}`, 0).setDepth(9).setImmovable(true);
          img.body.setAllowGravity(false);
          this.platforms.add(img);
          this.crumbles.push({ img, state: 'idle', t: 0 });
          break;
        }
        case 'boss': {
          const Ctor = this.def.boss ? BOSS_TYPES[this.def.boss] : undefined;
          if (!Ctor) break;
          this.exitOpen = false;
          this.time.delayedCall(900, () => {
            this.boss = new Ctor(this, s.x, s.y);
            playMusic(this.bossTrack());
            this.enemies.add(this.boss);
            this.counted.add(this.boss);
            this.totalEnemies++;
          });
          break;
        }
        default:
          break;
      }
    }
    if (this.exit && !this.exitOpen) this.exit.setVisible(false);
  }

  /** the final bosses get their own tracks */
  bossTrack(): string {
    if (this.def.boss === 'aurren') return this.bossStage === 'sun' ? 'sun' : 'blade';
    if (this.def.boss === 'fromage') return 'gala';
    if (this.def.boss === 'colossus') return this.bossStage === 'p3' ? 'colossus3' : 'colossus';
    if (this.def.boss === 'erratum') return this.bossStage === 'd3' || this.bossStage === 'act4' ? 'erratum3' : 'erratum';
    if (this.def.boss === 'cantor') return this.bossStage === 'p3' ? 'cantor3' : this.bossStage === 'p2' ? 'cantor2' : 'cantor';
    if (this.def.boss === 'tumblar') return this.bossStage === 'p3' ? 'tumblar3' : this.bossStage === 'p2' ? 'tumblar2' : 'tumblar';
    if (this.def.boss === 'umbra') return this.bossStage === 'p3' ? 'umbra3' : 'umbra';
    return this.def.boss === 'moth' ? 'final' : 'boss';
  }

  private oneWayFilter(t: Phaser.Tilemaps.Tile): boolean {
    if (t.index !== T.ONEWAY) return true;
    return this.time.now >= this.player.dropThroughUntil;
  }

  // ------------------------------------------------------------------ queries (used by entities)
  private tileAt(x: number, y: number): number {
    const t = this.layer.getTileAtWorldXY(x, y, true);
    return t ? t.index : T.EMPTY;
  }
  isSolidAt(x: number, y: number): boolean {
    const i = this.tileAt(x, y);
    if (i === T.TOP || i === T.BODY || i === T.ONEWAY) return true;
    return this.platforms.getChildren().some((p) => {
      const b = (p as Phaser.Physics.Arcade.Image).body as Phaser.Physics.Arcade.Body;
      return b.enable && x >= b.left && x <= b.right && y >= b.top && y <= b.bottom;
    });
  }
  /** solid (non one-way) tile at world point: used for ceiling corner correction */
  isBlockAt(x: number, y: number): boolean {
    const i = this.tileAt(x, y);
    return i === T.TOP || i === T.BODY;
  }
  /**
   * World y of the underside of the ceiling at column x, scanning down from `fromY`
   * (e.g. the camera top). Returns `fromY` if that point is already open air.
   * Things dropped "from the top of the screen" must spawn here: spawning above a solid
   * ceiling makes them land on its top face and die instantly.
   */
  ceilingBelow(x: number, fromY: number): number {
    let y = Math.max(0, fromY);
    const maxY = Math.min(this.worldHeight, fromY + 8 * TILE);
    while (y < maxY && this.isBlockAt(x, y)) y = (Math.floor(y / TILE) + 1) * TILE;
    return y < maxY ? y : fromY;
  }
  lineOfSight(x1: number, y1: number, x2: number, y2: number): boolean {
    const d = Phaser.Math.Distance.Between(x1, y1, x2, y2);
    const steps = Math.ceil(d / 8);
    for (let i = 1; i < steps; i++) {
      const x = x1 + ((x2 - x1) * i) / steps;
      const y = y1 + ((y2 - y1) * i) / steps;
      const t = this.tileAt(x, y);
      if (t === T.TOP || t === T.BODY) return false;
    }
    return true;
  }
  nearHazard(x: number, y: number): boolean {
    return this.level.hazards.some((h) => x > h.x - 22 && x < h.x + h.w + 22 && y > h.y - 24 && y < h.y + h.h + 8);
  }
  standingOnOneWay(p: Player): boolean {
    const b = p.body;
    return this.tileAt(b.center.x, b.bottom + 2) === T.ONEWAY;
  }

  // ------------------------------------------------------------------ spawns
  spawnProjectile(x: number, y: number, tex: string, vx: number, vy: number, team: Team, opts: ProjectileOpts = {}): Projectile {
    const p = new Projectile(this, x, y, tex, vx, vy, team, opts);
    this.projectiles.add(p);
    return p;
  }
  spawnEnergySlash(x: number, y: number, dir: 1 | -1): void {
    const lvl = this.player.stats.energySlashLvl;
    this.spawnProjectile(x, y, 'energySlash', dir * 320, 0, 'player', {
      damage: (lvl >= 2 ? 2 : 1) * this.player.stats.damageMul,
      pierce: lvl >= 3,
      lifeMs: PLAYER.energySlashLifeMs,
    });
  }
  /** Called by a Breakable when it is smashed: environment reacts, maybe a shard. */
  onBreakableSmashed(x: number, y: number, dir: number): void {
    this.breakables = this.breakables.filter((b) => b.alive);
    this.art?.flare(x, y, 90, 0.6);
    this.art?.push({ x: x - 24, y: y - 16, w: 48, h: 28 }, x - dir * 8, 0.8);
    if (Math.random() < BREAKABLE_SHARD_CHANCE) this.spawnPickup(x, y - 4, 'shard', true, dir * Phaser.Math.Between(20, 70), Phaser.Math.Between(-220, -150));
  }

  private spawnPickup(x: number, y: number, kind: 'shard' | 'heart', physics: boolean, vx = 0, vy = 0): Phaser.Physics.Arcade.Sprite {
    const img = this.physics.add.sprite(x, y, kind === 'shard' ? 'pickupShard' : 'pickupHeart').setDepth(12);
    img.play({ key: kind === 'shard' ? 'pickupShard-spin' : 'pickupHeart-pulse', startFrame: Phaser.Math.Between(0, 5) });
    img.setData('kind', kind);
    img.setData('born', this.time.now);
    if (physics) {
      img.body.setVelocity(vx, vy).setBounce(0.5).setDrag(60, 0);
    } else {
      img.body.setAllowGravity(false);
      this.tweens.add({ targets: img, y: y - 3, yoyo: true, repeat: -1, duration: 600 + Math.random() * 200, ease: 'Sine.inOut' });
    }
    this.pickups.add(img);
    return img;
  }
  /**
   * Heart pickup for boss fights. 'pop' = physics bounce out of (x, y);
   * 'drift' = no gravity, sinks slowly until it lands on the floor / a platform.
   */
  spawnHeart(x: number, y: number, mode: 'drift' | 'pop'): void {
    if (mode === 'pop') {
      this.spawnPickup(x, y, 'heart', true, Phaser.Math.Between(-60, 60), -220);
      return;
    }
    const img = this.spawnPickup(x, y, 'heart', true);
    (img.body as Phaser.Physics.Arcade.Body).setAllowGravity(false);
    img.setVelocity(0, 30).setBounce(0).setDrag(0, 0);
    img.setAlpha(0);
    this.tweens.add({ targets: img, alpha: 1, duration: 300 });
  }
  /** pickups of a kind currently in the level */
  countPickups(kind: 'shard' | 'heart'): number {
    return this.pickups.getChildren().filter((p) => p.active && p.getData('kind') === kind).length;
  }
  dropShards(x: number, y: number, n: number): void {
    for (let i = 0; i < n; i++) this.spawnPickup(x, y - 4, 'shard', true, Phaser.Math.Between(-90, 90), Phaser.Math.Between(-240, -120));
    if (Math.random() < 0.08) this.spawnPickup(x, y - 4, 'heart', true, 0, -200);
  }

  onEnemyKilled(e: Enemy, reward: boolean): void {
    // summoned adds would otherwise push kills past the total ("12 / 8") and inflate the rank
    if (this.counted.delete(e)) this.kills++;
    if (reward) this.bloodPactKill();
    if (e === this.boss) this.onBossDefeated();
  }

  /** Blood Pact: every N rewarded kills heals 1 (the counter keeps running at full hp). */
  private bloodPactKill(): void {
    const p = this.player;
    const every = p.stats.killsPerHeal;
    if (every <= 0 || !p.alive) return;
    if (++this.killsSinceHeal < every) return;
    this.killsSinceHeal = 0;
    if (p.hp >= p.stats.maxHp) return;
    p.heal(1);
    sfx.heal();
    this.juice.floatText(p.x, p.y - 20, '+1', '#ff6b8a');
  }

  private onBossDefeated(): void {
    bus.emit('boss-hide');
    stopMusic();
    this.juice.shake(0.015, 600);
    // the reward is granted now (saved even if the player quits mid-cinematic); shown after the white-out
    const reward = this.def.reward;
    let rewardText = '';
    if (reward && !save.data.upgrades[reward]) {
      save.data.upgrades[reward] = 1;
      save.save();
      this.player.stats = computeStats(save.data);
      const names: Record<string, string> = { doubleJump: 'DOUBLE JUMP unlocked! (jump in mid-air)', airDash: 'TWIN WIND: hits & wall-jumps refresh your dash!' };
      rewardText = names[reward] ?? 'New ability!';
    }
    // kill remaining minions
    for (const c of this.enemies.getChildren() as Enemy[]) if (c.alive && c !== this.boss) c.die(false);
    // punch toward the boss + white-out after its flicker-out (Boss.die already fired killBig), then reveal
    const reveal = () => {
      this.exitOpen = true;
      if (this.exit) {
        this.exit.setVisible(true).setAlpha(0);
        this.tweens.add({ targets: this.exit, alpha: 1, duration: 800 });
      }
      if (rewardText) bus.emit('toast', rewardText);
    };
    if (this.boss) bossDeath(this, this.boss, reveal);
    else reveal();
  }

  /** Cinematic hold on/off (boss intro). While on, the player stands still and ignores input. */
  setCinematic(on: boolean): void {
    if (this.cinematic === on) return;
    this.cinematic = on;
    if (!on) {
      // presses made during the cinematic must not fire on release
      for (const a of ['attack', 'jump', 'dash', 'special'] as const) this.inp.consume(a);
      // Player caches its current anim key; clear it so it re-picks after holdPlayer() swapped anims
      (this.player as unknown as { visKey: string }).visKey = '';
    }
  }

  private holdPlayer(): void {
    const p = this.player;
    if (!p.alive) return;
    p.body.setVelocityX(0);
    const key = p.body.blocked.down ? 'player-idle' : 'player-fall';
    if (p.anims.currentAnim?.key !== key && this.anims.exists(key)) p.play(key);
  }

  // ------------------------------------------------------------------ flow
  onPlayerDead(): void {
    if (this.finished) return;
    this.finished = true;
    save.save();
    this.scene.pause();
    this.scene.launch('GameOver', { levelId: this.def.id, checkpoint: this.currentCheckpoint(), bossStage: this.boss?.alive ? this.bossStage : undefined });
  }

  private currentCheckpoint(): { x: number; y: number } | undefined {
    const on = [...this.checkpoints].reverse().find((c) => c.on);
    return on ? { x: on.img.x, y: on.img.y } : this.data0.checkpoint;
  }

  private completeLevel(): void {
    if (this.finished) return;
    this.finished = true;
    const killRatio = this.totalEnemies ? this.kills / this.totalEnemies : 1;
    const rank = computeRank(this.elapsed, this.def.parMs, this.player.damageTaken, killRatio);
    const firstClear = !save.isCompleted(this.def.id);
    save.completeLevel(this.def.id, { rank, timeMs: Math.round(this.elapsed) });
    this.player.body.setVelocity(0, 0);
    this.player.alive = false;
    // pose freeze + ray burst + chime, then the beam-out
    stageClear(this, () => {
      sfx.victory();
      this.tweens.add({ targets: this.player, alpha: 0, scaleY: 1.6, scaleX: 0.3, duration: 400 });
      this.cameras.main.fadeOut(600, 255, 255, 255);
    });
    this.time.delayedCall(CINE.clearFreezeMs + 650, () => {
      this.scene.stop('UI');
      this.scene.start('LevelComplete', {
        levelId: this.def.id,
        rank,
        timeMs: this.elapsed,
        kills: this.kills,
        total: this.totalEnemies,
        shards: this.shardsThisRun,
        damage: this.player.damageTaken,
        firstClear,
      });
    });
  }

  // ------------------------------------------------------------------ update
  update(time: number, delta: number): void {
    const dt = Math.min(delta, 50);
    this.inp.update(time);

    if (this.inp.justPressed('pause') && !this.finished) {
      this.scene.pause();
      this.scene.launch('Pause', { levelId: this.def.id });
      return;
    }

    if (!this.finished) this.elapsed += dt;
    bus.emit('time', this.elapsed);

    this.updatePlatforms(time, dt);
    this.updateEnvVisuals(time);

    if (this.juice.frozen) return;

    // slowmo: entities and hitbox lifetimes run on scaled time so state timers (attack/hitbox durations,
    // AI wind-ups) stay in sync with the slowed physics, anims, tweens and timers. Input buffers, parry
    // windows, i-frames and stuns use real time (time.now), so the player stays responsive.
    const sdt = dt * this.juice.timeScale;
    if (this.cinematic) this.holdPlayer();
    else this.player.tick(time, sdt);
    for (const e of this.enemies.getChildren() as Enemy[]) e.tick(time, sdt);
    for (const p of this.projectiles.getChildren() as Projectile[]) p.tick();
    this.damage.update(sdt);

    if (!this.player.alive) return;
    this.updateHazards();
    this.updatePickups();
    this.updateProps();

    // camera look-ahead (eased toward facing/velocity) + extra down-look while falling fast / slamming
    const pl = this.player;
    const cc = MOVE_FX.camera;
    const dashing = pl.fsm.is('dash');
    this.lookAhead = smoothTo(this.lookAhead, lookAheadTarget(pl.facing, pl.body.velocity.x, PLAYER.runSpeed, dashing, cc), cc.lookHalfLifeMs, dt);
    const vy = pl.fsm.is('slam') ? PLAYER.fastFallMax : pl.body.velocity.y;
    const down = pl.grounded ? 0 : fallLookDown(vy, cc.fallLookStartVy, PLAYER.fastFallMax, cc.fallLookMax);
    this.lookDown = smoothTo(this.lookDown, down, down > this.lookDown ? cc.fallLookInHalfLifeMs : cc.fallLookOutHalfLifeMs, dt);
    this.cameras.main.setFollowOffset(-Math.round(this.lookAhead), Math.round(cc.baseOffsetY - this.lookDown));
  }

  private updatePlatforms(time: number, dt: number): void {
    const p = this.player;
    // physics is paused during hitstop and scaled by slow-mo: keep platforms in step with it
    if (!this.juice.frozen) this.platformClock += dt / this.physics.world.timeScale;
    if (this.moving.length) {
      const riders: Phaser.Physics.Arcade.Sprite[] = [];
      if (p.alive) riders.push(p);
      for (const e of this.enemies.getChildren() as Enemy[]) {
        const b = e.body as Phaser.Physics.Arcade.Body | null;
        if (e.alive && b?.enable && b.allowGravity) riders.push(e);
      }
      for (const m of this.moving) {
        const mb = m.img.body as Phaser.Physics.Arcade.Body;
        // who stands on it? (checked before moving; tolerant so a 1px hover still counts, but not mid-jump)
        const onTop = riders.filter((r) => {
          const b = r.body as Phaser.Physics.Arcade.Body;
          return b.velocity.y > -120 && Math.abs(b.bottom - mb.top) < 4 && b.right > mb.left && b.left < mb.right;
        });
        // exact position from the clock: no velocity integration, so no drift
        const off = Math.sin((this.platformClock / m.period) * Math.PI * 2) * m.range;
        const nx = m.axis === 'x' ? m.origin.x + off : m.origin.x;
        const ny = m.axis === 'y' ? m.origin.y + off : m.origin.y;
        const dx = nx - m.img.x;
        const dy = ny - m.img.y;
        m.img.setPosition(nx, ny);
        // carry riders by exactly the platform's per-frame delta (once per frame, whatever the step count);
        // on the way down this also stops the rider hovering/flickering between grounded and airborne
        for (const r of onTop) {
          r.x += dx;
          r.y += dy;
        }
      }
    }
    for (const c of this.crumbles) {
      const b = c.img.body as Phaser.Physics.Arcade.Body;
      if (c.state === 'idle') {
        const pb = p.body;
        if (pb.touching.down && Math.abs(pb.bottom - b.top) < 3 && pb.right > b.left && pb.left < b.right) {
          c.state = 'shaking';
          c.t = time;
          this.tweens.add({ targets: c.img, x: c.img.x + 1, yoyo: true, repeat: 6, duration: 30 });
        }
      } else if (c.state === 'shaking' && time - c.t <= 450) {
        c.img.setFrame(Math.min(3, 1 + Math.floor(((time - c.t) / 450) * 3)));
      } else if (c.state === 'shaking' && time - c.t > 450) {
        c.state = 'gone';
        c.t = time;
        b.enable = false;
        c.img.setAlpha(0);
        this.juice.burst(c.img.x, c.img.y, CRUMBLE_DUST[this.def.world], 8, 0.6);
      } else if (c.state === 'gone' && time - c.t > 2500) {
        const pr = p.hurtRect();
        if (!overlaps(pr, { x: b.x, y: b.y, w: 16, h: 16 })) {
          c.state = 'idle';
          b.enable = true;
          c.img.setFrame(0);
          this.tweens.add({ targets: c.img, alpha: 1, duration: 200 });
        }
      }
    }
  }

  /** Visual-only per-frame updates: lava/torches, checkpoint flames, exit glow, pickup sparkles. */
  private updateEnvVisuals(time: number): void {
    this.updateFoliage();
    this.art?.update(time);
    this.checkpoints.forEach((c, i) => {
      const fx = this.cpFx[i];
      if (!fx || fx.lit === c.on) return;
      fx.lit = c.on;
      fx.flame.setVisible(c.on);
      fx.light.setVisible(c.on);
      if (c.on) {
        fx.flame.setScale(0.2);
        this.tweens.add({ targets: fx.flame, scale: 1, duration: 260, ease: 'Back.out' });
      }
    });
    for (const fx of this.cpFx) if (fx.lit) fx.light.setAlpha(0.32 + Math.sin(time * 0.011) * 0.05 + Math.sin(time * 0.027) * 0.03);
    if (this.exit && this.exitFx) {
      const vis = this.exit.visible;
      this.exitFx.light.setVisible(vis).setAlpha((0.32 + Math.sin(time * 0.004) * 0.08) * this.exit.alpha);
      this.exitFx.motes.emitting = vis;
    }
    if (this.twinkles && time > this.nextTwinkle) {
      this.nextTwinkle = time + 140;
      const cam = this.cameras.main.worldView;
      const shards = (this.pickups.getChildren() as Phaser.Physics.Arcade.Sprite[]).filter((p) => p.getData('kind') === 'shard' && cam.contains(p.x, p.y));
      if (shards.length) {
        const p = shards[Math.floor(Math.random() * shards.length)];
        this.twinkles.emitParticleAt(p.x + Phaser.Math.Between(-3, 3), p.y + Phaser.Math.Between(-4, 3));
      }
    }
  }

  /** Torches flare at hits / explosions (wraps the Juice calls so no entity code has to know). */
  private hookEnvReactions(): void {
    const j = this.juice;
    const impact = j.impact.bind(j);
    j.impact = (...args: Parameters<Juice['impact']>) => {
      impact(...args);
      const [kind, x, y] = args;
      this.art?.flare(x, y, 110, kind === 'light' ? 0.6 : 1.1);
    };
    const ring = j.ring.bind(j);
    j.ring = (...args: Parameters<Juice['ring']>) => {
      ring(...args);
      const [x, y, , scale = 1] = args;
      this.art?.flare(x, y, 80 + 30 * scale, 0.6 + 0.3 * scale);
    };
  }

  /** Foliage leans as bodies pass through it and is flicked by attack swings. */
  private updateFoliage(): void {
    const art = this.art;
    if (!art) return;
    const view = this.cameras.main.worldView;
    const inView = (x: number, y: number) => x > view.x - 32 && x < view.right + 32 && y > view.y - 32 && y < view.bottom + 32;
    const p = this.player;
    if (p?.alive && p.body) {
      const b = p.body;
      art.touch(b.center.x, b.center.y, b.halfWidth, b.halfHeight, b.velocity.x);
    }
    for (const e of this.enemies.getChildren() as Enemy[]) {
      const b = e.body as Phaser.Physics.Arcade.Body | null;
      if (!e.alive || !b || !inView(b.center.x, b.center.y)) continue;
      art.touch(b.center.x, b.center.y, b.halfWidth, b.halfHeight, b.velocity.x);
    }
    for (const hb of this.damage.hitboxes) {
      if (hb.dead || this.pushedBoxes.has(hb)) continue;
      this.pushedBoxes.add(hb);
      const r = hb.rect();
      if (!inView(r.x + r.w / 2, r.y + r.h / 2)) continue;
      art.push(r, hb.team === 'player' ? p.x : r.x + r.w / 2, hb.team === 'player' ? 1 : 0.7);
    }
  }

  private updateHazards(): void {
    if (this.respawning) return;
    const p = this.player;
    const r = p.hurtRect();
    // spikes (not lava) can be pogoed with a slam
    for (const h of this.level.hazards) if (!h.lava && p.trySpikePogo(h)) return;
    for (const h of this.level.hazards) {
      if (!h.lava && p.spikeSafe) continue;
      if (!overlaps(r, h)) continue;
      const res = p.receiveHit({ damage: h.damage, kbX: 0, kbY: -250, sourceX: p.x, kind: 'hazard' });
      if (res === 'hit') {
        if (h.lava) this.juice.burst(p.x, p.y, COLORS.lava, 20);
        if (p.alive) this.respawnSafe();
      }
      return;
    }
    // pit
    if (p.y > this.worldHeight + 24) {
      p.receiveHit({ damage: 1, kbX: 0, kbY: 0, sourceX: p.x, kind: 'hazard' });
      if (p.alive) this.respawnSafe();
    }
  }

  private respawnSafe(): void {
    if (this.respawning || this.finished) return;
    this.respawning = true;
    const cam = this.cameras.main;
    cam.fadeOut(120, 0, 0, 0);
    this.time.delayedCall(140, () => {
      this.respawning = false;
      // died in the meantime: don't teleport the corpse; a level clear runs its own fade
      if (this.finished) return;
      if (this.player.alive) this.player.teleportSafe();
      cam.fadeIn(160);
    });
  }

  private updatePickups(): void {
    const p = this.player;
    const now = this.time.now;
    const dts = Math.min(this.game.loop.delta, 50) / 1000;
    // copy: collecting removes from the group mid-loop
    for (const obj of [...this.pickups.getChildren()] as Phaser.Physics.Arcade.Sprite[]) {
      if (obj.getData('collected')) continue;
      const d = Phaser.Math.Distance.Between(obj.x, obj.y, p.x, p.y);
      const age = now - (obj.getData('born') as number);
      const isShard = obj.getData('kind') === 'shard';
      const ob = obj.body as Phaser.Physics.Arcade.Body;
      if (isShard && age > MAGNET.minAge && (obj.getData('mag') || d < MAGNET.radius * p.stats.magnetMul)) {
        // homing pull that accelerates the longer it's been caught; ignores terrain once grabbed
        if (!obj.getData('mag')) {
          obj.setData('mag', true).setData('magV', MAGNET.v0).setData('trailAt', 0);
          this.tweens.killTweensOf(obj);
          ob.setAllowGravity(false);
          ob.checkCollision.none = true;
          ob.setDrag(0, 0).setBounce(0);
        }
        const v = Math.min(MAGNET.vMax, (obj.getData('magV') as number) + MAGNET.accel * dts);
        obj.setData('magV', v);
        const a = Phaser.Math.Angle.Between(obj.x, obj.y, p.x, p.y - 2);
        const steer = Math.min(1, MAGNET.steer + age / 4000);
        ob.setVelocity(Phaser.Math.Linear(ob.velocity.x, Math.cos(a) * v, steer), Phaser.Math.Linear(ob.velocity.y, Math.sin(a) * v, steer));
        // stretch along the flight direction + sparkle trail
        obj.setScale(1 + (v / MAGNET.vMax) * 0.25, 1 - (v / MAGNET.vMax) * 0.15);
        if (this.twinkles && now > (obj.getData('trailAt') as number)) {
          obj.setData('trailAt', now + 45);
          this.twinkles.emitParticleAt(obj.x + Phaser.Math.Between(-1, 1), obj.y + Phaser.Math.Between(-1, 1));
        }
      }
      if (d < 12 && age > 250) {
        if (isShard) {
          save.addShards(1);
          this.shardsThisRun++;
          bus.emit('shards', save.data.shards);
          this.shardChain = now - this.lastShardAt < SHARD_CHAIN_GAP_MS ? Math.min(this.shardChain + 1, SHARD_CHAIN_STEPS.length - 1) : 0;
          this.lastShardAt = now;
          sfx.pickup(Math.pow(2, SHARD_CHAIN_STEPS[this.shardChain] / 12));
        } else {
          if (p.hp >= p.stats.maxHp) continue;
          p.heal(1);
          sfx.heal();
          this.juice.floatText(p.x, p.y - 16, '+1', '#ef476f');
        }
        this.juice.burst(obj.x, obj.y, isShard ? COLORS.shard : COLORS.heart, 6, 0.5);
        this.collectPop(obj);
      }
    }
  }

  /** Squash-and-pop on collect: the pickup leaves physics and plays out over ~150ms. */
  private collectPop(obj: Phaser.Physics.Arcade.Sprite): void {
    obj.setData('collected', true);
    this.pickups.remove(obj);
    (obj.body as Phaser.Physics.Arcade.Body).enable = false;
    this.tweens.killTweensOf(obj);
    obj.setScale(1.7, 0.5).setTintFill(0xffffff);
    this.tweens.add({
      targets: obj,
      scaleX: 0.6,
      scaleY: 1.8,
      y: obj.y - 6,
      duration: 70,
      ease: 'Quad.out',
      onComplete: () => {
        obj.clearTint();
        this.tweens.add({ targets: obj, scaleX: 0, scaleY: 0, alpha: 0, duration: 80, ease: 'Quad.in', onComplete: () => obj.destroy() });
      },
    });
  }

  private updateProps(): void {
    const p = this.player;
    const pr: Rect = p.hurtRect();
    for (const c of this.checkpoints) {
      if (c.on) continue;
      if (Math.abs(c.img.x - p.x) < 12 && Math.abs(c.img.y - p.y) < 24) {
        c.on = true;
        c.img.setTexture('checkpointOn');
        p.heal(p.stats.maxHp);
        sfx.checkpoint();
        this.juice.burst(c.img.x + 4, c.img.y - 8, COLORS.checkpoint, 16);
        this.juice.floatText(c.img.x, c.img.y - 20, 'CHECKPOINT', '#06d6a0');
        save.save();
      }
    }
    if (this.exit && this.exitOpen && this.exit.visible) {
      const er = { x: this.exit.x - 6, y: this.exit.y - 14, w: 12, h: 28 };
      if (overlaps(pr, er)) this.completeLevel();
    }
    // signs
    let near = -1;
    this.signs.forEach((s, i) => {
      if (Math.abs(s.x - p.x) < 20 && Math.abs(s.y - p.y) < 24) near = i;
    });
    if (near !== this.activeSign) {
      this.activeSign = near;
      bus.emit('sign', near >= 0 ? this.signs[near].text : null);
    }
  }
}
