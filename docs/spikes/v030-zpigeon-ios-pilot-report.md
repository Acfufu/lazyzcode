# v030-zpigeon-ios-pilot — 0.3.0 zpigeon-ios 原生腿试点 A 报告

goal `v030-zpigeon-ios-pilot`（HEAVY/risk med，契约 `.lazyzcode/contracts/v030-zpigeon-ios.md`，contractHash 64e91dd7…，UPS 批准 2026-09-25）。
路线：主方案 `docs/plan-v030-agent-first.md` §9/§10-M2；M0 报告 `docs/spikes/v030-m0-report.md` §4.3/§7；拍板 5 串行序第三腿（lazyzcode 腿已由 v030-m2/m3 落地、openchamber 腿已由 v030-openchamber-pilot 落地）。出口判据：受控缺陷被真引擎驱动修复 + 实际展示行列表变化 + 重启恢复测试现场（V03/V04 子集）→ 三仓 A 出口推进至 3/3。

## 1. 冻结基线（N1，2026-09-25）

| 项 | 值 |
| --- | --- |
| 宿主 HEAD | `543a7edf2a70519b836d9390044ddd164dc7823a`（tree `161ea40b2a5a158f1d42e5ff985f9d7d5d7cc700`，树清洁） |
| 夹具 HEAD | `e5735163b86459306c2edc525ee847b7c7c4ff78`（tree `1a968ecaf0884301c1455a0e7f581b0f92f26d95`，detached 清洁） |
| 兄弟 ZCodeKit | `188991ad9cf11dade0e67ad299023c04c9463bfd`（只读冻结，经符号链接 `v030-fixtures/zpigeon` 解析相对路径契约） |
| 工具 | node v24.19.0 · Xcode 27.0（27A266a）· iOS 26.5 模拟器运行时（23F77） |
| 专用模拟器 | `v030-probe-sim`（iPhone 17 · iOS 26.5，UDID `2D3A1192-E7B0-47FF-BC33-B51993082B03`）在场断言 ✔ |
| 中继端口 | 18787 空闲断言 ✔（`lsof -i :18787` 零行；`artifacts/v030-zp/baseline/pins.txt`） |
| 宿主 npm test 改前计数 | 见 §1.1（`baseline/host-npm-test-baseline.txt`） |
| 夹具 build/dd 增量探针 | 见 §1.1（`baseline/build-probe.txt`）——裁决复用或清重建 |

## 2. 侦察事实表（explorer 八问，计划期 2026-09-25）

