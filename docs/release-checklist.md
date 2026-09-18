# 发布前手工清单（npm + GitHub）

> 维护者拍板（2026-09-07）：发布动作由维护者择机执行；lzy 侧已备料（repository 元数据、files 排除、doctor、契约测试）。本清单是执行时的检查账。

## npm

1. `npm whoami` —— 无账号先 `npm adduser`（包名 `lazyzcode` 已验证空闲）。
2. `npm test` 全绿（node ≥ 22 本地任一版本）。
3. `npm publish --dry-run` —— 逐项确认：
   - 文件清单只含 `cli/ core/ plugin/ + README/LICENSE/CHANGELOG/package.json`；
   - 输出中 grep 不到 `.mimosa`、`.lazyzcode`、`docs/`、`acfufu`、`sess_` 任何一处。
4. `npm publish`（首个版本不带 dist-tag，默认 latest）。
5. 换环境冒烟：`npm i -g lazyzcode && lzy --version && lzy doctor`。

## GitHub 公开仓库

6. 建公开仓库。**若仓库名不是 `lazyzcode` 或换组织，同步改 package.json 的 `repository` / `bugs` / `homepage` 三字段**（`test/package.surface.test.js` 目前不校验 URL 内容，改名靠人）。
7. `git remote add origin <url> && git push -u origin main`；打标 `git tag v<版本> && git push --tags`。
8. CI 绿：`.github/workflows/ci.yml`（node 22/24 × `node --test "test/**/*.test.js"`）。
9. About 填描述与 topics（zcode / agent / discipline / cli / goal-loop）。

## 私有测试路径（2026-09-08 已执行，先测后公开）

- 私有仓 `Acfufu/lazyzcode` 已建（LICENSE=MIT 已在库；私有期许可不对外生效，转公开即生效），main 与 v0.0.2 已推；CI 首跑三矩阵绿 → **第 8 步已 ✅**。
- **不依赖 npmjs 的安装**：`npm i -g --allow-git=root github:Acfufu/lazyzcode`。npm ≥12 的 `allow-git` 默认 `none`（供应链加固），不是仓库白名单而是三档策略 `all|root|none`——`root` 档允许「显式指定的根安装目标」走 git 源，传递依赖仍禁。git 源同样尊重 `files` 白名单（实测装载面 = cli/core/plugin + 4 元数据，test/docs 不夹带）。
- 转公开：Settings → General → Danger Zone → Change repository visibility；随后按上方 npm 节 1→5 执行（npmjs 包名 `lazyzcode` 在私测期未被占用，公开发布即锁名）。

## 本地残留外带检查（评审 R5-6；ADJ-41 内容级化，0.0.10）

- 文件名层：确认随包清单无本机路径/探针文件（`npm pack --dry-run` 对单）。
- 内容层（0.0.10 起）：`grep -rn "sess_" plugin/ docs/ --include="*.js" --include="*.md"` ——
  随包内容不得携带会话标识（tripwire 注释内的 `sess_` 形态曾漏过文件名层检查）；
  命中即确认属设计内注释或改写后再发。

10. 三处 gitignored 的 `.mimosa/`（`plugin/hooks/`、`test/spike/four-styles/`、`docs/reports/`）是守卫运行态：**绝不整目录拷贝**进任何发布载体。tarball 已验证不含；zip/网盘分发前 `find . -name ".mimosa"` 复查。

## ZCode 插件市场（市场 B 路——物料已落地，2026-09-16）

11. manifest 已入库：`.claude-plugin/marketplace.json`（goal v006-closeout）。配方：引擎按 `.claude-plugin/marketplace.json` → `marketplace.json` 顺序发现；条目 `source = {source:"github", repo:"Acfufu/lazyzcode", ref:"<发布 tag>", path:"plugin"}`——tarball API 免本机 git、`pin = sha ?? ref`（同仓 manifest 有意不写 sha）、`path` 指向 `plugin/` 子目录（stripRoot 后 join 校验，引擎实锤）。**每发布同步**：`plugins[].version` 与 `ref` 改成新 tag，与版本三体 bump 同一批提交。活体取证配方：引擎 app-server stdio 发 `plugins/marketplace/add`（信封 `{id, method, params}`，`workspace = {workspacePath, workspaceKey}`，`source = "Acfufu/lazyzcode"`）→ `plugins/overview` 的 availablePlugins 列出 lazyzcode 即绿；红半 = push 前同调用报 `Marketplace manifest not found in GitHub repo`。**runbook 订单 lesson（0.0.6 实测）**：tag 须最后切、publish 从 tagged 树发起——0.0.6 的 tag 落在尾随修复 4 提交之前（test-only + 行尾 renormalize，已核实零运行时 delta，但属流程瑕疵）。

