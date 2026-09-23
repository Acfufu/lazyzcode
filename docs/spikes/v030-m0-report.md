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

## 4. 三仓试验定义（N2，冻结）

**隔离夹具总配方（拍板 4 五边界全适用）**：夹具根 `/Users/acfufu/Codehub/v030-fixtures/`（三仓主树之外、宿主树之外）；每仓 `git clone` 后 checkout 冻结 HEAD（下行逐仓钉）；主工作树与夹具路径在本节分开记录，永不混写；机密走运行环境注入，证据脱敏。注入的缺陷一律如实记账为「试验注入」。

### 4.1 lazyzcode（CLI 腿，M2 试点；M3 队列试点定义一并冻结）

- 冻结源：本仓 `4b54f77` → 夹具 `v030-fixtures/lazyzcode@4b54f77/`。
- 基准任务 A（单任务）：在夹具中注入「`loop drive --workers 0` 非法参数不再拒绝」的受控缺陷，驱动 0.3.0 候选修复为非零退出且零工人启动；中断后恢复并交付 A。
  - 入口（已核）：`node cli/lzy.js loop drive --workers 0`、`node cli/lzy.js --help`；workers 参数入口在 `core/drive.js`，契约测试在 `test/drive-workers.contract.test.js`（规划 §9 写的 `drive.contract.test.js` 指针据此订正）。
  - 红绿要求：非法参数拒绝必须在环境/目标前置条件**之前**可观察（不得以另一错误冒充）；反例 = 合法参数路径不受修复影响。
- 基准任务 B（队列，M3 开始时才验收，不作 M2 前提）：队列完成第一项 → 中断 → 重启续第二项；故障场景不得刷新预算、不得重复交付。验收面：新队列入口 + 累计账本（缺省值见拍板 3：90min/1200pt）；假引擎用例与真引擎结果分列。
- 通过判据：修复后 CLI stdout/退出码活体、零启动副作用、真实引擎续跑在案。

### 4.2 openchamber（Web 腿，M2 试点）

- 冻结源：`5df72db27` → 夹具 `v030-fixtures/openchamber@5df72db2/`。
- 基准任务：在夹具中注入「scrollbar 查询映射不到外观设置」的受控缺陷，驱动修复 `scrollbar` 查询到外观设置的流程，并在浏览器**实际打开**对应设置页取证。
  - 入口（已核）：`bun run build:web`；`node packages/web/bin/cli.js serve --port 4173 --foreground`；`bun test packages/ui/src/lib/settings/search.test.ts`（scrollbar 用例已存在，3 处提及）；`bun run type-check:ui`；`bun run lint:ui`。
  - 隔离契约：按项目规范准备隔离实例与 OpenCode 依赖；夹具仓的 Git 权限单独声明（该项目规则=未经明确请求不做 Git 操作），不得用本仓授权暗中覆盖。
  - 红绿要求：浏览器操作不可由纯函数测试替代——绿半必须含浏览器在目标设置页的实拍。
- 通过判据：纯函数测试绿 + 浏览器实流回执（§6 探针先行验证该面可行）。

### 4.3 zpigeon-ios（原生腿，M2 试点）

- 冻结源：`e573516` → 夹具 `v030-fixtures/zpigeon-ios@e573516/`；兄弟依赖 `../zpigeon/Packages/ZCodeKit`（`188991a`）路径随夹具配方重绑。
- 基准任务：在夹具中注入「工作区卡片无法展开/收起」的受控缺陷，驱动修复并**实际展示行列表变化**，随后重启恢复测试现场。
  - 入口（已核）：`scripts/dev-setup.sh`；`xcodegen generate`；`xcodebuild -project ZPigeon.xcodeproj -scheme ZPigeon -destination 'platform=iOS Simulator,name=iPhone 17' build`；UI 测试 `ZPigeonUITests/ZCodeWebParitySmokeUITests.swift` 的 `testSmokeWorkspaceCardExpandCollapse`。
  - 环境事实：本机 Xcode 27.0 + iOS 26.5（规划写 iOS 26，实际 26.5 满足）；需专用模拟器配对与带任务的数据；配对/数据不可复现即为具体阻塞（§3.2：不得换易面、不得跳过后报绿）。
  - 红绿要求：现有测试含固定 sleep/空态分支——新验收等待**具体 UI 状态/事件**，不照搬固定 sleep。
- 通过判据：构建 + 安装 + launch 回执、UI 状态变化截图、重启恢复回执。

### 4.4 串行序（拍板 5）

M2 试点执行序 lazyzcode → openchamber → zpigeon-ios；今晚探针序 §5 → §6 → §7 严格串行（xcodebuild/构建噪声不与积分归因采样重叠）。

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
