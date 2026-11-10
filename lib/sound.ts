/**
 * Gate sounds. Synthesised in the browser (no audio files to download or cache), tuned to be calm and clear:
 * soft bell-like notes with a quick attack and a long natural fade, through a gentle limiter so nothing clips.
 * Browser only; silently does nothing if audio is blocked.
 */
let ctx: AudioContext | null = null;
let out: AudioNode | null = null;

/** One note: a pure fundamental, a quiet bell overtone that fades faster, and a soft attack. */
export type Note = { freq: number; at: number; length: number; gain?: number; bright?: number; wave?: OscillatorType };

/** C major pentatonic, so any pair of notes sounds pleasant. */
const C5 = 523.25, E5 = 659.25, G5 = 783.99, A5 = 880, C6 = 1046.5, G4 = 392, E4 = 329.63, C4 = 261.63;

export const SOUNDS = {
  /** Rising pair: "welcome". */
  signIn: [{ freq: E5, at: 0, length: 0.9 }, { freq: C6, at: 0.11, length: 1.3 }],
  /** Falling pair: "goodbye". */
  signOut: [{ freq: G5, at: 0, length: 0.9 }, { freq: C5, at: 0.13, length: 1.3 }],
  /** One clear note: "already done". */
  duplicate: [{ freq: A5, at: 0, length: 0.9, gain: 0.7 }],
  /** Low, soft and firm, never harsh: "please stop". */
  error: [
    { freq: E4, at: 0, length: 0.45, wave: "triangle", bright: 0, gain: 0.9 },
    { freq: C4, at: 0.2, length: 0.7, wave: "triangle", bright: 0, gain: 0.9 },
  ],
  /** Saved offline: a single neutral note. */
  saved: [{ freq: G4, at: 0, length: 1, gain: 0.8 }],
} satisfies Record<string, Note[]>;

export type SoundName = keyof typeof SOUNDS;

function output(c: AudioContext): AudioNode {
  if (out) return out;
  const limiter = c.createDynamicsCompressor();
  limiter.threshold.value = -14;
  limiter.knee.value = 12;
  limiter.ratio.value = 6;
  limiter.attack.value = 0.003;
  limiter.release.value = 0.2;
  const tone = c.createBiquadFilter(); // round off any edge
  tone.type = "lowpass";
  tone.frequency.value = 5200;
  const master = c.createGain();
  master.gain.value = 0.55;
  tone.connect(limiter).connect(master).connect(c.destination);
  out = tone;
  return out;
}

function voice(c: AudioContext, dest: AudioNode, n: Note, t0: number) {
  const peak = 0.32 * (n.gain ?? 1);
  const partials: [number, number, number][] = [[1, 1, n.length]]; // [ratio, level, decay]
  if ((n.bright ?? 1) > 0) partials.push([2, 0.18 * (n.bright ?? 1), n.length * 0.45], [3.01, 0.06 * (n.bright ?? 1), n.length * 0.25]);
  for (const [ratio, level, decay] of partials) {
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = ratio === 1 ? (n.wave ?? "sine") : "sine";
    osc.frequency.value = n.freq * ratio;
    const start = t0 + n.at;
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(peak * level, start + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, start + decay);
    osc.connect(g).connect(dest);
    osc.start(start);
    osc.stop(start + decay + 0.05);
  }
}

/** Total length of a sound in milliseconds, so speech can start just after it. */
export function soundLengthMs(name: SoundName): number {
  return Math.round(Math.max(...SOUNDS[name].map((n: Note) => n.at + Math.min(n.length, 0.35))) * 1000);
}

export function play(name: SoundName) {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === "suspended") void ctx.resume();
    const dest = output(ctx);
    const t0 = ctx.currentTime + 0.02;
    for (const n of SOUNDS[name] as Note[]) voice(ctx, dest, n, t0);
  } catch {
    // no audio available
  }
}

/** The shared audio context (created on first use), for the kiosk voice to play through. */
export function audioContext(): AudioContext | null {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

/** Call from a tap or click so later sounds are allowed to play. */
export function unlockAudio() {
  try {
    ctx ??= new AudioContext();
    void ctx.resume();
  } catch {
    // no audio available
  }
}

export const playSuccess = () => play("signIn");
export const playError = () => play("error");
