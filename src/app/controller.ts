import * as THREE from 'three';
import { animator, clamp, damp, ease, keyFor, tweenProps, wait } from '../anim/tween';
import { sfx } from '../audio/sfx';
import { unlockAudio } from '../audio/context';
import { emptySnapshot, interpolatedPosition, type Playback, type PlayerSnapshot } from '../playback/types';
import { Disc } from '../three/disc';
import { CASE, JewelCase } from '../three/jewelCase';
import { HUD_DEPTH, chooseRows, computeLayout, type Layout } from '../three/layout';
import { CDPlayer, type PlayerButton } from '../three/player';
import { Shelf, type Stack } from '../three/shelf';
import { WALL_COLOR, type Stage } from '../three/stage';
import { canvas, canvasTexture, drawBooklet, loadCover, type BookletLines } from '../three/textures';
import type { Album, Track } from '../types';
import type { Overlay } from '../ui/overlay';
import { storage } from '../storage';

type Target =
  | { kind: 'button'; name: PlayerButton }
  | { kind: 'cord' }
  | { kind: 'trayDisc' }
  | { kind: 'playerDisc' }
  | { kind: 'player' }
  | { kind: 'focusCase'; part: 'front' | 'booklet' | 'base'; uv?: THREE.Vector2 }
  | { kind: 'shelfCase'; c: JewelCase }
  | { kind: 'none' };

type PressMode = 'pending' | 'pan' | 'riffle' | 'lid' | 'flick' | 'disc' | 'eject' | 'cord' | 'none';

interface Press {
  id: number;
  pointerType: string;
  x0: number;
  y0: number;
  t0: number;
  target: Target;
  mode: PressMode;
  panStart: number;
  lidStart: number;
  lastX: number;
  lastY: number;
  lastT: number;
  vx: number; // px/ms
  vy: number;
  riffle?: { stack: Stack; start: number; current: number };
}

interface DiscDrag {
  disc: Disc;
  from: 'tray' | 'player';
  target: THREE.Vector3;
  near: boolean;
  lastPos: THREE.Vector3;
}

type Mode = 'browse' | 'transition' | 'focus';

const DRAG_DEPTH = HUD_DEPTH - 0.35;
const DIM_DEPTH = HUD_DEPTH + 1.4;
const TAP_SLOP = 8;

export interface ControllerOptions {
  stage: Stage;
  overlay: Overlay;
  loadTracks: (album: Album) => Promise<Track[]>;
}

/**
 * Orchestrates the experience: browsing the shelf, taking a case out,
 * opening it, moving the disc into the player and driving playback.
 */
export class Controller {
  readonly shelf = new Shelf();
  readonly player = new CDPlayer();
  layout!: Layout;
  private _mode: Mode = 'browse';
  get mode() {
    return this._mode;
  }
  set mode(m: Mode) {
    if (import.meta.env.DEV && m !== this._mode) console.debug(`mode: ${this._mode} → ${m}`);
    this._mode = m;
  }
  focused: JewelCase | null = null;
  /** When false (login screen), the scene renders but ignores input. */
  interactive = false;

  private stage: Stage;
  private overlay: Overlay;
  private loadTracksFn: ControllerOptions['loadTracks'];
  private playback: Playback | null = null;
  private snapshot: PlayerSnapshot = emptySnapshot();
  private playerAlbum: Album | null = null;
  private playerColor = new THREE.Color(WALL_COLOR);

  private pan = { x: 0, v: 0, target: null as number | null };
  private press: Press | null = null;
  private pointerNdc = new THREE.Vector2();
  private pointerSmooth = new THREE.Vector2();
  private drag: DiscDrag | null = null;
  private dim: THREE.Mesh;
  private dimState = { amount: 0 };
  private wallTint = WALL_COLOR.clone();
  private inserting = false;
  private flick = { y: 0 };

  private booklet = { canvas: canvas(1024, 1024), texture: null as THREE.CanvasTexture | null, lines: null as BookletLines | null, index: -2, albumId: '' };
  private kbStack = 0;
  private hintLevel = Number(storage.get('cdstream.hints') ?? '0');
  private tmpV = new THREE.Vector3();
  private tmpQ = new THREE.Quaternion();

