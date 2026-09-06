#!/usr/bin/env node
// SessionStart 钩子：会话开场注入目标循环现状（startup/resume/clear/compact 都触发）。
// 有 .lazyzcode/loop/goal.json 才说话；否则 {} 静默——绝不劫持无关会话。
import {
  emit,
  failOpen,
  inputCwd,
  readGoal,
  readStdinJson,
} from "./hook-lib.js";

try {
  const input = readStdinJson();
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
        ? `[lzy] 本目录有进行中的目标循环「${goal.slug} — ${goal.title}」` +
          `（${doneCount}/${steps.length} 步）。下一步 ${next.id} [${next.kind}] ${next.title}。` +
          `纪律：计划→执行→证据→不做完不停；收口用 node <lazyzcode>/cli/lzy.js step done ${next.id}` +
          (next.kind === "F" ? " --evidence <真实表面取证>" : "") +
          `。查看全局：node <lazyzcode>/cli/lzy.js loop status`
        : `[lzy] 本目录目标循环「${goal.slug}」全部步骤已收口，终验门未过：` +
          `运行 node <lazyzcode>/cli/lzy.js loop finish 完成 F 项证据时效终验。`,
    });
    process.exit(0);
  }

  if (goal.status === "planning") {
    emit({
      additionalContext:
        `[lzy] 本目录有目标「${goal.slug} — ${goal.title}」停在计划门：` +
        `写决策完备计划（N 项实现 / F 项终验，无待定）后 ` +
        `node <lazyzcode>/cli/lzy.js loop plan <文件> 采纳，再 loop start 开跑。`,
    });
    process.exit(0);
  }

  failOpen(); // done / abandoned：静默
} catch {
  failOpen();
}
