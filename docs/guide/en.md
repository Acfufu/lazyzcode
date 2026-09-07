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

- **macOS** — LazyZCode detects the ZCode engine layout on macOS only; other
  platforms report "not found" instead of guessing.
- **ZCode desktop app**, installed and logged in. LazyZCode runs *inside*
  ZCode; there is no separate login.
- **Node.js ≥ 20** — any maintained LTS. Installed via nvm or Homebrew both
  work: the bundled hook launcher scans both locations when the engine's hook
  environment lacks `node` (see [Hooks & lifecycle](#hooks--lifecycle)).
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
| Operating system | **macOS** | The only platform with engine layout detection today. |
| ZCode app | Desktop, logged in | Hooks and the plugin load through the desktop engine. |
| Node.js | ≥ 20, via nvm or Homebrew | The `hook-node` doctor check reports exactly which resolution path your hooks will use. |
| Project | A git repository | Evidence binding requires commits to exist; F-item evidence is captured **after** a commit. |
| Launch style | Either | Launching ZCode from the terminal or the Dock both work; the Dock case is handled by the `run-hook.sh` launcher. |

## Overview

LazyZCode installs four things:

1. **One plugin** (`lazyzcode:zw`) whose skill text carries the full
   orchestration protocol — triage, tier selection, planning, execution, and
   evidence rules.
2. **Four hooks** wired to the engine's lifecycle: SessionStart (re-inject
   loop state), UserPromptSubmit (trigger words), PostToolUse (comment
   advisory), Stop (bounded continuation).
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
ZCode.app starts from the Dock). The bundled `run-hook.sh` launcher resolves
node from nvm/Homebrew automatically; `lzy doctor`'s `hook-node` line tells
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
   is always allowed; **downgrading is never allowed.**
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
lzy loop register <slug> --title "…"    # planning state
lzy loop plan <file> [--review "…"] [--force]
lzy loop start                          # records the base tree hash + prints the measured 并发纪律 advisory
lzy step done <ID> [--note "…"] [--evidence "…"] [--evidence-file <file>]…
lzy loop status                         # progress, next step, evidence freshness
lzy loop verify                         # evidence freshness audit (exit 1 = stale/unbound)
lzy loop finish                         # the final gate; auto-archives the evidence bundle
lzy loop export                         # re-export the evidence bundle
lzy loop abandon | lzy loop reset       # give up / clear state
```

- `lzy loop plan` parses the N/F checklist and rejects undecided (TBD) items.
  Pass the plan-reviewer verdict with `--review "plan-reviewer: PASS …"`;
  HEAVY goals refuse to adopt a plan without a PASS review, and a `REVISE`
  verdict is refused even with `--force`.
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
  evidence with attachments); `lzy loop export` re-exports it any time.
- `lzy loop verify` is the audit-only variant of the finish gate (exit 1 when
  evidence is stale or unbound, or when no goal exists).
- `lzy loop abandon` gives up while keeping the record; `lzy loop reset`
  clears state (including session counters and orphan temp files) so the next
  loop can start.

## The plan gate

Plans are markdown checklists with two item kinds:

```markdown
- [N1] Implement the export endpoint in src/api/export.ts
- [N2] Add CSV serialization with quoting rules
- [F1] `curl localhost:3000/export` returns 200 and parses as CSV (qa-executor)
```

- **N items** (implementation) describe work.
- **F items** (final verification) name a **real surface** and the evidence
  that will be captured on it. A plan without F items does not pass.
- The plan must be **decision-complete**: no TBDs, no "decide later". The gate
  rejects undecided items at adoption time. (If your plan legitimately needs
  the literal string, a line-level `<!--lzy:allow-->` marker exempts it.)
- HEAVY goals additionally require a **plan-reviewer PASS** recorded via
  `--review`. The reviewer checks decision-completeness, hidden risks, and
  whether every F item names a capturable surface. `REVISE` refuses adoption —
  `--force` cannot bypass it; only a new review can.

## Evidence discipline

- Evidence comes from a **real surface**: a CLI's stdout, an HTTP response, a
  screenshot — not from the model's own summary, and not merely "tests are
  green" (a test run is one surface among several).
- Evidence is bound to `git rev-parse HEAD^{tree}` — the content snapshot of
  the current commit. **Commit first, capture after.** Uncommitted changes do
  not count.
- The moment the code changes, old evidence is stale *by construction*. The
  finish gate re-checks freshness and rejects stale or unbound evidence.
- Captured material can be archived under `.lazyzcode/evidence/`.
- The `lazyzcode:qa-executor` agent exists for this: spawn it to run the
  capture and report what it actually observed, verbatim.

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
8-hour window opposite your measured rate-limit concentration hours, when the
log data supports one.

The guardrail is structural, not a promise: an unattended session **continues
the open goal only** — it never registers a new goal and never writes or
adopts a plan, because the decision-complete gate needs a human. With nothing
to continue it exits cleanly, and the wake-up itself is bounded by the
continuation budget, fatal-429 handling, serial subagents, and ≥1-hour
spacing between runs.

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
| `stop.js` | Stop | Requests continuation (max 2/session) with the remaining-steps context while a loop is open. |

All four commands route through `plugin/hooks/run-hook.sh`: the engine spawns
hooks with *its own* environment, and a GUI-launched ZCode may have no `node`
on PATH — the launcher falls back to nvm (highest version) and Homebrew
locations, logs to `/tmp/lzy-hook-launcher.log`, and exits 0 (fail-open) if
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
  current hour falls in the measured concentration window; ≤2 only on a
  coherent clean band.
- **Risk trumps quota**: quota pressure may pick LIGHT at triage; it never
  lowers a HEAVY risk bar.
- After a fatal 429 (a turn judged dead after the engine's retries): stop
  cleanly, wait a few minutes, then `zw continue` — the loop state survives.

**Unattended (host automation)**: scheduling and the continue-only protocol
live in [Unattended](#unattended); the off-peak window comes from `lzy
doctor`'s `schedule` line — derived from your own measured concentration
hours, not a guess.

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
lzy loop register <slug> --title <t>    create the goal (planning)
lzy loop plan <file> [--review <v>] [--force]   adopt the N/F checklist
lzy loop start                  planning → executing; records base tree hash + 并发纪律 advisory
lzy loop status                 progress, next step, evidence freshness
lzy loop verify                 evidence freshness audit (exit 1 = stale/unbound/no goal)
lzy step done <ID> [--note <t>] [--evidence <t>] [--evidence-file <f>]…
lzy loop finish                 final gate: all done + all evidence fresh; archives evidence bundle
lzy loop export                 re-export the evidence bundle (<slug>.report.md)
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
| `node` | Node version floor (≥ 20) |
| `hook-node` | Which path the hook launcher resolves node from |
| `lzy-path` | Whether `lzy` resolves on PATH |
| `state` | `.lazyzcode/` hygiene (orphan temp files, goal state) |
| `platform` | Platform notice (macOS-only detection) |
| `agents-md` | Layered AGENTS.md coverage audit (skip when no root file; `lzy agents-md` for details) |
| `rate-limit` | GLM plan 429 pressure from the last 2 days of engine logs |
| `schedule` | Off-peak advisory: suggested automation window derived from the measured concentration (skip without evidence) |

## State & configuration

LazyZCode has **no configuration file**. Everything is derived:

| Path | Contents |
| --- | --- |
| `.lazyzcode/loop/goal.json` | Current goal: steps, statuses, evidence bindings |
| `.lazyzcode/loop/sessions/<sessionId>.json` | Per-session Stop-hook counters |
| `.lazyzcode/plans/<slug>.md` | Plan documents |
| `.lazyzcode/evidence/` | Archived evidence material |
| engine plugin cache | Deployed payload (managed by `lzy install`/`sync`) |
| LazyZCode registry | Install records (managed by the installer) |

Environment: `LZY_ZCODE_ENGINE` replaces the default engine candidate list
(default: `/Applications/ZCode.app/Contents/Resources/glm/zcode.cjs`). That is
the entire configuration surface.

Privacy: zero telemetry; diagnostics are computed locally and printed locally.

## Compatibility & limitations

- **macOS only** for engine detection; other platforms report "not found"
  rather than guessing.
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
