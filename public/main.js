// PacketRush — 3D packet highway.
// Outbound packets drive away on the left carriageway, inbound packets come
// toward the camera on the right. Vehicle type = protocol, size = packet size.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { PROTO_TO_TYPE, buildVehicleMeshes } from './vehicles.js';
import { FLEETS } from './fleets.js';
import { THEMES, buildThemeEnvironment, disposeGroup } from './themes.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const LANE_W = 3.5;
const LANES = 5;
const MEDIAN_HALF = 0.75;
const LANE_CENTERS = [2.5, 6.0, 9.5, 13.0, 16.5]; // mirrored for outbound (negative x)
const ROAD_HALF_W = 19.5;
const Z_NEAR = 70;    // despawn/spawn near camera
const Z_FAR = -220;   // despawn/spawn far away
const MAX_VEHICLES = 1000;
const MAX_QUEUE = 400;
const SPAWN_PER_FRAME = 10;
const CONVOY_GAP = 9;        // world units between members of one flow
const FLOW_STATE_TTL = 60e3; // forget a flow's lane/speed after idle
const NIGHT = 0x0b1020;

// ---------------------------------------------------------------------------
// Renderer / scene / camera
// ---------------------------------------------------------------------------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(NIGHT);
scene.fog = new THREE.Fog(NIGHT, 90, 280);

const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 600);
camera.position.set(18, 28, 66);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 2, -20);
controls.maxPolarAngle = Math.PI * 0.49;
controls.minDistance = 10;
controls.maxDistance = 220;
controls.enableDamping = true;
controls.dampingFactor = 0.08;

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---------------------------------------------------------------------------
// Environment & lighting: theme-driven (see themes.js). Lights live inside
// the theme group, so switching themes swaps lighting too.
// ---------------------------------------------------------------------------
const THEME_CONSTANTS = { ROAD_HALF_W, Z_NEAR, Z_FAR, MEDIAN_HALF };
let env = null; // { group, animate, theme }
let currentTheme = null;

function applyTheme(key) {
  if (!THEMES[key]) key = 'night';
  if (key === currentTheme) return;
  if (env) {
    scene.remove(env.group);
    disposeGroup(env.group);
  }
  env = buildThemeEnvironment(key, THEME_CONSTANTS);
  scene.add(env.group);
  scene.background = new THREE.Color(env.theme.bg);
  scene.fog = new THREE.Fog(...env.theme.fog);
  applyFleet(env.theme.fleet || 'cars');
  currentTheme = key;
  try { localStorage.setItem('packetrush-theme', key); } catch (_) { /* private mode */ }
  const sel = document.getElementById('theme');
  if (sel && sel.value !== key) sel.value = key;
}

const themeSelect = document.getElementById('theme');
for (const [key, t] of Object.entries(THEMES)) {
  const opt = document.createElement('option');
  opt.value = key;
  opt.textContent = t.label;
  themeSelect.appendChild(opt);
}
themeSelect.addEventListener('change', () => applyTheme(themeSelect.value));

let initialTheme = new URLSearchParams(location.search).get('theme');
if (!initialTheme) {
  try { initialTheme = localStorage.getItem('packetrush-theme'); } catch (_) { /* private mode */ }
}
// applyTheme(initialTheme) runs at the bottom of this module, once the fleet
// and legend systems it touches exist.

// ---------------------------------------------------------------------------
// Vehicles
// ---------------------------------------------------------------------------
// The active fleet (cars, boats, spacecraft, fish…) is chosen by the theme.
// All fleets share the same 9 slot keys, so filters/picking/convoys carry over.
let FLEET = null;
let vehicleMeshes = {};
let currentFleet = null;
const bodyMeshes = [];   // raycast targets, refreshed on fleet swap
const instanceMap = {};  // per-frame instanceId -> vehicle, one array per type

const active = [];      // live vehicle states
const spawnQueue = [];  // packets waiting for a vehicle slot
const dummy = new THREE.Object3D();

function applyFleet(name) {
  if (!FLEETS[name]) name = 'cars';
  if (name === currentFleet) return;
  for (const { body, glow } of Object.values(vehicleMeshes)) {
    scene.remove(body);
    scene.remove(glow);
    body.geometry.dispose();
    glow.geometry.dispose();
    body.material.dispose();
    glow.material.dispose();
  }
  FLEET = FLEETS[name];
  vehicleMeshes = buildVehicleMeshes(FLEET, MAX_VEHICLES);
  bodyMeshes.length = 0;
  for (const [key, { body, glow }] of Object.entries(vehicleMeshes)) {
    scene.add(body);
    scene.add(glow);
    body.userData.typeKey = key;
    // Fixed broad-phase sphere covering the road volume (incl. fliers). The
    // instance matrices change every frame and three never recomputes the
    // cached sphere (it stays empty, radius -1), which silently kills picking.
    body.boundingSphere = new THREE.Sphere(
      new THREE.Vector3(0, 4, (Z_NEAR + Z_FAR) / 2),
      (Z_NEAR - Z_FAR) / 2 + 40
    );
    instanceMap[key] = [];
    bodyMeshes.push(body);
  }
  active.length = 0;
  spawnQueue.length = 0;
  currentFleet = name;
  clearSelection();
  buildLegend();
}

