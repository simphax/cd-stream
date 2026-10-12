import { api, SpotifyError } from '../spotify/api';
import { getAccessToken } from '../spotify/auth';
import type { Album } from '../types';
import { emptySnapshot, type Playback, type PlayerSnapshot } from './types';

const SDK_URL = 'https://sdk.scdn.co/spotify-player.js';

let sdkLoading: Promise<void> | null = null;
function loadSdk(): Promise<void> {
  if (window.Spotify) return Promise.resolve();
  sdkLoading ??= new Promise<void>((resolve, reject) => {
    window.onSpotifyWebPlaybackSDKReady = () => resolve();
    const script = document.createElement('script');
    script.src = SDK_URL;
    script.async = true;
    script.onerror = () => reject(new Error('Could not load the Spotify Web Playback SDK'));
    document.head.appendChild(script);
    setTimeout(() => reject(new Error('Spotify SDK load timed out')), 15000);
  });
  return sdkLoading;
}

interface RawPlayerState {
  is_playing: boolean;
  progress_ms: number | null;
  context: { uri: string } | null;
  item: {
    uri: string;
    name: string;
    duration_ms: number;
    track_number: number;
    artists: { name: string }[];
    album: { uri: string };
  } | null;
}

/**
 * Plays in this browser through the Web Playback SDK (Premium, desktop
 * browsers) and falls back to remote-controlling the user's active Spotify
 * device ("Spotify Connect") when the SDK is unavailable.
 */
export class SpotifyPlayback implements Playback {
  kind: 'sdk' | 'connect' = 'sdk';
  snapshot: PlayerSnapshot = emptySnapshot();
  /** Why the in-browser player is unavailable (set in connect mode). */
  fallbackReason = '';

  private player?: Spotify.Player;
  private deviceId?: string;
  private listeners: ((s: PlayerSnapshot) => void)[] = [];
  private pollTimer?: number;
  private transferred = false;

  async init() {
    try {
      await this.initSdk();
      this.kind = 'sdk';
    } catch (err) {
      this.kind = 'connect';
      this.fallbackReason = err instanceof Error ? err.message : String(err);
      this.player?.disconnect();
      this.player = undefined;
      this.startPolling();
    }
  }

  private async initSdk() {
    await loadSdk();
    const player = new Spotify.Player({
      name: 'cd·stream',
      volume: 0.8,
      getOAuthToken: (cb) => {
        getAccessToken().then(cb, () => cb(''));
      },
    });
    this.player = player;

    player.addListener('player_state_changed', (state) => this.fromSdk(state));
    player.addListener('autoplay_failed', () => {
      // Browser blocked audio until another gesture — the next tap will resume.
    });

    await new Promise<void>((resolve, reject) => {
      const fail = (msg: string) => reject(new Error(msg));
      const timer = setTimeout(() => fail('The in-browser Spotify player did not start'), 15000);
      player.addListener('ready', ({ device_id }) => {
        clearTimeout(timer);
        this.deviceId = device_id;
        resolve();
      });
      player.addListener('initialization_error', ({ message }) => fail(message));
      player.addListener('authentication_error', ({ message }) => fail(message));
      player.addListener('account_error', () => fail('In-browser playback requires Spotify Premium'));
      player.connect().then((ok) => {
        if (!ok) fail('Could not connect the in-browser Spotify player');
      });
    });
    player.addListener('not_ready', () => {
      this.transferred = false;
    });
    player.addListener('ready', ({ device_id }) => {
      this.deviceId = device_id;
    });
  }

  activate() {
    // Required on mobile Safari/Chrome so audio may start from an async call.
    this.player?.activateElement?.();
  }

  onChange(cb: (s: PlayerSnapshot) => void) {
    this.listeners.push(cb);
  }

  private emit(s: PlayerSnapshot) {
    this.snapshot = s;
    this.listeners.forEach((l) => l(s));
  }

