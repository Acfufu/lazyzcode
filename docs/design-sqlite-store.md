# 局部状态 SQLite 存储契约（P1 冻结）

日期：2026-10-16 · 状态：**P1 冻结；P2 已实施；P3 已实施；P4 已实施（2026-10-23 发版 0.6.0，goal p4-sqlite-release：七条评审处置＋macOS 真实 CLI 电池 29/29＋win32 VM 电池 10/10＋定版发布；处置表与平台事实=§12 P4 节）**
依据：`docs/plan-lzy-sqlite-state.md` §4（P1 批=范围/schema/存储契约/能力矩阵/试点及故障证据）；`docs/adr/0039-sqlite-store-boundary.md`（边界与地板定案）；能力矩阵与逐版本原始证据=goal `p1-sqlite-pilot` 的 F 证据面（探针脚本 `scripts/sqlite-capability-probe.mjs`，P1 N4 入库）。
本文件是存储层单一实施依据：P1 只冻结，不接线；任何与现行 `core/queue.js` 语义的偏差都在 §3 对账表逐条声明。

## 1. 范围与边界

**迁入本库**:队列条目（queue items）、派发事务与分段（dispatches、dispatch segments）、预算事件账（budget events）、批次预算设置（budget settings）与 schema/backend 元数据（meta）——即现行三件家族的全部内容:

| 现行文件 | 现行位置 | 迁入后 |
|---|---|---|
| queue.json | `.lazyzcode/queue/` | 单库 `.lazyzcode/state.sqlite`（路径冻结） |
| dispatch.json | `.lazyzcode/queue/` | 同上 |
| ledger.json | `.lazyzcode/budget/` | 同上 |

**budget settings 的指名**：=queue.json.budget（pointsLimit/wallLimitMs/notes/pointsStoppedAck）。**不是** loop runtime.json 的 drive 预算（`lzy loop budget`）——两套同名预算分属不同家族，本迁移只碰前者。

**不迁移**（保留文件与语义，P2 只做协调与恢复面适配）：goal/DAG/attempt/runtime/授权（authorizations）/交付意图/证据/转录/候选快照/`.lazyzcode/loop/**` 全部；宿主 ZCode `db.sqlite`（lzy 只读查询，不改 schema）；全局 `lzy-usage/*.jsonl`（观测面，P0 已修，不承诺与工作区 DB 跨库原子）。

SQLite 不改变 OS 沙盒边界，不等于供应商余额，不能把逐段消费检测变成严格积分硬切；模型请求/进程/Git/远端交付不属于数据库事务。

## 2. 运行时地板与操作纪律（拍板 2026-10-16）

- **最低运行时＝Node ≥24.0.0**；22 线不入支持面（实证：22.12 及以下无 node:sqlite；22.13 起模块可用但构造器 `{timeout}` 被静默忽略、每次进程加载打一条 experimental 告警；24.0.0 全探针通过）。P2 实测复核（r2-F2）：22.12.0/22.13.0/24.19.0 三运行时钩子读面实跑原始输出在档 `artifacts/p2-baseline/out-n6check/probe-node22-hook.txt`——22.12/22.13 零记录+具名诊断 exit 0（诊断文案=「低于地板 ≥24.0.0」），24.19 正常记录一条；实测与本文及 ADR-0039 文本相符（地板拍板不动）。engines 字段与安装文案的机制收紧随 P3 切换窗口落地（切换前 JSON 面现行 ≥22 全额可用，不做虚假收窄）；运行时能力探针（`scripts/sqlite-capability-probe.mjs`）在 DB 面拒启非法环境并具名诊断。
- **只用 SQL 层操作**：`PRAGMA journal_mode`/`busy_timeout`/`integrity_check`、`VACUUM INTO`、纯 SQL 事务。构造器选项**唯一例外**＝`{readOnly:true}`（经探针矩阵验证：只读打开成功、写尝试必败）；其余构造器选项与高阶 API 不用（跨版本行为面未穷举）。
- **结构性不嵌套（P2 N1 落实）**：每个存储操作恰一个顶层事务，多写面在同一事务内展开；不用 `db.isTransaction` 之类高阶属性窥探事务态——既有事务在途时再开操作＝SQLite 拒（包为具名 `StatedbError`，不静默加入/不静默降级）。`busy_timeout=5000` 全连接统一（含 readOnly——P1 原型 1000 为临时偏差，已消除）。
- **零新增根依赖**：只用内建 `node:sqlite`；不引 ORM/服务进程/驱动包。

## 3. schema（DDL 定案）

