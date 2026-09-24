# Changelog

All notable changes to LazyZCode. Format inspired by Keep a Changelog;
versioning is SemVer.

## [Unreleased]

### Added

- **Requirement contracts** (0.3.0 M1, goal `v030-m1`; ADR-0024 revising ADR-0018):
  register a goal against an immutable requirement contract (`lzy loop register
  --contract <file>`; `contractHash` = sha256 of the file bytes). Plan adoption for
  contract-bound goals runs the five-check contract gate — disk-hash drift, effective
  authorization, acceptance coverage (`accepts:` refs on F items), subjects⊆scope,
  recipe-hash match — and the UPS approval phrase binds the **contract** short code;
  in-contract replans (`supersede`) re-run the review gate but no longer re-approve.
  New trusted UPS phrase 「撤回 <短码>」 appends a withdrawal record; the gate refuses
  the next gated action and already-occurred external effects stay honestly recorded.
  Records live in `.lazyzcode/authorizations/` (append-only, reset-surviving,
  fail-closed on a corrupt record); CLI read faces `lzy contract show` / `lzy
  contract auth`; doctor `contract` row. Goals without a contract keep the legacy
  planHash human gate byte-identical.
- **Project manifest** (0.3.0 M1): versioned `lzy.project.json` with six capability
  classes (prepare/start/check/observe/cleanup/delivery); recipes carry explicit argv
  arrays (shell strings rejected), timeouts, env-name lists (values injected at
  runtime), and root-confined write paths. `lzy project check` (validation +
  entry-present readiness) and `lzy project discover` (read-only missing list);
  doctor `project` row. A contract's `recipe:` field binds the manifest content hash.
- **Verification receipts** (0.3.0 M2, goal `v030-m2`; plan §4.1): `lzy verify run
  <checkId>` executes a manifest check recipe under the controlled executor (argv
  array, `shell:false`, SIGTERM timeout kill, env-name whitelist) and records a
  checksum-protected receipt — runId/checkId/acceptance ids/contract hash/candidate
  identity (HEAD + composite fingerprint)/recipe & manifest hash/input snapshot/env
  fingerprint/start-end/exit/artifact sha256 — under `.lazyzcode/verify/` (append-only,
  reset-surviving, fail-closed on tamper); raw output is stored separately from
  summaries (`<slug>/raw/<runId>.log`). Receipts are produced by real execution only —
  edited text or fingerprints never constitute a new run.
- **Scope-tier evidence reuse** (0.3.0 M2; ADR-0025): check recipes may declare
  `inputPaths` (validated like writePaths; files or directories, directories fully
  enumerated so unknown new files count as change). `lzy verify qualify <checkId>`
  runs the adversarial qualification live (injects a change into every declared input
  and requires detection plus byte-identical restore); `lzy verify reuse <checkId>
  --of <runId>` grants reuse only when all four questions pass (non-empty inputs,
  qualification on record for the same checkId+manifestHash, input snapshot unchanged,
  manifest hash and env fingerprint unchanged) — otherwise it conservatively falls
  back with named reasons. Reuse receipts append an applicability judgment and never
  rewrite the base receipt's original time and observations.
- **Integration verification** (0.3.0 M2; plan §4.3): the drive workers-wave barrier
  no longer re-anchors F evidence ("wave-barrier rebind" path retired — re-anchor is
  not re-verification). When the goal root has a manifest with check recipes, the
  barrier executes them for real on the merged candidate tree and records receipts;
  a failed integration check winds down unclean (blocks delivery A); without a
  manifest nothing auto-refreshes — stale evidence stays stale until genuinely
  re-verified. Zero-change waves skip the re-run (tree-change gate).
- **CI identity binding** (0.3.0 M2): `lzy verify ci [--sha <sha>] [--repo o/n]`
  queries GitHub check-runs read-only via `gh api` (zero shell, 30s timeout, no push,
  no repo-setting writes) and records a receipt binding {repo, sha, checks, queriedAt}.
  A recorded sha that differs from the current HEAD is displayed as 非现行 (not
  current); gh absent/offline yields an explicit blocked message with recovery hints
  and a nonzero exit — never a silent pass. Honors `LZY_GH_BIN` for injection seams.
- **Migration preview** (0.3.0 M1): `lzy migrate preview <root>` read-only scan of
  legacy goal-loop records — per-task contract drafts with `authorization: NONE`,
  endpoint draft, acceptance drafts from snapshot F assertions, and four
  privilege-escalation prohibitions (M0 §9 mapping). Active goals refuse; corrupt
  records surface as warnings; zero write-back. Full migration machinery is M5.
- **Knowledge routing** (0.3.0 M1): the zw skill splits into a ≤8 KiB resident entry
  plus eight per-phase recipes (`plugin/skills/zw/recipes/`); root AGENTS.md slims to
  ≤12 KiB by relocating history (`docs/history.md`), the decision table
  (`docs/decisions.md`), and the glossary (root `CONTEXT.md`). Nothing deleted —
  every rule stays reachable entry → recipe → cited ADR.

## [0.2.4] - 2026-09-23

### Added

- **`lzy loop drive --workers N` / `--fast`** (goal `v024-fast-scheduler#N1`): multi-worker
  wave orchestration on sibling worktrees — claim-based step split, wave-terminal merge with
  barrier re-anchor of all evidenced F items, `merge-conflict` clean wind-down cause, startup
  reclaim keeping unmerged branches, env-auth + H3R-wake-off entry preconditions, wall clock
  accrues max per wave; `--fast` ≡ `--workers 2`. Measured turns ≈2× — see
  `docs/reviews/2026-fast-exp-report.md`. Also: doctor `drive` row reports workers leftovers;
  contract group (12 cases) + real-engine e2e (`scripts/headless/e2e-drive-workers.mjs`).
- **Findings ledger** (goal `v024-debt-bundle#N2`): machine-readable account of
  dual-review dispositions at `docs/reviews/findings-ledger.jsonl` (schemaVersion 1;
  all 41 findings of the 0.2.3 five-round dual review backfilled — later batches must
  extend the pinned row count explicitly), with `scripts/findings-lint.mjs` schema
  validation and a contract test.
- **Attestation trailer verification** (debt-3 machine half, `v024-debt-bundle#N3`):
  `lzy doctor` gains an `attest-trailer` row — git-history `Lzy-Attestation:` trailers
  are compared one-by-one against content sha256 of files in `.lazyzcode/attestations/`
  (four-state verdict: dangling warn naming each / skip / ok no-trailers / ok all-match);
  warn-only, never flips the exit code.
- **Provenance-ready assertion** (debt-5, `v024-debt-bundle#N4`): decision of 2026-09-23
  keeps the maintainer-2FA publish channel (no provenance artifacts); the new
  `scripts/provenance-ready.mjs` mechanically asserts the migration-ready metadata triad
  (normalized repository URL, name, version triad) and the release checklist gains an
  explicit provenance-boundary step.

### Fixed

- **0.2.4 dual-review fix round** (goal `v024-fix-round`; 39 findings of the v024
  five-round dual review, `docs/reviews/2026-09-23-v024-dual-review.md`, all closed):
  the workers lane's wind-down phase is now integrity-preserving — subjects are
  unlinked before their worktrees are deleted (a clean non-done wind-down no longer
  leaves dangling roots that make every later `finish` hard-reject), dirty worker
  worktrees survive with their branches and are named in the handoff snapshot, and
  run-directory deletion is authorised solely by the owner sentinel the run writes;
  the wave barrier re-anchors only when the subject head-tree set actually moved and
  passes the previous green's `--harness` through (INV-08 had been silently vacuous
  on every rebound green, and the mechanical re-anchor made the stuck wind-down
  unreachable); HEAVY goals are refused at the workers entry instead of dead-ending
  at `finish`; step claims this run strands are released and the snapshot names the
  command; wall-clock accounting moved after the merge so a budget-exhausted
  wind-down keeps the wave's output; the assembly phase, worker-log archive and
  cleanup phase are all guarded; `--fast=false` no longer means workers 2; the H3R
  parser's four lexical gaps (segment truncation, bookkeeping-prefix newline, quote
  parity, mid-word quotes) are closed; `lzy evidence list` and the doctor
  `attest-trailer`/workers rows report what the machines actually check. See
  ADR-0026.
- **INV-08 harness freeze narrowed to the current red half** (goal `v024-debt-bundle`
  follow-up, commit 125bbdd; ADJ-16 of the v024 dual review — this user-visible
  main-path behaviour fix had no release note): on an append-only ledger the
  first-recorded red pins the gate forever if the recording procedure changes, which
  makes "re-record both halves with the same program" a dead recovery path (the
  warning pointed at a command that could not clear it). The freeze now judges only
  the latest current red of the pairing; a genuinely mismatched current red still
  rejects.
- **H3R command-layer gate parser root-fix** (ADR-0022 pre-registered promotion trigger,
  `v024-debt-bundle#N1`): substring matching upgraded to segment + token-sequence
  matching — two-word false positives (`ssh keys`, `npm publish-dry`) cleaned,
  quote/backslash hiding and escape-space bypasses sealed, parse ambiguity
  (unbalanced quotes/parens/backticks) fails closed to deny. `matched` keeps its shape
  and a `detail` field is added; dormant semantics unchanged field-for-field.

## [0.2.3] - 2026-09-23

### Added

- **H3R enforcement-point migration** (0.2.3 goal `v023-h3r-enforcement`):
  the dormant high-risk-step prototype gains two machine faces in the
  unattended lane — one-step-per-segment (`LZY_SEGMENT_ID`, shape-validated
  `<int>:seg-<int>`, a second distinct `step done` in one segment is refused;
  same-step evidence rebinds pass) and a command-layer gate
  (`plugin/hooks/h3r-pretool.js`, PreToolUse/Bash, awake only with
  `LZY_ABLATE_H3R_PRETOOL=1`) that denies word-list hits and writes the hit
  marker drive consumes for a clean wind-down. Default behavior stays
  byte-identical to 0.2.2.
