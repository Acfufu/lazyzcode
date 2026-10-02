# Resumable chunk spool writer

`src/writer.mjs` provides a small library that splits a payload file into fixed-size
chunks inside a spool directory and can rebuild the payload from those chunks.
The writer runs as a job that may be interrupted and started again later.

## API

- `writeSpool({ sourcePath, spoolDir, chunkSize, journalPath?, interruptAfter? })`
- `assembleSpool({ spoolDir, journalPath?, outPath })`
- `readJournal(journalPath)` and `chunkFileName(index)` are exported as well.
- `writeSpool` returns `{ chunks, bytes }`; `assembleSpool` returns `{ chunks, bytes }`.
- `chunkSize` must be a positive integer; any other value throws.

## Behaviour

- The source file is split into consecutive chunks of `chunkSize` bytes; the final
  chunk holds the remainder. An empty source produces zero chunks.
- Chunk `i` is stored at `<spoolDir>/chunk-<i>.bin`, where `<i>` is the index padded
  with zeroes to a width of at least four digits (`chunk-0000.bin`, `chunk-0001.bin`).
- Progress is recorded in a journal (default `<spoolDir>/journal.log`), one LF
  terminated line per chunk: `<index> <byteLength> <sha256hex>`.
- When a run finishes, the journal must describe exactly the chunks of the current
  source: one ascending line per chunk carrying its true length and digest. The
  spool directory must then contain only the expected chunk files, plus the journal
  when the journal lives there. No temporary or leftover files may remain.
- Re-running over an existing spool must be resumable and idempotent: the writer
  trusts nothing it finds on disk, repairs whatever does not agree with the source,
  and leaves the spool identical to a fresh run.
- A run can be cancelled: with `interruptAfter: n` the writer stops right after the
  n-th chunk it commits, leaves a consistent spool that a later run can finish, and
  throws an error whose `code` is `SPOOL_INTERRUPTED`. Several cancellations in a
  row must still converge on a correct spool.
- `assembleSpool` writes the chunks to `outPath` in ascending index order. It must
  refuse to produce output unless every chunk it uses is present and matches the
  length and digest recorded for it; when it refuses, it throws and leaves no output
  file behind.
- A spool directory and journal left behind by an earlier partial or cancelled run
  must be handled.
- No npm dependencies, no network access.

## Command line

- `node src/cli.mjs write <source> <spoolDir> <chunkSize>`
- `node src/cli.mjs assemble <spoolDir> <outPath>`

## Checking your work

From the repository root run `node check.mjs`. It prints one line per case and exits
with a non-zero status if any case fails.

When you believe the task is complete, end your final message with the line `TASK COMPLETE: x12-resumable-chunk-spool-writer`.