function hashString(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

// Muted protocol families (legend chips). Stats still count muted traffic —
// the HUD reports the wire, filters only shape what's drawn.
const muted = new Set();

function enqueuePacket(pkt) {
  // stats
  if (pkt.dir === 'out') stats.out++; else stats.in++;
  stats.bytes += pkt.len || 60;
  const remote = pkt.dir === 'out' ? pkt.dst : pkt.src;
  if (remote) destBytes.set(remote, (destBytes.get(remote) || 0) + (pkt.len || 60));
  if (muted.has(PROTO_TO_TYPE[pkt.proto] || 'bus')) return;
  if (spawnQueue.length >= MAX_QUEUE) spawnQueue.shift();
  spawnQueue.push(pkt);
}

// Per-flow lane/speed/timing so one connection's packets form a convoy:
// same lane, same speed, spaced CONVOY_GAP apart by delaying spawns.
const flowState = new Map(); // flowId -> { lane, speedFactor, nextFree, lastUsed }

function getFlowState(pkt, def, now) {
  const id = `${pkt.dir}:${pkt.flow}`;
  let st = flowState.get(id);
  if (!st) {
    st = {
      lane: pkt.flow % LANES,
      speedFactor: 0.9 + Math.random() * 0.25,
      nextFree: 0,
    };
    flowState.set(id, st);
  }
  st.lastUsed = now;
  return st;
}

function evictFlowState(now) {
  for (const [id, st] of flowState) {
    if (now - st.lastUsed > FLOW_STATE_TTL) flowState.delete(id);
  }
}

function spawnVehicle(pkt, now) {
  if (active.length >= MAX_VEHICLES) return 'full';
  const typeKey = PROTO_TO_TYPE[pkt.proto] || 'bus';
  const def = FLEET[typeKey];
  const out = pkt.dir === 'out';

  let lane, speedFactor;
  if (pkt.flow != null) {
    const st = getFlowState(pkt, def, now);
    // Convoy spacing: hold this packet until the previous member is a gap ahead
    if (now < st.nextFree) return 'wait';
    st.nextFree = now + (CONVOY_GAP / (def.speed * st.speedFactor)) * 1000;
    lane = st.lane;
    speedFactor = st.speedFactor;
  } else {
    const remote = out ? (pkt.dst || '') : (pkt.src || '');
    lane = hashString(remote) % LANES;
    speedFactor = 0.9 + Math.random() * 0.25;
  }

  const x = (out ? -1 : 1) * LANE_CENTERS[lane] + (Math.random() - 0.5) * 0.7;
  const scale = 0.8 + Math.min((pkt.len || 60) / 1500, 1) * 0.45;
  if (typeKey === 'ambulance') icmpBlip();
  active.push({
    typeKey,
    x,
    y: def.y || 0,
    bobAmp: def.bob || 0,
    bobF: def.bobF || 1.5,
    phase: Math.random() * Math.PI * 2,
    z: out ? Z_NEAR - 5 : Z_FAR + 5,
    dirSign: out ? -1 : 1,
    rotY: out ? Math.PI : 0,
    speed: def.speed * speedFactor,
    scale,
    pkt,
  });
  return 'spawned';
}

function updateVehicles(dt) {
  // Spawn from queue; convoy members not yet due are skipped, not dropped
  const now = performance.now();
  let spawned = 0;
  for (let i = 0; i < spawnQueue.length && spawned < SPAWN_PER_FRAME;) {
    const res = spawnVehicle(spawnQueue[i], now);
    if (res === 'full') break;
    if (res === 'wait') { i++; continue; }
    spawnQueue.splice(i, 1);
    spawned++;
  }

  // Move + cull
  for (let i = active.length - 1; i >= 0; i--) {
    const v = active[i];
    v.z += v.dirSign * v.speed * dt;
    if (v.z < Z_FAR || v.z > Z_NEAR) {
      v.dead = true;
      active[i] = active[active.length - 1];
      active.pop();
    }
  }

  // Write instance matrices grouped by type
  const tSec = performance.now() / 1000;
  const counters = {};
  for (const key of Object.keys(vehicleMeshes)) counters[key] = 0;
  for (const v of active) {
    const idx = counters[v.typeKey]++;
    instanceMap[v.typeKey][idx] = v;
    const { body, glow } = vehicleMeshes[v.typeKey];
    const y = v.y + (v.bobAmp ? Math.sin(tSec * v.bobF + v.phase) * v.bobAmp : 0);
    dummy.position.set(v.x, y, v.z);
    dummy.rotation.set(0, v.rotY, 0);
    dummy.scale.setScalar(v.scale);
    dummy.updateMatrix();
    body.setMatrixAt(idx, dummy.matrix);
    glow.setMatrixAt(idx, dummy.matrix);
  }
  for (const key of Object.keys(vehicleMeshes)) {
    const { body, glow } = vehicleMeshes[key];
    body.count = counters[key];
    glow.count = counters[key];
    body.instanceMatrix.needsUpdate = true;
    glow.instanceMatrix.needsUpdate = true;
  }
}

// ---------------------------------------------------------------------------
// Picking: click a vehicle to inspect its packet
// ---------------------------------------------------------------------------
const raycaster = new THREE.Raycaster();
const pickNdc = new THREE.Vector2();
const elTooltip = document.getElementById('tooltip');

const selRing = new THREE.Mesh(
  new THREE.RingGeometry(2.2, 2.8, 32),
  new THREE.MeshBasicMaterial({
    color: 0x7dd3fc, transparent: true, opacity: 0.85,
    side: THREE.DoubleSide, depthWrite: false,
  })
);
selRing.rotation.x = -Math.PI / 2;
selRing.visible = false;
scene.add(selRing);

let selected = null;

// ip -> hostname, fed by server rDNS ({type:'names'} messages)
const hostNames = new Map();

function fmtEndpoint(host, port) {
  if (!host) return '?';
  const name = hostNames.get(host) || host;
  return port ? `${name}:${port}` : name;
}

function showTooltip(v) {
  const def = FLEET[v.typeKey];
  const p = v.pkt || {};
  const arrow = p.dir === 'out' ? '▲ outbound' : '▼ inbound';
  elTooltip.innerHTML =
    `<span class="proto" style="color:#${def.color.toString(16).padStart(6, '0')}">${def.proto}</span>` +
    ` <span class="dim">· ${def.label} · ${arrow}</span><br>` +
    `${fmtEndpoint(p.src, p.sport)} <span class="dim">→</span> ${fmtEndpoint(p.dst, p.dport)}<br>` +
    `<span class="dim">size</span> ${Math.round(p.len || 0)} bytes`;
  elTooltip.style.display = 'block';
}

function clearSelection() {
  selected = null;
  selRing.visible = false;
  elTooltip.style.display = 'none';
}

function pickAt(clientX, clientY) {
  pickNdc.set(
    (clientX / window.innerWidth) * 2 - 1,
    -(clientY / window.innerHeight) * 2 + 1
  );
  raycaster.setFromCamera(pickNdc, camera);
  const hits = raycaster.intersectObjects(bodyMeshes, false);
  for (const hit of hits) {
    if (hit.instanceId === undefined) continue;
    const v = instanceMap[hit.object.userData.typeKey][hit.instanceId];
    if (v && !v.dead) {
      selected = v;
      selRing.visible = true;
      showTooltip(v);
      return;
    }
  }
  clearSelection();
}

// Debug/test hook (used by automated browser checks)
window.__pr = {
  pickAt, raycaster, bodyMeshes, instanceMap, active, camera, hostNames,
  applyTheme, THEMES, getTheme: () => currentTheme,
  FLEETS, getFleet: () => currentFleet, getFleetTypes: () => FLEET,
};
// (geo members appended after their declarations below)

// Distinguish clicks from orbit drags
let downX = 0, downY = 0;
renderer.domElement.addEventListener('pointerdown', (e) => {
  downX = e.clientX;
  downY = e.clientY;
});
renderer.domElement.addEventListener('pointerup', (e) => {
  if (Math.hypot(e.clientX - downX, e.clientY - downY) < 6) {
    pickAt(e.clientX, e.clientY);
  }
});

const projVec = new THREE.Vector3();

function updateSelection() {
  if (!selected) return;
  if (selected.dead) return clearSelection();
  selRing.position.set(selected.x, 0.06, selected.z);
  const pulse = 1 + Math.sin(performance.now() / 180) * 0.08;
  selRing.scale.setScalar(selected.scale * pulse);
  // Anchor tooltip above the vehicle
  projVec.set(selected.x, 3.2 * selected.scale, selected.z).project(camera);
  if (projVec.z > 1) return; // behind camera
  const sx = (projVec.x * 0.5 + 0.5) * window.innerWidth;
  const sy = (-projVec.y * 0.5 + 0.5) * window.innerHeight;
  elTooltip.style.left = `${Math.round(sx + 14)}px`;
  elTooltip.style.top = `${Math.round(sy - 14)}px`;
}

// ---------------------------------------------------------------------------
// GeoIP exit signs: bundled offline prefix table (public/geoip.json) maps
// remote IPs to org/country; the top destinations get roadside signs.
// ---------------------------------------------------------------------------
const destBytes = new Map(); // remote ip -> decayed byte counter
const geoCache = new Map();
let geoTable = null;

fetch('geoip.json')
  .then((r) => r.json())
  .then((d) => {
    geoTable = {
      v4: d.v4
        .map(({ cidr, org, cc }) => {
          const [ip, bitsStr] = cidr.split('/');
          const bits = Number(bitsStr);
          const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
          return { base: (ipToInt(ip) & mask) >>> 0, mask, bits, org, cc };
        })
        .sort((a, b) => b.bits - a.bits), // longest prefix first
      v6: d.v6prefixes,
    };
  })
  .catch(() => { /* signs stay blank without the table */ });

function ipToInt(ip) {
  const p = ip.split('.');
  return (((+p[0] << 24) | (+p[1] << 16) | (+p[2] << 8) | +p[3])) >>> 0;
}

function geoLookup(ip) {
  if (!geoTable || !ip) return null;
  if (geoCache.has(ip)) return geoCache.get(ip);
  let res = null;
  if (ip.includes(':')) {
    res = geoTable.v6.find((e) => ip.startsWith(e.prefix)) || null;
  } else if (/^\d+\.\d+\.\d+\.\d+$/.test(ip)) {
    const n = ipToInt(ip);
    res = geoTable.v4.find((e) => ((n & e.mask) >>> 0) === e.base) || null;
  }
  geoCache.set(ip, res);
  return res;
}

const LOCAL_ORGS = new Set(['LAN', 'loopback', 'link-local', 'multicast', 'Carrier NAT']);

function makeExitSign(z) {
  const group = new THREE.Group();
  const poleMat = new THREE.MeshLambertMaterial({ color: 0x2a3450 });
  for (const px of [-4.6, 4.6]) {
    const pole = new THREE.Mesh(new THREE.BoxGeometry(0.32, 9.2, 0.32), poleMat);
    pole.position.set(px, 4.6, 0);
    group.add(pole);
  }
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 224;
  const tex = new THREE.CanvasTexture(canvas);
  const board = new THREE.Mesh(
    new THREE.PlaneGeometry(11.5, 5.0),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true })
  );
  board.position.set(0, 9.0, 0.2);
  group.add(board);
  group.position.set(ROAD_HALF_W + 7.5, 0, z);
  group.rotation.y = -0.22; // angled toward the road
  group.visible = false;
  scene.add(group);
  return { ctx: canvas.getContext('2d'), tex, group };
}

