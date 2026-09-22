<div align="center">

  <img src="docs/assets/logo.svg" alt="LazyZCode" width="120">

  <h1>LazyZCode</h1>

  <p><strong>The discipline layer for ZCode.</strong><br />
  Plan → execute → take evidence → never stop half-done.</p>

  <p><em>A local, evidence-bound coding goal protocol with durable continuation —
  not a general workflow engine.</em></p>

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

Prerequisites: macOS, Windows, or Linux; the ZCode desktop app (logged in),
Node ≥ 22, git (evidence binds tree hashes, so git is required — `lzy loop register`
hard-rejects a non-git host with `git init` guidance, ADR-0019). Engine
layouts are detected on all three platforms (macOS app bundle, Linux deb
`/opt/ZCode`, Windows per-user `%LOCALAPPDATA%\Programs\ZCode`).

```bash
npm i -g lazyzcode   # the lzy CLI + the plugin payload
lzy install          # deploy to the engine cache + register + enable
lzy doctor           # local health report (zero telemetry)
```

`lzy install` never writes your `config.json` — enabling flows only through the
engine's official `plugins enable` ([ADR-0001](docs/adr/0001-installer-enable-via-engine-cli.md)).

Prefer the plugin marketplace? In ZCode's `/plugin` panel run
`/plugin marketplace add Acfufu/lazyzcode`, then install **lazyzcode** from it —
the same engine code path as the official marketplace, pinned to release tags.
The marketplace route installs the plugin layer only (skills, hooks, agents);
the `lzy` CLI still comes from npm, so `npm i -g lazyzcode` remains the
recommended full install.

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

### Upgrade

From 0.0.7 on, one command does it:

```bash
lzy update           # npm pulls the latest package, then a fresh child process runs lzy sync
```

On 0.0.6 or earlier, upgrade with the manual two steps (which is exactly what
`lzy update` automates):

```bash
npm i -g lazyzcode@latest && lzy sync
```

Why two steps: live sessions read the plugin payload from the engine cache's
versioned directory (`~/.zcode/cli/plugins/cache/.../<version>/`), not from the
npm package — so upgrading the npm package alone changes nothing in your
sessions. `lzy sync` atomically deploys the new payload into a new cache
directory and updates the registry. Running sessions are unaffected; new
sessions pick up the new version. Your enable state hangs off the plugin id in
`enabledPlugins`, so it survives version bumps — no re-enable needed.

### Uninstall

```bash
lzy uninstall        # prefers the engine's official plugins uninstall
```

## ⚡ CLI Commands

