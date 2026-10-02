# Resumable record importer

`src/cli.mjs` imports a JSONL source file into a JSONL output file:

    node src/cli.mjs --source <source.jsonl> --out <out.jsonl> --state <state.json>

Every line of the source file is one JSON object, for example
`{"key":"a","value":4}`. For every source record, in order, the tool appends
one JSON line to the output file:

    {"key":"a","value":4,"parity":"even","square":16}

`parity` is `"even"` when the value is even and `"odd"` otherwise, and `square`
is `value * value`. `key` is copied unchanged. Values are always integers.

`--state` names a file that belongs to the tool. It may be used for whatever
bookkeeping the implementation needs; its format is not fixed.

## What must hold

1. An uninterrupted run writes exactly the lines above, in source order, and
   exits with status 0.
2. Each record is appended to the output file as soon as it has been produced.
   Already produced records are never kept back in memory.
3. The import is resumable. Running the same command again after any number of
   interruptions, at any moments, must leave the output file holding exactly the
   lines of one uninterrupted run: nothing duplicated, nothing missing, nothing
   reordered. This includes dying between writing a record and updating the
   bookkeeping, and re-running when the bookkeeping file does not exist although
   the output file already has content.
4. If the bookkeeping file exists but cannot be read, or cannot be reconciled
   with the output file on disk (for example the output file is gone, or holds
   fewer records than the bookkeeping claims are complete), the tool must stop
   with a nonzero exit status, report the problem on stderr, and leave the
   output file exactly as it found it.
5. Re-running a finished import changes nothing.

## Simulating an interruption

When the environment variable `CANCEL_AFTER` is a positive integer `k`, the
process must terminate abruptly with exit status 70 at the instant the `k`-th
source record consumed by that run has been appended to the output file, and
before any further bookkeeping is written. Nothing is cleaned up. `k` counts
records consumed by the current run, not records in the source file.

## Checking your work

    node check.mjs

The check passes once the importer behaves as described.

When you believe the task is complete, end your final message with the line `TASK COMPLETE: x03-resumable-import-checkpoint`.
