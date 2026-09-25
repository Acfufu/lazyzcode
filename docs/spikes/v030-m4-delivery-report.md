# v030-m4-delivery 试点报告 — 0.3.0 M4 有限交付 B/C

Goal `v030-m4-delivery`（tier heavy · risk high · 契约 4a2efc76…59b · 计划快照 0ee2558ca1…）。主方案 docs/plan-v030-agent-first.md §6/§7/§10-M4；出口=一条 B（PR→main 绑 HEAD 合并+读回 merge SHA+该 SHA CI 绿）与一条 C（Pages 构建对齐 merge 提交+HTTPS 内容核验）真实通过，断连未知结果可核对且不盲目重复写入（V09/V10/V11）。本报告随执行追加。

## 1. 基线钉定（N1，2026-09-25）

| 项 | 值 |
| --- | --- |
| 宿主 HEAD / tree | `c0a8b30` / `73961e9b94c4f5a4105685cbb9cad906ed1c2861`（zpigeon 试点收口树） |
| 工作分支 | `v030-m4-delivery`（基点 c0a8b30；合并前承载全部 goal 提交） |
| origin/main | `a5d14ad`（0.2.4 post-publish record；本地领先 **65** 提交——B 链 PR 如实携带 0.3.0 主线整体） |
| npm test 改前基线 | **567/567 pass，exit 0，57.6s**（原文 artifacts/v030-m4/test-baseline-pre.log；NODE v24.19.0） |
| gh 实核（只读 API） | main 无分支保护（GET branches/main/protection=404）· allow_merge_commit=true · allow_auto_merge=false · 身份 push+admin · Pages legacy source=main:/docs status=built · latest build commit=a5d14ad（2026-09-23T15:21:42Z）· 仓史 PR 数=0（B 链=本仓首个 PR） |
| gh CLI | 已认证（account Acfufu，scopes repo/workflow/gist/read:org，https） |
| 其他 | 零新增根依赖 · Node ≥22 · 宿主 config.json 零写入 · 驱动 CLI=仓内 `node cli/lzy.js`（与全局发布版分开，自举混淆防线） |

## 2. 接线点事实表（explorer 九问浓缩，全部 file:line 实核）

- **契约/授权账本**：core/contract.js:14-21（record 形状 {version,kind,slug,contractHash,at,sessionId}；endpoint∈{A,B,C} 入哈希:16,72-74）；:134-136（账本目录 .lazyzcode/authorizations/）；:138-159（形状断言，额外键容忍但写读两侧同钉）；:163-202（读 fail-closed+effectiveAuthorization 后到者赢）；:206-218（recordAuthorization=测试与未来受信写者用，CLI 不暴露写命令）。
- **UPS 钩子**：plugin/hooks/trigger.js:58-201 approvalVerdict（批准分支读 goal.contractPending〔:74-88，无 status 闸〕，exact-hash 复核 re-hash contractPending.contractPath〔:87-91〕，写记录 :104-108）；:207-268 withdrawalVerdict（仅匹配 goal.contract.contractHash :215,232——M4 最小扩展点）；双熔断 LZY_ABLATE_HOOK_HUMAN_GATE / _TRIGGER（:276-285）。
- **契约门五查**：core/loop.js:866-957（a 磁盘漂移/b 授权有效/c 覆盖/d subjects⊆scope/e 配方一致）；contractGateReject 落 contractPending={contractHash,contractPath,requestedAt}（:872-880）；放行清 pending（:1113）；覆盖检查 assertAcceptanceCoverage（:959-980）。
- **verify/gh 缝**：core/verify.js:552-601（LZY_GH_BIN 注入缝家法、check-runs 查询、kind:"ci" 回执形状）；core/headless.js:95-127（deps.run 注入家法）；core/queue.js:677-682（deps 注入 sentinel 家法）。
- **queue 侧 M4 指路**：core/queue.js:108/351-353（endpoint B/C 拒绝+报文指路 M4——维持不动）。
- **校验和家法**：core/runtime.js:104-159（tmp 0600 rename+载荷 sha256 fail-closed+只 ENOENT 视空+schemaVersion 形状断言+单调写护栏）。
- **CLI**：cli/lzy.js:1385-1424（top-level switch 家族注册）；:87 VALUE_FLAGS；:1055-1067/1287-1374（queue 族 help+子命令形态=delivery 族蓝本）。
- **reset 存活家族登记**：core/loop.js:2312-2317（ANY_TMP_SCAN_DIRS——delivery/ 增补点）。
- **测试蓝本**：test/ci-binding.contract.test.js（假 gh=LZY_GH_BIN+chmod 0755）；test/dispatch-recovery.contract.test.js:56-65/199-219（deps 注入+中途崩溃模拟）；test/human-gate.contract.test.js:188（钩子 spawn+stdin 模拟+短码 mismatch 面）。

## 3. 评审轮记录

