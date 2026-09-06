# LazyZCode 进度双审核报告 — 5 轮 × A/B 双审

- 日期：2026-09-06 · 基线 commit `811739b`（tree `0e0b8f3c22`）· 审计对象：P0~P4 全部交付（core/ cli/ plugin/ docs/ 发布材料）
- 方法论：每轮并行两只**只读**审查代理 —— **A 审 = 代码正确性审查**（逐文件精读找真实缺陷），**B 审 = 断言-现实审计**（把宪法/文档断言逐条对真实表面验证，可跑只读探针）。主代理为唯一写者：回收发现 → 对源码核实 → 去重定级 → 成文。
- 严重度：P0=红线违反/功能损坏 · P1=真实缺陷/断言失实 · P2=应改进 · P3=吹毛求疵。每条发现含 file:line + 原样引用。
- 纪律：本轮评审未修改任何产品代码；唯一新增仓库文件即本报告。

---

## 执行摘要

**总体判定：核心架构与全部宪法红线成立，可发布；发布前建议修掉 2 条 P1（均为一行级修复，不触及红线）。** 五轮双审合计 **41 条去重发现：0×P0 · 2×P1 · 15×P2 · 24×P3**。所有红线级断言（config.json 零写入、安全 spawn 形态、Stop 预算 ≤2 预留 1 + sessionId 隔离、REVISE 门不可 force 越过、证据绑 HEAD^{tree}、终验拦截、脱敏零泄漏、发布面 24 文件零敏感物）经「代码精读 + 真实表面活体探针」双重证实；缺陷集中在**命令边界、错误诊断质量、终态处理、共享状态健壮性**，核心语义无一失效。

| 轮次 | 范围 | P0 | P1 | P2 | P3 | 断言审计 |
|------|------|----|----|----|----|----------|
| R1 | 红线与硬约束 | 0 | 0 | 2 | 3 | 7/7 ✅（5 项活体） |
| R2 | 状态机与证据语义 | 0 | **1** | 6 | 5 | 8/8 ✅（全活体，/tmp scratch） |
| R3 | CLI 生命周期与 doctor | 0 | **1** | 5 | 7 | 8 项：7✅ + 1 code-verified-only |
| R4 | 插件资产 | 0 | 0 | 1 | 4 | 8/8 ✅（stdin 全矩阵 + cache 字节比对） |
| R5 | 发布面与文档一致性 | 0 | 0 | 1 | 5 | 6/6 ✅（README 逐字端到端走通） |

**两条 P1（发布前修复建议）：**
1. **R2-1** `lzy loop abandon` 全状态必炸（`core/loop.js:40` 空 allowlist 真值 bug）——三重独立实锤（R2-A 代码、R2-B 与 R4-B 两处活体、主代理复现）。后果：放弃目标唯一出路是 `reset`（连证据档案一起删）。
2. **R3-1** 共享引擎注册表损坏被 `readRegistry` 的 catch-all 静默吞掉 → 写回只剩 lazyzcode 一条 → **其他插件注册条目被静默抹除**（`core/installer.js:39-41`，主代理亲核）。修法：仅 ENOENT 允许空默认。

**P2 主题分布**（15 条）：证据/输出形态缺引擎活体背书（R1-1）、fail-open 语义边界（R1-2）、脏检测子串过宽（R2-2）、REVISE 扫描粒度（R2-3）、git-less 目录误诊（R2-4）、并发竞态×2（R2-5 goal.json / R3-1 附带）、verify 退出码（R2-6）、计划门误报（R2-7，本评审计划初稿即被活体误报一次）、cpSync 夹带 .mimosa（R3-2）、sync rm→cp 窗口（R3-3）、hooks.json 不入自检（R3-4）、卸载版本错位（R3-5）、status 退出码契约弱于文档（R3-6）、comment-checker 终态不滤（R4-1）、README/CHANGELOG 夸大 doctor 覆盖（R5-1）。

**方法论记录**：每轮 A/B 并行、主代理唯一写者；P1 均经主代理亲自核码/复现后才记录；三轮 B 审在真机侧零污染（隔离 HOME 子壳 + /tmp scratch，清理回报完备）。双审互补性实证：abandon 由 A 审代码发现、活体双处复现；注册表 catch-all 仅 A 审发现（B 的沙箱没有损坏注册表可踩）；README 端到端仅 B 审覆盖。评审过程自身产出的元发现（计划门朴素子串误报、REVISE 全文扫描）已作为 R2 素材收录。

---

## R1 · 红线与硬约束（core/engine.js · core/paths.js · plugin/hooks/{stop,hook-lib,session-start}.js · hooks.json）

### 合并定级发现（A 审 6 条 + B 审 7 条 → 去重 5 条）

