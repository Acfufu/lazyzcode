# 安装价值校准：记录模板

日期：2026-10-05。协议单源：[完整方案](../plan-lzy-install-value-calibration.md)。入口：[ZCode 交接](../handoffs/zcode-install-value-calibration.md)。模板中的空值是尚待测量/冻结，不能直接当作有效 manifest。

所有事实记录只追加；修正使用新行指向原记录，保存旧值、原因、操作者与时间。文件哈希用于绑定被检查的内容，不声称同权限本地文件不可篡改。原始敏感信息留本地，分享时另生成脱敏副本并保留原件哈希。

## 1. 证据目录建议

```text
artifacts/install-value-calibration/<batch-id>/
  preparation.md              # 工具/环境盘点、授权与参与条件、未解决缺口
  task-pool.jsonl             # 全部候选、纳入排除原因；不含隐藏答案
  manifest.json               # 首题前冻结，含全部六槽和参数
  manifest.sha256
  smoke/                     # 正反验收、隔离、计时和中断计量记录
  events.jsonl               # 阶段/任务事件，只追加
  human-time.jsonl           # 真实用户主动时间区间
  sessions.jsonl             # 会话身份、父子关系、归账范围
  costs.jsonl                # 原始用量引用、计价、去重与修正
  deviations.jsonl           # 偏离、影响与处理
  runs/<run-id>/             # 公开需求、源快照身份、原始输出、最终产物、验收
  independent-review/        # 独立会话输入身份、检查及复核结论
  report.md                  # 人可读报告
```

这只是证据目录。实际被测 checkout/HOME 要放在不会继承 lzy 仓库指令的隔离位置；隐藏检查由独立准备者保管，不把正文放进执行者可读的任务包。共享文件系统下依靠会话与输入纪律，不能宣称实现了不可突破的安全沙箱。

## 2. 准备与启动卡

```markdown
# 批次准备
- 协议版本与文件哈希：
- 当前阶段：P0 / P1 / P2
- 仓库HEAD、dirty/未跟踪清单及处置：
- 已有授权证据指针：
- 本机已确认事实及验证命令：
- 尚缺条件、影响、最小补齐动作：
- 工程准备付费范围/额度/授权（无则不得付费开发）：
- 用户可参与时段：
- 各题本地副本与动作权限（含是否允许副本内提交）：
- 每对绝对墙钟截止、依据：
- 共同介入规则、检查节奏与停滞间隔：
- 产品安装/学习时间的记录方式：
- 实验三账的已用、未决、剩余额度：
- 可以开始的下一阶段及依据：
```

## 3. 冻结 manifest 字段

下列为字段草图，不是现有 CLI 的输入 schema；本方案不声称仓库已有消费此文件的命令。可用简单本地脚本/人工双查实现完整性检查，无需新平台。

```json
{
  "schemaVersion": 1,
  "batchId": null,
  "purpose": "single-user-calibration",
  "protocol": { "version": 1, "path": null, "sha256": null },
  "frozenAt": null,
  "participantId": null,
  "coordinatorSessionId": null,
  "environment": {
    "os": null, "node": null, "zcodeShell": null, "engine": null,
    "pricingUnit": null, "pricingSource": null
  },
  "arms": {
    "B": {
      "launchMethod": null, "provider": null, "model": null,
      "commonPromptSha256": null, "loadedInstructionsManifestSha256": null,
      "toolsAndPermissionsSha256": null, "isolationEvidence": null
    },
    "L": {
      "launchMethod": null, "provider": null, "model": null,
      "commonPromptSha256": null, "loadedInstructionsManifestSha256": null,
      "toolsAndPermissionsSha256": null, "isolationEvidence": null,
      "candidatePackageSha256": null, "candidateSourceManifestSha256": null,
      "productEntry": null, "reviewModelManifestSha256": null
    }
  },
  "budget": {
    "unit": "points-after-verified-mapping",
    "totalStopThreshold": 200,
    "productRuns": 150, "perRun": 25,
    "externalEvaluation": 30, "smoke": 20,
    "paidEngineeringAuthorization": null
  },
  "interactionPolicySha256": null,
  "humanTimerMethod": null,
  "randomization": { "algorithm": null, "seed": null, "outputSha256": null },
  "pairs": [],
  "executionOrder": [],
  "independentPreparationSessionId": null,
  "independentReviewArrangement": null,
  "preflightEvidence": [],
  "authorizationEvidence": []
}
```

`pairs` 必须包含三对，每对包含两道不同任务及一 B 一 L。每题必须有：taskId、runId、来源、仓库与基点、用户尚不知修法的确认、匹配依据、熟悉度、复现环境、公开 brief/验收哈希、隐藏检查哈希与保管者、独立 checkout、对应权限、墙钟上限、产品积分上限25、分配臂。`executionOrder` 恰好列出六个 runId，不重不漏。

原生模型若由宿主动态回退，应能检测实际 provider/model。无法固定或确认则不得宣称同模型对照；记录偏离并停在对应阶段。对候选源身份，单写 version/HEAD 不足以覆盖未提交补丁和未跟踪文件。

## 4. 任务与人工记录

任务池每行：候选ID、来源、发现日期、项目熟悉度、预期难度依据、纳入/排除/待定、理由、是否被解题或答案污染。筛选难度不使用运行后的成功/失败结果。

人工时间区间字段：

