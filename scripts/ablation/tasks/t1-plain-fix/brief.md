# Task brief — fix the word wrapper

The function `wrap(text, width)` in `lib/textwrap.js` is broken: it splits words
in the middle instead of moving them to the next line.

Fix it so that `node check.mjs` prints `PASS`.

Rules the function must follow (also documented in the file header):

- Words are sequences of non-space characters; wrap greedily: fill each line up
  to `width` characters, never split a word, and never leave leading/trailing
  spaces on a line.
- A word longer than `width` occupies a whole line by itself.
- Empty input returns an empty string.

Do not change the function signature. Do not modify `check.mjs`.
