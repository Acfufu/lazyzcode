#!/usr/bin/env node
// PostToolUseFailure 空转绊线（ADR-0009 同批，incident-guardrails#N5）：同一 MCP 工具
// 在 TTL 窗口内连续失败时经 additionalContext 轻提示一次——换工具，或上下文已退化时
// 走交接收尾（lzy loop handoff）。事故背景：sess_95421d3d 同工具空转 79 连调 47 分钟。
// 纪律：goal.json 不在场即 {} 静默（对齐 comment-checker）；is_interrupt（用户手动取消）
// 不计数；「连续」=TTL 失败连击——成功事件不经过本钩子（PostToolUse 与 Failure 互斥，
// 引擎实锤 Z:427504/427557），计数只被 TTL 归零，绝不能被穿插的成功重置（事故中 44 次
// 成功穿插会把字面意义的「连续」永远清零）；每连击窗口只提示一次（warned 位防注入本身
// 变成上下文污染）；异常 fail-open。失败事件稀疏，仅失败时写盘。
import {
  emit,
  failOpen,
  inputCwd,
  inputSessionId,
  readGoal,
  readSessionState,
  readStdinJson,
  withSessionLock,
  writeSessionState,
} from "./hook-lib.js";

const TTL_MS = 10 * 60 * 1000;
const WARN_AT = 2;
const MAX_DETAIL = 300;

try {
  const input = readStdinJson();
  if (!input) failOpen();
  const cwd = inputCwd(input);
  const sessionId = inputSessionId(input);
  if (!sessionId) failOpen();
  const goal = readGoal(cwd);
  // 只陪在跑的目标（对齐 comment-checker；缺 status 视为在跑，兼容手工构造状态）。
  if (!goal || (goal.status && goal.status !== "executing")) failOpen();

  const isInterrupt = input.isInterrupt === true || input.is_interrupt === true;
  if (isInterrupt) failOpen(); // 用户手动取消不是模型空转

  const toolName = typeof input.tool_name === "string" ? input.tool_name : "";
  // 双保险：hooks.json 的 matcher 已收窄 ^mcp__（引擎侧过滤），此处防御 matcher 失配。
  if (!/^mcp__/.test(toolName)) failOpen();

  const now = Date.now();
  let warn = false;
  withSessionLock(cwd, sessionId, () => {
    const state = readSessionState(cwd, sessionId);
    const prev = state.toolFail;
    // 单槽记账：换工具即覆盖（窄起步，双审 P2 接受交替工具漏判）；TTL 过期归零重臂。
    const fresh =
      prev && prev.tool === toolName && now - (prev.lastAt ?? 0) <= TTL_MS
        ? { count: prev.count + 1, warned: prev.warned === true }
        : { count: 1, warned: false };
    warn = fresh.count >= WARN_AT && !fresh.warned;
    writeSessionState(cwd, sessionId, {
      toolFail: { tool: toolName, count: fresh.count, lastAt: now, warned: warn || fresh.warned },
    });
  });
  if (!warn) failOpen();

  const short = toolName.replace(/^mcp__/, "").replace(/^codegraph__/, "codegraph/");
  let message =
    `[lzy] 绊线：${short} 连续失败 ${WARN_AT} 次（10 分钟窗）。换工具或改查询方式；` +
    `若上下文已退化：写交接快照并 lzy loop handoff --snapshot <file> 收尾，` +
    `请用户开新上下文「zw 继续」（提示在新上下文才吸收得了）。同窗不重复提示。`;
  if (message.length > MAX_DETAIL) message = `${message.slice(0, MAX_DETAIL)}…`;
  emit({ additionalContext: message });
  process.exit(0);
} catch {
  failOpen();
}
