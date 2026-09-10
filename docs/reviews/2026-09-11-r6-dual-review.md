# LazyZCode 第六轮双审核报告 — A/B 双审（R6）

- 日期：2026-09-11 · 基线 commit `0dca352`（tree `51a0bfe70c`）· 审计对象：09-07 P3 清账收口后的全部演进（92 提交、15 个 goal）+ 全仓现状（core 9 + cli 2 + plugin 载荷 20 文件、docs 全面、test 13 套件）。
- 方法论：沿 09-06 家法——**A 审 = 代码正确性精读**（只读代理逐文件找真实缺陷），**B 审 = 断言-现实审计**（只读代理把文档/宪法断言对真实表面验证），**主代理唯一写者**：回收发现 → 对源码逐条亲核 → 去重定级 → 成文。本轮 **13/13 条发现均经主代理亲核属实后才收录**。
- **方法论偏差（如实记）**：①09-06 为两代理并行，本轮按实测限流纪律改**串行单发**（doctor rate-limit 实测：近 26h 账号限流 2308 次首撞、集中本地 22:00–01:00 占 8 成，评审窗口正落集中段；`lzy loop start` 并发纪律行=并行上限 1）；②B 审活体探针腿由**主代理亲跑**（explorer 契约禁写盘，/tmp scratch 类探针归主代理，09-06 先例同构）；③活体探针**收窄为测试作证不了的三项**（cache 字节比对 / flake 现实形态 / run-hook.sh PATH 回退），计划门/REVISE/证据门/过期拦截/handoff 消费/绊线 TTL 等断言已被 test/（loop.e2e/tripwire/plan-gate 套件）覆盖，引 N1 绿基线（94 用例 92 绿）作证——配额集中段把串行 spawn 花在测试已断言的面上新信号近零。
- 严重度：P0=红线违反/功能损坏 · P1=真实缺陷/断言失实 · P2=应改进 · P3=吹毛求疵。每条含 file:line + 原样引用。
- 纪律：本轮评审**未修改任何产品代码**；仓库写入=本报告 + 宪法 §2 一行（§9.1 阶段推进要求）。

---

## 执行摘要

**总体判定：宪法红线与核心语义全部成立，无 P0；发布面前有一条 P1 阻断项（README 安装主路径在真实 npm registry 404——发布后自消解，属「待用户动作」的文档面失同步而非代码缺陷）。** 双审合计 **13 条去重发现：0×P0 · 1×P1 · 4×P2 · 8×P3**（A/B 零重叠）；**终验阶段（F1 实跑）再翻出 1 条元发现 R6F-1（P2）**，全轮合计 **14 条：0×P0 · 1×P1 · 5×P2 · 8×P3**。六类计数位点零漂移；两轮历史处置 16 条抽查零虚记（2 条部分在位转新发现 R6A-1/R6A-4）；cache 已装载荷与仓库字节级一致；已知债务七项判定齐（⑥升级为「源码级消解、活体仍欠」）。

| 通道 | P0 | P1 | P2 | P3 | 覆盖面 |
|------|----|----|----|----|--------|
| A 审（代码精读） | 0 | 0 | 3 | 5 | 20 文件 20/20 已读确认；红线九靶全过（含引擎源码交叉验证）；处置抽查 10；债务七项 |
| B 审（断言-现实） | 0 | 1 | 1 | 3 | 38 条断言判决（33 CONFIRMED / 5 DIFF）；六类计数位点全一致；处置抽查 6 |
| F1 终验实跑（元发现） | 0 | 0 | 1 | 0 | 第三失败≠环境类：R6F-1 日期+小时依赖断言（固定 now 四对照确定性复现） |
| **合计（亲核后）** | **0** | **1** | **5** | **8** | 14/14 主代理亲核属实 |

---

## R6A · A 审发现（代码正确性）

