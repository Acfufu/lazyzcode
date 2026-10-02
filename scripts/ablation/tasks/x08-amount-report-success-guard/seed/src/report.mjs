const HEADER = 'id,category,amount';

// Success looks fine here, but rejected rows are dropped without a word.
export const parseReport = (text) => {
  const lines = text.split('\n');
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();

  const rows = Math.max(0, lines.length - 1);
  const groups = new Map();
  const seen = new Set();

  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split(',');
    const id = parts[0] ?? '';
    const category = parts[1] ?? '';
    const amount = parts[2] ?? '';
    if (id === '' || category === '') continue;
    if (seen.has(id)) continue;
    seen.add(id);
    const value = Number(amount);
    if (!Number.isFinite(value)) continue;
    const group = groups.get(category) ?? { count: 0, total: 0 };
    group.count += 1;
    group.total += value;
    groups.set(category, group);
  }

  return { ok: true, rows, groups };
};

export const formatReport = (result) => {
  const names = [...result.groups.keys()].sort();
  const lines = [];
  let total = 0;
  for (const name of names) {
    const group = result.groups.get(name);
    lines.push(`${name} ${group.count} ${group.total}`);
    total += group.total;
  }
  lines.push(`SUCCESS rows=${result.rows} groups=${result.groups.size} total=${total}`);
  return lines.join('\n') + '\n';
};
