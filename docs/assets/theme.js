// LazyZCode docs theme: dark | light | auto (system follow), persisted in
// localStorage. The head inline snippet in each layout resolves the theme
// before first paint; this module wires the toggle and live system changes.
(() => {
  const KEY = "lzy-theme";
  const mq = window.matchMedia("(prefers-color-scheme: light)");
  const meta = document.querySelector('meta[name="theme-color"]');
  const META_COLOR = { dark: "#0a0c10", light: "#f6f8fa" };

  const pref = () => {
    try { return localStorage.getItem(KEY) || "auto"; } catch (e) { return "auto"; }
  };
  const resolve = (p) => (p === "auto" ? (mq.matches ? "light" : "dark") : p);

  const apply = () => {
    const p = pref();
    const t = resolve(p);
    document.documentElement.dataset.theme = t;
    if (meta) meta.setAttribute("content", META_COLOR[t]);
    document.querySelectorAll(".theme-toggle button").forEach((b) => {
      const on = b.dataset.themeSet === p;
      b.classList.toggle("active", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
    });
  };

  document.querySelectorAll(".theme-toggle button").forEach((b) => {
    b.addEventListener("click", () => {
      try { localStorage.setItem(KEY, b.dataset.themeSet); } catch (e) { /* private mode */ }
      apply();
    });
  });

  const onSystemChange = () => { if (pref() === "auto") apply(); };
  if (mq.addEventListener) mq.addEventListener("change", onSystemChange);
  else if (mq.addListener) mq.addListener(onSystemChange);

  apply();
})();
