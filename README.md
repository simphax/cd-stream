# cd·stream

A Spotify player that brings back the ritual of playing **one album at a time**.

Your library sits on a bookshelf as stacks of CD jewel cases. Pick one out, open
the case, take the disc and put it in the player. The player's buttons skip
tracks and play/pause, and you can pull the cord too. Everything is rendered in
3D with [three.js](https://threejs.org/) and built for both touch and desktop.

## How it works

| | Desktop | Touch |
| --- | --- | --- |
| Browse the shelf | Drag, scroll wheel / trackpad, or arrow keys | Swipe sideways |
| Look inside a stack | Hover a stack (the CD under the pointer rises) | Swipe up/down on a stack |
| Take a CD out | Click it (or <kbd>Enter</kbd>) | Tap it |
| Open the case | Click it, or drag the lid open | Tap it, or swipe the lid open |
| Start the album | Drag the disc onto the player (or click the disc) | Drag the disc onto the player (or tap it) |
| Jump to a track | Click a track in the booklet | Tap a track in the booklet |
| Put the case back | Click outside it, flick it, or <kbd>Esc</kbd> | Tap outside or flick it up/down |
| Play / pause | ⏯ button, pull cord, tap the spinning disc, <kbd>Space</kbd> | ⏯ button, pull cord, tap the disc |
| Previous / next | ⏮ ⏭ buttons, <kbd>←</kbd> <kbd>→</kbd> while a case is out | ⏮ ⏭ buttons |
| Eject | ⏏ button, <kbd>E</kbd>, or drag the disc off the player | ⏏ button or drag the disc off |

Small details: the disc tilts as you drag it and snaps onto the spindle; it spins
up and coasts down when paused; the LCD shows the track and time and scrolls the
title; ejected discs fly back into their own case on the shelf; the wall picks
up a tint from the album that is playing. All sound effects (hinge clacks, the
disc snapping on, the motor) are synthesised. You can mute them from the top bar.

## Running it

```bash
npm install
npm run dev        # http://127.0.0.1:5173
```

Press **Try the demo** to play with a shelf of made-up albums. They have
generated artwork and generated music, so no Spotify account is needed.

### Connecting Spotify

1. Create an app at <https://developer.spotify.com/dashboard> and select
   **Web API** and **Web Playback SDK**.
2. Add the redirect URI. Use the page's exact URL, including the trailing
   slash:
   - local development: `http://127.0.0.1:5173/` (Spotify does not accept
     `localhost`; use the loopback IP)
   - production: your HTTPS URL, e.g. `https://you.github.io/cd-stream/`
3. Provide the app's **Client ID** in one of two ways:
   - put it in `.env.local` as `VITE_SPOTIFY_CLIENT_ID=…` (see `.env.example`), or
   - paste it under **Setup** on the login screen. It is stored in `localStorage`.
4. While the app is in Development Mode, add every Spotify account that should
   be able to log in under **User Management** in the dashboard.

Login uses the Authorization Code flow with PKCE, so there is no client secret
and no backend.

### Playback

- **This browser:** with Spotify Premium on a desktop browser, cd·stream
  registers itself as a Spotify Connect device through the
  [Web Playback SDK](https://developer.spotify.com/documentation/web-playback-sdk)
  and plays the audio itself.
- **Remote:** when the SDK is unavailable (no Premium, or mobile browsers,
  which the SDK doesn't support), cd·stream remote-controls your active Spotify
  app instead. Open Spotify on your phone or computer first. The top bar shows
  which mode is active.

Spotify's February 2026 rules for Development Mode apps also apply: the app
owner needs Premium, and new apps are limited to 5 users.

### The shelf

The shelf shows your saved albums, up to 120. If you have saved very few, it is
topped up with albums from your top tracks and recently played tracks.

## Build & deploy

```bash
npm run build      # type-checks, then writes static files to dist/
npm run preview
```

`npm run build:artifact` makes a demo-only, single-file build
(`dist-artifact/cd-stream.html`) for sandboxed hosts that block network access,
such as a claude.ai Artifact.

`dist/` is fully static and uses relative asset paths, so it can be hosted
anywhere (GitHub Pages, Netlify, S3…). Remember to register the hosted URL as a
redirect URI.

## Code tour

```
src/
  main.ts               boot: login / demo / Spotify wiring
  app/controller.ts     the interaction state machine (browse → focus → disc → player)
  three/stage.ts        renderer, camera, lights; `world` (shelf) and `hud` (camera-attached)
  three/layout.ts       responsive layout for landscape & portrait
  three/shelf.ts        bookcase, stacks on stepped risers, hover/peek, intro animation
  three/jewelCase.ts    hinged jewel case: lid, booklet, tray, glare, shadow
  three/disc.ts         the compact disc (picture label + iridescent data side)
  three/player.ts       CD player: spindle, LCD (7-segment), buttons, pull cord
  three/textures.ts     canvas-drawn textures (covers, booklet tracklist, disc label…)
  anim/tween.ts         tweens & springs
  audio/sfx.ts          synthesised foley
  audio/demoSynth.ts    generative music for the demo albums
  playback/spotify.ts   Web Playback SDK + Spotify Connect fallback
  playback/demo.ts      simulated player for the demo
  spotify/auth.ts       PKCE login & token refresh
  spotify/api.ts        Web API calls, library loading
```

During development, append `?dt=0.3` to the URL to let slow software renderers
(such as headless test browsers) keep animations in real time.
