# v030-m2 实施报告：0.3.0 M2 验证机器面与 lazyzcode 自托管试点 A

goal `v030-m2`（0.3.0 M2：verify 回执 + 范围档 + 整合验证 + CI 身份绑定 + lazyzcode 试点 A）· 2026-09-24 开工。
主方案 docs/plan-v030-agent-first.md §4/§7/§10-M2；ADR-0024（契约授权）/ADR-0025（验证依赖范围）。
计划 `.lazyzcode/plans/v030-m2.md`（快照 sha256 77edef9126…，R2 PASS 后按 P3 建议微调三处的版本）；契约 `.lazyzcode/contracts/v030-m2.md`（contractHash 093bfd9c…，UPS 批准在案）。

## 1. 冻结基线

| 面 | 冻结值 |
| --- | --- |
| 本仓 HEAD（开工时点） | `0d23018` chore(loop): v030-m1 close-out（= 0.2.4 + M0/M1 收口树） |
| 计划快照 | `.lazyzcode/loop/snapshots/v030-m2.md` · sha256 77edef9126… |
| node | v24.19.0（nvm；M2 纯 Node CLI 面） |
| gh | 2.95.0 · 已登录 Acfufu（repo/workflow scope，`gh auth status` 2026-09-24 实测——CI 只读面凭据在案） |
| 测试基线（F6 锚点） | `npm test` **514 绿 / 0 红**（改前实测 2026-09-24，46 文件） |
| 夹具 | `~/Codehub/v030-fixtures/lazyzcode@4b54f77` HEAD `d7a2c70`（M0 脚手架：marker ORIGINAL→BROKEN 两提交）· clean · 槽位含 M0 残档 `v030-reanchor-repro`（detached-HEAD 形态，N9 reset 后开分支） |
| 计划外事件 | 开工时宿主树脏：根 package.json 被误加 `"ai": "^7.0.113"` 依赖 + 未跟踪 package-lock.json（违反零根依赖）——stash 保全（`park pre-v030-m2`），不动已拍板树 |

## 2. 接线点事实表（explorer 八问侦察，代码级，2026-09-24）

| # | 面 | 事实 |
| --- | --- | --- |
| 1 | workers 参数路径 | CLI 值旗标 lzy.js:75 → parseInt 截断（2.5→2 接受）→ core/drive.js:250-257 守卫 `--workers 非法` 拒 0/-1/1.5/NaN，先于 readGoal(:272)/executing(:274-278)/风险门(:279)/engine(:280-284)/凭据(:285-291) 全部前置；接受 ≥1 整数（1=冻结单工=默认） |
| 2 | workers 测试面 | 试点受测守卫钉在 test/drive-workers.contract.test.js:146-161（test ①）与 :508-522（CLI 接线 ⑪）；drive.contract.test.js 零 workers 钉；家法=node:test+spawnSync CLI+scratch 仓+passDeps 假引擎 |
| 3 | 波末重锚路径 | drive.js:1172-1211 runDriveWorkers 屏障：subject 头树变化时对有证据 F 步逐个 shell `step done <Fid> --evidence "wave-barrier rebind…（drive 代跑，未复跑断言）"`；代码自注「重锚 ≠ 复验」；失败 windDownW(false)；零变化波跳过；pendingCount=0 时 drive 自跑 loop finish（:1016-1024） |
| 4 | 证据与指纹机器 | 复合指纹 fingerprintSubjects loop.js:749-765（{host}∪subjects 头树 sha256）；绿半无独立命令、由 step done→doCompleteStep(:1315-1414) 记账（supersedes 边）；红半 recordEvidenceHalf(:1420-1512) + 附件 attachHalfFiles(:1521-1574)；账本 core/dag.js .lazyzcode/loop/dag.json（校验和 fail-closed）；comparator attest.js（MATCH 判定+归档 evidence/）；INV-08/09 finish 门 loop.js:1861-1883；新鲜度权威 verifyEvidence(:1678-1721) |
| 5 | M1 可复用面 | contract.js：parseContract/hashContractBytes/effectiveAuthorization（authorizations/ 追加账本）；project.js：manifestHash/validateManifest/projectCheck（六类配方 schema，writePaths 校验家法 :77-88）；模块头自注「真实执行与回执归 M2 core/verify.js」（project.js:5-6） |
| 6 | CLI 分派 | main switch lzy.js:1145-1187；VALUE_FLAGS :75、MULTI_FLAGS :76；M1 三族=cli 内薄 handler→core 模块（cmdContract :1038/cmdProject :1087/cmdMigrate :1123）；help 巡逻嵌 drive.contract.test.js:429-444（无全 help 扫描）；`lzy loop verify`（:281）=证据新鲜度读面已存在，新 `lzy verify` 顶层族需 help 分工 |
| 7 | CI 现状 | 全仓零 gh 调用（core/cli/plugin grep 确认）——CI 绑定全新绿地；.github/workflows/ci.yml 唯一工作流：matrix node[22,24]×[ubuntu,windows]，steps=`node --test "test/**/*.test.js"`+`--help`（4 腿=绑定对象） |
| 8 | 账本家族与登记义务 | loop/ 内：goal/dag/attempt/runtime/metrics/handoff/segment/h3r-hit/.lock+sessions/snapshots/salvage/handoff/approvals；loop/ 外：evidence/attestations/authorizations；登记义务=新 tmp 家族入 LOOP_TMP_FAMILIES（loop.js:64-76 单源）+cleanupLoopResidue(:2340-2384)+doctor 孤儿计数(:2319-2332) 两面覆盖；loop/ 内新目录还须 doctor EXEMPT 双清单（doctor.js:309/321）——本 goal verify/ 家族在 loop/ 外，登记 ANY_TMP_SCAN_DIRS(:2310-2315) 即可 |

