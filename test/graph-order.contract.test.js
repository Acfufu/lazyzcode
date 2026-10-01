// 执行图顺序语义契约（决策 #43 执法点③，ADR-0036）：波分派关键路径优先——深链头步
// 先派，浅叶垫尾；并列保持计划序（稳定排序，等深池与旧轮转均分逐字段同）。夹具用
// 「链深不对齐」：一链三步（A1→A2→A3）+ 两独立头步，链头在计划序中垫底——轮转均分
// 与关键路径优先在此夹具上分派不同（区分断言的构造前提）。
import { test } from "node:test";
import assert from "node:assert/strict";

import { waveSplit } from "../core/drive.js";
import { criticalDepthMap, criticalPath, topoLayers, claimableSteps, blockedBy, validateDeps } from "../core/graph.js";

const neverFresh = () => false;

function chainFixture() {
  // 计划序刻意把链头 A1 放最后（轮转均分会把 B1 派给首工人）。
  return {
    steps: [
      { id: "B1", status: "pending" },
      { id: "C1", status: "pending" },
      { id: "A1", status: "pending" },
      { id: "A2", status: "pending", deps: ["A1"] },
      { id: "A3", status: "pending", deps: ["A2"] },
    ],
  };
}

test("waveSplit 关键路径优先：链深不对齐夹具上链头先派（轮转均分会派 B1）", () => {
  const groups = waveSplit(chainFixture(), 2);
  assert.equal(groups[0][0], "A1", `首工人首位须为链头 A1（实得 ${groups[0][0]}）`);
  assert.equal(groups[1][0], "B1", `次工人首位须为最深余项 B1（实得 ${groups[1][0]}）`);
  // 首波全集不丢不重（A2/A3 被依赖阻塞不入本波）
  const flat = groups.flat().sort();
  assert.deepEqual(flat, ["A1", "B1", "C1"]);
});

test("waveSplit 等深池=旧轮转均分逐字段同（并列稳定排序回退）", () => {
  const goal = { steps: [{ id: "P1", status: "pending" }, { id: "P2", status: "pending" }, { id: "P3", status: "pending" }] };
  const groups = waveSplit(goal, 2);
  assert.deepEqual(groups, [["P1", "P3"], ["P2"]]);
});

test("criticalDepthMap/criticalPath/topoLayers：一链三步+独立头步语义（深度=解锁链长，链头最深）", () => {
  const items = [
    { id: "B1", deps: [] }, { id: "C1", deps: [] },
    { id: "A1", deps: [] }, { id: "A2", deps: ["A1"] }, { id: "A3", deps: ["A2"] },
  ];
  const depth = criticalDepthMap(items);
  assert.equal(depth.get("A1"), 3, "链头解锁链长 3（A1→A2→A3）");
  assert.equal(depth.get("A2"), 2);
  assert.equal(depth.get("A3"), 1);
  assert.equal(depth.get("B1"), 1);
  assert.deepEqual(criticalPath(items), ["A1", "A2", "A3"], "头先自然序");
  assert.deepEqual(topoLayers(items), [["B1", "C1", "A1"], ["A2"], ["A3"]], "层内保持计划序");
});

test("就绪谓词单源：blockedBy/claimableSteps 注入语义（done/阻塞/认领新鲜三态）", () => {
  const goal = {
    steps: [
      { id: "D1", status: "done" },
      { id: "P1", status: "pending", deps: ["D1"] }, // 依赖已满足→可认领
      { id: "P2", status: "pending", deps: ["P3"] }, // 依赖未完成→阻塞
      { id: "P3", status: "pending" }, // 认领新鲜→排除
      { id: "P4", status: "pending", deps: ["N9"] }, // 悬空引用（旧账容忍读法）→阻塞
    ],
  };
  assert.deepEqual(blockedBy(goal.steps[1], goal), []);
  assert.deepEqual(blockedBy(goal.steps[2], goal), ["P3"]);
  assert.deepEqual(blockedBy(goal.steps[4], goal), ["N9"]);
  const claimable = claimableSteps(goal, (s) => s.id === "P3").map((s) => s.id);
  assert.deepEqual(claimable, ["P1"]);
});

test("validateDeps 单源回归：悬空/自指/成环三例报错文案逐字（plan-gate 契约镜像）", () => {
  assert.throws(() => validateDeps([{ id: "N1", deps: ["N99"] }, { id: "N2", deps: [] }]), /依赖边引用不存在的条目：N1 → N99/);
  assert.throws(() => validateDeps([{ id: "N1", deps: ["N1"] }]), /依赖边自指：N1 依赖自己/);
  assert.throws(() => validateDeps([{ id: "N1", deps: ["N2"] }, { id: "N2", deps: ["N1"] }]), /计划依赖成环：N1 → N2 → N1/);
});
