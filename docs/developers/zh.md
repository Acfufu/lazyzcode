# 开发者视角

写给想扩展 LazyZCode、参与贡献或对接集成的开发者。[文档](../guide/zh.md)
讲的是*工作流*，这一页讲*机器*。本页全部内容取自实际源码（`plugin/`、
`core/`、`cli/`）——不画饼，只写已发布的部分。

## 系统架构

LazyZCode 是边界分明的三块：引擎加载的插件、独占循环状态的 CLI、以及项目
自留的状态目录。

<figure class="diagram">
<svg viewBox="0 0 840 300" xmlns="http://www.w3.org/2000/svg" font-size="13">
  <defs>
    <marker id="arrz" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M0 0L10 5L0 10z" fill="var(--accent)"/>
    </marker>
  </defs>
  <g fill="var(--surface-2)" stroke="var(--line-strong)">
    <rect x="20" y="70" width="190" height="76" rx="10"/>
    <rect x="300" y="40" width="240" height="104" rx="10"/>
    <rect x="620" y="40" width="200" height="60" rx="10"/>
    <rect x="620" y="150" width="200" height="60" rx="10"/>
    <rect x="300" y="190" width="240" height="60" rx="10"/>
  </g>
  <g fill="var(--text)" text-anchor="middle" font-weight="600">
    <text x="115" y="102">ZCode 引擎</text>
    <text x="420" y="66">lazyzcode:zw 插件</text>
    <text x="720" y="65">lzy CLI</text>
    <text x="720" y="175" class="mono" font-weight="400">.lazyzcode/</text>
    <text x="420" y="215">git 仓库</text>
  </g>
  <g fill="var(--muted)" text-anchor="middle" font-size="11.5">
    <text x="115" y="124">桌面端 · zcode.cjs</text>
    <text x="420" y="88">skills/zw · 编排文本</text>
    <text x="420" y="107">hooks ×6 · 经 run-hook 启动器</text>
    <text x="420" y="126">agents ×3 · 只读角色</text>
    <text x="720" y="83">目标循环状态机</text>
    <text x="720" y="193" class="mono" font-weight="400">goal.json · plans · evidence</text>
    <text x="420" y="233" class="mono" font-weight="400">HEAD^{tree}</text>
  </g>
  <g stroke="var(--accent)" stroke-width="1.4" fill="none">
    <path d="M210 90 H296" marker-end="url(#arrz)"/>
    <path d="M620 55 C500 -8 330 -8 216 62" stroke-dasharray="5 4" marker-end="url(#arrz)"/>
    <path d="M720 100 V146" marker-end="url(#arrz)"/>
    <path d="M616 210 H544" marker-end="url(#arrz)"/>
  </g>
  <g fill="var(--muted)" font-size="11.5">
    <text x="253" y="118" text-anchor="middle">装载插件</text>
    <text x="253" y="133" text-anchor="middle">触发钩子事件</text>
    <text x="418" y="16" text-anchor="middle">官方 plugins enable · config.json 零写入</text>
    <text x="728" y="128" text-anchor="start">读 / 写</text>
    <text x="580" y="200" text-anchor="end">证据绑定</text>
    <text x="580" y="215" text-anchor="end" class="mono">HEAD^{tree}</text>
  </g>
</svg>
<figcaption>边界是有意为之：安装器永不写你的 <code>config.json</code>（启用只走引擎官方
<code>plugins enable</code>），循环状态留在项目内，插件载荷零运行时依赖。</figcaption>
</figure>

设计准绳按序：**Skill &gt; MCP &gt; Tool &gt; Hook**。离线了也无所谓的放技能文本；
钩子是最后手段，且一律写成 fail-open。

## 目标循环：一台状态机

`lzy loop` 是磁盘上的朴素状态机（无守护进程）。技能文本驱动模型走完它；
CLI 把守每一处迁移。

