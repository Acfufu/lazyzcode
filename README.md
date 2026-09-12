<div align="center">

  <img src="docs/assets/logo.svg" alt="LazyZCode" width="120">

  <h1>LazyZCode</h1>

  <p><strong>The discipline layer for ZCode.</strong><br />
  Plan → execute → take evidence → never stop half-done.</p>

  <p>
    <a href="docs/guide/en.md">Docs</a>
    ·
    <a href="#-install-10-minutes">Install</a>
    ·
    <a href="#-cli-commands">Commands</a>
    ·
    <a href="#-what-is-this">What is this?</a>
  </p>

  <p>English · <a href="README.zh-CN.md">简体中文</a></p>

  <br />
</div>

> [!NOTE]
> **ZCode already writes code. LazyZCode makes it finish.**
>
> Coding agents are great at starting work and optimistic about declaring it
> done. The fix is not another prompt — it is a loop: a decision-complete plan
> gate, evidence captured on real surfaces and bound to a git tree hash, and a
> Stop hook that pulls the agent back until the goal is verifiably complete.
>
> One discipline, three beats:
> **Finish** what you start — the goal loop with plan & evidence gates.
> **Remember** what you build — layered `AGENTS.md` project memory.
> **Keep going** while you're away — scheduled wake-ups that continue the open
> goal only, off-peak by design.
>
> ```bash
> npm i -g lazyzcode && lzy install
> ```

## 🚀 Install (10 minutes)

Prerequisites: macOS, the ZCode desktop app (logged in), Node ≥ 20, git
(evidence binding uses tree hashes, so git is required).

```bash
npm i -g lazyzcode   # the lzy CLI + the plugin payload
lzy install          # deploy to the engine cache + register + enable
lzy doctor           # local health report (zero telemetry)
```

`lzy install` never writes your `config.json` — enabling flows only through the
engine's official `plugins enable` ([ADR-0001](docs/adr/0001-installer-enable-via-engine-cli.md)).

### Start your first goal loop

Open a fresh ZCode session in any project and type:

```
zw implement <your goal>
```

The `zw` trigger injects the full orchestration protocol: the model registers
the goal → writes a decision-complete plan (HEAVY goals must pass the
plan-reviewer gate and declare their known unknowns, each with a falsification
path; every step carries its own pointers so a fresh claimer can run it) →
executes step by step → captures real-surface evidence
for every final-verification item (bound to `git rev-parse HEAD^{tree}`) →
runs an evidence comparison per item, and `lzy loop finish` must pass before
anything counts as done. Stop early, and the Stop hook pulls the agent back
(at most 2 continuations per session).

### Verify it worked

```bash
lzy status           # quick check; exit code 0 = no fail-level findings
lzy doctor           # deep local diagnostics, all offline
```

### Your next moves

The first goal loop is the whole product in miniature. Two more beats wait
behind it:

1. **Remember what you build.** In a mature project, run the
   `lazyzcode:init-deep` skill to draft a layered `AGENTS.md` project map —
   draft first, nothing written until you approve. `lzy agents-md` audits
   coverage; `lzy doctor`'s `agents-md` line patrols adoption (warn-only).
2. **Keep going while you're away.** Mount a wake-up in the engine's own
   automation with `zw continue (unattended: …)`. Unattended sessions continue
   the open goal only — never start a new one — and `lzy doctor`'s `schedule`
   line suggests an off-peak window from your measured rate-limit hours,
   cross-checked against a declared table of platform pricing peaks
   (UTC+8, hand-maintained).

The scaffolding thesis has external proof: Anthropic reported its model
formalized Fermat's Last Theorem in Lean in 11 days on the Prove2Me scaffold,
and three consumer subscriptions proved Vinogradov's three-primes theorem in
three days — what multiplied the output was not the model alone but the right
scaffold. LazyZCode is that idea for software engineering.

### Uninstall

```bash
lzy uninstall        # prefers the engine's official plugins uninstall
```

## ⚡ CLI Commands

