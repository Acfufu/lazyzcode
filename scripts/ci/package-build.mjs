import { mkdtempSync, mkdirSync, readFileSync, readdirSync, lstatSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, relative, basename } from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { identity } from "./identity.mjs";
import { runNpm } from "./npm.mjs";

const out = resolve(process.argv[2]);
mkdirSync(out, { recursive: true });
const parsed = JSON.parse(runNpm(["pack", "--json", "--ignore-scripts", "--pack-destination", out]));
const packed = Array.isArray(parsed) ? parsed[0] : parsed[Object.keys(parsed)[0]];
if (!packed?.filename || basename(packed.filename) !== packed.filename) throw new Error("Unexpected npm pack filename");
const tgz = join(out, packed.filename);
const unpack = mkdtempSync(join(tmpdir(), "lzy-pack-manifest-"));
try {
  const r = spawnSync("tar", ["-xzf", tgz, "-C", unpack], { encoding: "utf8", timeout: 60_000 });
  if (r.status !== 0) throw new Error(`Cannot unpack candidate: ${r.stderr}`);
  const root = join(unpack, "package");
  const files = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir).sort()) {
      const p = join(dir, name), st = lstatSync(p);
      if (st.isDirectory()) walk(p);
      else if (st.isFile()) files.push({ path: relative(root, p).split("\\").join("/"), bytes: st.size, sha256: createHash("sha256").update(readFileSync(p)).digest("hex") });
      else throw new Error(`Unsupported package member: ${p}`);
    }
  };
  walk(root);
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const bytes = readFileSync(tgz);
  const manifest = { schemaVersion: 1, kind: "unpublished-ci-candidate", ...identity(), name: pkg.name, version: pkg.version, filename: packed.filename, sha256: createHash("sha256").update(bytes).digest("hex"), integrity: `sha512-${createHash("sha512").update(bytes).digest("base64")}`, files };
  writeFileSync(join(out, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(JSON.stringify({ filename: manifest.filename, sha256: manifest.sha256, integrity: manifest.integrity, checkoutSha: manifest.checkoutSha, checkoutTree: manifest.checkoutTree, files: files.length }, null, 2));
} finally { rmSync(unpack, { recursive: true, force: true }); }
