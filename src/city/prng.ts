export function mulberry32(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function chunkSeed(cx: number, cz: number) {
  const a = (cx | 0) * 374761393;
  const b = (cz | 0) * 668265263;
  return ((a ^ b) + 1013904223) >>> 0;
}
