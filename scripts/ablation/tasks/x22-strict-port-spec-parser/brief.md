# Strict port-spec parser

The ES module `src/portspec.mjs` (Node >= 22, zero dependencies) turns a hand-written port
list into a normalized set of ranges. Today it is far too permissive: it accepts garbage and
never normalizes its output. Make it honour the contract below.

## Exports

- `PortSpecError` - an `Error` subclass whose `name` is `'PortSpecError'`.
- `parsePortSpec(text)` - parse a spec string and return the normalized range list, or throw
  a `PortSpecError`.

## Grammar

A spec is a string holding one or more comma-separated tokens. Each token is either a single
port (`<number>`) or a range (`<number>-<number>`).

A `<number>` is one to five ASCII digits (`0`-`9`). Whitespace around a token and around the
hyphen of a range is ignored; whitespace inside a number is not allowed. A token counts as a
range token when it contains at least one hyphen.

Every port value must lie in `1..65535` inclusive.

## Result

`parsePortSpec` returns an array of `[start, end]` number pairs: inclusive ranges, sorted
ascending by `start`, with duplicates collapsed and overlapping or touching ranges merged
(`80-90,91-100` becomes `80-100`). The returned list never contains ranges that overlap or
are adjacent.

## Errors

`parsePortSpec` never returns a partial or garbage result: on a bad spec it throws a
`PortSpecError` carrying `message`, `code` and `token`.

`token` is the offending comma-separated token with surrounding whitespace removed (the whole
token, before it is split into bounds), or `null` when no single token is at fault.

`code` values:

- `TYPE` - the argument is not a string (`token` is `null`).
- `EMPTY` - the whole spec is empty or whitespace only (`token` is `null`).
- `TOKEN` - a non-range token is not a valid `<number>`, or the list contains an empty token
  (a leading, trailing or doubled comma).
- `RANGE` - a range token has a missing bound, more than one hyphen, a bound that is not a
  valid `<number>`, or `start > end`.
- `OUT_OF_RANGE` - a well-formed numeric value (single port or either bound) falls outside
  `1..65535`.

## Constraints

Plain JavaScript ES modules, Node >= 22, no npm dependencies. Keep the file path and the
exported names unchanged. `check.mjs` exercises only a few examples of the contract; it is
not exhaustive, and the whole contract above has to hold.

## Visible check

    node check.mjs

On a correct parser it exits 0 and prints only `ok` lines plus a short summary.

When you believe the task is complete, end your final message with the line `TASK COMPLETE: x22-strict-port-spec-parser`.
