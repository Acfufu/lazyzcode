# Changelog

All notable changes to LazyZCode. Format inspired by Keep a Changelog;
versioning is SemVer.

## [0.0.5] - unreleased

> 0.0.5 is the internal-hardening release: the parallel-claim minimal chain
> lands (decision #21 upgraded from debt per owner grilling 2026-09-13/14),
> plus the cost two-piece and two loose ends. Publishing waits for 0.0.6
> (owner decision 2026-09-14).

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
