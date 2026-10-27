// Read-only host inspection plus an ad-hoc, unentitled capability probe.
// Does not use a signing key, install profiles, subscribe, or start a workload.
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';
if (process.platform !== 'darwin') throw Error('macOS required');
const out = resolve(process.argv[2] ?? 'artifacts/reliability/r0-native/macos');
mkdirSync(out, { recursive: true });
const run = (cmd, args) => {
  const r = spawnSync(cmd, args, { encoding: 'utf8', timeout: 15000, maxBuffer: 4 * 1024 * 1024 });
  if (r.error) throw r.error;
  return r;
};
const required = (cmd, args) => { const r = run(cmd, args); if (r.status !== 0) throw Error(`${cmd}: ${r.stderr}`); return r.stdout.trim(); };
const sha = p => createHash('sha256').update(readFileSync(p)).digest('hex');
const sdk = required('xcrun', ['--show-sdk-path']);
const binary = join(out, 'es-capability');
const source = resolve('scripts/probes/r0-macos-es.c');
required('xcrun', ['clang', '-Wall', '-Wextra', '-Werror', '-fblocks', '-mmacosx-version-min=11.0', source, '-lEndpointSecurity', '-o', binary]);
// On arm64 clang emits an ad-hoc signature. Inspect; never add a restricted key.
const signature = run('codesign', ['-dvvv', '--entitlements', ':-', binary]);
writeFileSync(join(out, 'signature.txt'), signature.stdout + signature.stderr);
const identities = required('security', ['find-identity', '-v', '-p', 'codesigning']);
const profiles = [];
for (const dir of [join(homedir(), 'Library/Developer/Xcode/UserData/Provisioning Profiles'), join(homedir(), 'Library/MobileDevice/Provisioning Profiles')]) {
  if (!existsSync(dir)) continue;
  for (const name of readdirSync(dir).filter(n => /\.(mobileprovision|provisionprofile)$/.test(n))) {
    const file = join(dir, name), decoded = run('security', ['cms', '-D', '-i', file]);
    if (decoded.status !== 0) { profiles.push({ sha256: sha(file), decoded: false }); continue; }
    // Parse only selected fields. Never persist raw profiles, device IDs or names.
    const json = spawnSync('/usr/bin/python3', ['-c', 'import sys,plistlib,json; p=plistlib.loads(sys.stdin.buffer.read()); e=p.get("Entitlements",{}); print(json.dumps({"platform":p.get("Platform"),"expires":str(p.get("ExpirationDate")),"endpointSecurity":e.get("com.apple.developer.endpoint-security.client")==True,"macApplicationIdentifier":isinstance(e.get("com.apple.application-identifier"),str)}))'], { input: decoded.stdout, encoding: 'utf8', timeout: 5000 });
    if (json.status !== 0) throw Error('profile plist decode failed');
    profiles.push({ sha256: sha(file), ...JSON.parse(json.stdout) });
  }
}
const probe = run(binary, ['--descendants-only']);
const result = { schemaVersion: 1, inspectedAt: new Date().toISOString(), os: required('sw_vers', ['-productVersion']),
  arch: process.arch, node: process.version, sdk, sdkHeaderSha256: sha(join(sdk, 'usr/include/EndpointSecurity/ESClient.h')),
  sourceSha256: sha(source), binarySha256: sha(binary),
  signing: { appleDevelopmentCount: (identities.match(/"Apple Development:/g) ?? []).length,
    developerIDApplicationCount: (identities.match(/"Developer ID Application:/g) ?? []).length },
  profiles, probe: { exitCode: probe.status, signal: probe.signal, stdout: probe.stdout.trim(), stderr: probe.stderr.trim() },
  boundary: 'prerequisites only; no event completeness, containment or recovery proof' };
writeFileSync(join(out, 'result.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
// A blocked prerequisite is a failing capability gate, not a skipped success.
process.exitCode = probe.status === 0 ? 0 : 78;
