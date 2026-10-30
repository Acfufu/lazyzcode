# PR 01：三平台 CI 基线修复验收

执行日：2026-10-30（Asia/Shanghai）。[PR #4](https://github.com/Acfufu/lazyzcode/pull/4)。源码基线 `5a6d1d0c1d905b13239776cfe00fafe693e3a113`；修复提交 `52fa3b09b5650123860ebd2d54f8cb96484fe6c5`，tree `14c335a41630675580ba5e4c83f23f0e018227fd`。文档跟进提交的最终合并前检查以 PR 当前候选为准，不复用旧 SHA 绿灯。

## 原失败与根因边界

[原 run 40587507910](https://github.com/Acfufu/lazyzcode/actions/runs/40587507910)，attempt 1，macOS 26.6.2 arm64、Node 24.22.1、npm 11.19.1：`sqlite-migrate.contract.test.js` 腿⑤报 `Missing expected exception: 缺表预存文件=具名拒`。Ubuntu/地板/链接成功，Windows 因 fail-fast 取消，不能算通过。原日志未输出 SQLite 库版本及文件时间差，不补造这些数据。

`openDb` 的说明写“双信号合取”，代码实际用 OR 将“stat 时缺席”与“birthtime 晚于进程时间”连接。后者单独成立即可 unlink 数据库及侧车，不能证明文件归属。确定性反例令进程高精度时间落后 60 秒：真实预存空文件被删除，`loadQueue` 没有抛错。该偏差是注入条件，**不是原 runner 偏差的测量值**。这证实了与原安全断言一致的错误路径；不能从旧日志排除所有触发因素。

修复移除读路径的推断式删除。在场但缺表的库关闭句柄、保留文件并具名拒绝；即使存在检查后消失又被 SQLite 重建的竞争，也不猜测归属后删除。不增加 sleep、不扩大误差、不跳过原安全断言。保留文件不等于对 SQLite 打开前后每个字节不变的承诺，现有 WAL 打开机制未改。

## 红绿与本地验证

原迁移测试文件：16 通过、0 失败。新增 `⑤r6-F2 时钟偏差` 在修复前稳定失败；探针记录 `error: null, existsAfter: false`。修复后同文件在本机 Node 24.19.0 及官方校验过的 Node 24.22.1 下均 17 通过、0 失败、0 跳过。

命令：`node --test --test-name-pattern='⑤r6-F2 时钟' test/sqlite-migrate.contract.test.js`；绿半为 `node --test test/sqlite-migrate.contract.test.js`。原安全腿⑤保持原断言。

Node 24.0.0：`node scripts/sqlite-capability-probe.mjs` 成功；`node --test test/statedb.contract.test.js test/statedb-readers.contract.test.js` 为 23 通过、0 失败、0 跳过。两个 Node 版本从 nodejs.org 下载，并与同版官方 SHASUMS256 清单核对；24.22.1 arm64 tar SHA256 为 `89c682593d76cd44233fa53b1563264e7de9cbb189cad169135c5b4fadfbc0a7`；24.0.0 为 `194e2f3dd3ec8c2adcaa713ed40f44c5ca38467880e160974ceac1659be60121`。

本机受限沙盒首次全套有端口监听/嵌套 Seatbelt 拒绝及 pack 超时，不作为产品通过证据。随后允许本地子进程的 Node 24.19.0/npm 12.2.1 全套为 983 通过、1 失败、0 跳过，唯一失败是原 `npm pack --dry-run` 300 秒超时；匹配 runner 的 Node 24.22.1/npm 11.19.1 对该项单独复核 1 通过（约 1.5 秒）。两次尝试都保留，没有将定点通过写成全套通过。匹配运行时的本机全套另行运行，最终结果进入集中验收记录。

`node scripts/check-docs-links.mjs` 通过；`git diff --check` 通过。两项独立只读评审（规范／计划符合性）对修复提交均无阻塞发现；它们不代替运行验收。

## 真实 runner 结果

[修复 run 40999032997](https://github.com/Acfufu/lazyzcode/actions/runs/40999032997)，attempt 1，事件 `pull_request`，绑定上述修复 head。默认 checkout 为 GitHub 合并候选，不能当作 head tree；原工作流没有完整身份清单，PR 02 将补齐。

| job | 通过 | 失败 | 跳过 | 结果 |
| --- | ---: | ---: | ---: | --- |
| macOS Node 24 | 984 | 0 | 0 | success，178.6 秒测试 |
| Ubuntu Node 24 | 982 | 0 | 2 | success，107.3 秒测试 |
| Windows Node 24 | 959 | 0 | 24 | success，341.9 秒测试 |
| Ubuntu Node 24.0.0 SQLite 地板 | 23 | 0 | 0 | success（探针及契约） |
| docs-links | — | 0 | — | success |

Windows 有自身成功结果，未沿用原取消态。不同平台由既有条件动态注册/跳过子例，以上是 runner 原始计数，不将 skip 计入 pass。

现有 skip 未改：Ubuntu 的两项是真实 Seatbelt 文件边界与 OS 边界测试（仅 macOS）。Windows spec 的 17 条具名 SKIP 输出如下（Node 含套件/子例共计 24）：

- CI 身份绑定的“全绿判读”“非 success 判读”“远端无此提交”“非现行对照”：POSIX shebang 假 gh 执行语义未核，原 `itNotWin`。
- POSIX process group 的 normal、timeout、abort，以及 cleanup once、cleanup permission failure：Windows 没有该 POSIX 组语义。
- 水位警戒线、orphan-wake doctor、M2 默认账本/显式 dbPath：runner 缺 sqlite3 CLI 的既有能力门；不等于内建 node:sqlite 地板失败。
- EACCES 只读批准目录：POSIX 权限语义；Windows 原跳过。
- real sandbox readers、real OS boundary：macOS Seatbelt 专用。
- unified-gate 基态及反例族：POSIX 假 gh 夹具的原 `itNotWin`，含嵌套子例。
- verify-receipt 超时 SIGTERM：Windows 击杀语义原未核，原 `itNotWin`。

## 证据位置与下一门

关键红绿日志、地板结果、独立评审及原远端快照保存于 `docs/evidence/ci-pipeline-2026-10-30/pr01/`（Pages 排除 evidence）。完整本机与 runner 日志保存于 `.omo/evidence/testing/pr-pipeline-20261030/pr01/a1/`；已完成文件的 SHA256 清单随关键证据保存。远端 run/job 链接提供平台原记录。

第一批后续单元仍须分别验收。此报告不宣称 main 规则已启用、CodeQL 门已生效、npm 发布方式已迁移、真实 ZCode 装载或 ADR-0041 生命周期 R0 通过。