| 字段 | 内容 |
|---|---|
| recordId / runId / participantId | 唯一身份；未指定任务的安装/研究工作另有归属 |
| startAt / endAt / elapsedSeconds | 实际开始结束事件；重叠区间按时间并集统计，不能双算 |
| category | 阅读任务/检查进度/提示/审批/排障/恢复/产品文书/用户验收/安装学习/实验记录 |
| accounting | product-active / onboarding / research；不能用分类隐藏产品摩擦 |
| trigger / action / evidence | 为什么介入、做了什么、对应原始事件 |
| captureQuality | 实测 / 漏记 / 仅有粗略回忆；收益主读数只用可核实记录，缺失明确披露 |
| correctionOf / reason | 修正旧行时必填，保留原行 |

任务事件至少包括：开始、模型请求/子会话启动、明确求助、人工介入、停滞、候选就绪、执行者声称完成、用户验收失败/接收、预算或时限触发、最终停止。事件都有 UTC 时间与本地时区，不将日志输出顺序当精确时序。每次声称完成/提交验收事件须引用该时刻的完整源码或基点＋补丁快照（含未提交内容）、哈希、原话和公开验收结果；旧快照不覆盖。严重错误复核必须指向出错的历史快照，不能只检查后来修好的最终版本。

## 5. 会话与费用账

每个会话记录：sessionId、parentSessionId、runId、provider、实际模型、角色、开始/结束、原始用量文件或查询回执、账目类别、是否结束/待结算。协调者若给题目提供额外解题工作，不能归作无关准备。

费用记录字段：recordId、sessionId、requestId/原生去重键、账类别、原始tokens、积分、计价身份、状态（metered / pending / absent / unpriced）、证据引用、correctionOf。一条费用只进一个账；重试有自己的消耗，重复读取同一回执不重复加。

| 汇总对象 | 已知消耗 | 待结算/未知条数 | 停止阈值 | 超额 | 是否允许下一次派发 |
|---|---:|---:|---:|---:|---|
| 每题 | 实填 | 实填 | 25 | 实填 | 未知时否；达到阈值时否 |
| 六题产品账 | 实填 | 实填 | 150 | 实填 | 按单题与累计共同判断 |
| 外部实验验收 | 实填 | 实填 | 30 | 实填 | 同上 |
| 冒烟 | 实填 | 实填 | 20 | 实填 | 同上 |
| 实验合计 | 实填 | 实填 | 200 | 实填 | 不含另有授权的工程账；工程账另展示 |

## 6. 每题结案卡

```markdown
# run-id
- 分配：pair / task / arm / 实际顺序
- 输入与身份：manifest / brief / source / candidate / model
- 实际授权、环境与偏离：
- 开始 / 候选就绪 / 声称完成 / 用户接收 / 终止时间：
- 停止原因：accepted / task-failed / timeout / budget / user-withdrawn /
  instrument-failed（含用量未知等计量不可用）/ identity-drift /
  hidden-info-leak / serious-error-pending / not-started
- 用户真实主动时间H（未知区间另列）：
- 产品模型费用C（已知下界、未知、所有尝试与子会话）：
- 端到端W：完整值或截至停止的观测下界；不得混淆
- 首次安装学习、实验记录与独立审计的另账：
- 独立正确性：pass / fail / unknown；检查身份与证据
- 是否用户接收：true / false / unknown
- 执行者是否声称完成：true / false / unknown
- lzy内部状态（B为不适用）：
- 人或协调者是否直接实现修复、具体贡献：
- 四格结果或unknown（注明宣称完成与实际接收不同）：
- 严重错误：无观察 / 疑似 / 已确认；独立复核身份及证据
- 历次声称完成/提交验收的快照、哈希、原话、公开检查及严重错误处置：
- 最终产物哈希、diff、原始检查与真实表面证据：
- 重试/恢复/额外帮助/判定器故障：
- 执行者事实说明与独立验收分别署名：
```

## 7. 最终报告模板

```markdown
# 批次报告
日期：
协议/manifest/产物哈希：
独立复核身份、输入及费用：

## 结案
仪器不合格 / 校准未完成 / 测量可用、收益未定 / 候选因严重错误不通过
结论能支持什么，不能支持什么：

## 完整性
六个分配槽及其结局；缺失/未开始的原因：
两臂加载、模型、权限、候选是否一致于冻结身份：
原始人工时间、全部会话和费用是否齐备：
未知、环境/判定器故障及偏离：

## 逐题、逐对结果
列出所有题的正确性、接收、声称完成、严重错误、H、C、W及截尾。
三对各自差异与难度可比性；不得把不同题说成同题重复配对。
只作描述汇总；任何成功子集单列且注明选择偏差。

## 全部投入
三账已用/未知/超额、独立工程账、人工主动/安装学习/研究时间。
预算耗尽与未判定处置。安装回本任务数仅在人工净节省可估时给条件估计。

## 误差与独立复核
单用户、非盲参与、每臂三题、任务差异、模型/环境波动与计量限制。
执行者自评与独立验收不一致的事实及处置。

## 下一步
修仪器 / 修产品 / 收窄范围 / 准备新的正式验证集。
若建议正式验证，给出波动、预算和样本量设计依据；本批题转开发集。
保留功能开发与重构扩展；不自动发布、切默认或修改#42。
```

## 8. 文档与记录检查

- 开跑前：manifest 无关键空值、三对六槽完整、启动条件有证据、三账合计 200、各题 25、两臂权限与共同提示词可核。
- 收尾时：六槽无遗漏，事件与会话都有归属，修正保留旧值，独立结论绑定被测文件哈希；缺独立复核不得由执行者补签。
- 仓内文档可运行 `node scripts/check-docs-links.mjs` 与 `git diff --check`。它们只检查文档，不证明实验、计量或产品效果通过。
