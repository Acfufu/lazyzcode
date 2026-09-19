# 产品叙事 checklist（维护者面）

> 用途：凡改动 README / guide / 首页 / CHANGELOG / AGENTS.md 叙事面的目标，收尾按本清单对表一遍。
> 数值是快照不是真理——**核验命令比数字重要**：每项都给了怎么查，发现漂移就地修，修不完记入目标计划。
> 事实快照：2026-09-13（goal narrative-pricing-alignment 收口后，plan-v2-phase2 / pisper-absorption 批次已并入）。

## 单主轴：三节拍

所有叙事面最终都要能落到这三拍。新增能力先问「属于哪一拍」——答不上来就先别写进门面。

| 节拍 | 含义 | 主载体 |
| --- | --- | --- |
| **做完** | 计划 → 执行 → 拿证据 → 不做完不停 | README tagline 与 NOTE 弧线、首页 Goal loop 卡、guide「第一个目标循环」 |
| **记住** | 分层 `AGENTS.md` 项目记忆 | README「之后的路」第 1 条、首页 Project memory 卡、guide「项目记忆」节 |
| **接着走** | 无人值守只继续已开目标 | README「之后的路」第 2 条、首页 Unattended 卡（护栏句式）、guide「无人值守」节 |

## 叙事面与必载元素

### README 双语（`README.md` + `README.zh-CN.md`，逐节对位）

- [ ] tagline 与 NOTE 三节拍弧线在场。
- [ ] 两技能自述（zw / init-deep）与 `plugin/skills/*/SKILL.md` frontmatter `description` 事实一致。
- [ ] CLI 命令表齐全（快照 20 行，2026-09-18 v0.1.0 棒B 后；2026-09-19 0.1.1 goal1 目标循环行内容扩人权门句、行数不变，逐版计数账见下行「三面分记」；沿革 2026-09-16 增 update→又增 证据主体 subject/tier 两行）：install / sync / update / status / doctor / 目标循环 / 证据主体 subject / Tier / 步级认领 claim / 证据包 export / 交接 handoff / 跨仓清单 list / 目标谱系 history / 积分报表 cost / 证据账本 red·waive·list / 失效 DAG dependents·stale / 对照 attestation / attempt 世系 supersede·attempts / agents-md / uninstall——新命令进 `cli/lzy.js` 必须同批进双语表。
- [ ] 「`lzy doctor` 都查什么」段与实跑输出一致（含 rate-limit / transport / content / band-by-provider / cost / schedule / agents-md / claims / host-git / ledger / waterline / orphan-wake / hook-node——核验：跑 `lzy doctor` 逐行对描述）。
- [ ] 「之后的路 / Your next moves」承载记住 + 接着走两拍的入口（快速上手只教循环）。
- [ ] 架构树与实际一致（skills 2、hooks 5 经 run-hook 启动器[win32 走 run-hook.cmd 孪生]、agents 3、core 模块清单）。
- [ ] schedule 措辞口径：「限流实测 ∩ 计价高峰对照」（2026-09-10 起，双语 8 处；不许退回纯限流表述）。
- [ ] 「十一件事对比表」双语在场且行数互等（不树靶口径：十一项 + 单差距行，无竞品点名；核验：`grep -c '^| [0-9][0-9]* |' README.md README.zh-CN.md` = 11 / 11；第 11 行=attestation 卖点，2026-09-17 起）。
- [ ] 市场 B 路安装两行在场（`/plugin marketplace add Acfufu/lazyzcode` 双语各一）+「市场路只装插件层、`lzy` 仍来自 npm」告诫在场（2026-09-16 起）。

### 首页（`docs/_layouts/home.html`）

- [ ] 特性卡 6 张：Goal loop / Plan gate / Evidence discipline / Project memory / Unattended / lzy CLI。
- [ ] Unattended 卡保持护栏句式（"continue existing goals only — never start new ones"）。
- [ ] 双语 nav（`docs/_includes/nav-*.html`）与语言卡可导航。

### guide 双语（`docs/guide/en.md` + `zh.md`）

- [ ] 锚点双语对齐（快照 22/22，2026-09-19 v011 goal2 增 Security & trust surface 节）。
- [ ] 「项目记忆」「无人值守」保持独立概念节。
- [ ] schedule 相关行为计价感知措辞 + 「UTC+8、人工维护、活动期」免责三件套。
- [ ] 新概念先查 AGENTS.md §8 术语表——先有守门词条，再有文档节。

### CHANGELOG / AGENTS.md / 技能文本

- [ ] 每个落地的目标在 CHANGELOG 有条目，Added/Changed 语义正确；版本切分遵循 Keep a Changelog（0.0.3 已并入 0.0.4 unreleased，2026-09-13 拍板）。
- [ ] AGENTS.md §2 登记行 + §8 术语表同步；预算 150 行顶格——加行先置换/压缩旧行。
- [ ] 动了 `plugin/` 契约文本：`lzy sync` 后 grep 安装缓存实证（真会话读 cache 不读工作树）。

### 品牌与报告

