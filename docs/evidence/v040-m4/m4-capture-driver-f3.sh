#!/usr/bin/env bash
# M4 F3 原始取证驱动器（修订版：清单夹具派生专项义务；goal v040-m4-scope-qualification · N11）
# 复现：先跑 qa scope-qualification（提供 scope-stale 与 scope-main 夹具），再执行本脚本。
#   bash m4-f3-capture2.sh <FX> <EVID>
# 机械腿一律 LZY_ZCODE_ENGINE=/nonexistent-lzy-suppressed（与 qa baseEnv 同值）；替身腿用
# qa 写出的 stub-engine.cjs + LZY_STUB_* 旋钮。
set -u
REPO=${REPO:-/Users/acfufu/Codehub/lazyzcode}
FX=${1:?usage: m4-f3-capture2.sh <fixtureRoot> <evidenceDir>}
EVID=${2:?usage: m4-f3-capture2.sh <fixtureRoot> <evidenceDir>}
CASE="$FX/scope-qualification"
STUB="$CASE/stub-engine.cjs"
MAIN="$CASE/scope-main"
STALE="$CASE/scope-stale"
GATE="$FX/scope-gate"
SCRATCH=$(mktemp -d /tmp/m4-cap2-home-XXXXXX)
mkdir -p "$EVID"
MECH=/nonexistent-lzy-suppressed

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

OUTF3="$EVID/m4-f3-gate-live.txt"
: >"$OUTF3"
printf '# F3 gate 复用合取与关闭依据原始取证（夹具：scope-gate=自建清单夹具；scope-stale=qa 夹具；scope-main=qa 夹具拒资面）\n' >>"$OUTF3"

# ── (a) 拒资复用面（scope-main：最新资格档为拒绝态）──────────────────────────
printf '\n# (a) scope-main 拒资面：最新资格档为拒绝态 ⇒ 复用不可用\n' >>"$OUTF3"
cap "$OUTF3" "$MAIN" "LZY_ZCODE_ENGINE=$MECH" -- review reuse scope-main.a1.r1

