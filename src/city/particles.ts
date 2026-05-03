import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

function tag(g: THREE.BufferGeometry, c: number[]) {
  const n = g.attributes.position!.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = c[0]!;
    arr[i * 3 + 1] = c[1]!;
    arr[i * 3 + 2] = c[2]!;
  }
  g.setAttribute("color", new THREE.BufferAttribute(arr, 3));
  g.deleteAttribute("uv");
  return g;
}

export function makeCarGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const body = new THREE.BoxGeometry(2.0, 0.7, 4.4);
  body.translate(0, 0.55, 0);
  parts.push(tag(body, [1, 1, 1]));
  const cabin = new THREE.BoxGeometry(1.7, 0.55, 2.2);
  cabin.translate(0, 1.18, -0.2);
  parts.push(tag(cabin, [0.18, 0.22, 0.3]));
  const wheels: Array<[number, number]> = [
    [0.9, 1.5], [-0.9, 1.5], [0.9, -1.5], [-0.9, -1.5],
  ];
  for (const [wx, wz] of wheels) {
    const w = new THREE.CylinderGeometry(0.32, 0.32, 0.3, 8);
    w.rotateZ(Math.PI / 2);
    w.translate(wx, 0.32, wz);
    parts.push(tag(w, [0.05, 0.05, 0.05]));
  }
  const merged = mergeGeometries(parts, false);
  parts.forEach((p) => p.dispose());
  if (!merged) {
    const fallback = new THREE.BoxGeometry(2.0, 1.4, 4.4);
    fallback.translate(0, 0.7, 0);
    return tag(fallback, [1, 1, 1]);
  }
  return merged;
}

export function makePersonGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const legs = new THREE.BoxGeometry(0.45, 0.85, 0.35);
  legs.translate(0, 0.42, 0);
  parts.push(tag(legs, [0.18, 0.22, 0.42]));
  const torso = new THREE.BoxGeometry(0.55, 0.7, 0.4);
  torso.translate(0, 1.2, 0);
  parts.push(tag(torso, [1, 1, 1]));
  const head = new THREE.BoxGeometry(0.4, 0.4, 0.4);
  head.translate(0, 1.75, 0);
  parts.push(tag(head, [0.93, 0.78, 0.65]));
  const merged = mergeGeometries(parts, false);
  parts.forEach((p) => p.dispose());
  if (!merged) {
    const fallback = new THREE.BoxGeometry(0.55, 1.8, 0.4);
    fallback.translate(0, 0.9, 0);
    return tag(fallback, [1, 1, 1]);
  }
  return merged;
}
