# Note store: escaped key/value records

`src/store.mjs` implements the small line-based store format used to keep field
notes on disk. The format must survive values that come from untrusted text: a
value holding a line break, a `#`, or an `=` must stay data and must never turn
into a new record, a comment, or a directive.

## File format

- Text is UTF-8, split into lines on `\n`. A single trailing `\r` on a line is
  ignored.
- A line is skipped when its trimmed form is empty, or when its first non-space
  character is `#`.
- Every other line must look like `KEY=VALUE`:
  - `KEY` matches `^[A-Za-z_][A-Za-z0-9_-]*$` and must not be padded with
    spaces. An empty key, a key containing a space, or a key starting with a
    digit is an error.
  - `VALUE` is everything after the first `=`, taken verbatim (never trimmed).
  - A line with no `=` at all is an error.
- Inside `VALUE` four escape sequences are recognised: `\\` for a backslash,
  `\n` for LF, `\r` for CR and `\t` for TAB. Any other `\x` pair, and a
  backslash at the end of a value, is an error. Every other character is
  literal data.
- The same key may not appear twice in one file.

## API

`parseStore(text)` returns a `Map` of string keys to string values, in file
order. It throws an `Error` for any malformed line, bad key or bad escape.

`formatStore(entries)` takes a `Map` of strings and returns text. Keys are
validated and values are escaped, so that `parseStore(formatStore(m))` yields a
`Map` equal to `m` for any map of strings. Each entry becomes exactly one line
ending in `\n`; an empty map produces `""`. Iteration order is preserved.
`formatStore` throws an `Error` for an invalid key or a non-string value.

## Run the visible check

```
node check.mjs
```

When you believe the task is complete, end your final message with the line `TASK COMPLETE: x11-note-store-escape-roundtrip`.
