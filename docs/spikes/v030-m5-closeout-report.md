# v030-m5-closeout 报告 — 0.3.0 M5 迁移与发布收口

- goal：`v030-m5-closeout` · tier heavy · risk high · 契约 `a65e57fe`（docs/spikes/v030-m5-contract.md）
- 计划：.lazyzcode/plans/v030-m5-closeout.md（13N+7F；快照 31d7c6c9c2）
- 执行日：2026-09-25 起（宿主 main 直做；子代理串行——并发纪律建议上限 1）
- 设计依据：docs/plan-v030-agent-first.md §8 迁移 / §10 M5 / §11 V01–V12；ADR-0024/0025/0027/0028 前链

## 1. 冻结基线（N1，改前活体）

| 项 | 读数 | 采集 |
| --- | --- | --- |
| HEAD | `8ef38fed1e6eaf7549e34cca37c62dc78dc16a56` | `git rev-parse HEAD` |
| tree | `6d3073b84ed8fa6b2d417cb32a11f61d7a8a4b13` | `git show -s --format=%T HEAD`（zsh 花括号雷规避配方） |
| branch | main（提交前断言） | `git branch --show-current` |
| origin/main | `ab9e1efacab1d7a09c68d70c461519a222e2a89a`（本地领先 3 · 落后 0） | `git rev-list --left-right --count main...origin/main` |
| CI 四腿改前真值 | run `36142988403` @ origin/main：`test (22, ubuntu-latest)`/`test (22, windows-latest)`/`test (24, ubuntu-latest)`/`test (24, windows-latest)` 全 success（2026-09-25T13:45Z）；前一轮 e514c7d（PR#2 merge）failure=债 M4-1 已知 flake | `gh run list --workflow ci.yml --branch main --limit 2` + `gh run view 36142988403 --json jobs` |
| Pages 部署腿 | run `36142987560` pages build and deployment success（同 SHA） | 同上 |
| npm test 改前基线 | **603/603 绿**（pass 603 · fail 0 · skipped 0），duration_ms 75281，node v24.19.0，EXIT=0；日志存证 artifacts/v030-m5-red/n1-baseline-npm-test.log | 当次实跑 |
| 工具链 | node v24.19.0 · npm 12.1.0 · gh 2.101.0（2026-09-15） | `--version` |
| 版本三体 | package.json=0.2.4 · plugin/.zcode-plugin/plugin.json=0.2.4 · CHANGELOG=`## [Unreleased]`（含 M3/M4 条目，无 0.3.0 定版条目） | `grep '"version"'` + `head` |
| 红半场地 | artifacts/v030-m5-red/（gitignore 面，本地存证） | mkdir |

## 2. explorer 八问事实表（2026-09-25 侦察，plan-reviewer 复核引用）

