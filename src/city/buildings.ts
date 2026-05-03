import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import {
  BUILDING_PALETTE,
  CHUNK_SIZE,
  LOTS_PER_CHUNK,
  LOT_SIZE,
  LOT_STRIDE,
  STREET_WIDTH,
  UNIT_PER_WINDOW,
} from "./constants";

export interface BuildingModel {
  object: THREE.Object3D;
  size: THREE.Vector3;
}

export function makeBuildingMaterial(): THREE.MeshLambertMaterial {
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  mat.defines = { ...(mat.defines || {}), USE_UV: "" };
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uNightAmount = { value: 0 };
    (mat as any).userData.shader = shader;
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
attribute float aIsWall;
varying float vIsWall;`
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
vIsWall = aIsWall;`
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
varying float vIsWall;
uniform float uNightAmount;
float bHash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }`
      )
      .replace(
        "#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>
if (vIsWall > 0.5) {
  vec2 buv = vUv;
  vec2 cell = floor(buv);
  vec2 g2 = fract(buv);
  float winX = step(0.18, g2.x) * step(g2.x, 0.82);
  float winY = step(0.22, g2.y) * step(g2.y, 0.78);
  float win = winX * winY;
  float seed = bHash(cell);
  float lit = step(0.55, seed);
  diffuseColor.rgb *= mix(1.0, 0.55, win);
  vec3 winCol = mix(vec3(1.0, 0.82, 0.45), vec3(0.85, 0.95, 1.0), step(0.85, seed));
  totalEmissiveRadiance += win * lit * winCol * (1.2 + uNightAmount * 2.5);
}`
      );
  };
  return mat;
}

function setBuildingAttributes(geo: THREE.BufferGeometry, color: number[]) {
  const normal = geo.attributes.normal as THREE.BufferAttribute;
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const uv = geo.attributes.uv as THREE.BufferAttribute | undefined;
  const count = pos.count;
  const colors = new Float32Array(count * 3);
  const isWall = new Float32Array(count);
  const ox = Math.floor(Math.random() * 9000);
  const oy = Math.floor(Math.random() * 9000);
  const u = UNIT_PER_WINDOW;
  for (let i = 0; i < count; i++) {
    const ny = normal.getY(i);
    const wall = Math.abs(ny) < 0.6 ? 1 : 0;
    isWall[i] = wall;
    const k = wall ? 1.0 : ny > 0 ? 0.78 : 0.5;
    colors[i * 3 + 0] = color[0]! * k;
    colors[i * 3 + 1] = color[1]! * k;
    colors[i * 3 + 2] = color[2]! * k;
    if (uv) {
      if (wall) {
        const px = pos.getX(i);
        const py = pos.getY(i);
        const pz = pos.getZ(i);
        const nx = normal.getX(i);
        const nz = normal.getZ(i);
        const horiz = Math.abs(nx) > Math.abs(nz) ? pz : px;
        uv.setXY(i, horiz / u + ox, py / u + oy);
      } else {
        uv.setXY(i, 0, 0);
      }
    }
  }
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geo.setAttribute("aIsWall", new THREE.BufferAttribute(isWall, 1));
  if (uv) uv.needsUpdate = true;
}

