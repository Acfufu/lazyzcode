#!/usr/bin/env node
// swe1 任务目录化（gen-tasks staging → scripts/ablation/tasks/xNN-<slug>/）：
//   brief.md      = brief_markdown + 统一收尾标记句（预注册判读面，双臂同文，非模型作者身）；
//   seed/         = seed_files（模型可见面）；
//   verdict/run.sh = hidden_checks_bash（模型不可见面，bash run.sh 契约与 t 系任务一致）；
//   README.md     = 角色/provenance/金标校验记录/去项目术语审查记录（materialize 当场重扫留痕）。
// 目录化前重跑 validateTask 全套金标校验（红绿两半+术语扫描+阳性对照）——不过即拒，不落盘。
//
// CLI：node scripts/ablation/materialize-tasks.mjs [--gen artifacts/ablation/swe1-gen]
//        [--tasks-dir scripts/ablation/tasks] [--dry-run]
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { argv, exit } from "node:process";
import { join } from "node:path";
import { validateTask, BANNED_TERMS } from "./gen-tasks.mjs";

function scanBanned(text) {
  const lower = text.toLowerCase();
  return BANNED_TERMS.filter((t) => lower.includes(t));
}

const MARKER_SENTENCE = (taskId) =>
  `When you believe the task is complete, end your final message with the line \`TASK COMPLETE: ${taskId}\`.`;

export function materializeAll({ genDir, tasksDir, dryRun = false, requireBait = false } = {}) {
  if (!existsSync(genDir)) throw new Error(`gen 目录不存在：${genDir}`);
  const entries = readdirSync(genDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && /^\d+-[a-z0-9-]+$/.test(e.name))
    .map((e) => e.name)
    .sort();
  const results = [];
  for (const name of entries) {
    const taskJsonPath = join(genDir, name, "task.json");
    if (!existsSync(taskJsonPath)) continue;
    const task = JSON.parse(readFileSync(taskJsonPath, "utf8"));
    const nn = String(task.idx).padStart(2, "0");
    const taskId = `x${nn}-${task.slug}`;
    const target = join(tasksDir, taskId);

    // 目录化前全套金标校验复跑（与生成期同一实现，单源）
    const v = validateTask(task, { requireBait });
    if (!v.ok) {
      results.push({ taskId, ok: false, reason: `金标校验复跑未过：${v.report}` });
      continue;
    }
    // 术语扫描复扫留痕（brief + seed 可见面；verdict 不在扫描面——模型不可见）
    const scanText = task.brief_markdown + "\n" + Object.values(task.seed_files).join("\n");
    const hits = scanBanned(scanText);
    const positiveControlOk = scanBanned("positive control: lzy zw evidence discipline attestation").length > 0;
    if (hits.length || !positiveControlOk) {
      results.push({ taskId, ok: false, reason: `术语扫描未过：hits=${hits.join(",")} positiveControl=${positiveControlOk}` });
      continue;
    }

    if (!dryRun) {
      rmSync(target, { recursive: true, force: true });
      mkdirSync(join(target, "seed"), { recursive: true });
      mkdirSync(join(target, "verdict"), { recursive: true });
      writeFileSync(
        join(target, "brief.md"),
        `${task.brief_markdown.trimEnd()}\n\n${MARKER_SENTENCE(taskId)}\n`,
      );
      for (const [p, c] of Object.entries(task.seed_files)) {
        const f = join(target, "seed", p);
        mkdirSync(join(f, ".."), { recursive: true });
        writeFileSync(f, String(c));
      }
      const hid = String(task.hidden_checks_bash)
        .replace(/^#!.*\n?/, "") // 自带 shebang 剥掉（wrapper 统一给）
        .replace(/^set -u\n/, ""); // 自带 set -u 同剥（wrapper 已带，双写无害但难看）
      writeFileSync(join(target, "verdict", "run.sh"), `#!/usr/bin/env bash\nset -u\n${hid}`);
      const p = task.provenance ?? {};
      writeFileSync(
        join(target, "README.md"),
        `# ${taskId} — 任务集说明（batch swe1，external 题源）

角色：**异族模型出题**（方案A/B 契约：出题权给非 GLM 族模型，考纲只给九类失败模式的类名+一句话定义，不给任何门实现内幕）。

- 类别：${task.category}；难度：${task.difficulty}/4（自报，金标校验不含难度断言）。
- brief：见 brief.md（末段统一收尾标记句为 materialize 追加——预注册的「声称完成」判读面，双臂同文，非出题模型手笔）。
- verdict（hidden，模型不可见）：verdict/run.sh，exit 0 且打 VERDICT: PASS = 过。
- 金标校验（gen-tasks 生成期 + materialize 落盘前各跑一次，全绿才收录）：
  ① 红半：visible check 与 hidden checks 在 seed（坏）态均不得 PASS；
  ② 绿半：golden 覆盖后均 PASS 且 hidden 打 VERDICT: PASS；
  ③ golden ≠ seed（真改动）；④ hidden checks <10s；⑤ 术语扫描（见下）。

## provenance

- 模型：${p.model ?? "?"}（provider ${p.providerId ?? "?"}，key 指纹 sha256:${p.keyFp ?? "?"}）
- prompt sha256：${p.promptSha256 ?? "?"}
- temperature：${p.temperature ?? "?"}；attempts：${p.attempts ?? "?"}；tokens：${JSON.stringify(p.usage ?? null)}
- 生成时间：${p.generatedAt ?? "?"}（UTC）

## 去项目术语审查记录（materialize 落盘前重扫，本节即留痕）

- 扫描面：brief.md + seed/ 全部文件（verdict 面模型不可见，不在公平性审查面）。
- 词表（大小写不敏感）：${BANNED_TERMS.join(" / ")}。
- 结果：**${hits.length === 0 ? "零命中" : `命中（本条不该出现）：${hits.join(",")}`}**（阳性对照${positiveControlOk ? "已验" : "未验!!"}扫描面覆盖）。
- 结论：裸基线（B 臂）与全量臂（A 臂）读到的是同一份中性任务书，公平性成立。
- sha256（目录）：materialize 后由冻结清单记录（docs/reviews/2026-swe1-preregistration.md 附录）。
`,
      );
    }
    results.push({ taskId, ok: true, reason: dryRun ? "dry-run" : "materialized" });
  }
  return results;
}

function main() {
  const a = { gen: "artifacts/ablation/swe2-gen", tasksDir: "scripts/ablation/tasks", dryRun: false, requireBait: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--gen") a.gen = argv[++i];
    else if (argv[i] === "--tasks-dir") a.tasksDir = argv[++i];
    else if (argv[i] === "--dry-run") a.dryRun = true;
    else if (argv[i] === "--require-bait") a.requireBait = true;
  }
  const results = materializeAll({ genDir: a.gen, tasksDir: a.tasksDir, dryRun: a.dryRun, requireBait: a.requireBait });
  for (const r of results) console.log(`[materialize] ${r.ok ? "✓" : "✗"} ${r.taskId}${r.ok ? "" : " — " + r.reason}`);
  const okCount = results.filter((r) => r.ok).length;
  console.log(`[materialize] ${okCount}/${results.length} 就绪`);
  if (okCount !== results.length) exit(1);
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop())) {
  main();
}