| # | 严重度 | 位置 | 发现 |
|---|--------|------|------|
| R1-1 | **P2** | `plugin/hooks/stop.js:36-38` | **预算耗尽分支的输出形态缺引擎活体证据**。该分支 emit `{additionalContext}` 且**不带 `continue`**：`emit({ additionalContext: \`[lzy] 目标循环 ${goal.slug} 已用尽本钩子续跑预算…\` })`。逆向门条件为 `stopShouldContinue && additionalContexts.length>0 && count<3`（docs/reports/review-against-reversed.md:25），按此应不续跑；但 Spike 3（docs/spikes/p0-day1.md:77-89）只活体测过 `continue+注入` 与 `{}` 两种形态，**「只注入不 continue」形态从未对引擎实测**。若引擎把 additionalContext 的存在当作续跑信号，此分支反而成为绕过 ≤2 预算的活门。B 审活体探针 D3 证实钩子侧确实产出该形态且 exit 0，但引擎侧行为仍属 code-verified-only。建议：显式 `continue: false` 或补一次活体探针。 |
| R1-2 | **P2** | `plugin/hooks/hook-lib.js:13,28` + `stop.js` | **「fail-open」实际语义与断言有出入（活体反例实锤）**。`return raw.trim() ? JSON.parse(raw) : {};` 空/坏 stdin 静默降级为 `{}` 后回退 `process.cwd()` + `unknown-session`（hook-lib.js:28）；B 审在有执行中目标的目录活体复现：`printf 'not json {{{' \| node stop.js` → `{"continue":true,…续跑预算 1/2…}` EXIT=0。即 fail-open 只保证「不阻断、不 crash」，**不保证「不请求续跑」**；且 multiple sessions 落入同一 `unknown-session` 计数器会互相耗预算。引擎正常供给 stdin 时不可达，故 P2 非 P1。 |
| R1-3 | P3 | `plugin/hooks/hook-lib.js:47,61` | sessionId 未消毒即拼进状态文件名：`const target = join(dir, \`${sessionId}.json\`);`。含 `/`/`..` 的 sessionId 可逸出 `sessions/` 目录（A、B 两审各自独立发现）。当前引擎供 UUID，不可达。 |
| R1-4 | P3 | `plugin/hooks/hook-lib.js:43-68` | 计数器 read-modify-write 非跨进程原子：并发同 session 两读 used=0 可发放 3 次。`renameSync` 保文件完整性不保增量。引擎回合模型下不可达，理论项。 |
| R1-5 | P3 | `plugin/hooks/hook-lib.js:71-73` + `stop.js:54`；`core/paths.js:69-77` | ① `emit()` 后立即 `process.exit(0)`，Windows 管道异步写可能被截断（POSIX 同步，本项目 P0 仅 macOS，paths.js:2 明示平台立场）；② `installPathFor` 将 manifest 原始字段直接入 `join`（version undefined → TypeError 而非预期报错；name 含 `/` 可逸出 cache 目录）——今日 manifest 为仓库自有常量，不可达。 |

### 断言审计结果（B 审活体探针 + A 审代码精读交叉）

| 断言 | 判决 | 证据 |
|------|------|------|
| config.json 零写入（ADR-0001） | ✅ CONFIRMED | 双审独立全仓 sweep：engine.js 无 fs 调用；唯一 config 路径 `paths.js:34` 仅被 `status.js:107` 只读消费；全部 writeFileSync 落点=注册表/cache/`.lazyzcode/`/会话计数器 |
| 安全 spawn 形态（字面量+shell:false+无 stdin） | ✅ CONFIRMED | 8 处 spawnSync 全检（engine.js×4、git.js×2、status.js:112、doctor.js:25）；`grep input:` 全仓 0 命中 |
| Stop 预算 ≤2 预留 1、per-sessionId 隔离 | ✅ CONFIRMED（活体） | B 探针 D1/D2/D3 三连跑：1/2→2/2→第三跑无 `continue` 键；计数器 `sessions/<sessionId>.json` 独立 |
| fail-open（不阻断） | ✅ CONFIRMED（活体） | 空/坏 stdin、cwd=/dev/null 强制 ENOTDIR → 全部 `{}` EXIT=0 无 stderr；catch-all `stop.js:71-73` |
| 续跑必带非空 additionalContexts | ✅ CONFIRMED（活体） | 全部 `continue:true` 两处均为非空模板串；无第三处 |
| 永不 exit 2（不用强制续跑原语） | ✅ CONFIRMED | stop.js 仅 `process.exit(0)`/failOpen |
| hooks.json 4 事件注册合规 | ✅ CONFIRMED | 仅 PostToolUse 带 `matcher:"Edit|Write"`，四条命令均为 `node "${ZCODE_PLUGIN_ROOT}/hooks/<script>"` + timeout 10，脚本文件均在 |

**R1 小结**：无 P0/P1。核心红线（config 零写入、安全 spawn、预算语义、隔离）双审交叉证实成立；2 条 P2 均为「证据缺口/断言措辞」级，非现行可触发缺陷。

---

## R2 · 目标循环状态机与证据语义（core/loop.js · core/git.js · cli/lzy.js loop/step 段）

### 合并定级发现（A 审 11 条 + B 审 11 条 → 去重 12 条）

