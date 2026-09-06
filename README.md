# LazyZCode

给 ZCode 造一个 lazycodex 同款的 **AI 编码工作流纪律层**：让 AI 不只写代码，
而是 **计划 → 执行 → 拿证据 → 不做完不停**。形态：**ZCode 插件 + 轻量 CLI（`lzy`）**。

仓库根 [AGENTS.md](AGENTS.md) 是项目宪法（北极星 / 硬约束 / 决策速查表 / 红线 / 术语表），
ZCode 原生自动读取；细节见 `docs/`。

## 快速开始（10 分钟）

前置：macOS + ZCode 桌面端已安装并登录；Node ≥ 20；git（目标循环的证据绑定 tree hash，必需）。

```bash
npm i -g lazyzcode   # 获得 lzy 命令与插件载荷
lzy install          # 落位引擎缓存 + 注册表 + 引擎官方 plugins enable
lzy doctor           # 本地自检（零遥测）：引擎/安装/启用/hook 语法/node 版本
```

然后在任意项目目录新开一个 ZCode 会话，第一条消息输入：

```
zw 帮我实现 <你的目标>
```

`zw` 触发词会注入目标循环编排：模型注册目标 → 写决策完备计划（HEAVY 目标强制过
plan-reviewer 评审门）→ 逐步执行 → 对终验项在真实表面取证（绑定 git tree hash）→
`lzy loop finish` 通过才算完成；中途停手会被 Stop 钩子拉回（每会话 ≤2 次）。

## 卸载 / 诊断

```bash
lzy uninstall        # 优先走引擎官方 plugins uninstall
lzy status           # 快速体检（退出码 0=无 fail 级检查，warn/skip 不影响）
lzy doctor           # 深度诊断：status 全套 + hook 语法自检（含 hooks.json 注册校验）/node 下限/钩子 node 解析/lzy 解析/状态卫生
```

排障速查：

- **钩子全无反应**（触发词/Stop 拉回/轻提示都不动）：十有八九是引擎 spawn 钩子的 PATH
  里没有 node（从 Dock 直启 ZCode.app 的常见场景）。`lzy doctor` 的 `hook-node` 行给出判定；
  插件自带 `run-hook.sh` 启动器会自动扫 nvm/homebrew 兜底，详见
  `docs/diagnostics/2026-09-07-hook-spawn-env.md`。
- **`lzy: command not found`**：CLI 未全局安装（`npm i -g lazyzcode`）或 npm 全局 bin
  不在当前 shell PATH；临时可用 `node <仓库>/cli/lzy.js …` 直调。

## 开发者路径（改代码/贡献）

```bash
git clone <本仓库> && cd lazyzcode
npm run install:local     # 安装并启用插件（落位引擎缓存 + 注册表 + 官方 plugins enable）
npm run sync              # 热重载：重新部署 plugin/ 载荷（新会话生效）；node cli/lzy.js sync --watch 持续监听
npm run status            # lzy status（只读）
npm run uninstall:local   # 卸载
```

- 插件载荷在 `plugin/`（`.zcode-plugin/plugin.json` + `skills/zw` + `hooks/` + `agents/`），逻辑在 `core/`，CLI 入口 `cli/lzy.js`。
- 零 npm 依赖，Node ≥ 20，纯 ESM。
- 引擎定位：默认找 `/Applications/ZCode.app/Contents/Resources/glm/zcode.cjs`，
  可用 `LZY_ZCODE_ENGINE` 覆盖。**仅覆盖 macOS 引擎布局**；其他平台由 `lzy status`
  明确报「未找到」，绝不盲猜。
- 设计红线（[ADR-0001](docs/adr/0001-installer-enable-via-engine-cli.md)）：
  **lzy 对用户 `config.json` 零写入**——启用一律经引擎官方 `plugins enable`。

## 目标循环

```
lzy loop register <slug> --title …   # 注册目标（planning）
lzy loop plan <计划.md>              # 计划门：采纳 N/F 清单，默认拒绝待定项
lzy loop start                       # 开跑（记录基线 tree hash）
lzy step done <ID> [--evidence …]    # 收口一步；F 项必须带真实表面证据
lzy loop finish                      # 终验：全部 done + F 项证据 tree hash 新鲜
```

- 计划清单语法：`- [N1] 实现步骤…` / `- [F1] 终验步骤（命名真实表面）…`。
- **证据纪律**：F 项证据绑定 `git rev-parse HEAD^{tree}`——先提交再取证；
  代码一变证据过期，`finish` 会拦下并要求在当前代码上重新取证。
- **续跑机制**：Stop 钩子在目标未完时请求引擎续跑（每会话 ≤2 次，
  给引擎 3 次共享池中的后台通知预留 1 次）；SessionStart 钩子开场注入循环现状。
  钩子状态按 sessionId 隔离，异常一律放行（绝不劫持无关会话）。
- 循环状态在 `.lazyzcode/loop/`（goal.json + sessions/ 计数），计划放 `.lazyzcode/plans/`；
  与宿主 `.zcode/` 划清边界，建议加入 `.gitignore` 或按需提交。
- 触发词 `zw`（兼容 `ulw`/`ultrawork`）：UserPromptSubmit 钩子自动注入 zw 编排引导
  （词边界匹配防误触）；技能文本（`plugin/skills/zw/SKILL.md`）承载完整编排协议。
- **纪律角色**：三只读子代理——`lazyzcode:explorer`（计划前侦察，大仓库可走 codegraph
  索引）、`lazyzcode:plan-reviewer`（计划评审门）、`lazyzcode:qa-executor`（真实表面取证，
  Web/HTTP 面可用 ego-browser/curl）。HEAVY 目标计划必须过评审门：判决 REVISE 会被
  CLI 拒绝采纳，`--force` 不越过。
- **comment-checker 轻钩子**：Edit/Write 落盘内容含 TODO/FIXME/XXX/HACK 标记或调试残留
  时经 additionalContext 轻提示（只提示不阻断；仅在有目标循环的工作区生效）。

## 已知限制

- headless（`--prompt`）驱动引擎需显式模型配置与登录凭据（桌面端运行时注入）；
  CLI 活体会话验收顺延，机制正确性由 Spike 3（`docs/spikes/p0-day1.md`）背书。
- 仅覆盖 macOS 引擎布局；其他平台由 `lzy status` 明确报「未找到」。

## License

MIT（[LICENSE](LICENSE)）。借用以 [lazycodex](https://github.com/code-yeongyu/lazycodex)
（MIT）为限；OmO 主仓（SUL-1.0）只学思想，不搬代码。
