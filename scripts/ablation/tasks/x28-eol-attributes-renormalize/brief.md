# Line-ending renormalize planner

`src/eol.mjs` exports `plan(files, rules)` — a pure planner that decides which
files need their line endings rewritten to match repository attributes.

Inputs:

- `files`: array of `{ path, content }` (content is a string; `\n` and `\r\n`
  may both appear).
- `rules`: array of `{ pattern, eol }` where `pattern` is a path suffix
  (e.g. ".md") matched against the file path's ending, and `eol` is
  "lf", "crlf", or `null` (binary — never rewritten).

Returns an array of `{ path, action }` in the same order as `files`:

- the target ending for a file comes from the **last** matching rule;
  a file matching no rule is never rewritten;
- `action` is "rewrite" when the content contains any line break that does not
  match the target ending — a lone `\r` not followed by `\n` also counts as a
  mismatch for any target — otherwise "ok";
- files with a `null`-eol (binary) rule, or no matching rule, are always "ok";
- empty content is always "ok".

The function must be pure: no filesystem access, no mutation of its inputs.

Run `node check.mjs` for the visible cases.

When you believe the task is complete, end your final message with the line `TASK COMPLETE: x28-eol-attributes-renormalize`.
