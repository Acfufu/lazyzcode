#!/usr/bin/env node
// PostToolUse comment-checker 轻钩子：Edit/Write 落盘内容里发现 TODO/FIXME/XXX/HACK
// 标记或调试残留（console.log/console.debug/debugger）时，经 additionalContext 轻提示。
// 纪律：goal.json 不在场即 {} 静默——绝不劫持无关会话（对齐 session-start.js）；
// 只提示不阻断（additionalContext 契约见逆向 zcode.cjs:36794-36796）；异常 fail-open。
import {
  emit,
  failOpen,
  inputCwd,
  readGoal,
  readStdinJson,
} from "./hook-lib.js";

const MARKER_RE = /\b(TODO|FIXME|XXX|HACK)\b/g;
const DEBUG_RE = /\b(console\.(log|debug)|debugger)\b/g;
const MAX_LISTED = 5;
const MAX_DETAIL = 300;

function findHits(re, text, label) {
  const hits = [];
  for (const m of text.matchAll(re)) {
    // 行号按 new_string/content 片段内计算：标注「片段L…」如实呈现，不冒充文件行号（评审 R4-2）。
    const line = text.slice(0, m.index).split("\n").length;
    hits.push(`${label}:片段L${line} ${m[0]}`);
  }
  return hits;
}

function composeMessage(hits) {
  const listed = hits.slice(0, MAX_LISTED);
  let detail = listed.join("；");
  const overflow = hits.length - listed.length;
  if (overflow > 0) detail += `；…及 ${overflow} 处更多`;
  return (
    `[lzy] comment-checker：本次写入内容含 ${hits.length} 处待留意注释 → ${detail}。` +
    `若有意保留请忽略；若属临时调试/半成品标记，建议在收口前清理（只提示，不阻断）。`
  );
}

try {
  const input = readStdinJson();
  if (!input) failOpen(); // 无/坏 stdin：静默（评审 R1-2）
  const cwd = inputCwd(input);
  const goal = readGoal(cwd);
  // 只陪在跑的目标：done/abandoned 的 goal.json 还在盘上，不得永远提示（评审 R4-1）；缺 status 视为在跑（兼容手工构造的状态）。
  if (!goal || (goal.status && goal.status !== "executing")) failOpen();

  const toolName = typeof input?.tool_name === "string" ? input.tool_name : "";
  const toolInput = input?.tool_input ?? {};
  const text =
    toolName === "Edit" && typeof toolInput.new_string === "string"
      ? toolInput.new_string
      : toolName === "Write" && typeof toolInput.content === "string"
        ? toolInput.content
        : "";
  if (!text) failOpen();

  const hits = [...findHits(MARKER_RE, text, "标记"), ...findHits(DEBUG_RE, text, "调试")];
  if (hits.length === 0) failOpen();

  // ≤300 守卫施加在最终整串上（评审 R4-3：原先只截内层 detail，守卫形同虚设）。
  let message = composeMessage(hits);
  if (message.length > MAX_DETAIL) message = `${message.slice(0, MAX_DETAIL)}…`;
  emit({ additionalContext: message });
  process.exit(0);
} catch {
  failOpen();
}
