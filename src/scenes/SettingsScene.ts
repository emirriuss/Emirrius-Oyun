import Phaser from 'phaser';
import { GAME_W, GAME_H } from '../config';
import { Menu, type MenuItem } from '../ui/Menu';
import { txt, type PxText } from '../ui/text';
import { panel, hintRow, gradientTexture } from '../ui/Panel';
import { transitionTo } from '../ui/transition';
import { C } from '../art/palette';
import { save, type Difficulty } from '../systems/SaveSystem';
import { DEFAULT_KEYS, type Action } from '../core/InputManager';
import { remapKey } from '../core/keys';
import { setVolume, sfx } from '../systems/sfx';
import { setMusicEnabled, playMusic } from '../systems/music';

const DIFFS: Difficulty[] = ['easy', 'normal', 'hard'];
const REMAP: Action[] = ['jump', 'attack', 'dash', 'special', 'left', 'right', 'up', 'down'];
const NAMES: Record<string, string> = { jump: 'Jump', attack: 'Attack', dash: 'Dash', special: 'Special', left: 'Move left', right: 'Move right', up: 'Up / aim', down: 'Down / drop' };
/** row spacing; 18 rows must fit inside the panel */
const ROW = 12;
const HINT = ['[LEFT]', '[RIGHT]', 'Adjust', '|', '[ENTER]', 'Select / remap', '|', '[ESC]', 'Back'];

