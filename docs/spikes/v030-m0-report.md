# v030-m0 探针与基线报告

goal `v030-m0`（0.3.0 M0 能力与基线）· 2026-09-23/24 夜间无限窗口执行 · 零产品代码改动。
主方案 docs/plan-v030-agent-first.md §9/§10-M0；拍板记录见 `.lazyzcode/plans/v030-m0.md`（五项，2026-09-23 夜 grilling 收口）。

## 1. 冻结基线

| 面 | 冻结值 |
| --- | --- |
| 本仓（lazyzcode） | 0.2.4 已发布（a5d14ad 发布记录）+ 规划提交 4b54f77（0.3.0 六文件入库）；本 goal 全程锚此树 |
| openchamber | `5df72db27` fix(theme): align Catppuccin palettes with official colors (#3632) |
| zpigeon-ios | `e573516` chore(version): MARKETING_VERSION 0.3.0 → 0.3.1 |
| zpigeon（兄弟 Kit） | `188991a` feat(kit): SubscriptionBase 增 conversationCanLoadOlder 只读访问器 |
| Xcode | 27.0 (27A266a)；iOS runtime 26.5 (23F77) |
| bun | 1.3.14 |
| node | v24.19.0 |
| gh | 2.95.0 |
| xcodegen | 2.46.0 |
| 计费账本 | `~/.zcode/cli/db/db.sqlite`（2,227,580,928 B ≈ 2.2 GB——查询必须限时限量，见 §4） |

## 2. 已核事实表（explorer 侦察，代码级）

1. **headless usage 直通**：`spawnHeadless` 摘要提取 `response/sessionId/usage/raw`，usage 为 `s.usage ?? null` 原样透传，core 不消费任何 token/points 字段（core/headless.js:157-168）。唯一消费者是 ablation 脚本（`usage.modelRequestCount`、`projection.contextUsed`）。
2. **计费账本只读**：引擎账本 SQLite，`billingDbPath()` = `~/.zcode/cli/db/db.sqlite`（core/paths.js:46-48）；`lzy loop cost` 经 `queryHostDb` 以 sqlite3 spawn 只读查询 `model_usage JOIN session`（core/cost.js:106-111），积分 = tokens/1e6 × 常设系数 ×（促销 overlay 或 1）。
3. **逐目标归因是启发式**：时间窗 ∩（会话目录 == 仓根 OR 会话在认领集），自报「需人工复核」（core/cost.js:173-186, 300-302）；无逐运行归因。
4. **workers 波末重锚不执法**：`runDriveWorkers` 屏障对有证据的 F 步 shell `step done <id> --evidence "wave-barrier rebind…（drive 代跑，未复跑断言）"`，代码自注「重锚 ≠ 复验」（core/drive.js:1172-1211）——M2 退役目标，N6 反例对象。
5. **预算账本单次制**：`runtime.json` budget `{wallClockBudgetMs, pointsBudget, spentMs, spentPoints}`，`initBudget` 拒绝交互重开，每 drive 重开（core/runtime.js:329-343, 356）；`spentPoints` 实际恒 0（drive 记 `points: 0`，core/drive.js:471/1136），真执法是账号级 5h 滚动水位（core/cost.js:234-247）。队列累计账本（M3）的自然挂点 = `initBudget`/`recordSpend` 两个写者。
6. **迁移机器不存在**：全仓无 migrate 代码；goal/dag/attempt/runtime 四账本 schema 全部 =1、校验和 fail-closed、无旧 schema 读路径。**approvals 附加无撤回**：`.lazyzcode/loop/approvals/` create-only（core/loop.js:794-813），writer = `plugin/hooks/trigger.js:51-140`（原子 tmp+rename），reader = `findApproval` slug+planHash 双键；隐式失效仅两处（计划改后 exact-hash 复核作废、supersede 换哈希不匹配旧记录），无任何撤回命令。

## 3. 批准/撤回面收口

以 §2 事实 6 的代码级事实收口（explorer 已核），不立活体探针——既定自有代码事实非未知能力，M0 出口不含该活体项；撤回机器化归 M1 `core/contract.js` 面（主方案 §3.1 撤回语义 + §7 模块表）。

## 4. 三仓试验定义（N2）

（待 N2 填充）

## 5. 积分归因探针（N3）

（待 N3 填充）

## 6. openchamber 浏览器回执（N4）

（待 N4 填充）

## 7. zpigeon-ios 模拟器回执（N5）

（待 N5 填充）

## 8. workers 重锚反例（N6）

（待 N6 填充）

## 9. 迁移样本（N7）

（待 N7 填充）
