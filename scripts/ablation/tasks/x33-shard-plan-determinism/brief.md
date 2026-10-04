# Shard planner

`src/cli.mjs` turns a test manifest into a shard plan and prints it as JSON.

    node src/cli.mjs <manifest.json> [shardCount]

`shardCount` is an integer >= 1 and defaults to 1 when the argument is omitted.

## Manifest

    {
      "name": "api-suite",
      "files": [
        { "id": "auth-login", "durationMs": 5 },
        { "id": "auth-refresh", "durationMs": 1 }
      ]
    }

`id` is a non-empty string, unique inside one manifest. `durationMs` is a non-negative integer.

## Output

Write exactly one line of compact JSON to stdout, then a newline, and nothing else:

    {"shards":[{"index":0,"totalMs":5,"files":["auth-login"]}],"totalMs":5,"fileCount":1}

* `shards` holds exactly `shardCount` entries, with `index` running 0, 1, 2, ... in that order.
* `files` in a shard is the list of ids assigned to it, sorted ascending by code unit.
* A shard's `totalMs` is the sum of the durations of the files assigned to it.
* Top-level `totalMs` is the sum over all files; `fileCount` is the number of files.
* The output has exactly the keys shown above: `shards`, `totalMs`, `fileCount`, and per shard
  `index`, `totalMs`, `files`. No other keys, no run metadata.

## Balancing rule

Walk the files in this order: duration descending, and files with equal duration in ascending
`id` order. Give each file to the shard that currently has the smallest `totalMs`; if several
shards are tied for the smallest, take the one with the lowest `index`. Every shard starts at 0.

Two runs with the same manifest and shard count must produce byte-identical stdout, no matter
when, where or in which environment they run.

## Constraints

Node >= 22, ES modules, zero dependencies, no network access. `src/cli.mjs` stays the entry point.

## Local check

    node check.mjs

prints `check.mjs: ok` and exits 0 while the behaviour described above holds.

When you believe the task is complete, end your final message with the line `TASK COMPLETE: x33-shard-plan-determinism`.