| # | 严重度 | 位置 | 发现（亲核属实） |
|---|--------|------|------|
| R6A-1 | **P2** | `core/loop.js:135-165` | **registerGoal 是唯一不套 withLock 的 goal.json 变更操作**（adoptPlan/start/completeStep/finish/abandon/reset 六处全套）。并发 `lzy loop register`（如无人值守 cron 唤起撞手工会话）双方 readGoal 均 null → 各自 writeGoal 原子覆盖 → 先注册的目标无痕丢失。git -S 考古：自 c86e918 引入即无锁，系 R2-5 修复（「withLock 套全部变更操作」）的漏网，非新回归。修法：registerGoal 的查重+写入整体入锁。 |
| R6A-2 | **P2** | `core/status.js:174` + `cli/lzy.js:75-82` | 裸 `lzy status` 遇 version≠1 的 goal.json 整体炸：readGoal（loop.js:37-42）抛 LoopError，collectStatus 无隔离、cmdStatus 无 try/catch → 已完成的 engine/install/files/enabled 检查全部丢弃、单行报错 exit 1。doctor 侧有兜底（doctor.js:388-393 降级 warn 行），status 侧没有——违背 doctor.js:1-4「单项异常 fail-soft」纪律。触发：盘上 goal.json version≠1（lzy 降级/手改）后跑 `lzy status`。 |
| R6A-3 | **P2** | `core/loop.js:501-530` vs `:532-534` | **handoffGoal 锁外交写 vs resetLoop 锁内清理的交错竞态**：handoff 的 requireActive 读到 goal 在场 → 并发 reset 进锁清 marker+删 goal.json（cleanupLoopResidue loop.js:556-558，注释自述防的正是此事故）→ handoff 在锁外写入 marker → 孤儿 marker + 无 goal。下一目标 register+start 后首个 Stop 消费残标记（stop.js:61-84）→ 误放行 + `consumed++` 污染新目标可观测面。:527 注释只论证了对 Stop 消费的原子性，漏了 reset 侧。修法：handoff 写入入 withLock（与 requireActive 同事务）。 |
| R6A-4 | P3 | `plugin/hooks/stop.js:161` | 全收口分支预算耗尽路径 `return {}; // 预算用尽：放手` 未用显式 `continue:false`——同文件 :116 注释宣称「三处放行/弃拉（stuck/预算/交接）统一显式键，不赌省略形态」，此处是**第四处**放行出口破了自家统一性断言。功能等价（引擎判据需 `continue===true`，空对象不入 3 池，A 审引擎源码实证 L2552/L2706：`stopShouldContinue===!0 && additionalContexts.length>0 && t<3`），纯形态一致性。 |
| R6A-5 | P3 | `cli/lzy.js:37` + `:232` | `snapshot` 不在 VALUE_FLAGS 白名单：`--snapshot foo` 时 foo 落位置参数 `_[1]`，靠 handoff 分支回退取值碰巧工作；`--snapshot=foo` 才原生生效。当前可用但绑定脆弱（调用序列一变即绑错值）。 |
| R6A-6 | P3 | `core/status.js:111-114` | dirtyHint 语义指向**载荷仓库**（「仓库有未提交改动，先提交再 sync」），脏检测却打 `createGit(process.cwd())`——npm 安装场景 cwd=用户项目时误指用户项目；且无 missing/mismatch 时该 git spawn 纯浪费（每次 status 多一次子进程）。 |
| R6A-7 | P3 | `core/loop.js:29-35` | readGoal 的 catch-all 把「goal.json 在场但损坏」与「不存在」同归 null：status 报「本目录没有目标循环状态」（误导）、registerGoal 直接覆盖损坏文件（无警告）、listRepos 把损坏仓报成空仓。与 R6A-2 合看=损坏分诊缺失的两半。 |
| R6A-8 | P3 | `core/loop.js:72-81`（withLock）+ `hook-lib.js:179-192`（withSessionLock 同款） | 过期抢锁 stat-then-rm TOCTOU：等待者 B 判锁过期后、rmSync 前，另一进程已抢旧锁建新锁 → B 删掉**活锁**并成功 mkdir，双持有者。R1-4 处置只记了「超时无锁放行」为接受面，rm-无归属校验这半边未记账。需过期锁+双等待者+精确交错，极窄；后果=并发会话计数器双读多发续跑。 |

### A 审红线九靶（全部通过，验伪未中）

| 靶 | 判决 | 关键证据 |
|----|------|----------|
| 1 config.json 零写入 | ✅ | 唯一触点 status.js:202-208 只读（codegraph 探测）；写面仅注册表/cache/`.lazyzcode/`//tmp |
| 2 spawn 安全形态 | ✅ | 全部 spawnSync（git×5/engine×4/doctor×3/status×1）字面量 argv+shell:false+无 input 通道 |
| 3 Stop 预算 ≤2+隔离 | ✅ | hook-lib.js:17 MAX=2；耗尽/stuck/交接三处显式 `continue:false`；交接 unlink 无 force 恰一赢家；放行清振数/stuck 不入 continues |
| 4 fail-open=不阻断且不续跑 | ✅ | 五钩子坏/空 stdin → `{}`+exit 0 无 continue 键；引擎判据需 continue===true（源码实证） |
| 5 锁与原子写 | ✅（两漏网→R6A-1/R6A-3） | 六处变更入锁；tmp+rename 原子写齐 |
| 6 路径消毒 | ✅ | sanitizeSessionId 白名单+截断（hook-lib.js:45-49）；installPathFor 白名单（paths.js:75-88） |
| 7 tree-hash 证据语义 | ✅ | `HEAD^{tree}`+hex 校验（git.js:12-21）；porcelain 精确路径排除 `.lazyzcode/`（git.js:59）；过期 finish 拦（loop.js:387-400） |
| 8 认领制 | ✅ | claimedAt 唤起级+executing 闸门（trigger.js:37-46）；Stop 仅认领会话（stop.js:43-46）；两振 stuck 弃拉不耗预算（stop.js:100-111） |
| 9 新面专项（09-07 后 92 提交） | ✅ | tripwire TTL/warn-once/重臂、salvage 盘点、metrics 永不抛、listRepos 每仓容错、status 逐文件 sha256、恢复式报错+fail-fast、scheduleAdvisory 纯 UTC、handoff/abandon CLI 面——未见缺陷（handoff 竞态见 R6A-3） |