## 版本流转纪律

## 发布载荷冻结纪律（ADJ-15，0.0.10）

**tag 之后、publish 之前，随包文件一律禁改。** payload（`plugin/` 全部）、双语
README、CHANGELOG、`package.json` 的 files 清单——任何一项在 tag 后又改动，都会
造成「registry 载荷/文档 ≠ 仓库 tag 内容」：已装用户读到的纪律文本与 npm 包内容
分叉，doctor 的 payload-ver 内容级对照（0.0.10 起）也会把这种漂移报成 warn。

- 发现漏改：不补丁 tag——按版本流转纪律 bump 后重走定版（新 tag 替换旧 tag 仅在
  尚未 publish 时允许；已 publish 一律进下一版）。
- 定版提交（三体 bump+市场 manifest 钉+CHANGELOG 定版）必须是 tag 前最后一次触碰
  随包文件的提交；tag 切在该提交上（runbook 既有订单）。
- 发布后核对：`npm pack --dry-run` 清单 vs tag 树逐文件一致；doctor payload-ver
  内容级对照（样本 skills/zw/SKILL.md）双 ✔。


12. 改版本号必须三方同步：`package.json` / `plugin/.zcode-plugin/plugin.json` / `CHANGELOG.md`——不一致会被 `test/package.surface.test.js` 拦下。**外加两处文档站同步（无测试拦截，靠人）**：`docs/_layouts/home.html` 的 SoftwareApplication JSON-LD `softwareVersion`、`docs/sitemap.xml` 相关页的 `lastmod`。

## GitHub Pages（文档站）

13. `docs/` 是 Jekyll 站点骨架（`_config.yml` GFM + `_layouts/` + `assets/`；内容单源= `guide/en.md`+`zh.md`）。仓库公开后开通：Settings → Pages → Build and deployment → Source 选 **Deploy from a branch** → Branch `main`、Folder **`/docs`** → Save。站点地址 `https://<org>.github.io/lazyzcode/`；**若仓库改名或换组织，同步改 `docs/_config.yml` 的 `baseurl`**。

## 执行记录（2026-09-14，v0.0.5 首发）

- **npm（第 1-5 步）**：0.0.5 已发布、名字锁下（2FA 走浏览器授权）；registry 元数据复核（bin/engines/repository/tarball）无误；换环境冒烟=隔离 prefix `npm i -g lazyzcode` → `lzy --version` 0.0.5 → `lzy doctor` 全 ✔（缓存逐文件 sha256 一致）。
- **转公开（第 6 步）**：`gh repo edit --visibility public` 已执行；仓库名与元数据未动，三字段无需改。
- **tag + Release（第 7 步）**：`v0.0.5` 打在 98f019c（=npm 发布的同一棵树）；GitHub Release 用英文首版说明。
- **CI（第 8 步）**：node 22/24 矩阵绿（历史重整后连续多次全绿）。
- **About（第 9 步）**：topics 五枚已加（zcode / agent / discipline / cli / goal-loop）。
- **Pages（第 13 步）**：`POST /repos/.../pages` source=main `/docs` 已执行；**首建失败**——Liquid 把 `docs/reviews/` 历史报告表格里的 <code>&#123;&#123;&#123;</code> 当模板语法炸掉整个构建（历史评审从未过 Jekyll；本地预览走 marked 无此面，属双工具链保真缺口）→ `_config.yml` 排除 `reviews`/`evidence` 修复（a0f40c9），guide 指向 `diagnostics/` 的真实链接不受影响。实测：站点与 guide/zh、developers、adr、ablation 深层页全 200，锚点渲染正常。**二课（2026-09-14）：本行先以反引号字面写入三连左花括号，fda2c31 的 Pages 构建即被同一机制再次炸掉——写事故记录本身复发事故；修复=花括号改 HTML 实体书写（Liquid 不可见、浏览器渲染等价）。**
- **同日附带**：git 历史重整为 22 条英文里程碑提交后公开（重整详情见提交史与备份注记）。
- **仍未执行**：第 11 步 ZCode 插件市场（另立项）。

## 执行记录（0.0.6，跨平台首发——待实弹）

> 机械件已备（goal v006-release-mechanics，2026-09-15）：版本三体 0.0.6、CHANGELOG 定版、活面清扫完毕。剩余动作全部是用户侧三命令，按序执行。

### Runbook（按序）

