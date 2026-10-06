#!/usr/bin/env node
// 正式配对执行器（0.4.0 M5 N6；docs/plan-v040-engineering-policy.md §8.1 用例二/§9；goal
// v040-m5-eval-release）。**本工具不是产品授权写者**（scripts/evaluation/README §头注）。
//
// 用法（§8.1 合同）：
//   node scripts/evaluation/run-pairs.mjs --manifest scripts/evaluation/manifests/m0-freeze-index.json \
//     --baseline <0.3.1.tgz> --candidate <候选.tgz> --out <证据根> [--max-runs N] [--arm old|new] [--repo <名>]
//   [--force-seq 1,2,…]（§9.1 失效配对整对重跑：旧行保留=尝试账，report 按 seq 取末行 supersede）
//   [--rejudge-oracle <证据根>]（仪面修复后存量判读腿重跑：agent 会话不重跑，supersede 行入账）
// 单调用语义：预飞 → batch manifest 冻结（seed 交错序）→ 执行未完成 cells（跨会话 resume 安全）
// → 全齐时 integrity report（§9.2 判据；不满足=「尚无质量收益证据」如实输出，不产晋级材料）。
// exit 0=进展或完成 · 1=失败 · 3=blocked（fail-closed 预飞/完整性拒）。
//
// 隔离纪律：任务 brief/缺陷配方/oracle 判据内容实现方不读——本工具只消费文件名、sha256 与
// 结构元数据；oracle 以子进程机械执行（--eval-oracle 内部模式，判据命令在夹具仓内运行）。
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { findEngine } from "../../core/paths.js";
import { spawnHeadless } from "../../core/headless.js";
import { querySessionPoints } from "../../core/cost.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..");
const ARMS = ["old", "new"];
const TRIALS_PER_TASK = 3;
const KILL_FLOOR_MS = 90_000; // 中断注入下限：转录在场后再跑满 floor 才杀（两臂同触发条件）
const ORACLE_TIMEOUT_MS = 120_000;

function parseArgs(argv) {
  const f = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const next = argv[i + 1];
    if (next != null && !next.startsWith("--")) {
      f[a.slice(2)] = next;
      i += 1;
    } else f[a.slice(2)] = true;
  }
  return f;
}

const sha256Of = (p) => createHash("sha256").update(readFileSync(p)).digest("hex");

// ── 纯函数（契约测试面）───────────────────────────────────────────────
// mulberry32：无 RNG 依赖的可重放派生（seed 固定于 M0 封存，evaluation README §运行序）。
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// seed 派生确定性交错序：基序=repo 字典序 × taskId 字典序 × trial 1..3 × arm(old,new)，
// Fisher-Yates（mulberry32(seed)）整体洗牌——同 seed 恒同序（无时钟无环境读数）。
export function deriveSequence(seed, repoTaskIds) {
  const runs = [];
  for (const repo of Object.keys(repoTaskIds).sort()) {
    for (const taskId of [...repoTaskIds[repo]].sort()) {
      for (let trial = 1; trial <= TRIALS_PER_TASK; trial += 1) {
        for (const arm of ARMS) runs.push({ repo, taskId, trial, arm });
      }
    }
  }
  const rand = mulberry32(seed >>> 0);
  for (let i = runs.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [runs[i], runs[j]] = [runs[j], runs[i]];
  }
  return runs.map((r, i) => ({ seq: i + 1, ...r }));
}

export function chainSha(prevSha, line) {
  return createHash("sha256").update(`${prevSha}\n${line}`).digest("hex");
}

// journal sha 链校验：line i 的 sha 字段必须=chainSha(prev, rawLine)； genesis="0".repeat(64)。
export function verifyJournalChain(lines) {
  let prev = "0".repeat(64);
  for (let i = 0; i < lines.length; i += 1) {
    const expect = chainSha(prev, lines[i].raw);
    if (lines[i].sha !== expect) return { ok: false, brokenAt: i + 1, reason: `第 ${i + 1} 行 sha 链断裂（篡改或删插）` };
    prev = lines[i].sha;
  }
  return { ok: true, brokenAt: null, last: prev };
}

