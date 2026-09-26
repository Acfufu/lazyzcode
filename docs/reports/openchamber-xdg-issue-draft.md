# 上游 issue 草稿：openchamber 配置面不尊重 XDG（候选，未提交）

日期：2026-09-26 ｜ 状态：**草稿，未提交上游**（外向动作须单独授权；本文件只备稿）
来源：0.3.0 M2 三仓试点（`docs/spikes/v030-openchamber-pilot-report.md` 债 L）

## 标题候选

`Server config ignores XDG_CONFIG_HOME (homedir()/.config hard-coded) — breaks sandboxed/CI runs`

## 正文候选

运行环境：任意设置 `XDG_CONFIG_HOME`（或隔离 HOME 之外的沙箱）的自动化场景。
预期：服务端配置目录遵循 XDG 基准目录规范（`$XDG_CONFIG_HOME/openchamber`）。
实际：配置路径由 `os.homedir()` 直拼 `.config/openchamber` 得出，`XDG_CONFIG_HOME`
被忽略——隔离/CI 运行会读到并**写入**真实用户配置（我们在沙箱化验收时实测命中，
也只能靠覆写 `HOME` 规避）。

建议：配置目录解析改为 `process.env.XDG_CONFIG_HOME ?? join(os.homedir(), ".config")`
（其余 XDG 面同理），或在文档中明示不支持 XDG 并要求调用方覆写 HOME。

## 提交前置

- 外向动作（开 issue）须用户单独授权（B/C 面语义）；批准后按本稿提交并在报告记账。
