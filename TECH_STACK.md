# Emirrius: Tech Stack

Emirrius is a 2D action-platformer that runs in the browser and as a desktop app. This page lists the technology it uses. For gameplay and controls, see [README.md](README.md).

## Technologies

| Area | Technology |
|---|---|
| Language | **TypeScript** (about 31k lines in `src/`) |
| Game engine | **Phaser 3** (WebGL renderer, Arcade physics, scenes, gamepad input) |
| Build / dev server | **Vite** |
| Tests | **Vitest** |
| Desktop app | **Electron**, packaged with **electron-builder** (Windows portable + installer, Linux AppImage) |
| Graphics | Pixel art generated in code at runtime on 2D canvases. There are no image files. |
| Visual effects | Phaser pre/post-FX pipelines and lights (vignette, colour grading, glows) |
| Audio | **Web Audio API** with synthesized music and sound effects (oscillators and filters). There are no audio files. |
| Save data | Browser `localStorage` |
| Levels | Plain ASCII grids written in TypeScript files, parsed at load time |

Phaser is the only library the game uses at runtime. There is no backend, server, or database.

## What's in the repo

```
index.html          entry page
src/
  main.ts           boots Phaser
  config.ts         gameplay tuning values
  art/              code-generated pixel art, palette, pixel font
  core/             state machine, input buffering, game feel (hitstop/shake), FX
  combat/           hitboxes, damage, boss fight-balancing math
  entities/         player, enemies, bosses
  levels/           ASCII levels for worlds 1-4
  scenes/           menu, world map, game, HUD, pause, settings, etc.
  systems/          saving, progression, music/SFX synths
  ui/               UI helpers
tests/              Vitest unit tests, level validator, boss fight simulations
electron/main.cjs   desktop window wrapper
vite.config.ts      build config
tsconfig.json       TypeScript config
```

## Commands

```bash
npm install
npm run dev          # dev server at http://localhost:5173
npm test             # run the tests
npm run build        # typecheck + production build into dist/
npm run electron     # run as a desktop app
npm run dist:win     # build Windows .exe files into release/
npm run dist:linux   # build a Linux AppImage into release/
```
