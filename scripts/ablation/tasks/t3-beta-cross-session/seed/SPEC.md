# SPEC — string case converters

Input: an English sentence of words separated by single spaces. A word is a
sequence of letters and digits. Punctuation is out of scope: inputs contain
only letters, digits, and single spaces.

All four functions take one string argument and return the converted string.
Split the input on spaces, then:

- `toCamel(s)`: first word lowercase, every following word capitalized
  (first letter uppercase, rest lowercase), all joined with no separator.
  Empty input returns an empty string.
  Examples: `"hello world"` → `"helloWorld"`, `"FIX THIS now"` → `"fixThisNow"`.
- `toSnake(s)`: every word lowercased, joined with `_`.
  Examples: `"Hello World"` → `"hello_world"`, `"FIX THIS now"` → `"fix_this_now"`.
- `toKebab(s)`: every word lowercased, joined with `-`.
  Examples: `"Hello World"` → `"hello-world"`.
- `toConstant(s)`: every word UPPERCASED, joined with `_`.
  Examples: `"hello world"` → `"HELLO_WORLD"`, `"fix This now"` → `"FIX_THIS_NOW"`.

Case normalization applies per word (e.g. `"FIX"`, `"Fix"`, `"fix"` are the
same word). A single-word input is returned normalized with no separator.
