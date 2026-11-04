import { describe, it, expect } from 'vitest';
import { report, simulateFight, type SimReport } from '../src/combat/cantorSim';
import { windupMs, floorMs, punishMs, idleMs, expectedChainMs, pickEntropy, beatMs, type CantorMove } from '../src/combat/cantorPlan';
import { SKILL, seeded, type SkillName, type DiffName } from '../src/combat/funMath';

/**
 * The "is it fun?" gate for CANTOR: whole fights simulated with the funMath player model.
 * `npm run sim:cantor` prints the full table (CANTOR_REPORT=1).
 */
const RUNS = 2000;
const cache = new Map<string, SimReport>();
const r = (s: SkillName, d: DiffName): SimReport => {
  const k = s + d;
  if (!cache.has(k)) cache.set(k, report(s, d, RUNS, 7));
  return cache.get(k)!;
};

describe('CANTOR fight simulation', () => {
  it('average player on normal: a winning run takes 100-140 s, every phase 25-55 s', () => {
    const a = r('average', 'normal');
    expect(a.medianWinS).toBeGreaterThanOrEqual(100);
    expect(a.medianWinS).toBeLessThanOrEqual(140);
    for (const s of a.phaseS) {
      expect(s).toBeGreaterThanOrEqual(25);
      expect(s).toBeLessThanOrEqual(55);
    }
  });

  // Flow zone: an average player's attempt is roughly a coin flip (~2 tries). The fairness floor caps
  // it: every P3 telegraph already sits on its Hick floor, so going harder would need sub-floor
  // (unfair) telegraphs or more strike volume, which the model shows crushes novices first.
  it('win-rate bands: novices usually lose, average wins about every other try, experts usually win', () => {
    expect(r('novice', 'normal').winRate).toBeLessThan(0.12);
    const a = r('average', 'normal');
    expect(a.winRate).toBeGreaterThanOrEqual(0.35);
    expect(a.winRate).toBeLessThanOrEqual(0.65);
    expect(r('expert', 'normal').winRate).toBeGreaterThanOrEqual(0.55);
  });

  it('difficulty orders win rates for every skill, and hard is still beatable by experts', () => {
    for (const s of ['novice', 'average', 'expert'] as const) {
      expect(r(s, 'easy').winRate).toBeGreaterThanOrEqual(r(s, 'normal').winRate);
      expect(r(s, 'normal').winRate).toBeGreaterThanOrEqual(r(s, 'hard').winRate);
    }
    expect(r('expert', 'hard').winRate).toBeGreaterThanOrEqual(0.2);
  });

  it('damage budget: average runs use ~80% of HP + hearts, and wins are close calls (1-3.5 HP left)', () => {
    const a = r('average', 'normal');
    expect(a.budgetUsed).toBeGreaterThanOrEqual(0.7);
    expect(a.budgetUsed).toBeLessThanOrEqual(0.95);
    expect(a.winHpLeft).toBeGreaterThanOrEqual(1);
    expect(a.winHpLeft).toBeLessThanOrEqual(3.5);
  });

  // Death is final: once HP reaches 0 no heart (periodic, phase-change or parry) may revive the player.
  it('death ends the fight at once: no healing after 0 HP, a run that died is never a win', () => {
    const fragile = { ...SKILL.novice, maxHp: 2, heartPickup: 1 };
    const rnd = seeded(3);
    let deaths = 0;
    for (let i = 0; i < 2000; i++) {
      const f = simulateFight(fragile, 'normal', rnd);
      if (f.deathMs === null) continue;
      deaths++;
      expect(f.win).toBe(false);
      expect(f.hpLeft).toBe(0);
      expect(f.ms).toBe(f.deathMs);
    }
    expect(deaths).toBeGreaterThan(1000);
  });

  it.runIf(!!(globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.CANTOR_REPORT)('prints the report', () => {
    const moves: CantorMove[] = ['swing', 'toll', 'clapper', 'peal', 'echo', 'synco', 'carillon'];
    const lines = ['move      floor    P1    P2    P3   (first-strike windup, ms)'];
    for (const m of moves) lines.push([m.padEnd(9), ...[floorMs(m), windupMs(m, 0), windupMs(m, 1), windupMs(m, 2)].map((n) => String(n).padStart(5))].join(' '));
    for (const p of [0, 1, 2])
      lines.push(`P${p + 1}: beat ${beatMs(p).toFixed(0)}  chain ${expectedChainMs(p).toFixed(0)}  punish ${punishMs(p)}  idle ${idleMs(p)}  entropy ${pickEntropy(p + 1, 150, false).toFixed(2)} bits`);
    lines.push('', 'skill    diff     win%  tries medWin  P1   P2   P3 (s)  hpLeft budget');
    for (const s of ['novice', 'average', 'expert'] as const)
      for (const d of ['easy', 'normal', 'hard'] as const) {
        const x = r(s, d);
        lines.push([s.padEnd(8), d.padEnd(7), (x.winRate * 100).toFixed(1).padStart(5), x.attempts.toFixed(1).padStart(6), x.medianWinS.toFixed(0).padStart(6), ...x.phaseS.map((v) => v.toFixed(0).padStart(4)), '  ', x.winHpLeft.toFixed(2), x.budgetUsed.toFixed(2)].join(' '));
      }
    console.log(lines.join('\n'));
  });
});
