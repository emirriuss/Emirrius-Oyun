import type { LevelDef } from '../types';
import { W4_1 } from './w4-1';
import { W4_2 } from './w4-2';
import { W4_3 } from './w4-3';
import { W4_4 } from './w4-4';
import { W4_5 } from './w4-5';
import { W4_6 } from './w4-6';
import { W4_7 } from './w4-7';
import { W4_8 } from './w4-8';
import { W4_9 } from './w4-9';
import { W4_10 } from './w4-10';

/**
 * World 4 (The Hollow Deep): pure boss arenas, unlocked after the Hollow King.
 * w4-1 Chained Warden, w4-2 Gilded Croupier, w4-3 Eclipse Moth (final boss, ending).
 * w4-4 is the post-game secret (Aurren, true ending), unlocked by clearing w4-3.
 * w4-5 is the encore (Monsieur Fromage), unlocked by clearing w4-4.
 * w4-6 is the misprint (ERRATUM, the Unwritten), unlocked by clearing w4-5.
 * w4-7 is the sleeping mountain (ORRATH, the Buried Colossus), unlocked by clearing w4-6.
 * w4-8 is the belfry (CANTOR, the Tolling Bell), the math-tuned boss, unlocked by clearing w4-7.
 * w4-9 is the vault (TUMBLAR, the Keyless Door), the lock-picking puzzle boss, unlocked by clearing w4-8.
 * w4-10 is the lantern hall (UMBRA, the Cast Shadow), unlocked by clearing w4-9.
 * World map: w4-1..w4-3 sit on world 4's page; the post-game w4-4..w4-10 (`region: 'margin'`) get
 * their own "The Margin" page after it, each appearing once unlocked (7 slots max).
 */
export const WORLD4: LevelDef[] = [W4_1, W4_2, W4_3, W4_4, W4_5, W4_6, W4_7, W4_8, W4_9, W4_10];
