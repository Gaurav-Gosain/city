import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { CHUNK_SIZE, LOTS_PER_CHUNK, LOT_SIZE, LOT_STRIDE, STREET_WIDTH } from "./constants";

const SIDEWALK = [0.62, 0.6, 0.57];
const LOT = [0.46, 0.5, 0.42];
const ASPHALT = [0.16, 0.16, 0.17];
const YELLOW = [0.95, 0.78, 0.2];
const WHITE = [0.92, 0.92, 0.92];

function setColor(g: THREE.BufferGeometry, c: number[]) {
  const n = g.attributes.position!.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = c[0]!;
    arr[i * 3 + 1] = c[1]!;
    arr[i * 3 + 2] = c[2]!;
  }
  g.setAttribute("color", new THREE.BufferAttribute(arr, 3));
}

export function buildRoadsGeometry(rand: () => number): THREE.BufferGeometry {
  const geos: THREE.BufferGeometry[] = [];

  const base = new THREE.PlaneGeometry(CHUNK_SIZE, CHUNK_SIZE);
  base.rotateX(-Math.PI / 2);
  base.translate(CHUNK_SIZE / 2, 0, CHUNK_SIZE / 2);
  setColor(base, SIDEWALK);
  geos.push(base);

  for (let i = 0; i < LOTS_PER_CHUNK; i++) {
    for (let j = 0; j < LOTS_PER_CHUNK; j++) {
      const x0 = STREET_WIDTH / 2 + i * LOT_STRIDE + 1.5;
      const z0 = STREET_WIDTH / 2 + j * LOT_STRIDE + 1.5;
      const sz = LOT_SIZE - 3;
      const lot = new THREE.PlaneGeometry(sz, sz);
      lot.rotateX(-Math.PI / 2);
      lot.translate(x0 + sz / 2, 0.04, z0 + sz / 2);
      const tint = 0.85 + rand() * 0.3;
      setColor(lot, [LOT[0]! * tint, LOT[1]! * tint, LOT[2]! * tint]);
      geos.push(lot);
    }
  }

  for (let i = 0; i <= LOTS_PER_CHUNK; i++) {
    const z = i * LOT_STRIDE;
    const sH = new THREE.PlaneGeometry(CHUNK_SIZE, STREET_WIDTH);
    sH.rotateX(-Math.PI / 2);
    sH.translate(CHUNK_SIZE / 2, 0.06, z);
    setColor(sH, ASPHALT);
    geos.push(sH);

    const x = i * LOT_STRIDE;
    const sV = new THREE.PlaneGeometry(STREET_WIDTH, CHUNK_SIZE);
    sV.rotateX(-Math.PI / 2);
    sV.translate(x, 0.06, CHUNK_SIZE / 2);
    setColor(sV, ASPHALT);
    geos.push(sV);
  }

  for (let i = 0; i <= LOTS_PER_CHUNK; i++) {
    const z = i * LOT_STRIDE;
    for (let s = 0; s < CHUNK_SIZE; s += 6) {
      const mod = s % LOT_STRIDE;
      if (mod > LOT_STRIDE - STREET_WIDTH * 1.2 && mod < STREET_WIDTH * 1.2) continue;
      const m = new THREE.PlaneGeometry(3, 0.35);
      m.rotateX(-Math.PI / 2);
      m.translate(s + 1.5, 0.08, z);
      setColor(m, YELLOW);
      geos.push(m);
    }
    const x = i * LOT_STRIDE;
    for (let s = 0; s < CHUNK_SIZE; s += 6) {
      const mod = s % LOT_STRIDE;
      if (mod > LOT_STRIDE - STREET_WIDTH * 1.2 && mod < STREET_WIDTH * 1.2) continue;
      const m = new THREE.PlaneGeometry(0.35, 3);
      m.rotateX(-Math.PI / 2);
      m.translate(x, 0.08, s + 1.5);
      setColor(m, YELLOW);
      geos.push(m);
    }
  }

  for (let i = 0; i <= LOTS_PER_CHUNK; i++) {
    for (let j = 0; j <= LOTS_PER_CHUNK; j++) {
      const ix = i * LOT_STRIDE;
      const iz = j * LOT_STRIDE;
      const half = STREET_WIDTH / 2;
      for (const side of [-1, 1]) {
        for (let k = -2; k <= 2; k++) {
          const m = new THREE.PlaneGeometry(0.45, STREET_WIDTH * 0.85);
          m.rotateX(-Math.PI / 2);
          m.translate(ix + side * (half + 1.2 + k * 1.0), 0.09, iz);
          setColor(m, WHITE);
          geos.push(m);
        }
        for (let k = -2; k <= 2; k++) {
          const m = new THREE.PlaneGeometry(STREET_WIDTH * 0.85, 0.45);
          m.rotateX(-Math.PI / 2);
          m.translate(ix, 0.09, iz + side * (half + 1.2 + k * 1.0));
          setColor(m, WHITE);
          geos.push(m);
        }
      }
    }
  }

  return mergeGeometries(geos, false);
}

export function buildStreetlightGeometries(rand: () => number): {
  poles: THREE.BufferGeometry | null;
  bulbs: THREE.BufferGeometry | null;
} {
  const poleGeos: THREE.BufferGeometry[] = [];
  const bulbGeos: THREE.BufferGeometry[] = [];
  for (let i = 0; i <= LOTS_PER_CHUNK; i++) {
    for (let j = 0; j <= LOTS_PER_CHUNK; j++) {
      const ix = i * LOT_STRIDE;
      const iz = j * LOT_STRIDE;
      const off = STREET_WIDTH * 0.45 + 0.4;
      const corners: Array<[number, number]> = [
        [ix - off, iz - off],
        [ix + off, iz - off],
        [ix - off, iz + off],
        [ix + off, iz + off],
      ];
      for (const [x, z] of corners) {
        if (x < 0 || x > CHUNK_SIZE || z < 0 || z > CHUNK_SIZE) continue;
        if (rand() > 0.5) continue;
        const poleH = 5.5;
        const pole = new THREE.CylinderGeometry(0.08, 0.12, poleH, 6);
        pole.translate(x, poleH / 2, z);
        poleGeos.push(pole);
        const dx = x < ix ? 0.6 : -0.6;
        const arm = new THREE.BoxGeometry(1.2, 0.12, 0.12);
        arm.translate(x + dx * 0.5, poleH - 0.2, z);
        poleGeos.push(arm);
        const bulb = new THREE.IcosahedronGeometry(0.32, 0);
        bulb.translate(x + dx, poleH - 0.25, z);
        bulbGeos.push(bulb);
      }
    }
  }
  const poles = poleGeos.length ? mergeGeometries(poleGeos, false) : null;
  const bulbs = bulbGeos.length ? mergeGeometries(bulbGeos, false) : null;
  poleGeos.forEach((g) => g.dispose());
  bulbGeos.forEach((g) => g.dispose());
  return { poles, bulbs };
}