| # | 严重度 | 位置 | 发现 |
|---|--------|------|------|
| R2-1 | **P1** | `core/loop.js:37-44,229-231` | **`lzy loop abandon` 全状态必炸（命令整体不可用，代码+活体双重实锤）**。`abandonLoop` 调 `requireActive(cwd)` 无参 → rest 参数 `states=[]` 为真值 → `[].includes(goal.status)` 恒 false → 恒抛错。主代理活体复现两态：planning 态报 `…此操作要求`（空列表），executing 态报 `…此操作要求 `（空尾串），均 EXIT=1。后果：因 `registerGoal` 在存在目标文件时拒绝新注册（core/loop.js:64-68），放弃目标的唯一出路只剩 `lzy loop reset`——而 reset 会删除 abandon 承诺保留的证据档案（cli/lzy.js:161）。修法一行：`requireActive` 加 `states.length===0` 短路，或 `abandonLoop` 显式传全部合法状态。 |
| R2-2 | P2 | `core/git.js:32-34` | 脏检测用**子串**排除：`!line.includes(".lazyzcode/")`——任何路径 merely 含该子串（如 `examples/demo/.lazyzcode/`、`backup.lazyzcode/`）的真实改动都不会触发「未提交改动」警告，证据可静默遗漏这些编辑。 |
| R2-3 | P2 | `core/loop.js:103-108` | REVISE 门对整个 `--review` 字符串做 `/\bREVISE\b/i` 全文扫描且先于 force 分支无条件执行：一份判决 PASS 但警告文本含 "revise" 字样的评审记录会被硬拒，且 `--force` 刻意不越过 → 用户只能改评审文本。「REVISE 不受 force 越过」本身是宪法 #15 的正确设计；缺陷在**判决词与普通词汇不分**的扫描粒度。 |
| R2-4 | P2 | `core/loop.js:215-222` + `core/git.js:18` | 非 git 目录/零提交仓里 `treeHash()` 返回 null → 所有 F 项落 `unbound` → `finish` 永远不可达，且报错文案误诊为「证据已过期（代码在取证后变更）」，开出的药方（重新取证）在该环境下永不可能成功。阻断本身符合设计（git.js:6-7），缺陷是误诊+死循环药方。 |
| R2-5 | P2 | `core/loop.js:163-186` | 并发 `lzy step done` 无锁竞态：两进程各读各改，后写者覆盖前者，丢步骤完成且无任何报错（read-modify-write 与 tmp+rename 的原子性无关）。 |
| R2-6 | P2 | `cli/lzy.js:145-152` | `lzy loop verify` 检出过期/未绑定证据仍恒 exit 0（对照 cmdStatus 有文档化退出码契约）：脚本化 `lzy loop verify && deploy.sh` 会在证据过期时照常放行。B 活体证实（过期 1 仍 EXIT=0）。 |
| R2-7 | P2 | `core/loop.js:87,115-127` | 未决标记门是全文件宽正则 `/(TBD\|待定\|待确认\|未定\|待讨论)/i`：正文含「尚未定论」等无辜子串即拒，且唯一 bypass `--force` 是全或无（同时关闭真 TBD 检测）。**本评审计划初稿即被误报一次**（R2 范围行里的「TBD 拦截」审计对象字样触发），与 B 审 scratch 复现互证。另注意不对称：此门可被 `--force` 越过（by design，宪法只给 REVISE 门不可越过）。 |
| R2-8 | P3 | `cli/lzy.js:36-39,128` | `--force=true` 被解析为字符串 `"true"`，`f.force === true` 为 false → 门照拒，提示用户「用 --force」（用户已用过）；`--force plan.md` 还会把路径吞成旗标值。 |
| R2-9 | P3 | `core/loop.js:181-183` | `--evidence`/`--note` 字符串无长度上限（对照项目自身 comment-checker 的 ≤300 字符纪律），`--evidence "$(cat 20MB.log)"` 会写出行级 goal.json 且每次 status/verify 重解析。 |
| R2-10 | P3 | `core/loop.js:8,21-27` | `GOAL_VERSION=1` 写入但读取时不校验：未来 schema 变更会在远离成因处误读旧状态文件而非快速失败。 |
| R2-11 | P3 | `core/loop.js:32-34` + `core/doctor.js:78-106` | tmp 写入与 rename 之间 kill -9 会留孤儿 `.goal.json.<pid>.<ts>.tmp`；`resetLoop` 只删 goal.json，doctor 状态卫生检查也不看它（rename 本身原子，无状态损坏）。 |
| R2-12 | P3 | 行为观察（`core/git.js:24-35` 无责） | 计划文件散落在仓库根（而非 `.lazyzcode/plans/`）时是真实未跟踪改动，会触发脏警告——语义正确但对按 C1 指引「任意路径写计划」操作者显得像误报；`register` 的指引已把正道指向 `.lazyzcode/plans/`。 |

### 断言审计结果（B 审活体驱动 /tmp scratch 仓，11 项探针）

| 断言 | 判决 | 关键证据（verbatim） |
|------|------|----------------------|
| 计划门拒绝含未决标记的计划 | ✅ CONFIRMED（活体） | `plan-bad.md` → `[lzy] 计划未决策完备（含 TBD/待定 标记 1 处）` EXIT=1；clean 计划 EXIT=0 |
| REVISE 拒绝且 `--force` 不越过 | ✅ CONFIRMED（活体） | 带/不带 `--force` 两次字节级相同报错 EXIT=1；PASS 记录正常采纳 |
| F 项强制 `--evidence` | ✅ CONFIRMED（活体） | 裸 `step done F1` → `[lzy] 终验项 F1 必须带 --evidence…` EXIT=1 |
| 证据绑 `HEAD^{tree}`、过期拦截 | ✅ CONFIRMED（活体） | goal.json 存值与 `git rev-parse HEAD^{tree}` 逐位核对一致（T0/T2）；新提交后 `verify` 报 `过期 1`、`finish` EXIT=1 |
| 脏树警告 + `.lazyzcode/` 不计脏 | ✅ CONFIRMED（活体） | 未跟踪文件触发 ⚠ 警告；仅 `.lazyzcode/` 在 porcelain 中时无警告 |
| finish 终验 + 全流程 happy path | ✅ CONFIRMED（活体） | 剩 N1 时 `[lzy] 未完成即停 = 半途而废` EXIT=1；补齐后 `✔✔ 目标完成` EXIT=0，status 显示 `证据@fdfe82a4bd` |
| 鲁棒边界（无计划 start / 未知步骤 / planning 态 finish） | ✅ CONFIRMED（活体） | 三例均单行 `[lzy]` 错误 + EXIT=1，零栈回溯 |
| 空 tree hash 不误判过期 | ✅ VERIFIED-OK（A 审） | 空提交不改内容树，按内容哈希比较不误报 |

