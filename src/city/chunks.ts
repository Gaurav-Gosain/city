import * as THREE from "three";
import { CHUNK_SIZE, LOTS_PER_CHUNK, LOT_SIZE, LOT_STRIDE, STREET_WIDTH } from "./constants";
import { mulberry32, chunkSeed } from "./prng";
import type { BuildingModel } from "./buildings";
import { buildBuildingsGeometry } from "./buildings";
import { buildRoadsGeometry, buildStreetlightGeometries } from "./roads";

export interface ChunkObj {
  group: THREE.Group;
  buildings?: THREE.Mesh;
  modelBuildings?: THREE.Object3D[];
  trunks?: THREE.InstancedMesh;
  foliage?: THREE.InstancedMesh;
  poles?: THREE.Mesh;
  bulbs?: THREE.Mesh;
  ground: THREE.Mesh;
}

export interface ChunkDeps {
  roadMat: THREE.Material;
  buildingMat: THREE.Material;
  trunkGeo: THREE.BufferGeometry;
  foliageGeo: THREE.BufferGeometry;
  trunkMat: THREE.Material;
  foliageMat: THREE.Material;
  poleMat: THREE.Material;
  bulbMat: THREE.Material;
  models: BuildingModel[];
}

export function buildChunk(cx: number, cz: number, d: ChunkDeps): ChunkObj {
  const rand = mulberry32(chunkSeed(cx, cz));
  const group = new THREE.Group();
  group.position.set(cx * CHUNK_SIZE, 0, cz * CHUNK_SIZE);

  const roadGeo = buildRoadsGeometry(rand);
  const ground = new THREE.Mesh(roadGeo, d.roadMat);
  group.add(ground);

  const parkLots = new Set<string>();
  for (let i = 0; i < LOTS_PER_CHUNK; i++) {
    for (let j = 0; j < LOTS_PER_CHUNK; j++) {
      if (rand() < 0.1) parkLots.add(i + "," + j);
    }
  }

  let buildings: THREE.Mesh | undefined;
  let modelBuildings: THREE.Object3D[] | undefined;
  const occupiedLots = new Set<string>();
  if (d.models.length > 0) {
    modelBuildings = [];
    for (let i = 0; i < LOTS_PER_CHUNK; i++) {
      for (let j = 0; j < LOTS_PER_CHUNK; j++) {
        const key = i + "," + j;
        if (parkLots.has(key)) continue;
        if (rand() > 0.92) continue;
        const cx2 = STREET_WIDTH / 2 + i * LOT_STRIDE + LOT_SIZE / 2;
        const cz2 = STREET_WIDTH / 2 + j * LOT_STRIDE + LOT_SIZE / 2;
        const model = d.models[Math.floor(rand() * d.models.length)]!;
        const inst = model.object.clone(true);
        const target = LOT_SIZE * (0.78 + rand() * 0.18);
        const horiz = Math.max(model.size.x, model.size.z);
        inst.scale.setScalar(horiz > 0.001 ? target / horiz : 1);
        inst.position.set(cx2, 0, cz2);
        inst.rotation.y = Math.floor(rand() * 4) * (Math.PI / 2);
        group.add(inst);
        modelBuildings.push(inst);
        occupiedLots.add(key);
      }
    }
  }
  const buildingGeo = buildBuildingsGeometry(cx, cz, rand, parkLots, occupiedLots);
  if (buildingGeo) {
    buildings = new THREE.Mesh(buildingGeo, d.buildingMat);
    buildings.position.set(-cx * CHUNK_SIZE, 0, -cz * CHUNK_SIZE);
    group.add(buildings);
  }

  const slights = buildStreetlightGeometries(rand);
  let poles: THREE.Mesh | undefined;
  let bulbs: THREE.Mesh | undefined;
  if (slights.poles) {
    poles = new THREE.Mesh(slights.poles, d.poleMat);
    group.add(poles);
  }
  if (slights.bulbs) {
    bulbs = new THREE.Mesh(slights.bulbs, d.bulbMat);
    group.add(bulbs);
  }

  const trunkMatrices: THREE.Matrix4[] = [];
  const foliageMatrices: THREE.Matrix4[] = [];
  const _m = new THREE.Matrix4();
  const _q = new THREE.Quaternion();
  const _p = new THREE.Vector3();
  const _s = new THREE.Vector3();

  for (let i = 0; i < LOTS_PER_CHUNK; i++) {
    for (let j = 0; j < LOTS_PER_CHUNK; j++) {
      const isPark = parkLots.has(i + "," + j);
      const lotX0 = STREET_WIDTH / 2 + i * LOT_STRIDE;
      const lotZ0 = STREET_WIDTH / 2 + j * LOT_STRIDE;
      const cxL = lotX0 + LOT_SIZE / 2;
      const czL = lotZ0 + LOT_SIZE / 2;

      const positions: Array<[number, number, number]> = [];
      if (isPark) {
        const n = 18 + Math.floor(rand() * 14);
        for (let k = 0; k < n; k++) {
          positions.push([
            lotX0 + 3 + rand() * (LOT_SIZE - 6),
            0,
            lotZ0 + 3 + rand() * (LOT_SIZE - 6),
          ]);
        }
      } else {
        const inset = 3.5;
        const candidates: Array<[number, number]> = [
          [lotX0 + inset, lotZ0 + inset],
          [lotX0 + LOT_SIZE - inset, lotZ0 + inset],
          [lotX0 + inset, lotZ0 + LOT_SIZE - inset],
          [lotX0 + LOT_SIZE - inset, lotZ0 + LOT_SIZE - inset],
          [cxL, lotZ0 + inset],
          [cxL, lotZ0 + LOT_SIZE - inset],
          [lotX0 + inset, czL],
          [lotX0 + LOT_SIZE - inset, czL],
        ];
        for (const [x, z] of candidates) {
          if (rand() < 0.22) positions.push([x, 0, z]);
        }
      }

      for (const [x, _y, z] of positions) {
        const trunkH = 3 + rand() * 2.5;
        const folR = 1.6 + rand() * 1.4;
        const rotY = rand() * Math.PI * 2;
        _q.setFromEuler(new THREE.Euler(0, rotY, (rand() - 0.5) * 0.05));
        _p.set(x, trunkH / 2, z);
        _s.set(1, trunkH / 4, 1);
        _m.compose(_p, _q, _s);
        trunkMatrices.push(_m.clone());

        _p.set(x, trunkH + folR * 0.6, z);
        _s.set(folR, folR * (0.9 + rand() * 0.4), folR);
        _m.compose(_p, _q, _s);
        foliageMatrices.push(_m.clone());
      }
    }
  }

  let trunks: THREE.InstancedMesh | undefined;
  let foliage: THREE.InstancedMesh | undefined;
  if (trunkMatrices.length) {
    trunks = new THREE.InstancedMesh(d.trunkGeo, d.trunkMat, trunkMatrices.length);
    foliage = new THREE.InstancedMesh(d.foliageGeo, d.foliageMat, foliageMatrices.length);
    for (let k = 0; k < trunkMatrices.length; k++) {
      trunks.setMatrixAt(k, trunkMatrices[k]!);
      foliage.setMatrixAt(k, foliageMatrices[k]!);
    }
    trunks.instanceMatrix.needsUpdate = true;
    foliage.instanceMatrix.needsUpdate = true;
    group.add(trunks);
    group.add(foliage);
  }

  return { group, buildings, modelBuildings, trunks, foliage, poles, bulbs, ground };
}

export function disposeChunk(ch: ChunkObj) {
  ch.group.parent?.remove(ch.group);
  ch.buildings?.geometry.dispose();
  ch.poles?.geometry.dispose();
  ch.bulbs?.geometry.dispose();
  ch.ground.geometry.dispose();
}
