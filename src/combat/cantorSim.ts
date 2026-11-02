/**
 * Monte Carlo model of a whole CANTOR fight, built only from cantorPlan.ts timings and the
 * funMath.ts player model. It is the "is this fun?" gate: tests/cantorSim.test.ts asserts fight
 * length, win-rate bands and the damage budget; `npm run sim:cantor` prints the report.
 * Abstracted on purpose: no positions, just time, strikes (hit / dodge / parry) and damage windows.
 */
import { SKILL, DIFF, COMBO_DPS, hitProb, median, seeded, type Skill, type SkillName, type DiffName } from './funMath';
import {
  CANTOR_HP, CANTOR_THRESHOLDS, CANTOR_HEARTS, CHAIN, SPEC, CARILLON_PUNISH, VESPERS_TAKEN,
  chooseMove, strikeTimes, moveMs, punishMs, idleMs, strikeGapMs, beatMs, type CantorMove,
} from './cantorPlan';

/** Mirrors Boss / Enemy constants. */
const PARRY_STUN_MS = 900;
const PARRY_MUL = 1.5;
const PUNISH_MUL = 1.25;
const PHASE_MS = 1500;
const HEART_PERIOD = CANTOR_HEARTS.periodicMs;
const HEART_PER_PARRIES = CANTOR_HEARTS.perParries;
/** while threatened the player still sneaks in a little damage (fraction of openEff) */
const CHIP = 0.25;

export interface FightResult {
  win: boolean;
  ms: number;
  hpLeft: number;
  maxHp: number;
  hits: number;
  hearts: number;
  parries: number;
  /** ms spent in each phase (index 0..2) */
  phaseMs: [number, number, number];
}

export function simulateFight(skill: Skill, diff: DiffName, rnd: () => number): FightResult {
  const d = DIFF[diff];
  const maxBoss = CANTOR_HP * d.hpMul;
  const maxHp = skill.maxHp + d.hpBonus;
  const dps = COMBO_DPS * skill.dmgMul;
  let boss = maxBoss, hp = maxHp, t = 0, phase = 1;
  let hits = 0, hearts = 0, parries = 0, heartClock = 0;
  const phaseMs: [number, number, number] = [0, 0, 0];
  const history: CantorMove[] = [];
  const seen = new Set<CantorMove>();

  const pass = (ms: number) => {
    t += ms;
    phaseMs[Math.min(3, phase) - 1] += ms;
    heartClock += ms;
    while (heartClock >= HEART_PERIOD) {
      heartClock -= HEART_PERIOD;
      if (hp < maxHp && rnd() < skill.heartPickup) { hp++; hearts++; }
    }
  };
  const heal = () => { if (rnd() < skill.heartPickup && hp < maxHp) { hp++; hearts++; } };
  /** deal damage; returns true when a phase changed (the chain is interrupted) */
  const deal = (dmg: number): boolean => {
    boss -= dmg * (phase >= 3 ? VESPERS_TAKEN : 1);
    let changed = false;
    while (phase - 1 < CANTOR_THRESHOLDS.length && boss / maxBoss <= CANTOR_THRESHOLDS[phase - 1] && boss > 0) {
      phase++;
      changed = true;
      pass(PHASE_MS);
      heal(); // hearts.onPhase = 1
    }
    return changed;
  };

  while (boss > 0 && hp > 0 && t < 600000) {
    const ph = Math.min(3, phase) - 1;
    let interrupted = false;
    let carillon = false;
    for (let i = 0; i < CHAIN[ph] && !interrupted && hp > 0 && boss > 0; i++) {
      const m = chooseMove(phase, 150 * rnd() + 40, rnd() < 0.15, history, rnd);
      history.push(m);
      if (history.length > 4) history.shift();
      const first = !seen.has(m);
      seen.add(m);
      const s = SPEC[m];
      const n = Math.max(1, s.strikes[ph]);
      pass(rnd() * beatMs(ph)); // waiting for the downbeat
      for (let k = 0; k < n && hp > 0; k++) {
        // first strike answers the full telegraph; follow-ups ride a known rhythm (no choice to make)
        const p = k === 0 ? hitProb(strikeTimes(m, ph, first)[0], s.choices, s.travel, skill) : hitProb(strikeGapMs(ph), 0, 0, skill);
        const dmgBase = k === n - 1 && s.lastDmg ? s.lastDmg : s.dmg;
        if (s.parryable && rnd() < skill.parry) {
          parries++;
          if (parries % HEART_PER_PARRIES === 0) heal();
          if (deal(dps * skill.punishEff * PARRY_MUL * (PARRY_STUN_MS / 1000))) { interrupted = true; break; }
        } else if (rnd() < p) {
          hits++;
          hp -= Math.max(1, Math.round(dmgBase * d.dmgMul));
        }
      }
      const dur = moveMs(m, ph, first);
      pass(dur);
      if (!interrupted && deal(dps * skill.openEff * CHIP * (dur / 1000))) interrupted = true;
      if (m === 'carillon') { carillon = true; break; }
    }
    if (interrupted || hp <= 0 || boss <= 0) continue;
    const pun = carillon ? CARILLON_PUNISH : punishMs(ph);
    pass(pun);
    if (deal(dps * skill.punishEff * PUNISH_MUL * (pun / 1000))) continue;
    const idle = idleMs(ph);
    pass(idle);
    deal(dps * skill.openEff * (idle / 1000));
  }
  return { win: boss <= 0 && hp > 0, ms: t, hpLeft: Math.max(0, hp), maxHp, hits, hearts, parries, phaseMs };
}

export interface SimReport {
  skill: SkillName;
  diff: DiffName;
  runs: number;
  winRate: number;
  /** median fight length of winning runs (s) */
  medianWinS: number;
  /** median seconds per phase in winning runs */
  phaseS: [number, number, number];
  /** mean HP left on winning runs */
  winHpLeft: number;
  /** mean (damage taken) / (max HP + hearts) over all runs: the damage budget used */
  budgetUsed: number;
  /** expected attempts to first win (geometric) */
  attempts: number;
}

export function report(skill: SkillName, diff: DiffName, runs = 5000, seed = 1): SimReport {
  const rnd = seeded(seed);
  const res = Array.from({ length: runs }, () => simulateFight(SKILL[skill], diff, rnd));
  const wins = res.filter((r) => r.win);
  const winRate = wins.length / runs;
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  return {
    skill,
    diff,
    runs,
    winRate,
    medianWinS: median(wins.map((r) => r.ms)) / 1000,
    phaseS: [0, 1, 2].map((i) => median(wins.map((r) => r.phaseMs[i])) / 1000) as [number, number, number],
    winHpLeft: mean(wins.map((r) => r.hpLeft)),
    budgetUsed: mean(res.map((r) => (r.maxHp + r.hearts - r.hpLeft) / (r.maxHp + r.hearts))),
    attempts: winRate > 0 ? 1 / winRate : Infinity,
  };
}
