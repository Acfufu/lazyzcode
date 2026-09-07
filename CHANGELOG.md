# Changelog

All notable changes to LazyZCode. Format inspired by Keep a Changelog;
versioning is SemVer.

## [Unreleased]

### Added

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
