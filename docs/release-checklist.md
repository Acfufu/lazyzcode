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

## 本地残留外带检查（评审 R5-6）

10. 三处 gitignored 的 `.mimosa/`（`plugin/hooks/`、`test/spike/four-styles/`、`docs/reports/`）是守卫运行态：**绝不整目录拷贝**进任何发布载体。tarball 已验证不含；zip/网盘分发前 `find . -name ".mimosa"` 复查。

## ZCode 插件市场（市场 B 路——物料已落地，2026-09-16）

11. manifest 已入库：`.claude-plugin/marketplace.json`（goal v006-closeout）。配方：引擎按 `.claude-plugin/marketplace.json` → `marketplace.json` 顺序发现；条目 `source = {source:"github", repo:"Acfufu/lazyzcode", ref:"<发布 tag>", path:"plugin"}`——tarball API 免本机 git、`pin = sha ?? ref`（同仓 manifest 有意不写 sha）、`path` 指向 `plugin/` 子目录（stripRoot 后 join 校验，引擎实锤）。**每发布同步**：`plugins[].version` 与 `ref` 改成新 tag，与版本三体 bump 同一批提交。活体取证配方：引擎 app-server stdio 发 `plugins/marketplace/add`（信封 `{id, method, params}`，`workspace = {workspacePath, workspaceKey}`，`source = "Acfufu/lazyzcode"`）→ `plugins/overview` 的 availablePlugins 列出 lazyzcode 即绿；红半 = push 前同调用报 `Marketplace manifest not found in GitHub repo`。**runbook 订单 lesson（0.0.6 实测）**：tag 须最后切、publish 从 tagged 树发起——0.0.6 的 tag 落在尾随修复 4 提交之前（test-only + 行尾 renormalize，已核实零运行时 delta，但属流程瑕疵）。

## 版本流转纪律

12. 改版本号必须三方同步：`package.json` / `plugin/.zcode-plugin/plugin.json` / `CHANGELOG.md`——不一致会被 `test/package.surface.test.js` 拦下。

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