// §评估资格判定（0.5.0 M0，plan-v050 §4 P0 收口）：与 §9.2 质量门分离的前置层。
// 资格不成立＝这批数据不能进入质量门判读——六类数据缺陷（缺任务/缺臂/缺 trial/重复 trial/
// 未知判读/身份与判读代次混杂）另加批清单冻结面三要素缺席；资格成立而门不满足＝
// 「尚无质量收益证据」。资格拒与质量门结论在报告层可判别（stage=evaluation-qualification）。
export function qualificationGate(runs, { batch, keyCounterexampleIds } = {}) {
  const reasons = [];
  const sequence = Array.isArray(batch?.sequence) ? batch.sequence : null;
  if (!sequence || sequence.length === 0) reasons.push("批清单无冻结序列（batch.sequence 缺席或空）——完整性无从核对");
  if (!batch?.repoTaskIds || typeof batch.repoTaskIds !== "object") reasons.push("批清单无任务集合（batch.repoTaskIds 缺席）");
  if (!Array.isArray(keyCounterexampleIds)) reasons.push("批清单未预注册关键反例清单（keyCounterexampleIds 字段缺席）——逐项反例判读无法绑定（存量批重出报告沿新批规则重冻结，不改旧批）");
  if (reasons.length > 0 || !sequence) return { eligible: false, reasons, stats: { sequenceCells: sequence?.length ?? 0, rows: runs.length, trialsByTask: new Map() } };

  // 预注册分母与格位表全部取自冻结序列——分母不再硬编码（plan-v050 §4 P0 验收）。
  const seqCellBySeq = new Map();
  const trialsByTask = new Map();
  const seqCellSeen = new Map();
  for (const c of sequence) {
    const cell = `${c.repo}/${c.taskId}::t${c.trial}::${c.arm}`;
    if (seqCellBySeq.has(c.seq)) reasons.push(`冻结序列 seq ${c.seq} 重复声明——序列损坏`);
    if (seqCellSeen.has(cell)) reasons.push(`冻结序列重复格位：${cell}（seq ${seqCellSeen.get(cell)} 与 seq ${c.seq}）——冻结面即损坏`);
    seqCellBySeq.set(c.seq, cell);
    seqCellSeen.set(cell, c.seq);
    const tk = `${c.repo}/${c.taskId}`;
    if (!trialsByTask.has(tk)) trialsByTask.set(tk, new Set());
    trialsByTask.get(tk).add(c.trial);
  }

  // 关键反例 id 须在冻结任务集内（0.5.0 M0 评审 F-2）：错形/悬空 id 静默降级「守住」＝假读数。
  const frozenTaskIds = new Set(sequence.map((c) => c.taskId));
  for (const id of keyCounterexampleIds) {
    if (typeof id !== "string" || !frozenTaskIds.has(id)) reasons.push(`关键反例 id 不在冻结任务集：${JSON.stringify(id)}——错形或悬空（核对批清单任务 id 形态，如全相对路径「<repo>/<task>」）`);
  }

  // 行面核对：重复 trial / 身份混杂 / 未知判读 / 判读代次混杂。
  const cellSeen = new Map();
  const judgeGens = new Set();
  const rowsByTask = new Map();
  for (const r of runs) {
    const tk = `${r.repo}/${r.taskId}`;
    if (!rowsByTask.has(tk)) rowsByTask.set(tk, []);
    rowsByTask.get(tk).push(r);
    const cell = `${tk}::t${r.trial}::${r.arm}`;
    if (cellSeen.has(cell)) reasons.push(`重复 trial：${cell}（seq ${cellSeen.get(cell)} 与 seq ${r.seq} 同格双行）`);
    else cellSeen.set(cell, r.seq);
    const expectCell = seqCellBySeq.get(r.seq);
    if (expectCell === undefined) reasons.push(`seq ${r.seq} 不在冻结序列内（${cell}）——身份混杂`);
    else if (expectCell !== cell) reasons.push(`seq ${r.seq} 记录格位 ${cell} ≠ 冻结序列 ${expectCell}——身份混杂`);
    if (r.status !== "skipped" && r.oraclePassed !== true && r.oraclePassed !== false) reasons.push(`未知判读：seq ${r.seq} ${cell}（oraclePassed=${String(r.oraclePassed)}）——判读缺席不记败，先 --rejudge-oracle 统一或 --force-seq 重跑该腿`);
    judgeGens.add(r.oracleJudge == null ? "v1(隐)" : `v${r.oracleJudge}`);
  }
  if (judgeGens.size > 1) reasons.push(`判读代次混杂（${[...judgeGens].sort().join(" × ")}）——判读代次须统一，先 --rejudge-oracle`);

  // 缺任务/缺臂/缺 trial：对批清单声明的任务集合逐格对表。
  for (const [repo, ids] of Object.entries(batch.repoTaskIds)) {
    for (const taskId of ids) {
      const tk = `${repo}/${taskId}`;
      const rows = rowsByTask.get(tk) ?? [];
      if (rows.length === 0) {
        reasons.push(`缺任务：${tk} 零行记录`);
        continue;
      }
      const expectedTrials = trialsByTask.get(tk);
      for (const arm of ARMS) {
        const armRows = rows.filter((r) => r.arm === arm);
        if (armRows.length === 0) {
          reasons.push(`缺臂：${tk} 无 ${arm} 臂记录`);
          continue;
        }
        if (expectedTrials) {
          for (const t of [...expectedTrials].sort()) {
            if (!armRows.some((r) => r.trial === t)) reasons.push(`缺 trial：${tk} ${arm} 臂缺 trial ${t}`);
          }
        }
      }
    }
  }
  return { eligible: reasons.length === 0, reasons, stats: { sequenceCells: sequence.length, rows: runs.length, trialsByTask } };
}

// §9.2 质量门判定（报告层）：输入=逐 run 记录（oraclePassed/goalDone/legitimateStop 标记）。
// 返回 {met, reasons[]}——met=false 即「尚无质量收益证据」，不产晋级材料。
// trialsByTask（0.5.0 M0）：预注册 trial 分母（Map tk→trial 数，出自冻结序列）——
// 每任务门槛=⌈2/3×预注册 trial 数⌉，不再硬编码成功数 2；缺席时回退 3（直接调用方兼容）。
export function qualityGate(runs, { keyCounterexampleIds = [], trialsByTask = null } = {}) {
  const reasons = [];
  const byArm = (arm) => runs.filter((r) => r.arm === arm && r.status !== "skipped");
  const fresh = byArm("new");
  const base = byArm("old");
  if (runs.length === 0) return { met: false, reasons: ["无已完成运行"] };
  for (const id of keyCounterexampleIds) {
    const bad = fresh.filter((r) => r.taskId === id && r.oraclePassed === false && r.goalDone === true);
    if (bad.length > 0) reasons.push(`关键反例 ${id}：新臂错误完成 ${bad.length} 次`);
  }
  const falseCompletions = fresh.filter((r) => r.goalDone === true && r.oraclePassed === false).length;
  if (falseCompletions > 0) reasons.push(`新臂关键错误完成 ${falseCompletions} 次（须=0）`);
  const tasks = [...new Set(runs.map((r) => `${r.repo}/${r.taskId}`))].sort();
  for (const t of tasks) {
    const armTrials = (arm) => fresh.concat(base).filter((r) => `${r.repo}/${r.taskId}` === t && r.arm === arm);
    const okOf = (rs) => rs.filter((r) => r.oraclePassed === true).length;
    const reg = trialsByTask?.get(t);
    const trialsRegistered = typeof reg === "number" ? reg : reg instanceof Set ? reg.size : 3;
    const need = Math.ceil((2 / 3) * trialsRegistered);
    if (armTrials("new").length > 0 && okOf(armTrials("new")) < need) reasons.push(`${t}：新臂正确交付 ${okOf(armTrials("new"))}/${armTrials("new").length}（每任务须 ≥${need}/${trialsRegistered}，预注册 trial 分母）`);
  }
  const newOk = fresh.filter((r) => r.oraclePassed === true).length;
  const oldOk = base.filter((r) => r.oraclePassed === true).length;
  if (fresh.length > 0 && newOk < oldOk) reasons.push(`正确交付总数新臂 ${newOk} < 基线 ${oldOk}`);
  const strictBetter = newOk > oldOk || fresh.filter((r) => r.goalDone === true && r.oraclePassed === false).length < base.filter((r) => r.goalDone === true && r.oraclePassed === false).length;
  if (!strictBetter && reasons.length === 0) reasons.push("质量与基线打平且无一项严格改善——尚无质量收益证据");
  return { met: reasons.length === 0, reasons };
}

