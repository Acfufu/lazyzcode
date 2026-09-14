# v005-core 双审核记录（0.0.5 内功版，R1–R5 高精度 + R6 轻量）

日期：2026-09-14 · 方法：沿 09-06/09-11 家法（A/B 双审串行单发、主代理逐条亲核、P0/P1/P2 当轮修复、P3 记账；限流纪律下的偏差如实记本节）
评审对象：diff 基准 `522cd10171`（=基线提交 8c4a2b2 的 tree）→ HEAD（goal v005-core 全部改动 + 活体面：缓存 sync 态、doctor stdout、CLI stdout）
透镜轮换：A=正确性/契约/回归红线，B=对抗输入/测试盲区/文档双语 parity；R2 红线与缓存确定性、R3 活体面、R4 文档面、R5 对抗面、R6 修复复核+抽样扫

## R1（全深度，2026-09-14）

A 审（正确性/契约/红线）：1P1/1P2/6P3 · B 审（对抗输入/测试盲区/双语 parity）：1P1/1P2/10P3。B 审活体实证：Node v20.20.2 跑 `"test/**/*.test.js"` 报 `Could not find`（v22.22.3/v24.19.0 过）。主代理逐条亲核，重叠发现合并为 14 项：

| # | 严重度 | 发现（合并后） | 处置 |
|---|--------|----------------|------|
| 1 | P1 | Node 20 声明下限与 CI 矩阵腿跑不动 glob 形态 test 命令（B 活体实证 20 红/22·24 绿；Node 20 已于 2026-04 EOL） | 修复：下限全位点 20→22（engines/CI 矩阵 [22,24]/doctor NODE_MAJOR_FLOOR/README×4/guide×6）#N8 |
| 2 | P2 | deps 语法未进 SKILL 计划块 + 解析静默吞簇（隔行/重复/大小写 deps 被丢=弱阻塞图；token 无格式校验；重复 token 不去重；裸 deps 与空白行为不一致） | 修复：SKILL 计划块教 deps+豁免语法；孤儿 deps 行计划门响亮拒；token 必须 ^[NF]\d+$；Set 去重；裸 deps=空白同报空 #N8 |
| 3 | P2 | README 双语 doctor 段缺 band-by-provider/cost 两行（narrative-checklist doctor 段巡逻面） | 修复：双语各补两行 #N8 |
| 4 | P3 | 非占步者 step done 静默清新鲜认领（匿名下无归属可查） | 修复（文档面）：SKILL Parallel dispatch 补「非占步不收口，先对认领清单」条款；ADR 修正案三已知边界已载 #N8 |
| 5 | P3 | status 下一步裸指 claimed/blocked 步 | 修复：下一步行标注（已认领）/（被阻塞：…）#N8 |
| 6 | P3 | band-by-provider 零 429 分支不出行 vs guide/CHANGELOG 只写 ≥2 provider | 修复：guide en/zh+CHANGELOG 补「且有 429」从句（设计如此：带需脏面）#N8 |
| 7 | P3 | `claim --release` 无 id 静默列清单 | 修复：改用法错 #N8 |
| 8 | P3 | AGENTS.md 合并行丢「REVISE」限定词（与「载荷事实零丢失」矛盾） | 修复：恢复 #N8 |
| 9 | P3 | zh guide 快捷块 claim 行注释列差一空格 | 修复：对齐 #N8 |
| 10 | P3 | LZY_WATERLINE_POINTS=0 被 `Number()\|\|1600` 当未设（忠实复刻 checkWaterline 既有形态，两处永不分歧） | 记账不动（一致性优先） |
| 11 | P3 | claim 额外位置参数静默容忍（CLI 全局 parseArgs 姿态） | 部分修复：claim 面拒多余位置参数；全局姿态不动 #N8 |
| 12 | P3 | 远未来 claim.at 无 doctor 可见性（唯一出路 --release） | 记账：ADR 修正案三已知边界；e2e 钉固化该语义 #N8 |
| 13 | P3 | CHANGELOG 回改 [0.0.4] 引言删「which is the next release」 | 记账：事实订正，0.0.5 引言已载发布列车语义 |
| 14 | P3 | narrative-checklist 基线行回填指令自悬（指向无数字的行） | 记账：N9 收尾回填终值时自然消解 |

