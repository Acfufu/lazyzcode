# Bounded tail scan

`src/tailscan.mjs` exports `scanTail(filePath, options)` for scanning a large
log file that must never be read in full: callers only ever need the tail, and
the read budget is part of the contract.

`options`: `{ maxBytes, deadlineMs }` — both required numbers.

Returns a promise of `{ text, truncated, readBytes }`:

- At most `maxBytes + 3` bytes may be read from the file (`+3` slack exists so
  a UTF-8 character straddling the front boundary can be dropped whole).
  Reading the whole file — even to count lines — is a contract violation.
- `text` is the decoded tail. A multi-byte character cut by the read boundary
  must be dropped whole: the decoded text must never contain a replacement
  character (`\uFFFD`) from boundary handling.
- `truncated` is `true` exactly when bytes were skipped (the file was larger
  than what was read); `false` when the whole file fit.
- `readBytes` is the number of bytes actually read
  (`<= min(maxBytes + 3, fileSize)`).
- `deadlineMs` is a hard ceiling on scan time: if exceeded, stop and return
  what is already read with `truncated: true`. It must never make the call
  throw.
- A missing file must throw. `options` missing either number must throw a
  `TypeError`.

Run `node check.mjs` for the visible cases.

When you believe the task is complete, end your final message with the line `TASK COMPLETE: x29-bounded-tail-scan`.