// ── oracle 子进程（内部模式）──────────────────────────────────────────
// N9 仪面缺陷修复（2026-09-29，批内 36 run oracle 全零实证）：①密封判据命令引用 $FIXTURE
// 指向物化仓 ⇒ spawn 须注入 env（cwd 已是 repoDir，无注入时 bash 展开空串 `cd /packages/web`）；
// ②expect 为人读判据句——锚定「exit code 0」者按结构化解析（exit 0 + contains 标记逐个在
// 输出在场，标记=引号串或裸大写 token），其余（契约测试字面形态）保持字面子串语义。判定
// 主承载仍是判据命令自身退出码（探针脚本内部断言失败即非零、成功标记仅末尾打印）。
export function oracleExpectMarkers(expect) {
  const markers = [];
  const re = /contains\s+(?:"([^"]+)"|([A-Z][A-Z0-9_-]*(?:\s+[A-Z][A-Z0-9_-]+)*))/g;
  let m;
  while ((m = re.exec(expect)) != null) markers.push(m[1] ?? m[2]);
  return markers;
}

function evalOracle(oraclePath, repoDir, outPath) {
  const oracle = JSON.parse(readFileSync(oraclePath, "utf8"));
  const checks = (oracle.checks ?? []).map((c) => {
    let run;
    try {
      run = spawnSync("bash", ["-lc", String(c.command ?? "")], { cwd: repoDir, encoding: "utf8", timeout: ORACLE_TIMEOUT_MS, env: { ...process.env, FIXTURE: repoDir } });
    } catch (e) {
      run = { status: null, stdout: "", stderr: String(e?.message ?? e) };
    }
    const output = `${run.stdout ?? ""}${run.stderr ?? ""}`;
    const expect = c.expect == null ? null : String(c.expect);
    const structured = expect != null && expect.trim().startsWith("exit code 0");
    const markers = structured ? oracleExpectMarkers(expect) : null;
    const ok = run.status === 0 && (structured ? markers.every((mk) => output.includes(mk)) : expect == null || expect === "" || output.includes(expect));
    return { id: c.id, kind: c.kind ?? null, ok, exit: run.status, outputSample: output.slice(0, 400) };
  });
  const result = {
    task: oracle.task ?? null,
    passed: checks.length > 0 && checks.every((c) => c.ok),
    checksPassed: checks.filter((c) => c.ok).length,
    checksTotal: checks.length,
    legitimateStopNote: typeof oracle.legitimateStop === "string",
    checks,
  };
  writeFileSync(outPath, `${JSON.stringify(result, null, 2)}\n`);
  process.exit(result.passed ? 0 : 1);
}

// ── 预飞（fail-closed）───────────────────────────────────────────────
function sourceDirFor(repo, f) {
  if (typeof f[`source-${repo}`] === "string") return resolve(f[`source-${repo}`]);
  if (repo === "lazyzcode") return process.cwd();
  const home = process.env.HOME ?? "";
  const candidate = join(home, "Codehub", repo);
  return existsSync(candidate) ? candidate : null;
}