| 轮 | 判决 | 要点 |
| --- | --- | --- |
| 1 | 须修订 | 两条必修：AGENTS ≤12KiB 腾位未钉（现余 133B）；contractPending 三字段未钉（contractPath=钩子 exact-hash 复核目标，缺位=误哈希主契约）。警告：CI 轮询无预算/65 提交首见 CI win32 矩阵风险/树相等无条件化/open re-arm 未名 |
| 2 | 通过 | 两必修修复核实+警告全落定（CI 轮询 15s×≤12 双段/树相等条件化 base 不动/open→intended re-arm） |
| 3 | 通过 | 机器覆盖门抓 F6 缺 `accepts: A5` 行（评审两轮均未察，机器门立功）；补行后逐行核验=与轮 2 批准文本零漂移 |

## 4. F 面预注册（红半归属）

| F | 表面 | 红半 |
| --- | --- | --- |
| F1 授权门 | 宿主 CLI stdout+intents.json+shim 调用枚举 | N2(a)(c)：delivery 族未知命令+家族缺位原文 |
| F2 意图/读回 | 宿主 CLI stdout+intents.json+shim 枚举 | N2(a)：意图/读回面缺位原文 |
| F3 撤回 | spawn 真钩子 stdin+CLI stdout | N2(b)：hook 对非绑定短码 mismatch 原文 |
| F4 真实 B 链 | 真 gh stdout+PR/mergeCommit+check-runs | N2(a)：改前 delivery 面不存在（断言面缺位） |
| F5 真实 C 链 | pages builds API JSON+HTTPS 抓取+截图 sha256 | N2(d)：内容标记改前不在场预抓取 |
| F6 回归聚合 | npm test stdout | waive-red 一行（回归聚合面） |

## 5. 执行记录（随步追加）

### N2 主机红半预捕（改前活体，场地 artifacts/v030-m4-red/）

