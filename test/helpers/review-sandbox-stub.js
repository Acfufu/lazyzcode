// Existing runner tests simulate the engine. Their explicit sandbox dependency is not OS evidence.
export async function testReviewSandbox() {
  return { headless: { baseEnv: {} }, metadata: { level: "test", backend: "injected" }, stats: { denied: 0 }, close: async () => {} };
}

export function withInjectedReviewSandbox(runReview) {
  return (cwd, options = {}) => runReview(cwd, {
    ...options,
    deps: { ...((options.deps?.spawnHeadless || options.deps?.run) ? { prepareSandbox: testReviewSandbox } : {}), ...options.deps },
  });
}
