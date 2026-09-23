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

## 5. 积分归因探针（N3，样本冻结 2026-09-24 凌晨）

探针：`scripts/probes/v030-m0-usage-probe.mjs`（真 HOME、plan 模式、平凡 prompt、3s 轮询账本）。样本原件 `artifacts/v030-m0-samples/sample-*.json`（gitignore，sha256 绑入证据包）。

### 5.1 usage 字段枚举（引擎 --json summary，source=provider）

`source, modelRequestCount, inputTokens, outputTokens, totalTokens, cacheReadTokens, cacheWriteTokens, reasoningTokens, webFetchRequests, webSearchRequests`——逐运行用量在摘要层**可得**（core 现为透传不消费）。

### 5.2 账本行可见延迟（决定性发现：在途不可见）

| 样本 | 运行时长 | 请求起始 lag | 轮询期可见行 | 行状态 |
| --- | --- | --- | --- | --- |
| single-1 | 10.1s | 4.1s | 3s/6s/9s 三次轮询全 0 | completed（仅运行结束后可见） |
| single-2 | 8.0s | 3.4s | 3s/6s 两次轮询全 0 | completed（同上） |
| conc-a/b（并行） | 10.7s/11.2s | — | 轮询全 0 | completed（结束后可见，双 session_id 独立成行） |
| interrupt（8s SIGKILL） | 8.0s | — | 轮询全 0 | **零行——20s 后复查仍无行** |

结论：model_usage 行在**请求完成时**才落库；在途请求账本不可见；被 SIGKILL 的在途请求消耗**服务端照常发生、账本永久假零**。检测粒度 = 每请求完成（多轮运行中每轮完成即可见一轮），延迟 ≈ 单请求时长。查询成本可忽略（8–26ms，带 started_at 下界过滤）。附带量级：平凡 prompt 单轮 input ≈ 78k tokens（会话固定开销，跨会话 cache 几乎不命中，768）；大上下文交互会话单轮 ≈ 168k。

### 5.3 并发可分性

双并行运行各得独立 `session_id` 行（sess_5b53… / sess_5973…），逐运行分离归因**可行**（按 session_id；会话目录列亦可作辅助）。

### 5.4 V08 能力判定草稿（对号 §5.2 三态）

**判定：仅事后统计 + 单请求完成粒度检测——诊断能力，不构成执行前硬限制。**

1. **执行前额度保留/硬限制：不可行**（当前引擎面）——无逐运行计量挂点、无请求级预算旗标（`--max-turns` 已移除）、在途请求账本不可见、被杀请求消耗不入账。
2. **带在途超额的近似限制：部分可行**——每请求完成即落账（检测延迟 ≈ 单请求时长），轮询检测 + 停止下一次派发可实现；在途超额结构性不可避免，且被 SIGKILL 的在途消耗账本假零（§5.2 中断样本）。
3. **后果（§5.2 预注册语义对号）**：V08「已批准上限能约束执行」在当前引擎面**不可通过**——事后记账/停止下一次派发只算诊断能力；近似限制语义属范围变更，须交用户拍板；未拍板前 **M3 累计积分硬顶验收阻塞**，发布验收连带阻塞。墙钟硬顶（进程 SIGKILL）不受此影响，仍为一等收束信号。

## 6. openchamber 浏览器回执（N4，2026-09-24 凌晨）

- 隔离夹具：`v030-fixtures/openchamber@5df72db2/`（冻结 `5df72db27`），`bun install`（3065 包，63s）+ `bun run build:web`（30s）全绿。
- 服务面：`node packages/web/bin/cli.js serve --port 4173 --foreground` → HTTP 200（27,447B HTML 壳，6.8ms）。
- 浏览器面（ego-browser）：打开实例 → 等待 SPA 渲染 → 打开设置弹窗 → 搜索框输入 `scrollbar` → 左栏过滤出 Appearance「Always show scrollbars」（含描述文案）——**M2 表面全链活体演练通过**。
- 截图：`artifacts/v030-m0-samples/oc-settings-scrollbar.png`（sha256 绑入证据包；侧栏背景虚化天然脱敏）。
- 运行清理：serve 进程已停（post-kill HTTP 000），浏览器任务空间已关闭（keep: []）。
- **配方注意点（M2 前必须处理）**：夹具实例自动检测并连接了本机在跑的 OpenCode（端口 62668）——设置页显示的是**用户真实数据**（侧栏会话历史）。只读观察无害且已脱敏，但 M2 注入试验必须换隔离 OpenCode 实例（或专用端口），不得让试验流量混入用户实例；本节观察全程未做任何写操作。