export class SettingsScene extends Phaser.Scene {
  private menu!: Menu;
  private from = 'Menu';
  private levelId?: string;
  private waiting: Action | null = null;
  private modal?: Phaser.GameObjects.Container;
  private hint!: Phaser.GameObjects.Container;
  private leaving = false;
  constructor() {
    super('Settings');
  }
  init(d: { from?: string; levelId?: string }): void {
    this.from = d.from ?? 'Menu';
    this.levelId = d.levelId;
    this.waiting = null;
    this.modal = undefined;
    this.leaving = false;
  }
  create(): void {
    const s = save.data.settings;
    if (this.from === 'Pause') this.scene.bringToTop();
    if (this.from === 'Pause') this.add.rectangle(0, 0, GAME_W, GAME_H, C.ink, 0.85).setOrigin(0, 0);
    else {
      this.cameras.main.setBackgroundColor(0x0b0b14);
      this.add.image(0, 0, gradientTexture(this, 'ui-bg-plain', GAME_W, GAME_H, [0x0b0b14, 0x10223a, 0x1d3a5a], 10)).setOrigin(0, 0);
    }
    const cx = GAME_W / 2;
    panel(this, cx, 139, 316, 226, 'dark');
    panel(this, cx, 18, 132, 24, 'ribbon');
    txt(this, cx, 17, 'SETTINGS', 14, '#ffeec2');
    const onOff = (v: boolean) => (v ? 'ON' : 'OFF');
    const items: MenuItem[] = [
      {
        label: 'Volume',
        value: () => '■'.repeat(Math.round(s.volume * 10)) + '□'.repeat(10 - Math.round(s.volume * 10)),
        onAdjust: (d) => {
          s.volume = Phaser.Math.Clamp(Math.round((s.volume + d * 0.1) * 10) / 10, 0, 1);
          setVolume(s.volume);
        },
      },
      {
        label: 'Difficulty',
        value: () => `< ${s.difficulty.toUpperCase()} >`,
        onAdjust: (d) => {
          s.difficulty = DIFFS[(DIFFS.indexOf(s.difficulty) + d + 3) % 3];
        },
        onSelect: () => {
          s.difficulty = DIFFS[(DIFFS.indexOf(s.difficulty) + 1) % 3];
        },
      },
      { label: 'Music', value: () => onOff(s.music), onSelect: () => this.toggleMusic(), onAdjust: () => this.toggleMusic() },
      { label: 'Visual FX', value: () => onOff(s.fx), onSelect: () => (s.fx = !s.fx), onAdjust: () => (s.fx = !s.fx) },
      { label: 'Screen shake', value: () => onOff(s.shake), onSelect: () => (s.shake = !s.shake), onAdjust: () => (s.shake = !s.shake) },
      { label: 'Rumble', value: () => onOff(s.rumble), onSelect: () => (s.rumble = !s.rumble), onAdjust: () => (s.rumble = !s.rumble) },
      // camera rotation / fake-crash greyscale (ERRATUM); off = gentler in-arena versions
      { label: 'Screen tricks', value: () => onOff(s.tricks), onSelect: () => (s.tricks = !s.tricks), onAdjust: () => (s.tricks = !s.tricks) },
      ...REMAP.map<MenuItem>((a) => ({
        label: NAMES[a] ?? a,
        keys: () => s.keys[a],
        onSelect: () => this.startRemap(a),
      })),
      {
        label: 'Reset keys',
        onSelect: () => {
          s.keys = structuredClone(DEFAULT_KEYS);
          this.menu.inp.setKeyMap(s.keys);
        },
      },
      { label: 'Cheats', onSelect: () => this.openCheats() },
      { label: 'Back', onSelect: () => this.back() },
    ];
    this.menu = new Menu(this, cx, 40, items, ROW, 9, { width: 288 });
    this.menu.inp.update(this.time.now);
    // section divider between options and key bindings
    this.add.rectangle(cx - 136, 40 + 5.5 * ROW, 272, 1, C.slate).setOrigin(0, 0.5);
    this.hint = hintRow(this, cx, GAME_H - 11, HINT);

    this.input.keyboard!.on('keydown', (ev: KeyboardEvent) => {
      // ignore auto-repeat of the key that opened the prompt (held ENTER would bind itself)
      if (!this.waiting || ev.repeat) return;
      const name = Object.entries(Phaser.Input.Keyboard.KeyCodes).find(([, v]) => v === ev.keyCode)?.[0];
      // ESC / pause keys cancel; the key is removed from other actions so it never does two things
      const next = name ? remapKey(s.keys, this.waiting, name, REMAP) : null;
      if (next) s.keys = next;
      sfx.confirm();
      this.waiting = null;
      this.modal?.destroy();
      this.modal = undefined;
      this.time.delayedCall(50, () => {
        this.menu.enabled = true;
        this.menu.inp.setKeyMap(s.keys);
        // two polls: a key still held from the prompt (e.g. ESC = back) must not read as a fresh press
        this.menu.inp.update(this.time.now);
        this.menu.inp.update(this.time.now);
        this.menu.refresh();
      });
    });
  }
  private toggleMusic(): void {
    const s = save.data.settings;
    s.music = !s.music;
    setMusicEnabled(s.music);
    if (s.music && this.from !== 'Pause') playMusic('menu');
  }
  private startRemap(a: Action): void {
    this.waiting = a;
    this.menu.enabled = false;
    const cx = GAME_W / 2;
    const cy = GAME_H / 2;
    const parts: Phaser.GameObjects.GameObject[] = [
      this.add.rectangle(0, 0, GAME_W, GAME_H, C.ink, 0.6).setOrigin(0, 0),
      panel(this, cx, cy, 220, 58, 'gold'),
      txt(this, cx, cy - 12, `Press a key for ${(NAMES[a] ?? a).toUpperCase()}`, 9, '#ffd96a'),
      hintRow(this, cx, cy + 10, ['[ESC]', 'Cancel']),
    ];
    const t = parts[2] as PxText;
    this.tweens.add({ targets: t, alpha: 0.5, yoyo: true, repeat: -1, duration: 400 });
    this.modal = this.add.container(0, 0, parts).setDepth(50);
  }
  private openCheats(): void {
    save.save();
    this.scene.start('Cheats', { from: this.from, levelId: this.levelId });
  }
  private back(): void {
    if (this.leaving) return;
    save.save();
    if (this.from === 'Pause') {
      this.scene.start('Pause', { levelId: this.levelId });
    } else {
      this.leaving = true;
      this.menu.enabled = false;
      if (!transitionTo(this, 'Menu')) {
        this.leaving = false;
        this.menu.enabled = true;
      }
    }
  }
  update(time: number): void {
    if (this.waiting) return;
    if (this.menu.enabled && this.menu.inp.justPressed('pause')) {
      this.back();
      return;
    }
    this.menu.update(time);
    void this.hint;
  }
}
