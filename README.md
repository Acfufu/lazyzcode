# LazyZCode

给 ZCode 造一个 lazycodex 同款的 **AI 编码工作流纪律层**：让 AI 不只写代码，
而是 **计划 → 执行 → 拿证据 → 不做完不停**。形态：**ZCode 插件 + 轻量 CLI（`lzy`）**。

仓库根 [AGENTS.md](AGENTS.md) 是项目宪法（北极星 / 硬约束 / 决策速查表 / 红线 / 术语表），
ZCode 原生自动读取；细节见 `docs/`。

## 安装管理（P0）

```bash
npm run install:local     # 安装并启用插件（落位引擎缓存 + 注册表 + 官方 plugins enable）
npm run sync              # 热重载：重新部署 plugin/ 载荷（新会话生效）；node cli/lzy.js sync --watch 持续监听
npm run status            # lzy status：引擎/安装/启用/装载/循环检查（只读，退出码 0=健康）
npm run uninstall:local   # 卸载
```

- 插件载荷在 `plugin/`（`.zcode-plugin/plugin.json` + `skills/zw` + `hooks/`），逻辑在 `core/`，CLI 入口 `cli/lzy.js`。
- 零 npm 依赖，Node ≥ 20，纯 ESM。
- 引擎定位：默认找 `/Applications/ZCode.app/Contents/Resources/glm/zcode.cjs`，
  可用 `LZY_ZCODE_ENGINE` 覆盖。
- 设计红线（[ADR-0001](docs/adr/0001-installer-enable-via-engine-cli.md)）：
  **lzy 对用户 `config.json` 零写入**——启用一律经引擎官方 `plugins enable`。

## 目标循环（P1 核心）

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
- 触发词 `zw`（兼容 `ulw`/`ultrawork`）：技能文本（`plugin/skills/zw/SKILL.md`）
  承载完整编排协议（tier 分级 / 计划门 / 证据纪律 / 续跑响应）。

## 已知限制（P1 收尾时点）

- headless（`--prompt`）驱动引擎需显式模型配置与登录凭据（桌面端运行时注入）；
  CLI 活体会话验收顺延，机制正确性由 Spike 3（`docs/spikes/p0-day1.md`）背书。
- 仅覆盖 macOS 引擎布局；其他平台由 `lzy status` 明确报「未找到」。

## License

MIT。借用以 [lazycodex](https://github.com/code-yeongyu/lazycodex)（MIT）为限；
OmO 主仓（SUL-1.0）只学思想，不搬代码。
