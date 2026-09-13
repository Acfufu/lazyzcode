# 消融账本与协议（ablation ledger & protocol）

纪律层部件的价值不靠直觉出售：**影子消融**测「部件在场时多抓了什么」，**天然消融**记「部件真没了会发生什么」。本文件 = 协议 + 账本，过程文档位对齐 `docs/release-checklist.md`；立账决策见 `docs/adr/0007-known-unknowns-ablation-ledger.md`。

## 影子消融（HEAVY 目标默认执行）

1. 计划写毕、送评审门前：先跑 LIGHT 式自查（对照 `lazyzcode:plan-reviewer` 门清单），发现原样记录、不改写不美化。
2. 照常过评审门；REVISE 多轮时各轮发现全留（记累计差集，不只末轮）。
3. 差集 = 评审员独有发现（自查未见），按 P0-P3 定级；评审 MUST-FIX 计 P1/P2、WARN 计 P3。自查独有发现对称记录。
4. 回填账本一行：日期 · 部件 · 形态 · 双方计数与差集 · 判据落点。

**预注册判据（写死于首验日 2026-09-09，改动须新 ADR）**：连续 5 个 HEAVY 目标「评审员独有 P1/P2 ≈ 0」→ 影子测不出（霍桑偏差高估自查 + 门的预防效应对影子不可见），结论只允许是「维持现状或以一次性真消融终审」，**绝不触发降档**；独有 P1/P2 持续 > 0 → 门挣得自身成本。

## 天然消融（被动事件补录）

现实把部件拿掉的事件（环境事故、引擎行为变化、误删）按同表补录：事件、实际缺位面、后果、产出物。边界：Stop 拉回等干预型部件无法影子化，只能靠天然事件或真消融（真消融 = 受控跳过部件跑真目标，须 ADR 特赦窗口，当前无此窗口）。

## 账本

