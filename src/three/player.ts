import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { Spring, clamp, damp } from '../anim/tween';
import { DISC, type Disc } from './disc';
import { FONT_MONO, canvas, canvasTexture, softShadow } from './textures';

/** A wall-mountable, square-ish CD player in the spirit of late-90s design. */
export const PLAYER = { W: 1.9, H: 2.36, D: 0.34, DISC_Y: 0.3, CORD: 0.62 };

export type PlayerButton = 'eject' | 'prev' | 'play' | 'next';

export interface DisplayState {
  hasDisc: boolean;
  trackNumber: number;
  positionMs: number;
  paused: boolean;
  title: string;
  loading?: boolean;
}

const BODY_COLOR = 0xf1eee8;

/* ----------------------------- textures ----------------------------- */

function grilleTexture() {
  const S = 1024;
  const [c, g] = canvas(S, S);
  g.fillStyle = '#e6e3dd';
  g.fillRect(0, 0, S, S);
  const step = 22;
  g.fillStyle = '#a19d96';
  for (let row = 0, y = step / 2; y < S; row++, y += step * 0.866) {
    for (let x = (row % 2) * (step / 2) + step / 2; x < S; x += step) {
      g.beginPath();
      g.arc(x, y, 5.2, 0, Math.PI * 2);
      g.fill();
    }
  }
  return canvasTexture(c);
}

function iconTexture(kind: PlayerButton) {
  const S = 256;
  const [c, g] = canvas(S, S);
  g.fillStyle = '#f4f2ed';
  g.fillRect(0, 0, S, S);
  const grad = g.createRadialGradient(S / 2, S / 2, S * 0.3, S / 2, S / 2, S / 2);
  grad.addColorStop(0, 'rgba(0,0,0,0)');
  grad.addColorStop(1, 'rgba(0,0,0,0.10)');
  g.fillStyle = grad;
  g.fillRect(0, 0, S, S);
  g.fillStyle = '#4b4843';
  const tri = (x: number, y: number, w: number, h: number, dir: 1 | -1) => {
    g.beginPath();
    g.moveTo(x, y - h / 2);
    g.lineTo(x + w * dir, y);
    g.lineTo(x, y + h / 2);
    g.closePath();
    g.fill();
  };
  const m = S / 2;
  if (kind === 'play') {
    tri(m - 44, m, 46, 56, 1);
    g.fillRect(m + 12, m - 26, 12, 52);
    g.fillRect(m + 32, m - 26, 12, 52);
  } else if (kind === 'next') {
    tri(m - 46, m, 40, 50, 1);
    tri(m - 8, m, 40, 50, 1);
    g.fillRect(m + 34, m - 25, 10, 50);
  } else if (kind === 'prev') {
    tri(m + 46, m, 40, 50, -1);
    tri(m + 8, m, 40, 50, -1);
    g.fillRect(m - 44, m - 25, 10, 50);
  } else {
    g.beginPath();
    g.moveTo(m, m - 34);
    g.lineTo(m + 36, m + 8);
    g.lineTo(m - 36, m + 8);
    g.closePath();
    g.fill();
    g.fillRect(m - 36, m + 20, 72, 12);
  }
  const t = canvasTexture(c);
  t.center.set(0.5, 0.5);
  t.rotation = Math.PI / 2;
  return t;
}

function ghostRingTexture() {
  const S = 512;
  const [c, g] = canvas(S, S);
  g.translate(S / 2, S / 2);
  g.strokeStyle = 'rgba(255,255,255,1)';
  g.lineWidth = 6;
  g.setLineDash([18, 14]);
  g.beginPath();
  g.arc(0, 0, S / 2 - 6, 0, Math.PI * 2);
  g.stroke();
  g.setLineDash([]);
  const glow = g.createRadialGradient(0, 0, S * 0.05, 0, 0, S / 2);
  glow.addColorStop(0, 'rgba(255,255,255,0.35)');
  glow.addColorStop(0.3, 'rgba(255,255,255,0.0)');
  glow.addColorStop(0.92, 'rgba(255,255,255,0.0)');
  glow.addColorStop(1, 'rgba(255,255,255,0.25)');
  g.fillStyle = glow;
  g.beginPath();
  g.arc(0, 0, S / 2, 0, Math.PI * 2);
  g.fill();
  return canvasTexture(c);
}

/* ------------------------------ 7-segment ------------------------------ */