**R2 小结**：1×P1（abandon 命令整体不可用——本轮唯一硬缺陷，双审+主代理三重实锤）、6×P2、5×P3。全部六个宪法断言（计划门/REVISE 门/证据强制/tree 绑定/脏检测/终验）经活体探针证实行为与宣称一致；缺陷集中在**边界与诊断质量**，不在核心状态机语义。

---

## R3 · CLI 生命周期与 doctor（core/installer.js · core/status.js · core/doctor.js · cli/syntax-check-worker.js · cli/lzy.js 全局）

### 合并定级发现（A 审 12 条 + B 审 9 条 → 去重 13 条）

| # | 严重度 | 位置 | 发现 |
|---|--------|------|------|
| R3-1 | **P1** | `core/installer.js:33-41`（主代理已亲核） | **共享注册表损坏→静默清空其他插件条目**。`readRegistry` 的 `catch { return { version: 1, plugins: [] }; }` 无差别兜底：ENOENT（全新安装的合法路径）与 JSON.parse 失败/EACCES（共享引擎注册表 `~/.zcode/cli/plugins/installed_plugins.json` 被截断/无权限）不可区分。后续 `upsertRegistryEntry`(:79-85)/`removeFromRegistry`(:92-98) 把「只含 lazyzcode 一条」的注册表原子写回 → **其他插件的注册条目被静默抹除**。该 read-modify-write 也无锁（与引擎并发写可丢更新）。修法：仅 ENOENT 允许空默认，parse/权限错误必须上抛。 |
| R3-2 | P2 | `core/installer.js:105` | `cpSync(repoPluginDir(), dest, { recursive: true })` 无排除过滤器：`plugin/hooks/.mimosa/`（守卫运行时残留，本仓实测在载荷内）与 `.DS_Store` 会被原样部署进公开 cache；npm tarball 干净仅因 `files` 排除（package.json:20-21），`cpSync` 不吃这套。 |
| R3-3 | P2 | `cli/lzy.js:85` + `core/installer.js:103-105` | sync 先 `rmSync` 活 cache 再 cp——rm→cp 窗口内并发会话的钩子脚本可 ENOENT，而输出断言「已开启的会话不受影响」不真。deploy 改 tmp+rename（仓库已有同款 `writeRegistryAtomic` 模式）即成立。 |
| R3-4 | P2 | `cli/syntax-check-worker.js:14` | doctor 语法自检只 `.filter(endsWith(".js"))`——**hooks.json 本身永不被语法校验**：JSON 拼错 → 自检报 0 坏文件、doctor 全绿、引擎注册 hooks:0、整层纪律静默失效。 |
| R3-5 | P2 | `core/installer.js:166` | 卸载删的是**当前 manifest 版本**推导的 cache 路径，而非注册表记录的 `installPath`（:64 有存不用）：装 0.0.1 后仓升 0.0.2 未 sync 就卸载 → 0.0.2（不存在）被 rm、0.0.1 成孤儿。 |
| R3-6 | P2 | `core/status.js:39-41,88` + `cli/lzy.js:215` | 「退出码 0=健康」契约弱于文档：引擎缺席时 engine=warn/enabled=skip → exit 0。轮询退出码的 CI 会把「插件根本装不上」的机器判为健康。（engine 列取失败时 remediation 还误指「先运行 lzy install」，status.js:67。） |
| R3-7 | P3 | `core/installer.js:65-75`（B 活体） | 注册表幂等是语义幂等非字节幂等：每次 install 重写 `updatedAt`（B 三连装 diff 实证仅此一字段变化；`installedAt`/`cacheTransactionId` 经 `prev?.` 正确保留）。 |
| R3-8 | P3 | `cli/lzy.js:107`（B 活体） | 卸载「无安装物」时头部仍打绿色 `✔ 已卸载`（步骤行如实披露引擎失败），成功图标误导。 |
| R3-9 | P3 | `core/paths.js:48-56`（B 活体） | darwin 默认引擎候选路径无法用 env 关闭（`LZY_ZCODE_ENGINE` 只前插不替换）→ 「引擎缺失回退手动启用」路径在本机不可活体触达（code-verified only，cli/lzy.js:76-79 文案正确）。可测性缺口。 |
| R3-10 | P3 | `core/doctor.js:26-27` | 语法 worker 用 PATH 上的 `"node"` 而非 `process.execPath` 拉起（与 engine.js 自家纪律不一致）：PATH 上有古怪 node 时自检 fail-soft 为 ⚠（B 活体捕获 `spawnSync node ENOENT` 形态）——fail-soft 设计正确（worker 崩溃/超时/输出不可解析均 warn 绝不 pass，doctor.js:30-40），但属可避免的降级。 |
| R3-11 | P3 | `AGENTS.md:21` vs `cli/syntax-check-worker.js:28` | **宪法措辞失实**：写的是「node --check 走 stdin + vm worker」，实际实现是 worker 内 `new vm.SourceTextModule(source)` 纯解析（不执行、无代码执行面，实现本身可靠）——实现无罪，宪法描述过期（R5 文档面需同步）。 |
| R3-12 | P3 | `core/status.js:60,78` | 「缓存载荷完整」只查了 manifest 存在性（hooks/skills/agents 缺失也叫完整）；诊断归属用 `JSON.stringify(d).includes(id)` 子串匹配可误捕他人插件的诊断。 |
| R3-13 | P3 | `cli/lzy.js:89` + `cli/lzy.js` 文件位 | `--watch=1` 静默退化为一次性 sync（只认裸 `--watch` token）；`cli/lzy.js` 文件位 644 非可执行（npm shim 无碍，直调 `./cli/lzy.js` 会失败）。 |

