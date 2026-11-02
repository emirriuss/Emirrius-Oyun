import type Phaser from 'phaser';
import { LEVELS } from '../levels';
import { save } from './SaveSystem';

/**
 * Testing cheats: a small DOM panel (outside Phaser, so it works on every screen).
 * Toggle with F9. Shown by default in dev builds. (The in-game menu is Settings > Cheats, see ./cheats.ts.)
 */
export function installCheats(game: Phaser.Game): void {
  const box = document.createElement('div');
  box.style.cssText =
    'position:fixed;top:8px;right:8px;z-index:9999;display:flex;flex-direction:column;gap:4px;' +
    'padding:6px;background:rgba(11,11,20,.85);border:1px solid #5d5b7a;border-radius:4px;' +
    'font:12px monospace;color:#c2c3d6;user-select:none';
  const title = document.createElement('div');
  title.textContent = 'CHEATS (F9)';
  title.style.cssText = 'color:#ffd96a;text-align:center';
  box.appendChild(title);

  const btn = (label: string, fn: () => void) => {
    const b = document.createElement('button');
    b.textContent = label;
    b.style.cssText = 'font:12px monospace;cursor:pointer;background:#22223a;color:#c2c3d6;border:1px solid #5d5b7a;padding:3px 6px';
    // keep focus on the game canvas so keyboard input isn't swallowed
    b.addEventListener('mousedown', (e) => e.preventDefault());
    b.addEventListener('pointerdown', (e) => e.stopPropagation());
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      fn();
      save.save();
      refresh(game);
    });
    box.appendChild(b);
  };

  btn('+50 gold', () => save.addShards(50));
  btn('+500 gold', () => save.addShards(500));
  btn('Unlock next level', () => {
    const next = LEVELS.find((l) => !save.isCompleted(l.id));
    if (next) markDone(next.id);
  });
  btn('Unlock all levels', () => LEVELS.forEach((l) => markDone(l.id)));
  btn('Lock all levels', () => {
    save.data.completed = [];
    save.data.records = {};
  });

  let visible = import.meta.env.DEV;
  const apply = () => (box.style.display = visible ? 'flex' : 'none');
  apply();
  window.addEventListener('keydown', (e) => {
    if (e.key === 'F9') {
      visible = !visible;
      apply();
      e.preventDefault();
    }
  });
  document.body.appendChild(box);
}

/** Mark a level cleared without touching an existing best record. */
function markDone(id: string): void {
  if (!save.isCompleted(id)) save.data.completed.push(id);
}

/** Redraw screens that only read the save in create(). */
function refresh(game: Phaser.Game): void {
  for (const key of ['WorldMap', 'Shrine']) {
    const s = game.scene.getScene(key);
    if (s && game.scene.isActive(key)) s.scene.restart();
  }
}
