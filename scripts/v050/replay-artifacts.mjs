#!/usr/bin/env node
// 树外工件重放通道（0.5.0 M2 N9，a1.r5 F-3／a1.r11 F-4）：候选树内可复算证据工件哈希。
// 背景家法=「工件持久」：M0/M1 的取证探针与归因工件落在 gitignored artifacts/，树内只剩
// 报告转述——第三方无法复核「日志所载即脚本所为」。本通道把 {path, sha256} 索引入树
// （scripts/v050/artifact-index/*.json），对工件根逐文件复算哈希对表；探针正本另收编树内
// （items[].alsoAt，逐字节同哈希）可直接重跑。
// 用法：node scripts/v050/replay-artifacts.mjs --index <索引json> [--root <工件根>]
//   缺省 root=索引 artifactsRoot（相对仓根解析）。索引 sha256 收全量（64 位）或前缀（≥8 位）。
// 退出码：0=全对表；1=缺席/失配/索引不可读（fail-closed）。
import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(join(dirname(fileURLToPath(import.meta.url)), "..", ".."));
const argv = process.argv.slice(2);
const argOf = (flag) => {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : null;
};
const indexPath = argOf("--index");
if (!indexPath) {
  console.error("用法：node scripts/v050/replay-artifacts.mjs --index <索引json> [--root <工件根>]");
  process.exit(1);
}
const indexAbs = resolve(REPO, indexPath);
let index;
try {
  index = JSON.parse(readFileSync(indexAbs, "utf8"));
} catch (err) {
  console.error(`索引不可读（fail-closed）：${indexAbs}——${err.message}`);
  process.exit(1);
}
const root = resolve(REPO, argOf("--root") ?? index.artifactsRoot ?? ".");
const sha = (p) => createHash("sha256").update(readFileSync(p)).digest("hex");
const matches = (want, have) => want === have || (want.length <= 32 && have.startsWith(want));

let bad = 0;
console.log(`重放对表：索引=${indexPath} · 工件根=${root} · 条目=${index.items?.length ?? 0}`);
for (const item of index.items ?? []) {
  const abs = join(root, item.path);
  if (!existsSync(abs)) {
    bad += 1;
    console.log(`MISSING ${item.path}（${abs}）`);
    continue;
  }
  const have = sha(abs);
  if (!matches(item.sha256, have)) {
    bad += 1;
    console.log(`MISMATCH ${item.path}——索引 ${item.sha256.slice(0, 16)} ≠ 盘面 ${have.slice(0, 16)}`);
    continue;
  }
  const also = item.alsoAt ? ` · 树内正本 ${item.alsoAt}${existsSync(resolve(REPO, item.alsoAt)) ? "" : "（缺席！）"}` : "";
  console.log(`OK       ${item.path} · ${have.slice(0, 16)}${also}`);
}
for (const d of index.reportDrift ?? []) {
  console.log(`DRIFT    ${d.path}——报告前缀 ${d.reportSha16} ≠ 盘面 ${d.diskSha256.slice(0, 16)}（${d.note}）`);
}
console.log(bad === 0 ? "重放对表：全对表（exit 0）" : `重放对表：${bad} 条缺席/失配（exit 1）`);
process.exit(bad === 0 ? 0 : 1);
