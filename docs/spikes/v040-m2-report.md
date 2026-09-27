# 0.4.0 M2 受控独立评审：运行器活体收官报告（goal v040-m2-review）

2026-09-27 · tier heavy · 契约 12f92bbc · 主方案 docs/plan-v040-engineering-policy.md §4.1/§4.2/§6/§7/§8-M2 · ADR-0031

## 1. 交付面总览

M1 遗留的唯一放行缺口（评审义务 `review.general-correctness` 恒不可满足）在本阶段翻为可满足且**已真实满足过**：

- **运行族**（`core/review.js`）：`.lazyzcode/review/<slug>.a<attempt>.r<seq>.json` 一档一运行 + 同茎运行目录
  （`input.json`/`candidate/`/`home/`/`raw.txt`）；queue 家法容器（原子写 0600+校验和+版本+形状闸 fail-closed）；
  序号 max+1 确定序（对人工清档免疫复用覆写；孤儿运行目录一并计数——SIGKILL 中途死=下次拿新 runId，拍板 8）。
- **输入包与隔离**：facts-only `input.json`（契约/清单/AGENTS/步骤与 F 证据/回执摘要/策略义务集/候选身份；
  多 subject fail-closed 拒）+ `git archive HEAD` 候选快照（有序复合树哈希）+ 每运行隔离 HOME + 泄漏断言
  （在先运行 runId/结论摘要哈希/raw 哈希串零命中）+ 读取轨迹断言（转录路径键深走 + realpath 归一 + 前缀边界）。
- **运行器**（`runReview`）：前置四查（auth/契约授权/预算占位/计量能力）→ 候选固定（三字段+净树）→ 替身或真
  引擎 `--mode plan` 会话 → stdout+stderr 分节封存 → 恰一 json 围栏解析 → 归一化（pass∧blocking/P0P1=blocked）
  → 逐因失败分类（timeout/exit-nonzero/parse-fail/candidate-moved/contamination/interrupted/isolation-breach/
  leak/metering-absent/unpriced-model）→ 运行后候选四者复查+快照污染复查 → 落档（失败运行不可改判）。
  **单次重跑**：首轮 parse-fail 附更强格式约束重 spawn（拍板 3 收窄模板路径），逐会话封存、计量按会话求和。
- **计量参数化**（`core/cost.js querySessionPoints(sessionId,{dbPath})`）：默认值=宿主账本（调用点零变化），
  runner 恒传隔离 HOME 子账本路径——M0 发现一的计量缝收口。
- **统一门接通**（`core/gate.js` 拍板 6 七合取）：同代次 ∧ duty/规则版本/模板哈希一致 ∧ valid ∧ metered ∧
  pass ∧ 候选三字段现行 ∧ 原始输出在场哈希相符；取同代次最新档逐因阻塞；家族损坏 fail-closed 具名阻塞
  （不炸穿 evaluateGate）。
- **翻面同批**（`core/policy.js`）：`REVIEW_RUNNER_FACE.available=true` ∧ `DUTY_TABLE_VERSION 1→2` ∧
  rulesHash 组成增职责模板内容哈希；读侧放宽（dutyTableVersion 形状闸只验正整数，漂移由 rulesHash 判）；
  doctor `checkPolicy` 版本漂移 warn 面。
- **CLI 三命令**（`lzy review run|list|show`）：退出码契约 0=pass 且有效 / 1=blocked·invalid 已落档 / 2=用法 /
  3=前置不具备（不 spawn 不消耗不落档）；list/show 只读、损坏族 fail-closed 非 0。
- **测试与 QA**：契约测试十例（deps 注入，CI 无凭据可跑；688/688 绿）；qa `--case review-runtime` 活体
  exit 0（替身八体拒绝矩阵 + LIGHT/HEAVY 真实绿例全链）；INV-08 harness `m2-review-harness.mjs`
  D1-D6 双半实测（绿半工作树七观察 / 红半 0a31f54 六观察）。

翻面 sweep：9 测试断言行 + 头注 + `policy show` 面按「评审无在案运行」新语义重钉（重钉≠放宽——夹具均无
评审运行在案，义务仍 unsatisfied，仅理由字面位移）；qa.mjs `REVIEW_RE` 同批；新增拍板 2 双断言（旧版本档可读
∧ rulesHash 漂移判）。

## 2. 反例矩阵（qa --case review-runtime 活体 exit 0；替身引擎=按引擎 CLI 约定出单 JSON 摘要+约定转录+按腿写子账本）

