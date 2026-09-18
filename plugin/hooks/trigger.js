#!/usr/bin/env node
// UserPromptSubmit 触发词钩子（分层匹配）：
// - bare zw 只在 prompt 开头命中（「zw <任务>」是发起形态；句中提及高频，不触发）；
// - 显式全名 lazyzcode:zw（全半角冒号皆可）任意位置命中（显式调用形态）；
// - ulw / ultrawork 维持词边界任意位置命中（罕见长词，误触面小）。
// 不含触发词一律 {} 静默；任何异常 fail-open（绝不劫持无关会话）。
// 附带：唤起级触发（句首 zw / 显式技能名 / 句首 ulw·ultrawork，ADR-0004 修正案）且 goal
// 处于 executing 时登记会话认领；认领写失败不损注入。
import {
  emit,
  failOpen,
  inputCwd,
  inputSessionId,
  readGoal,
  readStdinJson,
  sanitizeSessionId,
  withSessionLock,
  writeSessionState,
} from "./hook-lib.js";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, renameSync } from "node:fs";
import { resolve, join } from "node:path";

const BARE_ZW_RE = /^\s*zw(?![a-z0-9_-])/i;
const EXPLICIT_RE = /lazyzcode[：:]zw/i;
const ALIAS_RE = /(^|[^a-z0-9_-])(ulw|ultrawork)([^a-z0-9_-]|$)/i;
// 唤起级别名（ADR-0004 修正案）：句首 ulw/ultrawork 是发起形态；句中「/ulw」是提及
// （ specimen：「对比 /ulw 的写法」曾误认领，致盲真主会话）。通知注入维持全谱 ALIAS_RE 不变。
const ALIAS_INITIAL_RE = /^\s*(ulw|ultrawork)(?![a-z0-9_-])/i;
// 人权门批准形态（0.1.1 goal1，ADR-0018）：恰「批准/approve + 8 位 hex 短码」；负向
// 后行断言屏蔽中文否定前置字（不/别）。多条命中取首个（钉死）。
const APPROVE_RE = /(?<![不别])(?:批准|approve)\s*([0-9a-f]{8})\b/i;

// 返回 null=落回既有触发词逻辑（零输出零 exit）；返回对象=恰一次 emit 后 exit 0
// （由调用方执行）。emit 文案零时间戳零文件名（双跑确定性不变量）；全分支异常
// fail-open——批准面绝不劫持会话，门保持关闭由 CLI 侧重试。
function approvalVerdict(input) {
  const prompt = typeof input?.prompt === "string" ? input.prompt : "";
  const m = prompt.match(APPROVE_RE);
  if (!m) return null;
  try {
    const cwd = inputCwd(input);
    const goal = readGoal(cwd);
    const pending = goal?.approvalPending;
    if (!pending?.planHash) return null;
    const short = String(pending.planHash).slice(0, 8).toLowerCase();
    if (m[1].toLowerCase() !== short) {
      return {
        additionalContext:
          `[lzy] Approval code mismatch — the pending plan short code is ${short}. ` +
          `Ask the model for the exact approval sentence (「批准 <短码>」) and send it again. Nothing was recorded.`,
      };
    }
    // exact-hash 复核：计划文件现内容必须仍哈希到 pending 值（批准后改计划=批准作废）。
    // planPath 取 pending 内（首次采纳时 goal.planPath 尚空、复采纳时指向旧计划）。
    let current = null;
    try {
      current = createHash("sha256").update(readFileSync(resolve(cwd, pending.planPath ?? goal.planPath))).digest("hex");
    } catch {}
    if (current !== pending.planHash) {
      return {
        additionalContext:
          `[lzy] Plan changed since this approval was requested — the short code is void. ` +
          `Ask the model to re-run the adoption command for a fresh code. Nothing was recorded.`,
      };
    }
    const dir = join(cwd, ".lazyzcode", "loop", "approvals");
    mkdirSync(dir, { recursive: true });
    const sid = String(inputSessionId(input) ?? "unknown");
    const name = `${short}-${sanitizeSessionId(sid).slice(0, 24)}-${Date.now()}.json`;
    const tmp = join(dir, `.${name}.${process.pid}.tmp`);
    writeFileSync(
      tmp,
      `${JSON.stringify({ version: 1, slug: goal.slug, planHash: pending.planHash, at: new Date().toISOString(), sessionId: sid }, null, 2)}\n`,
    );
    renameSync(tmp, join(dir, name));
    return {
      additionalContext:
        `[lzy] Human approval recorded for plan ${goal.slug} (short code ${short}). ` +
        `The model may now re-run the adoption command (lzy loop plan <file>) to pass the human gate.`,
    };
  } catch {
    return null;
  }
}

