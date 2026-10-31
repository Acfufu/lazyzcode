# GitHub PR 流水线第二批：受信候选包

日期：2026-10-31（Asia/Shanghai）。范围为方案 PR07（本地规划 `docs/plan-github-pr-pipelines-2026-10-30.md`）。维护者已选择先完成 PR07，保留本机 2FA 发布；PR08 OIDC stage-only 暂缓。本批不增加 npm 权限、不改账号发布配置、不创建新发行、不移动既有 tag。原本未跟踪的规划与调研文件保留在本地，不夹带进实现 PR。

## 实现

- `release-candidate.yml` 仅 main 手动派发：受信控制脚本与 tag 源码分开，tag 解析为完整 SHA、检查 main 祖先关系；精确查询该 SHA 的最新 canonical main push CI，必须完成成功且本 attempt 的 `CI Required` 成功。
- 从固定 SHA pack 一次，macOS/Windows/Linux Node24 与 Linux24.0.0 使用同一 tgz，复用现有安装 bin、全部包成员与离线载荷检查。最终 job 要求四份结果的 SHA/tree/run/attempt/摘要一致，再次验证 tag 对象与 CI attempt，封装 30 天候选 artifact。
- `release-candidate.mjs download/verify` 绑定真实 GitHub run/attempt/artifact 元数据，检查有效期、tag、SHA、摘要和回执；本机发布前隔离安装。`registry` 只读回查确切版本/dist-tag/integrity/shasum，下载并校验原 tgz 字节，隔离安装同字节文件。
- [发布清单](../release-checklist.md#受信候选包pr072026-10-31) 记录完整命令、失败恢复和冻结要求。发布始终从验证过的原 tgz 执行。手工发布前 live 复核与 npm 命令之间没有原子锁，发生 tag 变化或等待后必须重验。

无需新发布方式 ADR：PR07 仅备料，现行发布方式未变；PR08 未采纳。本批不改变第一批 fork NOT_RUN、CodeQL 未关闭 medium 告警或生命周期 R0 的边界。

## 验证记录

本地证据目录：`.omo/evidence/testing/pr07-20261031/a1/`。以下是各自实际表面，不互相代替：

| 检查 | 状态与证据 |
| --- | --- |
| 身份/负向机制测试 | 本地 Node24.19.0：19 通过、0 失败、0 跳过，`release-tests.log`；假 API/隔离夹具，不称远端正例 |
| 工作流扫描 | PASS：仓库钉版 actionlint1.7.12 / zizmor1.31.1，下载摘要一致、正常工作流零发现，两种既有负控被拒；`workflow-check/result.json` |
| 既有发布 tag 的真实拒绝 | PASS（拒绝符合预期）：只读 GitHub API 验证 v0.6.2 后拒绝 `exactly one CI Required job is required`；`published-tag-rejection.log`。旧 tag 早于第一批固定门，不重切旧 tag 来造正例 |
| 本地全套与安装 | 收集中；以完成后的原始回执补记，不预记通过 |
| 新 workflow 的托管正向运行 | NOT_RUN：需先合入 main，并在下一次定版后有满足全部前置的新 tag |
| 错 SHA/tag 漂移/过期/摘要反例的真实 Actions 演练 | NOT_RUN：机制测试已覆盖，尚无真实 Actions 候选回执，不替换成远端验收 |
| 首次真实发行 registry 回读 | NOT_RUN：按计划留给第一次真实发行；未运行 npm publish |

线上正向前置的限制来自发布身份契约：当前 main 仍是 0.6.2，已有 v0.6.2 已公开且 tag 的历史 CI 不含固定门；只新建其他版本 tag 又会被三体/tag 一致性拒绝。不得为消除 NOT_RUN 而改旧 tag、绕过 CI 或虚构新版本发布。下一次正常发行时由维护者按清单完成正向及发后记录。
