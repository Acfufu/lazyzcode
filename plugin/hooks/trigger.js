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
  probeHostRoot,
  readGoal,
  readStdinJson,
  sanitizeSessionId,
  withSessionLock,
  writeSessionState,
} from "./hook-lib.js";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, renameSync } from "node:fs";
import { resolve, join } from "node:path";

// 锚 `^[ \t\r]*` 而非 `^\s*`（V021-ADJ-68）：`\s` 含换行，空行开头的多行 prompt 会把第 2 行
// 的首 token 判成「句首」（误写认领 / 误触 standdown：粘一段含 `zw standdown` 行的文本即可静默
// 退出拉回）。`\r` 保留在窗口内（单行 CR 形态仍算句首），`\n` 不在——首行是空行就不是句首。
const BARE_ZW_RE = /^[ \t\r]*zw(?![a-z0-9_-])/i;
const EXPLICIT_RE = /lazyzcode[：:]zw/i;
const ALIAS_RE = /(^|[^a-z0-9_-])(ulw|ultrawork)([^a-z0-9_-]|$)/i;
// 唤起级别名（ADR-0004 修正案）：句首 ulw/ultrawork 是发起形态；句中「/ulw」是提及
// （ specimen：「对比 /ulw 的写法」曾误认领，致盲真主会话）。通知注入维持全谱 ALIAS_RE 不变。
const ALIAS_INITIAL_RE = /^[ \t\r]*(ulw|ultrawork)(?![a-z0-9_-])/i;
// 人权门批准形态（0.1.1 goal1，ADR-0018）：恰「批准/approve + 8 位 hex 短码」。否定面在
// approvalVerdict 内做消息级前置筛（APPROVE_NEG_RE）——旧实现用负向后行断言只挡紧邻「不/别」，
// 「不要批准/不准批准/未批准/请勿批准/拒绝批准/don't approve」照写记录（V021-ADJ-56）。
const APPROVE_RE = /(?:批准|approve)\s*([0-9a-f]{8})\b/i;
// 否定前置筛（V021-ADJ-56）：否定词与批准词之间 ≤6 个**非断句**字符（句读/换行/空白边界不计
// 跨度）——「不要批准」命中，「不要改计划，批准 abc12345」「请勿修改计划，批准 abc12345」不命中
//（句读阻断跨度 + 只在批准词之前的切片内生效）。审阅语义：仅否决不采纳，反向（少记）安全。
const APPROVE_NEG_RE =
  /(?:不要?|不准|别|未|请勿|拒绝|勿|don['’]?t|do\s+not|not)\s*[^。！？\n，,、；;.?!]{0,6}(?:批准|approve)/i;
// standdown 声明形态（0.1.1 goal2，ADR-0009 修订节）：句首「zw standdown」——本会话
// 退出当前目标参与（Stop 不再拉回）；参与触发（invocational）写认领时同步清旗标。
// 锚同 BARE_ZW_RE（^[ \t\r]*，V021-ADJ-68）：空行开头的多行 prompt 不得触发。
const STANDDOWN_RE = /^[ \t\r]*zw\s+standdown(?![a-z0-9_-])/i;
// 撤回形态（0.3.0 M1，ADR-0024）：「撤回/withdraw/revoke + 8 位 hex 短码」——对当前
// goal 绑定契约（goal.contract.contractHash）的授权撤回。不要求任何 pending 在场
//（撤回是主动声明，批准才是对 pending 的应答）；记录写 .lazyzcode/authorizations/
//（追加式，生效判定=后到者赢）。否定前置筛与批准同族（APPROVE_NEG_RE 家法换动词）。
const WITHDRAW_RE = /(?:撤回|withdraw|revoke)\s*([0-9a-f]{8})\b/i;
const WITHDRAW_NEG_RE =
  /(?:不要?|不准|别|未|请勿|拒绝|勿|don['’]?t|do\s+not|not)\s*[^。！？\n，,、；;.?!]{0,6}(?:撤回|withdraw|revoke)/i;

// queue-pending 批准解析（0.3.1 棒1，ADR-0030 修正节）：入队时 goal 尚不存在，UPS 批准
// 解析需第三个来源——扫 `.lazyzcode/queue/queue.json` 的已声明交付契约（delivery[ep].hash
// 前 8 位）。自包含 inline（钩子不 import core，家族校验和算法与 core/queue.js checksumOf
// 逐字同形：strip checksum → JSON.stringify(rest) → sha256）。返回 null=零命中或读面异常
// （fail-open，落回既有诊断支，绝不炸钩子）；返回对象=恰一次 emit。文案零时间戳零文件名。
// 写入面=同族同目录（.lazyzcode/authorizations/，记录形状与 contractPending 支逐字同构）。
function queueDeliveryVerdict(cwd, short, sessionId) {
  let q;
  try {
    const obj = JSON.parse(readFileSync(join(cwd, ".lazyzcode", "queue", "queue.json"), "utf8"));
    const { checksum, ...rest } = obj ?? {};
    if (checksum !== createHash("sha256").update(JSON.stringify(rest)).digest("hex")) return null;
    q = rest;
  } catch {
    return null; // 缺席/损坏/校验和不符：fail-open
  }
  const items = Array.isArray(q?.items) ? q.items : [];
  const hits = [];
  const pendingCands = [];
  for (const it of items) {
    if (!it || ["completed", "failed", "cancelled"].includes(it.state)) continue;
    for (const ep of ["B", "C"]) {
      const h = it?.delivery?.[ep]?.hash;
      if (typeof h !== "string") continue;
      pendingCands.push(`${it.id}/${ep}（${h.slice(0, 8)}）`);
      if (h.slice(0, 8).toLowerCase() === short) hits.push({ it, ep, hash: h, path: it.delivery[ep].path });
    }
  }
  if (hits.length === 0) {
    // 有候选但不匹配：给出可诊断的短码列表（零写入）；无候选=真零命中，落回既有诊断支。
    if (pendingCands.length === 0) return null;
    return {
      additionalContext:
        `[lzy] No pending approval matches this code. Queue delivery contracts awaiting approval: ${pendingCands.join("、")}. ` +
        `Ask the model for the exact approval sentence (「批准 <短码>」) and send it again. Nothing was recorded.`,
    };
  }
  if (hits.length > 1) {
    const cands = hits.map((x) => `${x.it.id}/${x.ep}（${x.hash.slice(0, 8)}）`).join("、");
    return {
      additionalContext:
        `[lzy] Delivery approval code matches multiple queue items — refusing to guess (nothing was recorded): ${cands}. ` +
        `Ask the user to confirm which item/endpoint this approval is for.`,
    };
  }
  const { it, ep, hash, path } = hits[0];
  // exact-hash 复核：入队时记录的契约路径现字节须仍哈希到该值（入队后改契约=批准对象已变=作废）。
  let cur = null;
  try {
    cur = createHash("sha256").update(readFileSync(resolve(cwd, path))).digest("hex");
  } catch {}
  if (cur !== hash) {
    return {
      additionalContext:
        `[lzy] Delivery contract of queue item ${it.id} (${ep}) changed since it was enqueued — the short code is void. ` +
        `Ask the model to re-enqueue the item with the updated contract for a fresh code. Nothing was recorded.`,
    };
  }
  const authDir = join(cwd, ".lazyzcode", "authorizations");
  try {
    mkdirSync(authDir, { recursive: true });
    const sid = String(sessionId ?? "unknown");
    const name = `approval-${short}-${sanitizeSessionId(sid).slice(0, 24)}-${Date.now()}.json`;
    const tmp = join(authDir, `.${name}.${process.pid}.tmp`);
    writeFileSync(
      tmp,
      `${JSON.stringify({ version: 1, kind: "approval", slug: it.goalSlug, contractHash: hash, at: new Date().toISOString(), sessionId: sid }, null, 2)}\n`,
    );
    renameSync(tmp, join(authDir, name));
  } catch (err) {
    const reason = err?.code ?? err?.name ?? "unknown";
    return {
      additionalContext:
        `[lzy] Delivery approval was valid but the authorization record could not be written (${reason}) — nothing was recorded and the queue gate stays closed. ` +
        `Check that .lazyzcode/authorizations is writable (not blocked by a file or a read-only mount) and that the disk has free space, then re-send the approval sentence.`,
    };
  }
  return {
    additionalContext:
      `[lzy] Human approval recorded for delivery ${ep} of queue item ${it.id} (short code ${short}). ` +
      `The queue readiness gate releases the item once all declared authorizations are in place — run lzy queue list to see the readiness face.`,
  };
}

// 返回 null=落回既有触发词逻辑（零输出零 exit）；返回对象=恰一次 emit 后 exit 0
// （由调用方执行）。emit 文案零时间戳零文件名（双跑确定性不变量）；全分支异常
// fail-open——批准面绝不劫持会话，门保持关闭由 CLI 侧重试。
function approvalVerdict(input) {
  const prompt = typeof input?.prompt === "string" ? input.prompt : "";
  const m = prompt.match(APPROVE_RE);
  if (!m) return null;
  // 否定前置筛（V021-ADJ-56）：只审批准词**之前**的文本（切片到命中短码为止，故
  // 「批准 abc12345，不要改计划」照常算批准），命中否定形态即整支落回既有触发词管线
  //（与旧「不批准/别批准」同路径：不写记录、不 emit 批准文案、落回可能注入 ZW 的常规面）。
  if (APPROVE_NEG_RE.test(prompt.slice(0, m.index + m[0].length))) return null;
  try {
    const cwd = inputCwd(input);
    const goal = readGoal(cwd);
    // 契约批准分支（0.3.0 M1，ADR-0024）：goal 挂着 contractPending 时，批准对象是需求
    // 契约（contractHash），不是执行计划。钩子只追加 authorization 记录、绝不写 goal.json
    //（contractPending 的清除/再置一律归 CLI 闸在 withLock 内做——钩子与 CLI 并发改
    // goal.json 是竞态）。pending 缺席即落回 legacy 分支（无 goal 的债 E 诊断也在那边，
    // 两分支共用同一条「无目标」出口）。
    const contractPending = goal?.contractPending;
    if (contractPending?.contractHash) {
      const short = String(contractPending.contractHash).slice(0, 8).toLowerCase();
      if (m[1].toLowerCase() !== short) {
        return {
          additionalContext:
            `[lzy] Approval code mismatch — the pending contract short code is ${short}. ` +
            `Ask the model for the exact approval sentence (「批准 <短码>」) and send it again. Nothing was recorded.`,
        };
      }
      // exact-hash 复核：契约文件现内容必须仍哈希到 pending 值（批准后改契约=批准作废）。
      let current = null;
      try {
        current = createHash("sha256")
          .update(readFileSync(resolve(cwd, contractPending.contractPath ?? goal.contract?.path ?? "")))
          .digest("hex");
      } catch {}
      if (current !== contractPending.contractHash) {
        return {
          additionalContext:
            `[lzy] Contract changed since this approval was requested — the short code is void. ` +
            `Ask the model to re-run the contract registration (lzy loop register --contract <file>) for a fresh code. Nothing was recorded.`,
        };
      }
      const authDir = join(cwd, ".lazyzcode", "authorizations");
      try {
        mkdirSync(authDir, { recursive: true });
        const sid = String(inputSessionId(input) ?? "unknown");
        const name = `approval-${short}-${sanitizeSessionId(sid).slice(0, 24)}-${Date.now()}.json`;
        const tmp = join(authDir, `.${name}.${process.pid}.tmp`);
        writeFileSync(
          tmp,
          `${JSON.stringify({ version: 1, kind: "approval", slug: goal.slug, contractHash: contractPending.contractHash, at: new Date().toISOString(), sessionId: sid }, null, 2)}\n`,
        );
        renameSync(tmp, join(authDir, name));
      } catch (err) {
        const reason = err?.code ?? err?.name ?? "unknown";
        return {
          additionalContext:
            `[lzy] Contract approval was valid but the authorization record could not be written (${reason}) — the contract gate stays closed and nothing was recorded. ` +
            `Check that .lazyzcode/authorizations is writable (not blocked by a file or a read-only mount) and that the disk has free space, then re-send the approval sentence.`,
        };
      }
      return {
        additionalContext:
          `[lzy] Human approval recorded for contract of goal ${goal.slug} (short code ${short}). ` +
          `The model may now re-run the adoption command (lzy loop plan <file>) to pass the contract gate.`,
      };
    }
    const pending = goal?.approvalPending;
    if (!pending?.planHash) {
      // queue-pending 解析支（0.3.1 棒1，ADR-0030 修正节）：goal 侧双 pending 皆缺席（或
      // goal 缺席）时才扫队列——否则会抢本 goal 自身的 legacy 计划批准支。命中即返回
      // （含写记录或 fail-soft 诊断）；零命中/读面异常返回 null，落回下方既有诊断支。
      const qv = queueDeliveryVerdict(cwd, m[1].toLowerCase(), inputSessionId(input));
      if (qv) return qv;
      // 债 E（ADR-0018 修正案）：批准正则已命中却读不到 goal/pending——旧实现静默
      // return null，用户发出的批准句零反馈，L2 门失败完全无声（2026-09-20 zpigeon
      // 事故被误诊为「引擎 hook 调度未生效」）。两条诊断分支各 emit 一次即接管本回合
      // （沿本函数既有三分支形态）：只提示不阻断，approvals/ 恒不写。
      // 注意优先序代价：落到任一支即不再进入下方触发词管线，故同含触发词与批准形态的
      // 提示词（如「zw 批准 <短码>」）本回合不写认领、不注入 ZW 引导——批准句是更强
      // 意图信号，先让人权门说清楚（N3 用例⑥钉死该既成行为）。
      if (!goal) {
        const root = probeHostRoot(cwd);
        return {
          additionalContext: root
            ? `[lzy] Approval sentence received, but no goal loop is registered at ${cwd} — nothing was recorded. ` +
              `A goal loop was found at ${root}; ask the model to return to that directory and re-send the approval sentence.`
            : `[lzy] Approval sentence received, but no goal loop is registered at ${cwd} or any parent directory — nothing was recorded. ` +
              `Confirm you are in the goal's host workspace root, then re-send the approval sentence.`,
        };
      }
      return {
        additionalContext:
          `[lzy] Approval sentence received, but this goal loop has no pending plan adoption to approve (goal ${goal?.slug ?? "unknown"}) — nothing was recorded. ` +
          `Ask the model to run the adoption command (lzy loop plan <file>) first. ` +
          `If you did not intend to approve a plan adoption, ignore this notice.`,
      };
    }
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
    // 批准记录落盘：写面单独 try/catch（V021-ADJ-63）——旧实现把写盘包在函数级 catch 里，
    // 失败时 return null 落回触发词管线（句子无触发词 → {}），用户体验与债 E 完全同形：
    // 批准句发出、门不开、零回执。现在失败即 emit 一条与既有三支同形的诊断并接管本回合
    //（诊断只含 errno 摘要，零时间戳零文件名——emit 双跑确定性与注入确定性不变量不破）。
    const dir = join(cwd, ".lazyzcode", "loop", "approvals");
    try {
      mkdirSync(dir, { recursive: true });
      const sid = String(inputSessionId(input) ?? "unknown");
      const name = `${short}-${sanitizeSessionId(sid).slice(0, 24)}-${Date.now()}.json`;
      const tmp = join(dir, `.${name}.${process.pid}.tmp`);
      writeFileSync(
        tmp,
        `${JSON.stringify({ version: 1, slug: goal.slug, planHash: pending.planHash, at: new Date().toISOString(), sessionId: sid }, null, 2)}\n`,
      );
      renameSync(tmp, join(dir, name));
    } catch (err) {
      const reason = err?.code ?? err?.name ?? "unknown";
      return {
        additionalContext:
          `[lzy] Approval was valid but the approval record could not be written (${reason}) — the human gate stays closed and nothing was recorded. ` +
          `Check that .lazyzcode/loop/approvals is writable (not blocked by a file or a read-only mount) and that the disk has free space, then re-send the approval sentence.`,
      };
    }
    return {
      additionalContext:
        `[lzy] Human approval recorded for plan ${goal.slug} (short code ${short}). ` +
        `The model may now re-run the adoption command (lzy loop plan <file>) to pass the human gate.`,
    };
  } catch {
    return null;
  }
}

// 撤回判定（0.3.0 M1，ADR-0024）：「撤回/withdraw/revoke + 8hex」匹配当前 goal 绑定契约
// 即追加 withdrawal 记录——不要求 pending（撤回是主动声明）；哈希不匹配/无 goal/无契约
// 各 emit 一条诊断接管本回合（与批准面同姿态：说清楚，不静默）。撤回的信任属性与批准
// 相同：唯一写入口=真实用户消息上的本钩子，CLI 无任何撤回写命令。
function withdrawalVerdict(input) {
  const prompt = typeof input?.prompt === "string" ? input.prompt : "";
  const m = prompt.match(WITHDRAW_RE);
  if (!m) return null;
  if (WITHDRAW_NEG_RE.test(prompt.slice(0, m.index + m[0].length))) return null;
  try {
    const cwd = inputCwd(input);
    const goal = readGoal(cwd);
    if (!goal) {
      const root = probeHostRoot(cwd);
      return {
        additionalContext: root
          ? `[lzy] Withdrawal sentence received, but no goal loop is registered at ${cwd} — nothing was recorded. ` +
            `A goal loop was found at ${root}; ask the model to return to that directory and re-send the withdrawal sentence.`
          : `[lzy] Withdrawal sentence received, but no goal loop is registered at ${cwd} or any parent directory — nothing was recorded. ` +
            `Confirm you are in the goal's host workspace root, then re-send the withdrawal sentence.`,
      };
    }
    // 撤回目标集合（0.3.0 M4，ADR-0028）：goal 主契约 + delivery 契约（B/C）——形状与
    // 后到者赢语义照走（记录仍 {version,kind,slug,contractHash,at,sessionId}，无 scope 字段：
    // 目标身份由契约本体承载）。8hex 前缀两两碰撞=拒（确定性优先，不猜用户意图）。
    const candidates = [];
    if (typeof goal?.contract?.contractHash === "string" && goal.contract.contractHash) {
      candidates.push({ hash: goal.contract.contractHash, what: "goal contract" });
    }
    for (const ep of ["B", "C"]) {
      const h = goal?.delivery?.[ep]?.hash;
      if (typeof h === "string" && h) candidates.push({ hash: h, what: `delivery ${ep} contract` });
    }
    if (candidates.length === 0) {
      return {
        additionalContext:
          `[lzy] Withdrawal sentence received, but goal ${goal.slug} has no contract bound (register with lzy loop register --contract <file> first) — nothing was recorded.`,
      };
    }
    const code = m[1].toLowerCase();
    const matched = candidates.filter((c) => String(c.hash).slice(0, 8).toLowerCase() === code);
    if (matched.length === 0) {
      const list = candidates.map((c) => `${String(c.hash).slice(0, 8).toLowerCase()} (${c.what})`).join(", ");
      return {
        additionalContext:
          `[lzy] Withdrawal code mismatch — valid codes for goal ${goal.slug}: ${list}. ` +
          `Ask the model for the exact withdrawal sentence (「撤回 <短码>」) and send it again. Nothing was recorded.`,
      };
    }
    if (matched.length > 1) {
      return {
        additionalContext:
          `[lzy] Withdrawal code ${code} matches more than one contract on goal ${goal.slug} — refusing to guess. ` +
          `Nothing was recorded; withdraw by full context (e.g. re-bind and withdraw via the model relaying exact instructions).`,
      };
    }
    const bound = matched[0].hash;
    const authDir = join(cwd, ".lazyzcode", "authorizations");
    try {
      mkdirSync(authDir, { recursive: true });
      const sid = String(inputSessionId(input) ?? "unknown");
      const name = `withdrawal-${code}-${sanitizeSessionId(sid).slice(0, 24)}-${Date.now()}.json`;
      const tmp = join(authDir, `.${name}.${process.pid}.tmp`);
      writeFileSync(
        tmp,
        `${JSON.stringify({ version: 1, kind: "withdrawal", slug: goal.slug, contractHash: bound, at: new Date().toISOString(), sessionId: sid }, null, 2)}\n`,
      );
      renameSync(tmp, join(authDir, name));
    } catch (err) {
      const reason = err?.code ?? err?.name ?? "unknown";
      return {
        additionalContext:
          `[lzy] Withdrawal was valid but the authorization record could not be written (${reason}) — nothing was recorded. ` +
          `Check that .lazyzcode/authorizations is writable and that the disk has free space, then re-send the withdrawal sentence.`,
      };
    }
    return {
      additionalContext:
        `[lzy] Withdrawal recorded for goal ${goal.slug} (short code ${code}). ` +
        `The matching gate will refuse the next gated action (plan adoption / supersede / delivery act) for this contract; ` +
        `work already performed stays as-is — withdrawal does not undo external effects.`,
    };
  } catch {
    return null;
  }
}

try {
  const input = readStdinJson();
  // LZY_ABLATE_HOOK_HUMAN_GATE（0.1.1 goal1，ADR-0015 形态）：恰 "1" 才消融；短路=径直
  // 落回既有触发词逻辑。批准/撤回分支整体置于 TRIGGER 消融短路之前——消融轴独立（TRIGGER
  // 臂不连带灭人权门）；撤回与批准同轴同熔断（0.3.0 M1），批准优先匹配保 legacy 行为
  // 逐字段不变（含「批准+撤回」同句的既有优先序）。
  if (process.env.LZY_ABLATE_HOOK_HUMAN_GATE !== "1") {
    const verdict = approvalVerdict(input) ?? withdrawalVerdict(input);
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

  // standdown 声明（ADR-0009 修订节，0.1.1）：「zw standdown」=本会话退出本目标参与。
  // 置于正则门后、sentinel/认领前——命中即整支接管，绝不落回注入/认领流程。归
  // LZY_ABLATE_HOOK_TRIGGER 轴（短路点在上方：触发面全灭=本分支同灭，与认领写同轴；
  // 对比人权门的独立消融轴——那是消融臂 D/E 必须过采纳门的特例）。写旗标常驻、幂等
  // 同文；参与（认领写）即清；reset 清 sessions/ 即清。emit 文案全静态零时间戳零文件名
  //（双跑字节确定契约）。
  if (STANDDOWN_RE.test(prompt)) {
    const cwd = inputCwd(input);
    const sessionId = inputSessionId(input);
    if (!sessionId) failOpen(); // 缺 sessionId 无法绑定会话旗标（引擎恒供，缺=异常输入）
    if (readGoal(cwd)) {
      withSessionLock(cwd, sessionId, () => {
        writeSessionState(cwd, sessionId, { standdown: true });
      });
      emit({
        additionalContext:
          "[lzy] standdown recorded: this session has opted out of the current goal loop. " +
          "The Stop hook will no longer pull this session back (pull-back budget untouched). " +
          "To rejoin, send an invocational trigger such as \"zw 继续\" — claiming clears the " +
          "standdown flag. The flag is also cleared when the goal loop is reset.",
      });
      process.exit(0);
    }
    emit({
      additionalContext:
        "[lzy] standdown: no goal loop in this directory — nothing to opt out of. " +
        "No flag written.",
    });
    process.exit(0);
  }

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
        // 参与即恢复（ADR-0009 修订节）：认领写同步清 standdown 旗标——「zw 继续」重新
        // 加入拉回，与「退出须显式声明」对偶。
        writeSessionState(cwd, sessionId, {
          claimedAt: new Date().toISOString(),
          standdown: null,
        });
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