# ── (b) 关闭依据全链（scope-stale）：stale 拦 → reopen → 替身 recheck → close → 翻过 ──
printf '\n# (b) scope-stale 关闭依据全链\n' >>"$OUTF3"
printf 'capt-drift\n' >> "$STALE/marker.txt"
git -C "$STALE" add -A >/dev/null
git -C "$STALE" commit -qm "cap fix-area drift" >/dev/null
cap "$OUTF3" "$STALE" "LZY_ZCODE_ENGINE=$MECH" -- step done F1 --evidence "green rebind: marker.txt present in HEAD tree（capt drift 后未变面重录）"
cap "$OUTF3" "$STALE" "LZY_ZCODE_ENGINE=$MECH" -- gate explain
cap "$OUTF3" "$STALE" "LZY_ZCODE_ENGINE=$MECH" -- finding list
FP8=$( cd "$STALE" && env HOME="$SCRATCH" USERPROFILE="$SCRATCH" LZY_ZCODE_ENGINE="$MECH" node "$REPO/cli/lzy.js" finding list 2>&1 | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const m=/\n\s+([0-9a-f]{8}) \[/.exec("\n"+s);process.stdout.write(m?m[1]:"")})' )
printf '\n# finding 指纹前 8 位：%s\n' "${FP8:-<未取到>}" >>"$OUTF3"
cap "$OUTF3" "$STALE" "LZY_ZCODE_ENGINE=$MECH" -- finding reopen "$FP8" --note closure-basis-stale
cap "$OUTF3" "$STALE" "LZY_ZCODE_ENGINE=$STUB LZY_STUB_LEG=green LZY_STUB_DUTY=review.general-correctness LZY_STUB_LEDGER=1" -- review recheck --timeout-ms 30000
RCSTEM=$(node -e '
  const fs=require("fs");
  const d=process.argv[1]+"/.lazyzcode/review";
  const xs=fs.readdirSync(d).filter(x=>x.endsWith(".json")).map(x=>x.replace(/\.json$/,""));
  const num=(s)=>{const m=/\.r(\d+)$/.exec(s);return m?Number(m[1]):-1;};
  xs.sort((a,b)=>num(a)-num(b));
  process.stdout.write(xs[xs.length-1]??"");
' "$STALE")
printf '\n# recheck 运行：%s\n' "$RCSTEM" >>"$OUTF3"
cap "$OUTF3" "$STALE" "LZY_ZCODE_ENGINE=$MECH" -- finding close "$FP8" --outcome fixed --basis "重开复核不再报" --recheck "$RCSTEM"
cap "$OUTF3" "$STALE" "LZY_ZCODE_ENGINE=$MECH" -- gate explain

# ── (c) 清单夹具全序（scope-gate 自建：直跑满足 → 无档 → 无资格 → 复用链满足 → 候选漂移 → 身份过期 → fallback）──
printf '\n# (c) scope-gate 清单夹具（capabilities.check 派生 review.verification-deps 专项义务）\n' >>"$OUTF3"
rm -rf "$GATE"; mkdir -p "$GATE"
( cd "$GATE" && git init -q && git config user.email t@l && git config user.name t \
  && mkdir -p docs src scripts \
  && printf '.lazyzcode/\nnode_modules/\n' > .gitignore \
  && printf '# doc\n' > docs/readme.md \
  && printf 'export const a=1;\n' > src/util.js \
  && printf 'echo ok\n' > scripts/check.sh \
  && printf '{}\n' > package-lock.json \
  && printf '{\n  "schemaVersion": 1,\n  "capabilities": { "check": [{ "id": "build", "argv": ["%s", "--version"] }] }\n}\n' "$(command -v node)" > lzy.project.json \
  && printf 'task: gate capture fixture\nendpoint: A\nscope: .\nrecipe: none\nbudget-ref: none\n\n- [A1] marker file works\n' > contract.md \
  && printf -- '- [N1] add marker file\n- [F1] marker exists\naccepts: A1\n' > plan.md \
  && git add -A && git commit -qm fixture )
cap "$OUTF3" "$GATE" "LZY_ZCODE_ENGINE=$MECH" -- loop register m4gate --title t --contract contract.md
cap "$OUTF3" "$GATE" "LZY_ZCODE_ENGINE=$MECH" -- loop plan plan.md
SHORT=$(node -e 'const g=require(process.argv[1]+"/.lazyzcode/loop/goal.json");process.stdout.write(String(g.contractPending?.contractHash??"").slice(0,8))' "$GATE")
printf '\n# contractPending 短码：%s\n' "${SHORT:-<无>}" >>"$OUTF3"
{
  printf '\n===== approve via trigger hook（批准 %s）\n' "$SHORT"
  printf '{"prompt":"批准 %s","cwd":"%s","sessionId":"sess_cap"}' "$SHORT" "$GATE" | ( cd "$GATE" && env HOME="$SCRATCH" USERPROFILE="$SCRATCH" LZY_ZCODE_ENGINE="$MECH" node "$REPO/plugin/hooks/trigger.js" ) 2>&1
  printf '===== EXIT: %s\n' "$?"
} >>"$OUTF3"
cap "$OUTF3" "$GATE" "LZY_ZCODE_ENGINE=$MECH" -- loop plan plan.md
cap "$OUTF3" "$GATE" "LZY_ZCODE_ENGINE=$MECH" -- loop start
cap "$OUTF3" "$GATE" "LZY_ZCODE_ENGINE=$MECH" -- evidence red F1 --evidence "red: marker.txt absent on baseline tree"
printf 'marker\n' > "$GATE/marker.txt"
git -C "$GATE" add -A >/dev/null; git -C "$GATE" commit -qm "marker" >/dev/null
cap "$OUTF3" "$GATE" "LZY_ZCODE_ENGINE=$MECH" -- step done N1 --note "add marker file"
cap "$OUTF3" "$GATE" "LZY_ZCODE_ENGINE=$MECH" -- step done F1 --evidence "green: marker.txt present in HEAD tree"
cap "$OUTF3" "$GATE" "LZY_ZCODE_ENGINE=$MECH" -- verify run build
cap "$OUTF3" "$GATE" "LZY_ZCODE_ENGINE=$STUB LZY_STUB_LEG=green LZY_STUB_DUTY=review.verification-deps LZY_STUB_LEDGER=1" -- review run --duty review.verification-deps --timeout-ms 30000
printf '\n# (c1) 直跑满足（专项运行候选=现行）\n' >>"$OUTF3"
cap "$OUTF3" "$GATE" "LZY_ZCODE_ENGINE=$MECH" -- gate explain
printf '\n# (c2) 候选漂移且从未走资格/复用 ⇒ 无在案适用档\n' >>"$OUTF3"
printf '\n<!-- drift -->\n' >> "$GATE/docs/readme.md"
git -C "$GATE" add -A >/dev/null; git -C "$GATE" commit -qm "docs drift" >/dev/null
cap "$OUTF3" "$GATE" "LZY_ZCODE_ENGINE=$MECH" -- gate explain
printf '\n# (c3) 无在案资格档 ⇒ 复用前置拒（指路先资格挑战）\n' >>"$OUTF3"
cap "$OUTF3" "$GATE" "LZY_ZCODE_ENGINE=$MECH" -- review reuse m4gate.a1.r1
printf '\n# (c4) 资格 granted + 复用 applicable ⇒ gate 复用链满足\n' >>"$OUTF3"
printf '%s\n' '{"dutyId":"review.verification-deps","rules":[{"pattern":"src/**","class":"in-scope"},{"pattern":"docs/**","class":"unrelated"},{"pattern":"scripts/**","class":"in-scope"}],"sharedInputs":["package-lock.json"]}' > "$FX/gate-good.decl.json"
cap "$OUTF3" "$GATE" "LZY_ZCODE_ENGINE=$MECH" -- review qualify m4gate.a1.r1 --scope "$FX/gate-good.decl.json"
cap "$OUTF3" "$GATE" "LZY_ZCODE_ENGINE=$MECH" -- review reuse m4gate.a1.r1
cap "$OUTF3" "$GATE" "LZY_ZCODE_ENGINE=$MECH" -- gate explain
cap "$OUTF3" "$GATE" "LZY_ZCODE_ENGINE=$MECH" -- policy show
printf '\n# (c5) 候选再漂移（未重跑 reuse）⇒ 适用档目标候选非现行\n' >>"$OUTF3"
printf '\n<!-- drift2 -->\n' >> "$GATE/docs/readme.md"
git -C "$GATE" add -A >/dev/null; git -C "$GATE" commit -qm "docs drift2" >/dev/null
cap "$OUTF3" "$GATE" "LZY_ZCODE_ENGINE=$MECH" -- gate explain
printf '\n# (c6) 身份过期：engine 轴漂移（机械腿换 engine 取值=实存 stub 路径）\n' >>"$OUTF3"
cap "$OUTF3" "$GATE" "LZY_ZCODE_ENGINE=$STUB" -- gate explain
printf '\n# (c7) 声明内（in-scope）变化 ⇒ 最新适用档判 fallback（复用不足因）\n' >>"$OUTF3"
cap "$OUTF3" "$GATE" "LZY_ZCODE_ENGINE=$MECH" -- review reuse m4gate.a1.r1
printf '\nexport const a=2;\n' >> "$GATE/src/util.js"
git -C "$GATE" add -A >/dev/null; git -C "$GATE" commit -qm "in-scope change" >/dev/null
cap "$OUTF3" "$GATE" "LZY_ZCODE_ENGINE=$MECH" -- review reuse m4gate.a1.r1
cap "$OUTF3" "$GATE" "LZY_ZCODE_ENGINE=$MECH" -- gate explain

printf '\n== capture2 done ==\n'
wc -l "$OUTF3"
