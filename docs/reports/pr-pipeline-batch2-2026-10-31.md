# GitHub PR 流水线第二批：受信候选包

日期：2026-10-31（Asia/Shanghai）。范围为方案 PR07（本地规划 `docs/plan-github-pr-pipelines-2026-10-30.md`）。维护者已选择先完成 PR07，保留本机 2FA 发布；PR08 OIDC stage-only 暂缓。本批不增加 npm 权限、不改账号发布配置、不创建新发行、不移动既有 tag。原本未跟踪的规划与调研文件保留在本地，不夹带进实现 PR。

**状态：PR27 已合并；合并 SHA 的 main CI 与 CodeQL 均通过。候选工作流正向运行、真实发行验收按维护者安排留到下次发版，仍为 NOT_RUN；PR08 继续暂缓。** [实际 PR27](https://github.com/Acfufu/lazyzcode/pull/27)，实现提交 `49f342385e7dbdb58ee18c96bc6576988f789667`，最终 PR head `dfba1fd11e7bd49e95a26fb5ff2945d68ca79721`；于 2026-10-31 13:42:50 +08:00 合并为 `0f02bb2a085ff433ac70bb76aee0110989af9a53`。原 PR 证据仍绑定各自候选的真实 merge checkout，不把它们冒充 main push 证据。

## main 合并验收

本节固定记录 PR27 合并 SHA 的真实 push 运行，不与后续文档同步提交的检查身份混用：

| 项目 | 实际结果 |
| --- | --- |
| 合并 SHA / 事件 / 分支 | `0f02bb2a085ff433ac70bb76aee0110989af9a53` / push / main |
| canonical main CI | [41173689406](https://github.com/Acfufu/lazyzcode/actions/runs/41173689406)，attempt1，completed/success；13 job 均 success，包含 CI Required |
| 三平台与同包检查 | macOS/Windows/Linux Node24 全套、SQLite24.0.0 地板、同一 tgz 的三平台与24.0.0安装、docs-links、Jekyll、workflow-check 均 success；skip 仍按各测试现行平台契约，不计通过 |
| 独立 main CodeQL | [41173689390](https://github.com/Acfufu/lazyzcode/actions/runs/41173689390)，attempt1，同一 SHA 的 push/main，completed/success |
| 原始合并/运行回执 | 本地 `.omo/evidence/testing/pr07-merge-20261031/a1/`：pr27-merged.json、main-ci-list.json、main-ci-result.json、main-codeql-list.json、main-codeql-result.json、main-ci-watch.log |
| 下次发行前仍未验收 | release-candidate 的真实正向执行与 Actions 漂移/过期演练、registry 发后回读/隔离安装均 NOT_RUN；本次未发版，未切新 tag，未移动 v0.6.2，PR08 继续暂缓 |

状态同步只修改报告、发布清单及 AGENTS.md 入口，遵循 main 的正常 PR 合并门；本地计划沿用原先未跟踪状态更新，不夹带原调研文件。

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
| canonical CI 选择器真实正例 | PASS：精确 main `20b426ffdc3d43e6db5c470e816ac0f73029bfad` → run41070942593/attempt2/gate124136889479；`current-main-ci.json`。这是选择器正例，不是整套 release workflow 正例 |
| 本地全套 | 首跑 FAIL：Node24.19.0/npm12.2.1，999 通过、14 失败、0 跳过；13 项为外层沙盒的监听/嵌套 Seatbelt 拒绝，1 项为 pack dry-run 300 秒超时。原 `full-tests/` 回执完整保留 |
| 本地受控对照 | 仅将上述四文件在外层沙盒之外按原代码重跑一次：20 通过、0 失败、0 跳过；`../a2/failed-files/`。不把定向对照写成第二次全套全绿，也不覆盖首败 |
| 本地真正 pack/安装 | 首次 pack 120 秒超时；仅增加 NPM_CONFIG_OFFLINE=true 的一次对照仍超时。无 manifest，依赖它的安装/反例不能计成功。`a1/package-build.log`、`../a2/package-build.log`；不据此修改产品断言 |
| PR 托管检查 | [CI41171862815](https://github.com/Acfufu/lazyzcode/actions/runs/41171862815) / attempt1 成功，CI Required 成功；[CodeQL41171862760](https://github.com/Acfufu/lazyzcode/actions/runs/41171862760) 分析及 CodeQL 语义检查成功；15 项检查成功 |
| 同 tgz 四路安装 | 托管四个 consumer 均 PASS，逐项核对 run/attempt/checkout SHA/tree/SHA256/SRI 一致，包76文件/载荷25文件；`same-package.json`。属于 PR ci 工作流，不冒称新的 release-candidate 工作流已经执行 |
| 新 workflow 的托管正向运行 | NOT_RUN：工作流已合入 main；按维护者安排，留到下一次定版后用满足全部前置的新 tag 验收 |
| 错 SHA/tag 漂移/过期/摘要反例的真实 Actions 演练 | NOT_RUN：机制测试已覆盖，尚无真实 Actions 候选回执，不替换成远端验收 |
| 首次真实发行 registry 回读 | NOT_RUN：按计划留给第一次真实发行；未运行 npm publish |

线上正向前置的限制来自发布身份契约：当前 main 仍是 0.6.2，已有 v0.6.2 已公开且 tag 的历史 CI 不含固定门；只新建其他版本 tag 又会被三体/tag 一致性拒绝。不得为消除 NOT_RUN 而改旧 tag、绕过 CI 或虚构新版本发布。下一次正常发行时由维护者按清单完成正向及发后记录。

## 托管候选与计数

真实 checkout `c3c09f097d18f2dda408aa99d0ad61c22da795ac`，tree `c6f7fe083b03c3a57b35d5b1b34f979c0f5e44e2`，对应 PR head49f3423 与 base20b426f 的合并候选；不是 main push 身份。三平台均为 Node24.22.1：

| 平台 | 通过 | 失败 | 跳过 | 注册总数 |
| --- | --- | --- | --- | --- |
| macOS | 1013 | 0 | 0 | 1013 |
| Linux | 1011 | 0 | 2 | 1013 |
| Windows | 988 | 0 | 24 | 1012 |

skip 不计通过；具名跳过及原始布尔/文字原因、各平台回执、扫描工具下载摘要、首败与受控对照计数见[证据摘要](https://github.com/Acfufu/lazyzcode/blob/cac2499fb44f43268a5bcc703b11e61c76d926a2/docs/evidence/ci-pipeline-2026-10-31/pr07/verification.json)。未为布尔 skip 编造原因。

同包 SHA256 `f8a041d13588df8bb9f563a399ee66670c95f82b79cec43d44db4a9f02d16918`，SHA512 SRI 逐消费方匹配。该摘要与第一批相同不表示复用了历史 artifact：本次重新 pack，证据单独绑定本次 run/attempt/merge tree。源码变化只在 CI/脚本/测试/文档，不修改随包产品载荷。

本批执行命令包括：`node --test test/release-candidate.test.js`；钉版 `node scripts/ci/workflow-check.mjs <out>`；`node scripts/ci/run-checks.mjs <out>`；`node scripts/ci/package-build.mjs <out>`（含一次离线对照）；对四个失败文件的具名 `run-checks.mjs` 外层沙盒之外对照；真实 `release-candidate.mjs prepare v0.6.2 <proof>` 拒绝；源码链接校验通过（本地138文件，包括两份未跟踪规划文件）。完整日志与 GitHub 下载产物留在本地证据目录。
