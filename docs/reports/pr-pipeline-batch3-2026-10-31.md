# GitHub PR 流水线第三批：只读失败归因（PR09）

日期：2026-10-31（Asia/Shanghai）。用户授权先完成本地实现和验证，模型配置需要时再提供；本地验证完成后追加授权提交、推送并创建草稿 PR，交付分支为 `codex/ci-failure-triage`。基线为本地 main `4d6c0ca0a5602c6130b2ab99b40e6068fe6cedda`，origin 指向 Acfufu/lazyzcode。原两份未跟踪的规划/调研文件原样保留，不纳入提交。PR09 是方案编号；本报告不将草稿交付视为已合并或托管验收完成，未改变远端规则或模型配置。

## 实现范围

- 独立 `ci-triage.yml`：仅 main 手动派发，默认 collection-only；最小只读权限、固定 action SHA、禁用 checkout 凭据持久化、10 分钟超时、独立 14 天诊断 artifact。现有 `ci.yml`、`CI Required`、CodeQL 和 ruleset 不改。
- `triage-collect.mjs`/`triage-lib.mjs`：校验指定 run/attempt 和 job/artifact 身份；同仓 PR 和 main push；报告优先、失败日志补充；原始行号/来源、checkout 与 head 分开、历史候选回查、缺证据与截断具名。无法建立 PR 关联时拒绝继续，不猜测历史身份。
- `triage-zip.mjs`：零依赖、内存内读取被动 JSON；体积/展开/路径/软链接/CRC 防护；不执行目标提交或 artifact 内容。网络重定向不转发 GitHub 凭据。
- `triage-model.mjs`/`triage-prompt.txt`：单一 Chat Completions 协议适配入口，无模型工具、无重试；严格引用/schema 校验；预请求费用保留与 usage 回执。配置 `.github/ci-triage-model.json` 默认禁用，不提供任何真实 endpoint、模型或 key。
- `triage.mjs`：统一 CLI/工作流入口，错误也写诊断回执和安全转义 summary；模型故障仅使独立诊断失败。建议命令保持为文本，由维护者判断。

每次最多一个请求，低于原方案三次上限；请求前按已核验模型/token 上界/价格预留，单次不超过 US$0.50。前 20 个 workflow run_number、付费拒绝 rerun，将试点请求预留限制在 US$10；collection-only、失败和取消也消耗序号。维护者未配置/核验协议、token 边界、价格和密钥前不能开放付费调用。这是有前提的请求限额，不宣称已经验证提供商账单上限。

详细运行方式、模型接入条件与限制见[开发者说明](../developers/ci-triage.md)。这项可逆辅助入口沿用已批准的 PR09 范围，无产品决策或发布方式变更；不新增 ADR。根包零 npm 依赖保持，全部实现与提示词自写。

## 本地验证

证据根目录：`.omo/evidence/testing/pr09-20261031/`。测试 runner 为本机 Node24.19.0/macOS；假 API/假模型响应只验证机制，不证明托管流程或真实模型准确率。

