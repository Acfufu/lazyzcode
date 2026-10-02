# Notes packer

`pack.mjs` turns the documents in `src/` into a publishable folder in `dist/`.

## What it must do

Run with:

    node pack.mjs

It must:

1. Recursively collect every regular file under `src/` whose name ends in
   `.md` or `.txt`. Nothing else is eligible.
2. Reproduce those files under `dist/`, keeping the same relative paths and
   the same bytes.
3. Write `dist/index.json`: one JSON object whose keys are the packed
   relative paths (forward slashes) and whose values are the byte sizes of
   the packed files.

## Output contract

After any successful run:

* `dist/` contains exactly the entries produced from the *current* contents
  of `src/` - nothing else. No stale entries from an earlier run, no scratch,
  staging, cache or intermediate entries, no leftovers of any kind.
* Nothing outside `dist/` is created, changed or deleted by the run. `src/`
  is never touched.
* Running the build twice in a row leaves `dist/` byte-for-byte identical;
  the run is deterministic.

## Constraints

* Node >= 22, ES modules, no third-party packages, no network access.

## Checking your work

    node check.mjs

`check.mjs` builds a throwaway copy of the project and prints `PASS` when the
basic contract holds; otherwise it prints a `FAIL:` line and exits nonzero.
It does not cover every consequence of the contract above.

When you believe the task is complete, end your final message with the line `TASK COMPLETE: x14-document-pack-clean-dist`.