| Command | Type this | What it does |
| --- | --- | --- |
| `install` | `lzy install` | Deploy the plugin payload to the engine cache, register, and enable (official engine path only; zero `config.json` writes) |
| `sync` | `lzy sync [--watch]` | Hot-reload the payload after edits; `--watch` keeps syncing on change |
| `status` | `lzy status` | Quick health check; exit 0 = no fail-level findings (warn/skip do not flip it) |
| `doctor` | `lzy doctor` | Full diagnostics — see below |
| Goal loop | `lzy loop register <slug> --title "…"` → `lzy loop plan <plan.md>` → `lzy loop start` → `lzy step done <ID> --evidence …` → `lzy loop finish` | The state machine: register → plan gate → execute → evidence → finish gate |
| Evidence bundle | `lzy loop export` | Re-export the evidence bundle (`<slug>.report.md`); also auto-archived at `finish` |
| Handoff | `lzy loop handoff --snapshot <file>` | Register a clean handoff — the next Stop releases once, without spending the continue budget |
| Cross-repo list | `lzy loop list [--root <dir>]` | Read-only sweep of sibling repos' goal loops (status, progress, claims, staleness, salvage stubs); anonymous release counters survive reset |
| Cost report | `lzy loop cost` | Points report from the engine's local billing ledger (standing coefficients + dated promo overlay; simplified-OR goal attribution with a human-review note; read-only) |
| `agents-md` | `lzy agents-md` | Project-memory audit: qualifying directories and coverage gaps |
| `uninstall` | `lzy uninstall` | Removes the deployed cache and the registry entry |

### What `lzy doctor` checks

Engine and install state, enabled flags, hook syntax self-check (vm-parsed in a
worker, including `hooks.json` registry validation), node version floor,
`hook-node` resolution (the launcher's nvm/homebrew fallback for GUI-launched
sessions), the `lzy` PATH shim, `.lazyzcode/` state hygiene, a platform notice,
GLM plan rate-limit pressure (last 2 days of engine logs, read-only:
deduplicated 429 turns, fatal turns, longest sustained run, and an empirical
concurrency band — warn-only, never flips the exit code), transport-death
turns counted as a separate family (`transport`: request-never-reached-server
failures such as ENETDOWN, never fed into the concurrency math), a project-memory
adoption audit (`agents-md`, warn-only), a claim patrol for the open goal loop
(`claims`: who claimed it, stuck markers, zero-claim orphan notice — warn-only),
commit-ledger coverage (`ledger`: goal-era commits missing the `Goal:` trailer — warn-only),
a `waterline` line (rolling 5-hour point burn vs the self-calibrated nudge threshold, plus
its fail-open reason when sqlite3 is absent) and an `orphan-wake` idle-burn patrol for
unbound wake automations anchored here (skip when no mounts),
and a suggested off-peak window for
unattended runs (`schedule`, derived from the same measured concentration
data and cross-checked against declared platform pricing peaks — skipped,
never guessed, when the data is silent). Fully local, zero telemetry, no new
configuration surface.

## Use the built-in workflows

LazyZCode should be judged by what it actually installs: one plugin — two
skills (`zw`, `init-deep`), five hooks, three read-only agents — and the
`lzy` CLI.

### 1. Trigger words inject the protocol

| Trigger | Fires |
| --- | --- |
| `zw` | at the start of the prompt only |
| `lazyzcode:zw` | anywhere; the full-width colon `：` works too |
| `ulw` / `ultrawork` | anywhere, word-bounded |

Injection is conditional: an invocation engages the protocol, a mere mention
("how does the `zw` trigger work?") is ignored and answered directly.

### 2. The goal loop is the spine

- **Plan gate.** Plans are N/F checklists (`- [N1] …` implementation items,
  `- [F1] …` final-verification items). Undecided items (TBD) are rejected;
  the plan must be decision-complete. HEAVY goals must additionally pass the
  plan-reviewer: a `REVISE` verdict refuses adoption and `--force` cannot
  bypass it.
- **Evidence gate.** Every F item needs evidence from a real surface (CLI
  stdout, an HTTP response, a screenshot) bound to
  `git rev-parse HEAD^{tree}` — commit first, capture after. Change the code
  and the evidence expires; `finish` rejects stale evidence and demands a
  re-capture on the current tree.