### 断言审计结果（B 审：隔离 HOME 活体生命周期 + 真机只读侧）

| 断言 | 判决 | 关键证据（verbatim） |
|------|------|----------------------|
| install 幂等（cache 落位+注册表写） | ✅ CONFIRMED（活体，隔离 HOME 三连装） | 三次 stdout 全同 EXIT=0；载荷字节级不变；注册表仅 `updatedAt` 漂移（R3-7） |
| 引擎缺失→手动启用回退、exit 0（ADR-0001） | ⚠️ CODE-VERIFIED-ONLY | 本机 darwin 默认候选无法经 env 关闭（R3-9）；回退文案 `⚠ 启用未完成——安装已就绪，还差一步` 经代码核实正确 |
| uninstall 闭环（注册表+cache 移除） | ✅ CONFIRMED（活体） | 注册表归 `plugins:[]`、版本载荷全删；空父目录壳残留（P3 级） |
| status 只读 + codegraph 缺席=skip 不翻退出码 | ✅ CONFIRMED（活体双态） | 真机 `➖/✔ codegraph` 两态均捕获；exit 聚合只数 `fail`（status.js:129-130） |
| doctor = status 全套+五项自检+零遥测 | ✅ CONFIRMED（活体） | 12 项检查 2.2s 跑完 EXIT=0；仅横幅提及遥测（零外发）；node 越过 PATH 时 hooks 项 fail-soft ⚠（R3-10） |
| npm scripts ↔ CLI 对得齐 | ✅ CONFIRMED（活体） | status/doctor/loop(默认 status)/step(用法错误 EXIT=1) 四脚本输出全符合预期 |
| 发布面 24 文件零敏感物 | ✅ CONFIRMED（活体复跑） | `npm publish --dry-run` 24 files / 29.5kB；grep `mimosa\|.lazyzcode\|docs/` 零命中；bin+shebang 在 |
| lzy 尊重 HOME 隔离（评审红线） | ✅ CONFIRMED（活体 A/B 对照） | 真机注册表字节级不变、官方清单 mtime 不动；漂移均来自活体宿主自身 |

**R3 小结**：1×P1（共享注册表 catch-all 数据销毁面——本轮第二硬缺陷，主代理亲核）、5×P2、7×P3。五项宪法断言活体证实；ADR-0001 回退路径因引擎候选硬编码不可活体触达（可测性缺口如实记账）。B 审全程真机零污染（隔离 HOME 子壳 + 清理回报完备）。

---

## R4 · 插件资产（hooks.json · comment-checker.js · trigger.js · agents/×3 · skills/zw/SKILL.md · plugin.json）

### 合并定级发现（A 审 3 条 + B 审 7 条 → 去重 5 条）

| # | 严重度 | 位置 | 发现 |
|---|--------|------|------|
| R4-1 | **P2** | `plugin/hooks/comment-checker.js:40-41` | **goal 闸门只查在场不查 status**：`const goal = readGoal(cwd); if (!goal) failOpen();`——`readGoal`（hook-lib.js:32-41）不过滤状态，`finish`/`abandon` 后 goal.json 仍在，轻提示对**后续所有 Edit/Write 永续触发**直到 `lzy loop reset`。姊妹钩子均有状态闸（stop.js:23 要求 executing；session-start.js:48 静默 done/abandoned），唯 comment-checker 缺席。触发场景：几周后用户在老工作区改一行含 TODO 的代码，仍被注入"[lzy] comment-checker"循环上下文。 |
| R4-2 | P3 | `plugin/hooks/comment-checker.js:22-23` | Edit 分支行号在 `new_string` 片段内计算却以 `标记:L2` 呈现，读起来像文件行号：1 行片段应用到文件 137 行 → 提示 `L1`，误导定位。 |
| R4-3 | P3 | `plugin/hooks/comment-checker.js:33`（B 活体度量） | `MAX_DETAIL=300` 截断的只是内层 detail 且实际不可达（B 实测 10 命中最长 146 字符）——真实 ≤300 性质来自 `MAX_LISTED=5` 而非 300 守卫；守卫形同虚设（无害但名不副实）。 |
| R4-4 | P3 | `plugin/hooks/trigger.js:6`（B 17 例矩阵） | 词边界是 **ASCII 标识符边界**非 Unicode 词边界：`伊zw语` → INJECT（CJK 相邻不拦）。对中文提示词属良性甚至合意；但「词边界防误触」实际只防拉丁标识符相邻（`azw`/`a_zw`/`my_zw_var`/`ultraworks` 均不触发，实证）。另：`lzy loop verify` 无目标时 EXIT=1，SKILL.md 未提。 |
| R4-5 | P3 | `plugin/skills/zw/SKILL.md:41` | 「One active goal per workspace」低述实情：done/abandoned 的 goal.json 同样阻塞新注册（core/loop.js:64-68），SKILL.md 未把 `lzy loop reset` 列为新循环前置——模型按技能文本连续开下一个目标时会撞未预期的恢复步骤。（与 R4-1 同族：终态处理三处不一致。） |

