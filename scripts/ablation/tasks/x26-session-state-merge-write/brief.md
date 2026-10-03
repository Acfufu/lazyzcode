# Status file merge-write

`src/state-file.mjs` exports `mergeWrite(filePath, patch)`. Several
long-running workers share one JSON status file per worker id. Each worker only
knows its own subset of fields, so a write must never erase fields written by
the others.

`mergeWrite(filePath, patch)`:

1. Read the existing JSON at `filePath`; if the file is missing or is not
   parseable as JSON, the base is `{}` (a corrupt file is replaced, not merged).
2. Shallow-merge `patch` over the base: keys present in `patch` win, every key
   absent from `patch` is preserved. Keys whose value is `undefined` are
   skipped entirely (they must not delete or overwrite anything).
3. Write the merged object back so that no reader ever observes a partial
   write: write a temp file in the same directory, then rename it over the
   target. The temp file must be gone when the call returns.
4. Return the merged object.

`patch` must be a plain object; for anything else throw a `TypeError` before
touching the file.

Run `node check.mjs` for the visible cases.

When you believe the task is complete, end your final message with the line `TASK COMPLETE: x26-session-state-merge-write`.
