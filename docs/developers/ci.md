# CI 与合并检查

`CI Required` 是确定性检查的固定汇总状态。必需 job 必须全部为 `success`；失败、取消、跳过和缺失都拒绝放行。job 内按既有平台能力规则跳过的测试会在报告中保留名称及原因。没有产物不表示检查通过。CodeQL 的安全告警门独立于此工作流。

CI 每个 PR 完整运行 Node 24 三平台、文档链接和 Node 24.0.0 SQLite 地板。三平台矩阵不会因另一平台失败而取消。测试超时 30 分钟，文档链接 10 分钟，地板 15 分钟，汇总 5 分钟；原基线 runner 为分钟量级，先采用有余量的边界，后续根据完成运行的耗时校准。

`package-build` 从当前 checkout 真正 pack 一次，输出未发布候选 tgz、SHA256、SHA512 SRI、源码身份和包内逐文件摘要。三平台 Node 24 及 Ubuntu Node 24.0.0 的 `package-smoke` 下载同一 artifact，校验身份与摘要，在独立 prefix、用户目录和 cache 中离线安装，运行实际安装的 bin（Windows 为 `.cmd`），再从已安装包调用载荷部署原语并核对文件集合及摘要。此检查不需要 ZCode 或账号，不代表真实宿主装载通过。三个隔离反例覆盖摘要损坏、缺少 CLI 和实际 bin 失败；它们不得进入公开候选包。

候选 artifact 名称包含 run attempt，保留 14 天。重跑候选检查时应重跑整次工作流，以便包准备和所有消费方使用同一 attempt；只重跑失败消费 job 不会悄悄改用旧 attempt 的包。`package-build`、`package-smoke` 均为 `CI Required` 的直接前置，单个成功安装不能代替整个矩阵。

同一 PR 的新候选取消旧运行；push 按事件及提交 SHA 分组，main/dev 的不同 SHA 不互相替换。汇总使用 `always()` 但显式检查每个上游结果。新的必需 job 须同时加入 `needs` 和 `REQUIRED_JOBS`。改名时先跑通新检查、迁移远端规则，再删除旧名。

`scripts/ci/run-checks.mjs <输出目录> [测试路径…]` 用 Node 内置 spec/JUnit 和事件 reporter 运行测试，保存原退出码、信号、完整日志、机器报告、具名跳过及源位置、实际 checkout SHA/tree、PR head/base、run/attempt、OS/架构及 Node/npm。传入 `--script <Node 脚本> [参数…]` 时保存普通检查的日志与 JSON 回执，文档链接、CLI help 及 SQLite 能力探针也走这条路径；探针失败仍有执行前身份及失败回执。报告在失败时也尝试上传，保留 14 天；取消或 runner 丢失可能来不及上传。PR 默认测试合并候选，报告中的 checkout 不能当作 PR head。旧测试使用布尔 skip 时如实保留布尔值及源位置，不伪造具体原因。

本地复核可运行 `node --test test/ci-required.test.js`，以及 `node scripts/ci/run-checks.mjs artifacts/ci-local test/sqlite-migrate.contract.test.js`。包装器的失败、skip 与退出码行为另用隔离 fixture 核验；不要把故意失败的 fixture 合入测试目录。

单独检查地板探针并保存回执：`node scripts/ci/run-checks.mjs artifacts/sqlite-probe --script scripts/sqlite-capability-probe.mjs`。命令非零退出会原样传递给调用者，产物目录仍保存执行身份与失败日志。

平台 runner、离线安装与浏览器结果各有验收边界；本流水线不证明真实 ZCode 装载、macOS ES 授权或托管进程生命周期通过。发布仍按现行维护者手工流程执行。
