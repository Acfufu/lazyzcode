# Recipe: evidence (F items)

For each F item, either verify it yourself or — when the surface needs careful
command-by-command capture — spawn `lazyzcode:qa-executor` with the item and the
suggested command; it returns verbatim observed output and a MATCH verdict.

`lzy step done F1 --evidence "<the observable result you actually saw>"`

- **Tests alone never prove done.** Green tests are necessary, not sufficient.
- **Evidence binds the composite fingerprint** (sha256 over every {host}∪subjects
  root's HEAD tree hash) — any root changing (or the subject set itself changing)
  makes the evidence stale.
- **Live-surface ordering**: when an F-item's evidence surface is an expensive, flaky
  live run (UI test, paired device, real session), iterate the test harness to
  stability BEFORE banking any green half — capture all greens in one final batch
  after the harness freezes. A test-only commit after greens are banked invalidates
  every one of them. Preflight the environment before a formal capture; failures
  attributed to infrastructure (`INFRA-FAIL:` in the attempt note) do not retire an
  approach — only assertion failures do.
- Run the real surface: hit the endpoint, take the screenshot, run the CLI and read
  its stdout. For web/HTTP surfaces prefer read-only HTTP via `curl` or the
  Bash-driven `ego-browser` skill — screenshots and response bodies are first-class
  F-item evidence. The built-in browser-use skill (`control-browser`) is
  main-agent-only and cannot be used inside subagents. Record what you observed, not
  what you hope. Evidence from qa-executor must quote its observed output, never its
  conclusions alone.
- **File evidence**: attach the capture itself with
  `lzy step done F1 --evidence "<what the capture shows>" --evidence-file <path>`
  (repeatable, ≤4 files per F item). `lzy` copies each file into
  `.lazyzcode/evidence/` and binds its sha256. The text still has to say what the
  capture shows — a PNG nobody describes is not evidence.
- Code changed after you captured evidence? The evidence is stale — `lzy loop
  finish` will reject it. Re-verify on the current code and re-record.

## Red-green evidence (dual evidence)

Every F-item claim carries two halves by default: a **red** capture showing the
assertion failing on the pre-change state, and a **green** capture showing it passing
on the post-change state. Capture the red half before you edit. If no counter-state
can be constructed for the surface (pure reachability, ambient facts), say so in a
one-line exemption inside the evidence text — exemptions state why, they are not a
silent skip. Narrate both halves in `--evidence`; attach both captures with
`--evidence-file` when they are files.

**Machine ledger (ADR-0014):** the halves are also machine-accounted —
`lzy evidence red <Fid> --evidence … [--surface <external-surface>]` records the red
half (default surface = composite fingerprint at capture time; `--surface` binds an
external surface; red/green each bind their OWN surface),
`lzy evidence waive-red <Fid> --reason …` is the machine form of the one-line
exemption, and the green half is mirrored automatically at `step done`. `lzy evidence
list` renders the per-F manifest (halves, surfaces, rebind chain). Since baton 2 the
ledger is the unified validity authority: `verify`/`finish` judge evidence freshness
from the ledger's green node for the goal.json-recorded generation, and an unreadable
ledger or a fingerprint-form record with no ledger node fails closed (recovery =
re-record via `step done`). "Authority" means validity judgments only: a MATCH/
MISMATCH verdict is a judgment about comparator claims, never a fact the ledger
invents.

## INV-08 / INV-09 (0.1.0, HEAVY finish machine gates)

- **INV-08 harness freeze**: record `--harness <procedure string, ≤300 chars>` on red
  and green halves; a red/green harness mismatch is a HEAVY finish reject plus a
  `list` ⚠. waive halves take no harness. When the same-source pairing claim is
  load-bearing, declare `--harness` on BOTH halves — that converts a protocol promise
  into a checked one (ADJ-47: INV-09 alone checks *presence*, not same-source).
- **INV-09 red-half presence**: HEAVY finish checks each F item for a red (or waived)
  half paired to the anchored green — a missing red is not repairable by more green;
  recover via `lzy evidence red` (reverse pairing after the green is legal —
  `recordEvidenceHalf` anchors to `findGreenByGeneration`) or `waive-red`.
