# ADR-0005 · 透明账本纪律：提交 Goal 指针 + doctor 巡逻 + 证据 opt-in 入库

日期：2026-09-09 · 状态：已拍板 · 关联：决策 #18、ADR-0004（认领制）、
调研报告 artifacts/{ai-oss-maintenance-survey,upstream-maintenance-survey}.html（OmO 提交
带 Plan 指针与证据入仓的业界对照）

## 决策

1. **提交尾注**：提交信息尾部加 trailer 风格指针 `Goal: <slug>#<步号>`（例
   `Goal: ledger-discipline#N1`），人和 AI 提交时遵守；历史提交不补。约定载于宪法与 zw
   收尾规程。
2. **doctor `ledger` 行**：goal.json（executing）在场时，统计 goal 起点后提交缺 `Goal:`
   尾注的比例——0 缺=ok「X/X」，有缺=warn（不阻断、不翻退出码）；git 不可用或起点后
   无提交=skip。
3. **证据 opt-in 入库**：goal 计划可声明「证据入库」，finish 收尾经人点头把
   `.lazyzcode/evidence/<slug>.report.md` 复制进 `docs/evidence/<slug>.md`；技能文本承载，
   零新钩子零 CLI。零仓写 goal 的既有纪律不受影响。
4. **AI 署名不加**：提交作者保持人类身份；AI 参与经 Goal 指针与目标循环记录可查。

## 依据

- 业界对照（2026-09-08/09 实测）：OmO 的 AI 提交正文带 `Plan: .omo/plans/….md` 指针且
  .omo/evidence 整体入仓；OpenHands 把 AI 署名写进公开提交——「每条改动可回溯到目标」
  是 AI 驱动仓的账本底线。
- 表达层级：钩子强制被否决（克制原则）；doctor 是 CLI 侧纯读巡逻，warn-only 不阻断，
  与 claims/agents-md/rate-limit/schedule 行同款 fail-soft 模式。
- 狗粮价值：本批实现提交自带 Goal 尾注，doctor ledger 覆盖率活体可见——产品叙事的一部分。

## 备选与否决

- **纯尾注约定（零代码）**：静默腐化不可见，且破例于本仓「宪法约束 + doctor 巡逻」治理
  模式（ADR-0002 分工原则），否（其「先看看再自动化」直觉记此）。
- **钩子强制校验（PostToolUse 拦截无指针提交）**：历史提交不可补、违背钩子克制原则，否。
- **finish 自动全量入库证据**：与本仓多个 goal 的「零仓库写入」纪律直接冲突，且未治理的
  杂音公开是负资产，否（改 opt-in + 人点头）。
- **AI 署名尾注（Co-authored-by）**：单人仓信任价值低、需平台级 bot 身份定义、提交噪音；
  多人协作或外部贡献出现再拍，记备选。
