import { getAccessToken } from './auth';
import type { Album, Track, User } from '../types';

const BASE = 'https://api.spotify.com/v1';

export class SpotifyError extends Error {
  constructor(
    message: string,
    public status: number,
    public reason?: string,
  ) {
    super(message);
  }
}

export async function api<T = unknown>(path: string, init: RequestInit = {}, attempt = 0): Promise<T> {
  const token = await getAccessToken(attempt > 0);
  const res = await fetch(path.startsWith('http') ? path : BASE + path, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...init.headers,
    },
  });
  if (res.status === 401 && attempt === 0) return api(path, init, 1);
  if (res.status === 429 && attempt < 3) {
    const retry = Number(res.headers.get('Retry-After') ?? '1');
    await new Promise((r) => setTimeout(r, Math.min(10, retry + attempt) * 1000));
    return api(path, init, attempt + 1);
  }
  if (!res.ok) {
    let message = `Spotify request failed (${res.status})`;
    let reason: string | undefined;
    try {
      const body = await res.json();
      message = body?.error?.message ?? message;
      reason = body?.error?.reason;
    } catch {
      /* empty body */
    }
    throw new SpotifyError(message, res.status, reason);
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

/* ----------------------------- raw shapes ----------------------------- */

interface RawImage {
  url: string;
  width: number | null;
  height: number | null;
}
interface RawArtist {
  name: string;
}
interface RawTrack {
  id: string;
  uri: string;
  name: string;
  artists: RawArtist[];
  duration_ms: number;
  track_number: number;
  disc_number: number;
  album?: RawAlbum;
}
interface RawAlbum {
  id: string;
  uri: string;
  name: string;
  album_type?: string;
  artists: RawArtist[];
  images: RawImage[];
  release_date?: string;
  total_tracks?: number;
  label?: string;
  tracks?: { items: RawTrack[]; next: string | null; total: number };
}
interface Paging<T> {
  items: T[];
  next: string | null;
  total: number;
}

function pickImage(images: RawImage[], target: number) {
  if (!images?.length) return undefined;
  const sorted = [...images].sort((a, b) => (b.width ?? 0) - (a.width ?? 0));
  // smallest image that is still >= target, or the biggest available
  const fit = [...sorted].reverse().find((i) => (i.width ?? 0) >= target);
  return (fit ?? sorted[0]).url;
}

function toTrack(t: RawTrack): Track {
  return {
    id: t.id,
    uri: t.uri,
    name: t.name,
    artists: t.artists?.map((a) => a.name).join(', ') ?? '',
    durationMs: t.duration_ms,
    trackNumber: t.track_number,
    discNumber: t.disc_number ?? 1,
  };
}

function toAlbum(a: RawAlbum): Album {
  const tracks = a.tracks?.items?.length ? a.tracks.items.map(toTrack) : null;
  return {
    id: a.id,
    uri: a.uri,
    name: a.name,
    artist: a.artists?.map((x) => x.name).join(', ') ?? '',
    year: a.release_date?.slice(0, 4) ?? '',
    label: a.label,
    coverUrl: pickImage(a.images, 600),
    coverUrlSmall: pickImage(a.images, 280),
    // If the album has more tracks than the embedded page, fetch the rest lazily.
    tracks: tracks && (!a.tracks?.next || tracks.length >= (a.total_tracks ?? 0)) ? tracks : null,
    totalTracks: a.total_tracks ?? tracks?.length ?? 0,
  };
}

/* ----------------------------- endpoints ------------------------------ */

export async function getMe(): Promise<User> {
  const me = await api<{ display_name: string; id: string; images?: RawImage[]; product?: string }>('/me');
  return { name: me.display_name || me.id, imageUrl: me.images?.[0]?.url, product: me.product };
}

const MAX_ALBUMS = 120;

/**
 * Builds the shelf: the user's saved albums first, topped up with albums from
 * their top & recently played tracks when the library is small.
 */
export async function loadLibrary(onProgress?: (count: number) => void): Promise<Album[]> {
  const albums: Album[] = [];
  const seen = new Set<string>();
  const add = (raw: RawAlbum | undefined) => {
    if (!raw || seen.has(raw.id) || albums.length >= MAX_ALBUMS) return;
    if (raw.album_type === 'single' && (raw.total_tracks ?? 1) < 3 && albums.length > 12) return;
    seen.add(raw.id);
    albums.push(toAlbum(raw));
  };

  let url: string | null = '/me/albums?limit=50';
  while (url && albums.length < MAX_ALBUMS) {
    const page: Paging<{ album: RawAlbum }> = await api(url);
    page.items.forEach((i) => add(i.album));
    onProgress?.(albums.length);
    url = page.next;
  }

  if (albums.length < 24) {
    const extra = await Promise.allSettled([
      api<Paging<RawTrack>>('/me/top/tracks?limit=50&time_range=medium_term'),
      api<Paging<{ track: RawTrack }>>('/me/player/recently-played?limit=50'),
      api<Paging<RawTrack>>('/me/top/tracks?limit=50&time_range=long_term'),
    ]);
    for (const r of extra) {
      if (r.status !== 'fulfilled' || !r.value) continue;
      for (const item of r.value.items as (RawTrack | { track: RawTrack })[]) {
        const track = 'track' in item ? item.track : item;
        add(track?.album);
      }
    }
    onProgress?.(albums.length);
  }
  return albums;
}

export async function loadAlbumTracks(album: Album): Promise<Track[]> {
  const tracks: Track[] = [];
  let url: string | null = `/albums/${album.id}/tracks?limit=50`;
  while (url) {
    const page: Paging<RawTrack> = await api(url);
    tracks.push(...page.items.map(toTrack));
    url = page.next;
  }
  return tracks;
}
