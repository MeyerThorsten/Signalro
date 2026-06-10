// Unit tests for the tcpdump line parser and flow table.
// Run with: npm test

const { test } = require('node:test');
const assert = require('node:assert');
const {
  parseLine, classify, splitHostPort, tagFlow, sweepFlows, flows,
  parseRouteGetOutput, parseIpRouteOutput,
  requestRdns, rdnsCache, knownNames, _setRdnsResolver, _rdnsStats,
  extractSNI, hexLinesToBuffer,
  parseLsof, parseSs, tokenOf,
} = require('../server.js');

test('tokenOf: extracts the token query param from a WS upgrade URL', () => {
  assert.strictEqual(tokenOf('/?token=s3cret'), 's3cret');
  assert.strictEqual(tokenOf('/?foo=1&token=abc&bar=2'), 'abc');
  assert.strictEqual(tokenOf('/?token=a%20b'), 'a b');
  assert.strictEqual(tokenOf('/'), null);
  assert.strictEqual(tokenOf(''), null);
  assert.strictEqual(tokenOf(undefined), null);
});

// Build a minimal valid TLS ClientHello carrying the given SNI host, optionally
// prefixed with junk bytes (to simulate link-layer + IP/TCP headers).
function buildClientHello(host, prefix = 0) {
  const hostBuf = Buffer.from(host, 'ascii');
  const sniExtBody = Buffer.concat([
    Buffer.from([0x00, hostBuf.length + 3]),       // server_name_list length
    Buffer.from([0x00]),                            // name_type = host_name
    Buffer.from([(hostBuf.length >> 8) & 0xff, hostBuf.length & 0xff]),
    hostBuf,
  ]);
  const sniExt = Buffer.concat([
    Buffer.from([0x00, 0x00, (sniExtBody.length >> 8) & 0xff, sniExtBody.length & 0xff]),
    sniExtBody,
  ]);
  const extensions = sniExt;
  const body = Buffer.concat([
    Buffer.from([0x03, 0x03]),                      // client_version
    Buffer.alloc(32, 0xab),                         // random
    Buffer.from([0x00]),                            // session_id length 0
    Buffer.from([0x00, 0x02, 0x00, 0x2f]),          // cipher_suites
    Buffer.from([0x01, 0x00]),                      // compression_methods
    Buffer.from([(extensions.length >> 8) & 0xff, extensions.length & 0xff]),
    extensions,
  ]);
  const handshake = Buffer.concat([
    Buffer.from([0x01, (body.length >> 16) & 0xff, (body.length >> 8) & 0xff, body.length & 0xff]),
    body,
  ]);
  const record = Buffer.concat([
    Buffer.from([0x16, 0x03, 0x01, (handshake.length >> 8) & 0xff, handshake.length & 0xff]),
    handshake,
  ]);
  return Buffer.concat([Buffer.alloc(prefix, 0x00), record]);
}

// ---------------------------------------------------------------------------
// TLS SNI extraction
// ---------------------------------------------------------------------------
test('extractSNI: pulls hostname from a ClientHello', () => {
  assert.strictEqual(extractSNI(buildClientHello('github.com')), 'github.com');
  assert.strictEqual(extractSNI(buildClientHello('www.cloudflare.com')), 'www.cloudflare.com');
});

test('extractSNI: finds the handshake behind link/IP/TCP headers', () => {
  assert.strictEqual(extractSNI(buildClientHello('example.org', 54)), 'example.org');
});

test('extractSNI: returns null for non-TLS or truncated buffers', () => {
  assert.strictEqual(extractSNI(Buffer.from('not a tls packet at all')), null);
  assert.strictEqual(extractSNI(Buffer.alloc(0)), null);
  assert.strictEqual(extractSNI(buildClientHello('github.com').subarray(0, 20)), null);
});

test('extractSNI: rejects a bogus (non-hostname) server_name', () => {
  assert.strictEqual(extractSNI(buildClientHello('nodotsorgtld')), null);
});

test('hexLinesToBuffer: reassembles tcpdump -x hex lines', () => {
  const buf = hexLinesToBuffer(['\t0x0000:  4500 0028 abcd', '\t0x0010:  00ff']);
  assert.deepStrictEqual([...buf], [0x45, 0x00, 0x00, 0x28, 0xab, 0xcd, 0x00, 0xff]);
});

