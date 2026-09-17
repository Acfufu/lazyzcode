# ADR-0017: headless 驱动原语与自驱动验收面

日期：2026-09-18（goal v010-batb-protocol-headless，承 roadmap §⑪ Q7 拍板；前置件=
docs/spikes/headless.md 解锁判定）

**原语面**：`core/headless.js spawnHeadless` 封装「一次 headless 引擎调用」的进程契约：
字面量 argv + `shell:false`（engine.js/update.js 安全形态），node 直跑引擎（spike 实证
形态）；`--mode` 显式必填不设默认——spike 实测 `--prompt` 缺省 yolo，自驱动必须显式选模
式；`--max-turns` 在 0.16.5 实拒（help 列出但解析器拒收），墙钟预算是唯一兜底（超时
SIGKILL，null/0 守卫沿 ablation b1 事故教训）；HOME/USERPROFILE 隔离换绑时认证 env
（ZCODE_*_PROVIDER_CONFIG_FILE）随 env 透传，无 env 时引擎读 login OAuth credentials
（HOME 绑定）；`--json` 末尾摘要对象解析出 sessionId/response/usage/projection；失败四族
（spawn/超时/非零退出/解析）各带恢复式报错；deps.run 可注入供离线契约测试。

**验收面**：全链自驱动 E2E 走 `scripts/headless/e2e-loop.mjs`（scratch loop 注册→finish→
attestation），仅限有凭据开发机手动实弹——不入 npm test、CI 永不触网（认证门缺席=SKIP
exit 0，沿 ablation 管线「脚本承载活体、fixture 承载契约」先例）；fake-engine 契约测试
钉 argv 字面量/shell:false 证据（shell 元字符原样到达）/mode 必显/HOME 隔离/JSON 解析/墙
钟。doctor 增 `headless` 诊断行（引擎缺席=skip、凭据两态=ok/warn-only，零遥测）。

**边界**：无人值守语义（budget/lease/fencing/wake 集成）全留 0.2.0——本原语不做任何循
环编排、不自动唤起、不冒充交付（LOOP_COMPLETE≠DELIVERY_COMPLETE 立场不变）。
