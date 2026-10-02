# Template renderer

`render.mjs` renders a plain-text template, filling placeholders from a JSON object.
It substitutes values into the raw text before parsing blocks, so a value can escape its context.

## Run

    node render.mjs <template-file> <data.json>

The rendered text goes to stdout and the process exits 0.

## Template language

The template is split on `\n`; one trailing newline at the end of the file is ignored.
Each line is classified by its trimmed form:

- `@if KEY` — opens a block.
- `@else` — alternative branch of the innermost open `@if`.
- `@endif` — closes the innermost open `@if`.
- any other line whose trimmed form starts with `@` — error.
- anything else — a text line.

`KEY` is `[A-Za-z_][A-Za-z0-9_]*`. Blocks nest. Structure is validated before
anything is rendered, so a malformed directive is an error even inside a branch
that is not taken.

A placeholder is `{{KEY}}` with optional spaces around `KEY`; anything else
containing braces is ordinary text. Placeholders appear only in text lines.

## Values

`string` is inserted as-is, `number` in its usual decimal form, `boolean` as
`true`/`false`, `null` as the empty string. An object or array used in a
placeholder is an error, and so is naming a key that is not an own property of
the data object. A text line inside a branch that is not taken is not emitted and
its placeholders are not resolved.

`@if KEY` is taken when the data object has that own property and the value is not
`null`, not `false`, not `0` and not `""`.

## Values are data, never template source

An inserted value is emitted verbatim and is never scanned again for placeholders or
directives. A value can never change which template lines are emitted, open or close
a block, or select a branch; text such as `{{...}}`, `@if`, `@else`, `@endif` or
newlines inside a value only changes the characters of the output.

## Output

Emitted lines are joined with `\n` and the result ends with a single `\n`. If
nothing is emitted, stdout is empty.

## Errors
On any error write a message starting with `error: ` to stderr, write nothing to
stdout, and exit with code 2.

## Check

`node check.mjs` runs a few examples and prints pass/fail.

When you believe the task is complete, end your final message with the line `TASK COMPLETE: x24-inert-template-value-renderer`.