const exitSigns = [makeExitSign(-30), makeExitSign(-85), makeExitSign(-140)];
Object.assign(window.__pr, { geoLookup, destBytes, exitSigns });

function drawExitSign(sign, title, sub, rate) {
  const { ctx, tex } = sign;
  const W = 512, H = 224;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#0b5c38';
  ctx.beginPath();
  ctx.roundRect(0, 0, W, H, 18);
  ctx.fill();
  ctx.strokeStyle = '#e8eef9';
  ctx.lineWidth = 7;
  ctx.beginPath();
  ctx.roundRect(8, 8, W - 16, H - 16, 12);
  ctx.stroke();
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 44px ui-monospace, Menlo, monospace';
  let t = title;
  while (t.length > 1 && ctx.measureText(t).width > W - 60) t = t.slice(0, -1);
  if (t !== title) t += '…';
  ctx.fillText(t, 30, 78);
  ctx.font = '36px ui-monospace, Menlo, monospace';
  ctx.fillStyle = '#bfe8d2';
  ctx.fillText(sub, 30, 134);
  ctx.fillStyle = '#ffd98a';
  ctx.fillText(rate, 30, 188);
  tex.needsUpdate = true;
}

function updateExitSigns() {
  const ranked = [...destBytes.entries()]
    .filter(([ip]) => {
      const g = geoLookup(ip);
      return !(g && LOCAL_ORGS.has(g.org));
    })
    .sort((a, b) => b[1] - a[1])
    .slice(0, exitSigns.length);
  exitSigns.forEach((sign, i) => {
    const entry = ranked[i];
    // bytes are decayed by ~0.93 per 500ms tick → ~0.86/s steady-state factor
    if (!entry || entry[1] < 400) {
      sign.group.visible = false;
      return;
    }
    const [ip, bytes] = entry;
    const g = geoLookup(ip);
    const name = hostNames.get(ip) || ip;
    const sub = g ? `${g.org}${g.cc ? ' · ' + g.cc : ''}` : 'unknown network';
    drawExitSign(sign, name, sub, `${(bytes / 1024).toFixed(1)} KB recent`);
    sign.group.visible = true;
  });
}

