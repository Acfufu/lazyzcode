# Byte-size parsing

`src/parse-size.mjs` exports `parseByteSize(input)`, which turns a size string
such as `"2.5 MB"` into a whole number of bytes. `src/cli.mjs` is a small
command line front end for it.

Both files are currently too permissive: they accept malformed input, round
values that should be rejected, and the CLI reports partial success. Make the
behaviour below hold exactly.

## parseByteSize(input)

- `input` must be a primitive string (`typeof input === "string"`); anything
  else throws `TypeError`.
- Leading and trailing whitespace is ignored. What remains must be
  `<number><separator><unit>` and nothing else.
  - `<number>` is `0`, or a non-zero digit followed by more digits. An optional
    fractional part `.<digits>` with 1 to 3 digits is allowed, but only when
    the unit is not `B`. Signs, exponents, underscores and leading zeros are
    not allowed.
  - `<separator>` is zero or one ASCII space.
  - `<unit>` is one of `B`, `KB`, `MB`, `GB`, `TB`, `KiB`, `MiB`, `GiB`, `TiB`
    and is case sensitive. `B` is 1 byte, `KB` is 10^3 bytes and so on up to
    `TB` = 10^12; `KiB` is 2^10 bytes and so on up to `TiB` = 2^40.
- A string that does not match that shape throws `SyntaxError`.
- A matching string whose value is not a whole number of bytes, or whose value
  is bigger than `Number.MAX_SAFE_INTEGER`, throws `RangeError`.
- Otherwise return the byte count as a `number`. The value must be exact: do
  not round, and do not lose precision.

## src/cli.mjs

`node src/cli.mjs <size>...`

- No arguments: write a usage line to stderr, write nothing to stdout, exit 2.
- Parse every argument up front. If all of them are valid, write each byte
  count on its own line to stdout in argument order and exit 0.
- If any argument is invalid, write nothing at all to stdout, write a short
  error message to stderr, and exit 2.

## Constraints

- Node >= 22, ES modules, standard library only, no new files or dependencies.

## Running the check

From the repository root: `node check.mjs`

It prints a single success line and exits 0 when everything above holds.

When you believe the task is complete, end your final message with the line `TASK COMPLETE: x10-strict-byte-size-parser`.
