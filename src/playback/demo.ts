import { DemoSynth } from '../audio/demoSynth';
import { hashString } from '../demo/rng';
import type { Album } from '../types';
import { emptySnapshot, type Playback, type PlayerSnapshot } from './types';

/** Simulated CD player for the demo library. */
export class DemoPlayback implements Playback {
  readonly kind = 'demo' as const;
  snapshot: PlayerSnapshot = emptySnapshot();
  private album: Album | null = null;
  private index = 0;
  private position = 0;
  private paused = true;
  private last = performance.now();
  private timer = 0;
  private listeners: ((s: PlayerSnapshot) => void)[] = [];
  private synth = new DemoSynth();

  async init() {
    this.timer = window.setInterval(() => this.tick(), 250);
  }

  activate() {}

  onChange(cb: (s: PlayerSnapshot) => void) {
    this.listeners.push(cb);
  }

  private get track() {
    return this.album?.tracks?.[this.index];
  }

  private tick() {
    const now = performance.now();
    const dt = now - this.last;
    this.last = now;
    if (!this.paused && this.track) {
      this.position += dt;
      if (this.position >= this.track.durationMs) {
        if (this.index + 1 < (this.album?.tracks?.length ?? 0)) this.go(this.index + 1, false);
        else {
          // End of the disc: stop at track 1, like a real player.
          this.index = 0;
          this.position = 0;
          this.paused = true;
          this.synth.stop();
        }
      }
    }
    this.emit();
  }

  private emit() {
    const t = this.track;
    this.snapshot = {
      albumUri: this.album?.uri ?? null,
      trackUri: t?.uri ?? null,
      trackName: t?.name ?? '',
      artist: t?.artists ?? '',
      trackNumber: t ? this.index + 1 : 0,
      positionMs: this.position,
      durationMs: t?.durationMs ?? 0,
      paused: this.paused,
      timestamp: performance.now(),
    };
    this.listeners.forEach((l) => l(this.snapshot));
  }

  private go(index: number, keepPaused: boolean) {
    this.index = index;
    this.position = 0;
    this.last = performance.now();
    if (!keepPaused) this.paused = false;
    if (this.paused) this.synth.stop();
    else if (this.track) this.synth.start(hashString(this.track.uri), 0);
    this.emit();
  }

  async playAlbum(album: Album, trackIndex: number) {
    this.album = album;
    this.go(Math.min(trackIndex, (album.tracks?.length ?? 1) - 1), false);
  }

  async togglePlay() {
    if (!this.album) return;
    this.paused = !this.paused;
    this.last = performance.now();
    if (this.paused) this.synth.stop();
    else if (this.track) this.synth.start(hashString(this.track.uri), this.position / 1000);
    this.emit();
  }

  async pause() {
    if (!this.paused) await this.togglePlay();
  }

  async next() {
    if (!this.album?.tracks) return;
    if (this.index + 1 < this.album.tracks.length) this.go(this.index + 1, this.paused);
  }

  async previous() {
    if (!this.album?.tracks) return;
    if (this.position > 3000 || this.index === 0) this.go(this.index, this.paused);
    else this.go(this.index - 1, this.paused);
  }

  dispose() {
    clearInterval(this.timer);
    this.synth.stop();
  }
}
