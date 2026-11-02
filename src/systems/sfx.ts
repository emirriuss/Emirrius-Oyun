/** Tiny WebAudio synth. All sounds are generated, no files. */
type Wave = OscillatorType;

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let volume = 0.5;

function ac(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!ctx) {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = volume;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

/** Shared context for the music sequencer. */
export function getAudio(): { ctx: AudioContext; master: GainNode } | null {
  const c = ac();
  return c && master ? { ctx: c, master } : null;
}

export function setVolume(v: number): void {
  volume = Math.max(0, Math.min(1, v));
  if (master) master.gain.value = volume;
}

/** Random pitch (±6%) and volume (±15%) jitter applied by default so repeated sounds don't machine-gun. */
export const SFX_JITTER = { pitch: 0.06, vol: 0.15 };
const jit = (amt: number) => 1 + (Math.random() * 2 - 1) * amt;

/**
 * One oscillator blip. `pitchMul` multiplies freq/slideTo (on top of the random jitter);
 * pass `jitter = false` for exact pitches (UI jingles).
 */
export function tone(freq: number, dur: number, wave: Wave = 'square', vol = 0.3, slideTo?: number, delay = 0, pitchMul = 1, jitter = true): void {
  const c = ac();
  if (!c || !master || volume <= 0) return;
  const pm = pitchMul * (jitter ? jit(SFX_JITTER.pitch) : 1);
  const v = vol * (jitter ? jit(SFX_JITTER.vol) : 1);
  const t = c.currentTime + delay;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = wave;
  o.frequency.setValueAtTime(Math.max(1, freq * pm), t);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(1, slideTo * pm), t + dur);
  g.gain.setValueAtTime(v, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + dur + 0.02);
}

let noiseBuf: AudioBuffer | null = null;
/**
 * Filtered white-noise burst. `pitchMul` scales the filter cutoff (and playback rate);
 * `type` picks the filter (lowpass by default).
 */