- **Fix-round hardening** (0.2.3 goal `v023-fix-round`): drive's wind-down
  channel is non-throwing (the every-cause-authors-a-snapshot invariant holds
  under corrupt state), heartbeat failures split by family (storage I/O no
  longer mislabeled as takeover; snapshot + lease-reclaim guidance),
  segment-boundary recovery guidance dispatches by cause (RESTRICTED's only
  exit is narrow-and-re-register), reset/start sweep the segment markers, the
  word list closes the `push -f` / `id_ed25519` / whitespace-evasion gaps,
  and the ablation instruments count events echo-free (see the h3r report
  errata: deny 13→4, one-step refusals 1199→11).

### Notes

- The sixth hook (`h3r-pretool.js`) is **dormant by default** and costs one
  `run-hook` + node spawn per Bash tool call in every session (zero behavior
  impact otherwise). Accounted here per the v023 dual review (ADJ-27); its
  removal or default wake state is a maintainer decision after the experiment
  review (ADR-0022).

## [0.2.2] - 2026-09-22

### Added

- **H3R high-risk-step gate prototype** (ADR-0022, goal `v022-bat2-h3r`): a
  step-level human gate for unattended runs, shipped **dormant**. `core/h3r.js`
  holds the judgment surface and `core/drive.js` checks it at the top of each
  segment: if the next pending step's text matches the risk word list (or carries
  an explicit `[risk:high]` marker), drive winds down cleanly before spawning —
  no engine call, no tokens — and writes the 7-field handoff snapshot carrying the
  recovery path. **Off unless `LZY_ABLATE_H3R_GATE` is exactly `"1"`, and that
  switch WAKES the prototype rather than ablating it** — the inverse of the
  `LZY_ABLATE_*` family's semantics, which is why ADR-0022 quotes the operative
  pre-registration sentence. Default behavior is byte-identical to 0.2.1.
- **Ablation trials can run through `lzy loop drive`** (`scripts/ablation/h3r-trial.mjs`,
  `h3r-batch.mjs`): the harness had never exercised drive — every earlier batch
  spawned the engine directly, while the H3R gate lives only in drive's segment
  loop, so a drive-based base had to be built. Adds the `H3R-A`/`H3R-B`/`H3R-C` arm
  variants, `extractH3rMetrics` (drive swallows the segment's `--json` summary, so
  turns and usage are aggregated from the archived rollout instead) and `aggregateH3r`.
- **Lock contention is observable** (goal `v022-bat1-instrument`): `withLock` now
  records acquisitions, waits, wait-time total/max and timeouts into
  `loop/metrics.json`, and a new `lzy doctor` `lock` row surfaces them. A probe
  measured the real critical-section cost across this repo and three dogfood repos
  (worst case 58.9 ms against the 5 s wait window — 0.012× of it).
- **`docs/adr/0023`**: the multi-provider pricing convention — units stated in yuan
  per million tokens, an enumerated table with sources, and the waterline SQL
  generated from that table.

### Fixed

- **drive judged progress by a done-step jump alone**: a long step with commits and
  evidence but no `step done` still read as zero progress and got wound down as
  `stuck` after two segments. It now judges by the documented progress-signal state
  set (done steps ∪ subject head trees ∪ evidence-ledger green nodes ∪
  handoff/salvage registrations), implemented in `core/progress.js`. Dirty trees
  are deliberately not a signal.
- **The waterline watch was blind to non-GLM providers**: `core/cost.js`'s rolling
  SQL recognized only two model names and counted everything else as zero, so on a
  DeepSeek session both the 1600-point warning line and drive's 400-point budget
  read as idle. The table is now enumerated with per-unit pricing and the SQL is
  generated from it; the stale copy in `plugin/hooks/stop.js` was fixed alongside.
- **The ablation harness's spawn had no wall-clock hard cap**: ADJ-38's fix had
  reached `core/headless.js` but not the ablation pipeline; pipe `destroy`, exit
  settlement and `durationMs` reporting now match core's.
- The handoff-snapshot directory is enumerated and exempted from the doctor's scar
  patrol, and six stale claims the code had outgrown were retired.

### Notes

