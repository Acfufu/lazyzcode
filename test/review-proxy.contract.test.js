import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import dns from 'node:dns';
import { once } from 'node:events';
import { startReviewProxy } from '../core/review-proxy.js';

async function listen(server, host = '127.0.0.1') {
  server.listen(0, host);
  await once(server, 'listening');
  return server.address().port;
}
function stop(server) { server.closeAllConnections?.(); return new Promise(resolve => server.close(resolve)); }
function request(port, url, headers = {}, host = '127.0.0.1') {
  return new Promise((resolve, reject) => {
    const req = http.request({ host, port, path: url, headers, agent: false }, res => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    req.end();
  });
}
async function connect(port, authority, head = '') {
  const socket = net.connect(port, '127.0.0.1');
  await once(socket, 'connect');
  socket.write(`CONNECT ${authority} HTTP/1.1\r\nHost: ${authority}\r\n\r\n${head}`);
  let data = '';
  while (!data.includes('\r\n\r\n')) {
    const [chunk] = await once(socket, 'data');
    data += chunk.toString();
  }
  return { socket, data };
}

test('HTTP forwards only the exact allowed origin and strips proxy credentials', async t => {
  let received;
  const upstream = http.createServer((req, res) => {
    received = { url: req.url, headers: req.headers };
    res.end('allowed-http');
  });
  const upstreamPort = await listen(upstream);
  const origin = `http://127.0.0.1:${upstreamPort}`;
  const proxy = await startReviewProxy({ endpoints: [`${origin}/v1`] });
  t.after(async () => { await proxy.close(); await stop(upstream); });
  assert.deepEqual(proxy.endpoints, [origin]);
  assert.equal(proxy.url, `http://127.0.0.1:${proxy.port}`);
  assert.deepEqual(await request(proxy.port, `${origin}/api?x=1`, {
    'Proxy-Authorization': 'SECRET', 'Proxy-Connection': 'keep-alive',
    Authorization: 'provider-secret', Host: 'attacker.example',
    Connection: 'x-hop', 'x-hop': 'remove-me',
  }), { status: 200, body: 'allowed-http' });
  assert.equal(received.url, '/api?x=1');
  assert.equal(received.headers.host, `127.0.0.1:${upstreamPort}`);
  assert.equal(received.headers.authorization, 'provider-secret');
  assert.equal(received.headers['proxy-authorization'], undefined);
  assert.equal(received.headers['proxy-connection'], undefined);
  assert.equal(received.headers['x-hop'], undefined);
  for (const target of ['http://127.0.0.1:1/private', `${origin.replace('http:', 'https:')}/`, '/relative', `${origin.replace('http://', 'http://user:secret@')}/`]) {
    const result = await request(proxy.port, target);
    assert.equal(result.status, 403, target);
    assert.equal(result.body.includes('secret'), false);
  }
  assert.equal(proxy.stats.denied, 4);
});

test('CONNECT tunnels only allowed host and port, forwards early bytes, and close destroys active tunnels', async t => {
  const peerSockets = new Set();
  const upstream = net.createServer(socket => {
    peerSockets.add(socket);
    socket.on('close', () => peerSockets.delete(socket));
    socket.pipe(socket);
  });
  const upstreamPort = await listen(upstream);
  const proxy = await startReviewProxy({ endpoints: [`https://127.0.0.1:${upstreamPort}`] });
  t.after(async () => { await proxy.close(); for (const socket of peerSockets) socket.destroy(); await stop(upstream); });
  const tunnel = await connect(proxy.port, `127.0.0.1:${upstreamPort}`, 'early-bytes');
  assert.match(tunnel.data, /^HTTP\/1\.1 200 /);
  let echoed = tunnel.data.split('\r\n\r\n')[1];
  if (!echoed) echoed = (await once(tunnel.socket, 'data'))[0].toString();
  assert.equal(echoed, 'early-bytes');
  const closed = once(tunnel.socket, 'close');
  await proxy.close();
  await closed;
  assert.equal(tunnel.socket.destroyed, true);
  await proxy.close();
  await assert.rejects(request(proxy.port, 'http://127.0.0.1:1/'));
});

test('CONNECT authority parsing denies malformed, IPv6 and unknown targets without dialing', async t => {
  const proxy = await startReviewProxy({ endpoints: ['https://127.0.0.1:12345'] });
  t.after(() => proxy.close());
  for (const authority of ['127.0.0.1:1', '[::1]:12345', 'user@127.0.0.1:12345', '127.0.0.1:12345/path', '127.0.0.1:12345?x=1', '127.0.0.1:12345#x', '127.0.0.1:012345', '127.1:12345', '%31%32%37.0.0.1:12345']) {
    const { socket, data } = await connect(proxy.port, authority);
    assert.match(data, /^HTTP\/1\.1 403 /, authority);
    socket.destroy();
  }
  assert.equal(proxy.stats.denied, 9);
});

test('endpoint configuration rejects ambiguous URLs without echoing credentials', async () => {
  for (const endpoints of [[], ['file:///tmp/x'], ['https://user:secret@example.com'], ['https://@example.com'], ['https://example.com:0'], ['http://example.com:65536'], ['https://example.com\\evil'], [' https://example.com'], ['https://example.com/#fragment']]) {
    await assert.rejects(startReviewProxy({ endpoints }), error => !error.message.includes('secret'));
  }
});


test('configured IPv6 CONNECT authority is parsed exactly and reaches local peer', async t => {
  const upstream = net.createServer(socket => { socket.on('error', () => {}); socket.end('ipv6-peer'); });
  const upstreamPort = await listen(upstream, '::1');
  const proxy = await startReviewProxy({ endpoints: [`https://[::1]:${upstreamPort}/v1`] });
  t.after(async () => { await proxy.close(); await stop(upstream); });
  const { socket, data } = await connect(proxy.port, `[::1]:${upstreamPort}`);
  assert.match(data, /^HTTP\/1\.1 200 /);
  let body = data.split('\r\n\r\n')[1];
  if (!body) body = (await once(socket, 'data'))[0].toString();
  assert.equal(body, 'ipv6-peer');
  socket.destroy();
});


test('same-port IPv6 proxy listener enforces the same HTTP allowlist', async t => {
  const upstream = http.createServer((_req, res) => res.end('ipv6-proxy-allowed'));
  const upstreamPort = await listen(upstream);
  const origin = `http://127.0.0.1:${upstreamPort}`;
  const proxy = await startReviewProxy({ endpoints: [origin] });
  t.after(async () => { await proxy.close(); await stop(upstream); });
  assert.deepEqual(await request(proxy.port, `${origin}/v1`, {}, '::1'), { status: 200, body: 'ipv6-proxy-allowed' });
  assert.equal((await request(proxy.port, 'http://127.0.0.1:1/', {}, '::1')).status, 403);
  assert.equal(proxy.stats.denied, 1);
  await proxy.close();
  await assert.rejects(request(proxy.port, `${origin}/`, {}, '::1'));
});

test('occupied IPv6 same-port slot rejects startup and releases the IPv4 listener', async t => {
  const blocker = net.createServer(socket => socket.end());
  blocker.listen({ host: '::1', port: 0, ipv6Only: true });
  await once(blocker, 'listening');
  const port = blocker.address().port;
  t.after(() => stop(blocker));
  const startup = startReviewProxy({ endpoints: ['https://127.0.0.1'], port }).then(proxy => { t.after(() => proxy.close()); return proxy; });
  await assert.rejects(startup, error => error.code === 'EADDRINUSE');
  await assert.rejects(request(port, 'http://127.0.0.1:1/'), error => error.code === 'ECONNREFUSED');
});


test('HTTP-only endpoint cannot grant a raw CONNECT tunnel', async t => {
  let accepted = 0;
  const peer = net.createServer(socket => { accepted += 1; socket.end(); });
  const peerPort = await listen(peer);
  const proxy = await startReviewProxy({ endpoints: [`http://127.0.0.1:${peerPort}`] });
  t.after(async () => { await proxy.close(); await stop(peer); });
  const tunnel = await connect(proxy.port, `127.0.0.1:${peerPort}`);
  assert.match(tunnel.data, /^HTTP\/1\.1 403 /);
  tunnel.socket.destroy();
  assert.equal(accepted, 0);
});

test('startup pins hostname DNS once for both HTTP and CONNECT; later resolution changes cannot redirect', async t => {
  let lookups = 0;
  let receivedHost;
  t.mock.method(dns.promises, 'lookup', async (host, options) => {
    assert.equal(host, 'review-provider.invalid');
    assert.equal(options.all, true);
    lookups += 1;
    return [{ address: lookups === 1 ? '127.0.0.1' : '127.0.0.2', family: 4 }];
  });
  const httpPeer = http.createServer((req, res) => { receivedHost = req.headers.host; res.end('pinned-http'); });
  const httpPort = await listen(httpPeer);
  const tcpPeer = net.createServer(socket => { socket.on('error', () => {}); socket.pipe(socket); });
  const tcpPort = await listen(tcpPeer);
  const proxy = await startReviewProxy({ endpoints: [`http://review-provider.invalid:${httpPort}`, `https://review-provider.invalid:${tcpPort}`] });
  t.after(async () => { await proxy.close(); await stop(httpPeer); await stop(tcpPeer); });
  assert.equal(lookups, 1);
  assert.deepEqual(await request(proxy.port, `http://review-provider.invalid:${httpPort}/v1`), { status: 200, body: 'pinned-http' });
  assert.equal(receivedHost, `review-provider.invalid:${httpPort}`);
  const tunnel = await connect(proxy.port, `review-provider.invalid:${tcpPort}`, 'pinned-connect');
  assert.match(tunnel.data, /^HTTP\/1\.1 200 /);
  let body = tunnel.data.split('\r\n\r\n')[1];
  if (!body) body = (await once(tunnel.socket, 'data'))[0].toString();
  assert.equal(body, 'pinned-connect');
  tunnel.socket.destroy();
  assert.equal(lookups, 1);
});

test('failed startup resolution rejects before listeners open and redacts resolver messages', async t => {
  t.mock.method(dns.promises, 'lookup', async () => { throw new Error('resolver SECRET internal details'); });
  const slot = net.createServer();
  const port = await listen(slot);
  await stop(slot);
  const startup = startReviewProxy({ endpoints: ['https://review-provider.invalid'], port }).then(proxy => { t.after(() => proxy.close()); return proxy; });
  await assert.rejects(startup, error => !error.message.includes('SECRET') && !error.message.includes('review-provider'));
  await assert.rejects(request(port, 'http://127.0.0.1:1/'), error => error.code === 'ECONNREFUSED');
});

test('HTTP redirects are relayed without dialing a denied canary', async t => {
  let canaryConnections = 0;
  let proxy;
  const canary = http.createServer((_req, res) => res.end('denied-canary'));
  canary.on('connection', () => { canaryConnections += 1; });
  let canaryUrl;
  const upstream = http.createServer((_req, res) => {
    res.writeHead(302, { Location: canaryUrl });
    res.end('redirect-body');
  });
  t.after(async () => { await proxy?.close(); await stop(upstream); await stop(canary); });
  canaryUrl = `http://127.0.0.1:${await listen(canary)}/private`;
  const origin = `http://127.0.0.1:${await listen(upstream)}`;
  proxy = await startReviewProxy({ endpoints: [origin] });
  assert.deepEqual(await request(proxy.port, `${origin}/redirect`), { status: 302, body: 'redirect-body' });
  assert.equal(canaryConnections, 0);
  assert.equal((await request(proxy.port, canaryUrl)).status, 403);
  assert.equal(canaryConnections, 0);
});

test('denied canonical origins make zero canary connections', async t => {
  let canaryConnections = 0;
  let proxy;
  const canary = http.createServer((_req, res) => res.end('denied-canary'));
  canary.on('connection', () => { canaryConnections += 1; });
  const upstream = http.createServer((_req, res) => res.end('allowed'));
  t.after(async () => { await proxy?.close(); await stop(upstream); await stop(canary); });
  const canaryPort = await listen(canary);
  const allowedPort = await listen(upstream);
  proxy = await startReviewProxy({ endpoints: [`http://127.0.0.1:${allowedPort}`] });
  for (const host of ['127.0.0.1', 'localhost', '%31%32%37.0.0.1', '2130706433', '[::1]', 'xn--bcher-kva.invalid']) {
    const target = `http://${host}:${canaryPort}/private`;
    const result = await request(proxy.port, target);
    assert.equal(canaryConnections, 0, `denied target dialed canary: ${target}`);
    assert.equal(result.status, 403, target);
  }
  // Canonically equivalent origins are still allowed; the policy is not raw-string matching.
  assert.deepEqual(await request(proxy.port, `http://2130706433:${allowedPort}/ok`), { status: 200, body: 'allowed' });
});
