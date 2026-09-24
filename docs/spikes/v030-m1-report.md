# v030-m1 实施报告：0.3.0 M1 项目与授权

goal `v030-m1`（0.3.0 M1 项目与授权：需求契约 + 授权撤回 + 项目清单 + 知识路由 + 迁移预览）· 2026-09-24 开工。
主方案 docs/plan-v030-agent-first.md §3/§7/§10-M1；计划 `.lazyzcode/plans/v030-m1.md`（快照 sha256 9b35c0f5d3…）。

## 1. 冻结基线

| 面 | 冻结值 |
| --- | --- |
| 本仓 HEAD（开工时点） | `6cfa167` docs(ledger): V08 verdict accepted（= 0.2.4 + M0 收官 + V08 拍板入库） |
| 计划快照 | `.lazyzcode/loop/snapshots/v030-m1.md` · sha256 9b35c0f5d3… |
| node | v24.19.0（沿用 M0 §1 实测；M1 纯 Node CLI 面，无 bun/xcode 依赖） |
| 测试基线 | `npm test` 491 绿（0.2.4 发布载荷基线） |
| 入口体积基线（F4 红半锚点） | plugin/skills/zw/SKILL.md = 47,285 B；根 AGENTS.md = 93,869 B |

**计划外事件记账（红线 3：信任状态、订正言语）**：开工时 HEAD 已自规划会话快照（f92e8ca）前进——用户于 2026-09-24 07:11 拍板 V08 判定（积分预算=逐请求完成检测+停止下一次派发的近似限制语义，M3 解锁）并提交 6cfa167，**AGENTS §4 决策表 #32 已被该拍板占用**。计划 N14 所写「决策行 #32」据实顺延为 **#33**；此为外部提交导致的机械编号漂移，不动已采纳快照，本节即订正记录。

## 2. 接线点事实表（explorer 侦察，代码级，2026-09-24）

