export const CHUNK_SIZE = 240;
export const LOTS_PER_CHUNK = 4;
export const LOT_STRIDE = CHUNK_SIZE / LOTS_PER_CHUNK;
export const STREET_WIDTH = 12;
export const LOT_SIZE = LOT_STRIDE - STREET_WIDTH;
export const VIEW_RADIUS = 5;
export const UNIT_PER_WINDOW = 3.2;

export const BUILDING_PALETTE: number[][] = [
  [0.86, 0.78, 0.62],
  [0.78, 0.55, 0.42],
  [0.6, 0.36, 0.32],
  [0.42, 0.55, 0.66],
  [0.82, 0.84, 0.88],
  [0.55, 0.62, 0.5],
  [0.36, 0.46, 0.55],
  [0.72, 0.62, 0.5],
  [0.46, 0.5, 0.55],
  [0.88, 0.62, 0.4],
  [0.92, 0.86, 0.5],
  [0.34, 0.42, 0.36],
];

export const CAR_PALETTE = [0xd24a3c, 0x3d5a8a, 0xeac24a, 0xffffff, 0x2c2c2c, 0x4a8a55, 0xc8c8c8, 0x6e3aa6];
export const SHIRT_PALETTE = [0xd24a3c, 0x3d5a8a, 0xeac24a, 0x4a8a55, 0xb86fb0, 0x55b8d4, 0xeaeaea];

export const SEASON_FOLIAGE: Record<string, [number, number, number]> = {
  spring: [0.42, 0.7, 0.36],
  summer: [0.24, 0.49, 0.22],
  fall: [0.78, 0.42, 0.16],
  winter: [0.62, 0.66, 0.7],
};