export function preflight(f, { cwd = process.cwd() } = {}) {
  const problems = [];
  const note = (m) => problems.push(m);
  const manifestPath = resolve(typeof f.manifest === "string" ? f.manifest : "");
  const baselinePath = resolve(typeof f.baseline === "string" ? f.baseline : "");
  const candidatePath = resolve(typeof f.candidate === "string" ? f.candidate : "");
  const outDir = resolve(typeof f.out === "string" ? f.out : "");
  if (!existsSync(manifestPath)) return { blocked: `--manifest 缺席：${manifestPath}` };
  if (!existsSync(baselinePath)) return { blocked: `--baseline 包缺席：${baselinePath}` };
  if (!existsSync(candidatePath)) return { blocked: `--candidate 包缺席：${candidatePath}` };
  if (!outDir || outDir === "/") return { blocked: "缺 --out <证据根>" };
  const index = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (index.schemaVersion !== 1) return { blocked: `清单 schemaVersion 不识别：${index.schemaVersion}` };
  const sealedRoot = resolve(REPO, index.evalSet.sealedRoot);
  if (!existsSync(sealedRoot)) return { blocked: `封存评估集实物缺席：${sealedRoot}（M0 evalsets 未物化）` };
  const manifestJson = join(sealedRoot, "MANIFEST.json");
  if (!existsSync(manifestJson)) return { blocked: `封存 MANIFEST.json 缺席：${manifestJson}` };
  const sealedSha = sha256Of(manifestJson);
  if (sealedSha !== index.evalSet.manifestSha256) return { blocked: `封存 MANIFEST sha256 不符（${sealedSha.slice(0, 12)}… ≠ 清单钉值 ${index.evalSet.manifestSha256.slice(0, 12)}…）——评估集被动过` };
  const sealed = JSON.parse(readFileSync(manifestJson, "utf8"));
  const repoTaskIds = {};
  const taskFiles = [];
  for (const [repo, rd] of Object.entries(sealed.repos)) {
    repoTaskIds[repo] = rd.tasks.map((t) => t.id);
    for (const t of rd.tasks) {
      // task.id 为全长相对路径（如 "lazyzcode/task-1"，M0 封存形态）——直接对 sealedRoot 拼，勿再前置 repo
      const dir = join(sealedRoot, t.id);
      for (const [file, key] of [["brief.md", "briefSha256"], ["defect-spec.md", "defectSpecSha256"], ["oracle.json", "oracleSha256"]]) {
        const p = join(dir, file);
        if (!existsSync(p)) return { blocked: `封存任务文件缺席：${t.id}/${file}` };
        if (sha256Of(p) !== t[key]) return { blocked: `封存任务文件 sha 不符：${t.id}/${file}（评估集被读改）` };
        taskFiles.push(`${t.id}/${file}`);
      }
    }
  }
  if (taskFiles.length !== index.evalSet.files - 1) note(`任务文件数 ${taskFiles.length} ≠ 清单 files-1（${index.evalSet.files - 1}）——以 MANIFEST 为准继续`);
  const srcDirs = {};
  for (const repo of Object.keys(sealed.repos)) {
    const src = sourceDirFor(repo, f);
    if (!src || !existsSync(join(src, ".git"))) return { blocked: `仓 ${repo} 本地源缺席（--source-${repo} <路径> 指认含冻结提交的本地克隆）` };
    const chk = spawnSync("git", ["-C", src, "cat-file", "-e", `${sealed.repos[repo].snapshotCommit}^{commit}`]);
    if (chk.status !== 0) return { blocked: `仓 ${repo} 本地源缺冻结提交 ${sealed.repos[repo].snapshotCommit.slice(0, 8)}——重冻结或补齐克隆后重跑` };
    srcDirs[repo] = src;
  }
  const engine = findEngine();
  if (!engine) return { blocked: "引擎未找到（findEngine）——真会话臂无法驱动，预飞阻塞" };
  // 原始授权标记：宿主活动 goal（本工具在 M5 goal 工作区内运行）
  const goalPath = join(cwd, ".lazyzcode", "loop", "goal.json");
  let auth = null;
  try {
    const goal = JSON.parse(readFileSync(goalPath, "utf8"));
    const snap = join(cwd, ".lazyzcode", "loop", "snapshots", `${goal.slug}.md`);
    auth = { slug: goal.slug, status: goal.status, planSnapshotSha: existsSync(snap) ? sha256Of(snap) : null };
    if (!["executing", "planning"].includes(goal.status)) note(`活动 goal 状态 ${goal.status}（非 executing/planning）——授权标记照录`);
  } catch {
    return { blocked: `原始授权标记缺席：${goalPath} 不可读或无活动 goal——正式配对须在已批准的 M5 goal 工作区内运行` };
  }
  const batch = {
    schemaVersion: 1,
    kind: "m5-eval-batch",
    batchId: `m5eval-${new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14)}`,
    createdAt: new Date().toISOString(),
    auth,
    manifest: { path: manifestPath, sha256: sha256Of(manifestPath) },
    packages: { baseline: { path: baselinePath, sha256: sha256Of(baselinePath) }, candidate: { path: candidatePath, sha256: sha256Of(candidatePath) } },
    env: { engine, node: process.version, tz: process.env.TZ ?? null, platform: process.platform },
    seed: sealed.seed,
    repoTaskIds,
    repos: Object.fromEntries(
      Object.entries(sealed.repos).map(([repo, rd]) => [repo, { snapshotCommit: rd.snapshotCommit, siblingDependency: rd.siblingDependency ?? null }]),
    ),
    sealedRoot,
    srcDirs,
    budgets: {},
    // 关键反例清单冻结面绑定（0.5.0 M0）：缺席记 null（报告层资格拒），显式数组照录。
    keyCounterexampleIds: Array.isArray(index.keyCounterexampleIds) ? index.keyCounterexampleIds : null,
    sequence: null,
  };
  const perRepoManifests = {};
  for (const [repo, rel] of Object.entries(index.manifests)) {
    const mp = resolve(REPO, rel);
    const m = JSON.parse(readFileSync(mp, "utf8"));
    perRepoManifests[repo] = m;
    batch.budgets[repo] = { wallMsPerRun: m.budget?.wallMsPerRun ?? null, pointsPerRun: m.budget?.pointsPerRun ?? null };
  }
  batch.sequence = deriveSequence(sealed.seed, repoTaskIds);
  return { batch, index, perRepoManifests, warnings: problems };
}

// ── 执行 ─────────────────────────────────────────────────────────────
function materializeRepo(srcDir, commit, dest) {
  mkdirSync(dest, { recursive: true });
  const r = spawnSync("bash", ["-c", `git -C '${srcDir}' archive '${commit}' | tar -x -C '${dest}'`], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`夹具物化失败：${r.stderr ?? r.stdout}`);
  spawnSync("git", ["init", "-q"], { cwd: dest });
  spawnSync("git", ["config", "user.email", "eval@l"], { cwd: dest });
  spawnSync("git", ["config", "user.name", "eval"], { cwd: dest });
  spawnSync("git", ["config", "commit.gpgsign", "false"], { cwd: dest });
  const gi = join(dest, ".gitignore");
  const ig = existsSync(gi) ? readFileSync(gi, "utf8") : "";
  if (!/^\.lazyzcode\/$/m.test(ig)) writeFileSync(gi, `${ig}${ig.endsWith("\n") || ig === "" ? "" : "\n"}.lazyzcode/\n`);
  spawnSync("git", ["add", "-A"], { cwd: dest });
  spawnSync("git", ["commit", "-qm", "eval fixture baseline"], { cwd: dest });
}

function extractPackage(tgz, dest) {
  if (existsSync(join(dest, "package", "cli", "lzy.js"))) return join(dest, "package");
  mkdirSync(dest, { recursive: true });
  const r = spawnSync("tar", ["-xzf", tgz, "-C", dest], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`包解压失败：${tgz}：${r.stderr}`);
  return join(dest, "package");
}

function findRolloutSid(home) {
  try {
    const roll = join(home, ".zcode", "cli", "rollout");
    if (!existsSync(roll)) return null;
    const f = readdirSync(roll).find((x) => x.startsWith("model-io-") && x.endsWith(".jsonl"));
    return f ? f.slice("model-io-".length, -".jsonl".length) : null;
  } catch {
    return null;
  }
}

function buildPrompt({ repoDir, briefPath, cliPath, pointsCap, wallMin }) {
  return [
    `你是任务执行代理，在仓库 ${repoDir} 完成一个开发任务。`,
    `任务需求全文见：${briefPath}（只含需求，不含验收判据——不要寻找或猜测额外判据）。`,
    `使用本仓的目标循环纪律工具完成全链：${cliPath} loop register … → plan（--review 附一行自评）→ start → 按步骤实施并取证（step done，证据=真实表面读数）→ finish。`,
    `lzy 一律用绝对路径 ${cliPath} 调用。不要创建需求契约（无人权门通道，直用 planHash 门）；tier 自行判断。`, 
    `预算：本 run 上限 ${pointsCap} 积分 / ${wallMin} 分钟墙钟。到限即收尾并如实报告未完成项，不伪报完成。`,
  ].join("\n");
}

