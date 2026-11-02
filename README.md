# Emirrius

An original 2D melee action-platformer for the browser: Phaser 3 + TypeScript + Vite.
All art is pixel art generated in code at runtime (see `src/art/README.md`) and all audio is synthesized, so there are no asset files.

## Run

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # unit tests + level validator
npm run build      # typecheck + static build in dist/
```

## Desktop build (Electron)

```bash
npm run electron     # build and run in an Electron window
npm run dist:win     # release/Emirrius-<ver>-Portable.exe and -Setup.exe (Windows x64)
npm run dist:linux   # release/Emirrius-<ver>.AppImage
```

The Windows builds are self-contained: no install, Node, or internet needed. In the desktop app, F11 toggles fullscreen.

## Controls

| Action | Keys | Gamepad |
|---|---|---|
| Move | Arrows / WASD | D-pad / left stick |
| Jump (hold = higher) | Z / Space | A |
| Attack (tap ×3 = combo; works while running, keeps momentum) | X / J / **Left click** | X |
| Air combo (2 hits) | Attack twice in mid-air | |
| Heavy strike | hold Attack after a swing | |
| Up-slash | Up + Attack | |
| Slam (pogo) | Down + Attack in mid-air | |
| Float at jump apex / fast-fall | hold Jump / hold Down in mid-air | |
| Dash (i-frames) | C / K / Shift | B / RT |
| Dash-slash | Attack during a Dash | |
| Cancel a swing | Jump or Dash mid-swing | |
| Attack off a wall | Attack while wall-sliding | |
| Parry | Attack into an enemy hit / projectile at the right moment (facing it; Up-slash parries from above) | |
| Special (Wave Edge upgrade) | F / I / **Right click** | Y / RB |
| Drop through platform | Down + Jump | |
| Pause | Esc / P | Start |

There is no parry button: a swing parries a hit that lands during its first moment. Moves with a **red** telegraph can't be parried; dodge or dash through them.

You can remap keys in Settings.

## Visual settings
- **Visual FX** (Settings): a vignette and colour grade per world, plus sprite glows. Turn it off on slow machines; the additive lights stay on either way.
- **Screen shake** can be toggled in Settings.
- **Dev art gallery:** in `npm run dev`, press **G** on the title screen to browse every generated sprite and animation (←/→ to page, B to change the background).
- **Dev level jump:** in `npm run dev`, open `http://localhost:5173/?level=w4-1` to start straight in that level.

## Game structure

