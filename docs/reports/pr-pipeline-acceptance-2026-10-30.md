# GitHub PR 流水线第一批实施与验收

日期：2026-10-30（Asia/Shanghai）。范围：方案 PR01–06 和配置01。第一批实现及 main 确定性/安全语义门已落地，正例已实际合并，负例在无 bypass 阶段由 GitHub 服务器判为不可合并。**fork 路径按用户安排暂挂，验收保持 NOT_RUN**：需要另一 GitHub 归属的实际入口，未由同仓或本地检查替代；其余项继续完成。

本批没有 npm 发布、发布方式迁移或 AI 失败归因试点。npm 发布记录仍为 0.6.2；本批源码修复未发版。真实 ZCode 装载、macOS ES 授权和生命周期 R0 保持各自原有验收状态。

## 单元、候选和合并记录

方案编号与实际 PR 编号分列。head 是 PR 候选，runner 实际 checkout 与 tree 以回执为准。

| 单元 | 实际 PR | 验收 head | main 合并 | 实际检查 |
| --- | --- | --- | --- | --- |
| PR01 SQLite 基线修复 | [4](https://github.com/Acfufu/lazyzcode/pull/4) | b20625b8 | a6938f91 | [41000282535](https://github.com/Acfufu/lazyzcode/actions/runs/41000282535)，5 job 成功 |
| PR02 诊断与固定汇总门 | [5](https://github.com/Acfufu/lazyzcode/pull/5) | 725312a0 | 36204a11 | [41003178690](https://github.com/Acfufu/lazyzcode/actions/runs/41003178690)，6 job 成功 |
| PR03 同一 tgz 安装 | [9](https://github.com/Acfufu/lazyzcode/pull/9) | 7ef8f9d0 | ce47218a | [41004948694](https://github.com/Acfufu/lazyzcode/actions/runs/41004948694)，11 job 成功 |
| PR04 Pages/Jekyll | [10](https://github.com/Acfufu/lazyzcode/pull/10) | 7c961699 | 7fa731bc | [41006314916](https://github.com/Acfufu/lazyzcode/actions/runs/41006314916)，12 job 成功 |
| PR05 SHA/维护/扫描 | [11](https://github.com/Acfufu/lazyzcode/pull/11) | 4465e7e5 | e42d4f80 | [41008267859](https://github.com/Acfufu/lazyzcode/actions/runs/41008267859)，13 job 成功 |
| PR06 CodeQL 接入 | [15](https://github.com/Acfufu/lazyzcode/pull/15) | 7556d34f | dbba5842 | [CI](https://github.com/Acfufu/lazyzcode/actions/runs/41009722418) 和 [CodeQL](https://github.com/Acfufu/lazyzcode/actions/runs/41009722472) 成功，PR 15 项检查成功 |
| PR06 全量告警跟进 | [16](https://github.com/Acfufu/lazyzcode/pull/16) | d9e5256b | 37a56702 | [CI](https://github.com/Acfufu/lazyzcode/actions/runs/41012793329) 和 [CodeQL](https://github.com/Acfufu/lazyzcode/actions/runs/41012793413) 成功，PR 15 项检查成功 |

每个实现候选均保留 Standards/Spec 独立来源评审及其 source-only 边界。它们不是平台强制的人类 approval。完整原始记录在本地 `.omo/evidence/testing/pr-pipeline-20261030/`；关键回执另存 [GitHub 证据目录](https://github.com/Acfufu/lazyzcode/tree/main/docs/evidence/ci-pipeline-2026-10-30)。

## 基线、测试与运行治理

SQLite 修复移除了凭文件时间推断归属并删除数据库的路径；原有“预存缺表数据库具名拒绝且保留原文件”断言保留，新增受控时间错位回归。受控偏移不是 runner 实际时钟偏差的测量。原始 CI 失败、局部/并发对照及本地运行差异见[基线报告](ci-baseline-repair-2026-10-30.md)；本地原生 Node 24.19 曾有 pack 超时，匹配 Node 24.22.1 的全套为 984 通过，未隐藏该失败或弱化安全断言。

PR16 的三平台完整报告对应同一实际 checkout tree `0af863084f881bb01ad7daf9f04b63d78f0aa9fc`：

| 平台 | 实际 Node | 通过 | 失败 | 跳过 | 注册总数 |
| --- | --- | --- | --- | --- | --- |
| macOS | 24.21.0 | 994 | 0 | 0 | 994 |
| Linux | 24.22.1 | 992 | 0 | 2 | 994 |
| Windows | 24.22.1 | 969 | 0 | 24 | 993 |

各平台注册总数分别保留；skip 不计为通过。具名 skip、源位置和原始布尔/文字值在[三平台回执](https://github.com/Acfufu/lazyzcode/blob/main/docs/evidence/ci-pipeline-2026-10-30/pr06/three-platforms.json)中，没有替布尔 skip 编造原因。Node 24.0.0 SQLite 地板与离线安装地板也持续运行。

`CI Required` 对 failure/cancelled/skipped/missing 均拒绝放行；空必需清单也失败。PR02 的真实失败、skipped、取消演练分别在 [6](https://github.com/Acfufu/lazyzcode/pull/6)、[7](https://github.com/Acfufu/lazyzcode/pull/7)、[8](https://github.com/Acfufu/lazyzcode/pull/8) 留档，均已关闭未合并。同 PR 的旧运行被新 push 淘汰，新候选另有自己的成功检查。

main 的不同提交有各自完成的 canonical push 运行。并发机制另以隔离分支复制生产表达式、相同 workflow 名和 push 事件，实际推送三个不同 SHA；[41017254181](https://github.com/Acfufu/lazyzcode/actions/runs/41017254181)、[41017276889](https://github.com/Acfufu/lazyzcode/actions/runs/41017276889)、[41017294011](https://github.com/Acfufu/lazyzcode/actions/runs/41017294011) 的原生时间戳证明重叠，最终均成功。该项是[真实隔离分支实测](https://github.com/Acfufu/lazyzcode/blob/main/docs/evidence/ci-pipeline-2026-10-30/config01/push-concurrency.json)，没有人为造成 main 的重叠 push，也不将其标作 main 生产重叠记录。

最终 [PR24](https://github.com/Acfufu/lazyzcode/pull/24) 的首个候选 c84664f 在 [41020766156](https://github.com/Acfufu/lazyzcode/actions/runs/41020766156) 被门阻止：macOS Node24.22.1 为 993 通过、1 失败，CI Required failure。失败位于既有 worker 分派测试，旧正则在整个 prompt 匹配 N 加数字，出现多余 N3、5+4 的误计。源码和受控对照定位到路径型误计：固定含 N3 的路径在本地 Node24.19 和匹配的官方24.22.1均确定性重现同样结果。原始失败未记录完整 prompt，不宣称恢复了当时的目录名；没有直接重跑直到变绿。

修复提交 `6707134` 及强化提交 `aa4cb09914a176e493873d9d635fa9473d8361f1` 只改该测试：解析显式分派清单，永久保留含 N3 的对抗性路径；仅移除已知路径字面量后，仍在整个 prompt 检查没有额外步骤引用。原两工人/2+1断言保留，并新增 N1/N2/N3 恰好覆盖一次的断言。绑定强化提交的24.22.1定向检查为1通过、0失败、0跳过；独立副本把 N2 分派文字改为 N1、维持2+1数量时，精确覆盖断言仍失败。产品调度代码没有变更；模型执行使用原有 fake engine，未执行真实 provider 工作。首败身份、红绿日志与负控在[末次取证证据](https://github.com/Acfufu/lazyzcode/tree/main/docs/evidence/ci-pipeline-2026-10-30/final)保留，修复后的候选仍须全套托管检查。

## 安装包、文档和维护面

PR03 四个消费方实际使用同一未发布 tgz，SHA256 为 `f8a041d13588df8bb9f563a399ee66670c95f82b79cec43d44db4a9f02d16918`，SHA512 SRI 同样一致；安装 76 文件、部署载荷 25 文件。Windows 走实际安装生成的 `.cmd`，Ubuntu 同时覆盖 24.0.0。摘要损坏、缺 CLI、实际 bin 破坏三个隔离反例均失败。[回执](https://github.com/Acfufu/lazyzcode/blob/main/docs/evidence/ci-pipeline-2026-10-30/pr03/same-package.json)绑定 run/attempt 和真实 checkout；不同 run 即便包摘要相同，也不能冒用旧身份。此结果只证明 runner 的离线安装与载荷。

PR04 用 Ruby 3.3.4、Bundler 2.5.11、锁定的 github-pages 232/Jekyll 3.10.0 真构建，显式载入 Pages 插件；五个入口、内部锚点/链接/baseurl 和非法 Liquid 负控均完成。修正 kramdown GFM 配置和两个被排除文档的链接。合并后的实际 Pages API 显示 built `7fa731b`、error null；[五个真实 HTTP URL](https://github.com/Acfufu/lazyzcode/blob/main/docs/evidence/ci-pipeline-2026-10-30/pr04/live-http.json)均 200，四个双语入口所需锚点存在。首页检查器曾误要求任意 id，修正后使用独立尝试目录；原始失败保留。Pages 来源保持 main `/docs`。

所有自定义 workflow 的外部 action 使用完整 SHA、checkout 不持久化凭据，上游提交来源已取证。固定版本/摘要的 actionlint 与 zizmor 在真实 Linux job 和本地执行，两种工具分别拒绝预期隔离反例，正常 workflow 无发现。[扫描回执](https://github.com/Acfufu/lazyzcode/blob/main/docs/evidence/ci-pipeline-2026-10-30/pr05/scanner-result.json)记录实际下载摘要。平台仍提示部分 v4 Actions 的 Node20 声明已弃用、实际强制 Node24；本批保留已验证版本，major 更新单列待审。

Dependabot 动态更新任务实际成功并提出 [12](https://github.com/Acfufu/lazyzcode/pull/12)、[13](https://github.com/Acfufu/lazyzcode/pull/13)、[14](https://github.com/Acfufu/lazyzcode/pull/14)：兼容 npm 更新分组、Actions major 独立。Actions 同时最多 3 个更新 PR，docs npm/Bundler 独立配置，根包无新增依赖。更新提案没有在本批自动合并，旧 base 的提案须更新后重新完整验收。

补正：早期本地直接运行 preview 链接器所报的 99 页/452 链接来自旧 dist，不计为候选源码证据，原始记录保留且 PR15 说明已更正。d9e5256 的实际源码链接器检查 136 个本地 Markdown 文件通过；本地数量包含未跟踪规划文件。托管 source docs-links 与真实 Jekyll 结果独立绑定各自 checkout。

## CodeQL 与 main 规则

接入前 default setup 为 not-configured，仅新增独立 advanced JS/TS workflow。PR 差异分析为零不能代表 main 全量无告警。首次 main 全量 17 条结果已逐项登记；1–3 自动 fixed，4 在独立源审及真实 canary 正反证后具名 false positive，13 条 medium 保持 open。main 回读 high/critical open 为 0；完整 SARIF 仍有已处置的发现。[告警处置及复核触发](codeql-baseline-triage-2026-10-30.md)保留责任人、范围和未清理项。

[main ruleset 26189284](https://github.com/Acfufu/lazyzcode/rules/26189284) 于 2026-10-30 14:38:45 +08:00 启用。原状 rulesets 为空、classic protection 404；当前 main protected=true。实际[规则快照](https://github.com/Acfufu/lazyzcode/blob/main/docs/evidence/ci-pipeline-2026-10-30/config01/ruleset.json)要求：PR；人类 approval 0；不强制 CODEOWNERS approval；讨论解决；`CI Required` 必须来自 GitHub Actions App15368；严格最新 base；禁止强推/删除；CodeQL 工具结果必需，安全阈值 high_or_higher、普通告警阈值 errors。dev 不增加同等规则。

下表负例使用无 bypass 阶段的 GitHub 实际 PR 合并资格判定；均非 draft、无合并冲突，前六项观察时 base 为 37a5670。**没有向负例发送 merge 请求**。规则配置回读、真实检查来源和服务器资格共同构成证据，不将单独返回规则 JSON 当作生效验收；后续获授权账号的恢复例外不由这些旧负例证明。

| 场景 | 实际 PR | 观察结果 |
| --- | --- | --- |
| 测试失败 | [18](https://github.com/Acfufu/lazyzcode/pull/18) | Ubuntu 故意失败，CI Required failure；BLOCKED |
| 取消 | [17](https://github.com/Acfufu/lazyzcode/pull/17) | 独立 CI 被取消，Windows cancelled、CI Required failure；BLOCKED |
| 缺必需检查 | [19](https://github.com/Acfufu/lazyzcode/pull/19) | 其余真实检查成功，固定来源的 CI Required 缺席；BLOCKED |
| 错误来源冒名成功 | 同 19 | 维护者 classic CI Required success、总 rollup SUCCESS，仍 BLOCKED |
| 新增严重告警 | [20](https://github.com/Acfufu/lazyzcode/pull/20) | CI Required 和 CodeQL 分析 job 成功；实际新增 critical 告警18，独立语义检查失败、BLOCKED |
| 缺 CodeQL 结果 | [21](https://github.com/Acfufu/lazyzcode/pull/21) | CI Required 成功，分析 job skipped、实际 analyses 为空；BLOCKED |
| 全绿正例 | [22](https://github.com/Acfufu/lazyzcode/pull/22) | 15 项成功、CLEAN，实际合并为 786485d3；仅新增无害证据 JSON |
| 过时 base | [23](https://github.com/Acfufu/lazyzcode/pull/23) | 原先 CLEAN；正例推进 main 后，自身 head/15 项成功不变、无冲突，却变 BEHIND（behind 2） |

过时 base 首次查询为 UNKNOWN，未计通过；REST 触发服务器计算后再观察到 BEHIND。PR 的 baseRefOid 快照仍为旧基线，实际 main tip 另由 branches API 核对。负例和原聚合门演练 PR 均关闭未合并，源码及运行记录保留。强推/删除和讨论解决只核配置，没有执行破坏性操作或创建测试讨论。

最初增加长期恢复例外的请求曾在执行前被自动审批拒绝，理由是具体账号及长期作用范围尚未明确批准；[原阻断记录](https://github.com/Acfufu/lazyzcode/blob/main/docs/evidence/ci-pipeline-2026-10-30/config01/bypass-policy-block.json)及[无 bypass 阶段快照](https://github.com/Acfufu/lazyzcode/blob/main/docs/evidence/ci-pipeline-2026-10-30/config01/ruleset-no-bypass-phase.json)保持原样，属于历史事实，不再表示批准待答。用户随后明确选择“批准仅 Acfufu 的 PR 恢复例外”，该[授权及 fork 安排](https://github.com/Acfufu/lazyzcode/blob/main/docs/evidence/ci-pipeline-2026-10-30/config01/recovery-user-decisions.json)已单独登记。

2026-10-30 22:05:07 +08:00，GitHub 接受并经独立 GET 回读：只增加 `User` 73582072（Acfufu），`bypass_mode=pull_request`；其余名称、目标、启用态、main 范围及全部规则字段与变更前一致，[逐字段核对](https://github.com/Acfufu/lazyzcode/blob/main/docs/evidence/ci-pipeline-2026-10-30/config01/recovery-readback-delta.json)和[准确请求](https://github.com/Acfufu/lazyzcode/blob/main/docs/evidence/ci-pipeline-2026-10-30/config01/recovery-request.json)保留。没有扩大为管理员角色、其他账号或 always 模式。GitHub 不机械区分恢复与日常，该账号经 PR 绕过检查的能力已授予；日常仍按流程等待全绿。恢复 PR 须记录原因、操作者、跳过项及补验计划，恢复后补验并留结果。此次验收范围是配置提交与独立回读，实际绕过失败 PR、直推、强推及删除演练均未执行；不能称恢复行为已实测。

此前严格阶段的 [PR24](https://github.com/Acfufu/lazyzcode/pull/24) 候选 a62e3d3f 经过 15 项检查后合并为 main `934d9c7e`。[main CI 41025146142](https://github.com/Acfufu/lazyzcode/actions/runs/41025146142) 13 个 job 全部成功，三平台失败均为 0（Linux 跳过 2、Windows 跳过 24）；[CodeQL 41025146186](https://github.com/Acfufu/lazyzcode/actions/runs/41025146186) 全量分析 2060757335 无 error/warning，open high/critical 为 0、medium 13；[Pages 41025145229](https://github.com/Acfufu/lazyzcode/actions/runs/41025145229) built 到该 SHA，五个真实 HTTP200 页面及所需锚点检查通过。[当时最终回执](https://github.com/Acfufu/lazyzcode/blob/main/docs/evidence/ci-pipeline-2026-10-30/final/pr24-main-verification.json)绑定 tree `f922f01501a8471bf5dcfce5920e4d6276162ec4`，13 份原始产物及完整日志另以 93 个文件摘要保存在本地；该快照中的无 bypass 状态属于启用恢复例外之前。

## 尚未验收及证据保存

fork 实测仍缺另一归属入口：仓库现有 forks 与账号 orgs 均为空，同账号创建 fork 的实际尝试返回原仓库且 fork=false，未创建新 fork，不能算成功。用户现已选择“fork 验收暂挂，先完成其余项”，安排状态为暂挂，验收仍为 NOT_RUN，不再等待该入口推进其余项。同仓正确 SHA 的分析、隔离 push、Dependabot 或本地 payload 均未被冒充 fork 权限验收；暂挂不会将 NOT_RUN 变为 PASS。

CI 诊断/候选 artifact 配置保留 14 天；取消或 runner 丢失可能没有完整上传，缺产物不推导成功。关键 JSON、日志、skip 与 SHA 摘要已提交到证据目录，完整原始输出留在本地执行目录。后续文档 PR 同样须完整 CI/CodeQL 及 main 合并后检查，其实际提交与平台记录绑定本报告修订；恢复例外的存在不改变本次正常合并先检查全绿的流程。