1. **core/migrate.js 现状**：仅 `lzy migrate preview <root>`（cli/lzy.js:1186-1200 cmdMigrate；分派 :1562；help :1046-1047）。输出 `{root, warnings[], tasks[]}`，task 草案={task, acceptanceDraft[](自快照 F 断言), endpoint 恒 "A", authorization 恒 "NONE", counts, privilegeEscalationProhibitions[4]}（core/migrate.js:133-183）。枚举 6 族：goal.json、attestations/*.json、loop/snapshots/*.md（含 .attempt<n>）、loop/salvage/*.md、loop/approvals/*.json、evidence/*.report.md（:80-132）。损坏处理：attestation/approval 不可解析→⚠不阻断；快照不可读→⚠跳过；goal.json 不可解析=硬拒（:50-55）；活跃 goal=拒（:56-61）；零写回由 sha256 逐文件钉死（test/migrate-preview.contract.test.js:84-92）。对照 §8：只读预览✅；校验备份/暂存/原子切换/按任务身份幂等/崩溃日志恢复全缺；活跃 lease 检查缺（全文件无 runtime 检查）；「未知 schema 停止切换」仅 goal.json 族成立。文件头明示完整机器归 M5（:6-7）。
2. **旧记录族与版本字段**：loop/ 内=goal.json、dag.json(dagVersion:1 core/dag.js:11)、attempt.json(attemptVersion:1 core/attempt.js:16)、runtime.json(runtimeVersion:1 core/runtime.js:17)、metrics/handoff/segment/h3r-hit/sessions/snapshots/salvage/handoff/approvals+`.lock`；loop/ 外=evidence/、attestations/（无版本字段）、authorizations/(version:1 core/contract.js:14)、verify/(schemaVersion core/verify.js:49)、queue/(queueVersion:1/dispatchVersion:1/ledgerVersion:1 core/queue.js:30,168-193)、delivery/(schemaVersion core/delivery.js:100-101)、plans/contracts/drafts/。lzy.project.json schemaVersion（core/project.js:115-116）。迁移样本夹具=~/Codehub/v030-fixtures/migration-sample-src/（54 平铺文件，M0 §9 docs/spikes/v030-m0-report.md:132-146）。
3. **升级链**：`lzy update`=npm view→比较→`npm i -g lazyzcode@latest`→spawn 全新子进程 `node <全局根>/lazyzcode/cli/lzy.js sync`（ADR-0012；core/update.js:96-183；win32 npm 经 cmd.exe :59-71；config.json 零写入 :6；child argv 断言 test/update.contract.test.js:83-97，①-⑩ 全 fake 注入）。打包：files 白名单=cli/core/plugin/+元数据（package.json:32-40）；deployFiles=仓 plugin/ 整目录 cp 到 `~/.zcode/cli/plugins/cache/lazyzcode-local/lazyzcode/<version>`（tmp+rename，core/installer.js:151-168；路径 core/paths.js:98-115）；sync=deployFiles+upsert（:198-203）。**deployFiles cp 完整性无直接单测**（test/ 零消费）；update/installer grep "migrate" 零命中=升级链不触 .lazyzcode。
4. **跨平台**：CI 矩阵 node [22,24] × [ubuntu,windows] 4 腿（.github/workflows/ci.yml:13-33，TZ=Asia/Shanghai）。win32 显式 skip：test/verify-receipt.contract.test.js:86（SIGTERM 语义未核）、test/ci-binding.contract.test.js:19（gh 解析未核）、test/human-gate.contract.test.js:253（skip win32/root）+:301-302（路径反斜杠 JSON 转义雷，2026-09-21 首跑实录）、test/attestation-trailer.doctor.test.js:120（chmod 000）、test/attempt-lineage.contract.test.js:47 IS_WIN。支持边界声明：ADR-0011（arm64 实测/x64 文档声明）；README.md:187（nvm-windows hook-node）、:323-328（run-hook.cmd）。M2 债 G 原文「本地不得宣称跨平台执行面已验」（v030-m2-report.md:92）。
5. **三仓回放账**：lazyzcode 腿=M2 试点 A 1 次（含 SIGKILL→僵尸租约→reclaim→drive#2 中断恢复，v030-m2-report.md:71）+M3 队列 1 次（段中 SIGKILL→reconcile，v030-m3-report.md:62-63）；openchamber 腿=1 次（N4，oc:59）；zpigeon-ios 腿=1 次（N5 段间击杀，zp:86-89）。对照 §11「每任务 ≥3 含中断恢复」：每仓缺 2 次。夹具在盘：v030-fixtures/{lazyzcode@4b54f77(v030-m2-pilot@fe139ea、v030-m3-pilot=cf0ead7), lazyzcode@4b54f77-fast, openchamber@5df72db2, zpigeon+zpigeon-ios@e573516, migration-sample-src}。驱动=宿主候选 CLI 绝对路径（M2 自举混淆教训 :73）；e2e 基座 scripts/headless/e2e-drive.mjs。
6. **V 矩阵记账**：显式编号=V08（M0 §5.4→拍板 #32；M3 F3；zp §5.4）、V03/V04（oc/zp 自述子集）、V09/V10/V11（m4:80-84 ✅）。实质覆盖未编号=V01（m1:67+m3:52）、V02（m1:67+m4:83）、V05（m2:44）、V06（m2:45,72）、V07（m3:44）。**V12 零覆盖**（全 spike grep 零命中；仅 M1 只读预览实质面）。release-checklist 分流：免授权预飞=第 2 步 npm test（:8）、第 3 步 pack dry-run（:9-11）、本地残留外带（:29-36）、第 11 步 marketplace manifest 随定版（:40）、第 12 步版本三体+文档站同步（:62）、载荷冻结纪律（:44-59）；用户直发=第 1/4/5/6 步 whoami/provenance/publish 2FA/换环境冒烟、第 6-9 步 push/tag/CI/About、Release notes、第 13 步 Pages（:66）。
7. **债清单原文**：M4-1 CI flake「根因未定论，不静默；readiness 原因已随止步报文落日志」（m4:92；readiness 明细已随 5dfcc83 落地）；M4-2「d5 账本纠错路径未产品化」（correction attempt 留痕 :72）；M4-3「queue B/C 编排…后续版本归并」（代码侧 core/queue.js:108/351-353 维持拒 B/C）；M4-4「C 单标记…多页爬核留后续」；债 F「升格条件=本 goal 交付面已落地，待复评」（唯一指名待办）；M3 债 G「CI 矩阵轮真值补核」（m3:83）；M3 债 K「engine --json usage 第二计量源对账…M4 若需低延迟计量再做拍板」（m3:86，M4 无处置记录）。
8. **回归聚合与接线点**：npm test 基线 603/603（explorer 实跑 92733ms@node22；本报告基线表=75281ms@node24 复跑）。test/=59 个 *.test.js+spike/；node:test+assert/strict 零依赖；家法=spawnSync 真 CLI+HOME 隔离+LZY_ZCODE_ENGINE 抑制（migrate-preview.contract.test.js:16-24）/依赖注入工厂（update.contract.test.js:26-37）。CLI 接线：VALUE_FLAGS=cli/lzy.js:96；printHelp=:954；顶层 case=:1529-1578（migrate :1562）；help 巡逻 test/drive.contract.test.js:429-435。

## 3. 评审轮记录

- R1（plan-reviewer，2026-09-25）：VERDICT REVISE。MUST-FIX 2：N2(g) V12 谓词被契约文件自身污染（grep 全 docs/spikes 唯一命中即 v030-m5-contract.md）；N2/N3 缺依赖边（并行 wave 下 N3 引入 stateVersion 污染 N2(b) 改前红半）。WARNING 3：A2「损坏源停止」与 preserve 族 ⚠ 容忍的张力需对照声明；N3 reset 注册表理据措辞（实义=core/loop.js:2375-2376 家族登记家法）；N4 VALUE_FLAGS 应定死旗标名。
- R2（同评审员续热）：VERDICT PASS。两 MUST-FIX 关闭核验（排除式谓词可捕、deps 闭包封死全部改前红半），三 WARNING 采纳，落地声明逐条实证（migrate.js:6-8/cli:1186-1194/runtime.js:168/loop.js:2343-2352/win32 三组 skip/夹具在盘/债原文 m4:92/ADR-0029 与 #36 空位）。
- R3（同评审员续热，采纳前增量）：VERDICT PASS。标题凝缩+散文移位无丢失无解析污染（恰 20 条目、散文节无幽灵条目）；豁免令牌干净；F deps 删除安全（12 条 N deps 边原样，关键边 N3 deps:N1,N2 在位）。
- UPS 人权门：契约 a65e57fe 批准已由 UserPromptSubmit 钩子在真实用户消息落账（2026-09-26 钩子实录）。

## 4. F 面预注册（红绿映射）

| F | 表面 | 红半 | 绿半锚 |
| --- | --- | --- | --- |
| F1 迁移写路径 | 夹具旧树 CLI stdout+迁移后树 sha256+drafts/ 草案 | N2(a)(b) | N6 全链活体 |
| F2 迁移执法面 | spawn 真 CLI stdout+sha256 对照+journal | N2(b) | N5/N6 执法场景 |
| F3 升级链与打包一致 | pack dry-run stdout+契约测试 stdout+doctor stdout | N2(c)(d) | N6 |
| F4 跨平台边界 | gh run view stdout+边界文档 | N2(e) | N7 |
| F5 三仓回放账 | 回归报告+各回放段日志/stdout 附件 | N2(f) | N11 |
| F6 债面与矩阵 | M5 报告债面节+矩阵表 | N2(g)(h) | N12 |
| F7 回归聚合与发布候选 | npm test stdout+预飞记录 | waive（回归聚合面，一行理由） | N13 终树 |

## 5. 执行日志

- N1（2026-09-25/26）：基线冻结（本报告 §1）+骨架成文+评审三轮记录+F 面预注册。explorer 八问（§2）自规划期侦察转录，plan-reviewer R2/R3 已逐条实证引用。
