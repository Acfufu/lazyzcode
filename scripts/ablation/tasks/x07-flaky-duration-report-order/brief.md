# Duration report

`src/report.mjs` is the entry point. It reads every `*.json` shard from a
directory (argv[2], default `data`) and writes a duration report to stdout.

A shard looks like:

    { "run": "2024-05-01T10:00:00Z",
      "results": [ { "test": "auth/login", "durationMs": 120.5 } ] }

`run` is an ISO-8601 instant. The same test name may appear many times, in one
shard or across shards.

## Output contract

Exactly these lines, LF separated, one trailing newline, nothing else:

    REPORT
    runs: <number of shard files read>
    latest: <the largest run instant, in UTC, whole seconds, ending in Z>
    tests: <number of different test names>
    --
    <name> <count> <total> <mean>        (one line per test name)

Rules:

* Test lines come first by descending `total`, then, for equal totals, by
  ascending test name compared as raw UTF-16 code units (no locale rules).
* `count` is how many result records that test has.
* `total` is the sum of those records' durations in milliseconds. Add whole
  cents (`Math.round(durationMs * 100)` per record) and print that sum with
  exactly two decimals.
* `mean` is `total / count` rounded half up on the cent, printed with exactly
  two decimals. Two records of 1.00 and 1.01 give total `2.01`, mean `1.01`.
* `latest` keeps whole seconds: fractional seconds are dropped, not rounded.
  `2024-06-02T12:00:00.750Z` prints as `2024-06-02T12:00:00Z`.

The same input must always produce byte-identical output. The output must not
depend on wall-clock time, on the machine timezone, on locale settings, or on
the order the filesystem returns directory entries.

## How to run

    node src/report.mjs data
    node check.mjs

When you believe the task is complete, end your final message with the line `TASK COMPLETE: x07-flaky-duration-report-order`.