```sql
CREATE TABLE meta (            -- schema_version=1 / writer_version=<lzy 版本> / backend（P3 切换窗口写）
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE queue_items (
  id TEXT PRIMARY KEY,
  goal_slug TEXT NOT NULL,
  contract_hash TEXT NOT NULL,             -- 64 hex（形状门同现行 r1）
  endpoint TEXT NOT NULL CHECK (endpoint IN ('A','B','C')),
  state TEXT NOT NULL CHECK (state IN ('proposed','authorized','ready','running','completed','blocked','failed','cancelled')),
  created_at TEXT NOT NULL,                -- TEXT ISO（现行同形）
  updated_at TEXT NOT NULL,
  title TEXT NOT NULL,
  contract_path TEXT NOT NULL,
  plan_path TEXT NOT NULL,
  blocked_reason TEXT,
  completed_endpoint TEXT,
  tier TEXT,                               -- light|heavy（可空=旧 item 兼容）
  risk TEXT,                               -- low|med|high|restricted（可空）
  seq INTEGER,                             -- 入队序（addQueueItem 分配 q.items.length+1；id 亦由它导出；派发 FIFO 排序键 queue.js:1099）
  plan_hash TEXT,                          -- HEAVY 派发前比对（queue.js:941-949）
  deps_json TEXT NOT NULL,                 -- string[] 原样 JSON
  delivery_json TEXT,                      -- {B:{path,hash},C?:…} 原样 JSON（端点-交付矩阵在写侧校验，同现行）
  plan_review_json TEXT                    -- 入队前评审记录原样 JSON（可空）
);

CREATE TABLE queue_budget (    -- 单行
  id INTEGER PRIMARY KEY CHECK (id = 1),
  points_limit REAL,                       -- NULL=未设
  wall_limit_ms INTEGER,
  notes_json TEXT NOT NULL,                -- [{at,note}] 追加式
  ack_json TEXT                            -- {at,ackSeq,note}（--resume-points）
);

CREATE TABLE dispatch_txs (
  tx_id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL,
  goal_slug TEXT NOT NULL,
  phase TEXT NOT NULL CHECK (phase IN ('open','settled','killed','reconciled-orphan')),
  opened_at TEXT NOT NULL,
  settled_at TEXT,
  limits_json TEXT NOT NULL,               -- {wallMs,points}=占用登记上限（崩溃未决按此保守计入）
  delivering_since_ms INTEGER,             -- 交付在途存活核/墙钟（queue.js:823-827/:976/:1235/:1260）
  delivering_pid INTEGER,
  note TEXT
);

CREATE TABLE dispatch_segments (
  tx_id TEXT NOT NULL REFERENCES dispatch_txs(tx_id),
  seg_index INTEGER NOT NULL,
  session_id TEXT,
  duration_ms INTEGER NOT NULL,
  extra_json TEXT,
  PRIMARY KEY (tx_id, seg_index)
);

CREATE TABLE budget_events (
  seq INTEGER PRIMARY KEY,                 -- 显式分配：事务内 MAX(seq)+1（稠密单调，对齐现行 entries.length+1；不依赖 AUTOINCREMENT）
  at TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('wall','points','metering-absent','killed-inflight','overrun','review')),
  authorization_json TEXT NOT NULL,        -- {slug, contractHash}
  provenance TEXT,
  item_id TEXT, tx_id TEXT, session_id TEXT,
  ms INTEGER,
  points REAL,                             -- IEEE754 双精度，与 JS number 同位
  overrun_points REAL,                     -- overrun 条目的超额解释字段（不入消费累计）
  note TEXT,
  dedup_key TEXT NOT NULL UNIQUE           -- 判重唯一键（UNIQUE 冲突→duplicate no-op，errcode 1555 判别）
);
CREATE INDEX idx_dispatch_txs_phase ON dispatch_txs(phase);
CREATE INDEX idx_queue_items_state ON queue_items(state);
```

嵌套载荷（deps/delivery/plan_review/limits/notes/ack/authorization）以 JSON 文本**逐字保形**——读面零转换，迁移零语义变换；仅查询/唯一性/排序所用字段列化（上表）。

**数值表示**：points/overrun_points=REAL；ms/wall_limit_ms=INTEGER；seq=显式 INTEGER；时刻=TEXT ISO（与现行 JSON 面同形）；tokens 不入本库（全局观测面职责，沿 `lzy-usage` 单列）。

## 4. 语义对账表（现行 symbol → DB 对应物 → 差异）

