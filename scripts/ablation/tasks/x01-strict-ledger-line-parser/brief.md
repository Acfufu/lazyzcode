# Strict ledger parsing

`src/ledger.mjs` is a dependency-free ES module that reads a small text ledger. It is
too permissive: it silently accepts malformed records and produces wrong numbers.
Make it strict. Keep the public API as it is.

## API

- `parseAmount(text)` -> the amount as an integer number of minor units (cents).
- `parseLedger(text)` -> `{ entries, total }`. `entries` holds `{ date, amount, memo }`
  objects in input order; `total` is the sum of the entry amounts.
- `ParseError` extends `Error` with `name === "ParseError"`. Invalid input always
  raises it. When the error comes from `parseLedger`, `error.line` is the 1-based
  number of the offending line, counting every line of the text; otherwise
  `error.line` is `null`.

## Amount syntax

An amount matches exactly

    -?(0|[1-9][0-9]*)(\.[0-9]{1,2})?

So: no surrounding whitespace, no `+` sign, no exponent, no hex or binary, no
thousands separators or underscores, no trailing dot, no leading zeros apart from the
single `0`. The value is the exact integer count of minor units and its absolute value
must not exceed `Number.MAX_SAFE_INTEGER`; anything larger is invalid. Floating point
arithmetic must never round or alter the result.

## Ledger text

- Records are separated by `\n`. A single trailing `\r` on a line is not part of it.
- Lines that are empty or contain only whitespace are skipped, but they still count
  for line numbering.
- Every other line has exactly three `|`-separated fields.
- Field 1 is a date written `YYYY-MM-DD` that must exist on the calendar, including
  correct leap years. No surrounding whitespace.
- Field 2 is an amount in the syntax above, used verbatim.
- Field 3 is the memo. It is trimmed and may be empty.
- Parsing is all-or-nothing: the first bad line raises `ParseError` and nothing is
  returned.

## Running the check

From the repository root:

    node check.mjs

It prints one line per case and exits non-zero when something is wrong.

When you believe the task is complete, end your final message with the line `TASK COMPLETE: x01-strict-ledger-line-parser`.
