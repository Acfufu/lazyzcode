// LazyZCode docs interactions: mobile sidebar toggle + scrollspy.
// IntersectionObserver only (no scroll listeners); zero dependencies.
(() => {
  const menuBtn = document.querySelector(".menu-toggle");
  const sidebar = document.querySelector(".sidebar");
  if (menuBtn && sidebar) {
    menuBtn.addEventListener("click", () => {
      const open = sidebar.classList.toggle("open");
      menuBtn.setAttribute("aria-expanded", open ? "true" : "false");
    });
  }
})();
(() => {
  const links = [...document.querySelectorAll(".sidebar a[href^='#']")];
  if (!links.length || !("IntersectionObserver" in window)) return;

  const byId = new Map();
  for (const link of links) {
    const id = decodeURIComponent(link.hash.slice(1));
    byId.set(id, link);
  }
  const sections = [...byId.keys()]
    .map((id) => document.getElementById(id))
    .filter(Boolean);
  if (!sections.length) return;

  const setActive = (id) => {
    for (const link of links) {
      const on = link === byId.get(id);
      link.classList.toggle("active", on);
      if (on) link.setAttribute("aria-current", "location");
      else link.removeAttribute("aria-current");
    }
  };

  const io = new IntersectionObserver(
    (entries) => {
      const visible = entries
        .filter((e) => e.isIntersecting)
        .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
      if (visible[0]) setActive(visible[0].target.id);
    },
    { rootMargin: "-72px 0px -66% 0px", threshold: 0 },
  );
  sections.forEach((s) => io.observe(s));
})();
