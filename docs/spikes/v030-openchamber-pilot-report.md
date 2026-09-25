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

## 5. Known unknowns 状态

1. **OpenCode 隔离配方形态**（外挂钉定支② vs 托管自起支④）→ N3 证伪路径（探活+数据面断言+无用户数据断言）。
2. **bun 1.3.14 vs packageManager bun@1.4.2 版本差**→ N1 首证对齐（build 32.5s exit 0、靶向 7/7 绿、ui 套件 527/527 绿）——暂不炸，N4/N5 期间继续观察。
3. **真引擎在夹具 AGENTS.md 默认拒 git 语义下完成修复 commit**→ N4 证伪路径；不落则驱动侧代落并如实分记「引擎段外补偿动作」。

## 6. 执行记录

（N2–N6 随执行追加）

## 7. 债记账

（收口时点）

## 8. 消耗实账

（收口时点：墙钟=drive 段记录实际值；积分=hostdb model_usage 按段 sessionId 查询按 ADR-0023 折算）
