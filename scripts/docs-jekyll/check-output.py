"""Check the five public entry pages and their rendered local links/assets."""
import sys
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlsplit, unquote

root = Path(sys.argv[1]).resolve()
baseurl = "/lazyzcode"

class Page(HTMLParser):
    def __init__(self, path):
        super().__init__(convert_charrefs=True)
        self.ids, self.links = set(), []
        self.feed(path.read_text())

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        self.ids.update(value for key, value in attrs.items() if key in ("id", "name") and value)
        self.links.extend(attrs[key] for key in ("href", "src") if attrs.get(key))

cache = {}
def page(path):
    if path not in cache:
        cache[path] = Page(path)
    return cache[path]

entries = ["index", "guide/en", "guide/zh", "developers/en", "developers/zh"]
failures = []
for entry in entries:
    candidates = [root / (entry + ".html"), root / entry / "index.html"]
    path = next((p for p in candidates if p.is_file()), None)
    if path is None:
        failures.append(f"missing entry: {entry}")
        continue
    body = path.read_text()
    for marker in ("{{ site.", "{{site.", "{% include", "{% if", "{% for"):
        if marker in body:
            failures.append(f"unexpanded Liquid in {path.relative_to(root)}")
    for link in page(path).links:
        url = urlsplit(link)
        if url.scheme or url.netloc:
            continue
        local = unquote(url.path)
        if local.startswith("/"):
            if local != baseurl and not local.startswith(baseurl + "/"):
                failures.append(f"baseurl missing: {entry}: {link}")
                continue
            target = root / local[len(baseurl):].lstrip("/")
        else:
            target = path.parent / local if local else path
        target = target.resolve()
        if not target.is_relative_to(root):
            failures.append(f"outside site: {entry}: {link}")
            continue
        if target.is_dir():
            target /= "index.html"
        if not target.is_file():
            failures.append(f"missing link: {entry}: {link}")
        elif url.fragment and target.suffix == ".html" and unquote(url.fragment) not in page(target).ids:
            failures.append(f"missing anchor: {entry}: {link}")
if failures:
    raise SystemExit("\n".join(failures))
print(f"PASS: {len(entries)} public entries, rendered local links/anchors/assets and {baseurl} baseurl")
