import Phaser from 'phaser';

import { DEFAULT_KEYS, type Action, type KeyMap } from './keys';
export { DEFAULT_KEYS, type Action, type KeyMap };

// Standard gamepad mapping (button indices)
const PAD: Partial<Record<Action, number[]>> = {
  jump: [0],
  attack: [2],
  dash: [1, 7],
  special: [3, 5],
  pause: [9],
  confirm: [0, 9],
  up: [12],
  down: [13],
  left: [14],
  right: [15],
};

const ACTIONS = Object.keys(DEFAULT_KEYS) as Action[];

/**
 * Polls keyboard + gamepad once per frame and exposes held / pressed / released
 * per action, plus a short press buffer used for jump buffering and combos.
 */
export class InputManager {
  private keys = new Map<Action, Phaser.Input.Keyboard.Key[]>();
  private held = new Map<Action, boolean>();
  private prevHeld = new Map<Action, boolean>();
  private lastPress = new Map<Action, number>();
  private holdStart = new Map<Action, number>();
  private now = 0;
  /** keyCodes pressed since last update (catches taps shorter than a frame) */
  private pending = new Set<number>();
  /** mouse buttons pressed since last update */
  private pendingMouse = new Set<number>();
  /**
   * mouse buttons whose press this scene saw. A button held down from a click in another
   * scene (e.g. clicking "Resume" / "Retry" in a menu) must not count as an attack/special.
   */
  private mouseArmed = new Set<number>();
  /** keyCodes whose initial (non-repeat) keydown this manager saw */
  private seenDown = new Set<number>();
  /**
   * keyCodes that only reached this scene as OS auto-repeat (held from before the scene
   * started / resumed, e.g. ESC held while the pause menu opens). Ignored until released,
   * otherwise holding ESC toggles pause on and off every repeat.
   */
  private repeatOnly = new Set<number>();

  /**
   * @param mouse enable mouse bindings (left click = attack, right click = special).
   *              Off for menus, whose items handle clicks themselves.
   */
  constructor(private scene: Phaser.Scene, keyMap: KeyMap = DEFAULT_KEYS, private mouse = false) {
    this.setKeyMap(keyMap);
    const onDown = (ev: KeyboardEvent) => {
      if (ev.repeat) {
        if (!this.seenDown.has(ev.keyCode)) this.repeatOnly.add(ev.keyCode);
        return;
      }
      this.seenDown.add(ev.keyCode);
      this.repeatOnly.delete(ev.keyCode);
      this.pending.add(ev.keyCode);
    };
    const onUp = (ev: KeyboardEvent) => {
      this.seenDown.delete(ev.keyCode);
      this.repeatOnly.delete(ev.keyCode);
    };
    const kb = scene.input.keyboard!;
    kb.on('keydown', onDown);
    kb.on('keyup', onUp);
    // Phaser resets this scene's keys on pause; a held key comes back via repeat on resume.
    // That's fine for movement, but a still-held pause key must not re-pause right away.
    const forgetKeys = () => this.keys.get('pause')?.forEach((k) => this.seenDown.delete(k.keyCode));
    scene.events.on('pause', forgetKeys);
    const onPointer = (p: Phaser.Input.Pointer) => {
      this.pendingMouse.add(p.button);
      this.mouseArmed.add(p.button);
    };
    const disarm = () => this.mouseArmed.clear();
    if (mouse) {
      scene.input.on('pointerdown', onPointer);
      scene.events.on('pause', disarm);
      scene.events.on('resume', disarm);
    }
    scene.events.once('shutdown', () => {
      kb.off('keydown', onDown);
      kb.off('keyup', onUp);
      scene.events.off('pause', forgetKeys);
      scene.input.off('pointerdown', onPointer);
      scene.events.off('pause', disarm);
      scene.events.off('resume', disarm);
    });
  }

  private mouseDown(a: Action): boolean {
    if (!this.mouse) return false;
    const p = this.scene.input.activePointer;
    if (a === 'attack') return (p.leftButtonDown() && this.mouseArmed.has(0)) || this.pendingMouse.has(0);
    if (a === 'special') return (p.rightButtonDown() && this.mouseArmed.has(2)) || this.pendingMouse.has(2);
    return false;
  }

  setKeyMap(map: KeyMap): void {
    const kb = this.scene.input.keyboard!;
    this.keys.clear();
    const valid = (c: unknown): c is string => typeof c === 'string' && Phaser.Input.Keyboard.KeyCodes[c.toUpperCase() as keyof typeof Phaser.Input.Keyboard.KeyCodes] !== undefined;
    for (const a of ACTIONS) {
      // unknown / empty bindings (corrupt save) fall back to the defaults instead of leaving the action dead
      const mapped = Array.isArray(map[a]) ? map[a].filter(valid) : [];
      const codes = mapped.length ? mapped : DEFAULT_KEYS[a];
      this.keys.set(
        a,
        codes.map((c) => kb.addKey(c, true, false)),
      );
    }
  }

  update(time: number): void {
    this.now = time;
    const pad = this.scene.input.gamepad?.pad1;
    for (const a of ACTIONS) {
      let down = this.keys.get(a)!.some((k) => (k.isDown && !this.repeatOnly.has(k.keyCode)) || this.pending.has(k.keyCode)) || this.mouseDown(a);
      if (pad) {
        const btns = PAD[a];
        if (btns && btns.some((i) => pad.buttons[i]?.pressed)) down = true;
        const ax = pad.axes[0]?.getValue() ?? 0;
        const ay = pad.axes[1]?.getValue() ?? 0;
        if (a === 'left' && ax < -0.4) down = true;
        if (a === 'right' && ax > 0.4) down = true;
        if (a === 'up' && ay < -0.5) down = true;
        if (a === 'down' && ay > 0.5) down = true;
      }
      const was = this.held.get(a) ?? false;
      this.prevHeld.set(a, was);
      this.held.set(a, down);
      if (down && !was) {
        this.lastPress.set(a, time);
        this.holdStart.set(a, time);
      }
    }
    this.pending.clear();
    this.pendingMouse.clear();
  }

  isDown(a: Action): boolean {
    return this.held.get(a) ?? false;
  }
  justPressed(a: Action): boolean {
    return (this.held.get(a) ?? false) && !(this.prevHeld.get(a) ?? false);
  }
  justReleased(a: Action): boolean {
    return !(this.held.get(a) ?? false) && (this.prevHeld.get(a) ?? false);
  }
  /** True if action was pressed within the last `ms` and not yet consumed. */
  buffered(a: Action, ms: number): boolean {
    const t = this.lastPress.get(a);
    return t !== undefined && this.now - t <= ms;
  }
  consume(a: Action): void {
    this.lastPress.delete(a);
  }
  holdTime(a: Action): number {
    if (!this.isDown(a)) return 0;
    return this.now - (this.holdStart.get(a) ?? this.now);
  }
  axisX(): number {
    return (this.isDown('right') ? 1 : 0) - (this.isDown('left') ? 1 : 0);
  }
}
