// Temporary per-user launchd job. Always removes its own label and finite fixture.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, existsSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
if (process.platform !== 'darwin') throw Error('Darwin only');
const out = resolve(process.argv[2] ?? 'artifacts/reliability/r0-followup/launchd');
mkdirSync(out, { recursive: true });
const label = 'local.lzy.r0.' + randomUUID(), domain = 'gui/' + process.getuid();
const plist = join(out, 'job.plist'), fixture = resolve('scripts/probes/r0-fixture.cjs');
const escape = s => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
writeFileSync(plist, `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>Label</key><string>${label}</string><key>ProgramArguments</key><array>${[process.execPath, fixture, 'segment1', out].map(s => '<string>' + escape(s) + '</string>').join('')}</array><key>RunAtLoad</key><true/><key>AbandonProcessGroup</key><false/><key>StandardErrorPath</key><string>${escape(join(out, 'stderr.log'))}</string></dict></plist>`);
let loaded = false;
try {
  execFileSync('launchctl', ['bootstrap', domain, plist]); loaded = true;
  const deadline = Date.now() + 10000;
  while (!existsSync(join(out, 'segment1.done'))) { if (Date.now() > deadline) throw Error('launchd fixture timeout'); await delay(30); }
  await delay(250);
  const state = execFileSync('launchctl', ['print', domain + '/' + label], { encoding: 'utf8' });
  const before = statSync(join(out, 'service.beats')).size; await delay(150);
  const afterExit = statSync(join(out, 'service.beats')).size;
  execFileSync('launchctl', ['bootout', domain + '/' + label]); loaded = false;
  await delay(150); const afterBootout = statSync(join(out, 'service.beats')).size;
  const result = { label, before, afterExit, afterBootout, escaped: afterBootout > afterExit, jobExited: /state = not running/.test(state), state };
  writeFileSync(join(out, 'result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ ...result, state: undefined }));
} finally {
  if (loaded) try { execFileSync('launchctl', ['bootout', domain + '/' + label]); } catch {}
  if (existsSync(join(out, 'service.pid'))) {
    const pid = JSON.parse(readFileSync(join(out, 'service.pid'))).pid;
    try { process.kill(pid, 'SIGKILL'); } catch (e) { if (e.code !== 'ESRCH') throw e; }
  }
}