| # | 事实 | 证据 |
| --- | --- | --- |
| 1 | 注入面=宿主视图 `RemoteHomeView` 的 toggle 汇聚点：`@State expanded: Set<String>`（:26）、toggle 处理器（:281-285）、卡头 `onToggle` 接线（:267）；最小注入=函数体熔断（展开/收起两向失效），收起全部钮 `expanded.removeAll()`（:295-303）独立路径不受影响；defaultExpansion 直改集合不经 toggle（:188-192）故注入态首卡默认展开仍渲染 | 夹具 `ZPigeon/Sources/Features/Home/RemoteHomeView.swift:26,188-192,267,281-285,295-303` |
| 2 | UI 测试 `testSmokeWorkspaceCardExpandCollapse`（:90-122）：守门断言 :28 `homeCollapseAll` 20s 等待→收起全部→行数 0→点卡头→行数>0（:113）→再点→行数 0（:121）；前置=Keychain 至少一条配对（否则空态壳 DrawerShell.swift:63-72）+cards 非空（否则「暂无任务」） | 夹具 `ZPigeonUITests/ZCodeWebParitySmokeUITests.swift:3-7,13-29,90-122` |
| 3 | 配对三路：相机扫码/粘贴 UI/`-PairingURL` launch 参数自动入库（AppShell.swift:23-29 读、DrawerShell.swift:83-86 `.task` 写）——XCUITest 传参即可配对，无需 UI 输入；持久于 Keychain（service `io.zpigeon.app`/account `pairings.v1`）；URL 解析要求查询参数 sid/hash/t（必有）+mid/name/app_version/theme（可选）；**web 面=配对 URL host 派生 ws(s)://host/ws 的 ZCode 中继，非 openchamber**（oc 腿债 L 预判修正） | 夹具 `ZPigeon/Sources/AppShell.swift:23-29`、`ZPigeon/Sources/Features/Shell/DrawerShell.swift:83-86`；ZCodeKit@188991a `Remote/RemoteURL.swift:38-61,63-75` |
| 4 | 任务数据=桌面 bootstrap 应答按设备落盘快照：UserDefaults 键 `zpigeon.bootstrapSnapshot.<deviceSid>`（deviceSid=配对 record.id=sid），上限 50 条；DeviceSession.init 先播种缓存（「启动先画」）；卡列表在 `.idle/.connecting` 缓存态即渲染，`.failed` 才被 failedView 盖掉；pairTimeout=60s | 夹具 `ZPigeon/Sources/Support/BootstrapSnapshotCache.swift:38-40`、`ZPigeon/Sources/Features/Devices/DeviceSession.swift:27-32,50-53`、`ZPigeon/Sources/Features/Home/RemoteHomeView.swift:196-213` |
| 5 | 连接状态机：RelayClient（terminal sid+passHash）→RemoteClient→`waitPaired(timeout:60)`→`rem.bootstrap()`；帧构造器 RelayClient.swift:564-607；深链 `zpigeon://session/<id>` 与配对无关 | ZCodeKit@188991a `Relay/RelayClient.swift:564-607`；夹具 `DeviceSession.swift:63-109` |
| 6 | 构建链：`scripts/dev-setup.sh` 只读三查零写入（kit 目录/Package.swift/git 树）→`xcodegen generate`（xcodeproj 不入库，project.yml 唯一约束面，Kit 相对路径 `../zpigeon/Packages/ZCodeKit`）→`xcodebuild -scheme ZPigeo -destination id=… build/test`；**单工人 drive 无 worktree（core/drive.js:246 N=1 现行行为）→Kit 相对路径契约保真** | 夹具 `scripts/dev-setup.sh:14-50`、`project.yml:7-9,13-14`、`.gitignore:1-2`；宿主 `core/drive.js:246` |
| 7 | 仓规则：夹具与兄弟仓均无 AGENTS.md/CLAUDE.md；夹具 CONTRIBUTING.md 纪律=配对 hash 绝不入 git（:91）/零多余网络面（:92）/INFRA-RED 不发活体测试不清桌面任务（:84）/冒烟离线类模拟器可跑（:75-76）；兄弟仓 README「逆向产物永不入本仓」「凭据永不入 git」——**无 openchamber 式禁 git 条款**，宿主契约仍明示本地 git 授权面 | 夹具 `CONTRIBUTING.md:75-115` |
| 8 | 重启恢复语义：持久=Keychain 配对+bootstrap 快照 UserDefaults+@AppStorage（organizeBy/sortBy/preferredAgent）；不持久=展开态（@State 重启回 defaultExpansion 首卡）/userDisconnected/selectedDeviceId；快照覆写仅发生在 connect/refresh 成功时（:95,:210）——「重启恢复测试现场」=Keychain+快照仍在→卡列表行集合原样重现 | 夹具 `RemoteHomeView.swift:23-24,26,188-192`、`DeviceSession.swift:27-29,95,210` |

## 3. 评审轮记录（HEAVY 计划门，lazyzcode:plan-reviewer）

- **R1 REVISE**（一条 MUST-FIX+三条非阻塞）：N1/N3 两条清单项标题超 `TITLE_MAX=300` 机器硬上限（309/474 字符，ITEM_RE core/loop.js:524 + JS `.length` 口径，超限即 LoopError 拒采纳）；WARN=中继端口未钉死建议钉候选值、三处 ZCodeKit 文件引用缺仓限定、（已实证面清单供 R2 免查：契约哈希/subjects/accepts 覆盖/deps 链/驱动机械引用/注入面与数据面行号全核实属实）。
- **R2 PASS**：MUST-FIX 核销（N1 309→240、N3 474→292，全部 12 条机器同口径复测 ≤300）；三条 WARN 采纳落盘（端口钉 18787+顺延规则、兄弟仓引用补 `ZCodeKit@188991a` 前缀、`.git/info/exclude` 冗余句删除改引夹具 .gitignore 事实）；全量复扫无回归（UNDECIDED_RE 零命中、deps/accepts 形健、subjects 可过、契约字节未动）。
- 计划快照 sha256 `acec729df1…`（`.lazyzcode/loop/snapshots/v030-zpigeon-ios-pilot.md`）；契约 UPS 批准 2026-09-25（短码 64e91dd7）。

## 4. F 面预注册

