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

## The workflow

### 1 · Register

```
lzy loop register <slug> --title "<goal in one line>"
```

slug: kebab-case. One active goal per workspace.

### 2 · Plan (decision-complete gate)

Explore what is needed, then write the plan to `.lazyzcode/plans/<slug>.md` as a
checklist:

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

Adopt and start (the gate rejects undecided plans):

```
lzy loop plan .lazyzcode/plans/<slug>.md
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

`lzy step done F1 --evidence "<the observable result you actually saw>"`

- **Tests alone never prove done.** Green tests are necessary, not sufficient.
- Run the real surface: hit the endpoint, take the screenshot, run the CLI and
  read its stdout. Record what you observed, not what you hope.
- Code changed after you captured evidence? The evidence is stale — `lzy loop
  finish` will reject it. Re-verify on the current code and re-record.

### 5 · Finish

```
lzy loop finish
```

Passes only when every step is done AND every F item's evidence tree-hash equals
the current code. This is the only valid "done". 不做完不停 — if finish rejects,
keep working, never declare victory.

## Continuation (how the Stop hook drives you)

- The plugin's Stop hook requests engine continuation while the goal is
  unfinished — at most **2× per session** (it reserves 1 of the engine's
  shared 3-continue pool for background notifications).
- When you feel the `[lzy]` nudge: continue the **current step**. Do not replan,
  do not summarize, do not ask questions — work.
- Budget exhausted with steps remaining? State plainly which steps remain and
  stop cleanly; the next session's SessionStart hook re-injects the loop state.
- `lzy loop status` at any time to re-ground yourself (also after compaction).

## Red lines

1. Never write the user's `config.json`; plugin enabling flows only through the
   engine's official CLI (`lzy install` handles this).
2. Evidence is tree-hash-bound. Tests alone ≠ evidence.
3. `.lazyzcode/` is the loop's single source of truth — if speech and state
   disagree, trust the state, then fix the speech.

## CLI cheat sheet

| Command | Purpose |
|---|---|
| `lzy loop register <slug> --title …` | create goal (planning) |
| `lzy loop plan <file> [--force]` | adopt checklist (rejects TBD) |
| `lzy loop start` | planning → executing, records base tree hash |
| `lzy loop status` | progress, next step, evidence freshness |
| `lzy step done <ID> [--note] [--evidence]` | complete a step (F requires evidence) |
| `lzy loop verify` | evidence freshness report |
| `lzy loop finish` | final gate: all done + fresh evidence |
| `lzy loop abandon` / `lzy loop reset` | give up / clear state |
