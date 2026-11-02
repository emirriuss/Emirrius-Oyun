import { describe, it, expect } from 'vitest';
import {
  PINS, NOTCHES, MACS, applyPin, pinStatus, pinsSolved, solvePins, pinRound, makeBitting, makePinLock, springPick, springPin,
  DIAL_N, turnDial, relockDial, makeDial, dialSteps, dialLightHits,
  BOLTS, pressBolt, solveBolts, makeBolts, rekeyPick,
  tumblarWeights, chooseTumblarMove, tumblarResume, TUMBLAR_THRESHOLDS, TUMBLAR_HP, UNLOCK_CHUNK, TELE, ATTACK_GAP,
  type PinLock, type PinState, type DialLock, type DialState, type TumblarMove,
} from '../src/combat/tumblarPlan';
import { seeded } from '../src/combat/funMath';

const allStates = function* (): Generator<PinState> {
  for (let n = 0; n < NOTCHES ** PINS; n++) {
    const h: number[] = [];
    let k = n;
    for (let i = 0; i < PINS; i++) {
      h.push(k % NOTCHES);
      k = Math.floor(k / NOTCHES);
    }
    yield { h, spoolOk: false };
  }
};

/** Follow the hint until open; returns moves taken. */
function walkHints(lock: PinLock, st: PinState): number {
  let n = 0;
  for (;;) {
    const { dist, next } = solvePins(lock, st);
    if (dist === 0) return n;
    expect(next).not.toBeNull();
    const nx = applyPin(lock, st, next!.i, next!.d);
    expect(nx).not.toBeNull();
    expect(solvePins(lock, nx!).dist).toBe(dist - 1);
    st = nx!;
    n++;
  }
}

describe('TUMBLAR pins (phase 1)', () => {
  it('up-slash raises, slam lowers, and a pin can never leave its slot', () => {
    const lock: PinLock = { target: [0, 1, 2, 3, 4], links: [], spool: -1 };
    const st: PinState = { h: [0, 0, 0, 0, 4], spoolOk: false };
    expect(applyPin(lock, st, 1, 1)!.h).toEqual([0, 1, 0, 0, 4]);
    expect(applyPin(lock, st, 0, -1)).toBeNull();
    expect(applyPin(lock, st, 4, 1)).toBeNull();
  });

  it('a linked driver drags its follower (same way or opposite), and jams if the follower would leave its slot', () => {
    const lock: PinLock = { target: [2, 2, 2, 2, 2], links: [{ from: 0, to: 1, sign: -1 }, { from: 2, to: 3, sign: 1 }], spool: -1 };
    const st: PinState = { h: [2, 2, 2, 2, 2], spoolOk: false };
    expect(applyPin(lock, st, 0, 1)!.h).toEqual([3, 1, 2, 2, 2]);
    expect(applyPin(lock, st, 2, -1)!.h).toEqual([2, 2, 1, 1, 2]);
    // follower moves alone
    expect(applyPin(lock, st, 1, 1)!.h).toEqual([2, 3, 2, 2, 2]);
    expect(applyPin(lock, { h: [2, 2, 2, 4, 2], spoolOk: false }, 2, 1)).toBeNull();
  });

  it('a spool pin only counts as set when it is lowered into place (raising into it is a false set)', () => {
    const lock: PinLock = { target: [1, 1, 1, 1, 1], links: [], spool: 2 };
    let st: PinState = { h: [1, 1, 0, 1, 1], spoolOk: false };
    st = applyPin(lock, st, 2, 1)!;
    expect(pinStatus(lock, st, 2)).toBe('false');
    expect(pinsSolved(lock, st)).toBe(false);
    st = applyPin(lock, st, 2, 1)!; // overset
    st = applyPin(lock, st, 2, -1)!; // drop into place
    expect(pinStatus(lock, st, 2)).toBe('set');
    expect(pinsSolved(lock, st)).toBe(true);
  });

  it('bittings obey MACS and use at least 3 depths', () => {
    const rnd = seeded(7);
    for (let n = 0; n < 300; n++) {
      const b = makeBitting(rnd);
      expect(b).toHaveLength(PINS);
      for (let i = 1; i < PINS; i++) expect(Math.abs(b[i] - b[i - 1])).toBeLessThanOrEqual(MACS);
      expect(new Set(b).size).toBeGreaterThanOrEqual(3);
    }
  });

  it('generated locks match their round and start inside the min-move window', () => {
    const rnd = seeded(11);
    for (const round of [0, 1, 2, 3]) {
      const cfg = pinRound(round);
      for (let n = 0; n < 25; n++) {
        const { lock, start } = makePinLock(round, rnd);
        expect(lock.links).toHaveLength(cfg.links);
        expect(lock.spool >= 0).toBe(cfg.spool);
        const used = lock.links.flatMap((l) => [l.from, l.to]);
        expect(new Set(used).size).toBe(used.length); // disjoint pairs
        if (lock.spool >= 0) {
          expect(lock.links.some((l) => l.from === lock.spool)).toBe(false);
          expect(lock.target[lock.spool]).toBeLessThan(NOTCHES - 1);
        }
        const { dist } = solvePins(lock, start);
        expect(dist).toBeGreaterThanOrEqual(cfg.minMoves);
        expect(dist).toBeLessThanOrEqual(cfg.maxMoves);
      }
    }
  });

  it('every state of a generated lock is solvable (so Spring Back can never soft-lock), and the hint always makes progress', () => {
    const rnd = seeded(23);
    for (let n = 0; n < 6; n++) {
      const { lock } = makePinLock(2, rnd);
      let worst = 0;
      for (const st of allStates()) {
        const { dist } = solvePins(lock, st);
        expect(dist).toBeLessThan(Infinity);
        worst = Math.max(worst, dist);
      }
      expect(worst).toBeLessThanOrEqual(24);
      const { start } = makePinLock(2, rnd);
      walkHints(lock, start);
    }
  });

  it('Spring Back moves a set pin to a wrong notch and drops a spool set', () => {
    const rnd = seeded(3);
    const lock: PinLock = { target: [1, 2, 1, 3, 0], links: [], spool: 0 };
    const st: PinState = { h: [1, 2, 0, 0, 0], spoolOk: true };
    for (let n = 0; n < 50; n++) {
      const { i, to } = springPick(lock, st, rnd);
      expect(pinStatus(lock, st, i)).toBe('set');
      expect(to).not.toBe(lock.target[i]);
      expect(to).not.toBe(st.h[i]);
      const after = springPin(lock, st, i, to);
      if (i === 0) expect(after.spoolOk).toBe(false);
    }
  });
});