| # | 日期 | 部件 | 形态 | 结果 | 证据 |
|---|------|------|------|------|------|
| 0 | 2026-09-07 | 全部钩子（环境级） | 天然 | GUI 直启致引擎 env 无 node，四钩子静默全灭（累计 895+ 次 hook.run.failed）；纪律层靠 zw 技能文本存活、循环未崩——暴露「静默失败无感知」真问题；产出 run-hook.sh 启动器（nvm/homebrew fallback）+ doctor hook-node 检查 | docs/diagnostics/2026-09-07-hook-spawn-env.md |
| 1 | 2026-09-09 | 计划评审门 | 影子（goal ablation-confidence） | 自查 5 条全执行注意级（0 P1/P2）vs 评审 3 轮累计 MUST-FIX 2 + WARN 10；去重后评审独有 P1×1（计划行文踩门禁词——研究禁词的当口把禁词写进计划，自指面）+ P2×1（漏 nav 侧栏条目致 F2 的 21/21 必挂）+ P3×9；独有 P1/P2 = 2 > 0 → **门挣得成本**。诚实注记：自查者即计划作者，霍桑偏差方向为高估自查；P1 的性质（知道规则仍踩规则）佐证「预防效应」真实存在 | 本行 + goal 评审记录（`loop plan --review` 摘要）+ `.lazyzcode/plans/ablation-confidence.md` |
| 2 | 2026-09-10 | 计划评审门 | 影子（goal comparator-salvage） | 自查 P3×1（F1 带尾注提交构造未写明）+成稿前自纠 1（F2 锚点数含糊→预注 21/21）vs 评审 3 轮累计 MUST-FIX 3 + WARN 3（全闭环零遗留）：R1 独有 P1×2（已知未知#1 证伪面指错载体——F1 scratch 隔离装不到技能层机制；status 无 goal 分支早退 loop.js:525 漏测）+W×2；R2 独有 P1×1（安装缓存滞后——F4 会拿旧契约判新机制的假证伪风险，lzy sync 前置缺失）+W×1；R3 PASS。独有 P1/P2 = 3 > 0 → **门挣得成本（连续 >0 第 2 样本，距「影子测不出」判据还差 5 连 ≈0）**。自指注记：本轮评审对象含评审角色自身职责的扩展（对照=qa-executor 新职责） | 本行 + goal 评审记录 + `.lazyzcode/plans/comparator-salvage.md` |
| 3 | 2026-09-10 | 计划评审门 | 影子（goal handoff-meter-crossrepo-list） | 评审单轮 PASS（摘要=行锚 loop.js/stop.js/status.js/doctor.js/lzy.js 逐点实核吻合、基线 86/86 评审实跑复核、三已知未知各带证伪途径零禁词，无修改意见记载）→ 评审独有 P1/P2 = 0，**判据「连续 5 HEAVY ≈0」第 1 个样本**（评审方零 P1/P2 时独有数恒为 0，此向不受自查缺位影响）。诚实注记：本轮自查侧（LIGHT 式自查差集）未留痕于计划文件，自查独有发现无从对称登记；本行系 2026-09-10 事后补账，非收尾即时回填 | 本行 + `.lazyzcode/loop/goal.json` review 字段（done 态全档）+ `.lazyzcode/plans/handoff-meter-crossrepo-list.md` |
| 4 | 2026-09-10 | 计划评审门 | 影子（goal incident-guardrails） | 终态评审 PASS（finish 归档报告载明），评审指认实绩可考：E2（交接消费未清振数→防重入误振，并入 N3）、E6（stop 全收口分支零覆盖→本轮测试首次触雷，抓获 writeSessionCounter 自 0.0.2 潜伏必炸 bug，并入 N6）——门的捕虫价值再次显形。但 goal.json 已随 reset 灭失，判决原文、轮次数与逐条定级不可考，自查侧亦无留痕 → **按证据不足不计入判据样本（≈0 与 >0 均无法严格成立）** | 本行 + `.lazyzcode/evidence/incident-guardrails.report.md`（「评审 PASS」+ E2/E6 去向）+ `.lazyzcode/loop/salvage/incident-guardrails.md`（提交文内痕迹） |
| 5 | 2026-09-11 | 任期制 A'（部署前缓刑，非在役部件） | 预审否决（五轮双审 R2/R4/R5，非影子/天然消融） | 业主拍板缓刑：unbound wake（ADR-0010）落地后单会话寿命已被双硬顶（引擎 3 次/turn + 钩子 2 次/session）结构封死，A' 的边际保护≈0 而认知负荷最高（三重 min 条件+哨兵词自检+7 字段产出）、spec 洞最多（班时在 wake 会话无定义、水位是模型数不了自己的伪精度、与 wake 模板「不做完不停」字面冲突、哨兵无技术强制）。**复活前置四条**：删班时/ETA 边界；水位降定性或等 tripwire 实信号；同步改写 wake 模板冲突（援引 ADR-0009 交接语义）；trigger.js 哨兵旗标先行。复活程序=Phase 2 基线数据齐后单独立 ablation，与部件 E 同纪律 | 本行 + `docs/reports/plan-v2-workflow-cost-review.md` §4 缓刑条款 + ADR-0010 依据节 |
| 6 | 2026-09-13 | 计划评审门 | 影子（goal plan-v2-phase2） | 自查 0 P1/P2（计划初稿自评决策完备）vs 评审独有 MUST-FIX×2：①F1 断言绑活库内容（未计价模型行）不可控，若表覆盖即 finish 不可满足[P2]；②7 字段快照 lint 落地而教学面未同步，活体交接会全数被拒[P1 候选，在交接最需要的退化场景引爆]——两条均修订后 PASS。**门连续再次挣得成本**（判据样本：#1,#6 独有 P1/P2>0，连续 5≈0 未触达） | 本行 + `.lazyzcode/evidence/plan-v2-phase2.report.md`（评审记录与修复轮） |
| 7 | 2026-09-13 | 计划评审门 | 影子（goal pisper-absorption） | 自查=计划内预验三处实核（AGENTS 行预算算术/formatRepoList 形态/salvage 与报告格式解析前提）+cli 无 --json 先例查证；评审单轮 PASS，0 MUST-FIX，WARN×3 全部非阻断且执行中吸收（双跑须每轮重置状态→已入测试注释；git.js goalLedger --since 有界不可复用→新写 trailersBySlug；子命令枚举行号漂移→订正）。评审独有 P1/P2 = 0 → **≈0 样本（#6 破断后连续计数第 1 个；判据=连续 5≈0 未触达）**。诚实注记：执行侧自查发现 git 夹具无 diff 提交静默失败（三轮红测），属执行期发现不属计划差集，记 memory 不记本表 | 本行 + `.lazyzcode/evidence/pisper-absorption.report.md`（收尾归档） |
| 8 | 2026-09-13 | 计划评审门 | 影子（goal engine-3121-sync） | 自查=真表面预核三点（doctor 基线先行/npm test 实跑/全仓 grep 位点枚举进计划）但未逐项走门清单；评审 2 轮累计 MUST-FIX×4 全为评审独有且全 P2：①F2 断言自相矛盾（117/117 同文件两行，按 N2 授权集必挂）②F1 staleness 断言不可绑（提示仅 mapLag≥50 渲染，N1 提交重锚后恒 0）③F3 TAP/spec reporter 形态错配 ④ledger 行基线对照不可满足（planning skip→executing ok 恒跃迁）；修订后 PASS。独有 P1/P2 = 4 > 0 → **门连续再次挣得成本（#7 的 ≈0 连续计数清零）**。环境盲区注记：评审员独立实跑 npm test 复核「123 真实」时同样被污染（本目标侦察语料 asar 解包的 test-tube-*.js 图标资源被 node --test 裸 cwd 发现按 test-*.js 模式误捕 3 幻影 pass）——门可复核断言形态、不可免疫共享环境，证据面隔离（语料出仓）才是根治；幻影由 F3 终验在净树上抓获，123→120 订正（attempt 注记在计划 F3） | 本行 + `.lazyzcode/evidence/engine-3121-sync.report.md` + `.lazyzcode/plans/engine-3121-sync.md`（F3 attempt 注记） |

## 维护

- 每个 HEAVY 目标评审门通过后回填一行；LIGHT 目标不强制。
- 回填须随目标收尾即时完成：评审正文只存 `goal.json`，reset 即灭（#4 incident-guardrails 实证——存根与证据包仅留痕迹级引用，定级不可考）；事后补账时自查侧缺失一律如实注记，不得臆造计数。
- 判据触达（连续 5 目标 ≈0）时升格拍板：维持现状，或立真消融特赦 ADR。