---

## R6B · B 审发现（断言-现实）

| # | 严重度 | 位置 | 发现（亲核属实） |
|---|--------|------|------|
| R6B-1 | **P1** | `README.md:49` + `README.zh-CN.md:46`（排障项 :240/:244 再次指引） | **快速开始安装主路径在真实 npm registry 上不存在**：`npm view lazyzcode` → E404（2026-09-11 实测），README 双语无任何「未发布/需本地安装」提示——新用户照文档第一步即失败。AGENTS.md §2 明记「真发布待用户动作（0.0.3 已定版待发布）」，README 未跟齐此状态。**发布后自消解**；不发布则需加未发布提示。属发布面文档失同步，非代码缺陷，因「第一步即失败+双语齐错」定 P1。 |
| R6B-2 | **P2** | `AGENTS.md:59`（决策 #7） | 决策速查表宣称「manifest `description_i18n` 折中」**从未落地**：plugin/.zcode-plugin/plugin.json 实为 {name,version,description,skills} 四字段，`description_i18n` 全仓 json/js 零命中（仅宪法与研究底稿两处文字）。§9.1 要求决策变更同步速查表，但表内条目与实物不符——要么补字段要么订正决策行（manifest 单语 description 现状即事实上的定案）。 |
| R6B-3 | P3 | `AGENTS.md:102-103`（§7 地图） | 地图两条过账：`docs/ablation.md`（§2:29 引用为消融协议与账本所在，文件在场）未入地图；「契约测试三件套」是修复轮时点事实，test/ 现为 13 个测试文件+spike/。 |
| R6B-4 | P3 | `plugin/skills/zw/SKILL.md:312-325` | CLI cheat sheet 缺 `lzy loop handoff`（仅 :208 Continuation 散文提及）与 `lzy loop list [--root]`（全文零出现）两行——技能是模型会话内主要发现面，两命令 README/CHANGELOG/CLI 枚举均已记载，唯独速查表面缺席。 |
| R6B-5 | P3 | `cli/lzy.js:319-332` | `lzy --help` 目标循环段缺 `lzy loop handoff` 行（有 list 无 handoff），与同文件 :252 未知子命令枚举（含 handoff）及 README 命令表三面不对称。 |

### B 审断言判决摘要（38 条：33 CONFIRMED / 5 DIFF→上表）

- **宪法面**：§9.2 行数预算 143/150 ✅；§3.1 七事件枚举与逆向报告一致 ✅；hooks:4→5 与 hooks.json 5 键及实机 `hooks:5` 一致 ✅；§4 决策引用的 ADR 0001-0009 全在场且主题相符 ✅；近 5 条里程碑 goal slug 与 git log 对得上、行内测试数（86/86、74/74、93/93、94 静态计数）逐字相符 ✅；§5 红线两条代码面成立 ✅（R6B-11/12）；§3.8 cache 三候选 ✅。
- **README/CHANGELOG/SKILL 面**：两技能/五钩子/三代理 ✅；架构树 5 ✅；core 九模块清单 ✅；CI node 20/22/24 ✅；doctor 检查清单 14 项双语逐项对位 ✅；版本三处一致 0.0.3（含装机缓存）✅；CHANGELOG 0.0.3/Unreleased 声明抽验（TTL 10min、`^mcp__`、sha256 比对、handoff 不耗预算、metrics 跨 reset、list、疤痕豁免、PEAK_WINDOWS、UTC+8、架构树 4→5）全 CONFIRMED ✅；SKILL.md 行为断言（Stop ≤2 预留、REVISE 不可 force、verify 无目标 exit 1、finish 三段拦截）与源码逐条相符 ✅；init-deep 资格谓词/上限/退出码与 agentsmd.js 相符 ✅；零 npm 依赖/Node ≥20/纯 ESM ✅。
- **六类计数位点：零漂移**——hooks=5（hooks.json/AGENTS/README 双语/developers 双语/架构树双语七处全对表）、guide 锚点 21+21、技能=2、特性卡=6（home.html 六块）、developers 契约句=5、架构树句=5。README 双语表格行数完全对位。

