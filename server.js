// PacketRush server: captures packets via tcpdump and streams them to the
// browser over WebSocket. Falls back to "capture unavailable" status when
// tcpdump cannot open the interface (no root), letting the UI run demo mode.

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn, execSync } = require('child_process');
const dns = require('dns');
const { WebSocketServer } = require('ws');

const PORT = Number(process.env.PORT) || 8090;
const PUBLIC_DIR = path.join(__dirname, 'public');
const BATCH_INTERVAL_MS = 100;
const MAX_PACKETS_PER_BATCH = 80;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

// ---------------------------------------------------------------------------
// Local address set (used to decide packet direction)
// ---------------------------------------------------------------------------
function localAddresses() {
  const addrs = new Set();
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const info of ifaces[name] || []) {
      addrs.add(info.address.replace(/%.*$/, ''));
    }
  }
  return addrs;
}
const LOCAL_ADDRS = localAddresses();

// macOS: `route -n get default` → "  interface: en0"
function parseRouteGetOutput(out) {
  const m = out.match(/interface:\s*(\S+)/);
  return m ? m[1] : null;
}

// Linux: `ip route show default` → "default via 192.168.1.1 dev eth0 ..."
function parseIpRouteOutput(out) {
  const m = out.match(/^default\s.*?\bdev\s+(\S+)/m);
  return m ? m[1] : null;
}

function detectInterface() {
  if (process.env.IFACE) return process.env.IFACE;
  if (process.platform === 'darwin') {
    try {
      const iface = parseRouteGetOutput(
        execSync('route -n get default 2>/dev/null', { encoding: 'utf8' }));
      if (iface) return iface;
    } catch (_) { /* fall through */ }
    return 'en0';
  }
  try {
    const iface = parseIpRouteOutput(
      execSync('ip route show default 2>/dev/null', { encoding: 'utf8' }));
    if (iface) return iface;
  } catch (_) { /* fall through */ }
  return process.platform === 'linux' ? 'eth0' : 'en0';
}
const IFACE = detectInterface();

// ---------------------------------------------------------------------------
// tcpdump line parsing
// ---------------------------------------------------------------------------
// With -t -n -q, lines look like:
//   IP 192.168.1.5.52344 > 142.250.74.196.443: tcp 1448
//   IP 8.8.8.8.53 > 192.168.1.5.55321: UDP, length 120
//   IP 192.168.1.1 > 192.168.1.5: ICMP echo reply, length 64
//   IP6 fe80::1.5353 > ff02::fb.5353: UDP, length 100
const LINE_RE = /^(IP6|IP) (\S+?) > (\S+?): (.+)$/;

function splitHostPort(token, isV6) {
  const lastDot = token.lastIndexOf('.');
  if (lastDot === -1) return { host: token, port: null };
  if (isV6) {
    // Port present only if a dot appears after the last colon (e.g. ff02::fb.5353)
    if (lastDot > token.lastIndexOf(':')) {
      return { host: token.slice(0, lastDot), port: Number(token.slice(lastDot + 1)) };
    }
    return { host: token, port: null };
  }
  // IPv4: 4 dots means addr.port, 3 dots means bare address
  const dots = (token.match(/\./g) || []).length;
  if (dots === 4) {
    return { host: token.slice(0, lastDot), port: Number(token.slice(lastDot + 1)) };
  }
  return { host: token, port: null };
}

function classify(proto, srcPort, dstPort) {
  const ports = [srcPort, dstPort];
  if (proto === 'tcp') {
    if (ports.includes(443)) return 'https';
    if (ports.includes(80)) return 'http';
    if (ports.includes(22)) return 'ssh';
    if (ports.includes(53)) return 'dns';
    return 'tcp';
  }
  if (proto === 'udp') {
    if (ports.includes(443)) return 'quic';
    if (ports.includes(53) || ports.includes(5353)) return 'dns';
    return 'udp';
  }
  return proto; // icmp / other
}

function parseLine(line) {
  const m = LINE_RE.exec(line);
  if (!m) {
    if (/^ARP/.test(line)) {
      return { proto: 'other', len: 60, dir: 'in', src: 'arp', dst: 'arp', sport: null, dport: null };
    }
    return null;
  }
  const isV6 = m[1] === 'IP6';
  const src = splitHostPort(m[2], isV6);
  const dst = splitHostPort(m[3], isV6);
  const rest = m[4];

  let proto = 'other';
  if (/^tcp/i.test(rest)) proto = 'tcp';
  else if (/^UDP/i.test(rest)) proto = 'udp';
  else if (/^ICMP/i.test(rest)) proto = 'icmp';

  const lenMatch = rest.match(/(?:length |tcp )(\d+)/);
  const len = lenMatch ? Number(lenMatch[1]) : 60;

  const dir = LOCAL_ADDRS.has(src.host) ? 'out' : 'in';
  return {
    proto: classify(proto, src.port, dst.port),
    len,
    dir,
    src: src.host,
    dst: dst.host,
    sport: src.port,
    dport: dst.port,
  };
}

