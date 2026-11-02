/**
 * Minimal procedural chiptune sequencer (WebAudio). One looping track per "mood".
 * Notes are scheduled slightly ahead using the audio clock for stable timing.
 */
import { getAudio } from './sfx';

type Track = { bpm: number; bass: number[]; lead: number[]; wave: OscillatorType; leadVol: number };

// MIDI note numbers, 0 = rest. 16 steps per bar, 2 bars.
const n = (s: string) => s.split(' ').map((x) => (x === '.' ? 0 : Number(x)));
const TRACKS: Record<string, Track> = {
  menu: { bpm: 84, wave: 'triangle', leadVol: 0.05,
    bass: n('45 . . . 45 . . . 41 . . . 41 . . . 43 . . . 43 . . . 40 . . . 40 . . .'),
    lead: n('69 . 72 . 76 . 72 . 65 . 69 . 72 . 69 . 67 . 71 . 74 . 71 . 64 . 67 . 71 . 67 .') },
  1: { bpm: 112, wave: 'square', leadVol: 0.035,
    bass: n('43 . 43 . 50 . 43 . 48 . 48 . 55 . 48 . 45 . 45 . 52 . 45 . 50 . 50 . 57 . 50 .'),
    lead: n('67 . 71 74 . 71 72 . 76 . 74 . 72 . 71 . 69 . 72 76 . 72 74 . 78 . 76 . 74 . 72 .') },
  2: { bpm: 104, wave: 'square', leadVol: 0.03,
    bass: n('38 . 38 38 . 38 41 . 36 . 36 36 . 36 40 . 34 . 34 34 . 34 38 . 36 . 36 36 . 36 33 .'),
    lead: n('62 . 65 . 69 . 67 65 64 . 60 . 64 . 67 . 58 . 62 . 65 . 64 62 60 . 64 . 61 . 57 .') },
  3: { bpm: 128, wave: 'sawtooth', leadVol: 0.022,
    bass: n('40 40 . 40 43 . 40 . 39 39 . 39 42 . 39 . 37 37 . 37 40 . 37 . 35 35 . 35 38 . 47 .'),
    lead: n('64 . . 67 . . 71 . 70 . . 67 . 66 . . 61 . . 64 . . 68 . 66 . 64 . 63 . 59 .') },
  4: { bpm: 96, wave: 'triangle', leadVol: 0.045,
    bass: n('38 . . 38 . . 45 . 37 . . 37 . . 44 . 34 . . 34 . . 41 . 33 . . 33 40 . 45 .'),
    lead: n('74 . 77 . 76 . . 72 . 74 . . 69 . . . 70 . 74 . 72 . . 69 . 68 . 69 . . . .') },
  boss: { bpm: 140, wave: 'sawtooth', leadVol: 0.025,
    bass: n('33 33 45 33 33 45 33 44 31 31 43 31 31 43 31 42 29 29 41 29 29 41 29 40 28 28 40 28 32 35 40 44'),
    lead: n('69 . 68 . 69 . 72 . 71 . 69 . 68 . 64 . 65 . 64 . 65 . 69 . 68 . 64 . 59 . 64 . 68 .') },
  final: { bpm: 150, wave: 'sawtooth', leadVol: 0.024,
    bass: n('38 38 50 38 38 50 38 49 36 36 48 36 36 48 36 47 34 34 46 34 34 46 34 45 33 33 45 33 37 40 45 49'),
    lead: n('62 65 69 74 . 72 70 . 69 . 65 . 67 69 . 70 72 . 74 . 77 . 76 74 73 . 69 . 73 . 76 .') },
  // Aurren, the First Blade: driving E-minor duel, the lead answers itself like a sword exchange
  blade: { bpm: 146, wave: 'square', leadVol: 0.028,
    bass: n('40 40 52 40 47 40 52 40 36 36 48 36 43 36 48 36 38 38 50 38 45 38 50 38 35 35 47 35 39 42 47 51'),
    lead: n('64 . 67 71 . 69 67 . 66 . 64 . 67 . 71 . 72 . 71 69 . 67 66 . 67 . 69 . 71 . 75 .') },
  // Aurren, the Hollow Sun: bright and huge, D major turned uneasy (bVI / bVII), choir-like triangle
  sun: { bpm: 156, wave: 'triangle', leadVol: 0.05,
    bass: n('38 38 50 38 45 38 50 45 34 34 46 34 41 34 46 41 36 36 48 36 43 36 48 43 33 33 45 33 37 40 45 49'),
    lead: n('74 . 78 . 81 . 86 . 82 . 81 . 77 . 74 . 76 . 79 . 84 . 81 . 79 77 76 . 73 . 81 .') },
  // Fromage's game show: a jaunty oom-pah-pah waltz (3/4: 12 steps per bar, 4 bars)
  gala: { bpm: 168, wave: 'square', leadVol: 0.032,
    bass: n('41 . . . 57 . . . 57 . . . 36 . . . 55 . . . 55 . . . 36 . . . 52 . . . 52 . . . 41 . . . 57 . . . 53 . . .'),
    lead: n('69 . 72 . 77 . . . 76 . 74 . 72 . . . 70 . 67 . . . 64 . 67 . 70 . 72 . 70 . 67 . 69 . . . 65 . . . . . 60 .') },
  // ERRATUM: a nervous typewriter waltz in A minor; the lead is "typed" in staccato repeats
  erratum: { bpm: 138, wave: 'square', leadVol: 0.03,
    bass: n('45 . 52 . 45 . 52 . 41 . 48 . 41 . 48 . 43 . 50 . 43 . 50 . 40 . 47 . 44 . 47 .'),
    lead: n('76 76 . 72 . 69 . 72 74 74 . 72 . 71 . 69 72 72 . 69 . 67 . 69 71 . 68 . 64 . 68 71') },
  // Draft 3: the same tune misprinted: detuned saw, semitone slips, missing beats
  erratum3: { bpm: 152, wave: 'sawtooth', leadVol: 0.022,
    bass: n('45 45 . 46 45 . 52 51 41 41 . 42 41 . 48 47 43 . 43 44 . 43 50 . 40 40 . 41 44 . 47 46'),
    lead: n('76 . 77 72 . 69 . 73 74 . 75 72 . 71 70 . 72 . 73 69 . 67 . 68 71 . 68 . 64 65 . 71') },
  // ORRATH (P1-P2): slow, huge D minor; a tolling bell over a low octave drone
  colossus: { bpm: 88, wave: 'triangle', leadVol: 0.055,
    bass: n('38 . . . 50 . . . 38 . . . 50 . 48 . 41 . . . 53 . . . 43 . . . 55 . 53 .'),
    lead: n('74 . . . . . 72 . 69 . . . . . . . 77 . . . 76 . 74 . 72 . . . 69 . . .') },
  // ORRATH, falling: the same bell motif, twice as fast, driving saw bass
  colossus3: { bpm: 152, wave: 'sawtooth', leadVol: 0.024,
    bass: n('38 38 50 38 38 50 38 48 41 41 53 41 41 53 41 52 43 43 55 43 43 55 43 53 36 36 48 36 40 43 48 52'),
    lead: n('74 . 77 . 76 74 72 . 69 . 72 . 74 . 77 . 79 . 77 76 . 74 72 . 74 . 76 . 81 . 79 .') },
  // CANTOR: a change-ringing round in D minor; bass on every beat so the tempo IS the telegraph.
  // Same tune at the boss's three tempos (100 / 115 / 130 BPM = cantorPlan BPM).
  cantor: { bpm: 100, wave: 'triangle', leadVol: 0.05,
    bass: n('38 . . . 45 . . . 38 . . . 45 . . . 34 . . . 41 . . . 33 . . . 40 . . .'),
    lead: n('74 . 72 . 70 . 69 . 74 . 72 . 70 . 69 . 70 . 69 . 67 . 65 . 69 . . . 64 . . .') },
  cantor2: { bpm: 115, wave: 'square', leadVol: 0.03,
    bass: n('38 . 50 . 45 . 50 . 38 . 50 . 45 . 50 . 34 . 46 . 41 . 46 . 33 . 45 . 40 . 45 .'),
    lead: n('74 . 72 70 . 69 . 74 72 . 70 69 . 74 . 77 70 . 69 67 . 65 . 69 . 67 64 . 61 . 64 .') },
  // TUMBLAR: a clockwork lullaby in E minor; plucky staccato like tumblers falling, gets busier per lock.
  tumblar: { bpm: 96, wave: 'triangle', leadVol: 0.05,
    bass: n('40 . 47 . 40 . 47 . 36 . 43 . 36 . 43 . 38 . 45 . 38 . 45 . 35 . 42 . 47 . 42 .'),
    lead: n('76 . 79 . 83 . . . 81 79 . . 76 . . . 74 . 78 . 81 . . . 79 78 . 74 71 . . .') },
  tumblar2: { bpm: 108, wave: 'square', leadVol: 0.028,
    bass: n('40 52 47 52 40 52 47 52 36 48 43 48 36 48 43 48 38 50 45 50 38 50 45 50 35 47 42 47 35 47 42 47'),
    lead: n('76 . 79 83 . 81 79 . 76 . 72 76 . 79 76 . 74 . 78 81 . 79 78 . 74 . 71 74 . 78 75 .') },
  tumblar3: { bpm: 124, wave: 'sawtooth', leadVol: 0.022,
    bass: n('40 40 52 47 40 40 52 47 36 36 48 43 36 36 48 43 38 38 50 45 38 38 50 45 35 35 47 42 39 42 47 51'),
    lead: n('88 . 83 79 83 . 76 79 84 . 79 76 79 . 72 76 86 . 81 78 81 . 74 78 83 . 78 75 78 . 71 75') },
  cantor3: { bpm: 130, wave: 'sawtooth', leadVol: 0.022,
    bass: n('38 38 . 50 45 . 50 . 38 38 . 50 45 . 50 . 34 34 . 46 41 . 46 . 33 33 . 45 40 . 44 .'),
    lead: n('74 77 72 70 . 69 74 . 72 70 . 69 81 . 77 74 70 69 . 67 65 . 69 . 67 64 . 61 64 . 69 .') },
  // UMBRA: a slow lamplit waltz-ish creep in B minor, lots of air (the shadow fills the rests)
  umbra: { bpm: 88, wave: 'triangle', leadVol: 0.045,
    bass: n('35 . . . . . 42 . 35 . . . 40 . . . 31 . . . . . 38 . 30 . . . 37 . 33 .'),
    lead: n('71 . . 74 . . 73 . 71 . 66 . . . . . 67 . . 71 . . 69 . 66 . . 64 . 61 .') },
  // UMBRA, lights out: the same line, faster, over a pulsing saw bass
  umbra3: { bpm: 126, wave: 'sawtooth', leadVol: 0.022,
    bass: n('35 35 . 42 35 . 40 . 35 35 . 42 35 . 40 . 31 31 . 38 31 . 37 . 30 30 . 37 33 . 34 .'),
    lead: n('71 . 74 73 . 71 66 . 71 74 . 78 . 76 74 . 67 . 71 69 . 67 66 . 64 66 . 69 . 66 61 .') },
};

