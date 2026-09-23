#!/usr/bin/env node
// findings ledger lint（v024-debt-bundle N2）：对 findings-ledger.jsonl 做 schema 校验。
// 用法：node scripts/findings-lint.mjs [file]（缺省 docs/reviews/findings-ledger.jsonl）。
// 校验面（§N2）：每行合法 JSON；必填字段在场；枚举合法（severity P0-P3 / verdict /
// disposition）；id 全局唯一；首行=meta 记录（scope 范围句在场）；fixed ⇒ landed 为非空
// 提交指针，非 fixed ⇒ landed 记 open。机器只校形状不裁决内容——判定对不对归报告与评审。
import { readFileSync } from "node:fs";

const SEVERITIES = new Set(["P0", "P1", "P2", "P3"]);
// ADJ-27（v024 双审）：`landed` 原判据只验「非空且 ≠ open」——`"OPEN"`/`"tbd"`/散文串照过，
// 「fixed 有提交指针」这条机器承诺名存实亡。现行须为提交 sha 形态（7-40 位十六进制）；
// 且 batch 必须出现在 meta 行的 scope 文本里（批次与范围句脱钩时无人发现）。
const LANDED_RE = /^[0-9a-f]{7,40}$/;
const VERDICTS = new Set(["成立", "部分成立", "证伪"]);
const DISPOSITIONS = new Set(["fixed", "deferred", "wontfix", "waived"]);
const REQUIRED = ["id", "batch", "severity", "verdict", "disposition", "landed", "source"];

const file = process.argv[2] ?? "docs/reviews/findings-ledger.jsonl";
let lines;
try {
  lines = readFileSync(file, "utf8").split("\n").filter((l) => l.trim() !== "");
} catch (err) {
  console.error(`[findings-lint] 读不到 ${file}：${err.message}`);
  process.exit(1);
}
if (lines.length === 0) {
  console.error(`[findings-lint] ${file} 为空`);
  process.exit(1);
}

const errors = [];
const seen = new Set();
const batches = new Set();
let metaScope = "";
let findings = 0;

const checkRow = (obj, n, isMeta) => {
  if (isMeta) {
    if (typeof obj.scope !== "string" || obj.scope.trim() === "") errors.push(`L${n}: meta 行缺 scope 范围句`);
    if (obj.schemaVersion !== 1) errors.push(`L${n}: meta 行 schemaVersion 必须=1`);
    if (typeof obj.scope === "string") metaScope = obj.scope;
    return;
  }
  for (const k of REQUIRED) {
    if (typeof obj[k] !== "string" || obj[k].trim() === "") errors.push(`L${n}: 缺必填字段 ${k}`);
  }
  if (obj.severity != null && !SEVERITIES.has(obj.severity)) errors.push(`L${n}: severity 枚举外：${obj.severity}`);
  if (obj.verdict != null && !VERDICTS.has(obj.verdict)) errors.push(`L${n}: verdict 枚举外：${obj.verdict}`);
  if (obj.disposition != null && !DISPOSITIONS.has(obj.disposition)) errors.push(`L${n}: disposition 枚举外：${obj.disposition}`);
  if (obj.id != null) {
    if (seen.has(obj.id)) errors.push(`L${n}: id 重复：${obj.id}`);
    seen.add(obj.id);
  }
  if (typeof obj.batch === "string") batches.add(obj.batch);
  if (obj.disposition === "fixed" && !LANDED_RE.test(String(obj.landed ?? "").trim())) {
    errors.push(`L${n}: disposition=fixed 的 landed 须为提交 sha 形态（7-40 位十六进制），实际：${JSON.stringify(obj.landed)}`);
  }
  if (obj.disposition && obj.disposition !== "fixed" && obj.landed !== "open") {
    errors.push(`L${n}: disposition=${obj.disposition} 的 landed 须记 open（实际：${obj.landed}）`);
  }
};

lines.forEach((line, i) => {
  const n = i + 1;
  let obj;
  try {
    obj = JSON.parse(line);
  } catch (err) {
    errors.push(`L${n}: 非法 JSON：${err.message}`);
    return;
  }
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
    errors.push(`L${n}: 行不是 JSON 对象`);
    return;
  }
  const isMeta = obj.record === "meta";
  if (n === 1 && !isMeta) errors.push(`L1: 首行须为 meta 记录（record:"meta"，载 scope 范围句）`);
  if (n > 1 && isMeta) errors.push(`L${n}: meta 记录只许一行（首行）`);
  if (!isMeta) findings += 1;
  checkRow(obj, n, isMeta);
});

// batch ↔ meta scope 绑定（ADJ-27）：每个批次的标签必须出现在 meta 的范围句里——新批次
// 回填时若忘了扩写 scope，批次与范围句脱钩而无人发现（行数钉挡得住行数，挡不住这个）。
for (const b of batches) {
  if (!metaScope.includes(b)) {
    errors.push(`batch「${b}」未出现在 meta scope 文本里——回填新批次须同步扩写首行范围句`);
  }
}

if (errors.length > 0) {
  console.error(`[findings-lint] ${file} 不合规（${errors.length} 处）：`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
console.log(`[findings-lint] ${file} OK：${findings} findings + 1 meta（schemaVersion 1）`);
process.exit(0);
