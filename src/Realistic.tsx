import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import { Sky } from "three/examples/jsm/objects/Sky.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import * as SkeletonUtils from "three/examples/jsm/utils/SkeletonUtils.js";

type Weather = "clear" | "rain" | "snow";

const TILE_RADIUS = 1;
const CAR_COUNT = 0;
const PED_COUNT = 180;
const PED_ANIM_RADIUS = 160;
const CELL_SIZE = 4;

// Skip these merged source meshes by material substring — too heavy or visually
// problematic (trees clip buildings; street props balloon draw count).
const SKIP_PATTERNS = [
  /WheelTex/i, /CarTex/i,                          // baked cars
  /Foliage/i, /Bark/i, /Grass/i,                   // trees + ground cover
  /Street_Assets/i,                                // street furniture (poles, signs)
  /WetFloorSign/i, /metal_trash_can_rust/i,        // small props
  /Decals/i, /Stain/i,                             // road decals
];

interface OccGrid {
  cells: Uint8Array;
  cellSize: number;
  cols: number;
  rows: number;
  originX: number;
  originZ: number;
}

// Rasterize a mesh's triangles into a 2D occupancy grid (X,Z plane).
// Uses point-in-triangle tests at cell centers — gives an exact area fill,
// not just where verts happen to land.
function rasterizeMesh(
  mesh: THREE.Mesh,
  tileSizeX: number,
  tileSizeZ: number,
  sceneCenter: THREE.Vector3
): OccGrid {
  const cellSize = CELL_SIZE;
  const cols = Math.ceil(tileSizeX / cellSize) + 2;
  const rows = Math.ceil(tileSizeZ / cellSize) + 2;
  const originX = -tileSizeX / 2 - cellSize;
  const originZ = -tileSizeZ / 2 - cellSize;
  const cells = new Uint8Array(cols * rows);

  const pos = mesh.geometry.attributes.position as THREE.BufferAttribute;
  const idx = mesh.geometry.index;
  const triCount = idx ? idx.count / 3 : pos.count / 3;
  const m = mesh.matrixWorld;
  const _a = new THREE.Vector3();
  const _b = new THREE.Vector3();
  const _c = new THREE.Vector3();

  for (let t = 0; t < triCount; t++) {
    const i0 = idx ? idx.getX(t * 3) : t * 3;
    const i1 = idx ? idx.getX(t * 3 + 1) : t * 3 + 1;
    const i2 = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
    _a.fromBufferAttribute(pos, i0).applyMatrix4(m);
    _b.fromBufferAttribute(pos, i1).applyMatrix4(m);
    _c.fromBufferAttribute(pos, i2).applyMatrix4(m);
    const ax = _a.x - sceneCenter.x, az = _a.z - sceneCenter.z;
    const bx = _b.x - sceneCenter.x, bz = _b.z - sceneCenter.z;
    const cxv = _c.x - sceneCenter.x, czv = _c.z - sceneCenter.z;
    const minX = Math.min(ax, bx, cxv);
    const maxX = Math.max(ax, bx, cxv);
    const minZ = Math.min(az, bz, czv);
    const maxZ = Math.max(az, bz, czv);
    const cMinX = Math.max(0, Math.floor((minX - originX) / cellSize));
    const cMaxX = Math.min(cols - 1, Math.ceil((maxX - originX) / cellSize));
    const cMinZ = Math.max(0, Math.floor((minZ - originZ) / cellSize));
    const cMaxZ = Math.min(rows - 1, Math.ceil((maxZ - originZ) / cellSize));
    const eABx = bx - ax, eABz = bz - az;
    const eBCx = cxv - bx, eBCz = czv - bz;
    const eCAx = ax - cxv, eCAz = az - czv;
    for (let zc = cMinZ; zc <= cMaxZ; zc++) {
      const zw = originZ + zc * cellSize + cellSize / 2;
      for (let xc = cMinX; xc <= cMaxX; xc++) {
        const xw = originX + xc * cellSize + cellSize / 2;
        const s1 = eABx * (zw - az) - eABz * (xw - ax);
        const s2 = eBCx * (zw - bz) - eBCz * (xw - bx);
        const s3 = eCAx * (zw - czv) - eCAz * (xw - cxv);
        const allPos = s1 >= 0 && s2 >= 0 && s3 >= 0;
        const allNeg = s1 <= 0 && s2 <= 0 && s3 <= 0;
        if (allPos || allNeg) cells[zc * cols + xc] = 1;
      }
    }
  }
  return { cells, cellSize, cols, rows, originX, originZ };
}

function gridSubtract(a: OccGrid, b: OccGrid | null): OccGrid {
  if (!b) return a;
  const out = new Uint8Array(a.cells.length);
  for (let i = 0; i < a.cells.length; i++) {
    out[i] = a.cells[i] && !b.cells[i] ? 1 : 0;
  }
  return { ...a, cells: out };
}

function gridErode(g: OccGrid): OccGrid {
  const { cells, cols, rows } = g;
  const out = new Uint8Array(cells.length);
  for (let z = 1; z < rows - 1; z++) {
    for (let x = 1; x < cols - 1; x++) {
      const c = cells[z * cols + x];
      if (!c) continue;
      const all =
        cells[(z - 1) * cols + x] &&
        cells[(z + 1) * cols + x] &&
        cells[z * cols + x - 1] &&
        cells[z * cols + x + 1];
      if (all) out[z * cols + x] = 1;
    }
  }
  return { ...g, cells: out };
}

function rotForCell(cx: number, cz: number): boolean {
  const h = (Math.imul(cx | 0, 73856093) ^ Math.imul(cz | 0, 19349663)) >>> 0;
  return (h & 1) === 1;
}

function isOccAtTileLocal(g: OccGrid, lx: number, lz: number): boolean {
  const cx = Math.floor((lx - g.originX) / g.cellSize);
  const cz = Math.floor((lz - g.originZ) / g.cellSize);
  if (cx < 0 || cx >= g.cols || cz < 0 || cz >= g.rows) return false;
  return g.cells[cz * g.cols + cx] === 1;
}

function isOccAtWorld(
  g: OccGrid,
  tileSizeX: number,
  tileSizeZ: number,
  wx: number,
  wz: number
): boolean {
  const tileCx = Math.floor((wx + tileSizeX / 2) / tileSizeX);
  const tileCz = Math.floor((wz + tileSizeZ / 2) / tileSizeZ);
  let lx = wx - tileCx * tileSizeX;
  let lz = wz - tileCz * tileSizeZ;
  if (rotForCell(tileCx, tileCz)) {
    lx = -lx;
    lz = -lz;
  }
  return isOccAtTileLocal(g, lx, lz);
}

