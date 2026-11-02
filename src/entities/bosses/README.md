# Adding a boss

A working guide for agents adding a new boss. Read it top to bottom once, then use the
**checklist** as your to-do list. Every boss so far (Golem → CANTOR) follows this shape. When in
doubt, copy the pattern of the boss named in each section. Don't invent a new one.

> Ground rules for the whole project (from the root README / `src/art/README.md`):
> no image, font or audio files. Art is painted in code and audio is synthesized. Bosses must be original
> designs. Pure logic lives in `src/combat/*Plan.ts` with no Phaser import, so vitest can test it.

---

## 1. The checklist (every file a boss touches)

The ORRATH commit (`git show 1af0346 --stat`) and the CANTOR commits (`git show 1ee0c61 8510273 --stat`)
are complete reference diffs. A new boss `foo` on level `w4-9` touches:

| # | File | What to add | Required? |
|---|---|---|---|
| 1 | `src/levels/types.ts` | `'foo'` to the `BossId` union | yes |
| 2 | `src/entities/bosses/Foo.ts` | `export class Foo extends Boss` | yes |
| 3 | `src/entities/bosses/index.ts` | import + `foo: Foo` in `BOSS_TYPES` | yes |
| 4 | `src/combat/fooPlan.ts` | pure move-pick / timing / layout rules | strongly recommended |
| 5 | `tests/fooPlan.test.ts` | vitest for the plan | strongly recommended |
| 6 | `src/art/foo.ts` | `registerFooArt(scene)` painting every sheet and anim | yes |
| 7 | `src/art/bosses.ts` | import + call `registerFooArt(scene)` in `registerBossArt` | yes |
| 8 | `src/levels/worldN/wN-X.ts` | `LevelDef` arena with `boss: 'foo'` and one `&` spawn | yes |
| 9 | `src/levels/worldN/index.ts` | add to the world array **at the end** (see §7) + doc comment | yes |
| 10 | `src/scenes/UIScene.ts` | `BOSS_PHASES[name]` (bar ticks) + `BOSS_TITLES[name]` (subtitle) for **every** bar name the boss uses | yes |
| 11 | `src/systems/music.ts` | track(s) in `TRACKS` | optional (falls back to `'boss'`) |
| 12 | `src/scenes/GameScene.ts` | `bossTrack()` branch for its music; `*_STAGE_MS` if it has retry stages | if 11 / multi-stage |
| 13 | `src/systems/sfx.ts` | new `sfx.*` entries | optional |
| 14 | `src/scenes/GameOverScene.ts` | "Retry from …" item + sub-line, **gated by `levelId`** | if multi-stage |
| 15 | `src/levels/world4/*.ts` | `region: 'margin'` to put it on the post-game map page (`MARGIN_SLOTS` = 7 in `worldMap/layout.ts`: raise it, and update `tests/worldMap.test.ts`, when you add one past that), optional `mapDeco` doodle drawn in `WorldMapScene.drawDeco` | world-4 extras |
| 16 | `README.md` | one **Bosses** bullet (what it does, how to beat each phase) + code map entry | yes |
| 17 | `package.json` | `sim:foo` script, only if you add a Monte-Carlo sim | optional |

Ending/ability rewards: set `reward: '<UpgradeId>'` on the `LevelDef` (Golem → `doubleJump`,
Duelist → `airDash`). The reward text table lives in `GameScene.onBossDefeated`.

---

## 2. How a boss runs

```
GameScene.spawn('&')  ──900ms──▶  new BOSS_TYPES[def.boss](gs, x, y)  +  playMusic(gs.bossTrack())
Boss constructor      ──▶  bus.emit('boss', name, hp, maxHp)  (HUD bar)  +  bossIntro() cinematic
every frame: Enemy.tick → Boss.tick (idles ~2.4s during intro) → your think(dt) + animKey()
hit → Enemy.receiveHit → Boss.onHurt → crosses thresholds[] → phase++ → onPhase(n)
hp 0 → Boss.die → GameScene.onBossDefeated (reward, kill adds, white-out, open exit 'E')
```