## 3. 计划评审轮记录

| 轮 | 判决 | 处置 |
| --- | --- | --- |
| R1 | REVISE | 2 P1+2 P2 全修：P1a=N 项 windDownW(true 因) 转写错（对齐拍板 4 的 windDownW(false)——ok=false⇒outcome 失败非零退出，drive.js:781/:1237/:1265 语义）；P1b=夹具整合回执无清单来源（拍板 7 钉死夹具清单全内容+落库时序：reset 槽位→分支→清单 commit→再注入）；P2a=F 项顺序边缺位（解析器实锤一条目一关联行槽，deps 占槽则 accepts 孤儿拒——拍板 11 立 accepts-only F 项+串行纪律）；P2b=主机红半无归属（新 N2 预捕步，拍板 12 场地与 --surface external 家法） |
| R2 | PASS | 四发现复核全清（评审代理逐条重验代码）；4 P3 备注：N3 deps 增 N2（采纳）、N5 测试行号订正 272/452/473/733（采纳）、N7 help 与 loop verify 分工（采纳）、夹具残档=detached-HEAD 形态非分支名（核实无误不采纳）——三处采纳在 PASS 后微调，评审串如实记录实质零变更 |

## 4. F 面预注册（红绿半与归属；F 项执行前冻结）

| F | 表面 | 红半 | 绿半 |
| --- | --- | --- | --- |
| F1 回执活体 | 宿主 CLI stdout+回执文件 | N2 捕获：夹具基线 CLI（4b54f77）无 verify 族=未知命令原文 | verify run 全字段枚举+raw sha256 对照+篡改 fail-closed 原文 |
| F2 范围档活体 | 宿主 CLI stdout+回执枚举 | N2 捕获：改无关文件→全树一刀切过期原文（M0§8 T2 同形态） | reuse 放行+四反例回退原文+无资格拒原文 |
| F3 整合验证活体 | 宿主 CLI stdout+回执 | N2 捕获：真引擎两工人波末自动重绑把 BROKEN 洗成新鲜（M0§8 递延项；证伪回退=屏障形重放，分列记账） | 波末零自动重绑+verify 仍报过期+整合失败 windDown(false) 原文 |
| F4 CI 绑定活体 | 宿主 CLI stdout | N2 捕获：改前无 CI 查询面原文 | 未推送如实无 CI+远端 main 枚举（gh 只读）+非现行标注原文 |
| F5 试点 A 活体 | 夹具 CLI stdout+git log | N9 捕获：注入后 --workers 0 静默零退出+夹具 test ① 变红原文 | 非零退出+零启动副作用+拒绝先于前置+合法参数反例+套件绿+恢复回执 |
| F6 回归聚合 | npm test stdout | 豁免：回归聚合面反态=人为造红无意义（waive-red 记账） | 514 基线+新增全绿原文 |

## 5. 实施记录（随步追加）