<figure class="diagram">
<svg viewBox="0 0 840 230" xmlns="http://www.w3.org/2000/svg" font-size="13">
  <defs>
    <marker id="arrz2" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M0 0L10 5L0 10z" fill="var(--accent)"/>
    </marker>
  </defs>
  <g fill="var(--surface-2)" stroke="var(--line-strong)">
    <rect x="20" y="88" width="110" height="44" rx="10"/>
    <rect x="180" y="88" width="130" height="44" rx="10"/>
    <rect x="390" y="88" width="150" height="44" rx="10"/>
    <rect x="620" y="88" width="120" height="44" rx="10"/>
  </g>
  <rect x="772" y="94" width="52" height="32" rx="8" fill="var(--accent-dim)" stroke="var(--accent)"/>
  <g fill="var(--text)" text-anchor="middle" font-weight="600" font-size="12.5">
    <text x="75" y="115">注册</text>
    <text x="245" y="115">计划门</text>
    <text x="465" y="115">执行中</text>
    <text x="680" y="115">终验门</text>
    <text x="798" y="115" fill="var(--accent)">完成</text>
  </g>
  <g stroke="var(--accent)" stroke-width="1.4" fill="none">
    <path d="M130 110 H176" marker-end="url(#arrz2)"/>
    <path d="M310 110 H386" marker-end="url(#arrz2)"/>
    <path d="M540 110 H616" marker-end="url(#arrz2)"/>
    <path d="M740 110 H768" marker-end="url(#arrz2)"/>
    <path d="M430 132 v34 h110 v-30" stroke-dasharray="5 4" marker-end="url(#arrz2)"/>
    <path d="M465 46 V84" stroke-dasharray="5 4" marker-end="url(#arrz2)"/>
  </g>
  <g fill="var(--muted)" font-size="11.5" text-anchor="middle">
    <text x="245" y="150">决策完备</text>
    <text x="245" y="165">HEAVY 须评审 PASS</text>
    <text x="465" y="32">Stop 钩子拉回 · 每会话 ≤2 次</text>
    <text x="558" y="185">lzy step done · F 项须带证据</text>
  </g>
</svg>
<figcaption>每次迁移都是一条 CLI 命令；每道门都是一个有权拒绝的检查。Stop
钩子是唯一能把模型推回工作的东西，而它预算封顶、异常即放行。</figcaption>
</figure>

```bash
lzy loop register <slug> --title "…"
lzy loop plan <计划.md> --review "plan-reviewer: PASS …"
lzy loop start
lzy step done <ID> --evidence "curl /export -> 200，可按 CSV 解析"
lzy loop finish
```

## 证据绑定

整个产品的核心技巧：证据绑定到提交的内容快照，因此它不可能悄悄腐烂。

<figure class="diagram">
<svg viewBox="0 0 840 210" xmlns="http://www.w3.org/2000/svg" font-size="13">
  <defs>
    <marker id="arrz3" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M0 0L10 5L0 10z" fill="var(--accent)"/>
    </marker>
  </defs>
  <path d="M40 120 H800" stroke="var(--line-strong)" stroke-width="1.4"/>
  <g fill="var(--bg)" stroke="var(--accent)" stroke-width="1.6">
    <circle cx="130" cy="120" r="7"/>
    <circle cx="420" cy="120" r="7"/>
    <circle cx="660" cy="120" r="7"/>
  </g>
  <g fill="var(--muted)" font-size="11.5" text-anchor="middle" class="mono">
    <text x="130" y="145">提交 A · tree 95a0…</text>
    <text x="420" y="145">提交 B… · tree c3f1…</text>
    <text x="660" y="145">提交 C · tree 7d22…</text>
  </g>
  <rect x="45" y="24" width="230" height="58" rx="10" fill="var(--surface-2)" stroke="var(--line-strong)"/>
  <text x="160" y="47" fill="var(--text)" text-anchor="middle" font-weight="600">F 项证据取证</text>
  <text x="160" y="67" fill="var(--accent)" text-anchor="middle" class="mono" font-size="11.5">绑定：95a0…</text>
  <path d="M160 82 V111" stroke="var(--accent)" stroke-width="1.4" stroke-dasharray="5 4" marker-end="url(#arrz3)"/>
  <rect x="545" y="30" width="270" height="66" rx="10" fill="var(--surface-2)" stroke="var(--line-strong)"/>
  <text x="680" y="53" fill="var(--text)" text-anchor="middle" font-weight="600">finish 重查新鲜度</text>
  <text x="680" y="73" fill="var(--muted)" text-anchor="middle" font-size="11.5">95a0… 的证据对 7d22… 已过期</text>
</svg>
<figcaption>先提交，再取证。代码一变，旧证据按构造即过期，<code>lzy loop
finish</code> 拒绝之；<code>lzy step done</code> 在重取证时重新绑定。</figcaption>
</figure>

两个有意为之的推论：`.lazyzcode/` 自身永不计入脏工作区；「测试全绿」只是
众多表面之一，永远不能替代 F 项指名的表面。

## 钩子生命周期

六个钩子骑在引擎的会话时间线上。它们全部经 `plugin/hooks/run-hook`
拉起：POSIX 按 PATH → nvm → Homebrew 顺序解析 `node`（Windows 经 PATHEXT
把同一清单行解析到 `run-hook.cmd` 孪生，兜底 nvm-windows/Program Files），
从 Dock 直启的
ZCode（钩子环境没有 node）也能正常工作；解析结果由 `lzy doctor` 的
`hook-node` 检查报告。