| 体 | 注入 | 断言面（逐体命名） | 结果 |
| --- | --- | --- | --- |
| r1 候选竞态 | 替身运行中后台提交前进 | exit 1 ∧ 判因 candidate-moved | ✔ |
| r2 解析失败 | 无围栏答复 | exit 1 ∧ 判因 parse-fail | ✔ |
| r3 超时 | 替身挂起+小墙钟 | exit 1 ∧ 判因 timeout（SIGKILL） | ✔ |
| r4 缺用量 | 替身不写子账本 | exit 1 ∧ 判因 metering-absent | ✔ |
| r5 授权撤回 | withdrawal 事件追加（真 effectiveAuthorization 面） | exit 3 ∧ 报文带撤回短码+恢复指路 ∧ **零 spawn**（族目录不建） | ✔ |
| r6 伪导入 | 手写伪造档重签校验和、带**真实模板哈希与真实候选身份**（打穿规则面） | gate 仍 blocked ∧ 原始输出封存缺席（物证面拦下）；list 面在场 | ✔ |
| r7 污染 | 替身改快照 | exit 1 ∧ 判因 contamination | ✔ |
| r8 结构自相矛盾 | pass∧blocking 围栏 | blocked+归一化注记，exit 1 不可改判 | ✔ |

## 3. 真实绿例读数（真引擎会话；两档全链 review run→show→gate explain→loop finish→attestation）

| 档 | points（子账本） | 墙钟 | 双读 | 宿主对照 | gate | finish |
| --- | --- | --- | --- | --- | --- | --- |
| LIGHT | 0.11842148 | 47s | 相等（不累加） | absent ∧ db 不存在 | 裁决 PASS | exit 0 · attestation 1 |
| HEAVY（含 comparator 对照件绑 dag 绿节点） | 0.21093220 | 61s | 相等 | absent ∧ db 不存在 | 裁决 PASS | exit 0 · attestation 1 |

**计量缝收口读数**（M0 发现一）：隔离会话用量落在 `<runDir>/home/.zcode/cli/db/db.sqlite`，宿主账本对该
sessionId 结构性零行——`querySessionPoints` 参数化后 runner 读子账本、宿主对照零行，缝两侧同场实证。

**格式服从读数**（Known unknown #1 的证伪路径）：真会话最终轮单围栏服从成立（两档绿例首轮即过；解析失败率
读数=早期开发探针 3 会话中 1 次双围栏，经收窄模板（输出纪律句+读取范围硬约束）与单次重跑后未复现）。

**预算对照预注册**：≤12 会话（开发 ≤4、绿例 2、自审 1-2、复跑余量）。实耗 8：开发探针 4（light 系列各
0.394/0.325/0.279/0.118 分——三次失败运行分别暴露双围栏、夹具陈旧 .lazyzcode、幻影路径三发现，失败即数据）
+ 绿例 4（qa 首轮 light 引擎瞬态死亡 1 + 终轮两档 2 + heavy 首轮计入 1）；无超注。

## 4. 隔离与泄漏读数

- 两档绿例 input.json 零在先运行标记（facts-only 断言过）；`validity=valid` 蕴含逐会话转录轨迹在限
  （候选快照/运行目录/隔离 HOME/引擎自身前缀四前缀）。
- **真发现一（模板回显）**：真会话曾输出「修正版第二围栏」→ 恰一围栏判因 parse-fail；处置=职责模板与
  提示词加输出纪律句（禁第二围栏/禁示例回显/禁附加字段）+ 单次重跑。格式遵从债列 M3 输入。
- **真发现二（夹具自陷）**：早期夹具无 .gitignore，候选快照带入陈旧 `.lazyzcode`，评审判 blocked 点名
  「goal.json 步骤 pending 与输入包记载相反」——评审机器行为完全正确，夹具修正（.gitignore 先行）。
  该失败运行照常落档且不可改判，即「失败运行如实记账」的活体。
- **真发现三（幻影尝试路径）**：转录会记录模型拼错路径的**失败**读取（不存在路径）；containment 语义收窄为
  「存在路径的越界读取才算 breach」——读失败无数据流动，幻影单独计数如实透出（`phantoms` 字段）。
  转录粒度（Known unknown #2）实测=含逐读 file_path，无需降级。

## 5. 红绿同源读数（INV-08；harness=scripts/v040/m2-review-harness.mjs，同脚本同 env 两半）

| 观察面 | mapping | 绿半（工作树） | 红半（0a31f54 解包，--source 锚） |
| --- | --- | --- | --- |
| D1 无运行阻塞理由 | pre-N5 | 评审无在案运行——lzy review run | 受控评审运行器未接入（M2） |
| D2 替身真实运行→义务满足 | pre-N5 | exit0 valid pass metered ∧ gate 裁决 PASS | run 未知命令 exit1 |
| D3 review list/show 面 | pre-N6 | 0 / 0 且枚举到档 | 未知命令非 0 |
| D4 家族损坏 fail-closed | pre-N1 | list 非0+校验和具名+gate blocked | 无档可坏（面不存在） |
| D5 计量参数化 | pre-N4 | 子账本有行 ∧ 宿主结构性零行/无库 | 运行不可达 |
| D6 矛盾体归一化 | pre-N3 | exit1 blocked+归一化注记 | 未知命令 |

