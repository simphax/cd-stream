import type { Album, Track } from '../types';
import { hashString, mulberry32, pick, type Rng } from './rng';

/** A shelf of fictional albums with generated cover art, for the demo mode. */

const ALBUMS: [string, string, string][] = [
  ['Slow Weather', 'Paper Lanterns', '1997'],
  ['Neon Tide', 'Mira Okafor', '2001'],
  ['Kitchen Radio', 'The Quiet Hours', '1994'],
  ['Satellites of Summer', 'Juno Park', '1999'],
  ['Long Exposure', 'Halden', '2003'],
  ['Soft Machines', 'Lea Varga', '1996'],
  ['Postcards', 'Field Notes', '2000'],
  ['Night Bus Home', 'Ostra', '2002'],
  ['Analogue Hearts', 'Sundae Club', '1998'],
  ['Blue Hour Sessions', 'Teo Marin Trio', '1995'],
  ['Orchard', 'Willow & Ash', '2004'],
  ['Static Bloom', 'Glasshouse', '1999'],
  ['Low Orbit', 'Kepler Youth', '2001'],
  ['Saltwater Tapes', 'Nora Lind', '1993'],
  ['Parallel Lines', 'Grid', '1997'],
  ['Shortwave', 'Amber Rooms', '2000'],
  ['Weekend Forever', 'Polaroid Kids', '1998'],
  ['A Room With Plants', 'Clementine', '2002'],
  ['Highway Lights', 'Desert Motel', '1996'],
  ['Quiet Machinery', 'Ilse Brandt', '2003'],
  ['Small Hours', 'The Lamplighters', '1995'],
  ['Cassette Summer', 'Rio Kanda', '1999'],
  ['Moth & Moon', 'Velvet Static', '2001'],
  ['Coastal', 'Harbour Choir', '1997'],
  ['Sunday Drivers', 'Mopeds', '1994'],
  ['Echo Valley', 'Northern Pines', '2004'],
  ['Pastel Futures', 'Yumi & The Robots', '2000'],
  ['Midnight Laundromat', 'Coin Op', '1998'],
  ['Glow', 'Ada Sol', '2002'],
  ['Rooftop Weather', 'Skylight', '1996'],
  ['Telephone Wires', 'Ferns', '1999'],
  ['Dust & Gold', 'Marlow Grey', '2003'],
  ['Lighthouse Keeper', 'Ines Moreau', '1995'],
  ['Wavelengths', 'Prism Theory', '2001'],
  ['Bicycle Bells', 'Pip & Puddle', '1997'],
  ['Afterglow', 'Lumen', '2004'],
  ['Paper Planes', 'Odette', '1998'],
  ['Late Checkout', 'Hotel Lobby', '2002'],
  ['Tidal', 'Sea Glass', '1996'],
  ['Arcade Dreams', 'Pixel Hearts', '2000'],
];

const WORDS_A = ['Golden', 'Quiet', 'Paper', 'Silver', 'Summer', 'Little', 'Electric', 'Hollow', 'Velvet', 'Distant', 'Open', 'Northern', 'Blue', 'Slow', 'Bright', 'Soft', 'Late', 'Gentle', 'Secret', 'Lonely'];
const WORDS_B = ['Lights', 'Rain', 'Morning', 'Signals', 'Gardens', 'Waves', 'Letters', 'Rooms', 'Stars', 'Roads', 'Windows', 'Rivers', 'Dreams', 'Echoes', 'Kites', 'Tides', 'Clouds', 'Bridges', 'Songs', 'Hours'];
const SINGLE = ['Intro', 'Interlude', 'Reprise', 'Home', 'Outro', 'Static', 'Drift', 'Lullaby', 'Overture', 'Coda'];

const PALETTES = [
  ['#f2e8d5', '#e4572e', '#29335c', '#f3a712'],
  ['#1b1f3b', '#ff7b54', '#ffb26b', '#ffd56f'],
  ['#e8ece9', '#2d6a4f', '#95d5b2', '#081c15'],
  ['#fdf0d5', '#c1121f', '#003049', '#669bbc'],
  ['#0d1b2a', '#e0e1dd', '#778da9', '#415a77'],
  ['#ffe5ec', '#fb6f92', '#ff8fab', '#3d0814'],
  ['#f6f1eb', '#222222', '#c9a227', '#7a7a7a'],
  ['#2b2d42', '#edf2f4', '#ef233c', '#8d99ae'],
  ['#fefae0', '#283618', '#606c38', '#dda15e'],
  ['#e9f5f9', '#0081a7', '#00afb9', '#f07167'],
  ['#14213d', '#fca311', '#e5e5e5', '#000000'],
  ['#f1faee', '#457b9d', '#1d3557', '#e63946'],
  ['#3c1642', '#086375', '#1dd3b0', '#affc41'],
  ['#ece4db', '#9d8189', '#d8a48f', '#22223b'],
];