const freq = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

let current: string | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let step = 0;
let nextTime = 0;
let bus: GainNode | null = null;
let enabled = true;

// Persistent output chain shared by every track: track bus -> duck gain -> lowpass -> sfx master.
// Built once per AudioContext so duck/muffle state survives playMusic/stopMusic switches.
const OPEN_FREQ = 20000;
let chain: { ctx: AudioContext; duck: GainNode; filter: BiquadFilterNode } | null = null;
let muffleFreq: number | null = null;

function musicOut(ctx: AudioContext, master: GainNode): AudioNode {
  if (!chain || chain.ctx !== ctx) {
    const duck = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = muffleFreq ?? OPEN_FREQ;
    filter.Q.value = 0.7;
    duck.connect(filter).connect(master);
    chain = { ctx, duck, filter };
  }
  return chain.duck;
}

/**
 * Briefly ducks the music: drops its level by `amount` (0..1, 1 = silent) in ~25ms, then ramps back
 * to full over `ms`. Overlapping ducks restart from the current level. No-op before audio starts.
 */
export function duckMusic(amount: number, ms: number): void {
  if (!chain) return;
  const g = chain.duck.gain;
  const t = chain.ctx.currentTime;
  const target = Math.max(0, Math.min(1, 1 - amount));
  const cur = g.value;
  g.cancelScheduledValues(t);
  g.setValueAtTime(cur, t);
  g.linearRampToValueAtTime(Math.min(cur, target), t + 0.025);
  g.linearRampToValueAtTime(1, t + 0.025 + Math.max(0, ms) / 1000);
}

