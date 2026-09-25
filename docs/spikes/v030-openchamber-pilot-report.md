# v030-openchamber-pilot — 0.3.0 openchamber Web 腿试点 A 报告

goal `v030-openchamber-pilot`（HEAVY/risk med，契约 `.lazyzcode/contracts/v030-openchamber.md`，contractHash d9e26f07…，UPS 批准 2026-09-25）。
路线：主方案 `docs/plan-v030-agent-first.md` §9/§10-M2；M0 报告 `docs/spikes/v030-m0-report.md` §4.2/§6；拍板 5 串行序第二腿（lazyzcode 腿已由 v030-m2/m3 落地）。出口判据：受控缺陷被真引擎驱动修复 + 浏览器实流取证（V03/V04 子集）→ 三仓 A 出口推进至 2/3。

## 1. 冻结基线（N1，2026-09-25）

| 项 | 值 |
| --- | --- |
| 宿主 HEAD | `ac96644fc23db7a10a224efd57fc0ee3cb960b48`（tree `49ce67c176bf5ce69fae1b5833fc7afa61361f73`，树清洁） |
| 夹具 HEAD | `5df72db272aa8e80e75200d4a55d3069cdc59dca`（tree `62a0dadfd3fcaa4386040bedbd879f877825c400`，detached 清洁） |
| 工具 | node v24.19.0 · bun 1.3.14 · opencode v2.0.15 |
| 端口 | 14096/4177/62668 全空闲（断言原文 `artifacts/v030-oc/baseline/pins.txt`） |
| 用户 opencode 数据 | `~/.local/share/opencode/opencode.db` 6,544,658,432 B · mtime 2026-09-24 09:47（静止态，数据面快照断言用） |
| 宿主 npm test 改前计数 | **567/567 pass**（0 fail，50.2s；`baseline/host-npm-test-baseline.txt`） |
| 夹具 build:web | exit 0，**32.5s**（M0 基线 30s，KU2 首证对齐；`baseline/build-web.txt`） |
| 夹具靶向基线 | `search.test.ts` **7 pass / 0 fail / 14 expect**（72ms；`baseline/search-baseline.txt`） |
| 夹具 ui 套件改前计数 | **527/527 test files passed**（38.0s；`baseline/ui-suite-baseline.txt`） |

## 2. 侦察事实表（explorer 七问，计划期 2026-09-25）

| # | 事实 | 证据 |
| --- | --- | --- |
| 1 | M2 夹具试点配方：双层 goal（宿主 HEAVY 契约 / 夹具 LIGHT 消融门）+真引擎 drive+红半改前预捕+sha256 附件；夹具内相对 CLI 调用=自举混淆（须宿主绝对路径） | `docs/spikes/v030-m2-report.md:58-73` |
| 2 | M3 夹具驱动：queue 家族以夹具根为 cwd、宿主候选 CLI 绝对路径驱动；契约门消融批准落账走 recordAuthorization 受信写者并如实记账 | `docs/spikes/v030-m3-report.md:59-63`；`core/contract.js:206-218` |
| 3 | OpenCode 发现机制四支（复用自管进程/外挂钉定 env/探活自动附着/托管自起），auto-detect 支即 M0 连上用户 62668 的成因；env 钉定点=OPENCODE_PORT/OPENCHAMBER_OPENCODE_PORT/OPENCHAMBER_INTERNAL_PORT/OPENCODE_HOST+OPENCODE_SKIP_START；数据面在 XDG_DATA_HOME 侧（opencode.db/auth.json） | 夹具 `packages/web/server/lib/opencode/lifecycle.js:1044-1131`、`env-config.js:28-72`、`shared.js:9-13` |
| 4 | 注入面：`appearance.scrollbars` 条目（search.ts:92-98）加 `isAvailable` 假守卫→四 runtimeCtx 全滤除、靶向用例红；**删 keywords 无效**（haystack 含已解析 title，titleKey 自带 scrollbars 子串） | 夹具 `search.ts:92-98,1181-1226`、`search.test.ts:21-31`、`en.settings.ts:32-33` |
| 5 | 契约形：头键白名单 task/endpoint/scope/recipe/budget-ref/non-goals+`- [A1]` 验收项；五查=磁盘哈希/授权有效/accepts 覆盖/subjects⊆scope/配方一致 | `core/contract.js:17,69-99`；M3 夹具 `contracts/q1.md` 实物 |
| 6 | 执行通道=M2 同形普通 goal loop+真引擎 drive（HEAVY 不入队，M3 债 I）；浏览器回执按外部表面证据落 F 项附件 | `docs/plan-v030-agent-first.md:97-98,242`；`docs/spikes/v030-m3-report.md:84` |
| 7 | 夹具脚本：build:web=`bun run --cwd packages/web build`；type-check:ui/lint:ui 根脚本；serve=`node packages/web/bin/cli.js serve` | 夹具 `package.json:28,35,41`、`packages/web/bin/lib/cli-args.js:609-611` |