function drawCover(title: string, artist: string, seed: number): HTMLCanvasElement {
  const size = 512;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const rng = mulberry32(seed);
  const [bg, a, b, d] = pick(rng, PALETTES);
  g.fillStyle = bg;
  g.fillRect(0, 0, size, size);
  const style = Math.floor(rng() * 8);

  switch (style) {
    case 0: {
      // Bauhaus sun
      g.fillStyle = a;
      g.beginPath();
      g.arc(size * (0.3 + rng() * 0.4), size * (0.35 + rng() * 0.2), size * (0.22 + rng() * 0.12), 0, Math.PI * 2);
      g.fill();
      g.fillStyle = b;
      g.fillRect(0, size * 0.68, size, size * 0.32);
      g.fillStyle = d;
      g.fillRect(size * 0.08, size * 0.74, size * 0.3, 6);
      break;
    }
    case 1: {
      // horizon stripes
      const n = 6 + Math.floor(rng() * 8);
      for (let i = 0; i < n; i++) {
        g.fillStyle = [a, b, d][i % 3];
        const h = (size / n) * (0.25 + (i / n) * 0.75);
        g.fillRect(0, size * 0.25 + (i * size * 0.75) / n, size, h);
      }
      break;
    }
    case 2: {
      // dot grid
      const n = 7 + Math.floor(rng() * 6);
      const step = size / (n + 1);
      for (let x = 1; x <= n; x++)
        for (let y = 1; y <= n; y++) {
          g.fillStyle = rng() > 0.85 ? a : rng() > 0.5 ? b : d;
          g.beginPath();
          g.arc(x * step, y * step, step * (0.12 + rng() * 0.25), 0, Math.PI * 2);
          g.fill();
        }
      break;
    }
    case 3: {
      // soft gradient blobs
      for (let i = 0; i < 5; i++) {
        const x = rng() * size;
        const y = rng() * size;
        const r = size * (0.3 + rng() * 0.5);
        const grad = g.createRadialGradient(x, y, 0, x, y, r);
        const col = [a, b, d][i % 3];
        grad.addColorStop(0, col);
        grad.addColorStop(1, col + '00');
        g.fillStyle = grad;
        g.fillRect(0, 0, size, size);
      }
      break;
    }
    case 4: {
      // concentric rings
      const cx = size * (0.35 + rng() * 0.3);
      const cy = size * (0.35 + rng() * 0.3);
      for (let r = size * 0.9; r > 10; r -= size * (0.04 + rng() * 0.05)) {
        g.strokeStyle = [a, b, d][Math.floor(rng() * 3)];
        g.lineWidth = 3 + rng() * 14;
        g.beginPath();
        g.arc(cx, cy, r, 0, Math.PI * 2);
        g.stroke();
      }
      break;
    }
    case 5: {
      // diagonal split
      g.fillStyle = a;
      g.beginPath();
      g.moveTo(0, size);
      g.lineTo(size, size * (0.2 + rng() * 0.4));
      g.lineTo(size, size);
      g.fill();
      g.fillStyle = b;
      g.beginPath();
      g.arc(size * 0.7, size * 0.3, size * 0.09, 0, Math.PI * 2);
      g.fill();
      break;
    }
    case 6: {
      // ridgelines
      g.fillStyle = d;
      g.fillRect(0, 0, size, size);
      const lines = 18;
      for (let i = 0; i < lines; i++) {
        const y0 = size * 0.22 + (i * size * 0.6) / lines;
        g.beginPath();
        g.moveTo(size * 0.15, y0);
        for (let x = 0; x <= 60; x++) {
          const px = size * 0.15 + (x / 60) * size * 0.7;
          const mid = 1 - Math.abs(x / 60 - 0.5) * 2;
          const amp = Math.pow(Math.max(0, mid), 2.5) * (20 + rng() * 40);
          g.lineTo(px, y0 - amp * rng());
        }
        g.lineTo(size * 0.85, y0 + 30);
        g.lineTo(size * 0.15, y0 + 30);
        g.closePath();
        g.fillStyle = d;
        g.fill();
        g.strokeStyle = bg;
        g.lineWidth = 2;
        g.stroke();
      }
      break;
    }
    default: {
      // big type
      g.fillStyle = a;
      g.fillRect(0, 0, size, size);
      g.fillStyle = bg;
      g.font = `600 ${size * 0.2}px Inter, system-ui, sans-serif`;
      g.textBaseline = 'top';
      const words = title.toUpperCase().split(' ');
      words.forEach((w, i) => g.fillText(w, size * 0.06, size * 0.1 + i * size * 0.19, size * 0.9));
      break;
    }
  }

  // small typography in a corner, like a real sleeve
  g.fillStyle = style === 6 ? bg : style === 7 ? b : d;
  g.font = `600 ${size * 0.034}px Inter, system-ui, sans-serif`;
  g.textBaseline = 'alphabetic';
  g.fillText(artist.toUpperCase(), size * 0.06, size * 0.93);
  g.font = `400 ${size * 0.034}px Inter, system-ui, sans-serif`;
  g.fillText(title, size * 0.06, size * 0.965);
  return c;
}

function makeTracks(rng: Rng, albumId: string, artist: string): Track[] {
  const n = 7 + Math.floor(rng() * 7);
  return Array.from({ length: n }, (_, i) => {
    const name =
      rng() < 0.15 ? pick(rng, SINGLE) : rng() < 0.5 ? `${pick(rng, WORDS_A)} ${pick(rng, WORDS_B)}` : `${pick(rng, WORDS_B)} of ${pick(rng, WORDS_A)} ${pick(rng, WORDS_B)}`;
    return {
      id: `${albumId}-${i}`,
      uri: `demo:track:${albumId}:${i}`,
      name,
      artists: artist,
      durationMs: Math.round((95 + rng() * 150) * 1000),
      trackNumber: i + 1,
      discNumber: 1,
    };
  });
}

export function demoLibrary(): Album[] {
  return ALBUMS.map(([name, artist, year], i) => {
    const seed = hashString(name + artist);
    const rng = mulberry32(seed);
    const id = `demo${i}`;
    const tracks = makeTracks(rng, id, artist);
    return {
      id,
      uri: `demo:album:${id}`,
      name,
      artist,
      year,
      label: pick(rng, ['Lantern Records', 'Blue Room', 'Cassette Club', 'North Pier', 'Small Hours Music']),
      coverCanvas: drawCover(name, artist, seed),
      tracks,
      totalTracks: tracks.length,
    };
  });
}