// 中断注入 run：deps.run 包装——转录文件在场且跑满 KILL_FLOOR_MS 后 SIGKILL（两臂同触发）。
function runWithInterrupt({ repoDir, home, timeoutMs }) {
  return ({ argv, cwd, env }) =>
    new Promise((res) => {
      const child = spawn(process.execPath, argv, { cwd, env, shell: false });
      let stdout = "";
      let stderr = "";
      let settled = false;
      const started = Date.now();
      child.stdout?.on("data", (d) => {
        stdout += d;
      });
      child.stderr?.on("data", (d) => {
        stderr += d;
      });
      const finish = (payload) => {
        if (settled) return;
        settled = true;
        clearInterval(poll);
        clearTimeout(timer);
        res({ stdout, stderr, ...payload });
      };
      const poll = setInterval(() => {
        let sid = null;
        try {
          const roll = join(home, ".zcode", "cli", "rollout");
          if (existsSync(roll)) {
            const f = readdirSync(roll).find((x) => x.startsWith("model-io-") && x.endsWith(".jsonl"));
            if (f) sid = f.slice("model-io-".length, -".jsonl".length);
          }
        } catch {}
        if (sid && Date.now() - started >= KILL_FLOOR_MS) {
          try {
            child.kill("SIGKILL");
          } catch {}
          setTimeout(() => finish({ exitCode: null, signal: "SIGKILL", killedForResume: true, sessionId: sid }), 800).unref();
        }
      }, 500);
      const timer = setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {}
        finish({ exitCode: null, signal: "SIGKILL", timedOut: true });
      }, timeoutMs);
      child.on("close", (code, signal) => finish({ exitCode: code, signal }));
    });
}