export function noise(dur: number, vol = 0.3, filterFreq = 2000, delay = 0, pitchMul = 1, type: BiquadFilterType = 'lowpass', jitter = true): void {
  const c = ac();
  if (!c || !master || volume <= 0) return;
  if (!noiseBuf) {
    noiseBuf = c.createBuffer(1, c.sampleRate, c.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const pm = pitchMul * (jitter ? jit(SFX_JITTER.pitch) : 1);
  const v = vol * (jitter ? jit(SFX_JITTER.vol) : 1);
  const t = c.currentTime + delay;
  const s = c.createBufferSource();
  s.buffer = noiseBuf;
  s.playbackRate.value = pm;
  const f = c.createBiquadFilter();
  f.type = type;
  f.frequency.value = Math.min(20000, filterFreq * pm);
  const g = c.createGain();
  g.gain.setValueAtTime(v, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(f).connect(g).connect(master);
  s.start(t);
  s.stop(t + dur + 0.02);
}

// ------------------------------------------------------------------ layer helpers (for layered impacts)

/** Low sine thump that drops an octave: the "weight" layer of an impact. */
export function thump(freq = 90, dur = 0.12, vol = 0.35, delay = 0, pitchMul = 1): void {
  tone(freq, dur, 'sine', vol, freq * 0.5, delay, pitchMul);
}

/** Band-passed noise crunch: the "texture" layer of an impact. */
export function crunch(dur = 0.08, vol = 0.3, freq = 1800, delay = 0, pitchMul = 1): void {
  noise(dur, vol, freq, delay, pitchMul, 'bandpass');
}

/** Short high triangle ping: the "sparkle" layer (parries, crits, pickups). */
export function ring(freq = 2400, dur = 0.12, vol = 0.12, delay = 0, pitchMul = 1): void {
  tone(freq, dur, 'triangle', vol, freq * 1.02, delay, pitchMul);
}

/** Named game sounds. hit / heavyHit / swing / pickup take an optional pitch multiplier (e.g. combo steps). */
export const sfx = {
  jump: () => tone(300, 0.12, 'square', 0.15, 600),
  land: () => noise(0.06, 0.15, 600),
  dash: () => noise(0.15, 0.25, 3000),
  swing: (pitchMul = 1) => noise(0.08, 0.2, 5000, 0, pitchMul),
  hit: (pitchMul = 1) => {
    noise(0.1, 0.35, 1500, 0, pitchMul);
    tone(180, 0.1, 'square', 0.2, 60, 0, pitchMul);
  },
  heavyHit: (pitchMul = 1) => {
    noise(0.2, 0.5, 900, 0, pitchMul);
    tone(120, 0.2, 'sawtooth', 0.25, 40, 0, pitchMul);
    thump(75, 0.16, 0.4, 0, pitchMul);
    crunch(0.07, 0.3, 2200, 0.01, pitchMul);
  },
  /** Hit on a boss: dull, weighty thud + crunch (no slowmo-scale ring). */
  bossHit: (pitchMul = 1) => {
    thump(70, 0.18, 0.42, 0, pitchMul);
    crunch(0.1, 0.35, 1100, 0, pitchMul);
    tone(160, 0.12, 'square', 0.16, 55, 0, pitchMul);
  },
  /** Killing blow: thump + crunch + falling square + a little ring. */
  kill: (pitchMul = 1) => {
    thump(100, 0.16, 0.4, 0, pitchMul);
    crunch(0.1, 0.4, 1600, 0, pitchMul);
    tone(520, 0.16, 'square', 0.14, 90, 0, pitchMul);
    ring(1900, 0.1, 0.08, 0.03, pitchMul);
  },
  /** Big kill (slowmo): deeper, longer, with a bright ring tail. */
  killBig: () => {
    thump(60, 0.35, 0.5);
    crunch(0.18, 0.45, 1000);
    tone(400, 0.4, 'sawtooth', 0.16, 50);
    ring(2600, 0.3, 0.12, 0.05);
    ring(3900, 0.25, 0.06, 0.1);
  },
  /** Corpse bursting into chunks. */
  gibs: () => {
    crunch(0.09, 0.3, 900);
    thump(140, 0.08, 0.2);
    noise(0.05, 0.15, 4000, 0.03);
  },
  /** Heavy boss / charger ground or wall impact. */
  slam: () => {
    thump(55, 0.3, 0.45);
    crunch(0.15, 0.35, 700);
  },
  hurt: () => tone(400, 0.25, 'sawtooth', 0.25, 80),
  die: () => {
    tone(300, 0.6, 'square', 0.25, 40);
    noise(0.5, 0.3, 800);
  },
  enemyDie: () => {
    tone(500, 0.15, 'square', 0.15, 100);
    noise(0.15, 0.2, 2000);
  },
  pickup: (pitchMul = 1) => {
    // one jitter for both notes so the interval stays in tune
    const pm = pitchMul * jit(SFX_JITTER.pitch);
    tone(880, 0.06, 'square', 0.12, undefined, 0, pm, false);
    tone(1320, 0.08, 'square', 0.12, undefined, 0.06, pm, false);
  },
  heal: () => {
    tone(523, 0.08, 'triangle', 0.2, undefined, 0, 1, false);
    tone(659, 0.08, 'triangle', 0.2, undefined, 0.08, 1, false);
    tone(784, 0.12, 'triangle', 0.2, undefined, 0.16, 1, false);
  },
  parry: () => {
    tone(1500, 0.25, 'triangle', 0.3, 2500);
    noise(0.05, 0.3, 8000);
    thump(110, 0.1, 0.3);
    crunch(0.05, 0.3, 3500);
    ring(3200, 0.35, 0.12, 0.02);
  },
  checkpoint: () => {
    [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.1, 'square', 0.12, undefined, i * 0.07, 1, false));
  },
  select: () => tone(660, 0.05, 'square', 0.1, undefined, 0, 1, false),
  confirm: () => {
    tone(660, 0.06, 'square', 0.12, undefined, 0, 1, false);
    tone(990, 0.1, 'square', 0.12, undefined, 0.06, 1, false);
  },
  shoot: () => tone(900, 0.08, 'triangle', 0.12, 400),
  explode: () => {
    noise(0.4, 0.5, 700);
    tone(90, 0.3, 'sawtooth', 0.2, 30);
  },
  charge: () => tone(200, 0.4, 'sine', 0.12, 800),
  bossRoar: () => {
    tone(80, 0.8, 'sawtooth', 0.3, 50);
    noise(0.8, 0.2, 400);
  },
  victory: () => {
    [523, 659, 784, 1046, 784, 1046].forEach((f, i) => tone(f, 0.15, 'square', 0.12, undefined, i * 0.12, 1, false));
  },
  telegraph: () => tone(1200, 0.1, 'square', 0.1, 1200),
  // --- TWIN BLADES
  /** blade slid home into its scabbard (Iaido tell) */
  sheathe: () => {
    noise(0.12, 0.12, 4200, 0, 1, 'highpass');
    ring(2800, 0.08, 0.1, 0.1);
  },
  /** the instant draw cut: a bright rip of air */
  iaido: () => {
    noise(0.18, 0.35, 7000, 0, 1, 'highpass');
    tone(1800, 0.14, 'sawtooth', 0.12, 300);
  },
  /** Mirror Guard ping (stance up) / clang (a hit blocked) */
  guardUp: () => ring(1900, 0.25, 0.14),
  guardClang: () => {
    ring(2600, 0.18, 0.16);
    crunch(0.05, 0.25, 4000);
  },
  /** one column of Thousand Cuts */
  cut: (pitchMul = 1) => {
    noise(0.07, 0.25, 6000, 0, pitchMul, 'highpass');
    tone(1400, 0.06, 'square', 0.08, 700, 0, pitchMul);
  },
  /** soft footstep (run footfall frames); pitchMul lets callers alternate feet */
  step: (pitchMul = 1) => {
    noise(0.035, 0.05, 650, 0, pitchMul);
    tone(95, 0.035, 'sine', 0.05, 65, 0, pitchMul);
  },
  /** short scuff for a skid / turn-around at speed */
  skid: () => noise(0.09, 0.07, 1400, 0, 1, 'bandpass'),
  // --- cinematics (juice phase 4b)
  /** boss death: deep boom under the killBig impact */
  bossFall: () => {
    thump(70, 0.5, 0.45);
    tone(160, 0.9, 'sawtooth', 0.18, 35, 0, 1, false);
    noise(0.9, 0.25, 500, 0.05, 1, 'lowpass', false);
  },
  /** stage clear: bright rising sparkle chime */
  clearChime: () => {
    [1046, 1318, 1568, 2093].forEach((f, i) => tone(f, 0.18, 'triangle', 0.14, undefined, i * 0.05, 1, false));
    ring(3136, 0.35, 0.1, 0.2, 1);
  },
  /** level-complete rank stamp extra for S */
  rankSparkle: () => {
    [2093, 2637, 3136].forEach((f, i) => ring(f, 0.14, 0.08, i * 0.06, 1));
  },
  /** short tick while result numbers count up */
  tally: () => tone(1320, 0.025, 'square', 0.05, undefined, 0, 1, false),
  /** breakable took a hit but didn't break */
  propHit: () => {
    thump(160, 0.07, 0.22);
    crunch(0.05, 0.16, 1200);
  },
  /** breakable smashed: wood crack (W1) / clay-pottery shatter (W2/W3) */
  propBreak: (world: 1 | 2 | 3 | 4 = 1) => {
    thump(world === 1 ? 110 : 140, 0.14, 0.32);
    if (world === 1) {
      crunch(0.12, 0.32, 900);
      crunch(0.06, 0.2, 1600, 0.04);
    } else {
      crunch(0.09, 0.28, 2600);
      ring(2200, 0.06, 0.06, 0.02, world >= 3 ? 0.8 : 1);
      ring(3100, 0.05, 0.05, 0.06, world >= 3 ? 0.8 : 1);
    }
  },

  // ---- Monsieur Fromage's game show
  /** one click of the Wheel of Fate passing a wedge */
  wheelTick: () => tone(1800, 0.025, 'square', 0.06, 1500),
  /** the wheel stops: "DING!" */
  ding: () => {
    tone(1568, 0.5, 'triangle', 0.18, undefined, 0, 1, false);
    tone(2093, 0.4, 'triangle', 0.1, undefined, 0.01, 1, false);
  },
  /** a hit rigged the wheel one wedge forward */
  nudge: () => {
    noise(0.07, 0.25, 900);
    tone(300, 0.08, 'square', 0.14, 520);
  },
  /** canned studio audience laugh: a few wobbling noise bursts */
  laughTrack: () => {
    for (let i = 0; i < 5; i++) noise(0.09, 0.12, 1400 + (i % 2) * 500, i * 0.11, 1, 'bandpass');
  },
  applause: () => {
    for (let i = 0; i < 14; i++) noise(0.05, 0.1, 3500, i * 0.06 + Math.random() * 0.03, 1, 'highpass');
  },
  slotMachine: () => {
    [880, 988, 1047, 1175, 1319, 1397, 1568].forEach((f, i) => tone(f, 0.05, 'square', 0.08, undefined, i * 0.05, 1, false));
    tone(196, 0.5, 'sawtooth', 0.14, 98, 0.4, 1, false);
  },
  boing: () => tone(160, 0.3, 'sine', 0.25, 520),
  squeak: () => tone(2400, 0.06, 'square', 0.06, 3100),
  splat: () => {
    noise(0.25, 0.4, 500);
    tone(110, 0.2, 'sine', 0.25, 50);
  },

  // ---- Gilded Croupier (casino) ----
  /** Bright two-partial coin ting. */
  coinPing: (pitchMul = 1) => {
    ring(2600, 0.14, 0.12, 0, pitchMul);
    ring(3900, 0.09, 0.06, 0.01, pitchMul);
  },
  /** Bone dice knocking together: two quick clicks. */
  diceClack: () => {
    crunch(0.03, 0.25, 3200);
    tone(700, 0.03, 'square', 0.08, 500);
    crunch(0.025, 0.2, 2600, 0.06);
  },
  /** One reel notch passing (call repeatedly while spinning). */
  reelTick: (pitchMul = 1) => noise(0.02, 0.15, 4500, 0, pitchMul, 'highpass'),
  /** A reel locks into place. */
  reelStop: (pitchMul = 1) => {
    thump(160, 0.08, 0.25, 0, pitchMul);
    crunch(0.05, 0.25, 1400, 0, pitchMul);
  },
  /** Slot-machine payout: rising arpeggio + a shower of coin pings. */
  jackpot: () => {
    [523, 659, 784, 1046, 1318].forEach((f, i) => tone(f, 0.12, 'square', 0.12, undefined, i * 0.07, 1, false));
    for (let i = 0; i < 6; i++) ring(2400 + Math.random() * 1600, 0.1, 0.07, 0.35 + i * 0.05);
  },
  /** Card snapped face up. */
  cardFlip: () => {
    noise(0.05, 0.22, 3500, 0, 1, 'bandpass');
    tone(900, 0.04, 'triangle', 0.08, 1300, 0.02);
  },
  /** Roulette ball rolling for `ms`: ticks that slow down, then a final drop. */
  rouletteRoll: (ms = 1500) => {
    const total = Math.max(0.2, ms / 1000);
    let t = 0;
    let gap = 0.04;
    while (t < total - 0.05) {
      noise(0.02, 0.12, 5000, t, 1 + (1 - t / total) * 0.3, 'highpass');
      t += gap;
      gap *= 1.07;
    }
    crunch(0.06, 0.25, 2200, total);
    ring(1800, 0.1, 0.08, total);
  },
  // ---------------------------------------------------------------- ERRATUM (w4-6)
  /** Quill dragged across paper. */
  quill: (ms = 300) => {
    const n = Math.max(2, Math.round(ms / 45));
    for (let i = 0; i < n; i++) noise(0.04, 0.12, 3800 + Math.random() * 1500, i * 0.045, 1, 'bandpass');
  },
  /** Rubber eraser: low scrubbing noise. */
  eraser: () => {
    for (let i = 0; i < 5; i++) noise(0.06, 0.18, 900 + (i % 2) * 400, i * 0.06, 1, 'bandpass');
  },
  /** Typewriter key strike. */
  keyClack: (pitchMul = 1) => {
    crunch(0.025, 0.25, 3200, 0, pitchMul);
    thump(220, 0.04, 0.12, 0, pitchMul);
  },
  /** Error chime: two falling square notes (an original jingle). */
  errorDing: () => {
    tone(784, 0.14, 'square', 0.1, undefined, 0, 1, false);
    tone(523, 0.22, 'square', 0.1, undefined, 0.13, 1, false);
  },
  /** Page turn. */
  pageFlip: () => {
    noise(0.18, 0.2, 2600, 0, 1, 'bandpass');
    noise(0.1, 0.12, 5200, 0.12, 1, 'highpass');
  },
  /** Inky chuckle: wobbling descending blips. */
  laugh: () => {
    [520, 470, 500, 440, 470, 400].forEach((f, i) => tone(f, 0.07, 'square', 0.09, f * 0.85, i * 0.08));
  },
  /** Typewriter carriage-return bell. */
  bell: () => {
    ring(2600, 0.25, 0.14);
    ring(3900, 0.18, 0.06, 0.01);
  },
  /** ORRATH: a mountain's roar, much longer and lower than bossRoar. `size` 0..1+ scales length/volume. */
  titanRoar: (size = 1) => {
    const d = 1.2 + size * 1.2;
    tone(46, d, 'sawtooth', 0.18 + size * 0.1, 30);
    tone(69, d * 0.8, 'sawtooth', 0.08 + size * 0.05, 41, 0.05);
    noise(d, 0.16 + size * 0.08, 260);
    thump(60, 0.5, 0.4);
  },
  /** Rock breaking: a heavy thump under a gritty crunch. */
  rockCrumble: () => {
    thump(70, 0.25, 0.35);
    crunch(0.18, 0.22, 900);
    noise(0.35, 0.12, 500, 0.04);
  },
  /** Low double heartbeat; `k` 0..1 makes it louder. */
  heartbeat: (k = 0) => {
    thump(52, 0.16, 0.3 + k * 0.25);
    thump(48, 0.14, 0.22 + k * 0.2, 0.18);
  },
  /** Rushing wind (beam sweep, swipes, exhale). */
  windRush: () => noise(0.7, 0.14, 1200, 0, 1, 'bandpass'),
  /** CANTOR: a big bronze toll (inharmonic partials: hum, prime, tierce, quint). `pitch` > 1 = smaller bell. */
  toll: (pitch = 1) => {
    thump(70 * pitch, 0.35, 0.3);
    tone(220 * pitch, 1.1, 'sine', 0.16, 214 * pitch, 0, 1, false);
    tone(440 * pitch, 0.9, 'sine', 0.1, 436 * pitch, 0, 1, false);
    tone(528 * pitch, 0.7, 'triangle', 0.06, 520 * pitch, 0, 1, false);
    ring(1320 * pitch, 0.4, 0.05, 0.005);
  },
  /** CANTOR's metronome: a dry clockwork tick; `accent` = the beat the strike lands on. */
  tick: (accent = false) => {
    tone(accent ? 1760 : 1320, 0.035, 'square', accent ? 0.12 : 0.07, undefined, 0, 1, false);
    noise(0.02, accent ? 0.1 : 0.05, 6000, 0, 1, 'highpass', false);
  },
  /** CANTOR punished: a cracked, dead clang. */
  clang: () => {
    crunch(0.12, 0.3, 1200);
    tone(310, 0.3, 'square', 0.08, 180);
    ring(1900, 0.15, 0.06);
  },
  /** TUMBLAR: a pin drops onto the shear line (`true`), or the hollow click of a false set. */
  pinSet: (good = true) => {
    noise(0.025, 0.14, 7000, 0, 1, 'highpass', false);
    tone(good ? 2100 : 900, good ? 0.06 : 0.05, 'square', good ? 0.1 : 0.07, undefined, 0, 1, false);
    if (good) ring(3200, 0.08, 0.05, 0.02);
  },
  /** TUMBLAR's dial: the loud contact click on the right number. */
  dialContact: () => {
    tone(1500, 0.03, 'square', 0.16, undefined, 0, 1, false);
    tone(1500, 0.03, 'square', 0.12, undefined, 0.05, 1, false);
    thump(140, 0.06, 0.2);
  },
  /** TUMBLAR: a pin jams / the dial slips / a digit is pulled. */
  jam: () => {
    crunch(0.08, 0.22, 600);
    tone(150, 0.12, 'square', 0.07, 110);
  },
  /** TUMBLAR's floor bolts flip. */
  bolt: () => {
    thump(110, 0.08, 0.25);
    crunch(0.05, 0.2, 2400);
  },
  /** TUMBLAR's deadbolt shoots out. */
  deadbolt: () => {
    noise(0.22, 0.2, 1400, 0, 1, 'bandpass');
    thump(80, 0.18, 0.3);
  },
  /** TUMBLAR: a spring pops (Spring Back, tumbler gears). */
  spring: () => {
    tone(420, 0.14, 'triangle', 0.1, 1300);
  },
  /** TUMBLAR: a lock opens: tumblers fall, then a bright chime. */
  unlock: () => {
    for (let k = 0; k < 4; k++) noise(0.02, 0.12, 6000, k * 0.035, 1, 'highpass', false);
    thump(90, 0.2, 0.32, 0.15);
    tone(784, 0.35, 'triangle', 0.1, undefined, 0.16, 1, false);
    tone(1175, 0.45, 'triangle', 0.08, undefined, 0.22, 1, false);
  },
  /** UMBRA: a struck iron lantern (`v` scales the volume: soft for hits inside its cooldown). */
  lanternClang: (v = 1) => {
    ring(2100, 0.18, 0.07 * v);
    tone(660, 0.12, 'triangle', 0.1 * v, 600);
    noise(0.04, 0.08 * v, 5000, 0, 1, 'highpass');
  },
  /** UMBRA: a sword passing through a shadow (hollow breath). */
  shadowPass: () => noise(0.16, 0.08, 700, 0, 1, 'bandpass'),
  /** UMBRA: a flame pinched out. */
  snuff: () => {
    noise(0.25, 0.14, 900, 0, 1, 'lowpass');
    tone(240, 0.3, 'sine', 0.08, 90);
  },
  /** UMBRA: a lantern catching again. */
  relight: () => {
    noise(0.12, 0.1, 3000, 0, 1, 'bandpass');
    tone(520, 0.25, 'triangle', 0.08, 880);
  },
};
