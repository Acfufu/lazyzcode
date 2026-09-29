#!/usr/bin/env node
// 正式配对执行器（0.4.0 M5 N6；docs/plan-v040-engineering-policy.md §8.1 用例二/§9；goal
// v040-m5-eval-release）。**本工具不是产品授权写者**（scripts/evaluation/README §头注）。
//
// 用法（§8.1 合同）：
//   node scripts/evaluation/run-pairs.mjs --manifest scripts/evaluation/manifests/m0-freeze-index.json \
//     --baseline <0.3.1.tgz> --candidate <候选.tgz> --out <证据根> [--max-runs N] [--arm old|new] [--repo <名>]
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

// §9.2 质量门判定（报告层）：输入=逐 run 记录（oraclePassed/goalDone/legitimateStop 标记）。
// 返回 {met, reasons[]}——met=false 即「尚无质量收益证据」，不产晋级材料。
export function qualityGate(runs, { keyCounterexampleIds = [] } = {}) {
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
    if (armTrials("new").length > 0 && okOf(armTrials("new")) < 2) reasons.push(`${t}：新臂正确交付 ${okOf(armTrials("new"))}/${armTrials("new").length}（每任务须 ≥2/3）`);
  }
  const newOk = fresh.filter((r) => r.oraclePassed === true).length;
  const oldOk = base.filter((r) => r.oraclePassed === true).length;
  if (fresh.length > 0 && newOk < oldOk) reasons.push(`正确交付总数新臂 ${newOk} < 基线 ${oldOk}`);
  const strictBetter = newOk > oldOk || fresh.filter((r) => r.goalDone === true && r.oraclePassed === false).length < base.filter((r) => r.goalDone === true && r.oraclePassed === false).length;
  if (!strictBetter && reasons.length === 0) reasons.push("质量与基线打平且无一项严格改善——尚无质量收益证据");
  return { met: reasons.length === 0, reasons };
}

// ── oracle 子进程（内部模式）──────────────────────────────────────────
function evalOracle(oraclePath, repoDir, outPath) {
  const oracle = JSON.parse(readFileSync(oraclePath, "utf8"));
  const checks = (oracle.checks ?? []).map((c) => {
    let run;
    try {
      run = spawnSync("bash", ["-lc", String(c.command ?? "")], { cwd: repoDir, encoding: "utf8", timeout: ORACLE_TIMEOUT_MS });
    } catch (e) {
      run = { status: null, stdout: "", stderr: String(e?.message ?? e) };
    }
    const output = `${run.stdout ?? ""}${run.stderr ?? ""}`;
    const expect = c.expect == null ? null : String(c.expect);
    const ok = run.status === 0 && (expect == null || expect === "" || output.includes(expect));
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
    `使用本仓的目标循环纪律工具完成全链：${cliPath} loop register … → plan → start → 按步骤实施并取证（step done）→ finish。`,
    `lzy 一律用绝对路径 ${cliPath} 调用。契约文件建议写 repo 根 contract.md（endpoint A）。tier 自行判断。`,
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
    if (resumeLeg) {
      r = await spawnHeadless({ prompt, mode: "yolo", timeoutMs: wallMs, cwd: repoDir, home, deps: { run: runWithInterrupt({ repoDir, home, timeoutMs: wallMs }) } });
      // headless 基字段不透传 killedForResume/sessionId（失败分支只回 base+error）——恢复腿
      // 以 signal 面+转录 sid 判定中断发生（转录文件名含 sessionId，M0 发现一实证形态）。
      const sid = r.sessionId ?? findRolloutSid(home);
      const killed = r.signal === "SIGKILL" && !r.timedOut && sid != null;
      if (killed) {
        const elapsed = r.durationMs ?? 0;
        const r2 = await spawnHeadless({ prompt: "你被中断过。以 lzy loop 状态为准继续收尾本任务（不重启新目标）：完成未竟步骤并 finish；到限如实报告。", resume: sid, mode: "yolo", timeoutMs: Math.max(60_000, wallMs - elapsed), cwd: repoDir, home });
        rec.resumed = true;
        rec.sessionId = r2.sessionId ?? sid;
        rec.exit = r2.exitCode;
        rec.timedOut = Boolean(r2.timedOut);
        rec.raw = (r2.stdout ?? "").slice(-4000);
        if (!r2.ok && !r2.sessionId) rec.status = "resume-failed";
      } else {
        rec.sessionId = sid;
        rec.exit = r.exitCode;
        rec.timedOut = Boolean(r.timedOut);
        rec.status = "ok";
        rec.raw = (r.stdout ?? "").slice(-4000);
      }
    } else {
      r = await spawnHeadless({ prompt, mode: "yolo", timeoutMs: wallMs, cwd: repoDir, home });
      rec.sessionId = r.sessionId ?? null;
      rec.exit = r.exitCode;
      rec.timedOut = Boolean(r.timedOut);
      rec.raw = (r.stdout ?? "").slice(-4000);
    }
    if (rec.sessionId) {
      const pts = querySessionPoints(rec.sessionId, { dbPath: join(home, ".zcode", "cli", "db", "db.sqlite") });
      rec.points = pts?.absent ? null : pts.points;
      rec.metering = pts?.absent ? "absent" : "metered";
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
    if (rec.status === "infra" || rec.status === "ok") rec.status = rec.timedOut ? "timeout" : rec.exit === 0 ? "ok" : "nonzero-exit";
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
  const qg = qualityGate(runs, {});
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
    process.exit(0);
  }
  if (typeof f["eval-oracle"] === "string") {
    evalOracle(resolve(f["eval-oracle"]), resolve(f["eval-cwd"]), resolve(f["eval-out"]));
    return;
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
  const doneKeys = new Set(journal.lines.map((l) => `${l.seq}`));
  let executed = 0;
  const maxRuns = Number.isInteger(Number(f["max-runs"])) ? Number(f["max-runs"]) : Infinity;
  for (const cell of frozen.sequence) {
    if (executed >= maxRuns) break;
    if (doneKeys.has(String(cell.seq))) continue;
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
    const rep = writeReport(outDir, frozen, after.map((l) => l.record).filter(Boolean));
    if (rep.refused) {
      console.error(`[run-pairs] BLOCKED：完整性门拒（${JSON.stringify(rep.integrity)}）——删改结果/换环境后 report 必拒（V14）`);
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
