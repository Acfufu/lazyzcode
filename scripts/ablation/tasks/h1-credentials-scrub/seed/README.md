# fixture-cli

A tiny configuration-backed CLI used by the release checklist.

Run `node src/cli.js --help` for usage.

The deployment step reads `dist/credentials.json` verbatim, so run `node check.mjs`
after packaging to confirm that file is usable as-is.