1. **push dev**：`git push origin dev`——未推提交随本次上远端，CI 的 windows-latest 腿首跑，其绿判即 ADR-0011 验收线「CI 全硬」的最后悬置格（本地代理证据=Windows VM 套件 0 挂）。
2. **tag**：`git tag v0.0.6 && git push origin v0.0.6`——tag 待史压缩拍板后落（若先压缩未推段，则打在压缩后 tip；两情形都不需要 force，未推段重排后 push 仍是 fast-forward）。
3. **publish**：`npm publish`（2FA 走浏览器授权，同 0.0.5）；发后隔离 prefix 冒烟：`npm i -g lazyzcode && lzy --version`（应 0.0.6）+ `lzy doctor`。若 publish 日≠定版日（CHANGELOG 写的 2026-09-15），改 CHANGELOG 一行重提即可。
4. **GitHub Release**：以本节下方草稿为 notes 创建 `v0.0.6` Release。
5. **Pages 滞后提醒**：文档站部署自 `main`——本批三平台措辞在并回 main 前不上站（dev 分支模型的既知代价）。

### GitHub Release notes 草稿（v0.0.6）

```markdown
## Highlights

- **Windows and Linux are now supported.** One hooks manifest line across all three
  platforms: a POSIX shell runs the extensionless `run-hook` launcher, and on Windows
  cmd.exe resolves the same line to the `run-hook.cmd` twin via PATHEXT. The engine
  location table now covers the macOS app bundle, Linux deb installs (`/opt/ZCode`), and
  Windows per-user installs (`%LOCALAPPDATA%\Programs\ZCode`).
- **`lzy doctor` is platform-aware**: the `hook-node` check probes the per-OS launcher
  (explicitly via cmd.exe on Windows, since Node ≥ 18 refuses to spawn `.cmd` directly),
  and the `platform` row reports the engine-candidate hit per platform instead of the
  former darwin-only stance.
- **Windows is a first-class test platform**: the suite passes on win32 (ESM file-URL
  imports, USERPROFILE-aware isolation, platform-branched launcher contract), and CI
  gained a `windows-latest` leg alongside ubuntu.
- **Live acceptance on ARM VMs**: the full chain (install → doctor → engine hook
  registration `hooks: 5` → goal-loop finish) verified on Windows 11 ARM64 and Ubuntu
  aarch64 virtual machines.
- Docs (README, guide, developers pages, llms.txt, FAQ schema) now state three-platform
  support with the coverage boundary below.

## Coverage boundary

Live evidence covers **arm64** guests (Parallels VMs on an Apple Silicon host). x64
coverage follows the official ZCode download matrix (three platforms × dual arch) by
documentation; the detection paths are architecture-independent (environment-based).

## Upgrade

`npm i -g lazyzcode && lzy install` — requires the ZCode desktop app (logged in),
Node ≥ 22, and git.
```

### 补记（2026-09-16，goal v006-closeout）

- 上节 Runbook 五步已全部实弹收官（2026-09-15：push/tag v0.0.6/GitHub Release/npm publish，registry latest=0.0.6，CI 四腿含 windows stdin 修复 eedb25c 全绿）。
- 第 11 步市场物料落地：`.claude-plugin/marketplace.json` 入库 + README 双语市场安装路径；活体取证与 runbook 订单 lesson 记在第 11 步。

## 执行记录（0.0.7，`lzy update` 首发——机械件已备，publish 留用户）

> 机械件（2026-09-16，维护者指令直发，未走 goal loop——槽位被 done 态 gpt-v3-feedback-triage 占用，未动用户记录）：版本三体 0.0.7、市场 manifest `version`/`ref` 随发布同步（第 11 步）、CHANGELOG 定版、AGENTS.md §2 状态行跟齐。本节提交不带 `Goal:` 尾注（账本巡逻预期一条 warn）。

### Runbook（按序）

1. **push main**（发布提交与 GPT V3 triage docs 提交随行上远端）。
2. **CI 全绿再 tag**（0.0.6 lesson：tag 最后切）：四腿（node 22/24 × ubuntu/windows）全绿后 `git tag v0.0.7 && git push origin v0.0.7`。
3. **GitHub Release**：以本节下方草稿为 notes 创建 `v0.0.7`。
4. **publish（用户手动）**：`npm publish`（2FA 浏览器授权，同 0.0.5/0.0.6）；publish 日≠2026-09-16 则改 CHANGELOG 一行重提。
5. **发后核验**：registry `dist-tag latest=0.0.7`；隔离 prefix 冒烟 `npm i -g lazyzcode && lzy --version`（应 0.0.7）+ `lzy doctor`；真机狗粮 `lzy update`（本机全局 0.0.6 → 0.0.7，升级链活体）。
6. **win32 三 VM 实弹**（0.0.7 特有，publish 后才可做——升级目标必须是已发布版本）：Win11 ARM64 装 npm 0.0.6 → `lzy update` 应经 ComSpec 链升 0.0.7 并子进程 sync（ADR-0012 更新链的 win32 全链活体验收，v007 顺延件）。