F 项红半与 harness 串逐字对应（INV-09）：mapping 见计划附注，执行期以实提交号回填——N1=5e20218、
N2=bd141ab、N3=6ed3242、N4=d0fb277、N5=7cb9c49、N6=692db63（改前树按各面 pre-* 提交解包）。

## 6. 威胁边界如实声明

- **同权限本地账本非密码学防伪**：运行档容器（校验和+版本+形状）防的是笔误与半写，不防蓄意伪造——
  伪造者可重签校验和（r6 体实证了伪造档过容器闸）。补偿控制三层：①gate 物证面（原始输出封存在场+哈希
  相符——伪造档止步于此，r6 实证）；②doctor `checkReview` 逐档家法读（损坏=fail 级）；③M3 独立复核面
  （发现生命周期）尚未建立，本阶段 gate reasons 如实指路「发现面未建立（M3）」。
- **doctor `checkReview` 口径差异**：损坏=fail 级（有意严于 checkPolicy 的 warn）——评审档是放行依据，
  读不出即不可放行；policy 档损坏只 warn 因其有 inputsHash/rulesHash 双重门在后。差异已记 N10 输入。
- **stub 契约测试的 auth 腿=fixture 注入**（deps.detectAuth/sqliteProbe）；真实 auth 只在两档绿例验证
  （oauth+provider env 双形态的宿主环境实测）。CI（无凭据）全绿=deps 注入形态，不冒充真 auth 验证。
- **隔离面边界**（沿 M0 口径）：夹具根+隔离 HOME，非全盘 chroot；不宣称抵御同权限恶意进程。转录粒度
  实测含逐读 file_path（Known unknown #2 无需降级）；幻影尝试路径语义收窄见 §4。

## 7. A4 授权条款取证溯源声明

契约 §A4（授权撤回前置拒）的反例体=qa r5（授权撤回，exit 3 零 spawn）。该体同时是 **F2 拒绝矩阵的
授权撤回体**与 **A4 的授权半证据**——F4/F6 的 accepts 引 A4 时由本报告此节点名溯源：授权撤回面的一次
取证同时服务 F2 与 A4 两判据（同一活体，无二次取证）。

## 8. M3 输入清单（本阶段如实声明不冒充的出口）

1. **发现生命周期**（§4.2 独立复核关闭/证伪/去重/延期）：评审 findings 目前只入档不流转；gate blocked
   的唯一出路=修复后重跑（报文点名 N 条阻塞发现并指路）。
2. **reassess（义务复判，ADR-0033）**：`lzy policy show/explain` 无取消通道（文案已点名 M3）。
3. **队列累计账本并入**：评审消耗未入 `LEDGER_KINDS`（不改 queue 族 schema 的本阶段取舍）——durable 面=
   运行族计量事实；并入需新 LEDGER_KIND+预算视图扩面。
4. **翻面波及面复盘**：DUTY_TABLE v2 起职责模板哈希入 rulesHash——模板任何编辑=新规则版本（supersede
   再采纳）；三条专项职责（权限与外部副作用/状态与恢复/验证依赖）须与范围资格面（§5 qualify/reuse）同批。
5. **unpriced ⇒ invalid 的残余面**：模型退出价表会重现「义务不可满足」——报文须点 `lzy loop cost` 未计价行
   与扩价表路径（core/cost.js MODEL_ALIASES）；metered 下界口径句已入运行档 note。
6. **评审消耗会话数入 drive 预算视图**：评审运行不计入 loop budget 台账（拍板 7③ 只记占位），M3 执法面
   需要评审预算档位。

## 9. 收口相位（拍板 9）与文档行

- 收口相位走既有 forward-only 世系：全量实现落地后计划增补「收口相位」节 → plan-reviewer 复审 →
  `lzy loop supersede` → attempt 2 + `.lazyzcode/policy/v040-m2-review.a2.json`（新规则导出）→ 步骤重记 →
  F 证据与自审运行按 a2 采集（a1 代运行/证据不冒充 a2）。a2 落档后职责表与模板冻结。
- AGENTS §2 M2 行、docs/history.md 里程碑行、CHANGELOG Unreleased：按 M1 先例在 finish 收口 chore 提交
  落终值（LOOP_COMPLETE 时点数字），本报告 §1/§3 数据为其唯一事实源。
