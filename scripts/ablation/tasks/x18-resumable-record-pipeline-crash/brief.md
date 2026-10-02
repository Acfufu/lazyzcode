# Resumable record pipeline

`src/pipeline.mjs` exposes `runPipeline(options)`. It converts every non-empty line of an
input file into one output line. A run can be interrupted at any moment, and a later run
must continue the work without losing or repeating records.

## Files

- **input** — one record per line; blank lines are ignored and never produce output.
- **output** — one line per committed record, in input order, formatted `"<index>:<RECORD>"` where `<index>` is the 0-based position of the record and `<RECORD>` is that input line uppercased.
- **state** — JSON `{"version":1,"committed":<non-negative integer>}`, where `committed` counts the records that are safely in the output file.

## Behaviour

`runPipeline({ inputPath, outPath, statePath, interrupt })` returns `{ total, committed }`:
the number of input records, and how many are committed when the run ends.

The optional `interrupt(phase, index)` callback simulates a crash. `index` is the 0-based
position of the record being handled and `phase` is one of:

- `"start"` — before the run reads or writes any file (`index` is `0`);
- `"before-output"` — the state file still records `index` committed records and the output file holds exactly `index` complete lines;
- `"after-output"` — the record's line is in the output file, the state file still records `index` committed records;
- `"after-state"` — the state file records `index + 1` committed records and the output file holds `index + 1` complete lines.

If the callback throws, the run stops at that point. The files left behind must stay
usable: the state file is either the previous version or the new one, never half written,
truncated or unreadable. The next run resumes from the state file, first discarding any
output written after the last committed record, and the committed count never decreases.

If `statePath` does not exist the run starts fresh and truncates an existing `outPath` to
empty before writing anything. When a run ends normally, the state file records every
input record as committed, so running a finished pipeline again is a no-op that leaves the
output and state files byte-identical.

A persisted state is invalid when it is not a JSON object, when `version` is not `1`, when
`committed` is not an integer >= 0, or when it claims more committed records than the
input file or the output file can account for. `runPipeline` must then throw an `Error`
whose message contains `corrupt state` — it must not restart silently or fail with an
unrelated parse error.

## Constraints

Node >= 22, ES modules, standard library only, no new dependencies. Keep the module path
`src/pipeline.mjs` and the exported `runPipeline` name.

## Checking

    node check.mjs

The check exercises an interrupted run followed by a resume; it fails on the current code.

When you believe the task is complete, end your final message with the line `TASK COMPLETE: x18-resumable-record-pipeline-crash`.