- [ ] `docs/assets/` mark / logo / favicon 三件 SVG（Z 末笔收于证据圆点）。
- [ ] `docs/reports/` 四份 HTML（index + full/pm/dev）可打开。

## 写死计数位点对表

六类高频漂移位点 + 核验方法。**两种已知漏网形态别再踩**（narrative-pricing-alignment 实锤）：数字括注形态「（4 个 / (4, via」（README 架构树，grep 散文「四/four」扫不到）；zh/en 同义换词变体（「反推错峰窗口」vs「同一份实测数据反推」）——每处旧位点写一个专属断言模式，双语成对写。

| 位点 | 快照值 | 核验 |
| --- | --- | --- |
| 钩子数 | 5 | `python3 -c "import json;print(len(json.load(open('plugin/hooks/hooks.json'))['hooks']))"`；全文档面 `grep -rn '四个\|four\|（4 个\|(4,' README.md README.zh-CN.md docs/`（注意「其余四钩」类契约句的合法误中） |
| guide 锚点 | en 22 + zh 22 | `grep -c '^## ' docs/guide/en.md docs/guide/zh.md` + docs-preview 锚点检查 |
| 首页特性卡 | 6 | `grep -c 'class="feature"' docs/_layouts/home.html` |
| 技能数 | 2 | `ls plugin/skills/`；对双语 README 自述句 |
| CLI 表行 | guide CLI 栅栏 lzy 行 53/语言（双语互等） · README 表 20/语言（双语互等） · 帮助枚举 loop 族 19 + 证据账本块 5（含 dag stale）+ 对照 attestation 块 1 · 对比表 11/11（0.1.0 未动） | 三面分记（2026-09-14 R4 订正：旧「14/语言」指代不明；R6 订正帮助枚举字面值）；2026-09-16 v008 刷新：guide 快起栅栏 14→18（subject add/remove/list+tier）、README 表 14→16（证据主体 subject+Tier 两行）、帮助枚举 13→15/canonical 14→16（subject/tier 入列）；2026-09-17 v009 刷新：guide 快起栅栏 18→21（evidence red/dag dependents/attest comparator 三行）、README 表 16→19（红绿 manifest/失效 DAG/机器证明三行）、帮助枚举 loop 族 15→17+证据账本块 4+对照块 1；2026-09-18 v0.1.0 棒B 刷新：guide CLI 栅栏 lzy 行 53/语言（supersede/attempts/dag stale 三行入列；口径=guide 全部 ``` 围栏内 `^lzy ` 行，en/zh awk 对等）、README 表 19→20（attempt 世系行；失效 DAG 行就地扩 dag stale 不加行）、帮助枚举 loop 族 17→19（supersede/attempts）+证据账本块 4→5（dag stale）；对比表 11/11 不变（协议升级未加对比行，发布弧再议）；2026-09-19 v011：README 表 20/语言不变（目标循环行内容扩人权门句）、guide 栅栏 53/语言不变（人权门为散文 bullet 非栅栏行）、帮助枚举与对比表均不变；2026-09-20 v020 棒1 刷新：README 表 20→23/语言（Risk/Lease/Budget 三行，ADR-0020）、guide CLI 栅栏 53→56/语言（lzy loop risk/lease/budget 三行入列，双语互等 56/56）、帮助枚举 loop 族 19→22（risk/lease/budget 入列）、对比表 11/11 不变 |
| doctor 检查清单 | 见 README doctor 段 | `lzy doctor` 实跑逐行对描述 |

## 收尾验证链（必跑）

1. `npm test` —— 基线以收窄发现面为准（2026-09-14 起 `node --test "test/**/*.test.js"`，幻影 pass 结构性根治——裸 cwd 发现已废；Node ≥22 对 `--test` 位置参数按 glob 解释，目录字面量形态不可用）。快照 **297/297**（2026-09-19，v011 goal2 N7 实跑刷新；前值 271/271 v0.1.0 棒B、287/271 后 0.1.1 goal1——此处曾漏刷）；出红先分「既有 flake / 新回归」再动手，不硬凑旧数字。
2. `node scripts/docs-preview/build.mjs && node scripts/docs-preview/check-anchors.mjs && node scripts/docs-preview/check-links.mjs` —— 断链 0、锚点双语对齐、页面数稳定。
3. 动了 `plugin/` 时：`lzy sync` + grep 安装缓存。
4. 提交带尾注 `Goal: <slug>#<步号>`（ADR-0005）。

## 变更史

- 2026-09-13 初版入库：吸收 goal narrative-pricing-alignment（README 双语八处 schedule 计价措辞收口 + 六类计数位点回归）的断言方法与漏网教训；事实快照刷新至 plan-v2-phase2 / pisper-absorption 之后（CLI 表 +history/cost、doctor +waterline/orphan-wake、测试基线 117/117）。
- 2026-09-16 增补（goal v006-closeout）：README 检查面加「十件事对比表」与「市场 B 路安装路径」两行；发布清单第 11 步（市场 manifest）从占位转实（配方+每发布同步+runbook 订单 lesson）。