- N1：基线冻结+骨架落盘（HEAD 0d23018→9f05564；npm test 514 绿改前实测）。
- N2 主机红半预捕（账本 n366-n369，附件 artifacts/v030-m2-red/ sha256 绑定）：
  - **F1 红**：夹具基线 CLI `verify run` → 未知命令原文（8.5KB help 全文，exit 1）。
  - **F2 红**：scratch（9f05564）LIGHT goal 绿锚 marker ORIGINAL @ 52a562d（指纹 5a3a68d644）→ 无关 README 变更 → verify `过期 1：F1` exit 1——全树一刀切语义实锤。
  - **F3 红（M0§8 递延全形态，真引擎 zcode.cjs 3.14.3）**：lz-red-f3 scratch，绿锚 @ 78db300（gen1）→ marker 改 BROKEN @ cc4c043（对照态 verify 如实过期）→ `drive --workers 2`：波 1 完成（工人 77.5s/180.6s）→「屏障重锚完成（subject 头树集实变）」→ **finish 过（marker 客观为假时新鲜度门放行）**。加重实锤：波中工人 w2 曾如实记红（dag n3：grep ORIGINAL 零命中），屏障重锚绿 n4（gen2「wave-barrier rebind…drive 代跑，未复跑断言」）把诚实红覆盖成现行。附带发现：清理相删 worktree 后复合指纹含 missing 根，verify 再报过期——证据曾短暂绑定瞬态 worktree 状态（另一缺陷面，如实记账）。
  - **F4 红**：改前宿主 CLI `verify ci` → 未知命令原文。
  - 消融记账：F2/F3 场地人权门 LZY_ABLATE_HUMAN_GATE=1 + 钩子层 LZY_ABLATE_HOOK_HUMAN_GATE=1（M0§8 家法，被测面=证据机器非批准门）。

## 5.1 N9 试点夹具注入（2026-09-24）

- 夹具槽位 reset（M0 残档 v030-reanchor-repro 清理，salvage 盘点在案）→ 分支 `v030-m2-pilot` 基点 `4b54f77`。
- 清单落库 `eaceadf`（check 类 test-suite 配方，拍板 7 钉死内容）→ 注入 `3879150`（drive.js workers 守卫删除，commit 如实标试验注入）。
- F5 红半（账本 n370，附件 sha256 绑定）：`--workers 0` 拒绝面消失——退出码 1 但报文=「本目录没有目标循环状态」前置错误冒充（顺序违规：参数级拒绝本应先于一切前置）；夹具套件 test ①/⑪ 两处 `/--workers 非法/` 钉全数失守（28 例中 2 红）。

## 5.2 N10 试点驱动修复与交付 A（2026-09-24）

- **夹具 goal**：`v030-m2-pilot`（LIGHT·人权门/钩子双层消融记账）——计划经两次 supersede（attempt 1→2→3，forward-only 世系；N3/N4 为 marker 被测步增补），**finish 通过 7/7**，证据包 `.lazyzcode/evidence/v030-m2-pilot.report.md`。
- **修复交付**：注入 3879150 → 修复 a373c7f（守卫恢复，**与 4b54f77 blob 哈希全同** 24591a1953f）；候选分支 `v030-m2-pilot` 净变更=清单+三 marker+注入/修复对冲；**独立评审 PASS**（8 提交全分类、无未标注行为变更、drive-workers 套件 28/28 绿）。
- **F1 四查绿半**：0/-1 非法值非零退出+workers 非法报文先于一切前置；合法 1/2（引擎抑制）过参数门到引擎前置——反例不受影响；零启动副作用（无 [drive] 横幅、runtime.json 缺席）。
- **F3 中断恢复活体**：drive#1 35s SIGKILL（attempt 同代）→**孤儿引擎会话续跑交付 N2**（9e4a989）→drive#2 被僵尸租约门拦（原文「持租进程 pid 14508 已不存在——回收：lzy loop lease reclaim」）→显式 reclaim 回收→重驱零重复交付；认领护航（F2/F3 预认领）全程未被工人越权分派。
- **F2 整合验证活体**：候选 CLI 驱动 drive#4 波 1——真引擎工人交付 marker-3（142886ms）→merge fe139ea→**波末整合检查 test-suite 真执行 exit 0，回执 r-20260924T170013-18cqfkkb**（绑候选 headSha fe139ea/复合指纹 60a9fca3…）；零「屏障重锚」行=重锚退役在真波上成立；零变更波打「候选树未变——跳过整合检查」（新门控）。
- **计划外事件 1（自举混淆反例，如实记账）**：drive#3 误用夹具内旧 CLI 驱动——旧「屏障重锚完成」行在退役后复现即为铁证；候选整合面未执行。处置：supersede 增 N4，改候选 CLI 重驱（drive#4）。教训：夹具工作区内 `node cli/lzy.js` 永远解析夹具自身代码——试点驱动一律用绝对路径候选 CLI。
- **计划外事件 2（门控经济性补丁）**：整合验证原实现每波都跑全套件；补头树实变门槛（零变更波跳过+如实打行），drive#4 波 2/3 跳过行如约。

