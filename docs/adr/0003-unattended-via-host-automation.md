# ADR-0003 · 无人值守调度走宿主自动化，lzy 零写入零调度代码

日期：2026-09-08 · 状态：已拍板 · 关联：决策 #8（原生 scheduler 记入备选）、ADR-0001（config 零写入）、`docs/reports/review-against-reversed.md` §3.5

## 决策

「无人值守深循环」落地为**宿主内路径**：用户在宿主侧配置 automation（引擎自带
scheduler，cron 式、持久化、按工作区派发 prompt），唤起 prompt 固定写
`zw 继续（无人值守：…）`——句首触发 UPS 分层规则，SessionStart 钩子自动重注入
goal 状态。lzy 侧**零调度代码、零写入**；唯一增量是 doctor 的 `schedule` 行：
从实测集中段反推错峰窗口（`scheduleAdvisory` 纯函数），供用户挑挂载时段。

唤起协议（zw 技能 Unattended 段承载，六条红线）：只推进 executing 目标；无目标
或 planning 态→不立新计划、干净退出（决策完备门要求 interview 用户，唤起会话
做不到）；推进至 Stop 预算（≤2/会话）或 429 判死自然封顶；频率 ≥1h。

## 依据

- 外部 cron/launchd **事实否决**：`lzy step` 只记账不干活，活是模型做的——脱离
  宿主跑 CLI 没有执行面。这条理由不记下来，未来一定有人再提一遍 cron 方案。
- lzy 代写宿主调度（`tasks-index.sqlite` / config）**红线否决**：碰引擎内部存储
  踩 ADR-0001「config 零写入」的邻域，且宿主调度面随版本演化，代写是长期负债。
- 宿主自动化今天就是通的：SessionStart 重注入 + 句首触发 + 状态机恢复（429 判死
  后 `zw 继续`）全部已实锤，零新代码即成立。
- 时刻表不该拍脑袋：本仓实测限流集中本地 0–3 点（份额 70%+），错峰窗口从
  `concentration` 反推（集中段对侧净弧中央 8h），集中段变了窗口自动跟着变。

## 备选与否决

- **lzy 代写宿主 automation 配置**：红线邻域 + 版本负债（见上），否。
- **外部 cron 驱动 CLI**：无模型执行面，否。
- **无人值守允许立新计划**：interview 做不到 → 决策完备门形同虚设，凌晨自由发挥
  风险不可接受，否。
- **单步推进制**（每次唤起只收口一步）：唤起成本高、碎片化，且 Stop 预算与状态机
  本身就是边界，否。
