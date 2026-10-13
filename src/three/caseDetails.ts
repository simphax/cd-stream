import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32 } from '../demo/rng';
import { FONT_SANS, canvas, canvasTexture } from './textures';

/**
 * The small things that make a jewel case read as a jewel case: the moulded
 * black tray, the ridged hinge strip, hinge pins and booklet tabs on the lid,
 * and a lifetime of fine scratches in the polystyrene.
 *
 * Dimensions mirror CASE in jewelCase.ts (1 unit = 100 mm).
 */
const W = 1.42;
const H = 1.25;
const CX = W / 2 - 0.025 - 0.6;
/** Width of the hinge strip on the left of the lid. */
const HINGE = 0.085;

/* ------------------------------------------------------------------ */
/* Lid geometry: front plate (group 0) + flanges, pins and tabs (group 1) */
/* ------------------------------------------------------------------ */

export function lidGeometry(lidT: number) {
  const plateT = 0.014;
  const plate = new THREE.BoxGeometry(W, H, plateT);
  plate.translate(0, 0, lidT / 2 - plateT / 2);

  const back = lidT / 2 - plateT; // z of the plate's inner face
  const fd = lidT - plateT; // flange depth
  const fz = back - fd / 2;
  const t = 0.011;
  const parts: THREE.BufferGeometry[] = [];
  const box = (w: number, h: number, d: number, x: number, y: number, z: number) => {
    const b = new THREE.BoxGeometry(w, h, d);
    b.translate(x, y, z);
    parts.push(b);
  };
  box(W, t, fd, 0, H / 2 - t / 2, fz); // top flange
  box(W, t, fd, 0, -H / 2 + t / 2, fz); // bottom flange
  box(t, H - 2 * t, fd, W / 2 - t / 2, 0, fz); // opening edge
  box(t * 0.7, H - 2 * t, fd * 0.8, -W / 2 + t * 0.35, 0, fz); // hinge edge
  // hinge pins at the top and bottom of the spine
  for (const sy of [1, -1]) {
    const pin = new THREE.CylinderGeometry(0.017, 0.017, 0.07, 16);
    pin.translate(-W / 2 + 0.006, sy * (H / 2 - 0.05), back - 0.008);
    parts.push(pin);
  }
  // the two little tabs that hold the booklet on the opening side
  for (const sy of [1, -1]) box(0.05, 0.028, 0.006, W / 2 - 0.032, sy * 0.36, back - 0.003);
  // and the ribs along the hinge side that keep the booklet off the spine
  for (const sy of [1, -1]) box(0.012, 0.16, 0.007, -W / 2 + HINGE + 0.004, sy * 0.38, back - 0.0035);

  // every part is an indexed position/normal/uv geometry, as mergeGeometries requires
  const edges = mergeGeometries(parts, false)!;
  parts.forEach((p) => p.dispose());
  const lid = mergeGeometries([plate, edges], true)!;
  plate.dispose();
  edges.dispose();
  return lid;
}

/** The rosette that grips the disc: a ring of flexible teeth around a push button. */
export function rosetteGeometry() {
  const parts: THREE.BufferGeometry[] = [];
  const teeth = 12;
  for (let i = 0; i < teeth; i++) {
    const a = (i / teeth) * Math.PI * 2;
    const tooth = new THREE.BoxGeometry(0.013, 0.026, 0.016);
    tooth.translate(0, 0.06, 0.008);
    tooth.rotateZ(a);
    parts.push(tooth);
  }
  const ring = new THREE.CylinderGeometry(0.076, 0.08, 0.004, 48);
  ring.rotateX(Math.PI / 2);
  ring.translate(0, 0, 0.002);
  parts.push(ring);
  const button = new THREE.CylinderGeometry(0.036, 0.04, 0.012, 32);
  button.rotateX(Math.PI / 2);
  button.translate(0, 0, 0.006);
  parts.push(button);
  const geo = mergeGeometries(parts, false)!;
  parts.forEach((p) => p.dispose());
  return geo;
}