### 断言审计结果（B 审活体 stdin 矩阵 + cache 字节比对）

| 断言 | 判决 | 关键证据（verbatim） |
|------|------|----------------------|
| comment-checker goal 闸门（无目标=静默） | ✅ CONFIRMED（活体） | 无 goal 态三种输入全 `{}` EXIT=0；armed 态 TODO/FIXME 均出 `标记:L1 …（只提示，不阻断）` EXIT=0 |
| 上限 5 处 ≤300 字符 | ✅ CONFIRMED（活体度量） | 10 命中 → 列 5 + `…及 5 处更多`，总长 146 实测；细节见 R4-3 |
| comment-checker fail-open | ✅ CONFIRMED（活体） | 空/坏 JSON/缺字段/不存在 cwd/字段错型 → 五例全 `{}` EXIT=0 |
| 调试残留检测（console.log/debugger） | ✅ CONFIRMED（活体） | `console.log`/`console.debug`/`debugger` 命中；`console.info/warn` 不误报；`TODOX`/`MYTODO` 零误报 |
| 触发词词边界防误触 | ✅ CONFIRMED（活体 17 例） | zw/ulw/ultrawork 均注入、`ZW` 大写注入、`pwd`/`azw`/`ultraworks`/`a_zw` 不注入；CJK 相邻行为见 R4-4 |
| 三 agent 只读契约（file:line / VERDICT / MATCH） | ✅ VERIFIED-OK（A 审） | explorer.md:25-32、plan-reviewer.md:21-32（VERDICT 为首行而非末行——无害，解析按位置无关正则）、qa-executor.md:20-33；引擎自动发现 agents/ 有活体在证 |
| SKILL.md cheat sheet ↔ CLI 实况 | ✅ CONFIRMED（A+B 双审） | 每条命令/旗标逐一比对零漂移；行为性断言（Stop ≤2 预留 1、REVISE 不可 force 越过、tree 绑定）与代码一致；abandon 存在但执行必炸（独立佐证 R2-1） |
| 已装 cache 与仓库载荷一致 | ✅ CONFIRMED（活体 `cmp -s`） | 11 文件 byte-identical、双向零缺失；cache 侧 3 个 `.mimosa` 文件为引擎运行态非载荷漂移 |

**R4 小结**：无 P0/P1（abandon P1 系 R2 已录，本轮第三处独立佐证）。1×P2（comment-checker 终态不滤）+ 4×P3。插件资产内部一致性最佳：文本层与实现层零漂移，两个 stdin 钩子在全矩阵下行为与宣称逐条相符。

---

## R5 · 发布面与文档一致性（README · CHANGELOG · LICENSE · package.json · AGENTS.md · docs/ · 脱敏）

### 合并定级发现（A 审 5 条 + B 审 2 条 → 去重 6 条）

| # | 严重度 | 位置 | 发现 |
|---|--------|------|------|
| R5-1 | **P2** | `README.md:34` · `CHANGELOG.md:34-36` | 「hook 语法自检」宣传覆盖面大于实货：doctor 只把 hook 目录喂给 JS 解析器（core/doctor.js:27），hooks.json 本身永不校验（机制见 R3-4）——文档措辞随 R3-4 一并修正即可。 |
| R5-2 | P3 | `docs/adr/0001-*.md:28` | ADR 写「status 不读 config」，P3 后 `core/status.js:104-107` 为 codegraph 探测只读消费了 config——意图（零写入、启用态走引擎 CLI）未破，句子过期需补注。 |
| R5-3 | P3 | `AGENTS.md:77-84`（§7 仓库地图） | 地图未含 docs/reviews/（本报告入库后即漂移）；按 §9 维护纪律提交后应顺手补一行。 |
| R5-4 | P3 | `README.md:11` | 前置清单缺 git：目标循环证据纪律硬依赖 git（README.md:66 `HEAD^{tree}`），非 git 项目 F 项证据开箱即不可用。 |
| R5-5 | P3 | `package.json` | 公开发布前缺 `repository`/`bugs`/`homepage` 元数据：npm 页面将无 Repository 链接（README 也仅在 lazycodex 引用处间接带出仓库）。 |
| R5-6 | P3 | `docs/reports/.mimosa/`（本地，gitignored） | 其中 9 个文件含真实 session id（sess_5fa4…）与机器路径——git 零跟踪、tarball 零包含（B 双重验证），仅当整目录脱离 git 拷贝才会泄漏；建议列入发布前手工检查清单。（同类：plugin/hooks/.mimosa/、test/spike/four-styles/.mimosa/ 均为 gitignored 本地残留。） |

