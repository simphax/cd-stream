import type { Album } from '../types';

export interface PlayerSnapshot {
  albumUri: string | null;
  trackUri: string | null;
  trackName: string;
  artist: string;
  /** 1-based track number when known, 0 otherwise. */
  trackNumber: number;
  positionMs: number;
  durationMs: number;
  paused: boolean;
  /** performance.now() when this snapshot was taken (for interpolation). */
  timestamp: number;
}

export const emptySnapshot = (): PlayerSnapshot => ({
  albumUri: null,
  trackUri: null,
  trackName: '',
  artist: '',
  trackNumber: 0,
  positionMs: 0,
  durationMs: 0,
  paused: true,
  timestamp: performance.now(),
});

export interface Playback {
  readonly kind: 'sdk' | 'connect' | 'demo';
  init(): Promise<void>;
  /** Must be called synchronously inside a user gesture (unlocks audio on mobile). */
  activate(): void;
  playAlbum(album: Album, trackIndex: number): Promise<void>;
  togglePlay(): Promise<void>;
  pause(): Promise<void>;
  next(): Promise<void>;
  previous(): Promise<void>;
  onChange(cb: (s: PlayerSnapshot) => void): void;
  readonly snapshot: PlayerSnapshot;
  dispose(): void;
}

export function interpolatedPosition(s: PlayerSnapshot, now = performance.now()) {
  if (s.paused) return s.positionMs;
  return Math.min(s.durationMs || Infinity, s.positionMs + (now - s.timestamp));
}
