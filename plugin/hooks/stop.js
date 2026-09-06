#!/usr/bin/env node
// Stop 钩子：目标循环未完成时请求引擎续跑（不做完不停）。
// 纪律（源码+spike3 实锤）：非空 additionalContexts 才续跑；≤3 硬顶且与后台通知共享池；
// 状态按 sessionId 隔离、按 cwd 限定生效——没有 .lazyzcode/loop/goal.json 的目录一律 {} 放手。
import {
  MAX_STOP_CONTINUES,
  emit,
  failOpen,
  inputCwd,
  inputSessionId,
  readGoal,
  readSessionCounter,
  readStdinJson,
  withSessionLock,
  writeSessionCounter,
} from "./hook-lib.js";

try {
  const input = readStdinJson();
  if (!input) failOpen(); // 无/坏 stdin = 没有可靠输入，宁可放手也不凭空续跑（评审 R1-2）
  const cwd = inputCwd(input);
  const sessionId = inputSessionId(input);
  if (!sessionId) failOpen(); // 缺 sessionId 无法按会话记账；引擎恒供（spike 实锤），缺=异常输入
  const goal = readGoal(cwd);

  if (!goal || goal.status !== "executing") {
    failOpen(); // 无目标 / planning / done / abandoned：引擎说了算
  }

  const steps = Array.isArray(goal.steps) ? goal.steps : [];
  const pending = steps.filter((s) => s?.status !== "done");
  const doneCount = steps.length - pending.length;

  if (pending.length > 0) {
    const next = pending[0];
    // 计数器读改写套轻量锁：并发同 session 两读 used=0 会多发续跑（评审 R1-4）；
    // 锁拿不到就无锁放行，绝不阻断会话。
    const payload = withSessionLock(cwd, sessionId, () => {
      const used = readSessionCounter(cwd, sessionId);
      if (used >= MAX_STOP_CONTINUES) {
        // 预算用尽：不请求续跑（引擎会照常结束会话），只留一条一次性上下文提示账目与余项。
        // continue:false 必须显式——省略键的形态引擎侧行为无活体证据，不能赌（评审 R1-1）。
        return {
          continue: false,
          additionalContext:
            `[lzy] 目标循环 ${goal.slug} 已用尽本钩子续跑预算（${used}/${MAX_STOP_CONTINUES}，` +
            `引擎 3 次共享池需给后台通知预留）。未完成项：${pending.map((s) => s.id).join(" ")}。` +
            `下次会话 SessionStart 会提醒续接。`,
        };
      }
      writeSessionCounter(cwd, sessionId, used + 1);
      return {
        continue: true,
        additionalContext:
          `[lzy] 目标循环「${goal.slug} — ${goal.title}」未完成（${doneCount}/${steps.length} 步）。` +
          `下一步 ${next.id} [${next.kind}] ${next.title}。继续执行该步；` +
          `完成后 node <lazyzcode>/cli/lzy.js step done ${next.id}` +
          (next.kind === "F" ? " --evidence <真实表面取证>" : "") +
          ` 收口。本会话 lzy 续跑预算 ${used + 1}/${MAX_STOP_CONTINUES}。不做完不停。`,
      };
    });
    emit(payload);
    process.exit(0);
  }

  // 全部步骤收口但未 finish：提醒走终验门（同样占续跑预算，上限 2 次）
  const payload = withSessionLock(cwd, sessionId, () => {
    const used = readSessionCounter(cwd, sessionId);
    if (used < MAX_STOP_CONTINUES) {
      writeSessionCounter(cwd, sessionId, used + 1);
      return {
        continue: true,
        additionalContext:
          `[lzy] 目标循环「${goal.slug}」全部步骤已收口，但终验门未过。` +
          `运行 node <lazyzcode>/cli/lzy.js loop finish 做证据时效终验` +
          `（F 项证据 tree hash 须等于当前代码），通过后目标才算 done。`,
      };
    }
    return {}; // 预算用尽：放手，引擎照常结束
  });
  emit(payload);
  process.exit(0);
} catch {
  failOpen();
}
