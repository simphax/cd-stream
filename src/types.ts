export interface Track {
  id: string;
  uri: string;
  name: string;
  artists: string;
  durationMs: number;
  trackNumber: number;
  discNumber: number;
}

export interface Album {
  id: string;
  uri: string;
  name: string;
  artist: string;
  year: string;
  label?: string;
  /** Full size (~640px) cover image. */
  coverUrl?: string;
  /** Shelf size (~300px) cover image. */
  coverUrlSmall?: string;
  /** Pre-rendered cover (demo mode). */
  coverCanvas?: HTMLCanvasElement;
  /** null until loaded (some sources only give album stubs). */
  tracks: Track[] | null;
  totalTracks: number;
}

export interface User {
  name: string;
  imageUrl?: string;
  product?: string;
}
