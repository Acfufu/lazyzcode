// findings ledger 契约测试（v024-debt-bundle N2；v024-dual-review N5 扩钉）：已提交 ledger
// 过 lint（exit 0 + 行数输出）+ 畸形夹具各形非零退出。行数钉 80=有意完整性绊线：回填新批次
// 须显式扩钉本断言并改 ledger meta scope——静默加行在此红（评审警示③的钉法声明）。
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(import.meta.url), "..", "..");
const LINT = join(ROOT, "scripts", "findings-lint.mjs");
const LEDGER = join(ROOT, "docs", "reviews", "findings-ledger.jsonl");

const runLint = (file) =>
  spawnSync(process.execPath, [LINT, file], { encoding: "utf8", timeout: 30_000 });

test("已提交 findings ledger 过 lint：exit 0 + 行数 80", () => {
  const r = runLint(LEDGER);
  assert.equal(r.status, 0, `lint 应过：${r.stdout}${r.stderr}`);
  assert.match(r.stdout, /80 findings/, `行数 80 输出须在场：${r.stdout}`);
});

test("畸形夹具：坏 JSON / 缺必填 / 枚举外 / id 重复 / fixed 缺指针 / landed 非 sha / batch 脱离 meta / 缺 meta 首行 ⇒ 全部非零", () => {
  const d = mkdtempSync(join(tmpdir(), "lzy-findings-lint-"));
  try {
    const meta = JSON.stringify({ record: "meta", schemaVersion: 1, scope: "测试夹具" });
    const good = JSON.stringify({
      id: "V9-ADJ-01", batch: "t", severity: "P2", verdict: "成立",
      disposition: "fixed", landed: "abc1234", source: "report §1",
    });
    const cases = [
      ["bad-json", `${meta}\n{"id": broken\n`],
      ["missing-field", `${meta}\n${JSON.stringify({ id: "V9-ADJ-01", batch: "t", severity: "P2", verdict: "成立", disposition: "fixed", landed: "abc1234" })}\n`],
      ["bad-severity", `${meta}\n${JSON.stringify({ ...JSON.parse(good), id: "V9-ADJ-01", severity: "P4" })}\n`],
      ["bad-verdict", `${meta}\n${JSON.stringify({ ...JSON.parse(good), id: "V9-ADJ-01", verdict: "存疑" })}\n`],
      ["bad-disposition", `${meta}\n${JSON.stringify({ ...JSON.parse(good), id: "V9-ADJ-01", disposition: "maybe" })}\n`],
      ["dup-id", `${meta}\n${good}\n${good}\n`],
      ["fixed-open-landed", `${meta}\n${JSON.stringify({ ...JSON.parse(good), id: "V9-ADJ-01", landed: "open" })}\n`],
      ["deferred-with-commit", `${meta}\n${JSON.stringify({ ...JSON.parse(good), id: "V9-ADJ-01", disposition: "deferred", landed: "abc1234" })}\n`],
      ["no-meta-first", `${good}\n`],
      // ADJ-27（v024-fix-round#N9）：landed 须 sha 形态、batch 须出现在 meta scope
      ["fixed-prose-landed", `${meta}\n${JSON.stringify({ ...JSON.parse(good), id: "V9-ADJ-01", landed: "OPEN" })}\n`],
      ["fixed-shortsha", `${meta}\n${JSON.stringify({ ...JSON.parse(good), id: "V9-ADJ-01", landed: "abc12" })}\n`],
      ["batch-not-in-meta", `${meta}\n${JSON.stringify({ ...JSON.parse(good), id: "V9-ADJ-01", batch: "other-batch", disposition: "deferred", landed: "open" })}\n`],
    ];
    for (const [name, content] of cases) {
      const f = join(d, `${name}.jsonl`);
      writeFileSync(f, content);
      const r = runLint(f);
      assert.notEqual(r.status, 0, `${name} 夹具应非零退出：${r.stdout}`);
    }
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});