const SEGMENTS: Record<string, string> = {
  '0': 'abcdef', '1': 'bc', '2': 'abged', '3': 'abgcd', '4': 'fgbc', '5': 'afgcd',
  '6': 'afgedc', '7': 'abc', '8': 'abcdefg', '9': 'abcdfg', '-': 'g', ' ': '',
};

function drawDigit(g: CanvasRenderingContext2D, ch: string, x: number, y: number, w: number, h: number, on: string, off: string) {
  const t = w * 0.17;
  const gap = t * 0.12;
  const sk = h * 0.09;
  const skew = (px: number, py: number): [number, number] => [px + ((y + h - py) / h) * sk, py];
  const poly = (pts: [number, number][]) => {
    g.beginPath();
    pts.map(([px, py]) => skew(px, py)).forEach(([px, py], i) => (i ? g.lineTo(px, py) : g.moveTo(px, py)));
    g.closePath();
    g.fill();
  };
  const horiz = (cy: number) =>
    poly([
      [x + t / 2 + gap, cy], [x + t + gap, cy - t / 2], [x + w - t - gap, cy - t / 2],
      [x + w - t / 2 - gap, cy], [x + w - t - gap, cy + t / 2], [x + t + gap, cy + t / 2],
    ]);
  const vert = (cx: number, ya: number, yb: number) =>
    poly([
      [cx, ya + t / 2 + gap], [cx + t / 2, ya + t + gap], [cx + t / 2, yb - t - gap],
      [cx, yb - t / 2 - gap], [cx - t / 2, yb - t - gap], [cx - t / 2, ya + t + gap],
    ]);
  const segs: Record<string, () => void> = {
    a: () => horiz(y + t / 2),
    g: () => horiz(y + h / 2),
    d: () => horiz(y + h - t / 2),
    f: () => vert(x + t / 2, y, y + h / 2),
    b: () => vert(x + w - t / 2, y, y + h / 2),
    e: () => vert(x + t / 2, y + h / 2, y + h),
    c: () => vert(x + w - t / 2, y + h / 2, y + h),
  };
  const active = SEGMENTS[ch] ?? '';
  for (const s of 'abcdefg') {
    g.fillStyle = active.includes(s) ? on : off;
    segs[s]();
  }
}

/* ------------------------------- player ------------------------------- */

export class CDPlayer {
  readonly root = new THREE.Group();
  readonly tilt = new THREE.Group();
  readonly discMount = new THREE.Group();
  disc: Disc | null = null;
  readonly buttons = new Map<PlayerButton, { mesh: THREE.Mesh; press: Spring; z: number }>();
  readonly bead: THREE.Mesh;
  /** Everything the pointer can hit on the player. */
  readonly pickables: THREE.Object3D[] = [];
  readonly tiltX = new Spring(0, 60, 14);
  readonly tiltY = new Spring(0, 60, 14);

  private cord: THREE.Mesh;
  private cordAnchor = new THREE.Vector3(0.6, -PLAYER.H / 2, 0.06);
  private pull = new Spring(0, 260, 9);
  private sway = new Spring(0, 90, 3.2);
  private cordDragging = false;
  private ghost: THREE.Mesh;
  private ghostAmount = new Spring(0, 120, 18);
  private ledMat: THREE.MeshStandardMaterial;
  private lcd: { g: CanvasRenderingContext2D; tex: THREE.CanvasTexture; key: string; c: HTMLCanvasElement; mat: THREE.MeshStandardMaterial };
  private spinSpeed = 0;
  private spinTarget = 0;
  private marquee = 0;
  private display: DisplayState = { hasDisc: false, trackNumber: 0, positionMs: 0, paused: true, title: '' };
  private time = 0;

