# CI 与合并检查

`CI Required` 是确定性检查的固定汇总状态。必需 job 必须全部为 `success`；失败、取消、跳过和缺失都拒绝放行。job 内按既有平台能力规则跳过的测试会在报告中保留名称及原因。没有产物不表示检查通过。CodeQL 的安全告警门独立于此工作流。

CI 每个 PR 完整运行 Node 24 三平台、文档链接和 Node 24.0.0 SQLite 地板。三平台矩阵不会因另一平台失败而取消。测试超时 30 分钟，文档链接 10 分钟，地板 15 分钟，汇总 5 分钟；原基线 runner 为分钟量级，先采用有余量的边界，后续根据完成运行的耗时校准。

`package-build` 从当前 checkout 真正 pack 一次，输出未发布候选 tgz、SHA256、SHA512 SRI、源码身份和包内逐文件摘要。三平台 Node 24 及 Ubuntu Node 24.0.0 的 `package-smoke` 下载同一 artifact，校验身份与摘要，在独立 prefix、用户目录和 cache 中离线安装，运行实际安装的 bin（Windows 为 `.cmd`），再从已安装包调用载荷部署原语并核对文件集合及摘要。此检查不需要 ZCode 或账号，不代表真实宿主装载通过。三个隔离反例覆盖摘要损坏、缺少 CLI 和实际 bin 失败；它们不得进入公开候选包。

候选 artifact 名称包含 run attempt，保留 14 天。重跑候选检查时应重跑整次工作流，以便包准备和所有消费方使用同一 attempt；只重跑失败消费 job 不会悄悄改用旧 attempt 的包。`package-build`、`package-smoke` 均为 `CI Required` 的直接前置，单个成功安装不能代替整个矩阵。

`docs-build` 在 Ubuntu 24.04 上使用 Ruby 3.3.4、Bundler 2.5.11 和锁定的 `github-pages` 232（Jekyll 3.10.0），与 [Pages 公布的依赖集](https://pages.github.com/versions/) 对齐。独立工具目录的 Gemfile 必须通过 `BUNDLE_GEMFILE` 指定，构建显式载入 `github-pages` 才能启用 Pages 默认插件；仅运行裸 Jekyll 会漏掉无 front matter 页面处理等平台行为。实际托管 Pages 部署须在 main 合并后另行回读，容器或 PR 构建不能代替部署成功。

真实构建核对首页、双语 guide/developers 的输出、内部链接、锚点和静态资源 baseurl；隔离非法 Liquid 页面必须因 Liquid 语法错误失败。站点使用 kramdown 的 GFM parser 保持 GitHub 风格的中文/符号标题锚点；被 Pages 排除的评审档链接到 GitHub 源文件。PR 只构建，现行 main `/docs` 的 Pages 来源保持不变。

全部自定义 workflow 的外部 action 使用完整提交 SHA，checkout 关闭凭据持久化。Dependabot 每周维护 Actions、独立 docs-preview npm 工具和 Jekyll Bundler 依赖；Actions 同时最多三个更新 PR，minor/patch 分组，major 单列，不增加根 npm 依赖项。更新 PR 同样经过完整合并检查，配置被读取和实际首个更新 PR 的出现要分别验收。

`workflow-check` 使用 `scripts/ci/workflow-tools.json` 中固定版本和 SHA256 的 actionlint/zizmor 二进制，下载后先核摘要。zizmor 静态检查以 offline 模式运行，fork 路径无需额外 token。两种工具各有隔离反例，防止扫描入口空跑。工具升级须同步版本/摘要并复验反例及完整 CI；扫描发现按位置修复，不全局关闭规则。诊断和下载摘要保留 14 天。

CodeQL 使用独立 advanced setup，固定 action SHA，分析 JavaScript/TypeScript，`build-mode: none`；PR、main push 和每周定时运行。启用前确认 default setup 未同时配置。只有分析 job 获得 `security-events: write`，其余保持只读，不使用 secrets 或 `pull_request_target`。同仓与 fork 的实际分析、SARIF 上传、源码 SHA 和权限结果分别记录；fork token 的平台权限降级不由仓库脚本绕过。上传拒绝或分析失败按真实失败处理，不加 `continue-on-error`。Dependabot PR 同样走 `pull_request` 事件，避免只读 token 在 push 上传时受限，参见 [GitHub 排障说明](https://docs.github.com/en/code-security/reference/code-scanning/troubleshoot-analysis-errors/resource-not-accessible)。

分析 job 成功只表示扫描和上传完成。安全告警由独立 code scanning merge protection 判断，不能以 `CI Required` 或 CodeQL job 的成功状态替代。告警处置由维护者逐条记录规则、位置、严重度、分析 SHA、证据和结论：真实问题修复后复扫；误报或仅测试用途按具体告警说明理由、责任人及复核触发条件后再处置，不批量 dismiss 或整体关闭规则。新增 high/critical 告警、必需工具缺结果，以及隔离反例的实际阻止结果须单独验收。仓库能力不支持语义门时明确标为观测态；尚未执行的 fork 验收保持未执行。

同一 PR 的新候选取消旧运行；push 按事件及提交 SHA 分组，main/dev 的不同 SHA 不互相替换。汇总使用 `always()` 但显式检查每个上游结果。新的必需 job 须同时加入 `needs` 和 `REQUIRED_JOBS`。改名时先跑通新检查、迁移远端规则，再删除旧名。

`scripts/ci/run-checks.mjs <输出目录> [测试路径…]` 用 Node 内置 spec/JUnit 和事件 reporter 运行测试，保存原退出码、信号、完整日志、机器报告、具名跳过及源位置、实际 checkout SHA/tree、PR head/base、run/attempt、OS/架构及 Node/npm。传入 `--script <Node 脚本> [参数…]` 时保存普通检查的日志与 JSON 回执，文档链接、CLI help 及 SQLite 能力探针也走这条路径；探针失败仍有执行前身份及失败回执。报告在失败时也尝试上传，保留 14 天；取消或 runner 丢失可能来不及上传。PR 默认测试合并候选，报告中的 checkout 不能当作 PR head。旧测试使用布尔 skip 时如实保留布尔值及源位置，不伪造具体原因。

本地复核可运行 `node --test test/ci-required.test.js`，以及 `node scripts/ci/run-checks.mjs artifacts/ci-local test/sqlite-migrate.contract.test.js`。包装器的失败、skip 与退出码行为另用隔离 fixture 核验；不要把故意失败的 fixture 合入测试目录。

单独检查地板探针并保存回执：`node scripts/ci/run-checks.mjs artifacts/sqlite-probe --script scripts/sqlite-capability-probe.mjs`。命令非零退出会原样传递给调用者，产物目录仍保存执行身份与失败日志。

平台 runner、离线安装与浏览器结果各有验收边界；本流水线不证明真实 ZCode 装载、macOS ES 授权或托管进程生命周期通过。发布仍按现行维护者手工流程执行。

main 规则要求 PR、固定来源的 `CI Required`、最新 base、讨论解决及 CodeQL 语义结果；单维护者的人类 approval 数为 0，不强制 CODEOWNERS approval。实际规则和演练证据见[第一批验收报告](../reports/pr-pipeline-acceptance-2026-10-30.md)。当前没有长期 bypass。若故障锁死，维护者须先记录 PR、原因、操作者、受影响检查和补验计划，再临时调整具体规则；恢复后还原规则并重新验收。普通合并始终先确认固定 head、最新 base 和全部必需检查成功，不能用本地绿灯代替远端状态。