| 现行（core/queue.js） | DB 对应物 | 差异声明 |
|---|---|---|
| `appendLedgerEntry`（:620-639）扫描去重 + 整本重写 | 事务内 `INSERT` + `dedup_key UNIQUE`（冲突=errcode 1555→`{duplicate:true}`）+ `seq=MAX(seq)+1` | 无差异（判重语义等价；写代价从 O(n) 重写降为 O(1) 插入） |
| `budgetView`（:298-349）聚合 | `readBudgetAggregate`：wall/points/review 三轴求和；overrun 排除；open tx 的 limits 保守计入；stopKinds 按 `seq > ackSeq` 过滤；overrunPoints 派生 `max(0,points−limit)`（:331）；remaining/exhausted 公式逐字同 | 无差异（读面字段名与语义冻结） |
| `settleTxLedger`（:650-701）U 族入账 | 结算事务：逐段 wall 恒入；metering-absent（缺行/未计价两族）；points；overrun 派生（事务内读聚合） | 无差异（逐段序=seg_index 序） |
| `setQueueBudget`（:552-576）+ `--resume-points`（:567-571） | `queue_budget` 单行 + `ack_json={at,ackSeq=max(seq),note}` | 无差异（confirmment 只豁免 seq≤ackSeq，不看时戳） |
| `openTx`（:596-609）→ dispatch 写入 → item 置 running | 占用事务：`INSERT dispatch_txs(open)` + `UPDATE queue_items→running` 一次提交 | 差异：现行跨两次文件写（有撕裂窗）；DB 事务消除——这是迁移收益本体 |
| `patchTx`（:611-618） | `UPDATE dispatch_txs` | 无差异 |
| `reconcileDispatch`（:752-920）恢复判定表 | 事务化后同判定表逻辑（判定读面从 DB） | 逻辑无差异；写序见 §5 |
| `queue_items.*` 全列（含 seq/planHash/delivering_*） | 上表逐列 | 无差异（seq=入队序、plan_hash=HEAVY 比对、delivering_*=存活核，四处出处见 §3 注） |
| 家族读三层闸（:64-90：errno/JSON/校验和/版本/形状） | `openStore`：文件级错误判别 + `schema_version` 校验 + 写侧形状门（列约束/CHECK） | 差异：JSON 校验和→DB 内建页校验与 CHECK；"版本读侧放宽数组"语义取消（DB 单一代 schema_version=1，未来只增不改） |
| `withLock`（loop.js:259-327）目录锁 | 保留，作为跨存储协调锁（§5） | 无差异 |

## 5. 锁序与事务纪律（冻结）

- **单向锁序：withLock（目录锁 `.lazyzcode/loop/.lock`）→ 单一 DB 事务**。事务内禁取目录锁、禁网络、禁 spawn、禁长等待——外部动作（模型段、Git、远端）全部在事务外，提交后启动。
- **busy 策略**：连接打开即 `PRAGMA busy_timeout=5000`（SQL 层；地板实证唯一可靠面）；超时=具名 `StatedbBusyError`（errcode 5），不无限重试、不静默降级；写事务短小化（不把读聚合、判定、外部等待拉进写事务）。
- **两处核心事务**（P2 实施）：①派发占用=登记 tx(open)+item→running 一次提交；②结算=逐段事件+tx settled+item 应达态一次提交（保留失败回 ready 的现行恢复路径）。
- **P2 输入（现行撕裂窗清单，须逐一事务化）**：`runQueueDispatch` 四处锁外写（queue.js:1143、:1190、:1202-1203、:1235）；写序不一致（reconcile 尾写 queue:916 vs abortDelivery 首写 queue:966）——事务化后写序问题消解，但锁内/锁外归属须逐点定案。

**P2 锁内/锁外归属定案（2026-10-17，goal p2-sqlite-tx#N3；DB 后端）**：①派发占用=门序锁内**单事务**{insert tx(open)+item→running(+updated_at)}（提交后才进入 goal 生命周期与 drive——外部动作在事务提交后启动）；②槽位冲突分支（现行 :1143 锁外 patchTx + :1144 锁内 saveQueue）=并入既有相邻 withLock 的**单事务**{tx→reconciled-orphan+item→failed}（dispatch 写从锁外挪进锁内——不新增无锁 queue_items 写）；③drive 后段记录（:1190）=保持锁外**单事务**{段行整体替换}；④drive 失败路径（现行 :1194 锁内 saveQueue + 锁外 :1202-1203 patchTx/settleTxLedger）=并入既有相邻 withLock 的**单事务**{item→failed〔含 refreshStates 级联全量队列〕+逐段事件+tx→settled}；⑤交付在途标记（:1235）=保持锁外**单事务**，提交后才进交付链。写序：reconcile 尾写（:916）与 abortDelivery 首写（:966）各自独立事务、原子性消解——**无需统一写序**。JSON 后端各点原路径逐字不动。

## 6. WAL、备份与恢复

- **打开即校验**：`PRAGMA journal_mode=WAL` 后**回读**；≠wal＝拒绝进入 DB 模式（具名诊断，不静默降级到 delete 模式）。不支持 WAL 的文件系统（网络盘等）按拒启处理——P4 平台面验证前不承诺替代策略。
- **备份＝`VACUUM INTO` + `PRAGMA integrity_check`**（能力矩阵实证通过）；**不复制主文件冒充 WAL 一致快照**（WAL 未 checkpoint 时主文件是旧快照）。
- 崩溃恢复由 SQLite 内建承担：kill -9 于写事务中→已提交在、未提交无、integrity ok（实证）；未决占用=phase open 的 tx 持续可见、按 limits 保守计入（绝不当零）。

## 7. 迁移提交点与 journal 协议（P3 实施，本文件成文）

