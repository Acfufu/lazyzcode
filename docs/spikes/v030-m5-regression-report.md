# v030-m5 三仓回归报告（N11）

goal `v030-m5-closeout`（0.3.0 M5）· 采集 2026-09-25/26 · 设计总案 §11 口径：「三仓代表任务每项至少 3 次独立回放，其中包含中断恢复；小样本仅作为验收记录，不宣传为总体可靠率」。

## 1. 回放计数表（每仓 ≥3 ✓）

| 仓 / 代表任务 | 回放 | 形态 | 结果 | attestation / 证据锚 |
| --- | --- | --- | --- | --- |
| lazyzcode@4b54f77（drive --workers 0 拒绝修复） | ①v030-m2 试点（2026-09-24） | 常态+中断恢复（F3：SIGKILL→孤儿交付→僵尸门→reclaim→重驱） | done 7/7+修复 blob 全同 | v030-m2-report.md §5.2 |
| 〃 | ②v030-m3 队列试点（2026-09-25） | 队列项+段中 SIGKILL→reconcile 恢复 | done+队列确认 | v030-m3-report.md §5 |
| 〃 | ③v030-m5-replay4 | **中断恢复**：SIGKILL@100s→僵尸租约门（原文在案）→reclaim→重驱 fence2→N1 修复交付→**积分止步**（水位 446.1≥400，handoff 自写）→放宽续驱 fence3 六段 | done 6/6 | v030-m5-replay4-20260925T194849Z.json |
| 〃 | ④v030-m5-replay5 | 常态：直驱 3/6→积分止步（618.5）→续驱 6/6（末段墙钟 SIGKILL 抢在 finish 前→显式 finish 过） | done 6/6 | v030-m5-replay5-20260925T202623Z.json |
| openchamber@5df72db2（scrollbar 搜索映射修复） | ①v030-oc-pilot（2026-09-25） | 中断恢复（SIGKILL→僵尸门→reclaim→fence2）+浏览器实流取证 | done+att | v030-oc-pilot-20260925T020411Z.json |
| 〃 | ②v030-m5-oc-replay4 | **中断恢复**：红面靶向 6p1f→SIGKILL@100s→**孤儿引擎自交付修复** 213968e97→僵尸门（原文）→reclaim→重驱 | done 4/4 | v030-m5-oc-replay4-20260925T203940Z.json |
| 〃 | ③v030-m5-oc-replay5 | 常态：直驱 done 4/4 | done 4/4 | v030-m5-oc-replay5-20260925T205918Z.json |
| zpigeon-ios@e573516（工作区卡片 toggle 修复） | ①v030-zp-pilot（2026-09-25） | 中断恢复（积分止步+段间 SIGKILL→僵尸门→fence3）+XCUITest 实流 | done+att | v030-zp-pilot-20260925T033940Z.json |
| 〃 | ②v030-m5-zp-replay4 | **中断恢复**：红面 TEST FAILED→SIGKILL@150s→僵尸门（原文）→reclaim→重驱→修复 bc175f4+XCUITest 冒烟绿+blob 全同 | done 4/4 | v030-m5-zp-replay4-20260925T213328Z.json |
| 〃 | ③v030-m5-zp-replay5 | 常态：直驱 done 4/4（修复 a0012a0 恰一条） | done 4/4 | v030-m5-zp-replay5-20260925T215953Z.json |

**计数**：三仓各 3 次独立回放 ✓；每仓 ≥1 次中断恢复形态 ✓（且新回放各含一次真引擎僵尸租约/积分止步收束链）。

## 2. 复现入口配方（回放④/⑤）

- 公共：冻结夹具新克隆+基点 checkout+试点提交 cherry-pick（清单/契约/计划+受控注入）→宿主候选 CLI 绝对路径驱动（防自举混淆）；夹具 goal=LIGHT+契约经 recordAuthorization 受信写者落账（M3 家法，sessionId 种子标注非 UPS 人工事件）+`LZY_ABLATE_HUMAN_GATE=1` 受控消融（ADR-0015 记账）。
- lazyzcode 腿：`4b54f77`+`eaceadf`+`3879150`；drive `--mode yolo`。
- openchamber 腿：`5df72db272`+`2f0a18292`+`8c0d30b48`；隔离=HOME+双 XDG+`OPENCODE_BINARY`（oc118@1.18.18）+`OPENCODE_SKIP_START=true`+端口钉定；浏览器取证前必重 build:web（债 N）；绿半实拍=搜索 scrollbar 命中→点击→`?settings=appearance` 复选项在场（截图 sha256 `6df2b875c9…`）。
- zpigeon-ios 腿：`e573516`+`aef973a`+`4182d45`；专用模拟器 v030-probe-sim boot+`scripts/dev-setup.sh`+`xcodegen generate`；`pilot-check.sh`（中继拉起+幂等重播种+xcodebuild 两命令）。
- 中断形态脚本：drive#1 后台→sleep 100-150s→SIGKILL→轮询孤儿收尾→重驱（预期僵尸租约门拦原文）→`lease reclaim`→重驱至收束。

