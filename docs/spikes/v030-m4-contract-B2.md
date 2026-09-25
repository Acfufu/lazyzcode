task: 交付 B2（合并主干·follow-up）——push 分支 v030-m4-followup 至 Acfufu/lazyzcode 并开 PR 至 main；PR CI 全绿后以 --match-head-commit 绑定分支尖端合并；PR 携带=首链后本地 main 三个交付面修复（check-runs 大小写归一/观察参数重瞄/重瞄内存同步）+M3 预算测试断言插桩（CI 偶发红的自诊断面）；PR CI 红若复现 budget-ledger 空派发形态则 stop 原因将随报文落日志（本 PR 的目的之一）；HEAD 身份由意图账本钉定（act 前漂移复核）
endpoint: B
scope: .
recipe: none
budget-ref: none
non-goals: 不修改仓库设置；不使用 admin 绕过；合并后该 SHA CI 红=如实「已合并、验证失败」，再 follow-up 须新契约新批准；不因本 PR 触发额外发布（main 合并触发 Pages 构建为既有副作用，C 已验证面不受损）
- [A1] PR 以意图声明的 HEAD 建立（headRefOid==意图 SHA ∧ base==main，漂移即拒不合并）
- [A2] 合并前 PR headSha check-runs 全绿（四矩阵腿）；合并绑定该 HEAD（--match-head-commit）
- [A3] 读回实际 mergeCommit SHA 入意图账本；该 SHA CI 轮询结果如实记录（green/pending/failed 分列）
