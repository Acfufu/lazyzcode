#!/usr/bin/env node
// Stop 钩子：目标循环未完成时请求引擎续跑（不做完不停）。
// 纪律（源码+spike3 实锤）：非空 additionalContexts 才续跑；≤3 硬顶且与后台通知共享池；
// 状态按 sessionId 隔离、按 cwd 限定生效——没有 .lazyzcode/loop/goal.json 的目录一律 {} 放手。
// 认领制（ADR-0004）：目录内存在认领会话时只拉认领会话（空集=现状目录级行为，单调收紧）；
// 进度振数：拉回后步骤零推进两振写 stuck 提前弃拉（不消耗预算），有推进自愈。
// 交接放行（ADR-0009）：`lzy loop handoff` 落目录级匿名标记，Stop 在此一次性原子消费
// （unlink 恰一赢家）；放行显式 continue:false 不入 3 池（红线 #2 形态同 stuck 分支）。
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
  MAX_STOP_CONTINUES,
  emit,
  failOpen,
  inputCwd,
  inputSessionId,
  listClaims,
  readGoal,
  readSessionCounter,
  readSessionState,
  readStdinJson,
  sanitizeSessionId,
  withSessionLock,
  writeSessionCounter,
  writeSessionState,
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

  // 认领闸门（ADR-0004）：认领谓词=会话文件含 claimedAt（纯振数文件不算认领）。
  // 空集=现状（首个认领出现前人人可被拉）；非空且本会话不在集=旁路会话，放手。
  const claims = listClaims(cwd);
  if (claims.length > 0 && !claims.includes(sanitizeSessionId(sessionId))) {
    failOpen();
  }

  // 交接放行（ADR-0009）：消费块置于认领闸门后、pending 分叉前（评审钉死落点）——
  // pending 与全收口两分支共享同一交接出口。unlink 是原子动作：并发多会话同停时
  // 恰一赢家 rm 成功、输家 ENOENT 落回拉回纪律（故 rm 不带 force——ENOENT 必须抛出）。
  const handoffPath = join(cwd, ".lazyzcode", "loop", "handoff.json");
  let handoff = null;
  try {
    handoff = JSON.parse(readFileSync(handoffPath, "utf8"));
  } catch {
    handoff = null;
    try {
      rmSync(handoffPath); // 坏 JSON：当垃圾清走，本轮视同无标记（无标记时 ENOENT 同样静默忽略）
    } catch {}
  }
  if (handoff) {
    try {
      rmSync(handoffPath); // 原子消费：恰一赢家，输家 ENOENT 落回拉回
    } catch {
      handoff = null;
    }
  }
  if (handoff) {
    // 放行同时清本会话振数与 stuck（评审 E2：重入防误振；stuck 会话由此获得体面出口）
    withSessionLock(cwd, sessionId, () => {
      writeSessionState(cwd, sessionId, { stallCount: 0, stuck: false, lastDoneCount: null });
    });
    const snap = typeof handoff.snapshot === "string" ? handoff.snapshot : "";
    emit({
      continue: false,
      additionalContext:
        `[lzy] 交接标记已消费，本轮放行（目标 ${goal.slug} 保持 executing，状态在盘）。` +
        (snap ? `交接快照：${snap}。` : "") +
        `用户开新上下文后以「zw 继续」续跑。`,
    });
    process.exit(0);
  }

  const steps = Array.isArray(goal.steps) ? goal.steps : [];
  const pending = steps.filter((s) => s?.status !== "done");
  const doneCount = steps.length - pending.length;

  if (pending.length > 0) {
    const next = pending[0];
    // 计数器读改写套轻量锁：并发同 session 两读 used=0 会多发续跑（评审 R1-4）；
    // 锁拿不到就无锁放行，绝不阻断会话。
    const payload = withSessionLock(cwd, sessionId, () => {
      const state = readSessionState(cwd, sessionId);
      // 进度振数（ADR-0004）：首拉（lastDoneCount=null）只记快照不计振；
      // 有推进（doneCount 变化，含步骤重开）清振清 stuck 自愈；零推进 stallCount+1，
      // 两振写 stuck 提前弃拉——stuck 判定先于预算消耗，弃拉不消耗 continues（红线 #2）。
      const progressed = state.lastDoneCount !== null && doneCount !== state.lastDoneCount;
      const stallCount =
        state.lastDoneCount === null || progressed ? 0 : state.stallCount + 1;
      if (stallCount >= 2) {
        writeSessionState(cwd, sessionId, { stallCount, stuck: true });
        return {
          continue: false,
          additionalContext:
            `[lzy] 目标循环 ${goal.slug} 连续两振原地无进展（done ${doneCount}/${steps.length}），` +
            `已停拉（stuck）。排查阻塞后推进步骤即自愈；未完成项：${pending.map((s) => s.id).join(" ")}。`,
        };
      }
      const used = state.continues;
      if (used >= MAX_STOP_CONTINUES) {
        // 预算用尽：不请求续跑（引擎会照常结束会话），只留一条一次性上下文提示账目与余项。
        // continue:false 显式形态有引擎侧实锤：仅 continue===true 入 3 池（Z:460139-460157）。
        // 三处放行/弃拉（stuck/预算/交接）统一显式键，不赌省略形态。
        writeSessionState(cwd, sessionId, { stallCount, stuck: false, lastDoneCount: doneCount });
        return {
          continue: false,
          additionalContext:
            `[lzy] 目标循环 ${goal.slug} 已用尽本钩子续跑预算（${used}/${MAX_STOP_CONTINUES}，` +
            `引擎 3 次共享池需给后台通知预留）。未完成项：${pending.map((s) => s.id).join(" ")}。` +
            `下次会话 SessionStart 会提醒续接。`,
        };
      }
      writeSessionState(cwd, sessionId, {
        continues: used + 1,
        stallCount,
        stuck: false,
        lastDoneCount: doneCount,
      });
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
      // 全收口态下 stuck 已无意义，清掉防读面滞留显示（ADR-0004 显示自愈一致性）
      writeSessionState(cwd, sessionId, { stallCount: 0, stuck: false });
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
