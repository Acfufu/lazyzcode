# 局部状态 SQLite 存储契约（P1 冻结）

日期：2026-10-16 · 状态：**P1 冻结（未发布任何机制；P2 依据本文件实现，P3 显式迁移）**
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

- **最低运行时＝Node ≥24.0.0**；22 线不入支持面（实证：22.12 及以下无 node:sqlite；22.13 起模块可用但构造器 `{timeout}` 被静默忽略、每次进程加载打一条 experimental 告警；24.0.0 全探针通过）。engines 字段与安装文案的机制收紧随 P3 切换窗口落地（切换前 JSON 面现行 ≥22 全额可用，不做虚假收窄）；运行时能力探针（`scripts/sqlite-capability-probe.mjs`）在 DB 面拒启非法环境并具名诊断。
- **只用 SQL 层操作**：`PRAGMA journal_mode`/`busy_timeout`/`integrity_check`、`VACUUM INTO`、纯 SQL 事务。构造器选项**唯一例外**＝`{readOnly:true}`（经探针矩阵验证：只读打开成功、写尝试必败）；其余构造器选项与高阶 API 不用（跨版本行为面未穷举）。
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

## 8. 版本冲突与回退姿态

- **前向单向**：不提供反向导出；**不支持自动回退**（切换后已有新写入时，恢复旧备份会丢新账——明示不支持）。
- `meta.writer_version` 记录写入者版本；旧 CLI 改写 JSON 的检测机制属 P3 设计面（本文件只冻结姿态与字段位）。
- 不承诺在同一用户权限下强制阻止任意旧二进制写文件；切换后检测到旧状态误写＝阻断新版继续派发并提示核对。

## 9. 观察面适配边界（#46 只增不改）

- `status`/`doctor --json`：信封 `{schemaVersion,command,ok,checks[{name,state,detail}]}` 与检查三元组形状冻结；现状 **queue 族无任何结构化字段**（status 不 import queue.js；doctor 仅 drive 行内嵌评审分/预算读数、state 行统计 `.tmp` 孤儿）——后端切换不得使既有行开始抛错；允许新增检查行。
- 文本读面（P1 零变更基线采集对象）：`lzy queue list`（汇总行+条目行）、`lzy queue show`（item 原样 JSON+事务账+就绪判定）、`lzy queue budget`（字段清单=queue.js:338-348 全量）——字段与文案只增不改。
- 钩子读路径改造（DB 源）与版本检查归属：P2/P3 接线面；P1 只证可行（§10）。

## 10. 钩子权威读路径（冻结形态）

- 形态：**自包含内联读器**（不 import core——现行钩子家法），`{readOnly:true}` 打开，读面等价 `queueDeliveryVerdict`（trigger.js:61-131 全七支：approve/void/refuse-multi/candidates-no-match/write-failed/unreadable/none）。
- `schema_version` 不识别＝当不可读；库不可读/损坏＝**零记录 + 具名诊断 + 不阻断会话**（fail-open 家族纪律）；授权门由「没写批准记录」保持关闭（与现行语义同构，非钩子显式阻断）。
- P1 可行性证据：`scripts/p1-sqlite-pilot/hook-reader.mjs` 原型 + stdin 驱动契约测试（A/B 对照真 trigger.js）；生产接线（trigger.js 改读 DB）属 P2/P3。

## 11. 九项冻结表（P1 出口）

| # | 冻结项 | 定案 | 依据/出处 |
|---|---|---|---|
| F1 | 真实源事件身份 | (project, runId, 来源水位) + 评审行 instance 摘要/内容指纹；DB 落列+唯一约束；历史缺口保留不改写 | P0 已实施（p0-ledger-fix），本库承接 |
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

**P2**：按 §3–§5 实现存储层并把 queue/review/CLI/钩子接线（仍不接管用户现有状态；夹具按上表重建）。**P3**：§7/§8 的显式迁移与单权威切换。**P4**：真实 CLI 平台面（含 win32 VM）与最低运行时验证。
