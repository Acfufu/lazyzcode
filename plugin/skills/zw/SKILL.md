---
name: zw
description: LazyZCode goal-loop entry (trigger "zw"; aliases "ulw"/"ultrawork"). Runs a disciplined workflow — plan → execute → evidence → never stop half-done. Use when the user starts a request with "zw"/"ulw"/"ultrawork", asks to run/check a goal loop, or says "不做完不停".
---

# zw — LazyZCode goal loop

You are the executor of a goal loop. The value contract: **plan → execute → take
evidence → never stop half-done**. Loop state lives in `.lazyzcode/` and is owned
by the `lzy` CLI — you drive it, the CLI enforces it, hooks remind you.

All commands below are `lzy …`; if `lzy` is not on PATH, use
`node <lazyzcode-repo>/cli/lzy.js …`.

## Opening protocol

Your first user-visible line must be exactly:

`**ZW** engaged — <LIGHT|HEAVY> tier`

Then run the tier triage below and follow the workflow. No preamble before it.

## Tier triage

- **LIGHT** — small, contained, low-risk (single-file fix, copy edit, one obvious
  config change). Plan may be 1–2 items with a single F item. Skip exploration
  beyond reading the files you will touch.
- **HEAVY** — multi-file features, architecture, anything risky or vague. Explore
  first (read code, run quick probes), then plan every step.
- Escalate LIGHT→HEAVY freely when you discover scope. **Never downgrade.**
  Quota pressure may inform the initial triage choice (see Rate-limit
  discipline) — it never lowers the risk bar.
- **Mention ≠ invocation.** If the user message only mentions zw/ulw in passing
  (meta-discussion about this project — its hooks, status, docs, trigger design),
  do not engage the loop: answer the question directly.

## The workflow

### 1 · Register

```
lzy loop register <slug> --title "<goal in one line>"
```

slug: kebab-case. One active goal per workspace. A finished (`done`) or abandoned goal
still occupies the slot — run `lzy loop reset` first to clear it (reset removes loop
state; your evidence lives in commits and the plan file, not in the reset state).

### 2 · Plan (decision-complete gate + review gate)

Explore what is needed — for **HEAVY** goals spawn the `lazyzcode:explorer` agent
with 3–8 specific questions instead of sweeping alone — then write the plan to
`.lazyzcode/plans/<slug>.md` as a checklist. In large repos, recon should lean on
the code index when available: the user-level `codegraph` MCP (tool
`codegraph_explore`, pass `projectPath`) or its CLI (`codegraph status/query/…`,
already whitelisted for the explorer via Bash) — fall back to plain grep/read when
no index exists for the target repo. If the repo has no root AGENTS.md yet,
suggest running `lazyzcode:init-deep` first — the plan gate reads better with a
project map in place.

```
- [N1] <implementation step>
- [N2] <implementation step>
- [F1] <final verification via a real surface — name the surface>
```

Rules:
- **N items** are implementation steps; **F items** are final verifications that
  require real-surface evidence (HTTP response / screenshot / CLI stdout).
- **Decision-complete**: zero TBDs, zero 待定, no "ask user later". If a decision
  is genuinely missing, interview the user BEFORE writing the plan, not during
  execution.
- Every F item names its surface in the title (e.g. "F1 · CLI stdout shows
  parsed record matches fixture").
- **Known unknowns (HEAVY mandatory, LIGHT advisory)**: after the checklist, add a
  `## Known unknowns` section listing 1–3 assumptions the plan silently rests on,
  each with its falsification path (what signal proves it wrong, how to check).
  Writing "none" requires a one-line note of where you looked. This section states
  **unverified premises**, not postponed decisions — and it must not contain the
  gate's forbidden tokens (see the Decision-complete rule above), or the plan is
  rejected like any other line. Protocol and ledger: `docs/ablation.md`.

**Review gate** — the plan does not go live on your word alone:

- **HEAVY (mandatory)**: spawn the `lazyzcode:plan-reviewer` agent with the goal
  and plan path. On `VERDICT: PASS` adopt with the review record:
  `lzy loop plan .lazyzcode/plans/<slug>.md --review "plan-reviewer: PASS — <one-line summary>"`.
  On `VERDICT: REVISE` the CLI rejects adoption — fix the plan per the review
  items and re-review; never bypass with `--force`.
- **LIGHT**: run the reviewer's checklist yourself (decision-complete, F surfaces
  named, scope tight). `--review` optional.

Then start:

```
lzy loop plan .lazyzcode/plans/<slug>.md [--review "plan-reviewer: PASS …"]
lzy loop start
```

### 3 · Execute

Work step by step, in order. After finishing a step's work:

```
lzy step done N1 --note "<what was done, one line>"
```

- **Edit discipline**: Edit tool `old_string` must carry the file's exact original
  indentation — lenient fallback silently rewrites indentation style.
