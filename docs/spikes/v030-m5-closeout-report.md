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

## 6. 执行日志（N1–N11）

- **N1 基线冻结**（f3b373a）：§1 基线表+explorer 八问+评审三轮+F 预注册。
- **N2 红半预捕**（n454-459，指纹 9326d4a954）：八项红半入账；三处谓词当场修正——(c) doctor 已有 M1 preview migrate 行→改钉无 stateVersion 读面（N4 由「增行」转「扩展行」）；(e) README.zh 已有平台薄行→改钉边界节实体缺位；(g) 本 goal 报告自身含 V12→排除式扩含。
- **N3 迁移机器**（a288f2c）：apply 四阶段+journal 相位记账+state.json 版本入口（最后写=提交点）+classifyGoal 执法（corrupt/live 拒、僵尸租约可转换、runtime 不可读保守拒）+drafts 草案 authorization NONE+preserve 族 ⚠ 保字节+migration/drafts 家族登记（ANY_TMP_SCAN_DIRS）。冒烟六态全过。
- **N4 CLI 接线**（176b480）：migrate preview|apply|status+doctor migrate 行扩展版本入口读面（纯信息面）；--root 值旗标沿 preview 既有。
- **N5 契约测试**（9acb5cc）：11 件全绿（apply 全链/幂等/僵尸租约/活体拒/corrupt 停/state 损坏停/崩溃恢复/doctor 行/preview 回归）；执行期修正四处（租约形状补 acquiredAt·heartbeatAt、doctor 整体退出码属 install/files 行、journal 剥相位按行过滤、死 pid 构造 cross-platform）；全量 614/614 绿。
- **N6 载荷一致**（3ae2559）：deployFiles 逐文件 sha256 对表+点残渣不部署+pack 白名单对表（npm12 对象包封归一）+外带 sess_ 三连；旧树夹具全链 v2：重组袋（20 approvals+32 attestations+salvage+evidence）preview 33 任务 0⚠→合成在途→apply 1 草案→status 0.3.0→备份↔源 56 文件 0 mismatch。
- **N7 跨平台边界**（93dc4c5）：CI 四腿真值（run 36142988403 全绿@ab9e1ef）+win32 skip 六点三族归类（SIGTERM/gh 解析/EACCES 权限语义——维持 skip 记边界）+双语 README/guide「平台支持边界」节+债 G 补核结论（win32 腿执行其余全量绿；skip 组=边界非已验面）；docs-preview 链接 263/0 断+锚 44/44。
- **N8 lazyzcode 腿回放 ×2**：④中断形态（SIGKILL→僵尸门→reclaim→重驱→积分止步 446.1→放宽续驱→done 6/6+att 194849Z）+⑤常态（积分止步 618.5→续驱→末段墙钟 SIGKILL→显式 finish→done 6/6+att 202623Z）——三仓回归报告 §1。
- **N9 oc 腿回放 ×2**：④中断（孤儿引擎自交付修复 213968e97→僵尸门→reclaim→重驱 done 4/4+att 203940Z）+⑤常态（done 4/4+att 205918Z）+浏览器绿半（隔离 serve+外挂 opencode 1.18.18@14198：搜索 scrollbar 命中→点击→?settings=appearance 复选项在场，截图 sha256 6df2b875c9…）。
- **N10 zp 腿回放 ×2**：④中断（红面 TEST FAILED→SIGKILL@150s→僵尸门→reclaim→重驱→修复 bc175f4+XCUITest 冒烟绿+blob 全同→done 4/4+att 213328Z）+⑤常态（done 4/4+att 215953Z）；红面 exit 码被管道 tail 吃（输出原文为权威红证据，瑕疵如实记）。
- **N11 回归报告**：docs/spikes/v030-m5-regression-report.md——三仓各 3 次计数表+中断恢复形态行+复现配方+计量（缺面如实记）+V01–V12 全表（V12 本轮收口）。

## 7. 债面处置（N12 拍板，逐条理据）

- **债 F（scope 逐写执法升格，M1 记/M3 改挂/M4 待复评）→ 不升格，设计终局**：设计总案 §3.1 明文「机器保证 lzy 管理路径的状态与授权核对，不宣称可以阻止同权限恶意代理绕开 lzy 执行原生命令」——逐写执法与该威胁边界直接矛盾；M4 交付面落地已满足升格复评条件，复评结论=边界即终局（非回避）。记入本报告+decisions #36 关联说明。
- **债 G（win32 执行语义未核，M2/M3 记）→ 收口于 N7**：CI 矩阵轮真值补核完成（四腿绿），三族 skip 逐条记入双语支持边界文档；「skip 组=支持边界非已验面」如实声明，VM 实测维持 ADR-0011 边界外。
- **债 K（engine --json usage 第二计量源对账，M3 记/M4 无处置）→ 延后**：无低延迟计量需求证据（M4 交付面以 CI 轮询为主面未需亚段计量）；#32 近似语义已执法且本轮两次积分止步活体有效；待真实需求出现再拍板。
- **债 M4-1（CI flake 根因未定论）→ 站岗**：readiness 原因明细已随 5dfcc83 落地（自诊断面在案）；本轮 CI 观察窗内零复现；复发即按 readiness 原因诊断，不预置修复。
- **债 M4-2（d5 账本纠错未产品化）→ 延后**：correction attempt 留痕路径已足（一次发生+双留痕）；复发第二例或用户点名再产品化。
- **债 M4-3（queue B/C 编排）/债 M4-4（C 面多页爬核）→ 重申后续版本**（原措辞明示延后，非 M5 义务）。