## 3. 评审轮记录（HEAVY 计划门，lazyzcode:plan-reviewer）

- **R1 REVISE**（四条 MUST-FIX）：(1) deps 行整体错位=五条自指边（解析器家法：deps 紧随所属条目下一行）；(2) 隔离只钉 XDG_CONFIG_HOME 未钉 XDG_DATA_HOME——opencode 数据面（db/auth）在 data 侧，构造型违反契约 non-goals，前后「无用户数据」侧栏断言可能不触发；(3) N6/F5 绑「N1 实测计数」但 N1 未列宿主 npm test 与夹具 ui 套件改前计数；(4) F3 无红半归属也无豁免行。
- **R2 PASS**：四条全核销（deps 重排 :22/:24/:26/:28/:30；双 scratch XDG 两支恒设+N3 数据面断言+KU1 同步；N1 明列双计数；F3 红半=N4 SIGKILL 活体）；三条非阻塞警告全采纳（db 快照断言附 lsof 差分归因规则防用户实例常态写入误停；四 env 覆盖两个 spawn env 各查一次；夹具契约布局分歧注明有意）。
- **R3 字面确认（标题 300 上限裁剪）维持 PASS**：N1/N2/N3 标题压至 ≤300 字（版本数值回计划头基线行、归因规则移拍板 2 散文），deps/accepts/F 面/KU 零漂移。
- 计划快照 sha256 `adbf40ce42…`（`.lazyzcode/loop/snapshots/v030-openchamber-pilot.md`）。

## 4. F 面预注册

| F | 面 | 表面（取证器具） | 红半 |
| --- | --- | --- | --- |
| F1 | 夹具链路与基线锚 | 夹具 git log + 夹具 CLI stdout | waive（纯新增锚定面；无授权拒负路径已在正文采补） |
| F2 | 注入红半与修复绿半 | bun test stdout + 夹具 git log | N3 注入后四上下文红 stdout+红截图 |
| F3 | 真引擎驱动与中断恢复 | 夹具 CLI stdout + 夹具 git log | N4 SIGKILL 中断原文+僵尸租约处置前活体 |
| F4 | 浏览器实流取证 | 截图 sha256 + 夹具 serve stdout | N3 缺陷态无命中实拍 |
| F5 | 整合验证与回归聚合 | CLI stdout | waive（回归聚合面，反态=人为造红无意义） |

## 5. Known unknowns 判定（收口）

1. **OpenCode 隔离配方形态**：外挂钉定支②**成立**——`OPENCODE_SKIP_START=true+OPENCODE_PORT=14096` 下 serve 日志原文「Using external OpenCode server at http://localhost:14096 (skip-start mode)」「Detected OpenCode port: 14096」，健康探活 `{"healthy":true,"version":"1.18.18"}`。前置校正：宿主 PATH 的 opencode v2.0.15 **API 断代**（`/global/health` 落 SPA、真 API 移 `/api/*` 且需鉴权 401），夹具需 1.18.x 线（SDK 1.18.31；用户环境 Managed OpenCode 1.18.18，见 `~/Codehub/openchamber-freeze-issue-1.18.2.md`）——本 goal 隔离安装 `opencode-ai@1.18.18` 于 `artifacts/v030-oc/oc118/`（npm12 allowScripts 拦 postinstall→手动等效复制平台二进制 Mach-O arm64）。托管自起支④未启用（外挂支即通）。
2. **bun 1.3.14 版本差**：不炸——build:web 32.5s exit 0（基线 30s 同量级）、靶向测试与 ui 套件（527/527）全复现；packageManager 声明 1.4.2 未触发任何行为差异。
3. **真引擎在夹具 AGENTS.md 默认拒 git 语义下完成提交**：**引擎服从显式授权**——修复提交 96f6da5ca（消息含「试点修复」+`Goal: v030-oc-pilot#N1` 尾注）与标记提交 1371950bf 均由引擎段内自主落地，无「引擎段外补偿动作」。