## 6. 对抗清单自查（docs/research-adversarial-checklist.md 九类，2026-09-25 收口）

本 goal 新增面：core/verify.js（受控执行器/校验和回执/范围档四问/qualification 活体/CI 查询）、drive.js 整合验证块（重锚退役）、CLI verify 六子命令、`.lazyzcode/verify/` 家族。逐类：

1. **malformed input——已有防护（新面自带）**：清单损坏在整合验证前置读 fail-closed（⑳b 钉）；回执篡改 fail-closed（校验和面，verify-receipt 钉）；qualification 对缺失条目/未检测变更 fail-closed 拒资格；gh 输出不可解析=blocked 不空过；argv shell 串在清单校验层拒绝（执行前）。
2. **prompt injection——不适用（攻击面未扩大）**：契约/计划信任级不变；CI 检查名/URL 仅作展示文本（console.log），不进任何命令构造；配方 argv 来自版本化清单（信任流=契约绑定哈希经批准，M1 面）。
3. **cancel-resume——已有防护（活体在案）**：回执写=tmp 0600+rename（无半写回执）；drive SIGKILL→僵尸租约门+显式 reclaim+重驱零重复交付（F3 活体）；supersede 重锚 ×3 全程 forward-only。
4. **stale state——已有防护（本 goal 主题之一）**：回执绑候选身份、show 恒对照「非现行」；复用四问现算快照/清单哈希/环境指纹；整合验证按头树实变门槛现判；F1 证据被合并自然过期→重取（诚实门活体）。
5. **dirty worktree——已有防护**：宿主 goal 全程先提交后取证（N2 记步时的未提交警示即该门提示面）；回执绑 HEAD 头树（未提交不可见，与证据家族同一语义，如实记账）。
6. **hung commands——已有防护**：执行器 timeoutMs SIGTERM 击杀（ETIMEDOUT 语义钉）；gh 30s 超时；整合检查受配方超时约束；零变更波跳过重跑（门控）。
7. **flaky tests——已有防护+两处显式跳过**：四件套 24 例真子进程+HOME 隔离+LZY_GH_BIN 注入缝（CI 零触网零 PATH 操控）；win32 下超时击杀与假 gh 两组显式 skip（执行语义未核，Known unknowns 3 预注册——CI 矩阵轮真值补核）；integration 用假引擎零网。
8. **misleading success output——本 goal 主题（红绿全链在案）**：重锚退役（F3 真引擎红半→绿半）；回执不可由文本/指纹冒充；blocked ≠ pass；「非现行」如实标注；回退具名原因；qualification 字节原样恢复复核；**对抗自查实战捕获=drive#3 自举混淆**（夹具旧 CLI 驱动使旧重锚复现——「屏障重锚完成」行即铁证，改候选 CLI 重驱纠正）。
9. **repeated interruptions——已有防护**：F1 过期→重取证→finish 通过（重取流程活体）；attempt 2→3 重锚 ×2；回执只追加（seq 递增）容忍重跑。

## 7. 债记账（收口时点）

- **债 G（新记）：win32 执行语义未核**——执行器 SIGTERM 超时击杀（signal/ETIMEDOUT 形态）与 gh 可执行解析（PATHEXT/.exe）在 Windows 未验证；四件套对应两组 win32 显式 skip。升格路径：CI 矩阵 win 腿真值补核（预注册于计划 Known unknowns 3）；本地不得宣称跨平台执行面已验。
- **债 H（新记）：整合回执不刷新 F 项红绿证据（设计如此，摩擦如实声明）**——重锚退役后，带已锚定 F 证据的目标经 workers 波后证据自然过期，须真实重验才得新鲜；drive 对此类目标收束于 finish 拒（诚实路径）。操作面摩擦=交付 A 前多一步真实重验；不设任何自动刷新通道（M0§8 教训的代价，接受）。
- **债 F（M1 记，状态不变）**：scope 运行时执法缺位（writePaths/inputPaths 均不观察逐次写入）；升格条件仍挂 M3 派发面。
- **观察（非债）**：空分派波仍装配 2 工人 worktree（drive#4 波 2/3 实测 0ms 分派但装配照走）——浪费小、语义无害；若 M3 队列放大该形态再评估跳过装配。