### `Boss` base (`Boss.ts`): what you get for free
| Member | Use |
|---|---|
| `thresholds = [0.66, 0.33]` | HP fractions that start phase 2, 3, … Must match `BOSS_PHASES` in UIScene. |
| `phase`, `onPhase(n)` | Override `onPhase` to change sheets, arena, move set. Usually calls `transform()`. |
| `busy`, `cooldown` | `think()` should `return` while `busy`; decrement `cooldown -= dt` and pick a move at ≤ 0. |
| `attack(ms, cooldownAfter, fn)` | Runs `fn`, holds `busy` for `ms`, then sets `cooldown`. Wrap **every** move in this. |
| `later(ms, fn)` | Use instead of `gs.time.delayedCall`. Skips if dead and waits out parry-stun. |
| `telegraph(ms, color, unparryable)` | Flash before a hit. `unparryable=true` → **red** telegraph (the project's rule: red = dodge, don't parry). |
| `meleeBox(offX, offY, w, h, ms, dmg, parryable, kb)` | Hitbox in front of the boss (offX mirrors with `facing`). |
| `shoot(...)`, `gs.spawnProjectile(...)` | Projectiles. Pass `owner: this` so parries reflect correctly. |
| `shockwaves(speed, dmg)`, `rain(count, tex, spread)` | Stock ground waves / ceiling rain with markers. |
| `recover(ms, pose, cooldownAfter)` | Punish window after a heavy move: still, dizzy stars, takes ×1.25. **Every phase needs at least one.** |
| `transform(ms, fn)` | Invulnerable phase change: clears enemy projectiles, drops `hearts.onPhase`, runs `fn` after `ms`. |
| `setPose(name, ms)` / `curPose` | Visual-only pose that `animKey()` reads. |
| `hearts: HeartConfig` | Opt-in heals. Late bosses use `{ periodicMs: 24000, maxOnField: 1, perParries: 4, onPhase: 1 }`. |
| `cancelRecover()`, `endIntro(ms)` | For scripted cutscenes. |

From `Enemy`: `facePlayer()`, `dxToPlayer()`, `distToPlayer()`, `facing`, `stunned`, `onGround`,
`contactDamage`, `deathTint`, `filterHit()` (return `'blocked'` for armoured states),
`damageTakenMul()` (override for weak points; call `super` to keep transform/recover multipliers).

From `GameScene` (`this.gs`): `player`, `juice` (`impact`, `shake`, `rumble`, `burst`, `ring`, `slowmo`,
`hitstop`, `floatText`, `settleZoom`), `spawnHeart`, `ceilingBelow(x, y)`, `worldWidth/Height`,
`platforms` (static group for spawned ledges), `projectiles`, `bossStage`, `setCinematic(on)`.

### Minimal boss (Golem is the 120-line reference)
```ts
export class Foo extends Boss {
  private hist: FooMove[] = [];
  constructor(gs: GameScene, x: number, y: number) {
    super(gs, x, y, 'foo', 'FOO, THE EXAMPLE', { hp: 140, bodyW: 30, bodyH: 40, contactDamage: 0, shards: 80 });
    this.thresholds = [0.66, 0.33];
    this.deathTint = 0xffeec2;
    this.hearts = { periodicMs: 24000, maxOnField: 1, perParries: 4, onPhase: 1 };
    // anything you add to the scene: destroy it on DESTROY
    this.once(Phaser.GameObjects.Events.DESTROY, () => this.cleanup());
  }
  protected animKey(): string {           // visual only: never change AI here
    if (this.stunned) return 'foo-stun';
    return this.curPose ? 'foo-' + this.curPose : 'foo-idle';
  }
  protected think(dt: number): void {
    if (this.busy) return;
    this.cooldown -= dt;
    this.facePlayer();
    if (this.cooldown > 0) return;
    const m = pickFooMove(this.phase, Math.abs(this.dxToPlayer()), this.hist);  // from fooPlan.ts
    this.hist.push(m);
    this[m]();
  }
  protected onPhase(n: number): void {
    this.transform(900, () => { /* new sheet, arena change */ });
  }
  private slam(): void {
    const tele = this.phase === 1 ? 600 : 450;
    this.attack(tele + 400, 700, () => {
      this.telegraph(tele, 0xff5400, true);
      this.setPose('windup', tele);
      this.later(tele, () => {
        this.meleeBox(10, -8, 40, 30, 200, 2, false);
        this.gs.juice.impact('slam', this.x, this.body.bottom, Math.PI / 2);
        this.recover(900, 'stuck');                 // the punish window
      });
    });
  }
}
```

---

## 3. The plan module (`src/combat/fooPlan.ts`)

