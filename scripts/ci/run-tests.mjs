import { appendFileSync, createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { identity } from "./identity.mjs";

const out = resolve(process.argv[2] ?? "artifacts/ci-tests");
mkdirSync(out, { recursive: true });
const meta = { ...identity(), startedAt: new Date().toISOString() };
writeFileSync(join(out, "identity.json"), `${JSON.stringify(meta, null, 2)}\n`);
const log = createWriteStream(join(out, "tests.log"));
const args = ["--test", "--test-reporter=spec", "--test-reporter-destination=stdout", "--test-reporter=junit", `--test-reporter-destination=${join(out, "junit.xml")}`, `--test-reporter=${fileURLToPath(new URL("events-reporter.mjs", import.meta.url))}`, `--test-reporter-destination=${join(out, "events.jsonl")}`, ...(process.argv.slice(3).length ? process.argv.slice(3) : ["test/**/*.test.js"])];
const child = spawn(process.execPath, args, { stdio: ["ignore", "pipe", "pipe"] });
child.stdout.on("data", (data) => { process.stdout.write(data); log.write(data); });
child.stderr.on("data", (data) => { process.stderr.write(data); log.write(data); });
child.on("error", (error) => { log.write(`${error.stack}\n`); });
const { code, signal } = await new Promise((done) => child.on("close", (code, signal) => done({ code, signal })));
await new Promise((done) => log.end(done));
const hasReports = ["events.jsonl", "junit.xml"].every((file) => existsSync(join(out, file)));
const events = existsSync(join(out, "events.jsonl")) ? readFileSync(join(out, "events.jsonl"), "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line)) : [];
const skips = events.filter(({ data }) => data.skip).map(({ data }) => ({ name: data.name, reason: data.skip, file: data.file ?? null, line: data.line ?? null }));
const result = { ...meta, finishedAt: new Date().toISOString(), exitCode: code, signal, hasReports, summaries: events.filter(({ type }) => type === "test:summary").map(({ data }) => data), skips };
writeFileSync(join(out, "result.json"), `${JSON.stringify(result, null, 2)}\n`);
if (process.env.GITHUB_STEP_SUMMARY) {
  const safeJson = JSON.stringify(result, null, 2).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## Test execution\n\n<pre>${safeJson}</pre>\n`);
}
process.exitCode = code === 0 && hasReports ? 0 : (code || 1);
