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
- Escalate LIGHT→HEAVY freely when you discover scope — and persist it: register
  with `--tier heavy` or run `lzy loop tier heavy` before adopting. The HEAVY
  review gate is enforced by the machine off the persisted tier, not your
  narration: HEAVY adoption without a PASS review is hard-rejected. **Never
  downgrade.**
  Quota pressure may inform the initial triage choice (see Rate-limit
  discipline) — it never lowers the risk bar.
- **risk_class axis (0.1.0, L0 protocol text)** — orthogonal to LIGHT/HEAVY
  (which measure effort): LOW / MED / HIGH / RESTRICTED, upgrade-only, judged
  at triage and re-judged on material change. HIGH+ must never enter
  unattended lanes (scheduled wake-ups, idle runs); RESTRICTED is a
  HARD_BLOCK — only a human narrowing the scope re-opens it. Since 0.2.0 the
  risk_class is machine-registered (L1 data): `lzy loop register --risk …` /
  `lzy loop risk <level>` (upgrade-only), and the drive-entry gate
  (`assertDriveEligible`, ADR-0020) rejects HIGH/RESTRICTED at the unattended
  lane entry, machine-enforced since 0.2.0 baton 2 (`lzy loop drive` runs the
  gate before anything spawns). Triage self-assessment itself remains L0 — err
  toward upgrading; the machine enforces the value you declared.
- **Read-only recon needs no goal.** Information gathering, code reading and
  Q&A are not goal-loop work — the loop is for state-changing work (plan
  adoption needs a human and a decision-complete plan anyway). Do the recon,
  report, and stop; don't register a goal just to think out loud.
- **Mention ≠ invocation.** If the user message only mentions zw/ulw in passing
  (meta-discussion about this project — its hooks, status, docs, trigger design),
  do not engage the loop: answer the question directly.

## The workflow

### 1 · Register

```
lzy loop register <slug> --title "<goal in one line>" [--tier heavy]
```

slug: kebab-case. One active goal per workspace. A finished (`done`) or abandoned goal
still occupies the slot — run `lzy loop reset` first to clear it (reset removes loop
state; your evidence lives in commits and the plan file, not in the reset state).
`--tier` defaults to light; `--tier heavy` declares a heavy goal up front — HEAVY
adoption without a PASS review is machine-rejected (not a reminder; `--force` does
not cross it).

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
subjects: ../sibling-repo
subjects: /abs/other-repo

