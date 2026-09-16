# LazyZCode Documentation

**English** · [简体中文](zh.md)

The complete guide to the discipline layer for ZCode: plan → execute →
take evidence → never stop half-done.

| | |
| --- | --- |
| **Install** | [Installation](#installation) · [Recommended environment](#recommended-environment) |
| **Getting started** | [Overview](#overview) · [Your first goal loop](#your-first-goal-loop) · [FAQ](#faq) |
| **Triggers & protocol** | [Trigger words](#trigger-words) · [The zw protocol](#the-zw-protocol) · [Goal loop commands](#goal-loop-commands) |
| **Concepts** | [The plan gate](#the-plan-gate) · [Evidence discipline](#evidence-discipline) · [The continuation budget](#the-continuation-budget) · [Discipline agents](#discipline-agents) · [Hooks & lifecycle](#hooks--lifecycle) · [Rate-limit discipline](#rate-limit-discipline) |
| **Reference** | [CLI reference](#cli-reference) · [Diagnostics](#diagnostics) · [State & configuration](#state--configuration) · [Compatibility & limitations](#compatibility--limitations) |

---

## Installation

One package installs both halves of LazyZCode: the `lazyzcode:zw` plugin
(skills, hooks, agents) and the `lzy` CLI (the goal-loop state machine).

### Prerequisites

- **macOS, Windows, or Linux** — LazyZCode detects the ZCode engine layout on
  all three (macOS app bundle, Linux deb `/opt/ZCode`, Windows per-user
  `%LOCALAPPDATA%\Programs\ZCode`); nothing is guessed.
- **ZCode desktop app**, installed and logged in. LazyZCode runs *inside*
  ZCode; there is no separate login.
- **Node.js ≥ 22** — any maintained LTS. Installed via nvm or Homebrew both
  work: the bundled hook launcher scans both locations when the engine's hook
  environment lacks `node` (Windows resolves via nvm-windows/Program Files;
  see [Hooks & lifecycle](#hooks--lifecycle)).
- **git** — evidence binding uses `git rev-parse HEAD^{tree}`, so the project
  you work in must be a git repository.

### Install

```bash
npm i -g lazyzcode
lzy install
```

`lzy install` does three things: deploys the plugin payload to the engine's
plugin cache, writes LazyZCode's own registry entry, and enables the plugin
through the engine's official `plugins enable` command. It **never writes your
`config.json`** — enabling flows only through the engine's own CLI
([ADR-0001](../adr/0001-installer-enable-via-engine-cli.md)).

### Verify it worked

```bash
lzy status   # quick check; exit code 0 = no fail-level findings
lzy doctor   # deep local diagnostics (zero telemetry)
```

Inside a fresh ZCode session, type `zw` at the start of a prompt — the
orchestration bootstrap should arrive, and the model's first line should read
`**ZW** engaged — LIGHT tier` (or HEAVY).

### Uninstall

```bash
lzy uninstall
```

Removes the deployed cache and the registry entry, preferring the engine's
official `plugins uninstall` path.

## Recommended environment

| Item | Recommendation | Notes |
| --- | --- | --- |
| Operating system | **macOS, Windows, or Linux** | Engine layout detection covers all three (ADR-0011). |
| ZCode app | Desktop, logged in | Hooks and the plugin load through the desktop engine. |
| Node.js | ≥ 22, via nvm or Homebrew | The `hook-node` doctor check reports exactly which resolution path your hooks will use. |
| Project | A git repository | Evidence binding requires commits to exist; F-item evidence is captured **after** a commit. |
| Launch style | Either | Launching ZCode from the terminal or the Dock both work; the Dock case is handled by the `run-hook` launcher. |

## Overview

LazyZCode installs four things:

1. **One plugin** (`lazyzcode:zw`) whose skill text carries the full
   orchestration protocol — triage, tier selection, planning, execution, and
   evidence rules.
2. **Five hooks** wired to the engine's lifecycle: SessionStart (re-inject
   loop state), UserPromptSubmit (trigger words), PostToolUse (comment
   advisory), PostToolUseFailure (same-tool failure tripwire), Stop
   (bounded continuation).
3. **Three read-only agents**: `lazyzcode:explorer`,
   `lazyzcode:plan-reviewer`, `lazyzcode:qa-executor`.
4. **One CLI** (`lzy`) implementing the goal loop as a state machine that
   survives session restarts: register → plan gate → execute → evidence →
   finish gate.

The mental model: a plan checkbox is a *claim*; only real-surface evidence is
a *fact*. LazyZCode's job is to make the agent convert claims into facts — and
to pull it back when it tries to stop before that conversion is complete.

## Your first goal loop

Open a fresh ZCode session in your project and type:

```
zw implement a CSV export endpoint with tests
```

What happens:

1. The UserPromptSubmit hook matches the sentence-initial `zw` and injects the
   orchestration bootstrap.
2. The model announces `**ZW** engaged — <tier> tier` and triages the task
   (see [The zw protocol](#the-zw-protocol)).
3. It registers a goal with the CLI (`lzy loop register …`) and writes a plan
   file into `.lazyzcode/plans/`.
4. The plan is adopted through the plan gate — HEAVY plans must first pass the
   `lazyzcode:plan-reviewer` agent.
5. The model executes step by step, calling `lzy step done <ID>` as steps
   complete. F items require `--evidence` bound to the current tree hash.
6. `lzy loop finish` runs the final gate: all steps done, all evidence fresh.
   Only then is the goal complete.

If the model stops while the loop is open, the Stop hook pulls it back — at
most 2 continuations per session. To resume after an interruption (including a
rate-limit kill), just send `zw continue` (`zw 继续`); the loop state in
`.lazyzcode/` is untouched.

To free the slot after a finished loop, run `lzy loop reset`.

## FAQ

**Where does LazyZCode keep its state?**
In `.lazyzcode/` inside your project (loop state, plans, archived evidence).
It is deliberately separate from ZCode's own `.zcode/`. Add it to your
`.gitignore` if you do not want to commit it.

**Does it phone home?**
No. Zero telemetry. Everything `lzy doctor` reports is computed locally from
your own files and engine logs.

**Does it write my `config.json`?**
Never. Enabling goes through the engine's official `plugins enable`; the
installer only deploys files and writes LazyZCode's own registry.

**Why didn't my `zw` trigger?**
Matching is stratified: a bare `zw` fires only at the start of the prompt.
Mid-sentence `zw` is ignored (that is intentional — "check the `zw` hooks" is
a question, not an invocation). Use the explicit `lazyzcode:zw` anywhere, or
`ulw`/`ultrawork` anywhere word-bounded.

**Why did `lzy loop finish` reject my evidence?**
Evidence is bound to the tree hash of the commit that was current when it was
captured. If you changed code after capturing, the evidence is stale by
construction — commit, then re-capture with
`lzy step done <ID> --evidence …`.

**I hit `[1302] rate limit`. Is LazyZCode broken?**
No — that is the GLM plan's account-level concurrency limit. `lzy doctor`'s
`rate-limit` line reports your measured pressure and a suggested session
budget. See [Rate-limit discipline](#rate-limit-discipline).

**My hooks do nothing at all.**
Your engine was probably launched without `node` on its PATH (common when
ZCode.app starts from the Dock). The bundled `run-hook` launcher resolves
node automatically — nvm/Homebrew on POSIX, nvm-windows/Program Files on
Windows; `lzy doctor`'s `hook-node` line tells
you what it found. Details in
[docs/diagnostics/2026-09-07-hook-spawn-env.md](../diagnostics/2026-09-07-hook-spawn-env.md).

**Can I run two goal loops at once?**
One loop per project directory. A finished loop still occupies the slot until
`lzy loop reset` clears it.

**Can I use the CLI without the plugin (or vice versa)?**
Yes. The CLI works anywhere; the plugin needs the engine. The workflow works
best with both — the hooks and skill text drive the discipline that the CLI
enforces.

## Trigger words

| Trigger | Fires | Example |
| --- | --- | --- |
| `zw` | **Start of the prompt only** (leading whitespace allowed) | `zw fix the flaky test` |
| `lazyzcode:zw` | Anywhere; full-width colon `：` accepted | `explain what lazyzcode:zw does`* |
| `ulw` / `ultrawork` | Anywhere, word-bounded | `ultrawork this refactor` |
| `/zw` or the Skill tool | Explicit invocation | — |

\* that example does **not** engage the loop — it is a *mention*. Injection is
conditional: an invocation engages the protocol; a mere mention is ignored and
answered directly ("Mention ≠ invocation"). `zwift`, `azw`, and mid-sentence
`zw` never fire.

## The zw protocol

The injected skill text (`plugin/skills/zw/SKILL.md`) defines the contract the
model follows:

1. **Open** with exactly `**ZW** engaged — <LIGHT|HEAVY> tier`.
2. **Triage the tier.** LIGHT for small, contained, low-risk work (a 1–2 item
   plan, one F item). HEAVY for multi-file features, architecture, or anything
   risky or vague — explore first, plan every step. Escalating LIGHT → HEAVY
   is always allowed — and persisted: register with `--tier heavy` or run
   `lzy loop tier heavy` before adopting (the HEAVY review gate is enforced by
   the machine off the persisted tier). **Downgrading is never allowed.**
3. **Register** the goal with the CLI.
4. **Plan** with an N/F checklist (see [The plan gate](#the-plan-gate)).
5. **Execute** step by step, committing work and calling
   `lzy step done <ID>` with notes — and evidence for F items.
6. **Capture evidence** on real surfaces (see
   [Evidence discipline](#evidence-discipline)).
7. **Finish** through the CLI gate (see
   [Goal loop commands](#goal-loop-commands)).

The protocol also carries behavioral red lines (no fake evidence, no silent
scope abandonment) and the rate-limit rules below.

## Goal loop commands

```
lzy loop register <slug> --title "…" [--tier heavy]   # planning state; tier defaults to light
lzy loop plan <file> [--review "…"] [--force]
lzy loop start                          # records the base tree hash + prints the measured 并发纪律 advisory
lzy loop subject add <path>             # declare a sibling repo root (executing-only; validated: git repo, no containment)
lzy loop subject remove <path>          # remove a subject (missing-deadlock escape; evidence invalidation semantics apply)
lzy loop subject list                   # list the subject set (empty = host-only)
lzy loop tier heavy                     # tier upgrade, one-way (machine gate is adoption-time)
lzy loop claim [<id>] [--release]        # per-step claim (anonymous, 48h mutex); bare lists claimable steps
lzy step done <ID> [--note "…"] [--evidence "…"] [--evidence-file <file>]…
lzy loop status                         # progress, next step, evidence freshness, tier/subjects/snapshot
lzy loop verify                         # evidence freshness audit (exit 1 = stale/unbound); prints per-tree head/dirty lines
lzy loop finish                         # the final gate: fresh composite fingerprint + all trees clean; auto-archives
lzy loop export                         # re-export the evidence bundle
lzy loop handoff --snapshot <file>      # register a clean handoff; next Stop releases once
lzy loop cost                           # points report (standing coefficients + promo overlay, read-only)
lzy loop list [--root <dir>]            # read-only sweep of sibling repos' goal loops
lzy loop history                        # goal lineage (evidence ∪ stubs ∪ trailers, read-only)
lzy loop abandon | lzy loop reset       # give up / clear state
```

- `lzy loop plan` parses the N/F checklist and rejects undecided (TBD) items.
  Pass the plan-reviewer verdict with `--review "plan-reviewer: PASS …"`;
  a `REVISE` verdict is refused even with `--force`, and for HEAVY goals
  (persisted tier) adoption without a PASS verdict is machine-rejected. Adoption
  snapshots the plan into `.lazyzcode/loop/snapshots/<slug>.md` and binds
  `goal.planHash` (review records carry it too — the review binds the reviewed
  artifact; re-adopting an amended plan requires a fresh review). A
  `deps: N1,N2` line right after an item declares prerequisites — ids must
  exist, and self-loops, cycles, or orphan `deps:` lines are rejected (quoting
  the syntax in prose? end that line with `<!--lzy:allow-->`).
- `lzy loop start` freezes the base tree hash; drift is reported against it.
  It also prints a 并发纪律 line — a subagent parallelism cap computed from
  your measured 429 data (see [rate-limit discipline](#rate-limit-discipline)).
- `lzy step done` on an F item without `--evidence` is refused. Re-running
  with new evidence re-binds it (marked ↻ re-captured). `--evidence-file`
  (repeatable, ≤4 per F item) attaches the capture itself — screenshots,
  response dumps; `lzy` copies each file into `.lazyzcode/evidence/` and binds
  its sha256 next to the tree hash.
- `lzy loop finish` archives an evidence bundle to
  `.lazyzcode/evidence/<slug>.report.md` (review verdict, step notes, F-item
  evidence with attachments) — atomically: the report is written before the
  goal flips to `done`, so a failed archive leaves the goal `executing` with a
  recovery path instead of a done state with no report. The integrity gate
  additionally requires every `{host}∪subjects` root clean — dirty, missing,
  or git-error roots all reject (no bypass flag). `lzy loop export` re-exports
  any time.
- `lzy loop verify` is the audit-only variant of the finish gate (exit 1 when
  evidence is stale or unbound, or when no goal exists).
- `lzy loop claim` provides anonymous per-step claiming for same-goal
  multi-worker runs: 48h mutual exclusion, blocked-step rejection against the
  plan's `deps:` edges, `lzy step done` auto-releases, `--release` frees
  early, and the bare form lists claimable steps (`lzy loop status` marks
  `[claimed]`/`[blocked: …]`).
- `lzy loop handoff --snapshot <file>` registers a clean handoff: the next
  Stop consumes the marker once and releases the session without spending the
  continue budget (the goal stays `executing`; state lives on disk).
  The snapshot must exist, have been modified within 2h, and contain all seven
  mandatory sections (remaining steps / next action / goal & progress / dirty-tree
  list / tree hash / risks / resume command — missing or empty sections are
  rejected; template in zw's Continuation section). `lzy loop reset` sweeps a
  leftover marker (abandon leaves it; reset before re-registering). Each
  registration and consumption increments anonymous counters in
  `.lazyzcode/loop/metrics.json` (`registered`/`consumed`, no session
  identity); they survive reset and surface in `lzy status`/`lzy loop status`.
- `lzy loop list` is a read-only diagnostic: it scans one level of sibling
  directories (default anchor: the parent of the current directory, itself
  included; `--root` overrides) and prints each repo's goal slug, status,
  step progress, claims, staleness and salvage stubs. One unreadable repo
  never breaks the sweep — it prints a `版本不符` row instead.
- `lzy loop abandon` gives up while keeping the record; `lzy loop reset`
  clears state (including session counters and orphan temp files) so the next
  loop can start.

## The plan gate

Plans are markdown checklists with two item kinds:

```markdown
- [N1] Implement the export endpoint in src/api/export.ts
- [N2] Add CSV serialization with quoting rules
deps: N1
- [F1] `curl localhost:3000/export` returns 200 and parses as CSV (qa-executor)
```

- **N items** (implementation) describe work.
- **F items** (final verification) name a **real surface** and the evidence
  that will be captured on it. A plan without F items does not pass.
- **Subjects (optional, multi-tree goals)**: `subjects: <path>` header lines —
  one path per line, header-only (before the first item), relative paths
  resolve against the host root. Each must exist, be a git repo, and be a
  sibling (no containment either way with the host). Declared subjects join
  the evidence fingerprint and the finish gate; any later
  `subject add`/`remove` invalidates all captured F evidence.
- **Dependency edges (optional)**: a bare lowercase `deps:` line immediately
  after an item lists case-sensitive N/F ids (deduplicated). Unknown refs,
  self-loops, cycles, and orphan `deps:` lines are rejected loudly.
- The plan must be **decision-complete**: no TBDs, no "decide later". The gate
  rejects undecided items at adoption time. (If your plan legitimately needs
  the literal string, a line-level `<!--lzy:allow-->` marker exempts it.)
- HEAVY goals (persisted tier) additionally require a **plan-reviewer PASS**
  recorded via `--review` — machine-enforced at adoption: any non-PASS string
  (including none at all) is rejected and `--force` cannot bypass it. The
  reviewer checks decision-completeness, hidden risks, and whether every F
  item names a capturable surface.

## Known unknowns

Decision-complete means *no undecided choices* — not *no unverified premises*.
A HEAVY plan therefore ends with an explicit **known-unknowns** section: 1–3
assumptions the plan silently rests on, each with a **falsification path**
(the signal that would prove it wrong, and how to check). Writing "none" is
allowed, but must say in one line where you looked.

The section complements the plan gate rather than softening it: it states
unverified premises, not postponed decisions — and the gate still scans every
line of it, so an actual TBD inside the section is rejected like anywhere
else. The plan-reviewer audits it against hidden risks: is every entry
falsifiable, and is a "none" credible?

## Evidence discipline

- Evidence comes from a **real surface**: a CLI's stdout, an HTTP response, a
  screenshot — not from the model's own summary, and not merely "tests are
  green" (a test run is one surface among several).
- Evidence is bound to the **composite fingerprint** — the sha256 over every
  `{host}∪subjects` root's HEAD tree hash (`git rev-parse HEAD^{tree}` per
  root). **Commit first, capture after.** Uncommitted changes do not count,
  and any subject root changing — or the subject set itself changing — makes
  the evidence stale. Legacy evidence (recorded before 0.0.8) compares the
  single host tree, unchanged.
- **Red-green evidence (dual evidence).** By default every F-item claim needs
  two halves: a **red** capture of the assertion failing on the pre-change
  state (taken before you edit) and a **green** capture of it passing after.
  If no counter-state can be constructed for the surface, say so in a one-line
  exemption inside the evidence text — an exemption explains, it does not
  silently skip.
- The moment the code changes, old evidence is stale *by construction*. The
  finish gate re-checks freshness and rejects stale or unbound evidence.
- Captured material can be archived under `.lazyzcode/evidence/`.
- The `lazyzcode:qa-executor` agent exists for this: spawn it to run the
  capture and report what it actually observed, verbatim.
- **Evidence comparison (comparator).** Existence and freshness are checked
  mechanically; whether the evidence actually *demonstrates* the claim is not —
  no CLI can read meaning. So HEAVY goals dispatch `qa-executor` in comparator
  mode before `finish`: each F item's assertion is held against its captured
  evidence, and a `不匹配` verdict sends you back for a real re-capture (or an
  honest plan amendment). Proving a slightly different theorem than the one
  stated is still not proving it.

## The continuation budget

ZCode grants each session a shared pool of **3** stop-continuations, which
background task notifications also draw from. LazyZCode's Stop hook spends at
most **2 per session**, deliberately reserving 1. Counters are isolated per
`sessionId` (a probe that counted globally once hijacked an unrelated session
— that constraint is now structural). Any hook error **fails open**: the loop
never traps a session it does not own, and the user's explicit stop always
wins once the budget is spent.

SessionStart re-injects the loop state, so a fresh session continues where
the previous one stopped.

## Project memory

Planning heavily against a codebase nobody has mapped wastes the plan gate.
`lazyzcode:init-deep`, the plugin's second skill, builds **layered project
memory**: a root `AGENTS.md` map plus maps for qualifying subdirectories
(build entry points, directories with 40+ files, directories the root already
mentions). ZCode reads `AGENTS.md` natively, so the map rides into every
future session — no hook required.

The skill is conservative by contract: it drafts first and writes only after
your approval; existing files receive patch suggestions, never overwrites;
secrets and machine-local paths stay out. It touches only the `AGENTS.md`
layer — personal lessons go to the host's native memory at a zw finish.

`lzy agents-md` lists qualifying directories and coverage gaps; `lzy doctor`'s
`agents-md` line audits adoption (warn-only: a repo without a root map is
skipped, not nagged). HEAVY planning consults the map when one exists.

## Unattended

Unattended mode is the same goal loop on a schedule. The engine's built-in
automation wakes a fresh session with `zw continue (unattended: …)`; the wake
cadence is off-peak by design — `lzy doctor`'s `schedule` line derives an
8-hour window opposite your measured rate-limit concentration hours, then
cross-checks it against known platform pricing peaks (GLM / DeepSeek, a
static UTC+8 table maintained by hand) and always states the pricing-safe
nightly window. The table can go stale — treat the line as measured
rate-limit data plus declared pricing, not a guarantee.

The guardrail is structural, not a promise: an unattended session **continues
the open goal only** — it never registers a new goal and never writes or
adopts a plan, because the decision-complete gate needs a human. With nothing
to continue it exits cleanly, and the wake-up itself is bounded by the
continuation budget, fatal-429 handling, serial subagents, and ≥1-hour
spacing between runs.

No need to wait for your laptop for the overnight digest: push the results to
**your own** IM bot webhook (zero servers — `lzy` ships no notification
channel of its own). Recipe: [unattended notify](../unattended-notify.md).

## Discipline agents

Three read-only roles ship in the plugin's `agents/` directory and are
auto-discovered by the engine. Spawn them via the Agent tool with the role as
`subagent_type`:

| Role | Use it for |
| --- | --- |
| `lazyzcode:explorer` | Pre-plan reconnaissance: map the relevant code area, answer the planner's questions with `file:line` evidence. Can use a codegraph index on large repos. |
| `lazyzcode:plan-reviewer` | The plan review gate: audits decision-completeness, N/F well-formedness, real F-item surfaces, hidden risks. Returns `VERDICT: PASS` or `VERDICT: REVISE`. |
| `lazyzcode:qa-executor` | Evidence execution: run one F-item verification on the real surface and report exactly what it observed — commands and raw output. It fights evidence fabrication. |

All three are read-only: they never edit code, and their value is that their
findings come from the repository, not from the main agent's assumptions.

## Hooks & lifecycle

| Hook | Event | Does |
| --- | --- | --- |
| `session-start.js` | SessionStart | Re-injects goal-loop state so a new session picks up where the last stopped. |
| `trigger.js` | UserPromptSubmit | Stratified trigger matching; injects the zw bootstrap on invocation. |
| `comment-checker.js` | PostToolUse (Edit/Write) | Advisory detection of `TODO`/`FIXME`/`XXX`/`HACK` markers and debug residue (`console.log`, `console.debug`, `debugger`) in new content. Capped at 5 hits, 300 characters, inject-only — and only active in workspaces with an open goal loop. |
| `stop.js` | Stop | Requests continuation (max 2/session) with the remaining-steps context while a loop is open; consumes a registered handoff marker once and releases without spending the budget. |
| `tripwire.js` | PostToolUseFailure (`^mcp__`) | Warns once when the same MCP tool fails twice inside a 10-minute window (successes don't reset the streak — the TTL does). Steers toward switching tools or closing cleanly via `lzy loop handoff`; inject-only, isInterrupt-exempt, only active with an open goal. |

All five commands route through `plugin/hooks/run-hook`: the engine spawns
hooks with *its own* environment, and a GUI-launched ZCode may have no `node`
on PATH. One manifest line serves both platform families — POSIX shells
execute the extensionless `run-hook` script, while on Windows cmd.exe resolves
the same name to the `run-hook.cmd` twin via PATHEXT. The launcher falls back
to nvm (highest version) and Homebrew locations on POSIX (nvm-windows and
Program Files on Windows), logs to `/tmp/lzy-hook-launcher.log`
(`%TEMP%\lzy-hook-launcher.log` on Windows), and exits 0 (fail-open) if
everything is missing. `lzy doctor`'s `hook-node` check reports the resolved
path.

## Rate-limit discipline

GLM plans enforce an **account-level** concurrency limit (`[1302]` / 429).
There is no fixed threshold you can configure around: measured headroom varies
by plan tier, time of day, and account state — `lzy doctor` measures it from
your engine logs (last 2 days) and reports deduplicated 429 **turns**, fatal
turns, the longest sustained run, and — when the data is coherent — an
empirical concurrency band ("N sessions clean / M sessions collide"). Warn
only; it never flips the exit code.

Behavioral rules the zw skill carries:

- **One goal loop at a time**; parallel main sessions kept few.
- Subagent parallelism is **measured, not guessed**: `lzy loop start` prints a
  并发纪律 cap from the same data — serial while a hit is recent or the
  current hour falls in the measured concentration window; ≤2 on a coherent
  clean band, or when the window has no 429s at all (skill default,
  independent captures only).
- **Risk trumps quota**: quota pressure may pick LIGHT at triage; it never
  lowers a HEAVY risk bar.
- After a fatal 429 (a turn judged dead after the engine's retries): stop
  cleanly, wait a few minutes, then `zw continue` — the loop state survives.
- **Transport deaths are a different family**: the request never left your
  machine (`ENETDOWN` and friends; the engine often mislabels them as
  non-retryable). Same recovery contract — close cleanly and nothing in
  `.lazyzcode/` is lost; `lzy doctor`'s `transport` line keeps a separate
  tally (never mixed into the quota math).
- **Content-moderation kills are a third family**: the stream opens fine and
  the server's content filter kills it mid-generation (`1301` — either the
  input or the generated text can trip it; the engine often mislabels it as
  `reason=unknown`). An in-place retry reproduces deterministically — close
  cleanly and resume in a NEW session, or rephrase so the model takes a
  different reasoning path; `lzy doctor`'s `content` line keeps a separate
  tally (never mixed into the quota math).
- **Repo-wiki generation shares your pool**: the desktop app's repo-wiki
  feature runs as a background lane on the same account model quota — while a
  large repo wiki is generating, avoid stacking dense unattended wake-ups on
  top of it.

**Unattended (host automation)**: scheduling and the continue-only protocol
live in [Unattended](#unattended); the window comes from `lzy
doctor`'s `schedule` line — your own measured concentration hours cross-checked
against declared pricing peaks, not a guess.

## CLI reference

Project memory: the `lazyzcode:init-deep` skill generates a layered AGENTS.md
map (root + qualifying subdirectories), drafts first — nothing is written
without your approval; `lzy doctor` patrols coverage on every run.

```
lzy install                     deploy plugin + registry + official enable
lzy sync [--watch]              re-deploy payload (hot reload; --watch keeps watching)
lzy status                      quick health check (exit 0 = no fail-level findings)
lzy doctor                      deep local diagnostics (zero telemetry)
lzy uninstall                   remove cache + registry entry
lzy loop register <slug> --title <t> [--tier heavy]   create the goal (planning; HEAVY adoption without PASS review is machine-rejected)
lzy loop plan <file> [--review <v>] [--force]   adopt the N/F checklist (snapshots plan + binds planHash)
lzy loop start                  planning → executing; records base tree hash + 并发纪律 advisory
lzy loop subject add <path>     declare sibling repo root (executing-only; validated, dedup'd)
lzy loop subject remove <path>  remove a subject (missing-deadlock escape)
lzy loop subject list           list the subject set
lzy loop tier heavy             tier upgrade, one-way (adoption-time machine gate)
lzy loop claim [<id>] [--release]  per-step claim (multi-worker; blocked-step checks; 48h mutex)
lzy loop status                 progress, next step, evidence freshness, tier/subjects/snapshot
lzy loop verify                 evidence freshness audit (exit 1 = stale/unbound/no goal); per-tree head/dirty lines
lzy step done <ID> [--note <t>] [--evidence <t>] [--evidence-file <f>]…
lzy loop finish                 final gate: all done + fresh composite fingerprint + all {host}∪subjects trees clean; atomic archive
lzy loop export                 re-export the evidence bundle (<slug>.report.md)
lzy loop cost                   points report (coefficients + promo overlay, read-only)
lzy loop list [--root <dir>]    cross-repo goal-loop sweep (read-only)
lzy loop history                goal lineage (evidence ∪ stubs ∪ trailers, read-only)
lzy loop abandon                give up, keep the record
lzy loop reset                  clear loop state (incl. session counters, orphan tmp)
lzy agents-md                   layered AGENTS.md audit (exit 1 = gaps/overcaps)
lzy version                     print version
```

Flags: `--note` is capped at 300 chars, `--evidence` at 4000, `--evidence-file`
is repeatable (≤4 per F item, each ≤20 MB); `--force=true` and `--force` are
equivalent; `--watch=<value>` warns (it takes no value).

## Diagnostics

`lzy status` runs the base checks; `lzy doctor` runs those plus the deeper
ones. Exit code: **fail** findings flip it to 1; **warn** and **skip** never
do.

| Check | Meaning |
| --- | --- |
| `payload` | Repo plugin manifest readable |
| `install` | Registry entry present and healthy |
| `files` | Deployed cache matches the repo payload, file by file |
| `enabled` | The engine lists the plugin as enabled |
| `codegraph` | Codegraph MCP/CLI availability (absence = `skip`) |
| `loop` | Goal-loop progress in this directory (skip when none; warns while a loop is open) |
| `hooks` | Hook syntax self-check (vm-parsed in a worker) + `hooks.json` registry validation |
| `node` | Node version floor (≥ 22) |
| `hook-node` | Which path the hook launcher resolves node from |
| `lzy-path` | Whether `lzy` resolves on PATH |
| `state` | `.lazyzcode/` hygiene (orphan temp files, goal state) |
| `claims` | Claim patrol: who claimed the open goal loop, stuck markers; zero claims = "unclaimed" notice (warn, never flips the exit code) |
| `handoff` | Handoff marker present (the next Stop consumes it and releases) |
| `handoff-usage` | Anonymous release counters, registered/consumed (survive reset) |
| `ledger` | Commit-ledger patrol: share of goal-era commits missing the `Goal:` trailer (warn, never flips the exit code) |
| `waterline` | Rolling 5-hour point burn vs the self-calibrated nudge threshold (degraded note when sqlite3 is absent) |
| `orphan-wake` | Idle-burn patrol for unbound wake automations anchored here (skip when none mounted) |
| `platform` | Engine-candidate notice per platform (ok + path when the desktop engine is found) |
| `agents-md` | Layered AGENTS.md coverage audit + staleness hint (≥50 covered-dir commits since the map's last commit; skip when no root file; `lzy agents-md` for details) |
| `rate-limit` | GLM plan 429 pressure from the last 2 days of engine logs |
| `transport` | Transport deaths (request-never-reached-server failures, e.g. ENETDOWN): counted as a separate family, never fed into the concurrency math |
| `content` | Content-moderation kills (provider content-filter mid-stream kills, e.g. 1301): counted as a separate family; an in-place retry reproduces, never fed into the concurrency math |
| `band-by-provider` | Per-provider empirical band (completed-side clean × 429 dirty buckets); emitted only when the window has ≥1 429 and ≥2 providers — providers without 429s of their own are honestly labeled "no dirty-face sample" |
| `cost` | Model-tier advisory ("success → try lighter tier"): a zero-429 window with a low rolling waterline suggests a lighter tier for routine goals; advisory text only |
| `schedule` | Off-peak advisory: automation window from the measured concentration, cross-checked against declared pricing peaks with a safe-window note; hand-maintained UTC+8 pricing table (skip without evidence) |

## State & configuration

LazyZCode has **no configuration file**. Everything is derived:

| Path | Contents |
| --- | --- |
| `.lazyzcode/loop/goal.json` | Current goal: steps, statuses, evidence bindings |
| `.lazyzcode/loop/sessions/<sessionId>.json` | Per-session Stop-hook counters |
| `.lazyzcode/loop/salvage/<slug>.md` | Salvageable-artifact stubs written when a loop is reset/abandoned (uncommitted changes, footnoted commits, asset pointers); `lzy loop status` surfaces them in both the no-goal and goal-present views |
| `.lazyzcode/plans/<slug>.md` | Plan documents |
| `.lazyzcode/evidence/` | Archived evidence material |
| engine plugin cache | Deployed payload (managed by `lzy install`/`sync`) |
| LazyZCode registry | Install records (managed by the installer) |

Environment: `LZY_ZCODE_ENGINE` replaces the default engine candidate list
(default: `/Applications/ZCode.app/Contents/Resources/glm/zcode.cjs`). That is
the entire configuration surface.

Privacy: zero telemetry; diagnostics are computed locally and printed locally.

## Compatibility & limitations

- **macOS, Windows, and Linux** are supported for engine detection and the
  full install chain (ADR-0011); the distribution matrix is arm64-live-verified
  (Windows 11 / Ubuntu ARM VMs), x64 coverage follows the official download
  matrix by documentation.
- **Headless** driving of the engine (`--prompt`) needs the desktop's injected
  model credentials; the mechanism is probe-validated, live headless
  acceptance is deferred.
- **One goal loop per project directory**, and a finished loop occupies the
  slot until `lzy loop reset`.
- Trigger matching is deliberately stratified — if you want the loop from
  mid-sentence, say `lazyzcode:zw` or `ultrawork`.

---

*LazyZCode is MIT-licensed. The workflow is inspired by
[lazycodex](https://github.com/code-yeongyu/lazycodex) (MIT);
[oh-my-openagent](https://github.com/code-yeongyu/oh-my-openagent) (OmO,
SUL-1.0) contributed ideas only. Documentation structure follows the
lazycodex docs with credit.*
