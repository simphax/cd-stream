import { CASE } from './jewelCase';
import { PLAYER } from './player';
import { FOV } from './stage';

export const SHELF = {
  colW: CASE.W + 0.52,
  rowH: 2.36,
  plankT: 0.08,
  rise: 0.12,
  depthStep: 0.155,
  lean: 0.085,
  peekLift: 0.6,
};

export const HUD_DEPTH = 3;

export interface Rect {
  x: number;
  y: number;
}

export interface Layout {
  width: number;
  height: number;
  portrait: boolean;
  rows: number;
  camY: number;
  camZ: number;
  /** World units per CSS pixel on the shelf plane. */
  worldPerPx: number;
  panMin: number;
  panMax: number;
  hud: {
    w: number;
    h: number;
    player: { x: number; y: number; scale: number; rotY: number };
    focus: { x: number; y: number; closedScale: number; openScale: number };
  };
}

/** Fraction of the screen height the shelf gets in portrait (top part). */
const PORTRAIT_SHELF = 0.5;
const PORTRAIT_TOP = 0.065;

const tan = Math.tan(((FOV / 2) * Math.PI) / 180);
const PLAYER_TOTAL_H = PLAYER.H + PLAYER.CORD + 0.25;

export function chooseRows(width: number, height: number) {
  const portrait = width / height < 0.9;
  const shelfPx = portrait ? height * PORTRAIT_SHELF : height * 0.9;
  const target = portrait ? 240 : 330;
  return Math.max(1, Math.min(4, Math.round(shelfPx / target)));
}

export function computeLayout(width: number, height: number, rows: number, contentWidth: number): Layout {
  const aspect = width / height;
  const portrait = aspect < 0.9;

  // Vertical extent of the shelf unit (bottom plank to top plank).
  const yBottom = -SHELF.plankT - 0.12;
  const yTop = rows * SHELF.rowH + 0.12;
  const contentH = yTop - yBottom;
  const contentMid = (yTop + yBottom) / 2;

  let viewH: number;
  let camY: number;
  if (portrait) {
    viewH = contentH / PORTRAIT_SHELF;
    camY = contentMid - (0.5 - (PORTRAIT_TOP + PORTRAIT_SHELF / 2)) * viewH;
  } else {
    viewH = contentH / 0.9;
    camY = contentMid;
  }
  let camZ = viewH / (2 * tan);
  // Keep the shelf comfortably behind the HUD plane (player, focused case).
  if (camZ < 5.5) {
    camZ = 5.5;
    viewH = camZ * 2 * tan;
    if (portrait) camY = contentMid - (0.5 - (PORTRAIT_TOP + PORTRAIT_SHELF / 2)) * viewH;
  }
  const viewW = viewH * aspect;

  // HUD (camera space) layout
  const hudH = 2 * HUD_DEPTH * tan;
  const hudW = hudH * aspect;
  const margin = Math.min(hudW, hudH) * 0.05;
  let player: Layout['hud']['player'];
  let focus: Layout['hud']['focus'];
  let reserveRight = 0;

  if (portrait) {
    const room = 1 - PORTRAIT_TOP - PORTRAIT_SHELF - 0.05;
    const s = Math.min((0.6 * hudW) / PLAYER.W, (room * hudH) / PLAYER_TOTAL_H);
    const y = -hudH / 2 + hudH * 0.015 + (PLAYER.H / 2 + PLAYER.CORD + 0.25) * s;
    player = { x: 0, y, scale: s, rotY: 0 };
    const regionTop = hudH / 2 - margin * 2.2;
    const regionBottom = y + (PLAYER.H / 2) * s + margin * 1.4;
    const regionH = regionTop - regionBottom;
    const openScale = Math.min((hudW * 0.92) / (2 * CASE.W), (regionH * 0.7) / CASE.H);
    const closedScale = Math.min((hudW * 0.74) / CASE.W, (regionH * 0.72) / CASE.H, openScale * 1.7);
    focus = { x: 0, y: (regionTop + regionBottom) / 2 + regionH * 0.04, closedScale, openScale };
  } else {
    const s = Math.min((0.66 * hudH) / PLAYER_TOTAL_H, (0.25 * hudW) / PLAYER.W);
    const x = hudW / 2 - margin * 1.3 - (PLAYER.W / 2) * s;
    const y = -0.03 * hudH + ((PLAYER.CORD + 0.25) / 2) * s;
    player = { x, y, scale: s, rotY: -0.16 };
    const regionLeft = -hudW / 2 + margin;
    const regionRight = x - (PLAYER.W / 2) * s - margin;
    const regionW = regionRight - regionLeft;
    const openScale = Math.min((regionW * 0.9) / (2 * CASE.W), (hudH * 0.6) / CASE.H);
    const closedScale = Math.min((regionW * 0.66) / CASE.W, (hudH * 0.62) / CASE.H, openScale * 1.45);
    focus = { x: (regionLeft + regionRight) / 2, y: 0.04 * hudH, closedScale, openScale };
    reserveRight = ((hudW / 2 - (x - (PLAYER.W / 2) * s)) / hudW) * viewW;
  }

  const edge = 0.45;
  const panMin = viewW / 2 - edge;
  let panMax = contentWidth + edge - viewW / 2 + reserveRight;
  if (panMax < panMin) panMax = panMin;
  // If everything fits, centre the shelf in the free area.
  const fits = contentWidth + 2 * edge <= viewW - reserveRight;
  const centred = contentWidth / 2 + reserveRight / 2;

  return {
    width,
    height,
    portrait,
    rows,
    camY,
    camZ,
    worldPerPx: viewH / height,
    panMin: fits ? centred : panMin,
    panMax: fits ? centred : panMax,
    hud: { w: hudW, h: hudH, player, focus },
  };
}