- **Commit before evidence**: evidence binds to `git rev-parse HEAD^{tree}`;
  uncommitted changes are invisible to the hash. Commit your step, then verify.

### 4 · Evidence (F items)

For each F item, either verify it yourself or — when the surface needs careful
command-by-command capture — spawn `lazyzcode:qa-executor` with the item and the
suggested command; it returns verbatim observed output and a MATCH verdict.

`lzy step done F1 --evidence "<the observable result you actually saw>"`

- **Tests alone never prove done.** Green tests are necessary, not sufficient.
- Run the real surface: hit the endpoint, take the screenshot, run the CLI and
  read its stdout. For web/HTTP surfaces prefer read-only HTTP via `curl` or the
  Bash-driven `ego-browser` skill (`serverFetch`/`browserFetch`/`captureScreenshot`
  helpers) — screenshots and response bodies are first-class F-item evidence.
  The built-in browser-use skill (`control-browser`) is main-agent-only and
  cannot be used inside subagents. Record what you observed, not what you hope.
  Evidence from qa-executor must quote its observed output, never its
  conclusions alone.
- **File evidence**: attach the capture itself with
  `lzy step done F1 --evidence "<what the capture shows>" --evidence-file
  <path>` (repeatable, ≤4 files per F item). `lzy` copies each file into
  `.lazyzcode/evidence/` and binds its sha256. The text still has to say what
  the capture shows — a PNG nobody describes is not evidence.
- Code changed after you captured evidence? The evidence is stale — `lzy loop
  finish` will reject it. Re-verify on the current code and re-record.

### 5 · Finish

```
lzy loop finish
```

Passes only when every step is done AND every F item's evidence tree-hash equals
the current code. This is the only valid "done". 不做完不停 — if finish rejects,
keep working, never declare victory.

**Commit ledger (ADR-0005).** Every commit made inside a goal carries a trailer-style
pointer `Goal: <slug>#<step>` (e.g. `Goal: ledger-discipline#N3`) — humans and agents alike;
historical commits are never rewritten to add it. `lzy doctor`'s `ledger` line patrols
coverage (warn-only).

**Evidence opt-in.** If the plan declares "evidence go-to-repo", copy the archived bundle
to `docs/evidence/<slug>.md` after an explicit human nod. Goals whose plans say
"zero repo writes" are never touched by this.

On success `finish` archives an evidence bundle to
`.lazyzcode/evidence/<slug>.report.md` (plan verdict, step notes, F-item
evidence with attachments). Then close the loop with a memory ritual: distill
**2–3 durable, repo-specific lessons** from this goal (flaky verification
surfaces, required headers/flags, slow suites — things the next goal would
otherwise rediscover) and save them to your native project memory, one memory
file per lesson (`type: project`). Future sessions pick them up automatically.

## Host workspace (cross-repo goals)

Applies when a goal's code lives outside the repo that owns `.lazyzcode/`
(that repo is the **host workspace** — loop state registers there, ADR-0006):

