#!/usr/bin/env bash
# 0.3.1 棒1 统一取证入口（INV-08：红绿同源——同一脚本 + 被测 CLI 经 LZY_PROBE_CLI 注入）
# 用法：bash scripts/v031/evidence-probe.sh <F1|F2|F3|F4|F5>
#   红半：LZY_PROBE_CLI=<改前 CLI 绝对路径> LZY_PROBE_TRIGGER=<改前 trigger 路径>
#   绿半：默认（仓内 CLI / 现版 trigger）
# 脚本只执行流程并原样打印，不做红绿期望判定——差异全部来自被测面本身。
set -u
export PATH="$HOME/.nvm/versions/node/v24.19.0/bin:$PATH"
FID="${1:?用法：evidence-probe.sh <F1|F2|F3|F4|F5>}"
REPO=/Users/acfufu/Codehub/lazyzcode
CLI="${LZY_PROBE_CLI:-$REPO/cli/lzy.js}"
TRIGGER="${LZY_PROBE_TRIGGER:-$REPO/plugin/hooks/trigger.js}"
HOME_ISO=$(mktemp -d /tmp/v031b1-ev.XXXXXX); export HOME="$HOME_ISO" USERPROFILE="$HOME_ISO" LZY_ZCODE_ENGINE=/nonexistent-lzy-probe
D=$(mktemp -d "/tmp/v031b1-ev-$FID.XXXXXX")
echo "=== EVIDENCE PROBE $FID  $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="
echo "CLI=$CLI"; echo "TRIGGER=$TRIGGER"; echo "fixture=$D"
cd "$D" || exit 1
mkfloor() {
  git init -q . && git config user.email p@l && git config user.name p && git config commit.gpgsign false
  printf '{"schemaVersion":1,"capabilities":{"check":[{"id":"smoke","argv":["node","-e","process.exit(0)"],"timeoutMs":30000}]}}\n' > lzy.project.json
  printf -- 'task: main A\nendpoint: A\nscope: .\nrecipe: none\n\n- [A1] x\n' > c-main-a.md
  printf -- 'task: main B\nendpoint: B\nscope: .\nrecipe: none\n\n- [A1] x\n' > c-main-b.md
  printf -- 'task: main C\nendpoint: C\nscope: .\nrecipe: none\n\n- [A1] x\n' > c-main-c.md
  printf -- 'task: B\nendpoint: B\nscope: .\nrepo: Acfufu/lazyzcode\nbase: main\nbranch: v031\npr-title: t\n\n- [A1] x\n' > cb.md
  printf -- 'task: C\nendpoint: C\nscope: .\nrepo: Acfufu/lazyzcode\nexpect-marker: v0.3.1\npage: /guide/\n\n- [A1] x\n' > cc.md
  printf -- '- [N1] x\n- [F1] y\naccepts: A1\n' > p.md
  git add -A && git commit -qm fix
  BARE="$HOME_ISO/origin-$(basename "$D").git"; git init -q --bare "$BARE"; git remote add origin "$BARE"; git branch v031 >/dev/null 2>&1
}
run() { echo; echo "\$ lzy $*"; node "$CLI" "$@" 2>&1; echo "EXIT=$?"; }
hook() { echo; echo "\$ trigger <$1>"; printf '{"prompt":"%s","cwd":"%s","session_id":"ev"}' "$1" "$PWD" | node "$TRIGGER"; echo; }
shortof() { node -e 'const fs=require("fs");const q=JSON.parse(fs.readFileSync(".lazyzcode/queue/queue.json","utf8"));const [a,b]=process.argv[1].split(".");const v=a==="main"?q.items[0].contractHash:q.items[0].delivery[a].hash;process.stdout.write(v.slice(0,8))' "$1"; }
approveall() {
  hook "批准 $(shortof B.b)"
  hook "批准 $(shortof C.c)"
  node "$CLI" loop register qev --title t --contract c-main-c.md >/dev/null 2>&1
  node "$CLI" loop plan p.md >/dev/null 2>&1
  hook "批准 $(shortof main.b)"
  node "$CLI" loop reset >/dev/null 2>&1
}

case "$FID" in
F1|F3|F5)
  mkfloor
  echo; echo "--- add（endpoint C + 双交付契约；F3/F5 变体在契约/C 面）---"
  run queue add t --contract c-main-c.md --plan p.md --endpoint C --delivery-b cb.md --delivery-c cc.md --goal-slug qev
  approveall
  echo; echo "--- 就绪面 ---"; run queue list
  MODE=""
  [ "$FID" = "F3" ] && MODE="--page-404"
  [ "$FID" = "F5" ] && MODE="--merge-fails"
  echo; echo "--- dispatch（harness 夹具驱动 + 假外部注入）$MODE ---"
  node "$REPO/scripts/v031/queue-bridge-e2e.mjs" "$D" $MODE 2>&1 | tail -40
  echo; echo "--- 文件面 ---"
  node -e '