describe('TUMBLAR dial (phase 2)', () => {
  const lock: DialLock = { combo: [5, 1, 7], dirs: [1, -1, 1] };
  const rest: DialState = { pos: 0, got: 0, last: 0 };

  it('clicks on contact, captures by reversing on the number, slips anywhere else', () => {
    let r = turnDial(lock, rest, 1, 5);
    expect(r.st.pos).toBe(5);
    expect(r.events).toEqual(['contact']);
    // reversing on 5 locks digit 1 and carries on left
    r = turnDial(lock, r.st, -1, 1);
    expect(r.events[0]).toBe('capture');
    expect(r.st.got).toBe(1);
    expect(r.st.pos).toBe(4);
    // overshoot past 1 going left, then reverse on 11: slip, no progress lost
    r = turnDial(lock, r.st, -1, 5);
    expect(r.events).toContain('contact');
    expect(r.st.pos).toBe(11);
    const slip = turnDial(lock, r.st, 1, 1);
    expect(slip.events[0]).toBe('slip');
    expect(slip.st.got).toBe(1);
  });

  it('opens on the third capture', () => {
    let st = rest;
    st = turnDial(lock, st, 1, 5).st;
    st = turnDial(lock, st, -1, 4).st; // capture 5, go to 1
    expect(st.pos).toBe(1);
    st = turnDial(lock, st, 1, 6).st; // capture 1, to 7
    expect(st.got).toBe(2);
    expect(st.pos).toBe(7);
    const r = turnDial(lock, st, -1, 1);
    expect(r.events).toEqual(['capture', 'open']);
    expect(r.st.got).toBe(3);
    // a solved dial ignores further turns
    expect(turnDial(lock, r.st, 1, 3).st).toEqual(r.st);
  });

  it('relock pulls the last digit back out', () => {
    expect(relockDial({ pos: 3, got: 2, last: 1 })).toEqual({ pos: 3, got: 1, last: 0 });
    expect(relockDial({ pos: 3, got: 0, last: 1 }).got).toBe(0);
  });

  it('combinations go right-left-right with 3..8 number legs, never start on 0, and need a bounded number of hits', () => {
    const rnd = seeded(5);
    for (let n = 0; n < 300; n++) {
      const l = makeDial(rnd);
      expect(l.dirs).toEqual([1, -1, 1]);
      expect(l.combo[0]).not.toBe(0);
      let at = 0;
      l.combo.forEach((c, k) => {
        const leg = dialSteps(at, c, l.dirs[k]);
        expect(leg).toBeGreaterThanOrEqual(3);
        expect(leg).toBeLessThanOrEqual(8);
        at = c;
      });
      expect(dialLightHits(l)).toBeLessThanOrEqual(3 * 9);
      // replay the light-hit solution and check it opens in exactly that many hits
      let st: DialState = { pos: 0, got: 0, last: 0 };
      let hits = 0;
      for (let k = 0; k < 3 && st.got < 3; k++) {
        while (st.pos !== l.combo[k]) {
          st = turnDial(l, st, l.dirs[k], 1).st;
          hits++;
        }
        st = turnDial(l, st, (-l.dirs[k]) as 1 | -1, 1).st;
        hits++;
      }
      expect(st.got).toBe(3);
      expect(hits).toBe(dialLightHits(l));
    }
    expect(DIAL_N).toBe(12);
  });
});

