# Lane rollup report

`src/cli.mjs` turns a directory of run records into one JSON report.

Run it with:

    node src/cli.mjs <records-dir>

## Input

Every `*.json` file directly inside `<records-dir>` holds exactly one record:

    {"id":"r-a","lane":"Zeta","ms":120,"status":"ok"}

`id` and `lane` are non-empty strings, `ms` is a non-negative integer, `status`
is `"ok"` or `"fail"`. Entries in the directory that are not `*.json` (notes,
for example) must be ignored. The file name of a record carries no meaning and
gives no record priority over another.

## Output

Print one JSON object on stdout with exactly two top-level keys:

    {"version": 1, "lanes": [...]}

`version` is always the number `1`. `lanes` holds one object per lane, each
with exactly these keys:

    {"lane":"...","runs":0,"ok":0,"failed":0,"totalMs":0,"order":[]}

* `runs` is the number of records in the lane, `ok` the number whose status is
  `"ok"`, `failed` the rest, `totalMs` the sum of their `ms`.
* `order` lists every id of the lane, slowest first (largest `ms` first). Ids of
  records that share the same `ms` come out ascending.
* `lanes` is ordered by `lane` ascending.

String comparison is a plain `<` / `>` comparison on the strings (UTF-16 code
units). Locale-aware collation must not be used anywhere.

## Determinism

The same collection of records must always yield exactly the same output:
across repeated runs, across record files that the filesystem happens to list
in a different order, and across machines with different time zone or locale
settings. Nothing derived from the current time or from randomness may appear
in the output.

## Constraints

Node >= 22, ES modules, no third-party packages, no network access.

## Check

    node check.mjs

It builds a small temporary fixture, runs the CLI, and must exit 0.

When you believe the task is complete, end your final message with the line `TASK COMPLETE: x16-deterministic-lane-rollup`.
