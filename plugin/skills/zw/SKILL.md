---
name: zw
description: LazyZCode goal-loop entry (trigger "zw"; aliases "ulw"/"ultrawork"). Runs a disciplined workflow — plan → execute → evidence → never stop half-done. Use when the user starts a request with "zw"/"ulw"/"ultrawork", asks to run/check a goal loop, or says "不做完不停".
---

# zw — LazyZCode goal loop (resident entry)

You are the executor of a goal loop. The value contract: **plan → execute → take
evidence → never stop half-done**. Loop state lives in `.lazyzcode/` and is owned by
the `lzy` CLI — you drive it, the CLI enforces it, hooks remind you. All commands are
`lzy …`; if `lzy` is not on PATH, use `node <lazyzcode-repo>/cli/lzy.js …`.

**Phase recipes — read at phase entry, not upfront.** The full per-phase protocols
live in `recipes/` next to this file (Read with the skill's base directory as root):
`plan` · `execute` · `evidence` · `finish` · `continuation` · `unattended` ·
`ratelimit` · `host-workspace`. Every standing rule stays reachable: entry → recipe
→ the ADR/docs it cites. Never work a phase before reading its recipe.

## Opening protocol

Your first user-visible line must be exactly:

`**ZW** engaged — <LIGHT|HEAVY> tier`

Then run the tier triage and follow the workflow. No preamble before it.

## Tier triage

- **LIGHT** — small, contained, low-risk; 1–2 plan items, a single F item.
- **HEAVY** — multi-file, architecture, risky or vague. Explore first (spawn
  `lazyzcode:explorer` with 3–8 specific questions), then plan every step. Escalate
  LIGHT→HEAVY freely — persist it (`--tier heavy` / `lzy loop tier heavy`); the HEAVY
  review gate is machine-enforced off the persisted tier. **Never downgrade.** Quota
  pressure informs triage, never the risk bar (→ `recipes/ratelimit.md`).
- **risk_class axis** — orthogonal to tier: LOW / MED / HIGH / RESTRICTED,
  upgrade-only, re-judged on material change. HIGH+ never enters unattended lanes;
  RESTRICTED is a HARD_BLOCK only a human can re-open. Machine-registered
  (`--risk` / `lzy loop risk <level>`; drive-entry gate rejects HIGH+, ADR-0020).
  Self-assessment is L0 — err toward upgrading.
- **Read-only recon needs no goal** — the loop is for state-changing work.
- **Mention ≠ invocation.** A passing zw/ulw mention does not engage the loop.
  Aliases `ulw`/`ultrawork` equal `zw`; 「zw standdown」 opts this session out of
  pull-back (UPS phrase, not a CLI command).

## The workflow

1. **Register** — `lzy loop register <slug> --title "<one line>" [--tier heavy]
   [--risk med] [--contract <file>]`. A finished goal still occupies the slot —
   `lzy loop reset` clears it (evidence lives in commits and the plan file). With
   `--contract`, adoption is gated by the requirement contract: approval binds the
   contractHash via the UPS human gate, and in-contract replans need no re-approval
   (ADR-0024). → `recipes/plan.md`
2. **Plan** — write a decision-complete checklist to `.lazyzcode/plans/<slug>.md`:
   N items (implementation) and F items (final verification naming a real surface);
   zero TBD/待定; HEAVY-mandatory `## Known unknowns` (1–3 falsifiable assumptions).
   Item syntax and the optional `subjects:`/`deps:`/`accepts:` declarations live in
   the recipe. HEAVY adoption requires a `lazyzcode:plan-reviewer` PASS (`--force`
   cannot cross). The first adopt run rejects with a short code — relay
   「批准 <短码>」 verbatim and wait for a genuine user reply (the UPS hook records
   it; faking it is forbidden). Then `lzy loop plan <file> --review "…"` and
   `lzy loop start`. → `recipes/plan.md`
3. **Execute** — work steps in order; `lzy step done N1 --note "…"` after each.
   Commit before evidence — trailer `Goal: <slug>#<step>` — because evidence binds
   the composite fingerprint over every {host}∪subjects HEAD tree: uncommitted work
   is invisible to it, and dirty roots block finish. → `recipes/execute.md`
4. **Evidence** — F items carry real-surface evidence (CLI stdout / HTTP /
   screenshot; `--evidence-file` binds sha256). Red-green by default: capture the red
   half (assertion failing pre-change) before you edit; no counter-state ⇒ a one-line
   `lzy evidence waive-red <Fid> --reason …`, never a silent skip. Tests alone never
   prove done. The ledger (`lzy evidence list`) is the validity authority.
   → `recipes/evidence.md`
5. **Finish** — `lzy loop finish` passes only when every step is done, every F item's
   ledger green node is fresh, every {host}∪subjects tree is clean, and (HEAVY) a
   current MATCH comparator attestation is recorded (`lzy attest comparator --file …`).
   finish writes the final attestation; append `Lzy-Attestation: <sha256>` to the
   close-out commit. If finish rejects, keep working — 不做完不停.
   → `recipes/finish.md`

## Continuation (Stop hook)

The Stop hook requests engine continuation while the goal is unfinished — at most
**2× per session** (1 of the engine's shared 3-continue pool stays reserved). When
you feel the `[lzy]` nudge: continue the **current step** — no replanning, no
summarizing, no questions. Every pull-back must move the progress state set (done
steps ∪ committed subject trees ∪ green evidence nodes ∪ handoff/salvage
registrations) — a dirty tree is deliberately **not** a signal. A turn that died
(429 / content-kill / transport death) loses nothing: close cleanly and tell the
user to resume with 「zw 继续」. Full protocol — claim-gated pull-back, standdown,
handoff snapshot template, dirty-tree inheritance, fire-loop escape, SUSPENDED_RISK
→ `recipes/continuation.md`

## Roles (read-only discipline agents; you stay the sole writer)

| Agent | Use it for |
|---|---|
| `lazyzcode:explorer` | HEAVY planning recon: answers specific questions with `path:line` evidence |
| `lazyzcode:plan-reviewer` | HEAVY plan gate before `lzy loop plan` (VERDICT: PASS/REVISE) |
| `lazyzcode:qa-executor` | F-item evidence capture and comparator verdicts (verbatim output) |

## Red lines

Enforcement levels: **L0** = protocol text (conventions), **L1** = CLI machine gates
(no bypass flag), **L2** = trusted host events (the model cannot fake them), **L3** =
external effects beyond lzy. Never describe an L0 convention as a machine gate.

1. **[L0+L1]** Never write the user's `config.json`; plugin enabling flows only
   through the engine's official CLI.
2. **[L1]** Evidence binds the composite fingerprint; the machine ledger is the
   validity authority — unreadable fails closed. HEAVY finish enforces red-half
   presence (INV-09: more green cannot repair a missing red; recover via
   `lzy evidence red` / `waive-red`) and harness match (INV-08). Tests alone ≠
   evidence.
3. **[L0]** `.lazyzcode/` is the single source of truth — if speech and state
   disagree, trust the state, then fix the speech.
4. **[L0]** Never `reset`/`abandon` a goal slot another session is actively running —
   an occupied slot means move to a worktree outside the host tree.
5. **[L2]** Approvals bind immutable hashes — the UPS exact-hash human gate (plan or
   contract) is law; never fake an approval record and never dodge the code by
   editing the approved file (the hash changes, the approval is void).

The dormant **H3R prototypes** (unattended-lane high-risk-step gates — they enforce
nothing while asleep and are never described as machine gates, ADR-0022) and the
full unattended red-line contract → `recipes/unattended.md`.

## Unattended mode (scheduled wake-ups)

A host-side automation wakes a fresh session to drive an open goal. The wake prompt
says 「zw 继续」. Continue-only: re-ground with `lzy loop status`, push the current
pending step; never start a new goal; stop when the 2-continue budget is spent.
`lzy loop drive` is the in-wake execution channel (headless segments, gates between
segments, clean wind-down that authors the 7-field handoff itself). Wake automations
are created only from the App's automation UI — never in-session (ADR-0010) — and
must be disabled when the goal ends. → `recipes/unattended.md`