1. 确认无活跃派发/评审/写入者；取迁移协调锁并冻结写入。
2. 备份相关旧状态（journal 登记源指纹与恢复信息；journal/提交点协议形态沿 ADR-0029 迁移机器先例）。
3. 导入临时库：核旧文件版本/形状/关联身份与事件唯一性；保留历史 seq/ack/限额/授权引用/已知消费与未知状态（不把未知改写成零或完整）。
4. 逐项语义对账 + `integrity_check`；发现重复身份冲突/损坏/不可解释差额即停，不静默合并。
5. **提交点＝backend 标记最后写**（meta.backend），此前所有步骤可重入；文件标记与 DB 无跨资源事务，中断重入以 journal 保证幂等。
6. 切换后 DB 是唯一权威；旧 JSON 保留只作备份/导出；DB 缺失/损坏/读取失败**不回落到旧 JSON** 继续派发或批准。
7. `update/sync` 永不自动迁移；迁移是显式用户动作。

**P3 实施定案（2026-10-23，goal p3-sqlite-switch；实现=`core/sqlite-migrate.js` + `core/statedb.js` marker/指纹原语 + cli `migrate sqlite`）**：

1. **新工作区姿态=JSON 起步**：生产零自动建库（迁移=显式用户动作）；空/部分族工作区可显式迁移（缺家族=空族合法导入，loadFamilyFile ENOENT=null 现成语义）。
2. **读向闸=库外 marker**（`.lazyzcode/state.backend.json`，`{backend:"sqlite",format:1,migratedAt,writerVersion}`）：marker 在场=迁移已做 → DB 必须（core 库缺席/不可读=具名拒不回落；钩子零记录+具名诊断+exit 0）；marker 缺席=迁移未做 → P2 判据逐字。**marker 损坏=当迁移态处理**（库在场照读 DB、库缺席具名拒）——marker 只在「库缺席」时有判别意义，健康库永不被损坏侧车挡住（core 与钩子口径一致）。「非工作区／迁移未做／迁移已做」三分可判（§12 交接清单 7 收口）。
3. **提交点序=install→marker→meta.backend 最后写**：install（staged close 后同卷原子 rename）→ 写 marker（读向翻转）→ 写 `meta.backend`+`writer_version`+`meta.json_frozen`（最后写=提交点，§7.5）。install→marker 窗口=P2 判据已认库且内容为忠实导入，语义安全；marker→meta.backend 窗口=读向已翻、resume 按相位补提交点。两窗口均被 journal 相位覆盖，重入幂等。
4. **备份语义**：三族=文件复制到 `.lazyzcode/migration/sqlite/<runId>/backup/` + manifest 逐文件 sha256 + install 前源漂移双读校验（漂移=停）；**VACUUM INTO 不入迁移路径**（迁移前无库可 VACUUM——§12-2「§6 路线」的 reading 如实记档：staged 库以 integrity_check 为导入门禁，VACUUM INTO 仍专属 backupTo 运维面）；迁移不改写不删除源 JSON（前向单向）。
5. **命令面**：`lzy migrate sqlite <根路径>`（根路径显式，沿 cmdMigrate 家法）；单命令无 preview（对账内建于 apply）；重跑语义=未收尾 journal→断点续跑（幂等）、已收尾且库在场→具名拒（已迁移）；前置拒绝=活跃 tx（open/delivering）或 running 条目（§7.1 冻结写入）+ withLock 整段。journal=`migration/sqlite/journal/<runId>.jsonl`（七相位），与 ADR-0029 机器（state.json 版本入口）互不相涉。
6. **旧状态误写检测**：提交时三族冻结指纹落 `meta.json_frozen`（在场=sha256、缺席=null）；`reconcileDispatch` withLock 锁内首行预检（runQueueDispatch 首动作即 reconcile，单点覆盖双入口）；任一族「在场但 sha≠冻结」=具名拒（恢复/删除/核对三路指路），缺席=不违例；meta.json_frozen 缺席（P2 时代库工作区、夹具）=no-op；JSON 态不检（逐字零变更）。**P4 增补（r3-F3，2026-10-23）**：违例判据统一为「now 在场 ∧ sha≠冻结指纹」——冻结时缺席（frozen=null）、迁移后出现的族（旧版 CLI 误写/异物拷入）与改写同责=违例；「缺席=不违例」读向不变（冻结后在场的族被删除仍不违例）。
7. **openDb 缺表库保留**（r6-F2；2026-10-30 CI 基线修复）：库在场却缺表时关闭句柄、保留文件并具名拒绝，不回落 JSON。旧实现将 stat 缺席与 birthtime 判据按 OR 组合，且文件系统创建时间与进程时钟不能证明文件归属；时钟偏差可造成预存库被误删。移除读路径的推断式 unlink，即使检查后消失、SQLite 重建出缺表库也保留待人工核对。契约腿⑤保留原断言并新增时钟偏差反例；实际 runner 验收见 CI 基线报告。

## 8. 版本冲突与回退姿态

- **前向单向**：不提供反向导出；**不支持自动回退**（切换后已有新写入时，恢复旧备份会丢新账——明示不支持）。
- `meta.writer_version` 记录写入者版本；旧 CLI 改写 JSON 的检测机制属 P3 设计面（本文件只冻结姿态与字段位）。
- 不承诺在同一用户权限下强制阻止任意旧二进制写文件；切换后检测到旧状态误写＝阻断新版继续派发并提示核对。

