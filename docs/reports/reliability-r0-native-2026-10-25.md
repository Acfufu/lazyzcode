# R0 原生后端：授权方向后的能力验证

日期：2026-10-25。承接 [R0 后续](reliability-r0-followup-2026-10-25.md)。用户已同意 Windows 原生 helper＋Linux cgroup，macOS 保留原生、先验证 ES／Apple entitlement，不切 Linux VM；禁止提交、推送、付费模型。方向记入 [ADR-0041](../adr/0041-managed-process-backends.md)，[协议候选](../design-process-lifecycle-r0.md)仍待实证冻结。

**结论：R0 未通过。** 本轮增加独立 Win32 EXE 和 Linux 恢复身份／互斥实证；macOS 在本机确认 Apple entitlement 前置阻塞。新增代码均在 `scripts/probes/`，不接入生产、不更改 npm 白名单，不修改已安装 ZCode。R1/R2 未启动，既有 R3 证据不被本轮原型替代。

## 1. 已验证

| 平台 | 实际环境与检查 | 结果及边界 |
| --- | --- | --- |
| Windows | Windows 11 arm64、Node 24.19.0；自写 C 编译为静态链接 x64 Win32 EXE；SYSTEM 和已登录用户 Limited 各执行 6 场景 | 正常／取消共用 stop、stdin EOF、helper 强杀、线程放行前强杀、Job 名冲突均通过。跨段复用同一 HTTP 服务，独立会话后代被包含；观察器持 SYNCHRONIZE 进程句柄确认停止，组外 canary 继续。含空格／中文目录通过。是 x64 EXE 在 arm64 Windows 上运行，不是 arm64 原生构建或真实 x64 OS 验收；尚无生产恢复／签名／包安装 |
| Linux | 隔离特权容器挂载自己的 cgroup namespace，仅委派专用子树；Node **24.0.0**、UID 1000 执行恢复探针 | 活跃控制器、错误 boot／mount／group／base／路径／fence、损坏记录共 8 类均拒绝且心跳继续；控制器强杀后，两真实恢复进程仅一方回收，另一方读到 already-clean；populated 0、心跳停止、canary 继续。另以 canary PID＋错误出生身份模拟 PID 复用，canary 未被误杀；不是实际 PID 回绕。默认只读 cgroup 容器在 mkdir 处 EROFS、未启动夹具；不是产品 doctor 已接线 |
| macOS | macOS 27.0.1、arm64、Node 24.19.0、本机 Xcode SDK；无受限 entitlement 的 ad-hoc 能力二进制 | `-Wall -Wextra -Werror` 编译通过；UID 501 的 descendants-only 调用返回 `NOT_ENTITLED`（3），进程 exit **78**，workloadLaunches=0。无订阅、不调用传统全系统 ES、不申请 root／FDA。签名身份和已有 profile 的只读核查见下节 |

Windows 源码：[native helper](../../scripts/probes/r0-windows-native.c)、[场景驱动](../../scripts/probes/r0-windows-native.cjs)。编译器只在隔离开发容器中安装；EXE 运行时不动态编译，也不依赖 PowerShell／CLR。PowerShell／任务调度器仅用于传输和以普通用户运行验证，不是产品运行依赖。`cancel` 场景调用与 normal 相同的 stop 原语，不是已经实现 CLI 取消接线。Job 名碰撞分支只关闭本次打开的句柄，不向原 Job 发停止命令。

Linux 源码：[恢复探针](../../scripts/probes/r0-linux-recovery.mjs)。新实验用 SQLite 写锁串行化两恢复者，且持锁等待清空；这是隔离机制证明，产品短事务＋恢复 lease／fence 尚待实现。先前[跨段与强杀原语](../../scripts/probes/r0-linux-cgroup.mjs)证据另存，没有把所有生命周期场景重新标为本批通过。

macOS 源码：[能力检查](../../scripts/probes/r0-macos-es.c)、[可重复前置核查](../../scripts/probes/r0-macos-prerequisites.mjs)。入口 `node scripts/probes/r0-macos-prerequisites.mjs` 默认只编译未授权探针及检查公开签名元数据；会返回 78，而不是跳过后报成功。首轮 profile XML 转 JSON 遇到 Data 类型失败，已改为 plistlib 仅提取白名单字段后复跑；没有保存原始 profile、设备列表、证书邮件或私钥。

## 2. Apple 前置条件与需要用户介入的授权

本机核查：可用 Apple Development 身份 **1** 个；Developer ID Application **0** 个。两个常规 profile 目录中找到的 **1** 份 profile 的 Platform 为 iOS／xrOS／visionOS，ES entitlement=false，且没有 macOS application identifier。**这只证明本机已查位置没有合适的凭据，不证明 Apple 账号没有获批或其他位置没有材料。** 本轮未登录开发者门户、未签发证书、未使用现有私钥签名。

