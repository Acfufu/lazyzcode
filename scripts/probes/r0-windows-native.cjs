// Real Win32 executable probe. No dynamic compilation, models, or user config.
const cp = require('node:child_process'), fs = require('node:fs'), path = require('node:path');
const assert = require('node:assert/strict'), { randomUUID } = require('node:crypto');
const [binaryArg, fixtureArg, outArg] = process.argv.slice(2);
const binary = path.resolve(binaryArg), fixture = path.resolve(fixtureArg), out = path.resolve(outArg);
const delay = ms => new Promise(r => setTimeout(r, ms));
const wait = async fn => { const end = Date.now() + 15000; while (!fn()) { if (Date.now() > end) throw Error('bounded wait timeout'); await delay(20); } };
const size = f => fs.existsSync(f) ? fs.statSync(f).size : 0;
const read = (dir, f) => JSON.parse(fs.readFileSync(path.join(dir, f)));
const spawn = args => {
  const p = cp.spawn(binary, args, { stdio: ['pipe', 'pipe', 'pipe'] });
  p.log = ''; p.errors = '';
  p.stdout.on('data', b => p.log += b); p.stderr.on('data', b => p.errors += b);
  p.on('error', e => p.errors += e.message);
  return p;
};
(async () => {
  assert.equal(process.platform, 'win32'); fs.mkdirSync(out, { recursive: true });
  const report = { platform: process.platform, arch: process.arch, node: process.version,
    user: cp.execFileSync('whoami.exe', { encoding: 'utf8' }).trim(), cases: [] };
  const canary = cp.spawn(process.execPath, [fixture, 'canary', out], { stdio: 'ignore' });
  try {
    await wait(() => size(path.join(out, 'canary.beats')) > 0);
    for (const mode of ['normal', 'cancel', 'eof', 'owner-kill', 'before-resume', 'collision']) {
      const id = randomUUID(), dir = path.join(out, mode + ' space 中文'); fs.mkdirSync(dir);
      // Intent exists before helper starts. This is not the production recovery store.
      const fd = fs.openSync(path.join(dir, 'intent.json'), 'wx');
      fs.writeFileSync(fd, JSON.stringify({ id, backend: 'win32-job', mode })); fs.fsyncSync(fd); fs.closeSync(fd);
      const owner = spawn([process.execPath, fixture, dir, id]); let observer, rival;
      try {
        await wait(() => owner.log.includes('"ready"') || owner.exitCode !== null);
        assert.equal(owner.exitCode, null, owner.errors);
        if (mode === 'before-resume') {
          owner.stdin.write('suspended\n'); await wait(() => owner.log.includes('"created"'));
        } else {
          owner.stdin.write('segment1\n'); await wait(() => fs.existsSync(path.join(dir, 'segment1.done')));
          owner.stdin.write('segment2\n'); await wait(() => fs.existsSync(path.join(dir, 'leaf.pid')) && owner.log.split('"segment"').length === 3);
          assert.equal(read(dir, 'segment1.done').service, read(dir, 'segment2.done').service);
        }
        if (mode === 'collision') {
          rival = spawn([process.execPath, fixture, dir, id]);
          await wait(() => rival.exitCode !== null); assert.equal(rival.exitCode, 71);
          assert.match(rival.errors, /job-identity-collision/);
          const before = size(path.join(dir, 'service.beats')); await delay(100);
          assert.ok(size(path.join(dir, 'service.beats')) > before, 'collision must not terminate original job');
        }
        const ids = mode === 'before-resume'
          ? [JSON.parse(owner.log.split('\n').find(l => l.includes('"created"'))).pid]
          : ['service.pid', 'leaf.pid'].map(n => read(dir, n).pid);
        observer = spawn(['--observe', ...ids.map(String)]);
        await wait(() => observer.log.includes('observer-ready') || observer.exitCode !== null);
        assert.match(observer.log, /observer-ready/);
        const before = size(path.join(out, 'canary.beats'));
        if (mode === 'owner-kill' || mode === 'before-resume') owner.kill('SIGKILL');
        else if (mode === 'eof') owner.stdin.end();
        else owner.stdin.end('stop\n');
        await wait(() => observer.exitCode !== null);
        assert.equal(observer.exitCode, 0, observer.errors); assert.match(observer.log, /observer-exited/);
        await wait(() => owner.exitCode !== null || owner.signalCode !== null);
        if (mode !== 'owner-kill' && mode !== 'before-resume') { assert.equal(owner.exitCode, 0, owner.errors); assert.match(owner.log, /"empty"/); }
        const beats = ['service', 'leaf'].map(n => size(path.join(dir, n + '.beats')));
        await delay(180); assert.deepEqual(['service', 'leaf'].map(n => size(path.join(dir, n + '.beats'))), beats);
        assert.ok(size(path.join(out, 'canary.beats')) > before);
        if (mode === 'before-resume') assert.equal(fs.existsSync(path.join(dir, 'service.pid')), false);
        report.cases.push({ mode, ownedProcessHandles: ids.length, allExited: true, canaryUnaffected: true, ownerCode: owner.exitCode, ownerSignal: owner.signalCode });
      } finally {
        for (const p of [owner, observer, rival].filter(Boolean)) if (p.exitCode === null && p.signalCode === null) p.kill('SIGKILL');
        fs.writeFileSync(path.join(dir, 'helper.log'), owner.log + owner.errors);
      }
    }
    fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
  } finally { canary.kill('SIGKILL'); await wait(() => canary.exitCode !== null || canary.signalCode !== null); }
})().catch(e => { console.error(e); process.exitCode = 1; });
