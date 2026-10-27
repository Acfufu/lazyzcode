// R0 protocol experiment ONLY. Requires a dedicated delegated cgroup v2 base.
// SQLite serializes recovery; fd anchors prevent switching a checked pathname.
import { spawn } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import * as fs from 'node:fs';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import assert from 'node:assert/strict';
const [mode, baseArg, outArg, requestedFence] = process.argv.slice(2);
const wait = async fn => { const end = Date.now() + 8000; while (!fn()) { if (Date.now() > end) throw Error('bounded wait'); await delay(15); } };
const read = p => fs.readFileSync(p, 'utf8');
const identity = path => {
  const s = fs.statSync(path, { bigint: true });
  return { dev: String(s.dev), ino: String(s.ino), ctimeNs: String(s.ctimeNs) };
};
const boot = () => read('/proc/sys/kernel/random/boot_id').trim();
const start = pid => {
  try { return read(`/proc/${pid}/stat`).split(') ').at(-1).split(' ')[19]; }
  catch (e) { if (e.code === 'ENOENT') return null; throw e; }
};
const fixture = resolve('scripts/probes/r0-fixture.cjs');
const self = resolve(process.argv[1]);
const child = (args, options = {}) => spawn(process.execPath, [self, ...args], { stdio: ['ignore', 'pipe', 'pipe'], ...options });
const collect = p => {
  p.output = ''; p.errors = ''; p.stdout.on('data', b => p.output += b); p.stderr.on('data', b => p.errors += b); return p;
};
const launch = (cg, role, data) => spawn('sh', ['-c', 'echo $$ > "$1/cgroup.procs" || exit 71; shift; exec "$@"', 'gate', cg, process.execPath, fixture, role, data], { stdio: 'ignore' });
if (mode === 'controller') {
  const a = launch(baseArg, 'segment1', outArg);
  await wait(() => a.exitCode === 0 && fs.existsSync(join(outArg, 'segment1.done')));
  const b = launch(baseArg, 'segment2', outArg);
  await wait(() => b.exitCode === 0 && fs.existsSync(join(outArg, 'leaf.pid')));
  fs.writeFileSync(join(outArg, 'ready'), '1'); setTimeout(() => process.exit(124), 20000);
} else if (mode === 'recover') {
  let db, fd;
  try {
    db = new DatabaseSync(join(outArg, 'recovery.sqlite')); db.exec('PRAGMA busy_timeout=5000; BEGIN IMMEDIATE');
    const row = db.prepare('SELECT body,state FROM run WHERE id=1').get();
    const r = JSON.parse(row.body);
    if (r.fence !== Number(requestedFence)) throw Error('FENCE_MISMATCH');
    if (row.state === 'cleaned') { db.exec('COMMIT'); console.log('already-clean'); }
    else {
      if (r.boot !== boot()) throw Error('BOOT_MISMATCH');
      if (start(r.owner.pid) === r.owner.start) throw Error('OWNER_LIVE');
      if (r.base !== fs.realpathSync(baseArg) || r.name !== 'lzy-r0-' + r.id) throw Error('PATH_MISMATCH');
      assert.deepEqual(identity(r.base), r.baseIdentity, 'BASE_MISMATCH');
      fd = fs.openSync(join(r.base, r.name), fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
      const anchor = `/proc/self/fd/${fd}`;
      const mount = read(`/proc/self/fdinfo/${fd}`).match(/^mnt_id:\s*(\d+)$/m)?.[1];
      if (mount !== r.mount) throw Error('MOUNT_MISMATCH');
      assert.deepEqual(identity(anchor), r.groupIdentity, 'GROUP_MISMATCH');
      // All metadata guards precede the first signal. Do not substitute PID kill.
      fs.writeFileSync(join(anchor, 'cgroup.kill'), '1');
      await wait(() => /populated 0/.test(read(join(anchor, 'cgroup.events'))));
      db.prepare("UPDATE run SET state='cleaned' WHERE id=1").run(); db.exec('COMMIT');
      console.log('recovered');
    }
  } catch (e) { console.error(e.message); process.exitCode = 78; }
  finally { if (fd !== undefined) fs.closeSync(fd); db?.close(); }
} else if (mode === 'test') {
  assert.equal(process.platform, 'linux'); assert.notEqual(process.getuid(), 0);
  const base = fs.realpathSync(baseArg), out = resolve(outArg); fs.mkdirSync(out, { recursive: true });
  const id = randomUUID(), name = 'lzy-r0-' + id, cg = join(base, name);
  fs.mkdirSync(cg); const groupIdentity = identity(cg), baseIdentity = identity(base);
  const fd = fs.openSync(cg, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
  const mount = read(`/proc/self/fdinfo/${fd}`).match(/^mnt_id:\s*(\d+)$/m)?.[1]; fs.closeSync(fd);
  const controller = collect(child(['controller', cg, out]));
  const canary = spawn(process.execPath, [fixture, 'canary', out], { stdio: 'ignore' });
  const db = new DatabaseSync(join(out, 'recovery.sqlite'));
  db.exec('PRAGMA synchronous=FULL; CREATE TABLE run(id INTEGER PRIMARY KEY,body TEXT,state TEXT)');
  const r = { id, name, base, boot: boot(), groupIdentity, baseIdentity, mount, fence: 7, owner: { pid: controller.pid, start: start(controller.pid) } };
  const put = value => db.prepare("INSERT OR REPLACE INTO run VALUES(1,?,'active')").run(typeof value === 'string' ? value : JSON.stringify(value));
  put(r); const results = { platform: process.platform, node: process.version, uid: process.getuid(), negatives: [] };
  const recover = async (value, fence = '7') => {
    put(value); const p = collect(child(['recover', base, out, fence]));
    await wait(() => p.exitCode !== null); return p;
  };
  try {
    await wait(() => fs.existsSync(join(out, 'ready')));
    let p = await recover(r); assert.equal(p.exitCode, 78); assert.match(p.errors, /OWNER_LIVE/); results.negatives.push('live-owner');
    controller.kill('SIGKILL'); await wait(() => controller.signalCode !== null);
    for (const [label, value, fence] of [
      ['boot', { ...r, boot: 'other-boot' }], ['mount', { ...r, mount: 'other-mount' }],
      ['group', { ...r, groupIdentity: { ...r.groupIdentity, ino: '0' } }],
      ['base', { ...r, baseIdentity: { ...r.baseIdentity, ino: '0' } }],
      ['path', { ...r, name: '../unrelated' }], ['fence', r, '6'], ['corrupt', '{broken'],
    ]) {
      const before = fs.statSync(join(out, 'service.beats')).size;
      p = await recover(value, fence); assert.equal(p.exitCode, 78, label + p.errors);
      await delay(100); assert.ok(fs.statSync(join(out, 'service.beats')).size > before, label + ' must not kill');
      results.negatives.push(label);
    }
    // Simulate a reused controller PID with a different birth identity. The
    // live unrelated process must survive; only the verified cgroup is killed.
    const reused = { ...r, owner: { pid: canary.pid, start: 'not-the-current-start' } };
    put(reused); const a = collect(child(['recover', base, out, '7'])), b = collect(child(['recover', base, out, '7']));
    await wait(() => a.exitCode !== null && b.exitCode !== null);
    assert.equal(a.exitCode, 0, a.errors); assert.equal(b.exitCode, 0, b.errors);
    assert.deepEqual([a.output.trim(), b.output.trim()].sort(), ['already-clean', 'recovered']);
    assert.match(read(join(cg, 'cgroup.events')), /populated 0/);
    const beats = ['service', 'leaf'].map(n => fs.statSync(join(out, n + '.beats')).size);
    const before = fs.statSync(join(out, 'canary.beats')).size;
    await delay(150); assert.deepEqual(['service', 'leaf'].map(n => fs.statSync(join(out, n + '.beats')).size), beats);
    assert.ok(fs.statSync(join(out, 'canary.beats')).size > before);
    results.concurrentRecovery = ['already-clean', 'recovered']; results.empty = true; results.canaryUnaffected = true;
    results.simulatedOwnerPidReuse = true;
    fs.writeFileSync(join(out, 'result.json'), JSON.stringify(results, null, 2)); console.log(JSON.stringify(results));
  } finally {
    controller.kill('SIGKILL'); canary.kill('SIGKILL'); db.close();
    fs.writeFileSync(join(cg, 'cgroup.kill'), '1'); await wait(() => /populated 0/.test(read(join(cg, 'cgroup.events')))); fs.rmdirSync(cg);
  }
} else throw Error('usage: test|recover|controller base out [fence]');
