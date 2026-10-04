# Manifest exporter

`run.mjs` exports a JSON manifest: it reads a manifest file and writes one JSON
file per record into an output directory. Today the program claims success in
cases where no file was produced, and it ignores most manifest rules.

## Usage

    node run.mjs <manifest.json> <outDir>

## Manifest rules

The manifest holds a JSON array of record objects, e.g.

    { "id": "a1", "group": "team/one", "name": "Alpha", "value": 3 }

- `id` is required and must be a string matching `^[a-z][a-z0-9-]*$`.
- `group` is optional; when present it must be a string holding `/`-separated
  segments that each match `^[a-z][a-z0-9-]*$`, with no empty segment and no
  leading or trailing `/`.

## Per-record behaviour (manifest order)

- A record whose `id` or `group` breaks a rule above is not written.
- A record that would target the same output file as an earlier record of this
  run is not written.
- Every other record produces `<outDir>/<group>/<id>.json`, creating missing
  directories, with content exactly equal to `JSON.stringify(record, null, 2)`
  followed by one `\n`.

## Report on stdout

One line per record, `<i>` being the zero-based index:

    record <i>: ok <path relative to outDir, '/' separated>
    record <i>: failed invalid id
    record <i>: failed invalid group
    record <i>: failed duplicate id
    record <i>: failed write failed

A write that does not succeed (for any reason) is `failed write failed`, never
`ok`. The last stdout line is always:

    summary: written=<W> failed=<M> total=<T>

with `T` the record count, `W` the number of files really written by this run,
`M` the number of records not written, and `W + M == T`.

If the manifest cannot be read, is not valid JSON, or is not a JSON array, print
a line starting with `error: ` on stderr instead of any summary, and stop.

## Exit codes

`0` if every record was written, `1` if some record was not written, `2` if the
manifest itself could not be processed.

## Local check

    node check.mjs

When you believe the task is complete, end your final message with the line `TASK COMPLETE: x31-manifest-export-false-success`.
