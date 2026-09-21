// 进度信号状态集（0.2.2 棒1#N2/ADR-0020 后，拍板 Q3；ADJ-34 的根因修法）。
//
// drive 段循环原判据只有 done 步数跳变（core/drive.js 旧 `dc > lastDoneCount`），于是
// 「重活/长步」——有提交、有证据入账、步未翻 done——被判零推进，连续两段即走
// `windDown(true, …)` **干净收束**，与 H3R 判据③要测的「干净挂起 + handoff」落在同一
// 输出通道（这正是 0.2.2 先修仪器的理由）。
//
// 现行集合 = done 步数 ∪ subject 头树集（提交）∪ 证据账本绿节点数 ∪ handoff/salvage
// 登记数。**不含脏树**——只写不提交不算推进（否则 churn 即可无限延长 leash）。
//
// never-throw 契约（house 读面家法，core/loop.js verifyEvidence 单项降级先例）：任一信号
// 源失败都不冒泡，而是**沿用 prev 的该信号值**（首段无 prev 则取哨兵 "unavailable"）。
// 这对 drive 尤其关键——core/drive.js 段循环是 try/finally **无 catch**，异常逃逸=不写
// 7 字段快照，直接破 drive 契约。保持上一段值还保证瞬时故障不会伪造出「推进」（假清零
// 振数）或「倒退」。
import { resolve } from "node:path";
import { createGit } from "./git.js";
import { loadDag } from "./dag.js";
import { listHandoffSnapshots, listSalvageStubs } from "./loop.js";

/** 信号源不可用且无 prev 时的哨兵值（与任何真实读数都不等）。 */
export const UNAVAILABLE = "unavailable";

/** 稳定签名串：任一分量变化即不同（drive 用它判「本段有无推进」）。 */
export function signatureKey(sig) {
  return ["done", "trees", "greens", "handoffs", "salvage"]
    .map((k) => `${k}=${sig?.[k] ?? UNAVAILABLE}`)
    .join("|");
}

/**
 * 采集一次进度签名。
 * @param {string} cwd 宿主根
 * @param {object|null} goal 当前 goal（可读时的快照）
 * @param {object|null} prev 上一段签名——某信号源失败时沿用其对应值
 */
export function progressSignature(cwd, goal, prev) {
  const hold = (key) => (prev && key in prev ? prev[key] : UNAVAILABLE);
  const run = (key, fn) => {
    try {
      return fn();
    } catch {
      return hold(key);
    }
  };

  const sig = {
    done: run("done", () => {
      const steps = Array.isArray(goal?.steps) ? goal.steps : [];
      return steps.filter((s) => s?.status === "done").length;
    }),
    // 提交面：每根一份头树，任一提交即变（相对路径按宿主根解析，缺根记 missing）
    trees: run("trees", () => {
      const roots = [cwd, ...(Array.isArray(goal?.subjects) ? goal.subjects : [])];
      return roots.map((r) => createGit(resolve(cwd, r)).headTreeHash() ?? "missing").join(",");
    }),
    // 证据面：账本绿节点数（绿半在 step done 时自动镜像，故「取证」本身即推进）
    greens: run("greens", () => {
      const nodes = loadDag(cwd)?.nodes;
      return (Array.isArray(nodes) ? nodes : []).filter(
        (n) => n?.kind === "evidence" && n?.half === "green",
      ).length;
    }),
    handoffs: run("handoffs", () => listHandoffSnapshots(cwd).length),
    salvage: run("salvage", () => listSalvageStubs(cwd).length),
  };
  return sig;
}