Keep everything you might want to tune or test out of the Phaser class: move weights per phase and
range, the move picker (no immediate repeats, a heavy every N moves), spawn layouts, timing tables,
retry-stage data, and bar names. Take an `rnd: () => number` argument so tests can seed it.
Templates: `wardenPlan.ts` (small), `colossusPlan.ts` (phases + layouts + resume), `cantorPlan.ts`
(timings derived from `funMath`).

Tests (`tests/fooPlan.test.ts`) usually assert that each phase has its own move set, that each phase has
a heavy (punishable) move, that the picker never repeats and uses every move over many seeded rolls,
that layouts stay inside the arena, and that resume state is correct. Copy the `mulberry32` helper from
`colossusPlan.test.ts` or use `seeded()` from `funMath.ts`.

### Optional: tune with `funMath.ts`
`src/combat/funMath.ts` is boss-agnostic. `hickWindup(choices, travelPx)` gives the minimum fair
telegraph. `hitProb` / `SKILL` / `DIFF` model players. `ttk()` and `expectedHits()` set the fight-length
and damage budget. `entropyBits` and `capRepeats` handle variety. CANTOR derives every windup from it and
`tests/cantorSim.test.ts` simulates thousands of fights (see `cantorSim.ts`, `npm run sim:cantor`).
Do this when you want numbers that can be defended. Golem-style hand-tuning is fine for simple bosses.

---

## 4. Art (`src/art/foo.ts`)

Follow `src/art/README.md`. In short:
- `sheet(scene, 'foo', frames, [['idle', [0,1], 4], ['windup', [2], 1], ['die', [3,4], 8, 0]])` from
  `./bosses` registers the sheet and `foo-<anim>` animations together (`[name, frames, fps, repeat?]`).
  `frames` are `P` painter objects (see `art/colossus.ts` and `art/warden.ts` for how they are built).
  `drawImage` / `drawCanvas` handle props and backgrounds.
- Feet go on the bottom row. Body size (`bodyW/H`) is set in the constructor, not by the art.
- Every anim key that `animKey()` can return **must exist**. A missing key just doesn't play (silent
  bug), so check it in the gallery.
- Register in `registerBossArt` (`src/art/bosses.ts`).
- Check: `npm run dev`, press **G** on the title screen, filter by your key.

---

## 5. Audio

- **Music** (`src/systems/music.ts`): `TRACKS.foo = { bpm, wave, leadVol, bass: n('…'), lead: n('…') }`
  with MIDI numbers and `.` rests. Then add a branch to `GameScene.bossTrack()`, e.g.
  `if (this.def.boss === 'foo') return this.bossStage === 'p3' ? 'foo3' : 'foo';`.
- **SFX** (`src/systems/sfx.ts`): add to the `sfx` object, built from `tone`, `noise`, `thump`, `crunch`, `ring`.
  `sfx.bossRoar()` already fires on every phase change.

---

## 6. HUD names and phases

`UIScene` looks up the bar by **name string**:
```ts
// BOSS_PHASES: tick marks on the bar. Must equal the boss's `thresholds`.
'FOO, THE EXAMPLE': [0.66, 0.33],
// BOSS_TITLES: subtitle on the intro name card
'FOO, THE EXAMPLE': 'Something Short and Ominous',
```
If the boss renames itself per phase (Fromage, ERRATUM, ORRATH do this with `bus.emit('boss', newName, hp, maxHp)`),
add **every** name to both tables. Otherwise the ticks vanish when it renames.

---

## 7. The level and unlock order

```ts
export const W4_9: LevelDef = {
  id: 'w4-9', name: 'The Example Hall', world: 4, parMs: 240000, boss: 'foo',
  rows: [ /* rectangular; '#' walls; exactly one P, one E, one & — legend in levels/types.ts */ ],
};
```
- The validator counts the raw characters `P`, `E`, `&`, `?`, so don't use them anywhere else in the rows.
- `E` is hidden until the boss dies. Bosses that build their own ledges keep the tile map flat
  (`w4-7.ts`), and the arena-wide floor Y is usually a constant in the boss file.
- **Unlocking is by list order**: `isUnlocked` (`src/levels/index.ts`) opens a level when the
  *previous entry in `LEVELS`* is cleared. **Append** new bosses to the end of the world array.
  Inserting in the middle shifts ids and breaks saves, and needs a `SaveSystem.migrateSave` step plus a
  `version` bump (the Croupier did this, see `SaveSystem.ts` v2). Ids may skip numbers (w4-8 shipped before
  w4-7 and was then reordered), but array order is what counts.
