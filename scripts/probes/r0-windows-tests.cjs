// Run from a task-owned Windows checkout; streams evidence instead of buffering
// all output in spawnSync. No models, network tests, or user ledgers.
const fs = require('node:fs'), path = require('node:path'), cp = require('node:child_process');
const root = process.cwd(), mode = process.argv[2] ?? 'parallel';
const out = path.join(root, 'r0-results', mode); fs.mkdirSync(out, { recursive: true });
const env = { ...process.env, TZ: 'Asia/Shanghai', LZY_R0_TRACE: path.join(out, 'trace'), NODE_OPTIONS: `--require=${path.join(root, 'scripts/probes/r0-windows-trace.cjs')}` };
const winPath = env.Path ?? env.PATH ?? ''; delete env.PATH; env.Path = root + '/bin;' + winPath;
const files = ['sandbox-usage-reliability', 'harvest-reliability', 'statedb', 'statedb-readers', 'cost'].map(f => `test/${f}.contract.test.js`);
const args = ['--test', '--test-reporter=tap', ...(mode.startsWith('serial') ? ['--test-concurrency=1'] : []), ...files];
const started = Date.now();
fs.writeFileSync(path.join(out, 'dispatch.json'), JSON.stringify({ started, mode, args }));
const child = cp.spawn(process.execPath, args, { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
fs.writeFileSync(path.join(out, 'spawn-return.json'), JSON.stringify({ pid: child.pid, returned: Date.now(), spawnMs: Date.now() - started }));
const log = fs.createWriteStream(path.join(out, 'focused.tap'));
child.stdout.pipe(log, { end: false }); child.stderr.pipe(log, { end: false });
let timedOut = false;
let watchdog;
const timer = setTimeout(() => {
  timedOut = true;
  // The only target is this test runner and its known descendants.
  const killer = cp.spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); killer.unref();
  child.stdout.destroy(); child.stderr.destroy();
  // Diagnostic completion must not wait forever for an inherited pipe. This
  // reports timeout, never a claim that every descendant has been recovered.
  watchdog = setTimeout(() => {
    fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify({ mode, timedOut, code: null, durationMs: Date.now() - started, closeMissing: true }));
    process.exit(124);
  }, 5000);
}, 180000);
child.on('close', (code, signal) => {
  clearTimeout(timer); clearTimeout(watchdog); log.end();
  const result = { mode, code, signal, timedOut, durationMs: Date.now() - started, node: process.version, arch: process.arch };
  fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result)); process.exitCode = code ?? 1;
});
