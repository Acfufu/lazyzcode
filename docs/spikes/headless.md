# Spike：headless 驱动引擎（2026-09-17）

**结论：解锁。** 引擎 0.16.5 的 headless 单发驱动是一等能力，在桌面宿主环境下**零额外配置即可自足运行**；`--resume` 跨进程续会话成立。0.2.0 headless driver（lzy 自驱动引擎会话，roadmap §⑨ 候选1）的前置门通过。

- 基线：桌面壳 3.12.2（env `ZCODE_APP_VERSION` 自报；AGENTS §3 的 3.12.1 为 09-13 复核值）/ 引擎 CLI 0.16.5 / darwin-arm64 / Node v24.19.0
- goal：`headless-spike`（roadmap §⑪ Q6 拍板「独立轻 goal」）；探针 stdout 逐字存档 `artifacts/headless-spike-probes/`（不入 git，见 §8 索引）
- 成本：模型调用 2 次（input 12,025 + 12,052，output 各 2）；用户 `config.json` 只读未写（宪法红线 #1），一切凭据零落档

## 1. 启动形（存档 p0-launch-forms.txt）

| 形态 | 结果 |
|---|---|
| `node` v24.19.0 直跑 `zcode.cjs` | ✔ `--version` = 0.16.5，EXIT=0 |
| `ELECTRON_RUN_AS_NODE=1` + app Electron 二进制（`Contents/MacOS/ZCode`） | ✔ 同上 |
| `node:sqlite`（v24） | ✔ 无旗标可用（DatabaseSync/StatementSync/Session/constants/backup） |

`.node-bundle-meta.json` 实读：`runtime=electron-node, entry=zcode.cjs, source=apps/zcode-cli/packages/cli/dist/zcode.cjs`。

## 2. headless 契约面（--help 全文 dump 存档 p1-help-full.txt）

- 单发：`--prompt <text>` / `-p, --print`（位置式）；机器输出 `--json`
- 续接：`--resume <sessionId>`（`sess_…` 形）；`-c, --continue`（取 cwd 最新会话）
- 护栏：`--max-turns <n>`、`--allowed-tools/--disallowed-tools`、`--attach`、`--target`（headless 设 goal）、`--surface terminal|desktop`
- 权限：`--mode build|edit|plan|yolo`——**`--prompt` 缺省即 yolo**（自驱动安全面必须显式选模式）
- 登录：`login`（OAuth）、`--no-browser`（只打印 URL）
- `--json` 末尾单摘要对象，顶层字段实测：`sessionId` / `traceId` / `turnId` / `response` / `usage`（`modelRequestCount` / `inputTokens` / `outputTokens` / `cacheReadTokens` / `cacheWriteTokens` / `reasoningTokens` / `webFetchRequests` / `webSearchRequests`）/ `eventCount` / `projection`（`status` / `turnCount` / `contextUsed` / `contextWindow: 200000`）

## 3. 认证链（本轮核心发现）

**空隔离 HOME（零 config、零凭据文件）下 `--prompt "reply with OK" --json` 一发即中**（绿半，存档 p2-empty-home-green.txt）——认证并非 HOME/配置文件绑定。减法实验定位依赖链：

| 实验 | env 面 | 实测输出（原文） | 判定 |
|---|---|---|---|
| P2 绿半 | 空 HOME，桌面注入 env 原样继承 | 单摘要 JSON `response:"OK"`，EXIT=0 | 桌面宿主 env 内 headless 自足 |
| P3a 红半① | 空 HOME + 摘除两个 provider env | `无法定位 CLI ZCode Built-in Provider Config：/Applications/ZCode.app/Contents/Resources/glm/provider/zcode-builtin.json, /config/provider/zcode-builtin.json` EXIT=1 | **启动门**：builtin 配置缺席进程起不来（回退路径=引擎旁 `provider/` 与根 `/config/provider/`） |
| P3a2 红半② | 空 HOME + builtin 指向 /tmp 拷贝、personal 摘除 | `Error: Model creation failed (traceId: 10b905aa-6e15-4ae9-a8d9-27ffba54f988)` EXIT=1 | **模型创建门**：有 provider 规则无凭据则建不出模型客户端 |