/**
 * Muffles the music with a lowpass at `freq` Hz (on) or opens it back to ~20kHz (off), with a smooth
 * ~250ms ramp. The state persists across track switches and applies once audio starts.
 */
export function muffleMusic(on: boolean, freq = 700): void {
  muffleFreq = on ? Math.max(40, freq) : null;
  if (!chain) return;
  const f = chain.filter.frequency;
  const t = chain.ctx.currentTime;
  f.cancelScheduledValues(t);
  f.setValueAtTime(Math.max(1, f.value), t);
  f.exponentialRampToValueAtTime(muffleFreq ?? OPEN_FREQ, t + 0.25);
}

const muffleReasons = new Set<string>();
/**
 * Reason-tracked muffle (e.g. 'pause', 'lowhp'): the music stays muffled while any reason is on,
 * so closing the pause menu doesn't un-muffle a low-HP muffle and vice versa.
 */
export function setMuffle(reason: string, on: boolean, freq = 700): void {
  const was = muffleReasons.size > 0;
  if (on) muffleReasons.add(reason);
  else muffleReasons.delete(reason);
  const now = muffleReasons.size > 0;
  if (now !== was) muffleMusic(now, freq);
}

export function setMusicEnabled(on: boolean): void {
  enabled = on;
  if (!on) stopMusic();
}