### GitHub Release notes 草稿（v0.0.7）

```markdown
## Highlights

- **`lzy update` — one command to upgrade.** Probes the registry with `npm view`,
  upgrades the global package, then re-runs `sync` from a **fresh child process**
  spawned out of the new install (an in-process sync would deploy the new payload
  with the old in-memory code). Already-latest exits without installing; every
  mid-chain failure prints a recovery hint, and the upgraded-but-not-synced
  mid-state names itself.
- **Bilingual upgrade docs**: what `lzy update` automates, why live sessions need
  the extra `sync` step (they read the engine cache's versioned directory, so a
  bare npm upgrade is invisible to them), and why `enabledPlugins` survives
  version bumps without re-enabling.

## Upgrade

New: `lzy update`. On 0.0.6 or earlier: `npm i -g lazyzcode && lzy sync`.
Requires the ZCode desktop app (logged in), Node ≥ 22, and git.
```

### 补记（2026-09-16，publish 收官 + win32 三 VM 实弹）

- Runbook 1-5 全部实弹收官：push → CI 四腿绿 → tag v0.0.7（f52e171，=origin/main 尖）→ GitHub Release → 用户 `npm publish`（2FA）。registry `dist-tag latest=0.0.7`，发布 shasum 与 dry-run 逐字节一致（f0b9d7a1…）。
- 隔离 prefix 冒烟：`npm i -g lazyzcode` → `lzy --version` 0.0.7 + `lzy doctor` 18 ✔ 零失败。
- 真机狗粮：手动两步 0.0.6→0.0.7 + sync 过；`lzy update` 已是最新路径活体（EXIT=0）。**勘误**：`update` 无法从更老版本自举（0.0.6 全局无此命令）——「0.0.6 → lzy update」不是合法狗粮链，跨版本桥=README 手动两步；真升级链活体=降版标记配方（v007 F2）。
- **win32 三 VM 实弹（Runbook 第 6 步，Win11 ARM64，SYSTEM exec 上下文）**：registry 新装 0.0.7（9s）→「已是最新」半区 EXIT=0 → `npm pkg set version=0.0.6 --prefix <全局根>` 降戳（F2 配方 win32 版，免 cmd 引号地狱）→ `lzy update` 全链 EXIT=0：probe 0.0.6 vs 0.0.7 → ComSpec spawn `npm i -g lazyzcode@latest` → **全新子进程 sync 输出可见（stdio inherit）**、缓存 0.0.7 落 systemprofile 下（prlctl exec=SYSTEM 会话既知形态）→ 终态三件核对全绿（package.json 复原 0.0.7 / `--version` 0.0.7 / 缓存 manifest 在场）。ADR-0012 win32 验收线闭环。

## 执行记录（0.0.8，完整性内核——机械件已备，publish 留用户）

> 机械件（2026-09-16，维护者指令直发，未走 goal loop）：版本三体 0.0.8、市场 manifest `version`/`ref` 钉 v0.0.8（第 11 步每发布同步）、CHANGELOG 定版、AGENTS.md §2 状态行跟齐。本节提交不带 `Goal:` 尾注（账本巡逻预期一条 warn，同 0.0.7 先例）。

### Runbook（按序）

1. **push main**（定版提交与 integrity-kernel 未推提交随行上远端）。
2. **CI 全绿再 tag**（0.0.6 lesson：tag 最后切）：四腿（node 22/24 × ubuntu/windows）全绿后 `git tag v0.0.8 && git push origin v0.0.8`。
3. **GitHub Release**：以本节下方草稿为 notes 创建 `v0.0.8`。
4. **publish（用户手动）**：从 tagged 树先 `npm publish --dry-run` 复核文件清单与敏感串（第 3 步检查项），再 `npm publish`（2FA 浏览器授权，同 0.0.5–0.0.7）。
5. **发后核验**：registry `dist-tag latest=0.0.8`；隔离 prefix 冒烟 `npm i -g lazyzcode && lzy --version`（应 0.0.8）+ `lzy doctor`；真机狗粮 `lzy update`（本机 0.0.7 → 0.0.8 升级链活体）。
6. **win32 三 VM 复测**（publish 后才可做）：registry 新装 0.0.8 + `lzy doctor` + scratch loop 全链 finish。