// ---------------------------------------------------------------------------
// Demo traffic generator
// ---------------------------------------------------------------------------
const DEMO_WEIGHTS = [
  ['https', 0.30], ['quic', 0.13], ['tcp', 0.15], ['dns', 0.13],
  ['http', 0.06], ['udp', 0.12], ['ssh', 0.04], ['icmp', 0.03], ['other', 0.04],
];
const DEMO_SIZES = {
  https: [200, 1500], quic: [100, 1400], tcp: [60, 1500], dns: [50, 220],
  http: [200, 1500], udp: [60, 900], ssh: [60, 400], icmp: [64, 64], other: [60, 600],
};
const DEMO_HOSTS = ['142.250.74.1', '104.16.32.7', '151.101.1.69', '13.107.42.14',
  '185.199.108.1', '17.253.144.10', '52.84.151.9', '140.82.114.4'];
const DEMO_PORTS = { https: 443, quic: 443, http: 80, dns: 53, ssh: 22 };
// Plausible rDNS names for the demo hosts (real mode gets these from the server)
const DEMO_NAMES = {
  '142.250.74.1': 'fra16s48-in-f1.1e100.net',
  '104.16.32.7': 'cloudflare.com',
  '151.101.1.69': 'cdn.fastly.net',
  '13.107.42.14': 'l-0004.l-msedge.net',
  '185.199.108.1': 'cdn.github.io',
  '17.253.144.10': 'aads1-cdts.aaplimg.com',
  '52.84.151.9': 'server-52-84-151-9.fra56.r.cloudfront.net',
  '140.82.114.4': 'lb-140-82-114-4-iad.github.com',
};
for (const [ip, name] of Object.entries(DEMO_NAMES)) {
  if (!hostNames.has(ip)) hostNames.set(ip, name);
}

