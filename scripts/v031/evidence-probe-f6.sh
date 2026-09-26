#!/usr/bin/env bash
# F6 统一取证入口（红绿同源）：谓词束在「被测树」上跑——红=改前树（git 提取）、绿=工作树。
# 用法：bash scripts/v031/evidence-probe-f6.sh
#   LZY_PROBE_SRC=<源模式>：worktree（默认，工作树）| git:<rev>（该提交的树，经 git show 取文件）
# 谓词束：README 双语行 / guide 双语节 / CHANGELOG 节 / help 用法串 / 全量测试计数（仅工作树模式）
set -u
export PATH="$HOME/.nvm/versions/node/v24.19.0/bin:$PATH"
REPO=/Users/acfufu/Codehub/lazyzcode
SRC="${LZY_PROBE_SRC:-worktree}"
echo "=== F6 PROBE $(date -u +%Y-%m-%dT%H:%M:%SZ)  src=$SRC ==="
show() { # show <path> → 该树的内容到 stdout
  if [ "$SRC" = "worktree" ]; then cat "$REPO/$1"; else git -C "$REPO" show "$SRC:$1"; fi
}
for f in README.md README.zh-CN.md CHANGELOG.md docs/guide/zh.md docs/guide/en.md cli/lzy.js; do
  n1=$(show "$f" | command grep -c "ADR-0030" || true)
  n2=$(show "$f" | command grep -c -- "--delivery-b" || true)
  n3=$(show "$f" | command grep -c "交付编排\|delivery orchestration" || true)
  n4=$(show "$f" | command grep -c "跨项目验证配方\|Cross-project verification" || true)
  echo "$f: ADR-0030=$n1 --delivery-b=$n2 交付编排=$n3 跨项目配方=$n4"
done
if [ "$SRC" = "worktree" ]; then
  echo "--- docs-preview ---"
  node "$REPO/scripts/docs-preview/check-links.mjs" 2>&1 | tail -1
  node "$REPO/scripts/docs-preview/check-anchors.mjs" 2>&1 | tail -2
  echo "--- 全量测试计数（npm test 尾行）---"
  (cd "$REPO" && npm test 2>&1 | command grep -E "^ℹ (tests|pass|fail)" )
fi
echo "=== F6 PROBE END $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="
