import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Spring, animator, ease } from '../anim/tween';
import { mulberry32 } from '../demo/rng';
import type { Album } from '../types';
import { CASE, JewelCase } from './jewelCase';
import { SHELF } from './layout';
import { WALL_COLOR } from './stage';
import { canvas, canvasTexture, loadCover } from './textures';

export interface Stack {
  index: number;
  group: THREE.Group;
  /** Front (0) to back. */
  cases: JewelCase[];
  fan: Spring;
  riser: THREE.Mesh | null;
}

const WALL_Z = -1.02;
const PLANK_FRONT = 0.24;

function woodTexture() {
  const [c, g] = canvas(1024, 128);
  g.fillStyle = '#dcc7a4';
  g.fillRect(0, 0, 1024, 128);
  const rng = mulberry32(42);
  for (let i = 0; i < 90; i++) {
    const y = rng() * 128;
    const amp = 2 + rng() * 6;
    const freq = 0.002 + rng() * 0.01;
    const phase = rng() * 10;
    g.strokeStyle = `rgba(${120 + rng() * 40},${80 + rng() * 30},${40 + rng() * 20},${0.05 + rng() * 0.12})`;
    g.lineWidth = 0.6 + rng() * 2.2;
    g.beginPath();
    for (let x = 0; x <= 1024; x += 16) {
      const yy = y + Math.sin(x * freq + phase) * amp;
      x ? g.lineTo(x, yy) : g.moveTo(x, yy);
    }
    g.stroke();
  }
  const t = canvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  return t;
}

function plasterTexture() {
  const [c, g] = canvas(256, 256);
  const img = g.createImageData(256, 256);
  const rng = mulberry32(7);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = 245 + Math.floor(rng() * 10);
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const t = canvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(60, 16);
  return t;
}

const riserCache = new Map<number, THREE.BufferGeometry>();
function riserGeometry(n: number) {
  let geo = riserCache.get(n);
  if (geo) return geo;
  const parts: THREE.BufferGeometry[] = [];
  for (let k = 1; k < n; k++) {
    const h = k * SHELF.rise;
    const b = new THREE.BoxGeometry(CASE.W * 0.84, h, SHELF.depthStep + 0.002);
    b.translate(0, h / 2, -CASE.D / 2 - k * SHELF.depthStep);
    parts.push(b);
  }
  geo = parts.length ? mergeGeometries(parts) : new THREE.BufferGeometry();
  riserCache.set(n, geo);
  return geo;
}

/**
 * The bookcase: back wall, planks, side panels and stacks of jewel cases
 * standing on little stepped risers so each case peeks over the one in front.
 */
export class Shelf {
  readonly group = new THREE.Group();
  stacks: Stack[] = [];
  cases: JewelCase[] = [];
  rows = 2;
  contentWidth = 0;
  readonly wallMat: THREE.MeshStandardMaterial;

  private furniture = new THREE.Group();
  private plankMat: THREE.MeshStandardMaterial;
  private riserMat: THREE.MeshStandardMaterial;
  private wall: THREE.Mesh;
  private wood = woodTexture();
  private hovered: JewelCase | null = null;
  private tmpEuler = new THREE.Euler();

  constructor() {
    this.wallMat = new THREE.MeshStandardMaterial({ color: WALL_COLOR, map: plasterTexture(), roughness: 0.95 });
    this.wall = new THREE.Mesh(new THREE.PlaneGeometry(400, 100), this.wallMat);
    this.wall.position.z = WALL_Z;
    this.wall.receiveShadow = true;
    this.plankMat = new THREE.MeshStandardMaterial({ color: 0xffffff, map: this.wood, roughness: 0.7 });
    this.riserMat = new THREE.MeshStandardMaterial({ color: 0xf0e6d6, map: this.wood, roughness: 0.75 });
    this.group.add(this.wall, this.furniture);
  }

  /** Builds stacks for a new library. */
  setAlbums(albums: Album[], rows: number) {
    this.cases.forEach((c) => c.dispose());
    this.stacks.forEach((s) => s.group.removeFromParent());
    this.cases = [];
    this.stacks = [];

    const rng = mulberry32(1234);
    let i = 0;
    while (i < albums.length) {
      const r = rng();
      const size = Math.min(albums.length - i, r < 0.12 ? 2 : r < 0.45 ? 3 : r < 0.85 ? 4 : 5);
      const stack: Stack = { index: this.stacks.length, group: new THREE.Group(), cases: [], fan: new Spring(0, 140, 16), riser: null };
      for (let k = 0; k < size; k++, i++) {
        const c = new JewelCase(albums[i]);
        c.shelf = {
          stackIndex: stack.index,
          slot: k,
          hover: new Spring(0, 210, 17),
          jitter: { x: (rng() - 0.5) * 0.06, yaw: (rng() - 0.5) * 0.05, roll: (rng() - 0.5) * 0.012 },
          away: false,
          lift: 0,
          pushBack: 0,
        };
        stack.cases.push(c);
        stack.group.add(c.root);
        this.cases.push(c);
        this.loadArt(c);
      }
      if (size > 1) {
        stack.riser = new THREE.Mesh(riserGeometry(size), this.riserMat);
        stack.riser.castShadow = stack.riser.receiveShadow = true;
        stack.group.add(stack.riser);
      }
      this.stacks.push(stack);
      this.group.add(stack.group);
    }
    this.arrange(rows);
  }

  private async loadArt(c: JewelCase) {
    try {
      const { texture, color } = await loadCover(c.album);
      c.setCover(texture);
      c.setColor(color);
    } catch {
      /* keep placeholder */
    }
  }

