// 执行图（execution graph）单源核心（决策 #43 / ADR-0036，2026-10-01 grill 四象限拍板）：
// deps 语义唯一权威——健全性校验（validateDeps，自 loop.js 迁入逐字同款）、就绪集谓词
// （blockedBy/claimableSteps，自 loop.js 迁入）、顺序语义（拓扑分层/关键路径）。
// 与失效 DAG（core/dag.js，证据失效边账本）分立两物（CONTEXT「执行图」条），观察层由
// `lzy loop graph` 同读两图（决策 #46）。
//
// ESM 环安全：本模块 import loop.js 仅取 LoopError（call-time 构造，函数体内引用，不在
// 模块顶层求值期使用——gate.js/policy.js 同款先例）；loop.js 顶层 import 本模块的纯函数，
// 互不为对方模块求值期依赖。isClaimFresh 由调用方参数化注入（本模块不 import 钩子态）。
//
// 行为保持契约：validateDeps 报错文案逐字不变（test/plan-gate.contract.test.js 悬空/自指/
// 成环三例逐字断言背书，零改动保持绿=回归背书）；blockedBy/claimableSteps 谓词语义逐字同。
import { LoopError } from "./loop.js";

const CYCLE_PATH_CAP = 8;

function capCyclePath(path) {
  if (path.length <= CYCLE_PATH_CAP) return path.join(" → ");
  return `${path.slice(0, CYCLE_PATH_CAP).join(" → ")} → …（共 ${path.length} 节）`;
}

export function validateDeps(items) {
  const byId = new Map(items.map((it) => [it.id, it]));
  for (const it of items) {
    for (const dep of it.deps) {
      if (dep === it.id) throw new LoopError(`依赖边自指：${it.id} 依赖自己`);
      if (!byId.has(dep)) {
        throw new LoopError(
          `依赖边引用不存在的条目：${it.id} → ${dep}（现有：${items.map((x) => x.id).join(" ")}）`,
        );
      }
    }
  }
  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const state = new Map(items.map((it) => [it.id, WHITE]));
  for (const start of items) {
    if (state.get(start.id) !== WHITE) continue;
    const stack = [{ id: start.id, i: 0 }];
    state.set(start.id, GRAY);
    while (stack.length > 0) {
      const top = stack[stack.length - 1];
      const deps = byId.get(top.id).deps;
      if (top.i < deps.length) {
        const dep = deps[top.i];
        top.i += 1;
        const st = state.get(dep);
        if (st === GRAY) {
          const from = stack.findIndex((f) => f.id === dep);
          throw new LoopError(
            `计划依赖成环：${capCyclePath([...stack.slice(from).map((f) => f.id), dep])}`,
          );
        }
        if (st === WHITE) {
          state.set(dep, GRAY);
          stack.push({ id: dep, i: 0 });
        }
      } else {
        stack.pop();
        state.set(top.id, BLACK);
      }
    }
  }
}

// 无阻塞谓词：deps 全 done（无 deps=恒无阻塞）。返回未完成依赖 id 列表（空=可认领）。
// 容忍旧 goal.json 无 deps 字段（additive 字段，hooks 同款容忍读法）。
export function blockedBy(step, goal) {
  const deps = Array.isArray(step.deps) ? step.deps : [];
  if (deps.length === 0) return [];
  const byId = new Map(goal.steps.map((s) => [s.id, s]));
  return deps.filter((d) => byId.get(d)?.status !== "done");
}

// 可认领集：未 done、无在场认领、无阻塞。isClaimFresh 由调用方注入（认领新鲜度语义
// 归 loop.js 认领层——调度器管就绪与顺序，认领管归属，ADR-0036）。
export function claimableSteps(goal, isClaimFresh) {
  return goal.steps.filter(
    (s) => s.status !== "done" && !isClaimFresh(s) && blockedBy(s, goal).length === 0,
  );
}

