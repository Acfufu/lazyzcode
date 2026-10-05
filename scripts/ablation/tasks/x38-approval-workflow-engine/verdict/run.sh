#!/usr/bin/env bash
set -u
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
cat > "$TMP/full_check.mjs" <<'JSEOF'
import { pathToFileURL } from "node:url";
const { createWorkflow, WorkflowError } = await import(pathToFileURL(process.cwd() + "/src/workflow.mjs").href);
let pass = 0, fail = 0;
function eq(name, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log("FAIL " + name + " got=" + g + " want=" + w); }
}
function ok(name, cond) { if (cond) { pass++; } else { fail++; console.log("FAIL " + name); } }
function thr(name, fn, code) {
  try { fn(); fail++; console.log("FAIL " + name + " (no throw)"); }
  catch (e) {
    if (!code) { pass++; return; }
    if ((e.code === code) || (e.constructor && e.constructor.name === code)) pass++;
    else { fail++; console.log("FAIL " + name + " wrong error " + (e.code || e.constructor.name)); }
  }
}
function fresh() { return createWorkflow({ author: "ann" }); }
// 合法转移
ok("draft submit", fresh().transit("submit", "ann") === "in_review");
{
  const w = fresh(); w.transit("submit", "ann");
  ok("review approve", w.transit("approve", "bob") === "approved");
}
{
  const w = fresh(); w.transit("submit", "ann");
  ok("review reject", w.transit("reject", "bob", { reason: "bad" }) === "rejected");
}
{
  const w = fresh(); w.transit("submit", "ann");
  ok("review escalate", w.transit("escalate", "bob") === "escalated");
}
{
  const w = fresh(); w.transit("submit", "ann"); w.transit("escalate", "bob");
  ok("escalated approve", w.transit("approve", "carol") === "approved");
}
{
  const w = fresh(); w.transit("submit", "ann"); w.transit("escalate", "bob");
  ok("escalated reject", w.transit("reject", "carol", { reason: "no" }) === "rejected");
}
{
  const w = fresh(); w.transit("submit", "ann"); w.transit("reject", "bob", { reason: "x" });
  ok("rejected resubmit", w.transit("submit", "ann") === "in_review");
}
{
  const w = fresh(); ok("draft withdraw", w.transit("withdraw", "ann") === "withdrawn");
}
{
  const w = fresh(); w.transit("submit", "ann");
  ok("in_review withdraw", w.transit("withdraw", "ann") === "withdrawn");
}
// 非法转移（全矩阵补）
{
  const w = fresh();
  thr("approve in draft", () => w.transit("approve", "bob"), "ILLEGAL_TRANSITION");
  thr("reject in draft", () => w.transit("reject", "bob", { reason: "x" }), "ILLEGAL_TRANSITION");
  thr("escalate in draft", () => w.transit("escalate", "bob"), "ILLEGAL_TRANSITION");
  thr("withdraw by non-author", () => w.transit("withdraw", "bob"), "ILLEGAL_TRANSITION");
}
{
  const w = fresh(); w.transit("submit", "ann");
  thr("submit from in_review", () => w.transit("submit", "ann"), "ILLEGAL_TRANSITION");
  thr("withdraw by non-author 2", () => w.transit("withdraw", "bob"), "ILLEGAL_TRANSITION");
}
{
  const w = fresh(); w.transit("submit", "ann"); w.transit("approve", "bob");
  thr("anything from approved", () => w.transit("submit", "ann"), "ILLEGAL_TRANSITION");
}
{
  const w = fresh(); w.transit("withdraw", "ann");
  thr("anything from withdrawn", () => w.transit("submit", "ann"), "ILLEGAL_TRANSITION");
}
// 守卫顺序与编码
{
  const w = fresh(); w.transit("submit", "ann");
  thr("self approve", () => w.transit("approve", "ann"), "SELF_REVIEW");
  thr("self reject", () => w.transit("reject", "ann", { reason: "x" }), "SELF_REVIEW");
  thr("reject no reason", () => w.transit("reject", "bob"), "REASON_REQUIRED");
  thr("reject empty reason", () => w.transit("reject", "bob", { reason: "" }), "REASON_REQUIRED");
}
// WorkflowError 形态
{
  const w = fresh();
  try { w.transit("approve", "bob"); } catch (e) {
    ok("instanceof WorkflowError", e instanceof WorkflowError);
    ok("name", e.name === "WorkflowError");
    ok("code", e.code === "ILLEGAL_TRANSITION");
  }
}
// 日志
{
  const w = fresh(); w.transit("submit", "ann");
  ok("failed not logged yet", w.log.length === 1);
  try { w.transit("approve", "ann"); } catch {}
  ok("failed attempt not logged", w.log.length === 1);
  w.transit("approve", "bob");
  eq("log entries shape", w.log, [
    { from: "draft", action: "submit", actor: "ann", to: "in_review" },
    { from: "in_review", action: "approve", actor: "bob", to: "approved" },
  ]);
}
// 守卫顺序：author + no reason → SELF_REVIEW 优先于 REASON_REQUIRED
{
  const w = fresh(); w.transit("submit", "ann");
  thr("self review beats reason", () => w.transit("reject", "ann"), "SELF_REVIEW");
}
console.log("SCORE " + pass + "/" + (pass + fail));
if (fail > 0) { console.log("VERDICT: FAIL"); process.exit(1); }
console.log("VERDICT: PASS");
JSEOF
node "$TMP/full_check.mjs"