function makeBuildingShape(
  shape: number,
  w: number,
  d: number,
  h: number,
  rand: () => number,
  color: number[]
): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [];
  if (shape === 0) {
    const g = new THREE.BoxGeometry(w, h, d);
    g.translate(0, h / 2, 0);
    setBuildingAttributes(g, color);
    out.push(g);
  } else if (shape === 1) {
    const segs = 10 + Math.floor(rand() * 8);
    const r = Math.min(w, d) / 2;
    const g = new THREE.CylinderGeometry(r * (0.85 + rand() * 0.15), r, h, segs, 1, false);
    g.translate(0, h / 2, 0);
    setBuildingAttributes(g, color);
    out.push(g);
  } else if (shape === 2) {
    const tiers = 2 + Math.floor(rand() * 3);
    let cw = w, cd = d, y = 0;
    for (let t = 0; t < tiers; t++) {
      const remaining = tiers - t;
      const tierH = h * (1 / remaining) * (0.7 + rand() * 0.6);
      const g = new THREE.BoxGeometry(cw, tierH, cd);
      g.translate(0, y + tierH / 2, 0);
      setBuildingAttributes(g, color);
      out.push(g);
      y += tierH;
      cw *= 0.65 + rand() * 0.2;
      cd *= 0.65 + rand() * 0.2;
    }
  } else if (shape === 3) {
    const a = new THREE.BoxGeometry(w, h, d * 0.55);
    a.translate(0, h / 2, -d * 0.225);
    setBuildingAttributes(a, color);
    out.push(a);
    const b = new THREE.BoxGeometry(w * 0.55, h * (0.7 + rand() * 0.3), d);
    b.translate(-w * 0.225, h * 0.5 * (0.7 + rand() * 0.3), 0);
    setBuildingAttributes(b, color);
    out.push(b);
  } else if (shape === 4) {
    const g = new THREE.BoxGeometry(w, h, d);
    g.translate(0, h / 2, 0);
    setBuildingAttributes(g, color);
    out.push(g);
    const antH = 6 + rand() * 14;
    const ant = new THREE.CylinderGeometry(0.3, 0.5, antH, 5);
    ant.translate(0, h + antH / 2, 0);
    setBuildingAttributes(ant, [0.25, 0.25, 0.28]);
    out.push(ant);
  } else {
    const r = Math.min(w, d) / 2;
    const g = new THREE.CylinderGeometry(r, r, h, 8, 1, false);
    g.translate(0, h / 2, 0);
    setBuildingAttributes(g, color);
    out.push(g);
  }
  return out;
}

export function buildBuildingsGeometry(
  cx: number,
  cz: number,
  rand: () => number,
  parkLots: Set<string>,
  occupiedLots: Set<string>
): THREE.BufferGeometry | null {
  const geos: THREE.BufferGeometry[] = [];
  for (let i = 0; i < LOTS_PER_CHUNK; i++) {
    for (let j = 0; j < LOTS_PER_CHUNK; j++) {
      const key = i + "," + j;
      if (parkLots.has(key)) continue;
      if (occupiedLots.has(key)) continue;
      const wx = cx * CHUNK_SIZE + STREET_WIDTH / 2 + i * LOT_STRIDE + LOT_SIZE / 2;
      const wz = cz * CHUNK_SIZE + STREET_WIDTH / 2 + j * LOT_STRIDE + LOT_SIZE / 2;
      const heightBoost = Math.max(0, 1 - Math.hypot(wx, wz) / 2500);

      const w = LOT_SIZE * (0.55 + rand() * 0.38);
      const d = LOT_SIZE * (0.55 + rand() * 0.38);
      const r = rand();
      let h: number;
      let shape: number;
      if (r < 0.55) {
        h = 8 + rand() * 14;
        shape = rand() < 0.85 ? 0 : 3;
      } else if (r < 0.85) {
        h = 22 + rand() * 22;
        const s = rand();
        shape = s < 0.4 ? 0 : s < 0.65 ? 2 : s < 0.85 ? 1 : 3;
      } else if (r < 0.98) {
        h = 50 + rand() * (35 + heightBoost * 30);
        const s = rand();
        shape = s < 0.4 ? 4 : s < 0.7 ? 2 : s < 0.9 ? 1 : 5;
      } else {
        h = 90 + rand() * (40 + heightBoost * 40);
        const s = rand();
        shape = s < 0.55 ? 4 : s < 0.8 ? 1 : 5;
      }

      const color = BUILDING_PALETTE[Math.floor(rand() * BUILDING_PALETTE.length)]!;
      const parts = makeBuildingShape(shape, w, d, h, rand, color);
      for (const p of parts) {
        p.translate(wx, 0, wz);
        geos.push(p);
      }

      if (rand() < 0.5 && h > 16 && (shape === 0 || shape === 4)) {
        const rw = w * (0.18 + rand() * 0.25);
        const rd = d * (0.18 + rand() * 0.25);
        const rh = 1.5 + rand() * 4;
        const rb = new THREE.BoxGeometry(rw, rh, rd);
        const offX = (rand() - 0.5) * (w - rw) * 0.6;
        const offZ = (rand() - 0.5) * (d - rd) * 0.6;
        rb.translate(wx + offX, h + rh / 2, wz + offZ);
        setBuildingAttributes(rb, [0.35, 0.35, 0.38]);
        geos.push(rb);
      }
    }
  }
  if (!geos.length) return null;
  const merged = mergeGeometries(geos, false);
  geos.forEach((g) => g.dispose());
  return merged;
}