### GitHub Release notes 草稿（v0.0.8）

```markdown
## Highlights

- **finish integrity gate — dirty goals can no longer report done (P0-A closure).**
  `lzy loop finish` now runs a per-root integrity check over every tree in the
  goal's evidence scope (the host repo plus any declared subjects): dirty
  (uncommitted changes), missing (root gone / not a git repo / unparseable HEAD),
  and git failure (fail-closed) each reject the finish. **No bypass flag.**
- **Composite evidence fingerprints (multi-tree)**: F-item evidence binds the sha256
  over the HEAD tree hash of every root in the host ∪ subjects set — any root
  changing, or the subject set itself changing, stales the evidence. Legacy
  evidence keeps the 0.0.7-identical single-tree comparison.
- **Subjects (multi-tree goals)**: declare sibling repos with `subjects: <path>`
  plan-header lines and manage them with `lzy loop subject add|remove|list`
  (`remove` is the missing-root deadlock escape).
- **Plan snapshot + hash**: adoption snapshots the plan and binds `goal.planHash`;
  reviews bind the reviewed artifact; status re-verifies the snapshot hash
  (tamper visible).
- **Tier persistence + HEAVY machine gate**: `register --tier heavy`, one-way
  `lzy loop tier heavy`; a HEAVY goal is rejected at adoption without a PASS
  review verdict (`--force` does not cross).
- **Atomic finish reports**: the report archive lands (tmp+rename) before the goal
  flips to `done`; a failure leaves the goal `executing` with a recovery path.

## Upgrade

`lzy update` (0.0.7+). On 0.0.6 or earlier: `npm i -g lazyzcode && lzy sync`.
Requires the ZCode desktop app (logged in), Node ≥ 22, and git.
```

### 补记（2026-09-16，publish 收官 + win32 VM 复测）

- 发布过程 CI 抓获第五族 win32 测试雷（memory windows-test-mines-families）：integrity-kernel 夹具 `split("/").pop()` 取 basename，win32 反斜杠路径切不开→整条绝对路径写进 `subjects:` 头→production `path.resolve` 折出双重前缀，7 个测试同根因翻红且断言形态迥异（误伤面=共用 sibName 的全部用例）；`startsWith("/")` 绝对路径断言同族（realpath 在 win32 给盘符）。mac 本地+ubuntu CI 双绿不构成 win32 证据。test-only 修复 69992ff（basename/isAbsolute），CI 四腿绿后 tag v0.0.8 最后切（=69992ff）。
- Runbook 1-5 收官：push → CI 四腿绿 → tag → GitHub Release → 用户 `npm publish`（2FA）。registry `dist-tag latest=0.0.8`，发布 shasum `b6064e34…` 与 dry-run 逐字一致。
- 隔离 prefix 冒烟：`npm i -g lazyzcode`（隔离 prefix）→ `lzy --version` 0.0.8 + doctor 全套运作。
- 真机狗粮：`lzy update` 0.0.7→0.0.8 全链 EXIT=0（探测→升级→新装子进程 sync 输出可见）；`lzy update` 已是最新半区通；doctor install/files 双 ✔（缓存 15 文件逐文件 sha256 一致）。
- **win32 VM 复测（Runbook 第 6 步，Win11 ARM64，SYSTEM exec 上下文）**：`lzy update` 0.0.7→0.0.8 EXIT=0（ComSpec 链+新装子进程 sync，缓存落 systemprofile 既知形态）→ doctor（payload/install/files/hooks/node 全 ✔；engine/platform ⚠=SYSTEM 上下文不见用户级桌面端，既知形态非缺陷）→ scratch loop 全链（register→plan〔快照 sha256 行在场〕→start→step done N1/F1〔证据绑指纹 6d733f8087〕→finish 过：完整性闸门文案+报告归档）→ status 快照复核一致。0.0.8 完整性内核 win32 活体验收闭环。
- VM 探针作业教训：prlctl exec 的 cmd 对正斜杠路径 mkdir/cd 报「找不到路径」，且 cd 失败后 `&` 链继续在默认 cwd（system32）执行——node 相对写入会残留 system32（已清理）；配方=`%TEMP%` 相对路径 cd 链 + 一切文件操作走 node。

## 执行记录（0.0.9，attestation 列车——机械件已备，publish 留用户）

> 机械件（2026-09-17，维护者指令直发，未走 goal loop）：版本三体 0.0.9、市场 manifest `version`/`ref` 钉 v0.0.9（第 11 步每发布同步）、CHANGELOG 定版、README 对比表补第 11 行（attestation 卖点，0.0.9 拍板⑥叙事件；narrative-checklist 计数钉 10/10→11/11 同步）、home.html softwareVersion + sitemap 首页 lastmod、AGENTS §2 跟齐。本节提交不带 `Goal:` 尾注（沿 0.0.7/0.0.8 先例，账本 warn 预期）。

