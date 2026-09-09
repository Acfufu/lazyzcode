# ADR-0008 · 传输死亡诊断面：与限流分族计数，绝不进带数学

日期：2026-09-10 · 状态：已拍板 · 关联：决策 #16（限流经验测量）、ADR-0003（无人值守
错峰窗口）、触发事故 sess_4ad3d9c9（2026-09-08 Clash TUN 瞬断 → `connect ENETDOWN`，
请求未出本机，引擎误标 `retryable=false`）

## 决策

1. **doctor 增 `transport` 行**：`collectRateLimitStats` 同一遍流式扫描内分族收集传输
   死亡——`event=model.request.failed` 预过滤后，errno 主判据取自 `context.statusMessage`
   （实测该事故 `reason="unknown"`，按 reason 白名单会漏掉触发事故本身）；
   `reason=network_error` 与 connect 阶段 timeout 为辅判据；`rate_limited/cancelled/
   server_error/invalid_request` 排除。回合口径与限流族同款双口径（复合键 coverage
   ≥0.9）。warn-only 不翻退出码，无集中段之类门槛（任何一起都是有效信号）。
2. **分族，不混算**：传输数据绝不进 `bandAdvisory`/`scheduleAdvisory` 的并发带与错峰窗
   数学——本地网络/代理事故不是配额压力，混入会污染实测带（测量纯度是本 ADR 的全部
   理由）。`transportAdvisory` 仅在样本地址命中 198.18.0.0/15（Clash/mihomo fake-ip
   保留段）时附一条「本地代理 TUN 疑似，可加直连规则」提示。
3. **429 谓词零语义变化**：限流分支保持原子串谓词逐字不动；护栏=重构前旧实现与重构后
   新实现同跑两日真日志（10310 事件/161 回合），429 字段级 diff 为空（已执行通过）。

## 依据

- 结构性鲁棒已足、诊断面缺席：turn 级传输死亡发生时模型未执行，纪律层当场必然失明，
  恢复全靠磁盘状态+三重入路径（SessionStart CTA/UPS 认领/无人值守唤起）——这套已建成；
  缺的只是用户侧可见性（doctor 原先对该家族零输出）。
- 表达层级：纯 CLI 读面增量，零新钩子零配置面零遥测（宪法 #9）。
- 隐私纪律：fixture 入库 sessionId 等长打码；errno 与 198.18.x.x 为保留段地址可原样。

## 备选与否决

- **按 reason 白名单判族**：否决——实测会漏掉触发本特性的 ENETDOWN 事故本身（其
  reason=unknown）；errno 主判据+reason 辅判据才完备。
- **把传输死亡计入并发带**：否决——污染测量纯度（见决策 2）。
- **turn 内自动重试**：否决——重试策略归引擎（其 `retryable=false` 误判记为已知引擎
  行为，不在本项目修）；我方职责是状态无损与诊断可见。
- **同时计数 `turn.failed`/`model.network.failed` 事件**：否决——同一事故落三事件形态
  （实测），单源计数防重复；回合去重已兜住尝试级重复。