## 9. 观察面适配边界（#46 只增不改）

- `status`/`doctor --json`：信封 `{schemaVersion,command,ok,checks[{name,state,detail}]}` 与检查三元组形状冻结；现状 **queue 族无任何结构化字段**（status 不 import queue.js；doctor 仅 drive 行内嵌评审分/预算读数、state 行统计 `.tmp` 孤儿）——后端切换不得使既有行开始抛错；允许新增检查行。
- 文本读面（P1 零变更基线采集对象）：`lzy queue list`（汇总行+条目行）、`lzy queue show`（item 原样 JSON+事务账+就绪判定）、`lzy queue budget`（字段清单=queue.js:338-348 全量）——字段与文案只增不改。
- 钩子读路径改造（DB 源）与版本检查归属：P2/P3 接线面；P1 只证可行（§10）。

## 10. 钩子权威读路径（冻结形态）

- 形态：**自包含内联读器**（不 import core——现行钩子家法），`{readOnly:true}` 打开，读面等价 `queueDeliveryVerdict`（全七支：approve/void/refuse-multi/candidates-no-match/write-failed/unreadable/none）。
- `schema_version` 不识别＝当不可读；库不可读/损坏＝**零记录 + 具名诊断 + 不阻断会话**（fail-open 家族纪律）；授权门由「没写批准记录」保持关闭（与现行语义同构，非钩子显式阻断）。
- **版本/形状门归属（P2 N6④ 落定）**：DB 分支实现 schema_version 校验（异版本=当不可读）+ 行级形状门（id/state/delivery_json 坏行=整面当不可读，fail-closed）+ 地板探针（major≥24 先于 require——22.13+ 模块在而不在支持面与 core runtimeSupport 口径一致；模块缺席=require 抛同落具名诊断）；JSON 分支维持现状（checksum-only，不校验 queueVersion——本批零变更，§12-6 的归属就此闭合）。库在场判据同 core（`state.sqlite` 存在性）；**库在场即 DB 权威，失败支不回落旧 JSON 批准**（零记录+具名诊断+exit 0，22.12/22.13/24.19 三运行时实跑取证在 artifacts/p2-baseline/out-n6check/probe-node22-hook.txt）。
- 批准记录唯一写者不变（r4-F1）：UPS 钩子写 `.lazyzcode/authorizations/`、形状不变；DB 分支只读不写。
- P1 可行性证据：`scripts/p1-sqlite-pilot/hook-reader.mjs` 原型 + stdin 驱动契约测试（A/B 对照真 trigger.js）；P2 已生产接线（trigger.js 双后端：无库=JSON 路径逐字不变，库在场=DB 只读读面，`createRequire` 同步取 `node:sqlite` 不引入 async），pilot reader 面退役为历史档案。

## 11. 九项冻结表（P1 出口）

| # | 冻结项 | 定案 | 依据/出处 |
|---|---|---|---|
| F1 | 真实源事件身份 | 承接声明=**事件身份语义沿用 P0**（project/runId/来源水位落全局用量账单列，不在本库）；本库只落三族、**DDL 不含 project/runId/水位列**——判重唯一=dedup_key（UNIQUE 冲突=duplicate no-op，含评审行 instance 摘要/内容指纹沿 P0 语义的组成）；历史缺口保留不改写（r2-F1 文书修订 2026-10-18：原「DB 落列」表述与 §1 范围表自相矛盾，就此对齐） | P0 已实施（p0-ledger-fix）；本库承接=判重语义（§3/§4） |
| F2 | schema 与数值表示 | §3（五表+meta；REAL/INTEGER/TEXT-ISO；dedup_key UNIQUE；seq 显式） | 本文件 §3/§4 |
| F3 | 最低运行时 | Node ≥24.0.0 + 运行时探针拒启；engines 收紧随 P3 窗口 | ADR-0039；能力矩阵 |
| F4 | 钩子权威读路径 | §10（自包含只读读器；不可读=零记录门关闭） | hook-failopen 先例；P1 原型证据 |
| F5 | 锁顺序 | §5（withLock→事务单向；事务内禁锁/网络/spawn） | plan §4 明文 |
| F6 | busy 策略 | §5（`PRAGMA busy_timeout=5000`；具名 StatedbBusyError；不无限重试） | 地板实证 |
| F7 | 备份/WAL 支持环境 | §6（WAL 回读校验拒降级；VACUUM INTO+integrity；不冒充快照） | 能力矩阵实证 |
| F8 | 迁移提交点 | §7（journal+备份→导入→对账→原子安装→backend 标记最后写=提交点） | ADR-0029 先例 |
| F9 | 版本冲突与回退能力 | §8（前向单向；writer_version；不支持自动回退明示） | plan §6 明文姿态 |

## 12. 后续实施面（非本批）与 P1→P2 交接注记

