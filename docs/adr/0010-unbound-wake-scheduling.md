# ADR-0010: zw wake automation 必须 unbound（空 target，每 run 新会话）

日期：2026-09-11 ｜ 状态：已拍板 ｜ 关联：ADR-0003（无人值守走宿主自动化、频率 ≥1h 不变）、ADR-0009（交接放行）、ADR-0004（认领制）、决策报告 `docs/reports/plan-v2-workflow-cost-review.md`

## 背景

实证事故（2026-09-08/09，sess_95421d3d）：单会话跨 25.6h、1054 请求、平均上下文 451k、单周 4.75 亿 input token。根因不在 Stop 钩子（其预算仅 2-3 次），而在**调度绑定**：引擎在会话内创建 automation 时自动写 `targetTaskId = 当前 sessionId`（zcode.cjs 创建路径 `n?.sessionId?{targetTaskId:n.sessionId}:{}`），此后每班 wake 恒 `resumeTask` 同一会话——每次 wake 是新 user turn，不经任何续命预算，上下文跨 wake 无限累积。

成本后果：全账号改版后标准规则反事实 ≈16.2 万积分/周，其中夜间 Flash ≈14.5 万；账单 83% 是缓存重读，正是「同一会话每请求重读全部历史」的计费形态。

关键机制事实（宿主 app.asar `dispatchCronRun` 实证）：`targetTaskId` 为空时走 `createTask`——**每 run 一个全新 task/session**，仅绑定分支才 `resumeTask`。即「解绑 = 结构性消灭跨 wake 上下文累积」。

## 决策

1. **zw wake automation 一律 unbound**（`target_task_id` 为空）：每班 wake 新开会话，靠 SessionStart 重注入 + 盘上循环状态（`.lazyzcode/`）接手——该接手路径是现有设计（ADR-0003/0009 已实锤），无需新代码。
2. **禁止在会话内创建 wake automation**（含开工/目标会话内经任何工具创建）：创建即自动绑定当前会话，是本事故的字面根源。2026-09-11 探针双实证：工具路径创建的 automation `target_task_id` 立即等于创建会话 id；且引擎有「一会话一 automation」创建护栏（第二次创建直接报错）。重建只能走非会话上下文（App 自动化管理界面）。
3. **旧钉定 automation 退役**：在非会话上下文删除原 automation（automation-a8aba356，钉 sess_233c0ae2），按同样方式重建 unbound 版本；wake 间隔维持 **≥1h 不变**（ADR-0003 未修）。
4. **语义 canary 常驻**：unbound 语义依赖宿主 `dispatchCronRun` 黑盒行为，设一个低频（周频）探针 automation（空 target、无害 prompt、`max_runs` 有限或可随时停用），定期比对 `automation_runs` 落点 session id 是否各不相同——宿主更新若使语义回退为钉定/停摆，canary 先于账单发现。
5. **认领卫生**：重建时确认旧会话（sess_233c0ae2 等）无残留认领文件（`loop/sessions/`）；认领 TTL 与 orphan-wake 检查归 Phase 2 代码（见报告 §5）。

## 依据

- **换会话的量级**：马拉松 1054 请求 × 均值 451k ≈ 4.7 亿输入 token；同量产出在新会话形态下 ≈ 3,000 万（引导 ≈6-10k/会话 + 小上下文请求），差 ~15×。账单 83% 为缓存重读（97.1% 命中率下的大上下文读税），「暖会话」跨 compaction 边界本是幻觉。
- **双硬顶使复发不可能**：unbound 后单会话寿命 = 引擎 3 次/turn（每 prompt 重置）+ lzy 钩子 2 次/session（持久计数），跨 wake 累积失去了容器。
- **ADR-0003 不受影响**：本决策只改 automation 的绑定字段与创建位置，lzy 仍零调度零写入；频率 ≥1h 原样保留（加密方案已被红队以「违反 ADR-0003 + 空转比 4:1」否决，见报告 §3-Q2）。
- **任期制缓刑的依据**：unbound 落地后，任期制（A'）的边际保护≈0（上下文卫生已被容器切换 + compaction + tripwire + 空转逃逸契约覆盖），而其认知负荷与规范洞最多——缓刑入 `docs/ablation.md` 账本，与写手子代理（E）同纪律，待 Phase 2 基线数据后重审。

## 附记（2026-09-13）：挂载全清，开关语义确立

决策 1–4 的挂载物运行两夜后由业主拍板全清：unbound 版 10 颗逐小时 automation 已删（语义验收当时已通过——两夜 13 run/13 互异 session_id 零失败，验收记录在 automation_runs）；canary（zcode 工作区）随全清退役，留业主在 App 界面手动删。拍板理由：槽空空转会话过多，且**无人值守是用户可自行开关的能力，非常驻默认**——此为对 ADR-0003 的语义澄清：挂载=开、清空=关，开关动作与时机归业主。本 ADR 的机制结论（创建即自绑定、unbound=每 run 新会话）不受影响，是复挂时的技术前提；复挂配方见 `docs/reports/plan-v2-workflow-cost-review.md` §6（含 canary 重建步骤，复挂时是否重立由当次拍板决定）。
