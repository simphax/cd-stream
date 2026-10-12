import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import './styles.css';

import { Controller } from './app/controller';
import { setSfxMuted, sfxMuted } from './audio/sfx';
import { demoLibrary } from './demo/library';
import { DemoPlayback } from './playback/demo';
import { SpotifyPlayback } from './playback/spotify';
import type { Playback } from './playback/types';
import { getMe, loadAlbumTracks, loadLibrary, SpotifyError } from './spotify/api';
import { getClientId, handleRedirect, hasBuiltInClientId, isLoggedIn, login, logout, redirectUri, setClientId } from './spotify/auth';
import { Stage } from './three/stage';
import type { Album } from './types';
import { Overlay } from './ui/overlay';

const overlay = new Overlay();
let playback: Playback | null = null;
let source: 'demo' | 'spotify' = 'demo';

function webglAvailable() {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

async function fontsReady() {
  const wanted = ['400 20px Inter', '600 20px Inter', '400 20px "IBM Plex Mono"', '500 20px "IBM Plex Mono"'];
  await Promise.race([Promise.all(wanted.map((f) => document.fonts.load(f))), new Promise((r) => setTimeout(r, 2500))]);
}

async function main() {
  overlay.initSound(sfxMuted, () => setSfxMuted(!sfxMuted()));
  if (!webglAvailable()) {
    overlay.setLoading(null);
    overlay.toast('Your browser does not support WebGL, which cd·stream needs.', 1e9);
    return;
  }
  await fontsReady();

  const stage = new Stage(document.getElementById('stage')!);
  const controller = new Controller({
    stage,
    overlay,
    loadTracks: (album: Album) => (source === 'demo' ? Promise.resolve(album.tracks ?? []) : loadAlbumTracks(album)),
  });
  stage.start();
  if (import.meta.env.DEV) Object.assign(window, { __cd: { controller, stage } });

  const usePlayback = async (p: Playback) => {
    playback?.dispose();
    playback = p;
    controller.setPlayback(p);
    await p.init();
  };

  const startDemo = async () => {
    source = 'demo';
    overlay.hideLogin();
    overlay.setMode('Demo', 'Fictional albums with generated music');
    controller.interactive = true;
    controller.updateHint();
    await usePlayback(new DemoPlayback());
  };

  const showLogin = (error?: string) => {
    source = 'demo';
    controller.interactive = false;
    controller.setLibrary(demoLibrary());
    overlay.showLogin({
      needsClientId: !hasBuiltInClientId(),
      clientId: getClientId() ?? '',
      redirectUri: redirectUri(),
      error,
      onConnect: (id) => {
        if (!hasBuiltInClientId()) setClientId(id);
        login().catch((err) => overlay.toast(String(err?.message ?? err)));
      },
      onDemo: startDemo,
    });
  };

  const startSpotify = async () => {
    source = 'spotify';
    overlay.setLoading('Opening your CD collection…');
    try {
      const user = await getMe();
      const albums = await loadLibrary((n) => overlay.setLoading(`Taking ${n} CDs off the shelf…`));
      overlay.setLoading(null);
      overlay.setUser(user, () => {
        logout();
        location.reload();
      });
      if (!albums.length) {
        overlay.toast('No saved albums found in your library — here is a demo shelf instead. Save some albums in Spotify and reload.', 8000);
        await startDemo();
        controller.setLibrary(demoLibrary());
        return;
      }
      controller.setLibrary(albums);
      controller.interactive = true;
      controller.updateHint();

      const sp = new SpotifyPlayback();
      overlay.setMode('Connecting…');
      await usePlayback(sp);
      if (sp.kind === 'sdk') overlay.setMode('This browser', 'Playing through the Spotify Web Playback SDK');
      else {
        overlay.setMode('Remote', 'Controlling your active Spotify device');
        overlay.toast(`${sp.fallbackReason}. cd·stream will play on your active Spotify app instead — open Spotify on your phone or computer.`, 9000);
      }
    } catch (err) {
      overlay.setLoading(null);
      let message = err instanceof Error ? err.message : String(err);
      if (err instanceof SpotifyError && err.status === 403) {
        message = 'Spotify refused access. If the app is in Development Mode, add your account under "Users and Access" in the Spotify dashboard.';
      }
      logout();
      showLogin(message);
    }
  };

  let redirectError: string | undefined;
  try {
    await handleRedirect();
  } catch (err) {
    redirectError = err instanceof Error ? err.message : String(err);
  }

  if (isLoggedIn()) await startSpotify();
  else showLogin(redirectError);
}

main().catch((err) => {
  console.error(err);
  overlay.toast(`Something went wrong: ${err instanceof Error ? err.message : err}`, 1e9);
});