// ---------------------------------------------------------------------------
// process / app attribution parsers
// ---------------------------------------------------------------------------
test('parseLsof: maps local port -> app for established and listening sockets', () => {
  const out = [
    'COMMAND   PID  USER   FD   TYPE DEVICE SIZE/OFF NODE NAME',
    'Google    901  me     50u  IPv4 0x1    0t0      TCP  10.0.0.2:55123->142.250.1.1:443 (ESTABLISHED)',
    'node      77   me     12u  IPv6 0x2    0t0      TCP  *:8090 (LISTEN)',
    'Spotify   55   me     30u  IPv4 0x3    0t0      UDP  10.0.0.2:51999->35.1.2.3:443',
  ].join('\n');
  const m = parseLsof(out);
  assert.strictEqual(m.get('55123'), 'Google');
  assert.strictEqual(m.get('8090'), 'node');
  assert.strictEqual(m.get('51999'), 'Spotify');
});

test('parseSs: maps local port -> app from ss -tunp output', () => {
  const out = [
    'tcp   ESTAB 0 0 10.0.0.2:55123 1.2.3.4:443  users:(("chrome",pid=123,fd=50))',
    'udp   ESTAB 0 0 10.0.0.2:51999 8.8.8.8:53   users:(("systemd-resolve",pid=9,fd=12))',
    'tcp   LISTEN 0 128 0.0.0.0:8090 0.0.0.0:*',
  ].join('\n');
  const m = parseSs(out);
  assert.strictEqual(m.get('55123'), 'chrome');
  assert.strictEqual(m.get('51999'), 'systemd-resolve');
  assert.strictEqual(m.has('8090'), false); // no users:() = no attribution
});

test('extractSNI: works on a hex-reassembled ClientHello', () => {
  const ch = buildClientHello('signalro.com', 14); // 14 = fake ethernet header
  // emit as tcpdump-style hex lines
  const lines = [];
  for (let i = 0; i < ch.length; i += 16) {
    const row = ch.subarray(i, i + 16).toString('hex').replace(/(..)(?=.)/g, '$1');
    lines.push(`\t0x${i.toString(16).padStart(4, '0')}:  ${ch.subarray(i, i + 16).toString('hex')}`);
  }
  assert.strictEqual(extractSNI(hexLinesToBuffer(lines)), 'signalro.com');
});

// ---------------------------------------------------------------------------
// splitHostPort
// ---------------------------------------------------------------------------
test('splitHostPort: IPv4 with port (4 dots)', () => {
  assert.deepStrictEqual(splitHostPort('192.168.1.5.52344', false),
    { host: '192.168.1.5', port: 52344 });
});

test('splitHostPort: bare IPv4 (3 dots)', () => {
  assert.deepStrictEqual(splitHostPort('192.168.1.1', false),
    { host: '192.168.1.1', port: null });
});

test('splitHostPort: IPv6 with port (dot after last colon)', () => {
  assert.deepStrictEqual(splitHostPort('ff02::fb.5353', true),
    { host: 'ff02::fb', port: 5353 });
});

test('splitHostPort: bare IPv6 (no dot after last colon)', () => {
  assert.deepStrictEqual(splitHostPort('fe80::1', true),
    { host: 'fe80::1', port: null });
});

test('splitHostPort: full-length IPv6 with port', () => {
  assert.deepStrictEqual(splitHostPort('2001:db8:0:1:1:1:1:1.443', true),
    { host: '2001:db8:0:1:1:1:1:1', port: 443 });
});

test('splitHostPort: token with no dot at all', () => {
  assert.deepStrictEqual(splitHostPort('arp', false), { host: 'arp', port: null });
});

// ---------------------------------------------------------------------------
// classify
// ---------------------------------------------------------------------------
test('classify: tcp 443 -> https (either side)', () => {
  assert.strictEqual(classify('tcp', 50000, 443), 'https');
  assert.strictEqual(classify('tcp', 443, 50000), 'https');
});

test('classify: tcp 80 -> http, 22 -> ssh, 53 -> dns', () => {
  assert.strictEqual(classify('tcp', 50000, 80), 'http');
  assert.strictEqual(classify('tcp', 22, 50000), 'ssh');
  assert.strictEqual(classify('tcp', 50000, 53), 'dns');
});

test('classify: other tcp ports -> tcp', () => {
  assert.strictEqual(classify('tcp', 50000, 8080), 'tcp');
});

