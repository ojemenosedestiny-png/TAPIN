/** Short tones for enrollment and kiosk feedback. Browser only; silently does nothing if audio is blocked. */
let ctx: AudioContext | null = null;

function tone(freqs: number[], durationMs: number, type: OscillatorType = "sine") {
  try {
    ctx ??= new AudioContext();
    const start = ctx.currentTime;
    freqs.forEach((f, i) => {
      const osc = ctx!.createOscillator();
      const gain = ctx!.createGain();
      osc.type = type;
      osc.frequency.value = f;
      const t0 = start + (i * durationMs) / 1000;
      const t1 = t0 + durationMs / 1000;
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(0.25, t0 + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, t1);
      osc.connect(gain).connect(ctx!.destination);
      osc.start(t0);
      osc.stop(t1 + 0.02);
    });
  } catch {
    // no audio available
  }
}

export const playSuccess = () => tone([880, 1320], 110);
export const playError = () => tone([220, 180], 160, "square");
