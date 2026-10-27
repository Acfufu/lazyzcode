# ADR-0041：托管进程的平台后端方向

日期：2026-10-25。状态：**用户已批准方向；R0 未通过，生产实现未启动。**

普通 POSIX 进程组无法包含 ZCode 正常创建的独立会话后代，逐 PID 扫描也不能消除启动／恢复的身份窗口。因此接受 Windows 独立原生 helper＋Job Object、Linux 真实委派的 cgroup v2；macOS 保留原生执行，先核查 ES helper 与 Apple entitlement 前置条件，不切 Linux VM，不自行缩减旧系统支持范围。Windows 接受新增二进制构建／架构／打包链；Linux 接受需要管理员或宿主提供专用委派，但不在每次执行时提权。macOS 获 entitlement 仍须证明事件完整性与 helper 强杀恢复；27+ API 不等于已决定最低系统版本。付费模型、提交、推送及发布不在本轮授权内。

平台后端负责启动前归属与清空证明，SQLite 负责运行意图、恢复互斥与 fence，二者均不能被裸 PID 替代。具体磁盘协议、接口和宽限仍为 [R0 协议候选](../design-process-lifecycle-r0.md)，须三平台实证后才能冻结并进入 R1/R2。当前所有新 native 载荷仅为离线探针，不进入 npm 包或宿主安装。证据与外部授权见 [本轮报告](../reports/reliability-r0-native-2026-10-25.md)。
