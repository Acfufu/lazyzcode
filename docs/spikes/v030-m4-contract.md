task: 0.3.0 M4 有限交付 B/C——实现 delivery 授权与动作面，并在本仓完成首条 GitHub 合并（B）与 Pages 上线验证（C）真实闭环
endpoint: C
scope: .
recipe: none
budget-ref: none
non-goals: 不修改仓库设置（分支保护/auto-merge/Pages 配置），不使用 admin 绕过保护，不 npm publish、不 tag/Release、不发 GitHub Release；合并后 CI 红不重写历史（follow-up 须另行授权）；B/C 授权缺席或已撤回时绝不执行对应外部写入；queue 交付编排与 zw 交付阶段配方不在本 goal（后续版本）

- [A1] delivery 授权门活体：无授权拒绝执行对应外部动作；仅 B 授权而缺 C 时拒绝合并（main 为 Pages 发布源，合并即触发部署）；撤回对下一 delivery 受控动作生效；批准与撤回的唯一写入口=UPS 钩子在真实用户消息上的记录
- [A2] 外部动作纪律活体：意图（含目标身份）先于动作落账；动作后读回核对；已成功动作绝不重复执行；超时/断连=结果未知态，读回分类后方可收束，未知或真实失败不归 completed
- [A3] 真实 B 链：push 分支+开 PR（如实携带 0.3.0 主线 65+N 提交，公网可见）→PR CI 绿→合并绑定 PR HEAD（--match-head-commit）→读回实际 merge SHA→该 SHA 必需 CI 检查通过
- [A4] 真实 C 链：Pages 构建对应 merge 提交；HTTPS 实际内容与版本标记匹配；浏览器关键路径可达
- [A5] 回归聚合：npm test 全绿，不劣于改前实测基线
