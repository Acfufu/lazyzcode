// Run ONLY inside a delegated cgroup subtree; no privileged production helper.
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, existsSync, statSync, rmdirSync, openSync, fsyncSync, closeSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
const [base, out, mode, group, dir] = process.argv.slice(2);
const fixture = resolve('scripts/probes/r0-fixture.cjs');
const wait = async fn => { const end = Date.now() + 10000; while (!fn()) { if (Date.now() > end) throw Error('probe wait timeout'); await delay(20); } };
const launch = (target, role, data) => {
  // The shell joins before exec. A closed pipe before GO exits without running
  // fixture code. The persistent cgroup is created before this wrapper exists.
  const child = spawn('sh', ['-c', 'echo $$ > "$1/cgroup.procs" || exit 71; shift; read gate && test "$gate" = GO || exit 72; exec "$@"', 'gate', target, process.execPath, fixture, role, data], { stdio: ['pipe', 'ignore', 'inherit'] });
  return child;
};
if (mode === 'controller') {
  const a = launch(group, 'segment1', dir); a.stdin.end('GO\n');
  await wait(() => existsSync(join(dir, 'segment1.done')) && a.exitCode === 0);
  const b = launch(group, 'segment2', dir); b.stdin.end('GO\n');
  await wait(() => existsSync(join(dir, 'segment2.done')) && existsSync(join(dir, 'leaf.pid')) && b.exitCode === 0);
  writeFileSync(join(dir, 'controller.ready'), 'ready');
  setTimeout(() => process.exit(4), 15000);
} else {
  mkdirSync(out, { recursive: true });
  const results = { platform: process.platform, node: process.version, uid: process.getuid(), base, cases: [] };
  const canary = spawn(process.execPath, [fixture, 'canary', out], { stdio: 'ignore' });
  try {
    for (const ending of ['normal', 'cancel', 'controller-kill']) {
      const id = randomUUID(), cg = join(base, 'lzy-r0-' + id), data = join(out, id);
      mkdirSync(cg); mkdirSync(data);
      const identity = { path: cg, inode: statSync(cg).ino, id };
      const fd = openSync(join(data, 'intent.json'), 'wx'); writeFileSync(fd, JSON.stringify(identity)); fsyncSync(fd); closeSync(fd);
      const controller = spawn(process.execPath, [resolve(process.argv[1]), base, out, 'controller', cg, data], { stdio: 'ignore' });
      try {
        await wait(() => existsSync(join(data, 'controller.ready')));
        const first = JSON.parse(readFileSync(join(data, 'segment1.done'))), second = JSON.parse(readFileSync(join(data, 'segment2.done')));
        assert.equal(first.service, second.service);
        const pids = readFileSync(join(cg, 'cgroup.procs'), 'utf8').trim().split('\n').map(Number);
        const service = JSON.parse(readFileSync(join(data, 'service.pid'))).pid, leaf = JSON.parse(readFileSync(join(data, 'leaf.pid'))).pid;
        assert.ok(pids.includes(service) && pids.includes(leaf));
        if (ending === 'controller-kill') { controller.kill('SIGKILL'); await wait(() => controller.signalCode !== null); }
        const before = statSync(join(out, 'canary.beats')).size;
        // Recovery rereads the durable identity; a mismatched inode must not
        // authorize a write. This is a prototype, not the R1 fencing protocol.
        const saved = JSON.parse(readFileSync(join(data, 'intent.json')));
        assert.equal(saved.inode, statSync(saved.path).ino);
        writeFileSync(join(saved.path, 'cgroup.kill'), '1');
        await wait(() => /populated 0/.test(readFileSync(join(cg, 'cgroup.events'), 'utf8')));
        const beats = ['service', 'leaf'].map(n => statSync(join(data, n + '.beats')).size);
        await delay(150);
        assert.deepEqual(['service', 'leaf'].map(n => statSync(join(data, n + '.beats')).size), beats);
        assert.ok(statSync(join(out, 'canary.beats')).size > before);
        results.cases.push({ ending, pids, reusedService: service, empty: true, canaryUnaffected: true, controllerKilled: ending === 'controller-kill' });
      } finally {
        controller.kill('SIGKILL');
        writeFileSync(join(cg, 'cgroup.kill'), '1');
        await wait(() => /populated 0/.test(readFileSync(join(cg, 'cgroup.events'), 'utf8')));
        rmdirSync(cg);
      }
    }
    // Crash window before exec: the wrapper cannot run on an EOF gate.
    const cg = join(base, 'lzy-r0-gate-' + randomUUID()); mkdirSync(cg);
    const child = launch(cg, 'service', out); child.stdin.end();
    await wait(() => child.exitCode !== null);
    assert.equal(child.exitCode, 72); assert.equal(existsSync(join(out, 'service.pid')), false);
    rmdirSync(cg); results.preExecEOF = true;
    writeFileSync(join(out, 'result.json'), JSON.stringify(results, null, 2)); console.log(JSON.stringify(results));
  } finally { canary.kill('SIGKILL'); }
}