### Runbook（按序）

1. **push main**（定版提交与棒1/棒2/headless spike 共 16+ 个未推提交随行上远端）。
2. **CI 全绿再 tag**（tag 最后切）：四腿（node 22/24 × ubuntu/windows）全绿后 `git tag v0.0.9 && git push origin v0.0.9`。
3. **GitHub Release**：以本节下方草稿为 notes 创建 `v0.0.9`。
4. **publish（用户手动）**：从 tagged 树先 `npm publish --dry-run` 复核文件清单与敏感串（第 3 步检查项），再 `npm publish`（2FA 浏览器授权，同 0.0.5–0.0.8）；publish 日≠2026-09-17 则改 CHANGELOG 一行重提。
5. **发后核验**：registry `dist-tag latest=0.0.9`；发布 shasum 与 dry-run 逐字比对；隔离 prefix 冒烟 `npm i -g lazyzcode && lzy --version`（应 0.0.9）+ `lzy doctor`；真机狗粮 `lzy update`（0.0.8 → 0.0.9 升级链活体，新载荷含 DAG/attestation 面）。
6. **win32 VM 复测**（publish 后才可做）：registry 新装 0.0.9 + `lzy doctor`（新增 payload-ver 行与 DAG 面零异常）+ scratch loop 全链 finish（红绿 manifest/attestation 文案活体）。

### GitHub Release notes 草稿（v0.0.9）

```markdown
## Highlights

- **The evidence ledger is now the judge.** `verify`/`finish` no longer compare
  hashes by themselves: each F step's green evidence is anchored to the central
  invalidation DAG (`.lazyzcode/loop/dag.json` — cross-reset, JSON atomic write
  with a payload checksum, fail-closed on corruption with a recovery pointer).
  Legacy evidence keeps the 0.0.8-identical dual track; a fingerprint-form
  record with no ledger node rejects as "账本不一致" (re-record to re-register).
- **Red/green evidence as a machine manifest**: `lzy evidence red` / `waive-red`
  record the failing half with its own surface (composite fingerprint by
  default, `--surface` for external surfaces such as a published version);
  greens mirror at `step done`; rebinds append `supersedes` chains;
  `lzy evidence list` renders the per-F manifest, and `lzy dag dependents`
  answers "what depends on X".
- **Comparator attestation + HEAVY finish gate**: `lzy attest comparator --file`
  records qa-executor verdicts as machine attestations bound to slug + planHash
  + composite fingerprint + file sha256. HEAVY `finish` requires a current
  MATCH attestation — missing, MISMATCH, and stale all reject. No bypass flag.
- **LOOP_COMPLETE final attestation**: every successful finish writes
  `.lazyzcode/attestations/<slug>-<UTC-compact>.json` (plan hash, per-root head
  trees, composite fingerprint, ledger-anchored evidence refs, comparator
  record, report sha256) — a machine proof of completion that survives `reset`
  as history, outside the scar patrol's view.
- **doctor `payload-ver`**: the installed payload cache version directories vs
  the running CLI version, so the ADR-0012 "npm upgraded but not synced"
  intermediate state names itself instead of confusing live sessions.

## Upgrade

`lzy update` (0.0.7+). On 0.0.6 or earlier: `npm i -g lazyzcode && lzy sync`.
Requires the ZCode desktop app (logged in), Node ≥ 22, and git.
```

### 补记（2026-09-17，publish 收官）