机制（包内实读证据）：

- 桌面注入 `ZCODE_BUILTIN_PROVIDER_CONFIG_FILE` → `~/.zcode/v2/runtime/provider/<platform>/<壳版>/endpoint-<hash>/zcode-builtin.json`（builtin 模板规则：zai-api 等 template、baseUrl、builtinModelIds）
- 桌面注入 `ZCODE_PERSONAL_PROVIDER_CONFIG_FILE` → `~/.zcode/v2/provider_config.json`（个人 provider 规则，含 `access:{type:"api-key", apiKey:…}` 条目）
- 引擎包内对这两个 env 名各实读一次（`grep -c` 均 = 1；zcode.cjs 11.4MB／3583 行——早期「单行」表述有误，2026-09-17 勘误 ADJ-34；单行 bundle 上 grep -c 恒 1 的家规仍适用其真正的单行 chunk）
- 另见凭据读取路径 `join(baseDir ?? env ?? homedir(), ".zcode", "v2", "credentials.json")`——`login`（OAuth）写此文件，是**脱离桌面宿主的干净机自足路径**；本机桌面注入使该文件非必需（未走此路径）
- 包内 38 处 `keychain` 命中全为捆绑的第三方 CLI 补全表（cosign/k8s），非本引擎认证面——排除钥匙串假设

**P1 已知限制正名**：「headless 需登录/API-key 配置（V4 签名凭据，桌面运行时注入）」的注入载体即这两个 env 文件指针——在桌面宿主会话内 spawn 引擎自动继承，无需任何额外配置。

## 4. `--resume` 跨进程续会话（存档 p4-resume.txt）

`--resume sess_19ee75de-… --prompt "What exact word did I ask you to reply with in your first prompt?"`：

- 同 `sessionId` 返回，新 `traceId` / `turnId`，EXIT=0
- `response:"OK"`——正确复述**仅存在于首轮对话**的指定词（该词不在续问 prompt 内）⇒ 历史在场
- `cacheReadTokens 11904 / inputTokens 12052`：前缀整命中形态（首轮全量上下文走缓存命中，新增仅本轮消息 ≈148 token）⇒ 旁证历史真实续载

**证实**：会话状态跨进程持久（落隔离 HOME 的 `~/.zcode/cli/rollout/model-io-<sessId>.jsonl`，同 session 多轮追加同一文件）。

## 5. ouroboros 契约情报逐条判定（其基线 app 3.2.5/3.3.5 / CLI 0.15.0-0.15.2）

| # | 情报 | 判定 |
|---|---|---|
| 1 | `model.main` 须 `"provider-id/model-id"` 字符串形，对象形报 "Model config is missing" | **修正**：0.16.5 桌面 provider env 下 `model.main` 整体不需要（真实 config.json 顶层只有 plugins/mcp/skills/hooks；空 HOME 亦通）。其在场时的接受语义本轮未测（模型调用预算 2 次已尽），不影响解锁结论 |
| 2 | headless `--prompt --json` 末尾单摘要对象（顶层 response/sessionId） | **证实**（字段面比情报更富，见 §2） |
| 3 | `--resume <sessionId>` 续会话 | **证实**（扩展：`-c, --continue` 按 cwd 取最新） |
| 4 | app 内嵌 Electron/Node 启动形 + `.node-bundle-meta.json` 判别 | **证实**；但 Node v24 直跑已可行，Electron 形非必需 |
| 5 | Node 20 直跑 `zcode.cjs` 撞 `node:sqlite` | **过时**：v24 的 node:sqlite 已无旗标内置，直跑无碍 |

## 6. 对 0.2.0 headless driver 的含义