try {
  const input = readStdinJson();
  // LZY_ABLATE_HOOK_HUMAN_GATE（0.1.1 goal1，ADR-0015 形态）：恰 "1" 才消融；短路=径直
  // 落回既有触发词逻辑。批准分支整体置于 TRIGGER 消融短路之前——消融轴独立（TRIGGER
  // 臂不连带灭人权门）。
  if (process.env.LZY_ABLATE_HOOK_HUMAN_GATE !== "1") {
    const verdict = approvalVerdict(input);
    if (verdict) {
      emit(verdict);
      process.exit(0);
    }
  }
  // LZY_ABLATE_HOOK_TRIGGER（ADR-0015）：恰 "1" = 触发词层全灭——stdin 已吃净后短路
  // （emit {} + exit 0，failOpen 同款），注入/认领/哨兵旗标全不动；其余取值行为逐字段同。
  if (process.env.LZY_ABLATE_HOOK_TRIGGER === "1") failOpen();
  const prompt = typeof input?.prompt === "string" ? input.prompt : "";
  if (!BARE_ZW_RE.test(prompt) && !EXPLICIT_RE.test(prompt) && !ALIAS_RE.test(prompt)) failOpen();

  // 哨兵旗标（plan-v2 Phase 2-6）：wake prompt 含「无人值守」→ 记 unattended 入会话状态。
  // 写在 executing 闸门之外——无目标/planning 的空转 wake 也要记（wake_noop 遥测与 A'
  // 复活前置④依赖它）；认领块不动（claimedAt 仍限 executing）。宿主 wake 模板含
  // 「无人值守：只推进 executing 目标…」，交互会话正常不含该词（误触面=A' 缓刑已知边界）。
  try {
    const cwd = inputCwd(input);
    const sessionId = inputSessionId(input);
    if (sessionId && prompt.includes("无人值守")) {
      withSessionLock(cwd, sessionId, () => {
        writeSessionState(cwd, sessionId, { unattended: true, wakeAt: new Date().toISOString() });
      });
    }
  } catch {
    // 旗标写失败不影响注入
  }

  // 认领登记（ADR-0004，写面收窄见修正案）：executing 闸门 + 唤起级触发——句首 zw /
  // 显式 lazyzcode:zw / 句首 ulw·ultrawork 才写 claimedAt；句中提及只注入不认领，
  // 防「顺带提一句」的会话在任何仓库白拿认领资格；
  // 无人值守唤起（句首「zw 继续」）到达时 goal 必 executing，接管路径不受损。
  // 内层 try/catch：登记失败绝不影响下方注入。
  try {
    const cwd = inputCwd(input);
    const sessionId = inputSessionId(input);
    const invocational =
      BARE_ZW_RE.test(prompt) || EXPLICIT_RE.test(prompt) || ALIAS_INITIAL_RE.test(prompt);
    if (sessionId && invocational && readGoal(cwd)?.status === "executing") {
      withSessionLock(cwd, sessionId, () => {
        writeSessionState(cwd, sessionId, { claimedAt: new Date().toISOString() });
      });
    }
  } catch {
    // 认领登记失败 = 本会话暂不被拉回，注入照常
  }

  emit({
    additionalContext:
      "[lzy] Trigger word detected in the prompt (zw / lazyzcode:zw / ulw / ultrawork). " +
      "If the user is invoking the LazyZCode goal loop — e.g. the prompt starts with " +
      "\"zw <task>\" (like \"zw fix the login bug\" or \"zw 继续\"), commands ulw/ultrawork, " +
      "or names the lazyzcode:zw skill — invoke the Skill tool with skill \"lazyzcode:zw\" now " +
      "and follow its protocol exactly: your first user-visible line must be the ZW engagement " +
      "banner with the tier, then register/plan/execute with evidence per the skill. " +
      "If the prompt only mentions zw in passing — asking about zw's hooks, status, docs, or " +
      "discussing this project — do NOT engage the loop: ignore this notice and answer directly.",
  });
  process.exit(0);
} catch {
  failOpen();
}