**P1→P2 交接清单（P1 侦察实证，P2 逐条消费）**：
1. **锁外写四点（须事务化）**：`runQueueDispatch` 内 core/queue.js:1143（槽位冲突 patchTx）、:1190（drive 后 segments patchTx）、:1202-1203（失败路径 saveQueue+patchTx+settleTxLedger）、:1235（交付在途标记 patchTx）——现行跨文件写在这些点存在撕裂窗（§5）。
2. **写序不一致**：`reconcileDispatch` 尾写 queue（queue.js:916）vs `abortDelivery` 首写 queue（queue.js:966）——事务化消解写序问题，锁内/锁外归属须逐点定案（§5）。
3. **夹具重建清单（按后端）**：test/ 八件=queue-state、budget-ledger、queue-metering、queue-delivery、dispatch-recovery、unified-gate、delivery-hook（混合真 CLI 驱动）、review-findings（经 core 间接写 ledger）；scripts/ 侧 v031（evidence-probe.sh、closeout-qa.mjs、queue-bridge-e2e.mjs）与 v040（qa.mjs 的 sha256 字节保留断言、m1-gate-harness.mjs）；ablation 族的 ledger.jsonl 与本三件无关（勿混改）。
4. **checksumOf 六份逐字复制面**（core/delivery.js:53、core/runtime.js:41、core/verify.js:33、core/dag.js:28、core/attempt.js:27 + trigger.js:66 内联第七份）——「逐字同源」只是注释约定；存储契约单源化时这是现成漂移面清单（本批不动）。
5. **迁移机器（core/migrate.js）的 BACKUP_FAMILIES 不含三族**（只含 loop/goal.json、approvals、snapshots、salvage、attestations、evidence、plans）——P3 迁移的备份语义需新设计，不能复用 v040 QA 的「迁移前后 sha256 不变」断言（那是「不碰」证明，非备份机制）。
6. **trigger.js 不校验 queueVersion**（只校验 checksum；core 有版本闸）——钩子权威读路径改造时须补版本/形状门归属（§10）。
7. **hook 读面在 DB 缺席时的分支**：「非工作区」与「迁移未做」须区分（P3 接线设计面，P1 原型把库缺席当落回信号）。

**P1 评审发现处置表（P2 N8 落档 2026-10-18；八条全非阻塞，逐条处置面引用可核）**：

| 发现 | 等级 | 处置 | 落点 |
|---|---|---|---|
| r2-F1（§11 F1 行与 §1 范围表自相矛盾） | 非阻塞 | F1 行文书修订：明示「承接声明=事件身份语义沿用 P0（全局用量账单列），本库只落三族、DDL 不含 project/runId/水位列」 | 本文件 §11 F1 行（2026-10-18 修订） |
| r2-F2（地板依据证据缺口） | 非阻塞 | 22.12.0/22.13.0/24.19.0 三运行时实跑原始输出入档；实测与 ADR 文本相符，地板拍板不动 | 本文件 §2 指针；`artifacts/p2-baseline/out-n6check/probe-node22-hook.txt` |
| r2-F3（测试断言强度） | 非阻塞 | N6⑥ 落：全失败分支 exit 码断言 + write-failed「authDir 可读不可写」真实构造（POSIX chmod 555；win32 具名 skip 记档） | `test/statedb-readers.contract.test.js` |
| r2-F4（isTransaction 白名单+readOnly timeout） | 非阻塞 | N1 落：结构性不嵌套（不用高阶事务窥探）+ busy_timeout=5000 全连接统一（含 readOnly） | 本文件 §2 |
| r3-F1（package.surface 隐式依赖外层 git 树） | 非阻塞 | 加「无 .git 具名 skip」守卫；有 .git 时断言不弱化 | `test/package.surface.test.js` git 残留断言 |
| r3-F2（backup-replay 不在回路） | 非阻塞 | N7④ 落：重写指向 `core/statedb.js` + 纳入契约测试回路（⑩ 电路腿） | `scripts/backup-replay.mjs` + `test/statedb.contract.test.js` |
| r4-F1（pilot 原型写生产形状/单写者纪律） | 非阻塞 | N6⑤ 落：生产读器只读不写；批准记录唯一写者不变 | 本文件 §10；`plugin/hooks/trigger.js` DB 分支 |
| r4-F2（backup-replay 破坏性） | 非阻塞 | N7④ 落：目标目录已存在 state.sqlite 时拒绝（exit 2）+ 用法行明示覆盖面 | `scripts/backup-replay.mjs` 守卫段 |

**P2→P3 交接注记（P2 收官 2026-10-18，goal p2-sqlite-tx）**：