  private fromSdk(state: Spotify.PlaybackState | null) {
    if (!state) {
      this.emit({ ...this.snapshot, paused: true, timestamp: performance.now() });
      return;
    }
    const t = state.track_window.current_track;
    this.emit({
      albumUri: t?.album?.uri ?? state.context?.uri ?? null,
      trackUri: t?.uri ?? null,
      trackName: t?.name ?? '',
      artist: t?.artists?.map((a) => a.name).join(', ') ?? '',
      trackNumber: 0,
      positionMs: state.position,
      durationMs: state.duration,
      paused: state.paused,
      timestamp: performance.now(),
    });
  }

  private startPolling() {
    const tick = async () => {
      if (document.visibilityState === 'visible') await this.poll();
      this.pollTimer = window.setTimeout(tick, 2000);
    };
    tick();
  }

  private pollSoon() {
    if (this.kind !== 'connect') return;
    setTimeout(() => this.poll(), 350);
    setTimeout(() => this.poll(), 1200);
  }

  private async poll() {
    try {
      const s = await api<RawPlayerState | undefined>('/me/player');
      if (!s || !s.item) {
        if (!this.snapshot.paused) this.emit({ ...this.snapshot, paused: true, timestamp: performance.now() });
        return;
      }
      this.emit({
        albumUri: s.item.album?.uri ?? s.context?.uri ?? null,
        trackUri: s.item.uri,
        trackName: s.item.name,
        artist: s.item.artists.map((a) => a.name).join(', '),
        trackNumber: s.item.track_number,
        positionMs: s.progress_ms ?? 0,
        durationMs: s.item.duration_ms,
        paused: !s.is_playing,
        timestamp: performance.now(),
      });
    } catch {
      /* transient — try again next tick */
    }
  }

  async playAlbum(album: Album, trackIndex: number) {
    const body = JSON.stringify({ context_uri: album.uri, offset: { position: trackIndex }, position_ms: 0 });
    if (this.kind === 'sdk' && this.deviceId) {
      if (!this.transferred) {
        await api('/me/player', { method: 'PUT', body: JSON.stringify({ device_ids: [this.deviceId], play: false }) }).catch(() => {});
        this.transferred = true;
      }
      try {
        await api(`/me/player/play?device_id=${this.deviceId}`, { method: 'PUT', body });
      } catch (err) {
        if (err instanceof SpotifyError && err.status === 404) {
          await api('/me/player', { method: 'PUT', body: JSON.stringify({ device_ids: [this.deviceId], play: false }) });
          await api(`/me/player/play?device_id=${this.deviceId}`, { method: 'PUT', body });
        } else throw err;
      }
      return;
    }
    try {
      await api('/me/player/play', { method: 'PUT', body });
    } catch (err) {
      if (!(err instanceof SpotifyError) || err.status !== 404) throw err;
      const { devices } = await api<{ devices: { id: string; is_restricted: boolean }[] }>('/me/player/devices');
      const device = devices.find((d) => !d.is_restricted);
      if (!device) throw new Error('No Spotify device found. Open Spotify on your phone or computer, then try again.');
      await api(`/me/player/play?device_id=${device.id}`, { method: 'PUT', body });
    }
    this.pollSoon();
  }

  async togglePlay() {
    if (this.player) {
      await this.player.togglePlay();
      return;
    }
    if (this.snapshot.paused) await api('/me/player/play', { method: 'PUT' });
    else await api('/me/player/pause', { method: 'PUT' });
    this.emit({ ...this.snapshot, paused: !this.snapshot.paused, timestamp: performance.now() });
    this.pollSoon();
  }

  async pause() {
    if (this.player) return this.player.pause();
    if (!this.snapshot.paused) await api('/me/player/pause', { method: 'PUT' }).catch(() => {});
    this.emit({ ...this.snapshot, paused: true, timestamp: performance.now() });
  }

  async next() {
    if (this.player) return this.player.nextTrack();
    await api('/me/player/next', { method: 'POST' });
    this.pollSoon();
  }

  async previous() {
    if (this.player) return this.player.previousTrack();
    await api('/me/player/previous', { method: 'POST' });
    this.pollSoon();
  }

  dispose() {
    clearTimeout(this.pollTimer);
    this.player?.disconnect();
  }
}
