Phase 2 — requirement change: the separator semantics of `slug` change.

Whitespace runs must now collapse into a single underscore "_" instead of a
hyphen "-". Lowercasing and trimming are unchanged. Examples:
`"  Hello   World  "` → `"hello_world"`, `"a\t\tb"` → `"a_b"`.

Update `lib/slug.js` and the slug section of `check.mjs` to the new contract;
`node check.mjs` must print `PASS` (both sections). `lib/pad.js` and its
check section are frozen — do not touch them.

Bring your goal loop up to date with this change and finish the goal once
the tree satisfies both phases.