| Command | Type this | What it does |
| --- | --- | --- |
| `install` | `lzy install` | Deploy the plugin payload to the engine cache, register, and enable (official engine path only; zero `config.json` writes) |
| `sync` | `lzy sync [--watch]` | Hot-reload the payload after edits; `--watch` keeps syncing on change |
| `update` | `lzy update` | One-command upgrade: npm pulls the latest package, then a fresh child process from the new install runs `lzy sync` (skips when already latest; manual two-step hints on any failure) |
| `status` | `lzy status` | Quick health check; exit 0 = no fail-level findings (warn/skip do not flip it) |
| `doctor` | `lzy doctor` | Full diagnostics — see below |
| Goal loop | `lzy loop register <slug> --title "…" [--tier heavy]` → `lzy loop plan <plan.md>` → `lzy loop start` → `lzy step done <ID> --evidence …` → `lzy loop finish` | The state machine: register → plan gate → execute → evidence → finish gate (evidence binds the composite fingerprint over the host + declared subjects; finish requires every tree clean). Plan adoption passes a human gate (0.1.1): the first run rejects with a short code — a human replies 「批准 <短码>」 and the UPS hook records the approval; the model cannot approve itself |
| Attempt lineage | `lzy loop supersede <plan.md> [--review …] · lzy loop attempts` | Forward-only plan change mid-execution (0.1.0): the old attempt is marked superseded and a new one opens with every adoption gate re-run — no in-place re-planning; lineage is a checksummed ledger surviving reset |
| Subjects | `lzy loop subject add <path> · remove · list` | Declare sibling repo roots for multi-tree goals (executing-only; validated git repos, no host containment) — any set change invalidates captured F evidence |
| Tier | `lzy loop tier heavy` | One-way LIGHT→HEAVY upgrade; HEAVY adoption without a PASS review is machine-rejected (adoption-time gate) |
| Risk | `lzy loop risk <level>` | One-way risk_class upgrade (low/med/high/restricted); HIGH+ barred from unattended lanes by the drive-entry gate (ADR-0020) |
| Lease | `lzy loop lease acquire\|heartbeat\|release\|reclaim` | Run-level lease: minutes-scale mutex with heartbeat; fence token declares write paths; `reclaim` is the zombie-lease exit (auto when the holder pid is gone, `--force` when it is not) (ADR-0020) |
| Budget | `lzy loop budget init\|spend\|remaining` | Drive budget: wall-clock + points double cap; over-cap reject = clean wind-down signal (ADR-0020) |
| Drive | `lzy loop drive [--wall-ms N] [--max-segments N] [--mode m]` | In-wake unattended execution channel: headless segments inside one wake, risk/lease/budget gates between segments, fence-tokened segment writes; wind-down authors the handoff snapshot itself; exit 0 = done or clean wind-down, 1 = gate reject / segment failure (ADR-0020) |
| Step claims | `lzy loop claim [<id>] [--release]` | Anonymous per-step claiming for same-goal multi-worker runs: 48h mutex, blocked-step checks against plan `deps:` edges, `step done` auto-releases; bare form lists claimable steps |
| Evidence bundle | `lzy loop export` | Re-export the evidence bundle (`<slug>.report.md`); also auto-archived at `finish` |
| Red-green manifest | `lzy evidence red <Fid> --evidence … · waive-red <Fid> --reason · list` | Dual-evidence machine ledger: the red half binds its own surface (composite fingerprint by default, `--surface` for external); waive is the one-line exemption's machine form; greens mirror at `step done`; `list` reads the per-F manifest |
| Invalidation DAG | `lzy dag dependents <id|surface> · lzy dag stale` | The central cross-reset ledger: "what depends on X" plus an invalidation preview against the current fingerprint (display-only); verify/finish judge evidence freshness from it — fail-closed on corruption (ADR-0014) |
| Attestations | `lzy attest comparator --file <json>` | Comparator verdicts as machine attestations (HEAVY finish enforces a current MATCH); every finish writes the LOOP_COMPLETE final attestation |
| Handoff | `lzy loop handoff --snapshot <file>` | Register a clean handoff — the next Stop releases once, without spending the continue budget |
| Cross-repo list | `lzy loop list [--root <dir>]` | Read-only sweep of sibling repos' goal loops (status, progress, claims, staleness, salvage stubs); anonymous release counters survive reset |
| Goal lineage | `lzy loop history` | Read-only union of evidence bundles, salvage stubs, and git ledger trailers — every past goal with status, commit count, and latest activity |
| Cost report | `lzy loop cost` | Points report from the engine's local billing ledger (standing coefficients + dated promo overlay; simplified-OR goal attribution with a human-review note; read-only) |
| `agents-md` | `lzy agents-md` | Project-memory audit: qualifying directories and coverage gaps |
| `uninstall` | `lzy uninstall` | Removes the deployed cache and the registry entry |

### What `lzy doctor` checks

