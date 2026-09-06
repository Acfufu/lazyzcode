#!/usr/bin/env node
// UserPromptSubmit 触发词钩子（分层匹配）：
// - bare zw 只在 prompt 开头命中（「zw <任务>」是发起形态；句中提及高频，不触发）；
// - 显式全名 lazyzcode:zw（全半角冒号皆可）任意位置命中（显式调用形态）；
// - ulw / ultrawork 维持词边界任意位置命中（罕见长词，误触面小）。
// 不含触发词一律 {} 静默；任何异常 fail-open（绝不劫持无关会话）。
import { emit, failOpen, readStdinJson } from "./hook-lib.js";

const BARE_ZW_RE = /^\s*zw(?![a-z0-9_-])/i;
const EXPLICIT_RE = /lazyzcode[：:]zw/i;
const ALIAS_RE = /(^|[^a-z0-9_-])(ulw|ultrawork)([^a-z0-9_-]|$)/i;

try {
  const input = readStdinJson();
  const prompt = typeof input?.prompt === "string" ? input.prompt : "";
  if (!BARE_ZW_RE.test(prompt) && !EXPLICIT_RE.test(prompt) && !ALIAS_RE.test(prompt)) failOpen();

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
