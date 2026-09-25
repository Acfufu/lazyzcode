task: 交付 C（上线验证）——GitHub Pages（main:/docs → https://acfufu.github.io/lazyzcode/）构建对齐 B 链 merge SHA 且线上 HTTPS 内容含预期标记；关键路径浏览器取证
endpoint: C
scope: .
recipe: none
budget-ref: none
non-goals: 不修改 Pages 配置；不触发任何额外发布动作；构建失败/内容不符/标记缺失=如实阻塞不假绿（V11）
- [A1] Pages 构建对应 merge SHA（builds/latest：status=built ∧ commit==mergeSha）
- [A2] 线上 HTTPS 内容含 expect-marker（M4 报告页 slug v030-m4-delivery-report——改前预抓取已证其不在场）
- [A3] 关键路径可达（浏览器截图取证随 F5 绑账本）
