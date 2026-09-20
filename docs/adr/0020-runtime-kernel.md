# ADR-0020: runtime 运行时账本——lease/fencing/budget 与 risk 机器面

日期：2026-09-20 ｜ 状态：已拍板（roadmap artifacts/gap-roadmap-2026-09.md §⑮ Q1-Q7）｜
关联：ADR-0003 修正节（并存）、ADR-0010（unbound wake 不动）、ADR-0004/0009（匿名立场）、
ADR-0013（tier 机器门先例）、ADR-0015（消融开关形态）、决策 #21（步级 claim 对照）

## 决策

0.2.0 无人值守运行时的机器地基落 `loop/runtime.json`（core/runtime.js，沿 attempt.js
家法：载荷 sha256 校验和、原子写 tmp+rename 0o600、读 fail-closed 仅 ENOENT=缺席、
写护栏 fenceCounter 单调性不可回退；跨 reset 常驻，同 dag.json/attempt.json 先例）。
三件一体：

1. **lease 运行级认领**：`acquire/heartbeat/release`——单运行时互斥（活跃未过期租约
   在场=二次 acquire 拒）；TTL 缺省 15min（`--ttl-ms` 可覆盖），心跳续期、结束释放；
   过期=自然失效。匿名立场（ADR-0009）：handle=不透明 fence 令牌，绝不存 sessionId。
   与步级 claim（48h、goal.json 内嵌、done 自清）是两层：claim 占步、lease 占运行时。
2. **fencing 防伪令牌**：单调递增 fenceCounter 发号；写路径守卫 `guardFence`（loop.js，
   withLock 临界区内先过）在全部 goal/dag/attest/handoff 写入口执法——**opt-in 申报制**：
   不带 fence（交互人类）恒放行（零读账本，向后兼容逐字段同）；带 fence（drive 派生
   工人）必须与现行活跃租约相符，否则拒「你已被接管，立即停手不写」。CLI `--fence`
   旗标经 parseArgs 桥接 `LZY_RUNTIME_FENCE` env（守卫单源读 env）。消融开关
   `LZY_ABLATE_FENCE`。
3. **budget 运行预算**：墙钟+积分双硬顶（缺省 30min / 400 积分=waterline 警戒线 1600
   的四分之一保守定标，env `LZY_DRIVE_WALLCLOCK_BUDGET_MS`/`LZY_DRIVE_POINTS_BUDGET`
   覆盖，实测后调——沿 waterline「定标+env」先例）；`recordSpend` 超顶即拒（drive 段
   开工前申报，超顶=收束信号）；remaining 读面联动近 5h 滚动水位参照行（联动执法归
   棒2 drive）。宿主外生上限（如闲时车道墙钟掐断）为一等输入：预算数学须容忍宿主中途
   收窄，收束形态=handoff 快照干净交回，绝不烂尾。

**risk_class 机器面**：register 落 `risk` 字段（low|med|high|restricted，缺省 low，
小写归一，additive 零版本 bump）；`lzy loop risk <level>` 只升不降（镜像 setTier，
无 planHash 耦合——执法点在 drive 入口非采纳时点，无 ADJ-09 死锁面）；HIGH/RESTRICTED
升档 warn-only 提示 SUSPENDED_RISK。`assertDriveEligible` 谓词=drive 入口机器门
（HIGH 拒：人工会话推进；RESTRICTED 硬禁：唯一出口=人工收窄范围后 reset 重注册——
risk 只升不降无降级命令，出口经重建非降档），棒2 drive 接线；开关
`LZY_ABLATE_RISK_GATE`（=§⑮ H3R 三臂实验的 B/C 臂目标级门）。

## 已知边界（守卫面四项并列，记档不设防）

1. **钩子侧写面**（stop.js unlink handoff.json、trigger.js/session-start.js 写
   sessions/）不经 withLock，不在 fence 守卫面。
2. **resetLoop** 的删除面=goal.json（+ 残留 tmp/sessions），**不删 runtime.json、
   dag.json、attempt.json（三者跨 reset 常驻）**；reset 无 fence 守卫直接删 goal.json
   （该边界如实记档）——残留租约以 TTL 自然过期或人工删除。僵尸伤害面已收窄：租约现在
   绑定目标 slug（跨 reset 的僵尸写因目标不符即拒）；与钩子面同属「人工/协议层管辖」。
3. **runtime.json 自身写者**（budget init/spend）不带 fence——僵尸只能扰动预算读数，
   不伤 goal/dag 权威面一致性。
4. **未申报的机器写**：带 fence 与否靠申报自觉（交互直通语义的代价）；drive 派生
   工人由棒2 一律注入 fence，drive 外机器写不申报即直通=申报纪律残差（沿 subjects
   未声明兄弟仓先例）。
5. **fence 非鉴权凭证**（ADJ-35，2026-09-21 五轮双审）：令牌是明文可读、可重放的低熵
   单调计数器（acquire 输出/doctor/runtime.json 三处可见）——它保证的是「申报一致性 +
   单调性」，不是「只有我知道的密钥」。正确口径：**未申报或申报不符的写被拒**；「被接管
   即停手」是协议层纪律（新持有者 acquire 后旧 fence 才失效），不是密码学保证。不发散
   令牌给不可信进程。

## 依据

- opt-in 申报制而非全量强制：交互人类是最高权威，强制申报会把每条 lzy 命令变成
  租约谈判；僵尸伤害面集中在 drive 派生的机器写，申报制恰好罩住它（预算数学与
  claim 的 48h 无互斥教训同源：粒度错了护栏就是摆设）。
- 独立账本而非混入 goal.json：goal.json 是 reset 即清的每目标全量 read-modify-write
  快照，混入高频心跳写会翻动 mtime（`lzy loop list` 活跃度读数失真）并加剧锁竞争；
  混入 dag.json 会污染统一权威面（节点型封闭，ADR-0014）。
- risk 无 planHash 耦合：tier 机器门在采纳时点（planHash 移拒防评审绕过）；risk 门
  在 drive 入口，采纳时点无从绕过——耦合只会制造死锁。

## 备选与否决

- **lease 入 sessions/ 每会话小文件族**：并发心跳的读-改-写碎片化；单账本+withLock
  已够（若多工人并发心跳撞 LOCK_WAIT_MS=5s 窗口，回退路径=per-handle 文件形态，
  预注册于计划已知未知①）。
- **全量强制 fence（活跃租约期内一切写须申报）**：交互会话被误伤（handoff/对冲等
  人工救援动作全被拦）；升格条件=棒2 实测出现僵尸写逃逸实例（届时拍板）。