- (a) delivery 族未知命令 ×4：`未知命令：delivery`（stderr）+用法（stdout），**EXIT=1** 四态同（a-unknown-*.out/.err + a-unknown-exitcodes.txt）。
- (b) hook 撤回对非绑定短码（deadbeef）mismatch 原文：`Withdrawal code mismatch — the contract bound to goal v030-m4-delivery has short code 4a2efc76 … Nothing was recorded.`（spawn 真钩子 stdin，EXIT=0 零记录；b-hook-mismatch.out）——F3 红半。
- (c) `.lazyzcode/` 家族清单：**无 delivery/**（attestations/authorizations/contracts/drafts/evidence/loop/plans/verify；c-family-absence.txt）。
- (d) 线上站点改前预抓取：index 200（内容含 0.2.4、**零** v030-m3/v030-m4 标记）；报告页两 URL 变体 **404**（d-site-fetch-meta.txt+d-marker-count.txt+原文 body×3）——F5 内容标记「合并后才存在」的改前不在场活体。

### N10 真链 B 活体（2026-09-25）

- **授权**：B 契约 86cfd50f、C 契约 10fce1cd 经 UPS 钩子在真实用户消息上批准（钩子批准分支对 delivery 契约零改动即生效——活体确认；撤回面扩展随链在案）。
- **链**：`lzy delivery act B` 机器执行 push（76 提交上公网）→PR #1 建立→漂移复核→headSha CI 门：**首跑 180s 预算内未全绿=refused**（真 CI 无 shim）→重跑两次同拒（假拒根因见下）→裁决修复后 CI 绿→**merge --match-head-commit 绑 5ee8cb0**→读回实际 mergeSha=`61d1dc35415685f01980b34a96f56275e7ecda46`→merge SHA CI 轮询=**failed（如实「已合并、验证失败」）**。
- **首链抓获真缺陷三枚（全部 fail-safe 方向，绝不假绿）**：(a) check-runs REST 面 status/conclusion 为小写，旧大写断言恒判 pending=假拒（dc0ee9d 归一修复）；(b) C 面 URL 形态猜错（/docs/spikes/ vs 站点根 /spikes/）与 marker 串猜错（slug 不在渲染体；真标记=报告页标题）——V11 门如实拦截，观察参数重瞄机制落地（8b84041）+重瞄后内存同步缺陷（86d732b，测试假件按 URL 区分 body 钉死）；(c) 修复全部在合并后落 main 本地（工作树态跑链，合并内容=已批准的 5ee8cb0 树）。
- **merge SHA CI 偶发红 ×2（遗留）**：attempt1=budget-ledger ④（results 空），attempt2=⑤（同形态）——同树 PR CI 四腿全绿、本地 17 执行（含 CPU 饥饿模拟）零复现；M3 时代测试竞态、CI runner 特异。处置=测试断言插桩（stop 原因入失败报文）随 follow-up PR 走新授权（B2），不做盲赌重跑。

### N11 真链 C 活体（2026-09-25）

- Pages 构建 built @ 61d1dc35（== mergeSha，check-runs 亦见 pages build/deploy/report-build-status 三连绿）。
- HTTPS 内容判据：报告页 `https://acfufu.github.io/lazyzcode/spikes/v030-m4-delivery-report/` → 200 ∧ 标题标记「v030-m4-delivery 试点报告」在场（改前预抓取已证 0.2.4 站点零 v030-m4 串）。
- 浏览器关键路径截图：报告页整页（pages-report-full.png，1.17MB）+站点首页（pages-index.png），IAB 实流，sha256 绑 N12 账本。

### N12 收口（2026-09-25）

- **B2 链活体（续）**：PR#3（read-back-authority 缺陷修复+回归钉⑪+readiness 原因插桩）→CI 四腿绿→merge 绑 HEAD `9742677`→**实际 mergeSha=`ab9e1efaca` CI 全绿**（4 测试腿+Pages 三检查全 success）——B 端点判据（V09）达成；d5 假事实（read-back-authority 缺陷产物）经 correction attempt 显式作废回 refused（账本纠错留痕，报告本节即披露）。
- **C 复验**：新意图 d7——Pages built@ab9e1efaca（==新 mergeSha）+报告页 200∧标记在场。意图账本终态七条（d1-d7）=全链诚实史。
- **F 证据**：终树（main@ab9e1ef，tree 514b8237）六项采集，npm test 603/603（基线 567+36）。

## 6. 结果与判据对照

| 判据 | 结果 |
| --- | --- |
| M4 出口=一条 B 真实通过 | ✅ PR#1/#2/#3 三次真实合并（全部 --match-head-commit 绑 HEAD+读回实际 merge SHA）；最终 mergeSha ab9e1efaca CI 全绿（V09） |
| M4 出口=一条 C 真实通过 | ✅ Pages 构建两次对齐 mergeSha（61d1dc35、ab9e1efaca）+HTTPS 内容标记+浏览器关键路径双截图（V11） |
| 断连未知可核对、不盲目重写 | ✅ merge 超时=unknown→readback 分类收束；CI 轮询查询故障预算内重试；read-back-authority 缺陷被纠正机制捕获并留痕（V10） |
| 授权边界 | ✅ 四次 UPS 真实批准（goal 契约 4a2efc76、B 86cfd50f、C 10fce1cd、B2 ec48a4cf）；授权记录 schema 零扩展；撤回面扩展随线交付 |
| V09 漂移/CI 门 | ✅ push 后 API 读滞后假漂移=拒（读回核对后重跑过门）；headSha CI 门三连假拒（小写判读缺陷）如实 refused 后修复再过 |

## 7. 对抗清单九类自查

1. 假完成：merge-SHA CI 红×3 全部如实「已合并、验证失败」，从不归 completed——B 端点在 CI 全绿的 ab9e1efaca 才宣告达成。2. 假重锚：无（波末重锚面不在本 goal）。3. 越权写入：四次 UPS 批准外的零外部写入（push/PR/merge 全在 delivery act 门序内、授权现读 fail-closed）。4. 证据时效：F 证据绑终树（rebind 于收官提交后重采）。5. 自指：对照项不进 F 表（comparator 独立核验）。6. 授权漂移：契约文件四份全部字节哈希绑定，批准后零改动。7. 计量假零：本 goal 无引擎段（budget-ref none 如实），无消耗记账面。8. 静默收窄：queue B/C 编排不做（拍板 12 四债声明）、C 面全只读不涉 unknown——报告显式。9. 单源漂移：decisions #35+ADR-0028+CONTEXT 新词+README/guide 双语同批落。

## 8. 债与遗留（如实记账）

- **债 M4-1（CI flake）**：M3 预算套件在 push-to-main 腿三次偶发零就绪（④×1、⑤×2；PR 腿 5/5 绿、本地 20+ 执行零复现）——readiness 原因已随止步报文落日志，下次复现自诊断；根因未定论，不静默。**债 M4-2（d5 账本纠错）**：read-back-authority 缺陷产出的假 done 经 correction attempt 作废（非机器转移，报告+attempt 双留痕）；纠错路径未产品化。**债 M4-3（queue B/C 编排）**：delivery 独立于 queue，队列项仍拒 B/C（后续版本归并）。**债 M4-4（C 内容判据为单标记）**：报告页标题串+构建 commit 双判据已强，多页爬核留后续。**债 F 继承**：scope 逐写执法升格条件=本 goal 交付面已落地，待复评。

## 9. 终验收口（2026-09-25，§7 第 4 条预注册的 rebind 落地）

- F 证据 rebind 终树 fd20cdde9：1ece2a8→本次 docs 差异纯报告/AGENTS/history，delivery 代码面零改动（status/intents/check-runs/报告页 HTML 附件 sha256 与 gen1 逐字相同自证）——六项绿半 gen2（F3 gen3）全新鲜，外部读面（status/gh pr view 3/pages builds/latest/HTTPS 标记计数=3）与 IAB 双截图全量重采。
- 红半 n446–n450 补入账（N2 改前原文：delivery 四态未知命令 EXIT=1/hook mismatch 零记录/站点零标记+报告页 404）+F6 一行豁免在账——INV-09 六对齐。
- 对照 n451 六项 MATCH（对照员独立复跑活体面+git show c0a8b30 实证改前 cli/lzy.js 零 delivery 字样）；LOOP_COMPLETE attestation=终验机器证明（planHash+各根头树+指纹 2f12959281+对照 n451）。

