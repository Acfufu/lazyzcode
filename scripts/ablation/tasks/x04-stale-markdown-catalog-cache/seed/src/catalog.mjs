import fs from 'node:fs';
import path from 'node:path';

const SUFFIX = '.md';

const titleOf = (data, slug) => {
  const text = data.toString('utf8');
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\r$/, '').trim();
    if (line.startsWith('# ')) {
      const title = line.slice(2).trim();
      return title.length > 0 ? title : slug;
    }
  }
  return slug;
};

export class Catalog {
  constructor(dir) {
    this.dir = dir;
    this.rebuildCount = 0;
    this._entries = null;
    this._dirStamp = null;
  }

  list() {
    const stamp = this._stamp();
    if (this._entries === null || stamp !== this._dirStamp) {
      this._entries = this._scan();
      this._dirStamp = stamp;
      this.rebuildCount += 1;
    }
    return this._entries;
  }

  _stamp() {
    try {
      return String(fs.statSync(this.dir).mtimeMs);
    } catch {
      return null;
    }
  }

  _scan() {
    let names;
    try {
      names = fs.readdirSync(this.dir);
    } catch {
      return [];
    }
    const entries = [];
    for (const name of names) {
      if (!name.endsWith(SUFFIX)) continue;
      const full = path.join(this.dir, name);
      let st;
      let data;
      try {
        st = fs.statSync(full);
        if (!st.isFile()) continue;
        data = fs.readFileSync(full);
      } catch {
        continue;
      }
      const slug = name.slice(0, -SUFFIX.length);
      entries.push({ slug, title: titleOf(data, slug), bytes: st.size });
    }
    entries.sort((a, b) => a.slug.localeCompare(b.slug));
    return entries;
  }
}