| 面 | 事实 | 证据 |
| --- | --- | --- |
| 人权门单点 | `doAdoptPlan` 内单一 `if`（first adopt 与 supersede 同门复入）；无独立二次校验步 | core/loop.js:933-950；supersedePlan=同函数带旗复入 loop.js:822-825 |
| planHash | sha256(计划文件原始字节)；快照 writeAtomic 至 loop/snapshots/，supersede 归档 `.attempt<n>.md` | loop.js:869-874/912/981-989 |
| 批准钩子 | UPS 正则 `批准\|approve +8hex`+否定前置过滤；复核 pending.planPath 文件哈希；原子 tmp+rename 写 approvals/；记录 `{version,slug,planHash,at,sessionId}` | plugin/hooks/trigger.js:37/41/51-140 |
| 批准读面 | findApproval 扫 approvals/*.json，slug+planHash 双键 | loop.js:797-813 |
| 校验和账本家法 | errno 判别（只 ENOENT 特判）+ 载荷 sha256 校验和 + 版本/形状断言 + 空载荷写护栏 + tmp 0600 rename | core/attempt.js:62-122（dag.js:42-111 同族） |
| 计划解析 | ITEM_RE/UNDECIDED_RE/deps 家法（紧跟项行+孤儿拒）/subjects 家法；TITLE_MAX=300 | loop.js:50/507-565/576-619/660-695 |
| reset 家族登记义务 | 新增常驻账本须登记 LOOP_TMP_SCAN_DIRS/ANY_TMP_SCAN_DIRS + doctor EXEMPT（loop/ 内项） | loop.js:2120-2131（义务注释 2152-2155）、doctor.js:307/319 |
| CLI 分派 | 单文件 switch；新值旗标须入 VALUE_FLAGS 白名单；help 枚举受账本巡逻 | cli/lzy.js:72-73/815-862/925-1017/1020-1065 |
| doctor | push(name,state,detail) 四态 ok/warn/skip/fail；退出码只看 fail；step 函数 try/catch fail-soft | core/doctor.js:1046-1089 |
| 技能装载 | 引擎原生发现 plugin/skills/zw/SKILL.md（manifest `skills:"skills"`）；钩子只发短 nudge 不内联正文；installer 整目录递归复制 | plugin/.zcode-plugin/plugin.json、core/installer.js:157-158、trigger.js:231-241 |
| 迁移机器 | 全仓无 migrate 代码；approvals create-only 无撤回（M0 §2 事实 5/6） | M0 报告 §2 |

## 3. 计划评审轮记录

| 轮 | 判决 | 处置 |
| --- | --- | --- |
| R1 | REVISE | 9 发现（1P1+4P2+4P3）全修：P1=N12 标题 312>300；P2=契约文件漂移复核缺失（增五查之 a）、contractPending 再置规则缺失（增幂等再置）、钩子写 goal.json 竞态（改钩子只追加、CLI 锁内清/再置）、`lzy contract register` 未定义（裁撤，只留 show/auth）；P3=十问预注册/ANY_TMP_SCAN_DIRS 指针订正/win32 雷防/accepts 仅 F 项后+scope 路径规则+L1 证据标注 |
| R2 | REVISE | 唯一残留：N13 标题 314>300（win32 细节顶超）→ 移缩进子弹 |
| R3 | 通过 | 终扫 20 项零发现 |
| R4 | 通过 | 机器门捕获 R2/R3 双双漏掉的自环 `deps: N1`（N1 依赖自己）——评审脚本补齐 validateDeps 复刻检查后复核：唯一改动=删该行，其余与 R3 版逐字节一致，终判可采纳 |

教训入 memory 候选：评审解析器自检须逐字复刻 validateDeps 的自环+环检查（R2/R3 均报「图无环」却漏自环；机器门为权威）。

## 4. F4 十问检索清单（预注册，搬迁后逐问验证两跳可达）

①触发词与别名 ②Stop 续跑预算与预留 ③红绿证据与豁免形态 ④计划门禁词与决策完备 ⑤并发纪律来源 ⑥无人值守唤醒协议 ⑦跨仓宿主工作区规则 ⑧提交尾注账本格式 ⑨H3R 三原型开关语义 ⑩消融 kill-switch 家族语义。
（F4 执行时逐问记录：入口文件 → 指针 → 落点文件，路径链在案。）

## 5. 实施记录（随步追加）

- N2-N11 机器面逐提交落地（contract.js/trigger.js/loop.js 契约门五查/accepts/project.js/migrate.js/CLI 三族/doctor 三行）；每步 `npm test` 全绿（基线 491 零回归）。
- N12 对抗反例夹具（scripts/probes/v030-m1-gate-repro.sh，v030-fixtures 外隔离现场；绿半=本树 CLI，红半=冻结基线 lazyzcode@4b54f77 且 HUMAN_GATE 消融如实记账）：
  - 反例1 越界：红半覆盖缺口计划静默采纳（exit 0）；绿半查 c 覆盖缺口拒 + 查 d subject 出 scope 拒（exit 1）。
  - 反例2 撤回：红半「撤回 abcdef01」被基线静默无视（空 JSON，exit 0）；绿半撤回→supersede 被拒点名撤回（查 b，exit 1）→再批准→supersede 过（exit 0）；authorizations 账本 approval→withdrawal→approval 时序在案。
  - 反例3 配方漂移：红半改 lzy.project.json 后基线重采纳无感知（exit 0）；绿半查 e 漂移拒（exit 1）。
  - 夹具勘误记账：配方哈希须与文件字节同源（printf 无换行 vs echo 有换行曾误配——查 e 活体自证）；sibling 须为真兄弟仓（宿主内路径被既有 subject 包含关系门先拒）。
- 计划外漂移记账：开工时用户已拍板 V08（提交 6cfa167），AGENTS §4 #32 被占用→计划 N14「决策行 #32」顺延 #33（本报告 §1）。

## 6. 对抗清单自查（docs/research-adversarial-checklist.md 九类，2026-09-24）

本 goal 新增面：契约门（CLI 闸，parse+state-merge 面）、trigger.js 批准双分派+撤回分支（command 面）、
project.js 清单校验（parse 面）、migrate.js 只读预览（展示面）、authorizations 账本家族。逐类：

1. **malformed input——已有防护（新增面自带）**：契约解析器拒绝未知结构键/单值键重复/非法 endpoint/坏 recipe/A 项重复 id/scope 不存在；清单校验拒绝 shell 串 argv/重复 id/负 timeout/env 带值/writePaths 逃逸（契约测试 8 例）；授权账本单条损坏 fail-closed（跳过会隐藏 withdrawal——比 approvals 的 skip 严，威胁差异在 report §2 注明）。
2. **prompt injection——不适用（债 A 残余不扩大）**：契约文件与计划文件同信任级（用户/作者手写），本 goal 未引入外部不可信内容面；钩子撤回/批准短语否定前置筛沿 APPROVE_NEG_RE 家法，emit 文案全静态（双跑字节确定契约不破）。
3. **cancel-resume——已有防护（新面自带再置幂等）**：契约门每次拒绝在 withLock 内幂等再置 contractPending（mirror approvalPending 家法）；authorizations 追加式 reset 不清（契约测试钉）；钩子只追加记录不写 goal.json，CLI 闸与钩子并发无竞态。
4. **stale state——已有防护（新面主题即防过期）**：契约门查 a 每次重哈希磁盘契约文件（漂移即拒）；查 e 现算清单哈希（配方漂移即拒）；授权时序=at ISO 主键+文件名次键确定性排序；活体：反例3 配方漂移红绿在案。
5. **dirty worktree——已有防护**：本 goal 全程先提交后取证；scope 是采纳时点边界声明，运行时写入面无执法（如实 L0 声明，见计划执法层级节与债 F）。
6. **hung commands——已有防护**：contract.js/project.js/migrate.js 零 spawn 全同步；无新增超时面。
7. **flaky tests——已有防护**：三件套 23 例全确定性（固定 at 时戳、无时区依赖、HOME 隔离、win32 雷防家法：path.join 全程/原始 JSON 解析断言/无分隔符假设）。
8. **misleading success output——已有防护（本 goal 主题）**：越界三反例机器拒（查 c/d/b/e 红绿在案）；迁移预览恒标 authorization=NONE；project check 如实命名「入口存在」静态半、不冒充「实际可运行」。
9. **repeated interruptions——已有防护**：钩子 fail-open 姿态不变；重复撤回短语=追加多条 withdrawal 记录（后到者赢，无害幂等语义）。

**记账新债**：
- **债 F（scope 运行时执法缺位，本 goal 增记）**：契约 scope 仅在采纳/supersede 两闸执法（subjects⊆scope），lzy 不观察每次写入——scope 外写入是 L0 协议面非机器门。升格条件：M3 队列派发落地时由派发前检查扩展执法点；出现真实越 scope 事故时评估写入拦截。
- 债 A（计划/契约内容无来源标记）不变未扩大；债 B/C/D/E 状态不变。
