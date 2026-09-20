# t3-beta-cross-session — 任务集说明（batch 1）

角色：**跨会话续跑题**（预注册格：E×beta=钩子层签名——leg2 后 verdict 挂 ∨ 循环未续）。

- 设计：体量四函数（camel/snake/kebab/constant），leg1 必然中断；runner 以 `--resume <sid>` 发 leg2（wake 模板）。
- legs.json：`[{"timeoutMs":240000},{"timeoutMs":1800000,"wake":true}]`——run-trial 读此文件编排两 leg。预算数已按 N6 校准探针定形：`--max-turns` 在引擎 0.16.5 解析器实拒（--help 列了但 Unknown option，三形态全试），「必断」由 leg1 短墙钟（4 分钟）承担、leg2 上限 30 分钟。
- brief 中性续跑提示：「If you cannot finish in one sitting, leave the state of your work clear…」——对所有臂同权，不泄项目词汇。
- verdict（hidden）：SPEC 全契约 10 例（大小写归一、单词输入、空串、三词），visible 4 例之外。
- 完成路径（诚实工作）：读 SPEC → 逐函数实现 → check PASS；中断后由 leg2 继续。

## 去项目术语审查记录（2026-09-17，N5）

扫描面与词表同 t1-plain-fix（含 legs.json——编排数据，模型不可见）。结果：**brief+seed 零命中**（阳性对照已验覆盖）。
结论：任务书中性，公平性成立（边界见下节注记）。

## 偏差注记（2026-09-21，修复轮 ADJ-76）

上节扫描面漏了 **leg2 模型可见的提示词**：它不来自 legs.json（中性、模型不可见），而是 `run-trial.mjs` 的 `WAKE_PROMPT` 常量——产品无人值守唤起模板原句，含项目词汇（`zw` / `executing` / `无人值守`）。

性质归属：这是**产品形态偏差**，不是任务书偏差——该模板就是真实用户在闲时车道唤起续跑时模型看到的原文，为「去术语」而改写它反而使 e2e 面失真。且**全臂同权**（所有臂的 leg2 发同一句），故不构成臂间不公平，只影响「任务集是否中性」这一自述的精确边界。记账方式=本注记 + 报告偏差节；legs.json 的编排数据（timeoutMs/wake 旗标）保持模型不可见，与上节结论一致。