## 3. 可得计量（缺面如实记，不补造）

| 腿 | 段耗时（drive 记录） | 引擎消耗 | 人工介入 | 重验 |
| --- | --- | --- | --- | --- |
| lz-④ | 595s+83+165+143+506+228+219s | 未按 sessionId 折算（预算止步/handoff 链为主记录面） | 0（脚本全自动） | 0 |
| lz-⑤ | 744s+334s+900s(墙钟 SIGKILL) | 同上 | 1（显式 finish 补跑） | 0 |
| oc-④/⑤ | 段记录在各自 log（tail 缓冲仅留尾部） | 同上 | 0 | 0 |
| zp-④/⑤ | xcodebuild 段为主（build 增量复用） | 同上 | 0 | 0 |

- 对照冻结基线（试点轮）：修复面全部 blob 全同（`git diff <基线> -- <被修文件>` 空）、修复提交恰一条、靶向测试由红转绿——与试点结果逐点同构，零回归形态。
- 积分执法两次活体（lz-④ 446.1/400、lz-⑤ 618.5/400）：drive 按滚动水位诚实止步+handoff 自写，`LZY_DRIVE_POINTS_BUDGET` 放宽续驱（债 O 既有配方）——记账口径与 M3 #32 语义一致。
- 如实瑕疵：回放脚本红面/zombie 退出码被管道 tail 吃（输出原文为权威证据：TEST FAILED/僵尸门报文均在案）；oc-④/zp-④ 孤儿窗轮询计数在 steps-done 采样粒度上不完全精确（日志在案）。

## 4. 发布验收矩阵 V01–V12 记账

| 编号 | 判据（plan §11） | 覆盖 | 记账 |
| --- | --- | --- | --- |
| V01 | 契约内重规划不索新批准；删验收/扩路径/升终点/改权限拒沿用 | M1 反例1+M3 supersede 活体 | ✅（本轮复评编号标注；M1/M3 报告在案） |
| V02 | 撤回对下一动作生效；已发生外部效果如实保留 | M1 反例2+M4 撤回面扩展 | ✅（复评标注） |
| V03 | 三仓环境缺失可诊断；CLI/浏览器/模拟器实观察 | oc/zp 试点 V03/V04 子集+M2 | ✅ |
| V04 | 回执不可由摘要替代；候选/程序/输入身份不符≠现行证据 | M2 verify 面 | ✅ |
| V05 | 无关变更复用；脚本/锁文件/动态输入/新文件触发重验 | M2 F2 范围档四问+四反例回退 | ✅（复评标注） |
| V06 | 两工人各自过但整合失败阻 A；纯重锚不能修失败/过期 | M2 F3 整合失败 windDown(false) | ✅（复评标注） |
| V07 | 队列取消/失败依赖/争用/重复派发按规则收束 | M3 F5 | ✅（复评标注） |
| V08 | 已批准上限约束执行；跨目标/重启/重试不刷新、计量缺失停派发 | M0 判定→#32 拍板+M3 F3+**本轮 lz-④/⑤ 积分止步两次活体** | ✅（近似限制语义内） |
| V09 | 合并前漂移复核；无 B 拒合并；自动发布链缺 C 拒；merge SHA CI 过才完成 B | M4 报告 | ✅ |
| V10 | 超时先读回；成功动作不重复执行；失败/未知不归 completed | M4 报告 | ✅ |
| V11 | Pages 对应提交+线上内容验证成功才完成 C | M4 报告 | ✅ |
| V12 | 旧证据原义保留；在途迁移不提权；中断/损坏/版本不识别可恢复且不覆盖源 | **本轮 N5 契约测试 11 件+N6 夹具全链活体（56 文件 0 mismatch）+F1/F2 绿半** | ✅（新收口，M5 前 V12 零覆盖） |

**矩阵结论**：V01–V12 全部有证据（V08 在近似限制语义内、V12 本轮收口）；「关键误放行/未经授权交付/历史证据损失」零发案。
