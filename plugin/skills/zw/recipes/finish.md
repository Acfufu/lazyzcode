# Recipe: finish

```
lzy loop finish
```

Passes only when every step is done, every F item's evidence fingerprint is fresh
against the current subject set, AND every {host}∪subjects tree is clean
(dirty/missing/git-error all reject; no bypass flag) — and, for HEAVY goals, a
current MATCH comparator attestation. This is the only valid "done". 不做完不停 —
if finish rejects, keep working, never declare victory.

On success `finish` writes the **final attestation**
`.lazyzcode/attestations/<attemptId>.json` — the LOOP_COMPLETE machine proof
(planHash, per-root head trees, composite fingerprint, ledger-anchored evidence refs,
comparator record, report sha256); it survives `reset` as history. **Close-out
trailer (text half, L0):** append `Lzy-Attestation: <full sha256 of the attestation
file>` to the close-out commit's message — a tamper-evident pointer from the machine
proof into commit history.

## Evidence comparison (comparator, HEAVY mandatory)

Existence and freshness are the CLI's gates; relevance is not checked by any CLI — so
before `finish`, dispatch `qa-executor` in comparator mode over every F item's
assertion–evidence pair. The comparator also checks dual-evidence halves: every F
item shows red + green or a one-line exemption; a missing half without an exemption
is a `不匹配`. A `不匹配` verdict means the evidence does not demonstrate the claim:
re-capture on the right surface, or if the F item itself was wrong, amend the plan
honestly — then re-run. LIGHT goals: do the comparison yourself as a self-check
(weaker — you authored the evidence; know its blind spot).

**Machine attestation:** transcribe the comparator verdicts into a minimal JSON
(`{"slug", "items": [{"fid", "verdict": "MATCH|MISMATCH", "evidenceNodeId"|"generation",
"basis"}], "note"?}` — items must cover every F item, and every item must bind
evidence: `evidenceNodeId` = the green node id shown by `lzy evidence list`, or
`generation` = its capture generation; a comparison not anchored to a recorded green
half is rejected at record time) and record it with
`lzy attest comparator --file <verdicts.json>`. For HEAVY goals `finish`
machine-enforces a current MATCH attestation whose fingerprint matches the tree
(missing / MISMATCH / stale all reject, no bypass); LIGHT goals may skip recording.

## Adversarial coverage

HEAVY finishes touching command, parse, or state-merge surfaces self-check against
`docs/research-adversarial-checklist.md` — the standing nine-class sheet: probe what
applies, record why the rest are excluded.

## Evidence opt-in

If the plan declares "evidence go-to-repo", copy the archived bundle to
`docs/evidence/<slug>.md` after an explicit human nod. Goals whose plans say "zero
repo writes" are never touched by this.

## After finish

`finish` archives an evidence bundle to `.lazyzcode/evidence/<slug>.report.md`.
Close the loop with a memory ritual: distill **2–3 durable, repo-specific lessons**
from this goal (flaky verification surfaces, required headers/flags, slow suites —
things the next goal would otherwise rediscover) and save them to your native project
memory, one memory file per lesson (`type: project`). Stop the wake automation
feeding this workspace if one is mounted (App UI).