  constructor() {
    const { W, H, D, DISC_Y } = PLAYER;
    const bodyMat = new THREE.MeshPhysicalMaterial({ color: BODY_COLOR, roughness: 0.62, clearcoat: 0.15, clearcoatRoughness: 0.6 });
    const body = new THREE.Mesh(new RoundedBoxGeometry(W, H, D, 6, 0.09), bodyMat);
    body.userData.player = true;
    this.tilt.add(body);
    const shadow = softShadow(W * 1.02, H * 1.02, 0.28);
    shadow.position.set(0.1, -0.16, -D / 2 - 0.25);
    this.root.add(shadow);
    this.pickables.push(body);

    // speaker grille with a fine bezel
    const grille = new THREE.Mesh(new THREE.CircleGeometry(0.74, 96), new THREE.MeshStandardMaterial({ map: grilleTexture(), roughness: 0.9 }));
    grille.position.set(0, DISC_Y, D / 2 + 0.002);
    const bezel = new THREE.Mesh(new THREE.TorusGeometry(0.74, 0.014, 12, 128), new THREE.MeshStandardMaterial({ color: 0xd9d6cf, roughness: 0.4 }));
    bezel.position.copy(grille.position);
    this.tilt.add(grille, bezel);

    // spindle
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.068, 0.08, 0.06, 40).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xcfccc5, roughness: 0.35 }));
    hub.position.set(0, DISC_Y, D / 2 + 0.03);
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.05, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xeeeeee, metalness: 1, roughness: 0.18 }));
    cap.position.set(0, DISC_Y, D / 2 + 0.06);
    this.tilt.add(hub, cap);

    this.discMount.position.set(0, DISC_Y, D / 2 + 0.032);
    this.tilt.add(this.discMount);

    this.ghost = new THREE.Mesh(
      new THREE.PlaneGeometry(DISC.R * 2.08, DISC.R * 2.08),
      new THREE.MeshBasicMaterial({ map: ghostRingTexture(), transparent: true, opacity: 0, depthWrite: false, color: 0x8a7f72 }),
    );
    this.ghost.position.set(0, DISC_Y, D / 2 + 0.01);
    this.ghost.renderOrder = 3;
    this.ghost.raycast = () => {};
    this.tilt.add(this.ghost);

    // LCD
    const [lc, lg] = canvas(1024, 288);
    const lcdTex = canvasTexture(lc);
    const lcdMat = new THREE.MeshStandardMaterial({ map: lcdTex, roughness: 0.25, emissive: 0xffffff, emissiveMap: lcdTex, emissiveIntensity: 0.12 });
    const lcdW = 1.34;
    const lcdH = (lcdW * 288) / 1024;
    const lcd = new THREE.Mesh(new THREE.PlaneGeometry(lcdW, lcdH), lcdMat);
    lcd.position.set(0, -0.66, D / 2 + 0.012);
    const lcdFrame = new THREE.Mesh(new RoundedBoxGeometry(lcdW + 0.08, lcdH + 0.08, 0.02, 3, 0.02), new THREE.MeshStandardMaterial({ color: 0x3a3936, roughness: 0.5 }));
    lcdFrame.position.set(0, -0.66, D / 2 - 0.004);
    this.tilt.add(lcdFrame, lcd);
    this.lcd = { g: lg, tex: lcdTex, key: '', c: lc, mat: lcdMat };

    // buttons
    const sideMat = new THREE.MeshStandardMaterial({ color: 0xe4e1da, roughness: 0.5 });
    const btnGeo = new THREE.CylinderGeometry(0.105, 0.105, 0.07, 40).rotateX(Math.PI / 2);
    (['eject', 'prev', 'play', 'next'] as PlayerButton[]).forEach((name, i) => {
      const cap = new THREE.MeshStandardMaterial({ map: iconTexture(name), roughness: 0.45 });
      const mesh = new THREE.Mesh(btnGeo, [sideMat, cap, sideMat]);
      const z = D / 2 + 0.004;
      mesh.position.set(-0.54 + i * 0.36, -0.96, z);
      mesh.userData.button = name;
      this.tilt.add(mesh);
      this.pickables.push(mesh);
      this.buttons.set(name, { mesh, press: new Spring(0, 500, 22), z });
    });

    // status LED
    this.ledMat = new THREE.MeshStandardMaterial({ color: 0x2a2a2a, emissive: 0x7dff9a, emissiveIntensity: 0 });
    const led = new THREE.Mesh(new THREE.SphereGeometry(0.02, 16, 8), this.ledMat);
    led.position.set(W / 2 - 0.2, H / 2 - 0.2, D / 2);
    this.tilt.add(led);

    // pull cord (play/pause), a nod to a certain wall-mounted classic
    const cordMat = new THREE.MeshStandardMaterial({ color: 0x9c958a, roughness: 0.9 });
    this.cord = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 1, 8).translate(0, -0.5, 0), cordMat);
    this.cord.position.copy(this.cordAnchor);
    this.bead = new THREE.Mesh(new THREE.CapsuleGeometry(0.045, 0.1, 6, 16), new THREE.MeshStandardMaterial({ color: 0xc9b393, roughness: 0.55 }));
    this.bead.userData.cord = true;
    // generous invisible hit area around the bead for fingers
    const beadHit = new THREE.Mesh(new THREE.SphereGeometry(0.2, 8, 8), new THREE.MeshBasicMaterial({ visible: false }));
    beadHit.userData.cord = true;
    this.bead.add(beadHit);
    this.tilt.add(this.cord, this.bead);
    this.pickables.push(this.bead, beadHit);

    this.root.add(this.tilt);
    this.drawLcd(true);
  }

  /* ----------------------------- disc & spin ----------------------------- */

  mountDisc(disc: Disc) {
    this.disc = disc;
    this.discMount.add(disc.group);
  }

  setPlaying(playing: boolean) {
    this.spinTarget = playing ? 4.6 : 0;
  }

  get spinning() {
    return this.spinSpeed > 0.05;
  }

  /** World-space position of the spindle (for drop targeting). */
  mountWorldPosition(out = new THREE.Vector3()) {
    return this.discMount.getWorldPosition(out);
  }

  showTarget(amount: number) {
    this.ghostAmount.target = amount;
  }

  /* ------------------------------- buttons ------------------------------- */

  press(name: PlayerButton) {
    const b = this.buttons.get(name);
    if (!b) return;
    b.press.velocity = -1.6;
  }

  /* -------------------------------- cord --------------------------------- */

  beginCordDrag() {
    this.cordDragging = true;
  }

  /** `local` is the pointer in player-tilt space. */
  dragCord(local: THREE.Vector3) {
    const restY = this.cordAnchor.y - PLAYER.CORD;
    this.pull.target = clamp(restY - local.y, -0.05, 0.42);
    this.sway.target = clamp(local.x - this.cordAnchor.x, -0.25, 0.25);
  }

  /** Returns true when the cord was pulled far enough to trigger. */
  endCordDrag() {
    this.cordDragging = false;
    const triggered = this.pull.value > 0.16;
    this.pull.target = 0;
    this.sway.target = 0;
    this.sway.velocity += (Math.random() - 0.5) * 0.8;
    return triggered;
  }

  tugCord() {
    this.pull.velocity = 2.6;
    this.sway.velocity += (Math.random() - 0.5) * 0.6;
  }

  /* ------------------------------- display ------------------------------- */

  setDisplay(s: DisplayState) {
    this.display = s;
  }

  private drawLcd(force = false) {
    const s = this.display;
    const sec = Math.floor(s.positionMs / 1000);
    const blink = s.paused && s.hasDisc && s.trackNumber > 0 && Math.floor(this.time * 1.6) % 2 === 1;
    const textW = 1024 - 80;
    const { g } = this.lcd;
    g.font = `500 44px ${FONT_MONO}`;
    const title = s.hasDisc ? (s.loading ? 'READING…' : s.title || 'READY') : 'NO DISC';
    const tw = g.measureText(title).width;
    const scroll = tw > textW;
    const mOffset = scroll ? Math.floor(this.marquee * 90) % Math.ceil(tw + 120) : 0;
    const key = [s.hasDisc, s.trackNumber, sec, s.paused, title, blink, mOffset, s.loading].join('|');
    if (!force && key === this.lcd.key) return;
    this.lcd.key = key;

    const W = 1024, H = 288;
    const bg = g.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#b4bea4');
    bg.addColorStop(1, '#a2ad92');
    g.fillStyle = bg;
    g.fillRect(0, 0, W, H);
    const on = '#20271d';
    const off = 'rgba(32,39,29,0.07)';

    g.fillStyle = 'rgba(32,39,29,0.55)';
    g.font = `500 22px ${FONT_MONO}`;
    g.fillText('TRACK', 44, 42);
    g.fillText(s.paused ? 'PAUSE' : 'PLAY', 470, 42);
    g.fillText('TIME', 650, 42);

    const dw = 66, dh = 112, dy = 60, gap = 16;
    const tn = s.hasDisc && s.trackNumber > 0 ? String(s.trackNumber).padStart(2, '0').slice(-2) : '--';
    drawDigit(g, tn[0], 44, dy, dw, dh, on, off);
    drawDigit(g, tn[1], 44 + dw + gap, dy, dw, dh, on, off);

    // play / pause glyph
    g.fillStyle = s.hasDisc ? on : off;
    if (!s.paused) {
      g.beginPath();
      g.moveTo(480, 90);
      g.lineTo(530, 116);
      g.lineTo(480, 142);
      g.closePath();
      g.fill();
    } else {
      g.fillRect(480, 92, 14, 50);
      g.fillRect(504, 92, 14, 50);
    }

    const mm = s.hasDisc && s.trackNumber > 0 ? String(Math.min(99, Math.floor(sec / 60))).padStart(2, '0') : '--';
    const ss = s.hasDisc && s.trackNumber > 0 ? String(sec % 60).padStart(2, '0') : '--';
    const tx = 1024 - 44 - (dw * 4 + gap * 3 + 26);
    const showTime = !blink;
    drawDigit(g, showTime ? mm[0] : ' ', tx, dy, dw, dh, on, off);
    drawDigit(g, showTime ? mm[1] : ' ', tx + dw + gap, dy, dw, dh, on, off);
    g.fillStyle = showTime ? on : off;
    const cx = tx + dw * 2 + gap * 2 + 4;
    g.fillRect(cx, dy + dh * 0.28, 11, 11);
    g.fillRect(cx, dy + dh * 0.66, 11, 11);
    drawDigit(g, showTime ? ss[0] : ' ', cx + 26, dy, dw, dh, on, off);
    drawDigit(g, showTime ? ss[1] : ' ', cx + 26 + dw + gap, dy, dw, dh, on, off);

    // marquee
    g.save();
    g.beginPath();
    g.rect(40, 196, textW, 70);
    g.clip();
    g.font = `500 44px ${FONT_MONO}`;
    g.fillStyle = on;
    g.textBaseline = 'middle';
    g.fillText(title, 40 - mOffset, 234);
    if (scroll) g.fillText(title, 40 - mOffset + tw + 120, 234);
    g.restore();
    g.textBaseline = 'alphabetic';

    // glass sheen
    const sheen = g.createLinearGradient(0, 0, W, H);
    sheen.addColorStop(0, 'rgba(255,255,255,0.10)');
    sheen.addColorStop(0.45, 'rgba(255,255,255,0)');
    g.fillStyle = sheen;
    g.fillRect(0, 0, W, H);
    this.lcd.tex.needsUpdate = true;
  }

  /* -------------------------------- update ------------------------------- */

  update(dt: number) {
    this.time += dt;
    // spin with inertia: quick to spin up, slow to coast down
    const lambda = this.spinTarget > this.spinSpeed ? 2.2 : 1.1;
    this.spinSpeed = damp(this.spinSpeed, this.spinTarget, lambda, dt);
    if (this.spinSpeed < 0.01 && this.spinTarget === 0) this.spinSpeed = 0;
    if (this.disc) this.disc.spin.rotation.z -= this.spinSpeed * dt;

    if (!this.display.paused || this.display.title.length > 18) this.marquee += dt;
    this.drawLcd();
    this.lcd.mat.emissiveIntensity = damp(this.lcd.mat.emissiveIntensity, this.display.hasDisc ? 0.2 : 0.08, 3, dt);

    const ledTarget = this.display.hasDisc ? (this.display.paused ? 0.4 + 0.4 * Math.sin(this.time * 3) : 1.4) : 0;
    this.ledMat.emissiveIntensity = damp(this.ledMat.emissiveIntensity, ledTarget, 6, dt);

    for (const b of this.buttons.values()) {
      b.press.update(dt);
      b.mesh.position.z = b.z + clamp(b.press.value, -0.03, 0.01) * 0.6;
    }

    this.ghostAmount.update(dt);
    const ga = clamp(this.ghostAmount.value, 0, 1.2);
    (this.ghost.material as THREE.MeshBasicMaterial).opacity = ga * (0.55 + 0.25 * Math.sin(this.time * 6));
    this.ghost.scale.setScalar(1 + 0.03 * Math.sin(this.time * 6) * ga);
    this.ghost.rotation.z += dt * 0.4;

    if (!this.cordDragging) {
      // let it swing like a pendulum
      this.sway.target = 0;
    }
    this.pull.update(dt);
    this.sway.update(dt);
    const len = PLAYER.CORD + this.pull.value;
    const ang = Math.atan2(this.sway.value, len);
    this.cord.scale.set(1, Math.hypot(len, this.sway.value), 1);
    this.cord.rotation.z = ang;
    this.bead.position.set(this.cordAnchor.x + this.sway.value, this.cordAnchor.y - len - 0.07, this.cordAnchor.z);
    this.bead.rotation.z = ang;

    this.tiltX.update(dt);
    this.tiltY.update(dt);
    this.tilt.rotation.x = this.tiltX.value;
    this.tilt.rotation.y = this.tiltY.value;
  }
}