export function playMusic(key: string): void {
  if (!enabled) return;
  if (current === key && timer) return;
  stopMusic();
  const a = getAudio();
  if (!a) return;
  const { ctx, master } = a;
  const track = TRACKS[key];
  if (!track) return;
  current = key;
  bus = ctx.createGain();
  bus.gain.value = 0;
  bus.gain.linearRampToValueAtTime(1, ctx.currentTime + 1);
  bus.connect(musicOut(ctx, master));
  step = 0;
  nextTime = ctx.currentTime + 0.1;
  const stepDur = 60 / track.bpm / 4;
  const out = bus;
  timer = setInterval(() => {
    while (nextTime < ctx.currentTime + 0.2) {
      const i = step % track.bass.length;
      const b = track.bass[i];
      if (b) note(ctx, out, freq(b), stepDur * 1.8, 'triangle', 0.09, nextTime);
      const l = track.lead[i % track.lead.length];
      if (l) note(ctx, out, freq(l), stepDur * 0.9, track.wave, track.leadVol, nextTime);
      if (i % 4 === 0) hat(ctx, out, nextTime, i % 8 === 0 ? 0.05 : 0.025);
      nextTime += stepDur;
      step++;
    }
  }, 50);
}

export function stopMusic(): void {
  if (timer) clearInterval(timer);
  timer = null;
  current = null;
  if (bus) {
    const b = bus;
    const a = getAudio();
    if (a) b.gain.linearRampToValueAtTime(0, a.ctx.currentTime + 0.3);
    setTimeout(() => b.disconnect(), 400);
    bus = null;
  }
}

function note(ctx: AudioContext, out: AudioNode, f: number, dur: number, wave: OscillatorType, vol: number, t: number): void {
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = wave;
  o.frequency.value = f;
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(out);
  o.start(t);
  o.stop(t + dur + 0.02);
}

let hatBuf: AudioBuffer | null = null;
function hat(ctx: AudioContext, out: AudioNode, t: number, vol: number): void {
  if (!hatBuf) {
    hatBuf = ctx.createBuffer(1, ctx.sampleRate * 0.05, ctx.sampleRate);
    const d = hatBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
  }
  const s = ctx.createBufferSource();
  s.buffer = hatBuf;
  const f = ctx.createBiquadFilter();
  f.type = 'highpass';
  f.frequency.value = 7000;
  const g = ctx.createGain();
  g.gain.value = vol;
  s.connect(f).connect(g).connect(out);
  s.start(t);
}
