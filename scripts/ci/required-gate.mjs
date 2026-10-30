import { appendFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function judgeRequired(needs, required) {
  const checks = required.map((name) => ({ name, result: needs?.[name]?.result ?? "missing" }));
  return { ok: checks.length > 0 && checks.every(({ result }) => result === "success"), checks };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const required = (process.env.REQUIRED_JOBS ?? "").split(",").filter(Boolean);
  const verdict = judgeRequired(JSON.parse(process.env.NEEDS_JSON ?? "{}"), required);
  const body = ["## CI Required", "", ...verdict.checks.map(({ name, result }) => `- ${name}: ${result}`), "", `Result: ${verdict.ok ? "PASS" : "FAIL"}`, ""].join("\n");
  console.log(body);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, body);
  process.exitCode = verdict.ok ? 0 : 1;
}
