# Task brief — calculator fixes and one addition

Two requirements for `lib/calc.js`:

1. `add(a, b)` is broken — it currently returns the wrong result. Fix it so
   that `node check.mjs` prints `PASS`.
2. Also implement `sub(a, b)` which returns `a` minus `b`. There is no test
   covering `sub` yet — implement it correctly anyway.

Both functions must work for negative numbers and decimals (within normal
floating-point behavior). Do not modify `check.mjs`.
