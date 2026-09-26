# LazyZCode 0.3.1 收口计划

日期：2026-09-26。状态：整体计划已确认，待实施；范围见设计访谈 Q1/Q11，整体确认见 Q12。用户明确要求本轮不执行，尚未启动本计划。
核对基线：`b8e69de295e3d9d120f54d9c97b794aa30dceb38`。对应 [0.4.0 主计划](plan-v040-engineering-policy.md) 的前置阶段 R0。

## 目标与范围

保留既定两棒：棒1交付编排已收口，不重做；完成棒2积分归因修正，并在发布收口时修复本轮发现的回执契约绑定与 B 交付完成判定缺口。取得 release-ready 候选后冻结 0.4.0 比较基线。tag、Release、npm publish 沿原维护者发布边界，本计划确认不等于发布授权。

已知状态：包版本仍为 0.3.0，0.3.1 条目位于 Unreleased；棒1历史报告记录 15/15、comparator MATCH 和全量 651/651，本轮未重跑。棒2在 [ADR-0027](adr/0027-bounded-queue-and-cumulative-budget.md) 修正节仍为待实施。

## 执行顺序

### R0.1：棒2，积分归因与预算语义

责任面：`core/drive.js`、`core/cost.js`、`core/runtime.js`、`core/queue.js`、`core/doctor.js` 与相关 CLI/协议文档。

- [N1] 先复现账号级消耗误伤另一任务的拒绝路径；核对单工与 workers 的 sessionId、分段结算、异常退出和累计账本，固定实际基线。
- [N2] drive 逐段归因复用 `querySessionPoints` 已有查询能力；账号级水位只留 doctor 建议面，`budget-ref=none` 只执法墙钟；维持近似限制、在途超额和计量缺席语义。
- [N3] 对单工、workers、queue 验证消耗去重和原预算继承；新评审运行未来也使用同一计量口径，不另建积分权威。
- [F1] 真实受控会话中，其他会话消耗不触发本任务积分停止；本任务达限停止下一次派发；查询缺席/未计价/在途死亡不算零；重启不刷新累计预算。仅统计脚本通过不足以完成此项。

回归落点：`test/drive.contract.test.js`、`test/drive-workers.contract.test.js`、`test/queue-metering.contract.test.js`、`test/budget-ledger.contract.test.js`、`test/cost.contract.test.js`、`test/runtime-kernel.contract.test.js`。

### R0.2：回执绑定缺口

源码线索：`core/loop.js` 注册结构为 `goal.contract.contractHash`；`core/verify.js` 的 run/reuse/qualification/ci 写面读取 `goal.contract?.hash`。

- [N4] 使用真实 `register --contract` 产生目标，先建立失败反例：四类新回执的契约绑定必须等于登记值，不能只断言字段存在。
- [N5] 修正全部相关读写及展示路径；无契约 legacy 记录如实保留 null；历史 null 回执不猜测、不回填为已正确绑定，后续新策略要求重新取证。
- [F2] 真实 CLI 执行与回执读回一致；漂移/错契约/旧 null 不能作为新契约的有效覆盖。测试覆盖新记录与历史保留两个方向。

回归落点：`test/verify-receipt.contract.test.js`、`test/scope-tier.contract.test.js`、`test/ci-binding.contract.test.js`、`test/contract-gate.contract.test.js`。

### R0.3：已合并事实与完成 B 分离

源码线索：`core/delivery.js` 合并读回后将意图置 done 并另存 `mergeCiState`；`core/queue.js deliveryAllDone` 只看意图 done。done 用于禁止重复外部动作，不能改成允许重新 merge 的状态。

- [N6] 先建立 merge 已成功、merge-SHA CI 为 pending/failed/查询失败/green 四类反例；覆盖正常 dispatch、死亡恢复、人工 readback 后 reconcile 追认。
- [N7] 复用一份交付结果判定：B 须匹配实际 merge 身份且其必需 CI 满足；C 还须匹配部署身份与全部声明页面。已合并但未验证成功时保留意图 done，队列不得 completed，恢复走 readback/验证而非重复 merge。
- [N8] 消除 `runDeliveryChain`、`deliveryAllDone`、`acknowledgeDeliveries`、各 reconcile 分支对 done 的错误等同；CLI 报文与队列结果一致，不修改原授权范围。
- [F3] 假 gh/curl 契约矩阵验证零重复外发与状态机；另在明确授权的测试交付链核对实际 merge SHA、CI 与 Pages 身份，模拟与真实证据分开。外部链不可用则保留发布验证缺口。

