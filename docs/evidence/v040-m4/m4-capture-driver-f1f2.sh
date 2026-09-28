#!/usr/bin/env bash
# M4 F1–F3 原始取证驱动器（goal v040-m4-scope-qualification · N11 收口相位）
#
# 复现两步：
#   1) cd <repo> && node scripts/v040/qa.mjs --case scope-qualification --fixture <FX> --out <QAOUT>
#   2) bash m4-f1f3-capture-driver.sh <FX> <EVID>
#
# 约定：机械腿（qualify/reuse/gate/policy/finding）一律 LZY_ZCODE_ENGINE=/nonexistent-lzy-suppressed，
# 与 qa 案例 baseEnv 同值（资格身份 engine 轴一致，避免非预期漂移）；替身腿用 qa 写出的
# stub-engine.cjs + LZY_STUB_* 旋钮。所有输出=逐命令原文+退出码转录（只追加，不改夹具既有档）。
set -u
REPO=${REPO:-/Users/acfufu/Codehub/lazyzcode}
FX=${1:?usage: m4-f1f3-capture-driver.sh <fixtureRoot> <evidenceDir>}
EVID=${2:?usage: m4-f1f3-capture-driver.sh <fixtureRoot> <evidenceDir>}
CASE="$FX/scope-qualification"
STUB="$CASE/stub-engine.cjs"
MAIN="$CASE/scope-main"
REJ="$CASE/scope-reject"
STALE="$CASE/scope-stale"
NOF="$FX/scope-noqual"
SCRATCH=$(mktemp -d /tmp/m4-cap-home-XXXXXX)
mkdir -p "$EVID"
MECH=/nonexistent-lzy-suppressed

# cap <out> <dir> <env 串> -- <lzy args...>：转录命令 + 原文 + 退出码
cap() {
  local out="$1" dir="$2" envs="$3"; shift 3
  [ "${1:-}" = "--" ] && shift
  {
    printf '\n===== [%s]\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    printf '===== CMD: (cd %s) env %s node cli/lzy.js %s\n' "$dir" "$envs" "$*"
    ( cd "$dir" && env HOME="$SCRATCH" USERPROFILE="$SCRATCH" $envs node "$REPO/cli/lzy.js" "$@" ) 2>&1
    printf '===== EXIT: %s\n' "$?"
  } >>"$out"
}
sha() {
  local out="$1" dir="$2"; shift 2
  {
    printf '\n===== SHA256 (cd %s) %s\n' "$dir" "$*"
    ( cd "$dir" && shasum -a 256 "$@" ) 2>&1
  } >>"$out"
}
# 最新 q/p 档（seq 数值序）
latest_rec() { # latest_rec <review-scope dir> <q|p>
  node -e '
    const fs=require("fs");const d=process.argv[1],k=process.argv[2];
    const re=new RegExp("\\."+k+"(\\d+)\\.json$");
    const xs=fs.readdirSync(d).filter(x=>re.test(x)).map(x=>[Number(re.exec(x)[1]),x]).sort((a,b)=>a[0]-b[0]);
    if(xs.length) process.stdout.write(xs[xs.length-1][1]);
  ' "$1/.lazyzcode/review-scope" "$2"
}

# ── F2：复用通道（适用档 + 四拒逐因 + 字节不变）——须先于 F1 的拒绝态资格追加 ─────────
OUTF2="$EVID/m4-f2-reuse-live.txt"
: >"$OUTF2"
printf '# F2 复用通道原始取证（夹具=qa scope-qualification 的 scope-main / scope-reject）\n# 程序：机械腿（零会话）；base/资格档字节不变=复用判断前后 sha256 对表\n' >>"$OUTF2"
sha "$OUTF2" "$MAIN" .lazyzcode/review/scope-main.a1.r1.json ".lazyzcode/review-scope/$(latest_rec "$MAIN" q)"
cap "$OUTF2" "$MAIN" "LZY_ZCODE_ENGINE=$MECH" -- review reuse scope-main.a1.r1
APP_DOC=$(latest_rec "$MAIN" p)
cp "$MAIN/.lazyzcode/review-scope/$APP_DOC" "$EVID/m4-f2-applicable-doc.json"
sha "$OUTF2" "$MAIN" .lazyzcode/review/scope-main.a1.r1.json ".lazyzcode/review-scope/$(latest_rec "$MAIN" q)"
printf '\n# → 适用档副本：m4-f2-applicable-doc.json（%s）\n' "$APP_DOC" >>"$OUTF2"