export function Realistic() {
  const containerRef = useRef<HTMLDivElement>(null);
  const joyLeftRef = useRef<HTMLDivElement>(null);
  const joyRightRef = useRef<HTMLDivElement>(null);
  const climbUpRef = useRef(false);
  const climbDownRef = useRef(false);

  const [time, setTime] = useState(13);
  const [auto, setAuto] = useState(false);
  const [sensitivity, setSensitivity] = useState(1);
  const [weather, setWeather] = useState<Weather>("clear");
  const [loading, setLoading] = useState(true);
  const [loadProgress, setLoadProgress] = useState(0);
  const [grounded, setGrounded] = useState(false);
  const [tpp, setTpp] = useState(true);

  const timeRef = useRef(13);
  const autoRef = useRef(false);
  const sensitivityRef = useRef(1);
  const weatherRef = useRef<Weather>("clear");
  const groundedRef = useRef(false);
  const tppRef = useRef(true);

  useEffect(() => { timeRef.current = time; }, [time]);
  useEffect(() => { autoRef.current = auto; }, [auto]);
  useEffect(() => { sensitivityRef.current = sensitivity; }, [sensitivity]);
  useEffect(() => { weatherRef.current = weather; }, [weather]);
  useEffect(() => { groundedRef.current = grounded; }, [grounded]);
  useEffect(() => { tppRef.current = tpp; }, [tpp]);

  useEffect(() => {
    const container = containerRef.current!;
    const w = window.innerWidth;
    const h = window.innerHeight;

    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(w, h);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const fogColor = new THREE.Color("#c4d8e8");
    scene.fog = new THREE.Fog(fogColor, 500, 1800);

    const sky = new Sky();
    sky.scale.setScalar(10000);
    scene.add(sky);
    const skyU = sky.material.uniforms as Record<string, { value: any }>;
    skyU.turbidity!.value = 4;
    skyU.rayleigh!.value = 1.4;
    skyU.mieCoefficient!.value = 0.005;
    skyU.mieDirectionalG!.value = 0.85;
    const sunPos = new THREE.Vector3().setFromSphericalCoords(
      1,
      THREE.MathUtils.degToRad(45),
      THREE.MathUtils.degToRad(60)
    );
    skyU.sunPosition!.value.copy(sunPos);

    const pmrem = new THREE.PMREMGenerator(renderer);
    const envScene = new RoomEnvironment();
    scene.environment = pmrem.fromScene(envScene, 0.04).texture;
    scene.environmentIntensity = 0.5;

    const camera = new THREE.PerspectiveCamera(70, w / h, 0.5, 5000);
    camera.position.set(60, 35, 80);
    camera.lookAt(0, 5, 0);

    const hemi = new THREE.HemisphereLight(0xbcd6ee, 0x6a5b48, 0.55);
    scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xfff1d4, 2.4);
    sun.position.copy(sunPos).multiplyScalar(800);
    scene.add(sun);
    // Soft fill from opposite side — fakes bounced light without shadow cost
    const fill = new THREE.DirectionalLight(0x9ec3ff, 0.6);
    fill.position.set(-sunPos.x, sunPos.y * 0.5, -sunPos.z).multiplyScalar(600);
    scene.add(fill);
    const ambient = new THREE.AmbientLight(0xffffff, 0.18);
    scene.add(ambient);

    const STAR_COUNT = 1500;
    const starPos = new Float32Array(STAR_COUNT * 3);
    for (let i = 0; i < STAR_COUNT; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(Math.random() * 0.95);
      const r = 1800;
      starPos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      starPos[i * 3 + 1] = r * Math.cos(phi);
      starPos[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute("position", new THREE.BufferAttribute(starPos, 3));
    const starMat = new THREE.PointsMaterial({
      color: 0xffffff, size: 1.6, sizeAttenuation: false,
      transparent: true, opacity: 0, depthWrite: false, fog: false,
    });
    const stars = new THREE.Points(starGeo, starMat);
    stars.frustumCulled = false;
    scene.add(stars);

    const moonGeo = new THREE.SphereGeometry(50, 16, 12);
    const moonMat = new THREE.MeshBasicMaterial({
      color: 0xfff7d8, transparent: true, opacity: 0,
      fog: false, depthWrite: false,
    });
    const moon = new THREE.Mesh(moonGeo, moonMat);
    moon.frustumCulled = false;
    scene.add(moon);

    const cloudGeo = new THREE.IcosahedronGeometry(8, 0);
    const cloudMat = new THREE.MeshStandardMaterial({
      color: 0xffffff, roughness: 1, flatShading: true,
      transparent: true, opacity: 0.92,
    });
    const CLOUD_COUNT = 220;
    const clouds = new THREE.InstancedMesh(cloudGeo, cloudMat, CLOUD_COUNT);
    clouds.frustumCulled = false;
    scene.add(clouds);
    interface CloudData { pos: THREE.Vector3; scale: THREE.Vector3; speed: number; }
    const cloudData: CloudData[] = [];
    const cloudSpread = 1500;
    for (let i = 0; i < CLOUD_COUNT; i++) {
      cloudData.push({
        pos: new THREE.Vector3(
          (Math.random() - 0.5) * cloudSpread * 2,
          180 + Math.random() * 100,
          (Math.random() - 0.5) * cloudSpread * 2
        ),
        scale: new THREE.Vector3(
          1.5 + Math.random() * 3.5,
          0.6 + Math.random() * 1.2,
          1.5 + Math.random() * 3.5
        ),
        speed: 1.5 + Math.random() * 2.5,
      });
    }

    interface Car {
      pos: THREE.Vector3;
      axis: 0 | 1;
      sign: 1 | -1;
      speed: number;
    }
    const carData: Car[] = [];
    const carInstancedMeshes: THREE.InstancedMesh[] = [];

    interface Ped {
      pos: THREE.Vector3;
      axis: 0 | 1;
      sign: 1 | -1;
      speed: number;
      object: THREE.Object3D;
      mixer: THREE.AnimationMixer;
    }
    const pedList: Ped[] = [];

    let roadGrid: OccGrid | null = null;
    let walkGrid: OccGrid | null = null;
    let tileSizeX = 1;
    let tileSizeZ = 1;
    let groundY = 0;
    let pedGroundY = 0;
    let pedFeetOffset = 0;
    let playerAvatar: THREE.Object3D | null = null;
    let playerMixer: THREE.AnimationMixer | null = null;
    let playerIdleAction: THREE.AnimationAction | null = null;
    let playerWalkAction: THREE.AnimationAction | null = null;
    let playerRunAction: THREE.AnimationAction | null = null;
    let playerTPoseAction: THREE.AnimationAction | null = null;
    let playerEyeHeight = 1.65;
    const up = new THREE.Vector3(0, 1, 0);
    const emissiveMats: THREE.MeshStandardMaterial[] = [];

    const carSpread = 900;
    const pedSpread = 500;

    const isRoadW = (wx: number, wz: number) =>
      roadGrid ? isOccAtWorld(roadGrid, tileSizeX, tileSizeZ, wx, wz) : false;
    const isWalkW = (wx: number, wz: number) =>
      walkGrid ? isOccAtWorld(walkGrid, tileSizeX, tileSizeZ, wx, wz) : false;

    const roadCellList: Array<[number, number]> = [];
    const walkCellList: Array<[number, number]> = [];
    const buildCellList = (g: OccGrid, out: Array<[number, number]>) => {
      out.length = 0;
      for (let z = 0; z < g.rows; z++) {
        for (let x = 0; x < g.cols; x++) {
          if (g.cells[z * g.cols + x] === 1) out.push([x, z]);
        }
      }
    };

    const sampleSpawn = (
      grid: OccGrid | null,
      cells: Array<[number, number]>,
      near: THREE.Vector3,
      spread: number
    ): { pos: THREE.Vector3; axis: 0 | 1; sign: 1 | -1 } | null => {
      if (!grid || cells.length === 0) return null;
      const camTileX = Math.floor((near.x + tileSizeX / 2) / tileSizeX);
      const camTileZ = Math.floor((near.z + tileSizeZ / 2) / tileSizeZ);
      for (let attempt = 0; attempt < 30; attempt++) {
        const dxT = Math.round((Math.random() - 0.5) * 2 * (spread / tileSizeX));
        const dzT = Math.round((Math.random() - 0.5) * 2 * (spread / tileSizeZ));
        const tileCx = camTileX + dxT;
        const tileCz = camTileZ + dzT;
        const flip = rotForCell(tileCx, tileCz);
        const cell = cells[Math.floor(Math.random() * cells.length)]!;
        const lx = grid.originX + cell[0] * grid.cellSize + grid.cellSize / 2;
        const lz = grid.originZ + cell[1] * grid.cellSize + grid.cellSize / 2;
        const fx = flip ? -lx : lx;
        const fz = flip ? -lz : lz;
        const wx = tileCx * tileSizeX + fx;
        const wz = tileCz * tileSizeZ + fz;
        if (Math.hypot(wx - near.x, wz - near.z) > spread) continue;
        const axis = (Math.random() < 0.5 ? 0 : 1) as 0 | 1;
        const sign = (Math.random() < 0.5 ? 1 : -1) as 1 | -1;
        return { pos: new THREE.Vector3(wx, 0, wz), axis, sign };
      }
      return null;
    };

    const carInit = (i: number) => {
      const s = sampleSpawn(roadGrid, roadCellList, camera.position, carSpread);
      if (!s) {
        carData[i] = {
          pos: new THREE.Vector3(camera.position.x + 20, 0, camera.position.z),
          axis: 0, sign: 1,
          speed: 16,
        };
        return;
      }
      carData[i] = { ...s, speed: 14 + Math.random() * 12 };
    };

    const pickPedLaneState = () => {
      const useWalk = walkCellList.length > 0;
      const g = useWalk ? walkGrid : roadGrid;
      const cells = useWalk ? walkCellList : roadCellList;
      const s = sampleSpawn(g, cells, camera.position, pedSpread);
      if (!s) {
        return {
          pos: new THREE.Vector3(camera.position.x + 5, 0, camera.position.z + 5),
          axis: 0 as 0 | 1, sign: 1 as 1 | -1,
          speed: 1.4,
        };
      }
      return { ...s, speed: 1.2 + Math.random() * 0.6 };
    };

    const RAIN_COUNT = 3500;
    const rainGeo = new THREE.BoxGeometry(0.06, 1.4, 0.06);
    const rainMat = new THREE.MeshBasicMaterial({
      color: 0xaad0e8, transparent: true, opacity: 0.55, fog: false,
    });
    const rain = new THREE.InstancedMesh(rainGeo, rainMat, RAIN_COUNT);
    rain.frustumCulled = false;
    rain.visible = false;
    scene.add(rain);
    const rainRange = 200;
    const rainTop = 220;
    const rainData: Array<{ pos: THREE.Vector3; speed: number }> = [];
    for (let i = 0; i < RAIN_COUNT; i++) {
      rainData.push({
        pos: new THREE.Vector3(
          (Math.random() - 0.5) * rainRange * 2,
          Math.random() * rainTop,
          (Math.random() - 0.5) * rainRange * 2
        ),
        speed: 75 + Math.random() * 40,
      });
    }

    const SNOW_COUNT = 2800;
    const snowGeo = new THREE.SphereGeometry(0.18, 5, 4);
    const snowMat = new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0.9, fog: false,
    });
    const snow = new THREE.InstancedMesh(snowGeo, snowMat, SNOW_COUNT);
    snow.frustumCulled = false;
    snow.visible = false;
    scene.add(snow);
    const snowRange = 180;
    const snowTop = 200;
    interface SnowFlake { pos: THREE.Vector3; vy: number; sway: number; phase: number; }
    const snowData: SnowFlake[] = [];
    for (let i = 0; i < SNOW_COUNT; i++) {
      snowData.push({
        pos: new THREE.Vector3(
          (Math.random() - 0.5) * snowRange * 2,
          Math.random() * snowTop,
          (Math.random() - 0.5) * snowRange * 2
        ),
        vy: 2.2 + Math.random() * 1.6,
        sway: 0.4 + Math.random() * 0.6,
        phase: Math.random() * Math.PI * 2,
      });
    }

    interface TileMesh {
      instanced: THREE.InstancedMesh;
      base: THREE.Vector3;
    }
    const tileMeshes: TileMesh[] = [];

    const _cm = new THREE.Matrix4();
    const _cs = new THREE.Vector3();
    const _cq = new THREE.Quaternion();
    const _cp = new THREE.Vector3();

    const dracoLoader = new DRACOLoader();
    dracoLoader.setDecoderPath("https://www.gstatic.com/draco/v1/decoders/");
    dracoLoader.setDecoderConfig({ type: "js" });
    const loader = new GLTFLoader();
    loader.setDRACOLoader(dracoLoader);

    // Github Pages can't serve files stored via git-lfs (returns the pointer
    // text). In production, fetch realistic.glb through jsDelivr which resolves
    // LFS objects on github repos.
    const isLocal = typeof location !== "undefined" &&
      (location.hostname === "localhost" || location.hostname === "127.0.0.1");
    const realisticUrl = isLocal
      ? "realistic.glb"
      : "https://cdn.jsdelivr.net/gh/Gaurav-Gosain/city@main/src/assets/realistic.glb";

    let cancelled = false;
    loader.load(
      realisticUrl,
      async (gltf) => {
        if (cancelled) return;
        setLoadProgress(1);

        const root = gltf.scene;
        root.updateMatrixWorld(true);

        const meshes: THREE.Mesh[] = [];
        root.traverse((o) => {
          const m = o as THREE.Mesh;
          if (m.isMesh) meshes.push(m);
        });

        const sceneBox = new THREE.Box3().setFromObject(root);
        const sceneCenter = new THREE.Vector3();
        sceneBox.getCenter(sceneCenter);
        tileSizeX = sceneBox.max.x - sceneBox.min.x;
        tileSizeZ = sceneBox.max.z - sceneBox.min.z;

        // Detect ground level via a flat low-vert mesh whose bbox top hugs y≈0
        let bestTerrain: THREE.Mesh | null = null;
        let bestTerrainY = Infinity;
        for (const m of meshes) {
          const bb = new THREE.Box3().setFromObject(m);
          const sy = bb.max.y - bb.min.y;
          if (sy < 0.5 && bb.max.y >= -0.5 && bb.max.y < bestTerrainY) {
            const sx = bb.max.x - bb.min.x;
            const sz = bb.max.z - bb.min.z;
            if (sx > tileSizeX * 0.4 && sz > tileSizeZ * 0.4) {
              bestTerrain = m;
              bestTerrainY = bb.max.y;
            }
          }
        }
        if (bestTerrain) {
          const tBox = new THREE.Box3().setFromObject(bestTerrain);
          groundY = tBox.max.y;
        } else {
          groundY = sceneBox.min.y;
        }
        pedGroundY = groundY;

        // Detect road mesh by material name (lanes_secondary_color = yellow centerlines)
        const matName = (m: THREE.Mesh) => {
          const mat = m.material as THREE.Material | THREE.Material[];
          if (Array.isArray(mat)) return mat.map((x) => x?.name ?? "").join("|");
          return mat?.name ?? "";
        };
        const streetSurface = meshes.find((m) => /CityGen_Streets|^Streets$/i.test(matName(m)));
        const lanesWhite = meshes.find((m) => /lanes_white/i.test(matName(m)));
        const sidewalks = meshes.find((m) => /side\s*walks?/i.test(matName(m)));
        // Rasterize streets (asphalt) and sidewalks separately. Then road = streets ∧ ¬sidewalks
        // so cars never spawn or drive on the footpath. Erode sidewalks by 1 cell so peds stay
        // a margin away from edges.
        const streetSrc = streetSurface ?? lanesWhite;
        const streetGrid = streetSrc
          ? rasterizeMesh(streetSrc, tileSizeX, tileSizeZ, sceneCenter)
          : null;
        const swGrid = sidewalks
          ? rasterizeMesh(sidewalks, tileSizeX, tileSizeZ, sceneCenter)
          : null;
        if (streetGrid) {
          roadGrid = gridSubtract(streetGrid, swGrid);
          buildCellList(roadGrid, roadCellList);
        }
        if (swGrid) {
          walkGrid = gridErode(swGrid);
          buildCellList(walkGrid, walkCellList);
        }
        // Peds + player walk on sidewalks. Use the sidewalk top y so feet land on the
        // raised footpath surface, not the asphalt below.
        if (sidewalks) {
          const swBox = new THREE.Box3().setFromObject(sidewalks);
          if (isFinite(swBox.max.y)) pedGroundY = swBox.max.y;
        }

        // Pick a spawn over a road near tile center so initial view isn't inside a building.
        // Look down the longer tile axis (the main avenue).
        if (roadCellList.length > 0 && roadGrid) {
          let bestCell = roadCellList[0]!;
          let bestD = Infinity;
          for (const c of roadCellList) {
            const lx = roadGrid.originX + c[0]! * roadGrid.cellSize;
            const lz = roadGrid.originZ + c[1]! * roadGrid.cellSize;
            const d = lx * lx + lz * lz;
            if (d < bestD) { bestD = d; bestCell = c; }
          }
          const spawnX = roadGrid.originX + bestCell[0]! * roadGrid.cellSize;
          const spawnZ = roadGrid.originZ + bestCell[1]! * roadGrid.cellSize;
          camera.position.set(spawnX, 28, spawnZ);
          yaw = tileSizeX >= tileSizeZ ? -Math.PI / 2 : Math.PI;
          pitch = -0.08;
        }

        const maxAniso = renderer.capabilities.getMaxAnisotropy
          ? Math.min(4, renderer.capabilities.getMaxAnisotropy())
          : 1;
        const limitTexture = (mm: THREE.Material) => {
          const any = mm as any;
          if ("envMapIntensity" in any) any.envMapIntensity = 0.85;
          for (const key of [
            "map", "normalMap", "roughnessMap", "metalnessMap",
            "emissiveMap", "aoMap", "alphaMap",
          ]) {
            const t = any[key] as THREE.Texture | undefined;
            if (t && t.anisotropy !== undefined) t.anisotropy = maxAniso;
          }
          // Render double-sided so single-sided wall geometry doesn't show as see-through
          // when viewed from a direction the artist didn't expect.
          any.side = THREE.DoubleSide;
          // Force opaque unless an explicit alpha map is set (windows with cutouts).
          // Buildings often ship with transparent=true but no alpha source, which leaks the
          // background through walls.
          if (any.transparent && !any.alphaMap && !any.alphaTest) {
            any.transparent = false;
            any.opacity = 1;
            any.depthWrite = true;
          }
          // If material has an emissiveMap, force emissive=white so windows
          // glow at night (we modulate emissiveIntensity per frame).
          if (any.emissiveMap && any.emissive) {
            any.emissive.setRGB(1, 1, 1);
            any.emissiveIntensity = 0;
            emissiveMats.push(any);
          }
        };

        const N = (TILE_RADIUS * 2 + 1) * (TILE_RADIUS * 2 + 1);
        for (const m of meshes) {
          const mname = matName(m);
          if (SKIP_PATTERNS.some((re) => re.test(mname))) continue;

          const geo = m.geometry.clone();
          geo.applyMatrix4(m.matrixWorld);
          geo.translate(-sceneCenter.x, 0, -sceneCenter.z);

          const mat = m.material as THREE.Material | THREE.Material[];
          if (Array.isArray(mat)) mat.forEach(limitTexture);
          else if (mat) limitTexture(mat);

          const inst = new THREE.InstancedMesh(geo, mat as any, N);
          inst.frustumCulled = false;
          let i = 0;
          for (let dx = -TILE_RADIUS; dx <= TILE_RADIUS; dx++) {
            for (let dz = -TILE_RADIUS; dz <= TILE_RADIUS; dz++) {
              const flip = rotForCell(dx, dz);
              _cp.set(dx * tileSizeX, 0, dz * tileSizeZ);
              _cq.setFromAxisAngle(up, flip ? Math.PI : 0);
              _cs.set(1, 1, 1);
              _cm.compose(_cp, _cq, _cs);
              inst.setMatrixAt(i++, _cm);
            }
          }
          inst.instanceMatrix.needsUpdate = true;
          scene.add(inst);
          tileMeshes.push({ instanced: inst, base: new THREE.Vector3() });
        }

        // Soldier (cars currently disabled)
        try {
          const pedLoader = new GLTFLoader();
          pedLoader.setDRACOLoader(dracoLoader);
          const soldierGltf = await pedLoader.loadAsync("soldier.glb");

          // Compute foot-to-origin offset so feet sit on ground plane (not sunk in).
          soldierGltf.scene.updateMatrixWorld(true);
          const sBox = new THREE.Box3().setFromObject(soldierGltf.scene);
          pedFeetOffset = -sBox.min.y;
          playerEyeHeight = (sBox.max.y - sBox.min.y) - 0.15;

          const findClip = (name: string) =>
            soldierGltf.animations.find((a) => a.name === name);
          const idleClip = findClip("Idle");
          const walkClip = findClip("Walk") ?? soldierGltf.animations[0];
          const runClip = findClip("Run");
          const tposeClip = findClip("TPose");

          // Player avatar (separate clone). Used for ground TPP/FPP and fly TPP.
          playerAvatar = SkeletonUtils.clone(soldierGltf.scene);
          playerAvatar.rotation.order = "YXZ";
          playerAvatar.traverse((c: THREE.Object3D) => {
            const sm = c as THREE.SkinnedMesh;
            if (sm.isSkinnedMesh) {
              sm.frustumCulled = false;
              sm.castShadow = false;
            }
          });
          scene.add(playerAvatar);
          playerMixer = new THREE.AnimationMixer(playerAvatar);
          const setupAction = (clip: THREE.AnimationClip | undefined) => {
            if (!clip || !playerMixer) return null;
            const a = playerMixer.clipAction(clip);
            a.play();
            a.weight = 0;
            return a;
          };
          playerIdleAction = setupAction(idleClip);
          playerWalkAction = setupAction(walkClip);
          playerRunAction = setupAction(runClip);
          playerTPoseAction = setupAction(tposeClip);
          playerAvatar.visible = false;

          for (let i = 0; i < PED_COUNT; i++) {
            const clone = SkeletonUtils.clone(soldierGltf.scene);
            clone.scale.setScalar(1.0);
            clone.traverse((c: THREE.Object3D) => {
              const sm = c as THREE.SkinnedMesh;
              if (sm.isSkinnedMesh) {
                sm.frustumCulled = true;
                if (sm.geometry.boundingSphere) {
                  sm.geometry.boundingSphere.radius = 2.5;
                }
              } else if ((sm as any).isMesh) {
                (sm as any).frustumCulled = true;
              }
            });
            scene.add(clone);
            const mixer = new THREE.AnimationMixer(clone);
            // 25% of peds run, rest walk. Idle peds occasionally? skip — keep it simple.
            const isRunner = Math.random() < 0.25;
            const clip = (isRunner && runClip) ? runClip : walkClip;
            if (clip) {
              const action = mixer.clipAction(clip);
              action.timeScale = 1.0 + Math.random() * 0.25;
              action.time = Math.random() * clip.duration;
              action.play();
            }
            const s = pickPedLaneState();
            // Override speed to match anim style
            s.speed = isRunner ? 3.4 + Math.random() * 1.0 : 1.2 + Math.random() * 0.6;
            pedList.push({ ...s, object: clone, mixer });
          }
        } catch (e) {
          console.warn("soldier load failed", e);
        }

        try {
          const r = renderer as any;
          if (r.compileAsync) await r.compileAsync(scene, camera);
          else renderer.compile(scene, camera);
          renderer.render(scene, camera);
        } catch {}
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
        );
        setLoading(false);
      },
      (xhr) => { if (xhr.total > 0) setLoadProgress(xhr.loaded / xhr.total); },
      (err) => {
        console.warn("realistic GLB load failed", err);
        setLoading(false);
      }
    );

    // Controls
    const keys: Record<string, boolean> = {};
    let yaw = -Math.PI * 0.25;
    let pitch = -0.15;
    let avatarRoll = 0;
    let avatarYawPrev = yaw;
    const trackedKeys = new Set([
      "KeyW", "KeyA", "KeyS", "KeyD", "KeyC", "KeyQ", "KeyE", "KeyV", "KeyG",
      "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight",
      "Space", "ShiftLeft", "ShiftRight", "ControlLeft", "AltLeft",
    ]);
    const onKey = (e: KeyboardEvent, down: boolean) => {
      keys[e.code] = down;
      if (trackedKeys.has(e.code)) e.preventDefault();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      onKey(e, true);
      if (e.code === "KeyV") {
        const next = !tppRef.current;
        tppRef.current = next;
        setTpp(next);
      }
      if (e.code === "KeyG" && playerAvatar) {
        if (groundedRef.current) {
          groundedRef.current = false;
          setGrounded(false);
          playerAvatar.visible = false;
          camera.position.set(
            playerAvatar.position.x,
            pedGroundY + playerEyeHeight + 6,
            playerAvatar.position.z
          );
        } else {
          playerAvatar.position.set(camera.position.x, pedGroundY + pedFeetOffset, camera.position.z);
          playerAvatar.rotation.set(0, yaw, 0);
          groundedRef.current = true;
          setGrounded(true);
        }
      }
    };
    const onKeyUp = (e: KeyboardEvent) => onKey(e, false);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);

    let pointerLocked = false;
    const onPointerLockChange = () => {
      pointerLocked = document.pointerLockElement === renderer.domElement;
    };
    document.addEventListener("pointerlockchange", onPointerLockChange);
    const onClick = () => {
      if (!pointerLocked) renderer.domElement.requestPointerLock();
    };
    renderer.domElement.addEventListener("click", onClick);

    let calibSum = 0;
    let calibCount = 0;
    let mouseScale = 0.6;
    const TARGET_AVG = 3;
    const onMouseMove = (e: MouseEvent) => {
      if (!pointerLocked) return;
      const m = Math.hypot(e.movementX, e.movementY);
      if (calibCount < 60 && m > 0.5 && m < 250) {
        calibSum += m;
        calibCount++;
        if (calibCount === 60) {
          mouseScale = TARGET_AVG / Math.max(0.5, calibSum / 60);
        }
      }
      const s = 0.012 * (sensitivityRef.current ?? 1) * mouseScale;
      yaw -= e.movementX * s;
      pitch -= e.movementY * s;
      pitch = Math.max(-Math.PI / 2 + 0.05, Math.min(Math.PI / 2 - 0.05, pitch));
    };
    document.addEventListener("mousemove", onMouseMove);

    const onResize = () => {
      const W = window.innerWidth;
      const H = window.innerHeight;
      renderer.setSize(W, H);
      camera.aspect = W / H;
      camera.updateProjectionMatrix();
    };
    window.addEventListener("resize", onResize);

    const moveStick = { x: 0, y: 0 };
    const lookStick = { x: 0, y: 0 };
    const joyCleanup: Array<() => void> = [];
    const initJoystick = (zone: HTMLDivElement | null, out: { x: number; y: number }) => {
      if (!zone) return;
      const handle = document.createElement("div");
      Object.assign(handle.style, {
        position: "absolute", left: "50%", top: "50%",
        width: "60px", height: "60px",
        marginLeft: "-30px", marginTop: "-30px",
        borderRadius: "50%",
        background: "rgba(255,255,255,0.85)",
        boxShadow: "0 2px 8px rgba(0,0,0,0.4)",
        pointerEvents: "none",
        transition: "transform 0.05s linear",
        willChange: "transform",
      });
      const ring = document.createElement("div");
      Object.assign(ring.style, {
        position: "absolute", left: "50%", top: "50%",
        width: "120px", height: "120px",
        marginLeft: "-60px", marginTop: "-60px",
        borderRadius: "50%",
        border: "2px solid rgba(255,255,255,0.55)",
        pointerEvents: "none",
      });
      zone.appendChild(ring);
      zone.appendChild(handle);
      let pid: number | null = null;
      const maxR = 50;
      const setVec = (cx: number, cy: number, x: number, y: number) => {
        let dx = x - cx;
        let dy = y - cy;
        const r = Math.hypot(dx, dy);
        if (r > maxR) { dx = dx / r * maxR; dy = dy / r * maxR; }
        handle.style.transform = `translate(${dx}px, ${dy}px)`;
        out.x = dx / maxR;
        out.y = -dy / maxR;
      };
      const reset = () => {
        handle.style.transform = "translate(0, 0)";
        out.x = 0;
        out.y = 0;
      };
      const onDown = (e: PointerEvent) => {
        if (pid !== null) return;
        pid = e.pointerId;
        zone.setPointerCapture(e.pointerId);
        const r = zone.getBoundingClientRect();
        setVec(r.left + r.width / 2, r.top + r.height / 2, e.clientX, e.clientY);
        e.preventDefault();
      };
      const onMove = (e: PointerEvent) => {
        if (e.pointerId !== pid) return;
        const r = zone.getBoundingClientRect();
        setVec(r.left + r.width / 2, r.top + r.height / 2, e.clientX, e.clientY);
      };
      const onUp = (e: PointerEvent) => {
        if (e.pointerId !== pid) return;
        pid = null;
        try { zone.releasePointerCapture(e.pointerId); } catch {}
        reset();
      };
      zone.addEventListener("pointerdown", onDown);
      zone.addEventListener("pointermove", onMove);
      zone.addEventListener("pointerup", onUp);
      zone.addEventListener("pointercancel", onUp);
      zone.addEventListener("pointerleave", onUp);
      joyCleanup.push(() => {
        zone.removeEventListener("pointerdown", onDown);
        zone.removeEventListener("pointermove", onMove);
        zone.removeEventListener("pointerup", onUp);
        zone.removeEventListener("pointercancel", onUp);
        zone.removeEventListener("pointerleave", onUp);
        zone.removeChild(ring);
        zone.removeChild(handle);
      });
    };
    initJoystick(joyLeftRef.current, moveStick);
    initJoystick(joyRightRef.current, lookStick);

    // Heading lookup. Ferrari + Soldier both face -Z forward in their source GLBs.
    // To make geometry's -Z point along world axis dir:
    //   want forward = (sx, 0, sz). atan2(sx, sz) gives the rotation around Y that
    //   maps (0,0,1) to (sx,0,sz). Geometry forward is (0,0,-1), so we rotate by
    //   atan2(sx, sz) + π. Equivalent: atan2(-sx, -sz).
    const headingFor = (axis: 0 | 1, sign: 1 | -1) => {
      const fx = axis === 0 ? sign : 0;
      const fz = axis === 1 ? sign : 0;
      return Math.atan2(-fx, -fz);
    };

    let last = performance.now();
    let lastTimeSync = 0;
    let raf = 0;
    const look = new THREE.Vector3();

    const tick = () => {
      const now = performance.now();
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;

      const dzL = 0.12;
      const lAbsX = Math.abs(lookStick.x);
      const lAbsY = Math.abs(lookStick.y);
      if (lAbsX > dzL || lAbsY > dzL) {
        const lx = lAbsX > dzL ? Math.sign(lookStick.x) * Math.pow((lAbsX - dzL) / (1 - dzL), 1.7) : 0;
        const ly = lAbsY > dzL ? Math.sign(lookStick.y) * Math.pow((lAbsY - dzL) / (1 - dzL), 1.7) : 0;
        yaw -= lx * 2.6 * dt;
        pitch += ly * 1.8 * dt;
        pitch = Math.max(-Math.PI / 2 + 0.05, Math.min(Math.PI / 2 - 0.05, pitch));
      }

      let playerMoving = false;
      const cy = Math.cos(yaw), sy = Math.sin(yaw);
      const cp = Math.cos(pitch), sp = Math.sin(pitch);
      look.set(-sy * cp, sp, -cy * cp);

      const sprintHeld = keys["ShiftLeft"] || keys["ShiftRight"];
      const flatLook = new THREE.Vector3(look.x, 0, look.z).normalize();
      const flatRight = new THREE.Vector3().crossVectors(flatLook, up).normalize();
      const dz = 0.14;
      const mAbsX = Math.abs(moveStick.x);
      const mAbsY = Math.abs(moveStick.y);
      const mvStickX = mAbsX > dz ? Math.sign(moveStick.x) * (mAbsX - dz) / (1 - dz) : 0;
      const mvStickY = mAbsY > dz ? Math.sign(moveStick.y) * (mAbsY - dz) / (1 - dz) : 0;

      // Auto-enter grounded mode when descending into ground in fly mode
      if (!groundedRef.current && playerAvatar &&
          camera.position.y <= pedGroundY + playerEyeHeight + 0.05) {
        playerAvatar.position.set(camera.position.x, pedGroundY + pedFeetOffset, camera.position.z);
        playerAvatar.rotation.set(0, Math.atan2(-flatLook.x, -flatLook.z), 0);
        groundedRef.current = true;
        setGrounded(true);
      }

      if (groundedRef.current && playerAvatar) {
        // Jump back to fly mode
        if (keys["Space"] || keys["KeyE"] || climbUpRef.current) {
          groundedRef.current = false;
          setGrounded(false);
          playerAvatar.visible = false;
          camera.position.set(
            playerAvatar.position.x,
            pedGroundY + playerEyeHeight + 4,
            playerAvatar.position.z
          );
        } else {
          const walkMv = new THREE.Vector3();
          if (keys["KeyW"] || keys["ArrowUp"]) walkMv.add(flatLook);
          if (keys["KeyS"] || keys["ArrowDown"]) walkMv.sub(flatLook);
          if (keys["KeyD"] || keys["ArrowRight"]) walkMv.add(flatRight);
          if (keys["KeyA"] || keys["ArrowLeft"]) walkMv.sub(flatRight);
          walkMv.addScaledVector(flatLook, mvStickY);
          walkMv.addScaledVector(flatRight, mvStickX);
          const moving = walkMv.lengthSq() > 0;
          playerMoving = moving;
          if (moving) {
            walkMv.normalize();
            const walkSpeed = sprintHeld ? 6.5 : 2.6;
            playerAvatar.rotation.x = 0;
            playerAvatar.rotation.z = 0;
            playerAvatar.position.x += walkMv.x * walkSpeed * dt;
            playerAvatar.position.z += walkMv.z * walkSpeed * dt;
            playerAvatar.rotation.y = Math.atan2(-walkMv.x, -walkMv.z);
          }
          playerAvatar.position.y = pedGroundY + pedFeetOffset;
          // Anim state machine handled centrally below (after the fly/ground branch)

          if (tppRef.current) {
            playerAvatar.visible = true;
            const back = 4.5;
            const heightOff = 2.2;
            camera.position.set(
              playerAvatar.position.x - flatLook.x * back,
              playerAvatar.position.y + heightOff - sp * 1.5,
              playerAvatar.position.z - flatLook.z * back
            );
          } else {
            playerAvatar.visible = false;
            camera.position.set(
              playerAvatar.position.x,
              pedGroundY + playerEyeHeight,
              playerAvatar.position.z
            );
          }
        }
      } else {
        const speed = (sprintHeld ? 90 : 28) * (keys["AltLeft"] ? 0.25 : 1);
        const mv = new THREE.Vector3();
        // Forward follows full look vector — pitch up = climb, pitch down = dive
        const flyFwd = look.clone().normalize();
        if (keys["KeyW"] || keys["ArrowUp"]) mv.add(flyFwd);
        if (keys["KeyS"] || keys["ArrowDown"]) mv.sub(flyFwd);
        if (keys["KeyD"] || keys["ArrowRight"]) mv.add(flatRight);
        if (keys["KeyA"] || keys["ArrowLeft"]) mv.sub(flatRight);
        if (keys["Space"] || keys["KeyE"] || climbUpRef.current) mv.y += 1;
        if (keys["KeyC"] || keys["KeyQ"] || keys["ControlLeft"] || climbDownRef.current) mv.y -= 1;
        mv.addScaledVector(flyFwd, mvStickY);
        mv.addScaledVector(flatRight, mvStickX);
        if (mv.lengthSq() > 0) {
          mv.normalize().multiplyScalar(speed * dt);
          camera.position.add(mv);
        }
        if (camera.position.y < 1) camera.position.y = 1;
        // Fly TPP: dynamic orientation
        // - body forward (head) follows look direction (yaw + pitch)
        // - banks with A/D strafe + mouse-yaw turn rate
        if (tppRef.current && playerAvatar) {
          playerAvatar.visible = true;

          const strafe =
            ((keys["KeyD"] || keys["ArrowRight"]) ? 1 : 0) -
            ((keys["KeyA"] || keys["ArrowLeft"]) ? 1 : 0) +
            mvStickX;
          const yawDelta = yaw - avatarYawPrev;
          avatarYawPrev = yaw;
          const turnRoll = -yawDelta * 8;
          const targetRoll = Math.max(-1.2, Math.min(1.2, strafe * 0.6 + turnRoll));
          avatarRoll = THREE.MathUtils.lerp(avatarRoll, targetRoll, Math.min(1, dt * 6));

          // Position avatar in camera's local frame so it stays in view regardless
          // of pitch (fixes character disappearing below frame when looking up).
          const ahead = 4.5;
          const drop = 1.2;
          const camRight = new THREE.Vector3().crossVectors(look, up);
          if (camRight.lengthSq() < 1e-4) camRight.set(1, 0, 0);
          else camRight.normalize();
          const camUp = new THREE.Vector3().crossVectors(camRight, look).normalize();
          playerAvatar.position.set(
            camera.position.x + look.x * ahead - camUp.x * drop,
            camera.position.y + look.y * ahead - camUp.y * drop,
            camera.position.z + look.z * ahead - camUp.z * drop
          );

          // Build orthonormal basis: local +Y = head along fwd direction
          const fwdV = look.clone();
          fwdV.y += 0.05; // slight head-up baseline (Iron Man pose)
          fwdV.normalize();
          const wUp = up;
          const lx = new THREE.Vector3().crossVectors(fwdV, wUp);
          if (lx.lengthSq() < 1e-4) lx.set(1, 0, 0);
          else lx.normalize();
          const lz = new THREE.Vector3().crossVectors(lx, fwdV).normalize();
          // Bank: rotate localX/localZ around fwd by avatarRoll
          const rollQ = new THREE.Quaternion().setFromAxisAngle(fwdV, avatarRoll);
          lx.applyQuaternion(rollQ);
          lz.applyQuaternion(rollQ);
          const basis = new THREE.Matrix4().makeBasis(lx, fwdV, lz);
          playerAvatar.quaternion.setFromRotationMatrix(basis);
        } else {
          // Reset banking when leaving fly TPP so it doesn't snap on re-entry
          avatarRoll *= Math.max(0, 1 - dt * 6);
          avatarYawPrev = yaw;
          if (playerAvatar) playerAvatar.visible = false;
        }
      }

      camera.lookAt(camera.position.clone().add(look));

      // Player animation state machine: blend between Idle / Walk / Run / TPose
      if (playerMixer) {
        const flyTpp = !groundedRef.current && tppRef.current;
        const tIdle = groundedRef.current && !playerMoving ? 1 : 0;
        const tWalk = groundedRef.current && playerMoving && !sprintHeld ? 1 : 0;
        const tRun = groundedRef.current && playerMoving && sprintHeld ? 1 : 0;
        const tTPose = flyTpp ? 1 : 0;
        const fade = Math.min(1, dt * 10);
        const lerp = THREE.MathUtils.lerp;
        if (playerIdleAction) playerIdleAction.weight = lerp(playerIdleAction.weight, tIdle, fade);
        if (playerWalkAction) playerWalkAction.weight = lerp(playerWalkAction.weight, tWalk, fade);
        if (playerRunAction) playerRunAction.weight = lerp(playerRunAction.weight, tRun, fade);
        if (playerTPoseAction) playerTPoseAction.weight = lerp(playerTPoseAction.weight, tTPose, fade);
        playerMixer.update(dt);
      }

      const camX = camera.position.x;
      const camZ = camera.position.z;
      for (let i = 0; i < CLOUD_COUNT; i++) {
        const cd = cloudData[i]!;
        cd.pos.x += cd.speed * dt;
        const dxc = cd.pos.x - camX;
        const dzc = cd.pos.z - camZ;
        if (dxc > cloudSpread) cd.pos.x -= cloudSpread * 2;
        else if (dxc < -cloudSpread) cd.pos.x += cloudSpread * 2;
        if (dzc > cloudSpread) cd.pos.z -= cloudSpread * 2;
        else if (dzc < -cloudSpread) cd.pos.z += cloudSpread * 2;
        _cs.copy(cd.scale);
        _cm.compose(cd.pos, _cq, _cs);
        clouds.setMatrixAt(i, _cm);
      }
      clouds.instanceMatrix.needsUpdate = true;

      // Cars: cell-march on the road occupancy grid. At each step look 6m ahead;
      // if the next cell is off-road, try perpendicular turn (random side first),
      // else U-turn. Add a small chance to randomly turn at any intersection.
      if (carInstancedMeshes.length > 0 && carData.length === CAR_COUNT && roadGrid) {
        const probe = (px: number, pz: number, ax: 0 | 1, sg: 1 | -1, d: number) =>
          isRoadW(px + (ax === 0 ? sg * d : 0), pz + (ax === 1 ? sg * d : 0));
        for (let i = 0; i < CAR_COUNT; i++) {
          const c = carData[i]!;
          const dxc = c.pos.x - camX;
          const dzc = c.pos.z - camZ;
          if (Math.abs(dxc) > carSpread || Math.abs(dzc) > carSpread) {
            carInit(i);
            const heading0 = headingFor(c.axis, c.sign);
            _cq.setFromAxisAngle(up, heading0);
            _cs.set(1, 1, 1);
            _cp.set(c.pos.x, groundY, c.pos.z);
            _cm.compose(_cp, _cq, _cs);
            for (const im of carInstancedMeshes) im.setMatrixAt(i, _cm);
            continue;
          }

          if (!probe(c.pos.x, c.pos.z, c.axis, c.sign, 6)) {
            const newAxis = (1 - c.axis) as 0 | 1;
            const tryFirst = (Math.random() < 0.5 ? 1 : -1) as 1 | -1;
            if (probe(c.pos.x, c.pos.z, newAxis, tryFirst, 4)) {
              c.axis = newAxis; c.sign = tryFirst;
            } else if (probe(c.pos.x, c.pos.z, newAxis, -tryFirst as 1 | -1, 4)) {
              c.axis = newAxis; c.sign = -tryFirst as 1 | -1;
            } else {
              c.sign = -c.sign as 1 | -1;
            }
          } else if (Math.random() < dt * 0.5) {
            const newAxis = (1 - c.axis) as 0 | 1;
            const trySign = (Math.random() < 0.5 ? 1 : -1) as 1 | -1;
            if (probe(c.pos.x, c.pos.z, newAxis, trySign, 6)) {
              c.axis = newAxis; c.sign = trySign;
            }
          }

          const stepDist = c.speed * dt;
          if (c.axis === 0) c.pos.x += c.sign * stepDist;
          else c.pos.z += c.sign * stepDist;

          const heading = headingFor(c.axis, c.sign);
          _cq.setFromAxisAngle(up, heading);
          _cs.set(1, 1, 1);
          _cp.set(c.pos.x, groundY, c.pos.z);
          _cm.compose(_cp, _cq, _cs);
          for (const im of carInstancedMeshes) im.setMatrixAt(i, _cm);
        }
        for (const im of carInstancedMeshes) im.instanceMatrix.needsUpdate = true;
      }

      // Pedestrians on sidewalk grid (walkGrid). LOD: only animate close peds.
      const pedProbeFn = walkCellList.length > 0 ? isWalkW : isRoadW;
      const animR2 = PED_ANIM_RADIUS * PED_ANIM_RADIUS;
      const PED_AHEAD = 3.5;
      for (const p of pedList) {
        const dxp = p.pos.x - camX;
        const dzp = p.pos.z - camZ;
        const dist2 = dxp * dxp + dzp * dzp;
        if (Math.abs(dxp) > pedSpread || Math.abs(dzp) > pedSpread) {
          const s = pickPedLaneState();
          p.pos.copy(s.pos);
          p.axis = s.axis;
          p.sign = s.sign;
          p.speed = s.speed;
          p.object.position.set(p.pos.x, pedGroundY + pedFeetOffset, p.pos.z);
          continue;
        }
        const aheadX = p.pos.x + (p.axis === 0 ? p.sign * PED_AHEAD : 0);
        const aheadZ = p.pos.z + (p.axis === 1 ? p.sign * PED_AHEAD : 0);
        if (!pedProbeFn(aheadX, aheadZ)) {
          const newAxis = (1 - p.axis) as 0 | 1;
          const tryFirst = (Math.random() < 0.5 ? 1 : -1) as 1 | -1;
          const ax1 = p.pos.x + (newAxis === 0 ? tryFirst * PED_AHEAD : 0);
          const az1 = p.pos.z + (newAxis === 1 ? tryFirst * PED_AHEAD : 0);
          const ax2 = p.pos.x + (newAxis === 0 ? -tryFirst * PED_AHEAD : 0);
          const az2 = p.pos.z + (newAxis === 1 ? -tryFirst * PED_AHEAD : 0);
          if (pedProbeFn(ax1, az1)) {
            p.axis = newAxis; p.sign = tryFirst;
          } else if (pedProbeFn(ax2, az2)) {
            p.axis = newAxis; p.sign = -tryFirst as 1 | -1;
          } else {
            p.sign = -p.sign as 1 | -1;
          }
          // Don't step this frame after a turn — avoids drift into wall corner
          const heading = headingFor(p.axis, p.sign);
          p.object.rotation.y = heading;
          continue;
        }
        const stepDist = p.speed * dt;
        if (p.axis === 0) p.pos.x += p.sign * stepDist;
        else p.pos.z += p.sign * stepDist;
        const heading = headingFor(p.axis, p.sign);
        p.object.position.set(p.pos.x, pedGroundY + pedFeetOffset, p.pos.z);
        p.object.rotation.y = heading;
        if (dist2 < animR2) p.mixer.update(dt);
      }

      if (tileMeshes.length > 0) {
        const cx = Math.floor((camera.position.x + tileSizeX / 2) / tileSizeX);
        const cz = Math.floor((camera.position.z + tileSizeZ / 2) / tileSizeZ);
        for (const tm of tileMeshes) {
          if (tm.base.x !== cx || tm.base.z !== cz) {
            tm.base.set(cx, 0, cz);
            let i = 0;
            for (let dx = -TILE_RADIUS; dx <= TILE_RADIUS; dx++) {
              for (let dz2 = -TILE_RADIUS; dz2 <= TILE_RADIUS; dz2++) {
                const ax = cx + dx;
                const az = cz + dz2;
                const flip = rotForCell(ax, az);
                _cp.set(ax * tileSizeX, 0, az * tileSizeZ);
                _cq.setFromAxisAngle(up, flip ? Math.PI : 0);
                _cs.set(1, 1, 1);
                _cm.compose(_cp, _cq, _cs);
                tm.instanced.setMatrixAt(i++, _cm);
              }
            }
            tm.instanced.instanceMatrix.needsUpdate = true;
          }
        }
      }

      if (autoRef.current) {
        timeRef.current = (timeRef.current + dt * 0.18) % 24;
        if (now - lastTimeSync > 250) {
          setTime(timeRef.current);
          lastTimeSync = now;
        }
      }
      const tHour = timeRef.current;
      const sunAngle = (tHour - 6) * Math.PI / 12;
      const sunX = -Math.cos(sunAngle);
      const sunY = Math.sin(sunAngle);
      const sunZ = 0.25;
      const sunNorm = Math.hypot(sunX, sunY, sunZ);
      const sdx = sunX / sunNorm, sdy = sunY / sunNorm, sdz = sunZ / sunNorm;
      sun.position.set(sdx * 800, sdy * 800, sdz * 800);
      skyU.sunPosition!.value.set(sdx, sdy, sdz);
      const dayLight = Math.max(0, sdy);
      const nightFactor = Math.min(1, Math.max(0, -sdy * 1.4));
      const dawnDusk = Math.max(0, 1 - Math.abs(sdy) * 4);

      sun.intensity = dayLight * 2.8 + 0.05;
      sun.color.setRGB(1.0, 0.94 - dawnDusk * 0.22, 0.85 - dawnDusk * 0.35);
      sun.position.set(sdx * 800, sdy * 800, sdz * 800);
      fill.intensity = dayLight * 0.45;
      fill.position.set(-sdx * 600, Math.max(0.2, sdy * 0.5) * 600, -sdz * 600);
      hemi.intensity = 0.4 + dayLight * 0.55 + nightFactor * 0.12;
      hemi.color.setRGB(0.5 + dayLight * 0.5, 0.62 + dayLight * 0.32, 0.78 + dayLight * 0.2);
      ambient.intensity = 0.14 + dayLight * 0.12 + nightFactor * 0.18;
      ambient.color.setRGB(0.45 + dayLight * 0.55, 0.55 + dayLight * 0.45, 0.7 + dayLight * 0.3);
      scene.environmentIntensity = 0.35 + dayLight * 0.45 + nightFactor * 0.1;
      renderer.toneMappingExposure = 1.0 + nightFactor * 0.55;
      const emI = 0.1 + nightFactor * 1.6;
      for (const mm of emissiveMats) mm.emissiveIntensity = emI;

      skyU.rayleigh!.value = 0.8 + dayLight * 1.0;
      skyU.turbidity!.value = 2 + dayLight * 1.5;
      skyU.mieCoefficient!.value = 0.0025 + dawnDusk * 0.012;
      sky.visible = nightFactor < 0.95;
      if (nightFactor > 0.6) {
        if (!(scene.background as THREE.Color)?.isColor) {
          scene.background = new THREE.Color();
        }
        (scene.background as THREE.Color).setRGB(
          0.02 + (1 - nightFactor) * 0.05,
          0.03 + (1 - nightFactor) * 0.06,
          0.07 + (1 - nightFactor) * 0.12
        );
      } else {
        scene.background = null;
      }
      starMat.opacity = nightFactor;
      moonMat.opacity = nightFactor;
      moon.position.set(camera.position.x - sdx * 1500, -sdy * 1500, camera.position.z - sdz * 1500);

      const fogR = 0xc4 / 255 * dayLight + 0x0a / 255 * (1 - dayLight);
      const fogG = 0xd8 / 255 * dayLight + 0x14 / 255 * (1 - dayLight);
      const fogB = 0xe8 / 255 * dayLight + 0x24 / 255 * (1 - dayLight);
      (scene.fog as THREE.Fog).color.setRGB(fogR, fogG, fogB);
      scene.environmentIntensity = 0.25 + dayLight * 0.6;

      const wantRain = weatherRef.current === "rain";
      const wantSnow = weatherRef.current === "snow";
      rain.visible = wantRain;
      snow.visible = wantSnow;
      if (wantRain) {
        for (let i = 0; i < RAIN_COUNT; i++) {
          const r = rainData[i]!;
          r.pos.y -= r.speed * dt;
          if (r.pos.y < 0) {
            r.pos.x = camera.position.x + (Math.random() - 0.5) * rainRange * 2;
            r.pos.z = camera.position.z + (Math.random() - 0.5) * rainRange * 2;
            r.pos.y = camera.position.y + rainTop;
          } else {
            const dxx = r.pos.x - camera.position.x;
            const dzz = r.pos.z - camera.position.z;
            if (Math.abs(dxx) > rainRange) r.pos.x -= Math.sign(dxx) * rainRange * 2;
            if (Math.abs(dzz) > rainRange) r.pos.z -= Math.sign(dzz) * rainRange * 2;
          }
          _cs.set(1, 1, 1);
          _cq.identity();
          _cm.compose(r.pos, _cq, _cs);
          rain.setMatrixAt(i, _cm);
        }
        rain.instanceMatrix.needsUpdate = true;
      }
      if (wantSnow) {
        for (let i = 0; i < SNOW_COUNT; i++) {
          const f = snowData[i]!;
          f.pos.y -= f.vy * dt;
          f.pos.x += Math.cos(now * 0.001 + f.phase) * f.sway * dt * 4;
          f.pos.z += Math.sin(now * 0.0007 + f.phase) * f.sway * dt * 4;
          if (f.pos.y < 0) {
            f.pos.x = camera.position.x + (Math.random() - 0.5) * snowRange * 2;
            f.pos.z = camera.position.z + (Math.random() - 0.5) * snowRange * 2;
            f.pos.y = camera.position.y + snowTop;
          } else {
            const dxx = f.pos.x - camera.position.x;
            const dzz = f.pos.z - camera.position.z;
            if (Math.abs(dxx) > snowRange) f.pos.x -= Math.sign(dxx) * snowRange * 2;
            if (Math.abs(dzz) > snowRange) f.pos.z -= Math.sign(dzz) * snowRange * 2;
          }
          _cs.set(1, 1, 1);
          _cq.identity();
          _cm.compose(f.pos, _cq, _cs);
          snow.setMatrixAt(i, _cm);
        }
        snow.instanceMatrix.needsUpdate = true;
      }

      renderer.render(scene, camera);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("resize", onResize);
      document.removeEventListener("pointerlockchange", onPointerLockChange);
      document.removeEventListener("mousemove", onMouseMove);
      renderer.domElement.removeEventListener("click", onClick);
      for (const fn of joyCleanup) fn();

      const disposedMats = new Set<THREE.Material>();
      const disposeMat = (mm: THREE.Material) => {
        if (disposedMats.has(mm)) return;
        disposedMats.add(mm);
        const any = mm as any;
        for (const key of [
          "map", "normalMap", "roughnessMap", "metalnessMap",
          "emissiveMap", "aoMap", "alphaMap", "envMap",
        ]) {
          const t = any[key] as THREE.Texture | undefined;
          if (t && typeof t.dispose === "function") t.dispose();
        }
        mm.dispose();
      };
      const disposeMatAny = (m: THREE.Material | THREE.Material[] | undefined) => {
        if (!m) return;
        if (Array.isArray(m)) m.forEach(disposeMat);
        else disposeMat(m);
      };

      for (const tm of tileMeshes) {
        tm.instanced.geometry.dispose();
        disposeMatAny(tm.instanced.material as any);
      }
      for (const im of carInstancedMeshes) {
        im.geometry.dispose();
        disposeMatAny(im.material as any);
      }
      for (const p of pedList) {
        p.object.parent?.remove(p.object);
        p.object.traverse((o) => {
          const sm = o as THREE.SkinnedMesh;
          if (sm.isSkinnedMesh || (sm as any).isMesh) {
            sm.geometry?.dispose?.();
            disposeMatAny(sm.material as any);
          }
        });
      }
      if (playerAvatar) {
        playerAvatar.parent?.remove(playerAvatar);
        playerAvatar.traverse((o) => {
          const sm = o as THREE.SkinnedMesh;
          if (sm.isSkinnedMesh || (sm as any).isMesh) {
            sm.geometry?.dispose?.();
            disposeMatAny(sm.material as any);
          }
        });
      }
      pmrem.dispose();
      envScene.dispose?.();
      starGeo.dispose();
      starMat.dispose();
      moonGeo.dispose();
      moonMat.dispose();
      rainGeo.dispose();
      rainMat.dispose();
      snowGeo.dispose();
      snowMat.dispose();
      cloudGeo.dispose();
      cloudMat.dispose();
      dracoLoader.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement);
      }
    };
  }, []);

  const fmtTime = (h: number) => {
    const hh = Math.floor(h);
    const mm = Math.floor((h - hh) * 60);
    return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
  };

  return (
    <>
      <div
        ref={containerRef}
        style={{ position: "fixed", inset: 0, overflow: "hidden", touchAction: "none" }}
      />
      {loading && (
        <div
          style={{
            position: "fixed", inset: 0, zIndex: 100,
            background: "radial-gradient(circle at 50% 35%, #2c3e6e 0%, #0e1428 70%, #050810 100%)",
            display: "flex", flexDirection: "column",
            alignItems: "center", justifyContent: "center",
            color: "#eaeaea", fontFamily: "ui-monospace, monospace",
            transition: "opacity 0.5s ease",
            opacity: loadProgress >= 1 ? 0 : 1,
            pointerEvents: loadProgress >= 1 ? "none" : "auto",
          }}
        >
          <div style={{
            fontSize: 32, fontWeight: 700, letterSpacing: 2,
            textShadow: "0 4px 24px rgba(80,140,220,0.6)",
            marginBottom: 8,
          }}>
            REALISTIC CITY
          </div>
          <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 28 }}>
            streaming · loading {Math.floor(loadProgress * 100)}%
          </div>
          <div style={{
            width: "min(360px, 70vw)", height: 6,
            background: "rgba(255,255,255,0.12)",
            borderRadius: 999, overflow: "hidden",
          }}>
            <div style={{
              width: `${Math.floor(loadProgress * 100)}%`,
              height: "100%",
              background: "linear-gradient(90deg, #4ab8ff 0%, #ffb14a 100%)",
              borderRadius: 999,
              transition: "width 0.15s ease",
            }} />
          </div>
          <div style={{ fontSize: 10, opacity: 0.5, marginTop: 28, maxWidth: 320, textAlign: "center" }}>
            tip · drag mouse to look · WASD to move · Shift to sprint
          </div>
        </div>
      )}
      <div
        className="help-bar"
        style={{
          position: "fixed",
          left: "max(12px, env(safe-area-inset-left))",
          top: "max(12px, env(safe-area-inset-top))",
          padding: "8px 12px",
          background: "rgba(0,0,0,0.5)",
          color: "#eaeaea",
          fontFamily: "ui-monospace, monospace",
          fontSize: 11,
          lineHeight: 1.4,
          borderRadius: 6,
          pointerEvents: "none",
          maxWidth: "min(360px, calc(100vw - 24px))",
        }}
      >
        WASD / arrows · mouse drag · Shift sprint · Space/E up · C/Q down · G ground/fly · V FPP/TPP · click for pointer-lock
        <div style={{ marginTop: 4, opacity: 0.85 }}>
          mode · {grounded
            ? (tpp ? "ground · tpp" : "ground · fpp")
            : (tpp ? "fly · tpp" : "fly · fpp")}
        </div>
      </div>
      <div
        style={{
          position: "fixed",
          right: "max(12px, env(safe-area-inset-right))",
          top: "max(12px, env(safe-area-inset-top))",
          padding: "12px 14px",
          background: "rgba(0,0,0,0.55)",
          color: "#eaeaea",
          fontFamily: "ui-monospace, monospace",
          fontSize: 12,
          lineHeight: 1.5,
          borderRadius: 8,
          minWidth: 230,
          maxWidth: "min(320px, calc(100vw - 24px))",
          backdropFilter: "blur(6px)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
          <span>time</span>
          <span style={{ opacity: 0.85 }}>{fmtTime(time)}</span>
        </div>
        <input
          type="range" min={0} max={24} step={0.05} value={time}
          onChange={(e) => {
            const v = parseFloat(e.target.value);
            setTime(v);
            timeRef.current = v;
            setAuto(false);
          }}
          style={{ width: "100%", accentColor: "#ffb14a" }}
        />
        <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
          <input
            type="checkbox" checked={auto}
            onChange={(e) => setAuto(e.target.checked)}
          />
          <span>auto cycle day/night</span>
        </label>
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 12, marginBottom: 4 }}>
          <span>mouse sensitivity</span>
          <span style={{ opacity: 0.85 }}>{sensitivity.toFixed(2)}x</span>
        </div>
        <input
          type="range" min={0.2} max={3.5} step={0.05} value={sensitivity}
          onChange={(e) => setSensitivity(parseFloat(e.target.value))}
          style={{ width: "100%", accentColor: "#4ab8ff" }}
        />
        <div style={{ marginTop: 12 }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <span style={{ fontSize: 10, opacity: 0.7 }}>weather</span>
            <select
              value={weather}
              onChange={(e) => setWeather(e.target.value as Weather)}
              style={{
                background: "rgba(255,255,255,0.08)",
                color: "#eaeaea",
                border: "1px solid rgba(255,255,255,0.15)",
                borderRadius: 4,
                padding: "4px 6px",
                fontSize: 11,
              }}
            >
              <option value="clear">clear</option>
              <option value="rain">rain</option>
              <option value="snow">snow</option>
            </select>
          </label>
        </div>
      </div>
      <div
        ref={joyLeftRef}
        style={{
          position: "fixed",
          left: "max(20px, env(safe-area-inset-left))",
          bottom: "max(28px, env(safe-area-inset-bottom))",
          width: 140, height: 140, touchAction: "none", zIndex: 10,
        }}
      />
      <div
        ref={joyRightRef}
        style={{
          position: "fixed",
          right: "max(20px, env(safe-area-inset-right))",
          bottom: "max(28px, env(safe-area-inset-bottom))",
          width: 140, height: 140, touchAction: "none", zIndex: 10,
        }}
      />
      <div
        style={{
          position: "fixed",
          right: "max(180px, calc(env(safe-area-inset-right) + 180px))",
          bottom: "max(40px, env(safe-area-inset-bottom))",
          display: "flex", flexDirection: "column", gap: 10,
          zIndex: 10, touchAction: "none",
        }}
      >
        {([["▲", climbUpRef], ["▼", climbDownRef]] as const).map(([label, ref]) => (
          <button
            key={label}
            onPointerDown={(e) => { ref.current = true; (e.target as HTMLElement).setPointerCapture(e.pointerId); }}
            onPointerUp={(e) => { ref.current = false; try { (e.target as HTMLElement).releasePointerCapture(e.pointerId); } catch {} }}
            onPointerCancel={() => { ref.current = false; }}
            onPointerLeave={() => { ref.current = false; }}
            style={{
              width: 56, height: 56, borderRadius: "50%",
              background: "rgba(255,255,255,0.18)",
              color: "#eaeaea",
              border: "2px solid rgba(255,255,255,0.55)",
              fontSize: 22, lineHeight: "1", cursor: "pointer",
              touchAction: "none", userSelect: "none",
              backdropFilter: "blur(4px)",
            }}
          >
            {label}
          </button>
        ))}
      </div>
    </>
  );
}