test('classify: udp 443 -> quic', () => {
  assert.strictEqual(classify('udp', 50000, 443), 'quic');
});

test('classify: udp 53 and 5353 -> dns', () => {
  assert.strictEqual(classify('udp', 53, 50000), 'dns');
  assert.strictEqual(classify('udp', 50000, 5353), 'dns');
});

test('classify: other udp ports -> udp', () => {
  assert.strictEqual(classify('udp', 50000, 12345), 'udp');
});

test('classify: icmp passes through', () => {
  assert.strictEqual(classify('icmp', null, null), 'icmp');
});

// ---------------------------------------------------------------------------
// parseLine
// ---------------------------------------------------------------------------
test('parseLine: IPv4 tcp with length', () => {
  const pkt = parseLine('IP 8.8.8.8.443 > 192.168.1.5.52344: tcp 1448');
  assert.strictEqual(pkt.proto, 'https');
  assert.strictEqual(pkt.len, 1448);
  assert.strictEqual(pkt.src, '8.8.8.8');
  assert.strictEqual(pkt.dst, '192.168.1.5');
  assert.strictEqual(pkt.sport, 443);
  assert.strictEqual(pkt.dport, 52344);
  assert.strictEqual(pkt.dir, 'in'); // 8.8.8.8 is not a local address
});

test('parseLine: IPv4 UDP with "length N" form', () => {
  const pkt = parseLine('IP 8.8.8.8.53 > 192.168.1.5.55321: UDP, length 120');
  assert.strictEqual(pkt.proto, 'dns');
  assert.strictEqual(pkt.len, 120);
});

test('parseLine: ICMP without ports', () => {
  const pkt = parseLine('IP 192.168.1.1 > 192.168.1.5: ICMP echo reply, length 64');
  assert.strictEqual(pkt.proto, 'icmp');
  assert.strictEqual(pkt.sport, null);
  assert.strictEqual(pkt.dport, null);
  assert.strictEqual(pkt.len, 64);
});

test('parseLine: IPv6 mDNS', () => {
  const pkt = parseLine('IP6 fe80::1.5353 > ff02::fb.5353: UDP, length 100');
  assert.strictEqual(pkt.proto, 'dns');
  assert.strictEqual(pkt.src, 'fe80::1');
  assert.strictEqual(pkt.dst, 'ff02::fb');
  assert.strictEqual(pkt.sport, 5353);
  assert.strictEqual(pkt.dport, 5353);
});

test('parseLine: IPv6 without ports', () => {
  const pkt = parseLine('IP6 fe80::1 > ff02::1: ICMP6, neighbor solicitation, length 32');
  assert.strictEqual(pkt.src, 'fe80::1');
  assert.strictEqual(pkt.dst, 'ff02::1');
  assert.strictEqual(pkt.sport, null);
});

test('parseLine: ARP line maps to other', () => {
  const pkt = parseLine('ARP, Request who-has 192.168.1.1 tell 192.168.1.5, length 28');
  assert.strictEqual(pkt.proto, 'other');
  assert.strictEqual(pkt.len, 60);
});

test('parseLine: malformed lines return null', () => {
  assert.strictEqual(parseLine(''), null);
  assert.strictEqual(parseLine('garbage line'), null);
  assert.strictEqual(parseLine('tcpdump: listening on en0'), null);
});

test('parseLine: missing length falls back to 60', () => {
  const pkt = parseLine('IP 1.2.3.4.443 > 5.6.7.8.50000: tcp');
  assert.strictEqual(pkt.len, 60);
});

// ---------------------------------------------------------------------------
// tagFlow / sweepFlows
// ---------------------------------------------------------------------------
test('tagFlow: both directions of a connection share one flow id', () => {
  flows.clear();
  const a = tagFlow({ proto: 'https', src: '1.2.3.4', dst: '5.6.7.8', sport: 443, dport: 50000 });
  const b = tagFlow({ proto: 'https', src: '5.6.7.8', dst: '1.2.3.4', sport: 50000, dport: 443 });
  assert.strictEqual(a.flow, b.flow);
});

test('tagFlow: different connections get different flow ids', () => {
  flows.clear();
  const a = tagFlow({ proto: 'https', src: '1.2.3.4', dst: '5.6.7.8', sport: 443, dport: 50000 });
  const b = tagFlow({ proto: 'https', src: '1.2.3.4', dst: '5.6.7.8', sport: 443, dport: 50001 });
  assert.notStrictEqual(a.flow, b.flow);
});

