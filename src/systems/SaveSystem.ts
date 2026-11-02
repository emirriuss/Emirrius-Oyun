import { DEFAULT_KEYS, sanitizeKeys, type KeyMap } from '../core/keys';

export type Difficulty = 'easy' | 'normal' | 'hard';
export type UpgradeId =
  | 'maxHp' | 'damage' | 'stamina' | 'energySlash' | 'comboPlus' | 'doubleJump' | 'airDash'
  | 'parryWard' | 'fleetStep' | 'lodestone' | 'bloodPact' | 'secondWind';

export interface LevelRecord {
  rank: string;
  timeMs: number;
}

export interface SaveData {
  version: number;
  completed: string[];
  records: Record<string, LevelRecord>;
  shards: number;
  upgrades: Partial<Record<UpgradeId, number>>;
  settings: { volume: number; music: boolean; fx: boolean; difficulty: Difficulty; keys: KeyMap; shake: boolean; rumble: boolean; tricks: boolean };
}

export interface Storage {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
}

const KEY = 'emirrius-save-v1';
/**
 * Save format version. History:
 *  1: initial
 *  2: w4-2 became the Gilded Croupier; Moth w4-2 -> w4-3, Aurren w4-3 -> w4-4, Fromage w4-4 -> w4-5 (see migrateSave)
 */
export const SAVE_VERSION = 2;

export function defaultSave(): SaveData {
  return {
    version: SAVE_VERSION,
    completed: [],
    records: {},
    shards: 0,
    upgrades: {},
    settings: { volume: 0.5, music: true, fx: true, difficulty: 'normal', keys: structuredClone(DEFAULT_KEYS), shake: true, rumble: true, tricks: true },
  };
}

function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k) };
}

function browserStorage(): Storage {
  try {
    // accessing localStorage throws in some sandboxed / privacy contexts
    if (typeof localStorage !== 'undefined' && localStorage) return localStorage;
  } catch {
    /* fall through */
  }
  return memoryStorage();
}

export class SaveSystem {
  data: SaveData;
  private storage: Storage;

  constructor(storage?: Storage) {
    this.storage = storage ?? browserStorage();
    this.data = this.load();
  }

  load(): SaveData {
    let raw: string | null = null;
    try {
      raw = this.storage.getItem(KEY);
    } catch {
      return defaultSave();
    }
    if (!raw) return defaultSave();
    try {
      return migrateSave(JSON.parse(raw));
    } catch {
      return defaultSave();
    }
  }

  save(): void {
    try {
      this.storage.setItem(KEY, JSON.stringify(this.data));
    } catch {
      // storage full / unavailable (private mode): keep playing with the in-memory save
    }
  }

  reset(): void {
    const settings = this.data.settings;
    this.data = defaultSave();
    this.data.settings = settings;
    this.save();
  }

  isCompleted(id: string): boolean {
    return this.data.completed.includes(id);
  }

  /** Record a level clear; keeps the best rank/time. */
  completeLevel(id: string, rec: LevelRecord): void {
    if (!this.isCompleted(id)) this.data.completed.push(id);
    const prev = this.data.records[id];
    if (!prev || rankValue(rec.rank) > rankValue(prev.rank) || (rec.rank === prev.rank && rec.timeMs < prev.timeMs)) {
      this.data.records[id] = rec;
    }
    this.save();
  }

  upgradeLevel(id: UpgradeId): number {
    return this.data.upgrades[id] ?? 0;
  }

  addShards(n: number): void {
    this.data.shards = Math.max(0, this.data.shards + n);
  }
}

const DIFFICULTIES: Difficulty[] = ['easy', 'normal', 'hard'];
const UPGRADE_IDS: UpgradeId[] = [
  'maxHp', 'damage', 'stamina', 'energySlash', 'comboPlus', 'doubleJump', 'airDash',
  'parryWard', 'fleetStep', 'lodestone', 'bloodPact', 'secondWind',
];

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const num = (v: unknown, def: number, min = -Infinity, max = Infinity): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : def;
const bool = (v: unknown, def: boolean): boolean => (typeof v === 'boolean' ? v : def);

