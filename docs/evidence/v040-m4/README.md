# M4 终验证据集（goal `v040-m4-scope-qualification` · 收口相位 N11）

冻结计划：`.lazyzcode/plans/v040-m4-scope-qualification.md`（sha256 `de1d0a1f2be8bb28eda123ad0f995c7bb11e0f091524e2e312d0cfdfe74c72cf`）。
本目录=F1-F6 终验证据（F7 自审证据在 `.lazyzcode/evidence/` 与运行档）。红半来源逐项见计划「条目细则」R5。

## 复现配方

1. 夹具（F1-F3）：`node scripts/v040/qa.mjs --case scope-qualification --fixture <FX> --out <QAOUT>`
   （15 断言全绿；夹具留存于 `<FX>/scope-qualification/{scope-main,scope-reject,scope-stale}`）
2. F1/F2 原始取证：`bash m4-capture-driver-f1f2.sh <FX> <EVID>`（本目录同名 .sh 即驱动器原文）
3. F3 原始取证：`bash m4-capture-driver-f3.sh <FX> <EVID>`
   — F3 用自建清单夹具 `scope-gate`（`lzy.project.json` 的 `capabilities.check` 派生
   `review.verification-deps` 专项义务）走全序；**首版驱动器误用 scope-main（无清单）致专项义务
   不存在、复用链面失效，该版转录已弃用**（弃用版留档于 N11 提交的 artifacts 之外，判因见下）。
4. F4 三仓：`node scripts/v040/m4-three-repo.mjs …`（N10 驱动；工件 `artifacts/v040/M4/`）→
   本目录 `m4-f4-three-repo-summary.json` + `m4-f4-three-repo-readouts.txt`（十五条 stdout/leg-log 汇编）。
5. F5 双半：`node scripts/v040/m4-scope-harness.mjs --root . --out m4-f5-harness-green.json` 与
   `git archive 245a7ec | tar -x -C /tmp/m4-red` 后
   `node scripts/v040/m4-scope-harness.mjs --root /tmp/m4-red --source 245a7ec… --out m4-f5-harness-red.json`。
6. F6 绿：`node scripts/v040/qa.mjs --case review-runtime --fixture <FX6> --out <OUT6>`（真会话 2）与
   `--case finding-lifecycle …`（真会话 2）+ `npm test`；红：`git archive b36e453 | tar -x -C /tmp/m4-f6red`
   后以 `LZY_ZCODE_ENGINE=/nonexistent-lzy-suppressed` 跑改前树 `--case review-runtime`
   （桩矩阵；真腿按缺能力如实 blocked——红半只锚桩体面，零真会话）。

## 逐项读数与如实申报

- **F1**（`m4-f1-qualify-live.txt` + q1-q6 档）：10/10 轴 GRANTED；过宽声明（`shared/**` 划 unrelated）
  ⇒ `✖ C3 → keep @shared/dep-config.json` 拒；过窄声明（无 unrelated 规则）⇒
  `✖ C2 → no-unrelated-file（canary 无处安放——过窄声明）` 拒。
  **申报**：计划 F1 行括注的「canary 判 invalidate」型取法（同路径重复 pattern 制造首匹配歧义）
  不可构造——声明验形**前置拒**`scope.rules pattern 重复（首匹配语义下歧义）：docs/**`（exit 1 不落档）。
  过窄拒面的现行实读=上示 `no-unrelated-file` 判因（契约测试同名用例亦此语义）。
- **F2**（`m4-f2-reuse-live.txt` + applicable/四拒档）：无关变化 applicable（diff 1 项、绑 q3）；
  四拒逐因 fallback：env（`资格身份漂移：env`）/锁文件（`声明内/共享输入变化：package-lock.json`）/
  check 脚本（`…scripts/check.sh`）/未知新文件（`未知路径：stranger.txt`），四腿各 diff 恰 1 条路径；
  base 运行档与资格档 sha256 复用前后不变（`f0c3cb7e…`/`2abb22a7…` 两次对表一致）。
- **F3**（`m4-f3-gate-live.txt`）：拒资复用（最新资格档为拒绝态 → exit 3 前置拒）；清单夹具
  `scope-gate` 上：直跑满足 → 候选漂移且无档（`复用腿不可用：无在案适用档`）→ 无资格前置拒
  （`base 运行无在案资格档`）→ 资格+applicable ⇒ **gate 复用链满足**（`评审运行 m4gate.a1.r1 候选
  漂移由复用腿满足：适用档 m4gate.a1.p1（applicable · diff 1 项全分类）＋资格 m4gate.a1.q1 granted
  且身份现行`）+ `policy show` 三义务对账 → 适用档目标非现行 → `资格身份漂移 engine` → 最新适用档
  判 fallback（`声明内/共享输入变化：src/util.js`）；`scope-stale`：`closure-basis-stale` 拦 →
  `finding reopen` → 替身 recheck（r5）→ `close` → gate PASS（「曾关闭」保留）。
- **F4**（`m4-f4-three-repo-summary.json` + readouts）：三腿（lazyzcode/openchamber/zpigeon-ios）
  按 R1/R3「正反例齐备 ∨ 如实阻塞行」——**三腿均齐备**（base 真会话 valid/metered/points 非零、
  无关变化 applicable、声明内变化 fallback+真实重评、未知回退、越界声明拒、base/资格档字节不变）。
  红半=修复前真会话 metering-absent 档（`m4-f4-blocked-leg-prefix.json`：validity invalid
  `metering-absent`）+ WAL 契约测试红读（`m4-f4-wal-red-pre-fix.txt`）。
- **F5**（`m4-f5-harness-green.json` / `m4-f5-harness-red.json`）：同脚本两树八读数。红半（245a7ec：
  qualify/reuse 未知命令、家族零写入、gate 无复用腿且无该专项义务）；绿半（工作树：granted 10/10、
  applicable、gate 复用链被引、未知路径 fallback 并实拦点名 `stranger.txt`）。红半与 N10 期
  `artifacts/v040/M4/n10-meterseam/harness-red-245a7ec.json` 逐条一致（确定性复采）。
- **F6**（`m4-f6-*.txt` + 两份 result JSON）：绿=review-runtime 活体 exit 0（22 断言全绿，r1
  candidate-moved / r8 归一化判因复达；真会话 2，预注册 ≤12）+ finding-lifecycle 活体 exit 0
  （20 断言全绿；真会话 2：注缺陷评审 1+真 recheck 1）+ `npm test` **715/715**（≥697）；红=改前树
  （`b36e453`，N6 之前一代）桩矩阵读数：断言表仅 `r5a/r5b/r6/r6b` 四条，**r1..r4/r7/r8 的判据静默缺席**
  （bodies 只 run 不 expect 的哑弹面；`m4-f6-review-runtime-red-result.json` 的 `assertions` 与
  `bodies` 对照即证）。
  **申报**：两代替身引擎的绿腿围栏值实测**逐字一致**（`\`\`\`json…\`\`\`` 新转义链差异非可观测行为差）
  ——N6 提交自述同判：真根因=bodies expect 静默，「fromCharCode(96) 家法」属同类面加固。

## 附注

- 机械腿（qualify/reuse/gate/policy/finding 读面）零积分零会话（拍板 10）；F6 两案例的真会话为
  案例自带预注册预算内（review-runtime LIGHT/HEAVY 各 1、finding-lifecycle 2）。
- 夹具档含 `/private/tmp/…` 绝对路径（快照物化面），系追溯信息，不作机器判据。
