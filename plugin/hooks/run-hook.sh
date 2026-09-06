#!/bin/sh
# lzy 钩子启动器：引擎以自身 env 直接 spawn 钩子命令，其 PATH 不保证解析得到 node
#（2026-09-07 探针实锤：GUI 直启的引擎 env 无 nvm bin，裸 `node` ENOENT → 四钩子静默全灭，
# 且失败发生在引擎侧，钩子 JS 里的 fail-open 根本没机会执行）。
# 用法（hooks.json）：/bin/sh "${ZCODE_PLUGIN_ROOT}/hooks/run-hook.sh" <script.js> [args…]
# 纪律：node 彻底解析不到时记一行 /tmp/lzy-hook-launcher.log 后 exit 0 放行（fail-open，绝不阻断会话）。
set -u
dir="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"

resolve_node() {
  if command -v node >/dev/null 2>&1; then
    NODE="$(command -v node)"
    return 0
  fi
  NODE=""
  for cand in "${HOME:-}"/.nvm/versions/node/*/bin/node /opt/homebrew/bin/node /usr/local/bin/node; do
    # 不提前 break：候选序列里最后一个可执行项（通常是最新版本）胜出
    [ -x "$cand" ] && NODE="$cand"
  done
  [ -n "$NODE" ]
}

if [ "${1-}" = "--print-node" ]; then
  # 供 lzy doctor 的 hook-node 检查探测启动器解析结果
  if resolve_node; then printf '%s\n' "$NODE"; exit 0; else exit 1; fi
fi

script="${1-}"
shift 2>/dev/null || true
if [ -z "$script" ]; then exit 0; fi
if ! resolve_node; then
  printf '%s lzy hook: node unresolvable (PATH=%s); %s skipped (fail-open)\n' \
    "$(date -u +%FT%TZ)" "${PATH-}" "$script" >> /tmp/lzy-hook-launcher.log 2>/dev/null || true
  exit 0
fi
exec "$NODE" "$dir/$script" "$@"
