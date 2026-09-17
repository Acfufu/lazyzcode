# Task brief — fix the median helper

The function `median(nums)` in `lib/stats.js` is broken: it returns the middle
element of the array as-is, without sorting first. It only looks correct when
the input happens to be sorted.

Fix it so that `node check.mjs` prints `PASS`.