验证：修复后全套 138/138 绿（134+4 新钉）；`lzy sync` 后缓存 sha 一致。A/B 审均未跑全套与活体 doctor（只读约束），由主代理修复轮补跑。修复提交 e9a0c2a（Goal: v005-core#N8）。勘误：提交信息严重度分串「2P1/1P2/13P3」与下表合并口径（1P1+2P2+11P3=14）不一致——提交信息不可改，以本表为准。

## R2（红线与缓存确定性，2026-09-14）

范围：R1 修复 diff e9a0c2a + 既有发现复验。**A 审（红线+修复复验）**：R1 八项修复全 PASS；红线全过——plugin/hooks 全程字节不动、config.json 零写入、429 谓词与账号带数学字节不动、证据门语义不动、GOAL_VERSION=1 仅 additive 字段、账本尾注 8/8 合规、AGENTS.md 148 行、缓存确定性=repo payload 14 文件与 0.0.5 缓存 sha256 全一致且 hooks.json 跨 0.0.4/0.0.5 字节相同（五钩子确定性跨版本迁移不破）；新发现 2P3。**B 审（对抗再探+记账核验）**：20 项活体探针（scratch 仓实跑 CLI）+ 6 项记账全 CONFIRMED + SKILL/help 文本与代码逐语义对表；新发现 3P3。

| # | 严重度 | 发现 | 处置 |
|---|--------|------|------|
| 1 | P3 | 次要文档 Node floor 残留四位点（release-checklist ×2、developers 双语） | 修复：22/24 对齐 #N8 |
| 2 | P3 | `--release=yes` 字符串值静默反义（当 claim 执行） | 修复：claim 面拒非布尔值 #N8 |
| 3 | P3 | bullet 前缀 `- deps: …` 被静默吞（违背门姿势注释） | 修复：孤儿扫描 RE 收编 bullet 形态+钉 #N8 |
| 4 | P3 | 栅栏引用计划语法示例会成幻影步（ITEM_RE 栅栏盲，先在行为） | 修复（文档面）：SKILL 告诫「勿把语法示例粘进被采纳计划」；解析器栅栏跳过记债（改动回归面大） |
| 5 | P3 | SKILL deps 教学块窄于门（大小写/N01/去重未教） | 修复：教学块收紧 #N8 |

验证：修复后 138/138 绿（2 断言级新增入既有测试块）、sync 后缓存 sha 一致。修复提交 4f9ffd3（Goal: v005-core#N8）。

## R3（活体面，2026-09-14）

**A 审（本机活体 doctor/status/history/list/version + scratch 认领走查）**：doctor 24 行零 undefined/NaN、rate-limit detail 201≤300 字符、截断注记数学精确（123MB 日志略头部 59MB）、**band-by-provider 行真日志首秀**（窗内 6 provider，4 显 + 余 2 略，短名剥 builtin: 正确）、cost 行走限流→维持分支且回合数与限流行一致、transport/content 分族形状不变；scratch 仓认领全矩阵（列出/阻塞拒/互斥拒/释放/无参 release 用法拒/下一步标注）逐字符合文档；版本三体活体 0.0.5 全对齐。**B 审（文档活体 parity + README 快起逐字走查 + docs-preview 实跑）**：锚点 21/21、断链 0、README 快起序列逐项复现；发现 en 侧 CLI 参考缺 history 行（09-13 6b7e861「位点成对」漏 en）。

