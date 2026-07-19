import { mkdirSync, writeFileSync, existsSync, copyFileSync, readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dist = resolve(__dirname, "..", "dist");
const root = resolve(__dirname, "..");

mkdirSync(dist, { recursive: true });

const rootPkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf-8"));

const distPkg = {
  name: rootPkg.name,
  version: rootPkg.version,
  description: rootPkg.description,
  main: rootPkg.logseq?.main,
  logseq: rootPkg.logseq,
};

writeFileSync(resolve(dist, "package.json"), JSON.stringify(distPkg, null, 2));

const iconSrc = resolve(root, "icon.png");
const iconDst = resolve(dist, "icon.png");
if (existsSync(iconSrc)) {
  copyFileSync(iconSrc, iconDst);
}

console.log("\u2714 Copied plugin files to dist/");
