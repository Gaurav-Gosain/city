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

const assets: Array<[string, string]> = [
  ["city2.glb", "city.glb"],
  ["ferrari.glb", "ferrari.glb"],
  ["soldier.glb", "soldier.glb"],
  ["realistic.glb", "realistic.glb"],
];

let copied = 0;
for (const [src, dst] of assets) {
  const srcPath = path.resolve("src/assets", src);
  if (!existsSync(srcPath)) continue;
  await copyFile(srcPath, path.resolve(outdir, dst));
  copied++;
}

const ms = (performance.now() - start).toFixed(0);
console.log(`built ${result.outputs.length} files + ${copied} assets in ${ms}ms`);