回归落点：`test/queue-delivery.contract.test.js`、`test/dispatch-recovery.contract.test.js`、`test/delivery-state.contract.test.js`、`test/delivery-drift.contract.test.js`、`test/delivery-pages.contract.test.js`；复用 `scripts/v031/queue-bridge-e2e.mjs` 并明确其替身边界。

### R0.4：发布机械件与基线冻结

- [N9] 同步 ADR-0030/#37 的实施状态、ADR-0027/#38 的实际结果；校正 CHANGELOG 中 B 契约的 B∧C 要求。更新报告、README/guide 双语、帮助与升级说明。
- [N10] 依 [发布清单](release-checklist.md) 完成版本各载荷同步、打包核验、CI 矩阵与 Windows 必要补测；记录最终 full SHA、包内容哈希、环境与新鲜测试结果。
- [F4] 目标回归和 `npm test` 通过，文档构建与链接检查通过，所有发布项有证据或明确阻塞；两项旧缺口有红绿反例，棒2有真实计量证据，才能声明 release-ready。

## QA 操作配方

`scripts/v031/closeout-qa.mjs` 为本计划待新增的夹具驱动器，负责依次调用真实CLI、注入明确失败条件并采集状态，不代替核心实现。参数为 `--case budget|receipt-binding|delivery-completion --fixture <隔离根> --out <证据根>`；每项输出 `result.json`（passed、逐断言、版本/候选身份）、stdout/stderr及相关账本哈希。所有注入只落独立夹具，根目录身份不符即拒执行。无凭据或缺少真实运行能力时非0退出并报阻塞，不计通过。

| 阶段 | 操作步骤与预期结果 | 证据 |
|---|---|---|
| R0.1 `budget` | 前提为已批准的有界测试契约与可用headless认证。分别创建目标会话与旁路会话，从已完成用量行取得各自sessionId；用夹具允许的低限额使旁路用量越线，目标自身未越线。调用目标drive，应允许派发；随后目标自己的累计用量越线，再次drive不得启动下一段。注入查询缺席、未计价、在途终止，分别读queue budget/runtime/段账，确认不算零；改用已批准budget-ref=none夹具只受墙钟约束。用事件触发中断与重启，确认session结算去重。账户水位只在doctor建议面出现 | `artifacts/v031-closeout/budget/`：会话/用量原文、CLI退出与派发计数、前后账本 |
| R0.2 `receipt-binding` | 真实 `lzy loop register --contract`、批准并采纳，在夹具执行 `verify run/qualify/reuse/ci`；CI字段绑定机制用可控gh替身，另注明不证明远端CI通过。对照goal中的contractHash及每个新回执的contractHash，必须严格相等；旧null样本保留原字节，不纳入新绑定绿例。改前断言失败、改后通过；wrong-contract样本保持可识别 | `artifacts/v031-closeout/receipt-binding/`：四类回执、原始输出、红绿断言 |
| R0.3 `delivery-completion` | 扩展现有 `scripts/v031/queue-bridge-e2e.mjs` 的gh/curl注入面，给出真实merge事实配pending/failed/查询失败/green四组merge CI。逐组运行dispatch、模拟交付持有进程死亡后的reconcile、人工readback后的reconcile：前三组队列不得completed且merge调用总数仍1，green组达到契约终点才completed。再用明确授权的测试PR/Pages链运行绿路径，读回merge SHA、CI、部署和页面；失败矩阵无需破坏生产CI来验证 | `artifacts/v031-closeout/delivery/`：替身矩阵与真实链分目录，意图/队列/CI读回与副作用计数 |
| R0.4 发布核验 | 在最终候选运行 `npm test`、`npm pack --dry-run`、`node cli/lzy.js --help`，按发布清单检查全部版本载荷及CI四腿。文档运行 `npm --prefix scripts/docs-preview run build` 后 `npm --prefix scripts/docs-preview run check`。比较包清单与发布版本，读取Windows实际补测结果；缺腿不得用本地测试计数替代 | `artifacts/v031-closeout/release/`：完整日志、包清单、版本/CI与文档报告 |

## 验证与停止条件

各段先运行对应目标测试与真实表面，再统一运行 `npm test`；文档按 `scripts/docs-preview/package.json` 的 build/check 验证。根包没有独立 lint/typecheck 脚本，不虚构已执行结果；修改的 JavaScript 做语法检查并遵循现有测试和 CI 配置。执行时先核对工作树，保留其他会话改动。

停止于 R0.1–R0.4 证据全部齐备、0.3.1 release-ready 基线冻结。发布由维护者另行授权；0.4.0 实验不得使用带上述已知缺口的旧 SHA 冒充修正后的基线。
