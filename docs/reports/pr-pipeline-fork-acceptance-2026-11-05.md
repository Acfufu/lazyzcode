# 外部账号 fork CI / CodeQL 验收

日期：2026-11-05（Asia/Shanghai）。**本次外部归属 fork 的确定性检查及 CodeQL 权限/上传路径 PASS。** 用户提供已登录的 `codefufuai` 测试账号并授权继续推进；此前暂挂的第一批 fork 路径已取得真实平台证据。PR09 的模型按用户本次选择继续禁用，真实模型与托管诊断验收另列。

## 候选与权限

- 临时草稿 [PR #30](https://github.com/Acfufu/lazyzcode/pull/30) 由 `codefufuai` 从 `codefufuai/lazyzcode` 提交；该账号对主仓仅有读取权限，不具备 push/admin/maintain/triage。
- base：`4d6c0ca0a5602c6130b2ab99b40e6068fe6cedda`；fork head：`99131e2af76194b63f393db5e98039c86238e8c6`。
- runner 实际 checkout：`0d40caa3943d8170ee57233bfe5721198dcf39f3`；tree：`8d966b87ea529fb5069cc2f97a49754c19c1e1c9`。API 的 head、报告的 merge checkout 与 CodeQL analysis 分别核对，不将 source head 冒充实际执行提交。
- 唯一改动是 `docs/evidence/fork-acceptance-2026-11-05/fixture.json` 的九行惰性 JSON；产品源码、测试、工作流和依赖均未修改。
- 当前策略 `first_time_contributors` 实际把两个 workflow 的 attempt 1 置为 `action_required`。维护者检查改动后仅批准这两个 run；实际执行编号为 attempt 2。没有失败测试的重跑，也没有修改审批策略或 bypass。

## 实际结果

[CI 41966284074](https://github.com/Acfufu/lazyzcode/actions/runs/41966284074/attempts/2) 的 13 个 job 全部成功；[CodeQL 41966283781](https://github.com/Acfufu/lazyzcode/actions/runs/41966283781/attempts/2) 的分析 job 成功。PR head 上共 15 项检查成功，`CI Required` 来源为 GitHub Actions App 15368。草稿仍在时服务器 `mergeable_state=clean`；未把此状态称为实际合并验收。

| 产物 / 平台 | 实际 Node | 通过 | 失败 | 跳过 | 注册总数 |
| --- | --- | --- | --- | --- | --- |
| sqlite-floor-2 | v24.0.0 | 23 | 0 | 0 | 23 |
| tests-windows-latest-2 | v24.22.2 | 988 | 0 | 24 | 1012 |
| tests-macos-latest-2 | v24.22.1 | 1013 | 0 | 0 | 1013 |
| tests-ubuntu-latest-2 | v24.22.2 | 1011 | 0 | 2 | 1013 |

跳过不计通过。每项 skip 的真实名称、原始 reason/file/line 保留在[机器回执](../evidence/fork-acceptance-2026-11-05/verification.json)中；未把布尔 reason 改写成推测原因。

四个安装消费方（三平台 Node 24、Ubuntu Node 24.0.0）实际核对同一未发布 tgz：SHA256 `f8a041d13588df8bb9f563a399ee66670c95f82b79cec43d44db4a9f02d16918`。SHA512 SRI、run ID、attempt、checkout SHA/tree 均一致，每方安装 76 个文件并核对 25 个部署载荷文件；所有消费方 `PASS`。

CodeQL 的实际 `GITHUB_TOKEN Permissions` 为 `Contents: read`、`Metadata: read`、`SecurityEvents: read`。日志确认 `Successfully uploaded results` 和 `Analysis upload status is complete`；平台 analysis 2100582573 绑定 `refs/pull/30/merge` 及上述 checkout SHA，error/warning 均为空，本次 PR 差异结果数为 0。这是当前 GitHub 对 fork pull_request 路径的实际结果，不代表 token 获得通用写入权限，也不代表 main 的历史 medium 告警消失。

## 收束与边界

临时 PR 已于 `2026-11-05T04:22:53Z` 关闭，`merged=false`；保留测试 fork 与分支用于追溯。main 仍为原 base SHA，规则仍 active，恢复例外仍只有 Acfufu User 73582072 / pull_request。未执行 merge、发布、配置放宽或恢复绕过行为。

原始 API 回执、attempt 状态、完整日志 ZIP、13 份 CI artifact、解析后的 JSON、采集脚本及摘要清单保存在本地 `.omo/evidence/testing/fork-acceptance-20261105/`。下载时发生的 GitHub GET EOF 错误与重试边界保留；成功下载文件复用，没有为取证重跑 workflow。远端 artifact 保留期限仍为 14 天，本地副本独立保存。

这是一次未改变生产工作流的外部 fork 正向验收；不新增安全负例，不代替主仓此前的负例、真实 ZCode 装载、设备/服务、macOS ES 或生命周期 R0。PR09 的真实模型、托管诊断入口与观察周期保持未验收；[第二批](pr-pipeline-batch2-2026-10-31.md)的发行验收及 PR08 暂缓也保持原安排。
