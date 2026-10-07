#!/bin/sh
# F2 红绿探针（0.5.0 M2 / goal v050-m2-freeze）：run-hook 日志写点＋cpSync verbatimSymlinks。
# 用法：sh scripts/v050/probes/f2-reroute-probe.sh <树根>
#   <树根> 须含 plugin/hooks/run-hook{,.cmd} 与 scripts/ablation/run-trial.mjs 等——
#   红半传 0.4.1 发布包展开目录（artifacts/v050/m2-baseline-pkg/baseline-src），
#   绿半传本仓工作树根；同探针两态，仅被测代码不同。
# 断言：
#   A1 共享固定名 /tmp/lzy-hook-launcher.log 不再是写点（源面无该字面量＋行为不落该名）；
#   A2 launcher_log 追加不跟随预置符号链接（受害者文件零增长）；
#   A3 写点落 $HOME/.cache/lzy-hook/launcher.log（HOME=夹具）；
#   A4 .cmd 孪生不再写 %TEMP% 固定名（源面 grep，活体属 win32 VM 复测域）；
#   B1 recursive 树拷贝 verbatimSymlinks:true 覆盖计数恰 7（run-trial 2＋build 2＋h3r-trial 2＋run-fast-pair 1）；
#   B2 行为锚：cpSync(recursive, verbatimSymlinks:true) 下相对符号链接拷贝后仍相对（两态同判，
#      钉的是 API 语义即本棒加旗标的理由）。
# exit 1=红（存在失败断言），0=绿。
set -u
ROOT="${1:?用法: f2-reroute-probe.sh <树根>}"
fail=0
say() { printf '%s\n' "$*"; }
ck() {
  if [ "$1" = "0" ]; then say "ok - $2"; else fail=$((fail + 1)); say "FAIL - $2"; fi
}

# ── A. run-hook 写点 ──────────────────────────────────────────────────
HOOK="$ROOT/plugin/hooks/run-hook"
TMPD=$(mktemp -d)
VICTIM="$TMPD/victim.txt"
: > "$VICTIM"
FAKEHOME="$TMPD/home"
mkdir -p "$FAKEHOME"
STALE=/tmp/lzy-hook-launcher.log
HAD_STALE=0
if [ -e "$STALE" ] || [ -L "$STALE" ]; then HAD_STALE=1; mv "$STALE" "$STALE.f2-probe-bak"; fi
ln -s "$VICTIM" "$STALE"

# 从被测树的真实脚本抽取 launcher_log 函数体（写点语义的被测面），在夹具 HOME 下调用。
sed -n '/^launcher_log()/,/^}/p' "$HOOK" > "$TMPD/launcher_log.sh"
HOME="$FAKEHOME" sh -c ". '$TMPD/launcher_log.sh' && launcher_log 'probe line'"

if grep -q "/tmp/lzy-hook-launcher.log" "$HOOK"; then
  ck 1 "A1a 源面无共享固定名写点字面量"
else
  ck 0 "A1a 源面无共享固定名写点字面量"
fi
[ -s "$VICTIM" ]; ck "$([ -s "$VICTIM" ] && echo 1 || echo 0)" "A2 受害者文件未被经预置符号链接改道写入"
[ -f "$FAKEHOME/.cache/lzy-hook/launcher.log" ]; ck "$?" "A3 写点落 HOME/.cache/lzy-hook/launcher.log"
[ -s "$STALE" ]; ck "$([ -s "$STALE" ] && echo 1 || echo 0)" "A1b 预置链接本体保持零字节（写点不落共享名）"

grep -q "lzy-hook-launcher.log" "$ROOT/plugin/hooks/run-hook.cmd"
ck "$([ $? = 0 ] && echo 1 || echo 0)" "A4 .cmd 孪生弃 %TEMP% 固定名（源面）"

rm -f "$STALE"
if [ "$HAD_STALE" = "1" ]; then mv "$STALE.f2-probe-bak" "$STALE"; fi
F2TMP="$TMPD" node -e '
const { cpSync, mkdirSync, symlinkSync, writeFileSync, readlinkSync } = require("node:fs");
const { join, isAbsolute } = require("node:path");
const base = process.env.F2TMP;
const src = join(base, "b-src");
mkdirSync(join(src, "sub"), { recursive: true });
writeFileSync(join(src, "sub", "real.txt"), "x\n");
symlinkSync(join("sub", "real.txt"), join(src, "link-rel"));
const dstWith = join(base, "b-with");
cpSync(src, dstWith, { recursive: true, verbatimSymlinks: true });
const withRel = readlinkSync(join(dstWith, "link-rel"));
if (isAbsolute(withRel) || withRel !== join("sub", "real.txt")) {
  console.error(`FAIL B2: with-flag readlink=${withRel}`);
  process.exit(1);
}
console.log("B2 with-flag 相对链接保持相对 ✓");
'
ck "$?" "B2 行为锚：verbatimSymlinks:true 下相对符号链接拷贝后仍相对"
rm -rf "$TMPD"

# ── B. cpSync verbatimSymlinks 源面覆盖 ───────────────────────────────
COUNT=0
for spec in "scripts/ablation/run-trial.mjs:2" "scripts/docs-preview/build.mjs:2" "scripts/ablation/h3r-trial.mjs:2" "scripts/ablation/run-fast-pair.mjs:1"; do
  f="$ROOT/${spec%%:*}"
  want="${spec##*:}"
  got=$(grep -c "verbatimSymlinks: true" "$f" 2>/dev/null || echo 0)
  [ "$got" = "$want" ]; ck "$?" "B1 $spec 含 verbatimSymlinks:true ×${want}（实得 ${got}）"
  COUNT=$((COUNT + got))
done
ck "$([ "$COUNT" = "7" ] && echo 0 || echo 1)" "B1 合计 recursive 树拷贝覆盖=7（实得 ${COUNT}）"

if [ "$fail" = "0" ]; then say "F2 probe: ALL GREEN"; exit 0; fi
say "F2 probe: $fail assertion(s) failed"
exit 1
