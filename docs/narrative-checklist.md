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
- [ ] CLI 命令表齐全（快照 12 行）：install / sync / status / doctor / 目标循环 / 证据包 export / 交接 handoff / 跨仓清单 list / 目标谱系 history / 积分报表 cost / agents-md / uninstall——新命令进 `cli/lzy.js` 必须同批进双语表。
- [ ] 「`lzy doctor` 都查什么」段与实跑输出一致（含 rate-limit / transport / content / schedule / agents-md / claims / ledger / waterline / orphan-wake / hook-node——核验：跑 `lzy doctor` 逐行对描述）。
- [ ] 「之后的路 / Your next moves」承载记住 + 接着走两拍的入口（快速上手只教循环）。
- [ ] 架构树与实际一致（skills 2、hooks 5 经 run-hook.sh、agents 3、core 模块清单）。
- [ ] schedule 措辞口径：「限流实测 ∩ 计价高峰对照」（2026-09-10 起，双语 8 处；不许退回纯限流表述）。

### 首页（`docs/_layouts/home.html`）

- [ ] 特性卡 6 张：Goal loop / Plan gate / Evidence discipline / Project memory / Unattended / lzy CLI。
- [ ] Unattended 卡保持护栏句式（"continue existing goals only — never start new ones"）。
- [ ] 双语 nav（`docs/_includes/nav-*.html`）与语言卡可导航。

### guide 双语（`docs/guide/en.md` + `zh.md`）

- [ ] 锚点双语对齐（快照 21/21）。
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
| guide 锚点 | en 21 + zh 21 | `grep -c '^## ' docs/guide/en.md docs/guide/zh.md` + docs-preview 锚点检查 |
| 首页特性卡 | 6 | `grep -c 'class="feature"' docs/_layouts/home.html` |
| 技能数 | 2 | `ls plugin/skills/`；对双语 README 自述句 |
| CLI 表行 | 12/语言 | 双语表 vs `node cli/lzy.js` 帮助枚举 |
| doctor 检查清单 | 见 README doctor 段 | `lzy doctor` 实跑逐行对描述 |

## 收尾验证链（必跑）

1. `npm test` —— 快照 123/123（2026-09-14，content-kill-family 目标实跑刷新；跑测试前先清走会 被 `node --test` 裸发现误捕的 test-*.js 资源文件）；出红先分「既有 flake / 新回归」再动手，不硬凑旧数字。
2. `node scripts/docs-preview/build.mjs && node scripts/docs-preview/check-anchors.mjs && node scripts/docs-preview/check-links.mjs` —— 断链 0、锚点双语对齐、页面数稳定。
3. 动了 `plugin/` 时：`lzy sync` + grep 安装缓存。
4. 提交带尾注 `Goal: <slug>#<步号>`（ADR-0005）。

## 变更史

- 2026-09-13 初版入库：吸收 goal narrative-pricing-alignment（README 双语八处 schedule 计价措辞收口 + 六类计数位点回归）的断言方法与漏网教训；事实快照刷新至 plan-v2-phase2 / pisper-absorption 之后（CLI 表 +history/cost、doctor +waterline/orphan-wake、测试基线 117/117）。
