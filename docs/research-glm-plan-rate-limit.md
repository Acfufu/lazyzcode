# GLM 套餐限流与并发纪律——调研底稿（2026-09-07）

触发：用户 zw 任务失败，报 `[1302][您的账户已达到速率限制…][trace-id]`（429 `rate_limited`，
`retryable=true`）。本文记录机制、本机实测、归因与设计；实现为 doctor `rate-limit` 体检 +
zw SKILL.md 共享池纪律段。

## 1. 限制机制（官方文档）

GLM Coding Plan 双轨限制：

1. **用量配额**：每 5 小时滚动 + 每周限额，按 prompt 计次（Lite ≈ 80 次/5h，Pro ≈ 400，
   Max 约为 Pro 的 5 倍）。打满报额度类错误，等窗口滚动即可。
2. **并发/速率限制**：`1302` 属此类。官方明确「并发上限按套餐等级分级，Max > Pro > Lite，
   平台动态调整、不公布具体数值」；允许 Subagent 并发调用。高峰期（约 14:00–18:00 UTC+8）
   可能叠加动态限流。

本次撞的是第 2 类（全部 429 `rate_limited`，无额度类错误）；事发时间 00:40–02:46（本地）
不在官方高峰窗口——是用户自己的并发打满，非平台调控。

## 2. 本机实测（引擎 cli 日志 2026-09-07，UTC 时间戳）

数据源 `~/.zcode/cli/log/zcode-2026-09-07.jsonl`（每日一文件，现存保留 7 天，单日
24–85 MB）。**统计口径**：`event=model.request.failed` 且 `context.reason=rate_limited`；
`attempt` 取自 `context.attempt`（顶层无此字段）。双审 A 独立复算确认下列快照在
2026-09-06T19:17:50Z 时刻互洽；日志仍在活体追加，其后数字继续增长（429 复发见下）。

- **主峰窗口**：16:40:27Z 首条 429，主峰持续至 18:46Z（本地 00:40–02:46）；截至 19:17Z
  快照：429 失败请求 550 次、首撞（attempt=1）197 次、烧穿判死（attempt≥maxAttempts=11）
  5 次、受影响会话 27+ 个（当日全程 40+ 会话）。
- **并发曲线**（5 分钟桶活跃会话数 vs 429）：
  - ≤5 个活跃会话：16:00–16:35Z 各桶全净。
  - 6–10 个：主峰期 429 连绵（峰值桶 18:35Z，10 会话）。
  - 18:47Z 主会话从 8 回落至 2–3，主峰结束；**其后 429 零星复发**（至 19:50Z，
    以 subagent 为主——单请求长生成，RPM 压力远小于快速轮转的主会话）→
    **同时活跃的主会话数是主导变量**（方向性结论，非严格因果）。
- **经验并发带**（本账号当夜，粗粒度）：≤5 安全，≥6 开始持续撞线。近似性：桶内活跃
  会话数 ≠ 并发请求数（长请求与重试跨桶，归因偏移会把低活跃桶标脏），只作经验参考。
- **重试放大**：首撞 197 → 共 550 次失败请求（平均放大 ~2.8×）→ 主峰期仅 5 个烧穿
  11 次判 turn 死（用户看到的「任务失败」，如 sess_c0cc326f 硬顶约 6 分钟后死）。
  饱和期重试又加剧拥堵，轻微雪球。
- **分布**（19:17Z 快照）：main_turn 356 / subagent 172 / session_title 15 /
  project_memory_extract 7。

## 3. 自适配问题（用户 2026-09-07 拍板前置疑问：「分发后能否自适应用户套餐？」）

**套餐档位本地不可探测**：`~/.zcode/config.json`、`installed_plugins.json`、引擎日志均无
档位/订阅字段（2026-09-07 实查）。引擎多模型目录（10 provider）也不暴露配额元数据。

结论：**不做声明式档位配置（也无可声明的来源），做经验测量**——从本地引擎日志统计 429
压力与经验并发带，输出到 `lzy doctor`。三点理由：

1. 免配置、免遥测（宪法 #9），且 ADR-0001 的 config 零写入红线不破；
2. **撞过限流的账号自动校准**：429 数据来自用户自己的真实压力，Lite 的数据反映 Lite、
   Max 的反映 Max——测量天然随套餐与用量自适配（从未撞过 429 的账号只有 ok 行、
   不出带，冷启动即「无需带」）；
3. 失败事件自带 `providerId`，失败计数按 provider 分组可做；活跃桶（started 事件）
   无 providerId，故**经验带不按 provider 细分**——未来多 provider / 角色编排接入时，
   失败计数面按 provider 维度零结构扩展（角色级并发预算可消费同一数据）。

## 4. 设计

### 4.1 `lzy doctor` 增 `rate-limit` 检查（warn-only）

