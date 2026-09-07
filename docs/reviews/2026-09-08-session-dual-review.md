# 2026-09-08 会话双审核（docs-site 线程收官审）

> 范围：本会话全部十一个提交（3539237 仓库整理 → e0dafbf 头部顺序）+ goal
> docs-site-redesign 全程记账。方法沿五轮双审家法：A=正确性精读（逐文件对承诺
> 与实现），B=断言-现实活体探针（对会话报告的全部可验证声明逐一实测），两只只读
> 代理并行、主代理唯一写者。全程真机零污染（B 仅写 gitignored dist/ 与 /tmp）。

## 判定

- **A 审**：0 P0 / 0 P1 / **5 P2 / 9 P3**。
- **B 审**：**ALL-PASS** —— 11 组活体声明全过（C1-C11，附原始输出），仅 1 条
  P3 与 A 审发现重合（preview 的 Liquid lang 属性）。
- 总体：核心面（测试、发布面、git 卫生、宪法同步、锚点面、主题机制、语言对称）
  全部活体证实；无红线违反；问题集中在文档站新面的细节保真。

## 发现与处置（对照表）

| # | 级 | 发现（A/B） | 处置 |
| --- | --- | --- | --- |
| 1 | P2 | docs.css 浅色块与 no-JS 回退块 `--muted` 值漂移（#55677a vs #55667a） | 修：统一 #55677a |
| 2 | P2 | guide H1 选择器失效——menu-toggle 插入后 `.content > h1:first-child` 不再命中，hero 样式静默回退 | 修：改 `:first-of-type`（两处） |
| 3 | P2 | 7a6e3b2 宣称图表「双主题自适应」但四张 SVG 仍留 11 处硬编码 teal 强调（浅色底对比 ~1.8:1），commit 过度声称 | 修：`#4fd6b8`→`var(--accent)`、dim→`var(--accent-dim)`（en/zh 各 11 处） |
| 4 | P2 | developers 页引用的别名词正则 `/\b(?:ulw\|ultrawork)\b/i` 非实码（实码为 `(^|[^a-z0-9_-])…`，连字符相邻行为不同），违背「derived from actual source」承诺 | 修：照抄实码正则（en/zh） |
| 5 | P2 | AGENTS.md §7 地图缺 `scripts/` 行 | 修：补一行（预算 147/150） |
| 6 | P3 | build.mjs 未处理 `{{ page.lang \| default: 'en' }}`，dist 四页 lang 属性裸 Liquid（真 Jekyll 无碍，纯预览保真缺口） | 修：补过滤模式（B 审同源发现） |
| 7 | P3 | check-links.mjs 硬编码 `/lazyzcode` 前缀（改名即误报） | 修：从 _config.yml 取 baseurl，与 build.mjs 同源 |
| 8 | P3 | guide 诊断表 12 行漏 `loop` 检查（status.js:150，skip/ok/warn） | 修：补行（en/zh） |
| 9 | P3 | developers 页钩子契约句以偏概全（仅 Stop 能续跑且字段为复数 additionalContexts；其余三钩子纯注入） | 修：按事件拆分表述（en/zh） |
| 10 | P3 | README 调试残留清单漏 console.debug（comment-checker.js:15 实际检测） | 修：补上（en/zh） |
| 11 | P3 | ::selection 硬编码暗色 teal | 修：提为 `--selection` 变量（三块） |
| 12 | P3 | §2 未记 redesign 后续增量、release-checklist 未列 §7 | 修：§2 行内补注（0 行）+ reviews 行折叠 checklist（0 行） |
| 13 | P3 | 新写英文正文含 em-dash 31 处（guide/en），与设计技能的 em-dash 禁令张力 | 记账不修：禁令语义是 UI 文案/标题层（标签、按钮、眉题）；正文长句保留编辑性破折号是合法用法。后续若要全站清零另立小目标 |
| 14 | P3 | build.mjs 不模拟 rouge 高亮，developers 页「预览即所得」措辞过强 | 修：措辞改为「Pages 在其上多一层 rouge 语法高亮，其余一致」（en/zh） |

## B 审活体证据要点（原样摘录）

- C1 `node --test`：tests 33 / pass 33 / fail 0。
- C2 build → `built 14 pages`；check-links → `pages: 18 local links: 57 broken: 0`（exit 0）；check-anchors → `en 18/18` `zh 18/18`（exit 0）。
- C3 五页全 200，<title> 逐页正确（着陆全称 / Documentation / 文档 / For developers / 开发者视角）。
- C4 防闪内联脚本在三页均在场且严格位于 docs.css link 之前；data-theme-set 三按钮齐；`[data-theme="light"]` 与 no-JS 回退块齐。
- C5 头部序（DOM 序）= nav-link → lang-toggle → theme-toggle → GitHub（guide/en 与 developers/zh 双验证）。
- C6 语言胶囊四页两两对称（en 页「中文」→ /guide/zh/，zh 页 "EN" → /guide/en/；developers 同构）。
- C7 960px 断点 .sidebar 隐藏/.open 展开、.menu-toggle 桌面 none/窄屏 inline-flex；aside id=sidebar 与 aria-controls 对上。
- C8 npm 面：根包零依赖键；files 白名单含双 README；dry-run 27 文件，grep `.mimosa|acfufu|sess_|scripts/|docs/|dist/` 零命中。
- C9 git 卫生：porcelain 空；artifacts 被 ignore；mimosa 跟踪 0；b8e9ff6（amend 后）仅 3 文件不含 comparison-report；AGENTS.md 146 行。
- C10 宪法/记账同步：§2、§7、CHANGELOG 四条、checklist 第 13 步全在场。
- C11 保真：baseurl/defaults/GFM slug/pretty 链接与真 Jekyll 无可证偏差；唯一可证偏差 = C6 条 lang 属性（已修）。

## 复验（处置后）

处置提交前重跑：build `built 14 pages`；check-links `pages: 18 local links: 57
broken: 0`；check-anchors `en 18/18` `zh 18/18`；dist 四页 `lang="en|zh"` 已真实
渲染。A 审 P2-3 的图表取色以 `grep -c 'var(--accent)'` 双页 11/11 实证。