const fs=require("fs");
const q=JSON.parse(fs.readFileSync(".lazyzcode/queue/queue.json","utf8"));
console.log("queue.json item:",JSON.stringify({state:q.items[0].state,endpoint:q.items[0].endpoint,completedEndpoint:q.items[0].completedEndpoint,blockedReason:String(q.items[0].blockedReason).slice(0,140)}));
try{const it=JSON.parse(fs.readFileSync(".lazyzcode/delivery/intents.json","utf8"));
console.log("intents:",JSON.stringify(it.intents.map(x=>({ep:x.endpoint,status:x.status,origin:x.origin,mergeSha:!!x.observed?.mergeSha,pages:(x.observed?.pages??[]).map(p=>p.path)}))));}catch(e){console.log("intents 缺席");}
try{const dj=JSON.parse(fs.readFileSync(".lazyzcode/queue/dispatch.json","utf8"));
console.log("txs:",JSON.stringify(dj.txs.map(t=>({phase:t.phase,note:String(t.note).slice(0,90)}))));}catch(e){console.log("dispatch 缺席");}
'
  if [ "$FID" = "F5" ]; then
    echo; echo "--- 人工修复（真 CLI：delivery act B；假 gh 注入）---"
    FD="$HOME_ISO/evfakes"; mkdir -p "$FD"
    cat >| "$FD/fake-gh.mjs" <<'GH'
#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
const sf=process.env.GH_STATE_FILE; const a=process.argv.slice(2).join(" ");
const st=(()=>{try{return JSON.parse(readFileSync(sf,"utf8"))}catch{return{merged:false}}})();
const out=(o)=>{process.stdout.write(JSON.stringify(o));process.exit(0)};
if(a.startsWith("pr list"))out([]);
if(a.startsWith("pr view"))out({state:st.merged?"MERGED":"OPEN",headRefOid:process.env.FIX_HEAD,baseRefName:"main",number:7,url:"u",mergeCommit:st.merged?{oid:"b".repeat(40)}:null});
if(a.startsWith("pr create"))out({number:7});
if(a.startsWith("pr merge")){st.merged=true;writeFileSync(sf,JSON.stringify(st));out({})}
if(a.includes("check-runs"))out([{name:"ci",status:"COMPLETED",conclusion:"SUCCESS"}]);
if(a.includes("pages/builds/latest"))out({status:"built",commit:"b".repeat(40)});
process.stderr.write("x");process.exit(1);
GH
    chmod +x "$FD/fake-gh.mjs"
    printf '#!/usr/bin/env node\nprocess.stdout.write("<html>v0.3.1</html>HTTPSTATUS:200");\n' >| "$FD/fake-curl.mjs"
    chmod +x "$FD/fake-curl.mjs"
    export GH_STATE_FILE="$FD/gh-state.json" FIX_HEAD="$(git rev-parse HEAD)" LZY_GH_BIN="$FD/fake-gh.mjs" LZY_CURL_BIN="$FD/fake-curl.mjs"
    run delivery act B --origin-item q1 --repo Acfufu/lazyzcode --branch v031 --base main --head "$(git rev-parse HEAD)" --pr-title t --pr-body-file p.md
    run delivery act C --origin-item q1 --repo Acfufu/lazyzcode --expect-marker v0.3.1
    echo; echo "--- 追认（真 CLI：queue reconcile）---"
    run queue reconcile
    node -e '
const fs=require("fs");
const q=JSON.parse(fs.readFileSync(".lazyzcode/queue/queue.json","utf8"));
console.log("追认后 item:",JSON.stringify({state:q.items[0].state,completedEndpoint:q.items[0].completedEndpoint}));
'
  fi
  ;;
F4)
  mkfloor
  echo "--- endpoint 矩阵与门（逐态原样打印）---"
  run queue add a1 --contract c-main-a.md --plan p.md --delivery-b cb.md
  run queue add b0 --contract c-main-b.md --plan p.md
  run queue add b1 --contract c-main-b.md --plan p.md --endpoint B --delivery-b cb.md
  run queue add c0 --contract c-main-c.md --plan p.md --endpoint C --delivery-c cc.md
  run queue add c1 --contract c-main-c.md --plan p.md --endpoint C --delivery-b cb.md --delivery-c cc.md --goal-slug c1ok
  run queue add x1 --contract c-main-a.md --plan p.md --endpoint B --delivery-b cb.md --delivery-c cc.md
  run queue add h1 --contract c-main-b.md --plan p.md --endpoint B --delivery-b cb.md --delivery-c cc.md --tier heavy
  run queue add r1 --contract c-main-b.md --plan p.md --endpoint B --delivery-b cb.md --delivery-c cc.md --risk high
  node -e 'const fs=require("fs");try{const q=JSON.parse(fs.readFileSync(".lazyzcode/queue/queue.json","utf8"));console.log("登记项:",JSON.stringify(q.items.map(i=>({id:i.id,endpoint:i.endpoint,tier:i.tier??null,risk:i.risk??null,delivery:i.delivery?Object.keys(i.delivery):null}))));}catch(e){console.log("queue.json 无（全拒）");}'
  ;;
F2)
  mkfloor
  run queue add t --contract c-main-b.md --plan p.md --endpoint B --delivery-b cb.md --delivery-c cc.md --goal-slug qev
  SHORT=$(shortof B.b)
  hook "批准 $SHORT"
  hook "批准 deadbeef"
  echo; echo "--- authorizations 记录数 ---"; ls .lazyzcode/authorizations 2>/dev/null | wc -l | tr -d ' '
  node -e 'const fs=require("fs");try{const q=JSON.parse(fs.readFileSync(".lazyzcode/queue/queue.json","utf8"));console.log("条目态:",q.items[0].state);}catch(e){console.log("queue.json 缺");}'
  ;;
*)
  echo "未知 FID：$FID"; exit 2;;
esac
echo; echo "=== EVIDENCE PROBE $FID END $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="
