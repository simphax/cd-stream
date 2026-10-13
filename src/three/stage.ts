import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { setMaxAnisotropy } from './textures';

export const FOV = 30;
// `?dt=0.3` lets slow software renderers (headless tests) keep real-time pace.
const MAX_DT = Number(new URLSearchParams(location.search).get('dt')) || 1 / 20;

export const WALL_COLOR = new THREE.Color('#e9e5df');

/**
 * Renderer, camera and lights. `world` holds the shelf (the camera pans over
 * it); `hud` is parented to the camera for things held "in front of you":
 * the focused case, the disc being dragged and the player.
 */
export class Stage {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 200);
  readonly hud = new THREE.Group();
  readonly world = new THREE.Group();
  readonly key: THREE.DirectionalLight;
  width = 1;
  height = 1;

  private frameFns: ((dt: number, t: number) => void)[] = [];
  private resizeFns: (() => void)[] = [];
  private raycaster = new THREE.Raycaster();
  private ndc = new THREE.Vector2();
  private timer = new THREE.Timer();
  private running = false;

  constructor(private container: HTMLElement) {
    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NeutralToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.localClippingEnabled = false;
    container.appendChild(renderer.domElement);
    this.renderer = renderer;
    setMaxAnisotropy(renderer.capabilities.getMaxAnisotropy());

    this.scene.background = WALL_COLOR.clone();
    const pmrem = new THREE.PMREMGenerator(renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.5;

    const hemi = new THREE.HemisphereLight(0xffffff, 0xd9d0c4, 0.75);
    this.scene.add(hemi);

    const key = new THREE.DirectionalLight(0xfff6ea, 1.8);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.bias = -0.0004;
    key.shadow.normalBias = 0.02;
    key.shadow.radius = 4;
    this.key = key;
    this.scene.add(key, key.target);

    const fill = new THREE.DirectionalLight(0xe6eeff, 0.45);
    fill.position.set(6, 2, 8);
    this.scene.add(fill);

    this.scene.add(this.world, this.camera);
    this.camera.add(this.hud);

    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  onFrame(fn: (dt: number, t: number) => void) {
    this.frameFns.push(fn);
  }

  onResize(fn: () => void) {
    this.resizeFns.push(fn);
  }

  resize() {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.width = w;
    this.height = h;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.resizeFns.forEach((f) => f());
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.timer.reset();
    const loop = () => {
      if (!this.running) return;
      requestAnimationFrame(loop);
      this.timer.update();
      const dt = Math.min(this.timer.getDelta(), MAX_DT);
      const t = this.timer.getElapsed();
      this.frameFns.forEach((f) => f(dt, t));
      this.updateShadowCamera();
      this.renderer.render(this.scene, this.camera);
    };
    loop();
  }

  /** Keeps the shadow frustum over the visible part of the shelf. */
  private updateShadowCamera() {
    const cam = this.camera;
    const dist = cam.position.z;
    const vh = 2 * dist * Math.tan(THREE.MathUtils.degToRad(FOV / 2));
    const vw = vh * cam.aspect;
    const target = this.key.target.position;
    target.set(cam.position.x, cam.position.y, -0.5);
    this.key.position.set(target.x - 5, target.y + 9, target.z + 12);
    const sc = this.key.shadow.camera;
    const half = Math.max(vw, vh) * 0.62 + 2;
    if (sc.right !== half) {
      sc.left = -half;
      sc.right = half;
      sc.top = half;
      sc.bottom = -half;
      sc.near = 1;
      sc.far = 40;
      sc.updateProjectionMatrix();
    }
  }

  /** Size of the view frustum at a given distance from the camera. */
  viewSize(distance: number) {
    const h = 2 * distance * Math.tan(THREE.MathUtils.degToRad(FOV / 2));
    return { w: h * this.camera.aspect, h };
  }

  toNdc(clientX: number, clientY: number) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    return this.ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
  }

  raycast(clientX: number, clientY: number, objects: THREE.Object3D[], recursive = true) {
    this.camera.updateMatrixWorld();
    this.raycaster.setFromCamera(this.toNdc(clientX, clientY), this.camera);
    return this.raycaster.intersectObjects(objects, recursive);
  }

  /** Point under the cursor on the hud plane z = -depth (hud-local coords). */
  hudPoint(clientX: number, clientY: number, depth: number, out = new THREE.Vector3()) {
    const ndc = this.toNdc(clientX, clientY);
    const { w, h } = this.viewSize(depth);
    return out.set((ndc.x * w) / 2, (ndc.y * h) / 2, -depth);
  }

  /** Projects a hud-local point to CSS pixels. */
  hudToScreen(p: THREE.Vector3) {
    const depth = -p.z;
    const { w, h } = this.viewSize(depth);
    return { x: (p.x / w + 0.5) * this.width, y: (0.5 - p.y / h) * this.height };
  }

  worldToScreen(p: THREE.Vector3) {
    const v = p.clone().project(this.camera);
    return { x: (v.x * 0.5 + 0.5) * this.width, y: (-v.y * 0.5 + 0.5) * this.height };
  }
}
