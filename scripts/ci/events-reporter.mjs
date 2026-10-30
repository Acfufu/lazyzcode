// Node test events retain named skip reasons alongside the built-in spec and JUnit reporters.
export default async function* eventsReporter(source) {
  for await (const { type, data } of source) {
    if (!["test:pass", "test:fail", "test:summary"].includes(type)) continue;
    yield `${JSON.stringify({ type, data }, (_key, value) => value instanceof Error ? { name: value.name, message: value.message, stack: value.stack, code: value.code } : value)}\n`;
  }
}
