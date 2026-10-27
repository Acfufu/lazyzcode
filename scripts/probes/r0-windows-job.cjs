const cp = require('node:child_process'), fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const delay = ms => new Promise(r => setTimeout(r, ms));
const wait = async fn => { const end = Date.now() + 18000; while (!fn()) { if (Date.now() > end) throw Error('wait timeout'); await delay(30); } };
const root = process.cwd(), out = path.join(root, 'r0-results', 'jobs-' + require('node:crypto').randomUUID()); fs.mkdirSync(out, { recursive: true });
const size = f => fs.existsSync(f) ? fs.statSync(f).size : 0;
(async () => {
  const report = { out, platform: process.platform, node: process.version, arch: process.arch, user: cp.execFileSync('whoami.exe', { encoding: 'utf8' }).trim(), cases: [] };
  const canary = cp.spawn(process.execPath, [path.join(root, 'scripts/probes/r0-fixture.cjs'), 'canary', out], { stdio: 'ignore' });
  try {
    for (const mode of ['normal', 'cancel', 'controller-kill', 'before-resume']) {
      const data = path.join(out, mode); fs.mkdirSync(data, { recursive: true });
      const quote = s => "'" + s.replaceAll("'", "''") + "'";
      // Use an inline local command; do not modify the machine's script policy.
      const command = `Add-Type -Path ${quote(path.join(root, 'scripts/probes/r0-windows-job.cs'))}; [R0Job]::Run(${[root, data, mode, process.execPath].map(quote).join(',')})`;
      const owner = cp.spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { stdio: ['ignore', 'pipe', 'pipe'] });
      let log = '', observer; owner.stdout.on('data', b => log += b); owner.stderr.on('data', b => log += b);
      try {
        await wait(() => fs.existsSync(path.join(data, 'ready.json')) || owner.exitCode !== null);
        assert.ok(fs.existsSync(path.join(data, 'ready.json')), log);
        const ready = JSON.parse(fs.readFileSync(path.join(data, 'ready.json')));
        const before = size(path.join(out, 'canary.beats'));
        if (mode === 'controller-kill' || mode === 'before-resume') {
          const names = mode === 'before-resume' ? ['service.created'] : ['service.pid', 'leaf.pid'];
          const pids = names.map(n => JSON.parse(fs.readFileSync(path.join(data, n))).pid);
          const observe = `Add-Type -Path ${quote(path.join(root, 'scripts/probes/r0-windows-job.cs'))}; [R0Job]::Observe(${quote(data)},${quote(pids.join(','))})`;
          observer = cp.spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', observe], { stdio: ['ignore', 'pipe', 'pipe'] });
          observer.stderr.on('data', b => log += b);
          await wait(() => fs.existsSync(path.join(data, 'observer.ready')) || observer.exitCode !== null);
          assert.ok(fs.existsSync(path.join(data, 'observer.ready')), log);
          owner.kill('SIGKILL');
          await wait(() => observer.exitCode !== null);
          assert.equal(observer.exitCode, 0, log);
          assert.ok(fs.existsSync(path.join(data, 'observer.exited')));
        }
        await wait(() => owner.exitCode !== null || owner.signalCode !== null);
        if (mode === 'controller-kill' || mode === 'before-resume') assert.equal(owner.signalCode, 'SIGKILL');
        await delay(200);
        const beats = ['service', 'leaf'].map(n => size(path.join(data, n + '.beats')));
        await delay(200);
        assert.deepEqual(['service', 'leaf'].map(n => size(path.join(data, n + '.beats'))), beats);
        assert.ok(size(path.join(out, 'canary.beats')) > before);
        if (mode === 'before-resume') {
          assert.equal(fs.existsSync(path.join(data, 'service.pid')), false);
        } else {
          const a = JSON.parse(fs.readFileSync(path.join(data, 'segment1.done'))), b = JSON.parse(fs.readFileSync(path.join(data, 'segment2.done')));
          assert.equal(a.service, b.service); assert.ok(ready.active >= 2);
        }
        const handleProof = observer ? JSON.parse(fs.readFileSync(path.join(data, 'observer.exited'))) : null;
        report.cases.push({ mode, ready, beats, canaryUnaffected: true, handleProof, ownerCode: owner.exitCode, ownerSignal: owner.signalCode });
      } finally {
        if (owner.exitCode === null && owner.signalCode === null) owner.kill('SIGKILL');
        if (observer && observer.exitCode === null && observer.signalCode === null) observer.kill('SIGKILL');
        fs.writeFileSync(path.join(data, 'owner.log'), log);
      }
    }
    fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
  } finally { canary.kill('SIGKILL'); }
})().catch(e => { console.error(e); process.exitCode = 1; });
