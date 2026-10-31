# CI 失败归因试点（PR09）

状态：2026-10-31 实现及本地验证完成，按维护者安排以草稿 PR 交付。新的托管 workflow 尚未执行；模型配置默认禁用，真实模型调用及归因收益尚未验收。它是独立的辅助诊断入口，不属于 `CI Required`，不修改检查结果、标签、评论、代码或合并规则。

## 使用

本地只读采集（需要 Node 24；公开元数据可匿名访问，日志/产物下载通常需要具有 Actions read 的 `GH_TOKEN`）：

```sh
node scripts/ci/triage.mjs <run-id> artifacts/ci-triage [attempt]
```

输出 `input.json`、`diagnosis.json` 和安全转义的 `summary.md`。`COLLECTED` 只表示采集流程结束，可能完全缺少日志；请查看 limitations。它不是模型诊断成功、根因确认或目标 CI 通过。出错产生 `BLOCKED`/`FAILED` 回执与非零退出码。包装器对所有诊断输出标注 advisory，建议的检查不会自动执行。

工作流合入 main 后，可在 Actions 的 `ci-triage` 中手动填写 `run_id`、可选 `attempt`，`enable_model` 默认 false。只允许本仓 main 控制代码派发，绑定该次 dispatch 的 `github.sha`，不检出目标 CI 源码；同仓 PR 和 main push 可分析，fork 路径继续 NOT_RUN。普通 PR CI 不使用模型密钥。

每次诊断使用独立 artifact，保留 14 天；失败也尝试上传。runner 被取消或丢失可能来不及写回执/上传，这不是成功或零费用。collection-only 回执的 requests=0；真实模型调用前先写 requests=1 与完整费用预留。

## 身份和证据

- 验证固定仓库、`ci.yml` 的实际 workflow ID/path、run ID、指定 attempt、事件、分支及 completed 失败/取消状态。完整 job/artifact 清单缺失时拒绝继续，不把第一页冒充全集。
- 每个 job 的 run/attempt/SHA 必须一致；输出失败步骤、job 链接、日志原行号。PR 运行的 head SHA 与报告中的 checkout SHA/tree 分开记录。报告是来自目标运行的不可信数据；字段匹配也不构成独立签名证明。
- 优先读取已有 identity/result/events 报告，随后选择最多五个失败 job 的日志。无报告、过期、403/404、截断及身份冲突都具名记录。仅给出 run head 时，不能据此声称已取得实际 merge tree。
- 采集开始/结束及模型完成后回查最新 attempt、PR head/base 或 main。历史结果可以分析，标为 HISTORICAL；不贴当前候选通过标签。
- JSON 元数据每次最多 2 MiB、单次下载最多 5 MiB、artifact 下载累计最多 20 MiB。ZIP 仅在内存读白名单 JSON 成员，不落地解压；限制条目、单文件及总展开大小，拒绝路径逃逸、软链接、重复成员和损坏数据。
- 证据文本最多 40 片、共约 64 KiB；最终输入 JSON 最多 80 KiB。原始大日志不归档，输入只保存脱敏片段。已知凭据和常见 token/password 格式会替换；这不是通用 DLP，初版输入来自本公开仓库 CI。引入私有仓库或敏感日志前须另行检查输入策略。

日志下载只接受 GitHub API 或其 HTTPS 存储重定向，凭据不随重定向转发。模型只获得整理后的 JSON，网络请求由固定脚本执行；没有 terminal、MCP、浏览器、GitHub 工具或任何工具循环。日志中的命令保持为文本。引用校验只证明引用存在，无法证明模型的语义推断正确。

## 接入一个模型

配置位置：`.github/ci-triage-model.json`。API key 只保存在 Actions secret `TRIAGE_MODEL_API_KEY`，不得写入配置、报告或提交。当前配置没有 endpoint、型号和价格，因此 `enable_model=true` 会 BLOCKED，发送零次模型请求。

接入前需要确认：

1. 一个明确的 HTTPS `/chat/completions` endpoint 和固定模型 ID；响应 model 必须与配置相同，避免别名静默换型号。
2. 支持 system/user 消息、`max_completion_tokens`、非流式 JSON object 输出；响应包含 choices/finish_reason/model 及 prompt/completion token usage。不假设所有兼容服务都满足这些字段。
3. 提供当前输入/输出美元每百万 token 价格，填 `pricingCheckedAt`；超过 30 天拒绝付费调用。缓存按原价保守计算，不计折扣。
4. 该模型采用已核验的字节级 tokenizer，输入 token 不超过 UTF-8 字节数加 4096 个消息封装 token；服务保证输出上限包含内部推理 token，且没有另计的请求/工具费用。无法验证这些计费前提时保持 `compatibilityVerified=false`、不开调用，另做适配。
5. 完成以上核验后才设置 `compatibilityVerified` 和 `enabled` 为 true，并提供 secret。密钥仅用于指定 endpoint 的 Authorization header；响应重定向拒绝，无自动换模型/服务商或失败重试。

预请求按输入 token 上界和最大 completion 计算完整最坏费用，大于 US$0.50 时拒绝。每次只发一个请求（低于原方案三次上限），120 秒请求超时；采集 API 总时限 180 秒，工作流总时限 10 分钟。模型出错即停止。响应缺失或 usage 非法时保留完整预留，不能当作零成本；响应超出 token 上界时记录 usage 并失败，触发配置复核。

整个试点按 GitHub 的 workflow `run_number` 限制为前 20 次 dispatch，每次最多 US$0.50，预算预留总计不超过 US$10。只读采集、失败和取消也占序号；付费模式拒绝 `run_attempt>1`，需要新 dispatch。删除历史运行不能补回序号。保持同一个 workflow；重建工作流、迁移身份或扩容前须单独复核，不自动清零。

此限制是基于经核验协议/token 上界/价格的请求预留，不是提供商账单或其账号级硬停额度的独立证明。真实接入时仍须用实际 usage 和账单复核；本地假响应不证明这些服务端契约。现阶段不需要配置提供商或消耗付费额度即可完成本地验证。

## 验证和观察

```sh
node scripts/ci/run-checks.mjs artifacts/triage-tests test/ci-triage.test.js test/ci-required.test.js test/release-candidate.test.js
node scripts/ci/workflow-check.mjs artifacts/triage-workflows
```

离线测试覆盖来源、attempt、merge checkout、过期/缺日志、归档边界、伪造引用、工具调用响应拒绝、超时/限流、无重试和预算。传输测试使用注入的内存 fetch 假响应，不调用真实服务，也不证明某个模型会遵守提示词。全套测试继续走既有入口。第三批证据见[实施报告](../reports/pr-pipeline-batch3-2026-10-31.md)。

模型接入后分别验收托管 collection-only、真实模型正例/不足证据例、预算拒绝与失败回执；这些结果不能由本地测试替代。累计十次真实失败分析或两周后，记录维护者确认的有效/错误归因、重复发现、排查耗时及费用。样本不足保持辅助态；自动触发、评论、修复、推送与合并不在本批范围内。停用入口即可回退，现有确定性门继续生效。

协议依据：[GitHub workflow runs](https://docs.github.com/en/rest/actions/workflow-runs)、[workflow jobs](https://docs.github.com/en/rest/actions/workflow-jobs)、[run_number/run_attempt 语义](https://docs.github.com/en/actions/reference/workflows-and-actions/variables)、[Chat Completions 协议参考](https://developers.openai.com/api/reference/resources/chat)。本适配器并未验收任何供应商的完整兼容性。
