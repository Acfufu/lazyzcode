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
- [ ] 「`lzy doctor` 都查什么」段与实跑输出一致（含 rate-limit / transport / content / band-by-provider / provider-mix / cost / schedule / agents-md / claims / host-git / ledger / waterline / orphan-wake / lock / hook-node / payload-ver / handoff-usage / codegraph / drive——核验：跑 `lzy doctor` 逐行对描述；2026-09-21 ADJ-78：drive/provider-mix/payload-ver/codegraph/handoff-usage 五线曾漏记，双语 README 已补；同日 0.2.2 棒1 新增 `lock` 行，guide 双语表 + README 双语段同批补入）。
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
| CLI 表行 | guide CLI 栅栏 lzy 行 57/语言（双语互等） · README 表 24/语言（双语互等） · 帮助枚举 loop 族 24 + 枚举串 22（另一计数位点）+ 证据账本块 5（含 dag stale）+ 对照 attestation 块 1 · 对比表 11/11（0.1.0 未动） | 三面分记（2026-09-14 R4 订正：旧「14/语言」指代不明；R6 订正帮助枚举字面值）；2026-09-16 v008 刷新：guide 快起栅栏 14→18（subject add/remove/list+tier）、README 表 14→16（证据主体 subject+Tier 两行）、帮助枚举 13→15/canonical 14→16（subject/tier 入列）；2026-09-17 v009 刷新：guide 快起栅栏 18→21（evidence red/dag dependents/attest comparator 三行）、README 表 16→19（红绿 manifest/失效 DAG/机器证明三行）、帮助枚举 loop 族 15→17+证据账本块 4+对照块 1；2026-09-18 v0.1.0 棒B 刷新：guide CLI 栅栏 lzy 行 53/语言（supersede/attempts/dag stale 三行入列；口径=guide 全部 ``` 围栏内 `^lzy ` 行，en/zh awk 对等）、README 表 19→20（attempt 世系行；失效 DAG 行就地扩 dag stale 不加行）、帮助枚举 loop 族 17→19（supersede/attempts）+证据账本块 4→5（dag stale）；对比表 11/11 不变（协议升级未加对比行，发布弧再议）；2026-09-19 v011：README 表 20/语言不变（目标循环行内容扩人权门句）、guide 栅栏 53/语言不变（人权门为散文 bullet 非栅栏行）、帮助枚举与对比表均不变；2026-09-20 v020 棒1 刷新：README 表 20→23/语言（Risk/Lease/Budget 三行，ADR-0020）、guide CLI 栅栏 53→56/语言（lzy loop risk/lease/budget 三行入列，双语互等 56/56）、帮助枚举 loop 族 19→22（risk/lease/budget 入列）、对比表 11/11 不变；2026-09-20 v020 棒2 刷新：README 表 23→24/语言（Drive 行）、guide CLI 栅栏 56→57/语言（lzy loop drive 一行+fence 块入列，双语互等 57/57）、帮助枚举 loop 族 22→24（drive 入列+handoff 补行——评审订正：原 help 块漏 handoff 一行，枚举串有而 help 无）、**新增计数位点「枚举串」21→22**（throw 串位数与帮助行数是两物，棒2 评审订正后分记）、对比表 11/11 不变；2026-09-21 v021 定版刷新：**五面计数位点零漂移**（README 表 24、guide 栅栏 57、帮助枚举 24、枚举串 22、对比表 11）——`lease reclaim` 就地折入既有 Lease 行（README/guide/SKILL/帮助/用法串五处），不加行 |
| doctor 检查清单 | 见 README doctor 段 | `lzy doctor` 实跑逐行对描述 |

## 收尾验证链（必跑）

1. `npm test` —— 基线以收窄发现面为准（2026-09-14 起 `node --test "test/**/*.test.js"`，幻影 pass 结构性根治——裸 cwd 发现已废；Node ≥22 对 `--test` 位置参数按 glob 解释，目录字面量形态不可用）。快照 **394/394**（2026-09-21 0.2.2 棒1 实跑刷新〔`node --test "test/**/*.test.js"`：tests 394 · pass 394 · fail 0〕；本棒新增 19 例＝handoff-dir 3 + progress 4 + drive 长步 1 + lock-instrument 6 + cost 3 + ablation-spawn 2；前值 375/375 0.2.1 定版；前值 369/369 v021 修复轮 N6——其间修复轮后段又增 4 例，本轮 reclaim 契约 2 例；前值 343/343 v021 评审轮；前值 320/320 v020 棒2、309/309 v020 棒1、297/297 v011——此处曾漏刷）；出红先分「既有 flake / 新回归」再动手，不硬凑旧数字。
2. `node scripts/docs-preview/build.mjs && node scripts/docs-preview/check-anchors.mjs && node scripts/docs-preview/check-links.mjs` —— 断链 0、锚点双语对齐、页面数稳定。
3. 动了 `plugin/` 时：`lzy sync` + grep 安装缓存。
4. 提交带尾注 `Goal: <slug>#<步号>`（ADR-0005）。

## 变更史

- 2026-09-13 初版入库：吸收 goal narrative-pricing-alignment（README 双语八处 schedule 计价措辞收口 + 六类计数位点回归）的断言方法与漏网教训；事实快照刷新至 plan-v2-phase2 / pisper-absorption 之后（CLI 表 +history/cost、doctor +waterline/orphan-wake、测试基线 117/117）。
- 2026-09-16 增补（goal v006-closeout）：README 检查面加「十件事对比表」与「市场 B 路安装路径」两行；发布清单第 11 步（市场 manifest）从占位转实（配方+每发布同步+runbook 订单 lesson）。
- 2026-09-21 定版刷新（0.2.1，维护者指令直发未走 loop）：测试基线 369→375；CLI 表行记 `lease reclaim` 折入既有 Lease 行的零漂移口径（该折入补的是 0.2.1 修复轮 ADJ-32 的接线缺口——原实现只有 core 原语与指路文案，命令实际不可达）。
- 2026-09-22 定版刷新（0.2.2，goal v022-bat2-h3r）：测试基线 375→404；**五面计数位点零漂移**（README 表 24 行/语言、guide CLI 栅栏 57/语言、帮助枚举 loop 族 24、枚举串 22、对比表 11）——本版**未动 `cli/`**（`git diff` 实证空），新增面全是 `core/h3r.js`（休眠原型）、`scripts/ablation/h3r-*.mjs`（研究脚本，非 CLI）与文档/ADR；doctor 方面棒1 已加 `lock` 行（README/guide 双语 doctor 段与 SKILL 同步，见该棒 N6 步注），doc 行清单随之刷新。叙事面新增一处**必须区分措辞**：H3R 的机器形态是**休眠原型**，SKILL 里那句按 **L0** 写（禁把 L0 说成机器门，ADR-0022）——本版所有对外文本按此核查。**用户文档（guide 双语 + README 双语）刻意不加 H3R 词条**：该原型是休眠研究件，而用户文档至今**零** `LZY_ABLATE_*` 开关记载（实测双语四处命中均为 0），把休眠件写进用户面等于把研究开关广告成用户功能；delegate 归拍板之后。
