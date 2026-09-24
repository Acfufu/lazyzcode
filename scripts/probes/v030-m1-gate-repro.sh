#!/bin/bash
set -u
G="node /Users/acfufu/Codehub/lazyzcode/cli/lzy.js"
GH="node /Users/acfufu/Codehub/lazyzcode/plugin/hooks/trigger.js"
R="node /Users/acfufu/Codehub/v030-fixtures/lazyzcode@4b54f77/cli/lzy.js"
RH="node /Users/acfufu/Codehub/v030-fixtures/lazyzcode@4b54f77/plugin/hooks/trigger.js"
HASHV1=$(printf "v1\n" | shasum -a 256 | cut -c1-8)

mk() {
  rm -rf "$1"; mkdir -p "$1"; cd "$1"
  git init -q; git config user.email t@t; git config user.name t
  mkdir -p "$(dirname "$1")/sibling" && cd "$(dirname "$1")/sibling" && git init -q && echo x > f.txt && git add -A && git commit -qm s
  cd "$1"
  echo v1 > lzy.project.json
  printf 'task: gate-repro\nendpoint: A\nscope: .\nrecipe: %s\n\n- [A1] alpha works\n- [A2] beta works\n' "$HASHV1" > contract.md
  git add -A; git commit -qm init
  printf -- '- [N1] work\n- [F1] alpha only\naccepts: A1\n' > plan_gap.md
  printf -- '- [N1] work\n- [F1] alpha\naccepts: A1\n- [F2] beta\naccepts: A2\n' > plan_ok.md
  printf -- '- [N1] work\n- [F1] alpha ok\naccepts: A1\n- [F2] beta ok\naccepts: A2\n' > plan_ok2.md
  printf -- 'subjects: ../sibling\n\n- [N1] work\n- [F1] alpha\naccepts: A1\n- [F2] beta\naccepts: A2\n' > plan_scope.md
  printf -- '- [N1] work\n- [F1] alpha x\naccepts: A1\n- [F2] beta x\naccepts: A2\n' > plan_r.md
}

GD=$(mktemp -d)/g; RD=$(mktemp -d)/r
mk "$GD"; mk "$RD"

echo "########## 反例1 越界"
echo "--- R 红半（基线无契约概念，HUMAN_GATE 消融：覆盖缺口计划静默采纳）"
cd "$RD"
LZY_ABLATE_HUMAN_GATE=1 $R loop register repro --title repro >/dev/null 2>&1
LZY_ABLATE_HUMAN_GATE=1 $R loop plan plan_gap.md 2>&1 | head -1
echo "R-exit=${PIPESTATUS[0]}"
echo "--- G 绿半 a（覆盖缺口拒绝）"
cd "$GD"
$G loop register repro --title repro --contract contract.md >/dev/null 2>&1
$G loop plan plan_ok.md >/dev/null 2>&1   # 第一次=被拒，落 contractPending
SHORT=$(node -e "console.log(JSON.parse(require('fs').readFileSync('.lazyzcode/loop/goal.json','utf8')).contractPending.contractHash.slice(0,8))")
printf '{"prompt":"批准 %s","cwd":"%s","sessionId":"s"}' "$SHORT" "$PWD" | $GH >/dev/null
$G loop plan plan_ok.md >/dev/null 2>&1 && $G loop start >/dev/null 2>&1
$G loop supersede plan_gap.md 2>&1 | head -1 | cut -c1-120; echo "G-exit=${PIPESTATUS[0]}"
echo "--- G 绿半 b（subject 出 scope 拒绝）"
$G loop supersede plan_scope.md 2>&1 | head -1 | cut -c1-120; echo "G-exit=${PIPESTATUS[0]}"

echo "########## 反例2 撤回"
echo "--- R 红半（基线撤回短语无效果：静默空 JSON）"
cd "$RD"
printf '{"prompt":"撤回 abcdef01","cwd":"%s","sessionId":"s"}' "$PWD" | $RH; echo " R-exit=$?"
echo "--- G 绿半（撤回→supersede 拒→再批准→过）"
cd "$GD"
CSHORT=$(node -e "console.log(JSON.parse(require('fs').readFileSync('.lazyzcode/loop/goal.json','utf8')).contract.contractHash.slice(0,8))")
printf '{"prompt":"撤回 %s","cwd":"%s","sessionId":"s"}' "$CSHORT" "$PWD" | $GH >/dev/null
$G loop supersede plan_ok2.md 2>&1 | head -1 | cut -c1-90; echo "G-exit=${PIPESTATUS[0]}"
printf '{"prompt":"批准 %s","cwd":"%s","sessionId":"s"}' "$CSHORT" "$PWD" | $GH >/dev/null
$G loop supersede plan_ok2.md >/dev/null 2>&1; echo "re-approve supersede exit=$?"
echo "ledger: $(ls .lazyzcode/authorizations | sed 's/-[0-9]*\.json$/.json/' | tr '\n' ' ')"

echo "########## 反例3 配方漂移"
echo "--- R 红半（基线：配方变更后重采纳无任何门感知）"
cd "$RD"; echo v2 > lzy.project.json; git add -A; git commit -qm rc
LZY_ABLATE_HUMAN_GATE=1 $R loop plan plan_ok.md >/dev/null 2>&1; echo "R-exit=$?"
echo "--- G 绿半（本树：配方漂移拒绝）"
cd "$GD"; echo v2 > lzy.project.json; git add -A; git commit -qm rc
$G loop supersede plan_r.md 2>&1 | head -1 | cut -c1-120; echo "G-exit=${PIPESTATUS[0]}"
