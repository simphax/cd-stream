import * as THREE from 'three';
import type { Album } from '../types';
import { Disc } from './disc';
import { glareMaterial, lidGeometry, lidNormalMap, lidRoughnessMap, rosetteGeometry, trayTexture } from './caseDetails';
import { placeholderCover, softShadow, spineTexture } from './textures';
import type { Spring } from '../anim/tween';

/** Real jewel case proportions, 1 unit = 100 mm. */
export const CASE = {
  W: 1.42,
  H: 1.25,
  D: 0.104,
  COVER: 1.2,
  LID_T: 0.028,
  BASE_T: 0.052,
  /** x of the booklet / disc centre (the hinge strip sits on the left). */
  CX: 1.42 / 2 - 0.025 - 0.6,
  OPEN_ANGLE: Math.PI * 0.96,
};

const BASE_FRONT_Z = 0; // front face of the black tray
const LID_Z = CASE.D / 2 - CASE.LID_T / 2; // lid centre

let sharedGeo: {
  base: THREE.BoxGeometry;
  lid: THREE.BufferGeometry;
  cover: THREE.PlaneGeometry;
  rosette: THREE.BufferGeometry;
} | null = null;
let sharedMat: {
  tray: THREE.Material;
  rim: THREE.Material;
  /** Cheap see-through plastic for the many cases on the shelf. */
  lid: THREE.Material[];
  /** Real refraction (polystyrene, IOR 1.59) for the one case in your hands. */
  lidHQ: THREE.Material[];
  hub: THREE.Material;
} | null = null;

function shared() {
  if (!sharedGeo) {
    const base = new THREE.BoxGeometry(CASE.W, CASE.H, CASE.BASE_T);
    base.translate(0, 0, BASE_FRONT_Z - CASE.BASE_T / 2);
    sharedGeo = {
      base,
      lid: lidGeometry(CASE.LID_T),
      cover: new THREE.PlaneGeometry(CASE.COVER, CASE.COVER),
      rosette: rosetteGeometry(),
    };
    const normalMap = lidNormalMap();
    const roughnessMap = lidRoughnessMap();
    const plastic = {
      color: 0xffffff,
      metalness: 0,
      roughness: 1,
      roughnessMap,
      normalMap,
      normalScale: new THREE.Vector2(0.7, 0.7),
    };
    sharedMat = {
      tray: new THREE.MeshPhysicalMaterial({ map: trayTexture(), roughness: 0.5, clearcoat: 0.3, clearcoatRoughness: 0.3, envMapIntensity: 0.6 }),
      rim: new THREE.MeshPhysicalMaterial({ color: 0x1b1c1f, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.1 }),
      lid: [
        new THREE.MeshPhysicalMaterial({ ...plastic, transparent: true, opacity: 0.08, envMapIntensity: 3, depthWrite: false }),
        new THREE.MeshPhysicalMaterial({ color: 0xdfe7e6, roughness: 0.1, transparent: true, opacity: 0.32, envMapIntensity: 2, depthWrite: false }),
      ],
      lidHQ: [
        new THREE.MeshPhysicalMaterial({
          ...plastic,
          transmission: 1,
          thickness: 0.014,
          ior: 1.59,
          specularIntensity: 1,
          envMapIntensity: 1.4,
          attenuationColor: new THREE.Color(0xeef4f2),
          attenuationDistance: 0.6,
        }),
        // seen edge-on, clear polystyrene turns a faint grey-green
        new THREE.MeshPhysicalMaterial({
          color: 0xffffff,
          roughness: 0.08,
          transmission: 1,
          thickness: 0.05,
          ior: 1.59,
          envMapIntensity: 1.6,
          attenuationColor: new THREE.Color(0xa9bdb8),
          attenuationDistance: 0.04,
        }),
      ],
      hub: new THREE.MeshPhysicalMaterial({ color: 0x232327, roughness: 0.35, clearcoat: 0.6 }),
    };
  }
  return { geo: sharedGeo, mat: sharedMat! };
}

