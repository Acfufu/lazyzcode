import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import http from "node:http";
import { spawnHeadless } from "../core/headless.js";
import { createReviewSandbox, reviewSandboxCapability, reviewEnvironment } from "../core/review-sandbox.js";

test("review environment drops host secrets/injection and confines all runtime directories", () => {
  const root = mkdtempSync(join(tmpdir(), "lzy-review-env-"));
  try {
    const env = reviewEnvironment({ home: root, proxyUrl: "http://127.0.0.1:1234", source: { LANG: "zh_CN.UTF-8", NODE_OPTIONS: "bad", SECRET: "bad", PATH: "/bad", HTTPS_PROXY: "http://bad" } });
    assert.equal(env.SECRET, undefined);
    assert.equal(env.NODE_OPTIONS, undefined);
    assert.equal(env.HOME, root);
    assert.equal(env.TMPDIR, join(root, "tmp"));
    assert.equal(env.ZCODE_HTTP_PROXY, "http://127.0.0.1:1234");
    assert.ok(!env.PATH.includes("/bad"));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("unsupported review backend refuses a security downgrade", () => {
  for (const platform of ["linux", "win32"]) assert.equal(reviewSandboxCapability({ platform }).available, false);
});

test("real OS boundary confines engine, descendants, files and network", { skip: process.platform !== "darwin" }, async () => {
  const root = mkdtempSync(join(tmpdir(), "lzy-review-os-"));
  const outside = mkdtempSync(join(tmpdir(), "lzy-review-outside-"));
  let sandbox;
  const server = http.createServer((_req, res) => res.end("allowed-api"));
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const endpoint = `http://127.0.0.1:${server.address().port}`;
  try {
    const candidateDir = join(root, "candidate"); const home = join(root, "home");
    mkdirSync(candidateDir); mkdirSync(home);
    writeFileSync(join(candidateDir, "source.txt"), "candidate");
    writeFileSync(join(outside, "secret.txt"), "synthetic-secret");
    symlinkSync(join(outside, "secret.txt"), join(candidateDir, "escape"));
    const inputPath = join(root, "input.json"); writeFileSync(inputPath, "{}");
    const enginePath = join(candidateDir, "engine.mjs");
    writeFileSync(enginePath, `import fs from 'node:fs'; import http from 'node:http'; import net from 'node:net'; import {spawnSync} from 'node:child_process';
const denied = f => { try { f(); return false; } catch { return true; } };
const external=${JSON.stringify(join(outside, "secret.txt"))};
const checks={read:denied(()=>fs.readFileSync(external)),symlink:denied(()=>fs.readFileSync('escape')),write:denied(()=>fs.writeFileSync(external,'bad')),candidate:denied(()=>fs.writeFileSync('source.txt','bad')),input:denied(()=>fs.writeFileSync(${JSON.stringify(inputPath)},'bad'))};
checks.delete=denied(()=>fs.unlinkSync('source.txt'));checks.rename=denied(()=>fs.renameSync('source.txt',process.env.HOME+'/moved'));checks.link=denied(()=>fs.linkSync(external,process.env.HOME+'/linked'));
fs.writeFileSync(process.env.TMPDIR+'/yes','ok');
checks.descendant=spawnSync(process.execPath,['-e',"try { require('fs').readFileSync("+JSON.stringify(external)+"); process.exit(7) } catch { process.exit(0) }"],{encoding:'utf8'}).status===0;
const connectDenied=(host,port)=>new Promise(resolve=>{const s=net.connect({host,port}); s.once('connect',()=>{s.destroy();resolve(false)});s.once('error',()=>resolve(true));s.setTimeout(2000,()=>{s.destroy();resolve(false)})});
checks.direct=await connectDenied('127.0.0.1',${server.address().port}); checks.ipv6=await connectDenied('::1',${server.address().port});
const proxy=new URL(process.env.HTTP_PROXY);
checks.proxy=await new Promise((resolve,reject)=>{http.get({host:proxy.hostname,port:proxy.port,path:${JSON.stringify(endpoint)}},res=>{let s='';res.on('data',x=>s+=x);res.on('end',()=>resolve(s==='allowed-api'))}).on('error',reject)});
checks.unknown=await new Promise((resolve,reject)=>{http.get({host:proxy.hostname,port:proxy.port,path:'http://127.0.0.1:1/'},res=>{res.resume();res.on('end',()=>resolve(res.statusCode===403))}).on('error',reject)});
console.log(JSON.stringify({sessionId:'fake',response:JSON.stringify(checks)}));`);
    sandbox = await createReviewSandbox({ runDir: root, candidateDir, inputPath, home, enginePath, endpoints: [endpoint] });
    const r = await spawnHeadless({ prompt: "offline probe", mode: "plan", cwd: candidateDir, home, enginePath, timeoutMs: 10_000, ...sandbox.headless });
    assert.equal(r.ok, true, r.error);
    assert.deepEqual(JSON.parse(r.response), { read: true, symlink: true, write: true, candidate: true, input: true, delete: true, rename: true, link: true, descendant: true, direct: true, ipv6: true, proxy: true, unknown: true });
    assert.equal(readFileSync(join(outside, "secret.txt"), "utf8"), "synthetic-secret");
    assert.equal(readFileSync(join(candidateDir, "source.txt"), "utf8"), "candidate");
  } finally { await sandbox?.close(); await new Promise(resolve => server.close(resolve)); rmSync(root, { recursive: true, force: true }); rmSync(outside, { recursive: true, force: true }); }
});
