// F1 红绿探针（0.5.0 M2 / goal v050-m2-freeze）：verify 回执三件。
// ①环境指纹补轴：envFingerprint 含 tzEffective（TZ 缺席时=生效时区）与 toolchain 工具链轴；
// ②回执腿清单：receipt.legs[] 直读 skip 计数与名单（node --test 摘要＋TAP # SKIP 行）；
// ③配方 cwd/outputs 根收容：绝对 cwd／.. 逃逸 outputs／设备源 outputs 在清单加载面拒绝
//   （writePaths/inputPaths 同族家法，core/project.js），inputPaths 收容回归仍拒。
// 真实表面＝隔离 HOME＋fixture 仓下 node 直调 runCheck（core/verify.js）与
// loadProjectManifest（core/project.js）。
// exit 1=存在未满足断言（改前红），0=全绿。
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const { runCheck } = await import(`file://${join(ROOT, "core", "verify.js")}`);
const { loadProjectManifest, ProjectError } = await import(`file://${join(ROOT, "core", "project.js")}`);

let failures = 0;
const check = (name, fn) => {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (e) {
    failures += 1;
    console.log(`FAIL - ${name}: ${e?.message ?? e}`);
  }
};
const assert = (cond, msg) => {
  if (!cond) throw new Error(msg);
};
const expectProjectError = (fn, needle) => {
  try {
    fn();
  } catch (e) {
    if (!(e instanceof ProjectError)) throw new Error(`非 ProjectError：${e?.message ?? e}`);
    assert((e.message ?? "").includes(needle), `报文缺「${needle}」：${e.message}`);
    return;
  }
  throw new Error("未拒绝（清单照常加载=收容缺口）");
};

function fixture(manifestChecks, extra = {}) {
  const d = mkdtempSync(join(tmpdir(), "lzy-f1-"));
  const g = (args) => spawnSync("git", args, { cwd: d, encoding: "utf8" });
  g(["init", "-q"]);
  g(["config", "user.email", "t@t"]);
  g(["config", "user.name", "t"]);
  writeFileSync(
    join(d, "lzy.project.json"),
    JSON.stringify({ schemaVersion: 1, capabilities: { check: manifestChecks } }, null, 1),
  );
  mkdirSync(join(d, "scripts"));
  writeFileSync(
    join(d, "scripts", "fake-suite.cjs"),
    "console.log('ℹ tests 3');console.log('ℹ pass 2');console.log('ℹ fail 0');" +
      "console.log('ℹ skipped 1');console.log('# SKIP - sqlite3 缺席');\n",
  );
  writeFileSync(join(d, "outside.txt"), "outside\n");
  mkdirSync(join(d, ".lazyzcode", "loop"), { recursive: true });
  writeFileSync(
    join(d, ".lazyzcode", "loop", "goal.json"),
    JSON.stringify({
      version: 2, slug: "fx", title: "fixture", status: "executing", attempt: 1, tier: "light", risk: "low",
      policy: { schemaVersion: 1 },
      contract: null, subjects: [],
      steps: [{ id: "N1", kind: "N", title: "do", status: "done", note: "did", acceptsRefs: [] }],
    }),
  );
  g(["add", "-A"]);
  g(["commit", "-qm", "init"]);
  if (extra.beforeRun) extra.beforeRun(d);
  return d;
}

const OK_ARGV = ["node", "scripts/fake-suite.cjs"];

// ── ①环境指纹补轴（tzEffective＋toolchain）──────────────────────────────
{
  const d = fixture([{ id: "ok", argv: OK_ARGV, env: ["TZ"], timeoutMs: 30000 }]);
  const { receipt } = runCheck(d, "ok", { note: "probe" });
  const fp = receipt.envFingerprint;
  check("envFingerprint.tzEffective 在场且=生效时区", () => {
    assert(typeof fp.tzEffective === "string" && fp.tzEffective.length > 0, `tzEffective 非法：${JSON.stringify(fp.tzEffective)}`);
    assert(fp.tzEffective === Intl.DateTimeFormat().resolvedOptions().timeZone, `tzEffective 与生效时区不符：${fp.tzEffective}`);
  });
  check("envFingerprint.toolchain 在场（node/git/sqlite3 逐项）", () => {
    const tc = fp.toolchain;
    assert(tc && typeof tc === "object", `toolchain 缺席：${JSON.stringify(fp)}`);
    for (const k of ["node", "git", "sqlite3"]) {
      assert(typeof tc[k] === "string" && tc[k].length > 0, `toolchain.${k} 缺席或非字符串`);
    }
  });
  check("envFingerprint 旧轴回归（platform/arch/nodeVersion/TZ/vars）", () => {
    assert(fp.platform === process.platform && fp.arch === process.arch, "platform/arch 变化");
    assert(fp.nodeVersion === process.version, "nodeVersion 变化");
    assert("vars" in fp && typeof fp.vars.TZ === "string", "vars.TZ 缺席");
  });
  rmSync(d, { recursive: true, force: true });
}

// ── ②回执腿清单（legs[]：skip 计数＋TAP 名单直读）───────────────────────
{
  const d = fixture([{ id: "ok", argv: OK_ARGV, env: [], timeoutMs: 30000 }]);
  const { receipt } = runCheck(d, "ok", { note: "probe" });
  check("receipt.legs 在场且直读 skip 计数与名单", () => {
    assert(Array.isArray(receipt.legs), `legs 缺席或非数组：${JSON.stringify(receipt.legs)}`);
    const suite = receipt.legs.find((l) => l.name === "node-test");
    assert(suite && suite.status === "pass", `node-test 腿缺席或误判：${JSON.stringify(suite)}`);
    assert(/skipped=1/.test(suite.reason ?? ""), `skip 计数不在回执直读面：${suite?.reason}`);
    const skip = receipt.legs.find((l) => l.status === "skip" && /sqlite3 缺席/.test(l.reason ?? ""));
    assert(skip, `TAP skip 名单未入回执：${JSON.stringify(receipt.legs)}`);
  });
  rmSync(d, { recursive: true, force: true });
}

// ── ③配方 cwd/outputs 根收容（清单加载面负例×3＋inputPaths 收容回归）───────
{
  const rejectCase = (name, over, needle) => {
    const d = fixture([Object.assign({ id: "x", argv: OK_ARGV, timeoutMs: 30000 }, over)]);
    try {
      check(name, () => expectProjectError(() => loadProjectManifest(d), needle));
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  };
  rejectCase("绝对 cwd 拒绝（清单加载面）", { id: "abs-cwd", cwd: "/tmp" }, "cwd");
  rejectCase(".. 逃逸 outputs 拒绝", { id: "esc-outputs", outputs: ["../escape.txt"] }, "outputs");
  rejectCase("设备源/绝对 outputs 拒绝", { id: "dev-outputs", outputs: ["/dev/null"] }, "outputs");
  rejectCase("inputPaths 收容回归（../outside.txt 拒绝）", { id: "esc-inputs", inputPaths: ["../outside.txt"] }, "inputPaths");
}

console.log(failures === 0 ? "F1 probe: ALL GREEN" : `F1 probe: ${failures} assertion(s) failed`);
process.exit(failures === 0 ? 0 : 1);