- 新模块 `core/ratelimit.js`：`collectRateLimitStats(logDir)`（单目录）——读目录内
  最近 2 个 `zcode-*.jsonl`，**readline 流式逐行**（单日可达 85 MB，禁 readFileSync
  整读），子串预过滤命中后才 JSON.parse：
  - 输入事件：`model.request.started`（活跃桶）、`model.request.failed` 且
    `context.reason === "rate_limited"`；
  - 桶键 = **日期+HH:MM**（UTC，跨天文件不串桶）；
  - 输出：`available`、`rateLimited`、`providers{}`（失败计数，内部数据不渲染明细）、
    `sessions{}`、`fatal`（`context.attempt >= context.maxAttempts`，非字面量 11）、
    `lastAt`、`band`：
    - 脏桶（含 429）最低活跃数 `minDirty`、净桶最高活跃数 `maxClean`；
    - 连贯（`minDirty > maxClean`）**且** 样本足量（脏桶 ≥3 且净桶 ≥3）才输出带；
    - 否则降级输出单边证据「撞线时活跃会话低至 minDirty」（归因偏移下这是常态路径，
      守卫是对的，常见情形是被压掉）。
- `paths.js` 增 `userCliLogDir()`（解析归 paths，污点不跨文件，沿既有纪律）。
- `doctor.js` 在 `checkHookNode` 后加 `checkRateLimit`：
  - 无日志目录/文件 → `skip`（不翻转退出码，沿 codegraph 缺席先例）；
  - 有 429 记录 → `warn`（单行 ≤300 字符：计数、会话数、判死数、`lastAt` 本地时刻、
    行动指引三条——串行循环 / 活跃主会话 ≤3~5 / 判死后等数分钟 `zw 继续`）；
  - 零 429 → `ok`；读取/解析故障或坏行/半行（引擎活体写入中）→ fail-soft，按可解析
    前缀计数（诊断自身故障不翻转退出码）。

### 4.2 zw SKILL.md 增「Rate-limit discipline (provider concurrency)」段

英文编排文本（宪法决策 #7），插入 Continuation 之后、Red lines 之前。命名避开既有
「shared 3-continue pool」（Stop 续跑预算，AGENTS.md §3.3）——段名与首句显式切割两个
「池」，防执行模型混淆。要点全部行为化（模型可直接执行）：

- 一次只跑一个目标循环；子代理**默认串行**，仅多个独立 F 项取证时至多 ≤2 并发；
- turn 死于 429/1302 时：不重试轰炸、不 replan，干净收尾（状态在 `.lazyzcode/` 不丢），
  告知用户数分钟后 `zw 继续`/`lzy loop step` 恢复；
- 配额只影响 triage 选档（本就 contained 的活可从 LIGHT 起），**risk trumps quota**——
  本质 risky/vague 的活无论配额多紧都是 HEAVY；engaged 之后 Never downgrade 不变
  （Tier triage 处加回指，两处互引）；
- 多会话作业前 `lzy doctor` 看账号 429 压力与经验带；CLI cheat sheet 补 `lzy doctor` 行。

### 4.3 文档同步

README 排障速查补 1302 行 + doctor 能力清单行同步；CHANGELOG 补英文 Added 条目
（沿现有全英文风格）；AGENTS.md §2 补状态行、§4 补决策 #16（自适配=经验测量、零新增
配置面）、§8 补「经验并发带」词条（带 _Avoid_）。

## 5. 边界与非目标

- 不写用户 `config.json`（ADR-0001）；不新增任何配置面（自适配免声明）。
- 不改造引擎重试行为（引擎对插件不可插拔）；不做任何遥测（宪法 #9）。
- doctor 只读扫 `~/.zcode/cli/log/`；保留期以现场观察为准（现存 7 天），文件缺失天然降级。
- 「活跃会话数」是并发压力的近似代理，不宣称精确并发值。

## 6. 验收面

- `lzy doctor` stdout 在本机真实日志上输出 `rate-limit` 行（warn + 统计）——CLI stdout 取证。
- 契约测试（fixture 日志目录）：统计正确性 / skip / fail-soft 三态 + HOME 覆盖端到端。

## 7. v3 口径声明（2026-09-07，goal rl-v3-trigger-strata，轻度 A/B 双审后定稿）

- 回合口径：主口径 = (sessionId,turnId) 复合键去重（覆盖率 ≥90% 才用）；降级口径 = attempt===1
  首撞计数（attempt 缺失按 1 计，宁可计入不漏报）。一份报告只用一种口径，doctor 行内以
  「回合 / 次首撞」标明，两口径不可混用（不可比）。
- 集中段双门槛+地板：本地小时 3 小时环形窗，份额 ≥60%（按去重回合）且窗内回合 ≥10 且窗内
  started ≥100，三条全过才输出；份额不足即便听感集中也不输出（实测：本机撞线为 0–5 点 6 小时
  平台，最佳 3h 窗仅 56%，正确不输出）。
- 时区：内部聚合一律 UTC；「本地小时」只允许从完整带 Z 时间戳经 Date 解析——桶键（无 Z）喂
  Date 会按本地时区静默平移；游程连续性用 UTC 毫秒差判定（===60000），跨文件/跨午夜不断链。
  DST 日本地小时标签可能重/缺（darwin 主场无 DST，开源面向所有人如实记一笔）。
- 边界归属噪声（已知不追）：小时边界（started 13:59、撞线 14:00）、扫描窗起点截断（窗前首撞
  窗内只见重试）、双日同小时合并（hour-of-day 每槽 n=2）均只造成小幅噪声，不影响结论方向。
- 活跃会话数为分钟级下界（长回合无 started 事件不计入）；「撞线时活跃 N 会话」永远读作下界。
- 警戒线：不引入「平台官方高峰时段加权」之类先验——那等于把声明式平台假设走私进测量（决策 #16）。