---

## 历史处置抽查（A 审 10 + B 审 6 = 16 条）

- **A 审 10 条**：8 条全在位（R2-1 abandon 短路 loop.js:121-122、R3-1 仅 ENOENT installer.js:36-38、R1-2 五钩子 failOpen、R2-2 精确路径 git.js:59、R2-3 VERDICT 记号 loop.js:185-191、R3-4 hooks.json 自检 worker:12-37、R1-3 sessionId 消毒 hook-lib.js:45-49、R2-9 上限 loop.js:321-335）；**2 条部分在位转新发现**：R1-1（三处显式 continue:false 在位、第四出口 stop.js:161 遗漏→R6A-4）、R2-5（六处入锁、registerGoal 漏网→R6A-1）。
- **B 审 6 条**（git show 三方对表：报告↔提交信息↔现行代码）：7710dcf / 742d312 / d852902 / c3c6c47 / 1dbd9e3 / 61187f6 全部相符，**零虚记**。

## 债务七项判定

| # | 债务 | 判定 |
|---|------|------|
| ① | 多树证据绑定只见宿主树（ADR-0006） | 仍在，未恶化（git.js 单仓 cwd；绑定点只打宿主树） |
| ② | 依赖图并行认领（决策 #21 记债） | 仍在，未恶化（nextStep 线性 find） |
| ③ | 2 flake e2e | 仍在；本轮 N4 探针实证其**确定性**形态（见下）——两次全量运行失败集稳定为同两条，非随机 flake，是测试隔离缺陷（doctor 引擎探测子进程把真日志写进假 HOME） |
| ④ | 多认领撞窗（ADR-0009 已知边界） | 仍在，按 ADR 记账未恶化 |
| ⑤ | headless 引擎认证 | 仍在（凭据属引擎侧，代码面无从复核） |
| ⑥ | R1-1 附注 continue:false 引擎侧 code-verified-only | **升级：源码级消解**（A 审对 zcode.cjs 实证 `stopShouldContinue===!0 && additionalContexts.length>0 && t<3`、仅 `continue===!0` 置位——continue:false 不入 3 池已是源码实锤）；真机活体探针仍欠（与 ⑤ 同源阻塞） |
| ⑦ | R2-7 附注 UNDECIDED_RE 朴素子串 | 仍在（loop.js:169 原样；行级豁免是缓解非根治） |

## N4 · 活体探针（主代理亲跑，只写 /tmp，真机零污染）

1. **cache 载荷 vs 仓内载荷**：`diff -r -x .mimosa -x .DS_Store ~/.zcode/cli/plugins/cache/lazyzcode-local/lazyzcode/0.0.3 plugin/` → **BYTE-IDENTICAL**（cache 侧恰 14 文件、无 .mimosa 残留；与 doctor files 行「逐文件 sha256 一致（14 文件）」互证）。零 sync 漂移。
2. **2 flake 现实形态**：`npm test` 两次运行失败集恒=ratelimit.contract.test.js:119（rate-limit 行）与 :507（transport 行）——假 HOME 断言期望 `/无引擎日志/` skip 行，实得 `'  ✔ rate-limit   近 24h 无账号级限流记录'` 等真数据行，即引擎探测子进程把日志写进了假 HOME。**确定性复现非随机**（债 ③ 机制实锤）。
3. **run-hook.sh 三态**：①`env -i PATH=/usr/bin:/bin` 下 `--print-node` 解析出 `/Users/acfufu/.nvm/versions/node/v24.19.0/bin/node`（PATH 无 node 时 nvm fallback 活体成立）；②同环境经启动器跑 comment-checker（/tmp cwd 无 goal）→ `{}` exit 0；③空 HOME 全不可解析 → exit 0 放行 + `/tmp/lzy-hook-launcher.log` 记 `2026-09-10T18:09:10Z lzy hook: node unresolvable (PATH=/usr/bin:/bin); comment-checker.js skipped (fail-open)`——启动器 fail-open 契约三态全过。

---

## R6F · 终验阶段元发现（F1 实跑翻出）