function demoPorts(proto, dir) {
  const service = DEMO_PORTS[proto] || (proto === 'icmp' ? null : 1024 + Math.floor(Math.random() * 64000));
  if (service === null) return { sport: null, dport: null };
  const ephemeral = 49152 + Math.floor(Math.random() * 16000);
  return dir === 'out' ? { sport: ephemeral, dport: service } : { sport: service, dport: ephemeral };
}

function pickWeighted() {
  let r = Math.random();
  for (const [proto, w] of DEMO_WEIGHTS) {
    if ((r -= w) <= 0) return proto;
  }
  return 'tcp';
}

let demoBurst = 0;
let demoBurstProto = 'https';
let demoBurstDir = 'in';
let demoBurstFlow = 0;
let nextDemoFlow = 1_000_000; // demo flow ids, distinct from server-assigned ones

// ?pps=N overrides the demo chatter rate (useful for stress testing)
const DEMO_PPS = Number(new URLSearchParams(location.search).get('pps')) || 14;

function generateDemoTraffic(dt) {
  // Background chatter plus occasional bursts (downloads)
  let n = Math.random() < Math.min(DEMO_PPS * dt, 1) ? Math.max(1, Math.round(DEMO_PPS * dt)) : 0;
  if (demoBurst <= 0 && Math.random() < 0.25 * dt) {
    demoBurst = 8 + Math.floor(Math.random() * 22);
    demoBurstProto = Math.random() < 0.7 ? 'https' : 'quic';
    demoBurstDir = Math.random() < 0.75 ? 'in' : 'out';
    demoBurstFlow = nextDemoFlow++;
  }
  if (demoBurst > 0 && Math.random() < 28 * dt) {
    demoBurst--;
    const [lo, hi] = DEMO_SIZES[demoBurstProto];
    enqueuePacket({
      proto: demoBurstProto, dir: demoBurstDir,
      len: lo + Math.random() * (hi - lo),
      src: DEMO_HOSTS[hashString(demoBurstProto + demoBurstFlow) % DEMO_HOSTS.length],
      dst: '192.168.1.10',
      flow: demoBurstFlow,
      ...demoPorts(demoBurstProto, demoBurstDir),
    });
  }
  for (let i = 0; i < n; i++) {
    const proto = pickWeighted();
    const [lo, hi] = DEMO_SIZES[proto];
    const dir = Math.random() < 0.58 ? 'in' : 'out';
    const host = DEMO_HOSTS[Math.floor(Math.random() * DEMO_HOSTS.length)];
    enqueuePacket({
      proto, dir, len: lo + Math.random() * (hi - lo),
      src: dir === 'in' ? host : '192.168.1.10',
      dst: dir === 'in' ? '192.168.1.10' : host,
      flow: hashString(host + proto) % 100000,
      ...demoPorts(proto, dir),
    });
  }
}

