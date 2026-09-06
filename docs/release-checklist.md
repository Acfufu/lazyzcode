# 发布前手工清单（npm + GitHub）

> 维护者拍板（2026-09-07）：发布动作由维护者择机执行；lzy 侧已备料（repository 元数据、files 排除、doctor、契约测试）。本清单是执行时的检查账。

## npm

1. `npm whoami` —— 无账号先 `npm adduser`（包名 `lazyzcode` 已验证空闲）。
2. `npm test` 全绿（node ≥ 20 本地任一版本）。
3. `npm publish --dry-run` —— 逐项确认：
   - 文件清单只含 `cli/ core/ plugin/ + README/LICENSE/CHANGELOG/package.json`；
   - 输出中 grep 不到 `.mimosa`、`.lazyzcode`、`docs/`、`acfufu`、`sess_` 任何一处。
4. `npm publish`（首个版本不带 dist-tag，默认 latest）。
5. 换环境冒烟：`npm i -g lazyzcode && lzy --version && lzy doctor`。

## GitHub 公开仓库

6. 建公开仓库。**若仓库名不是 `lazyzcode` 或换组织，同步改 package.json 的 `repository` / `bugs` / `homepage` 三字段**（`test/package.surface.test.js` 目前不校验 URL 内容，改名靠人）。
7. `git remote add origin <url> && git push -u origin main`；打标 `git tag v<版本> && git push --tags`。
8. CI 绿：`.github/workflows/ci.yml`（node 20/22/24 × `node --test`）。
9. About 填描述与 topics（zcode / agent / discipline / cli / goal-loop）。

## 本地残留外带检查（评审 R5-6）

10. 三处 gitignored 的 `.mimosa/`（`plugin/hooks/`、`test/spike/four-styles/`、`docs/reports/`）是守卫运行态：**绝不整目录拷贝**进任何发布载体。tarball 已验证不含；zip/网盘分发前 `find . -name ".mimosa"` 复查。

## ZCode 插件市场（可选，另立项）

11. 按引擎市场清单格式另立 manifest 并提 PR（P4 报告口径；cache 装载只认 `.zcode/.claude/.codex` 三风格）。

## 版本流转纪律

12. 改版本号必须三方同步：`package.json` / `plugin/.zcode-plugin/plugin.json` / `CHANGELOG.md`——不一致会被 `test/package.surface.test.js` 拦下。
