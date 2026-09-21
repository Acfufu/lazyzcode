# Contributing to LazyZCode

Thanks for helping make LazyZCode better. LazyZCode is an AI coding-workflow
discipline layer for ZCode: plan → execute → take evidence → never stop
half-done. It ships as a plugin plus a lightweight CLI (`lzy`), with zero
runtime dependencies and zero telemetry.

## Read the constitution first

[`AGENTS.md`](AGENTS.md) is the single source of truth for this repository —
ZCode reads it automatically, and so should you before opening a PR:

- **§4 Decision table** — every settled decision, with dates. A decision
  change requires a matching row update in the same PR.
- **§5 Red lines** — two hard constraints no implementation may violate.
- **§6 License boundary** — what may be borrowed from where.
- **§8 Glossary** — project vocabulary; check it before coining new terms.

## Project layout

| Path | What lives there |
| --- | --- |
| `plugin/` | Skills (`zw`, `init-deep`), six hooks (via the `run-hook` launcher), three read-only agent roles |
| `core/` | Shared logic: loop state machine, invalidation DAG, attempt lineage, evidence, install/sync |
| `cli/` | The `lzy` CLI |
| `test/` | Contract tests (`node:test`, zero dependencies) |
| `docs/` | Docs site source (Jekyll), ADRs, review reports, research notes |

## Development setup

1. Node **≥ 22** (the project floor; see `engines` in `package.json`).
2. Clone and enter the repository — there is no install step, because the
   repository has zero dependencies:
   ```
   git clone https://github.com/Acfufu/lazyzcode && cd lazyzcode
   ```
3. Run the contract tests: `npm test`.
4. Try the CLI against a scratch repository:
   ```
   npm run install:local
   cd /tmp/scratch-repo
   node /path/to/lazyzcode/cli/lzy.js doctor
   ```
5. After editing, `npm run sync` redeploys the plugin payload into your ZCode
   cache so you can dogfood the change in a real session.

## Tests

- `npm test` runs every contract suite: `node --test "test/**/*.test.js"`.
- CI runs the suite on four legs: Node 22 and 24 × Ubuntu and Windows.
- Platform pitfalls are real: several classes of bugs only reproduce on
  Windows (`pathToFileURL`, `HOME` vs `USERPROFILE`, path separators). If a
  change touches paths, processes, or environment variables, exercise the
  Windows leg — a green macOS run is not Windows evidence.

## Ground rules (non-negotiable)

1. **Never write the user's `config.json`.** Installing means plugin cache
   placement plus a registry write; enabling goes through the engine's
   official `plugins enable` (ADR-0001).
2. **Stop-hook budget coexistence.** The `lzy` Stop hook requests at most 2
   continuations per session, reserving 1 slot of the shared pool of 3 for
   engine background-task notifications.
3. **Expression hierarchy: Skill > MCP > Tool > Hook.** If skill text can
   carry it, don't write a hook. Hooks fail open — a broken hook degrades the
   discipline layer, never the host session.
4. **Zero telemetry.** Diagnostics are computed and printed locally by
   `lzy doctor`; nothing leaves the machine.
5. **License boundary.** Adapt from `lazycodex` (MIT) only with attribution;
   never copy code or text from `oh-my-openagent` (SUL-1.0) — its ideas only
   (AGENTS.md §6).

## Commit conventions

- Subjects follow conventional style, as in the history: `feat:`, `fix:`,
  `docs:`, `chore:`, scoped where useful (`docs(release):`, `chore(cli):`).
- Work driven by a goal loop carries the ledger trailer `Goal: <slug>#<step>`
  on every commit (ADR-0005). Maintenance work outside a loop omits it;
  `lzy doctor` will report reduced ledger coverage as a warning, which is
  expected for such commits.

## Pull requests

Open PRs against `main`. A pull request is a review handoff, not just a
diff: a reviewer must be able to verify the result without reconstructing
your work. The PR template (structure adapted from
[openchamber](https://github.com/openchamber/openchamber), MIT) asks for:

- **Intent and non-goals** — the problem solved, and nearby behavior
  deliberately left unchanged.
- **Affected surfaces** — one line per platform and package; "not
  applicable" is an answer, a blank row is not.
- **Repository guidance** — the AGENTS.md rules the change touches (§4, §5,
  §6, §8), why they apply, and how it complies.
- **Validation** — exact commands with results, red-green where applicable
  (a face with no constructible failing state gets a one-line exemption with
  its reason), and platform evidence: a green macOS run is not Windows
  evidence.
- **Risks** — failure, rollback, compatibility concerns.

Keep PRs focused — one concern per PR. Bugs and feature ideas go through the
issue templates: for bugs, attach `lzy doctor` output, the project's local,
telemetry-free diagnostic — it answers most environment questions in one
shot.

## Not a developer?

You can still help: report bugs or confusing behavior through the issue
templates, exercise the platform combinations we test less (Windows arm64,
Linux aarch64 desktop), and improve the bilingual docs. Issues in English or
中文 are both welcome; the docs site carries both languages.

## License

By contributing, you agree that your contributions are licensed under the
[MIT License](LICENSE).