### 断言审计结果（B 审 README 逐字端到端 + 宪法/CHANGELOG 抽查）

| 断言 | 判决 | 关键证据（verbatim） |
|------|------|----------------------|
| README 快速开始端到端可走通（~10 分钟） | ✅ CONFIRMED（活体，`npm i -g`<tarball> 替代网络步） | install→doctor→status 全 ✔（`hooks:4`、`lzy-path` shim 解析）；机械步 <20s，10 分钟上限宽裕；GUI 会话步按 README 自身已知限制属 doc-verified only |
| `lzy --version`/`--help`、bin shim、零依赖 | ✅ CONFIRMED（活体） | `lzy 0.0.1（插件载荷同版本）· 引擎 0.16.5`；tarball 29.5kB/24 files；`added 1 package` |
| install→status→uninstall 生命周期 | ✅ CONFIRMED（活体） | 卸载后 status 三项 ✖ EXIT=1（正确不健康态）；真机 HOME 前后 stat 一致 |
| 宪法 §2 抽查（spike/ADR/reports/120≤150 行/四个 commit） | ✅ CONFIRMED 5/5 | p0-day1.md 三 spike 各✅；ADR-0001 标题逐字匹配；index.html 在场；`wc -l AGENTS.md`=120；45a4834/0317155/a1255da/811739b 全在 log |
| CHANGELOG 事实抽样 | ✅ CONFIRMED 5/5 | Stop ≤2、comment-checker 正则与上限、四钩子、「24 文件」算术精确（2 cli+7 core+11 plugin+4 门面）、零 npm 依赖 |
| 脱敏（tracked 树零机器泄漏） | ✅ CONFIRMED | `git grep acfufu/sess_` 零命中；`/Applications/ZCode.app` 属白名单泛化路径；残留物全在 gitignored `.mimosa/`（R5-6） |
| LICENSE=标准 MIT、版本三方一致 | ✅ VERIFIED-OK（A 审） | MIT 文本逐字；`Copyright (c) 2026 LazyZCode contributors`；0.0.1 在 package.json/plugin.json/CHANGELOG 三处一致 |

**R5 小结**：无 P0/P1。发布面干净（泄漏、许可、命令准确性三零）；6 条发现全部是文档措辞漂移与发布前元数据补全，其中 R5-1 与 R3-4 同根同修。

---

## 处置记录（2026-09-07）

用户拍板：①P1 现在修 ②发布只备料 ③P2 按组修核心并记录剩余 ④测试/CI 同批做 ⑤机械项带走。
执行：goal `review-remediation`（6 commits），契约测试 13/13 绿；本节修复commit 均可 `git show` 复核。

### 已修对照（P1×2 + P2×15 + P3×5）

| 发现 | 处置 | commit |
|------|------|--------|
| R2-1 abandon 全状态必炸 | `requireActive` 空 allowlist 按长度短路 | 7710dcf |
| R3-1 注册表 catch-all 吞损坏 | 仅 ENOENT 空默认、损坏上抛；status 加损坏诊断护（开发中自抓 else 链 null 解引用一并修） | 7710dcf |
| R1-1 预算耗尽形态无背书 | 显式 `continue:false`（逆向门合法形态） | 742d312 |
| R3-2 cpSync 夹带点残留 | filter 排除点目录/点文件，保留 `.zcode-plugin` | 742d312 |
| R3-3 sync rm→cp 空窗 | 同父 tmp + rename 原子换装 | 742d312 |
| R2-4 git-less finish 误诊 | 过期/未绑定分诊双文案，药方可执行 | d852902 |
| R2-5 goal.json 并发竞态 | `withLock`（mkdir 原子锁 + owner + 10s 过期抢 + 5s 超时）套全部变更操作 | d852902 |
| R2-6 verify 恒 exit 0 | 有过期/未绑定即 exit 1，帮助行同步 | d852902 |
| R3-5 卸载按当前版本删错目录 | 优先注册表 `installPath`，缺省回退推导 | d852902 |
| R3-6 status 退出码契约弱于文档 | 帮助行澄清「0=无 fail 级」；引擎 list 失败分诊 warn 不再误导重装 | d852902 |
| R1-2 空/坏 stdin 仍续跑 | `readStdinJson` 失败返回 null；无 stdin/坏 JSON/缺 sessionId 一律 failOpen（四钩子齐） | c3c6c47 |
| R2-2 脏检测子串过宽 | porcelain 行路径精确判定，仅排除 `.lazyzcode/` 自身 | c3c6c47 |
| R2-3 REVISE 全文扫描误拒 | `VERDICT:` 记号优先采信，无记号回退关键词 | c3c6c47 |
| R2-7 计划门误报难豁免 | 报错逐命中列行号+摘录；`<!--lzy:allow-->` 行级豁免 | c3c6c47 |
| R3-4 hooks.json 不入自检 | worker 增 JSON 解析+形状校验（`{description,hooks:{事件:[…]}}`，兼容裸事件表） | c3c6c47 |
| R5-1 doctor 覆盖宣传过宽 | README/CHANGELOG 措辞与实现对齐 | c3c6c47 |
| R4-1 comment-checker 终态不滤 | 非 executing 不提示（缺 status 兼容视为在跑） | c3c6c47 |
| R3-11 / R5-2 / R5-3 / R5-4 / R5-5（P3 机械项） | 宪法 doctor 措辞订正、ADR-0001 只读注、§7 地图补 reviews/test、README 前置补 git、package.json repository/bugs/homepage | 8982703 |

