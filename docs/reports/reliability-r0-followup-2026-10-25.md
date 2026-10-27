# R0 后续：进程归属、平台原语与超时定位

日期：2026-10-25。承接[可靠性计划](../plan-v061-reliability-patch.md)与[首轮记录](reliability-patch-2026-10-25.md)。用户授权继续验证三平台机制并定位 macOS EPERM／Windows 超时；新增生产原生组件、改变支持范围须给具体取舍。没有提交、推送、发布或运行模型。

**结论：R0 仍未通过。** Linux 与 Windows 已从文档设想推进到真实本地进程的机制证明；macOS 确认了可用的身份信号原语和实际能力门，但完整归属／恢复仍有缺口。所有 native 代码均为 `scripts/probes/` 下的离线原型，不进入 npm 包，未接入 drive，也未修改已安装的 ZCode。

**后续授权与新证据：** 用户已同意 Windows 原生 helper＋Linux cgroup；macOS 保持原生，先核查 ES／Apple entitlement，不切 Linux VM。下文第 4 节为当时的提案记录；现行方向与本轮 Win32 EXE、Linux 恢复互斥及 macOS 授权阻塞见[原生后端报告](reliability-r0-native-2026-10-25.md)。R0 仍未通过。

## 1. macOS EPERM：确定复现与最小修正

环境：macOS 27.0.1（26A434），arm64，Node 24.19.0。

1. 原正常退出场景重复 40 次未重现，不能当作问题消失。
2. 自写有限寿命 C 夹具故意短暂保留一个已退出、未被 wait 回收的子进程。仅含僵尸的进程组收到 `kill(-pgid, SIGKILL)` 返回 EPERM。
3. 将这段夹具接入真实 `spawnHeadless`：`exit` 首次组信号成功；`close` 第二次组信号 EPERM；已输出成功 JSON 的运行被报为回收失败。红记录含两次信号与子进程死亡信号 9。
4. 在 `core/headless.js` 加一次性清理标志，超时、取消、error、exit、close 共用。首次错误仍保留，不将所有 EPERM 当成功，也不重发可能已经失效的数字 PGID。
5. 同一原生夹具变绿：仅一次组信号、运行成功。增加事件去重与首次权限拒绝两项回归；普通真实后代场景再跑 40 次无失败。

这解释并修复了一个与首轮故障完全匹配的确定路径；首轮未记录逐信号时间线，不能宣称重建了那次运行的全部内核状态。修正不扩大 processTree 的同组边界，不关闭 F1。

