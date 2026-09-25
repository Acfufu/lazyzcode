task: v030-m5-closeout — 0.3.0 M5 迁移与发布收口：完整迁移机器（设计总案 §8）+升级链与打包/缓存一致+跨平台支持边界+三仓回归补账+发布候选
endpoint: A
scope: /Users/acfufu/Codehub/lazyzcode
scope: /Users/acfufu/Codehub/v030-fixtures
recipe: none
budget-ref: none
non-goals: 定版/tag/Release/npm publish/Pages 发布等外部发布动作（按 docs/release-checklist.md 归用户直发，本 goal 只做免授权预飞核验）；queue 项 B/C 编排归并（债 M4-3，后续版本）；C 面多页爬核（债 M4-4，后续版本）；engine --json usage 第二计量源对账的实现（债 K 本轮仅处置拍板）；win32 专属执行语义的 VM 实测升级（维持 ADR-0011 支持边界，以 CI 矩阵真值为准）。

# 需求契约：v030-m5-closeout

## 验收项

- [A1] 显式迁移命令对旧树完成「校验备份→暂存→校验→原子切换」，落版本入口；在途目标（无活体持有进程）转换出待确认需求契约草案（授权=NONE，零提权）；已完成目标与旧 attestation 原样字节保留、按旧语义可读。
- [A2] 迁移执法面：活跃 goal 或活体 lease 在场拒写迁移；损坏源与未知 schema 停止切换且源状态不变；中断后按迁移日志恢复、按任务身份幂等、不覆盖源。
- [A3] 升级链与打包/缓存一致：lzy update→sync 不触碰 .lazyzcode/ 的红线维持；部署载荷一致性获得直接契约测试（仓 plugin/ 树与部署缓存逐文件对表+pack files 白名单对表）；doctor 具迁移状态读面。
- [A4] 跨平台边界：CI 四腿（node 22/24 × ubuntu/windows）当前真值核验在案；win32 skip 清单逐条处置（补真断言或记入支持边界）；支持边界双语文档化。
- [A5] 三仓代表任务各累计 ≥3 次独立回放（既有 1 次+本轮每仓新增 2 次），每仓至少 1 次含中断恢复形态；回放记录汇总成三仓回归报告。
- [A6] 债面逐条处置：债 F 复评拍板、债 G 随 A4 收口、债 K 处置拍板、M4-1..M4-4 逐债明示去向；发布验收矩阵 V01–V12 逐项记账，V12 以 A1/A2 证据收口。
- [A7] 发布候选就绪：npm test 终树全绿（基线=改前实测计数）；release-checklist 免授权预飞项（测试全绿/pack 载荷核对/本地残留外带检查）核验在案；文档面（AGENTS/decisions/CHANGELOG/CONTEXT/README/guide/history）同步；最终独立审查轮完成且阻塞级发现修复收口。

## 边界与如实声明

- 回放为真引擎实弹：每仓回放墙钟与重试上限在计划钉定，失败即数据不无限重试；积分执法沿近似限制语义（决策 #32），计量缺席不算零、如实记账，不宣称积分硬顶。
- 迁移只转换 lzy 管理状态；不宣称阻止同权限进程原生写文件（设计总案 §3.1 威胁边界）。
- 版本三体（package.json/plugin.json/CHANGELOG 定版条目）维持 0.2.4/Unreleased，定版属用户直发序列。