/* ------------------------------------------------------------------ */
/* Textures                                                            */
/* ------------------------------------------------------------------ */

/**
 * Normal map for the lid's front plate: bevelled rims and the ridged hinge
 * strip on the left, flat (but not perfectly) everywhere else.
 */
export function lidNormalMap() {
  const S = 1024;
  const [c, g] = canvas(S, S);
  const img = g.createImageData(S, S);
  const d = img.data;
  const pxPerUnit = S / W;
  const hinge = Math.round(HINGE * pxPerUnit);
  const bevel = 7;
  const rng = mulberry32(99);
  // a very slight waviness: injection-moulded plastic is never optically flat
  const waves = Array.from({ length: 4 }, () => ({ fx: rng() * 0.02, fy: rng() * 0.02, p: rng() * 6 }));
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      let nx = 0;
      let ny = 0;
      for (const w of waves) {
        nx += Math.sin(x * w.fx + y * w.fy + w.p) * 0.012;
        ny += Math.cos(x * w.fy - y * w.fx + w.p) * 0.012;
      }
      if (x < hinge) {
        // fine vertical ridges on the hinge strip
        nx += Math.sin((x / 5) * Math.PI * 2) * 0.45;
        if (x > hinge - 5) nx -= 0.6; // the step down to the booklet window
      }
      if (x < bevel) nx -= 0.85 * (1 - x / bevel);
      if (x > S - bevel) nx += 0.85 * (1 - (S - x) / bevel);
      if (y < bevel) ny += 0.85 * (1 - y / bevel);
      if (y > S - bevel) ny -= 0.85 * (1 - (S - y) / bevel);
      const len = Math.hypot(nx, ny, 1);
      const i = (y * S + x) * 4;
      d[i] = 128 + (nx / len) * 127;
      d[i + 1] = 128 + (ny / len) * 127;
      d[i + 2] = 128 + (1 / len) * 127;
      d[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const t = canvasTexture(c, false);
  t.anisotropy = 4;
  return t;
}

/** Hairline scratches, cleaning swirls and a thumbprint near the opening edge. */
function drawWear(g: CanvasRenderingContext2D, S: number, strength: number, seed: number) {
  const rng = mulberry32(seed);
  g.lineCap = 'round';
  // swirl marks from being wiped on a t-shirt
  for (let i = 0; i < 70; i++) {
    const cx = rng() * S;
    const cy = rng() * S;
    const r = 40 + rng() * 260;
    const a0 = rng() * Math.PI * 2;
    g.strokeStyle = `rgba(255,255,255,${(0.05 + rng() * 0.12) * strength})`;
    g.lineWidth = 0.6 + rng() * 0.8;
    g.beginPath();
    g.arc(cx, cy, r, a0, a0 + 0.15 + rng() * 0.5);
    g.stroke();
  }
  // straight hairlines
  for (let i = 0; i < 45; i++) {
    const x = rng() * S;
    const y = rng() * S;
    const len = 15 + rng() * 120;
    const a = rng() * Math.PI;
    g.strokeStyle = `rgba(255,255,255,${(0.08 + rng() * 0.18) * strength})`;
    g.lineWidth = 0.5 + rng() * 0.7;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
    g.stroke();
  }
  // a thumbprint where the case is always opened
  const tx = S * 0.93;
  const ty = S * (0.45 + rng() * 0.1);
  g.save();
  g.translate(tx, ty);
  g.rotate(-0.4);
  for (let r = 4; r < 46; r += 3.2) {
    g.strokeStyle = `rgba(255,255,255,${0.06 * strength * (1 - r / 50)})`;
    g.lineWidth = 1.2;
    g.beginPath();
    g.ellipse(0, 0, r * 0.75, r, 0, 0, Math.PI * 2);
    g.stroke();
  }
  g.restore();
}

/** Roughness map (green channel) for the lid: glossy, with wear that scatters light. */
export function lidRoughnessMap() {
  const S = 1024;
  const [c, g] = canvas(S, S);
  g.fillStyle = 'rgb(14,14,14)';
  g.fillRect(0, 0, S, S);
  // the hinge strip is slightly satin
  g.fillStyle = 'rgb(40,40,40)';
  g.fillRect(0, 0, Math.round((HINGE / W) * S), S);
  drawWear(g, S, 1.6, 7);
  const t = canvasTexture(c, false);
  t.anisotropy = 4;
  return t;
}

/** The same wear on black, for the glare overlay (white = scratch). */
function wearTexture() {
  const S = 1024;
  const [c, g] = canvas(S, S);
  g.fillStyle = '#000';
  g.fillRect(0, 0, S, S);
  drawWear(g, S, 1.6, 7);
  return canvasTexture(c, false);
}

let wearTex: THREE.Texture | null = null;

/**
 * Additive highlight for the lid: a soft diagonal reflection that slides with
 * the case's tilt, lighting up the scratches as it passes over them.
 */
export function glareMaterial() {
  wearTex ??= wearTexture();
  return new THREE.ShaderMaterial({
    uniforms: { wear: { value: wearTex }, shift: { value: 0 }, opacity: { value: 0.4 } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D wear;
      uniform float shift;
      uniform float opacity;
      varying vec2 vUv;
      float band(float t, float a, float b, float c) {
        return smoothstep(a, b, t) * (1.0 - smoothstep(b, c, t));
      }
      void main() {
        float t = (vUv.x + (1.0 - vUv.y)) * 0.5 - shift;
        float streak = band(t, 0.36, 0.415, 0.47) * 0.6 + band(t, 0.53, 0.575, 0.62) * 0.22;
        float near = exp(-pow((t - 0.45) / 0.15, 2.0));
        float w = texture2D(wear, vUv).g;
        float a = (streak + w * (0.08 + near * 1.1)) * opacity;
        gl_FragColor = vec4(1.0, 1.0, 1.0, a);
      }`,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
}

/**
 * The black tray as seen from the front: frame, ribbed hinge panel,
 * disc well with finger notches, rosette surround and moulding marks.
 */
export function trayTexture() {
  const PX = 800; // pixels per unit
  const cw = Math.round(W * PX);
  const ch = Math.round(H * PX);
  const [c, g] = canvas(cw, ch);
  const X = (x: number) => (x + W / 2) * PX;
  const Y = (y: number) => (H / 2 - y) * PX;

  g.fillStyle = '#121214';
  g.fillRect(0, 0, cw, ch);

  // clear outer frame of the base, seen edge-on
  const frame = 0.018 * PX;
  g.fillStyle = '#26272b';
  g.fillRect(0, 0, cw, frame);
  g.fillRect(0, ch - frame, cw, frame);
  g.fillRect(0, 0, frame, ch);
  g.fillRect(cw - frame, 0, frame, ch);
  g.strokeStyle = 'rgba(255,255,255,0.10)';
  g.lineWidth = 2;
  g.strokeRect(frame, frame, cw - 2 * frame, ch - 2 * frame);

  // ribbed hinge panel
  const hx0 = frame + 6;
  const hx1 = X(CX - 0.6) - 10;
  g.fillStyle = '#16171a';
  g.fillRect(hx0, frame + 6, hx1 - hx0, ch - 2 * frame - 12);
  for (let x = hx0 + 6; x < hx1 - 4; x += 7) {
    g.fillStyle = 'rgba(255,255,255,0.045)';
    g.fillRect(x, Y(0.42), 2, Y(-0.42) - Y(0.42));
    g.fillStyle = 'rgba(0,0,0,0.35)';
    g.fillRect(x + 2, Y(0.42), 2, Y(-0.42) - Y(0.42));
  }
  // sockets for the lid's hinge pins
  for (const sy of [1, -1]) {
    g.fillStyle = '#0b0b0c';
    g.beginPath();
    g.roundRect(hx0 + 2, Y(sy * (H / 2 - 0.05)) - 26, hx1 - hx0 - 4, 52, 10);
    g.fill();
  }

  // disc well
  const cx = X(CX);
  const cy = Y(0);
  const R = 0.606 * PX;
  const well = g.createRadialGradient(cx, cy, R * 0.2, cx, cy, R);
  well.addColorStop(0, '#18181b');
  well.addColorStop(1, '#141416');
  g.fillStyle = well;
  g.beginPath();
  g.arc(cx, cy, R, 0, Math.PI * 2);
  g.fill();
  // finger notches either side of the disc
  for (const a of [Math.PI, 0]) {
    const nx = cx + Math.cos(a) * R;
    g.fillStyle = '#0a0a0b';
    g.beginPath();
    g.ellipse(nx, cy, 0.05 * PX, 0.11 * PX, 0, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.08)';
    g.lineWidth = 2;
    g.stroke();
  }
  // moulded rim of the well (lit from the top left)
  g.lineWidth = 3;
  g.strokeStyle = 'rgba(255,255,255,0.10)';
  g.beginPath();
  g.arc(cx, cy, R, Math.PI * 0.9, Math.PI * 1.9);
  g.stroke();
  g.strokeStyle = 'rgba(0,0,0,0.55)';
  g.beginPath();
  g.arc(cx, cy, R, Math.PI * 1.9, Math.PI * 2.9);
  g.stroke();
  // raised land the disc rests on, and the rosette surround
  g.strokeStyle = 'rgba(255,255,255,0.06)';
  g.lineWidth = 2;
  for (const r of [0.33, 0.115]) {
    g.beginPath();
    g.arc(cx, cy, r * PX, 0, Math.PI * 2);
    g.stroke();
  }
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    g.strokeStyle = i % 2 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.45)';
    g.beginPath();
    g.moveTo(cx + Math.cos(a) * 0.085 * PX, cy + Math.sin(a) * 0.085 * PX);
    g.lineTo(cx + Math.cos(a) * 0.112 * PX, cy + Math.sin(a) * 0.112 * PX);
    g.stroke();
  }

  // moulding marks: "PUSH", and the polystyrene recycling code
  const emboss = (draw: () => void) => {
    g.save();
    g.translate(1.5, 1.5);
    g.fillStyle = g.strokeStyle = 'rgba(0,0,0,0.6)';
    draw();
    g.restore();
    g.fillStyle = g.strokeStyle = 'rgba(255,255,255,0.13)';
    draw();
  };
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  emboss(() => {
    g.font = `600 ${0.024 * PX}px ${FONT_SANS}`;
    g.fillText('PUSH', cx, cy - 0.15 * PX);
  });
  const rx = (hx0 + hx1) / 2;
  const ry = Y(-0.5);
  emboss(() => {
    const s = 0.03 * PX;
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(rx, ry - s);
    g.lineTo(rx + s, ry + s * 0.75);
    g.lineTo(rx - s, ry + s * 0.75);
    g.closePath();
    g.stroke();
    g.font = `600 ${0.022 * PX}px ${FONT_SANS}`;
    g.fillText('6', rx, ry + s * 0.12);
    g.font = `600 ${0.018 * PX}px ${FONT_SANS}`;
    g.fillText('PS', rx, ry + s * 1.5);
  });

  // fine surface grain from the mould
  const rng = mulberry32(3);
  for (let i = 0; i < 4000; i++) {
    g.fillStyle = `rgba(255,255,255,${rng() * 0.02})`;
    g.fillRect(rng() * cw, rng() * ch, 1.5, 1.5);
  }
  return canvasTexture(c);
}