- Runbook 1-5 收官：push（17 提交，棒1/棒2/headless spike 随行）→ CI 四腿绿（run 35150826600）→ tag v0.0.9（6c1d099）→ GitHub Release → 用户 `npm publish`（2FA）。registry `dist-tags.latest=0.0.9`；发布 shasum `90ec5417…` 与 dry-run 逐字一致；publish 时刻 2026-09-16T21:20Z（=本地 09-17，CHANGELOG 日期成立，无需重提）。
- 隔离 prefix 冒烟：`lzy --version` = 0.0.9（载荷同版本）。**npm 12 新雷=EALLOWREMOTE**（remote tarball URL 直装默认禁，同 EALLOWGIT 策略家族）——绕法=`lazyzcode@0.0.9 --prefer-online`；另注 **npm view 元数据缓存滞后数分钟**（publish 后直读仍得旧版，registry HTTP 端点才是真相源；`lzy update` 的探测在数分钟后自然读到新版）。
- 真机狗粮：`lzy update` 0.0.8→0.0.9 全链 EXIT=0（探测→升级→新装子进程 sync 输出可见，缓存 0.0.9 目录落位）；升级后 doctor install/files 双 ✔（15 文件逐文件 sha256 一致）；隔离 0.0.9 doctor 对未 sync 缓存的 install ⚠/files ✖ 行=ADR-0012 中间态自名活体。
- **win32 VM 复测收官（Runbook 第 6 步，Win11 ARM64〔现名 Windows 11 aarch64〕，SYSTEM exec 上下文，2026-09-17）**：registry 新装 `npm i -g lazyzcode@0.0.9`（372ms）→ `lzy --version`=0.0.9（载荷同版本；引擎未找到=SYSTEM 上下文既知形态）→ **doctor payload-ver 新行双读活体**：sync 前 ⚠「缓存 [0.0.7, 0.0.8] 无 CLI 0.0.9 的载荷目录：跑 lzy sync（ADR-0012 中间态自查面）」/ sync 后 ✔「[0.0.7, 0.0.8, 0.0.9] · CLI 0.0.9 一致」→ `lzy sync` 载荷落 systemprofile 缓存（既知形态，15 文件 sha256 一致）→ 降戳 `npm pkg set version=0.0.8 --prefix <全局根>` → **`lzy update` 全链 EXIT=0**（probe 0.0.8 vs 0.0.9 → ComSpec 升级 → 子进程 sync 输出可见 → package.json 复原 0.0.9）→ **scratch loop 全链**：register→plan〔快照 sha256 行〕→start→`lzy evidence red`（红半 n2·gen1·基线面 d2093dfff1）→翻转提交→`step done` 绿→未提交 plan.md 拦 finish 预演→补提交→合法 rebind（↻ gen2·19bfc63888）→**`lzy evidence list` manifest 活体**（4 节点：计划 n1·planHash+红绿两半+rebind 链 gen1→gen2）→finish 过完整性闸门→**终验 attestation 落盘**（w32redgreen-20260916T220120Z.json，942B）→reset 后 attestation 存活。
- **prlctl exec 作业新知（本台 Parallels 26.4.1）**：①语法**无 `--` 分隔符**——`prlctl exec <VM> cmd.exe /c <cmd>` 直跑；带 `--` 的旧写法全部静默 exit 2（本机记忆旧配方受此污染，已订正 memory）；②挂起恢复会楔死工具通道（exec 全灭+`list -a` 的 IP 列显「-」，但 `list -i` 里真实 IP 在）——`prlctl restart` 解楔，重启后等 2-3 分钟桌面起来；③控制台截屏动词是 `prlctl capture`（无 capture-screenshot）；④guest 输出编码：node 系（lzy/npm）原生 UTF-8 直读，cmd 内建输出是 GBK 需 iconv——**别对 node 输出做 GBK→UTF-8 二次转码**；⑤长命令仍走「每条独立 exec + ASCII 参数 + 计划文件走 base64 通道」，`&&` 链与嵌套引号照旧是雷。

## 执行记录（0.0.10，双审修复列车——2026-09-17）

- 定版：5fc15d1（三体 bump 漏了第三体 plugin/.zcode-plugin/plugin.json——package.surface 版本三方测试当场抓：223/224 红，教训与 0.0.8 win32 夹具同族=**发布提交链必须在 npm test 全绿闸后**）→ 补 e404829 → push → CI 四腿绿（run 35170974099，node 22/24 × ubuntu/windows）→ tag v0.0.10 最后切（=origin 尖 e404829）→ GitHub Release（Highlights/Coverage boundary 体例）。npm publish 归用户 2FA（待办）。
- 载荷冻结纪律（ADJ-15）首版生效：tag 后仅 docs/release-checklist.md（未随包）动过；样本内容级对照（skills/zw/SKILL.md）已入 doctor payload-ver。
- 随 0.0.10 沿用 0.0.9 补记两条 npm 雷：npm 12 EALLOWREMOTE（remote tarball 直装默认禁，绕法 `lazyzcode@0.0.10 --prefer-online`）+ npm view 元数据缓存滞后数分钟（registry HTTP 端点为真相源）。

## 执行记录（0.1.0，协议升级列车——机械件已备，publish 留用户）