describe('TUMBLAR bolts (phase 3)', () => {
  it('a strike flips the bolt and its neighbours', () => {
    expect(pressBolt(0, 0)).toBe(0b00011);
    expect(pressBolt(0, 2)).toBe(0b01110);
    expect(pressBolt(0, 4)).toBe(0b11000);
    expect(pressBolt(pressBolt(0b10101, 3), 3)).toBe(0b10101);
  });

  it('generated bolts are 2..3 strikes from open and the hint walks straight there', () => {
    const rnd = seeded(9);
    for (const round of [0, 1, 2]) {
      for (let n = 0; n < 100; n++) {
        let b = makeBolts(round, rnd);
        const { dist } = solveBolts(b);
        expect(dist).toBeGreaterThanOrEqual(2);
        expect(dist).toBeLessThanOrEqual(3);
        if (round > 0) expect(dist).toBe(3);
        for (let k = dist; k > 0; k--) {
          const { next } = solveBolts(b);
          b = pressBolt(b, next!);
          expect(solveBolts(b).dist).toBe(k - 1);
        }
        expect(b).toBe(0);
      }
    }
  });

  it('re-keying keeps the bolts solvable, never opens them for you, and stays solvable', () => {
    const rnd = seeded(13);
    let b = makeBolts(0, rnd);
    for (let n = 0; n < 500; n++) {
      const i = rekeyPick(b, rnd);
      expect(i).toBeGreaterThanOrEqual(0);
      expect(i).toBeLessThan(BOLTS);
      b = pressBolt(b, i);
      expect(b).not.toBe(0);
      expect(solveBolts(b).dist).toBeLessThanOrEqual(3);
    }
  });
});

describe('TUMBLAR moves and pacing', () => {
  const phaseMoves = (p: number, progress: number) => new Set(tumblarWeights(p, { progress, high: false }).map(([m]) => m));

  it('each phase has its own puzzle-specific pressure move', () => {
    expect(phaseMoves(1, 3).has('spring')).toBe(true);
    expect(phaseMoves(2, 1).has('relock')).toBe(true);
    expect(phaseMoves(3, 1).has('rekey')).toBe(true);
    expect(phaseMoves(1, 3).has('relock')).toBe(false);
    expect(phaseMoves(2, 1).has('spring')).toBe(false);
    // relock only once there is a digit to pull
    expect(phaseMoves(2, 0).has('relock')).toBe(false);
  });

  it('never repeats a move back to back and uses every live move', () => {
    const rnd = seeded(17);
    for (const p of [1, 2, 3]) {
      const ctx = { progress: 2, high: false };
      const hist: TumblarMove[] = [];
      const seen = new Set<TumblarMove>();
      for (let n = 0; n < 400; n++) {
        const m = chooseTumblarMove(p, ctx, hist, rnd);
        if (hist.length) expect(m).not.toBe(hist[hist.length - 1]);
        hist.push(m);
        seen.add(m);
      }
      expect(seen).toEqual(new Set(tumblarWeights(p, ctx).map(([m]) => m)));
    }
  });

  it('telegraphs and gaps never grow from one phase to the next', () => {
    for (const m of Object.keys(TELE) as TumblarMove[]) for (const p of [1, 2]) expect(TELE[m][p]).toBeLessThanOrEqual(TELE[m][p - 1]);
    for (const p of [1, 2]) expect(ATTACK_GAP[p]).toBeLessThanOrEqual(ATTACK_GAP[p - 1]);
  });

  it('unlock chunks alone need 2..4 locks per phase (the punish window shortens that)', () => {
    const span = TUMBLAR_HP * (1 - TUMBLAR_THRESHOLDS[0]);
    expect(Math.ceil(span / UNLOCK_CHUNK)).toBeGreaterThanOrEqual(2);
    expect(Math.ceil(span / UNLOCK_CHUNK)).toBeLessThanOrEqual(4);
  });

  it('resume stages start at the phase threshold', () => {
    expect(tumblarResume(undefined)).toBeNull();
    expect(tumblarResume('p2')).toEqual({ phase: 2, hpFrac: TUMBLAR_THRESHOLDS[0] });
    expect(tumblarResume('p3')).toEqual({ phase: 3, hpFrac: TUMBLAR_THRESHOLDS[1] });
  });
});