| 检查 | 结果与证据 |
| --- | --- |
| 初版定向测试 | PASS：73 通过、0 失败、0 跳过；`a1/targeted/`，覆盖 PR09 与既有 required gate、release-candidate 回归 |
| 日志窗口改进后的定向测试 | PASS：74 通过、0 失败、0 跳过；`a3/targeted/`；另加长 setup 不挤掉最终断言/尾部日志的回归 |
| 最终输出脱敏后的定向测试 | PASS：75 通过、0 失败、0 跳过；`a5/targeted/`；覆盖最终采集/模型/CLI 代码，另加提供商回显凭据的输出脱敏回归 |
| 工作流扫描 | PASS：钉版 actionlint1.7.12/zizmor1.31.1 正常文件无发现，非法依赖和不安全 workflow 负控被拒；`a2/workflow-check/`。`a1/workflow-check/` 保留外层网络限制导致的 fetch 失败；允许下载后只做一次同代码对照 |
| 全套首跑 | FAIL：1059 注册、1045 通过、14 失败、0 跳过；`a1/full/`。13 项为监听 EPERM/嵌套 Seatbelt 拒绝，1 项为 pack dry-run 的 300 秒超时。启动于日志窗口和输出脱敏改进之前，不能冒称最终代码全套全绿 |
| 失败四文件一次受控对照 | PASS：仅在外层沙盒之外按原代码重跑 payload-consistency、review-artifacts、review-os-sandbox、review-proxy，20 通过、0 失败、0 跳过；`a4/failed-files/`。pack 约95.6秒通过，首跑超时根因仍未确定。不是第二次全套，不覆盖首败 |
| 文档链接/差异/AGENTS 预算 | PASS：docs-links 扫描140文件（含两份原本未跟踪的规划文件）；git diff --check；AGENTS.md 12274字节，低于12KiB。最终命令回执与文件摘要见本地 `verification.json` |

涉及的机制场景包含：错误来源/事件/attempt、PR merge checkout 与 head 分离、历史/新 attempt、取消/过期/缺日志、ZIP 边界与 CRC、被动指令文本/脱敏、伪造引用拒绝、工具调用响应拒绝、模型超时/429/无 usage/型号漂移/截断、无重试、单次和累计预留限制、CLI 错误回执。

全套与定向均出现 Node 多 reporter 的 MaxListenersExceededWarning，实际退出码及统计如上保留；未为消除警告改动既有 runner。新增能力不存在旧版可运行入口，红半采用具名负向场景；没有把模拟模型调用当作真实归因双证据。

## 本地采集器访问真实 GitHub 的结果

这些是本地脚本访问既有远端只读资源的证据，不是新增 `ci-triage.yml` 已在 Actions 成功运行：

| 检查 | 实际结果 |
| --- | --- |
| 历史 main 运行，匿名采集 | `a1/live-collection/`：run41070942593/attempt1 的 API conclusion=cancelled；两个目标日志 403，明确缺证据；模型请求0。没有用 attempt2 的 success 覆盖旧 attempt |
| 同一次历史运行，现有 GitHub CLI 凭据 | `a2/live-collection/`：COLLECTED，读取 CI Required 失败日志片段；另一个 cancelled job 日志404，实际 checkout 缺失具名；latestAttempt=2、当前 main 已不同，HISTORICAL；模型请求0 |
| 历史 PR 关联缺失负例 | `a3/live-collection/`：run41020766156 的 PR 关联缺失，BLOCKED，模型请求0。保留此限制，不把它改写为成功的同仓 PR 正例 |
| 真实 artifact ZIP 互通 | `a3/zip-interop.json`：从既有成功 main CI41173689406 的 tests-ubuntu-latest-1 读取5个 JSON/JSONL成员、2份 identity。属于 ZIP reader 与真实 archive 的本地互通，不是失败运行整链路或托管 PR09 验收 |

历史 timeout 的原因仍未确定。本批不通过文本推测补出真实根因。

## 保留的未验收项

- 模型 endpoint/固定型号/价格/token 上界/协议兼容性、Actions secret 均未配置；真实模型调用、usage/账单核对、提示词遵守率和归因质量 NOT_RUN。
- 新增工作流未在 GitHub 执行；托管鉴权、artifact 上传、并发及实际 run_number 预算拒绝 NOT_RUN。本地假 API 的正反例不代替它们。
- 完整同仓 PR 远端采集正例尚未取得；真实 PR 关联缺失已按拒绝记录。fork 继续 NOT_RUN。
- 十次真实失败分析/两周观察尚未开始。代码提交、推送及草稿 PR 已获追加授权；自动触发、评论、修复、合并和发布不在本批授权范围。
- PR07 的下一次发行验收、PR08 暂缓，以及真实宿主/生命周期 R0 的原边界保持；第二批状态见[报告](pr-pipeline-batch2-2026-10-31.md)。
