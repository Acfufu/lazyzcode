// Finite, offline descendants shared by the containment prototypes.
const fs = require('node:fs'), path = require('node:path'), cp = require('node:child_process'), http = require('node:http');
const [role, dir] = process.argv.slice(2);
const put = (name, data) => fs.writeFileSync(path.join(dir, name), JSON.stringify(data));
setTimeout(() => process.exit(3), 45000).unref();
if (role === 'service' || role === 'leaf' || role === 'canary') {
  fs.appendFileSync(path.join(dir, role + '.beats'), 'x');
  put(role + '.pid', { pid: process.pid });
  setInterval(() => fs.appendFileSync(path.join(dir, role + '.beats'), 'x'), 30);
  if (role === 'service') {
    const server = http.createServer((req, res) => res.end(String(process.pid)));
    server.listen(0, '127.0.0.1', () => put('service.port', { port: server.address().port }));
  }
} else if (role === 'segment1') {
  const child = cp.spawn(process.execPath, [__filename, 'service', dir], { detached: true, stdio: 'ignore' }); child.unref();
  const timer = setInterval(() => { if (fs.existsSync(path.join(dir, 'service.port'))) { put('segment1.done', { service: child.pid }); clearInterval(timer); } }, 10);
} else if (role === 'segment2') {
  const port = JSON.parse(fs.readFileSync(path.join(dir, 'service.port'))).port;
  http.get(`http://127.0.0.1:${port}`, res => { let body = ''; res.on('data', b => body += b); res.on('end', () => put('segment2.done', { service: Number(body) })); });
  const child = cp.spawn(process.execPath, [__filename, 'nested', dir], { detached: true, stdio: 'ignore' }); child.unref();
  const timer = setInterval(() => { if (fs.existsSync(path.join(dir, 'leaf.pid'))) clearInterval(timer); }, 10);
} else if (role === 'nested') {
  const child = cp.spawn(process.execPath, [__filename, 'leaf', dir], { detached: true, stdio: 'ignore' }); child.unref();
} else throw Error('unknown role');
