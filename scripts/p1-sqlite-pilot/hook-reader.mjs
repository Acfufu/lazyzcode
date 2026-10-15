#!/usr/bin/env node
// P1 N3 钩子读器原型（**不入 npm 包**）：自包含内联——**不 import core 与 statedb**，
// 镜像 plugin/hooks/trigger.js 的钩子纪律；读试点库 `.lazyzcode/state.sqlite` 解析交付批准短码。
// 七支与 trigger.js:61-131（queueDeliveryVerdict）逐一对齐：
//   approve / void（契约漂移）/ refuse-multi（多命中拒猜）/ candidates-no-match（有候选零命中）
//   / write-failed（写记录失败）/ unreadable（库不可读/schema 不识别）/ none（真零命中=落回信号）
// stdin = 钩子负载 {prompt, cwd, session_id}；`--apply` 写批准记录（形状与命名同 trigger.js:113-131），
// 缺省 dry（只输出判定）。输出=JSON {branch, additionalContext?, itemId?, ep?, hash?}；none={}。
// 纪律：任何异常 fail-open（零记录、exit 0、不阻断会话）；库缺席=落回信号（「迁移未做」分支属 P3 设计面）。
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const require = createRequire(import.meta.url);
const APPROVE_RE = /(?:批准|approve)\s*([0-9a-f]{8})\b/i;
const APPROVE_NEG_RE =
  /(?:不要?|不准|别|未|请勿|拒绝|勿|don['’]?t|do\s+not|not)\s*[^。！？\n，,、；;.?!]{0,6}(?:批准|approve)/i;
const NODE_FLOOR_MAJOR = 24;

function sanitizeSessionId(sessionId) {
  return String(sessionId).replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 128);
}

function queueDeliveryVerdict(cwd, short, sessionId, apply) {
  const major = Number(process.versions.node.split(".")[0]);
  if (!(major >= NODE_FLOOR_MAJOR)) {
    return {
      branch: "unreadable",
      additionalContext:
        `[lzy] State DB reader requires Node ≥24.0.0 (pilot floor, 2026-10-16; current v${process.versions.node}) — nothing was recorded; the queue gate stays closed.`,
    };
  }
  let sqlite;
  try {
    sqlite = require("node:sqlite");
  } catch {
    return {
      branch: "unreadable",
      additionalContext: `[lzy] node:sqlite unavailable — nothing was recorded; the queue gate stays closed.`,
    };
  }
  const dbPath = join(cwd, ".lazyzcode", "state.sqlite");
  if (!existsSync(dbPath)) return null; // 库缺席=本支零命中（落回信号）
  let db;
  try {
    db = new sqlite.DatabaseSync(dbPath, { readOnly: true });
  } catch (e) {
    return {
      branch: "unreadable",
      additionalContext: `[lzy] State DB unreadable (${e?.code ?? e?.name ?? "unknown"}) — nothing was recorded; the queue gate stays closed.`,
    };
  }
  let rows;
  try {
    const meta = db.prepare("SELECT value FROM meta WHERE key='schema_version'").get();
    if (!meta || String(meta.value) !== "1") {
      db.close();
      return {
        branch: "unreadable",
        additionalContext:
          `[lzy] State DB schema_version ${meta ? meta.value : "missing"} unrecognized — nothing was recorded; the queue gate stays closed.`,
      };
    }
    rows = db.prepare("SELECT id, goal_slug, state, delivery_json FROM queue_items").all();
    db.close();
  } catch (e) {
    try { db.close(); } catch {}
    return {
      branch: "unreadable",
      additionalContext: `[lzy] State DB unreadable (${e?.code ?? e?.name ?? "unknown"}) — nothing was recorded; the queue gate stays closed.`,
    };
  }
  const hits = [];
  const pendingCands = [];
  for (const r of rows) {
    if (["completed", "failed", "cancelled"].includes(r.state)) continue;
    let delivery = null;
    try { delivery = r.delivery_json ? JSON.parse(r.delivery_json) : null; } catch { continue; }
    for (const ep of ["B", "C"]) {
      const h = delivery?.[ep]?.hash;
      if (typeof h !== "string") continue;
      pendingCands.push(`${r.id}/${ep}（${h.slice(0, 8)}）`);
      if (h.slice(0, 8).toLowerCase() === short) {
        hits.push({ it: { id: r.id, goalSlug: r.goal_slug }, ep, hash: h, path: delivery[ep].path });
      }
    }
  }
  if (hits.length === 0) {
    if (pendingCands.length === 0) return null; // 真零命中=落回
    return {
      branch: "candidates-no-match",
      additionalContext:
        `[lzy] No pending approval matches this code. Queue delivery contracts awaiting approval: ${pendingCands.join("、")}. ` +
        `Ask the model for the exact approval sentence (「批准 <短码>」) and send it again. Nothing was recorded.`,
    };
  }
  if (hits.length > 1) {
    const cands = hits.map((x) => `${x.it.id}/${x.ep}（${x.hash.slice(0, 8)}）`).join("、");
    return {
      branch: "refuse-multi",
      additionalContext:
        `[lzy] Delivery approval code matches multiple queue items — refusing to guess (nothing was recorded): ${cands}. ` +
        `Ask the user to confirm which item/endpoint this approval is for.`,
    };
  }
  const { it, ep, hash, path } = hits[0];
  let cur = null;
  try {
    cur = createHash("sha256").update(readFileSync(resolve(cwd, path))).digest("hex");
  } catch {}
  if (cur !== hash) {
    return {
      branch: "void",
      additionalContext:
        `[lzy] Delivery contract of queue item ${it.id} (${ep}) changed since it was enqueued — the short code is void. ` +
        `Ask the model to re-enqueue the item with the updated contract for a fresh code. Nothing was recorded.`,
    };
  }
  if (!apply) {
    return {
      branch: "approve",
      dry: true,
      itemId: it.id,
      ep,
      hash,
      additionalContext:
        `[lzy] Human approval valid for delivery ${ep} of queue item ${it.id} (short code ${short}) — dry run, nothing was recorded.`,
    };
  }
  const authDir = join(cwd, ".lazyzcode", "authorizations");
  try {
    mkdirSync(authDir, { recursive: true });
    const sid = String(sessionId ?? "unknown");
    const name = `approval-${short}-${sanitizeSessionId(sid).slice(0, 24)}-${Date.now()}.json`;
    const tmp = join(authDir, `.${name}.${process.pid}.tmp`);
    writeFileSync(
      tmp,
      `${JSON.stringify({ version: 1, kind: "approval", slug: it.goalSlug, contractHash: hash, at: new Date().toISOString(), sessionId: sid }, null, 2)}\n`,
    );
    renameSync(tmp, join(authDir, name));
  } catch (err) {
    const reason = err?.code ?? err?.name ?? "unknown";
    return {
      branch: "write-failed",
      additionalContext:
        `[lzy] Delivery approval was valid but the authorization record could not be written (${reason}) — nothing was recorded and the queue gate stays closed. ` +
        `Check that .lazyzcode/authorizations is writable (not blocked by a file or a read-only mount) and that the disk has free space, then re-send the approval sentence.`,
    };
  }
  return {
    branch: "approve",
    itemId: it.id,
    ep,
    hash,
    additionalContext:
      `[lzy] Human approval recorded for delivery ${ep} of queue item ${it.id} (short code ${short}). ` +
      `The queue readiness gate releases the item once all declared authorizations are in place — run lzy queue list to see the readiness face.`,
  };
}

try {
  let input = null;
  try {
    const raw = readFileSync(0, "utf8");
    input = raw.trim() ? JSON.parse(raw) : null;
  } catch { input = null; }
  const cwd = typeof input?.cwd === "string" && input.cwd ? input.cwd : process.cwd();
  const sid = input?.sessionId ?? input?.session_id;
  const prompt = typeof input?.prompt === "string" ? input.prompt : "";
  const m = prompt.match(APPROVE_RE);
  if (!m || APPROVE_NEG_RE.test(prompt)) {
    process.stdout.write("{}");
    process.exit(0);
  }
  const verdict = queueDeliveryVerdict(cwd, m[1].toLowerCase(), sid, process.argv.includes("--apply"));
  process.stdout.write(JSON.stringify(verdict ?? {}));
  process.exit(0);
} catch (e) {
  // fail-open：任何异常零记录、不阻断（钩子家族纪律）
  try { process.stdout.write(JSON.stringify({ branch: "unreadable", additionalContext: `[lzy] reader failure (${e?.name ?? "Error"}) — nothing was recorded.` })); } catch {}
  process.exit(0);
}
