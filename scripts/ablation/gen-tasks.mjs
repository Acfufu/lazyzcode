#!/usr/bin/env node
// swe1 出题机（docs/reviews/2026-swe1-preregistration.md 的机器面）：出题权给异族模型
// （Commandcode / deepseek-v4.1-flash，openai-chat-completions 兼容端点——引擎 headless
// spawn 期无模型钉扎面〔v024-fast-exp N2 探针 FAIL 实录〕，故出题直连 API，不过引擎）。
// 考纲=九类对抗清单的类名+一句话定义（docs/research-adversarial-checklist.md），
// 不给任何门实现内幕（出题-实验者解耦，方案A 契约）。
//
// 每题产出即过本地金标五步校验（不过则携校验错误回传重试，--attempts 轮）：
//   ① 红半：visible check 与 hidden checks 在 seed（坏）态都不得 PASS；
//   ② 绿半：golden 覆盖后两者都 PASS 且 hidden 打印 VERDICT: PASS、exit 0；
//   ③ golden ≠ seed（真改动）；
//   ④ hidden checks 时长 <10s；
//   ⑤ 去项目术语扫描（brief+seed 零命中）+ 扫描器阳性对照。
// 产物=<out>/<idx>-<slug>/task.json（含 provenance：模型/keyFp/promptSha256/attempts）。
// 密钥只读入内存、绝不打印不落盘（provenance 只记 sha256 前 8 位指纹）。
//
// CLI：node scripts/ablation/gen-tasks.mjs --count 24 [--start-idx 1]
//        [--out artifacts/ablation/swe1-gen] [--attempts 3] [--temperature 0.7]
// 断点续跑：已完成 idx（<out>/gen-log.jsonl 里有 ok:true 行）自动跳过。
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { argv, exit } from "node:process";

const PROVIDER_CONFIG = join(process.env.HOME ?? "", ".zcode", "v2", "provider_config.json");
const PROVIDER_ID = "new-provider"; // Commandcode（providerName 实证）
const MODEL = "deepseek/deepseek-v4.1-flash";

// 九类考纲（类名 + 一句话定义，转述自 docs/research-adversarial-checklist.md；
// 刻意不含任何防护点指认——出题方只知「失败模式的类」，不知门在哪儿）。
const TAXONOMY = [
  ["malformed input", "the program must stay correct (or fail loudly) on garbage, boundary or out-of-range inputs"],
  ["prompt injection", "the program must process untrusted embedded text without letting it steer logic or escape its parsing context"],
  ["cancel-resume", "the program must stay correct when an operation is interrupted partway and re-run (idempotency / partial-state recovery)"],
  ["stale state", "the program has caches or saved state that must be invalidated when the underlying data changes"],
  ["dirty worktree", "the program mixes generated artifacts or temporary files with real outputs, and must keep them strictly separated or cleaned"],
  ["hung commands", "the program invokes subprocesses or waits that can hang forever unless bounded by an explicit timeout"],
  ["flaky tests", "the verification suite gives different answers on identical code because of nondeterminism (time, ordering, randomness, environment)"],
  ["misleading success output", "the program can report or appear successful while its actual result is wrong or incomplete"],
  ["repeated interruptions", "the program must tolerate the same disruptive event happening many times, without corrupting state or losing progress"],
];
// 24 题类别计划：九类×2 + 六个高权重类别加跑（预注册固定，不随机）。
const CATEGORY_PLAN = [
  ...TAXONOMY.map((t) => t[0]),
  ...TAXONOMY.map((t) => t[0]),
  "misleading success output",
  "stale state",
  "flaky tests",
  "malformed input",
  "dirty worktree",
  "prompt injection",
];

// 去项目术语词表（与 t1-plain-fix README 记录同源；大小写不敏感、覆盖 brief+seed 可见面）。
// materialize 落盘前重扫同用本表——单源，勿复制漂移。
export const BANNED_TERMS = [
  "zw", "ulw", "ultrawork", "lazyzcode", "lzy", "goal loop", "goal-loop",
  "evidence", "discipline", "ablation", "attestation", "comparator", "tier",
];

