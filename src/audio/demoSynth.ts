import { audioContext } from './context';
import { mulberry32 } from '../demo/rng';

/**
 * A small generative "lo-fi" band used by the demo player, so demo albums
 * actually make (gentle) music. Each track seed gives its own key, tempo,
 * progression and arpeggio pattern.
 */

const SCALES = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
};
const PROGRESSIONS = [
  [0, 5, 3, 4],
  [0, 3, 4, 3],
  [0, 5, 1, 4],
  [5, 3, 0, 4],
  [0, 2, 3, 4],
  [1, 4, 0, 0],
];
const PATTERNS = [
  [0, 1, 2, 3, 2, 1, 0, 2],
  [0, 2, 1, 3, 0, 2, 1, 3],
  [0, -1, 2, -1, 1, -1, 3, 2],
  [3, 2, 1, 0, 1, 2, 3, -1],
];

const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

interface Song {
  root: number;
  scale: number[];
  bpm: number;
  progression: number[];
  pattern: number[];
  hats: boolean;
}

export class DemoSynth {
  private bus: GainNode | null = null;
  private timer = 0;
  private song: Song | null = null;
  private startedAt = 0; // ctx time corresponding to step 0
  private nextStep = 0;

  private ensureBus(ctx: AudioContext) {
    if (this.bus) return this.bus;
    const bus = ctx.createGain();
    bus.gain.value = 0;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 2600;
    const delay = ctx.createDelay(1);
    delay.delayTime.value = 0.36;
    const fb = ctx.createGain();
    fb.gain.value = 0.28;
    const wet = ctx.createGain();
    wet.gain.value = 0.35;
    bus.connect(lp);
    lp.connect(ctx.destination);
    lp.connect(delay);
    delay.connect(fb).connect(delay);
    delay.connect(wet).connect(ctx.destination);
    this.bus = bus;
    return bus;
  }

  start(seed: number, positionSec: number) {
    const ctx = audioContext();
    if (!ctx) return;
    const bus = this.ensureBus(ctx);
    const rng = mulberry32(seed);
    const scaleNames = Object.keys(SCALES) as (keyof typeof SCALES)[];
    this.song = {
      root: 50 + Math.floor(rng() * 10),
      scale: SCALES[scaleNames[Math.floor(rng() * scaleNames.length)]],
      bpm: 68 + Math.floor(rng() * 30),
      progression: PROGRESSIONS[Math.floor(rng() * PROGRESSIONS.length)],
      pattern: PATTERNS[Math.floor(rng() * PATTERNS.length)],
      hats: rng() > 0.4,
    };
    const stepDur = this.stepDur();
    this.nextStep = Math.ceil(positionSec / stepDur);
    this.startedAt = ctx.currentTime + 0.05 - positionSec;
    bus.gain.cancelScheduledValues(ctx.currentTime);
    bus.gain.setTargetAtTime(0.16, ctx.currentTime, 0.08);
    clearInterval(this.timer);
    this.timer = window.setInterval(() => this.schedule(ctx), 50);
    this.schedule(ctx);
  }

  stop() {
    clearInterval(this.timer);
    this.timer = 0;
    const ctx = audioContext();
    if (ctx && this.bus) {
      this.bus.gain.cancelScheduledValues(ctx.currentTime);
      this.bus.gain.setTargetAtTime(0, ctx.currentTime, 0.06);
    }
  }

  private stepDur() {
    return 60 / this.song!.bpm / 2; // eighth notes
  }

  private schedule(ctx: AudioContext) {
    if (!this.song) return;
    const stepDur = this.stepDur();
    while (this.startedAt + this.nextStep * stepDur < ctx.currentTime + 0.3) {
      const at = Math.max(ctx.currentTime, this.startedAt + this.nextStep * stepDur);
      this.playStep(ctx, this.nextStep, at, stepDur);
      this.nextStep++;
    }
  }

  private degree(deg: number, octave = 0) {
    const { scale, root } = this.song!;
    const idx = ((deg % 7) + 7) % 7;
    return root + scale[idx] + 12 * (Math.floor(deg / 7) + octave);
  }

  private playStep(ctx: AudioContext, step: number, at: number, stepDur: number) {
    const song = this.song!;
    const bar = Math.floor(step / 8);
    const inBar = step % 8;
    const chordDeg = song.progression[bar % song.progression.length];
    const chord = [0, 2, 4, 7].map((x) => this.degree(chordDeg + x, 1));

    const p = song.pattern[inBar];
    if (p >= 0) this.voice(ctx, at, mtof(chord[p]), 1.4, 0.07, 'triangle');
    if (inBar === 0) {
      this.voice(ctx, at, mtof(this.degree(chordDeg, -1)), 1.6, 0.16, 'sine');
      chord.slice(0, 3).forEach((n) => this.voice(ctx, at, mtof(n - 12), stepDur * 8, 0.025, 'sine', 0.4));
    }
    if (inBar === 4) this.voice(ctx, at, mtof(this.degree(chordDeg + 4, -1)), 1.0, 0.1, 'sine');
    if (song.hats && inBar % 2 === 1) this.hat(ctx, at);
  }

  private voice(ctx: AudioContext, at: number, freq: number, dur: number, gain: number, type: OscillatorType, attack = 0.006) {
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    osc.detune.value = (Math.random() - 0.5) * 8;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(gain, at + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    osc.connect(g).connect(this.bus!);
    osc.start(at);
    osc.stop(at + dur + 0.05);
  }

  private noise: AudioBuffer | null = null;
  private hat(ctx: AudioContext, at: number) {
    if (!this.noise) {
      this.noise = ctx.createBuffer(1, ctx.sampleRate * 0.2, ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 7000;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.03, at);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.05);
    src.connect(hp).connect(g).connect(this.bus!);
    src.start(at);
    src.stop(at + 0.06);
  }
}