  /** Lays stacks out column-major (top to bottom, then left to right). */
  arrange(rows: number) {
    this.rows = rows;
    const cols = Math.max(1, Math.ceil(this.stacks.length / rows));
    this.contentWidth = cols * SHELF.colW;
    this.stacks.forEach((s, i) => {
      const col = Math.floor(i / rows);
      const row = rows - 1 - (i % rows);
      s.group.position.set(col * SHELF.colW + SHELF.colW / 2, row * SHELF.rowH, 0);
    });
    this.buildFurniture(cols);
    this.wall.position.x = this.contentWidth / 2;
    this.wall.position.y = (rows * SHELF.rowH) / 2;
  }

  private buildFurniture(cols: number) {
    this.furniture.children.forEach((m) => (m as THREE.Mesh).geometry.dispose());
    this.furniture.clear();
    const width = cols * SHELF.colW + 0.5;
    const depth = PLANK_FRONT - WALL_Z;
    const T = SHELF.plankT;
    for (let r = 0; r <= this.rows; r++) {
      const geo = new THREE.BoxGeometry(width + T * 2, T, depth);
      const plank = new THREE.Mesh(geo, this.plankMat);
      plank.position.set(this.contentWidth / 2, r * SHELF.rowH - T / 2, (PLANK_FRONT + WALL_Z) / 2);
      plank.castShadow = plank.receiveShadow = true;
      this.furniture.add(plank);
    }
    this.wood.repeat.set(width / 5, 1);
    const height = this.rows * SHELF.rowH + T;
    for (const side of [-1, 1]) {
      const panel = new THREE.Mesh(new THREE.BoxGeometry(T, height, depth), this.plankMat);
      panel.position.set(this.contentWidth / 2 + side * (width / 2 + T / 2), height / 2 - T, (PLANK_FRONT + WALL_Z) / 2);
      panel.castShadow = panel.receiveShadow = true;
      this.furniture.add(panel);
    }
  }

  /** Lift needed for a case to clear the ones in front of it. */
  clearLift(c: JewelCase) {
    const k = c.shelf.slot;
    return k === 0 ? 0.3 : CASE.H - k * SHELF.rise + 0.08;
  }

  /** How far a hovered case rises — rear cases stop short of the plank above. */
  peekLift(c: JewelCase) {
    const k = c.shelf.slot;
    if (k === 0) return 0.1;
    return Math.max(0.2, Math.min(SHELF.peekLift, SHELF.rowH - SHELF.plankT - 0.05 - CASE.H - k * SHELF.rise));
  }

  stackOf(c: JewelCase) {
    return this.stacks[c.shelf.stackIndex];
  }

  caseFor(albumId: string) {
    return this.cases.find((c) => c.album.id === albumId) ?? null;
  }

  /** Pose of a case in its stack's local space. */
  slotPose(c: JewelCase, pos: THREE.Vector3, quat: THREE.Quaternion, liftOverride?: number) {
    const st = c.shelf;
    const stack = this.stackOf(c);
    const k = st.slot;
    const front = k === 0;
    const hover = st.hover.value;
    const lift = (liftOverride ?? st.lift) + hover * this.peekLift(c);
    const rise = SHELF.rise + stack.fan.value * 0.03;
    pos.set(st.jitter.x, CASE.H / 2 + k * rise + lift, -CASE.D / 2 - k * SHELF.depthStep + (front ? hover * 0.1 : 0) + st.pushBack);
    this.tmpEuler.set(-SHELF.lean + hover * (front ? 0.07 : 0.015), st.jitter.yaw, st.jitter.roll);
    quat.setFromEuler(this.tmpEuler);
  }

  /** Mouse hover: lifts the case under the pointer (peek) and fans its stack. */
  setHover(c: JewelCase | null) {
    if (c === this.hovered) return;
    this.hovered = c;
    for (const s of this.stacks) {
      const active = c && this.stackOf(c) === s;
      s.fan.target = active ? 1 : 0;
      for (const sc of s.cases) sc.shelf.hover.target = sc === c ? 1 : 0;
    }
  }

  get hoveredCase() {
    return this.hovered;
  }

  /** Peek a specific case in a stack (touch riffling / keyboard). */
  peek(stack: Stack, index: number) {
    this.setHover(stack.cases[index] ?? null);
  }

  /** Cases settle onto the shelf one after another. */
  intro() {
    this.cases.forEach((c) => {
      const st = c.shelf;
      st.pushBack = 2.2;
      st.lift = 0.6;
      const col = Math.floor(st.stackIndex / this.rows);
      const delay = col * 0.07 + (st.stackIndex % this.rows) * 0.05 + st.slot * 0.03;
      animator.tween({
        duration: 0.7,
        delay,
        ease: ease.outCubic,
        onUpdate: (k) => {
          st.pushBack = 2.2 * (1 - k);
        },
      });
      animator.tween({
        duration: 0.75,
        delay,
        ease: ease.outBounce,
        onUpdate: (k) => {
          st.lift = 0.6 * (1 - k);
        },
      });
    });
  }

  private pos = new THREE.Vector3();
  private quat = new THREE.Quaternion();

  update(dt: number) {
    for (const s of this.stacks) {
      s.fan.update(dt);
      for (const c of s.cases) {
        c.shelf.hover.update(dt);
        if (c.shelf.away) continue;
        this.slotPose(c, this.pos, this.quat);
        c.root.position.copy(this.pos);
        c.root.quaternion.copy(this.quat);
      }
    }
  }
}
