# ADR-0001 · 安装器「启用」步骤走引擎官方 CLI，lzy 对 config.json 零写入

日期：2026-09-06 · 状态：已拍板 · 关联：AGENTS.md §5 红线 #1、`docs/spikes/p0-day1.md` Spike 2

## 决策

lzy 安装器分两步，全程对用户 `config.json` 零写入：

1. **装**：lzy 自行落位插件缓存目录（`~/.zcode/cli/plugins/cache/<marketplace>/<name>/<version>/`）并幂等追加 `~/.zcode/cli/plugins/installed_plugins.json`——这是**插件注册表**，不是用户 config；「装插件」本身就意味着写它。
2. **启用**：调用引擎官方命令 `zcode plugins enable <id>`（同族 `disable` / `uninstall [--force]`），由引擎自有原子写路径去改 config 的 `plugins.enabledPlugins`。这与官方 UI 开关完全同路径，信任面最小。

红线 #1 原文**不动**（「永不改写用户 config.json」），本 ADR 只是明确：enable 经由引擎 CLI 达成，lzy 自己永不碰 config。找不到引擎 CLI 时报错并给指引，绝不退化为手写 config。

## 依据

- Spike 2 实锤：cache 安装型插件 `defaultEnabled:false`，只装不启用 = 没装；启用态在 config `plugins.enabledPlugins`。
- 引擎 CLI 实测（zcode 0.16.5）：`plugins [list|enable <id>|disable <id>|uninstall <id> [--force]]`，`list --json` 输出结构化状态。

## 备选与否决

- **直接 read-modify-write `enabledPlugins`**：功能等价，但违反红线 #1 字面，且要在 lzy 里复刻引擎的原子写逻辑——弃。
- **`plugins.dirs` 路线**（该配置项 defaultEnabled:true）：仍要写 config，且绕过引擎的版本管理——弃。

## 影响

- 引擎定位失败 = install/enable 失败（明确报错）；环境变量 `LZY_ZCODE_ENGINE` 可显式指定引擎 `zcode.cjs` 路径。
- uninstall 优先官方 `plugins uninstall --force`，失败时回退为手工清注册表条目 + 删缓存目录。
- status 不读 config，一律以 `plugins list --json` 的 `enabled` 字段为准。
