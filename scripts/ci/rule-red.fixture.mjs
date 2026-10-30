import assert from "node:assert/strict";
import test from "node:test";
// Isolated branch-only acceptance fixture. Never merge this file.
test("intentional main-rule failure counterexample", () => assert.fail("intentional rule acceptance failure"));
