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

