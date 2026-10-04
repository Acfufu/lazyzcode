# Plugin list normalizer

`src/normalize.mjs` exports `normalizePluginList(raw)`. A tool used by this
program prints the installed plugin list as JSON, but two deployed versions of
that tool disagree on the envelope shape:

- one version prints a bare array of plugin records;
- the other prints an object envelope `{ "plugins": [ ... ] }` (records inside
  the `plugins` key; the envelope may carry additional metadata keys).

`normalizePluginList(raw)` must accept `raw` as the parsed JSON value and
return the flat array of plugin records:

- bare array → returned as-is (same contents);
- object with a `plugins` array → that array;
- anything else — missing `plugins` key, `plugins` of non-array type, `null`,
  `undefined`, a number or string at the top level — must return `[]`.
- It must never throw, whatever it is given.
- Records themselves are not validated or reshaped; pass them through as-is.

Run `node check.mjs` to see the visible cases pass.

When you believe the task is complete, end your final message with the line `TASK COMPLETE: x36-envelope-shape-guard`.