- The H3R experiment's result is in `docs/reviews/2026-h3r-gate-report.md` and the
  ablation ledger (`docs/ablation.md` #31). Headline: **the gate's mechanics work
  but its enforcement point does not.** Verified working — a 2-second,
  zero-engine-call stop with a clean 7-field snapshot and no bypass attempt when the
  risky step is reachable at a segment boundary. Verified not working in the field —
  15 of 24 grid trials finished the entire plan inside a single segment (despite the
  segment prompt saying one step per segment), so a per-segment check gets no chance
  to fire. Results are input to the machine-form decision; nothing is promoted or
  downgraded automatically.

## [0.2.1] - 2026-09-21

### Added

- **Engine surface contract** (ADR-0021, goal v021-engine-surface): all five engine
  CLI touch points now have contract tests (`test/engine-surface.contract.test.js`,
  a fake engine that plays both generations), and the engine-output boundary
  normalizes at a single point (`core/engine.js normalizePluginList`).

### Fixed

- **Five-round dual review fix round (V021-ADJ-01..92, goal v021-r5-review-fix-ablation)** —
  92 adjudicated findings (P1x10, P2x27, P3x55) across core/hooks/instrument:
  `readGoal` errno discrimination (corrupt/unreadable goal.json no longer silently
  overwritten by `register`); cross-process lock ownership token + 60s stale line
  (mutual exclusion could break twice per window); lineage ledger duplicate-`n` and
  `n:null` poisoning closed (dual-source `deriveAttempt`, write-side shape check);
  `installPathFor` dot-segment escape fixed (`..` could `rm -rf` the plugins root);
  headless wall clock is now a real hard stop (exit-based settle; measured 25x
  overrun before); drive re-checks risk/identity between segments and always winds
  down through the handoff path; zombie leases get a `lzy loop lease reclaim` exit
  (auto-reclaims when the holder pid is gone, needs `--force` when it is not — a
  SIGKILLed drive used to lock every later wake out for a full TTL); lease is
  bound to its goal. Hooks: approval negation matrix, approval write-failure
  diagnostic, injected-text sanitization, version-order node selection. Ablation
  instrument: trial CLI now runs the variant tree (D/F/G/H machine-gate ablations
  were no-ops before), human gate ablated on all arms (pipeline was unrunnable
  since 0.1.1), payload provenance, three-state verdict. See
  `docs/reviews/2026-09-21-v021-r5-dual-review.md`.
- **`plugins list --json` envelope drift — false `enabled` failure on engine 0.16.9
  hosts** (pre-existing since 0.1.2, not a 0.2.0 regression): 0.16.9 emits a bare
  array where 0.16.5 wrapped it in `{plugins:[...]}`. `findInstalledPlugin` read only
  `list.plugins`, so `lzy status` / `lzy doctor` reported `enabled ✖ 引擎未列出该插件`
  and exited 1 on hosts where the plugin was in fact installed and enabled. The
  normalizer accepts both envelopes; unrecognized shapes still land `fail` rather than
  being downgraded to a warning.
- **Human gate: silent approval failure on cwd drift** (debt E, ADR-0018 amendment):
  `approvalVerdict` returned null both when the goal was unreadable (the model had
  `cd`'d away) and when there was simply no pending adoption, so the user's 「批准 …」
  sentence produced no output at all. It now emits a diagnostic in each case — naming
  the goal's host root via a read-only, depth-bounded ancestor probe when one is found.
  Approval recording is unchanged (`approvals/` stays unwritten), and the probe is a
  hint only: it is never used for state resolution, so strict-cwd semantics (ADR-0006)
  are untouched.

## [0.2.0] - 2026-09-20

### Added

- **Runtime kernel — unattended machine foundations** (ADR-0020, 0.2.0 baton 1,
  roadmap §⑮): a durable `loop/runtime.json` ledger (attempt-lineage family
  law: payload sha256 checksum, atomic 0o600 write, fail-closed reads, monotonic
  fence-counter write guard) carries three pieces. *Run-level lease*:
  `lzy loop lease acquire|heartbeat|release` — minutes-scale mutual exclusion
  (default TTL 15 min) distinct from the 48h per-step claim; anonymous handle =
  fence token, no session identity (ADR-0009 stance). *Fencing*: every
  goal/dag/attest/handoff write entry passes a fence guard — declaring a stale
  or wrong fence (`--fence` or `LZY_RUNTIME_FENCE`) rejects the write with
  "you have been superseded, stop writing"; undeclared (interactive) calls are
  untouched, and `LZY_ABLATE_FENCE` ablates the guard. *Drive budget*:
  `lzy loop budget init|spend|remaining` — wall-clock + points double cap
  (defaults 30 min / 400 pts, env-overridable), over-cap reject is the machine
  signal to wind a drive down cleanly. Plus a machine-registered risk_class:
  `lzy loop register --risk` and `lzy loop risk <level>` (upgrade-only);
  `assertDriveEligible` is the drive-entry gate data face (HIGH rejects with
  "advance in a human session", RESTRICTED hard-blocks with a rebuild exit;
  `LZY_ABLATE_RISK_GATE` ablates) — drive wiring itself lands in 0.2.0 baton 2.
  Ledger patrol and lineage reads now see unmerged side-branch trailer commits
  (`git log --all` on three query faces): multi-worktree independent slots
  (Lane B×N) no longer blind the audit face before merge. Known boundaries —
  hook-side writes, reset, runtime-ledger's own writers, undeclared machine
  writes — are enumerated in ADR-0020. Docs: ADR-0020, ADR-0003 amendment
  (coexistence: host stays the only timed wake face; lzy still writes zero
  scheduler code), zw SKILL/guide/README updates.

- **Drive — the in-wake unattended execution channel** (ADR-0020, 0.2.0
  baton 2, roadmap §⑮ Q3): `lzy loop drive [--wall-ms N] [--max-segments N]
  [--mode m]` spawns headless engine segments inside one wake and pushes the
  executing goal segment by segment. Gate order: executing-only → risk
  (`assertDriveEligible`) → engine → credentials → run-level lease
  (one runtime holder) → budget (initialized on first use, restarted fresh per
  run under a fence-matched active lease — every drive gets its own
  wall-clock + points cap). Segments run with `LZY_RUNTIME_FENCE` injected, so
  in-segment `lzy` writes fail closed once the run is superseded; the
  wall clock is capped at `min(budget, --wall-ms)` (the host's exogenous cut
  is a first-class input); an over-cap `recordSpend` rejection routes to a
  clean wind-down rather than escaping as an error. Wind-down has five named
  causes — done, wall clock, points (rolling-5h waterline linkage), segments
  exhausted, two zero-progress segments (stuck) — and every non-done cause
  authors the 7-field handoff snapshot itself (same lint as
  `lzy loop handoff`), registers the marker, and releases the lease. Exit
  code 0 = done or clean wind-down; 1 = gate reject or segment failure
  (snapshot authored before a nonzero exit when possible). `lzy doctor` gains
  a `drive` line (credential two-state, active lease, budget counters, current
  goal eligibility; engine absent = skip). `scripts/headless/e2e-drive.mjs`
  is the live-fire acceptance script (SKIP exit 0 without credentials, CI
  never touches the network). Primitives: `detectHeadlessAuth()` is now the
  single source for the oauth/env credential probe (doctor + both e2e
  scripts), `spawnHeadless` returns the `durationMs` its docs always
  promised. Docs: zw SKILL (drive section under Unattended; "read-only recon
  needs no goal" triage bullet; cheat-sheet row), guide/README (both
  languages), `docs/design-h3r-experiment.md` (pre-registered experiment
  design for the step-level high-risk gate — design only, separate spike
  goal).

## [0.1.2] - 2026-09-20

### Changed

- Track the ZCode 3.14.0 engine baseline (runtime 0.16.5 → 0.16.9): the
  zw skill's idle-run sentence now describes both binding forms (the
  `queryId <taskId>:bound:` marker was retired in favor of an explicit
  `boundSessionId` plus an `automationCheckTaskBinding` check), and the
  headless wall-clock-budget copy no longer cites `--max-turns` (the flag is
  gone from the 0.16.9 CLI surface). No behavior change; dated addendum added
  to `docs/spikes/headless.md`, and the headless contract re-verified live on
  engine 0.16.9 (§10: parser guards, auth gates, `--resume` cross-process
  carry, E2E full chain PASS).

## [0.1.1] - 2026-09-19

### Added

- **UPS exact-hash human gate** (ADR-0018, 0.1.1 goal1): plan adoption —
  `lzy loop plan` and `lzy loop supersede` alike, both tiers — now requires an
  approval record written only by the UserPromptSubmit hook when a genuine user
  message contains 「批准 <planHash 前 8 位>」. The first adoption run is
  rejected with the pending short code and recovery guidance; `--force` does
  not bypass (no escape flag). Approval records are append-only under
  `.lazyzcode/loop/approvals/` and survive reset; editing the plan after
  approval voids it and a fresh code is issued. Two ablation switches
  (`LZY_ABLATE_HUMAN_GATE`, `LZY_ABLATE_HOOK_HUMAN_GATE`, value exactly "1")
  keep the true-ablation harness and headless E2E drivable — the E2E now
  drives a real two-turn approval through the engine.
- **`zw standdown` — session-level opt-out** (ADR-0009 revision, 0.1.1 goal2):
  the UserPromptSubmit phrase 「zw standdown」 writes a standdown flag for the
  session; the Stop hook releases it read-only (no budget spend, no state
  writes) until a claiming trigger like 「zw 继续」 clears the flag or the
  goal is reset. Lives on the trigger ablation axis (no separate switch).
- **`host-git` doctor line + non-git register hard-reject** (ADR-0019,
  0.1.1 goal2): `lzy loop register` rejects a non-git host up front with
  `git init` recovery guidance (no bypass flag) — the unreachability of
  `finish` moves from close-out time to registration time; `doctor` carries a
  standing `host-git` check (ok / warn-only) and `status` appends guidance on
  the missing-state branch. A non-git **degraded form** (all-`--surface`
  external evidence, LIGHT-only, no attestation) is chartered as an ADR
  direction only — implementation and the LOOP_COMPLETE semantics redefinition
  stay future decisions.
- **Node floor pre-flight at install/sync** (debt-6 micro-widget): low Node
  versions now fail at the entry with the current version and an upgrade
  pointer instead of at runtime; `NODE_MAJOR_FLOOR` is exported as the single
  source.
- **Security & trust surface section** (README bilingual + guide bilingual,
  debt-4): what the five hook events execute and inject, the official-cache
  install footprint with zero `config.json` writes, user-verifiable recipes
  for both distribution chains (npm shasum, marketplace pin), and the plainly
  stated threat-model boundary (guards against laziness, not malicious agents).

### Changed

- **Pull-back is claim-gated** (ADR-0004 amendment 4, 0.1.1 goal2): the
  empty-claim-set fallback ("empty set = directory-level status quo") is
  abolished — pull-back eligibility requires a session-held unexpired claim;
  bystander sessions are structurally exempt and no longer need per-turn
  handoff mitigation. A fresh goal whose executing session never claimed
  releases at its first Stop by design (claim first with an invocational
  trigger). `status`/`doctor` claim wording follows the new semantics, and
  decision #17's pre-registered fallback is retired in the decision table.
- zw SKILL: pull-back eligibility and standdown contract sentences, the
  `Lzy-Attestation:` close-out trailer convention (text half of debt-3,
  L0; machine-side doctor verification deliberately deferred), and the
  git-prerequisite sentence in the host-workspace section.

## [0.1.0] - 2026-09-18

Protocol upgrade baton (0.1.0, ADR-0016/0017): forward-only attempt lineage,
invalidation propagation as a query surface, HEAVY exemption tightening, the
protocol text layer, and the headless drive primitive.

### Added

- **Live-surface evidence ordering** (zw SKILL): when an F-item's evidence
  surface is an expensive, flaky live run, iterate the test harness to stability
  before banking any green half — capture all greens in one final batch after
  the harness freezes; `INFRA-FAIL:`-attributed failures do not retire an
  approach (postmortem of the zpigeon render-granularity goal's re-capture
  avalanche).
- **Attempt lineage (supersede, forward-only)** (ADR-0016): `core/attempt.js`
  keeps `loop/attempt.json` (checksummed, atomic write, errno fail-closed;
  absent ledger falls back to a derived view from the central DAG's attempt
  stamps). Changing the plan mid-execution no longer dead-ends: `lzy loop
  supersede <plan> [--review …]` marks the old attempt superseded and opens
  attempt+1 with the full adoption gates re-run (same-hash refusal, previous
  snapshot archived as `.attempt<n>.md`, base tree re-captured). `lzy loop
  attempts` is the read-only lineage face; re-registering the same slug after
  a reset appends, preserving the supersede chain.
- **`lzy dag stale`** (ADR-0016): the invalidation preview is now a real
  query command — per-evidence-node status against the current composite
  fingerprint (fresh/stale/superseded/external/unknown), display-only; the
  gates still judge by direct fingerprint comparison. Planning-time finding
  recorded: passive comparison at verify/finish already covers the
  propagation semantics (lzy observes no commits), so write-time invalidation
  is deliberately not built.
- **Harness freeze (INV-08, minimal form)**: `lzy evidence red` and `lzy
  step done` accept `--harness "<procedure>"` (≤300 chars); its sha256 lands
  on the evidence node and a red/green pair naming different procedures is
  flagged in `evidence list` and refused at HEAVY finish. `waive-red` takes
  no harness (an exemption has no procedure).
- **Headless drive primitive** (ADR-0017): `core/headless.js`
  `spawnHeadless` — one-shot engine drive in the headless first-class form
  (literal argv + `shell:false`, node-runs-engine, explicit-required
  `--mode`, wall-clock budget with SIGKILL, HOME isolation swap with auth-env
  passthrough, `--json` summary parsing, recovery-pointer error families,
  injectable `deps.run`). `scripts/headless/e2e-loop.mjs` is the full-chain
  self-drive acceptance (scratch loop register→finish→attestation;
  credential-gated SKIP, never touched by CI). `lzy doctor` gains a
  `headless` line (engine absent = skip; credential two-state = ok/warn-only).

### Changed

- **HEAVY exemption tightening (INV-09)** (ADR-0016): HEAVY finish now checks
  every F item for a paired red or waived half — a missing red half cannot be
  repaired by capturing more green. Recovery: record the red (post-green
  recording reverse-pairs to the anchored green via the same
  `findGreenByGeneration` primitive the gate uses) or waive honestly. The
  check runs after the comparator binding checks and shares the
  `LZY_ABLATE_ATTEST` guard (ablation variant-D composition changes
  accordingly). LIGHT goals keep protocol-text-only enforcement; red-after-
  green rebind remains legal.

## [0.0.10] - 2026-09-17

Fix release closing all 44 unique findings from the five-round dual review of
0.0.9 (`docs/reviews/2026-09-17-v009-five-round-dual-review.md`), plus
per-provider rate-limit advice (roadmap debt 6). No new features; every
P0/P1/P2 fix carries live red-green evidence (red half captured on published
0.0.9). 224/224 tests green (baseline 211).

### Fixed

- **Unreadable ledger can no longer be silently wiped** (ADJ-01, P0):
  `loadDag` treated EACCES/EISDIR like a missing file, so the next write
  command overwrote `dag.json` and destroyed the sole red/waive halves
  (live-probed). Only ENOENT means absent now; `saveDag` additionally refuses
  to write an empty ledger over a non-empty file, or at all when the on-disk
  ledger is unreadable.
- **Malformed-but-checksummed ledgers fail closed with recovery pointers**
  (ADJ-05): shape validation for nodes/edges (was: bare TypeError or silent
  false answers).
- **Comparator attestations must bind captured evidence** (ADJ-02, P1): items
  carry `{fid, verdict, evidenceNodeId, generation, basis}`; unresolvable
  bindings are refused at record time, and the HEAVY finish gate additionally
  requires each item to point at the step's currently-anchored green node with
  the comparison recorded after the capture (kills compare-before-evidence,
  reuse-after-rebind, and cross-reset reuse). The final attestation records
  `at` timestamps.
- **Three deadlock families got state-aware exits** (ADJ-08/09/10; doctrine in
  the ADR-0014 addendum): zero-F HEAVY goals are exempt from the comparator
  gate and zero-F plans are rejected at HEAVY adoption up front; done-state
  ledger divergence recovers via a rebind whitelist (`step done`, `attest
  comparator`, `loop finish` work in done state; re-finish writes a fresh
  attestation — same-second attempts get a millisecond suffix instead of
  overwriting, ADJ-07); tier-heavy upgrades of goals without a plan snapshot
  are rejected up front, and executing goals without a planHash may re-adopt
  their plan (fresh snapshot + review) as the recovery exit.
- **Red-half attachments carry node identity** (ADJ-24, P1): same-generation
  red halves land in distinct files instead of silently overwriting each other
  (the ledger's sha256 was a false claim); a failed ledger write leaves no
  half-captured attachment behind.
- **red_of re-pairs on rebind** (ADJ-04): implementation now matches the
  documented "latest red_of is current" semantics.
- **Attempt-stamped instance isolation** (ADJ-44/03): cross-reset
  re-registration derives an attempt number from the ledger; pairing,
  supersedes, anchoring, and the evidence-list view are scoped per instance.
  The manifest view anchors the current green via the same lookup the
  authority uses, marks legacy-track steps honestly, and summarizes
  other-instance nodes instead of mixing them into per-step rows.
- **Finish critical section: half the git rounds + race recheck** (ADJ-13/06):
  the integrity gate returns the head trees it already fetched and the final
  attestation reuses them; a post-gate composite-fingerprint recheck rejects
  when the tree moved mid-finish (no self-contradictory LOOP_COMPLETE).
- **payload-ver deep checks** (ADJ-38/15/37): doctor compares the registry pin
  (what sessions actually load), samples payload content (skills/zw/SKILL.md
  sha256, cache vs package), and enumerates all marketplaces; the release
  checklist gains a payload-freeze rule (no packaged file changes after
  tagging).
- **Legacy escape hatch closed** (ADJ-11): legacy single-tree evidence on
  multi-subject goals reads as stale (subject commits were invisible to it);
  slot-occupied errors no longer suggest abandon/reset (ADJ-36); evidence list
  node filtering is O(N+E) via indexes (ADJ-23); the finish banner labels
  planHash=null for legacy goals (ADJ-12).
- **Five test gaps closed** (ADJ-16..20) and **all 21 P3 findings swept**
  (ADJ-07..43): orphan-ghost wrong-face fixture, real stale-branch assertion,
  comparator schema negatives, anchored-nodeId identity, attest pre-lock
  guard; attestation same-second suffix, attestation tmp sweeps, BigInt id
  allocator, manifest renders the current comparator verdict / waivers /
  attachment counts, single Added section for 0.0.9 in this changelog, AGENTS
  ADR map through 0014, robots sub-path boundary note, headless spike
  line-count correction, SKILL ledger-sentence rewrite, subject-remove
  path-form matching, guide finish fences at 0.0.9 semantics, content-level
  residue scan (session identifiers no longer shipped in payload comments),
  status dirt readout, checksum/recovery documentation.

### Added

- **Per-provider rate-limit advice** (roadmap debt 6): the band-by-provider
  line carries cap advice for coherent bands, and a mix-note line states how
  many providers the account-level numbers blend. Additive lines only — the
  main rate-limit line, 429 predicates, and concentration/band math are
  byte-identical.

## [0.0.9] - 2026-09-17

### Added

- **Central invalidation DAG + red/green evidence manifest** (0.0.9 baton 1,
  ADR-0014): a machine ledger at `.lazyzcode/loop/dag.json` — cross-reset
  resident, JSON atomic write with a payload sha256 checksum, fail-closed on
  corruption (every reading command rejects with a recovery pointer, never a
  silent empty ledger). `lzy evidence red <Fid>` records the red half with its
  OWN surface (composite fingerprint by default, `--surface` for external
  surfaces such as a published version), `lzy evidence waive-red <Fid>
  --reason` is the machine form of the one-line exemption, and the green half
  is mirrored automatically at `step done` (capture-time edge registration,
  dag-first: a ledger write failure rejects the whole command with goal.json
  untouched). Rebinds append `supersedes` edges; `red_of` pairs red halves to
  greens (multiple edges legal, latest wins). `lzy evidence list` renders the
  per-F manifest (halves, surface short codes, rebind chain, hash-surface
  stale column, orphan labeling) and `lzy dag dependents <id|surface>`
  answers "what depends on X". Plan adoption registers plan+review nodes with
  `reviews`/`plans` edges. The ledger only records — it gates nothing until
  baton 2 switches verify/finish authority to the DAG. Storage medium ruling:
  JSON, not node:sqlite (unflagged sqlite only exists from Node 22.13/23.4,
  which would silently raise the `>=22` engines floor).
- **Unified DAG authority + comparator attestation + final attestation** (0.0.9
  baton 2, ADR-0014 addendum): `verify`/`finish` now judge evidence freshness
  from the ledger — each F step's green node is anchored to the generation
  recorded in goal.json (orphan ghosts never count as current and never block;
  the ledger node's surface is the authority; legacy `treeHash` records keep the
  0.0.8-identical dual track). A fingerprint-form record with no anchored ledger
  node rejects fail-closed as "账本不一致" with a recovery pointer (re-record via
  `step done` re-registers the node); an unreadable ledger rejects everywhere as
  before. `lzy attest comparator --file <verdicts.json>` records qa-executor
  comparator verdicts as machine attestations (schema-validated: slug match,
  known F ids, MATCH|MISMATCH enum, full coverage; bound to slug + planHash +
  composite fingerprint + file sha256, `attests` edge to the current plan node).
  HEAVY `finish` machine-enforces a current MATCH attestation whose fingerprint
  matches the tree — missing, MISMATCH, and stale all reject, no bypass; LIGHT
  goals may self-check without recording. On success `finish` writes the **final
  attestation** `.lazyzcode/attestations/<slug>-<UTC-compact>.json` — the
  LOOP_COMPLETE machine proof (attemptId at second granularity, planHash,
  per-root head trees, composite fingerprint, ledger-anchored evidence refs,
  comparator record, report sha256) — atomic, surviving `reset` as history, and
  outside `loop/` so the scar patrol never sees it.
- **doctor `payload-ver` line** (debt #3 closeout): compares the actually
  installed payload cache version directories against the running CLI's
  package.json version — ok when the CLI version has a cache directory, warn
  with a `lzy sync` pointer when not (the ADR-0012 "npm upgraded but not synced"
  intermediate state where real sessions still load the old payload), skip when
  no cache exists. Versions are read live on both sides, never hardcoded.
- **fail-fast hardening**: `lzy evidence red|waive-red` in a directory without a
  goal no longer creates the `.lazyzcode/loop/` shell before rejecting
  (ADR-0006 pre-lock check; `lzy loop claim` already had it).

- **Same-workspace multi-session discipline** (skill + guide, both languages): one
  goal slot per workspace — a second `register` is rejected and a `done` goal keeps
  the slot until `lzy loop reset`; never `reset`/`abandon` a slot another session is
  actively running (new skill red line); parallel goals each get their own worktree
  **created outside the host tree** (an in-tree worktree dir reads as untracked and
  blocks the host's own finish); same-goal co-workers split per step via
  `lzy loop claim` with one writer committing at a time.
- **worktree-as-subject contract test**: a sibling worktree root is accepted as a
  subject, its dirt is attributed per root (host stays clean), and a commit there
  changes the composite fingerprint (declaring = coupling).

### Changed

- **Dirty-rejection message now names the files**: the finish integrity gate's `dirty`
  branch lists the first 3 offending paths (plus an "…等 N 处" count for the rest,
  `.lazyzcode/` ledger excluded), and adds two sentences — stray files can go into
  `.gitignore` or move out of the repo (no need to commit them), and a path you did
  not touch may be another session's uncommitted work in the same working directory.
  `git.integrity()`'s dirty state now carries `paths`; the rejection semantics are
  unchanged. Closes a GPT-blueprint N1 clause ("报错列前 N 个 dirty paths").

## [0.0.8] - 2026-09-16

### Changed

- **Evidence semantics: single-tree → composite fingerprint** (ADR-0013, decision #23).
  F-item evidence now binds the sha256 over every `{host}∪subjects` root's HEAD tree
  hash (realpath-sorted `realpath\0hash\n` concatenation): any root — or the subject
  set itself — changing makes evidence stale. Legacy evidence (recorded before this
  change) falls back to the 0.0.7-identical single-host-tree compare; verify/status/
  report display surfaces show the fingerprint short code for new evidence and keep
  the tree short code for legacy.
- **finish gate tightened: integrity gate added (P0-A closure)** — after
  pending/stale/unbound, a fourth rejection requires every `{host}∪subjects` root to
  pass a per-root integrity check: dirty (uncommitted changes beyond the per-root
  `.lazyzcode/` exemption), missing (root gone / not a git repo / unparseable HEAD —
  including the re-capture-while-missing traversal form), or git process error
  (fail-closed, raw error in the message). **No bypass flag.** A dirty-tree finish
  can no longer report done.
- **finish report archive is atomic**: the report is written (tmp+rename) before the
  goal flips to `done`; an archive failure leaves the goal `executing` with a
  recovery path instead of a done state with a ⚠ and no report.
- **HEAVY review gate is machine-enforced at adoption**: a HEAVY goal (persisted
  tier) without a PASS review verdict is rejected by the CLI (`--force` does not
  cross; any non-PASS string including UNVERIFIED is rejected). LIGHT behavior
  unchanged.

### Added

- **Subjects (multi-tree goals)**: optional `subjects: <path>` plan-header lines
  (one path per line, header-only, relative to the host root; nonexistent/non-git/
  host-containing roots rejected loudly, stray body lines follow the deps-orphan
  rule) plus `lzy loop subject add|remove|list` (executing-only; `remove` is the
  missing-deadlock escape). Any set change invalidates all captured F evidence.
- **Plan snapshot + hash**: adoption snapshots the plan to
  `.lazyzcode/loop/snapshots/<slug>.md` (reset keeps it), binds `goal.planHash`,
  and stamps `review.planHash` — the review binds the reviewed artifact. Re-adopting
  an amended plan with an absent or verbatim-identical review warns; status
  re-verifies the snapshot hash (tamper visible).
- **Tier persistence**: `register --tier heavy` and one-way `lzy loop tier heavy`
  (downgrade rejected; same-value no-op; upgrade without a PASS review warns —
  the machine gate lives at adoption time). status shows tier/subjects with
  missing-key tolerance for pre-0.0.8 goals.
- **Bilingual docs** for all of the above: zw SKILL contract text, guide sections,
  README positioning sentence ("A local, evidence-bound coding goal protocol with
  durable continuation — not a general workflow engine.") and CLI table rows,
  adversarial checklist (debt B discharged, new debt D), narrative-checklist
  counters. ADR-0013 + AGENTS.md decision #23 record the semantics.

## [0.0.7] - 2026-09-16

### Added

- **`lzy update` command** (ADR-0012): one-command upgrade — probes the registry
  with `npm view`, compares against the globally installed package, runs
  `npm install -g lazyzcode@latest`, then spawns a **fresh child process** from
  the new install path to run `lzy sync` (an in-process sync would deploy the
  new payload with the old in-memory code). Already-latest exits without
  installing; npm-missing and every mid-chain failure print recovery hints
  (manual two-step; the upgraded-but-not-synced mid-state names itself).
  npm spawns use the standing safe shape (literal argv + `shell:false`; win32
  via `cmd.exe /d /s /c`, CVE-2024-27980 hardened shape).
- **Bilingual README upgrade section** (`### Upgrade` / `### 升级`): documents
  `lzy update`, the manual two steps for 0.0.6-and-earlier, and why two steps
  are required (live sessions read the engine cache's versioned directory, so a
  bare npm upgrade is invisible to sessions; `enabledPlugins` survives version
  bumps with no re-enable). `lzy update` row added to both CLI tables.

## [0.0.6] - 2026-09-15

### Added

- **Cross-platform research base**: engine hook-spawn semantics (strict schema with no
  platform fields; `shell` three-state resolution; `process` launch primitive), official
  download surface (3 platforms × dual arch at 3.11.2), live VM probes on Windows 11
  ARM64 + Ubuntu aarch64 (engine layout isomorphism, node/npm trial installs, cmd
  PATHEXT probe), and a three-break obstacle inventory — `docs/research-crossplatform.md`.
- **Cross-platform design doc**: full-install-chain options with cost tiers and a single
  recommendation (C-pair extensionless launcher; engine-candidates table extension;
  platform-aware doctor line) — `docs/design-crossplatform.md`.
- **ADR-0011**: 0.0.6 ships three-platform distribution, revising the recon-only
  decision; acceptance = three-VM live evidence + CI matrix, arm64 evidence boundary
  declared.
- **Three-platform distribution support** (ADR-0011 acceptance): launcher C′ pair — an
  extensionless `run-hook` (POSIX) plus a `run-hook.cmd` twin (Windows resolves the same
  hooks.json line via PATHEXT, forward-slash engine-shape commands included) — with
  `run-hook.sh` retired; `engineCandidates()` extended to a three-platform data table
  (Linux `/opt/ZCode/...`, Windows per-user `%LOCALAPPDATA%\Programs\ZCode\...`, measured
  on live installs); platform-aware doctor (`hook-node` probes the per-OS launcher, the
  `platform` row reports the engine-candidate hit); Windows test-mine treatment
  (file-URL dynamic imports, USERPROFILE-aware test isolation, platform-branched launcher
  contract, line-ending pins) and a windows-latest CI leg; three-VM live acceptance
  (doctor, launcher probes, engine `plugins list` hooks:5, full loop chain) on
  Windows 11 ARM64 and Ubuntu aarch64; bilingual docs declare three-platform support
  with the arm64-live / x64-by-documentation boundary.
- **Docs-site SEO/GEO pass**: canonical URLs, Open Graph / Twitter card
  metadata with a 1200×630 social image (`docs/assets/og.png`, source
  `og.svg`), hreflang pairs between the English and Chinese guide/developers
  pages, per-page `<meta description>`, a static `sitemap.xml` covering the
  five curated pages, and JSON-LD (`SoftwareApplication` on the home page,
  `FAQPage` mirroring the on-page FAQs on both guides).
- **`llms.txt`** at the site root for generative engines, linking the raw
  markdown surfaces.
- **`bare` layout for internal records**: adr/spikes/diagnostics/research and
  other internal notes now render with a proper shell carrying
  `robots: noindex, follow` — links from the guide keep working, but the
  pages no longer hit search indexes as unstyled fragments.
- **Red-green evidence discipline (dual evidence)**: every F-item claim now
  carries two halves by default — a **red** capture of the assertion failing
  on the pre-change state (taken before the edit) and a **green** capture of
  it passing after. Surfaces where no counter-state can be constructed get a
  one-line exemption (reason required, not a silent skip). The `qa-executor`
  comparator checks halves presence per pair; missing halves without an
  exemption is a `不匹配`. Protocol/skill-text layer (zw SKILL, qa-executor
  contract, bilingual guide); zero CLI changes.
- **Adversarial checklist** (`docs/research-adversarial-checklist.md`): the
  nine-class adversarial sheet mapped to the project's existing defenses with
  per-class three-state verdicts (defended / tightened this round / recorded
  debt with promotion conditions), plus provenance and license-boundary notes
  (taxonomy cited as facts from OhMyZcode, itself an OmO ultraqa transplant;
  all prose self-written). HEAVY finishes touching command, parse, or
  state-merge surfaces self-check against it.

### Changed

- `npm` metadata: package `keywords` added; `homepage` now points at the
  docs site. The local docs-preview build mirrors the Jekyll head pipeline
  (generic includes, `page.url`/`page.description`, real `bare` layout,
  static-file copy), so local previews match the Pages build.

## [0.0.5] - 2026-09-14

> 0.0.5 is the internal-hardening release: the parallel-claim minimal chain
> lands (decision #21 upgraded from debt per owner grilling 2026-09-13/14),
> plus the cost two-piece and two loose ends. Published as 0.0.5 on
> 2026-09-14 (owner decision; supersedes the earlier wait-for-0.0.6 plan).

### Added

- **Parallel-claim minimal chain (decision #21; ADR-0004 amendment 3)**: plan
  items may declare dependency edges — a `deps: N1,N2` line right after an
  item; unknown refs, self-loops, and cycles are rejected at the plan gate, as
  are orphan/malformed `deps:` lines (with a `<!--lzy:allow-->` escape for
  prose mentions) —
  and a new `lzy loop claim` provides anonymous per-step claiming for
  same-goal multi-worker runs: 48h mutex (same TTL as goal-level claims),
  blocked-step rejection names the undone dependencies, `lzy step done`
  auto-releases, `--release` frees early, bare `lzy loop claim` lists
  claimable steps, and `lzy loop status` marks steps `[claimed]` /
  `[blocked: …]` (next-step annotation included) with usage guards on
  `--release`. No session identities are recorded
  (ADR-0009 stance). Old plan files parse unchanged. zw SKILL gains the
  parallel-dispatch rule: claim first, edit code in your own worktree, run
  every `lzy` command from the host workspace root (ADR-0006).
- **doctor `band-by-provider` line (decision #21 precondition)**: the same
  rate-limit scan now also reads `model.request.completed` events
  (provider-tagged) and computes a per-provider empirical band —
  completed-side clean buckets × 429 dirty buckets — emitted only when the
  window has ≥1 429 and ≥2 providers; a provider with no 429 of its own gets
  an honest "no dirty-face sample" row. The 429 substring predicate and the
  account-level started-based band math are byte-untouched (purity pins
  included); samples missing `providerId`/`sessionId` are skipped fail-soft.
- **Cost two-piece**: "mechanical $0 checks first" enters the zw SKILL
  evidence section and qa-executor Method as rule #1 — zero-cost deterministic
  evidence (CLI stdout, file asserts, grep/diff) before any semantic judgment.
  doctor gains a `cost` advisory line: a zero-429 window with the rolling
  waterline below half the threshold suggests trying a lighter model tier for
  routine goals (fall back on failure); otherwise it advises holding the tier.
  Advisory text only — it never enters predicate or band math, and the
  threshold honors `LZY_WATERLINE_POINTS` like the waterline check.

### Changed

- **Node.js floor raised 20 → 22** (engines, CI matrix [22, 24], and the
  `doctor` node check): Node 20 reached end-of-life in April 2026 and cannot
  run the new glob-form test command.
- `npm test` and CI run `node --test "test/**/*.test.js"` — discovery narrowed
  to `test/`, structurally preventing the bare-cwd phantom-pass class (Node
  ≥22 interprets `--test` positionals as globs; a literal directory argument
  is not usable). `pnpm-lock.yaml` moves to `.gitignore` (the file regenerates
  itself; owner decision Q3 2026-09-14).

## [0.0.4] - unreleased

> 0.0.3 was versioned but never published; per owner decision (2026-09-13) its
> section is folded into 0.0.4.

### Added

- **Idle-run lane semantics in zw SKILL (idle-lane-sync)**: the Continuation
  section now keeps FOUR continuation surfaces — engine, lzy Stop hook,
  unbound scheduler wake (fresh session each fire), and the new **idle run**:
  the host OffPeak idle task resumes the ORIGIN session (`queryId
  <taskId>:bound:`, turnNumber continues across wakes) with **zero pool
  exemption** — engine 3/turn and hook 2/session both count, and per-session
  counters persist with the session. Budget wording follows the offpeak-probe
  live probe (2026-09-14, with a same-night erratum): same-session binding
  proven and pull-back exemption absent, but executor-perceived conversation
  history is unreliable — never rely on in-chat references, keep all handoff
  state on disk; an idle-run-resumed goal loop follows the Unattended
  red-line protocol. Rate-limit discipline gains the "idle run = official
  off-peak lane" bullet, keeping the scheduling/concurrency axis distinct
  from the provider model pool (repo-wiki caveat).

- **Content-moderation stream-kill family (content-kill-family)**: `lzy doctor` gains a
  `content` line — provider content-filter mid-stream kills (BigModel `1301`; live
  incident 2026-09-14: the stream opened HTTP 200 and was killed after ~4.8k chars of
  model reasoning with zero text emitted) counted as a third failure family alongside
  429 rate limiting and ADR-0008 transport deaths. The match is pinned to the failed
  event's `context.statusMessage` field (companion fan-out lines never double-count);
  `retryable=false` means no retry amplification, so events equal dead requests. The
  zw SKILL rate-limit section and both guides gain the recovery contract: never retry
  in place (it reproduces deterministically) — close cleanly and resume in a new
  session, or rephrase so the model takes a different reasoning path. The family never
  enters the concurrency-band/off-peak math.

- **Engine baseline re-verified against ZCode 3.12.1 (engine-3121-sync)**: the desktop
  shell updated 3.11.2 → 3.12.1 (build 7207). All eight §3 hard constraints re-verified
  at source level and unchanged (7 hook events; Stop ≤3 with non-empty
  `additionalContexts`; shared 3-continue pool; AGENTS.md auto-read trio; trust-gate
  policy codes; cache three-styles two-step enable; hook output schema; exit-2-block).
  Knowledge corrections recorded: the engine CLI (`Resources/glm/zcode.cjs`) reports its
  own `--version` (0.16.5) that did not move across both shell generations — the app
  version is the discriminator; the desktop shell is now Vite-chunked
  (`out/{host,main,…}`) with the engine CLI outside the asar; the model catalog
  presents as 2 vendors (zai/bigmodel) × plan tiers with the GLM default unchanged.

- **Project-memory staleness hint (memory-staleness-fingerprint)**: `lzy
  doctor`'s `agents-md` line now measures map lag — commits touching covered
  directories since the root `AGENTS.md`'s last commit (resolved with
  `--full-history`, so merges cannot hide the base). At ≥50 (a written-dead
  constant, no env) the ok line gains a warn-only suffix suggesting a
  refresh; git silence (no repo, no committed map, empty coverage) means no
  suffix, never a guess. Re-running `lazyzcode:init-deep` resets the base by
  construction. Also documents that the desktop app's repo-wiki generation
  runs as a background lane on the same account model pool — zw's rate-limit
  discipline now says not to stack dense unattended wake-ups while a large
  wiki is generating.

- **Goal-loop cost observability (plan-v2 Phase 2)**: `lzy loop cost` turns
  the engine's local billing ledger (`~/.zcode/cli/db/db.sqlite`, read-only)
  into a points report — per-model standing coefficients (source-URL
  annotated, hand-maintained), a dated promo-overlay layer (the GLM nightly
  event 2026-09-03 → 09-20, nightly 23:00–09:00, Flash-via-ZCode free per the
  official notice, auto-expires and falls back to the standing off-peak
  rule), goal attribution via simplified OR (session directory ∪ claimed
  sessions) with an explicit human-review note, and unpriced models reported
  as honestly missing. The only new spawn lives in `core/hostdb.js` (literal
  `sqlite3 -readonly` argv, `shell:false` — the plan-v2 §4-2 exemption; the
  loop module itself stays spawn-free).
- **Finish metrics & evidence rebind traces**: `finish_attempts` and
  `finish_reject_{pending,stale,unbound}` counters land in `metrics.json`
  (the veto-rule data plane); re-recording evidence appends the previous
  capture to an append-only `evidenceHistory` (cap 5) and attachment files
  gain a take-sequence in their names, ending same-name overwrites.
- **Waterline nudge**: the Stop hook reads the same ledger's rolling 5-hour
  point burn; above a self-referential calibrated threshold (1600 — p95 of
  the trailing 14 days at calibration time, `LZY_WATERLINE_POINTS` overrides)
  it injects a wrap-up nudge once per window. Fail-open throughout (no
  ledger, no sqlite3 binary → silent skip); `lzy doctor` gains a `waterline`
  line exposing exactly that.
- **Orphan-wake doctor check**: an unbound wake automation (empty target,
  enabled, active) anchored to this workspace with no executing goal and ≥3
  consecutive succeeded runs within 48h warns as an idle-burn surface; with
  no mounts (the norm since the 09-13 full teardown) the line reports skip.
  Path comparison is realpath-normalized on both sides (macOS
  /var → /private/var proven live).
- **Handoff hardening**: snapshot mtime ceiling 24h → 2h; a 7-section
  snapshot content lint (remaining steps / next action / goal & progress /
  dirty-tree list / tree hash / risks / resume command — headings are
  contract literals, template embedded in zw's Continuation section, empty
  sections rejected); claims gain a 48h TTL (the engine has no SessionEnd —
  dead sessions' claims retire, pure expiry falls back to directory-level
  behavior, doctor counts them).
- **Unattended sentinel**: the trigger hook stamps `unattended`/`wakeAt` onto
  any session whose prompt contains 无人值守 — outside the executing gate, so
  idle wakes count too; the Stop hook counts `wake_noop` when such a session
  ends with zero progress against its first-pull baseline (stuck and budget
  paths; sessions that progressed and handoff releases don't count). This is
  the technical ground A'-revival precondition ④ asked for.
- **Prompt-layer discipline (plan-v2 Phase 1)**: zw's Continuation section
  defines the no-op criterion (the loop's state set must move: done count,
  F-item treeHash set, handoff registrations, salvage stubs), corrects the
  then-three-continuation-surfaces mental model (engine 3/turn resetting, lzy
  2/session persistent, scheduler wake unlimited; the fourth surface — idle
  run — arrives with idle-lane-sync above), embeds the 7-field
  snapshot template, and adds dirty-tree inheritance (reconcile first, no
  checkout/reset); Unattended gains two hygiene rules (never create wake
  automations in-session; disable the wake after finish/abandon — the CLI
  prints a reminder line on both). plan-reviewer's dispatch contract now
  requires re-review dispatches to carry the prior MUST-FIX text verbatim.
- **Goal lineage (`lzy loop history`, pisper-absorption)**: a read-only union
  of evidence bundles, salvage stubs, and git ledger trailers — one line per
  past goal (status from the archived report, trailer commit count, stub and
  bundle flags, latest activity date), sorted by recency; missing sources
  degrade per-source and an empty workspace gets a friendly empty state.
  `core/git.js` gains the all-time `trailersBySlug()` reader (the existing
  `goalLedger` is `--since`-bounded); the loop module stays spawn-free.
- **Injection determinism invariant**: hook `additionalContext` templates must
  be deterministic — same session state, byte-identical output; no timestamps,
  random values, or unstable iteration order inside injected text (GLM prompt
  cache compares byte-wise on the prefix, template jitter silently voids the
  discount that `lzy loop cost` accounts for). Pinned by a five-hook
  double-run contract test with per-run reseeded state.
- **Tripwire guidance + attempt notes**: the idle-tripwire warning now names
  the concrete correct action (prefer `search_tools` narrow activation, not
  `activate_domain` wholesale), and zw's Execute section requires an attempt
  note (`- [!] attempt <n>: …`) in the plan file whenever a step is redone
  with a different approach — the plan file is the attempt history.
- **Unattended notify & competitor-watch docs**: `docs/unattended-notify.md`
  (push the overnight digest to your own IM bot webhook — Feishu / WeCom /
  Telegram curl recipes, zero servers) and `docs/research-competitor-watch.md`
  (deadline-bound observation signals for competitor rescans, W1–W3, plus the
  demand-side evidence note for decision #21).

- **Pricing-aware `schedule` advisory (ADR-0003 amendment)**: `lzy doctor`'s
  schedule line now cross-checks the rate-limit-derived window against a
  hand-maintained UTC+8 table of platform pricing peaks (GLM Mon–Fri 14–18;
  DeepSeek Mon–Fri 9–12 & 14–18), flags overlapping hours, and always states
  the pricing-safe nightly window (23:00–09:00, GLM nightly promo — an
  activity-period clause, disclaimed in the output). `scheduleAdvisory` gains
  an injectable `now` (bandAdvisory precedent); the UTC+8 conversion is pure-UTC
  and independent of the running machine's timezone. The previously suggested
  09:00–17:00 window fell almost entirely inside peak pricing — the most
  expensive advice possible.

- **Handoff release counters**: every `lzy loop handoff` registration and
  every Stop-hook consumption now increments anonymous counters in
  `.lazyzcode/loop/metrics.json` (`registered`/`consumed` — counts only, no
  session identity, ADR-0009 anonymity intact). Counter writes are lock-free
  best-effort and can never block registration or release; counts survive
  `lzy loop reset` and surface in `lzy status` (`handoff-usage` check,
  inherited by `lzy doctor`) and `lzy loop status`. A registered-over-
  consumed skew is normal (reset sweeps and discarded garbage markers
  register without consuming).
- **`lzy loop list [--root <dir>]`**: read-only cross-repo sweep of goal
  loops. Scans one level of sibling directories (default anchor: the parent
  of the current directory, itself included) and prints per-repo slug,
  status, step progress, claim/stuck flags, goal-file staleness and salvage
  stubs — `executing` sorts first, then planning/done by recency. One
  unreadable repo prints a `版本不符` row instead of failing the sweep;
  an anchor with no goals prints a note and exits 0.

- **Session-runaway guardrails (incident-guardrails)**: `lzy loop handoff
  --snapshot <file>` registers a directory-level anonymous marker that the Stop
  hook consumes atomically (exactly one winner) to release a cleanly-closing
  session without spending the continue budget — a proper handoff is handing
  execution back to the user, not quitting half-done. A `PostToolUseFailure`
  tripwire (`^mcp__` tools only) warns once when the same tool fails twice in
  a 10-minute window — successes don't reset the streak, only the TTL does —
  steering toward switching tools or closing via handoff (hooks:4→5). `lzy
  status`'s payload check now compares file contents (sha256), not just the
  path set — a stale cache no longer reports "identical" (proven in a real
  incident). zw's Continuation section gains a tool-fire-loop escape contract;
  `lzy loop status` surfaces claim/handoff markers. Also fixes a latent bug:
  the all-steps-done finish reminder crashed on an unimported helper since
  0.0.2 (caught by the new contract tests).
- **Evidence comparison & salvageable artifacts (comparator-salvage)**: HEAVY
  finish protocols now dispatch `qa-executor` in a comparator mode over each F
  item's assertion–evidence pair — existence and freshness were machine gates,
  relevance was nobody's; a `不匹配` verdict sends the agent back for a real
  re-capture (protocol-level block, zero CLI/doctor code). Plans gain
  handoff-able-step guidance (every N item carries its own pointers; the
  plan-reviewer audits weak handoff as WARN/P3). When a loop is reset or
  abandoned, `lzy` inventories salvageable artifacts into
  `.lazyzcode/loop/salvage/<slug>.md` — uncommitted changes, footnoted
  commits, asset pointers — and `lzy loop status` surfaces stubs in both the
  no-goal and goal-present views (the moment after a reset is the primary
  salvage moment). Dependency-graph parallel claiming is recorded as design
  debt with explicit promotion triggers (ADR-0004 second amendment).
- **Transport-death diagnostics (ADR-0008)**: `lzy doctor` gains a
  `transport` line counting turns that died before reaching the server
  (ENETDOWN and the errno family, matched primarily from `statusMessage` —
  the engine logs such incidents with `reason: unknown`), with per-code
  breakdown and a fake-ip (198.18.0.0/15 → local proxy TUN) hint. The family
  is kept strictly separate from 429 accounting and never feeds the
  concurrency band or off-peak math. Warn-only, never flips the exit code.
- **Host workspace discipline (ADR-0006)**: cross-repo goal loops anchor at the
  host repo — strict-cwd resolution (no walk-up), write commands fail fast
  before they can leave empty `.lazyzcode/loop/` scar directories (reset keeps
  its null-goal cleanup contract), every no-goal error prints the exact path it
  checked plus a recovery hint, `lzy doctor` patrols empty-loop scars, and
  claim registration narrows to invocation-grade triggers (leading `zw` /
  explicit `lazyzcode:zw` / leading `ulw`·`ultrawork`; mid-sentence mentions
  still get the injection but no claim — ADR-0004 amendment). The `zw` skill
  gains a "Host workspace (cross-repo goals)" section.


### Changed

- README (both languages) now describes the `schedule` advisory as
  pricing-aware everywhere, matching the guide: the off-peak window is derived
  from measured rate-limit concentration hours and cross-checked against the
  declared platform pricing-peak table (UTC+8, hand-maintained), not from
  rate-limit data alone. Also fixes a stale hooks count (4 → 5) in both
  README architecture trees.
- Doctor's empty-shell scar patrol now exempts `metrics.json` (like
  `salvage/`) — the counters are an intentional long-lived artifact. The
  handoff read line in `lzy status` moved outside the goal branch so a
  leftover marker is visible even when no goal exists.

### Fixed

- Rate-limit log scans are now budget-bounded (goal `ratelimit-scan-budget`):
  `collectRateLimitStats` caps each engine log file at 64 MB read from the
  tail and stops entirely after 10 s, recording a `truncation` field instead
  of silently scanning a 260 MB+ retry-storm backlog measured at 18–52 s and
  starved `lzy loop start` / `lzy doctor`. The doctor `rate-limit` line and
  the `lzy loop start` concurrency advisory disclose the truncation (sample-
  credibility note takes priority over concentration/run-length detail within
  the 300-char budget). Fixtures below the cap produce byte-identical stats
  (guarded by contract pins; truncation path pinned via param injection and
  sparse fixtures).
- Engine-probe log pollution eliminated in tests (debt ③): `lzy doctor` under
  a scratch `HOME` used to spawn the engine probe subprocess, which wrote a
  real `zcode-<today>.jsonl` into the scratch log dir mid-run — before the
  rate-limit scan read it — flipping "empty HOME → skip" assertions. Test
  spawns now set `LZY_ZCODE_ENGINE` to a nonexistent path (candidate list is
  wholly replaced, no spawn), verified live: with suppression the scratch log
  dir is never created; 3 consecutive full-file runs stay green.
- E2E spawn helpers (`loop.e2e`, `plan-gate`, `p3-sweep`) now run with an
  isolated `HOME`, so test outcomes no longer depend on the host machine's
  real engine-log volume (the R6-era "cliff" where a ~200 MB log baseline
  passed at dusk and failed by midnight). The R6A-2 status-degradation case
  was reworked to a paired-baseline exit-code assertion, removing its hidden
  "installed on this machine" dependency.
- `lzy status` no longer dies outright when the on-disk `goal.json` carries an
  incompatible version: the loop check degrades to a `warn` line (mirroring
  the doctor-side fail-soft fallback) and every other check still prints.
- Concurrency races closed (R6 dual review): `lzy loop register` now performs
  its duplicate check and write under the cross-process lock — two concurrent
  registers could silently overwrite each other — and `lzy loop handoff`
  writes its marker under the lock, so it can no longer interleave with
  `lzy loop reset`'s marker sweep and leave an orphan that falsely releases
  the next goal's first Stop hook.
- The doctor `schedule` pricing-overlap enumeration now walks the window arc
  with wraparound: when the anchor lands in the window's tail hours (e.g.
  weekday 02:00–03:00 local for a 19:00–03:00 window), the old linear walk
  overflowed past the window end — misreporting out-of-window hours as
  in-window peak pricing while missing the window's remaining hours.

## [0.0.2] - 2026-09-08

### Added

- **Unattended mode via host automation (ADR-0003)**: schedule wake-ups with
  the engine's own scheduler — the wake prompt is `zw 继续（无人值守：…）`, the
  loop survives via SessionStart re-injection, and `lzy` stays zero-write,
  zero-scheduling-code. The wake-up protocol lives in the `zw` skill's
  Unattended section: continue only (never start a goal or adopt plans
  unattended — the decision-complete gate needs a human), bounded by the Stop
  budget and clean 429 exits, ≥1h interval.
- **Off-peak schedule advisory (`scheduleAdvisory` + doctor `schedule`
  line)**: derives the suggested automation window from the measured 429
  concentration (the 8h center of the clean arc opposite the window) — the
  timetable follows your own data instead of a guess; no concentration
  evidence → skip.
- **Layered project memory (`lazyzcode:init-deep`)**: generates or updates a
  layered AGENTS.md map — root file plus per-directory files for qualifying
  subdirectories — so the engine's native AGENTS.md auto-read has a fresh,
  lean map. Drafts first: nothing is written without explicit human approval
  (existing files get proposed patches, never silent rewrites). Depth ≤3 and
  zero flags by default (override in conversation).
- **Deterministic AGENTS.md audit (`core/agentsmd.js` + `lzy agents-md` +
  doctor `agents-md` check)**: the qualifying predicate (build entry present /
  >40 direct files / mentioned as `<dir>/` in the root file) and the coverage
  audit are pure code — reproducible across runs, auditable in review. A root
  mention doubles as a coverage declaration, so deliberate exemptions need no
  extra state file. Warn-only in doctor; root file missing = skip (adoption
  stays opt-in). Role split (model proposes / human approves / code enforces /
  doctor patrols) recorded in ADR-0002.
- **File evidence for F items (`--evidence-file`)**: attach the capture itself
  (screenshot, response dump) when closing an F item — repeatable, ≤4 files
  per item, ≤20 MB each. `lzy` copies each file into `.lazyzcode/evidence/`
  and binds sha256 + byte size next to the tree hash, so evidence survives
  `/tmp` cleanup; the `--evidence` text still has to say what the capture
  shows.
- **Evidence bundle export (`lzy loop export`, auto-archived on finish)**:
  renders the goal's review verdict, step notes, and every F item's evidence
  (tree hash, timestamps, attachment list with sha256) into
  `.lazyzcode/evidence/<slug>.report.md` — the human-readable record a
  takeover review starts from. Survives `lzy loop reset`.
- **Measured concurrency advisory (`bandAdvisory`)**: turns the doctor's
  empirical 429 data into a subagent parallelism cap — serial while a hit is
  <60 min old or the current local hour falls in the measured concentration
  window; ≤2 only on a coherent clean band; conservative serial when the band
  is incoherent. `lzy loop start` prints it as a 并发纪律 line (best-effort,
  never blocks the start; no log data → no line).
- **`zw` finish ritual**: after a loop passes finish, distill 2–3 durable,
  repo-specific lessons into the host's native project memory (skill text
  only — no new hook, per the Skill > Hook layering).
- **Rate-limit health check v3 (`lzy doctor`)**: scans the engine's local CLI
  logs (last 2 days, read-only, streamed) for account-level 429 `rate_limited`
  pressure and reports it as deduplicated hit **turns** (turnId composite-key
  dedup; falls back to first-attempt counting when turnId coverage is low),
  plus raw failure requests, fatal (judged-dead) turns, the last occurrence,
  the longest sustained-hit run, and an empirical concurrency band (coherent
  band only when buckets are clean and samples sufficient, otherwise one-sided
  evidence: a "no fixed concurrency threshold" contrast, plus — when a
  local-hour 3-hour ring window passes the 60% share / 10-turn / 100-started
  floors — the concentration window rendered in local time). Three message
  branches cover coherent band / one-sided evidence / no activity evidence;
  the advice line quotes the measured bound instead of a hard-coded number.
  Warn-only — never flips the exit code; absent logs degrade to skip. Zero
  telemetry and no new configuration surface.
- **Rate-limit discipline in the `zw` skill**: one goal loop at a time,
  serial-by-default subagents (parallel only ≤2 for independent F-item
  captures), behavioral guidance for 429-killed turns (no retry-bombing, no
  replanning, clean stop, resume via `zw 继续`), and "risk trumps quota"
  triage guidance that never lowers the HEAVY risk bar.
- **Stratified trigger matching + conditional injection text
  (`lazyzcode:zw` plugin)**: bare `zw` fires only at the start of the prompt;
  the explicit skill name `lazyzcode:zw` (full-width colon accepted) fires
  anywhere; `ulw`/`ultrawork` keep word-bounded any-position matching. The
  injected text is conditional — engage on invocation, ignore on mere mention.
  Mid-sentence `zw` no longer fires (supersedes the R4-4 CJK-adjacency
  INJECT behavior, now silent).

### Changed

- **Bilingual README in the lazycodex README form**: `README.md` is now
  English-first with a complete Chinese mirror at `README.zh-CN.md`; the two
  cross-link at the top. Structure follows the lazycodex README (MIT, credited
  under License); all text is written for LazyZCode.
- **Bilingual documentation set in the lazycodex.ai/docs form**
  (`docs/guide/en.md` + `docs/guide/zh.md`): single-scroll pages with the
  same information architecture — Install, Getting started (overview, first
  goal loop, FAQ), Triggers & protocol, Concepts (plan gate, evidence,
  continuation budget, agents, hooks, rate-limit), Reference (CLI, checks,
  state, limitations). All content derived from the actual CLI, hooks, and
  skill text.
- **GitHub Pages documentation site (Jekyll, source = `/docs`)**: dark-theme
  layout in the spirit of the lazycodex docs — sticky sidebar with the five
  nav groups, EN/ZH switcher, landing page; the guide markdown stays the
  single content source (also rendered on GitHub). Enabled after the repo
  goes public via Pages settings (step 13 of the release checklist).
- **Docs-site visual redesign ("The Verified Mark")**: new brand SVG assets
  (`mark` / `logo` / `favicon` — a Z whose final stroke lands on the evidence
  dot), a refined dark design system (layered surfaces, hairlines, single teal
  accent, scrollspy sidebar with group icons), a redesigned landing page, and
  a committed dev-only preview toolchain in `scripts/docs-preview/` (build +
  link-crawl + anchor checks; the root package stays zero-dependency).
- **Illustrated developer page (`docs/developers/en.md` + `zh.md`)**:
  hand-drawn inline SVG diagrams in the site design language — system
  architecture, goal-loop state machine, evidence staleness, hook lifecycle —
  plus extension contracts (agent roles, trigger regexes, hook output schema)
  and the build/test/preview toolchain. Served under `/developers/` via a new
  sidebar-less `page` layout and linked from the site header.
- **Theme switching (dark / light / system) across all docs pages**: a
  three-state header toggle persists to localStorage; an inline head snippet
  resolves the theme before first paint (no flash), a no-JS visitor falls
  back to `prefers-color-scheme`, system changes apply live, and the
  `theme-color` meta follows. Diagrams recolor via CSS variables.
- **Multi-device readability**: the guide sidebar collapses into a
  "On this page" toggle on small screens, wide diagrams and tables scroll
  horizontally instead of shrinking into illegibility, CJK line-height is
  relaxed, long words break safely, and touch targets grow on mobile.
- **Three-beat narrative across every entry surface**: the READMEs, the
  landing page, and the bilingual guide now tell one story — finish what you
  start (goal loop), remember what you build (project memory), keep going
  while you're away (unattended, continue-only). The READMEs catch up to the
  0.0.2 facts (two skills, `lzy agents-md` / `lzy loop export`, `agents-md` /
  `schedule` doctor checks, a "Your next moves" section); the landing page
  grows two feature cards; the guide gains dedicated Project memory and
  Unattended concept sections.

## [0.0.1] - 2026-09-06

First release: the AI coding-workflow discipline layer for ZCode —
plan, execute, take evidence, never stop half-done.

### Added

- **Goal loop CLI (`lzy loop` / `lzy step`)**: register a goal, adopt a
  decision-complete plan (N/F checklist; TBD items rejected), execute step by
  step, bind F-item evidence to `git rev-parse HEAD^{tree}`, and pass the
  `finish` gate (all steps done + fresh evidence) before declaring victory.
- **Discipline plugin**: `lazyzcode:zw` skill (English orchestration protocol),
  UserPromptSubmit trigger-word hook (`zw`/`ulw`/`ultrawork`, word-boundary
  match), SessionStart loop-state re-injection, and a Stop continuation hook
  (max 2 per session — the engine's shared 3-continue pool reserves 1 for
  background notifications; per-sessionId counters; fail-open on any error).
- **Comment-checker advisory hook**: PostToolUse (Edit/Write) detection of
  TODO/FIXME/XXX/HACK markers and debug residue (`console.log`, `console.debug`,
  `debugger`) in new content, surfaced via `additionalContext` (inject-only,
  never blocks; active only in workspaces with a goal loop; capped at 5 hits,
  300 chars).
- **Read-only discipline agents**: `lazyzcode:explorer` (pre-plan recon with
  codegraph index guidance for large repos), `lazyzcode:plan-reviewer`
  (mandatory HEAVY plan gate — REVISE verdicts reject adoption, `--force`
  cannot bypass), `lazyzcode:qa-executor` (real-surface evidence capture;
  ego-browser/curl for web surfaces).
- **Installer**: `lzy install` / `sync` / `status` / `doctor` / `uninstall`.
  Enabling flows only through the engine's official `plugins enable`;
  `lzy` never writes the user's `config.json` (ADR-0001). `lzy doctor` adds
  hook syntax self-check (vm-parse only, incl. hooks.json registry validation), node version floor, `lzy` PATH-shim
  report, `.lazyzcode/` state hygiene and platform notice — fully local,
  zero telemetry.
- **codegraph wiring**: `lzy status` reports codegraph availability
  (MCP config + CLI; absence is `skip`, never `fail`).

### Notes

- macOS-only engine layout; other platforms report "not found" instead of
  guessing.
- Published artifacts ship `cli/`, `core/`, `plugin/` plus README/LICENSE/
  CHANGELOG; session-state and tool directories are excluded.

### Fixed (2026-09-07 · P3 sweep + hook spawn-env hardening)

- **Hooks now survive node-less engine environments**: the engine spawns hook
  commands with its own env PATH, which lacks node when ZCode.app is launched
  from the Dock (all four hooks then fail silently — node ENOENT happens before
  any fail-open can run). All hook commands now route through
  `plugin/hooks/run-hook.sh` (PATH lookup → nvm/homebrew fallback → log + exit 0);
  `lzy doctor` gained a `hook-node` check. Full analysis:
  `docs/diagnostics/2026-09-07-hook-spawn-env.md`.
- Session ids are sanitized before being used in state file names; the Stop
  counter read-modify-write is lock-guarded (concurrent same-session hooks can
  no longer over-issue the 2-continue budget); hook output is written with a
  single synchronous `write(2)`.
- Registry writes are now byte-idempotent (repeat installs no longer bump
  `updatedAt`); `uninstall` reports "nothing installed" honestly; `status`
  verifies the deployed payload file-by-file and attributes engine diagnostics
  by structured fields.
- CLI arg parsing: `--force=true` works, `--force` no longer swallows a
  following path; `--note`/`--evidence` length caps (300/4000); incompatible
  goal-state versions fail fast with a reset pointer; `lzy loop reset` also
  clears session counters and orphan tmp files; `--watch=<value>` warns instead
  of silently degrading; `LZY_ZCODE_ENGINE` now replaces the candidate list,
  making the engine-missing fallback testable.
- comment-checker: line hints are labeled as fragment-relative (`片段L2`),
  and the 300-char cap applies to the whole injected message.