### 已文档化（1）

- R5-6 三处 `.mimosa` 本地残留外带检查 → `docs/release-checklist.md` #10。

### 新增测试与 CI

`test/` 契约三件套 13 用例（钩子 stdin 矩阵 / 状态机 E2E / 发布面，node:test **零 npm 依赖**）+ `.github/workflows/ci.yml`（node 20/22/24）→ d144ae4；本地 `npm test` 13/13 绿（2.4s）。

### 剩余未修（18 条 P3，按「顺带修」原则：动到相关文件时才顺手修）

> **2026-09-07 已全部处置：17 修 + 1 维持不修**（goal `p3-sweep-hook-env`，用户拍板「现在修」）。

1. R1-3 sessionId 未消毒拼状态文件名（引擎供 UUID，不可达）
2. R1-4 Stop 计数器 read-modify-write 非跨进程原子（引擎回合模型不可达）
3. R1-5 emit+exit(0) Windows 管道截断风险（项目 macOS-only）；installPathFor manifest 字段直入 join 未校验
4. R2-8 `--force=true` / `--force <路径>` 解析坑
5. R2-9 `--evidence`/`--note` 无长度上限（对照项目自身 300 字符纪律）
6. R2-10 GOAL_VERSION 写入不校验读取
7. R2-11 kill -9 孤儿 `.tmp` 残留，doctor/reset 均不查
8. R2-12 计划文件散落仓库根触发脏警告（语义正确、指引已指向 `.lazyzcode/plans/`，判无需修）
9. R3-7 注册表语义幂等致 `updatedAt` 每次 install 漂移
10. R3-8 卸载「无安装物」仍打绿 ✔
11. R3-9 darwin 引擎候选不可经 env 关闭，enable 回退路径无法活体触达（可测性）
12. R3-10 语法 worker 经 PATH `node` 而非 `process.execPath` 拉起（fail-soft 降级）
13. R3-12 「缓存载荷完整」仅查 manifest 存在；诊断子串归属可过捕
14. R3-13 `--watch=1` 静默退化一次性；cli/lzy.js 644 非可执行位
15. R4-2 comment-checker Edit 分支行号为片段相对却呈现为文件行号
16. R4-3 MAX_DETAIL=300 实际不可达，上限实由 MAX_LISTED=5 保证
17. R4-4 触发词边界为 ASCII 标识符级（CJK 相邻触发，良性）；`verify` 无目标 exit 1 未写进文档
18. R4-5 SKILL.md 低述终态占用，`reset` 前置未写明

处置对照（2026-09-07）：①R1-3→`1dbd9e3` ②R1-4→`1dbd9e3`（mkdir 轻锁超时放行）③R1-5①→`1dbd9e3`（fd1 直写）/②→`cdadaf3`（白名单校验）④R2-8→`61187f6` ⑤R2-9→`61187f6`（note 300/evidence 4000）⑥R2-10→`61187f6` ⑦R2-11→`61187f6`（reset 连带清理+doctor 卫生查）⑧R2-12 维持不修（语义正确、指引已到位）⑨R3-7→`c5ba72e`（升格字节幂等）⑩R3-8→`c5ba72e` ⑪R3-9→`cdadaf3`（env 改替换语义）⑫R3-10→`3c03977` ⑬R3-12→`c5ba72e`（逐文件核验+结构化归属）⑭R3-13→`61187f6` ⑮R4-2→`1dbd9e3` ⑯R4-3→`1dbd9e3` ⑰R4-4→SKILL.md 补 verify 退出码（`d144ae4` 后续 docs 提交）；CJK 词边界维持现状（判良性）；2026-09-07 触发词分层落地（goal rl-v3-trigger-strata）后句中 bare `zw` 不再触发，「伊zw语 → INJECT」变为静默（分层匹配 + 条件双路注入文案，行为变更在此记账）⑱R4-5→SKILL.md 补 reset 前置。
另记（修复轮带入的新发现）：引擎以自身 env 直接 spawn 钩子命令，GUI 直启场景 PATH 无 node → 裸 `node` 四钩子静默全灭（本会话触发词注入缺席活体佐证；2026-09-06 验收能跑系当从带 nvm 的终端启动）→ 四钩子改走 `run-hook.sh` 启动器 + doctor 增 `hook-node` 检查（`73966c8`），诊断全文 `docs/diagnostics/2026-09-07-hook-spawn-env.md`；契约测试增至 22 用例（`26894ec`）。

### 新记账（修复轮评审带入）

- R1-1 附注：`continue:false` 按逆向门为合法形态，但引擎侧行为仍 code-verified-only（headless 认证阻塞活体）；获得活体条件时补探针。
- R2-7 附注：UNDECIDED_RE 朴素子串匹配残留（如「尚无定论」仍命中）；行级豁免是缓解非根治，若误报积累再考虑收窄为行首标记语法。





