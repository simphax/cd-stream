import * as THREE from 'three';
import type { Album, Track } from '../types';

export const FONT_SANS = 'Inter, system-ui, -apple-system, Segoe UI, sans-serif';
export const FONT_MONO = '"IBM Plex Mono", ui-monospace, Menlo, monospace';

let maxAnisotropy = 4;
export function setMaxAnisotropy(n: number) {
  maxAnisotropy = Math.min(8, n);
}

export function canvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!] as const;
}

export function canvasTexture(c: HTMLCanvasElement, srgb = true) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = maxAnisotropy;
  return t;
}

/* ------------------------------------------------------------------ */
/* Covers                                                              */
/* ------------------------------------------------------------------ */

export interface CoverResult {
  texture: THREE.Texture;
  source: CanvasImageSource;
  color: THREE.Color;
}

const coverCache = new Map<string, Promise<CoverResult>>();

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Could not load ${url}`));
    img.src = url;
  });
}

/** Saturation-weighted average colour of an image — used for spines & ambience. */
export function dominantColor(source: CanvasImageSource): THREE.Color {
  const [, g] = canvas(16, 16);
  try {
    g.drawImage(source, 0, 0, 16, 16);
    const d = g.getImageData(0, 0, 16, 16).data;
    let r = 0, gg = 0, b = 0, wsum = 0;
    for (let i = 0; i < d.length; i += 4) {
      const max = Math.max(d[i], d[i + 1], d[i + 2]);
      const min = Math.min(d[i], d[i + 1], d[i + 2]);
      const w = 0.15 + (max - min) / 255;
      r += d[i] * w;
      gg += d[i + 1] * w;
      b += d[i + 2] * w;
      wsum += w;
    }
    return new THREE.Color().setRGB(r / wsum / 255, gg / wsum / 255, b / wsum / 255, THREE.SRGBColorSpace);
  } catch {
    return new THREE.Color(0x888888);
  }
}

export function loadCover(album: Album, large = false): Promise<CoverResult> {
  const key = `${album.id}:${large ? 'L' : 'S'}`;
  let p = coverCache.get(key);
  if (!p) {
    p = (async () => {
      let source: CanvasImageSource;
      if (album.coverCanvas) source = album.coverCanvas;
      else {
        const url = (large ? album.coverUrl : album.coverUrlSmall) ?? album.coverUrl ?? album.coverUrlSmall;
        if (!url) throw new Error('no cover');
        source = await loadImage(url);
      }
      const texture = album.coverCanvas ? canvasTexture(album.coverCanvas) : new THREE.Texture(source as HTMLImageElement);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = maxAnisotropy;
      texture.needsUpdate = true;
      return { texture, source, color: dominantColor(source) };
    })();
    coverCache.set(key, p);
    p.catch(() => coverCache.delete(key));
  }
  return p;
}

/** Shown until the real artwork arrives (or when there is none). */
export function placeholderCover(album: Album): THREE.Texture {
  const [c, g] = canvas(256, 256);
  g.fillStyle = '#d9d5ce';
  g.fillRect(0, 0, 256, 256);
  g.fillStyle = '#6d6862';
  g.font = `600 18px ${FONT_SANS}`;
  wrapText(g, album.name, 18, 40, 220, 22, 4);
  g.font = `400 15px ${FONT_SANS}`;
  g.fillText(album.artist.slice(0, 28), 18, 232);
  const t = canvasTexture(c);
  t.userData.placeholder = true;
  return t;
}

function wrapText(g: CanvasRenderingContext2D, text: string, x: number, y: number, maxW: number, lineH: number, maxLines: number) {
  const words = text.split(/\s+/);
  let line = '';
  let lines = 0;
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (g.measureText(test).width > maxW && line) {
      g.fillText(line, x, y + lines * lineH);
      line = w;
      if (++lines >= maxLines) return;
    } else line = test;
  }
  if (line) g.fillText(line, x, y + lines * lineH);
}

function truncate(g: CanvasRenderingContext2D, text: string, maxW: number) {
  if (g.measureText(text).width <= maxW) return text;
  let t = text;
  while (t.length > 1 && g.measureText(t + '…').width > maxW) t = t.slice(0, -1);
  return t + '…';
}

/* ------------------------------------------------------------------ */
/* Spine                                                               */
/* ------------------------------------------------------------------ */

export function spineTexture(album: Album, color: THREE.Color): THREE.Texture {
  // Drawn landscape, mapped onto the (portrait) side face with rotation.
  const [c, g] = canvas(1024, 48);
  const hsl = { h: 0, s: 0, l: 0 };
  color.getHSL(hsl);
  const bg = new THREE.Color().setHSL(hsl.h, Math.min(0.5, hsl.s), Math.min(0.35, hsl.l * 0.8));
  g.fillStyle = `#${bg.getHexString()}`;
  g.fillRect(0, 0, 1024, 48);
  g.fillStyle = 'rgba(255,255,255,0.88)';
  g.font = `600 22px ${FONT_SANS}`;
  g.textBaseline = 'middle';
  const text = truncate(g, `${album.artist.toUpperCase()}   ${album.name}`, 940);
  g.fillText(text, 40, 25);
  const t = canvasTexture(c);
  t.center.set(0.5, 0.5);
  t.rotation = Math.PI / 2;
  return t;
}