/**
 * Builds a valid SaveData from anything parsed out of storage: older saves missing newer
 * fields (music, fx, ...), wrong types and hand-edited garbage all fall back per field.
 */
export function migrateSave(parsed: unknown): SaveData {
  const d = defaultSave();
  if (!isObj(parsed)) return d;
  const completed = Array.isArray(parsed.completed) ? [...new Set(parsed.completed.filter((x): x is string => typeof x === 'string'))] : d.completed;
  const records: Record<string, LevelRecord> = {};
  if (isObj(parsed.records)) {
    for (const [id, r] of Object.entries(parsed.records)) {
      if (isObj(r) && typeof r.rank === 'string' && rankValue(r.rank) >= 0 && typeof r.timeMs === 'number' && Number.isFinite(r.timeMs)) {
        records[id] = { rank: r.rank, timeMs: r.timeMs };
      }
    }
  }
  const upgrades: SaveData['upgrades'] = {};
  if (isObj(parsed.upgrades)) {
    for (const id of UPGRADE_IDS) {
      const v = parsed.upgrades[id];
      if (typeof v === 'number' && Number.isFinite(v) && v > 0) upgrades[id] = Math.floor(v);
    }
  }
  const version = num(parsed.version, 1);
  if (version < 2) {
    // v1 world 4 was w4-2 Moth, w4-3 Aurren, w4-4 Fromage; the Croupier took w4-2, so each moves up one.
    // Highest first so nothing is overwritten. A v1 Moth clear also counts the new Croupier stage as cleared.
    const hadMoth = completed.includes('w4-2');
    for (const [from, to] of [['w4-4', 'w4-5'], ['w4-3', 'w4-4'], ['w4-2', 'w4-3']] as const) {
      const i = completed.indexOf(from);
      if (i >= 0) completed[i] = to;
      if (records[from]) {
        records[to] = records[from];
        delete records[from];
      }
    }
    if (hadMoth && !completed.includes('w4-2')) completed.push('w4-2');
  }
  const s = isObj(parsed.settings) ? parsed.settings : {};
  return {
    version: SAVE_VERSION,
    completed,
    records,
    shards: Math.floor(num(parsed.shards, 0, 0)),
    upgrades,
    settings: {
      volume: num(s.volume, d.settings.volume, 0, 1),
      music: bool(s.music, d.settings.music),
      fx: bool(s.fx, d.settings.fx),
      difficulty: DIFFICULTIES.includes(s.difficulty as Difficulty) ? (s.difficulty as Difficulty) : d.settings.difficulty,
      keys: sanitizeKeys(s.keys),
      shake: bool(s.shake, d.settings.shake),
      rumble: bool(s.rumble, d.settings.rumble),
      tricks: bool(s.tricks, d.settings.tricks),
    },
  };
}

const RANKS = ['C', 'B', 'A', 'S'];
export function rankValue(r: string): number {
  return RANKS.indexOf(r);
}

/** Pure rank calculation for a level result. */
export function computeRank(timeMs: number, parMs: number, damageTaken: number, killRatio: number): string {
  let score = 0;
  if (timeMs <= parMs) score += 2;
  else if (timeMs <= parMs * 1.5) score += 1;
  if (damageTaken === 0) score += 2;
  else if (damageTaken <= 2) score += 1;
  if (killRatio >= 0.9) score += 2;
  else if (killRatio >= 0.5) score += 1;
  if (score >= 6) return 'S';
  if (score >= 5) return 'A'; // skipping every enemy can no longer earn A
  if (score >= 3) return 'B';
  return 'C';
}

/** Global singleton used by scenes. */
export const save = new SaveSystem();
