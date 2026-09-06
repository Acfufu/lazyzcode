# P0 开工首日 · 三件真机验证 Spike 结果

> 日期：2026-09-06。执行依据：AGENTS.md §4 决策 #10（验证排期）。
> 环境：macOS（darwin 25.6.0 arm64）· ZCode Desktop v3.11.2（build 89817f5b）· 引擎 CLI（zcode 0.16.5，
> `zcode.cjs`）headless 真机会话 + 交互会话实测。
> 逆向源码实际位置：`~/Codehub/reversed/reversed-zcode/source/cli/zcode.cjs`
> （sha256 9c8d427d…28257，下文行号以它为准）。
> **注意**：live 引擎 `/Applications/ZCode.app/Contents/Resources/glm/zcode.cjs` sha256 为 e9f1868c…3266b8，
> 与 reversed 副本**不同**（版本漂移）；本 spike 涉及的装载/启用/预算关键结构已在 live 副本复核一致。
> 证据归档：临时归档目录（2026-09-06 会话后已清理；探针脚本原件 + 各实验 stop-log / session-start 日志）。

---

## Spike 1 · Edit old_string 稳定性 —— ✅ 已完成（首会话实测）

**结论：不需要 hashline 类锚定机制（P3 观察项可关闭），但有一条新设计红线：缩进静默改写。**

测试样本含 4 空格缩进、tab 缩进、重复行、中文 + 尾随空格、正则特殊字符；共 13 项：

| # | 场景 | 结果 | 说明 |
|---|------|------|------|
| T1 | 唯一精确匹配 | ✅ 成功 | |
| T2 | old_string 重复（2 处） | ❌ 响亮报错 | "Found 2 matches…set replace_all or provide more context"，提示可行动 |
| T3 | 行内中文子串替换 | ✅ 成功 | 子串语义，无需整行 |
| T4 | 缩进少写（文件 4 空格 vs old 2 空格） | ⚠️ **成功** | 在行内偏移 2 处命中，替换后残留 `  X`——**静默部分匹配** |
| T5 | 跨行尾随空格缺失（`spaces␠␠␠\n` vs `spaces\n`） | ❌ 响亮失败 | 跨行按字节严格，行尾空白不容错 |
| T6 | tab 行 vs 空格 old_string | ⚠️ **成功但改写** | 空白宽容命中后 **tab 被替换为空格**（verbatim 写入） |
| T7 | 正则特殊字符 `(a, b) => { [a, b] }` | ✅ 字面匹配 | 无正则解释 |
| T8 | 多行块替换 | ✅ 成功 | |
| T9 | 外部（Bash）修改后基于旧状态编辑 | ❌ **响亮拒绝** | "File has been modified since read. Read it again"——过期状态守卫生效 |
| T10 | replace_all | ✅ 成功 | 报告 "All occurrences replaced" |
| T11 | CRLF 文件 | ✅ 透明且保留 | LF old_string 命中 CRLF 内容，编辑后 `\r\n` 完好 |
| T12 | 删行（多行块替换为少一行） | ✅ 成功 | 需先重读过期文件（见 T9 流程） |
| T13 | 多行块第二行缩进不一致（文件 `  X` vs old `X`） | ⚠️ **成功且剥缩进** | new_string 原样写入，文件原缩进 `  ` 丢失 |

**行为模型（实测归纳）**：Edit = ①精确子串匹配 → ②失败则**逐行前导缩进宽容对齐**回退；new_string **原样写入**（不保留文件原缩进）；跨行边界与行尾空白**严格**；外部修改有 **mtime 状态守卫**。

**对 lazyzcode 的影响：**
1. **hashline 不需要**：hashline 解决「行号漂移」，ZCode 用内容匹配 + 过期守卫，问题不存在。P3 原判断「初步不需要」升级为「已验证不需要」。
2. **新红线（写入 P1 技能文本规范）**：`old_string` 必须带文件原样的精确缩进（T6/T13 表明宽容回退会静默改缩进风格）；子代理批量编辑后必须 `git diff --check` 或抽查缩进。
3. lzy loop 的证据校验可依赖 T9 守卫：外部改动后旧 Edit 必失败，不会静默错改。

---

## Spike 2 · 四风格清单装载 —— ✅ 已完成（第二会话 headless CLI 实测）

**源码结论维持**：工作区 walk-up 发现（`z5o`，:240363-240373）候选 `P5o` 四风格、优先级 .zcode > .claude > .codex > .cursor，清单校验仅要求非空 `name`（`U5o`，:240376-240385）。

**首轮探针部署失败（两个新实锤，比预期更有价值）：**
1. **安装型（cache）插件必须「安装 + 启用」两步**。装配循环（:248548-248582，live 复核一致）中 cache 候选 `defaultEnabled:false`，启用判定 `BDo = enabledPlugins[id] ?? default`（:248422）→ 只写 `installed_plugins.json` 的插件**永不装载**；启用态存于用户 config `plugins.enabledPlugins`。天然对照：video2code 已安装但 `enabled:false` → 会话中无其任何技能/工具/mcp。
2. **首轮 zip 打包漏掉 manifest**（仓库源四个 manifest 并排在 four-styles 根目录，未随各插件入包）→ 即使启用也会被跳过：`loadPlugin`（:248335）找不到清单即推 `plugin_manifest_not_found`（severity error）并 `continue`。

**修复部署后实测**（补各插件根 manifest + config 启用五探针，headless `plugins list` / `skills list` / `--verbose` 诊断）：