/* ------------------------------------------------------------------ */
/* Booklet back: liner notes with the tracklist                        */
/* ------------------------------------------------------------------ */

export interface BookletLines {
  /** Rows in UV space (v from bottom) for hit testing. */
  rows: { v0: number; v1: number; u0: number; u1: number; index: number }[];
}

export function formatTime(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function drawBooklet(
  g: CanvasRenderingContext2D,
  size: number,
  album: Album,
  tracks: Track[] | null,
  playingIndex: number,
  accent: THREE.Color,
): BookletLines {
  const pad = size * 0.075;
  g.fillStyle = '#ece7dd';
  g.fillRect(0, 0, size, size);
  // faint paper grain
  for (let i = 0; i < 900; i++) {
    g.fillStyle = `rgba(0,0,0,${Math.random() * 0.025})`;
    g.fillRect(Math.random() * size, Math.random() * size, 2, 2);
  }
  const ink = '#1a1816';
  const soft = '#6f6a61';
  g.textBaseline = 'alphabetic';
  g.fillStyle = ink;
  g.font = `600 ${size * 0.04}px ${FONT_SANS}`;
  g.fillText(truncate(g, album.name, size - pad * 2), pad, pad + size * 0.035);
  g.fillStyle = soft;
  g.font = `400 ${size * 0.028}px ${FONT_SANS}`;
  g.fillText(truncate(g, [album.artist, album.year].filter(Boolean).join(' · '), size - pad * 2), pad, pad + size * 0.08);
  g.fillStyle = `#${accent.getHexString()}`;
  g.fillRect(pad, pad + size * 0.105, size * 0.06, size * 0.006);

  const rows: BookletLines['rows'] = [];
  const top = pad + size * 0.16;
  const bottom = size - pad - size * 0.06;
  if (!tracks?.length) {
    g.fillStyle = soft;
    g.font = `400 ${size * 0.03}px ${FONT_MONO}`;
    g.fillText(tracks ? 'No tracks' : 'Loading tracklist…', pad, top + size * 0.04);
  } else {
    const cols = tracks.length > 16 ? 2 : 1;
    const perCol = Math.ceil(tracks.length / cols);
    const lineH = Math.min(size * 0.05, (bottom - top) / perCol);
    const colW = (size - pad * 2 - (cols - 1) * size * 0.04) / cols;
    const fs = Math.min(size * 0.034, lineH * 0.64);
    tracks.forEach((t, i) => {
      const col = Math.floor(i / perCol);
      const row = i % perCol;
      const x = pad + col * (colW + size * 0.04);
      const y = top + row * lineH;
      const playing = i === playingIndex;
      if (playing) {
        g.fillStyle = `#${accent.getHexString()}22`;
        g.fillRect(x - size * 0.012, y, colW + size * 0.024, lineH * 0.92);
      }
      const base = y + lineH * 0.62;
      g.font = `${playing ? 600 : 500} ${fs}px ${FONT_MONO}`;
      g.fillStyle = playing ? ink : soft;
      g.fillText(String(i + 1).padStart(2, '0'), x, base);
      g.fillStyle = ink;
      g.font = `${playing ? 600 : 400} ${fs}px ${FONT_SANS}`;
      const numW = fs * 2.2;
      const timeW = fs * 3.2;
      g.fillText(truncate(g, t.name, colW - numW - timeW), x + numW, base);
      g.font = `400 ${fs}px ${FONT_MONO}`;
      g.fillStyle = soft;
      const time = formatTime(t.durationMs);
      g.fillText(time, x + colW - g.measureText(time).width, base);
      rows.push({ v0: 1 - (y + lineH) / size, v1: 1 - y / size, u0: (x - size * 0.012) / size, u1: (x + colW) / size, index: i });
    });
  }
  g.fillStyle = soft;
  g.font = `400 ${size * 0.022}px ${FONT_MONO}`;
  const total = tracks?.reduce((s, t) => s + t.durationMs, 0) ?? 0;
  const foot = [album.label, tracks ? `${tracks.length} tracks · ${formatTime(total)}` : ''].filter(Boolean).join('   ');
  g.fillText(truncate(g, foot, size - pad * 2), pad, size - pad);
  return { rows };
}

/* ------------------------------------------------------------------ */
/* Disc label                                                           */
/* ------------------------------------------------------------------ */

/**
 * Picture-disc label: artwork printed on an annulus, a clear stacking ring,
 * and an iridescent mirror band at the rim.
 */
export function discLabel(source: CanvasImageSource | null, color: THREE.Color) {
  const S = 1024;
  const [c, g] = canvas(S, S);
  const [mc, mg] = canvas(S, S); // metalness/roughness helper (white = shiny metal)
  const R = S / 2;
  g.translate(R, R);
  mg.translate(R, R);
  mg.fillStyle = '#000';
  mg.fillRect(-R, -R, S, S);

  // mirror base with rainbow sheen
  const base = g.createRadialGradient(0, 0, R * 0.1, 0, 0, R);
  base.addColorStop(0, '#dfe1e6');
  base.addColorStop(1, '#c4c7cf');
  g.fillStyle = base;
  g.beginPath();
  g.arc(0, 0, R, 0, Math.PI * 2);
  g.fill();
  if ('createConicGradient' in g) {
    const conic = g.createConicGradient(0.6, 0, 0);
    const hues = ['#ff9ac1', '#ffe08a', '#9dffb0', '#8fd8ff', '#c7a2ff', '#ff9ac1', '#ffe08a', '#9dffb0', '#8fd8ff', '#c7a2ff', '#ff9ac1'];
    hues.forEach((h, i) => conic.addColorStop(i / (hues.length - 1), h));
    g.globalAlpha = 0.35;
    g.fillStyle = conic;
    g.beginPath();
    g.arc(0, 0, R, 0, Math.PI * 2);
    g.fill();
    g.globalAlpha = 1;
  }
  mg.fillStyle = '#fff';
  mg.beginPath();
  mg.arc(0, 0, R, 0, Math.PI * 2);
  mg.fill();

  // printed artwork annulus
  const outer = R * 0.965;
  const inner = R * 0.36;
  g.save();
  g.beginPath();
  g.arc(0, 0, outer, 0, Math.PI * 2);
  g.arc(0, 0, inner, 0, Math.PI * 2, true);
  g.clip();
  if (source) {
    // cover the annulus with the artwork, slightly zoomed
    const s = outer * 2.04;
    g.drawImage(source, -s / 2, -s / 2, s, s);
  } else {
    g.fillStyle = `#${color.getHexString()}`;
    g.fillRect(-R, -R, S, S);
  }
  // subtle ink sheen
  const sheen = g.createLinearGradient(-R, -R, R, R);
  sheen.addColorStop(0, 'rgba(255,255,255,0.10)');
  sheen.addColorStop(0.5, 'rgba(255,255,255,0)');
  sheen.addColorStop(1, 'rgba(0,0,0,0.10)');
  g.fillStyle = sheen;
  g.fillRect(-R, -R, S, S);
  g.restore();
  mg.fillStyle = '#000';
  mg.beginPath();
  mg.arc(0, 0, outer, 0, Math.PI * 2);
  mg.fill();
  mg.fillStyle = '#fff';
  mg.beginPath();
  mg.arc(0, 0, inner, 0, Math.PI * 2);
  mg.fill();

  // mirror band, then the clear plastic hub (dark: you see what is behind it)
  const band = g.createRadialGradient(0, 0, R * 0.27, 0, 0, inner);
  band.addColorStop(0, '#c9ccd3');
  band.addColorStop(0.5, '#eceef2');
  band.addColorStop(1, '#bfc3ca');
  g.fillStyle = band;
  g.beginPath();
  g.arc(0, 0, inner, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#3d4047';
  g.beginPath();
  g.arc(0, 0, R * 0.27, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = 'rgba(255,255,255,0.35)';
  g.lineWidth = 3;
  for (const r of [0.2, 0.265]) {
    g.beginPath();
    g.arc(0, 0, R * r, 0, Math.PI * 2);
    g.stroke();
  }
  mg.fillStyle = '#000';
  mg.beginPath();
  mg.arc(0, 0, R * 0.27, 0, Math.PI * 2);
  mg.fill();

  // outer edge ring
  g.strokeStyle = 'rgba(255,255,255,0.7)';
  g.lineWidth = 4;
  g.beginPath();
  g.arc(0, 0, R - 3, 0, Math.PI * 2);
  g.stroke();

  return { map: canvasTexture(c), metal: canvasTexture(mc, false) };
}

/** The shiny data side of a disc. */
let dataSide: THREE.Texture | null = null;
export function discDataSide() {
  if (dataSide) return dataSide;
  const S = 512;
  const [c, g] = canvas(S, S);
  g.translate(S / 2, S / 2);
  const conic = g.createConicGradient(0, 0, 0);
  const hues = ['#d6d9e0', '#ffc7e0', '#fff1b8', '#c9ffd6', '#c2ecff', '#e1d0ff', '#d6d9e0', '#ffc7e0', '#fff1b8', '#c9ffd6', '#c2ecff', '#e1d0ff', '#d6d9e0'];
  hues.forEach((h, i) => conic.addColorStop(i / (hues.length - 1), h));
  g.fillStyle = conic;
  g.beginPath();
  g.arc(0, 0, S / 2, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = 'rgba(200,203,210,0.9)';
  g.beginPath();
  g.arc(0, 0, S * 0.18, 0, Math.PI * 2);
  g.fill();
  dataSide = canvasTexture(c);
  return dataSide;
}

/* ------------------------------------------------------------------ */
/* Soft drop shadow for floating objects                               */
/* ------------------------------------------------------------------ */

let shadowTex: THREE.Texture | null = null;
/** A blurred rounded-rectangle shadow sprite (PlaneGeometry sized by caller). */
export function softShadowTexture() {
  if (shadowTex) return shadowTex;
  const S = 256;
  const [c, g] = canvas(S, S);
  g.filter = 'blur(18px)';
  g.fillStyle = 'rgba(40, 30, 20, 1)';
  const pad = 52;
  const r = 24;
  g.beginPath();
  g.roundRect(pad, pad, S - pad * 2, S - pad * 2, r);
  g.fill();
  shadowTex = canvasTexture(c, false);
  return shadowTex;
}

export function softShadow(width: number, height: number, opacity = 0.3) {
  // The texture has a 52/256 transparent margin on each side.
  const k = 256 / (256 - 104);
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(width * k, height * k),
    new THREE.MeshBasicMaterial({ map: softShadowTexture(), transparent: true, opacity, depthWrite: false, color: 0x000000 }),
  );
  mesh.renderOrder = 1;
  mesh.raycast = () => {};
  return mesh;
}