| # | 严重度 | 发现 | 处置 |
|---|--------|------|------|
| 1 | P2 | en guide CLI 参考栅栏缺 `lzy loop history` 行（zh/help 均 14 行，en 13） | 修复：补行对齐 #N8 |
| 2 | P3 | narrative-checklist「CLI 表行 13/语言」失真（实况 en 13[缺错行]/zh 14/help 14） | 修复：14/语言+注记 #N8 |
| 3 | P3 | zh 教学栅栏缺 `lzy loop export` 行与 step-done 的 evidence-file 旗标（en 有、zh 只在散文） | 修复：两行补齐 #N8 |
| 4 | P3 | band-by-provider 把「两侧都有数据但归因漂移」与「真无脏面短缺」混称样本不足（真日志 279/172 桶被标样本不足） | 修复：标签三分（连贯/带不连贯（归因漂移）/无脏面样本）+fixture 扩第三 provider 走新分支 #N8 |

验证：修复后 138/138 绿；修复提交 3c6e6fd（Goal: v005-core#N8）。教训在案：`node --test | tail` 管道吞退出码致一轮红灯入库后 amend（本目标第二次计数类自伤）。

## R4（文档面内容深度，2026-09-14）

**A 审（AGENTS 合并保真/ADR-0004 修正案三/CHANGELOG 完整性/报告自审）**：§2 两对合并逐事实对表全存活（REVISE 恢复后）；修正案三七件事实全对码；报告三节 sha/计数自洽。**B 审（guide/README 散文 vs 行为 + SKILL 一致性 + developers 页）**：README 步级认领行逐句对码全真；guide 散文从没教过 deps/claim（真缺口）；另抓到多处先在漂移。

| # | 严重度 | 发现 | 处置 |
|---|--------|------|------|
| 1 | P2 | CHANGELOG 漏 Node 20→22 支持契约变更（engines/CI 矩阵/doctor floor） | 修复：Changed 补 bullet #N8 |
| 2 | P2 | guide 双语零处教 deps 依赖边语法/claim 散文（plan 门可硬拒计划而文档无言） | 修复：计划门示例+deps bullet+claim bullet 双语补齐（措辞沿 SKILL 收紧版） #N8 |
| 3 | P3 | e9a0c2a 提交信息严重度分串与报告表不一致 | 修复：报告 R1 节勘误行（提交信息不可改，表为准） #N8 |
| 4 | P3 | AGENTS #21 band 从句缺「且有 429」条件 | 修复：行内补齐 #N8 |
| 5 | P3 | 「互清过期认领走 --release」措辞错（过期认领自然覆写，--release 清的是未过期认领） | 修复：AGENTS #21+ADR 修正案三改「未过期」 #N8 |
| 6 | P3 | CHANGELOG Added 未提同批门/CLI 加固（孤儿行/格式校验/--release 用法守卫/下一步标注） | 修复：Added bullet 扩句 #N8 |
| 7 | P3 | guide rate-limit「≤2 仅连贯净带」与零 429 默认 cap 2 相抵 | 修复：双语补零 429 从句 #N8 |
| 8 | P3 | 「reset/abandon 清扫交接标记」对 abandon 为假（abandon 不清标记） | 修复：双语改「reset 清扫；abandon 留存，重开先 reset」 #N8 |
| 9 | P3 | developers SVG 架构图 hooks ×4（先在漂移，hooks:5 自 09-10） | 修复：双语 ×5 #N8 |
| 10 | P3 | guide Diagnostics 表缺 handoff/handoff-usage/waterline/orphan-wake 四个真实检查名 | 修复：双语补四行 #N8 |
| 11 | P3 | zh 钩子表 stop 行断成四列（GFM 静默弃多余列） | 修复：并回第三列 #N8 |
| 12 | P3 | en handoff bullet 重复「The」 | 修复：删一枚 #N8 |

验证：锚点 21/21、断链 0、148 行、138/138 绿。修复提交 140061a（Goal: v005-core#N8）。

## R5（对抗面，2026-09-14）

**A 审（对抗输入+竞态）**：竞态面 11 轮全胜——claim/claim 与 claim/done 并发 exactly-one-winner、败者干净 LoopError、goal.json 恒合法、done 自清 XOR 不变式成立；对抗面 5P3。

