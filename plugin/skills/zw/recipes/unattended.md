# Recipe: unattended (wake-ups, drive, H3R)

A host-side automation (the engine's scheduler — cron-style, persistent, per
workspace) can wake a fresh session on a schedule to drive an open goal loop. The
wake prompt is plain text; say **`zw 继续`** so the stratified trigger fires and the
zw skill bootstrap loads. `lzy doctor`'s `schedule` line suggests the off-peak window
measured from your own 429 data, cross-checked against declared pricing peaks.

Since 0.2.0 a wake-up has an **in-wake execution channel**: `lzy loop drive`
(ADR-0020) spawns headless engine segments inside one wake and pushes the executing
goal segment by segment — risk/lease/budget gates are checked between segments (HIGH+
risk never enters; a lease keeps a single runtime holder; each drive gets a fresh
wall-clock cap; the points axis is the run's own per-segment `sessionId` usage — the
sum over the sessions this run spawned, queried from the host billing DB (0.3.1
retired the account-level 5h rolling waterline to a `lzy doctor` advisory line; a
contract `budget-ref: none` skips the points axis and keeps wall clock only; segments
whose usage cannot be metered are reported, never counted as zero),
and every segment's lzy writes carry the run's fence token so a taken-over run fails
closed on write instead of corrupting state). Wind-down is always clean and
enumerated: `done`, wall clock exhausted, points budget exhausted, segments
exhausted, two consecutive zero-progress segments (stuck), the step gate stopping at
a high-risk step (`h3r`), or a high-risk command denied at the tool boundary
(`PreToolUse`). Every non-done wind-down authors the 7-field handoff snapshot itself
and registers the handoff marker (see `recipes/continuation.md`), so the next wake-up
(or a human `zw 继续`) resumes from disk. Exit code 0 = done or clean wind-down;
1 = gate reject or segment failure. Since 0.2.4 `lzy loop drive --workers N` (sugar
`--fast` ≡ 2) runs N worker chains per wave on sibling worktrees — env-auth required,
H3R wake switches must be off, measured cost turns ≈2× (ADR-0026). The host
automation remains the **only scheduled wake face** — drive is what a wake runs once
awake. `lzy doctor`'s `drive` line reports channel availability.

## Wake-up protocol (this IS a red-line contract, not a suggestion)

1. **Continue only.** Re-ground with `lzy loop status`, then push the current pending
   step exactly as the workflow says (commit → evidence → `lzy step done`).
2. **Never start a new goal.** No goal in the workspace, or goal in `planning` state?
   Exit cleanly and say so — plan adoption needs a human.
3. **Stop budget is the boundary.** Push until the Stop hook's 2-continue budget is
   spent or a step completes; then end cleanly. Do not pad, do not replan, do not ask
   questions into the void.
4. **Dying turn?** Close cleanly, lose nothing — the next wake-up resumes from
   `.lazyzcode/`.
5. **Serial subagents** regardless of the 并发纪律 cap unless the loop is executing
   F-item captures and the cap allows 2.
6. **Never create wake automations in-session.** The engine auto-binds an automation
   created inside a session to that very session, and one session can own at most one
   automation (ADR-0010) — unbound wakes are created only from the App's automation
   UI (rebuild recipe: plan-v2 report §6).
7. **Stop the wake automation when the goal ends.** After `lzy loop finish` or
   `abandon`, disable the wake automation feeding this workspace (App UI); the CLI
   prints a reminder line. An empty-slot wake is pure idle burn — mounting is ON,
   clearing is OFF (ADR-0010 semantics), and both directions belong to the user.

Suggested automation prompt (host-side configuration, ≥1h interval):

```
zw 继续（无人值守：只推进 executing 目标；无目标或 planning 态则干净退出并说明；不做完不停）
```

## High-risk steps (H3R) — dormant prototypes, never "machine gates" while asleep

The convention that a high-risk step (credential handling, irreversible deletion,
force-push, publish) gets a human look before it runs is **still L0** — protocol
text. Three **dormant prototypes** exist in the unattended lane only, and while
asleep they enforce nothing:

- **Segment-start gate** (`core/drive.js` + `core/h3r.js`): checks the next pending
  step's text at each segment's start and winds down cleanly instead of spawning
  (cause `h3r`). Awake only when `LZY_ABLATE_H3R_GATE` is exactly `"1"` — the
  *inverse* of the `LZY_ABLATE_*` family.
- **One-step-per-segment** (`lzy step done` + a run-unique segment id): when drive
  injects `LZY_SEGMENT_ID` (only while `LZY_ABLATE_H3R_ONESTEP` is `"1"`), a second
  `step done` inside the same segment is refused (re-recording the *same* step id —
  the evidence-rebind path — passes). This gives the segment-start gate a boundary to
  see at all.
- **Command-layer gate** (`plugin/hooks/h3r-pretool.js`, PreToolUse/Bash): when awake
  (`LZY_ABLATE_H3R_PRETOOL` is `"1"`) **and** the drive-injected segment id is
  present (shape-validated `<int>:seg-<int>`), it denies Bash commands whose text
  matches the H3R word list and writes a hit marker that drive consumes for a clean
  wind-down. Interactive sessions carry no drive-injected segment id — exempt given
  env hygiene, and they are the recovery path. Inert without the one-step switch.

Do not call any of them a machine gate while dormant (ADR-0022). Two honest limits:
the word list is substring matching, not a command parser (it can be reworded around,
and it excludes the repo's own `lzy`/`git commit` bookkeeping); and a hook crash or
timeout surfaces to the model as a recoverable tool error on the engine side (never a
silent pass; whether the command itself ran is not guaranteed either way).
