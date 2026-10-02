# Reading summary (cached)

`src/summary.mjs` aggregates reading logs and prints a JSON summary.
It stores its result in `.cache/summary.json`, and today that stored result is
reused even after the inputs behind it have changed.

## Behavior

Run `node src/summary.mjs` from the project root.

Inputs:

- every top-level `*.json` file in `data/`; anything else in `data/` is ignored
- `config.json` at the project root: `{"exclude": ["<name>", ...]}`.
  If that file is absent, nothing is excluded.

Each data file holds `{"name": "<string>", "readings": [<number>, ...]}`.
Records that share a `name` are merged, wherever they appear, and names listed
in `config.json` are left out completely.

Output: exactly one JSON object on stdout, nothing else, exit code 0.

    {"names": {"<name>": {"count": n, "sum": s, "max": m}}}

`names` keys are sorted; `count` is the number of readings merged for that
name, `sum` is their total, `max` is the largest reading, or `null` when the
record has no readings.

## Cache

`.cache/summary.json` holds:

    {"source": "<fingerprint>", "summary": <the summary object>}

Rules:

- the stored result may be used only while it still describes the current
  inputs; it must be discarded and rebuilt when the bytes of any data file
  change (even if the file size stays the same), when a data file is added or
  removed, or when `config.json` changes
- `source` must change whenever those inputs change
- a cache file that is missing, unreadable, or malformed must never be trusted;
  the program still prints the correct summary and exits 0
- after a successful run the cache on disk must match what was printed
- `.cache/` is generated state and is never an input to the summary

## Checking your work

    node check.mjs

When you believe the task is complete, end your final message with the line `TASK COMPLETE: x13-stale-reading-summary-cache`.