// ---------------------------------------------------------------------------
// WebSocket client
// ---------------------------------------------------------------------------
const params = new URLSearchParams(location.search);
// On a static HTTPS host (e.g. a published demo) there's no capture server, so
// start in demo mode immediately — the highway is lively on load. If a real
// backend is present it switches us to LIVE on connect. Plain http:// (local
// dev) keeps the original behaviour: try the WebSocket first.
const hostedDemo = location.protocol === 'https:' && !params.has('live');
const state = {
  capture: 'connecting',  // connecting | live | unavailable
  demo: params.has('demo') || hostedDemo,
  demoForced: params.has('demo'),
  hosted: hostedDemo,
  paused: false,
};

function connect() {
  // Match the page protocol so an HTTPS host uses wss:// (a ws:// socket from an
  // https page is blocked as mixed content and throws).
  const scheme = location.protocol === 'https:' ? 'wss://' : 'ws://';
  let ws;
  try {
    ws = new WebSocket(`${scheme}${location.host}`);
  } catch (_) {
    if (!state.demoForced) state.demo = true;
    updateStatusUI({});
    setTimeout(connect, 15000);
    return;
  }
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.type === 'status') {
      state.capture = msg.capture;
      if (msg.capture === 'live' && !state.demoForced) state.demo = false;
      if (msg.capture === 'unavailable' && !state.demoForced) state.demo = true;
      updateStatusUI(msg);
    } else if (msg.type === 'names') {
      for (const [ip, name] of Object.entries(msg.names)) hostNames.set(ip, name);
    } else if (msg.type === 'packets' && !state.demo && !state.paused) {
      for (const pkt of msg.packets) enqueuePacket(pkt);
    }
  };
  ws.onclose = () => {
    if (state.capture !== 'unavailable') {
      state.capture = 'connecting';
      if (!state.demoForced) state.demo = true;
      updateStatusUI({});
    }
    // Back off hard on a hosted demo (no server will ever appear); retry
    // briskly during local dev so live capture connects fast.
    setTimeout(connect, state.hosted ? 15000 : 2500);
  };
  ws.onerror = () => ws.close();
}
connect();

// ---------------------------------------------------------------------------
// HUD
// ---------------------------------------------------------------------------
const stats = { in: 0, out: 0, bytes: 0 };
const elStatus = document.getElementById('status');
const elPpsIn = document.getElementById('pps-in');
const elPpsOut = document.getElementById('pps-out');
const elBps = document.getElementById('bps');
const elVehicles = document.getElementById('vehicles');

function updateStatusUI(msg) {
  const label = elStatus.querySelector('.label');
  const hint = elStatus.querySelector('.hint');
  if (state.demo) {
    elStatus.className = 'demo';
    label.textContent = 'DEMO — simulated traffic';
    hint.textContent = state.capture === 'unavailable'
      ? 'live capture needs privileges: `sudo npm start`, or once: `sudo scripts/grant-bpf.sh`'
      : state.hosted
        ? 'live, simulated demo · run PacketRush locally to watch your real traffic'
        : (state.capture === 'connecting' ? 'server not reachable — reconnecting…' : 'demo forced on');
  } else if (state.capture === 'live') {
    elStatus.className = 'live';
    label.textContent = `LIVE — capturing on ${msg.iface || 'en0'}`;
    hint.textContent = '';
  } else {
    elStatus.className = 'demo';
    label.textContent = 'CONNECTING…';
    hint.textContent = '';
  }
}

let signTick = 0;

// Rolling 60s history (120 samples at 500ms) drawn as a sparkline
const SPARK_SAMPLES = 120;
const sparkHistory = []; // { pps, kbs }
const sparkCanvas = document.getElementById('spark');
const sparkCtx = sparkCanvas.getContext('2d');