Engine and install state, enabled flags, hook syntax self-check (vm-parsed in a
worker, including `hooks.json` registry validation), node version floor,
`hook-node` resolution (the launcher's node fallback chain — nvm/homebrew on
POSIX, nvm-windows/Program Files on Windows — for GUI-launched sessions), the
`lzy` PATH shim, a payload-version cross-check (`payload-ver`: the cached
version directories versus the CLI's own `package.json` — the ADR-0012
intermediate-state self-check), `.lazyzcode/` state hygiene, an H3R word-list payload check (`h3r-words`: the one word list both the CLI and the command-layer hook read — missing = warn; awake-time behavior splits by reader: the drive-side gate hard-rejects (throws), the command-layer hook fails open — ADR-0022's failure semantics), a handoff-lane
usage counter (`handoff-usage`: registered versus consumed markers — a
difference means reset cleanup or bad markers, never lost handoffs), an
optional code-index probe (`codegraph`: user-level MCP config plus CLI
availability; absent = skip, never flips the exit code), a platform notice,
GLM plan rate-limit pressure (last 2 days of engine logs, read-only:
deduplicated 429 turns, fatal turns, longest sustained run, and an empirical
concurrency band — warn-only, never flips the exit code), transport-death
turns counted as a separate family (`transport`: request-never-reached-server
failures such as ENETDOWN, never fed into the concurrency math), content-moderation
stream kills counted as a separate family (`content`: provider content-filter
mid-stream kills such as 1301 — an in-place retry reproduces, never fed into
the concurrency math), a per-provider band line (`band-by-provider`:
completed-side clean buckets × 429 dirty buckets, emitted only when the
window has ≥1 429 and ≥2 providers — a provider with no 429 of its own gets
an honest "no dirty-face sample" row), a mixed-account caveat (`provider-mix`:
account-level advice pools 429 data across providers — one provider hitting
the wall says nothing about the others) and a model-tier advisory (`cost`: a
zero-429 window with a low rolling waterline suggests trying a lighter tier
for routine goals — advisory text only, never predicate math), a project-memory
adoption audit (`agents-md`, warn-only, with a staleness hint: ≥50 covered-dir
commits since the map's last commit suggests re-running init-deep), a claim
patrol for the open goal loop, and a headless-drive line (`headless`: engine
probe plus credential two-state — oauth credentials file or desktop-injected
config env; absent engine = skip, missing credentials = warn-only, 0.1.0) and —
0.2.0 — the unattended drive channel (`drive`: credential two-state, active
lease, run budget, and whether the open goal is drive-eligible; ADR-0020)
(`claims`: who claimed it, stuck markers; zero claims = nobody is pullable under claim-gated pull-back — warn-only),
whether the host is a git repository (`host-git`: warn with `git init` guidance when not — evidence binds git trees, ADR-0019),
commit-ledger coverage (`ledger`: goal-era commits missing the `Goal:` trailer — warn-only),
a `waterline` line (rolling 5-hour point burn vs the self-calibrated nudge threshold, plus
its fail-open reason when sqlite3 is absent) and an `orphan-wake` idle-burn patrol for
unbound wake automations anchored here (skip when no mounts),
a `lock` contention line (lock acquisitions, how many had to wait, total and max wait,
and wait timeouts, measured against `LOCK_WAIT_MS` — skip without samples, warn once a
wait times out; readings are lower bounds),
and a suggested off-peak window for
unattended runs (`schedule`, derived from the same measured concentration
data and cross-checked against declared platform pricing peaks — skipped,
never guessed, when the data is silent). Fully local, zero telemetry, no new
configuration surface.

## Use the built-in workflows

LazyZCode should be judged by what it actually installs: one plugin — two
skills (`zw`, `init-deep`), six hooks, three read-only agents — and the
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
  diagnoses it; the bundled `run-hook` launcher (with its `run-hook.cmd` twin
  on Windows) falls back automatically (nvm/homebrew on POSIX,
  nvm-windows/Program Files on Windows). Details:
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

## 🆚 Eleven things only LazyZCode does

As of September 2026 the official ZCode marketplace lists 19 plugins and none
of them is a discipline layer — so instead of a competitor table, here is what
only LazyZCode ships, and the one capability we have not built yet.

| # | Only here | In one line |
| --- | --- | --- |
| 1 | **Tree-hash evidence binding** | F-item evidence binds to `git rev-parse HEAD^{tree}` — change the code and old evidence is stale by construction |
| 2 | **Engine-internal Stop pull-back** | a lazy stop gets pulled back to work: at most 2 continuations per session, 1 of the engine's shared 3 reserved for background notifications |
| 3 | **Handoff release** | a lint-enforced handoff snapshot lets the agent wrap up cleanly — the next Stop releases once, without spending the continuation budget |
| 4 | **Claim-scoped sessions** | the pull-back only reaches sessions that claimed the goal; bystander sessions in the same repo are never hijacked; per-step claims coordinate multi-worker runs |
| 5 | **Measured rate-limit triage** | `lzy doctor` reads your own engine logs: deduplicated 429 turns, an empirical concurrency band, and an off-peak window cross-checked against declared pricing peaks |
| 6 | **Failure families, not "unknown"** | transport deaths (request never reached the server) and content-moderation kills (mid-stream; an in-place retry reproduces) are counted separately, never fed into the concurrency math |
| 7 | **Known unknowns, mandatory** | HEAVY plans must declare 1–3 unverified premises, each with a falsification path — "none" requires a one-line note of where you looked |
| 8 | **Project memory with a staleness fingerprint** | `init-deep` drafts layered `AGENTS.md` maps; a commit-lag signal says when the map has fallen behind |
| 9 | **A review gate that cannot be forced** | a `REVISE` verdict refuses plan adoption; `--force` does not bypass it |
| 10 | **Zero telemetry by constitution** | diagnostics are local-only, there is no configuration surface, and nothing phones home |
| 11 | **Loop-complete machine attestation** | every `finish` writes a LOOP_COMPLETE proof (plan hash, per-root trees, composite fingerprint, comparator verdict, report sha256) that survives `reset`; HEAVY goals additionally need a recorded comparator `MATCH` |

**The one gap we own:** a self-evolution loop (the harness improving its own
discipline) is not built — it stays a recorded long-horizon item rather than
shipping early.

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
machine). Zero npm dependencies, Node ≥ 22, pure ESM.

```
lazyzcode/
├── plugin/   → the lazyzcode plugin: skills/zw + skills/init-deep, hooks/ (6, via the run-hook launcher), agents/ (3)
├── core/     → shared logic: loop, installer, doctor, ratelimit, agentsmd, engine, git, paths, status, update, cost, dag, attempt, attest, runtime, drive, h3r, progress, headless, hostdb
├── cli/      → the lzy entry (cli/lzy.js) + syntax-check worker
├── test/     → contract tests (node:test, zero deps) + GitHub Actions (node 22/24)
└── docs/     → research notes, ADRs, five review rounds, diagnostics
```

Design rule of thumb: **Skill > MCP > Tool > Hook.** Anything that survives
being offline lives in skill text; hooks are the last resort. The installer
installs plugins and nothing else — enabling goes through the engine's official
`plugins enable`, so your `config.json` is never touched.

### Known limitations

- Platform support (ADR-0011): macOS, Windows and Linux are all supported;
  engine layouts are measured on each, the distribution matrix is
  arm64-live-verified (Windows 11 / Ubuntu ARM VMs), and x64 coverage follows
  the official download matrix by documentation.
- Driving the engine headlessly (`--prompt`) requires the desktop's injected
  model credentials; the mechanism is validated by probes, live headless
  acceptance is deferred.

## 🔒 Security & trust surface

What runs on your machine, where it installs, and what it deliberately does not
defend against:

- **Hooks execute local code.** Six lifecycle events run this plugin's local
  Node scripts (UserPromptSubmit, SessionStart, Stop, PreToolUse, PostToolUse,
  PostToolUseFailure); their output is injected context for the model, not a
  sandbox boundary.
- **Install footprint is the engine's official plugin cache** — enabling flows
  through the engine's official CLI, and LazyZCode never writes your
  `config.json`.
- **Dual distribution chains, user-verifiable.** npm: compare the published
  shasum with `npm view lazyzcode dist.integrity`. Marketplace: the manifest
  pins a commit sha, so the loaded payload is the pinned tree.
- **Threat-model boundary, stated plainly:** LazyZCode guards against laziness
  (fake done, silent scope abandonment), not against a malicious agent — local
  ledgers, approval records, and counters are readable/writable by any process
  with your permissions; integrity claims are enforced by protocol text plus
  the audit ring, not tamper-proof hardware.

## 📄 License

MIT — see [LICENSE](LICENSE).

The name and workflow are inspired by
[lazycodex](https://github.com/code-yeongyu/lazycodex) (MIT); structure and
installer patterns are borrowed within its license, with credit.
[oh-my-openagent](https://github.com/code-yeongyu/oh-my-openagent) (OmO) is
SUL-1.0: only ideas were learned, no code or text was copied.