- **Continuation, bounded.** While a loop is open, the Stop hook requests up to
  2 continuations per session — deliberately reserving 1 of the engine's
  shared pool of 3 for background notifications. Counters are isolated per
  sessionId; any hook error fails open and never hijacks unrelated sessions.

Loop state lives in `.lazyzcode/` (`loop/goal.json`, `plans/`), clearly
separated from the host's `.zcode/`. A finished loop frees its slot via
`lzy loop reset`.

### 3. Discipline agents ride ZCode's native sub-agents

Three read-only roles ship inside the plugin's `agents/` directory; the engine
discovers them automatically:

| Role | Use it for |
| --- | --- |
| `lazyzcode:explorer` | Pre-plan reconnaissance; codegraph index guidance for large repos |
| `lazyzcode:plan-reviewer` | The plan review gate (decision-completeness, hidden risks, real F-item surfaces) |
| `lazyzcode:qa-executor` | Real-surface evidence capture; ego-browser/curl for web surfaces |

Spawn them through the Agent tool with the role as `subagent_type` — the child
runs read-only with that contract:

```jsonc
Agent({ "subagent_type": "lazyzcode:explorer", "prompt": "TASK: map the auth flow end to end." })
```

### 4. Advisory hooks, not nagware

`comment-checker` watches Edit/Write output for `TODO`/`FIXME`/`XXX`/`HACK`
markers and debug residue (`console.log`, `console.debug`, `debugger`) and nudges through
`additionalContext` — inject-only, never blocks, capped at 5 hits per event,
and active only in workspaces with an open goal loop. SessionStart re-injects
loop state so a fresh session picks up where the last one left off.

### 5. Project memory feeds the plan gate

`lazyzcode:init-deep` drafts a layered `AGENTS.md` map of the repo (root plus
qualifying subdirectories). You approve before anything is written; existing
files get patch suggestions only, and secrets or machine-local paths stay out.
ZCode reads `AGENTS.md` natively, so the map rides into every later session —
and HEAVY planning consults it before spending the plan gate. `lzy agents-md`
lists qualifying directories and coverage gaps.

### 6. Unattended, on rails

The engine's built-in automation can wake a fresh session on a schedule with
`zw continue (unattended: …)`. The wake protocol is continue-only: it never
registers a new goal and never adopts a plan — the decision-complete gate
stays human. It is bounded by the continuation budget, fatal-429 handling,
serial subagents, and ≥1-hour spacing, and `lzy doctor`'s `schedule` line
derives an off-peak window from your measured rate-limit concentration hours,
cross-checked against the declared pricing-peak table.

### Troubleshooting quick list

- **`[1302] rate limit` (GLM plan):** account-level concurrency limiting.
  `lzy doctor`'s `rate-limit` line reports measured pressure and an empirical
  bound; keep one goal loop at a time, few parallel main sessions, and after a
  fatal 429 wait a few minutes, then `zw continue` — state in `.lazyzcode/`
  survives.
- **Hooks do nothing at all:** usually the engine's hook environment lacks
  `node` (ZCode.app launched from the Dock). `lzy doctor`'s `hook-node` line
  diagnoses it; the bundled `run-hook.sh` launcher falls back to nvm/homebrew
  automatically. Details:
  [docs/diagnostics/2026-09-07-hook-spawn-env.md](docs/diagnostics/2026-09-07-hook-spawn-env.md).
- **`lzy: command not found`:** install globally (`npm i -g lazyzcode`) or call
  `node <repo>/cli/lzy.js …` directly.

## 💤 What is this?