function drawSparkline() {
  const W = sparkCanvas.width;
  const H = sparkCanvas.height;
  sparkCtx.clearRect(0, 0, W, H);
  if (sparkHistory.length < 2) return;
  const step = W / (SPARK_SAMPLES - 1);
  const x0 = W - (sparkHistory.length - 1) * step; // right-aligned, grows leftward

  const series = [
    { key: 'pps', color: '#7dd3fc', fill: 'rgba(125, 211, 252, 0.12)' },
    { key: 'kbs', color: '#fbbf24', fill: null },
  ];
  for (const { key, color, fill } of series) {
    const max = Math.max(1, ...sparkHistory.map((s) => s[key]));
    sparkCtx.beginPath();
    sparkHistory.forEach((s, i) => {
      const x = x0 + i * step;
      const y = H - 2 - (s[key] / max) * (H - 6);
      i === 0 ? sparkCtx.moveTo(x, y) : sparkCtx.lineTo(x, y);
    });
    if (fill) {
      sparkCtx.save();
      sparkCtx.lineTo(x0 + (sparkHistory.length - 1) * step, H);
      sparkCtx.lineTo(x0, H);
      sparkCtx.closePath();
      sparkCtx.fillStyle = fill;
      sparkCtx.fill();
      sparkCtx.restore();
      sparkCtx.beginPath();
      sparkHistory.forEach((s, i) => {
        const x = x0 + i * step;
        const y = H - 2 - (s[key] / max) * (H - 6);
        i === 0 ? sparkCtx.moveTo(x, y) : sparkCtx.lineTo(x, y);
      });
    }
    sparkCtx.strokeStyle = color;
    sparkCtx.lineWidth = 2;
    sparkCtx.stroke();
  }
}

setInterval(() => {
  const pps = (stats.in + stats.out) * 2;
  const kbs = (stats.bytes * 2) / 1024;
  elPpsOut.textContent = `${stats.out * 2} pkt/s`;
  elPpsIn.textContent = `${stats.in * 2} pkt/s`;
  elBps.textContent = `${kbs.toFixed(1)} KB/s`;
  elVehicles.textContent = String(active.length);
  stats.in = 0;
  stats.out = 0;
  stats.bytes = 0;
  sparkHistory.push({ pps, kbs });
  if (sparkHistory.length > SPARK_SAMPLES) sparkHistory.shift();
  drawSparkline();
  evictFlowState(performance.now());
  // decay destination counters; refresh exit signs every 2s
  for (const [ip, bytes] of destBytes) {
    const next = bytes * 0.93;
    if (next < 50) destBytes.delete(ip);
    else destBytes.set(ip, next);
  }
  if (++signTick % 4 === 0) updateExitSigns();
  setAudioIntensity(pps);
}, 500);

// Legend — chips are clickable filters: click mutes/unmutes a protocol
// family, alt-click solos it (mutes everything else). Rebuilt per fleet.
const legend = document.getElementById('legend');
const chipEls = {};

function buildLegend() {
  legend.innerHTML = '';
  for (const [key, def] of Object.entries(FLEET)) {
    const chip = document.createElement('div');
    chip.className = 'chip';
    chip.title = `click: hide ${def.proto} · alt-click: show only ${def.proto}`;
    const sw = document.createElement('span');
    sw.className = 'swatch';
    sw.style.background = `#${def.color.toString(16).padStart(6, '0')}`;
    const label = document.createElement('span');
    label.textContent = def.proto;
    const veh = document.createElement('span');
    veh.className = 'vehicle';
    veh.textContent = `· ${def.label}`;
    chip.append(sw, label, veh);
    chip.addEventListener('click', (e) => toggleMute(key, e.altKey));
    chip.classList.toggle('muted', muted.has(key));
    legend.appendChild(chip);
    chipEls[key] = chip;
  }
}

function applyMutes() {
  for (const [key, el] of Object.entries(chipEls)) {
    el.classList.toggle('muted', muted.has(key));
  }
  // Despawn road vehicles and queued packets of muted families
  for (let i = active.length - 1; i >= 0; i--) {
    if (muted.has(active[i].typeKey)) {
      active[i].dead = true;
      active[i] = active[active.length - 1];
      active.pop();
    }
  }
  for (let i = spawnQueue.length - 1; i >= 0; i--) {
    const pkt = spawnQueue[i];
    if (muted.has(PROTO_TO_TYPE[pkt.proto] || 'bus')) spawnQueue.splice(i, 1);
  }
}

function toggleMute(key, solo) {
  if (solo) {
    const others = Object.keys(FLEET).filter((k) => k !== key);
    const isSolo = !muted.has(key) && others.every((k) => muted.has(k));
    muted.clear();
    if (!isSolo) others.forEach((k) => muted.add(k)); // solo again -> unmute all
  } else if (muted.has(key)) {
    muted.delete(key);
  } else {
    muted.add(key);
  }
  applyMutes();
}

