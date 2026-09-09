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
  withSessionLock,
  writeSessionState,
} from "./hook-lib.js";

const BARE_ZW_RE = /^\s*zw(?![a-z0-9_-])/i;
const EXPLICIT_RE = /lazyzcode[：:]zw/i;
const ALIAS_RE = /(^|[^a-z0-9_-])(ulw|ultrawork)([^a-z0-9_-]|$)/i;
// 唤起级别名（ADR-0004 修正案）：句首 ulw/ultrawork 是发起形态；句中「/ulw」是提及
// （ specimen：「对比 /ulw 的写法」曾误认领，致盲真主会话）。通知注入维持全谱 ALIAS_RE 不变。
const ALIAS_INITIAL_RE = /^\s*(ulw|ultrawork)(?![a-z0-9_-])/i;

try {
  const input = readStdinJson();
  const prompt = typeof input?.prompt === "string" ? input.prompt : "";
  if (!BARE_ZW_RE.test(prompt) && !EXPLICIT_RE.test(prompt) && !ALIAS_RE.test(prompt)) failOpen();

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
