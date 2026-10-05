# Dialect CSV engine

Implement `src/csv.mjs` with two exports, `parseCSV(text, opts)` and
`toCSV(rows, opts)`. The contract below is LARGE on purpose — you have a
bounded session, so maximize correctness; partial progress is expected.
`node check.mjs` runs only a small smoke subset.

## Options (all optional)

- `delimiter`: exactly one character (default ","). Not one character → TypeError.
- `quote`: exactly one character (default '"'). Not one character → TypeError.
- `escape`: "double" (default) — a quote inside a quoted field is doubled; or
  "backslash" — a backslash inside a quoted field escapes the next character,
  and doubled quotes do NOT mean an escaped quote.
- `comment`: character or null (default null) — a row whose FIRST character is
  this char is dropped entirely.
- `skipEmptyLines`: boolean (default false) — rows that are exactly one empty
  field are dropped. A row containing one empty QUOTED string counts as empty
  only for this rule when unquoted it would be empty; the quoted form `""`
  is one empty field and IS dropped when the option is on.

## parseCSV(text, opts) → string[][]

- A leading U+FEFF BOM is stripped before parsing.
- Row separators: "\n", "\r\n", and lone "\r".
- A quoted field starts only when the quote char is the FIRST character of the
  field; quoted fields may contain delimiters, raw newlines, and escaped
  quotes. Characters after a closing quote (before a delimiter/newline) are
  appended literally to the field.
- A quote character anywhere else is literal data.
- The final row needs no trailing newline. Empty text parses to one empty
  field (dropped when skipEmptyLines is on).

## toCSV(rows, opts) → string

- Inverse. A field is quoted iff it contains the delimiter, the quote char,
  "\n" or "\r"; quote chars are doubled (backslash-escaped in backslash
  mode). Leading/trailing spaces never force quoting. Rows join with "\n";
  no trailing newline.

When you believe the task is complete, end your final message with the line `TASK COMPLETE: x37-csv-dialect-engine`.