// ---------------------------------------------------------------------------
// Flow table: 5-tuple -> small integer flow id, so the client can group a
// connection's packets into one lane (convoys). Idle flows are evicted.
// ---------------------------------------------------------------------------
const FLOW_IDLE_MS = 30_000;
const FLOW_SWEEP_MS = 10_000;
const FLOW_MAX = 4096;

const flows = new Map(); // key -> { id, lastSeen }
let nextFlowId = 1;

function flowKey(pkt) {
  const a = `${pkt.src}:${pkt.sport ?? ''}`;
  const b = `${pkt.dst}:${pkt.dport ?? ''}`;
  // Order endpoints so both directions of a connection share one flow
  return a < b ? `${pkt.proto}|${a}|${b}` : `${pkt.proto}|${b}|${a}`;
}

function tagFlow(pkt, now = Date.now()) {
  const key = flowKey(pkt);
  let entry = flows.get(key);
  if (!entry) {
    if (flows.size >= FLOW_MAX) {
      // Evict the oldest entry (Map preserves insertion order; refreshed
      // entries are re-inserted, so the first key is the stalest).
      const oldest = flows.keys().next().value;
      flows.delete(oldest);
    }
    entry = { id: nextFlowId++, lastSeen: now };
  } else {
    flows.delete(key); // re-insert to keep Map ordered by recency
    entry.lastSeen = now;
  }
  flows.set(key, entry);
  pkt.flow = entry.id;
  return pkt;
}

function sweepFlows(now = Date.now()) {
  for (const [key, entry] of flows) {
    if (now - entry.lastSeen > FLOW_IDLE_MS) flows.delete(key);
    else break; // ordered by recency: the rest are fresher
  }
}

// ---------------------------------------------------------------------------
// Reverse DNS: cached + rate-limited lookups of remote hosts. Resolved names
// are streamed to clients as { type: 'names', names: { ip: hostname } } and
// used in the inspect tooltip.
// ---------------------------------------------------------------------------
const RDNS_TTL_MS = 10 * 60_000;
const RDNS_MAX_CACHE = 2048;
const RDNS_CONCURRENCY = 4;   // at most 4 lookups in flight
const RDNS_QUEUE_MAX = 256;   // shed lookups under bursts instead of piling up

const rdnsCache = new Map();  // ip -> { name|null, at }  (null = negative hit)
const rdnsQueue = [];
const rdnsQueued = new Set();
let rdnsActive = 0;
let pendingNames = {};        // resolved since the last broadcast
let rdnsResolve = (ip) => dns.promises.reverse(ip);

function requestRdns(ip, now = Date.now()) {
  if (!ip || !/^[0-9a-f.:]+$/i.test(ip) || LOCAL_ADDRS.has(ip)) return;
  const hit = rdnsCache.get(ip);
  if (hit && now - hit.at < RDNS_TTL_MS) return;
  if (rdnsQueued.has(ip) || rdnsQueue.length >= RDNS_QUEUE_MAX) return;
  rdnsQueued.add(ip);
  rdnsQueue.push(ip);
  pumpRdns();
}

function pumpRdns() {
  while (rdnsActive < RDNS_CONCURRENCY && rdnsQueue.length > 0) {
    const ip = rdnsQueue.shift();
    rdnsActive++;
    Promise.resolve()
      .then(() => rdnsResolve(ip))
      .then((names) => storeRdns(ip, (names && names[0]) || null))
      .catch(() => storeRdns(ip, null))
      .then(() => {
        rdnsActive--;
        rdnsQueued.delete(ip);
        pumpRdns();
      });
  }
}

function storeRdns(ip, name) {
  if (rdnsCache.size >= RDNS_MAX_CACHE) {
    rdnsCache.delete(rdnsCache.keys().next().value);
  }
  rdnsCache.set(ip, { name, at: Date.now() });
  if (name) pendingNames[ip] = name;
}

function knownNames() {
  const names = {};
  for (const [ip, entry] of rdnsCache) {
    if (entry.name) names[ip] = entry.name;
  }
  return names;
}

// ---------------------------------------------------------------------------
// HTTP + WebSocket server
// ---------------------------------------------------------------------------
const server = http.createServer((req, res) => {
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';
  const filePath = path.join(PUBLIC_DIR, path.normalize(urlPath));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      return res.end('Not found');
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  });
});

const wss = new WebSocketServer({ server });

let captureState = { capture: 'starting', iface: IFACE, reason: null };

function broadcast(obj) {
  const msg = JSON.stringify(obj);
  for (const client of wss.clients) {
    if (client.readyState === 1) client.send(msg);
  }
}

