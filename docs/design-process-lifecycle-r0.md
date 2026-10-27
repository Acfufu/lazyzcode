# R0 托管进程协议候选

日期：2026-10-25。**方向已批准（ADR-0041），接口候选未冻结、未接生产。** 本文承接[可靠性计划](plan-v061-reliability-patch.md)；R0 出口仍须三平台可实现性、恢复协议与失败语义全部有实证。当前 macOS entitlement 与 helper 死亡窗口未验证，不能启动 R1/R2。

## 1. 职责与存储

一个 drive 的主会话、workers、嵌套 CLI review 共用一个 runId 与绝对截止时间；独立 review 自有运行。平台归属跨分段保持，stdio 生命周期不作为运行是否清空的判断。helper 二进制不拥有契约批准、调度、预算或消费账本。

候选运行表放在既有 `.lazyzcode/state.sqlite`，属于 dispatch 生命周期，独立于 `loop/` 的 reset；不新建第二个产品数据库。表拟含 schemaVersion、runId、workspace、backend、backendVersion、state、fence、controllerIdentity、absoluteDeadline、backendIdentity、stopReason、cleanupDeadline、cleanupProof、lastError。平台身份字段必须版本化；未知版本、缺字段、损坏或身份不符均具名阻塞，不按“无残留”处理。探针中的 `recovery.sqlite` 仅为隔离机制实验，不是产品存储决定。

状态候选：`starting → active → stopping → cleaned`；任一不能确认清空的路径转 `cleanup-pending`，其恢复只到 `stopping/cleaned`，不重新派发任务。目标 done 与清理状态分别保存。租约释放、过期、reclaim、reset 均不能删除未 cleaned 记录。

## 2. 持久顺序和崩溃窗口

| 操作 | 先持久化 | 后执行与确认 | 中途死亡的处置 |
| --- | --- | --- | --- |
| 创建运行 | 在 SQLite 短事务内登记 runId、fence、deadline、starting；提交后才启动 helper | 建立平台归属；返回版本化 ready；核验身份后转 active | 未收到 ready 不放行目标；恢复核查平台身份，不能直接删记录 |
| 派发 | 核验现行 fence、active、父级截止及子项登记 | 目标在平台归属中启动；回执只代表该段，不结束整次运行 | 未确认的启动仍属于待回收运行；不能用重复派发修回执 |
| 停止 | 同一短事务关新派发并写 stopping、原因与清理截止 | 幂等 stop；等待 OS 清空证明；保存 proof 后写 cleaned | helper／控制器死亡转 cleanup-pending，下一次启动先恢复 |
| 恢复 | 在短事务中互斥认领恢复权、单调增加 fence；读旧控制器出生身份 | 核验旧控制器不活跃与平台身份，再回收并确认 | 恢复者死后释放 OS 锁；其他恢复者重读，不能窃取活跃控制器 |

长等待不持有工作区写事务。产品实现需把恢复认领与完成写入都绑定 fence，并验证旧恢复者迟到回执被拒。Linux 探针为证明互斥，特意持有隔离 SQLite 写锁至回收完成；**没有证明这套产品短事务／lease 协议**。不沿用它作为生产长锁设计。

跨 CLI attach 候选仅传 runId 与一次性通道凭证；接收端必须从 DB 核验 workspace、fence、父链和平台归属，不信任任意环境变量。Windows 同一 helper 持有唯一不继承的 Job handle；子级由它原子派发。Linux 子级先进入已登记 cgroup，GO 前不 exec 目标。macOS 必须在 ES 订阅、身份与恢复能力均确认后才 ready，当前不具备条件。

## 3. 平台身份与打包边界

| 平台 | 方向与所需身份 | 仍未证实 |
| --- | --- | --- |
| Windows | helper 预编译；`PROC_THREAD_ATTRIBUTE_JOB_LIST` 在 CreateProcess 内归属；禁止 BREAKAWAY 和继承 Job handle。持久身份候选为随机 Job 名＋启动实例＋OS boot／session＋helper 出生身份；遇到名称冲突不打开当作自己的运行，更不能终止对方 | 本轮 x64 EXE 在 arm64 Windows 验证，不是 arm64 原生构建或真实 x64 OS 验收；恢复 OpenJobObject 的权限、名称生命周期、旧会话／重启判定、版本握手、签名和包分发均未验收 |
| Linux | 真实委派 cgroup v2；专用私有 base、boot、mount、directory dev/ino/ctime、随机 run 名；打开目录 FD 后从 `/proc/self/fd` 锚定 kill/events。默认只读容器具名失败 | 更换路径／卸载重挂载／inode 复用的全矩阵、用户服务的 systemd 委派安装、cgroup.kill 内核地板和真实发行版兼容尚未冻结；元数据变更导致保守阻塞可接受，不能猜测杀进程 |
| macOS | 原生 helper 优先试 27+ descendants ES；Apple 批准 ES entitlement、匹配 macOS profile 和签名。restricted entitlement 的 standalone helper 要可嵌入 profile 的 app-like bundle | SDK／OS 版本支持范围、fork 事件丢失、helper 死亡后孤儿归属及恢复均未证实。新 helper 的 descendants client 不能预设能重新看到旧 helper 的孤儿子树 |

ES 是事件观察／授权 API，不是“客户端一死杀整树”的内核容器。`NOTIFY_FORK` 与日志刷盘之间、事件队列溢出、helper 与看护同时死亡均须单独造故障；只验证 token 信号、AUTH_EXEC 或日志回放不足以关闭 P07/P08。获授权后若出现不可修的正常宿主路径反例，保留 macOS 原生约束并报告具体取舍，不能自动改 VM 或降低三平台门。

Windows build-time 编译器可增加，运行时不要求 PowerShell、CLR 或动态编译。候选产品载荷放入 npm 白名单前，须完成 x64/arm64 构建、hash 清单、版本握手、缺件／损坏派发前失败、离线安装与架构选取验证；本轮 package.json 不变，探针不入包。

Linux 管理员委派是部署步骤，不由 lzy 猜写 `/sys/fs/cgroup` 或共享父组。验证使用的特权容器只提供隔离实验场，产品进程在 UID 1000 运行；不能把 Docker `--privileged` 当用户安装要求。

## 4. 失败码、时限与尚欠证据

候选诊断码：`BACKEND_UNAVAILABLE`、`BACKEND_VERSION`、`IDENTITY_MISMATCH`、`OWNER_LIVE`、`FENCE_STALE`、`CLEANUP_PENDING`、`CLEANUP_TIMEOUT`；缺能力必须发生于主会话／worker／review 启动前。探针 exit 78 仅表达配置／能力阻塞，不是已经发布的 CLI 退出码契约。

本轮探针使用有界等待：Windows 每段 10 秒、清空 5 秒、helper 总看护 30 秒；Linux 单次等待 8 秒、SQLite 竞争等待 5 秒。**这些是夹具容差，不是三平台生产宽限冻结值**。生产拟统一温和停止 2 秒＋强制清空 5 秒，macOS 能力未验证前不冻结；截止后不派发，宽限与执行时间分别记账。

R0 尚欠：macOS 真实 entitlement 后的 fork／helper 死亡实证，Windows 原生 arm64／恢复身份，Linux 替换／挂载和委派安装腿，启动登记窗口、恢复者死亡与旧 fence 回执矩阵。R1/R2 还须通过真实 CLI 主会话／workers／嵌套评审、跨段复用、截止竞争、reset/reclaim 与敏感材料清理，最终映射计划 P01–P08；局部原型不得冒充这些全链证据。
