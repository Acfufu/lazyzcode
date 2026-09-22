#!/usr/bin/env node
// provenance-ready 断言（v024-debt-bundle N4 / 债五）。
// 拍板（2026-09-23）：**不迁发布通道**——发布仍是维护者本机 2FA 直发，不产生 npm
// provenance（该能力仅 CI OIDC 发布生效）。本脚本只机械核验「若迁移则零障碍」的
// provenance-ready 形态三面：repository.url 归一化指向本仓 / name / 版本三体一致。
// 任一面破形=非零退出（发布清单发布前跑一次，见 release-checklist npm 节）。
import { readFileSync } from "node:fs";

const readJson = (p) => JSON.parse(readFileSync(new URL(`../${p}`, import.meta.url), "utf8"));

const errors = [];
const oks = [];

// ① repository.url 归一化比对：剥 git+ 前缀与尾部 .git/斜杠，host/path 大小写不敏感
//（现值 git+https://github.com/acfufu/lazyzcode.git）。
const pkg = readJson("package.json");
const rawUrl = typeof pkg.repository === "object" ? pkg.repository.url : pkg.repository;
const norm = String(rawUrl ?? "")
  .replace(/^git\+/i, "")
  .replace(/\.git\/?$/i, "")
  .toLowerCase();
try {
  const u = new URL(norm);
  if (u.hostname === "github.com" && u.pathname.replace(/^\/+|\/+$/g, "") === "acfufu/lazyzcode") {
    oks.push(`repository.url → github.com/acfufu/lazyzcode（原值 ${rawUrl}）`);
  } else {
    errors.push(`repository.url 归一化后非本仓：${norm}`);
  }
} catch {
  errors.push(`repository.url 不可解析：${rawUrl}`);
}

// ② name
if (pkg.name === "lazyzcode") oks.push(`name = lazyzcode`);
else errors.push(`name 非 lazyzcode：${pkg.name}`);

// ③ 版本三体一致：package.json + plugin/.zcode-plugin/plugin.json + marketplace plugins[]
const pluginJson = readJson("plugin/.zcode-plugin/plugin.json");
const market = readJson(".claude-plugin/marketplace.json");
const marketPlugins = Array.isArray(market.plugins) ? market.plugins : [];
const marketEntry = marketPlugins.find((p) => p?.name === "lazyzcode") ?? marketPlugins[0];
const triad = [
  ["package.json", pkg.version],
  ["plugin/.zcode-plugin/plugin.json", pluginJson.version],
  [".claude-plugin/marketplace.json plugins[].version", marketEntry?.version],
];
if (triad[0][1] && triad.every(([, v]) => v === triad[0][1])) {
  oks.push(`版本三体一致 = ${triad[0][1]}（${triad.map(([f]) => f).join(" · ")}）`);
} else {
  errors.push(`版本三体不一致：${triad.map(([f, v]) => `${f}=${v}`).join(" · ")}`);
}

for (const e of errors) console.error(`[provenance-ready] ✖ ${e}`);
if (errors.length > 0) process.exit(1);
for (const o of oks) console.log(`[provenance-ready] ✔ ${o}`);
console.log("[provenance-ready] OK：provenance-ready 形态三面全符（发布通道迁移与否归维护者拍板，非本脚本裁决）");