- [N1] <implementation step>
- [N2] <implementation step>
deps: N1
- [F1] <final verification via a real surface — name the surface)
```

Rules:
- **N items** are implementation steps; **F items** are final verifications that
  require real-surface evidence (HTTP response / screenshot / CLI stdout).
- **Subjects (multi-tree goals)**: optional `subjects: <path>` header lines —
  one path per line, header-only (before the first item; stray body lines are
  rejected like orphan `deps:`), relative paths resolve against the host root.
  Each must exist, be a git repo, and not contain/be contained by the host
  (siblings only). Declare subjects as early as you know them: evidence binds
  the composite fingerprint over {host}∪subjects, so any mid-loop
  `lzy loop subject add|remove` invalidates ALL captured F evidence (re-capture
  before finish). Undeclared sibling repos stay invisible to the freshness gate
  — declaring them is the discipline.
- **Dependency edges (optional)**: a `deps: N1,N2` line immediately after an
  item declares its prerequisites — the declaration line must be bare
  lowercase `deps:` (bullet-led or `Deps:` variants are rejected as orphans);
  ids are N/F + digits, case-sensitive, deduplicated, must exist, and
  self-loops/cycles are rejected; an orphan `deps:` line (not directly after
  an item) fails the gate. Quoting the syntax in prose? End that line with
  `<!--lzy:allow-->` — and never paste plan-syntax examples into an adopted
  plan file: the item parser is fence-blind, so any line matching the grammar
  becomes a step.
- **Decision-complete**: zero TBDs, zero 待定, no "ask user later". If a decision
  is genuinely missing, interview the user BEFORE writing the plan, not during
  execution.
- Every F item names its surface in the title (e.g. "F1 · CLI stdout shows
  parsed record matches fixture").
- **Handoff-able steps**: each N item carries its own pointers (files, symbols,
  expected shape) so a fresh claimer can execute it without reading the whole
  plan — sessions die and goals get adopted mid-flight; write every step for
  the engineer who was not in the room.
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
  The first adopt run then hits the **human gate (L2, ADR-0018)**: the CLI
  rejects with a pending short code — relay the exact sentence
  「批准 <短码>」 to the user verbatim and wait for their reply (the
  UserPromptSubmit hook records the approval only on a genuine user prompt),
  then re-run the same adopt command.
  On `VERDICT: REVISE` the CLI rejects adoption — fix the plan per the review
  items and re-review; never bypass with `--force`. Amending an adopted plan and
  re-adopting requires a fresh review — a changed snapshot hash with an unchanged
  review string is a red line (the CLI warns; the record must not lie about what
  was reviewed).
- **LIGHT**: run the reviewer's checklist yourself (decision-complete, F surfaces
  named, scope tight). `--review` optional. The human gate applies to LIGHT too.

Then start:

```
lzy loop plan .lazyzcode/plans/<slug>.md [--review "…"]   # 1st run rejects with 短码 → relay 「批准 <短码>」, wait, re-run
lzy loop start
```

### 3 · Execute

Work step by step, in order. After finishing a step's work:

```
lzy step done N1 --note "<what was done, one line>"
```

- **Edit discipline**: Edit tool `old_string` must carry the file's exact original
  indentation — lenient fallback silently rewrites indentation style.
- **Attempt notes (换路注记)**: redoing a step with a different approach — failed
  path abandoned — must leave a one-line note under that plan entry:
  `- [!] attempt <n>: dropped <approach A> because <reason>; switching to <B>`.
  The plan file is the attempt history; a fresh claimer must not re-walk a
  falsified path.
- **Commit before evidence — and before finish**: evidence binds to the composite
  fingerprint (per-subject HEAD tree hashes); uncommitted changes are invisible
  to it. Commit your step, then verify. At finish the integrity gate additionally
  requires every {host}∪subjects root clean — dirty, missing, or git-error roots
  all reject, no bypass flag.
- **Parallel dispatch (same-goal multi-worker, minimal claim chain)**: when the
  measured concurrency cap allows ≥2, workers coordinate per step — claim first
  with `lzy loop claim <id>` (anonymous, 48h mutual exclusion; bare
  `lzy loop claim` lists claimable steps; `step done` auto-releases;
  `--release` frees early), then work only your claimed step. Each worker edits
  code in its own git worktree, but runs every `lzy` command from the host
  workspace root (ADR-0006 strict-cwd — worktrees isolate code, not loop
  state). Claims are anonymous: never `step done` a step another worker still
  holds a fresh claim on — reconcile the claim listing first (`lzy loop claim`).
  Serial remains the default; the `lzy loop start` 并发纪律 line wins
  over any general rule here.
- **Same-workspace multi-session**: one goal slot per workspace — a second
  `register` in the same tree is rejected, and a `done` goal keeps the slot until
  `lzy loop reset`. Default to serial in one tree: finish or take over the running
  goal before starting another. **Never `reset`/`abandon` a slot another session is
  actively running** — that destroys its executing state (only a salvage stub
  survives); the slot error means "move to a worktree", never "clear the slot". To
  run goals in parallel, give each its own git worktree **created outside the host
  tree** (an in-tree worktree dir reads as untracked and blocks the host's own
  finish via the integrity gate). Multiple sessions cooperating on the SAME goal
  coordinate per step via `lzy loop claim` with one writer committing at a time:
  any commit advances the tree hash and invalidates the other sessions' captured F
  evidence, and anyone's uncommitted work blocks everyone's finish — read
  `lzy loop status` (claims, dirt) before you claim the finish. Multi-tree
  parallelism (each worktree its own slot and goal, N at once) is a supported
  form since 0.2.0: per-tree ledgers are mutually blind (each `.lazyzcode/`
  keeps its own evidence bundles and attestations — survey siblings with
  `lzy loop list --root`), and the ledger no longer goes blind on unmerged
  branches: `Goal:`-trailer commits on side branches count in history/salvage/
  doctor ledger (`git log --all`, ADR-0020).

### 4 · Evidence (F items)

For each F item, either verify it yourself or — when the surface needs careful
command-by-command capture — spawn `lazyzcode:qa-executor` with the item and the
suggested command; it returns verbatim observed output and a MATCH verdict.

`lzy step done F1 --evidence "<the observable result you actually saw>"`

- **Tests alone never prove done.** Green tests are necessary, not sufficient.
- **Evidence binds the composite fingerprint**: sha256 over every
  {host}∪subjects root's HEAD tree hash — any root changing (or the subject set
  itself changing) makes the evidence stale. Legacy evidence (recorded pre-0.0.8)
  compares the single host tree, unchanged behavior.
- **Red-green evidence (dual evidence).** Every F-item claim carries two halves
  by default: a **red** capture showing the assertion failing on the pre-change
  state, and a **green** capture showing it passing on the post-change state.
  Capture the red half before you edit. If no counter-state can be constructed
  for the surface (pure reachability, ambient facts), say so in a one-line
  exemption inside the evidence text — exemptions state why, they are not a
  silent skip. Narrate both halves in `--evidence`; attach both captures with
  `--evidence-file` when they are files.
  **Machine ledger (0.0.9, ADR-0014):** the halves are also machine-accounted —
  `lzy evidence red <Fid> --evidence … [--surface <external-surface>]` records the
  red half (default surface = composite fingerprint at capture time; `--surface`
  binds an external surface such as a published version, and red/green each bind
  their OWN surface), `lzy evidence waive-red <Fid> --reason …` is the machine
  form of the one-line exemption, and the green half is mirrored automatically at
  `step done`. `lzy evidence list` renders the per-F manifest (halves, surfaces,
  rebind chain). **Since baton 2 the ledger is the unified validity authority**:
  `verify`/`finish` judge evidence freshness from the ledger's green node for the
  goal.json-recorded generation (orphan ghosts never count as current), and an
  unreadable ledger or a fingerprint-form record with no ledger node fails closed
  (recovery = re-record via `step done`). "Authority" here means validity
  judgments only: the ledger is the single source those verdicts read from, while
  it still records without adjudicating — a MATCH/MISMATCH verdict is a judgment
  about comparator claims, never a fact the ledger invents; the comparator's
  pairing/existence check reads `lzy evidence list` as its first source, and
  assertion-vs-evidence matching is still judged per pair by qa-executor,
  unchanged.
- **Live-surface ordering**: when an F-item's evidence surface is an expensive,
  flaky live run (UI test, paired device, real session), iterate the test
  harness to stability BEFORE banking any green half — capture all greens in
  one final batch after the harness freezes. A test-only commit after greens
  are banked invalidates every one of them (the composite fingerprint is
  tree-wide), and re-capturing live waves is the costliest way to pay for
  that. Preflight the environment before a formal capture; failures attributed
  to infrastructure (mark `INFRA-FAIL:` in the attempt note) do not retire an
  approach — only assertion failures do.
- **Mechanical $0 checks first (成本两件套)**: exhaust zero-cost mechanical
  verification before any semantic/model-judged check — CLI stdout, file
  existence and content assertions, `grep`/`diff`. Never spend a model call on
  a question a command can answer; semantic judgment comes after, on the
  residue.
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

Passes only when every step is done, every F item's evidence fingerprint is fresh
against the current subject set, AND every {host}∪subjects tree is clean
(dirty/missing/git-error all reject; no bypass flag) — and, for HEAVY goals, a
current MATCH comparator attestation (see §4). This is the only valid
"done". 不做完不停 — if finish rejects, keep working, never declare victory.
On success `finish` also writes the **final attestation**
`.lazyzcode/attestations/<attemptId>.json` — the LOOP_COMPLETE machine proof
(planHash, per-root head trees, composite fingerprint, ledger-anchored evidence
refs, comparator record, report sha256); it survives `reset` as history.
**Close-out trailer (text half, L0):** when the close-out commit lands after
`finish`, append `Lzy-Attestation: <full sha256 of the attestation file>` to
its message — a tamper-evident pointer from the machine proof into commit
history (machine-side doctor verification is deliberately deferred; this is
protocol convention, not an enforcement gate).

**Evidence comparison (comparator, HEAVY mandatory).** Existence and freshness are the CLI's
gates; relevance is not checked by any CLI — so before `finish`, dispatch `qa-executor` in
comparator mode over every F item's assertion–evidence pair. The comparator also checks
dual-evidence halves: every F item shows red + green or a one-line exemption, and a missing
half without an exemption is a `不匹配`. A `不匹配` verdict means the
evidence does not demonstrate the claim: re-capture on the right surface, or if the F item
itself was wrong, amend the plan honestly — then re-run. LIGHT goals: do the comparison
yourself as a self-check (weaker — you authored the evidence; know its blind spot).
**Machine attestation (0.0.9 baton 2):** transcribe the comparator verdicts into a minimal
JSON
(`{"slug", "items": [{"fid", "verdict": "MATCH|MISMATCH", "evidenceNodeId"|"generation",
"basis"}], "note"?}` — items must cover every F item, and **every item must bind evidence**
(`evidenceNodeId` = the green node id shown by `lzy evidence list`, or `generation` = its
capture generation): a comparison that is not anchored to an already-recorded green half is
rejected at record time, so capture (or rebind) evidence first, then compare) and record it
with
`lzy attest comparator --file <verdicts.json>`. For HEAVY goals `finish` machine-enforces a
current MATCH attestation whose fingerprint matches the tree (missing / MISMATCH / stale all
reject, no bypass); LIGHT goals may skip the recording.

**Adversarial coverage.** HEAVY finishes touching command, parse, or state-merge surfaces
self-check against `docs/research-adversarial-checklist.md` — the standing nine-class sheet:
probe what applies, record why the rest are excluded.

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

- The host workspace must be a **git repository**: evidence binds git trees, so
  `register` hard-rejects a non-git host with recovery guidance (`git init` +
  a first commit; ADR-0019, no bypass), and `status`/`doctor` carry standing
  warnings if the host's git goes missing mid-goal.

- The session stays rooted at the host. Run `lzy` only from the host root —
  prefix commands with `cd <host-root> &&` (Bash cwd persists across calls,
  and the engine's cwd reset is not guaranteed on failure/timeout paths).
- Inside code repos use absolute paths or `git -C <repo>` — never `cd` away
  and forget the way back.
- Directory resolution is strict-cwd (no walk-up): a missing-goal error prints
  the exact path it checked — return to the host root; don't expect a flag to
  relax it.
- Take F-item evidence **after the last code-repo commit**; a sibling repo only
  enters the freshness gate once it is a declared subject — put it in the plan
  header or `lzy loop subject add <path>` (any set change invalidates all
  captured F evidence; re-capture before finish). If a subject repo gains
  commits before `finish`, re-verify and re-record. Never `register` from a
  non-host root.
- Parallel workers on a cross-repo goal: claim steps (`lzy loop claim`) and
  edit code in your own worktrees, but all `lzy` traffic — claim, step done,
  status — stays at the host root (see "Parallel dispatch" in §3 · Execute;
  multi-tree slot isolation is covered in "Same-workspace multi-session").
- A worktree root works as a subject too (`lzy loop subject add <worktree-path>`):
  per-root dirt and HEAD are tracked independently (its uncommitted work shows as
  DIRTY on that root only). An undeclared worktree stays invisible to the gate —
  declaring it is the discipline.

## Continuation (how the Stop hook drives you)

- The plugin's Stop hook requests engine continuation while the goal is
  unfinished — at most **2× per session** (a persistent per-session counter;
  1 of the engine's shared 3-continue pool stays reserved for background
  notifications). Keep the four continuation surfaces distinct — **engine**:
  3 continues per turn, counter resets on every new prompt; **lzy Stop hook**:
  self-limited to 2 per session, persistent, never resets; **unbound scheduler
  wake** (App-UI automation): a fresh session each fire with fresh budgets —
  unlimited across fires, never a license to pad; **idle run** (host OffPeak
  idle task): the engine's first-class off-peak lane, binding the origin
  session (engine ≤0.16.5 bound via a queryId-suffix marker, retired in
  0.16.9 in favor of an explicit `boundSessionId` plus a binding-check RPC
  `automationCheckTaskBinding` → `{bound}`; turnNumber continues across
  wakes) with
  **zero pool exemption** — engine 3/turn and hook 2/session both count, and
  per-session counters persist with the session. Conversation history is
  unreliable at an idle run's executor perception (probe offpeak-probe
  2026-09-14: the designated history-only nonce was never quoted) — never rely
  on in-chat references; all handoff state must live on disk. A goal loop
  resumed by an idle run follows the Unattended red-line protocol in full.
- **Pull-back eligibility (claim-gated, 0.1.1, ADR-0004 amendment 4).** Only a
  session that has **claimed** the goal (an invocational trigger such as
  「zw 继续」 writes `claimedAt`) is subject to pull-back; an empty claim set
  means **nobody is pullable** — bystander sessions (Q&A at the host root,
  never claimed) are structurally exempt, and a goal whose executing session
  never claimed simply releases at its first Stop (that is decision semantics,
  not a malfunction — claim first). To opt out explicitly, send
  **「zw standdown」**: the session writes a standdown flag and the Stop hook
  releases it read-only (pull-back budget untouched, no state writes) until it
  rejoins (a claiming trigger clears the flag) or the loop is reset.
- When you feel the `[lzy]` nudge: continue the **current step**. Do not replan,
  do not summarize, do not ask questions — work.
- **Progress signal / no-op detection (state set) — one concept, two enforcement
  points.** The **progress signal state set** is {done-step count, per-subject
  HEAD tree set (a commit moves it), evidence-ledger green-node count, handoff
  and salvage registrations}. Any component advancing counts as movement; a
  **dirty tree is deliberately not a signal** — writing without committing must
  not extend the leash. Both enforcement points read this same set, but they are
  **not equally strong**, and the difference matters when you cite it:
  **L1 (machine, full set)** — `lzy loop drive`'s segment loop holds the whole
  set across segments and winds down on two consecutive unmoving segments
  (`core/progress.js` is the single source). **L0-plus-partial (Stop hook)** —
  the Stop hook's pull-back check judges by the done count alone today; the rule
  below is what binds it, and it is protocol, not a machine gate. So: every
  pull-back must move the state set. A `step done` rebinding whose fingerprint
  did not change counts as a no-op; two consecutive handoff registrations with
  zero state-set movement are likewise violations (a handoff is a graceful
  hand-back per ADR-0009, not a free bail-out channel). Zero movement means you
  are padding: stop working the loop and close cleanly.
- Budget exhausted with steps remaining? State plainly which steps remain and
  stop cleanly; the next session's SessionStart hook re-injects the loop state.
- **Risk suspension (SUSPENDED_RISK, 0.1.0).** If risk_class rises to HIGH+
  mid-flight (blast radius grew, a new subject repo entered, credentials or a
  destructive surface got involved), suspend instead of pushing on: write the
  handoff snapshot, end the turn, resume only after a human nod. Suspending on
  risk does not burn the pull-back budget and is not a failure — pushing a
  HIGH-risk change unattended is. Since 0.2.0 this is machine-backed: record
  the upgrade with `lzy loop risk <level>` (ADR-0020) and the drive-entry gate
  keeps HIGH+/RESTRICTED out of unattended lanes.
- **Tool fire-loop escape (misfire attractor):** if the same tool fires 3+ times
  in a row with failures/timeouts, or with queries whose results are unrelated
  to the step (wrong index, sibling-repo symbols) — stop calling it, even if
  you already declared it "disabled" (self-commands do not survive long
  context). Switch tools or, when the context is already degraded: write a
  handoff snapshot per the 7-field template below, run
  `lzy loop handoff --snapshot <that file>`, then end the turn and ask the user
  to open a fresh context with `zw 继续`. Never pad with placeholder queries to
  "harmlessly" keep calling — that is how a 2-call misfire becomes a 79-call
  spiral. If the tripwire nudge (`[lzy]` same-tool failure streak) arrives, it
  means the hook observed this pattern before you did: obey it immediately.
- **Handoff snapshot template (lint-enforced).** `lzy loop handoff` rejects a
  snapshot missing any of the seven sections below — the Chinese headings are
  contract literals, byte-identical to the CLI's lint list; each section needs
  at least one non-empty line (a bare heading is an empty handoff):

  ```markdown
  # 交接快照
  ## 剩余步骤
  <pending step IDs + one-line titles>
  ## 下一步动作
  <the exact next action, executable without re-reading the whole plan>
  ## 目标与进度
  <slug · done/total · the step in progress>
  ## 脏树清单
  <verbatim `git status --porcelain` output; write （无） if the tree is clean>
  ## tree hash
  <output of git rev-parse "HEAD^{tree}" at handoff time>
  ## 风险与坑
  <gotchas a fresh claimer would otherwise rediscover the hard way>
  ## 复归指令
  <the exact resume command/prompt — e.g. zw 继续>
  ```

  Multi-subject goals: the two headings above are CLI lint literals and must stay
  byte-identical — under 脏树清单 and tree hash, list each {host}∪subjects root's
  status and HEAD tree hash separately (one block per root), so the receiver
  reconciles every tree, not just the host.

- **Dirty-tree inheritance:** the snapshot's 脏树清单 binds the receiver. A
  claiming session reconciles against that list FIRST; `checkout` / `reset`
  before every entry is accounted for destroys the previous session's
  uncommitted work — that work belongs to the goal, not to the cleaner.
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
- **A turn died without reaching the server at all** (transport death:
  `connect ENETDOWN` / `ECONNRESET`-family errors — local network or proxy
  tunnel flap; the engine often mislabels these `retryable=false`)? Same
  contract: close cleanly, lose nothing, resume after the link recovers.
  `lzy doctor`'s `transport` line tallies this family separately — never
  treat it as quota pressure.
- **A turn died mid-stream with `[1301]`** (provider content moderation
  killed the stream after generation started — input or generated text can
  trip it; the engine often shows it as `reason=unknown`)? Do NOT retry the
  same prompt: it reproduces deterministically. Close the session cleanly
  (`.lazyzcode/` lost nothing) and resume in a NEW session, or rephrase so
  the model takes a different reasoning path. `lzy doctor`'s `content` line
  tallies this family separately — not quota pressure.
- **Risk trumps quota.** HEAVY costs more calls (review gate, evidence
  capture, Stop pulls); when quota is tight, genuinely contained work may
  start LIGHT — but anything risky or vague is HEAVY regardless of quota.
  This applies only at triage; once engaged, never downgrade.
- **Before multi-session work**, run `lzy doctor`: its `rate-limit` line
  reports your account's recent 429 pressure and empirical concurrency band
  (or one-sided evidence when no coherent band exists — degradation is the
  normal path under attribution drift).
- **Repo-wiki generation shares your pool.** The desktop app's repo-wiki
  feature runs as a background lane on the same account model quota — while a
  large repo wiki is generating, avoid stacking dense unattended wake-ups on
  top of it.
- **Idle run is the official off-peak lane.** Host-granted OffPeak idle tasks
  run server-side off-peak, and the engine docs self-describe them as not
  consuming plan quota on the scheduling/concurrency side (start time not
  guaranteed). The provider **model pool** is a different axis: the repo-wiki
  sharing caveat above still applies, and a dying idle turn follows the same
  close-clean contract as any other death.

## Unattended mode (scheduled wake-ups)

A host-side automation (the engine's scheduler — cron-style, persistent, per
workspace) can wake a fresh session on a schedule to drive an open goal loop.
The wake prompt is plain text; say **`zw 继续`** so the stratified trigger
fires and this skill's bootstrap loads. `lzy doctor`'s `schedule` line
suggests the off-peak window measured from your own 429 data, cross-checked
against declared pricing peaks (a hand-maintained table) with a safe-window
note.

Since 0.2.4 `lzy loop drive --workers N` (sugar `--fast` ≡ 2) runs N worker chains per wave on sibling worktrees — env-auth required, H3R wake switches must be off, and the measured cost is turns ≈2× with small tasks possibly slowing down; waves merge back with a barrier re-anchor of all evidenced F items, and a merge conflict winds down cleanly leaving branches for a human. Since 0.2.0 a wake-up has an **in-wake execution channel**: `lzy loop drive`
(ADR-0020) spawns headless engine segments inside one wake and pushes the
executing goal segment by segment — risk/lease/budget gates are checked
between segments (HIGH+ risk never enters; a lease keeps a single runtime
holder; each drive gets a fresh wall-clock cap; the points axis is an account-level 5h rolling-waterline threshold (not a per-run counter — the reading being unavailable means the gate simply does not fire), and every segment's
lzy writes carry the run's fence token so a taken-over run fails closed on
write instead of corrupting state. Wind-down is always clean and enumerated:
`done`, wall clock exhausted, points budget exhausted, segments exhausted,
two consecutive zero-progress segments (stuck), the step gate stopping at a
high-risk step (`h3r`), or a high-risk command denied at the tool boundary
(`PreToolUse`). Every non-done wind-down
authors the 7-field handoff snapshot itself and registers the handoff marker,
so the next wake-up (or a human `zw 继续`) resumes from disk. Exit code 0 =
done or clean wind-down; 1 = gate reject or segment failure. The host
automation remains the **only scheduled wake face** — drive is what a wake
runs once awake (and what you can run yourself in an unattended window).
`lzy doctor`'s `drive` line reports channel availability (credentials, lease,
budget, current goal eligibility).

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
6. **Never create wake automations in-session.** The engine auto-binds an
   automation created inside a session to that very session, and one session
   can own at most one automation (ADR-0010 probe-proven) — unbound wakes are
   created only from the App's automation UI (rebuild recipe: plan-v2 report
   §6).
7. **Stop the wake automation when the goal ends.** After `lzy loop finish` or
   `abandon`, disable the wake automation feeding this workspace (App UI);
   the CLI prints a reminder line. An empty-slot wake is pure idle burn —
   mounting is ON, clearing is OFF (ADR-0010 semantics), and both directions
   belong to the user.

Suggested automation prompt (host-side configuration, ≥1h interval):

```
zw 继续（无人值守：只推进 executing 目标；无目标或 planning 态则干净退出并说明；不做完不停）
```

## Red lines

Enforcement levels (0.1.0): **L0** = protocol text (this skill — conventions,
not machine law); **L1** = CLI machine gates (lzy enforces, no bypass flag);
**L2** = trusted host events (engine-injected, the model cannot fake them);
**L3** = external effects beyond lzy's reach. Never describe an L0 convention
as a machine gate — a rule the model can only promise is L0, and saying
otherwise is a lie about who enforces it.

**High-risk steps (H3R).** The convention that a high-risk step (credential
handling, irreversible deletion, force-push, publish) gets a human look before
it runs is **still L0** — this skill's text. Three **dormant prototypes** exist
in the unattended lane only, and while asleep they enforce nothing:

- **Segment-start gate** (`core/drive.js` + `core/h3r.js`): checks the next
  pending step's text at each segment's start and winds down cleanly instead of
  spawning (cause `h3r`). Awake only when `LZY_ABLATE_H3R_GATE` is exactly
  `"1"` — the *inverse* of the `LZY_ABLATE_*` family.
- **One-step-per-segment** (`lzy step done` + a run-unique segment id): when
  drive injects `LZY_SEGMENT_ID` (only while `LZY_ABLATE_H3R_ONESTEP` is `"1"`),
  a second `step done` inside the same segment is refused (re-recording the
  *same* step id — the evidence-rebind path — passes; only a different step is
  the second one) — this is what gives
  the segment-start gate a boundary to see at all (measured: 15 of 24 trials
  once ran a whole plan in one segment, so the check never fired).
- **Command-layer gate** (`plugin/hooks/h3r-pretool.js`, PreToolUse/Bash): when
  awake (`LZY_ABLATE_H3R_PRETOOL` is `"1"`) **and** the drive-injected segment
  id is present (shape-validated `<int>:seg-<int>` — a stray residual export
  degrades to no gate), it denies Bash commands whose text matches the H3R word
  list and writes a hit marker that drive consumes for a clean wind-down
  (7-field snapshot, exit 0). Interactive sessions carry no drive-injected
  segment id — exempt given env hygiene, and they are the recovery path. It is **inert without the
  one-step switch** (no segment id ⇒ nothing to gate).

Do not call any of them a machine gate while dormant (ADR-0022). Two honest
limits: the word list is substring matching, not a command parser (it can be
reworded around, and it excludes the repo's own `lzy`/`git commit` bookkeeping
so step titles stay recordable); and a hook crash or timeout surfaces to the
model as a recoverable tool error on the engine side (never a silent pass;
whether the command itself ran is not guaranteed either way — ADR-0022's
failure semantics, corrected by the v023 fix round).

1. **[L0+L1]** Never write the user's `config.json`; plugin enabling flows only
   through the engine's official CLI (`lzy install` handles this — the CLI's
   own write face stays on the registry/cache, not session-driven).
2. **[L1]** Evidence is bound to the composite fingerprint (per-subject tree
   hashes; legacy evidence stays single-tree). Tests alone ≠ evidence. HEAVY
   finish additionally enforces dual-evidence presence (INV-09: a missing red
   half is not repairable by more green — recover via `lzy evidence red` /
   `waive-red`) and harness match (INV-08: red/green recorded with `--harness`
   must name the same procedure).
   **INV-09 scope — be precise about what the machine checks (ADJ-47):**
   *presence* is the gate's criterion. A red (or waived) half paired to the
   anchored green passes; a red half recorded in an earlier generation may
   stay paired to a later green (re-pairing on rebind is ADR-0014 semantics),
   so "the halves are the same assertion in the before/after states" is **not**
   machine-proven by INV-09 alone. Same-source proof becomes machine-checked
   only when both halves declare `--harness` (then INV-08 compares the
   hashes); otherwise it rests on the protocol and your declarations. Declare
   `--harness` on both halves whenever that pairing claim is load-bearing —
   it converts a protocol promise into a checked one.
3. **[L0]** `.lazyzcode/` is the loop's single source of truth — if speech and
   state disagree, trust the state, then fix the speech.
4. **[L0]** Never `reset`/`abandon` a goal slot another session is actively
   running — one writer per tree; hitting an occupied slot means move to a
   worktree (outside the host tree), not clear the slot.

**Approvals bind immutable hashes (INV-05).** Plan adoption already binds the
review to planHash and the snapshot (L1, machine-true). Since 0.1.1 the human
nod is machine law too — the **UPS exact-hash human gate (L2, ADR-0018)**:
adoption requires an approval record that only the UserPromptSubmit hook can
write, on a genuine user message containing 「批准 <planHash 前 8 位>」.
Never run commands or hand-write files to fake an approval (the CLI has no
approve command by design — a model-run approval is the fake human gate), and
never dodge the code by editing the plan file — the hash changes, the approval
is void, and re-adoption issues a fresh code. **Audit ring:** a material
change after review invalidates the review —
plan re-adoption requires a fresh PASS review (L1 for HEAVY; mid-execution
plan changes go through `lzy loop supersede`, which opens a new attempt and
re-runs every adoption gate, human gate included), and the HEAVY finish
comparator is the terminal audit ring before LOOP_COMPLETE.

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
| `lzy loop register <slug> --title … [--tier heavy]` | create goal (planning; HEAVY adoption without PASS review is machine-rejected; non-git host hard-rejected with git-init guidance, ADR-0019) |
| `lzy loop supersede <plan> [--review …]` | forward-only plan change mid-execution (0.1.0): old attempt → superseded, opens attempt+1, full adoption gates re-run |
| `lzy loop attempts` | attempt lineage read face (attempt.json ∪ central-ledger derivation; read-only) |
| `lzy loop plan <file> [--force]` | adopt checklist (rejects TBD; snapshots the plan + binds planHash; **human gate ADR-0018**: 1st run rejects with a short code → relay 「批准 <短码>」 verbatim, re-run after the user's reply) |
| `lzy loop start` | planning → executing; prints the measured 并发纪律 advisory |
| `lzy loop subject add/remove <path> · subject list` | declare/remove sibling repo roots (executing-only; any set change invalidates all F evidence) |
| `lzy loop tier heavy` | tier upgrade, one-way (machine gate is adoption-time; ADR-0013) |
| `lzy loop risk <level>` | risk_class upgrade, one-way (low|med|high|restricted; drive-entry gate rejects HIGH+; ADR-0020) |
| `lzy loop lease acquire/heartbeat/release/reclaim` | run-level lease: minutes-scale mutual exclusion, fence token for write-path declaration; `reclaim` = zombie-lease exit after a SIGKILLed drive (ADR-0020) |
| `lzy loop budget init/spend/remaining` | drive budget: wall-clock + points double cap, over-cap reject = clean wind-down signal (ADR-0020) |
| `lzy loop drive [--wall-ms N] [--max-segments N] [--mode m]` | in-wake unattended execution channel (0.2.0, ADR-0020): headless segments inside one wake, gates between segments, wind-down authors the handoff snapshot itself; exit 0 = done or clean wind-down, 1 = gate reject/segment failure |
| `lzy loop drive --workers N` · `--fast` | multi-worker wave orchestration (0.2.4, keep-fast decision): N≥2 runs N worker chains on sibling worktrees (worktree-as-subject, claim-based step split, wave-terminal merge + barrier re-anchor of all evidenced F items); `--fast` ≡ `--workers 2`; wave = segment, wall clock accrues the per-wave max across workers but accumulates as a sum over waves (two waves of 900ms/700ms cost 1800ms, not 1600ms and not 3200ms); HEAVY goals are refused at entry (ADR-0026), env-auth required and H3R switches off; measured cost: turns ≈2× — disclose before use (docs/reviews/2026-fast-exp-report.md) |
| `lzy loop status` | progress, next step, evidence freshness |
| `lzy step done <ID> [--note] [--evidence] [--evidence-file …]` | complete a step (F requires evidence; files bound by sha256) |
| `lzy loop verify` | evidence freshness report (exit 1 when stale/unbound evidence **or no goal exists**) |
| `lzy evidence red <Fid> · waive-red <Fid> --reason · list` | dual-evidence ledger: record the red half (own surface), the one-line exemption's machine form, and the per-F manifest view |
| `lzy dag dependents <id|surface>` | "what depends on X" against the central invalidation DAG (read-only) |
| `lzy dag stale` | invalidation preview: which evidence nodes are stale against the current composite fingerprint (display-only; gates still judge by direct fingerprint comparison) |
| `lzy attest comparator --file <json>` | record comparator verdicts (schema `{slug, items:[{fid, verdict, evidenceNodeId\|generation, basis}], note?}` — every item must bind a recorded green half; HEAVY finish enforces current MATCH) |
| `lzy loop finish` | final gate: all done + fresh evidence + all {host}∪subjects trees clean (+ HEAVY: MATCH attestation); auto-archives the evidence bundle and writes the final attestation |
| `lzy loop export` | re-export the evidence bundle to `.lazyzcode/evidence/<slug>.report.md` |
| `lzy loop abandon` / `lzy loop reset` | give up / clear state |
| 「zw standdown」 (UserPromptSubmit phrase, not a CLI command) | session-level opt-out: this session stops being pulled (read-only release, budget untouched) until a claiming trigger like 「zw 继续」 clears the flag or the goal is reset (ADR-0009 revision) |
| `lzy doctor` | deep local diagnostics incl. rate-limit pressure (zero telemetry) |