- **4 worlds**: Verdant Hollow → Iron Spire → Crimson Throne (5 stages each: 4 levels + a boss arena), then **The Hollow Deep** (3 boss arenas, unlocked after the Hollow King: The Warden's Pit, The Sunken Table, Eclipse Nest; plus a secret fourth, **The Sunless Core**, unlocked by beating Noctara, and an encore, **The Grand Gouda Gala**, after that)
- **Bosses:** Iron Golem (reward: double jump), Twin Blades (reward: dash refresh), The Hollow King (3 phases), The Chained Warden (3 phases), The Gilded Croupier (3 phases; a luck/gambling boss whose rolls show their odds before they land, with optional player wagers), Noctara, the Eclipse Moth (final boss, 3 phases). Long fights drop hearts: some fall from the ceiling while you're hurt, every 3rd parry pops one, and each phase change drops one.
- **Twin Blades** (w2-5), a samurai duelist in 3 phases. *One Blade*: parry the white-flash dash slashes; when he sheathes and his hilt glints, the Iaido Draw cuts a long line ahead. Parry or dodge it and hit him while he's frozen in the follow-through. Standing on a ledge invites a Rising Cut. *Twin Blades*: he draws the second sword. Combos end in a red thrust (dodge, don't parry), Cross Cut sends an X wave along the floor (jump it or parry it back), Falling Moon leaps up and plunges onto a red floor marker (move off it, then punish the stuck blade). Mirror Guard (blue rings) blocks every hit and answers with a red counter, so wait until it says OPEN. *Shadow Duet*: his shadow twin joins for pincer dashes from both sides (two parries in a row) and crossed fans. Killing the shadow staggers him; it returns after ~15s. Thousand Cuts dims the room and marks red columns that fire in a sweep: stand in an unmarked gap, then punish the long recovery.
- **Secret boss: Aurren, the First Blade** (w4-4, true ending). A duelist who fights with your own moves and reads your habits (spam attacks and he guards, keep away and he presses in, jump a lot and he cuts upward); every counter is announced by a taunt. 3 phases, then a false death, then he's reborn as **the Hollow Sun** (new bar, 2 phases: armoured, hit the core when it opens), then one last clash. Dying after the rebirth offers **Retry from Rebirth**.
- **Encore boss: Monsieur Fromage, the Wheel of Fate** (w4-5, unlocked by beating Aurren). He's a game-show cheese wheel who spins his own body to choose each attack. Hit him mid-spin to nudge the wheel and rig the show. He gets sliced in half, then melts. Watch out for BANKRUPT, which steals shards (hit the coins to win them back), and the DOUBLE OR NOTHING button.
- **Misprint boss: ERRATUM, the Unwritten** (w4-6, unlocked by beating Fromage; its node is scribbled in the world map's margin). A typo that escaped the level files and knows it's in a game. Draft 1 fights with the map: it erases floor columns into pits, writes ink platforms, and drops the level's own ASCII (`#` blocks, `=` ledges, `^` spikes, a `P` that copies you, an `E` fake exit); its margin notes say which wall it will dash from, and they may lie. Draft 2 leaves the arena for the HUD: it rips its HP bar off the screen and swings it (strike the bar when it sticks to hurt it), steals your hearts (strike them home), turns the page (camera rotation) and slams the letterbox shut except for one gap. Draft 3 breaks the program: a fake "not responding" window (hit Close before the cursor clicks Wait), the title menu falls in as slabs, the world map becomes hop platforms, the credits roll as a climb, and ink copies replay your last two seconds. When the bar empties the HUD dissolves and a save prompt offers to delete your file; refuse three times, then save over it. Nothing ever touches the real save. **Settings > Screen tricks** turns off the camera rotation and the greyscale. Dying offers **Retry from Draft N**.
- **Colossus boss: ORRATH, the Buried Colossus** (w4-7, unlocked by beating ERRATUM; its node is a mountain doodled in the map margin above ERRATUM's). A mountain that wakes up, with each phase change a skippable cinematic (Attack/Jump) that reveals more of it. Phase 1 is only a hand coming out of the valley floor, with an eye in its palm. It throws three shadowed fist slams (the last leaves the palm open), floor sweeps you jump over, parryable pebble flicks and a fist quake. **The Mountain Wakes:** the hand sinks, the camera pulls back, a head rises behind the range and its eye opens on the real name card. Phase 2 is the face: a sweeping eye beam you dash through, an exhale that blows you toward the walls under rock fans, the hand returning to smash the debris ledges, and a headbutt that leaves its eye bowed within reach. **The Fall:** silence and a heartbeat, the ground gives way, a slow-motion leap onto its back, a white-out. Phase 3 is fought on its back in open sky while the ground rises with its HP. The core only opens to attack: plate shrugs (get on a plate), swats (stay off them), debris rain and parryable core pulses. Dying offers **Retry from The Face / The Fall**.
- **Math-tuned boss: CANTOR, the Tolling Bell** (w4-8, unlocked by beating ERRATUM; a bell-tower node above the margin). A floating bronze bell whose whole fight runs on a beat (100 / 115 / 130 BPM, matching its music): every strike lands on a beat, a metronome ticks through each telegraph, and each chain of 2 / 3 / 4 moves gets a count-in and ends with the bell slamming down next to you, dizzy. Prime: rim Swing (parryable), Toll slams (jump the ring waves), Clapper drops down marked columns. Terce: numbered Peal bells ring down columns one beat apart, Echo replays the last move mirrored. Vespers: Syncopation lunges on the off-beat (the one move that breaks the rhythm), and the Carillon finale ends in a long punish window. Every number comes from `src/combat/funMath.ts` (Hick-law reaction floors, a hit-chance model per skill profile, damage budget, threat:opening ratio, move-pick entropy) through `src/combat/cantorPlan.ts`, and `tests/cantorSim.test.ts` simulates thousands of fights to check fight length and win rates; `npm run sim:cantor` prints the report. Dying offers **Retry from Terce / Vespers**.
- **Puzzle boss: TUMBLAR, the Keyless Door** (w4-9, unlocked by beating CANTOR; a keyhole on the Margin page of the world map). An iron vault door that locked itself so long ago it forgot what it guards. Its shell blocks every hit (only reflected shots chip it). **Pick the lock** and the keyhole core opens: it loses a fixed chunk of HP and stands dizzy for a punish window. Wrong moves on a lock only cost time; its attacks are what hurt. **The Tumblers:** five pin heads you can stand on. **Up-slash** a pin to raise it a notch, **slam** it to lower it, and line every pin up with its gold brackets. Later locks add **linked pins** (a chain: moving the pin with the dot also moves the one with the ring; blue = same way, pink = opposite) and a **spool pin** (waisted, "FALSE SET" when raised into place: push it past and slam it back down). It fires Deadbolts across one height band (red: jump or duck), tosses its key (parry it) and springs a pin you set. **The Dial:** a hanging combination dial. Strike it from the left to turn it right, from the right to turn it left (heavy = 3 numbers). A loud click and spark mark the right number in the right direction; reverse on it to lock the digit in (R, L, R). Tumbler gears roll along the floor, numerals fly at you, and a Relock hook flies at the dial: parry it (or block it with your body) or lose a digit. **The Wards:** five floor bolts; every strike flips a bolt and its neighbours, and the door keeps re-keying one. It can't be cut down: at the last notch it throws **the last key**. Parry it back into the lock. After two moves in a row that don't help, the next right move glows. Every lock is generated and checked solvable in `src/combat/tumblarPlan.ts` (exhaustively tested in `tests/tumblarPlan.test.ts`). Dying offers **Retry from The Dial / The Wards**.
- **Shadow boss: UMBRA, the Cast Shadow** (w4-10, The Lantern Hall, unlocked by beating TUMBLAR; a lantern doodle on the margin page). A shadow with no one standing in it, cast by lanterns hanging from a ceiling rail. Your sword passes straight **through** it, except when a lantern hangs almost straight above its feet: then it condenses into a glowing violet puddle you can cut. Move the light by hitting the lantern: a side swing slides it along the rail, an **up-slash hoists** it (a higher light makes a wider condense zone), a **pogo lowers** it. Its claws are as long as the shadow leaning at you, so **keep the light between you and it**. Lamplit (one lantern): Lean Strike (parryable), Dusk Sweep (a floor wave: jump or parry it), Snuff Wisp (knocks the lantern away from it: parry the wisp), and a red Pounce that leaves it sprawled (hittable for less, or for full damage if it lands under the light; parry stuns also make it hittable). Twin Lamps: a second lantern and two shadows from one body, plus Cross-cast (a parryable claw, a glide under you, then a red claw from the other side) and Lamp Swap. Lights Out (skippable cinematic): the room goes dark, one lantern is left, and the thing that cast the shadow steps out, solid from now on. It snuffs the lantern (one hit relights it; it takes less damage in the dark), throws Long Arm swipes and waves both ways, and its red Eclipse Grab leaves it gorged on the floor. Rules live in `src/combat/umbraPlan.ts` (tested in `tests/umbraPlan.test.ts`). Dying offers **Retry from Twin Lamps / Lights Out**.
- **Shards** dropped by enemies are spent at the **Shrine** on the world map: max HP, damage, stamina, a 4th combo hit, and a ranged energy slash.
- Each stage is ranked **S/A/B/C** on time vs par, damage taken, and kills. Progress saves to `localStorage`.
- Difficulty (Easy/Normal/Hard), volume, music, screen shake and key bindings are under Settings.

## Code map

```
src/
  config.ts              all gameplay tunables (speeds, timings, damage)
  art/                   generated pixel art: pipeline, palette, pixel font, player/enemies/bosses/environment/fx/ui
  core/                  StateMachine, InputManager (buffered input), Juice (hitstop/shake/VFX), Fx (post-FX, lights), legacy Textures
  combat/                Hitbox, DamageSystem (hitbox vs hurtbox), shared types
  entities/Player.ts     player controller and state machine
  entities/Enemy.ts      enemy base class with AI helpers (patrol, telegraph, meleeBox, shoot…)
  entities/enemies/      Slime, Charger, Archer, Flyer, Knight, Bomber
  entities/bosses/       Boss base, Golem, Duelist, King, Warden, Croupier, Moth, Aurren (+ aurrenSun sun form, AurrenEcho add), Fromage, Erratum (+ erratumProps: page editor, fake dialogs, slabs), Colossus, Cantor, Tumblar (+ tumblarProps: pin heads, dial, bolts), Umbra (+ umbraProps: lanterns, darkness overlay)
  levels/                ASCII level format (see levels/types.ts for the legend), parser, worlds 1–4
  scenes/                Boot, Menu, WorldMap, Shrine, Game, UI (HUD), Pause, GameOver, LevelComplete, Settings, Ending
  systems/               SaveSystem, Progression (upgrades/stats), sfx + music synths
tests/                   vitest: state machine, combat, save/progression, level validator (incl. reachability)
```

### Adding a boss
See **`src/entities/bosses/README.md`**: the file checklist, the `Boss` base API, plan/test pattern, art, music, HUD names, unlock order, retry stages, cinematics, and common bugs.

### Adding a level
Create `src/levels/worldN/wN-X.ts` that exports a `LevelDef` built from ASCII rows (the legend is in `src/levels/types.ts`), then add it to that world's `index.ts`. `npm test` checks the layout: rectangular rows, walls, exactly one start and exit, and a coarse reachability check.