| F | 面 | 表面（取证器具） | 红半 |
| --- | --- | --- | --- |
| F1 | 数据面配方与基线锚 | simctl/xcodebuild stdout+截图 sha256+夹具 git log | N1 复捕：无配对无数据冒烟测试红于 :28 分区头断言原文 |
| F2 | 注入红半与修复绿半 | xcodebuild test stdout+xcresult+夹具 git log | N4 注入后断言死于「点卡头应展开」stdout+xcresult |
| F3 | 真引擎驱动与中断恢复 | 夹具 CLI stdout+夹具 git log | N5 SIGKILL 中断原文+僵尸租约处置前活体 |
| F4 | UI 实流取证与重启恢复 | 截图 sha256+xcresult+simctl stdout | N4 注入态红 xcresult 附件/红截图（行列表不恢复实证） |
| F5 | 整合验证与回归聚合 | CLI stdout | waive（回归聚合面，反态=人为造红无意义） |

## 5. 实施记录（随步追加）

- N1：本节即骨架；基线钉版回执 `artifacts/v030-zp/baseline/pins.txt`（16 行）。

### 1.1 两项基线计数与探针（N1 实测）

- 宿主 npm test 改前计数：**567 pass / 0 fail**（90.8s，exit 0；与 oc 腿收口计数一致）——`baseline/host-npm-test-baseline.txt`。
- 夹具 build/dd 增量探针：`xcodebuild build`（destination id=2D3A1192…，-derivedDataPath build/dd）→ **BUILD SUCCEEDED，21.4s**（M0 残留增量复用成立，不清重建）——`baseline/build-probe.txt`。
- 红态复捕（M0 阻塞活体）：无配对无数据当前态下冒烟测试 **failed（26.5s）**，断言原文 `ZCodeWebParitySmokeUITests.swift:28: XCTAssertTrue failed - 远程面 web 首页分区头应存在(收起全部钮)`——与 M0 报告 §7 阻塞原文逐字同形——`red/red-m0-state-test.txt`（F1 红半）。

### 5.1 N2 数据面配方与 M0 阻塞解阻（2026-09-25）

- **配方三件按拍板 7 顺位一次通过，零换级**（KU1/KU2 首选支直接成立）：
  1. 假中继：`pilot-relay.mjs`（零依赖 Node，silent 模式）起 127.0.0.1:18787 → app 连接回执 `[relay] upgrade accepted path=/ws`——http→ws 派生与静默升级窗成立（app 停 `.connecting` 显示「正在连接,先显示上次的任务列表」横幅，缓存卡列表持续渲染）。
  2. 快照播种：`simctl spawn defaults write io.zpigeon.ZPigeon zpigeon.bootstrapSnapshot.v030zpilot -string '<合成 JSON>'`——**首试无 `-string` 类型被 defaults 旧式 plist 解析拒（如实记），显式 `-string` 后读数回执逐字节一致**；JSON 形状按消费端反推一次命中（workspaces[workspaceKey/workspacePath/label/kind]+tasks[taskId/title/displayStatus/createdAt/updatedAt/workspacePath]）。
  3. 配对注入：`simctl launch io.zpigeon.ZPigeon -PairingURL 'http://127.0.0.1:18787/remote/v4?sid=v030zpilot&hash=<合成>&t=<毫秒>'`（ProcessInfo.arguments 通道）——Keychain 入库+设备切换器现「未命名设备」。
- **M0 阻塞解阻实证截图**：`baseline/launch-paired-cards.png`（sha256 绑 F1）——分区头「当前设备上的工作区和任务 2 个工作区 · 2 个任务」+v030-ws-a 卡片「1 个任务」+任务行「v030 expand collapse probe」在场；通知权限弹框由 XCUITest runner 自然处理（M0 同款）。
- **注入前基线绿 ×2**（KU1 连续一致性判据）：`testSmokeWorkspaceCardExpandCollapse passed` **13.347s**（run1）/ **11.110s**（run2），均 exit 0——`baseline/green-run1.txt`/`green-run2.txt`；对照红态复捕 :28 失败=配方前红、配方后绿，F1 红绿两半齐。
- 配方回执汇总 `baseline/n2-recipe-receipt.txt`（relay 日志+seed 读数+截图 sha256）；回执文件 sha256：n2-recipe-receipt `f4a4aea447c10148…`、screenshot `168d2b34cf3e4881…`（终值绑证据账本）。