| # | 严重度 | 位置 | 发现（固定 now 四对照确定性复现） |
|---|--------|------|------|
| R6F-1 | **P2** | `core/ratelimit.js:372-404`（overlapSegments）+ `test/tier1-unattended.contract.test.js:75-118` | **计价重叠枚举「沿窗」注释与线性实现不符：锚在窗尾时溢出窗外，把非窗内小时误报「窗内落高峰计价」**。机制：候选窗枚举以「now 起下一个进入窗的整点」为锚后**线性连走 total 小时**（:384-385），不沿窗弧回卷——now 落窗尾时（如窗 19:00–03:00、now=周五 02:15 → 锚 02:00），枚举 02→09 越过窗终点 03:00，把**窗外**的 09:00（DeepSeek 周一至五 9–12 高峰起点）误判入窗 → doctor 输出自相矛盾：「建议窗口 19:00–03:00 …… ⚠ 窗内 09:00–10:00 落平台高峰计价」。固定 now 纯函数四对照实锤：Fri 02:15→`["09:00–10:00"]`（伪）、Sat 02:15→`[]`、Fri 01:15→`[]`（溢出仅达 08:00）、Fri 18:15→`[]`（窗外锚=19:00 整窗枚举不溢出）——精确触发带=**工作日 02:00–03:00 本地**（对本 fixture）。后果三重：①该波段内 doctor 对用户输出错误告警（恰是无人值守活跃时段）；②溢出波段同时**漏检**真实窗内重叠（枚举越窗后不再覆盖窗的剩余部分，当前表窗小时恰无高峰故未显形）；③e2e 断言 `doesNotMatch /高峰计价/`（:111）在该波段确定性失败——342bfdb「整数集不相交，任何执行日确定」只防了周几漂移没防小时内漂移，本轮 N1 两次 01:0x 全绿、02:1x 翻红即此。修法方向：枚举沿窗弧回卷（进入窗外小时即跳回 start），或如实改「从现在起的连续 8h 运行将跨入」措辞并同步测试注释。 |

**F1 终验实跑记录（如实）**：最终提交后 `npm test` = **94 用例 / 91 绿 / 3 失败**——失败集 = 既有 2 flake（ratelimit.contract:119/:507，形态与 N1 完全一致）+ R6F-1（tier1-unattended:75，非环境类，机制如上）。第三失败超出计划预设的「环境类」口径，按实际定性入账为本发现。

## OPEN QUESTIONS（需仓外/写盘/发布动作才能闭）


- **R6B-1 根因闭环**：`npm publish` 属用户动作（docs/release-checklist.md 13 步），发布后本条自消解；若暂不发布，README 双语需加未发布提示（修复目标内拍板）。
- **引擎版本轴**：宪法 §3 约束源自逆向 ZCode Desktop v3.11.2（build 89817f5b），本机引擎 CLI 自报 0.16.5——两轴是否同一构建未确证；7 事件/≤3 续跑等约束在装机版上的字面成立性维持逆向报告背书。
- **宿主自动化挂载**（automation-a8aba356）：仓外宿主状态，只读手段未见定义文件，维持 AGENTS.md §2 记载 + 09-10 人肉冒烟四环背书。
- 债务 ⑥ 的真机活体探针（continue:false 注入实测）与 headless 认证同源阻塞，获得条件后补。

## 处置建议（修复另立目标，本轮不动产品代码）

- **P1（R6B-1）**：随发布闭环；或发布前 README 双语快速开始加一行「未发布，先本地安装」提示（与 AGENTS §2 状态同步）。
- **P2 五条**：R6A-1 registerGoal 入锁（连同查重，一个 withLock 包完）；R6A-2 status 侧 readGoal try/catch 隔离降级 warn 行（对齐 doctor 兜底）；R6A-3 handoffGoal 写入入锁；R6B-2 决策 #7 订正（`description_i18n` 改为「manifest 单语 description，双语由 docs 站承载」之类实况）；R6F-1 overlapSegments 沿窗弧回卷枚举（或如实改措辞+测试注释，并补「锚在窗尾」固定 now 回归钉）——五条均一行到十行级修复。
- **P3 八条**：按「顺带修」记账（R6A-4 stop.js:161 补显式 continue:false 与注释对齐；R6A-5 snapshot 入 VALUE_FLAGS；R6A-6 dirtyHint 改 repoDir+惰性求值；R6A-7 损坏分诊；R6A-8 抢锁归属校验；R6B-3 地图两处；R6B-4 cheat sheet 补两行；R6B-5 help 补一行）。
- **债 ③**（flake→确定性测试隔离缺陷）：修复方向=doctor 引擎探测 spawn 显式注入隔离 env（测试已证明 PATH 注入可隔离），升格候选。