export interface ShelfSlot {
  stackIndex: number;
  slot: number;
  hover: Spring;
  jitter: { x: number; yaw: number; roll: number };
  /** True while the case is taken out of its stack. */
  away: boolean;
  /** Extra lift used while the stack is being cycled. */
  lift: number;
  pushBack: number;
}

/**
 * A jewel case: clear hinged lid with the booklet, black tray, and (when
 * focused) a disc. Hierarchy: root → tilt → body → (base, lidPivot → lid…).
 */
export class JewelCase {
  readonly root = new THREE.Group();
  readonly tilt = new THREE.Group();
  readonly body = new THREE.Group();
  readonly lidPivot = new THREE.Group();
  readonly cover: THREE.Mesh;
  readonly lid: THREE.Mesh;
  readonly base: THREE.Mesh;
  bookletBack: THREE.Mesh | null = null;
  disc: Disc | null = null;
  color = new THREE.Color(0x888888);
  shelf!: ShelfSlot;

  private coverMat: THREE.MeshStandardMaterial;
  private spineMat: THREE.MeshStandardMaterial;
  private backMat: THREE.MeshStandardMaterial;
  private details: THREE.Group | null = null;
  private shadow: THREE.Mesh | null = null;
  private glare: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial> | null = null;
  private _open = 0;