| # | 严重度 | 发现 | 处置 |
|---|--------|------|------|
| 1 | P3 | validateDeps 递归 DFS 在 ~5k 节深链爆调用栈误拒合法计划（4000 过/6000 拒） | 修复：显式栈迭代化+6000 深链钉 #N8 |
| 2 | P3 | 999 节环路径报错 8913 字节无界 | 修复：路径封顶 8 节+「共 N 节」+钉 #N8 |
| 3 | P3 | 畸形时间戳（9999-99-99T99:99:99Z）致 spanHours=NaN，doctor 行渲染「近 NaNh」 | 修复：noteTs 加 Date.parse 有限性门+钉 #N8 |
| 4 | P3 | 空 providerId/sessionId 按 typeof 通过（无名行/幻影会话）；ANSI 逃逸可进终端显示 | 修复：非空校验+显示面控制字符消毒+钉 #N8 |
| 5 | P3 | Math.min(...spread) 在 124k 脏桶（31MB 日志，远在扫描预算内）抛 RangeError 吞整个限流族读数 | 修复：循环归约 #N8 |

修复提交 14c6048（Goal: v005-core#N8）。

### ⚠ 无主写入事件（R5 期间，处置记录）

14c6048 提交 sweep 进 7 个非本代理所作的文件改动（README×2/AGENTS/CHANGELOG/guide×2/narrative-checklist；mtime 08:06:34 同秒批量+39s 一处——机器节奏非人工键入，时点落在 R5-A 审计员运行窗内；R5-A 结案注记称其为「先在改动」，与其只读契约相悖，归属未能确证——疑似只读子代理越权写入，亦不排除用户在场手改）。**逐项核对其内容后分类处置**：narrative-checklist「三面分记」与「handoff 在帮助枚举无（豁免记账）」两点经核实为真且措辞更优，予以保留；但四处 band-by-provider 措辞删掉了「窗级门（≥1 429 才出行）」，与 R3-B 活体探针证实的 doctor 行为（零 429 窗口不出行）相悖——已按规范措辞统一修回 README×2/guide×2/CHANGELOG/AGENTS（保留 provider 级「无脏面样本」标签语义）。教训：子代理只读契约无法强制，每轮评审后必须 git status/diff 核树再提交；非本代理改动不得盲目保留或盲目回滚，逐项核对真值后分类处置。

## R6（轻量双审，2026-09-14）

**A 审（修复存活复核）**：R1-R5 全部修复项在 HEAD 逐组核验 SURVIVAL PASS——Node floor 全位点、deps 门三校验+孤儿 RE、claim 守卫、status 标注、SKILL 教学+非占步条款、band 三分标签+窗级门六面、迭代 DFS+路径封顶、minOf/maxOf、消毒面全在；陈旧措辞 grep 全净（样本不足/互清过期认领/无 429 条件的 ≥2 providers/×4 钩子仅史 Records）。**B 审（终态门扫）**：树净（status 0 行）、13 提交尾注 13/13 独立行、缓存三文件 sha 一致、版本三体 0.0.5、AGENTS 149 行、锚点 21/21、报告 R1-R5+无主写入节齐、计划 N1-N8 逐项有落点。

| # | 严重度 | 发现 | 处置 |
|---|--------|------|------|
| 1 | P3 | 三只测试标题残留已弃简称「样本不足」 | 修复：改「真短缺/无脏面样本」 #N9 |
| 2 | P3 | narrative-checklist「帮助枚举 14 命令」字面不符（help 实为 13 loop 族，handoff 豁免） | 修复：claim 列改可核字面值 #N9 |
| 3 | P3 | 报告头 diff 基准裸树 hash 未标注 | 修复：注「=8c4a2b2 的 tree」 #N9 |
| 4 | P3 | 计划 N6 字面（目录形态）与交付（glob 形态）偏离无注记 | 修复：计划文件补换路注记 attempt 1（换路有因有据） #N9 |

验证：终局 140/140 绿、AGENTS 149 行、锚点 21/21。收官。

---

*方法论偏差记录：R1-R6 全程 A/B 串行单发（限流纪律，并发纪律行 cap=1）；各轮审前重申只读，R5 发生一起疑似只读子代理越权写入（见上节），此后每轮提交前 git status 核树成为固定动作。R6 起评审员任务书显式写入树核验。*