async function runCell(cell, ctx) {
  const { batch, outDir, index } = ctx;
  const runDir = join(outDir, "runs", `${String(cell.seq).padStart(2, "0")}-${cell.repo}-${cell.taskId}-t${cell.trial}-${cell.arm}`);
  const repoDir = join(runDir, "repo");
  const home = join(runDir, "home");
  const started = new Date().toISOString();
  const rec = { ...cell, runDir, startedAt: started, sessionId: null, points: null, metering: "absent", exit: null, timedOut: false, resumed: false, goalDone: false, oraclePassed: null, oraclePath: null, status: "infra", note: null };
  try {
    const rd = batch.repos[cell.repo];
    rmSync(runDir, { recursive: true, force: true }); // N9 修复：force-seq 重跑复用同 runDir 必须整目录复位（repo/home/oracle-result 全新）——先例缺陷=seq1/2 重跑在残留仓上叠加（materializeRepo 原为 tar 覆盖语义）
    materializeRepo(batch.srcDirs[cell.repo], rd.snapshotCommit, repoDir);
    if (rd.siblingDependency) {
      const sibDest = join(runDir, basename(rd.siblingDependency.repo));
      materializeRepo(rd.siblingDependency.repo, rd.siblingDependency.snapshotCommit, sibDest);
    }
    const briefSrc = join(batch.sealedRoot, cell.taskId, "brief.md");
    const briefPath = join(runDir, "brief.md");
    writeFileSync(briefPath, readFileSync(briefSrc));
    const cliPath = cell.arm === "old" ? ctx.pkgBaselineCli : ctx.pkgCandidateCli;
    const budget = batch.budgets[cell.repo] ?? {};
    const wallMs = budget.wallMsPerRun ?? 1_800_000;
    const pointsCap = budget.pointsPerRun ?? null;
    mkdirSync(home, { recursive: true });
    const resumeLeg = cell.trial === TRIALS_PER_TASK; // 每任务 trial 3=中断恢复腿（两臂同触发）
    const prompt = buildPrompt({ repoDir, briefPath, cliPath, pointsCap: pointsCap ?? "未设", wallMin: Math.round(wallMs / 60000) });
    let r;
    let resumeFailNote = null; // N9 仪面缺陷修复：resume 注记原在 killed 块外引用块内 const r2 ⇒ ReferenceError（seq35 实证）——改经闭包变量带出
    const evalEnv = { LZY_ABLATE_HUMAN_GATE: "1" }; // 受控消融（#25）：无人权门通道的 headless 评估语境（M0/M4 夹具同款）
    if (resumeLeg) {
      r = await spawnHeadless({ prompt, mode: "yolo", timeoutMs: wallMs, cwd: repoDir, home, extraEnv: evalEnv, deps: { run: runWithInterrupt({ repoDir, home, timeoutMs: wallMs }) } });
      // headless 基字段不透传 killedForResume/sessionId（失败分支只回 base+error）——恢复腿
      // 以 signal 面+转录 sid 判定中断发生（转录文件名含 sessionId，M0 发现一实证形态）。
      const sid = r.sessionId ?? findRolloutSid(home);
      const killed = r.signal === "SIGKILL" && !r.timedOut && sid != null;
      if (killed) {
        const elapsed = r.durationMs ?? 0;
        const r2 = await spawnHeadless({ prompt: "你被中断过。以 lzy loop 状态为准继续收尾本任务（不重启新目标）：完成未竟步骤并 finish；到限如实报告。", resume: sid, mode: "yolo", timeoutMs: Math.max(60_000, wallMs - elapsed), cwd: repoDir, home, extraEnv: evalEnv });
        rec.resumed = true;
        rec.sessionId = r2.sessionId ?? sid;
        rec.exit = r2.exitCode;
        rec.timedOut = Boolean(r2.timedOut);
        rec.raw = (r2.stdout ?? "").slice(-4000);
        if (!r2.ok && !r2.sessionId) {
          rec.status = "resume-failed";
          resumeFailNote = `resume 腿 r2 无会话返回：${String(r2.error ?? r2.stderr ?? "unknown").slice(0, 160)}`;
        }
      } else {
        rec.sessionId = sid;
        rec.exit = r.exitCode;
        rec.timedOut = Boolean(r.timedOut);
        rec.status = "ok";
        rec.raw = (r.stdout ?? "").slice(-4000);
      }
    } else {
      r = await spawnHeadless({ prompt, mode: "yolo", timeoutMs: wallMs, cwd: repoDir, home, extraEnv: evalEnv });
      rec.sessionId = r.sessionId ?? null;
      rec.exit = r.exitCode;
      rec.timedOut = Boolean(r.timedOut);
      rec.raw = (r.stdout ?? "").slice(-4000);
    }
    // 非_ok 态归因注记在终态归因后统一落（见 runCell 尾部）——resume 专注记经 resumeFailNote 带出
    if (rec.sessionId) {
      const db = join(home, ".zcode", "cli", "db", "db.sqlite");
      let pts = querySessionPoints(rec.sessionId, { dbPath: db });
      let mode = "metered";
      if (pts?.absent) {
        // 击杀/超时留非空 WAL ⇒ hostdb 守卫拒 immutable 回退（宁 null，M4 缺陷①语义）——
        // 评估账面改用 harness 侧 immutable 直读（已落盘行=击杀前已完成请求，M0 KILL-2 先例；
        // 如实标 metered-immutable，可能与引擎最终结算有差——账面注记）。
        const sql = `SELECT m.session_id AS sid, m.model_id AS model, m.started_at/3600000 AS h, SUM(m.input_tokens) AS it, SUM(m.cache_read_input_tokens) AS crt, SUM(m.output_tokens) AS ot FROM model_usage m WHERE m.session_id = '${rec.sessionId}' AND m.status = 'completed' GROUP BY sid, model, h`;
        const rr = spawnSync("sqlite3", [`file:${db}?immutable=1`, "-json", sql], { encoding: "utf8", timeout: 30_000 });
        if (rr.status === 0 && rr.stdout?.trim()) {
          try {
            const rows = JSON.parse(rr.stdout);
            const compute = (await import("../../core/cost.js")).computePoints;
            pts = { absent: false, unpriced: [], points: compute(rows) };
            mode = "metered-immutable";
          } catch {
            pts = { absent: true, unpriced: [], points: 0 };
          }
        }
      }
      rec.points = pts?.absent ? null : pts.points;
      rec.metering = pts?.absent ? "absent" : mode;
      if (pointsCap != null && rec.points != null && rec.points > pointsCap) rec.status = "budget-stopped";
    }
    const goalP = join(repoDir, ".lazyzcode", "loop", "goal.json");
    rec.goalDone = existsSync(goalP) ? JSON.parse(readFileSync(goalP, "utf8")).status === "done" : false;
    const oracleOut = join(runDir, "oracle-result.json");
    const ov = spawnSync(process.execPath, [fileURLToPath(import.meta.url), "--eval-oracle", join(batch.sealedRoot, cell.taskId, "oracle.json"), "--eval-cwd", repoDir, "--eval-out", oracleOut], { encoding: "utf8", timeout: ORACLE_TIMEOUT_MS + 30_000 });
    rec.oraclePath = existsSync(oracleOut) ? "oracle-result.json" : null;
    if (existsSync(oracleOut)) {
      const oj = JSON.parse(readFileSync(oracleOut, "utf8"));
      rec.oraclePassed = oj.passed;
      rec.oracleChecks = `${oj.checksPassed}/${oj.checksTotal}`;
    } else {
      rec.oracleError = (ov.stderr ?? "").slice(0, 200);
    }
    rec.oracleJudge = 2; // N9 仪面修复后判定器代次（v2=FIXTURE 注入+结构化 expect；--rejudge-oracle 以此去重）
    if (rec.status === "infra" || rec.status === "ok") rec.status = rec.timedOut ? "timeout" : rec.exit === 0 ? "ok" : "nonzero-exit";
    // 非_ok 态归因注记（infra/429/内容杀流 vs 任务性失败——§9.1 分标记；引擎错误尾注 200 字符）。
    // 终态归因后统一落：resume 专注记优先；终态 ok 不留腿1注记（seq23/30 曾把腿1击杀注记
    // 误挂到恢复成功的 ok 记录上）。
    if (resumeFailNote) rec.failNote = resumeFailNote;
    else if (rec.status !== "ok" && r && r.error) rec.failNote = String(r.error).slice(0, 200);
    void index;
  } catch (e) {
    rec.status = "infra";
    rec.note = String(e?.message ?? e).slice(0, 300);
  }
  rec.endedAt = new Date().toISOString();
  return rec;
}

