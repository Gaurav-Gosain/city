# city

Procedural infinite 3D city in the browser. Three.js, React, Bun.

Live: https://city.gaurav.zip

## Features

- Procedural infinite chunked city, streamed as you fly around
- GLB low-poly building models + procedural towers with shader-rendered windows
- Geometric low-poly roads, sidewalks, lane markings, crosswalks
- Trees with seasonal foliage, parks
- Streetlights that glow at night
- 260 cars driving and 380 pedestrians walking
- 220 drifting clouds, atmospheric Sky shader, stars + moon at night
- Day/night cycle (manual slider or auto)
- Weather: clear / rain / snow
- Seasons: spring / summer / fall / winter
- Free-fly camera: WASD / arrows + mouse, Shift sprint, Space/E up, C/Q down
- Mobile-friendly: dual on-screen joysticks

## Run

```sh
bun install
bun run dev
```

Open http://localhost:3000.

## Build

```sh
bun run build
```

Outputs static site to `dist/`. Deploys to GitHub Pages via `.github/workflows/deploy.yml`.