1. **解锁**：lzy 可在桌面宿主 env 内以 `node <engine>/zcode.cjs --prompt … --json` 自驱动引擎；「单发 + `--resume`」足以表达唤起→推进→交回的无人值守形态。
2. 注意点：
   - 每发 input ≈12k tokens（系统提示为大头）；第二发 11.9k 走 cache-read——自驱动频次必须进限流纪律与成本数学。
   - `--prompt` 缺省 `--mode yolo`——自驱动面必须显式选权限模式。
   - 会话状态/日志落 `~/.zcode/cli/`（HOME 绑定：rollout/model-io、db.sqlite、log）——隔离评估须连 HOME 一起换（本 spike 即此法）。
   - 干净机（CI/无桌面）配方 = 先 `login` 一次 + builtin 配置在场（env 指定或落引擎旁回退路径）。
3. 未测面（不阻塞解锁）：`--max-turns` / `--allowed-tools` 实际行为、`--surface desktop` 分支、逐事件流式输出形态、同机并行多会话互扰、`--resume` 过期会话的报错形态。

## 7. 复现命令要点

```bash
ENGINE=/Applications/ZCode.app/Contents/Resources/glm/zcode.cjs
node "$ENGINE" --version                                   # P0
node "$ENGINE" --help                                      # 契约面
perl -e 'alarm 90; exec @ARGV' env HOME=<隔离HOME> node "$ENGINE" --prompt "reply with OK" --json   # P2
perl -e 'alarm 90; exec @ARGV' env -u ZCODE_BUILTIN_PROVIDER_CONFIG_FILE -u ZCODE_PERSONAL_PROVIDER_CONFIG_FILE HOME=<隔离HOME> node "$ENGINE" --prompt "reply with OK" --json   # P3a 红半①
perl -e 'alarm 120; exec @ARGV' env HOME=<隔离HOME> node "$ENGINE" --resume <sessId> --prompt "…" --json   # P4
```

## 8. 存档索引（artifacts/headless-spike-probes/，不入 git）

| 文件 | 角色 |
|---|---|
| p0-launch-forms.txt | P0 三形态 + node:sqlite |
| p1-help-full.txt | P1 `--help` 契约面全文（62 行） |
| p2-empty-home-green.txt | **绿半**：空 HOME round-trip 摘要 JSON |
| p3a-red-no-auth.txt | **红半①**：双 provider env 摘除 → 启动门拒原文 |
| p3a2-builtin-only.txt | **红半②**：仅 builtin → 模型创建门拒原文 |
| p4-resume.txt | P4 续会话摘要 JSON |

## 9. 2026-09-19 · 0.16.9/3.14.0 复核增注（goal engine-3140-sync；只增注，§1–8 历史结论不动）

壳 3.12.3→3.14.0，引擎 runtime 0.16.5→0.16.9（`zcode.cjs --version` 活体 `0.16.9`）。对本文档契约面的复核增量：

- **`--max-turns` 旗标已从 CLI 面移除**：0.16.5 代 help 列出但解析器拒收一切形态（§6 实测）；0.16.9 代 bundle 内字面量 ×0（`maxTurns` 仅存于 agent/schema 配置字段，非 CLI 旗标）。「墙钟预算是唯一兜底」结论加强为唯一预算面。
- **新旗标面**（CLI 校验块实拟）：`--target` / `--target-replace`（与 `--prompt` 互斥，报文 `--target cannot be used with --prompt`）、`--continue`（续会话，与 `--resume` 互斥）、`--force-mcs`、`--surface`、`--memory-bench`、`--browser-use=headless` + `--browser-executable`、`-p` 别名；`--resume <sessionId>` 契约不变。注意 `--session`/`--agent` 等字面量部分命中 bundle 内置的外部工具 shell 补全表，非 ZCode 旗标。
- **对 spawnHeadless 原语零影响**：core/headless.js 本就不传 `--max-turns`（墙钟预算原语），契约无需改动；仅报文与注释跟新口径（同日 goal #N3）。
