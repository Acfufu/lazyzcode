// Parsing helpers for batch input files.

export function parseRecords(text) {
  const records = [];
  for (const chunk of String(text).split(/^---$/m)) {
    const fields = {};
    for (const line of chunk.split("\n")) {
      if (line.trim() === "") continue;
      const colon = line.indexOf(":");
      if (colon === -1) continue;
      const key = line.slice(0, colon).trim();
      const value = line.slice(colon + 1).trim();
      fields[key] = value;
    }
    if (Object.keys(fields).length > 0) records.push(fields);
  }
  return records;
}

export function toRecord(fields) {
  return {
    id: fields.id || "record",
    name: fields.name || "",
    qty: fields.qty === undefined ? "0" : fields.qty
  };
}
