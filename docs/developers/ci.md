# CI 与合并检查

`CI Required` 是确定性检查的固定汇总状态。必需 job 必须全部为 `success`；失败、取消、跳过和缺失都拒绝放行。job 内按既有平台能力规则跳过的测试会在报告中保留名称及原因。没有产物不表示检查通过。CodeQL 的安全告警门独立于此工作流。

CI 每个 PR 完整运行 Node 24 三平台、文档链接和 Node 24.0.0 SQLite 地板。三平台矩阵不会因另一平台失败而取消。测试超时 30 分钟，文档链接 10 分钟，地板 15 分钟，汇总 5 分钟；原基线 runner 为分钟量级，先采用有余量的边界，后续根据完成运行的耗时校准。

同一 PR 的新候选取消旧运行；push 按事件及提交 SHA 分组，main/dev 的不同 SHA 不互相替换。汇总使用 `always()` 但显式检查每个上游结果。新的必需 job 须同时加入 `needs` 和 `REQUIRED_JOBS`。改名时先跑通新检查、迁移远端规则，再删除旧名。

`scripts/ci/run-tests.mjs <输出目录> [测试路径…]` 用 Node 内置 spec/JUnit 和事件 reporter 运行测试，保存原退出码、信号、完整日志、机器报告、具名跳过、实际 checkout SHA/tree、PR head/base、run/attempt、OS/架构及 Node/npm。报告在失败时也尝试上传，保留 14 天；取消或 runner 丢失可能来不及上传。PR 默认测试合并候选，报告中的 checkout 不能当作 PR head。

本地复核可运行 `node --test test/ci-required.test.js`，以及 `node scripts/ci/run-tests.mjs artifacts/ci-local test/sqlite-migrate.contract.test.js`。包装器的失败、skip 与退出码行为另用隔离 fixture 核验；不要把故意失败的 fixture 合入测试目录。

平台 runner、离线安装与浏览器结果各有验收边界；本流水线不证明真实 ZCode 装载、macOS ES 授权或托管进程生命周期通过。发布仍按现行维护者手工流程执行。
