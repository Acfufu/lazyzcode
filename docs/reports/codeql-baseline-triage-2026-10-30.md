# CodeQL 首次全量基线处置

日期：2026-10-30。原始 main：`dbba58424d94238e992621a4cd080d9cdcc43d2a`。
[全量运行 41010479580](https://github.com/Acfufu/lazyzcode/actions/runs/41010479580) 的分析 `2060140793` 使用 CodeQL 2.27.3、87 条规则，返回 17 条结果：1 critical、3 high、13 medium，分析 error/warning 均为空。PR 差异分析的零结果没有被用作全仓无告警证据。

## 高与严重告警

| 告警 | 原始位置 | 判读与处置 |
| --- | --- | --- |
| [1](https://github.com/Acfufu/lazyzcode/security/code-scanning/1) high | test/dag-authority.contract.test.js:405，第一个版本插值 | 点号单独转义不完整；改用一次完整的正则字面量转义，保留外围匹配和断言 |
| [2](https://github.com/Acfufu/lazyzcode/security/code-scanning/2) high | 同文件 405，第二个版本插值 | 单独登记，使用同一完整转义值；不按测试文件整体豁免 |
| [3](https://github.com/Acfufu/lazyzcode/security/code-scanning/3) high | 同文件 657 | 同一修复，保持市场目录与载荷核对语义 |
| [4](https://github.com/Acfufu/lazyzcode/security/code-scanning/4) critical | core/review-proxy.js:98–103 | 自定义 allowlist 未被静态数据流模型识别；完成下述源审和真实边界检查后，按单条 false positive 处置 |

1–3 的输入来自提交内 package.json 的版本 `0.6.2`，接收方是本地 doctor 输出的测试断言，未发现当前产品中的不可信高危输入路径；完整转义仍消除了未来版本域变化时的断言脆弱性。修改后两个原有 payload-ver 测试均通过，外围正则、fixture 和产品实现保持原有语义。跟进 [PR16](https://github.com/Acfufu/lazyzcode/pull/16) 在 15 项检查成功后合并；main `37a5670` 的完整分析 `2060285787` 自动将 1–3 标为 fixed（2026-10-30T06:25:39Z）。

4 的 SARIF 路径从请求 URL 流向 http.request，但发送前存在主导控制流的 exact-origin Set 检查。允许的 endpoints 来自宿主选定的 provider 配置，在 reviewer 启动前固定，请求不能扩展该集合。配置和请求使用相同 URL parser；仅转发获准 HTTP origin，重写 Host，DNS 地址在启动时固定；HTTP 请求不跟随重定向。HTTPS CONNECT 另按获准 authority 处理。

原有 10 项代理契约检查通过。新增两项检查后共 12 项通过、0 失败、0 跳过：允许 origin 的 302 原样返回，未连接外来 canary；直接访问 canary 被拒绝；不同 hostname、规范化 IPv4、IPv6 和 punycode 外来 origin 均无 canary 连接；规范化后等价的授权 origin 仍可访问。所有目标均为隔离 loopback fixture，未使用真实 provider 或凭据。

另在独立副本中只移除 exact-origin membership guard，新增 canary 断言因一次实际越界连接失败，子进程 exit 1、ERR_ASSERTION 和预期诊断均被核对。此为去 guard 副本的负控；仓库产品 guard 保留。原始测试日志、JUnit/事件、负控源码摘要和失败日志在执行证据目录保留。

两名独立来源评审分别核查 allowlist 数据流和三个正则位置；评审自身仅作源码判读。责任人：维护者 Acfufu。4 的复核触发：endpoint 来源、origin 比较、URL parser、DNS callback 或重定向行为变更；1–3 的触发：版本来源/允许格式或正则插值变更。受信配置显式选定的私有/loopback 地址按设计允许，origin/authority 策略不承诺 path 限制。上述本地检查不证明宿主 OS 隔离或真实 ZCode/provider 行为。

## 保持 open 的 medium 告警

以下 13 条不计为清理完成，没有 dismiss、级别下调或全局规则关闭。责任人均为维护者 Acfufu；后续修改相关构造点、运行相关探针或准备下一次发行时逐条复核。生命周期探针的告警与 R0 验收仍独立处理。

| 告警 | 规则 | 原始位置 | 状态 |
| --- | --- | --- | --- |
| 5 | js/shell-command-injection-from-environment | scripts/probes/r0-linux-cgroup.mjs:14 | OPEN |
| 6 | js/shell-command-injection-from-environment | scripts/probes/r0-linux-recovery.mjs:28 | OPEN |
| 7 | js/bad-code-sanitization | scripts/probes/lock-contention.mjs:64 | OPEN |
| 8 | js/bad-code-sanitization | scripts/probes/r0-macos-zombie.mjs:46 | OPEN |
| 9 | js/bad-code-sanitization | scripts/probes/r0-signal-repro.mjs:32 | OPEN |
| 10 | js/bad-code-sanitization | scripts/probes/r0-signal-repro.mjs:34 | OPEN |
| 11 | js/bad-code-sanitization | scripts/probes/reliability-containment.mjs:13 | OPEN |
| 12 | js/bad-code-sanitization | scripts/probes/reliability-containment.mjs:14 | OPEN |
| 13 | js/bad-code-sanitization | scripts/probes/reliability-r0.mjs:55 | OPEN |
| 14 | js/bad-code-sanitization | test/headless-review-lifecycle.contract.test.js:69 | OPEN |
| 15 | js/bad-code-sanitization | test/headless-review-lifecycle.contract.test.js:71 | OPEN |
| 16 | js/bad-code-sanitization | test/lock-instrument.contract.test.js:62 | OPEN |
| 17 | js/identity-replacement | core/verify.js:39 | OPEN |

维护者于 2026-10-30T06:38:34Z 将具体告警 4 标为 false positive，并写明上述证据和复核触发。main 回读有 13 条 medium open、0 条 high/critical open；完整 SARIF 仍包含该已具名处置的发现，不能表述为全仓零结果。[汇总验收](pr-pipeline-acceptance-2026-10-30.md) 记录语义门及正反例。

fork 路径尚缺另一 GitHub 归属入口，仍为 NOT_RUN；未计为通过。npm 发布方式、本次产品版本和 R0 完成状态未由本报告改变。
