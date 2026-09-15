# ADR-0012: lzy update 用全新子进程跑 sync

日期：2026-09-16 · 状态：已接受 · 拍板：grilling 2026-09-16（goal v006-closeout）

`lzy update`（等价 `npm install -g lazyzcode@latest` + `lzy sync` 的糖命令）在 npm
升包成功后，**spawn 一个全新 `lzy sync` 子进程**（从 npm 全局 prefix 的新安装路径
解析），而不是在当前进程内直接跑 sync。

**Why**：npm 安装会整体替换包目录，而运行中的 lzy 进程还持有旧代码——`import.meta.url`
指向的磁盘路径已换新、内存里的模块还是旧版。进程内 sync 意味着「旧逻辑部署新载荷」：
sync 逻辑跨版本一旦变更（目录布局、注册表形状、原子部署策略），行为漂移且由每个中间
版本自证，无人兜底。多 spawn 一程的成本微乎其微（一次进程启动），换来的是升级链上每个
环节都由当版本代码执行。sync 子进程失败时按恢复式报错处理：明说「npm 已升级、sync 未跑」
的中间态（当前会话仍用旧版），给出手动 `lzy sync` 指引——沿无 goal 出口恢复式报错先例。

**Consequences**：版本探测用 `npm view lazyzcode version` 对照本地版本（同则「已是最新」
退出）；spawn npm 走 engine.js 安全形态（字面量 argv + `shell:false`）；npm 缺席时优雅
报错指路手动两步（零依赖红线不动）；「config.json 零写入」红线不涉（npm 写自己的 prefix，
sync 写引擎缓存与注册表）。真取舍：否决了省一次 spawn 的进程内方案（自指风险）与「只装
不 sync+提示」的保守方案（与现状两步无差别，糖命令价值减半）。
