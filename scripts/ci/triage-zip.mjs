// Read selected passive JSON members in memory. Never extract an untrusted archive.
import assert from "node:assert/strict";
import { inflateRawSync, crc32 } from "node:zlib";

export function readReportZip(bytes) {
  assert.ok(bytes.length <= 5 * 1024 * 1024, "artifact download too large");
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (bytes.readUInt32LE(i) === 0x06054b50 && i + 22 + bytes.readUInt16LE(i + 20) === bytes.length) { end = i; break; }
  }
  assert.ok(end >= 0, "ZIP end missing");
  assert.equal(bytes.readUInt32LE(end + 4), 0, "split ZIP unsupported");
  const count = bytes.readUInt16LE(end + 10), size = bytes.readUInt32LE(end + 12);
  let pos = bytes.readUInt32LE(end + 16), expanded = 0;
  assert.equal(bytes.readUInt16LE(end + 8), count);
  assert.ok(count <= 512 && pos + size === end, "ZIP directory bounds");
  const members = [], names = new Set();
  for (let i = 0; i < count; i++) {
    assert.ok(pos + 46 <= end && bytes.readUInt32LE(pos) === 0x02014b50, "ZIP directory corrupt");
    const flags = bytes.readUInt16LE(pos + 8), method = bytes.readUInt16LE(pos + 10);
    const compressed = bytes.readUInt32LE(pos + 20), length = bytes.readUInt32LE(pos + 24);
    const n = bytes.readUInt16LE(pos + 28), extra = bytes.readUInt16LE(pos + 30), comment = bytes.readUInt16LE(pos + 32);
    const offset = bytes.readUInt32LE(pos + 42), attrs = bytes.readUInt32LE(pos + 38);
    assert.ok(pos + 46 + n + extra + comment <= end, "ZIP filename bounds");
    const name = bytes.subarray(pos + 46, pos + 46 + n).toString("utf8");
    assert.ok(name && !name.startsWith("/") && !name.includes("\\") && !name.includes("\0") && !name.split("/").some((p) => p === ".." || p === "."), "unsafe ZIP path");
    assert.ok(!names.has(name), "duplicate ZIP member"); names.add(name);
    assert.ok(!(flags & 1) && [0, 8].includes(method), "encrypted/unsupported ZIP");
    assert.ok((attrs >>> 16 & 0xf000) !== 0xa000, "ZIP symlink rejected");
    expanded += length;
    assert.ok(length <= 2 * 1024 * 1024 && expanded <= 20 * 1024 * 1024, "ZIP expansion limit");
    assert.ok(offset + 30 <= bytes.readUInt32LE(end + 16) && bytes.readUInt32LE(offset) === 0x04034b50, "ZIP local header");
    const start = offset + 30 + bytes.readUInt16LE(offset + 26) + bytes.readUInt16LE(offset + 28);
    assert.ok(start + compressed <= bytes.readUInt32LE(end + 16), "ZIP data bounds");
    assert.equal(bytes.readUInt16LE(offset + 8), method);
    if (/(^|\/)(identity|result)\.json$|(^|\/)events\.jsonl$/.test(name)) {
      const data = method === 0 ? bytes.subarray(start, start + compressed) : inflateRawSync(bytes.subarray(start, start + compressed), { maxOutputLength: Math.max(1, length) });
      assert.equal(data.length, length, "ZIP length mismatch");
      assert.equal(crc32(data), bytes.readUInt32LE(pos + 16), "ZIP CRC mismatch");
      members.push({ name, text: data.toString("utf8") });
    }
    pos += 46 + n + extra + comment;
  }
  assert.equal(pos, end, "ZIP directory length mismatch");
  return members;
}
