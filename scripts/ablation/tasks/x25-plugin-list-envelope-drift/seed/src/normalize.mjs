// Broken: only understands the envelope shape. Bare arrays come back as [].
export function normalizePluginList(raw) {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return Array.isArray(raw.plugins) ? raw.plugins : [];
  }
  return [];
}
