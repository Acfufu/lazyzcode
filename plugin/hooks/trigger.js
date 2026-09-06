#!/usr/bin/env node
// UserPromptSubmit 触发词钩子：用户消息含 zw / ulw / ultrawork 时注入 zw 技能引导。
// 不含触发词一律 {} 静默；任何异常 fail-open（绝不劫持无关会话）。
import { emit, failOpen, readStdinJson } from "./hook-lib.js";

const TRIGGER_RE = /(^|[^a-z0-9_-])(zw|ulw|ultrawork)([^a-z0-9_-]|$)/i;

try {
  const input = readStdinJson();
  const prompt = typeof input?.prompt === "string" ? input.prompt : "";
  if (!TRIGGER_RE.test(prompt)) failOpen();

  emit({
    additionalContext:
      "[lzy] Trigger word detected — the user invoked the LazyZCode goal loop. " +
      "Invoke the Skill tool with skill \"lazyzcode:zw\" now and follow its protocol exactly: " +
      "your first user-visible line must be the ZW engagement banner with the tier, " +
      "then register/plan/execute with evidence per the skill. Do not treat this prompt as ordinary work.",
  });
  process.exit(0);
} catch {
  failOpen();
}
