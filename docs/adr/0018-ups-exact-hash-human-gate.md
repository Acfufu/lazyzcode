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
