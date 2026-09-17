#!/usr/bin/env node
// 变体装配（ADR-0015，goal true-ablation-full-flow#N4）：整包树拷贝（排除集见 common）
// → 按变体剪 plugin/ 子目录 → `<pkg>/cli/lzy.js install` 装进 trial HOME（HOME 双换 +
// LZY_ZCODE_ENGINE 显式指引擎，防候选表在隔离 HOME 下扑空）→ install 自带引擎官方
// plugins enable（ADR-0001：对 config.json 零写入沿红线）。B 变体不装（裸引擎对照）。
//
// CLI：node scripts/ablation/install-variant.mjs --variant <A-F> --home <trialHome> [--rebuild]
// 库：  import { installVariant, ensureVariantPkg } from "./install-variant.mjs"
import { spawnSync } from "node:child_process";
import { argv, exit } from "node:process";
import { ensureVariantPkg, resolveEngine, VARIANTS } from "./common.mjs";

export function installVariant(variant, { home, rebuild = false, engine = null } = {}) {
  const def = VARIANTS[variant];
  if (!def) throw new Error(`未知变体：${variant}`);
  if (!home) throw new Error("installVariant：home 必填");
  if (!def.install) {
    return { variant, installed: false, note: "B 变体：trial HOME 不装插件（裸引擎对照）" };
  }
  const pkg = ensureVariantPkg(variant, { rebuild });
  const enginePath = engine || resolveEngine();
  const r = spawnSync(process.execPath, [`${pkg}/cli/lzy.js`, "install"], {
    cwd: pkg,
    encoding: "utf8",
    timeout: 120_000,
    shell: false,
    env: {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
      LZY_ZCODE_ENGINE: enginePath, // 隔离 HOME 下候选表必扑空；显式指真引擎
    },
  });
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  return {
    variant,
    installed: r.status === 0 && /已启用/.test(out),
    pkg,
    exit: r.status,
    out,
  };
}

if (import.meta.url === `file://${argv[1]}`) {
  try {
    const a = {};
    for (let i = 2; i < argv.length; i++) {
      if (argv[i] === "--variant") a.variant = argv[++i];
      else if (argv[i] === "--home") a.home = argv[++i];
      else if (argv[i] === "--rebuild") a.rebuild = true;
      else throw new Error(`未知参数：${argv[i]}`);
    }
    if (!a.variant || !a.home) {
      console.error("用法：--variant <A-F> --home <trialHome> [--rebuild]");
      exit(2);
    }
    const r = installVariant(a.variant, a);
    console.log(JSON.stringify({ ...r, out: (r.out ?? "").slice(0, 500) }, null, 2));
    exit(r.installed || r.variant === "B" ? 0 : 1);
  } catch (e) {
    console.error(`[install-variant] ${e?.message ?? e}`);
    exit(2);
  }
}
