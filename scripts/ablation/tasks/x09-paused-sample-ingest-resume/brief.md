# Resumable sample ingest

`src/ingest.mjs` exports `run(dir)`, a job that turns a command log into a
normalized sample file. An external scheduler drives it: it calls `run`, the
job does some work, it may be told to stop, and it is called again later. Every
call can happen in a fresh process, so the only things that survive between
calls are the files inside `dir`.

## Files (all inside `dir`)

- `commands.ndjson` - one JSON object per line, written by the scheduler. Two
  kinds of commands appear: `{"op":"sample","id":"...","value":N}` and
  `{"op":"pause"}`. It is input only and must never be rewritten.
- `samples.ndjson` - the output. One JSON record per `sample` command:
  `{"seq":<index>,"id":<id>,"value":<value>}`, where `<index>` is the
  0-based line position of that command in `commands.ndjson`. Every line must
  be a complete JSON object and the file must end with a newline.
- `state.json` - the checkpoint owned by the job, shaped `{"cursor":<index>}`,
  where `<index>` is the position of the next command still to be handled. It
  is written by the job; the scheduler never touches it.

## Behaviour

`run(dir)` returns `{ status, processed }` and starts at the checkpoint
position:

- `sample` appends its record; a sample that is already recorded is not
  appended a second time.
- `pause` means stop now: the checkpoint is persisted and the call returns
  `{ status: "interrupted" }`. The pause command itself counts as handled, so
  the next call continues after it.
- Reaching the end of the log returns `{ status: "done" }`.

A `pause` may sit anywhere in the log and pauses may appear many times in a
row, including as the very last command. The process can vanish between calls
and a call can be abandoned at any moment.

Whatever the pattern of pauses, once `run` reports `"done"` for the first
time, `samples.ndjson` must hold exactly one record per `sample` command, in
log order, with the right `seq`, `id` and `value`; calling `run` again must
leave the directory exactly as it was.

`state.json` is a hint, not the truth: it can be missing, it can be older than
the output, and it can also be a leftover of an earlier run. The durable
records in `samples.ndjson` are what has to be trusted, and a checkpoint that
disagrees with the output must never lead to duplicated or dropped records.
The output file can moreover be left half-written; the job has to recover from
that on its own.

## Constraints

- Node >= 22, ES modules, no dependencies, standard library only.
- Never modify `commands.ndjson`; only ever append to `samples.ndjson`.
- LF line endings, UTF-8, no binary content.

## Running the check

    node check.mjs

When you believe the task is complete, end your final message with the line `TASK COMPLETE: x09-paused-sample-ingest-resume`.