## 6. 执行记录

- **N2 夹具落库**：分支 `v030-oc-pilot`（基点 5df72db272）→清单 `lzy.project.json`（check 三配方 ui-search/type-check-ui/lint-ui，recipe sha8=`172ec87b`）+契约 `contracts/pilot.md`（hash `8d09854d…`）+计划 `plans/pilot.md` 提交 `2f0a18292`→夹具 goal 注册（LIGHT）→**无授权 adopt 拒原文**（「批准 8d09854d」）→`recordAuthorization` 受信写者落账（sessionId 种子标记如实标注非 UPS 人工事件，M3 先例）→adopt 过+start（基线 tree `b28275c087`）。夹具 `.lazyzcode/` 经 `.git/info/exclude`（checkout 本地）排除。
- **N3 注入与红半**：注入提交 `8c0d30b48`（如实标注试验注入）→靶向测试红（`6 pass / 1 fail / exit 1`，`finds the scrollbar preference on every surface` fail，其余 6 例不受影响）→浏览器红半实拍（搜索 scrollbar → 左栏 `No matching settings`）。**陈旧 bundle 插曲**：首轮红半命中 N1 预构建产物（build 先于注入）→重建后复抓（陈旧误拍存档 `settings-scrollbar-STALE-bundle.png`）。
- **N4 真引擎驱动与恢复**：drive#1（fence 1）段中交付修复提交后 SIGKILL 驱动树 →僵尸租约原文（`hostPid 70543` 已死，`expiresAt` 未到）→重驱被租约门拦原文→`lease reclaim`（「租约已回收：fence 1（持有进程已不存在）——下次 acquire 发新号」）→drive#3（fence 2，段 212.3s+190.1s）续跑：N1 认「修复已在」不重复提交→N2 marker→F1/F2 引擎自采证据→**goal done**+终验 attestation `v030-oc-pilot-20260925T020411Z.json`。断言：修复提交恰 1 条、`git diff 5df72db272 HEAD -- search.ts` 空（blob 全同）、靶向 7/7 绿、树清洁。
- **N5 浏览器绿半**：重建（修复后）→加固配方 serve→搜索 scrollbar **命中**「Always show scrollbars」（含描述文案）→点击结果**实际打开 Appearance 设置页**（URL `?settings=appearance`，复选项在场）→两张实拍。清理回执：4177/14096 post-kill 000、浏览器空间 `keep:[]` 关闭。
- **N6 整合验证**：夹具 `type-check:ui`/`lint:ui` exit 0、ui 套件 **527/527**（=改前基线）；本仓 npm test **567/567**（=改前基线）。

### 6.1 隔离面事故与加固（如实记账）

**首版隔离配方（双 XDG 变量）不足**：openchamber web 服务端配置面走 `os.homedir()/.config/openchamber`（`package-manager.js:30` 硬编码，不吃 XDG），pilot serve 因此**写入了用户 live 配置目录**（`~/.config/openchamber/`：`settings.json`、`preferences.json`、`projects/*.json` 18 件、`logs/openchamber-4177.log`、`run/`；两批 mtime=09:39:03/09:51:25，均在我方 serve 存活窗内，用户侧无 openchamber server 进程）。**损害评估**：内容逐项扫无夹具指纹（无 v030/5df72db2/4177/14096 字样）；唯一语义可见变更为 `preferences.json` 的 `sidebarSessionGroupingMode.updatedAt` 落新值；我方 0 字节日志件已删除（`logs/openchamber-4177.log`；M0 期同款 `openchamber-4173.log` 非本 goal 产物未动）。**加固**：serve 与 opencode 双双加 `HOME=<scratch>` 覆写（+`OPENCODE_BINARY` 钉 1.18.18）→app 状态全面转向 `artifacts/v030-oc/home/.config/openchamber/`；加固后（09:54 起）用户目录**零新写入**（`find -newermt` 空）、用户 db 字节/mtime 不变（6,544,658,432 B / Sep 24 09:47）。教训：**进程级隔离不能只钉 XDG——`os.homedir()` 系路径须 HOME 覆写一并钉**（M0 §6 只关了 attach 层）。

## 7. 债记账（收口时点）

