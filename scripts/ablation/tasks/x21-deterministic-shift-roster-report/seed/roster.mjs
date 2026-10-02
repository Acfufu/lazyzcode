import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

async function load(rel) {
  return JSON.parse(await readFile(path.join(here, rel), "utf8"));
}

function pick(items) {
  return items[Math.floor(Math.random() * items.length)];
}

const { staff } = await load("data/staff.json");
const { shifts } = await load("data/shifts.json");

const totals = new Map();
for (const person of staff) {
  totals.set(person.name, { hours: 0, count: 0 });
}

const rows = [];

await Promise.all(
  shifts.map(async (shift) => {
    await new Promise((resolve) => setTimeout(resolve, Math.floor(Math.random() * 4)));
    const eligible = staff.filter((p) => p.available && p.role === shift.role);
    if (eligible.length === 0) {
      return;
    }
    const min = Math.min(...eligible.map((p) => totals.get(p.name).hours));
    const tied = eligible.filter((p) => totals.get(p.name).hours === min);
    const chosen = pick(tied);
    totals.get(chosen.name).hours += shift.hours;
    totals.get(chosen.name).count += 1;
    rows.push(`${shift.id} ${chosen.name} ${shift.hours}`);
  })
);

const lines = [];
lines.push("ROSTER");
lines.push(`generated ${new Date().toISOString()}`);
for (const row of rows) lines.push(row);
lines.push("TOTALS");

const summary = [];
for (const person of staff) {
  const t = totals.get(person.name);
  if (t.count > 0) summary.push([person.name, t]);
}
summary.sort((a, b) => a[1].hours > b[1].hours);
for (const [name, t] of summary) lines.push(`${name} ${t.hours} ${t.count}`);

console.log(lines.join("\n"));
