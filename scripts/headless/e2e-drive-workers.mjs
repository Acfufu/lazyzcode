// E2E：drive workers 波编排实弹（v024-fast-scheduler#N4）——真引擎+真凭据双工人在
// scratch goal 上推进 3 独立步→波终组装重锚→finish→attestation 全链。
// 认证/引擎缺席=SKIP exit 0（沿 e2e-drive.mjs SKIP 家法；CI 永不触网）。
// 用法：node scripts/headless/e2e-drive-workers.mjs [--keep]
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(import.meta.url), "..", "..", "..");
const CLI = join(ROOT, "cli", "lzy.js");

function envAuthOk() {
  for (const key of ["ZCODE_BUILTIN_PROVIDER_CONFIG_FILE", "ZCODE_PERSONAL_PROVIDER_CONFIG_FILE"]) {
    const v = process.env[key];
    if (v && v.length > 0 && existsSync(v)) return true;
  }
  return false;
}
function engineOk() {
  if (process.env.LZY_ZCODE_ENGINE) return existsSync(process.env.LZY_ZCODE_ENGINE);
  const candidates = ["/Applications/ZCode.app/Contents/Resources/glm/zcode.cjs"];
  return candidates.some((c) => existsSync(c));
}

if (!envAuthOk() || !engineOk()) {
  console.log("[e2e-drive-workers] SKIP：env-auth 或引擎缺席（CI/无桌面会话形态；SKIP exit 0 契约）");
  process.exit(0);
}

const keep = process.argv.includes("--keep");
const stamp = new Date().toISOString().replace(/[-:T.]/g, "").slice(0, 14);
const base = mkdtempSync(join(tmpdir(), `lzy-e2e-dw-${stamp}-`));
const d = join(base, "host");
mkdirSync(d, { recursive: true });
const g = (args) => spawnSync("git", args, { cwd: d, encoding: "utf8" });

g(["init", "-q"]);
g(["config", "user.email", "e2e@trial"]);
g(["config", "user.name", "e2e"]);
writeFileSync(join(d, "README.md"), "# e2e-drive-workers seed\n");
g(["add", "-A"]);
g(["commit", "-qm", "seed"]);

const lzy = (args, env = {}) =>
  spawnSync(process.execPath, [CLI, ...args], {
    cwd: d,
    encoding: "utf8",
    timeout: 600_000,
    // 夹具自动化沿消融家法：人权门机器+钩子两层消融（真用户不在环；非被测面）。
    env: { ...process.env, LZY_ABLATE_HUMAN_GATE: "1", LZY_ABLATE_HOOK_HUMAN_GATE: "1", ...env },
  });

// scratch goal：三独立步（三文件，跨工人零交集），LIGHT + 人权门消融。
writeFileSync(
  join(d, "plan.md"),
  [
    "- [N1] 新增 n1.txt 内容为 one 并提交",
    "- [N2] 新增 n2.txt 内容为 two 并提交",
    "- [N3] 新增 n3.txt 内容为 three 并提交",
    "- [F1] F1 · 全物面（worker-local：任一工人断言其可核的 n*.txt 存在即取证；合并态由 finish 完整性闸门兜底）",
  ].join("\n"),
);
// plan.md 必须先提交（宿主根洁净 → finish 完整性闸门才可能放行）。
g(["add", "plan.md"]);
g(["commit", "-qm", "plan"]);
lzy(["loop", "register", `e2e-dw-${stamp}`, "--title", "drive workers e2e"]);
const planR = lzy(["loop", "plan", "plan.md"]);
if (planR.status !== 0) {
  console.error(`[e2e-drive-workers] plan 失败：${planR.stdout}${planR.stderr}`);
  process.exit(1);
}
lzy(["loop", "start"]);

const driveR = lzy(["loop", "drive", "--workers", "2", "--max-segments", "4", "--wall-ms", "1500000"]);
console.log(`[e2e-drive-workers] drive exit=${driveR.status}`);
console.log((driveR.stdout ?? "").split("\n").filter((l) => l.includes("[drive]")).join("\n"));

const checks = [];
const eq = (name, ok) => {
  checks.push(`${ok ? "ok" : "FAIL"} ${name}`);
  if (!ok) process.exitCode = 1;
};
const goal = JSON.parse(readFileSync(join(d, ".lazyzcode", "loop", "goal.json"), "utf8"));
eq("goal done", goal.status === "done");
eq("steps 4/4 done", (goal.steps ?? []).every((s) => s.status === "done"));
eq("attestation 在场", readdirSync(join(d, ".lazyzcode", "attestations")).filter((f) => f.endsWith(".json")).length > 0);
eq("三产物合流", ["n1.txt", "n2.txt", "n3.txt"].every((f) => existsSync(join(d, f))));
eq("workers 残留已清（done 清理相）", !existsSync(join(dirname(d), basename(d) + "-fast", `fast-${stamp}`)));

console.log(checks.join("\n"));
if (!keep) rmSync(base, { recursive: true, force: true });
else console.log(`[e2e-drive-workers] --keep：夹具保留 ${base}`);
process.exit(process.exitCode ?? 0);
