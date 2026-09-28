# 0.4.0 M4 报告：评审范围资格与适用解释（goal v040-m4-scope-qualification）

基线：M3 收口 245a7ec（22/22 · 对照 8/8 · 697/697）。本报告数=开发跑累计；终验跑（F1-F7 取证，
冻结树上）以 `docs/evidence/v040-m4/` 为准，本报告给出读数与指针。三条缺陷（计量缝 WAL、挑战夹具
符号链接、遗漏反例选路）均在本阶段内发现即修，红绿证据在案。

## 1. 交付面（13N 全落 + 2 条缺陷修复）

| 步 | 面 | 提交 |
|---|---|---|
| N1 | review-scope 家族（双 kind 形状闸 fail-closed / seq / 损坏拒）+ ANY_TMP_SCAN_DIRS 登记 + 声明验形 + 确定性分类器 + 关闭依据 stale 审计 | 929f066 |
| N2 | `lzy review qualify`（base 快照物化挑战夹具逐轴对表 oracle；granted/拒绝双面落档） | ce4642c |
| N3 | `lzy review reuse`（当前候选对 base 快照 diff → 分类完备 → 适用档）+ `lzy finding reopen` | e170965 |
| N4 | 三专项职责翻面（DUTY_TABLE_VERSION 3→4）+ 三模板 + 三套件 + deriveObligations 推导 | 9691795 |
| N5 | gate 复用合取（base 七合取 ∨ 复用腿）+ `closure-basis-stale` 子句 + doctor 行 | b36e453 |
| N6 | M3 输入缺陷批 F-3/F-4/F-6/F-7 + 围栏转义链修复 + drive 评审预算读数 | 81f1a25 |
| N7 | 契约测试 14 面（review-scope：形状/矩阵/双面/真值表/推导/退出码） | 2a189a6 |
| N8 | qa `--case scope-qualification`（15 断言，零真会话）+ 遗漏反例选路修复 | 6322339 |
| N9 | INV-08 红绿同源 harness（三判据） | dcaefeb |
| N10 | 三仓真实正反例驱动 + **计量缝 WAL 静寂回退**（缺陷 ①） | 779d607 / 1645918 |
| N13 | 根 .gitignore 增补 `.video_agent/` | a9fd299 |
| N12 | 文档收口（AGENTS §4 翻面 / decisions / CHANGELOG / guide 双语） | dee8afc |

测试基线：M3 收口 697/697 → N1-N9 时点 711/711 → N10 缺陷 ① 修复后 **714/714**。
规则内容冻结面：三条专项职责模板、三份 `.qualify.json` 套件、满足条件串。

## 2. 资格挑战矩阵与绿例（qa `--case scope-qualification`，15 断言全绿）

真随包套件十轴（`core/review-duties/review.verification-deps.qualify.json`）在夹具仓逐轴对表：
in-scope / canary-keep / missed-dependency / unknown-new / rename-delete / lockfile / check-script /
env / contract / duty。读数（exit 0 · granted=true · 10/10）：

- **三类改变对表**：声明内改变判失效（in-scope）、无关文件可保持（canary-keep）、遗漏反例判失效
  （missed-dependency）。
- **越界声明点名拒**：把依赖制品（`shared/**`）划 `unrelated` ⇒ missed-dependency 轴取该命中为
  遗漏反例注入，观察 `keep` ≠ oracle `invalidate` ⇒ **REJECTED 且点名 `keep @shared/dep-config.json`**
  （拒绝也落档；拒绝非终态——修正声明重领即 granted，同一夹具反向可复现）。
- **四拒逐因**（独立夹具、单路径提交式改变）：锁文件（声明的共享输入）→ `声明内/共享输入变化：
  package-lock.json`；check 脚本（声明内）→ `…：scripts/check.sh`；未知新文件 → `未知路径：
  stranger.txt`；环境轴（TZ 变体）→ `资格身份漂移：env`。四腿皆 fallback exit 1 且 diff 恰一条路径。
- **字节不变**：base 运行档与资格档 sha256 在所有复用判断前后不变（只追加）。
- **关闭依据全链**：替身阻塞运行落账 → resolve-request → 替身 recheck → close → 修复区再变化 ⇒
  gate `closure-basis-stale` 拦 → `finding reopen` → 复核重关 ⇒ gate 翻过（「曾关闭」事实保留）。

## 3. INV-08 红绿同源（`scripts/v040/m4-scope-harness.mjs`，八读数 × 两半）

