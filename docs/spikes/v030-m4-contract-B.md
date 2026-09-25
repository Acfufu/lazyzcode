task: 交付 B（合并主干）——push 分支 v030-m4-delivery 至 Acfufu/lazyzcode 并开 PR 至 main；PR CI 全绿后以 --match-head-commit 绑定分支尖端合并；PR 如实携带 0.3.0 主线全部未推提交（origin/main=a5d14ad 0.2.4 发布点，PR diff=0.3.0 主线整体上公网），合并即触发 Pages 自动构建（C 授权另行批准）；HEAD 身份由意图账本钉定（act 前漂移复核 state/head/base）
endpoint: B
scope: .
recipe: none
budget-ref: none
non-goals: 不修改仓库设置（分支保护/auto-merge/Pages 配置）；不使用 admin 绕过；合并后该 SHA CI 红=如实「已合并、验证失败」，follow-up 须新契约新批准；PR 编号=动作结果态由意图账本记录，不预先虚构
- [A1] PR 以意图声明的 HEAD 建立（headRefOid==意图 SHA ∧ base==main，漂移即拒不合并）
- [A2] 合并前 PR headSha check-runs 全绿；合并绑定该 HEAD（--match-head-commit）
- [A3] 读回实际 mergeCommit SHA 入意图账本；该 SHA CI 轮询结果如实记录（green/pending/failed 分列，failed=已合并验证失败不归 completed）
