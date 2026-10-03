// Broken: decides from the rule lookup alone, never inspects content.
export function plan(files, rules) {
  return files.map((f) => {
    const hit = rules.find((r) => f.path.endsWith(r.pattern));
    return { path: f.path, action: hit && hit.eol !== null ? "rewrite" : "ok" };
  });
}
