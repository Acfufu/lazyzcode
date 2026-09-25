# Recipe: plan (register + plan gate)

## 1 · Register

```
lzy loop register <slug> --title "<goal in one line>" [--tier heavy] [--risk <level>] [--contract <file>]
```

slug: kebab-case. One active goal per workspace. A finished (`done`) or abandoned goal
still occupies the slot — run `lzy loop reset` first to clear it (reset removes loop
state; your evidence lives in commits and the plan file, not in the reset state).
`--tier` defaults to light; `--tier heavy` declares a heavy goal up front — HEAVY
adoption without a PASS review is machine-rejected (`--force` does not cross it).
Non-git hosts are hard-rejected with git-init guidance (ADR-0019).

## 2 · Requirement contracts (0.3.0, ADR-0024)

A **requirement contract** separates what the user approves (problem, acceptance
criteria, authorization boundary) from the execution plan (which the agent maintains
autonomously inside that boundary):

- The contract is a markdown file (suggested: `.lazyzcode/contracts/<task>.md`,
  committable). Header keys: `task:` (required), `endpoint:` (required, `A|B|C` —
  A mergeable change is the default; B merge to main / C deploy+verify need explicit
  authorization), `scope:` (required, repeatable — allowed write roots), `recipe:`
  (optional, `lzy.project.json` content hash prefix or `none`), `budget-ref:` /
  `non-goals:` (optional). Acceptance items are `- [A1] …` lines with stable ids.
- `contractHash` = sha256 of the raw file bytes. The contract is immutable: changing
  it = new hash = a new authorization request.
- Register with `--contract <file>`; the first plan adoption runs the **contract
  gate**: disk file still hashes to the bound hash (drift ⇒ re-register), an
  effective approval exists (approval record without a later withdrawal), every
  contract acceptance id is covered by some F item's `accepts:` refs, every subject
  root is inside some `scope:` entry, and the manifest hash still matches the
  contract's `recipe:` field. Any failure re-arms `contractPending` and rejects.
- Approve via the UPS human gate: relay 「批准 <contractHash 前 8 位>」 verbatim and
  wait for a genuine user message. **Withdrawal**: the user says
  「撤回 <contractHash 前 8 位>」 — the hook appends a withdrawal record and the gate
  refuses the next gated action; already-occurred external effects are honestly kept
  (withdrawal does not claim to undo them). Re-approval after withdrawal = a fresh
  approval record.
- In-contract replans (`lzy loop supersede`) re-run the review gate but NOT the human
  gate — that is the whole point of the boundary (ADR-0024 revising ADR-0018). Goals
  without a contract keep the legacy planHash human gate unchanged (explicit
  migration belongs to M5).

## 3 · Plan format

```
subjects: ../sibling-repo
subjects: /abs/other-repo

- [N1] <implementation step>
- [N2] <implementation step>
deps: N1
- [F1] <final verification via a real surface — name the surface>
accepts: A1
```

Rules:
- **N items** are implementation steps; **F items** are final verifications that
  require real-surface evidence (HTTP response / screenshot / CLI stdout).
- **Subjects**: optional header lines, one path per line, before the first item.
  Each must exist, be a git repo, and not contain/be contained by the host. Declare
  subjects as early as you know them: any mid-loop `lzy loop subject add|remove`
  invalidates ALL captured F evidence (re-capture before finish). Undeclared sibling
  repos stay invisible to the freshness gate — declaring them is the discipline.
- **Dependency edges**: a bare lowercase `deps: N1,N2` line immediately after an item
  declares prerequisites — ids must exist, self-loops/cycles are rejected, an orphan
  `deps:` line fails the gate. Quoting the syntax in prose? End that line with
  `<!--lzy:allow-->` — and never paste plan-syntax examples into an adopted plan file
  (the item parser is fence-blind).
- **accepts**: for contract goals, a bare `accepts: A1,A2` line immediately after an
  F item binds it to contract acceptance ids (F items only; N-item placement and
  orphan lines are rejected; an accepts line in a goal without a contract is a parse
  error).
- **Decision-complete**: zero TBDs, zero 待定， no "ask user later". If a decision is
  genuinely missing, interview the user BEFORE writing the plan. Every F item names
  its surface in the title. **Handoff-able steps**: each N item carries its own
  pointers (files, symbols, expected shape) so a fresh claimer can execute it.
- **Known unknowns (HEAVY mandatory, LIGHT advisory)**: after the checklist, a
  `## Known unknowns` section listing 1–3 assumptions the plan silently rests on,
  each with its falsification path; "none" requires a one-line note of where you
  looked. Protocol and ledger: `docs/ablation.md`.

For HEAVY goals spawn the `lazyzcode:explorer` agent with 3–8 specific questions
instead of sweeping alone; lean on the `codegraph` MCP/CLI when the repo has an
index. If the repo has no root AGENTS.md, suggest `lazyzcode:init-deep` first.

## 4 · Review gate — the plan does not go live on your word alone

- **HEAVY (mandatory)**: spawn the `lazyzcode:plan-reviewer` agent with the goal and
  plan path. On `VERDICT: PASS` adopt with the review record
  (`lzy loop plan <file> --review "plan-reviewer: PASS — <one-line summary>"`).
  On REVISE the CLI rejects adoption — fix and re-review; never bypass with
  `--force`. Amending an adopted plan and re-adopting requires a fresh review — a
  changed snapshot hash with an unchanged review string is a red line.
- **LIGHT**: run the reviewer's checklist yourself (decision-complete, F surfaces
  named, scope tight). `--review` optional.
- **Human gate (L2, ADR-0018 / ADR-0024)** applies to both tiers: the first adopt run
  rejects with a pending short code; relay the exact sentence 「批准 <短码>」 to the
  user verbatim and wait (the UserPromptSubmit hook records the approval only on a
  genuine user prompt), then re-run the same adopt command. Approval after a plan
  change is void — the hook re-verifies the file hash.

Then `lzy loop start` (prints the measured 并发纪律 advisory — see
`recipes/ratelimit.md`).
