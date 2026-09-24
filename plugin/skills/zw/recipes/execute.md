# Recipe: execute

Work step by step, in order. After finishing a step's work:

```
lzy step done N1 --note "<what was done, one line>"
```

- **Edit discipline**: Edit tool `old_string` must carry the file's exact original
  indentation — the lenient fallback silently rewrites indentation style.
- **Attempt notes (换路注记)**: redoing a step with a different approach — failed path
  abandoned — must leave a one-line note under that plan entry:
  `- [!] attempt <n>: dropped <approach A> because <reason>; switching to <B>`.
  The plan file is the attempt history; a fresh claimer must not re-walk a falsified
  path.
- **Commit before evidence — and before finish**: evidence binds to the composite
  fingerprint (per-subject HEAD tree hashes); uncommitted changes are invisible to
  it. Commit your step, then verify. At finish the integrity gate additionally
  requires every {host}∪subjects root clean — dirty, missing, or git-error roots all
  reject, no bypass flag.
- **Mechanical $0 checks first**: exhaust zero-cost mechanical verification before
  any semantic/model-judged check — CLI stdout, file existence and content
  assertions, `grep`/`diff`. Never spend a model call on a question a command can
  answer.

## Parallel dispatch (same-goal multi-worker, minimal claim chain)

When the measured concurrency cap allows ≥2, workers coordinate per step — claim
first with `lzy loop claim <id>` (anonymous, 48h mutual exclusion; bare
`lzy loop claim` lists claimable steps; `step done` auto-releases; `--release` frees
early), then work only your claimed step. Each worker edits code in its own git
worktree, but runs every `lzy` command from the host workspace root (ADR-0006
strict-cwd — worktrees isolate code, not loop state). Claims are anonymous: never
`step done` a step another worker still holds a fresh claim on — reconcile the claim
listing first. Serial remains the default; the `lzy loop start` 并发纪律 line wins
over any general rule here.

## Same-workspace multi-session

One goal slot per workspace — a second `register` in the same tree is rejected, and a
`done` goal keeps the slot until `lzy loop reset`. Default to serial in one tree:
finish or take over the running goal before starting another. **Never
`reset`/`abandon` a slot another session is actively running** — that destroys its
executing state (only a salvage stub survives); the slot error means "move to a
worktree", never "clear the slot". To run goals in parallel, give each its own git
worktree **created outside the host tree** (an in-tree worktree dir reads as
untracked and blocks the host's own finish via the integrity gate). Multiple sessions
cooperating on the SAME goal coordinate per step via `lzy loop claim` with one writer
committing at a time: any commit advances the tree hash and invalidates the other
sessions' captured F evidence, and anyone's uncommitted work blocks everyone's finish
— read `lzy loop status` (claims, dirt) before you claim the finish. Multi-tree
parallelism (each worktree its own slot and goal) is supported since 0.2.0: per-tree
ledgers are mutually blind (survey siblings with `lzy loop list --root`), and
`Goal:`-trailer commits on side branches count in history/salvage/doctor ledger
(`git log --all`, ADR-0020).

## Commit ledger (ADR-0005)

Every commit made inside a goal carries a trailer-style pointer
`Goal: <slug>#<step>` (e.g. `Goal: ledger-discipline#N3`) — humans and agents alike;
historical commits are never rewritten to add it. `lzy doctor`'s `ledger` line
patrols coverage (warn-only).

## Attempt lineage (0.1.0, ADR-0016)

Changing an adopted plan mid-execution goes through `lzy loop supersede <plan>
[--review …]` — forward-only: the old attempt is marked superseded, a new attempt
opens, and the full adoption gates re-run (HEAVY review gate; human gate per the
contract/legacy split in `recipes/plan.md`). `lzy loop attempts` shows the lineage.

## CLI cheat sheet

| Command | Purpose |
|---|---|
| `lzy loop register <slug> --title … [--tier heavy] [--risk …] [--contract <file>]` | create goal (planning) |
| `lzy loop supersede <plan> [--review …]` | forward-only plan change mid-execution |
| `lzy loop attempts` | attempt lineage read face (read-only) |
| `lzy loop plan <file> [--force]` | adopt checklist (rejects TBD; snapshots + planHash; human gate) |
| `lzy loop start` | planning → executing; prints the measured 并发纪律 advisory |
| `lzy loop subject add/remove <path> · subject list` | declare/remove sibling repo roots |
| `lzy loop tier heavy` / `lzy loop risk <level>` | tier/risk upgrade, one-way |
| `lzy loop lease acquire/heartbeat/release/reclaim` | run-level lease + fence token (ADR-0020) |
| `lzy loop budget init/spend/remaining` | drive budget wall-clock + points cap |
| `lzy loop drive [--wall-ms N] [--max-segments N] [--mode m]` | in-wake unattended execution channel |
| `lzy loop drive --workers N` · `--fast` | multi-worker wave orchestration (0.2.4; LIGHT only, ADR-0026) |
| `lzy loop status` | progress, next step, evidence freshness |
| `lzy step done <ID> [--note] [--evidence] [--evidence-file …]` | complete a step |
| `lzy loop verify` | evidence freshness report (exit 1 when stale/unbound or no goal) |
| `lzy evidence red <Fid> · waive-red <Fid> --reason · list` | dual-evidence ledger |
| `lzy dag dependents <id|surface>` / `lzy dag stale` | invalidation DAG queries (read-only) |
| `lzy attest comparator --file <json>` | record comparator verdicts (HEAVY finish enforces MATCH) |
| `lzy loop finish` | final gate + archive + final attestation |
| `lzy loop export` | re-export the evidence bundle |
| `lzy loop abandon` / `lzy loop reset` | give up / clear state |
| `lzy contract show` / `lzy contract auth` | contract read faces (0.3.0; approval/withdrawal live in UPS phrases) |
| `lzy project check` / `lzy project discover` | manifest readiness / missing-list (0.3.0) |
| `lzy migrate preview <root>` | legacy-records read-only preview (0.3.0) |
| `lzy doctor` | deep local diagnostics incl. rate-limit pressure (zero telemetry) |
