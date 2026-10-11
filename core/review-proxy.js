import http from 'node:http';
import net from 'node:net';
import dns from 'node:dns';

const CONNECT_TIMEOUT_MS = 10_000;
const IDLE_TIMEOUT_MS = 30_000;
const HOP_HEADERS = new Set([
  'connection', 'proxy-connection', 'proxy-authorization', 'proxy-authenticate',
  'keep-alive', 'te', 'trailer', 'transfer-encoding', 'upgrade',
]);

function parseEndpoint(value) {
  if (typeof value !== 'string' || /[\s\\\x00-\x1f\x7f]/u.test(value)) throw new Error('Invalid review proxy endpoint');
  const rawAuthority = /^https?:\/\/([^/?#]+)/iu.exec(value)?.[1];
  if (!rawAuthority || rawAuthority.includes('@')) throw new Error('Invalid review proxy endpoint');
  let url;
  try { url = new URL(value); } catch { throw new Error('Invalid review proxy endpoint'); }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password || url.hash || url.port === '0') {
    throw new Error('Invalid review proxy endpoint');
  }
  return url;
}

function authority(url) {
  return `${url.hostname.toLowerCase()}:${url.port || (url.protocol === 'https:' ? '443' : '80')}`;
}

function connectAuthority(value) {
  // CONNECT is an authority, never a URL. Reject normalization tricks before URL parsing.
  const match = /^(\[[0-9a-fA-F:.]+\]|[a-zA-Z0-9.-]+):([1-9][0-9]{0,4})$/u.exec(value ?? '');
  if (!match || Number(match[2]) > 65535) return null;
  let url;
  try { url = new URL(`http://${value}`); } catch { return null; }
  if (url.hostname.toLowerCase() !== match[1].toLowerCase()) return null;
  return `${url.hostname.toLowerCase()}:${match[2]}`;
}

function cleanHeaders(headers) {
  const denied = new Set(HOP_HEADERS);
  for (const item of String(headers.connection ?? '').split(',')) denied.add(item.trim().toLowerCase());
  return Object.fromEntries(Object.entries(headers).filter(([name]) => !denied.has(name.toLowerCase())));
}

async function pinHosts(urls) {
  const pinned = new Map();
  for (const url of urls) {
    if (pinned.has(url.hostname)) continue;
    const host = url.hostname.startsWith('[') ? url.hostname.slice(1, -1) : url.hostname;
    if (net.isIP(host)) { pinned.set(url.hostname, [{ address: host, family: net.isIP(host) }]); continue; }
    let deadline;
    try {
      const records = await Promise.race([
        dns.promises.lookup(host, { all: true }),
        new Promise((_resolve, reject) => { deadline = setTimeout(() => reject(new Error()), CONNECT_TIMEOUT_MS); }),
      ]);
      if (!Array.isArray(records) || !records.length || records.some(record => !net.isIP(record.address))) throw new Error();
      pinned.set(url.hostname, records.map(record => ({ address: record.address, family: net.isIP(record.address) })));
    } catch {
      throw new Error('Review proxy endpoint resolution failed');
    } finally { clearTimeout(deadline); }
  }
  return pinned;
}

/** HTTP origin allowlist and HTTPS TCP authority allowlist; caller must enforce OS isolation. */
export async function startReviewProxy({ endpoints, port: requestedPort = 0 } = {}) {
  if (!Array.isArray(endpoints) || endpoints.length === 0) throw new Error('Review proxy requires endpoints');
  if (!Number.isInteger(requestedPort) || requestedPort < 0 || requestedPort > 65535) throw new Error('Invalid review proxy port');
  const urls = endpoints.map(parseEndpoint);
  const origins = new Set(urls.map(url => url.origin));
  const authorities = new Map(urls.filter(url => url.protocol === 'https:').map(url => [authority(url), url.hostname]));
  const pinned = await pinHosts(urls);
  const stats = { denied: 0 };
  const sockets = new Set();
  const requests = new Set();
  let closed = false;
  let closePromise;
  function track(socket) {
    sockets.add(socket);
    socket.on('error', () => {});
    socket.once('close', () => sockets.delete(socket));
    socket.setTimeout(IDLE_TIMEOUT_MS, () => socket.destroy());
    if (closed) socket.destroy();
    return socket;
  }
  function denyResponse(res) {
    stats.denied += 1;
    res.writeHead(403, { 'Content-Type': 'text/plain', Connection: 'close' });
    res.end('Review proxy target denied');
  }
  const server = http.createServer((req, res) => {
    let target;
    try { target = parseEndpoint(req.url); } catch { denyResponse(res); return; }
    if (closed || target.protocol !== 'http:' || !origins.has(target.origin)) { denyResponse(res); return; }
    const headers = cleanHeaders(req.headers);
    headers.host = target.host;
    const addresses = pinned.get(target.hostname);
    const upstream = http.request(target, {
      method: req.method, headers, agent: false,
      lookup(_host, options, callback) {
        queueMicrotask(() => options.all ? callback(null, addresses) : callback(null, addresses[0].address, addresses[0].family));
      },
    });
    requests.add(upstream);
    const connectionDeadline = setTimeout(() => upstream.destroy(), CONNECT_TIMEOUT_MS);
    upstream.on('socket', socket => {
      track(socket);
      socket.once('connect', () => clearTimeout(connectionDeadline));
    });
    upstream.once('close', () => { clearTimeout(connectionDeadline); requests.delete(upstream); });
    upstream.on('error', () => {
      if (!res.headersSent) { res.writeHead(502, { Connection: 'close' }); res.end('Review proxy upstream unavailable'); }
      else res.destroy();
    });
    upstream.on('response', response => {
      res.writeHead(response.statusCode, cleanHeaders(response.headers));
      response.on('error', () => res.destroy());
      response.pipe(res);
    });
    req.on('aborted', () => upstream.destroy());
    req.on('error', () => upstream.destroy());
    res.on('close', () => upstream.destroy());
    req.pipe(upstream);
  });
  server.headersTimeout = CONNECT_TIMEOUT_MS;
  server.requestTimeout = IDLE_TIMEOUT_MS;
  server.keepAliveTimeout = 1_000;
  server.maxHeadersCount = 64;
  server.maxConnections = 64;
  server.on('connection', track);
  server.on('clientError', (_error, socket) => {
    stats.denied += 1;
    socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
  });
  server.on('connect', (req, client, head) => {
    const key = connectAuthority(req.url);
    if (closed || !key || !authorities.has(key)) {
      stats.denied += 1;
      client.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
      return;
    }
    const addresses = pinned.get(authorities.get(key));
    const address = addresses.find(record => record.family === 4) ?? addresses[0];
    const upstream = track(net.connect({ host: address.address, port: Number(key.slice(key.lastIndexOf(':') + 1)) }));
    const connectionDeadline = setTimeout(() => upstream.destroy(), CONNECT_TIMEOUT_MS);
    let connected = false;
    upstream.once('connect', () => {
      clearTimeout(connectionDeadline);
      connected = true;
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head.length) upstream.write(head);
      client.pipe(upstream);
      upstream.pipe(client);
    });
    upstream.once('close', () => {
      clearTimeout(connectionDeadline);
      if (!connected && !client.destroyed) client.end('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
      else client.destroy();
    });
    client.once('close', () => upstream.destroy());
  });
  // Seatbelt's localhost selector includes both loopback families. Own both slots
  // before returning, so an unrelated IPv6 listener cannot become an escape path.
  const ipv6Server = http.createServer();
  for (const event of ['request', 'connection', 'clientError', 'connect']) {
    for (const listener of server.listeners(event)) ipv6Server.on(event, listener);
  }
  for (const setting of ['headersTimeout', 'requestTimeout', 'keepAliveTimeout', 'maxHeadersCount', 'maxConnections']) {
    ipv6Server[setting] = server[setting];
  }
  const servers = [server, ipv6Server];
  async function listen(listener, options) {
    await new Promise((resolve, reject) => {
      listener.once('error', reject);
      listener.listen(options, () => { listener.off('error', reject); resolve(); });
    });
  }
  function closeAll() {
    closed = true;
    const closing = Promise.all(servers.map(listener => new Promise(resolve => listener.close(() => resolve()))));
    for (const request of requests) request.destroy();
    for (const socket of sockets) socket.destroy();
    return closing.then(() => {});
  }
  let port;
  try {
    await listen(server, { port: requestedPort, host: '127.0.0.1' });
    port = server.address().port;
    await listen(ipv6Server, { port, host: '::1', ipv6Only: true });
  } catch (error) {
    await closeAll();
    throw error;
  }
  // Runtime server errors must not carry request data into logs or become uncaught exceptions.
  for (const listener of servers) listener.on('error', () => {});
  return {
    url: `http://127.0.0.1:${port}`, port, endpoints: [...origins], stats,
    close() {
      closePromise ??= closeAll();
      return closePromise;
    },
  };
}