| 判据 | 红半（245a7ec 冻结树） | 绿半（工作树） |
|---|---|---|
| D1 命令族 | qualify/reuse 规范用法名缺席；`finding reopen` 报未知子命令；专项运行 exit 3（职责不在表 v3） | 三命令在场（用法/域拒可辨）；专项运行 valid/metered/pass |
| D2 家族写入 | `.lazyzcode/review-scope/` 不在场（零写入） | granted 10/10 落档 + applicable 档绑 q1 + 未知路径逐因 fallback |
| D3 gate 复用腿 | 零复用字样，无该专项义务（C2 亦 PASS） | C1 门 PASS 且叙述引用适用档 id；C2 由复用不足因单独阻塞并点名 `stranger.txt` |

## 4. 三仓真实正反例（N10；逐腿判据=「正反例齐备 ∨ 如实阻塞行」，条目细则 R1/R3）

夹具=各仓冻结 HEAD 内容物化（`git archive <frozenSha>` → 新 git 仓；声明/计划/契约落 `.lazyzcode/`
不入候选）；真引擎会话计量入账。冻结 HEAD：lazyzcode `54cb376` / openchamber `63bd5070c` /
zpigeon-ios `08ebd3ea`。

| 仓 | base 运行 | 资格 | 复用（无关 / 声明内 / 未知） | 越界声明 | 字节不变 | 结论 |
|---|---|---|---|---|---|---|
| lazyzcode `54cb376` | valid · metered · pass（3.14 分） | granted 10/10 | applicable `docs/_config.yml` / fallback + 重评 valid metered pass（2.06 分）/ fallback 点名 | REJECTED（missed-dependency @`.claude-plugin/marketplace.json`） | base ✓ 资格档 ✓ | **齐备** |
| openchamber `63bd5070c` | valid · metered · pass（6.85 分） | granted 10/10 | applicable `docs/.gitkeep` / fallback + 重评 valid metered pass（6.05 分）/ fallback 点名 | REJECTED（missed-dependency @`.openchamber/project.json`） | base ✓ 资格档 ✓ | **齐备** |
| zpigeon-ios `08ebd3ea` | valid · metered · pass（0.88 分） | granted 10/10 | applicable `docs/adr/0001-…md` / fallback + 重评 valid metered pass（1.31 分）/ fallback 点名 | REJECTED 三轴（in-scope + missed-dependency + rename-delete @`ZPigeon/Assets.xcassets/AccentColor.colorset/Contents.json`） | base ✓ 资格档 ✓ | **齐备** |

三仓逐腿读数与逐轴拒面原始 stdout 在 `artifacts/v040/M4/<repo>/`（`base-run` / `qualify` /
`reuse-unrelated` / `reuse-inscope-and-reeval` / `qualify-overbroad`），汇总 `summary.json`
（合并式写入：单仓重跑不抹其它仓在案读数）。

**中途发现并修复两条缺陷**（详见 §5）：① 计量缝 WAL 静寂回退——修复前真会话恒 `metering-absent`
（隔离夹具从未真跑引擎，两半只见 delete 日志模式桩库，故 CI 全绿而真实面全盲）；② 挑战夹具符号
链接污染——openchamber 仓含相对符号链接（`CLAUDE.md -> AGENTS.md`、`.claude/skills/* ->
../../.agents/skills/*`），`cpSync` 缺省把链接目标改写成**绝对**路径串，使每个挑战的 diff 掺入约
22 条伪「modified」未知路径：期望 keep 的 canary 轴必拒（首跑即此读数 `invalidate @docs/.gitkeep`），
而期望 invalidate 的轴**假过**。两者修复后三仓读数如上（复跑只重读受影响两腿，host 腿读数不动）。

## 5. 缺陷账（本阶段发现即修，红绿在案）

| # | 缺陷 | 机制 | 红半 | 绿半 | 提交 |
|---|---|---|---|---|---|
| ① | 真会话恒 `metering-absent`（V08 不可达） | 引擎账本=WAL 库；干净关闭后 SQLite 移除 `-wal/-shm`，`sqlite3 -readonly` 恒拒（CANTOPEN 14）⇒ `queryHostDb` 返 null ⇒ metering absent（不算零）⇒ 运行 invalid。隔离夹具从未真跑引擎（两半只见 delete 日志模式桩库），故 M2 计量缝 CI 全绿而真实面全盲 | 修复前真会话：verdict=pass 但 validity=invalid(metering-absent)（`n10-meterseam/host-leg-blocked-run.json`）；契约测试 1 失败 | `immutable=1` 只读回退+非静寂守卫（`-wal` 有内容不回退，防读旧快照）；契约测试 3/3 通过 | 779d607 |
| ② | 含相对符号链接仓资格挑战必拒（且 invalidate 轴假过） | 见 §4 | openchamber 真实读数（首跑 `invalidate @docs/.gitkeep`，在档于本报告 §4 与 `artifacts/v040/M4/openchamber/`） | 契约测试：相对链接目标串保字节 + 含链接仓可 granted（`test/review-scope.contract.test.js`）；红半=改前树上该测试失败（`n10-meterseam/red-symlink-pre-fix.txt`） | b71b037 |
| ③ | 越界声明未被遗漏反例轴抓（N8 首跑暴露） | missed-dependency 轴按 hint 首命中选路，命中的是被声明的共享输入 ⇒ 越界 hole 未被注入 | qa 首跑：`s3-qualify-overbroad-rejected` 失败（exit=0 GRANTED） | 选路改「优先取声明显式判 unrelated 的 hint 命中」为遗漏反例（`classifyScopePath` 单一事实源）；十轴对表 + 越界点名拒 | 6322339 |

