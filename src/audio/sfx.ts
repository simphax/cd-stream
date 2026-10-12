import { audioContext } from './context';

/**
 * Synthesised foley — plastic clicks, hinge snaps and the whirr of a disc
 * spinning up. Everything is generated, no audio files needed.
 */

const STORAGE_KEY = 'cdstream.sfxMuted';
let muted = localStorage.getItem(STORAGE_KEY) === '1';
let noise: AudioBuffer | null = null;
let out: GainNode | null = null;

export const sfxMuted = () => muted;
export function setSfxMuted(m: boolean) {
  muted = m;
  localStorage.setItem(STORAGE_KEY, m ? '1' : '0');
}

function setup() {
  if (muted) return null;
  const ctx = audioContext();
  if (!ctx) return null;
  if (!out) {
    out = ctx.createGain();
    out.gain.value = 0.55;
    out.connect(ctx.destination);
  }
  if (!noise) {
    noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  return ctx;
}

function burst(ctx: AudioContext, at: number, opts: { freq: number; q?: number; dur: number; gain: number; type?: BiquadFilterType; sweepTo?: number }) {
  const src = ctx.createBufferSource();
  src.buffer = noise;
  const filter = ctx.createBiquadFilter();
  filter.type = opts.type ?? 'bandpass';
  filter.frequency.setValueAtTime(opts.freq, at);
  if (opts.sweepTo) filter.frequency.exponentialRampToValueAtTime(opts.sweepTo, at + opts.dur);
  filter.Q.value = opts.q ?? 1.5;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(opts.gain, at + Math.min(0.004, opts.dur / 4));
  g.gain.exponentialRampToValueAtTime(0.0001, at + opts.dur);
  src.connect(filter).connect(g).connect(out!);
  src.start(at, Math.random() * 0.5);
  src.stop(at + opts.dur + 0.02);
}

function tone(ctx: AudioContext, at: number, opts: { freq: number; dur: number; gain: number; type?: OscillatorType; to?: number }) {
  const osc = ctx.createOscillator();
  osc.type = opts.type ?? 'sine';
  osc.frequency.setValueAtTime(opts.freq, at);
  if (opts.to) osc.frequency.exponentialRampToValueAtTime(opts.to, at + opts.dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(opts.gain, at + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, at + opts.dur);
  osc.connect(g).connect(out!);
  osc.start(at);
  osc.stop(at + opts.dur + 0.02);
}

const jitter = (v: number, amt = 0.08) => v * (1 + (Math.random() * 2 - 1) * amt);

export const sfx = {
  /** Case lifted / slid out of a stack. */
  slide() {
    const ctx = setup();
    if (!ctx) return;
    const t = ctx.currentTime;
    burst(ctx, t, { freq: jitter(900), sweepTo: jitter(2600), q: 0.9, dur: 0.22, gain: 0.12 });
  },
  /** Light tap of plastic on plastic (stack flipping, landing). */
  tap(strength = 1) {
    const ctx = setup();
    if (!ctx) return;
    const t = ctx.currentTime;
    burst(ctx, t, { freq: jitter(2400), q: 3, dur: 0.035, gain: 0.18 * strength });
    tone(ctx, t, { freq: jitter(180), to: 90, dur: 0.06, gain: 0.08 * strength });
  },
  /** The unmistakable jewel-case hinge "clack". */
  caseOpen() {
    const ctx = setup();
    if (!ctx) return;
    const t = ctx.currentTime;
    burst(ctx, t, { freq: jitter(3200), q: 4, dur: 0.03, gain: 0.35 });
    burst(ctx, t + 0.045, { freq: jitter(1500), q: 2, dur: 0.06, gain: 0.22 });
    tone(ctx, t + 0.045, { freq: 220, to: 120, dur: 0.07, gain: 0.08 });
  },
  caseClose() {
    const ctx = setup();
    if (!ctx) return;
    const t = ctx.currentTime;
    burst(ctx, t, { freq: jitter(1300), q: 2, dur: 0.05, gain: 0.25 });
    burst(ctx, t + 0.02, { freq: jitter(3600), q: 5, dur: 0.025, gain: 0.3 });
    tone(ctx, t, { freq: 160, to: 80, dur: 0.08, gain: 0.12 });
  },
  /** Disc popping off / onto a spindle. */
  snap() {
    const ctx = setup();
    if (!ctx) return;
    const t = ctx.currentTime;
    burst(ctx, t, { freq: jitter(4200), q: 6, dur: 0.02, gain: 0.4 });
    burst(ctx, t + 0.012, { freq: jitter(2000), q: 3, dur: 0.04, gain: 0.18 });
    tone(ctx, t, { freq: 140, to: 70, dur: 0.09, gain: 0.14 });
  },
  pop() {
    const ctx = setup();
    if (!ctx) return;
    const t = ctx.currentTime;
    burst(ctx, t, { freq: jitter(2800), q: 4, dur: 0.03, gain: 0.25 });
    tone(ctx, t, { freq: 420, to: 700, dur: 0.05, gain: 0.05 });
  },
  button() {
    const ctx = setup();
    if (!ctx) return;
    const t = ctx.currentTime;
    burst(ctx, t, { freq: jitter(2600), q: 5, dur: 0.018, gain: 0.3 });
    tone(ctx, t, { freq: 90, to: 60, dur: 0.05, gain: 0.12 });
    burst(ctx, t + 0.07, { freq: jitter(3000), q: 5, dur: 0.012, gain: 0.12 });
  },
  cord() {
    const ctx = setup();
    if (!ctx) return;
    const t = ctx.currentTime;
    burst(ctx, t, { freq: 700, sweepTo: 1800, q: 1.2, dur: 0.12, gain: 0.08 });
    burst(ctx, t + 0.1, { freq: jitter(2400), q: 4, dur: 0.025, gain: 0.3 });
  },
  /** Motor whirr when the disc spins up (or down). */
  whirr(up = true) {
    const ctx = setup();
    if (!ctx) return;
    const t = ctx.currentTime;
    const dur = up ? 1.1 : 1.3;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(up ? 30 : 110, t);
    osc.frequency.exponentialRampToValueAtTime(up ? 110 : 25, t + dur);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 500;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.05, t + 0.15);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(lp).connect(g).connect(out!);
    osc.start(t);
    osc.stop(t + dur + 0.05);
    burst(ctx, t, { freq: up ? 600 : 1800, sweepTo: up ? 1800 : 500, q: 6, dur, gain: 0.03 });
  },
};