- **P2 已实施面**（无库工作区逐字零变更；不建库、不迁移、不发版）：存储层 `core/statedb.js`（五表 DDL+单事务操作面+五面契约测试）；双后端 seam `stateBackend`/`backendCall`（库在场判据=`state.sqlite` 存在且可读且 `meta.schema_version=1`，库在场即 DB 权威绝不回落 JSON）；两核心事务（占用单事务、结算单事务含级联视图 `readBudgetAggregate({excludeTxId})`→`refreshStates(view)` 等价补偿）+ 派发四点锁外写事务化（§5 定案五点）+ reconcile/abortDelivery 写点；CLI 六访问器与 review 三调用点 DB 化；钩子权威读路径 DB 分支（只读、失败不回落，§10）；八件测试双后端参数化 + scripts 五件适配 + backup-replay 回路。
- **P3 输入面**：
  1. **meta.backend 提交点语义**：P2 从不写 `meta.backend`（仅 `writer_version` 随写更新；backend 判定用文件在场判据）——§7.5「backend 标记最后写=提交点」的写入者是 P3 迁移机器，其与库在场判据的衔接（标记先行还是文件先行、并存歧义期读向）是 P3 定案面。
  2. **迁移机器不受本批影响面**：`core/migrate.js` BACKUP_FAMILIES 不含三族（交接清单 5）——P3 备份语义需新设计（§6 VACUUM INTO+integrity_check 路线），不能复用「迁移前后 sha256 不变」断言（那是「不碰」证明）；迁移导入的形状核对面=P2 的 `ensureSchema`/`schema_version` 已定 DDL。
  3. **JSON 分支现行门现状**：checksum-only（不校验 queueVersion）保持零变更（§10 归属闭合句）——P3 切换窗口若给 JSON 面加版本闸属新语义变更，须走契约与评审流程，不得搭车。
  4. **engines 收紧窗口**：P2 维持 `package.json` engines 不动（JSON 面 ≥22 现行承诺不变）；机制收紧随 P3 切换窗口一次性落（§2/§11-F3）；钩子侧 major≥24 地板探针已在 P2 先行（库在场才生效，无库工作区不受影响）。
  5. **夹具/脚本面**：八件参数化（`KINDS=["json","sqlite"]` 循环）与 scripts 五件适配随 P3 全量切换须再核对（届时 DB kind 或转为主断言体，JSON kind 收缩为迁移回放面）；P2 证据面=`artifacts/p2-baseline/`。

**P2→P3 交接注记五条输入面的 P3 定案指针（2026-10-23 落定）**：①meta.backend 提交点语义→§7 增补定案 3（install→marker→meta.backend 最后写；P2 从不写 meta.backend 的遗留就此收口）；②迁移机器备份语义→§7 增补定案 4（三族文件复制+双读校验；VACUUM INTO 不入迁移路径的 reading 如实记档）；③JSON 分支现行门→维持 checksum-only 零变更（交接注记 3 的「若加版本闸须走契约评审」未触发——误写检测走 meta.json_frozen 独立面，JSON 兜底不加闸）；④engines 收紧→已随 P3 窗口一次性落（package.json ≥24.0.0 + NODE_MAJOR_FLOOR 24 + CI 去 22 腿 + 文案 20 位点；钩子侧 major≥24 探针 P2 先行者就此全面接齐）；⑤夹具/脚本面→八件 KINDS 双 kind 维持（未迁移 JSON 态与已迁移 DB 态均为 P3 后合法运行态，「DB 转主断言体」不做的 rationale：两态皆是运行态，翻转无收益；Node<24 具名 skip 化=r8-F1）；scripts 夹具驱动三件 git 零变更锚定。

**P3 已实施面（无未迁移工作区行为变更；不发版）**：迁移机器 `core/sqlite-migrate.js`（七相位 journal+备份双读+canonical 对账+漂移双读+三类具名拒+stopAfterPhase 测试钩子）；`core/statedb.js` 增 marker 原语（readBackendMarker/writeBackendMarker）与冻结指纹原语（json_frozen/assertNoJsonMiswrite/JSON_FAMILIES）；`core/queue.js` 读向闸（stateBackend/backendCall markerState 前置）+openDb 双信号修复+误写检测接入 reconcileDispatch 首行；`plugin/hooks/trigger.js` 内联 marker 三分支；doctor `sqlite-store` 检查行（#46 新增行）；cli `migrate sqlite`；engines 收紧；契约测试 `test/sqlite-migrate.contract.test.js` 11 腿（P2 八件双 kind 维持+具名 skip 化）。

**P2 评审 P3 处置表（r6/r7/r8 五条非阻塞，2026-10-23 逐条落定）**：

| 发现 | 处置 | 落点 |
|---|---|---|
| r6-F1（结算级联时点双后端不同序） | 记档无代码改动：单权威切换后已迁移工作区仅 DB 路径在跑，时点分歧不可达；未迁移工作区=纯 JSON（P2 行为不变）——分歧仅存于「同场景双后端对照」这一测试构造内 | 本行（§12）；contract 双 kind 等价腿持续兜底 |
| r6-F2（openDb 判据非原子） | 2026-10-30 修正：移除基于时间戳和 stat 的推断式 unlink；在场缺表库保留并具名拒绝。原安全断言＋时钟偏差回归 | §7 增补定案 7；`core/queue.js` openDb；contract 腿⑤ |
| r7-F1（backupTo 拼接守卫） | 记档：迁移机器不新增 VACUUM INTO 用户路径（备份=三族文件复制，§7 增补定案 4）；backupTo 单引号守卫原样保留，现调用方仍仅 scripts/测试 | 本行（§12）；`core/statedb.js` backupTo 未动 |
| r8-F1（Node<24 八件 [sqlite] 腿静默缺席） | 已修：八件 [sqlite] 腿恒在+<24 具名 skip（文案含地板依据；Node 22.23.1 实测 skipped=13 带因） | `test/`八件 KINDS 块；F7 红绿双面在 artifacts/p3-baseline/ |
| r8-F2（evidence-probe.sh 硬编码路径） | 已修：`REPO="${LZY_PROBE_REPO:-…}"` 覆盖缝；姊妹件 evidence-probe-f6.sh 同款留档不改（不在 P3 scope） | `scripts/v031/evidence-probe.sh`；本行记档 |

