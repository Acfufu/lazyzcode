---
name: init-deep
description: LazyZCode layered project memory (AGENTS.md). Generates or updates a layered AGENTS.md map — root file plus per-directory files for qualifying subdirectories — so the engine's native AGENTS.md auto-read has a fresh, lean project map. Use when the user asks to "init-deep", "生成分层 AGENTS.md", "build/update the project map", or a workspace plainly lacks one.
---

# init-deep — layered project memory (AGENTS.md)

You are the **proposer**. The value contract of this skill: **deterministic scan →
semantic drafts → human approval → write**. ZCode's engine natively reads
AGENTS.md files at every level (multi-source merge, 100 KB injection cap), so a
layered map is what makes large repos legible to every future session. You never
write without an explicit human approval of the exact draft.

The deterministic layer lives in the `lzy` CLI (`core/agentsmd.js`): the
qualifying predicate and coverage audit are pure code — two runs on the same
tree give the same answer. Your semantic judgment only ever *proposes*; the
audit and the human decide. `lzy doctor` patrols coverage on every run.

## Operating protocol

### 1 · Scan (deterministic)

```
lzy agents-md
```

(exit 0 = coverage complete; 1 = gaps/overcaps. The listing shows every
qualifying directory and why it qualifies.) If `lzy` is not on PATH, use
`node <lazyzcode-repo>/cli/lzy.js …`.

Qualifying predicate (fixed in code, mirror it in your reasoning):
- the directory directly contains a build entry (`package.json`, `go.mod`,
  `Cargo.toml`, `Makefile`, `pyproject.toml`, …), or
- it directly holds > 40 files, or
- the root AGENTS.md mentions `<dir>/` (repo-map style).

A mention in the root file doubles as coverage — the root declares it manages
that directory. Defaults: scan depth ≤ 3 levels, root file ≤ 150 lines, child
files ≤ 40 lines. The user may override depth/limits in conversation; there
are deliberately no flags (zero config surface).

### 2 · Understand (semantic, bounded)

For each qualifying directory lacking coverage, read enough to write a useful
map: entry points, key modules, non-obvious invariants, where tests live.
Prefer the workspace code index when present (`codegraph` MCP / CLI). Do not
boilerplate — a child map that restates the root is noise, not memory.

### 3 · Draft (never write yet)

Present the drafts to the user, one block per file, each with a one-line
rationale:

```
.proposed/AGENTS.md (root, 38 lines) — why: no root map exists
<draft body>
```

Rules for drafts:
- **Root** (`AGENTS.md`): repo purpose, layout map (use `dir/` tokens — they
  double as coverage declarations), how to run tests/build, pointer to deeper
  files. ≤ 150 lines.
- **Children** (`<dir>/AGENTS.md`): only what a session working *inside* that
  directory needs and the root cannot say. ≤ 40 lines.
- **Update mode**: an existing file is never silently rewritten. Propose a
  patch (unified diff or explicit before/after) and wait for approval. A
  hand-crafted AGENTS.md is someone's constitution — treat it as one.
- Language: follow the repo's existing docs language; a fresh map defaults to
  the repo's dominant language.
- Red lines: never include secrets, credential names with values, machine
  local paths, or anything you would not commit to a public mirror.

### 4 · Write (only after approval)

Apply exactly the approved drafts. Then re-run `lzy agents-md` and show the
user the after-state (expect exit 0 unless the user chose exemptions).

## Notes

- This skill only manages the **AGENTS.md layer** — the repo/team face that
  gets committed. Personal, machine-local lessons belong to the host's native
  project memory (the `zw` loop's finish ritual owns that side).
- No goal loop is required; this skill is a standalone tool. But if a `zw`
  HEAVY goal is about to start in an unmapped repo, running this first makes
  the plan gate materially better — say so when it applies.