| 清单风格 | plugins list | skills list | 判定 |
|---|---|---|---|
| `.zcode-plugin/plugin.json` | `[enabled] skills: 1` | 在列 | ✅ 免改名装载 |
| `.claude-plugin/plugin.json` | `[enabled] skills: 1` | 在列 | ✅ 免改名装载 |
| `.codex-plugin/plugin.json` | `[enabled] skills: 1` | 在列 | ✅ 免改名装载 |
| `.cursor-plugin/plugin.json` | **整个插件从列表消失** | 不在列 | ❌ cache 路径拒绝 |

cursor 被拒的引擎诊断（`plugins list --verbose`）：`[error] plugin_manifest_not_found: …/spike-cursorstyle/0.0.1`。源码根因：cache 装载路径的清单候选只有三种——`ODo/findManifest`（:248369）= `.zcode/.claude/.codex`；`.cursor-plugin/plugin.json` 全引擎只出现在工作区 walk-up 数组 `P5o`（live 副本 grep 计数 = 1）。

**结论与影响：**
1. 「免改名装载」对**安装型插件 = 三风格成立（zcode/claude/codex），cursor 风格不成立**；cursor 只适用于工作区直接落位的插件（源码实证，未活体复测）。P4「双宿主分发」卖点收窄为「三风格安装分发 + cursor 仅工作区」。
2. **P0 安装器设计推论**：只装不启用 = 没装。lzy 安装器必须包含启用步骤——官方路径是引擎自己的 enable 开关（写 `plugins.enabledPlugins`，即本次 spike 复现的写法）或评估 `plugins.dirs`（`defaultEnabled:true`，:248552）路线。这触碰红线 #1 的字面表述（「永不改写 config.json」），红线本意是禁「手改配置绕工作区信任门」，引擎自有 enable 写路径与之如何相容，**P0 骨架期需拍板**（ADR 候选）。
3. `stop-hook` 探针 manifest 里声明的 `"skills":"skills"` 目录不存在时仅告警（`plugin_skill_root_empty` warning），不影响 hooks 注册。

---

## Spike 3 · Stop 非空注入 + 3 次预算 —— ✅ 已完成（第二会话 headless 真机会话实测）

**源码结论维持**：输出 schema（:460130-460160）；判定式 `R7r`（:483767）`stopShouldContinue && additionalContexts.length>0 && count<3`。

探针（lzy-spike-hooks：SessionStart(startup) 写日志+注入标记；Stop 按触发序号前 2 次注入续跑、之后 `{}` 放手）修复装载后，headless 真机会话（GLM-5.3-Flash）实测：

**实验 1（基础续跑）**：`session-start.log` 每会话 1 条 → SessionStart 钩子自动触发 ✅。Stop 三连发与 stdout 完全对账：

| fire | stopHookActive | 模型回复 | 探针输出 | 结果 |
|---|---|---|---|---|
| 1 | false | `OK` | continue+注入 | 续跑 |
| 2 | true | `SPIKE3-CONT-1` | continue+注入 | 续跑 |
| 3 | true | `SPIKE3-CONT-2` | `{}` 放手 | 会话结束 |

→ **注入上下文确定到达模型**（模型精确按注入指令回复）；非空注入才续跑、探针放手即终止，均实测成立。

**实验 2（预算挤占，headless 版）**：派后台 `sleep 6` 后立即结束回合 → fire 序列与实验 1 完全一致，后台完成通知**未以独立续跑回合出现**，无可分辨信号。同池扣减维持**源码实锤**（共享计数），交互会话复测降级为可选观察项。

**实验 3（≤3 硬顶，探针改「前 6 次全部请求续跑」）**：stdout 末行 `SPIKE3-CONT-3`，该会话 fire 仅 1-4 → **第 4 次续跑请求被引擎拒绝，会话强制终结**。`Stop 续跑 ≤3` 由源码结论升级为**活体实锤** ✅。

**实测输入 schema 附注**：Stop stdin 同时携带 camelCase 与 snake_case 双份字段（`sessionId`/`session_id`、`stopHookActive`/`stop_hook_active`、`transcriptPath`/`transcript_path`）及 `responseText`/`last_assistant_message`/`toolCallCount`/`traceId`/`turnId`；续跑触发的回合 `stopHookActive=true`。写 lzy 钩子时以实测为准。

**意外收获（设计约束）**：探针为全局启用，用户另一交互会话（探针启用后启动）也被触发——钩子状态（触发计数）是**跨会话全局**的，注入会劫持无关会话。→ **lzy loop 的 Stop 钩子必须按 sessionId 隔离状态、按 cwd/scope 限定生效**，已列为 P0 设计约束。

---

## 汇总

| Spike | 状态 | 对设计的影响 |
|---|---|---|
| 1 Edit old_string | ✅ 完成 | hashline 砍掉（P3 观察项关闭）；新增「精确缩进」技能红线 |
| 2 四风格清单 | ✅ 完成 | 安装型插件三风格免改名装载成立、cursor 仅工作区；安装器须「安装+启用」两步，enable 写路径与红线 #1 的关系待 P0 拍板 |
| 3 Stop 注入/预算 | ✅ 完成 | 非空注入续跑 + ≤3 硬顶均活体实锤；同池扣减维持源码结论；Stop 钩子须按 sessionId 隔离状态 |

## 清理记录（2026-09-06）

五个探针已按约删除：`installed_plugins.json` 恢复 spike 前备份（`installed_plugins.json.bak-20260906-spike`）、config 移除 5 条 `enabledPlugins` 项（原备份 `config.json.bak-20260906-spike-enable`）、缓存目录与系统临时目录已删、仓库 `test/spike/` 已删（git 历史保留）。原始日志与探针脚本归档于临时归档目录（会话后已清理）。
