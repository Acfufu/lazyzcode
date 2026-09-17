# SPEC — string utilities (phase 1: pad)

`lib/slug.js` is already implemented and its current behavior must not change
in this phase. Do not modify it.

`lib/pad.js` — implement `pad(s, len, char = " ")`:

- Right-pad `s` with repeats of `char` until its length reaches `len`.
- If `s` is already `len` or longer, return `s` unchanged.
- `char` defaults to a single space; `char` is a single character.

Examples:

- `pad("ab", 5, ".")` → `"ab..."`
- `pad("abc", 3, "0")` → `"abc"`
- `pad("", 2, "0")` → `"00"`
- `pad("abcd", 2, ".")` → `"abcd"`
- `pad("a", 3)` → `"a  "`

`node check.mjs` prints `PASS` only when every section (slug and pad) passes.