入口：[原生红绿探针](../../scripts/probes/r0-macos-zombie.mjs)、[重复运行时间线](../../scripts/probes/r0-signal-repro.mjs)、[回归检查](../../test/headless-review-lifecycle.contract.test.js)。Apple XNU 的进程组筛选排除僵尸，POSIX killpg 路径在无可处理成员时可返回 EPERM，与本机结果相符；这是源码解释，不代替实测。[XNU 信号实现](https://github.com/apple-oss-distributions/xnu/blob/main/bsd/kern/kern_sig.c)。

## 2. 平台机制验证

下表是原语证明，**不是 P01–P08 全链验收**。共同夹具均使用真实 Node 子进程、脱离会话的后代、文件心跳及本机 HTTP 服务；不会访问模型。Linux／Windows 的第二段请求第一段留下的同一服务，随后启动另一次 detached 的嵌套后代。

| 平台／候选 | 实测结果 | 仍需满足的条件 |
| --- | --- | --- |
| Linux cgroup v2 | Node **24.0.0**、UID 1000；跨段服务复用、普通收束、取消、控制器 SIGKILL 后按持久 cgroup 恢复均通过；`cgroup.events` 变 populated 0、心跳停止；组外 canary 持续；启动门 EOF 不执行夹具 | cgroup 必须真实委派给运行用户；默认只读 Docker cgroup 不满足。此轮由隔离特权容器挂载自己的 cgroup namespace、只委派专用子树，再降为普通用户运行。不是普通发行版自动可用证明 |
| Windows Job Object | Windows 11 arm64、Node 24.19.0；原子加入 Job 后才允许线程执行；detached 服务／嵌套后代仍归属；跨段复用、显式终止、控制器强杀、创建后放行前强杀均通过。SYSTEM 首轮后，以普通用户 `RunLevel=Limited` 重跑两轮，四场景均通过；独立观察进程持有原生进程句柄，确认控制器强杀后的 2 个后代、放行前强杀的 1 个目标全部退出 | 仍需生产安装／签名／x64 构建腿与完整恢复协议。任务调度器只用于以已登录普通用户执行探针，临时任务随后删除，不是产品依赖 |
| macOS launchd＋进程组 | 自有临时 LaunchAgent 配 `AbandonProcessGroup=false`；主进程退出、bootout 后 detached 服务仍继续心跳；finally 清理自有服务与 label | 不能作为完整归属方案；launchd 托管监督器并不自动把它变成 cgroup／Job 等价物 |
| macOS audit token 信号 | UID 501，自有子进程传出 token；版本不匹配返回 ESRCH 且子进程仍活着；匹配 token 的信号返回 0，wait 确认 SIGKILL | 证明身份不匹配拒绝，并未强制真实 PID 回绕。信号目标身份与发现／持久归属是不同问题；只有此原语仍不能发现所有 detached 后代 |
| macOS Endpoint Security | 普通用户调用 `es_new_client` 返回 NOT_PRIVILEGED；27.0 descendants client 返回 NOT_ENTITLED | 27.0 descendants API 无 root／TCC 要求，但仍需 Apple 授予 entitlement。获授权后的事件完整性、helper 死亡、重启枚举及恢复尚未验证 |

Linux 启动顺序为先建唯一 cgroup、落盘意图，再让 shell 先写 `cgroup.procs`、等待 GO 后 exec。关闭控制管道时门退出。内核归属随后跨 fork／exec／setsid 保持。控制器退出不删除组，恢复端再次读取身份并写专用 `cgroup.kill`，等待 populated 0 后删除空组。生产还需要 boot／mount 身份、互斥恢复与 fence；探针的 inode 核对不冒充 P08 的完整身份协议。[Linux 探针](../../scripts/probes/r0-linux-cgroup.mjs)、[内核 cgroup v2 文档](https://docs.kernel.org/admin-guide/cgroup-v2.html)。

Windows 使用 `PROC_THREAD_ATTRIBUTE_JOB_LIST`＋`EXTENDED_STARTUPINFO_PRESENT` 在 `CreateProcessW` 内完成归属，设置 `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`，不启用 BREAKAWAY，job 句柄不可继承。创建时另加挂起标志，只为证明放行前已在 Job。**不能采用“挂起创建→另调 AssignProcessToJobObject”作为完整方案**，两调用间控制器死亡会留下未归属进程。原型通过 PowerShell Add-Type 调 Win32 API；未更改执行策略，也不建议将动态编译作为产品运行依赖。[Win32 原型](../../scripts/probes/r0-windows-job.cs)、[检查入口](../../scripts/probes/r0-windows-job.cjs)、[Microsoft 原子归属说明](https://devblogs.microsoft.com/oldnewthing/20230209-00/?p=107812)、[Job Objects](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects)。

macOS SDK 明确 NOTE_TRACK／NOTE_CHILD 自 10.5 起不再支持；不能照搬 BSD kqueue 的自动递归跟踪。27.0 descendants ES client 是本次发现的候选，当前官网仍带 beta 提示，应以受支持的 SDK／系统与实测冻结边界。它提供事件范围，不等同“helper 一死内核自动杀整树”；尚未证明失联后的完整恢复。[能力探针](../../scripts/probes/r0-macos-es.c)、[Apple API](https://developer.apple.com/documentation/endpointsecurity/es_new_descendants_client(_:_:))、[entitlement 申请要求](https://developer.apple.com/documentation/bundleresources/entitlements/com.apple.developer.endpoint-security.client)。

## 3. Windows 超时：已缩小范围，尚未关闭

首轮历史记录是默认文件并行在 150 秒总时限退出，强杀持锁者检查耗时约 69.6 秒；没有当时的进程启动／信号返回时间线，不能从测试名推断内核 kill 卡住。

本轮新增仅限测试的 preload：每个 PID 分别记录启动、单调时钟／墙钟、心跳、SQLite BEGIN／ROLLBACK、signal 调用及子进程 exit／close；外层 runner 实时落盘，180 秒 watchdog 有界终止自有测试树。[插桩](../../scripts/probes/r0-windows-trace.cjs)、[测试 runner](../../scripts/probes/r0-windows-tests.cjs)。

- 第一次带插桩并行运行约 19.7 秒结束，58 pass／2 fail／1 skip；两个失败是传输包遗漏 harvest／backup-replay 脚本，补齐后重测。该轮不算产品回归通过。
- 完整载荷并行运行 **60 pass／0 fail／1 既有 POSIX skip，43.6 秒**。持锁者 `kill` 调用约 0.475 ms，随后 exit 在约 80 ms 内到达；进程等待与锁操作没有重现历史 69 秒延迟。
- 后续串行轮的总耗时 **382.6 秒，timedOut=true**。同期宿主负载记录达到约 **604**；Windows 的 runner／测试文件第一次 preload 记录已分别在进程单调时间约 **40.2 秒／32.3 秒**，存在进入测试前的长启动延迟。该轮持锁者 kill 约 0.456 ms、随后约 54 ms 收到 exit。记录不足以把其余长延迟定位到某个 OS 调用，不能归咎于 SQLite 死锁。
- 随后的简单命令无响应有**另外一个确定原因**：VM 开着 300 秒闲置自动暂停。Parallels 日志记录 **14:12:47 自动暂停，14:21:06 恢复**。上述串行测试 trace 在 14:12:45 已结束，旧 13:33 的 150 秒超时区间也没有对应暂停；三件事不能混为一个根因。
- 本轮临时关闭闲置自动暂停，待负载下降后，完整载荷仍按默认文件并行通过：**60 pass／0 fail／1 POSIX skip，10.5 秒**；外层 spawn 实测 13 ms。之后恢复自动暂停原值。测试 runner 增加 dispatch／spawn 返回记录和超时后的管道关闭兜底，仅作诊断，不以退出回执冒充进程全部清空。

因此，**已定位 VM 自动暂停造成的命令挂起，确认资源争用轮次存在启动延迟；旧 150 秒超时根因仍未确认。** 不通过增加超时、默认改串行或关闭防护来销项；未改 Defender、用户 PATH 或执行策略。下一次需要在负载可控的 Windows 环境保留同一时间线复现慢样本，再决定修复位置。

## 4. 需要取舍的生产方向

| 选择 | 收益 | 成本／限制 | 建议 |
| --- | --- | --- | --- |
| Windows 独立 native helper＋Linux cgroup 后端 | 两边已有实测机制；Node ≥24 地板、零 npm 依赖可以保持 | Windows 增加原生二进制构建／架构／签名／打包链；Linux 需要可委派 cgroup；还须实现稳定监督器、崩溃回执与恢复互斥 | 可以进入接口／打包设计审批；不意味着 R0 整体通过 |
| macOS 原生 ES helper 路线 | 保留原生工作区／Xcode 等宿主能力；27.0 descendants API 有不提权的候选 | 新原生组件＋Apple entitlement；若限 27+ 就改变支持范围；旧系统使用传统 ES 又涉及 root／TCC；归属持久性与强杀恢复仍待实验，不能承诺获 entitlement 即完成 | 若必须保留原生 macOS 全部工具，先批准专项能力验证，并保持门未通过 |
| macOS 在 Linux VM／容器执行托管任务 | 可以复用已验证 cgroup 方向，减少 macOS 进程跟踪问题 | 用户须安装可用 VM／容器；执行边界变为 Linux，不能运行原生 Xcode／GUI／macOS 专有构建；工作区映射与凭据代理新增设计 | 只有明确接受这项支持范围变化时才可采用 |
| 先独立交付 R3＋确定的 EPERM 修正 | 可以先处理已证明的问题 | F1 继续挂账，不能宣称本可靠性计划完成或无人值守全链回收已实现 | 可另行决定候选范围；本轮不发布 |

推荐先确认是否接受 Windows helper／Linux 委派这个部署成本；macOS 保持原生执行与改为 Linux 执行是实质产品取舍。此报告没有替用户采纳任何一项，也没有改变现行平台支持承诺。

生产协议待冻结项：能力检查、持久启动意图、监督器与 drive 的生命期关系、跨段 attach、一次性停止、确认清空、恢复互斥与 fence、敏感临时材料清理。必须单独覆盖主会话／workers／嵌套评审、绝对截止、新派发阻止、reset／reclaim、旧身份与损坏记录；原型直接模拟的正常／取消收束共用同一底层 API，不算真实 CLI 接线。

## 5. 验证与证据

证据目录：本地忽略的 `artifacts/reliability/r0-followup/`。原生红绿结果、四十轮信号日志、Linux populated 证明、Windows 分 PID 时间线、launchd 反例、ES 能力错误分别保留。首轮旧候选 manifest／包没有覆盖重写。

| 检查 | 结果与覆盖边界 |
| --- | --- |
| macOS EPERM 红绿 | 原生确定反例：2 次信号／EPERM → 1 次信号／成功；新增回归改前 7 pass／1 fail，改后通过；40 次普通夹具全部通过 |
| headless 受影响套件 | macOS 18/18；Linux 非 root／Node 24.0.0 18/18；Windows 13 pass／5 POSIX 专用 skip；Windows 所需归属能力由独立 Job 原型证明，不用 skip 冒充 |
| macOS 全套 | 默认并发高负载轮记录 980 pass／0 fail／1 cancelled，payload-consistency 出现 pending promise；本任务发出终止请求，保留原日志。随后 `--test-concurrency=2` 完整 **983/983 pass、0 cancelled、0 skip，351.4 秒** |
| Windows 账本聚焦 | 最终默认文件并行 60 pass／1 既有 POSIX skip，10.5 秒；历史超时仍单独挂账 |
| 文档／静态检查 | 文档链接与锚点 127 文件通过；改动及新探针 JS 语法检查通过；`git diff --check` 通过；AGENTS 12,208 字节，未超预算 |
| 用户真账 | macOS 全局用量目录 6 个文件在测试前后逐文件 SHA-256 一致 |
| 包验证 | 76 文件逐字节匹配，**没有 C／C#／native probe 进入包**；离线安装、CLI version/help、包内真实 headless 一次清理烟测通过 |

本批包 `package/lazyzcode-0.6.1.tgz` SHA-256：`cbc95c1f9d25647ed9177993f308037af069f49a2b8a18e3ea9bae4755debd36`。首次安装命令早于异步 pack 完成，因包文件未生成失败；在 pack 完成且字节核对后重新离线安装通过，首次日志保留。这是验证编排错误，不是包安装缺陷。

Windows 结束前核对无探针残留进程，删除临时调度任务、任务载荷与从本批 trace 取得的临时目录；恢复 VM 闲置暂停原值与原先 stopped 状态。本地传输 HTTP 服务关闭；Linux 自有容器自动删除，macOS 临时 launchd label／夹具回收。原始证据与开发镜像保留，供复核。

源码与本批证据由独立 `manifest.json` 绑定。HEAD 仍为 `e494cff3b2acf778c46c9f20c14c829736535696`。当前没有生产 native helper、R1/R2、macOS ES entitlement 授权或三平台 P01–P08 全链证据；没有提交、推送、发布、真实模型调用。**原语可行不等于 R0 完成，下一阶段仍需上述取舍与协议验证。**
