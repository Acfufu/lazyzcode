<!--
PR template structure adapted from openchamber (MIT):
https://github.com/openchamber/openchamber
A pull request is a review handoff: a reviewer must be able to verify the
result without reconstructing your work.
-->

## Intent

<!-- What user or maintainer problem does this solve? What behavior changes?
Link the issue, or the goal slug + attempt for loop-driven work. -->

## Non-goals

<!-- Nearby behavior intentionally left unchanged when the scope could be
ambiguous. Write "None" only when the scope is unambiguous. -->

## Affected surfaces

<!-- One line per row: what this change does there. "Not applicable" is an
answer; a blank row is not. -->

| Surface | Behavior after this change |
|---|---|
| macOS |  |
| Windows |  |
| Linux |  |
| npm package / `lzy` CLI |  |
| Plugin (skills / hooks / agents) |  |

## Repository guidance

<!-- The AGENTS.md rules this change touches (§4 decisions, §5 red lines,
§6 license boundary, §8 vocabulary): why each applies and how the change
complies. Do not merely list filenames. -->

| Guidance | Why it applies | How the change complies |
|---|---|---|
|  |  |  |

## Validation

<!-- Exact commands and manual checks with their results, plus what was NOT
verified. A command name without a result is not evidence; green types/lint
do not evidence runtime behavior. -->

| Check | Result |
|---|---|
| `npm test` |  |

**Red-green:** <!-- For behavior changes: the assertion failing on the
pre-change state, then passing after. A face with no constructible failing
state gets a one-line exemption with its reason — not a silent skip.
Docs-only: say "docs-only". -->

**Platform:** <!-- A green macOS run is not Windows evidence. If paths,
processes, or env vars are touched, name what you ran on Windows (and Linux)
and what you saw, or state concretely why the change cannot differ per
platform. -->

## Risks and failure behavior

<!-- Failure, rollback, compatibility, security, performance, and
cross-platform concerns. "None identified" only with a concrete reason. -->

## Commit hygiene

- [ ] Conventional subjects (`feat:`, `fix:`, `docs:`, `chore:`); goal-loop commits carry the `Goal: <slug>#<step>` trailer (ADR-0005)
- [ ] User-facing changes have a `CHANGELOG.md` entry
- [ ] Decision changes update AGENTS.md §4; phase advances update §2
- [ ] License boundary respected: nothing copied from oh-my-openagent (SUL-1.0); lazycodex (MIT) adaptations noted (§6)
