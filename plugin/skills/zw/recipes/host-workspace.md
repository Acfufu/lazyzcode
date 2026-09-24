# Recipe: host workspace (cross-repo goals)

Applies when a goal's code lives outside the repo that owns `.lazyzcode/` (that repo
is the **host workspace** — loop state registers there, ADR-0006):

- The host workspace must be a **git repository**: evidence binds git trees, so
  `register` hard-rejects a non-git host with recovery guidance (`git init` + a first
  commit; ADR-0019, no bypass), and `status`/`doctor` carry standing warnings if the
  host's git goes missing mid-goal.
- The session stays rooted at the host. Run `lzy` only from the host root — prefix
  commands with `cd <host-root> &&` (Bash cwd persists across calls, and the engine's
  cwd reset is not guaranteed on failure/timeout paths).
- Inside code repos use absolute paths or `git -C <repo>` — never `cd` away and
  forget the way back.
- Directory resolution is strict-cwd (no walk-up): a missing-goal error prints the
  exact path it checked — return to the host root; don't expect a flag to relax it.
- Take F-item evidence **after the last code-repo commit**; a sibling repo only
  enters the freshness gate once it is a declared subject — put it in the plan header
  or `lzy loop subject add <path>` (any set change invalidates all captured F
  evidence; re-capture before finish). If a subject repo gains commits before
  `finish`, re-verify and re-record. Never `register` from a non-host root.
- Parallel workers on a cross-repo goal: claim steps (`lzy loop claim`) and edit code
  in your own worktrees, but all `lzy` traffic — claim, step done, status — stays at
  the host root (see `recipes/execute.md`).
- A worktree root works as a subject too (`lzy loop subject add <worktree-path>`):
  per-root dirt and HEAD are tracked independently. An undeclared worktree stays
  invisible to the gate — declaring it is the discipline.
