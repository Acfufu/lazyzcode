# Amount report tool

`src/cli.mjs` reads a small CSV file and prints a per-category report.
Run it from the repository root:

    node src/cli.mjs <file.csv>

All output goes to standard output. The exit code is 0 only when the whole
file was processed successfully. The tool must never print a line starting
with `SUCCESS` when any part of the file was rejected.

## Input

The file is UTF-8 text with LF line endings. Its first line must be exactly:

    id,category,amount

Every later line is either completely empty (ignored) or one record with
exactly three comma separated fields. No quoting: a comma always separates.

- `id` -- non-empty, must not repeat an id already accepted in this file
- `category` -- non-empty, may contain spaces
- `amount` -- integer cents: an optional `-` followed by one or more digits

## Output

On success print one line per category, then the summary line:

    <category> <row count> <sum of amounts>
    SUCCESS rows=<n> groups=<g> total=<t>

Categories appear in ascending code unit order. `rows` is the number of
records accepted, `groups` the number of categories printed, and `total`
the exact sum of all accepted amounts. Amounts may be larger than the safe
integer range, so the sum must stay exact.

A header-only file therefore prints just the summary line.

## Failure

On failure the only output is a single `ERROR ...` line and the exit code
is 2:

- unreadable file: `ERROR file: cannot read <path>`
- no path argument: `ERROR usage: expected <file> argument`
- first line not the exact header: `ERROR line 1: bad header`
- otherwise the first offending record: `ERROR line <L>: <reason>`

Line numbers are physical: line 1 is the header, the second physical line
is line 2, empty lines still use up a line number. Only the first
offending line is reported. Reasons: `bad field count`, `empty id`,
`duplicate id`, `empty category`, `bad amount`.

## Visible check

Run `node check.mjs`. It must report that every visible check passed.

When you believe the task is complete, end your final message with the line `TASK COMPLETE: x08-amount-report-success-guard`.
