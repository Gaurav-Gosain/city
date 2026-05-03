import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import { Sky } from "three/examples/jsm/objects/Sky.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import * as SkeletonUtils from "three/examples/jsm/utils/SkeletonUtils.js";
import {
  CAR_PALETTE,
  CHUNK_SIZE,
  LOT_STRIDE,
  SEASON_FOLIAGE,
  SHIRT_PALETTE,
  STREET_WIDTH,
  VIEW_RADIUS,
} from "./city/constants";
import type { BuildingModel } from "./city/buildings";
import { makeBuildingMaterial } from "./city/buildings";
import type { ChunkObj } from "./city/chunks";
import { buildChunk, disposeChunk } from "./city/chunks";
import { makeCarGeometry, makePersonGeometry } from "./city/particles";

type Weather = "clear" | "rain" | "snow";
type Season = "spring" | "summer" | "fall" | "winter";

export function City() {
  const containerRef = useRef<HTMLDivElement>(null);
  const joyLeftRef = useRef<HTMLDivElement>(null);
  const joyRightRef = useRef<HTMLDivElement>(null);
  const climbUpRef = useRef(false);
  const climbDownRef = useRef(false);

  const [time, setTime] = useState(13);
  const [auto, setAuto] = useState(true);
  const [sensitivity, setSensitivity] = useState(1);
  const [weather, setWeather] = useState<Weather>("clear");
  const [season, setSeason] = useState<Season>("summer");
  const [loading, setLoading] = useState(true);
  const [loadProgress, setLoadProgress] = useState(0);
  const [grounded, setGrounded] = useState(false);
  const [tpp, setTpp] = useState(true);

  const timeRef = useRef(13);
  const autoRef = useRef(true);
  const sensitivityRef = useRef(1);
  const weatherRef = useRef<Weather>("clear");
  const seasonRef = useRef<Season>("summer");
  const groundedRef = useRef(false);
  const tppRef = useRef(true);

  useEffect(() => { timeRef.current = time; }, [time]);
  useEffect(() => { autoRef.current = auto; }, [auto]);
  useEffect(() => { sensitivityRef.current = sensitivity; }, [sensitivity]);
  useEffect(() => { weatherRef.current = weather; }, [weather]);
  useEffect(() => { seasonRef.current = season; }, [season]);
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
    renderer.toneMappingExposure = 1.05;
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const fogColor = new THREE.Color("#c7dcec");
    scene.fog = new THREE.Fog(fogColor, 950, 1500);

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
    scene.environmentIntensity = 0.7;

    const camera = new THREE.PerspectiveCamera(70, w / h, 0.5, 3000);
    camera.position.set(40, 90, 140);
    camera.lookAt(120, 30, 120);

    const hemi = new THREE.HemisphereLight(0xbcd6ee, 0x6a5b48, 0.6);
    scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xfff1d4, 1.8);
    sun.position.copy(sunPos).multiplyScalar(800);
    scene.add(sun);
    const ambient = new THREE.AmbientLight(0xffffff, 0.18);
    scene.add(ambient);

    const buildingMat = makeBuildingMaterial();
    const roadMat = new THREE.MeshLambertMaterial({ vertexColors: true });
    const trunkGeo = new THREE.CylinderGeometry(0.4, 0.55, 4, 6);
    const foliageGeo = new THREE.IcosahedronGeometry(1, 0);
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5a3a22, roughness: 0.95 });
    const foliageMat = new THREE.MeshStandardMaterial({
      color: 0x3e7d3a,
      roughness: 0.85,
      flatShading: true,
    });
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x2d2d33, roughness: 0.7, metalness: 0.4 });
    const bulbMat = new THREE.MeshBasicMaterial({ color: 0xffe6a0 });

    const cloudGeo = new THREE.IcosahedronGeometry(8, 0);
    const cloudMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 1,
      flatShading: true,
      transparent: true,
      opacity: 0.92,
    });
    const CLOUD_COUNT = 220;
    const clouds = new THREE.InstancedMesh(cloudGeo, cloudMat, CLOUD_COUNT);
    clouds.frustumCulled = false;
    scene.add(clouds);

    interface CloudData {
      pos: THREE.Vector3;
      scale: THREE.Vector3;
      speed: number;
    }
    const cloudData: CloudData[] = [];
    const cloudSpread = 1500;
    const _cm = new THREE.Matrix4();
    const _cs = new THREE.Vector3();
    const _cq = new THREE.Quaternion();
    for (let i = 0; i < CLOUD_COUNT; i++) {
      const cd: CloudData = {
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
      };
      cloudData.push(cd);
      _cs.copy(cd.scale);
      _cm.compose(cd.pos, _cq, _cs);
      clouds.setMatrixAt(i, _cm);
    }
    clouds.instanceMatrix.needsUpdate = true;

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
      color: 0xffffff,
      size: 1.6,
      sizeAttenuation: false,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      fog: false,
    });
    const stars = new THREE.Points(starGeo, starMat);
    stars.frustumCulled = false;
    scene.add(stars);

    const moonGeo = new THREE.SphereGeometry(50, 16, 12);
    const moonMat = new THREE.MeshBasicMaterial({
      color: 0xfff7d8,
      transparent: true,
      opacity: 0,
      fog: false,
      depthWrite: false,
    });
    const moon = new THREE.Mesh(moonGeo, moonMat);
    moon.frustumCulled = false;
    scene.add(moon);

    const RAIN_COUNT = 3500;
    const rainGeo = new THREE.BoxGeometry(0.06, 1.2, 0.06);
    const rainMat = new THREE.MeshBasicMaterial({
      color: 0xaad0e8,
      transparent: true,
      opacity: 0.55,
      fog: false,
    });
    const rain = new THREE.InstancedMesh(rainGeo, rainMat, RAIN_COUNT);
    rain.frustumCulled = false;
    rain.visible = false;
    scene.add(rain);
    const rainRange = 180;
    const rainTop = 220;
    const rainData: Array<{ pos: THREE.Vector3; speed: number }> = [];
    for (let i = 0; i < RAIN_COUNT; i++) {
      rainData.push({
        pos: new THREE.Vector3(
          (Math.random() - 0.5) * rainRange * 2,
          Math.random() * rainTop,
          (Math.random() - 0.5) * rainRange * 2
        ),
        speed: 70 + Math.random() * 40,
      });
    }

    const SNOW_COUNT = 2800;
    const snowGeo = new THREE.SphereGeometry(0.18, 5, 4);
    const snowMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.9,
      fog: false,
    });
    const snow = new THREE.InstancedMesh(snowGeo, snowMat, SNOW_COUNT);
    snow.frustumCulled = false;
    snow.visible = false;
    scene.add(snow);
    const snowRange = 160;
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

    const carGeo = makeCarGeometry();
    const carMat = new THREE.MeshLambertMaterial({ vertexColors: true });
    const CAR_COUNT = 260;
    const cars = new THREE.InstancedMesh(carGeo, carMat, CAR_COUNT);
    cars.frustumCulled = false;
    scene.add(cars);
    interface Car {
      pos: THREE.Vector3;
      axis: 0 | 1;
      sign: 1 | -1;
      lane: number;
      speed: number;
    }
    const carData: Car[] = [];
    const carColor = new THREE.Color();
    const carSpread = 600;
    const carInit = (i: number) => {
      const camX = camera.position.x;
      const camZ = camera.position.z;
      const axis = (Math.random() < 0.5 ? 0 : 1) as 0 | 1;
      const sign = (Math.random() < 0.5 ? 1 : -1) as 1 | -1;
      const baseLane = Math.floor((axis === 0 ? camZ : camX) / LOT_STRIDE);
      const lane = baseLane + Math.floor((Math.random() - 0.5) * 12);
      const along = (axis === 0 ? camX : camZ) + (Math.random() - 0.5) * carSpread * 2;
      const cross = lane * LOT_STRIDE + (sign === 1 ? -1 : 1) * 2.5 * (axis === 0 ? 1 : -1);
      const px = axis === 0 ? along : cross;
      const pz = axis === 0 ? cross : along;
      carData[i] = {
        pos: new THREE.Vector3(px, 0, pz),
        axis,
        sign,
        lane,
        speed: 14 + Math.random() * 12,
      };
      carColor.setHex(CAR_PALETTE[Math.floor(Math.random() * CAR_PALETTE.length)]!);
      cars.setColorAt(i, carColor);
    };
    for (let i = 0; i < CAR_COUNT; i++) carInit(i);
    cars.instanceColor!.needsUpdate = true;

    const personGeo = makePersonGeometry();
    const personMat = new THREE.MeshLambertMaterial({ vertexColors: true });
    const PED_COUNT = 380;
    const peds = new THREE.InstancedMesh(personGeo, personMat, PED_COUNT);
    peds.frustumCulled = false;
    scene.add(peds);
    interface Ped {
      pos: THREE.Vector3;
      axis: 0 | 1;
      sign: 1 | -1;
      lane: number;
      speed: number;
      bobPhase: number;
    }
    const pedData: Ped[] = [];
    const pedSpread = 400;
    const pedColor = new THREE.Color();
    const pedInit = (i: number) => {
      const camX = camera.position.x;
      const camZ = camera.position.z;
      const axis = (Math.random() < 0.5 ? 0 : 1) as 0 | 1;
      const sign = (Math.random() < 0.5 ? 1 : -1) as 1 | -1;
      const baseLane = Math.floor((axis === 0 ? camZ : camX) / LOT_STRIDE);
      const lane = baseLane + Math.floor((Math.random() - 0.5) * 8);
      const along = (axis === 0 ? camX : camZ) + (Math.random() - 0.5) * pedSpread * 2;
      const sideOff = (Math.random() < 0.5 ? -1 : 1) * (STREET_WIDTH / 2 + 1.5);
      const cross = lane * LOT_STRIDE + sideOff;
      const px = axis === 0 ? along : cross;
      const pz = axis === 0 ? cross : along;
      pedData[i] = {
        pos: new THREE.Vector3(px, 0, pz),
        axis, sign, lane,
        speed: 1.4 + Math.random() * 0.8,
        bobPhase: Math.random() * Math.PI * 2,
      };
      pedColor.setHex(SHIRT_PALETTE[Math.floor(Math.random() * SHIRT_PALETTE.length)]!);
      peds.setColorAt(i, pedColor);
    };
    for (let i = 0; i < PED_COUNT; i++) pedInit(i);
    peds.instanceColor!.needsUpdate = true;

    const chunks = new Map<string, ChunkObj>();
    const cKey = (cx: number, cz: number) => cx + "," + cz;
    const buildingModels: BuildingModel[] = [];
    const chunkDeps = {
      roadMat, buildingMat, trunkGeo, foliageGeo,
      trunkMat, foliageMat, poleMat, bulbMat, models: buildingModels,
    };

    const pendingChunks: Array<[number, number]> = [];
    function ensureChunks() {
      const ccx = Math.floor(camera.position.x / CHUNK_SIZE);
      const ccz = Math.floor(camera.position.z / CHUNK_SIZE);
      const wanted = new Set<string>();
      const toBuild: Array<{ cx: number; cz: number; d: number }> = [];
      for (let dx = -VIEW_RADIUS; dx <= VIEW_RADIUS; dx++) {
        for (let dz = -VIEW_RADIUS; dz <= VIEW_RADIUS; dz++) {
          const cx = ccx + dx;
          const cz = ccz + dz;
          const k = cKey(cx, cz);
          wanted.add(k);
          if (!chunks.has(k)) toBuild.push({ cx, cz, d: dx * dx + dz * dz });
        }
      }
      toBuild.sort((a, b) => a.d - b.d);
      pendingChunks.length = 0;
      for (const item of toBuild) pendingChunks.push([item.cx, item.cz]);
      for (const [k, ch] of chunks) {
        if (!wanted.has(k)) {
          disposeChunk(ch);
          chunks.delete(k);
        }
      }
    }
    function buildOnePending() {
      const item = pendingChunks.shift();
      if (!item) return false;
      const [cx, cz] = item;
      const k = cKey(cx, cz);
      if (chunks.has(k)) return true;
      const ch = buildChunk(cx, cz, chunkDeps);
      chunks.set(k, ch);
      scene.add(ch.group);
      return true;
    }
    ensureChunks();

    let playerAvatar: THREE.Object3D | null = null;
    let playerMixer: THREE.AnimationMixer | null = null;
    let playerIdleAction: THREE.AnimationAction | null = null;
    let playerWalkAction: THREE.AnimationAction | null = null;
    let playerRunAction: THREE.AnimationAction | null = null;
    let playerTPoseAction: THREE.AnimationAction | null = null;
    let pedFeetOffset = 0;
    let playerEyeHeight = 1.65;
    const playerGroundY = 0;

    const loader = new GLTFLoader();
    let cancelled = false;
    loader.load(
      "city.glb",
      async (gltf) => {
        if (cancelled) return;
        setLoadProgress(1);
        const candidates: THREE.Object3D[] = [];
        const namePattern = /^(Commercial|Residential|Post Office|Apartment|Hotel|Office|Tower|Skyscraper)/i;
        gltf.scene.traverse((node) => {
          if ((node as THREE.Mesh).isMesh || (node as THREE.Group).isGroup) {
            if (namePattern.test(node.name)) candidates.push(node);
          }
        });
        const seen = new Set<string>();
        for (const node of candidates) {
          const root = node.name.replace(/\.\d+$/, "");
          if (seen.has(root)) continue;
          seen.add(root);
          const wrapped = new THREE.Group();
          const cloned = node.clone(true);
          cloned.position.set(0, 0, 0);
          cloned.rotation.set(0, 0, 0);
          cloned.scale.set(1, 1, 1);
          wrapped.add(cloned);
          const box = new THREE.Box3().setFromObject(wrapped);
          const size = new THREE.Vector3();
          box.getSize(size);
          if (size.x < 0.1 || size.z < 0.1 || size.y < 0.5) continue;
          if (size.x > 200 || size.z > 200) continue;
          const center = new THREE.Vector3();
          box.getCenter(center);
          cloned.position.set(-center.x, -box.min.y, -center.z);
          cloned.traverse((c) => {
            const m = c as THREE.Mesh;
            if (!m.isMesh) return;
            const mats = Array.isArray(m.material) ? m.material : [m.material];
            for (const raw of mats) {
              const mat = raw as THREE.MeshStandardMaterial;
              if (!mat) continue;
              mat.side = THREE.FrontSide;
              if ("metalness" in mat) mat.metalness = 0;
              if ("roughness" in mat) mat.roughness = 0.85;
              if (mat.emissiveMap) {
                mat.emissive = new THREE.Color(0xffffff);
                mat.emissiveIntensity = 1.5;
              }
              mat.needsUpdate = true;
            }
          });
          buildingModels.push({ object: wrapped, size });
          if (buildingModels.length >= 24) break;
        }

        // preload: add gltf.scene to scene + render once to force texture/shader upload
        scene.add(gltf.scene);
        try {
          const r = renderer as any;
          if (r.compileAsync) await r.compileAsync(scene, camera);
          else renderer.compile(scene, camera);
          renderer.render(scene, camera);
        } catch {}
        scene.remove(gltf.scene);

        if (buildingModels.length > 0) {
          for (const ch of chunks.values()) disposeChunk(ch);
          chunks.clear();
          ensureChunks();
          // build inner ring sync (~25 chunks) — outer ring loads in tick
          for (let i = 0; i < 25 && pendingChunks.length; i++) buildOnePending();
        }

        // Player avatar: rigged Soldier with idle/walk/run/tpose anims for
        // ground walking and superhero fly-TPP pose.
        try {
          const draco = new DRACOLoader();
          draco.setDecoderPath("https://www.gstatic.com/draco/v1/decoders/");
          draco.setDecoderConfig({ type: "js" });
          const pedLoader = new GLTFLoader();
          pedLoader.setDRACOLoader(draco);
          const soldier = await pedLoader.loadAsync("soldier.glb");
          soldier.scene.updateMatrixWorld(true);
          const sBox = new THREE.Box3().setFromObject(soldier.scene);
          pedFeetOffset = -sBox.min.y;
          playerEyeHeight = (sBox.max.y - sBox.min.y) - 0.15;

          playerAvatar = SkeletonUtils.clone(soldier.scene);
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
          const findClip = (name: string) =>
            soldier.animations.find((a) => a.name === name);
          const setupAction = (clip: THREE.AnimationClip | undefined) => {
            if (!clip || !playerMixer) return null;
            const a = playerMixer.clipAction(clip);
            a.play();
            a.weight = 0;
            return a;
          };
          playerIdleAction = setupAction(findClip("Idle"));
          playerWalkAction = setupAction(findClip("Walk") ?? soldier.animations[0]);
          playerRunAction = setupAction(findClip("Run"));
          playerTPoseAction = setupAction(findClip("TPose"));
          playerAvatar.visible = false;
          draco.dispose();
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
      (xhr) => {
        if (xhr.total > 0) setLoadProgress(xhr.loaded / xhr.total);
      },
      (err) => {
        console.warn("GLB load failed; using procedural fallback", err);
        setLoading(false);
      }
    );

    const keys: Record<string, boolean> = {};
    let yaw = -Math.PI * 0.25;
    let pitch = -0.25;
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
            playerGroundY + playerEyeHeight + 6,
            playerAvatar.position.z
          );
        } else {
          playerAvatar.position.set(
            camera.position.x,
            playerGroundY + pedFeetOffset,
            camera.position.z
          );
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

    // Adaptive mouse sensitivity — different browsers report wildly different
    // movementX scales under pointer-lock. Sample early events and rescale so
    // a unit of perceived motion is comparable across engines.
    let calibSum = 0;
    let calibCount = 0;
    let mouseScale = 0.6; // conservative until calibrated
    const TARGET_AVG = 3;
    const onMouseMove = (e: MouseEvent) => {
      if (!pointerLocked) return;
      const m = Math.hypot(e.movementX, e.movementY);
      if (calibCount < 60 && m > 0.5 && m < 250) {
        calibSum += m;
        calibCount++;
        if (calibCount === 60) {
          const avg = calibSum / 60;
          mouseScale = TARGET_AVG / Math.max(0.5, avg);
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
    const initJoystick = (
      zone: HTMLDivElement | null,
      out: { x: number; y: number }
    ) => {
      if (!zone) return;
      zone.style.position = zone.style.position || "fixed";
      const handle = document.createElement("div");
      Object.assign(handle.style, {
        position: "absolute",
        left: "50%",
        top: "50%",
        width: "60px",
        height: "60px",
        marginLeft: "-30px",
        marginTop: "-30px",
        borderRadius: "50%",
        background: "rgba(255,255,255,0.85)",
        boxShadow: "0 2px 8px rgba(0,0,0,0.4)",
        pointerEvents: "none",
        transition: "transform 0.05s linear",
        willChange: "transform",
      });
      const ring = document.createElement("div");
      Object.assign(ring.style, {
        position: "absolute",
        left: "50%",
        top: "50%",
        width: "120px",
        height: "120px",
        marginLeft: "-60px",
        marginTop: "-60px",
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

    let last = performance.now();
    let lastChunkCheck = 0;
    let lastTimeSync = 0;
    let raf = 0;
    let avatarRoll = 0;
    let avatarYawPrev = -Math.PI * 0.25;
    const up = new THREE.Vector3(0, 1, 0);
    const look = new THREE.Vector3();

    const headingFor = (sx: number, sz: number) => Math.atan2(-sx, -sz);

    const tick = () => {
      const now = performance.now();
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;

      // look stick — quadratic curve + deadzone for finer aim near center
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
      let playerMoving = false;

      // Auto-enter grounded mode when fly camera descends to ground height
      if (!groundedRef.current && playerAvatar &&
          camera.position.y <= playerGroundY + playerEyeHeight + 0.05) {
        playerAvatar.position.set(camera.position.x, playerGroundY + pedFeetOffset, camera.position.z);
        playerAvatar.rotation.set(0, headingFor(flatLook.x, flatLook.z), 0);
        groundedRef.current = true;
        setGrounded(true);
      }

      if (groundedRef.current && playerAvatar) {
        // Space/E = jump back to fly
        if (keys["Space"] || keys["KeyE"] || climbUpRef.current) {
          groundedRef.current = false;
          setGrounded(false);
          playerAvatar.visible = false;
          camera.position.set(
            playerAvatar.position.x,
            playerGroundY + playerEyeHeight + 4,
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
            playerAvatar.rotation.y = headingFor(walkMv.x, walkMv.z);
          }
          playerAvatar.position.y = playerGroundY + pedFeetOffset;

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
              playerGroundY + playerEyeHeight,
              playerAvatar.position.z
            );
          }
        }
      } else {
        const speed = (sprintHeld ? 320 : 95) * (keys["AltLeft"] ? 0.25 : 1);
        const mv = new THREE.Vector3();
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
        if (camera.position.y < 2) camera.position.y = 2;

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
          const fwdV = look.clone();
          fwdV.y += 0.05;
          fwdV.normalize();
          const lx = new THREE.Vector3().crossVectors(fwdV, up);
          if (lx.lengthSq() < 1e-4) lx.set(1, 0, 0);
          else lx.normalize();
          const lz = new THREE.Vector3().crossVectors(lx, fwdV).normalize();
          const rollQ = new THREE.Quaternion().setFromAxisAngle(fwdV, avatarRoll);
          lx.applyQuaternion(rollQ);
          lz.applyQuaternion(rollQ);
          const basis = new THREE.Matrix4().makeBasis(lx, fwdV, lz);
          playerAvatar.quaternion.setFromRotationMatrix(basis);
        } else {
          avatarRoll *= Math.max(0, 1 - dt * 6);
          avatarYawPrev = yaw;
          if (playerAvatar) playerAvatar.visible = false;
        }
      }

      camera.lookAt(camera.position.clone().add(look));

      // Player anim state machine: blend Idle / Walk / Run / TPose
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

      if (now - lastChunkCheck > 250) {
        ensureChunks();
        lastChunkCheck = now;
      }
      buildOnePending();

      const camX = camera.position.x;
      const camZ = camera.position.z;
      for (let i = 0; i < CLOUD_COUNT; i++) {
        const cd = cloudData[i]!;
        cd.pos.x += cd.speed * dt;
        const dx = cd.pos.x - camX;
        const dz = cd.pos.z - camZ;
        if (dx > cloudSpread) cd.pos.x -= cloudSpread * 2;
        else if (dx < -cloudSpread) cd.pos.x += cloudSpread * 2;
        if (dz > cloudSpread) cd.pos.z -= cloudSpread * 2;
        else if (dz < -cloudSpread) cd.pos.z += cloudSpread * 2;
        _cs.copy(cd.scale);
        _cm.compose(cd.pos, _cq, _cs);
        clouds.setMatrixAt(i, _cm);
      }
      clouds.instanceMatrix.needsUpdate = true;

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

      sun.intensity = dayLight * 2.4 + 0.04;
      sun.color.setRGB(1.0, 0.92 - dawnDusk * 0.25, 0.82 - dawnDusk * 0.4);
      hemi.intensity = 0.25 + dayLight * 0.7;
      hemi.color.setRGB(0.45 + dayLight * 0.55, 0.6 + dayLight * 0.35, 0.75 + dayLight * 0.25);
      ambient.intensity = 0.12 + dayLight * 0.22;
      ambient.color.setRGB(0.4 + dayLight * 0.6, 0.5 + dayLight * 0.5, 0.7 + dayLight * 0.3);

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
      moon.position.set(-sdx * 1500, -sdy * 1500, -sdz * 1500);

      const fogR = 0xc7 / 255 * dayLight + 0x0a / 255 * (1 - dayLight);
      const fogG = 0xdc / 255 * dayLight + 0x14 / 255 * (1 - dayLight);
      const fogB = 0xec / 255 * dayLight + 0x24 / 255 * (1 - dayLight);
      (scene.fog as THREE.Fog).color.setRGB(fogR, fogG, fogB);

      const nightBoost = 1 + (1 - dayLight) * 5;
      bulbMat.color.setRGB(1.0 * nightBoost, 0.84 * nightBoost, 0.5 * nightBoost);
      scene.environmentIntensity = 0.25 + dayLight * 0.6;
      const sShader = (buildingMat as any).userData?.shader;
      if (sShader) sShader.uniforms.uNightAmount.value = 1 - dayLight;

      const sc = SEASON_FOLIAGE[seasonRef.current] || SEASON_FOLIAGE.summer!;
      foliageMat.color.setRGB(sc[0]!, sc[1]!, sc[2]!);

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

      for (let i = 0; i < CAR_COUNT; i++) {
        const c = carData[i]!;
        if (c.axis === 0) c.pos.x += c.sign * c.speed * dt;
        else c.pos.z += c.sign * c.speed * dt;
        const dx = c.pos.x - camX;
        const dz = c.pos.z - camZ;
        if (Math.abs(dx) > carSpread || Math.abs(dz) > carSpread) {
          carInit(i);
          continue;
        }
        const heading = c.axis === 0
          ? (c.sign === 1 ? Math.PI / 2 : -Math.PI / 2)
          : (c.sign === 1 ? 0 : Math.PI);
        _cq.setFromAxisAngle(up, heading);
        _cs.set(1, 1, 1);
        _cm.compose(c.pos, _cq, _cs);
        cars.setMatrixAt(i, _cm);
      }
      cars.instanceMatrix.needsUpdate = true;

      for (let i = 0; i < PED_COUNT; i++) {
        const p = pedData[i]!;
        if (p.axis === 0) p.pos.x += p.sign * p.speed * dt;
        else p.pos.z += p.sign * p.speed * dt;
        const dx = p.pos.x - camX;
        const dz = p.pos.z - camZ;
        if (Math.abs(dx) > pedSpread || Math.abs(dz) > pedSpread) {
          pedInit(i);
          continue;
        }
        const heading = p.axis === 0
          ? (p.sign === 1 ? Math.PI / 2 : -Math.PI / 2)
          : (p.sign === 1 ? 0 : Math.PI);
        const bob = Math.sin(now * 0.012 + p.bobPhase) * 0.06;
        _cq.setFromAxisAngle(up, heading);
        _cs.set(1, 1 + bob, 1);
        _cm.compose(p.pos, _cq, _cs);
        peds.setMatrixAt(i, _cm);
      }
      peds.instanceMatrix.needsUpdate = true;

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
      if (playerAvatar) {
        playerAvatar.parent?.remove(playerAvatar);
        playerAvatar.traverse((o) => {
          const sm = o as THREE.SkinnedMesh;
          if (sm.isSkinnedMesh || (sm as any).isMesh) {
            sm.geometry?.dispose?.();
            const m = sm.material as THREE.Material | THREE.Material[] | undefined;
            if (Array.isArray(m)) m.forEach((mm) => mm.dispose());
            else m?.dispose();
          }
        });
      }
      for (const ch of chunks.values()) disposeChunk(ch);
      chunks.clear();
      buildingMat.dispose();
      roadMat.dispose();
      pmrem.dispose();
      envScene.dispose?.();
      trunkGeo.dispose();
      foliageGeo.dispose();
      trunkMat.dispose();
      foliageMat.dispose();
      poleMat.dispose();
      bulbMat.dispose();
      cloudGeo.dispose();
      cloudMat.dispose();
      starGeo.dispose();
      starMat.dispose();
      moonGeo.dispose();
      moonMat.dispose();
      rainGeo.dispose();
      rainMat.dispose();
      snowGeo.dispose();
      snowMat.dispose();
      carGeo.dispose();
      carMat.dispose();
      personGeo.dispose();
      personMat.dispose();
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
            position: "fixed",
            inset: 0,
            zIndex: 100,
            background:
              "radial-gradient(circle at 50% 35%, #2c3e6e 0%, #0e1428 70%, #050810 100%)",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            color: "#eaeaea",
            fontFamily: "ui-monospace, monospace",
            transition: "opacity 0.5s ease",
            opacity: loadProgress >= 1 ? 0 : 1,
            pointerEvents: loadProgress >= 1 ? "none" : "auto",
          }}
        >
          <div
            style={{
              fontSize: 32, fontWeight: 700, letterSpacing: 2,
              textShadow: "0 4px 24px rgba(80,140,220,0.6)",
              marginBottom: 8,
            }}
          >
            INFINITE CITY
          </div>
          <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 28 }}>
            building skyline · loading {Math.floor(loadProgress * 100)}%
          </div>
          <div
            style={{
              width: "min(360px, 70vw)", height: 6,
              background: "rgba(255,255,255,0.12)",
              borderRadius: 999, overflow: "hidden",
            }}
          >
            <div
              style={{
                width: `${Math.floor(loadProgress * 100)}%`,
                height: "100%",
                background: "linear-gradient(90deg, #4ab8ff 0%, #ffb14a 100%)",
                borderRadius: 999,
                transition: "width 0.15s ease",
              }}
            />
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
          type="range"
          min={0}
          max={24}
          step={0.05}
          value={time}
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
            type="checkbox"
            checked={auto}
            onChange={(e) => setAuto(e.target.checked)}
          />
          <span>auto cycle day/night</span>
        </label>
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 12, marginBottom: 4 }}>
          <span>mouse sensitivity</span>
          <span style={{ opacity: 0.85 }}>{sensitivity.toFixed(2)}x</span>
        </div>
        <input
          type="range"
          min={0.2}
          max={3.5}
          step={0.05}
          value={sensitivity}
          onChange={(e) => setSensitivity(parseFloat(e.target.value))}
          style={{ width: "100%", accentColor: "#4ab8ff" }}
        />
        <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
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
          <label style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <span style={{ fontSize: 10, opacity: 0.7 }}>season</span>
            <select
              value={season}
              onChange={(e) => setSeason(e.target.value as Season)}
              style={{
                background: "rgba(255,255,255,0.08)",
                color: "#eaeaea",
                border: "1px solid rgba(255,255,255,0.15)",
                borderRadius: 4,
                padding: "4px 6px",
                fontSize: 11,
              }}
            >
              <option value="spring">spring</option>
              <option value="summer">summer</option>
              <option value="fall">fall</option>
              <option value="winter">winter</option>
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
          width: 140, height: 140,
          touchAction: "none", zIndex: 10,
        }}
      />
      <div
        ref={joyRightRef}
        style={{
          position: "fixed",
          right: "max(20px, env(safe-area-inset-right))",
          bottom: "max(28px, env(safe-area-inset-bottom))",
          width: 140, height: 140,
          touchAction: "none", zIndex: 10,
        }}
      />
      <div
        style={{
          position: "fixed",
          right: "max(180px, calc(env(safe-area-inset-right) + 180px))",
          bottom: "max(40px, env(safe-area-inset-bottom))",
          display: "flex",
          flexDirection: "column",
          gap: 10,
          zIndex: 10,
          touchAction: "none",
        }}
      >
        {([
          ["▲", climbUpRef],
          ["▼", climbDownRef],
        ] as const).map(([label, ref]) => (
          <button
            key={label}
            onPointerDown={(e) => { ref.current = true; (e.target as HTMLElement).setPointerCapture(e.pointerId); }}
            onPointerUp={(e) => { ref.current = false; try { (e.target as HTMLElement).releasePointerCapture(e.pointerId); } catch {} }}
            onPointerCancel={() => { ref.current = false; }}
            onPointerLeave={() => { ref.current = false; }}
            style={{
              width: 56,
              height: 56,
              borderRadius: "50%",
              background: "rgba(255,255,255,0.18)",
              color: "#eaeaea",
              border: "2px solid rgba(255,255,255,0.55)",
              fontSize: 22,
              lineHeight: "1",
              cursor: "pointer",
              touchAction: "none",
              userSelect: "none",
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