**P3 评审 P4 处置表（r3/r4 七条非阻塞，2026-10-23 goal p4-sqlite-release 逐条落定）**：

| 发现 | 处置 | 落点 |
|---|---|---|
| r3-F1（迁移机微窗 kill 重入死路：rename→journal(install) 窗内重入 openStore 伪空库） | 已修：重入判据改锚 journal 相位（reconcile done∧install 缺席∧最终库在场=install 物理已完成）→integrity+counts 交叉核对后补相位续跑；伪空 staged 预损态同判据自愈 | `core/sqlite-migrate.js`（b56acda）；contract 腿⑬ |
| r3-F2（钩子 marker 形状门与 core 口径分歧：parse 成功但形状不识别回落 JSON 批准） | 已修：形状不识别=当迁移态处理，落「迁移已完成而库缺席」具名诊断支（零记录+exit 0）；parse 失败面钉住 fail-closed | `plugin/hooks/trigger.js`（9e0eba0）；contract 腿⑭ |
| r3-F3（误写检测漏 frozen=null 族） | 已修＋语义定案：违例判据统一「now 在场 ∧ sha≠冻结指纹」，冻结时缺席迁移后出现=违例（§7 定案 6 增补随批落） | `core/statedb.js`（aa01e5e）；contract 腿⑫续段；§7 定案 6 增补 |
| r3-F4（doctor marker 归因折叠：marker 损坏＋库健康误报库不可读） | 已修：marker parse 独立 try；损坏+库健康=warn 具名文案「读向标记损坏——当迁移态处理」，库不可读才 fail 且归因库 | `core/doctor.js`（0a014e2）；`test/doctor-sqlite-store.contract.test.js` |
| r4-F1/F2（evidence-probe.sh PATH 硬编码＋管道吞退出码） | 已修：PATH 注入缝 `LZY_PROBE_NODE_HOME`＋`set -o pipefail`+`BRIDGE_EXIT` 显式记账 | `scripts/v031/evidence-probe.sh`（f540f18）；实跑腿档案 |
| r4-F3（tier1-unattended 断言隐式依赖宿主 TZ） | 已修：模块顶钉 `process.env.TZ`（任何 Date 使用前；CI TZ env 保留双保险） | `test/tier1-unattended.contract.test.js`（7c9d9bf）；红绿档 n6 |
| 同族点：evidence-probe-f6.sh（P3 留档）/v030-m1-gate-repro.sh:31（实有 PIPESTATUS，残余仅 \| head SIGPIPE 形态）/ablation t4 verdict（冻结取证材料族） | 记档不接（理由见 P4 计划 N5 处置表） | 本行 |

**P4 已实施面（goal p4-sqlite-release，2026-10-23）**：七条处置如上表全落；macOS 宿主真实 CLI 电池 29/29（§7 清单①-⑦：派发 kill/恢复/重复 reconcile 零新账、并发恰一占用、迁移微窗/漂移/损坏重入、钩子四路、reset 预算保留、backup-replay+守卫、引擎 0.17.0 包封归一+7 事件面；原始件 artifacts/p4-baseline/s1-s7）；win32 VM（Windows 11 aarch64）电池 10/10（node 22→24.19.0 就地升、tarball 安装、NTFS 迁移全链、预算写读回、WAL 打开期在场/关闭收敛/integrity ok、钩子三腿、doctor sqlite-store；原始件 artifacts/p4-baseline/win32/leg0-6）；0.6.0 定版冻结（五处版本位+provenance 三体一致+全量 962/962+pack 白名单净）。记档不阻塞：backup-replay 同目录重跑在 VACUUM INTO 处 exit 1（守卫仅认 state.sqlite，dev 脚本 wart）；headless-review-lifecycle:87 满载一次性时序 flake（P4 零改动文件，复跑 3 次全绿）。

**P2**：已实施（见上「P2→P3 交接注记」；设计依据 §3–§5，出口=九项冻结表逐项可核 + P1 八发现全处置）。**P3**：已实施（§7 增补定案 1–7；出口=显式迁移/核对/单权威切换全链可核 + P2 评审五备忘全处置；「切默认」语义=迁移翻转为该工作区唯一权威，新工作区仍 JSON 起步——§7 增补定案 1）。**P4**：已实施（上表七条处置全落 + §7 清单①-⑦ 平台电池双绿 + 0.6.0 定版发布；出口=「源码绑定证据、限制说明、独立审查与交接」逐项可核）。
