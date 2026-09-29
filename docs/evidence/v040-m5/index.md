# v040-m5 F 证据索引（goal v040-m5-eval-release · attempt 2）

采集时点：2026-09-29T21:0x–21:3x（N13 提交 51a91cd 之后的现行树；本目录附件与索引随同批提交）。
真会话类（f7 capability/capability-meter/review-runtime/finding-lifecycle、f9 评审 run）为一次性运行，
附件即其 stdout；其余 CLI/测试面可重跑重绑（表面未被本目录提交改动——仅新增 docs 文件）。

| F | 绿半附件 | 红半（故障面）附件 |
|---|---|---|
| F1 | f1-qualify-gate-explain.stdout.log（qualify 十轴 granted 面 + gate explain 复用腿 env 拒因行）· f1-scope-qualification.stdout.log（qa 15 断言全绿） | 同前：腿2 拒因行「复用腿不足：资格身份漂移 env」+ f1-scope 日志 s4 越界拒/s6 四拒逐因 |
| F2 | f2-docs-links-clean.stdout.log（exit 0·103 文件）· f2-harness-clean.stdout.log（exit 0·八判据）· lzy.project.json/ci.yml 在场读数（绿文本账） | f2-docs-links-broken.stdout.log（exit 1 点名断链）· f2-harness-structural-fail.stdout.log（exit 1 点名 D9 缺位） |
| F3 | f3-symlink-fidelity-tests.stdout.log（6/6：containment 越界拒/悬空 clean/备份链接保真/部署链接保真） | 同前：containment 测试内拒绝断言（注入落点越界/不可解析）+夹具外字节零触碰断言 |
| F4 | f4-migration-recovery.stdout.log（11/11 断言 exit 0；三分支/相位注入/stateVersion=0.4.0） | 同前：MR7 残缺 v2 fail-closed 拒行 + MR11 done 意图再 act 拒（exit 1·gh 计数 8→8） |
| F5 | f5-contract-tests.stdout.log（9/9）· f5-interleave-determinism.stdout.log（双跑同序 true） | f5-integrity-refusal.stdout.log（删 journal 行 → exit 3 BLOCKED journalChain=false） |
| F6 | f6-batch-accounting.stdout.log（36/36·18/18 对·完整性 PASS·§9.2 判决行·哈希索引·R1 齐备） | 同 F5 完整性拒面（同门族）；批次账面 74 行 append-only 链 |
| F7 | f7-npm-test.stdout.log（739/739≥717）· f7-qa-seven-cases.stdout.log（七 case 全 exit 0；capability 补跑+meter 补录尾注）· f7-named-tests.stdout.log（V09/V10/V11 点名 34/34） | 同前：gate-matrix 15 断言=负例矩阵活体；delivery-gate/ci-binding 拒面断言（named 日志内） |
| F8 | f8-release-packaging.stdout.log（五处一致 0.4.0/surface 3 绿/provenance OK/CHANGELOG+checklist 在场） | f8-provenance-mismatch-red.stdout.log（临时副本单点 bump 0.4.9 → exit 1 双 ✖ 点名脱钩） |
| F9 | （f9 自审评审 run 落账后续填） | f9-gate-explain-red.stdout.log（评审义务未满足态 BLOCKED 读数） |