## 6. 预算账（真实会话，超注如实记账）

- 预注册（条目细则 R4）：N10 三仓 base+重评 ≤6 次、F7 自审 ≤3 次；单次墙钟 900s。
- 实际：**10 次真实会话（超注 4，如实记账）**——首跑 1 次（host 300s 墙钟超时，暴露缺陷 ① 的一半）；
  修复前正式跑 5 次（host 2：一次 metering-absent 阻塞 + 一次重评；openchamber 1：资格未授予阻塞；
  zpigeon 2）；修复 ① ② 后复跑 4 次（openchamber 2 + zpigeon 2，host 腿读数不动）。
  超注成因=**两条真缺陷**（计量缝 WAL、挑战夹具符号链接）各需一轮复跑 + 一次超时探针；失败即数据，
  不掩盖（模板见 M0 报告 §5 口径）。
- 计量读数（points，来自逐段 sessionId usage）：host base 3.14 / host 重评 2.06 / openchamber base
  3.46（其余见 `artifacts/v040/M4/summary.json` 与 F4 证据）。

## 7. 威胁边界（如实声明不冒充）

- **复用不证明结论正确**：复用只证明「本次候选未触及该职责的声明范围与结构身份」，不证明原结论
  正确、不替代阻塞发现的独立复核（ADR-0032 §威胁边界）。
- **套件 hint 是语义代理**不是判据：hint 模式对仓现存文件解析（如 lazyzcode 冻结树里
  `scripts/ablation/lock-queue-bench.mjs` 命中 `**/*lock*`），因此「命中 ≠ 真是锁文件」——轴验的是
  「声明对该类路径的处理是否健全」，不是文件语义分类（M5 输入）。
- **env 轴=同宿主同用户**：平台/arch/Node/TZ 复合，非强隔离证明。
- **unknown 恒回退**：分类器保守；unknown 占比高则复用价值下降（本阶段三仓读数：host 无关变化腿
  unknown=0）。
- **声明过窄=拒绝**（canary 无处安放）与**声明过宽=拒绝**（遗漏反例）两侧都拒，故声明面必须显式；
  这是纪律层的有意摩擦。

## 8. 收口相位与文档行拆分

收口链：计划增补节（条目细则 R1-R5 规范副本）→ plan-reviewer PASS（绑计划文件 sha256
`de1d0a1f…`）→ supersede 重采纳（attempt 2；**批准点=planHash 人权门**，本 goal 无契约）→ 步骤按
现行代次重记 → F1-F7 证据按现行代次采集 → 规则内容冻结。AGENTS §2 M4 行与 docs/history.md 里程碑行
在收口提交随最终对照结论落（M3 先例），本阶段文档面已落：AGENTS §4 三行翻面、docs/decisions.md
全表同步、CHANGELOG M4 条目、guide 双语（qualify/reuse/reopen 用法）。批量 close（拍板 11）不实现，
逐条 close 可用——取舍如实记录于此。

## 9. M5 输入清单

1. **套件 hint 的语义代理性**：`**/*lock*` 命中锁竞争脚本一类；M5 前置若做「必需 CI/锁文件」硬判据，
   须另立文件语义判定，不复用 hint。
2. **挑战夹具物化面**（缺陷 ② 根解已落）：仍建议 M5 复核其它 `cpSync` 物化点是否同病（本阶段只修
   挑战夹具一处；`materializeCandidate` 走 git archive/tar 不受影响）。
3. **计量缝**：WAL 静寂回退已修；仍建议 M5 在真引擎会话上复核 `metering` 读数（本阶段实证：修复后
   host/openchamber 两仓 metering=metered 且 points 非零）。
4. **三专项推导的轴映射**（已知未知 2）：本阶段三仓读数未出现「恒触发三倍成本」；M5 若做队列/交付
   编排，应把推导条件（清单 check/CI、riskClass、endpoint、subjects）纳入成本预估。
5. **声明面摩擦**：过窄/过宽双向拒绝意味着真实仓首次接入需按套件轴枚举声明；M5 迁移/文档宜给
   「按职责取提示的模式清单」配方（本阶段的 `docs/guide` 用法条目为起点）。
6. **批量 close 未实现**（拍板 11）：M5 若需一次收多发现，仍逐条走 resolve→recheck→close。
