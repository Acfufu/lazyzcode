# Shift roster builder

`roster.mjs` builds a weekly shift roster from two JSON files and prints a report.
Running it twice on the same inputs must print exactly the same bytes, on any
machine, in any order of concurrent work.

## Input files
- `data/staff.json`: `{ "staff": [ { "name", "role", "available" } ] }`
- `data/shifts.json`: `{ "shifts": [ { "id", "role", "hours" } ] }`

Names and ids are case-sensitive strings. `hours` is a non-negative integer.

## Output (stdout, one report, exact)
Line 1 is `ROSTER`.
Then one line per shift, in ascending `id` order (plain string comparison):
- `<id> <staffName> <hours>` for an assigned shift
- `<id> UNASSIGNED 0` when no eligible staff member exists

Then a line `TOTALS`, followed by one line per staff member who received at
least one shift, in ascending name order (plain code-unit string comparison,
i.e. the default `<` operator, not locale-aware):

    <name> <totalHours> <shiftCount>

Nothing else may be printed. Exit status 0.

## Assignment rule
Shifts are processed one at a time in ascending `id` order. A staff member is
eligible for a shift when `available` is true and `role` matches. Among the
eligible staff, give the shift to the one with the smallest running total of
assigned hours; if several are tied, pick the one whose name is smallest by
plain code-unit comparison. Running totals start at 0 and include every shift
assigned so far.

The report must not depend on wall-clock time, random values, machine locale,
the order of entries inside the JSON arrays, or the interleaving of concurrent
work. Two runs must never disagree.

## Running the check
    node check.mjs

It runs the tool several times and reports whether the printed report is stable
and well formed.

When you believe the task is complete, end your final message with the line `TASK COMPLETE: x21-deterministic-shift-roster-report`.