// ── 顺序语义（N2 新增；消费者=drive 波分派 N3 + loop graph 视图 N6）──────────────
// 前提：items 已过 validateDeps（采纳门保证无环）——有环输入未定义（不防御，保持纯）。

// 关键深度：该步解锁的最长链步数（含自身；沿「依赖它的边」向上量——链头最深、叶最浅，
// 分派序=深度降序即链头先行）。显式栈迭代求解（对抗审查 R5-A 先例：递归在 ~5000 节深链
// 上爆调用栈——评审 r4 F-3 同族风险回归，graph.js 全函数迭代化）。
export function criticalDepthMap(items) {
  const dependents = new Map(); // depId → [依赖它的步 id]
  for (const it of items) {
    for (const d of it.deps ?? []) {
      if (!dependents.has(d)) dependents.set(d, []);
      dependents.get(d).push(it.id);
    }
  }
  const depth = new Map();
  for (const it of items) {
    if (depth.has(it.id)) continue;
    const stack = [{ id: it.id, i: 0 }];
    depth.set(it.id, 0); // 环哨兵：前提无环，0 仅防恶意输入死循环
    while (stack.length > 0) {
      const top = stack[stack.length - 1];
      const outs = dependents.get(top.id) ?? [];
      if (top.i < outs.length) {
        const nxt = outs[top.i];
        top.i += 1;
        if (!depth.has(nxt)) {
          depth.set(nxt, 0);
          stack.push({ id: nxt, i: 0 });
        }
      } else {
        stack.pop();
        const d = 1 + Math.max(0, ...(dependents.get(top.id) ?? []).map((x) => depth.get(x) ?? 0));
        depth.set(top.id, d);
      }
    }
  }
  return depth;
}

// 关键路径：整图最长解锁链（头先自然序：从深度最大的头步沿最深被依赖者下行到叶）。
// 并列取计划序先者。返回 id 序列。
export function criticalPath(items) {
  const byId = new Map(items.map((it) => [it.id, it]));
  const depth = criticalDepthMap(items);
  const path = [];
  let cur = null;
  for (const it of items) {
    if (cur === null || (depth.get(it.id) ?? 0) > (depth.get(cur.id) ?? 0)) cur = it;
  }
  while (cur) {
    path.push(cur.id);
    const deps = dependentsOf(items, cur.id);
    let next = null;
    for (const d of deps) {
      if (next === null || (depth.get(d) ?? 0) > (depth.get(next) ?? 0)) next = byId.get(d);
    }
    cur = next;
  }
  return path;
}

function dependentsOf(items, id) {
  const out = [];
  for (const it of items) if ((it.deps ?? []).includes(id)) out.push(it.id);
  return out;
}

// 拓扑分层：层 0=无依赖步，层 i=deps 全在更浅层。返回逐层 id 数组（层内保持计划序）。
// 显式栈迭代（深链爆栈先例同 criticalDepthMap）。
export function topoLayers(items) {
  const byId = new Map(items.map((it) => [it.id, it]));
  const layerOf = new Map();
  for (const it of items) {
    if (layerOf.has(it.id)) continue;
    const stack = [{ id: it.id, i: 0 }];
    layerOf.set(it.id, 0); // 环哨兵同 criticalDepthMap
    while (stack.length > 0) {
      const top = stack[stack.length - 1];
      const deps = byId.get(top.id)?.deps ?? [];
      if (top.i < deps.length) {
        const dep = deps[top.i];
        top.i += 1;
        if (!layerOf.has(dep)) {
          layerOf.set(dep, 0);
          stack.push({ id: dep, i: 0 });
        }
      } else {
        stack.pop();
        const ds = byId.get(top.id)?.deps ?? [];
        const l = ds.length ? 1 + Math.max(...ds.map((d) => layerOf.get(d) ?? 0)) : 0;
        layerOf.set(top.id, l);
      }
    }
  }
  const layers = [];
  for (const it of items) {
    const l = layerOf.get(it.id) ?? 0;
    (layers[l] ??= []).push(it.id);
  }
  return layers.filter(Boolean);
}