Apple 当前[descendants API 文档](https://developer.apple.com/documentation/endpointsecurity/es_new_descendants_client(_:_:))与 SDK 均声明：macOS 27+、限定调用进程及后代、需要 ES entitlement，不要求 root 或 TCC。网页仍标 beta，不能凭本机系统版本把支持范围升为 27+。[ES entitlement 文档](https://developer.apple.com/documentation/bundleresources/entitlements/com.apple.developer.endpoint-security.client)要求向 Apple 申请；[申请入口](https://developer.apple.com/system-extensions/)的 Contact us 转开发者账号表单。

| 介入项 | 需要你提供／执行的内容 | 前置性 |
| --- | --- | --- |
| Apple 账号与权限 | 确认用于 LazyZCode 的 Developer Program Team；由有权限成员审阅并提交下节申请。若已获批，直接提供对应 macOS profile 的本地路径即可；无需导出私钥到聊天 | 继续 ES 运行验证的当前外部前置条件；本机 Apple Development 身份不能替代 Apple 授权 |
| App ID／开发 profile | 确认实际 bundle ID（候选 `io.github.acfufu.lazyzcode.process-helper`，尚未注册），取得包含 ES entitlement、有效期／Team／App ID 与本机签名身份匹配的 macOS 开发 profile；允许使用该身份签名隔离测试 helper | 获批后才测试；不安装系统级 profile，不篡改 entitlement |
| 分发材料 | 将来发布前提供 Developer ID Application、对应分发 profile 和公证流程授权 | **不阻塞当前离线 R0 开发探针**；本轮不申请或发布 |
| Linux 宿主部署 | 实际目标宿主需管理员／服务管理器只委派专用 cgroup 子树；安装前另给具体路径、用户与回滚命令 | 本轮隔离实验无需你操作；不把特权 Docker 作为产品要求 |

受限 entitlement 不能靠在裸 EXE 上添加布尔 key 获得。Apple [签名 daemon 的说明](https://developer.apple.com/documentation/xcode/signing-a-daemon-with-a-restricted-entitlement)与 [TN3125](https://developer.apple.com/documentation/technotes/tn3125-inside-code-signing-provisioning-profiles)要求此类 standalone helper 使用可嵌 profile 的 app-like bundle；后续准备 `Contents/MacOS/…`、Info.plist 与 `Contents/embedded.provisionprofile`，核对 Team／identifier／entitlement／证书后再签名。裸探针只作未授权错误证明，不是可分发布局。

本轮未关闭 SIP、未申请 FDA、未安装 LaunchDaemon／系统扩展，也没有把 Apple 授权等同完整生命周期可行。获授权后首先需证明 fork 事件完整性、队列溢出检测、helper 在登记窗口强杀、重启后孤儿可发现性和 audit-token 身份回收；新 descendants client 能否恢复旧 helper 的孤儿子树目前未知。该问题即使获批仍可能使 R0 失败。

## 3. Apple 申请草稿（待用户审阅，未发送）

以下只描述拟验证用途；Team、最终 App ID 和账号联系信息由账号成员在表单填写。当前没有可用的用户写作检索工具，按本轮明确事实与直接表述整理，不声称已匹配历史写作样本。

> Product: LazyZCode, an open-source CLI and workflow discipline plugin for ZCode.
>
> We would like to request the `com.apple.developer.endpoint-security.client` entitlement to evaluate a native macOS process-lifecycle helper using `es_new_descendants_client` on macOS 27 and later.
>
> The intended scope is the helper's own descendant processes: coding-engine sessions, their local tools, and background services that may create separate process groups. We need to track those processes across workflow segments and verify cleanup when the workflow ends or its controller crashes. We do not intend to monitor unrelated applications or user activity.
>
> This is a feasibility evaluation. We have not yet established complete event delivery, orphan recovery after helper termination, or production compatibility. Apple approval would allow us to test those conditions with local fixtures before any release. No model access or remote execution is needed for these tests.
>
> Could you confirm whether this use of the descendants-scoped API is eligible, and the required development and Developer ID provisioning arrangements for a signed helper in an app-like bundle? We understand that entitlement approval does not itself establish reliable containment or recovery.

## 4. 状态、验证与后续

本轮证据根：本地忽略的 `artifacts/reliability/r0-native/`。其中 macOS `result.json` 保存 SDK／源码／二进制摘要及脱敏 profile 摘要；Windows 两个身份运行日志、编译产物、Linux 两轮结果与未委派反例分别保留。源码／证据哈希另以本批 manifest 绑定，不重写上轮候选或包证据。

R0 尚欠及下一步按[协议候选](../design-process-lifecycle-r0.md)第 4 节执行。当前没有生产 helper、主会话／workers／嵌套评审接线、三平台 P01–P08 全链或真实 ZCode/provider 证据。macOS 授权是当前三平台门的外部前置条件；Windows／Linux 新原型也仍有恢复协议与打包兼容工作。未提交、未推送、未发布、未运行付费模型。

既有 headless 聚焦回归 **18/18 pass、0 skip**；新增 JS 探针语法检查、130 个 Markdown 文件链接／锚点检查、`git diff --check` 通过；AGENTS 为 **12,267 字节**，未超 12 KiB。本轮未改产品 JS，未重复跑全套；上轮 983 全绿不记作本轮重测。Windows EXE 使用 MinGW GCC 12-posix、`-std=c11 -Wall -Wextra -Werror -O2 -municode -static` 构建；导入表只有 KERNEL32.dll、msvcrt.dll，没有 .NET／PowerShell 依赖。

清理后核对：Windows 专属临时目录、任务均删除，探针进程数为 0，VM 恢复原先 stopped；本地传输 HTTP 服务及本轮自有构建容器已关闭。Linux 验证容器 `--rm` 删除，macOS 无本批后台夹具。Windows 100 个证据文件以 zip 保存在本地忽略目录。首次归档命令因 VM 300 秒闲置暂停超时；确认 paused、恢复后重新归档并清理成功，没有改自动暂停设置。这是归档阶段问题，不是已经结束的 12 场景超时。

包白名单干跑确认 **76 文件，无 native／probe 载荷**，未生成新 tarball 或进行安装。首次核验脚本把 npm 12 的按包名键控 JSON 当旧数组解析而失败；核查本机 npm 实现后，用保存的原始输出按正确形状解析通过。该编排错误不记作产品失败，原始输出与边界回执保留。