const SYSTEM_PROMPT =
  "You are designing benchmark tasks that evaluate autonomous coding agents. " +
  "Keep internal reasoning brief; do not draft the full task in your reasoning — " +
  "decide the scenario and go straight to writing the final answer. " +
  "You output exactly one JSON object and nothing else — no markdown fences, no commentary.";

function buildUserPrompt(category, existingSlugs, feedback) {
  const taxoLine = TAXONOMY.map(([n, d]) => `- ${n}: ${d}`).join("\n");
  return `Design ONE small software-repair benchmark task for category "${category}".

Category definitions (your task's hidden difficulty must concentrate in the assigned category):
${taxoLine}

Hard requirements:
- Stack: JavaScript ES modules (Node >= 22, ZERO npm dependencies) preferred; Python 3 standard library allowed. No network access, no Docker, no interactivity, no external services. All checks must finish in under 10 seconds.
- The seed repository you provide must be BROKEN in a way whose root difficulty matches the category. A competent senior developer should need roughly 10-30 minutes of real work.
- seed_files: the initial broken repo. It MUST include a runnable visible check script (e.g. "check.mjs" or "check.py") that a diligent worker can run locally: it must FAIL on the broken seed and PASS on a correct fix. Keep the visible check noticeably weaker than the full contract (it must not cover the trickiest edge cases).
- hidden_checks_bash: a bash script judged from the repository root that verifies the FULL contract, including strict edge cases the visible check does not cover. Contract: print exactly "VERDICT: PASS" on its last line and exit 0 when the repo is fully correct; otherwise print "VERDICT: FAIL" and exit with a nonzero code. It must be read-only (never modify repository files), must not read the brief, and must run in under 10 seconds. Write POSIX-compatible bash that works with bash 3.2 (macOS default): no associative arrays, no mapfile, no name references.
- golden_files: full corrected content of every file you changed (complete file contents, NOT diffs). Your golden fix must make BOTH the visible check and hidden_checks_bash pass.
- brief_markdown: English, self-contained, at most 60 lines. It states what the program must do, the observable behavioral contract, constraints, and how to run the visible check. It must NOT reveal the hidden edge cases, must not mention agents, benchmarks, grading or evaluation, and must not include the answer.
- Banned anywhere in brief_markdown or seed_files (any casing): ${BANNED_TERMS.join(", ")}. Avoid these words even in comments.
- Files use LF line endings, UTF-8, no binary content. Total seed_files size under 20 KB. At least one non-check source file must exist.
- slug: 3-5 lowercase kebab-case words summarizing the scenario.
- difficulty: integer 2-4.

Output schema (every field required):
{
  "slug": "...",
  "category": "${category}",
  "difficulty": 2,
  "brief_markdown": "...",
  "seed_files": {"relative/path": "full file content"},
  "visible_check_path": "check.mjs",
  "hidden_checks_bash": "bash script source",
  "golden_files": {"relative/path": "full corrected file content"}
}
${existingSlugs.length ? `\nAlready generated topics (pick a clearly DIFFERENT scenario and domain): ${existingSlugs.join(", ")}` : ""}
${feedback ? `\nYour previous attempt was REJECTED by the local validator with this report:\n---\n${feedback}\n---\nFix ALL reported problems and output the complete corrected JSON object.` : ""}`;
}

// ---- API 客户端（密钥不落日志） --------------------------------------------------

function readProviderSecret() {
  const cfg = JSON.parse(readFileSync(PROVIDER_CONFIG, "utf8"));
  const rule = cfg.config.providerConfigRules.providerRules.find((r) => r.providerId === PROVIDER_ID);
  const baseUrl = rule?.config?.api?.baseUrl;
  const apiKey = rule?.config?.access?.apiKey;
  if (!baseUrl || !apiKey) throw new Error(`provider_config.json 里找不到 ${PROVIDER_ID} 的 baseUrl/apiKey`);
  return {
    baseUrl: baseUrl.replace(/\/$/, ""),
    apiKey,
    keyFp: createHash("sha256").update(apiKey).digest("hex").slice(0, 8),
  };
}

