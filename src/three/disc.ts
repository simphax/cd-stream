import * as THREE from 'three';
import type { Album } from '../types';
import { discDataSide, discLabel } from './textures';

export const DISC = { R: 0.6, HOLE: 0.075, T: 0.012 };

let geo: { top: THREE.BufferGeometry; bottom: THREE.BufferGeometry; edge: THREE.BufferGeometry; hole: THREE.BufferGeometry } | null = null;
let bottomMat: THREE.Material | null = null;
let edgeMat: THREE.Material | null = null;

function shared() {
  if (!geo) {
    const top = new THREE.RingGeometry(DISC.HOLE, DISC.R, 128, 1);
    top.translate(0, 0, DISC.T);
    const bottom = new THREE.RingGeometry(DISC.HOLE, DISC.R, 128, 1);
    bottom.rotateY(Math.PI);
    const edge = new THREE.CylinderGeometry(DISC.R, DISC.R, DISC.T, 128, 1, true);
    edge.rotateX(Math.PI / 2);
    edge.translate(0, 0, DISC.T / 2);
    const hole = new THREE.CylinderGeometry(DISC.HOLE, DISC.HOLE, DISC.T, 48, 1, true);
    hole.rotateX(Math.PI / 2);
    hole.translate(0, 0, DISC.T / 2);
    geo = { top, bottom, edge, hole };
    bottomMat = new THREE.MeshPhysicalMaterial({
      map: discDataSide(),
      metalness: 1,
      roughness: 0.12,
      iridescence: 1,
      iridescenceIOR: 1.6,
      iridescenceThicknessRange: [200, 700],
    });
    edgeMat = new THREE.MeshPhysicalMaterial({ color: 0xd0d4dc, roughness: 0.2, metalness: 0.3, transmission: 0, clearcoat: 1 });
  }
  return geo;
}

/** A compact disc: origin at the centre of its bottom face, label facing +z. */
export class Disc {
  readonly group = new THREE.Group();
  /** Rotates around z; spun by the player. */
  readonly spin = new THREE.Group();
  readonly hit: THREE.Mesh;
  private topMat: THREE.MeshPhysicalMaterial;

  constructor(public album: Album) {
    const g = shared();
    this.topMat = new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      metalness: 1,
      roughness: 0.3,
      clearcoat: 0.8,
      clearcoatRoughness: 0.12,
      iridescence: 0.6,
      iridescenceIOR: 1.5,
      iridescenceThicknessRange: [150, 600],
    });
    const top = new THREE.Mesh(g.top, this.topMat);
    const bottom = new THREE.Mesh(g.bottom, bottomMat!);
    const edge = new THREE.Mesh(g.edge, edgeMat!);
    const hole = new THREE.Mesh(g.hole, edgeMat!);
    this.spin.add(top, bottom, edge, hole);
    this.spin.rotation.z = Math.random() * Math.PI * 2;
    this.group.add(this.spin);
    // solid, slightly generous hit area (the real disc has a hole in the middle)
    const hit = new THREE.Mesh(new THREE.CircleGeometry(DISC.R * 1.05, 32), new THREE.MeshBasicMaterial({ visible: false }));
    hit.position.z = DISC.T + 0.002;
    this.group.add(hit);
    this.hit = hit;
    for (const m of [top, bottom, edge, hit]) m.userData.disc = this;
    this.group.userData.disc = this;
  }

  setLabel(source: CanvasImageSource | null, color: THREE.Color) {
    const { map, metal } = discLabel(source, color);
    this.topMat.map?.dispose();
    this.topMat.metalnessMap?.dispose();
    this.topMat.map = map;
    this.topMat.metalnessMap = metal;
    this.topMat.iridescenceMap = metal;
    this.topMat.needsUpdate = true;
  }

  dispose() {
    this.topMat.map?.dispose();
    this.topMat.metalnessMap?.dispose();
    this.topMat.dispose();
    this.hit.geometry.dispose();
    this.group.removeFromParent();
  }
}
