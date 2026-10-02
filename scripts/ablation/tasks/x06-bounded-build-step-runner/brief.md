# Bounded step runner

`run-steps.mjs` executes a list of shell steps read from a JSON file. Build
pipelines sometimes contain a step that never exits, so the runner must stay in
control of every command it starts.

## Input

The path given on the command line points at an array of step objects:

    [{"name": "build", "command": "make all", "timeoutMs": 2000}]

- `name` - label used in the report.
- `command` - a shell command line.
- `timeoutMs` - optional budget in milliseconds. A missing, non-numeric or
  non-positive value means the default budget of 1000 ms.

## Behaviour

Run it with: `node run-steps.mjs <steps.json>`

- Steps run one at a time, in file order.
- Every command is executed through `/bin/sh -c "<command>"`.
- Step stdout and stderr are not copied to the runner's output.
- One line is printed per step, in step order:

      STEP <name> <status>

  `<status>` is `ok` when the command exits with code 0, `failed` for any other
  exit code (or when the command could not be started), and `timeout` when the
  command is still running after its budget.
- A step that runs past its budget must be stopped, together with any process it
  started, and must never delay the steps that follow. The run continues with
  the next step.
- After the last step a final line is printed: `RESULT ok` when every step
  reported `ok`, otherwise `RESULT failed`.
- The process exits with code 0 when the final line is `RESULT ok` and with
  code 1 otherwise.

## Constraints

- Node 22 or newer, ES modules, no dependencies.
- The runner must always terminate, whatever the steps do.

## Local check

    node check.mjs

It prints `PASS` lines while everything holds, and finishes in a few seconds.

When you believe the task is complete, end your final message with the line `TASK COMPLETE: x06-bounded-build-step-runner`.
