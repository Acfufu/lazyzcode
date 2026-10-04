// Broken: only understands bare arrays; the envelope shape comes back as [].
export function normalizePluginList(raw) {
  return Array.isArray(raw) ? raw : [];
}