# 四拒腿（各自单路径改变 + git reset 归位；env 腿不改文件）
BASE_REJ=$(git -C "$REJ" rev-parse HEAD)
printf '\n# 拒面夹具 scope-reject：base=%s\n' "$BASE_REJ" >>"$OUTF2"
cap "$OUTF2" "$REJ" "LZY_ZCODE_ENGINE=$MECH TZ=Asia/Tokyo" -- review reuse scope-reject.a1.r1
cp "$REJ/.lazyzcode/review-scope/$(latest_rec "$REJ" p)" "$EVID/m4-f2-reject-env-doc.json"
rej_leg() { # rej_leg <label> <relpath> <content>
  local label="$1" rel="$2" content="$3"
  printf '%s' "$content" > "$REJ/$rel"
  git -C "$REJ" add -A >/dev/null
  git -C "$REJ" commit -qm "cap leg $label" >/dev/null
  cap "$OUTF2" "$REJ" "LZY_ZCODE_ENGINE=$MECH" -- review reuse scope-reject.a1.r1
  cp "$REJ/.lazyzcode/review-scope/$(latest_rec "$REJ" p)" "$EVID/m4-f2-reject-$label-doc.json"
  git -C "$REJ" reset --hard "$BASE_REJ" >/dev/null
}
rej_leg lockfile package-lock.json '{}
{}
'
rej_leg checkscript scripts/check.sh 'echo changed
'
rej_leg unknown stranger.txt '??
'
printf '\n# → 四拒档副本：m4-f2-reject-{env,lockfile,checkscript,unknown}-doc.json\n' >>"$OUTF2"

# ── F1：资格通道（五核心轴十轴对表 + 过宽/过窄拒面 + 资格档与 sha256）────────────
OUTF1="$EVID/m4-f1-qualify-live.txt"
: >"$OUTF1"
printf '# F1 资格通道原始取证（夹具=qa scope-qualification/scope-main；机械腿零会话）\n' >>"$OUTF1"
cap "$OUTF1" "$MAIN" "LZY_ZCODE_ENGINE=$MECH" -- review qualify scope-main.a1.r1 --scope "$CASE/good.decl.json"
cap "$OUTF1" "$MAIN" "LZY_ZCODE_ENGINE=$MECH" -- review qualify scope-main.a1.r1 --scope "$CASE/overbroad.decl.json"
printf '%s\n' '{"dutyId":"review.verification-deps","rules":[{"pattern":"src/**","class":"in-scope"},{"pattern":"docs/**","class":"in-scope"},{"pattern":"scripts/**","class":"in-scope"}],"sharedInputs":["package-lock.json"]}' > "$CASE/overnarrow.decl.json"
cap "$OUTF1" "$MAIN" "LZY_ZCODE_ENGINE=$MECH" -- review qualify scope-main.a1.r1 --scope "$CASE/overnarrow.decl.json"
printf '%s\n' '{"dutyId":"review.verification-deps","rules":[{"pattern":"src/**","class":"in-scope"},{"pattern":"docs/**","class":"in-scope"},{"pattern":"scripts/**","class":"in-scope"},{"pattern":"docs/**","class":"unrelated"}],"sharedInputs":["package-lock.json"]}' > "$CASE/narrow2.decl.json"
cap "$OUTF1" "$MAIN" "LZY_ZCODE_ENGINE=$MECH" -- review qualify scope-main.a1.r1 --scope "$CASE/narrow2.decl.json"
for f in $(ls "$MAIN/.lazyzcode/review-scope" | command grep -E '\.q[0-9]+\.json$'); do
  cp "$MAIN/.lazyzcode/review-scope/$f" "$EVID/m4-f1-qualification-$f"
done
sha "$OUTF1" "$EVID" m4-f1-qualification-*.json

# 注：首版 F3 段已弃用并移除（scope-main 无清单 ⇒ 专项义务不存在、复用链面失效）；
#     现行 F3 取证见 m4-capture-driver-f3.sh（自建清单夹具 scope-gate 全序）。
