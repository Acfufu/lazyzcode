# Doc catalog cache

`src/catalog.mjs` exports a `Catalog` class that indexes the Markdown files of a
directory and hands out a snapshot of that index on demand.

## Interface

`new Catalog(dir)` takes a directory path.

`catalog.list()` returns an array of objects `{ slug, title, bytes }`:

- Only regular files whose name ends in `.md` and that sit directly inside `dir`
  are indexed. Sub-directories and every other file type are ignored.
- `slug` is the file name without the `.md` suffix.
- `bytes` is the size of the file in bytes, counted as stored on disk.
- `title` is the text after `# ` on the first line that starts with `# `, once
  trailing `\r` characters and surrounding whitespace have been stripped. When no
  such line exists, the title falls back to the slug.
- The array is sorted ascending by `slug`, comparing UTF-16 code units.
- The array is a fresh snapshot: changing the array or its objects after a call
  must never change what a later `list()` call returns.
- When `dir` does not exist, `list()` returns an empty array.

`catalog.rebuildCount` starts at 0 for a new object and grows by one each time
`list()` rebuilds the index from disk.

## Freshness rules

- Every `list()` call must return exactly what a brand new `Catalog` for the same
  directory would return at that moment.
- Files that are created, deleted, renamed or edited must show up on the next
  call, no matter how small the edit is.
- Reusing a cached index is expected, but only while the directory has genuinely
  not changed.
- Changing only a file's timestamp, without changing its bytes, is not a change:
  `rebuildCount` must stay as it was.
- Rewriting a file with identical bytes is not a change either.
- A rebuild means re-reading the directory and building a new index; it is worth
  exactly one `rebuildCount` step.

## Constraints

- Node >= 22, ES modules, standard library only, no dependencies.
- Keep the exported name and the object shape described above.

## Running the visible check

    node check.mjs

It prints one line per case and exits with a non-zero code when a case fails.

When you believe the task is complete, end your final message with the line `TASK COMPLETE: x04-stale-markdown-catalog-cache`.