> 机械件（2026-09-18，维护者指令直发，未走 goal loop）：版本三体 0.1.0（package.json / plugin/.zcode-plugin/plugin.json / CHANGELOG 定版）、市场 manifest `version`/`ref` 钉 v0.1.0（第 11 步每发布同步）、home.html `softwareVersion` 0.0.9→0.1.0（**补 0.0.10 漏账**：该面无测试拦截靠人，0.0.10 弧漏更，本次随发布补齐记档）、sitemap 首页+guide 双语 lastmod→2026-09-18、SKILL 活体面排序句随载荷首发（e083808，zpigeon 重采雪崩复盘；zpigeon 侧 preflight+INFRA-FAIL 归因=c7934a1 不随本包）。本节提交不带 `Goal:` 尾注（沿先例，账本 warn 预期）。⚠ 本批含 19 个首推提交（棒A 修复轮+棒B+batch-2 报告+SKILL 句），CI 首见这些树——windows 腿是新夹具雷高危面，绿判后再 tag。

### Runbook（按序）

1. push main（20 提交上远端）→ CI 四腿绿（node 22/24 × ubuntu/windows；红则 test-only 修复重走，tag 恒切绿判树）。
2. `git tag v0.1.0 && git push origin v0.1.0`（tag 最后切，落 CI 绿判的定版提交）。
3. GitHub Release：以下方草稿为 notes 创建 `v0.1.0`。
4. **publish（用户 2FA）**：`npm publish`；发后隔离 prefix 冒烟 `npm i -g lazyzcode && lzy --version`（应 0.1.0）+ `lzy doctor`。
5. 发后核验：registry `dist-tag latest=0.1.0`、发布 shasum 与 dry-run 逐字一致、真机 `lzy update` 0.0.10→0.1.0 全链 EXIT=0、`lzy doctor` `payload-ver` 深对照双 ✔。

### GitHub Release notes 草稿（v0.1.0）

```markdown
## Highlights

- **Attempt lineage (`lzy loop supersede`)** (ADR-0016): changing the plan
  mid-execution is no longer a dead end — the old attempt is marked superseded
  and attempt+1 opens with every adoption gate re-run (same-hash refusal,
  previous snapshot archived, base tree re-captured). `lzy loop attempts`
  reads the lineage; the chain survives resets.
- **Invalidation preview as a real command**: `lzy dag stale` reports
  per-evidence freshness (fresh / stale / superseded / external / unknown)
  against the current composite fingerprint. Display-only by design — the
  gates keep judging by direct comparison.
- **HEAVY exemption tightening (INV-09)**: HEAVY finish refuses to close an
  F item with green-only when its red half is missing; recover by honest
  reverse-pairing or waive. **Harness freeze (INV-08)**: red/green halves can
  bind a procedure string (`--harness`, ≤300 chars); mismatched pairs are
  flagged in `lzy evidence list` and refused at HEAVY finish.
- **Headless drive primitive** (ADR-0017): `spawnHeadless` (literal argv,
  shell off, explicit `--mode`, wall-clock SIGKILL budget, HOME isolation
  with auth passthrough, `--json` summary) + a full-chain self-drive E2E
  script + a `doctor headless` line.
- **Protocol text layer**: zw SKILL now marks each red line with its
  enforcement tier (L0–L3), adds risk-class to tier triage, and — new in
  this train — the live-surface evidence ordering rule: iterate the test
  harness before banking any green, capture greens in one final batch after
  the freeze, and `INFRA-FAIL:`-attributed failures do not retire an
  approach.

## Upgrade

From 0.0.10: `lzy update` (spawns a fresh child process to deploy the new
plugin payload). From older versions: manual two-step (`npm i -g lazyzcode
&& lzy install`). Requires the ZCode desktop app (logged in), Node ≥ 22, git.
```

### 补记（2026-09-18，发布日实弹）

- **CI 首跑（a55833d）windows 双腿红**：extract-metrics×2+aggregate×1——根因=六个 `scripts/ablation/*.mjs` 入口守卫 `` `file://${argv[1]}` `` 在 win32 永假（反斜杠盘符路径 ≠ `file:///` URL）→ CLI 块静默零输出退出 0。f6fc29d 统一改 `pathToFileURL`（argv[1] 空值安全）；scripts/ 不在 npm 包内，**payload 冻结点不变**。复跑 run 35379002725 四腿全绿。
- **流程瑕疵自记账**：首跑未出判时 v0.1.0 已被切出（`gh run watch --exit-status` 对失败 run 伪报 exit 0，且切 tag 与判决查看串在同一条命令未独立核验）→ 按「未 publish 的 tag 可替换」纪律删除重切 `v0.1.0=f6fc29d`。lesson：CI 判决**永远**以 `gh run view --json conclusion` 为准；tag 命令永不与未核验判决同串。
- GitHub Release 已建（notes=本节草稿逐字）；tag 即发布树。publish 留用户 2FA。