- World 4 extras live **off the world band**. Exclude the id in `WorldMapScene`'s band filter and draw
  a node like `MARGIN_ID` / `PEAK_ID` / `BELFRY_ID`, only `if (isUnlocked(...))`.
- `npm test` runs the level validator (`tests/levels.test.ts`): rectangular rows, walls, one start and
  one exit, and reachability.

---

## 8. Multi-stage fights: retry and cinematics

**Retry from stage X.** When the boss enters a later form, set `gs.bossStage = 'p2'` (any string). If the
player dies while the boss is alive, GameOver receives it. Then:
1. On construction, read `gs.bossStage` and jump to that phase/HP (`resumeState()` in `colossusPlan.ts`).
2. `GameOverScene`: add `Retry from <Name>` **gated on `this.d.levelId === 'w4-9'`**. Stage keys collide
   across bosses (ORRATH and CANTOR both use `p2`/`p3`), so never look a stage up without the level id.
3. `GameScene` create(): add a `FOO_STAGE_MS` so the run timer starts later and the rank isn't cheaper.
   This is also gated by `levelId` (see the `elapsed =` chain).
4. `bossTrack()` can switch music by stage.

**Phase cinematics.** `phaseCinematic(gs, { beats, commit, commitAt, length, shot?, cleanup?, done? })`
in `src/core/cinematics.ts` (used by ORRATH). Put **all** state changes (arena, props, form) in
`commit`, which runs exactly once, also on skip. Beats are visual/audio only, so a skip never leaves a
half-built arena. Run it inside `transform()` so the boss stays immune. Make cinematics skippable,
which the helper does for you.

---

## 9. Design rules the existing bosses follow

- **Readable**: every hit has a telegraph. Red (`unparryable=true`) means dodge or dash. Otherwise
  the hit is parryable, and parrying is the main skill the game teaches.
- **Every phase has a punish window** (`recover()` after a heavy move). Pick a heavy every ~3 moves.
- **No immediate repeats.** Weight moves by range (close/mid/far) and by whether the player is up high or camping.
- **Escalate per phase**: shorter telegraphs, new moves, arena changes. Don't just add HP.
- **Hearts** in long fights (`hearts` config) and one heart per phase change.
- Difficulty is already applied to the *player* (`DIFFICULTY` hpBonus / incomingMul in
  `Progression.computeStats`). Bosses don't branch on it, so don't add an "easy" code path.
- Add a README bullet that explains how to beat it. Players read that.

---

## 10. Common bugs (seen in past boss PRs)

- Orphaned objects: lights (`addLight`), graphics, sprites, tweens and timers that outlive the boss. Destroy
  them on `DESTROY` and when the phase that owns them ends.
- Using `gs.time.delayedCall` instead of `later()`: the callback fires after death or during a parry stun.
- `busy` stuck `true`: a move path that never reaches the end of `attack()`'s timer, or that calls
  `recover()` and `attack()` with mismatched lengths. Make sure `think()` always gets control back.
- Zoom left over after a scripted camera move. Call `gs.juice.settleZoom()` first (the cinematic helper does it).
- Overkill: one big hit crossing two thresholds calls `onPhase` twice back to back. Queue phases
  (`pendingPhases()` in `colossusPlan.ts`) if your transitions are long.
- Rain/projectiles under a ceiling: use `gs.ceilingBelow(x, cam.scrollY)` (the stock `rain()` already does).
- Map stomps or "list all bosses" features (ERRATUM) must only list bosses *before* their own level.

---

## 11. Verify before you commit

```bash
npm test                 # plan tests + level validator
npm run build            # typecheck
npm run dev              # then http://localhost:5173/?level=w4-9 jumps straight into the arena
```
- **F9** toggles the cheat panel in dev (god mode, unlock all levels, max upgrades).
- **G** on the title screen opens the art gallery.
- Play every phase, die in each stage (retry labels), skip each cinematic, and win (exit opens, reward,
  results screen). Check the console for errors.
- Commit message convention: `NAME, the Epithet (wN-X): one-line pitch`, then a body listing the
  pieces (see `git log` for 1af0346 / 8510273).
