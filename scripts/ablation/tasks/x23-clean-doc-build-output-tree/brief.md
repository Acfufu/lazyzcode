# Document build tool

`build.mjs` renders every document in `src/` into an output directory.

## Usage

    node build.mjs [--out <dir>]

The default output directory is `public`.

## Rendering rules

- The sources are the regular files matching `src/*.md`, top level only,
  processed in sorted order by file name. Anything else in `src/` is ignored.
- Source `<name>.md` produces `<out>/<name>.txt`.
- Every source line is uppercased. Line endings are normalized: `\r\n` and a
  lone `\r` become `\n`. Each output file ends with exactly one `\n`.
- A source whose content is empty or whitespace only is an error.

## Output directory rules

- After a successful run the output directory contains exactly the generated
  `.txt` files and nothing else, at any depth. Staging directories, `.part`
  files, manifests, caches and results left behind by earlier runs (including
  output whose source no longer exists) must all be gone.
- Running the build a second time must give the same result as the first run.
- When there are no sources the output directory still exists and is empty.
- A failed run changes nothing: the output directory must be exactly as it was
  before the run started. The reason goes to stderr and the exit status is
  non-zero.
- When the run is over the repository must contain no extra files: the output
  directory is the only thing the build may add, and any temporary working
  directories it creates must be removed before it exits.
- An output location that cannot be used as a directory is an error.

## Running the check

    node check.mjs

It prints `check: PASS` and exits 0 when the build behaves correctly,
otherwise it lists the problems and exits 1.

When you believe the task is complete, end your final message with the line `TASK COMPLETE: x23-clean-doc-build-output-tree`.