  constructor(public album: Album) {
    const { geo, mat } = shared();
    this.coverMat = new THREE.MeshStandardMaterial({ map: placeholderCover(album), roughness: 0.55 });
    this.spineMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.45 });
    this.backMat = new THREE.MeshStandardMaterial({ color: 0x444444, roughness: 0.5 });

    // faces: +x/−x spines (the inlay shows through), top/bottom rims, tray, back inlay
    this.base = new THREE.Mesh(geo.base, [this.spineMat, this.spineMat, mat.rim, mat.rim, mat.tray, this.backMat]);
    this.base.castShadow = true;

    this.lidPivot.position.set(-CASE.W / 2, 0, LID_Z);
    this.lid = new THREE.Mesh(geo.lid, mat.lid);
    this.lid.position.set(CASE.W / 2, 0, 0);
    this.lid.renderOrder = 2;
    this.cover = new THREE.Mesh(geo.cover, this.coverMat);
    this.cover.position.set(CASE.W / 2 + CASE.CX, 0, -CASE.LID_T / 2 - 0.003);
    this.cover.castShadow = true;
    this.lidPivot.add(this.cover, this.lid);

    this.body.add(this.base, this.lidPivot);
    this.tilt.add(this.body);
    this.root.add(this.tilt);

    for (const m of [this.base, this.lid, this.cover]) m.userData.case = this;
    this.setColor(this.color);
  }

  setCover(texture: THREE.Texture) {
    const old = this.coverMat.map;
    this.coverMat.map = texture;
    this.coverMat.needsUpdate = true;
    if (old && old !== texture && old.userData.placeholder) old.dispose();
  }

  setColor(color: THREE.Color) {
    this.color.copy(color);
    this.spineMat.map?.dispose();
    this.spineMat.map = spineTexture(this.album, color);
    this.spineMat.needsUpdate = true;
    const hsl = { h: 0, s: 0, l: 0 };
    color.getHSL(hsl);
    this.backMat.color.setHSL(hsl.h, Math.min(0.45, hsl.s), Math.min(0.3, hsl.l * 0.7));
  }

  /** 0 = closed, 1 = fully open (lid swung to the left, pair centred). */
  get open() {
    return this._open;
  }
  set open(v: number) {
    this._open = v;
    this.lidPivot.rotation.y = -v * CASE.OPEN_ANGLE;
    this.body.position.x = Math.min(1, Math.max(0, v)) * (CASE.W / 2);
  }

  /** Soft shadow behind the case while it floats in front of the shelf. */
  setFloatingShadow(opacity: number) {
    if (!this.shadow) {
      if (opacity <= 0) return;
      this.shadow = softShadow(CASE.W, CASE.H, 1);
      this.shadow.position.set(0.06, -0.09, -0.32);
      // follows the open pair: a second, wider shadow is overkill, so stretch it
      this.tilt.add(this.shadow);
    }
    const m = this.shadow.material as THREE.MeshBasicMaterial;
    m.opacity = opacity * 0.3;
    this.shadow.visible = opacity > 0.001;
    const open = Math.min(1, Math.max(0, this._open));
    this.shadow.scale.x = 1 + open;
  }

  /** Creates the inside of the case (tray hub, booklet back, disc) on demand. */
  ensureDetails() {
    if (this.details) return;
    const { geo, mat } = shared();
    const d = new THREE.Group();
    const rosette = new THREE.Mesh(geo.rosette, mat.hub);
    rosette.position.set(CASE.CX, 0, BASE_FRONT_Z);
    d.add(rosette);
    this.body.add(d);
    this.details = d;

    this.glare = new THREE.Mesh(new THREE.PlaneGeometry(CASE.W, CASE.H), glareMaterial());
    this.glare.position.set(CASE.W / 2, 0, CASE.LID_T / 2 + 0.001);
    this.glare.renderOrder = 3;
    this.glare.raycast = () => {};
    this.lidPivot.add(this.glare);
  }

  /** Slides the lid highlight with the case's tilt so it feels like real gloss. */
  updateGlare(shift: number) {
    if (!this.glare) return;
    const u = this.glare.material.uniforms;
    u.shift.value = shift;
    // the highlight belongs to the outside of the lid; fade it as the lid swings away
    u.opacity.value = 0.24 * Math.max(0, 1 - this._open * 1.6);
    this.glare.visible = u.opacity.value > 0.002;
  }

  /** Swap between the cheap shelf plastic and the refractive close-up plastic. */
  setCloseUp(on: boolean) {
    const { mat } = shared();
    this.lid.material = on ? mat.lidHQ : mat.lid;
  }

  setBooklet(texture: THREE.Texture) {
    if (!this.bookletBack) {
      const { geo } = shared();
      this.bookletBack = new THREE.Mesh(geo.cover, new THREE.MeshStandardMaterial({ roughness: 0.85, color: 0xd6d3cf }));
      this.bookletBack.rotation.y = Math.PI;
      this.bookletBack.position.copy(this.cover.position);
      this.bookletBack.position.z -= 0.002;
      this.bookletBack.userData.booklet = this;
      this.lidPivot.add(this.bookletBack);
    }
    const m = this.bookletBack.material as THREE.MeshStandardMaterial;
    if (m.map !== texture) {
      m.map?.dispose();
      m.map = texture;
      m.needsUpdate = true;
    }
  }

  /** Local position (in body space) where the disc rests in the tray. */
  static trayPosition(out = new THREE.Vector3()) {
    return out.set(CASE.CX, 0, BASE_FRONT_Z + 0.003);
  }

  insertDisc(disc: Disc) {
    this.disc = disc;
    this.body.add(disc.group);
    JewelCase.trayPosition(disc.group.position);
    disc.group.quaternion.identity();
    disc.group.scale.setScalar(1);
  }

  dispose() {
    this.coverMat.map?.dispose();
    this.coverMat.dispose();
    this.spineMat.map?.dispose();
    this.spineMat.dispose();
    this.backMat.dispose();
    const bm = this.bookletBack?.material as THREE.MeshStandardMaterial | undefined;
    bm?.map?.dispose();
    bm?.dispose();
    this.disc?.dispose();
    if (this.glare) {
      this.glare.material.dispose();
      this.glare.geometry.dispose();
    }
    this.shadow?.geometry.dispose();
    (this.shadow?.material as THREE.Material | undefined)?.dispose();
    this.root.removeFromParent();
  }
}