test('sweepFlows: evicts idle flows, keeps fresh ones', () => {
  flows.clear();
  const t0 = 1_000_000;
  tagFlow({ proto: 'tcp', src: 'a', dst: 'b', sport: 1, dport: 2 }, t0);
  tagFlow({ proto: 'tcp', src: 'c', dst: 'd', sport: 3, dport: 4 }, t0 + 25_000);
  sweepFlows(t0 + 35_000); // first is 35s idle (>30s), second only 10s
  assert.strictEqual(flows.size, 1);
});

// ---------------------------------------------------------------------------
// default-route interface detection
// ---------------------------------------------------------------------------
test('parseRouteGetOutput: macOS route -n get default', () => {
  const out = '   route to: default\ndestination: default\n        mask: default\n     gateway: 192.168.1.1\n   interface: en0\n       flags: <UP,GATEWAY,DONE,STATIC,PRCLONING,GLOBAL>\n';
  assert.strictEqual(parseRouteGetOutput(out), 'en0');
  assert.strictEqual(parseRouteGetOutput('no route to host'), null);
});

test('parseIpRouteOutput: Linux ip route show default', () => {
  assert.strictEqual(
    parseIpRouteOutput('default via 192.168.1.1 dev eth0 proto dhcp src 192.168.1.5 metric 100\n'),
    'eth0');
  assert.strictEqual(
    parseIpRouteOutput('default via 10.0.0.1 dev wlp3s0 proto dhcp metric 600\n'),
    'wlp3s0');
  assert.strictEqual(parseIpRouteOutput(''), null);
});

test('tagFlow: table is capped and evicts oldest', () => {
  flows.clear();
  for (let i = 0; i < 5000; i++) {
    tagFlow({ proto: 'tcp', src: `h${i}`, dst: 'x', sport: i, dport: 80 }, i);
  }
  assert.ok(flows.size <= 4096, `flow table grew to ${flows.size}`);
});

// ---------------------------------------------------------------------------
// reverse DNS queue
// ---------------------------------------------------------------------------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('rdns: resolves, caches, and dedupes lookups', async () => {
  rdnsCache.clear();
  let calls = 0;
  _setRdnsResolver(async (ip) => { calls++; return [`host-${ip}.example.net`]; });
  requestRdns('203.0.113.7');
  requestRdns('203.0.113.7'); // queued/cached — must not double-resolve
  await sleep(20);
  assert.strictEqual(calls, 1);
  assert.strictEqual(rdnsCache.get('203.0.113.7').name, 'host-203.0.113.7.example.net');
  assert.deepStrictEqual(knownNames(), { '203.0.113.7': 'host-203.0.113.7.example.net' });
  requestRdns('203.0.113.7'); // fresh cache hit — no new lookup
  await sleep(20);
  assert.strictEqual(calls, 1);
});

test('rdns: failed lookups cached as negative entries', async () => {
  rdnsCache.clear();
  let calls = 0;
  _setRdnsResolver(async () => { calls++; throw new Error('NXDOMAIN'); });
  requestRdns('198.51.100.9');
  await sleep(20);
  assert.strictEqual(rdnsCache.get('198.51.100.9').name, null);
  assert.deepStrictEqual(knownNames(), {});
  requestRdns('198.51.100.9');
  await sleep(20);
  assert.strictEqual(calls, 1, 'negative entry was not cached');
});

test('rdns: concurrency is limited to 4 in-flight lookups', async () => {
  rdnsCache.clear();
  let inFlight = 0, maxInFlight = 0;
  _setRdnsResolver(async (ip) => {
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await sleep(30);
    inFlight--;
    return [`h-${ip}.net`];
  });
  for (let i = 0; i < 20; i++) requestRdns(`192.0.2.${i}`);
  assert.ok(_rdnsStats().queued > 0, 'expected a backlog beyond the concurrency cap');
  await sleep(300);
  assert.strictEqual(maxInFlight, 4, `max in-flight was ${maxInFlight}`);
  assert.strictEqual(rdnsCache.size, 20);
});

test('rdns: ignores junk and non-IP tokens', async () => {
  rdnsCache.clear();
  let calls = 0;
  _setRdnsResolver(async () => { calls++; return ['x']; });
  requestRdns('arp');
  requestRdns('');
  requestRdns(null);
  await sleep(20);
  assert.strictEqual(calls, 0);
});
