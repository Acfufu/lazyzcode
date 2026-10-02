# Envelope renderer

`src/render-cli.mjs` turns one document file into a single-line JSON record. Documents come from
untrusted sources, so text inside a document, and text inside a supplied variable value, is data
only. It must never change how the document is parsed, which lines are headers, or how substitution
runs.

## Document layout

A document is text split into lines on `\n`.

- Line 1 must be exactly `--- headers ---`.
- The header section is every line after line 1, up to but not including the first line that is
  exactly `--- body ---`.
- A header line must be `<key>: <value>`, where `<key>` matches `[a-z][a-z0-9_-]*` and `<value>` is
  the rest of the line. If the same key appears twice, the later value wins.
- Inside a value, `\n` means a newline and `\\` means one backslash; any other backslash stands for
  itself. Decoding happens after the document is split into lines, so a decoded newline is ordinary
  text and never starts a header or a section.
- The body is every line after the `--- body ---` line, joined with `\n`.

## Output

    node src/render-cli.mjs <path> [--var name=value ...]

prints exactly one line of compact JSON with the keys `title`, `priority`, `body`, in that order,
for example `{"title":"Hello","priority":3,"body":"first"}`.

- `title`: the `title` header, or `""` when it is absent.
- `priority`: the `priority` header, or `0` when it is absent. When present it must be one or more
  digits `0-9`, and its value is the integer those digits denote.
- `body`: the body text after substitution.

## Substitution

`{{name}}`, where `name` matches `[A-Za-z_][A-Za-z0-9_]*`, is replaced by the value of the `--var`
with that name. This applies to `title` and to `body`. Any other `{{ ... }}` text stays exactly as
written, as does a placeholder whose name was not supplied. Substitution is one pass over the
original text: a value that came from a variable is never scanned for further placeholders.

## Failure

A document that does not match the layout above, an unusable `--var`, or a missing or extra path
argument is an error: stdout stays empty, a line starting with `error: ` goes to stderr, and the
exit code is `2`.

## Check

Run `node check.mjs` from the repository root. It prints one line per case and exits nonzero when a
case fails. Node >= 22, no npm dependencies.

When you believe the task is complete, end your final message with the line `TASK COMPLETE: x02-untrusted-envelope-placeholder-render`.