## 7. zpigeon-ios 模拟器回执（N5，2026-09-24 凌晨）

- 隔离夹具：`v030-fixtures/zpigeon-ios@e573516/`（冻结 `e573516`）；ZCodeKit 相对路径契约经夹具侧符号链接 `v030-fixtures/zpigeon → ../zpigeon` 满足（零写入主仓）；`scripts/dev-setup.sh` 前置三查全 ✔ → `xcodegen generate` 成功。
- 专用模拟器：`v030-probe-sim`（iPhone 17 · iOS 26.5，UDID 2D3A1192…），未触碰用户已有模拟器。
- 构建 ✔：`xcodebuild -project ZPigeon.xcodeproj -scheme ZPigeon -destination id=2D3A1192… -derivedDataPath build/dd build` → **BUILD SUCCEEDED**。
- 安装/启动 ✔：`simctl install` + `launch`（pid 17988/18640/19247）；截图 `artifacts/v030-m0-samples/zpigeon-launch.png`（通知权限弹框）。
- UI 自动化面 ✔：`xcodebuild test -only-testing:ZPigeonUITests/ZCodeWebParitySmokeUITests/testSmokeWorkspaceCardExpandCollapse` 真实执行 24.6s——XCUITest 跑过启动与首屏进入应用内容断言。
- **具体阻塞（如实记账）**：测试断言失败——原文 `XCTAssertTrue failed - 远程面 web 首页分区头应存在(收起全部钮)`（ZCodeWebParitySmokeUITests.swift:28）。根因=夹具无配对 web 面与带任务的数据（试验定义 §4.3 预告项）；xcresult 存档 `build/dd/Logs/Test/Test-ZPigeon-2026.09.24_00-37-08-+.xcresult`。
- **M0 判定**：构建/安装/启动/自动化四面全通；**数据准备是 M2 前置**（配对 web 面 + 任务数据配方），非环境阻塞。UI 自动化技术上可行（XCUITest 路径），通知弹框由测试 runner 自然处理。
- 附注：idb UI 后端缺席（`ios_ui_status: available:false`）；headless 模拟器无 GUI 窗口，AppleScript 点按不可用；`simctl privacy grant notifications` 被拒（Operation not permitted）、直写 TCC 行无效——UI 弹框交互以 XCUITest runner 为唯一已验证通道（M2 配方沿用）。

## 8. workers 重锚反例（N6，2026-09-24 凌晨，红绿完整）

- 夹具：`v030-fixtures/lazyzcode@4b54f77/`（冻结 `4b54f77`）内 LIGHT goal `v030-reanchor-repro`（人权门以 `LZY_ABLATE_HUMAN_GATE=1` 消融通过——反例对象是 `step done` 重绑路径，非采纳门，消融只用于夹具采纳，已如实记账）。
- 场景三步（全程 CLI 活体，命令与输出冻结）：
  1. **T1 绿半（真）**：`probe-marker.md` 含 ORIGINAL，`step done F1` 绑定指纹 `2f470b706b` @ `a5823fd`。
  2. **T2 红半对照（门正常执法）**：标记改 BROKEN 并提交（`d7a2c70`），`lzy loop verify` → `过期 1：F1`——无重绑时新鲜度门如实拒绝。
  3. **屏障形重绑（缺陷揭示）**：以 `core/drive.js:1195-1197` 同形态调用 `lzy step done F1 --evidence "wave-barrier rebind：workers 波 1 组装后复合指纹重锚（drive 代跑，未复跑断言）"` → 重绑成功，`verify` → `新鲜 1：F1`；同一树上 `git grep BROKEN` 命中——**证据被标现行而断言客观为假**。
- 结论：`step done` 重绑路径确实把「指纹重锚」当「证据现行」而不复跑断言——workers 波末屏障（drive.js:1172-1211）以该调用把整合候选的失败断言洗成新鲜证据。反例冻结为 M2 退役该路径的红面输入。
- 保真边界：本反例在屏障的**精确调用形态**上成立（explorer 核对屏障 shell 的即此命令形态）；全 workers 波活体复现（真引擎两工人）留 M2 退役工作顺带完成，不在 M0 展开。

## 9. 迁移样本（N7）

（待 N7 填充）