  constructor(opts: ControllerOptions) {
    this.stage = opts.stage;
    this.overlay = opts.overlay;
    this.loadTracksFn = opts.loadTracks;
    const { stage } = this;

    stage.world.add(this.shelf.group);
    stage.hud.add(this.player.root);

    this.dim = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ color: WALL_COLOR, transparent: true, opacity: 0, depthWrite: false }),
    );
    this.dim.position.z = -DIM_DEPTH;
    this.dim.renderOrder = 1;
    this.dim.visible = false;
    stage.hud.add(this.dim);

    this.booklet.texture = canvasTexture(this.booklet.canvas[0]);

    stage.onResize(() => this.relayout());
    stage.onFrame((dt, t) => this.update(dt, t));
    this.bindInput();
    this.relayout();
  }

  /* ================================================================== */
  /* setup                                                               */
  /* ================================================================== */

  setPlayback(p: Playback) {
    this.playback = p;
    p.onChange((s) => this.onSnapshot(s));
  }

  setLibrary(albums: Album[]) {
    this.resetFocus();
    this.ejectInstant();
    const rows = chooseRows(this.stage.width, this.stage.height);
    this.shelf.setAlbums(albums, rows);
    this.relayout();
    this.pan.x = this.layout.panMin;
    this.pan.v = 0;
    this.pan.target = null;
    this.kbStack = 0;
    this.shelf.intro();
  }

  /** Removes any focused case / dragged disc without animation. */
  private resetFocus() {
    if (this.focused) {
      this.focused.dispose();
      this.focused = null;
    }
    this.drag = null;
    this.mode = 'browse';
    this.dimState.amount = 0;
    this.overlay.setCaption(null);
  }

  private ejectInstant() {
    this.player.disc?.dispose();
    this.player.disc = null;
    this.playerAlbum = null;
  }

  private relayout() {
    const { stage } = this;
    const rows = chooseRows(stage.width, stage.height);
    if (rows !== this.shelf.rows && this.shelf.stacks.length) this.shelf.arrange(rows);
    else this.shelf.rows = rows;
    this.layout = computeLayout(stage.width, stage.height, this.shelf.rows, this.shelf.contentWidth);
    const L = this.layout;
    stage.camera.position.set(this.pan.x, L.camY, L.camZ);
    this.pan.x = clamp(this.pan.x, L.panMin, L.panMax);

    const p = L.hud.player;
    this.player.root.position.set(p.x, p.y, -HUD_DEPTH);
    this.player.root.scale.setScalar(p.scale);
    this.player.root.rotation.y = p.rotY;

    const d = stage.viewSize(DIM_DEPTH);
    this.dim.scale.set(d.w * 1.2, d.h * 1.2, 1);

    if (this.focused && this.mode === 'focus') {
      const pose = this.focusPose(this.focused.open > 0.5);
      this.focused.root.position.copy(pose.pos);
      this.focused.root.scale.setScalar(pose.scale);
    }
    this.updateHint();
  }

  /* ================================================================== */
  /* frame update                                                        */
  /* ================================================================== */

  private update(dt: number, t: number) {
    animator.update(dt);
    this.shelf.update(dt);
    this.updatePan(dt);

    const L = this.layout;
    this.pointerSmooth.x = damp(this.pointerSmooth.x, this.pointerNdc.x, 4, dt);
    this.pointerSmooth.y = damp(this.pointerSmooth.y, this.pointerNdc.y, 4, dt);
    const cam = this.stage.camera;
    // a whisper of parallax as the pointer moves
    cam.position.set(this.pan.x + this.pointerSmooth.x * 0.06, L.camY + this.pointerSmooth.y * 0.04, L.camZ);

    // player idle tilt toward the pointer
    this.player.tiltY.target = this.pointerSmooth.x * 0.07;
    this.player.tiltX.target = -this.pointerSmooth.y * 0.05;
    this.player.update(dt);

    // focused case: float and lean toward the pointer
    const f = this.focused;
    if (f && this.mode !== 'browse') {
      const tiltTarget = this.mode === 'focus' && !this.press ? 1 : 0.3;
      f.tilt.rotation.y = damp(f.tilt.rotation.y, this.pointerSmooth.x * 0.16 * tiltTarget, 6, dt);
      f.tilt.rotation.x = damp(f.tilt.rotation.x, -this.pointerSmooth.y * 0.12 * tiltTarget, 6, dt);
      f.tilt.position.y = Math.sin(t * 1.3) * 0.012 + this.flick.y;
      f.setFloatingShadow(this.dimState.amount);
      f.updateGlare(f.tilt.rotation.y * 1.8 - f.tilt.rotation.x * 0.8 + 0.08);
    }

    this.updateDiscDrag(dt);

    // dim the shelf behind a focused case
    const dm = this.dim.material as THREE.MeshBasicMaterial;
    dm.opacity = this.dimState.amount * 0.66;
    dm.color.copy(this.wallTint);
    this.dim.visible = dm.opacity > 0.002;

    // ambient colour drifts toward the playing album
    const tintTarget = this.tmpColor.copy(WALL_COLOR).lerp(this.playerColor, this.playerAlbum ? 0.14 : 0);
    this.wallTint.lerp(tintTarget, 1 - Math.exp(-1.5 * dt));
    this.shelf.wallMat.color.copy(this.wallTint);
    (this.stage.scene.background as THREE.Color).copy(this.wallTint);

    // player display
    const s = this.snapshot;
    const hasDisc = !!this.player.disc;
    const idx = this.playerAlbum ? this.trackIndexFor(this.playerAlbum, s) : -1;
    const matching = hasDisc && s.trackUri !== null;
    this.player.setDisplay({
      hasDisc,
      loading: hasDisc && !matching,
      trackNumber: matching ? (idx >= 0 ? idx + 1 : s.trackNumber) : 0,
      positionMs: matching ? interpolatedPosition(s) : 0,
      paused: !matching || s.paused,
      title: matching ? `${s.trackName}${s.artist ? ' — ' + s.artist : ''}` : '',
    });
    this.player.setPlaying(hasDisc && matching && !s.paused);

    if (f && this.mode !== 'browse') this.positionCaption();
  }

  private tmpColor = new THREE.Color();

  private updatePan(dt: number) {
    const L = this.layout;
    if (this.press?.mode === 'pan') return;
    if (this.pan.target !== null) {
      this.pan.target = clamp(this.pan.target, L.panMin, L.panMax);
      this.pan.x = damp(this.pan.x, this.pan.target, 10, dt);
      if (Math.abs(this.pan.x - this.pan.target) < 0.001) this.pan.target = null;
      return;
    }
    this.pan.x += this.pan.v * dt;
    this.pan.v *= Math.exp(-3.2 * dt);
    if (Math.abs(this.pan.v) < 0.01) this.pan.v = 0;
    // rubber band back inside the bounds
    const bounded = clamp(this.pan.x, L.panMin, L.panMax);
    if (bounded !== this.pan.x) {
      this.pan.v *= Math.exp(-14 * dt);
      this.pan.x = damp(this.pan.x, bounded, 9, dt);
    }
  }

  /* ================================================================== */
  /* playback state                                                      */
  /* ================================================================== */

  private onSnapshot(s: PlayerSnapshot) {
    const prevTrack = this.snapshot.trackUri;
    this.snapshot = s;
    if (this.focused && this.mode !== 'browse' && s.trackUri !== prevTrack) this.refreshBooklet();
  }

  private trackIndexFor(album: Album, s: PlayerSnapshot) {
    if (!s.trackUri) return -1;
    const tracks = album.tracks;
    if (tracks) {
      let i = tracks.findIndex((t) => t.uri === s.trackUri);
      if (i < 0) i = tracks.findIndex((t) => t.name === s.trackName);
      if (i >= 0) return i;
    }
    return s.trackNumber > 0 && s.albumUri === album.uri ? s.trackNumber - 1 : -1;
  }

  private playingIndexFor(album: Album) {
    if (!this.playerAlbum || this.playerAlbum.id !== album.id) return -1;
    return this.trackIndexFor(album, this.snapshot);
  }

  /* ================================================================== */
  /* input                                                               */
  /* ================================================================== */

  private bindInput() {
    const el = this.stage.renderer.domElement;
    el.addEventListener('pointerdown', (e) => this.onDown(e));
    el.addEventListener('pointermove', (e) => this.onMove(e));
    el.addEventListener('pointerup', (e) => this.onUp(e));
    el.addEventListener('pointercancel', (e) => this.onUp(e, true));
    el.addEventListener('lostpointercapture', (e) => this.onUp(e, true));
    el.addEventListener('pointerleave', (e) => {
      if (e.pointerType === 'mouse' && !this.press) {
        this.shelf.setHover(null);
        this.pointerNdc.set(0, 0);
      }
    });
    el.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('keydown', (e) => this.onKey(e));
  }

  private isDescendant(o: THREE.Object3D, root: THREE.Object3D) {
    for (let p: THREE.Object3D | null = o; p; p = p.parent) if (p === root) return true;
    return false;
  }

  private pick(x: number, y: number): Target {
    const objs: THREE.Object3D[] = [this.player.root];
    const f = this.focused;
    if (f && this.mode !== 'browse') objs.push(f.root);
    if (this.mode === 'browse') objs.push(this.shelf.group);
    const hits = this.stage.raycast(x, y, objs);
    for (const h of hits) {
      const o = h.object;
      const ud = o.userData;
      if (this.drag && this.isDescendant(o, this.drag.disc.group)) continue;
      if (ud.button) return { kind: 'button', name: ud.button };
      if (ud.cord) return { kind: 'cord' };
      if (ud.disc) {
        const d = ud.disc as Disc;
        if (d === this.player.disc) return { kind: 'playerDisc' };
        if (f && d === f.disc && f.open > 0.7) return { kind: 'trayDisc' };
        continue;
      }
      if (ud.booklet && f && ud.booklet === f) return f.open > 0.7 ? { kind: 'focusCase', part: 'booklet', uv: h.uv?.clone() } : { kind: 'focusCase', part: 'front' };
      if (ud.case) {
        const c = ud.case as JewelCase;
        if (c === f && this.mode !== 'browse') return { kind: 'focusCase', part: o === c.base ? 'base' : 'front' };
        if (this.mode === 'browse' && !c.shelf.away) return { kind: 'shelfCase', c };
        continue;
      }
      if (this.isDescendant(o, this.player.root)) return { kind: 'player' };
      if (f && this.isDescendant(o, f.root)) return { kind: 'focusCase', part: 'front' };
      return { kind: 'none' };
    }
    return { kind: 'none' };
  }

  private setPointerNdc(e: PointerEvent) {
    this.pointerNdc.set((e.clientX / this.stage.width) * 2 - 1, -(e.clientY / this.stage.height) * 2 + 1);
  }

  private onDown(e: PointerEvent) {
    unlockAudio();
    if (!this.interactive) return;
    if (this.press) return; // single pointer interactions
    (e.target as Element).setPointerCapture?.(e.pointerId);
    this.setPointerNdc(e);
    const target = this.pick(e.clientX, e.clientY);
    const now = performance.now();
    this.press = {
      id: e.pointerId,
      pointerType: e.pointerType,
      x0: e.clientX,
      y0: e.clientY,
      t0: now,
      target,
      mode: 'pending',
      panStart: this.pan.x,
      lidStart: this.focused?.open ?? 0,
      lastX: e.clientX,
      lastY: e.clientY,
      lastT: now,
      vx: 0,
      vy: 0,
    };
    this.pan.v = 0;
    this.pan.target = null;

    // immediate feedback for physical controls
    if (target.kind === 'button') this.player.press(target.name);
    if (target.kind === 'cord') {
      this.press.mode = 'cord';
      this.player.beginCordDrag();
    }
    if (target.kind === 'shelfCase' && e.pointerType !== 'mouse') {
      // touch: peek the case under the finger right away
      this.shelf.setHover(target.c);
    }
  }

  private onMove(e: PointerEvent) {
    this.setPointerNdc(e);
    const p = this.press;
    if (!p || p.id !== e.pointerId) {
      if (e.pointerType === 'mouse' && this.interactive) this.hover(e);
      return;
    }
    const now = performance.now();
    const dtm = Math.max(1, now - p.lastT);
    p.vx = p.vx * 0.6 + ((e.clientX - p.lastX) / dtm) * 0.4;
    p.vy = p.vy * 0.6 + ((e.clientY - p.lastY) / dtm) * 0.4;
    p.lastX = e.clientX;
    p.lastY = e.clientY;
    p.lastT = now;
    const dx = e.clientX - p.x0;
    const dy = e.clientY - p.y0;

    if (p.mode === 'pending' && Math.hypot(dx, dy) > TAP_SLOP) this.startDrag(p, dx, dy);

    switch (p.mode) {
      case 'pan': {
        const L = this.layout;
        let x = p.panStart - dx * L.worldPerPx;
        if (x < L.panMin) x = L.panMin - Math.pow(L.panMin - x, 0.8) * 0.5;
        if (x > L.panMax) x = L.panMax + Math.pow(x - L.panMax, 0.8) * 0.5;
        this.pan.x = x;
        break;
      }
      case 'riffle': {
        const r = p.riffle!;
        const steps = Math.round(-dy / 34);
        const idx = clamp(r.start + steps, 0, r.stack.cases.length - 1);
        if (idx !== r.current) {
          r.current = idx;
          this.shelf.peek(r.stack, idx);
          sfx.tap(0.5);
          navigator.vibrate?.(4);
        }
        break;
      }
      case 'lid': {
        const f = this.focused!;
        const px = this.caseScreenWidth(f);
        f.open = clamp(p.lidStart - dx / px, 0, 1.04);
        f.root.scale.setScalar(this.scaleForOpen(f.open));
        break;
      }
      case 'flick': {
        const f = this.focused!;
        this.flick.y = (-dy * this.hudPerPx()) / f.root.scale.x;
        break;
      }
      case 'disc':
      case 'eject':
        this.moveDiscDrag(e.clientX, e.clientY);
        break;
      case 'cord': {
        const local = this.stage.hudPoint(e.clientX, e.clientY, HUD_DEPTH, this.tmpV);
        this.player.tilt.worldToLocal(this.stage.hud.localToWorld(local));
        this.player.dragCord(local);
        break;
      }
    }
  }

  private startDrag(p: Press, dx: number, dy: number) {
    const horizontal = Math.abs(dx) > Math.abs(dy);
    const t = p.target;
    if (this.mode === 'browse') {
      if (t.kind === 'shelfCase' && !horizontal) {
        const stack = this.shelf.stackOf(t.c);
        const start = stack.cases.indexOf(this.shelf.hoveredCase ?? t.c);
        p.mode = 'riffle';
        p.riffle = { stack, start: Math.max(0, start), current: Math.max(0, start) };
        this.shelf.peek(stack, p.riffle.current);
        return;
      }
      if (t.kind === 'shelfCase' || t.kind === 'none') {
        p.mode = 'pan';
        if (p.pointerType !== 'mouse') this.shelf.setHover(null);
        return;
      }
    }
    if (this.mode === 'focus') {
      if (t.kind === 'trayDisc') {
        p.mode = 'disc';
        this.beginDiscDrag('tray');
        return;
      }
      if (t.kind === 'focusCase') {
        p.mode = horizontal ? 'lid' : 'flick';
        if (p.mode === 'lid') animator.cancel(keyFor(this.focused!, 'open'));
        return;
      }
    }
    if (t.kind === 'playerDisc' && !this.inserting && this.mode !== 'transition') {
      p.mode = 'eject';
      this.beginDiscDrag('player');
      return;
    }
    p.mode = 'none';
  }

  private onUp(e: PointerEvent, cancelled = false) {
    unlockAudio(); // iOS only unlocks audio on the end of a touch
    const p = this.press;
    if (!p || p.id !== e.pointerId) return;
    this.press = null;
    const dt = performance.now() - p.t0;
    const moved = Math.hypot(e.clientX - p.x0, e.clientY - p.y0);

    switch (p.mode) {
      case 'pending':
        if (!cancelled && moved <= TAP_SLOP * 1.5 && dt < 800) this.tap(p.target);
        break;
      case 'pan':
        this.pan.v = clamp(-p.vx * 1000 * this.layout.worldPerPx, -40, 40);
        if (performance.now() - p.lastT > 80) this.pan.v = 0;
        break;
      case 'riffle':
        break;
      case 'lid': {
        const f = this.focused!;
        const fast = Math.abs(p.vx) > 0.35;
        const open = fast ? p.vx < 0 : f.open > 0.45;
        if (open) this.openCase();
        else this.closeCase();
        break;
      }
      case 'flick': {
        const dy = e.clientY - p.y0;
        if (Math.abs(dy) > 90 || Math.abs(p.vy) > 0.7) this.dismiss();
        else tweenProps(this.flick, { y: 0 }, { duration: 0.45, ease: ease.outBack(2) });
        break;
      }
      case 'disc':
      case 'eject':
        this.endDiscDrag();
        break;
      case 'cord':
        if (this.player.endCordDrag()) {
          sfx.cord();
          this.action('play');
        } else if (moved < TAP_SLOP && !cancelled) {
          // a simple tap on the bead also works
          this.player.tugCord();
          sfx.cord();
          this.action('play');
        }
        break;
    }
    if (e.pointerType !== 'mouse' && p.mode !== 'riffle' && this.mode === 'browse' && !(p.mode === 'pending' && p.target.kind === 'shelfCase')) {
      this.shelf.setHover(null);
    }
    if (e.pointerType !== 'mouse') this.pointerNdc.set(0, 0);
  }

  private hover(e: PointerEvent) {
    const t = this.pick(e.clientX, e.clientY);
    if (this.mode === 'browse') this.shelf.setHover(t.kind === 'shelfCase' ? t.c : null);
    const interactive =
      t.kind === 'button' || t.kind === 'cord' || t.kind === 'trayDisc' || t.kind === 'playerDisc' || t.kind === 'shelfCase' || t.kind === 'focusCase';
    this.stage.renderer.domElement.style.cursor = interactive ? (t.kind === 'trayDisc' || t.kind === 'playerDisc' ? 'grab' : 'pointer') : 'default';
  }

  private onWheel(e: WheelEvent) {
    if (!this.interactive) return;
    e.preventDefault();
    if (this.mode !== 'browse') return;
    const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    const scale = e.deltaMode === 1 ? 32 : e.deltaMode === 2 ? this.stage.width : 1;
    this.pan.v = 0;
    this.pan.target = (this.pan.target ?? this.pan.x) + delta * scale * this.layout.worldPerPx * 0.9;
  }

  private onKey(e: KeyboardEvent) {
    if (!this.interactive) return;
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    unlockAudio();
    const key = e.key;
    if (key === ' ' || key === 'k') {
      e.preventDefault();
      this.player.press('play');
      this.action('play');
      return;
    }
    if (this.mode === 'focus') {
      if (key === 'Escape' || key === 'Backspace') this.dismiss();
      else if (key === 'Enter' || key === 'o') {
        const f = this.focused!;
        if (f.open < 0.5) this.openCase();
        else if (f.disc) this.insertDisc(f.disc, 0);
        else this.closeCase();
      } else if (key === 'ArrowRight' || key === 'n') {
        this.player.press('next');
        this.action('next');
      } else if (key === 'ArrowLeft' || key === 'p') {
        this.player.press('prev');
        this.action('prev');
      } else if (key === 'e') {
        this.player.press('eject');
        this.action('eject');
      }
      return;
    }
    if (this.mode !== 'browse' || !this.shelf.stacks.length) return;
    const rows = this.shelf.rows;
    const n = this.shelf.stacks.length;
    const cur = this.shelf.hoveredCase ? this.shelf.hoveredCase.shelf.stackIndex : this.kbStack;
    let next = cur;
    if (key === 'ArrowRight') next = cur + rows;
    else if (key === 'ArrowLeft') next = cur - rows;
    else if (key === 'ArrowDown') next = cur + 1;
    else if (key === 'ArrowUp') next = cur - 1;
    else if (key === 'Enter') {
      const c = this.shelf.hoveredCase ?? this.shelf.stacks[cur].cases[0];
      if (c) this.select(c);
      return;
    } else if (key === '[' || key === ']' || key === 'PageUp' || key === 'PageDown') {
      const stack = this.shelf.stacks[cur];
      const idx = this.shelf.hoveredCase ? stack.cases.indexOf(this.shelf.hoveredCase) : 0;
      const dir = key === ']' || key === 'PageDown' ? 1 : -1;
      this.shelf.peek(stack, clamp(idx + dir, 0, stack.cases.length - 1));
      sfx.tap(0.5);
      e.preventDefault();
      return;
    } else if (key === 'e') {
      this.player.press('eject');
      this.action('eject');
      return;
    } else return;
    e.preventDefault();
    next = clamp(next, 0, n - 1);
    this.kbStack = next;
    const stack = this.shelf.stacks[next];
    this.shelf.peek(stack, 0);
    // keep the selection in view
    const x = stack.group.position.x;
    const half = (this.layout.width * this.layout.worldPerPx) / 2;
    if (Math.abs(x - this.pan.x) > half * 0.6) this.pan.target = x;
  }

  /* ================================================================== */
  /* taps & actions                                                      */
  /* ================================================================== */

  private tap(t: Target) {
    if (t.kind === 'button') {
      this.action(t.name);
      return;
    }
    if (t.kind === 'playerDisc') {
      this.action('play');
      return;
    }
    if (t.kind === 'cord') return;
    if (this.mode === 'browse') {
      if (t.kind === 'shelfCase') this.select(t.c);
      else this.shelf.setHover(null);
      return;
    }
    if (this.mode !== 'focus') return;
    const f = this.focused!;
    switch (t.kind) {
      case 'focusCase':
        if (f.open < 0.5) this.openCase();
        else if (t.part === 'booklet' && t.uv) this.tapBooklet(t.uv);
        else this.nudge();
        break;
      case 'trayDisc':
        if (f.disc) this.insertDisc(f.disc, 0);
        break;
      case 'none':
        this.dismiss();
        break;
    }
  }

  private nudge() {
    const f = this.focused;
    if (!f) return;
    animator.tween({
      duration: 0.5,
      key: keyFor(f, 'nudge'),
      ease: ease.linear,
      onUpdate: (_k, t) => {
        f.tilt.rotation.z = Math.sin(t * Math.PI * 4) * 0.025 * (1 - t);
      },
    });
  }

  private async action(name: PlayerButton) {
    const pb = this.playback;
    sfx.button();
    if (name === 'eject') {
      this.eject();
      return;
    }
    if (!pb || !this.player.disc) {
      this.overlay.toast(this.player.disc ? 'Player not ready yet' : 'Put a disc in the player first');
      return;
    }
    pb.activate();
    try {
      if (name === 'play') {
        if (!this.snapshot.trackUri && this.playerAlbum) await pb.playAlbum(this.playerAlbum, 0);
        else await pb.togglePlay();
      } else if (name === 'next') await pb.next();
      else if (name === 'prev') await pb.previous();
    } catch (err) {
      this.showError(err);
    }
  }

  private tapBooklet(uv: THREE.Vector2) {
    const f = this.focused!;
    const row = this.booklet.lines?.rows.find((r) => uv.y >= r.v0 && uv.y <= r.v1 && uv.x >= r.u0 - 0.02 && uv.x <= r.u1 + 0.02);
    if (!row) {
      this.nudge();
      return;
    }
    sfx.tap(0.7);
    if (f.disc) this.insertDisc(f.disc, row.index);
    else if (this.playerAlbum?.id === f.album.id && this.playback) {
      this.playback.activate();
      this.playback.playAlbum(f.album, row.index).catch((err) => this.showError(err));
    }
  }

  showError(err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    this.overlay.toast(msg);
  }

  /* ================================================================== */
  /* focus: take a case out of the shelf                                 */
  /* ================================================================== */

  private focusPose(open: boolean) {
    const f = this.layout.hud.focus;
    return {
      pos: new THREE.Vector3(f.x, f.y, -HUD_DEPTH),
      quat: new THREE.Quaternion(),
      scale: open ? f.openScale : f.closedScale,
    };
  }

  private scaleForOpen(open: number) {
    const f = this.layout.hud.focus;
    return THREE.MathUtils.lerp(f.closedScale, f.openScale, clamp(open, 0, 1));
  }

  private hudPerPx() {
    return this.layout.hud.h / this.layout.height;
  }

  private caseScreenWidth(c: JewelCase) {
    return (CASE.W * c.root.scale.x) / this.hudPerPx();
  }

  private fly(obj: THREE.Object3D, to: { pos: THREE.Vector3; quat: THREE.Quaternion; scale: number }, opts: { duration: number; arc?: THREE.Vector3; spin?: number; ease?: (t: number) => number }) {
    const p0 = obj.position.clone();
    const q0 = obj.quaternion.clone();
    const s0 = obj.scale.x;
    const ctrl = p0.clone().lerp(to.pos, 0.5).add(opts.arc ?? new THREE.Vector3());
    const spinQ = new THREE.Quaternion();
    const axis = new THREE.Vector3(0, 1, 0);
    return animator.tween({
      key: keyFor(obj, 'fly'),
      duration: opts.duration,
      ease: opts.ease ?? ease.inOutCubic,
      onUpdate: (k) => {
        const a = (1 - k) * (1 - k);
        const b = 2 * (1 - k) * k;
        const c = k * k;
        obj.position.set(
          a * p0.x + b * ctrl.x + c * to.pos.x,
          a * p0.y + b * ctrl.y + c * to.pos.y,
          a * p0.z + b * ctrl.z + c * to.pos.z,
        );
        obj.quaternion.slerpQuaternions(q0, to.quat, k);
        if (opts.spin) obj.quaternion.multiply(spinQ.setFromAxisAngle(axis, Math.sin(k * Math.PI) * opts.spin));
        obj.scale.setScalar(s0 + (to.scale - s0) * k);
      },
    }).promise;
  }

  async select(c: JewelCase) {
    if (this.mode !== 'browse' || c.shelf.away) return;
    this.mode = 'transition';
    this.focused = c;
    this.flick.y = 0;
    this.overlay.setHint(null);
    this.stage.renderer.domElement.style.cursor = 'default';
    sfx.slide();

    // freeze the peek into an explicit lift, then rise clear of the stack
    const st = c.shelf;
    const front = st.slot === 0;
    st.lift += st.hover.value * this.shelf.peekLift(c);
    st.pushBack += front ? st.hover.value * 0.1 : 0;
    st.hover.snap(0);
    this.shelf.setHover(null);
    this.pan.v = 0;
    this.pan.target = null;

    this.prepareFocus(c);
    await tweenProps(st, { lift: this.shelf.clearLift(c), pushBack: 0.25 }, { duration: 0.24, ease: ease.outCubic });

    st.away = true;
    this.setShadows(c, false);
    this.stage.hud.attach(c.root);
    tweenProps(this.dimState, { amount: 1 }, { duration: 0.6, ease: ease.outCubic });
    const pose = this.focusPose(false);
    await this.fly(c.root, pose, { duration: 0.75, arc: new THREE.Vector3(0, 0.25, 0.4), spin: -0.5, ease: ease.outCubic });
    this.mode = 'focus';
    this.overlay.setCaption(c.album);
    this.updateHint();
  }

  private setShadows(c: JewelCase, on: boolean) {
    c.base.castShadow = on;
    c.cover.castShadow = on;
  }

  private prepareFocus(c: JewelCase) {
    c.ensureDetails();
    c.setCloseUp(true);
    // sharper artwork for the close-up
    loadCover(c.album, true)
      .then(({ texture, source, color }) => {
        if (this.focused !== c) return;
        c.setCover(texture);
        c.setColor(color);
        c.disc?.setLabel(source, color);
      })
      .catch(() => {});

    const discInPlayer = this.playerAlbum?.id === c.album.id;
    if (!discInPlayer && !c.disc) {
      const disc = new Disc(c.album);
      disc.setLabel(null, c.color);
      loadCover(c.album)
        .then(({ source, color }) => disc.setLabel(source, color))
        .catch(() => {});
      c.insertDisc(disc);
    }
    this.booklet.index = -2;
    this.booklet.albumId = '';
    c.setBooklet(this.booklet.texture!);
    this.refreshBooklet();
    if (!c.album.tracks) {
      this.loadTracksFn(c.album)
        .then((tracks) => {
          c.album.tracks = tracks;
          if (this.focused === c) {
            this.booklet.index = -2;
            this.refreshBooklet();
          }
        })
        .catch(() => {
          c.album.tracks = c.album.tracks ?? [];
          if (this.focused === c) this.refreshBooklet(true);
        });
    }
  }

  private refreshBooklet(force = false) {
    const f = this.focused;
    if (!f) return;
    const idx = this.playingIndexFor(f.album);
    if (!force && this.booklet.albumId === f.album.id && this.booklet.index === idx) return;
    this.booklet.albumId = f.album.id;
    this.booklet.index = idx;
    const [, g] = this.booklet.canvas;
    this.booklet.lines = drawBooklet(g, 1024, f.album, f.album.tracks, idx, f.color);
    this.booklet.texture!.needsUpdate = true;
  }

  private async openCase() {
    const f = this.focused;
    if (!f || this.mode !== 'focus') return;
    if (f.open < 0.9) sfx.caseOpen();
    const from = f.open;
    const target = this.focusPose(true);
    const s0 = f.root.scale.x;
    animator.tween({
      key: keyFor(f, 'open'),
      duration: 0.75 - from * 0.3,
      ease: ease.outBack(1.25),
      onUpdate: (k) => {
        f.open = from + (1 - from) * k;
        f.root.scale.setScalar(s0 + (target.scale - s0) * Math.min(1, k));
      },
      onComplete: () => this.updateHint(),
    });
    this.hintLevelAtLeast(1);
    this.overlay.setHint(null);
  }

  private closeCase(): Promise<boolean> {
    const f = this.focused;
    if (!f) return Promise.resolve(true);
    const from = f.open;
    const target = this.focusPose(false);
    const s0 = f.root.scale.x;
    if (from <= 0.001) return Promise.resolve(true);
    return animator
      .tween({
        key: keyFor(f, 'open'),
        duration: 0.32 + from * 0.12,
        ease: ease.inCubic,
        onUpdate: (k) => {
          f.open = from * (1 - k);
          f.root.scale.setScalar(s0 + (target.scale - s0) * k);
        },
        onComplete: () => {
          sfx.caseClose();
          this.updateHint();
        },
      })
      .promise.then((done) => {
        if (done) {
          // the little bounce of a snapped-shut lid
          animator.tween({
            duration: 0.35,
            key: keyFor(f, 'nudge'),
            ease: ease.linear,
            onUpdate: (_k, t) => {
              f.tilt.rotation.z = Math.sin(t * Math.PI * 3) * 0.012 * (1 - t);
            },
          });
        }
        return done;
      });
  }

  async dismiss() {
    const f = this.focused;
    if (!f || this.mode !== 'focus' || this.drag) return;
    this.mode = 'transition';
    this.overlay.setCaption(null);
    this.overlay.setHint(null);
    if (f.open > 0.01) {
      await this.closeCase();
      await wait(0.06);
    }
    tweenProps(this.flick, { y: 0 }, { duration: 0.3 });
    tweenProps(this.dimState, { amount: 0 }, { duration: 0.6, delay: 0.1, ease: ease.inOutCubic });

    const stack = this.shelf.stackOf(f);
    const st = f.shelf;
    stack.group.attach(f.root);
    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    st.pushBack = 0.25;
    this.shelf.slotPose(f, pos, quat, this.shelf.clearLift(f));
    sfx.slide();
    await this.fly(f.root, { pos, quat, scale: 1 }, { duration: 0.7, arc: new THREE.Vector3(0, 0.6, 0.8), spin: 0.4, ease: ease.inOutCubic });

    f.tilt.rotation.set(0, 0, 0);
    f.tilt.position.set(0, 0, 0);
    f.setFloatingShadow(0);
    f.setCloseUp(false);
    st.lift = this.shelf.clearLift(f);
    st.away = false;
    this.setShadows(f, true);
    this.focused = null;
    this.mode = 'browse';
    if (this.playerAlbum) this.hintLevelAtLeast(3);
    await tweenProps(st, { lift: 0, pushBack: 0 }, { duration: 0.45, ease: ease.outBounce });
    sfx.tap(0.8);
    this.updateHint();
  }

  /* ================================================================== */
  /* the disc                                                            */
  /* ================================================================== */

  private beginDiscDrag(from: 'tray' | 'player') {
    let disc: Disc | null;
    if (from === 'tray') {
      disc = this.focused?.disc ?? null;
      if (disc) this.focused!.disc = null;
    } else {
      disc = this.player.disc;
      this.player.disc = null;
    }
    if (!disc) return;
    animator.cancel(keyFor(disc.group, 'fly'));
    this.stage.hud.attach(disc.group);
    const target = disc.group.position.clone();
    this.drag = { disc, from, target, near: from === 'player', lastPos: target.clone() };
    sfx.pop();
    const scale = this.layout.hud.player.scale * (DRAG_DEPTH / HUD_DEPTH);
    tweenProps(disc.group.scale, { x: scale, y: scale, z: scale }, { duration: 0.3, ease: ease.outBack(2) });
    this.player.showTarget(from === 'tray' ? 0.55 : 0.9);
    if (from === 'tray') this.overlay.setHint(null);
  }

  private moveDiscDrag(clientX: number, clientY: number) {
    const d = this.drag;
    if (!d) return;
    this.stage.hudPoint(clientX, clientY, DRAG_DEPTH, d.target);
    // magnet toward the spindle
    const mount = this.mountInHud(DRAG_DEPTH);
    const discR = 0.6 * this.layout.hud.player.scale;
    const dist = Math.hypot(d.target.x - mount.x, d.target.y - mount.y);
    const near = dist < discR * 1.15;
    if (near !== d.near) {
      d.near = near;
      if (near) {
        sfx.tap(0.4);
        navigator.vibrate?.(6);
      }
    }
    this.player.showTarget(near ? 1.2 : 0.55);
    if (near) d.target.lerp(mount, clamp(1 - dist / (discR * 1.15), 0, 1) * 0.6);
  }

  /** Spindle position projected onto a hud plane at `depth`. */
  private mountInHud(depth: number) {
    const w = this.player.mountWorldPosition(new THREE.Vector3());
    const local = this.stage.hud.worldToLocal(w);
    const k = depth / -local.z;
    return local.multiplyScalar(k);
  }

  private updateDiscDrag(dt: number) {
    const d = this.drag;
    if (!d) return;
    const g = d.disc.group;
    if (!this.press) return;
    d.lastPos.copy(g.position);
    g.position.x = damp(g.position.x, d.target.x, 22, dt);
    g.position.y = damp(g.position.y, d.target.y, 22, dt);
    g.position.z = damp(g.position.z, d.target.z, 14, dt);
    // tilt into the motion, like a real disc held by its edge
    const vx = (g.position.x - d.lastPos.x) / Math.max(dt, 1e-3);
    const vy = (g.position.y - d.lastPos.y) / Math.max(dt, 1e-3);
    const tx = clamp(-vy * 0.18, -0.6, 0.6);
    const ty = clamp(vx * 0.18, -0.6, 0.6);
    this.tmpQ.setFromEuler(new THREE.Euler(tx, ty, 0));
    g.quaternion.slerp(this.tmpQ, 1 - Math.exp(-10 * dt));
  }

  private endDiscDrag() {
    const d = this.drag;
    if (!d) return;
    this.drag = null;
    this.player.showTarget(0);
    if (d.near) {
      this.insertDisc(d.disc, d.from === 'player' ? -1 : 0);
      return;
    }
    if (d.from === 'player') {
      this.ejectDisc(d.disc);
      return;
    }
    // back into the tray
    const f = this.focused;
    if (f && f.album.id === d.disc.album.id) this.returnDiscToCase(d.disc, f);
    else this.returnDiscToShelf(d.disc);
  }

  private async returnDiscToCase(disc: Disc, c: JewelCase) {
    c.body.attach(disc.group);
    const pos = JewelCase.trayPosition();
    await this.fly(disc.group, { pos, quat: new THREE.Quaternion(), scale: 1 }, { duration: 0.4, arc: new THREE.Vector3(0, 0, 0.3), ease: ease.outCubic });
    if (c.disc && c.disc !== disc) c.disc.dispose();
    c.disc = disc;
    sfx.tap(0.7);
    this.updateHint();
  }

  /**
   * Put a disc on the spindle and start the album.
   * `trackIndex` -1 means "resume" (the disc was only lifted off and back).
   */
  async insertDisc(disc: Disc, trackIndex: number) {
    if (this.inserting) return;
    this.inserting = true;
    const pb = this.playback;
    pb?.activate();
    const album = disc.album;
    const f = this.focused;
    if (f && f.disc === disc) f.disc = null;

    const old = this.player.disc;
    if (old && old !== disc) {
      this.player.disc = null;
      this.ejectDisc(old, false);
    }

    this.player.discMount.attach(disc.group);
    this.player.showTarget(0);
    const hover = new THREE.Vector3(0, 0, 0.28);
    await this.fly(disc.group, { pos: hover, quat: new THREE.Quaternion(), scale: 1 }, { duration: 0.32, ease: ease.outCubic });
    await this.fly(disc.group, { pos: new THREE.Vector3(), quat: new THREE.Quaternion(), scale: 1 }, { duration: 0.12, ease: ease.inQuad });
    sfx.snap();
    navigator.vibrate?.(12);
    this.player.tiltX.velocity -= 0.6;
    this.player.mountDisc(disc);
    const sameAlbum = this.playerAlbum?.id === album.id;
    this.playerAlbum = album;
    loadCover(album)
      .then(({ color }) => this.playerColor.copy(color))
      .catch(() => {});
    this.inserting = false;
    this.refreshBooklet();
    this.hintLevelAtLeast(2);
    this.updateHint();

    if (trackIndex === -1 && sameAlbum) return;
    sfx.whirr(true);
    if (!pb) return;
    try {
      await pb.playAlbum(album, Math.max(0, trackIndex));
    } catch (err) {
      this.showError(err);
    }
  }

  /** Eject button. */
  private async eject() {
    const disc = this.player.disc;
    if (!disc || this.inserting) return;
    this.player.disc = null;
    this.ejectDisc(disc);
  }

  /** Pops a disc off the player and sends it back to its case. */
  private async ejectDisc(disc: Disc, pause = true) {
    if (pause) {
      this.playerAlbum = null;
      this.playback?.pause().catch(() => {});
      sfx.whirr(false);
    }
    sfx.snap();
    const g = disc.group;
    if (g.parent === this.player.discMount) {
      await this.fly(g, { pos: new THREE.Vector3(0, 0.1, 0.45), quat: g.quaternion.clone(), scale: 1 }, { duration: 0.22, ease: ease.outBack(2) });
    }
    const f = this.focused;
    if (f && f.album.id === disc.album.id && this.mode === 'focus' && !f.disc) this.returnDiscToCase(disc, f);
    else this.returnDiscToShelf(disc);
    this.refreshBooklet();
    this.updateHint();
  }

  private async returnDiscToShelf(disc: Disc) {
    const c = this.shelf.caseFor(disc.album.id);
    if (!c || c.shelf.away || c.disc) {
      // nowhere to go: shrink away
      await tweenProps(disc.group.scale, { x: 0.001, y: 0.001, z: 0.001 }, { duration: 0.4, ease: ease.inCubic });
      disc.dispose();
      return;
    }
    c.body.attach(disc.group);
    const pos = JewelCase.trayPosition();
    await this.fly(disc.group, { pos, quat: new THREE.Quaternion(), scale: 1 }, { duration: 0.85, arc: new THREE.Vector3(0, 1.2, 1.5), spin: 2, ease: ease.inOutCubic });
    if (c.disc || c.shelf.away) {
      disc.dispose();
      return;
    }
    c.disc = disc;
    sfx.tap(0.5);
  }

  /* ================================================================== */
  /* captions & hints                                                    */
  /* ================================================================== */

  private positionCaption() {
    const f = this.focused!;
    const pose = this.layout.hud.focus;
    const s = f.root.scale.x;
    const p = this.stage.hudToScreen(this.tmpV.set(pose.x, pose.y - (CASE.H / 2) * s - 0.04, -HUD_DEPTH));
    this.overlay.positionCaption(p.x, p.y + 6);
  }

  private hintLevelAtLeast(level: number) {
    if (this.hintLevel >= level) return;
    this.hintLevel = level;
    storage.set('cdstream.hints', String(level));
  }

  private touchUi() {
    return matchMedia('(pointer: coarse)').matches;
  }

  updateHint(force = false) {
    if (!this.interactive) return this.overlay.setHint(null);
    const f = this.focused;
    const top = this.layout.portrait;
    const touch = this.touchUi();
    if (this.mode === 'browse') {
      if (this.hintLevel >= 2 && !force) return this.overlay.setHint(null);
      if (this.hintLevel >= 1) return this.overlay.setHint(touch ? 'Swipe up on a stack to flip through it' : 'Hover a stack to peek inside', top);
      return this.overlay.setHint(touch ? 'Swipe to browse · tap a CD' : 'Drag or scroll to browse · click a CD', top);
    }
    if (this.mode !== 'focus' || !f) return;
    if (f.open < 0.5) return this.overlay.setHint(touch ? 'Tap to open the case' : 'Click to open the case — or drag the lid', top);
    if (f.disc) return this.overlay.setHint(this.hintLevel >= 2 ? null : 'Drag the disc into the player', top);
    if (this.hintLevel >= 3) return this.overlay.setHint(null);
    return this.overlay.setHint(touch ? 'Tap a track to jump to it · tap outside to put the case back' : 'Click a track to jump to it · click outside to put the case back', top);
  }
}