- **债 L（新记，重要）**：openchamber 服务端配置面不吃 XDG（`os.homedir()/.config/openchamber` 硬编码）——任何以 openchamber serve 为执行体的试点/交付（含后续 zpigeon 配对或 M4 面）必须钉 HOME 覆写；上游可提 issue（配置面应尊重 XDG）。本 goal 内已加固并验证零泄漏。
- **债 M（新记）**：opencode v2.0.15 与夹具所需 1.18.x 断代（API 前缀+鉴权变更）——后续腿环境配方须钉 opencode 版本线；本机可用路线=隔离安装 `opencode-ai@1.18.18`（npm12 下 postinstall 被 allowScripts 拦，需手动等效复制平台二进制）。
- **债 N（新记，轻）**：源码态浏览器取证前必须重跑 `build:web`（dist 陈旧会产假性红/绿）；本 goal 首轮红半即踩中并复抓。
- **债 I 关联重申**：本腿=A endpoint 单任务、普通 goal loop+真引擎 drive（未用 queue，HEAVY/多待办面归 M4）——与 M3 债 I 收窄一致。
- **债 F/J**：不涉（无外部写动作、无队列孤儿引擎面；驱动树 SIGKILL 后引擎随父消亡、无孤儿续写观测）。

## 8. 消耗实账

| 项 | 值 |
| --- | --- |
| 墙钟 | drive#1（fence1）lease 01:55:48→SIGKILL 01:58:16（~148s，段中）· drive#3 段1 212.3s + 段2 190.1s = 402.4s |
| 积分（hostdb model_usage×ADR-0023） | drive#1 `sess_3f6dee91`=**1.626** · drive#3 `sess_299f9ae5`=**5.539** · 合计 **7.165** |
| fence | #1 → reclaim → #2（单调递增，绝不重用） |
| 夹具 goal 交付 | 修复 `96f6da5ca` + 标记 `1371950bf` + 终验 attestation（`.lazyzcode/attestations/v030-oc-pilot-20260925T020411Z.json`） |

## 9. 对抗清单自查（docs/research-adversarial-checklist.md 九类，2026-09-25 收口）

本 goal 新增面：宿主零代码改动（机械只消费）；夹具侧=试点分支四提交 + `.lazyzcode/` 状态 + 隔离面脚本族。逐类：

1. **malformed input——既有机械覆盖**：夹具契约/清单/计划均过既有校验（契约门五查活体：无授权拒→落账→过）；队列/预算族未使用。注入面=单行（无新解析面）。
2. **prompt injection——面收窄但需记**：引擎在夹具仓运行（yolo 段），读夹具 AGENTS.md 与计划；夹具规则「不做 git 除非明确请求」被计划/契约的显式授权覆盖（设计意图，非注入）。爆炸半径=夹具仓；宿主树零改动（证据：宿主 npm test 567/567 与树清洁）。
3. **cancel-resume——本 goal 主题（活体在案）**：段中 SIGKILL→僵尸租约（fence1，holderPid 死）→租约门拦重驱→reclaim→fence2 重驱→零重复交付（修复提交恰 1）；「认已交付不重复提交」由引擎段内判断落地。
4. **stale state——两类实锤**：陈旧 dist bundle（假性红半）已复抓+记账债 N；僵尸租约 fence 单调递增（1→2）。夹具 F 证据由夹具 goal 自身红绿门约束（finish 通过）。
5. **dirty worktree——全程清洁**：夹具树每次断言均清洁（含 finish 前）；宿主树清洁；`.lazyzcode/` 本地排除（info/exclude）已记录。
6. **hung commands——既有预算**：drive 段上限 6/墙钟 1800s 生效；两 drive 均正常收束（无悬挂）。
7. **flaky tests——重复一致性**：夹具靶向测试三次运行一致（基线 7/7 / 注入后 1 fail / 修复后 7/7）；ui 套件两轮 527/527；宿主两轮 567/567。
8. **misleading success output——对抗已加固**：零重复断言用提交枚举+blob 全同（不靠「跑绿了」自证）；陈旧 bundle 假红被内容断言（有无人名/关键词）而非仅截图识破；隔离面以三组独立断言（探活/数据面/无用户数据）+加固后零写入复核。
9. **repeated interruptions——单次演练足够**：一次段中 SIGKILL+一次 reclaim+一次重驱；fence 机制防重复租约，无并发驱动。

