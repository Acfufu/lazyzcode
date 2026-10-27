// Offline test instrumentation only. Never loaded by product code.
const fs = require('node:fs'), path = require('node:path'), cp = require('node:child_process');
const dir = process.env.LZY_R0_TRACE;
if (dir) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${process.pid}.jsonl`);
  const log = (kind, data = {}) => fs.appendFileSync(file, JSON.stringify({ kind, wall: Date.now(), mono: performance.now(), pid: process.pid, ...data }) + '\n');
  log('start', { ppid: process.ppid, argv: process.argv });
  const kill = process.kill;
  process.kill = function(pid, signal) {
    log('process.kill.enter', { target: pid, signal }); const start = performance.now();
    try { const result = kill.call(this, pid, signal); log('process.kill.return', { ms: performance.now() - start }); return result; }
    catch (error) { log('process.kill.error', { code: error.code }); throw error; }
  };
  const childKill = cp.ChildProcess.prototype.kill;
  cp.ChildProcess.prototype.kill = function(signal) {
    log('child.kill.enter', { target: this.pid, signal }); const start = performance.now();
    try { const result = childKill.call(this, signal); log('child.kill.return', { target: this.pid, ms: performance.now() - start, result }); return result; }
    catch (error) { log('child.kill.error', { code: error.code }); throw error; }
  };
  const emit = cp.ChildProcess.prototype.emit;
  cp.ChildProcess.prototype.emit = function(event, ...args) {
    if (['spawn', 'exit', 'close'].includes(event)) log('child.' + event, { child: this.pid, args });
    return emit.call(this, event, ...args);
  };
  const { DatabaseSync } = require('node:sqlite');
  const exec = DatabaseSync.prototype.exec;
  DatabaseSync.prototype.exec = function(sql) {
    const start = performance.now(), lock = /^BEGIN IMMEDIATE|^ROLLBACK/.test(sql.trim());
    if (lock) log('sqlite.enter', { sql });
    try { const result = exec.call(this, sql); if (lock) log('sqlite.return', { ms: performance.now() - start }); return result; }
    catch (error) { if (lock) log('sqlite.error', { ms: performance.now() - start, code: error.code }); throw error; }
  };
  require('node:module').syncBuiltinESMExports();
  setInterval(() => log('heartbeat'), 1000).unref();
  process.on('exit', code => log('exit', { code }));
}
