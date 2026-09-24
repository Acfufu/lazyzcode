# ADR-0018: UPS exact-hash human gate (H1 plan adoption)

Date: 2026-09-19 · Status: accepted · Decides: roadmap §⑬ Q1-Q3 · Related: ADR-0004/0009 (hook-layer siblings), ADR-0013 (fail-closed house rule), ADR-0015 (ablation switches), ADR-0016 (supersede re-adoption shares the gate)

## Context

The zw protocol makes plan adoption a human gate ("人点头 adopt+start"), but the only enforcement was protocol text (L0). A model can adopt unilaterally by running `lzy loop plan` itself — the "fake human gate" confirmed during the GPT V3 triage (2026-09-16). SOTA V3 INV-05 requires approvals to bind an immutable subject hash; the pre-agreed upgrade path (0.1.0 batB Q8: "UPS exact-hash 门守 0.1.1") is the UserPromptSubmit hook: it fires on genuine user prompts injected by the engine, a channel the model cannot fabricate from Bash. CLI-side `lzy approve`-style commands stay fake by construction and are not built.

## Decision

- **H1 only, both tiers.** The machine gate covers plan adoption (planning adopt, supersede re-adoption, ADJ-09 legacy re-adoption — all paths through `doAdoptPlan`). H3R (risk acceptance) stays L0 until risk_class gets a machine surface with 0.2.0 unattended, its first real consumer.
- **Approval = user-typed short code.** After review PASS, adoption prints the pending short code (first 8 hex of the plan content sha256). The human replies 「批准 <短码>」 (or `approve <短码>`) in conversation; the UPS hook verifies the code against the pending record and writes an approval record. Adoption re-run then passes. Exact-hash is human-visible: the hash prefix travels through the human's own keyboard.
- **Records are hook-written, append-only, reset-surviving.** `.lazyzcode/loop/approvals/<hash8>-<sanitizedSid>-<epochMs>.json`, content `{version, slug, planHash, at, sessionId}`; matched by slug+planHash double key. Like snapshots/attestations they survive reset (a human decision about content persists), and remain readable across goal lifecycles.
- **No escape flag.** `--force` does not bypass; the only failure mode is staying blocked with recovery guidance. Hook failures fail open (session never breaks) but the adoption gate stays closed (fail-closed on the trust boundary, per ADR-0013 house rule) — recovery is fixing the hook, never a bypass.
- **Two ablation switches** (ADR-0015 pattern, value exactly "1" to ablate, default-off behavior byte-identical): `LZY_ABLATE_HUMAN_GATE` (machine gate in `doAdoptPlan`), `LZY_ABLATE_HOOK_HUMAN_GATE` (hook approval branch short-circuits back into existing trigger logic). The hook branch sits before the `LZY_ABLATE_HOOK_TRIGGER` short-circuit so ablation axes stay independent.
- **Regex negation boundary.** Approval detection uses a negative lookbehind (不/别) to shield negation forms; exotic phrasings followed by the correct short code are treated as genuine intent — the human typed the exact hash prefix.

## Consequences

- The lazy path is closed: adopting a plan requires a genuine user message containing the current plan's hash prefix; editing the plan after approval voids it (hash re-computation fails the record match) and a fresh code is required.
- **Threat boundary (防偷懒不防伪证):** record files are local files; a same-privilege process (including a misbehaving model) can forge one, exactly like dag.json/attestations. The gate defends against laziness and fake-approval rituals, not against actively malicious evidence fabrication — that is the audit loop's job (comparator/attestation carry approval references). This is the same boundary documented for all local ledgers (roadmap §⑫-四).
- Cost: every goal (LIGHT included) needs one 批准 message per plan adoption. Supersede re-adoption needs a fresh approval for the new planHash — forward-only lineage is untouched.
- UX contract: the model must relay the exact 「批准 <短码>」 sentence verbatim; the hook's error states (code mismatch, plan-changed) inject corrective context so the human can self-correct without model interpretation.

