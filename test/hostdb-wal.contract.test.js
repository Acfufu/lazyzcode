// hostdb 只读查询契约测试（0.4.0 M4 N10 缺陷批：WAL 静寂回退）。
// 判据面：真实 sqlite3 建库（零桩）——WAL 库干净关闭后被 SQLite 移除 -wal/-shm，此时
// `sqlite3 -readonly` 恒拒（CANTOPEN 14）；queryHostDb 须以 immutable 只读回退读出内容，
// 且**只在库静寂时回退**（-wal 有内容不得读旧快照，宁降级 null）。
import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { queryHostDb } from "../core/hostdb.js";

const HAS_SQLITE3 = spawnSync("sqlite3", ["--version"], { timeout: 5_000 }).status === 0;
const sql = (db, statement) => spawnSync("sqlite3", [db, statement], { encoding: "utf8", timeout: 10_000 });

function walDb(dir, rows = 3) {
  const db = join(dir, "wal.sqlite");
  const inserts = Array.from({ length: rows }, (_, i) => `INSERT INTO usage(session_id, output_tokens) VALUES ('sess-${i}', ${i + 1});`).join(" ");
  const r = sql(db, `PRAGMA journal_mode=wal; CREATE TABLE usage(session_id TEXT, output_tokens INTEGER); ${inserts}`);
  assert.equal(r.status, 0, `建库失败：${r.stderr}`);
  return db;
}

test("hostdb/WAL 静寂：-shm 不可创建时 -readonly 恒拒而 immutable 回退读出内容", { skip: !HAS_SQLITE3 && "sqlite3 缺席" }, () => {
  const d = mkdtempSync(join(tmpdir(), "lzy-hostdb-"));
  const ro = join(d, "ro");
  try {
    mkdirSync(ro);
    const db = walDb(ro);
    // 构造与真引擎态等价且**确定**的失败前提：WAL 库 + 侧车缺席 + 连接不能创建 -shm。
    // （真引擎账本实测态=两侧车缺席；此处用只读目录把「-shm 不可创建」钉成确定性条件——
    // 缺省 -readonly 试图创建 -shm，不可得即 SQLITE_CANTOPEN 14，正是真会话 metering-absent 的机制。）
    rmSync(`${db}-wal`, { force: true });
    rmSync(`${db}-shm`, { force: true });
    chmodSync(ro, 0o555);
    try {
      const plain = spawnSync("sqlite3", ["-readonly", "-json", db, "SELECT count(*) AS n FROM usage;"], { encoding: "utf8", timeout: 10_000 });
      assert.notEqual(plain.status, 0, "plain -readonly 在 -shm 不可创建时应被拒（SQLITE_CANTOPEN）");
      // 被测面：immutable 回退读出真实内容
      assert.deepEqual(queryHostDb(db, "SELECT count(*) AS n FROM usage;"), [{ n: 3 }], "WAL 静寂回退未读出内容");
    } finally {
      chmodSync(ro, 0o755);
    }
    // 空结果集与「不可读」可辨（[] vs null）；回退路径零写入（库文件字节数不变）
    assert.deepEqual(queryHostDb(db, "SELECT session_id FROM usage WHERE session_id='nope';"), []);
    const before = statSync(db).size;
    assert.deepEqual(queryHostDb(db, "SELECT count(*) AS n FROM usage;"), [{ n: 3 }]);
    assert.equal(statSync(db).size, before);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("hostdb/WAL 非静寂守卫：-wal 有内容时不读旧快照（宁降级）", { skip: !HAS_SQLITE3 && "sqlite3 缺席" }, async () => {
  const d = mkdtempSync(join(tmpdir(), "lzy-hostdb-"));
  const d2 = mkdtempSync(join(tmpdir(), "lzy-hostdb-crash-"));
  let writer = null;
  try {
    const db = walDb(d, 3);
    // 造「崩溃残留」态：活写者把新行只写进 -wal（未 checkpoint），随后 -shm 缺失（崩溃清理序）。
    // 真实施工面=活连接写 + 只拷主库与 -wal 到新目录（不带 -shm）。
    writer = spawn("sqlite3", [db], { stdio: ["pipe", "ignore", "pipe"] });
    writer.stdin.write("PRAGMA journal_mode=wal;\nCREATE TABLE IF NOT EXISTS usage(session_id TEXT, output_tokens INTEGER);\nINSERT INTO usage(session_id, output_tokens) VALUES ('sess-9', 9);\n");
    const wal = `${db}-wal`;
    // 等 INSERT 真正落 -wal：以 wal 字节含 'sess-9' 为准（CI ubuntu 实锤——wal 非空≠已提交，
    // journal_mode/CREATE 先落盘，只等 size>0 会拷到未提交态，读旧快照 3 是拷贝时序假象而非
    // 守卫失效）。不开第二连接探内容：其退出可能 checkpoint 源库，破坏「新行只在 -wal」构造。
    let committed = false;
    for (let i = 0; i < 50 && !committed; i += 1) {
      await new Promise((r) => setTimeout(r, 100));
      committed = existsSync(wal) && statSync(wal).size > 0 && readFileSync(wal).includes(Buffer.from("sess-9"));
    }
    assert.ok(committed, "-wal 应含已提交的 sess-9（施工面不成立）");
    cpSync(db, join(d2, "crash.sqlite"));
    cpSync(wal, join(d2, "crash.sqlite-wal"));
    assert.equal(existsSync(join(d2, "crash.sqlite-shm")), false, "崩溃态须无 -shm");
    assert.ok(readFileSync(join(d2, "crash.sqlite-wal")).includes(Buffer.from("sess-9")), "拷贝面须含已提交行（施工面自证）");
    const r = queryHostDb(join(d2, "crash.sqlite"), "SELECT count(*) AS n FROM usage;");
    // 安全不变量：降级 null 或读到含 -wal 的全量（4）皆可；**只有旧快照（3）不可**
    assert.ok(r === null || r[0].n === 4, `非静寂态读了旧快照：${JSON.stringify(r)}`);
  } finally {
    if (writer) writer.kill("SIGKILL");
    rmSync(d, { recursive: true, force: true });
    rmSync(d2, { recursive: true, force: true });
  }
});

test("hostdb/既有行为：非 WAL 库与坏路径读面不变", { skip: !HAS_SQLITE3 && "sqlite3 缺席" }, () => {
  const d = mkdtempSync(join(tmpdir(), "lzy-hostdb-"));
  try {
    const db = join(d, "rollback.sqlite"); // 默认 delete 日志模式
    assert.equal(sql(db, "CREATE TABLE t(a); INSERT INTO t VALUES (1);").status, 0);
    assert.deepEqual(queryHostDb(db, "SELECT count(*) AS n FROM t;"), [{ n: 1 }]);
    assert.equal(queryHostDb(join(d, "missing.sqlite"), "SELECT 1;"), null, "缺库=null 降级（非抛）");
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});
