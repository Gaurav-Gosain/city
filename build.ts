#!/usr/bin/env bun
import { existsSync } from "fs";
import { rm, mkdir, copyFile } from "fs/promises";
import path from "path";

const outdir = path.resolve("dist");
if (existsSync(outdir)) await rm(outdir, { recursive: true, force: true });
await mkdir(outdir, { recursive: true });

const start = performance.now();

const result = await Bun.build({
  entrypoints: [path.resolve("src/index.html")],
  outdir,
  minify: true,
  target: "browser",
  sourcemap: "linked",
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
});

if (!result.success) {
  console.error("build failed:");
  for (const log of result.logs) console.error(log);
  process.exit(1);
}

await copyFile(
  path.resolve("src/assets/city2.glb"),
  path.resolve(outdir, "city.glb")
);

const ms = (performance.now() - start).toFixed(0);
console.log(`built ${result.outputs.length} files + city.glb in ${ms}ms`);