**LazyZCode** packages the [lazycodex](https://github.com/code-yeongyu/lazycodex)
discipline workflow as a native ZCode plugin plus a lightweight CLI.

Think [LazyVim](https://github.com/LazyVim/LazyVim) for
[lazy.nvim](https://github.com/folke/lazy.nvim) — but for ZCode.

The harness part is discipline: a plan gate, evidence-bound completion, and a
bounded continuation budget. ZCode already ships the skills/hooks/agents
machinery; LazyZCode is the workflow that makes them finish what they start.

## 🧩 What you get

| Feature | Description |
| --- | --- |
| 🎯 **Goal loop** | Register → plan → execute → verify, as a CLI state machine that survives session restarts |
| 🚧 **Plan gate** | Decision-complete plans only; TBD rejected; HEAVY plans must pass the reviewer gate (`REVISE` refuses adoption) |
| 🔬 **Evidence discipline** | F-item evidence bound to a git tree hash; stale evidence cannot pass `finish` |
| 📦 **Evidence bundle** | `--evidence-file` attachments (hash-bound copies) and `lzy loop export` — finish auto-archives a `<slug>.report.md` |
| 🗂️ **Project memory** | `init-deep` drafts layered `AGENTS.md` maps; human-approved writes, `lzy agents-md` audits gaps |
| 🌙 **Unattended** | Scheduled wake-ups continue the open goal only, never start new ones; off-peak window from `lzy doctor schedule` (measured rate-limit ∩ pricing-peak cross-check) |
| 🪝 **Bounded continuation** | Stop hook pulls the agent back, max 2 per session, budget shared fairly with background notifications |
| ⌨️ **Trigger words** | `zw` / `lazyzcode:zw` / `ulw` / `ultrawork`, stratified matching, mention ≠ invocation |
| 🕵️ **Read-only agents** | explorer / plan-reviewer / qa-executor, auto-discovered by the engine |
| 💬 **comment-checker** | Advisory TODO/debug-residue nudges; never blocks |
| 🩺 **`lzy doctor`** | Offline health report incl. hook-node resolution and rate-limit pressure |
| 🔒 **Privacy & red lines** | Zero telemetry; `lzy` never writes your `config.json` |

## 🧠 Why "done" needs evidence

Do not be surprised when LazyZCode refuses to celebrate. A plan checkbox is a
claim; only real-surface evidence is a fact. That is why F items must name the
surface they will capture (a CLI's stdout, an HTTP response, a screenshot), why
the evidence is bound to `git rev-parse HEAD^{tree}` (content snapshot of the
commit — the moment code changes, old evidence is stale by construction), and
why `lzy loop finish` re-checks freshness instead of trusting a summary. Tests
being green is not evidence; a test run is one surface among several.

The same philosophy sets the continuation budget. ZCode gives a session 3
stop-continuations, shared with background task notifications; LazyZCode's Stop
hook spends at most 2 of them, per session, and fails open on any error — the
loop is meant to pull work back across a lazy stop, not to trap the session.

## 🏗️ Architecture

LazyZCode is a plugin (the discipline layer) plus a CLI (the loop state
machine). Zero npm dependencies, Node ≥ 20, pure ESM.

```
lazyzcode/
├── plugin/   → the lazyzcode plugin: skills/zw + skills/init-deep, hooks/ (5, via run-hook.sh), agents/ (3)
├── core/     → shared logic: loop, installer, doctor, ratelimit, agentsmd, engine, git, paths, status
├── cli/      → the lzy entry (cli/lzy.js) + syntax-check worker
├── test/     → contract tests (node:test, zero deps) + GitHub Actions (node 20/22/24)
└── docs/     → research notes, ADRs, five review rounds, diagnostics
```

Design rule of thumb: **Skill > MCP > Tool > Hook.** Anything that survives
being offline lives in skill text; hooks are the last resort. The installer
installs plugins and nothing else — enabling goes through the engine's official
`plugins enable`, so your `config.json` is never touched.

### Known limitations

- The engine layout detection covers macOS only; other platforms report
  "not found" instead of guessing.
- Driving the engine headlessly (`--prompt`) requires the desktop's injected
  model credentials; the mechanism is validated by probes, live headless
  acceptance is deferred.

## 📄 License

MIT — see [LICENSE](LICENSE).

The name and workflow are inspired by
[lazycodex](https://github.com/code-yeongyu/lazycodex) (MIT); structure and
installer patterns are borrowed within its license, with credit.
[oh-my-openagent](https://github.com/code-yeongyu/oh-my-openagent) (OmO) is
SUL-1.0: only ideas were learned, no code or text was copied.
