// Unit tests for the tcpdump line parser and flow table.
// Run with: npm test

const { test } = require('node:test');
const assert = require('node:assert');
const {
  parseLine, classify, splitHostPort, tagFlow, sweepFlows, flows,
  parseRouteGetOutput, parseIpRouteOutput,
  requestRdns, rdnsCache, knownNames, _setRdnsResolver, _rdnsStats,
} = require('../server.js');

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