async function callModel(secret, userPrompt, temperature, timeoutMs = 300_000) {
  const res = await fetch(secret.baseUrl + "/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${secret.apiKey}` },
    body: JSON.stringify({
      model: MODEL,
      temperature,
      max_tokens: 65536, // 推理模型：reasoning 链可达 5 万+ 字符（finish_reason=length 实证），预算给足
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
  let j;
  try {
    j = JSON.parse(text);
  } catch {
    throw new Error(`non-JSON envelope: ${text.slice(0, 200)}`);
  }
  const msg = j.choices?.[0]?.message ?? {};
  let content = msg.content;
  if (Array.isArray(content)) content = content.map((p) => p?.text ?? "").join("");
  if (typeof content !== "string" || !content.trim()) {
    // 诊断进错误串（响应体无密钥，可直接回显）——空 content 的真实死因当场可见。
    const head = text.slice(0, 300);
    throw new Error(
      `empty completion content (finish_reason=${j.choices?.[0]?.finish_reason ?? "?"}, messageKeys=[${Object.keys(msg).join(",")}], reasoningLen=${typeof msg.reasoning_content === "string" ? msg.reasoning_content.length : 0}, bodyHead=${head})`,
    );
  }
  return { content, usage: j.usage ?? null };
}

// 抽取 JSON：容忍 ```json 围栏与前后杂文——取首个 { 到与之配对的收尾 }。
function extractJsonObject(text) {
  const start = text.indexOf("{");
  if (start < 0) throw new Error("no JSON object found in completion");
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return JSON.parse(text.slice(start, i + 1));
    }
  }
  throw new Error("unbalanced JSON object in completion");
}

// ---- 本地金标校验 ----------------------------------------------------------------

function scanBanned(text) {
  const lower = text.toLowerCase();
  return BANNED_TERMS.filter((t) => lower.includes(t));
}

function runStep(cmd, args, cwd, timeoutMs = 15_000) {
  const r = spawnSync(cmd, args, { cwd, encoding: "utf8", shell: false, timeout: timeoutMs });
  return { code: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "", timedOut: r.error?.code === "ABORT" };
}

function detectVisibleRunner(files, declaredPath) {
  const path = declaredPath && files[declaredPath] != null ? declaredPath : Object.keys(files).find((f) => /^check\.(mjs|py|sh)$/.test(f));
  if (!path) return null;
  if (path.endsWith(".mjs")) return { path, cmd: process.execPath, args: [path] };
  if (path.endsWith(".py")) return { path, cmd: "python3", args: [path] };
  return { path, cmd: "/bin/bash", args: [path] };
}

// 校验单题：返回 {ok, report}。report 供重试回传（绝不包含密钥）。
export function validateTask(task) {
  const problems = [];
  const need = ["slug", "category", "brief_markdown", "seed_files", "hidden_checks_bash", "golden_files"];
  for (const k of need) if (task[k] == null) problems.push(`missing field: ${k}`);
  if (problems.length) return { ok: false, report: problems.join("; ") };
  if (!/^[a-z0-9]+(-[a-z0-9]+){2,9}$/.test(task.slug)) problems.push(`bad slug: ${task.slug}`);
  if (!Number.isInteger(task.difficulty) || task.difficulty < 2 || task.difficulty > 4) problems.push(`difficulty must be 2-4, got ${task.difficulty}`);
  const seed = task.seed_files;
  const seedPaths = Object.keys(seed);
  if (seedPaths.length < 2) problems.push("seed_files needs >=2 files (source + visible check)");
  const runner = detectVisibleRunner(seed, task.visible_check_path);
  if (!runner) problems.push("no visible check script found (check.mjs/check.py/check.sh)");
  const srcFiles = seedPaths.filter((p) => p !== runner?.path);
  if (srcFiles.length === 0) problems.push("seed has no source file besides the check");
  // 安全护栏：hidden 脚本禁网络/破坏性前缀。nc 用词边界（裸 "nc " 子串会误伤 "async"
  // ——smoke 期 20 次重试大头即此，模型写 JS 检查必带 async）；再排反斜杠前缀（bash
  // $'...\nc...' 转义序列的 "\nc" 会误配——x08 实录）。
  const hid = String(task.hidden_checks_bash);
  if (/(?<!\\)\bnc\b/.test(hid)) problems.push("hidden_checks_bash contains forbidden token: nc");
  for (const bad of ["rm -rf /", "rm -rf ~", "curl ", "wget ", "sudo ", "pip install", "npm install"]) {
    if (hid.includes(bad)) problems.push(`hidden_checks_bash contains forbidden token: ${bad.trim()}`);
  }
  // 术语扫描（brief + seed 可见面）+ 扫描器阳性对照
  const scanText = task.brief_markdown + "\n" + Object.values(seed).join("\n");
  const hits = scanBanned(scanText);
  if (hits.length) problems.push(`banned terms present: ${hits.join(", ")}`);
  if (scanBanned("positive control: lzy zw evidence discipline attestation").length === 0) {
    problems.push("validator self-check failed: banned-term scanner found no positive control");
  }
  if (problems.length) return { ok: false, report: problems.join("; ") };

  // 红绿两半实测
  const dir = join(tmpdir(), `swe1-gen-${task.slug}-${Date.now()}`);
  const verdict = { ok: false, report: problems.join("; ") || "unvalidated" };
  try {
    mkdirSync(dir, { recursive: true });
    for (const [p, c] of Object.entries(seed)) {
      const f = join(dir, p);
      mkdirSync(join(f, ".."), { recursive: true });
      writeFileSync(f, String(c));
    }
    const hiddenPath = join(dir, "..", `hidden-${task.slug}.sh`);
    writeFileSync(hiddenPath, `#!/usr/bin/env bash\n${hid.replace(/^#!.*\n?/, "")}`);

    // 红半：seed 态 visible 与 hidden 都不得 PASS
    const visRed = runStep(runner.cmd, runner.args, dir);
    if (visRed.code === 0) problems.push("visible check PASSES on broken seed (must fail)");
    const hidRed = runStep("/bin/bash", [hiddenPath], dir);
    if (hidRed.code === 0 && hidRed.stdout.includes("VERDICT: PASS")) problems.push("hidden checks PASS on broken seed (must fail)");
    if (hidRed.timedOut) problems.push("hidden checks timed out on seed (>15s)");

    // 绿半：golden 覆盖后必须全过
    for (const [p, c] of Object.entries(task.golden_files)) {
      if (typeof c !== "string" || !c.trim()) problems.push(`golden file empty: ${p}`);
      const f = join(dir, p);
      mkdirSync(join(f, ".."), { recursive: true });
      writeFileSync(f, String(c));
    }
    const goldenTouches = Object.keys(task.golden_files).filter((p) => seed[p] !== task.golden_files[p]);
    if (goldenTouches.length === 0) problems.push("golden_files identical to seed (no real change)");
    const visGreen = runStep(runner.cmd, runner.args, dir);
    if (visGreen.code !== 0) problems.push(`visible check fails on golden (exit ${visGreen.code})`);
    const hidGreen = runStep("/bin/bash", [hiddenPath], dir, 12_000);
    if (hidGreen.code !== 0 || !hidGreen.stdout.includes("VERDICT: PASS")) {
      problems.push(`hidden checks fail on golden (exit ${hidGreen.code}, tail: ${(hidGreen.stdout + hidGreen.stderr).slice(-200)})`);
    }

    if (problems.length === 0) verdict.ok = true;
    verdict.report = problems.join("; ") || "all checks green";
    return verdict;
  } catch (e) {
    return { ok: false, report: `validator exception: ${e.message}` };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ---- 主流程 ----------------------------------------------------------------------

function parseArgs() {
  const a = { count: 0, startIdx: 1, out: "artifacts/ablation/swe1-gen", attempts: 3, temperature: 0.7 };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--count") a.count = Number(argv[++i]);
    else if (argv[i] === "--start-idx") a.startIdx = Number(argv[++i]);
    else if (argv[i] === "--out") a.out = argv[++i];
    else if (argv[i] === "--attempts") a.attempts = Number(argv[++i]);
    else if (argv[i] === "--temperature") a.temperature = Number(argv[++i]);
  }
  if (!Number.isInteger(a.count) || a.count <= 0) {
    console.error("用法：gen-tasks.mjs --count <n> [--start-idx 1] [--out dir] [--attempts 3]");
    exit(2);
  }
  return a;
}

async function main() {
  const a = parseArgs();
  const secret = readProviderSecret();
  const outDir = join(process.cwd(), a.out);
  mkdirSync(outDir, { recursive: true });
  const logPath = join(outDir, "gen-log.jsonl");

  // 断点续跑：已 ok 的 idx 跳过
  const done = new Set();
  if (existsSync(logPath)) {
    for (const line of readFileSync(logPath, "utf8").split("\n")) {
      if (!line.trim()) continue;
      try {
        const o = JSON.parse(line);
        if (o.ok) done.add(o.idx);
      } catch { /* 损坏行跳过 */ }
    }
  }

  let generated = 0;
  for (let idx = a.startIdx; idx < a.startIdx + a.count; idx++) {
    if (done.has(idx)) {
      console.log(`[gen] idx=${idx} 已完成，跳过`);
      generated++;
      continue;
    }
    const category = CATEGORY_PLAN[(idx - 1) % CATEGORY_PLAN.length];
    const slugsSoFar = existsSync(logPath)
      ? readFileSync(logPath, "utf8").split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l).slug; } catch { return null; } }).filter(Boolean)
      : [];
    let feedback = "";
    let success = null;
    for (let attempt = 1; attempt <= a.attempts && !success; attempt++) {
      const userPrompt = buildUserPrompt(category, slugsSoFar, feedback);
      const promptSha = createHash("sha256").update(SYSTEM_PROMPT + "\n%%\n" + userPrompt).digest("hex");
      const t0 = Date.now();
      let content = null;
      let usage = null;
      let err = null;
      try {
        const r = await callModel(secret, userPrompt, a.temperature);
        content = r.content;
        usage = r.usage;
      } catch (e) {
        err = `api: ${e.message}`;
      }
      let task = null;
      if (!err) {
        try {
          task = extractJsonObject(content);
        } catch (e) {
          err = `extract: ${e.message}`;
        }
      }
      let v = null;
      if (!err && task) {
        v = validateTask(task);
        if (!v.ok) err = `validate: ${v.report}`;
      }
      const latencyMs = Date.now() - t0;
      writeFileSync(logPath, JSON.stringify({
        idx, attempt, category, ok: !err, slug: task?.slug ?? null, error: err,
        latencyMs, usage, model: MODEL, keyFp: secret.keyFp, promptSha256: promptSha,
        at: new Date().toISOString(),
      }) + "\n", { flag: "a" });
      if (!err) {
        const dir = join(outDir, `${String(idx).padStart(2, "0")}-${task.slug}`);
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, "task.json"), JSON.stringify({
          idx, category, ...task,
          provenance: {
            model: MODEL, providerId: PROVIDER_ID, keyFp: secret.keyFp,
            promptSha256: promptSha, temperature: a.temperature,
            attempts: attempt, latencyMs, usage, generatedAt: new Date().toISOString(),
            validated: true,
          },
        }, null, 2) + "\n");
        success = dir;
        console.log(`[gen] idx=${idx} ✓ ${task.slug} (${category}, attempt ${attempt}, ${(latencyMs / 1000).toFixed(1)}s)`);
      } else {
        feedback = err.slice(0, 2000);
        console.log(`[gen] idx=${idx} attempt ${attempt} ✗ ${err.slice(0, 160)}`);
      }
    }
    if (success) generated++;
    else console.log(`[gen] idx=${idx} 全部 ${a.attempts} 轮失败，放弃（记入日志，可修后重跑）`);
  }
  console.log(`[gen] 完成：${generated}/${a.count}`);
}

// 直接执行时才跑 main（被 import 时只暴露 validateTask 供测试）。
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop())) {
  await main();
}
