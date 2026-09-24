# Recipe: continuation (Stop hook, pull-back, handoff)

- The plugin's Stop hook requests engine continuation while the goal is unfinished —
  at most **2× per session** (a persistent per-session counter; 1 of the engine's
  shared 3-continue pool stays reserved for background notifications). Keep the four
  continuation surfaces distinct — **engine**: 3 continues per turn, counter resets on
  every new prompt; **lzy Stop hook**: self-limited to 2 per session, persistent,
  never resets; **unbound scheduler wake** (App-UI automation): a fresh session each
  fire with fresh budgets; **idle run** (host OffPeak idle task): the engine's
  first-class off-peak lane, bound to the origin session with **zero pool exemption**
  (engine 3/turn and hook 2/session both count, per-session counters persist with the
  session). Conversation history is unreliable at an idle run's executor perception —
  never rely on in-chat references; all handoff state must live on disk.
- **Pull-back eligibility (claim-gated, ADR-0004 amendment 4).** Only a session that
  has **claimed** the goal (an invocational trigger such as 「zw 继续」 writes
  `claimedAt`) is subject to pull-back; an empty claim set means **nobody is
  pullable** — bystander sessions are structurally exempt. To opt out explicitly,
  send **「zw standdown」**: the session writes a standdown flag and the Stop hook
  releases it read-only (pull-back budget untouched) until it rejoins (a claiming
  trigger clears the flag) or the loop is reset.
- When you feel the `[lzy]` nudge: continue the **current step**. Do not replan, do
  not summarize, do not ask questions — work.
- **Progress signal (state set) — one concept, two enforcement points.** The set is
  {done-step count, per-subject HEAD tree set, evidence-ledger green-node count,
  handoff and salvage registrations}; any component advancing counts as movement; a
  **dirty tree is deliberately not a signal** — writing without committing must not
  extend the leash. **L1 (machine, full set)** — `lzy loop drive`'s segment loop
  (`core/progress.js` single source). **L0-plus-partial (Stop hook)** — judges by the
  done count alone today; the rule binds it as protocol. Every pull-back must move
  the state set; two consecutive handoff registrations with zero movement are
  violations (a handoff is a graceful hand-back, not a free bail-out channel).
- **Budget exhausted with steps remaining?** State plainly which steps remain and
  stop cleanly; the next session's SessionStart hook re-injects the loop state.
- **Risk suspension (SUSPENDED_RISK).** If risk_class rises to HIGH+ mid-flight
  (blast radius grew, a new subject repo entered, credentials or a destructive
  surface got involved), suspend instead of pushing on: write the handoff snapshot,
  end the turn, resume only after a human nod. Suspending on risk does not burn the
  pull-back budget. Since 0.2.0 record it with `lzy loop risk <level>` (ADR-0020);
  the drive-entry gate keeps HIGH+ out of unattended lanes.
- **Tool fire-loop escape (misfire attractor):** if the same tool fires 3+ times in a
  row with failures/timeouts, or with queries unrelated to the step — stop calling
  it, even if you already declared it "disabled" (self-commands do not survive long
  context). Switch tools or, when the context is already degraded: write a handoff
  snapshot per the template, run `lzy loop handoff --snapshot <file>`, end the turn,
  ask the user to open a fresh context with 「zw 继续」. Never pad with placeholder
  queries — that is how a 2-call misfire becomes a 79-call spiral. If the tripwire
  nudge arrives, the hook observed the pattern before you did: obey immediately.
- `lzy loop status` at any time to re-ground yourself (also after compaction); for
  cross-repo goals, return to the host root before running it.

## Handoff snapshot template (lint-enforced)

`lzy loop handoff` rejects a snapshot missing any of the seven sections — the Chinese
headings are contract literals; each section needs at least one non-empty line:

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

Multi-subject goals: list each {host}∪subjects root's status and HEAD tree hash
separately (one block per root).

**Dirty-tree inheritance:** the snapshot's 脏树清单 binds the receiver. A claiming
session reconciles against that list FIRST; `checkout`/`reset` before every entry is
accounted for destroys the previous session's uncommitted work — that work belongs to
the goal, not to the cleaner.