// Controls
const btnPause = document.getElementById('btn-pause');
btnPause.addEventListener('click', () => {
  state.paused = !state.paused;
  btnPause.textContent = state.paused ? '▶ resume' : '⏸ pause';
  btnPause.classList.toggle('active', state.paused);
});
const btnDemo = document.getElementById('btn-demo');
btnDemo.addEventListener('click', () => {
  state.demoForced = !state.demo;
  state.demo = !state.demo;
  updateStatusUI({});
  btnDemo.classList.toggle('active', state.demo);
});

// ---------------------------------------------------------------------------
// Ambient audio: procedural engine bed (brown noise + low drones) whose level
// follows packet rate, plus a two-tone blip when an ambulance (ICMP) spawns.
// Off by default; built lazily on the first toggle (autoplay rules).
// ---------------------------------------------------------------------------
const audio = { ctx: null, master: null, humGain: null, lowpass: null, enabled: false, lastBlip: 0 };

function initAudio() {
  if (audio.ctx) return;
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const master = ctx.createGain();
  master.gain.value = 0;
  master.connect(ctx.destination);

  // brown-noise road bed
  const buf = ctx.createBuffer(1, 2 * ctx.sampleRate, ctx.sampleRate);
  const data = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < data.length; i++) {
    last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
    data[i] = last * 3.5;
  }
  const noise = ctx.createBufferSource();
  noise.buffer = buf;
  noise.loop = true;
  const lowpass = ctx.createBiquadFilter();
  lowpass.type = 'lowpass';
  lowpass.frequency.value = 180;
  const humGain = ctx.createGain();
  humGain.gain.value = 0;
  noise.connect(lowpass);
  lowpass.connect(humGain);
  humGain.connect(master);
  noise.start();

  // low engine drones
  for (const [freq, level] of [[55, 0.05], [82.5, 0.03]]) {
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.value = level;
    osc.connect(g);
    g.connect(humGain);
    osc.start();
  }

  audio.ctx = ctx;
  audio.master = master;
  audio.humGain = humGain;
  audio.lowpass = lowpass;
}

function setAudioIntensity(pps) {
  if (!audio.enabled || !audio.ctx) return;
  const t = audio.ctx.currentTime;
  const level = Math.min(pps / 400, 1); // ~400 pkt/s = full roar
  audio.humGain.gain.linearRampToValueAtTime(0.10 + 0.6 * level, t + 0.45);
  audio.lowpass.frequency.linearRampToValueAtTime(160 + 640 * level, t + 0.45);
}

function icmpBlip() {
  if (!audio.enabled || !audio.ctx) return;
  const t = audio.ctx.currentTime;
  if (audio.ctx.currentTime - audio.lastBlip < 1.5) return;
  audio.lastBlip = audio.ctx.currentTime;
  for (let i = 0; i < 2; i++) {
    const osc = audio.ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.value = i % 2 ? 660 : 880;
    const g = audio.ctx.createGain();
    g.gain.setValueAtTime(0, t + i * 0.16);
    g.gain.linearRampToValueAtTime(0.07, t + i * 0.16 + 0.02);
    g.gain.linearRampToValueAtTime(0, t + i * 0.16 + 0.14);
    osc.connect(g);
    g.connect(audio.master);
    osc.start(t + i * 0.16);
    osc.stop(t + i * 0.16 + 0.16);
  }
}

const btnSound = document.getElementById('btn-sound');
btnSound.addEventListener('click', () => {
  initAudio();
  audio.enabled = !audio.enabled;
  if (audio.enabled && audio.ctx.state === 'suspended') audio.ctx.resume();
  const t = audio.ctx.currentTime;
  audio.master.gain.linearRampToValueAtTime(audio.enabled ? 0.5 : 0, t + 0.3);
  if (!audio.enabled) audio.humGain.gain.linearRampToValueAtTime(0, t + 0.3);
  btnSound.textContent = audio.enabled ? '🔊 sound' : '🔇 sound';
  btnSound.classList.toggle('active', audio.enabled);
});
Object.assign(window.__pr, { audio });

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------
applyTheme(initialTheme || 'night'); // builds environment, fleet, and legend

const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  if (!state.paused) {
    if (state.demo) generateDemoTraffic(dt);
    updateVehicles(dt);
  }
  if (env && env.animate) env.animate(dt); // ambient theme motion (rain, snow…)
  updateSelection();
  controls.update();
  renderer.render(scene, camera);
}
animate();
updateStatusUI({});
btnDemo.classList.toggle('active', state.demo);
