# Deadline-bounded task supervisor

`runner.mjs` runs the external commands listed in a JSON manifest, one after
another. Some commands never finish on their own, so every command must be
bounded by an explicit time budget and the whole run must always terminate.

## Usage

```
node runner.mjs <manifest.json>
```

Manifest:

```json
{
  "defaultTimeoutMs": 2000,
  "tasks": [
    { "name": "alpha", "command": "node", "args": ["work.mjs"], "timeoutMs": 500 }
  ]
}
```

- `tasks` is required and is an ordered array.
- `name` and `command` are required non-empty strings.
- `args` is optional; when present it must be an array of strings.
- `timeoutMs` is a positive integer. When a task omits it, or gives anything
  that is not a positive integer (`0`, `-5`, `"soon"`, ...), the manifest's
  `defaultTimeoutMs` applies; when that is also absent or invalid, use `2000`.

## Output contract

For every task, in manifest order, print exactly one line to stdout, with no
spaces anywhere inside it:

```
{"name":"<name>","status":"<status>","exitCode":<code>,"timedOut":<bool>}
```

- `status` is `"ok"` when the command exits with code 0; `"failed"` when it
  exits with a non-zero code, is terminated by a signal on its own, or never
  starts; and `"timeout"` when the supervisor stopped it for exceeding its
  budget.
- `exitCode` is the numeric exit code, or `null` when there is none (killed by a
  signal, stopped for a timeout, or never started).
- `timedOut` is `true` exactly for the `"timeout"` status.
- A task that overruns its budget must be stopped and reported as `timeout`
  within the supervisor's own deadline; the run must never block on it.
- Every task in the manifest is attempted, even after a timeout.

After the last task print:

```
SUMMARY ok=<n> failed=<n> timeout=<n>
```

Exit status: `0` when every task was `ok`, `1` when any task was not `ok`, and
`2` when the manifest is missing, unreadable or malformed (in that case no
`SUMMARY` line is printed).

## Constraints

- Node >= 22, ES modules, no npm dependencies, no network access.
- Runs must be deterministic and must always terminate.

## Visible check

```
node check.mjs
```

It exits 0 when the supervisor bounds a command that never ends, and prints a
short report otherwise.

When you believe the task is complete, end your final message with the line `TASK COMPLETE: x15-deadline-task-supervisor`.