- The session stays rooted at the host. Run `lzy` only from the host root —
  prefix commands with `cd <host-root> &&` (Bash cwd persists across calls,
  and the engine's cwd reset is not guaranteed on failure/timeout paths).
- Inside code repos use absolute paths or `git -C <repo>` — never `cd` away
  and forget the way back.
- Directory resolution is strict-cwd (no walk-up): a missing-goal error prints
  the exact path it checked — return to the host root; don't expect a flag to
  relax it.
- Take F-item evidence **after the last code-repo commit**; if a sibling repo
  gains commits before `finish`, re-verify and re-record (the freshness gate
  only sees the host tree). Never `register` from a non-host root.

## Continuation (how the Stop hook drives you)

- The plugin's Stop hook requests engine continuation while the goal is
  unfinished — at most **2× per session** (it reserves 1 of the engine's
  shared 3-continue pool for background notifications).
- When you feel the `[lzy]` nudge: continue the **current step**. Do not replan,
  do not summarize, do not ask questions — work.
- Budget exhausted with steps remaining? State plainly which steps remain and
  stop cleanly; the next session's SessionStart hook re-injects the loop state.
- `lzy loop status` at any time to re-ground yourself (also after compaction);
  for cross-repo goals, return to the host root before running it.

## Rate-limit discipline (provider concurrency)

Model access is a provider-side concurrency quota shared across ALL your
sessions (GLM plans cap it per tier — Max > Pro > Lite; error `1302` /
429 `rate_limited` means the account hit it). This is NOT the 3-continue
Stop pool from Continuation — two different pools, never confuse them.

- **One active goal loop at a time.** Do not run several `zw` loops in
  parallel sessions; serialize batches instead.
- **Subagent parallelism is measured, not guessed.** `lzy loop start` prints a
  并发纪律 line — a parallelism cap computed from your real 429 data (recent
  hits, the measured concentration window, the empirical concurrency band).
  Follow it: cap 1 = run explorer / plan-reviewer / qa-executor strictly one
  at a time; cap 2 = go parallel only to capture several independent F-item
  evidences. No advisory printed (no log data) → assume the conservative
  default of ≤2 for independent captures only.
- **A turn died with 429/`1302 rate limited`?** Do not retry-bomb, do not
  replan. Close the session cleanly — `.lazyzcode/` lost nothing — and tell
  the user to resume with `zw 继续` (or `lzy loop step`) after a few minutes,
  when the quota window has room again.
- **Risk trumps quota.** HEAVY costs more calls (review gate, evidence
  capture, Stop pulls); when quota is tight, genuinely contained work may
  start LIGHT — but anything risky or vague is HEAVY regardless of quota.
  This applies only at triage; once engaged, never downgrade.
- **Before multi-session work**, run `lzy doctor`: its `rate-limit` line
  reports your account's recent 429 pressure and empirical concurrency band
  (or one-sided evidence when no coherent band exists — degradation is the
  normal path under attribution drift).

## Unattended mode (scheduled wake-ups)

A host-side automation (the engine's scheduler — cron-style, persistent, per
workspace) can wake a fresh session on a schedule to drive an open goal loop.
The wake prompt is plain text; say **`zw 继续`** so the stratified trigger
fires and this skill's bootstrap loads. `lzy doctor`'s `schedule` line
suggests the off-peak window measured from your own 429 data.

Protocol for a wake-up session (this IS a red-line contract, not a suggestion):

1. **Continue only.** Re-ground with `lzy loop status`, then push the current
   pending step exactly as the workflow says (commit → evidence → `lzy step
   done`).
2. **Never start a new goal.** No goal in the workspace, or goal in
   `planning` state? Exit cleanly and say so — plan adoption needs a human
   (the decision-complete gate requires interviewing the user, which a wake-up
   cannot do).
3. **Stop budget is the boundary.** Push until the Stop hook's 2-continue
   budget is spent or a step completes; then end cleanly. Do not pad, do not
   replan, do not ask questions into the void.
4. **Dying turn?** Same as rate-limit discipline: close cleanly, lose
   nothing — the next wake-up resumes from `.lazyzcode/`.
5. **Serial subagents** regardless of the 并发纪律 cap unless the loop is
   executing F-item captures and the cap allows 2.

Suggested automation prompt (host-side configuration, ≥1h interval):

```
zw 继续（无人值守：只推进 executing 目标；无目标或 planning 态则干净退出并说明；不做完不停）
```

## Red lines

1. Never write the user's `config.json`; plugin enabling flows only through the
   engine's official CLI (`lzy install` handles this).
2. Evidence is tree-hash-bound. Tests alone ≠ evidence.
3. `.lazyzcode/` is the loop's single source of truth — if speech and state
   disagree, trust the state, then fix the speech.

## Roles (plugin agents)

| Agent | Use it for | Notes |
|---|---|---|
| `lazyzcode:explorer` | HEAVY planning recon: answer specific questions with `path:line` evidence | read-only; never edits |
| `lazyzcode:plan-reviewer` | HEAVY plan gate before `lzy loop plan` | returns VERDICT: PASS/REVISE; read-only |
| `lazyzcode:qa-executor` | F-item evidence capture on the real surface | returns verbatim output + MATCH verdict |

All three are read-only discipline roles. The main agent (you) stays the sole
writer: agents report, you decide and record via `lzy`.

## Trigger

The plugin's UserPromptSubmit hook injects this skill's bootstrap on stratified
matches: a prompt **starting with** `zw` (`zw <task>`), or containing the
explicit skill name `lazyzcode:zw` (full-width colon works too), or containing
`ulw` / `ultrawork` anywhere (word-bounded). A bare `zw` mentioned mid-sentence
does not fire. The skill can also be invoked explicitly (`/zw` or the Skill
tool). Aliases are equal — `zw` is the primary.

## CLI cheat sheet

| Command | Purpose |
|---|---|
| `lzy loop register <slug> --title …` | create goal (planning) |
| `lzy loop plan <file> [--force]` | adopt checklist (rejects TBD) |
| `lzy loop start` | planning → executing; prints the measured 并发纪律 advisory |
| `lzy loop status` | progress, next step, evidence freshness |
| `lzy step done <ID> [--note] [--evidence] [--evidence-file …]` | complete a step (F requires evidence; files bound by sha256) |
| `lzy loop verify` | evidence freshness report (exit 1 when stale/unbound evidence **or no goal exists**) |
| `lzy loop finish` | final gate: all done + fresh evidence; auto-archives the evidence bundle |
| `lzy loop export` | re-export the evidence bundle to `.lazyzcode/evidence/<slug>.report.md` |
| `lzy loop abandon` / `lzy loop reset` | give up / clear state |
| `lzy doctor` | deep local diagnostics incl. rate-limit pressure (zero telemetry) |
