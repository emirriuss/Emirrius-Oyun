/** Gameplay actions. There is no parry button: attacking into a parryable hit parries it. */
export type Action = 'left' | 'right' | 'up' | 'down' | 'jump' | 'attack' | 'dash' | 'special' | 'pause' | 'confirm';

export type KeyMap = Record<Action, string[]>;

export const DEFAULT_KEYS: KeyMap = {
  left: ['LEFT', 'A'],
  right: ['RIGHT', 'D'],
  up: ['UP', 'W'],
  down: ['DOWN', 'S'],
  jump: ['Z', 'SPACE'],
  attack: ['X', 'J'],
  dash: ['C', 'K', 'SHIFT'],
  special: ['F', 'I'],
  pause: ['ESC', 'P'],
  confirm: ['ENTER', 'Z', 'SPACE'],
};

/**
 * Pure key-remap: binds `name` as the primary key of `action` (max 2 keys per action) and
 * removes it from the other `remappable` actions so one key never triggers two gameplay
 * actions. An action left without keys gets the key `action` just lost, else a free default.
 * Keys bound to `pause` are reserved: returns null (the caller treats it as cancel).
 */
export function remapKey(keys: KeyMap, action: Action, name: string, remappable: readonly Action[]): KeyMap | null {
  if ((keys.pause ?? DEFAULT_KEYS.pause).includes(name)) return null;
  const next = structuredClone(keys);
  const old = next[action] ?? [];
  const kept = [name, ...old.filter((k) => k !== name)].slice(0, 2);
  const dropped = old.filter((k) => !kept.includes(k));
  next[action] = kept;
  const used = () => new Set(remappable.flatMap((a) => next[a] ?? []));
  for (const b of remappable) {
    if (b === action || !next[b]?.includes(name)) continue;
    const rest = next[b].filter((k) => k !== name);
    if (!rest.length) {
      const taken = used();
      const spare = dropped.find((k) => !taken.has(k)) ?? DEFAULT_KEYS[b].find((k) => !taken.has(k) && !next.pause.includes(k));
      if (!spare) continue; // nothing free: keep the shared key rather than leave the action unbound
      rest.push(spare);
    }
    next[b] = rest;
  }
  return next;
}

/** Valid, non-empty key list for every action (falls back to defaults per action). */
export function sanitizeKeys(raw: unknown, isKeyName: (k: string) => boolean = () => true): KeyMap {
  const src = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const out = structuredClone(DEFAULT_KEYS);
  for (const a of Object.keys(DEFAULT_KEYS) as Action[]) {
    const v = src[a];
    if (!Array.isArray(v)) continue;
    const list = [...new Set(v.filter((k): k is string => typeof k === 'string' && isKeyName(k)))];
    if (list.length) out[a] = list;
  }
  return out;
}
