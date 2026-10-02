# Content index builder

`tools/build-index.mjs` builds a small index of the Markdown sources in `content/`.
Run it from the repository root:

    node tools/build-index.mjs

It must work with plain Node (>= 22) and no dependencies.

## Layout

- `content/` — hand-written sources owned by the author. The tool never creates,
  moves, rewrites or deletes anything in here.
- `out/index.md` — the generated index. This is the only file the tool may
  produce outside its own scratch space.
- `.build/` — scratch space reserved for the tool. It may hold temporary files
  while the tool runs; no files may remain there once the tool exits.

## Output

`out/index.md` lists every entry in `content/` whose name ends in `.md`, one per
line, as `- <name>`, sorted ascending by code unit (plain byte order, not
locale-aware), and ends with a newline. Only the file name is listed. Entries
that do not end in `.md` are ignored. If there is no matching entry the file is
empty (0 bytes).

## Requirements

- Nothing inside `content/` is ever created, removed or modified.
- Temporary files live only in `.build/` and are gone when the tool exits,
  whether the run succeeded or failed. A run also clears scratch left behind by
  an earlier interrupted run.
- `out/index.md` is replaced atomically; a reader never sees a half-written
  file, and a failing run leaves the previous `out/index.md` byte-for-byte
  intact.
- Runs are idempotent: running the tool twice in a row leaves the same index and
  the same set of files on disk.
- Every `content/*.md` entry must be a regular file whose bytes are valid UTF-8.
  If an entry is not, or if `content/` cannot be read at all, the tool exits with
  a non-zero status, prints a short message on stderr, and leaves `content/` and
  `out/` untouched.
- A successful run exits 0.

## Checking

`node check.mjs` builds a small sandbox and reports whether the index comes out
right. It is only a quick smoke test.

When you believe the task is complete, end your final message with the line `TASK COMPLETE: x05-generated-index-clean-worktree`.