wss.on('connection', (ws) => {
  ws.send(JSON.stringify({ type: 'status', ...captureState }));
  const names = knownNames();
  if (Object.keys(names).length > 0) {
    ws.send(JSON.stringify({ type: 'names', names }));
  }
});

// ---------------------------------------------------------------------------
// Packet capture
// ---------------------------------------------------------------------------
let batch = [];
let droppedInBatch = 0;

setInterval(() => {
  if (batch.length === 0 && droppedInBatch === 0) return;
  broadcast({ type: 'packets', packets: batch, dropped: droppedInBatch });
  batch = [];
  droppedInBatch = 0;
}, BATCH_INTERVAL_MS).unref();

setInterval(() => {
  if (Object.keys(pendingNames).length === 0) return;
  broadcast({ type: 'names', names: pendingNames });
  pendingNames = {};
}, 1000).unref();

setInterval(sweepFlows, FLOW_SWEEP_MS).unref();

function startCapture() {
  const args = ['-i', IFACE, '-n', '-q', '-l', '-t', '-U'];
  const tcpdump = spawn('tcpdump', args);
  let stderrBuf = '';
  let gotPackets = false;

  let lineBuf = '';
  tcpdump.stdout.on('data', (chunk) => {
    lineBuf += chunk.toString();
    const lines = lineBuf.split('\n');
    lineBuf = lines.pop();
    for (const line of lines) {
      const pkt = parseLine(line.trim());
      if (!pkt) continue;
      gotPackets = true;
      if (captureState.capture !== 'live') {
        captureState = { capture: 'live', iface: IFACE, reason: null };
        broadcast({ type: 'status', ...captureState });
        console.log(`[capture] live on ${IFACE}`);
      }
      if (batch.length >= MAX_PACKETS_PER_BATCH) {
        droppedInBatch++;
      } else {
        batch.push(tagFlow(pkt));
        requestRdns(pkt.dir === 'out' ? pkt.dst : pkt.src);
      }
    }
  });

  tcpdump.stderr.on('data', (chunk) => {
    stderrBuf += chunk.toString();
    if (/permission denied|operation not permitted|don't have permission/i.test(stderrBuf) && captureState.capture !== 'unavailable') {
      captureState = { capture: 'unavailable', iface: IFACE, reason: 'permission' };
      broadcast({ type: 'status', ...captureState });
      console.log('[capture] permission denied — demo mode active in browser.');
      if (process.platform === 'darwin') {
        console.log('[capture] for live packets: `sudo npm start`, or grant yourself BPF access once');
        console.log('[capture] with `sudo scripts/grant-bpf.sh` and then plain `npm start` works.');
      } else {
        console.log('[capture] for live packets run with sudo, or setcap tcpdump (see README).');
      }
    }
  });

  tcpdump.on('error', () => {
    captureState = { capture: 'unavailable', iface: IFACE, reason: 'tcpdump-missing' };
    broadcast({ type: 'status', ...captureState });
  });

  tcpdump.on('exit', (code) => {
    if (!gotPackets && captureState.capture !== 'unavailable') {
      captureState = { capture: 'unavailable', iface: IFACE, reason: `exit-${code}` };
      broadcast({ type: 'status', ...captureState });
      console.log(`[capture] tcpdump exited (code ${code}) — demo mode active in browser.`);
    } else if (gotPackets) {
      // Capture died mid-run; try to restart after a moment.
      console.log(`[capture] tcpdump exited (code ${code}), restarting in 2s...`);
      setTimeout(startCapture, 2000);
    }
  });

  process.on('exit', () => tcpdump.kill());
}

module.exports = {
  parseLine, classify, splitHostPort, tagFlow, sweepFlows, flows,
  parseRouteGetOutput, parseIpRouteOutput,
  requestRdns, rdnsCache, knownNames,
  _setRdnsResolver: (fn) => { rdnsResolve = fn; },
  _rdnsStats: () => ({ active: rdnsActive, queued: rdnsQueue.length }),
};

if (require.main === module) server.listen(PORT, () => {
  console.log(`PacketRush running at http://localhost:${PORT}`);
  console.log(`Capturing on interface ${IFACE} (override with IFACE=enX)`);
  if (process.getuid && process.getuid() !== 0) {
    if (process.platform === 'linux') {
      console.log('Note: live capture needs privileges. Run `sudo npm start`, or grant tcpdump');
      console.log('capabilities once: sudo setcap cap_net_raw,cap_net_admin+eip "$(command -v tcpdump)"');
    } else {
      console.log('Note: live capture on macOS needs root. Run `sudo npm start` for real packets;');
      console.log('without it the browser falls back to simulated demo traffic.');
    }
  }
  startCapture();
});