export function loadJournal(outDir) {
  const jp = join(outDir, "journal.jsonl");
  if (!existsSync(jp)) return { path: jp, lines: [] };
  const lines = readFileSync(jp, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((rawLine) => {
      const parsed = JSON.parse(rawLine);
      const inner = typeof parsed.line === "string" ? parsed.line : rawLine; // 拆 {sha,line} 信封（写入面格式）
      let record = null;
      try {
        record = JSON.parse(inner);
      } catch {
        record = null;
      }
      return { raw: inner, sha: parsed.sha ?? null, record };
    });
  return { path: jp, lines };
}

export function appendJournal(outDir, rec) {
  const { path: jp, lines } = loadJournal(outDir);
  const prev = verifyJournalChain(lines);
  const prevSha = prev.ok ? prev.last : "0".repeat(64);
  const { raw: _omit, ...recClean } = rec;
  void _omit;
  const line = JSON.stringify(recClean);
  const entry = { sha: chainSha(prevSha, line), line };
  writeFileSync(jp, (lines.length ? `${readFileSync(jp, "utf8").trimEnd()}\n` : "") + `${JSON.stringify(entry)}\n`);
  return entry.sha;
}

export function writeReport(outDir, batch, runs) {
  const chain = verifyJournalChain(loadJournal(outDir).lines);
  const integrity = {
    journalChain: chain.ok,
    journalEntries: loadJournal(outDir).lines.length,
    packagesMatch:
      sha256Of(batch.packages.baseline.path) === batch.packages.baseline.sha256 && sha256Of(batch.packages.candidate.path) === batch.packages.candidate.sha256,
    envMatch: batch.env.node === process.version,
  };
  const integrityOk = integrity.journalChain && integrity.packagesMatch && integrity.envMatch;
  if (!integrityOk) {
    return { refused: true, integrity };
  }
  // 评估资格前置层（0.5.0 M0）：资格拒（stage=evaluation-qualification）独立于完整性拒与
  // §9.2 质量门——不完整批在此拦下，不进入质量门判读。关键反例清单绑定批清单预注册字段，
  // 缺席即资格拒；显式空数组＝声明「无」，逐项判读照常入报告。
  const keyCounterexampleIds = Array.isArray(batch.keyCounterexampleIds) ? batch.keyCounterexampleIds : null;
  const qualification = qualificationGate(runs, { batch, keyCounterexampleIds });
  if (!qualification.eligible) {
    return { refused: true, stage: "evaluation-qualification", qualification, integrity };
  }
  const qg = qualityGate(runs, { keyCounterexampleIds: keyCounterexampleIds ?? [], trialsByTask: qualification.stats.trialsByTask });
  const freshRows = runs.filter((r) => r.arm === "new" && r.status !== "skipped");
  const counterexampleItems = (keyCounterexampleIds ?? []).map((id) => {
    const bad = freshRows.filter((r) => r.taskId === id && r.oraclePassed === false && r.goalDone === true);
    return { id, falseCompletions: bad.length, verdict: bad.length === 0 ? "守住（0 次新臂错误完成）" : `命中（${bad.length} 次新臂错误完成——质量门拒因见 qualityGate.reasons）` };
  });
  const byPair = {};
  for (const r of runs) {
    const key = `${r.repo}/${r.taskId}/t${r.trial}`;
    byPair[key] = byPair[key] ?? {};
    byPair[key][r.arm] = { status: r.status, oraclePassed: r.oraclePassed, goalDone: r.goalDone, points: r.points, metering: r.metering, resumed: r.resumed };
  }
  const report = {
    schemaVersion: 1,
    batchId: batch.batchId,
    generatedAt: new Date().toISOString(),
    integrity,
    totals: {
      runs: runs.length,
      oraclePassed: runs.filter((r) => r.oraclePassed === true).length,
      goalDone: runs.filter((r) => r.goalDone).length,
      falseCompletionsNew: runs.filter((r) => r.arm === "new" && r.goalDone && r.oraclePassed === false).length,
      pointsByArm: {
        old: runs.filter((r) => r.arm === "old").reduce((s, r) => s + (r.points ?? 0), 0),
        new: runs.filter((r) => r.arm === "new").reduce((s, r) => s + (r.points ?? 0), 0),
      },
    },
    qualification: { eligible: true, sequenceCells: qualification.stats.sequenceCells, rows: qualification.stats.rows },
    counterexamples: { declared: keyCounterexampleIds?.length ?? 0, note: (keyCounterexampleIds?.length ?? 0) === 0 ? "批清单显式预注册为空" : null, items: counterexampleItems },
    qualityGate: qg,
    conclusion: qg.met ? "质量门满足（晋级材料见 qualityGate；采纳=维护者决定）" : "尚无质量收益证据（§9.2 不满足——不宣称通过，不产晋级材料）",
    pairs: byPair,
    runs,
  };
  writeFileSync(join(outDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  return { refused: false, report };
}

async function main() {
  const f = parseArgs(process.argv.slice(2));
  if (f.help === true) {
    console.log("用法: run-pairs.mjs --manifest <m0-freeze-index.json> --baseline <0.3.1.tgz> --candidate <候选.tgz> --out <证据根> [--max-runs N] [--arm old|new] [--repo <名>] [--phase preflight|report]");
    console.log("  内部模式: --eval-oracle <oracle.json> --eval-cwd <repo> --eval-out <result.json>");
    console.log("  重判模式: --rejudge-oracle <证据根>（对 journal 末行无 oracleJudge=v2 的记录仅重跑密封 oracle 判读腿——不重跑 agent 会话；supersede 行入账后重生成 report）");
    process.exit(0);
  }
  if (typeof f["eval-oracle"] === "string") {
    evalOracle(resolve(f["eval-oracle"]), resolve(f["eval-cwd"]), resolve(f["eval-out"]));
    return;
  }
  if (typeof f["rejudge-oracle"] === "string") {
    // N9 仪面缺陷修复的存量重判通道（2026-09-29）：旧 judge 无 $FIXTURE 注入且 expect 按字面
    // 解析 ⇒ 全批 oracle 判读机械失效；agent 会话与物化 repo 不受影响 ⇒ 仅重跑判读腿。
    const outDir = resolve(f["rejudge-oracle"]);
    const batchPath = join(outDir, "batch.json");
    if (!existsSync(batchPath)) {
      console.error(`[run-pairs] BLOCKED：重判模式缺 batch.json：${batchPath}`);
      process.exit(3);
    }
    const batch = JSON.parse(readFileSync(batchPath, "utf8"));
    const bySeqLatest = new Map();
    for (const l of loadJournal(outDir).lines) if (l.record?.seq != null) bySeqLatest.set(l.record.seq, l.record);
    let rejudged = 0;
    for (const rec of bySeqLatest.values()) {
      if (rec.oracleJudge === 2) continue; // 已是 v2 判定器产物（force-seq 重跑行）——不重复烧判读
      const repoDir = join(rec.runDir, "repo");
      if (!existsSync(repoDir)) continue;
      const oracleOut = join(rec.runDir, "oracle-result.json");
      const ov = spawnSync(process.execPath, [fileURLToPath(import.meta.url), "--eval-oracle", join(batch.sealedRoot, rec.taskId, "oracle.json"), "--eval-cwd", repoDir, "--eval-out", oracleOut], { encoding: "utf8", timeout: ORACLE_TIMEOUT_MS + 30_000 });
      const updated = { ...rec };
      if (existsSync(oracleOut)) {
        const oj = JSON.parse(readFileSync(oracleOut, "utf8"));
        updated.oraclePassed = oj.passed;
        updated.oracleChecks = `${oj.checksPassed}/${oj.checksTotal}`;
        updated.oraclePath = "oracle-result.json";
        delete updated.oracleError;
      } else {
        updated.oracleError = (ov.stderr ?? "").slice(0, 200);
      }
      updated.oracleJudge = 2;
      updated.rejudgedAt = new Date().toISOString();
      appendJournal(outDir, updated);
      rejudged += 1;
      console.log(`[run-pairs] ↻ rejudge seq=${rec.seq} ${rec.repo}/${rec.taskId} ${rec.arm} oracle=${updated.oraclePassed ?? "-"} (${updated.oracleChecks ?? "-"})`);
    }
    const after = loadJournal(outDir).lines;
    const latest = new Map();
    for (const l of after) if (l.record?.seq != null) latest.set(l.record.seq, l.record);
    const rep = writeReport(outDir, batch, [...latest.values()]);
    if (rep.refused) {
      if (rep.stage === "evaluation-qualification") {
        console.error(`[run-pairs] BLOCKED：评估资格拒——不具备评估资格：\n${rep.qualification.reasons.map((x) => `  - ${x}`).join("\n")}\n  （补齐配对 / --force-seq 重跑缺失腿 / --rejudge-oracle 统一判读代次后重出报告）`);
      } else {
        console.error(`[run-pairs] BLOCKED：完整性门拒（${JSON.stringify(rep.integrity)}）`);
      }
      process.exit(3);
    }
    console.log(`[run-pairs] rejudge ${rejudged} runs；report：${rep.report.conclusion}`);
    process.exit(0);
  }
  const pf = preflight(f);
  if (pf.blocked) {
    console.error(`[run-pairs] BLOCKED：${pf.blocked}`);
    process.exit(3);
  }
  const batch = pf.batch;
  batch._perRepo = pf.perRepoManifests; // 进程内用（预算已入 batch.budgets；不落盘）
  const outDir = resolve(f.out);
  mkdirSync(outDir, { recursive: true });
  const batchPath = join(outDir, "batch.json");
  if (!existsSync(batchPath)) {
    const serializable = Object.fromEntries(Object.entries(batch).filter(([k]) => !k.startsWith("_")));
    writeFileSync(batchPath, `${JSON.stringify(serializable, null, 2)}\n`);
    console.log(`[run-pairs] batch manifest 冻结：${batch.batchId}（seq ${batch.sequence.length} runs · seed ${batch.seed}）`);
  } else {
    const existing = JSON.parse(readFileSync(batchPath, "utf8"));
    if (existing.packages.baseline.sha256 !== batch.packages.baseline.sha256 || existing.packages.candidate.sha256 !== batch.packages.candidate.sha256) {
      console.error(`[run-pairs] BLOCKED：batch 已冻结但包身份漂移（${existing.batchId}）——R6 重冻结=新 out 根，不在原批上改`);
      process.exit(3);
    }
  }
  const frozen = JSON.parse(readFileSync(batchPath, "utf8"));
  if (f.phase === "preflight") {
    console.log(`[run-pairs] 预飞通过：提示 ${(pf.warnings ?? []).length} 项${(pf.warnings ?? []).length ? `（${pf.warnings.join("；")}）` : ""}；序列 ${frozen.sequence.length} runs`);
    process.exit(0);
  }
  const pkgBaseline = extractPackage(frozen.packages.baseline.path, join(outDir, "pkg-baseline"));
  const pkgCandidate = extractPackage(frozen.packages.candidate.path, join(outDir, "pkg-candidate"));
  const ctx = { batch: frozen, outDir, pkgBaselineCli: join(pkgBaseline, "cli", "lzy.js"), pkgCandidateCli: join(pkgCandidate, "cli", "lzy.js") };
  const journal = loadJournal(outDir);
  const doneKeys = new Set(journal.lines.map((l) => `${l.record?.seq ?? l.seq ?? ""}`)); // 信封重构后 seq 在 record 内（resume-skip 缺陷修复：曾读 l.seq=undefined 致整批重跑）
  const forceSeqs = new Set(String(f["force-seq"] ?? "").split(",").map((x) => x.trim()).filter(Boolean)); // §9.1 失效配对整对重跑：--force-seq 1,2,3（旧行保留=尝试账）
  let executed = 0;
  const maxRuns = Number.isInteger(Number(f["max-runs"])) ? Number(f["max-runs"]) : Infinity;
  for (const cell of frozen.sequence) {
    if (executed >= maxRuns) break;
    if (doneKeys.has(String(cell.seq)) && !forceSeqs.has(String(cell.seq))) continue;
    if (typeof f.arm === "string" && cell.arm !== f.arm) continue;
    if (typeof f.repo === "string" && cell.repo !== f.repo) continue;
    console.log(`[run-pairs] ▶ seq=${cell.seq} ${cell.repo}/${cell.taskId} t${cell.trial} ${cell.arm}`);
    const rec = await runCell(cell, ctx);
    appendJournal(outDir, rec);
    executed += 1;
    console.log(`[run-pairs] ✔ seq=${cell.seq} status=${rec.status} oracle=${rec.oraclePassed ?? "-"} points=${rec.points ?? "-"} metering=${rec.metering}`);
  }
  const after = loadJournal(outDir).lines;
  if (after.length >= frozen.sequence.length && f.phase !== "run-only") {
    // 同 cell 多行（resume-skip 缺陷期重复执行）按 seq 取末行=supersede（append-only 链不动，
    // 双行保留如实入账；harnessChanges 记录缺陷与处置）
    const bySeqLatest = new Map();
    for (const l of after) {
      const rec = l.record;
      if (rec?.seq != null) bySeqLatest.set(rec.seq, rec);
    }
    const rep = writeReport(outDir, frozen, [...bySeqLatest.values()]);
    if (rep.refused) {
      if (rep.stage === "evaluation-qualification") {
        console.error(`[run-pairs] BLOCKED：评估资格拒——不具备评估资格：\n${rep.qualification.reasons.map((x) => `  - ${x}`).join("\n")}\n  （补齐配对 / --force-seq 重跑缺失腿 / --rejudge-oracle 统一判读代次后重出报告）`);
      } else {
        console.error(`[run-pairs] BLOCKED：完整性门拒（${JSON.stringify(rep.integrity)}）——删改结果/换环境后 report 必拒（V14）`);
      }
      process.exit(3);
    }
    console.log(`[run-pairs] report：${rep.report.conclusion}`);
  } else {
    console.log(`[run-pairs] 进度 ${after.length}/${frozen.sequence.length}（--max-runs 分批推进；跨会话 resume 安全）`);
  }
  process.exit(0);
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
