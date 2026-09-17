# t3-beta-cross-session — 任务集说明（batch 1）

角色：**跨会话续跑题**（预注册格：E×beta=钩子层签名——leg2 后 verdict 挂 ∨ 循环未续）。

- 设计：体量四函数（camel/snake/kebab/constant），leg1 `--max-turns 5` 必然中断；runner 以 `--resume <sid>` 发 leg2（wake 模板）。
- legs.json：`[{"maxTurns":5},{"maxTurns":30,"wake":true}]`——run-trial 读此文件编排两 leg（N6 校准探针可回填预算数，改动走 attempt note）。
- brief 中性续跑提示：「If you cannot finish in one sitting, leave the state of your work clear…」——对所有臂同权，不泄项目词汇。
- verdict（hidden）：SPEC 全契约 10 例（大小写归一、单词输入、空串、三词），visible 4 例之外。
- 完成路径（诚实工作）：读 SPEC → 逐函数实现 → check PASS；中断后由 leg2 继续。

## 去项目术语审查记录（2026-09-17，N5）

扫描面与词表同 t1-plain-fix（含 legs.json——编排数据，模型不可见）。结果：**brief+seed 零命中**（阳性对照已验覆盖）。
结论：任务书中性，公平性成立。