<figure class="diagram">
<svg viewBox="0 0 840 190" xmlns="http://www.w3.org/2000/svg" font-size="13">
  <path d="M40 78 H800" stroke="var(--line-strong)" stroke-width="1.4"/>
  <g fill="var(--accent)">
    <circle cx="100" cy="78" r="7"/>
    <circle cx="270" cy="78" r="7"/>
    <circle cx="440" cy="78" r="7"/>
    <circle cx="610" cy="78" r="7"/>
    <circle cx="780" cy="78" r="7"/>
  </g>
  <g fill="var(--text)" text-anchor="middle" font-weight="600" font-size="12.5" class="mono">
    <text x="100" y="52">SessionStart</text>
    <text x="270" y="52">UserPromptSubmit</text>
    <text x="440" y="52">PostToolUse</text>
    <text x="610" y="52">PostToolUseFailure</text>
    <text x="780" y="52">Stop</text>
  </g>
  <g fill="var(--muted)" text-anchor="middle" font-size="11.5">
    <text x="100" y="106">向新会话重注入</text>
    <text x="100" y="123">循环状态</text>
    <text x="270" y="106">触发词匹配 →</text>
    <text x="270" y="123">注入 zw 引导</text>
    <text x="440" y="106">comment-checker 轻提示</text>
    <text x="440" y="123">（Edit / Write）</text>
    <text x="610" y="106">同工具失败连击</text>
    <text x="610" y="123">绊线告警一次</text>
    <text x="780" y="106">请求续跑</text>
    <text x="780" y="123">≤2 次 · 交接放行</text>
  </g>
  <text x="420" y="165" fill="var(--faint)" text-anchor="middle" font-size="11.5">session-start.js · trigger.js · comment-checker.js · tripwire.js · stop.js — 全部经 run-hook 启动器拉起</text>
</svg>
<figcaption>引擎暴露 7 个钩子事件和共享池 3 次 stop-continuation（后台通知
同池扣减）；LazyZCode 每会话至多花 2 次，任何异常一律放行。</figcaption>
</figure>

## 扩展它

**加一只纪律角色。** 往 `plugin/agents/` 丢一个带 frontmatter 的 Markdown
文件即可，引擎自动发现该目录。角色是只读契约：explorer（侦察，给
`file:line` 证据）、plan-reviewer（`VERDICT: PASS | REVISE`）、
qa-executor（原样报告实际观察，绝不推断）。新角色的输出契约务必可被机器
校验。

**触发词匹配**在 `plugin/hooks/trigger.js`，分层是有意设计：

| 模式 | 触发位置 |
| --- | --- |
| `/^\s*zw(?![a-z0-9_-])/i` | 仅句首 |
| `/lazyzcode[：:]zw/i` | 任意位置，全角冒号亦可 |
| `/(^|[^a-z0-9_-])(ulw|ultrawork)([^a-z0-9_-]|$)/i` | 任意位置，词边界 |

**钩子输出契约：** 只有 Stop 钩子能续跑会话，且仅限
`{continue:true, additionalContexts:[非空]}`（引擎自身契约）；其余四钩子只发
`{additionalContext}`——纯注入。其余任何情况，包括崩溃，一律 fail-open，
绝不困住会话。

**配置面：** 一个环境变量。`LZY_ZCODE_ENGINE` 整体替换引擎候选列表；其余
一切从仓库与引擎状态推导。

## 构建、测试、预览

```bash
npm test                      # node:test 契约测试，零依赖
cd scripts/docs-preview       # dev-only 工具链（独立 package.json）
npm install
npm run build                 # docs/ -> dist/（Jekyll 同构模拟）
npm run check                 # 爬链 + 锚点完整性，任何 miss 即退出码 1
```

CI 在 node 22 / 24 上跑全套。文档站由 GitHub Pages 从 `/docs` 构建
（Jekyll，GFM）；`scripts/docs-preview/build.mjs` 在本地镜像同一条管线——
Pages 在其上多一层 rouge 语法高亮，其余一致。

## 兼容性备注

- 引擎布局探测覆盖 macOS / Windows / Linux 三平台（ADR-0011）；分发矩阵按
  arm64 实证，x64 以官方下载矩阵文档声明。
- 本项目瞄准的引擎面：7 个钩子事件、≤3 次 stop-continuation（共享池）、
  原生 AGENTS.md 注入。
- headless 驱动需要桌面端注入的凭据；机制已经探针验证，活体验收顺延。

---

*LazyZCode 以 MIT 发布。工作流受
[lazycodex](https://github.com/code-yeongyu/lazycodex)（MIT）启发；OmO
（SUL-1.0）仅贡献思想。文档结构参照 lazycodex 文档并注明出处。*