## 修正案（2026-09-20）

Goal `v021-engine-surface` (debt E). `approvalVerdict` returned `null` both when `readGoal` came back empty *and* when the goal simply had no pending adoption, so an approval sentence landing in the wrong directory produced zero output — the L2 gate failed silently (2026-09-20 incident: the user's 「批准 …」 never landed, and it was misdiagnosed as "hook dispatch is broken"). The fallback now splits into three diagnostics (goal unreadable + ancestor found / goal unreadable + none found / goal present without a pending adoption), each emitting once and taking over the turn exactly like the sibling verdict branches. Recording behaviour is unchanged: `approvals/` stays unwritten.

Four boundaries, fixed here so they cannot drift:

1. **Diagnostic only, never blocking.** The branches inject context; they never write a record, never open the gate, and never turn a rejection into a pass. The gate stays closed until a genuine approval arrives.
2. **The ancestor probe is read-only and diagnostic-scoped.** `probeHostRoot` (hook-lib) walks up at most 8 levels using `existsSync` on `.lazyzcode/loop/goal.json` and returns a path. It performs zero state writes and must never be reused by any write path or state resolution — ADR-0006 strict-cwd is untouched: state is still resolved only at the delivered cwd, and no lzy command gains walk-up semantics.
3. **The probe is a hint, not a verification.** It checks path existence only — not goal status, not `approvalPending`. It may therefore name an ancestor whose goal is finished, abandoned, or has nothing pending. That is a legal state, not a defect: the line exists to tell a human where they probably should be, and precision is deliberately not attempted.
4. **The message may carry `cwd`, the probed host root, and the goal slug** — all deterministic for a given state — while the invariant still bans timestamps and record filenames (the record name embeds `Date.now()`; injecting it would break byte-determinism across runs).

**Precedence trade-off (recorded, machine-pinned).** A non-null verdict exits the hook, so an approve-shaped prompt that also carries a trigger word (e.g. `zw 批准 <短码>`) no longer reaches the trigger pipeline for that turn: no claim is written and no ZW engagement is injected. This is intentional — the approval is the stronger intent signal, and the human gate should speak before the loop engages — and the behaviour is pinned by test rather than left incidental.

## 修订节（2026-09-24，0.3.0 M1 goal v030-m1——批准对象迁移，ADR-0024 落地）

ADR-0024 改变批准的**对象**：人批准需求契约（contractHash，不可变），代理在契约边界内自主维护执行计划。自 0.3.0 M1 起双轨并存：

1. **契约 goal**（`lzy loop register --contract <file>` 绑定 `goal.contract`）：计划采纳与 supersede 走**契约门**（授权有效 + 覆盖检查 + subjects⊆scope + 配方一致 + 契约文件漂移复核），批准短语「批准 <contractHash 前 8 位>」由同一 UPS 钩子写入 `.lazyzcode/authorizations/`（approval/withdrawal 追加式，后到者赢）；**契约内重规划不再重走人权门**（supersede 仍重走评审门）。新增撤回短语「撤回 <8hex>」=同轴可信事件：撤回后下一受控动作被拒，已发生外部效果如实保留。机器门同受 `LZY_ABLATE_HUMAN_GATE`、钩子双分支同受 `LZY_ABLATE_HOOK_HUMAN_GATE`（消融矩阵契约测试钉）。
2. **legacy goal**（无契约）：本 ADR 的 planHash 人权门逐字段不变——`approvals/`、approvalPending、exact-hash 复核全保持；显式迁移归 0.3.0 M5。

不变量沿袭：审批记录只能由 UPS 钩子在真实用户消息上写入（CLI 无 approve/withdraw 写命令）；批准绑定不可变哈希，批准后改被批文件=作废；本门防偷懒不防伪证，补偿控制=协议文本+审计环（doctor `contract` 行新增）。
