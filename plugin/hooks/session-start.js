#!/usr/bin/env node
// SessionStart 钩子：会话开场注入目标循环现状（startup/resume/clear/compact 都触发）。
// 有 .lazyzcode/loop/goal.json 才说话；否则 {} 静默——绝不劫持无关会话。
// 注入净化（V021-ADJ-66）：slug/title/步标题来自工作区文件，进 additionalContext 前一律过
// sanitizeInjectText（剥控制字符/ANSI、折叠换行、≤200 字符）——宿主把 additionalContext 当
// 宿主指导注入，原样插入即「工作区数据伪装成宿主提示」（stop.js 两处同款）。
import {
  emit,
  failOpen,
  inputCwd,
  readGoal,
  readStdinJson,
  sanitizeInjectText,
} from "./hook-lib.js";

try {
  const input = readStdinJson();
  // LZY_ABLATE_HOOK_SESSION_START（ADR-0015）：恰 "1" = 开场广播全灭——stdin 已吃净后
  // 短路（emit {} + exit 0，failOpen 同款）；其余取值行为逐字段同。
  if (process.env.LZY_ABLATE_HOOK_SESSION_START === "1") failOpen();
  if (!input) failOpen(); // 无/坏 stdin：静默（评审 R1-2，对齐 stop.js）
  const cwd = inputCwd(input);
  const goal = readGoal(cwd);

  if (!goal) failOpen();

  const steps = Array.isArray(goal.steps) ? goal.steps : [];
  const doneCount = steps.filter((s) => s?.status === "done").length;

  if (goal.status === "executing") {
    const pending = steps.filter((s) => s?.status !== "done");
    const next = pending[0];
    emit({
      additionalContext: next
        ? `[lzy] 本目录有进行中的目标循环「${sanitizeInjectText(goal.slug)} — ${sanitizeInjectText(goal.title)}」` +
          `（${doneCount}/${steps.length} 步）。下一步 ${sanitizeInjectText(next.id)} [${sanitizeInjectText(next.kind)}] ${sanitizeInjectText(next.title)}。` +
          `纪律：计划→执行→证据→不做完不停；收口用 node <lazyzcode>/cli/lzy.js step done ${sanitizeInjectText(next.id)}` +
          (next.kind === "F" ? " --evidence <真实表面取证>" : "") +
          `。查看全局：node <lazyzcode>/cli/lzy.js loop status；发「zw 继续」即认领接管（ADR-0004）`
        : `[lzy] 本目录目标循环「${sanitizeInjectText(goal.slug)}」全部步骤已收口，终验门未过：` +
          `运行 node <lazyzcode>/cli/lzy.js loop finish 完成 F 项证据时效终验；` +
          `发「zw 继续」即认领接管（ADR-0004）。`,
    });
    process.exit(0);
  }

  if (goal.status === "planning") {
    emit({
      additionalContext:
        `[lzy] 本目录有目标「${sanitizeInjectText(goal.slug)} — ${sanitizeInjectText(goal.title)}」停在计划门：` +
        `写决策完备计划（N 项实现 / F 项终验，无待定）后 ` +
        `node <lazyzcode>/cli/lzy.js loop plan <文件> 采纳，再 loop start 开跑。`,
    });
    process.exit(0);
  }

  failOpen(); // done / abandoned：静默
} catch {
  failOpen();
}
