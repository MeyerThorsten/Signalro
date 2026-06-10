// Signalro — 3D packet highway.
// Outbound packets drive away on the left carriageway, inbound packets come
// toward the camera on the right. Vehicle type = protocol, size = packet size.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { PROTO_TO_TYPE, buildVehicleMeshes } from './vehicles.js';
import { FLEETS } from './fleets.js';
import { THEMES, THEME_GROUPS, buildThemeEnvironment, disposeGroup } from './themes.js';
import { createGlobe, CC_LATLNG } from './globe.js';

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
  if (typeof globe !== 'undefined' && globe) globe.resize();
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
  try { localStorage.setItem('signalro-theme', key); } catch (_) { /* private mode */ }
  const sel = document.getElementById('theme');
  if (sel && sel.value !== key) sel.value = key;
}

const themeSelect = document.getElementById('theme');
const groupedKeys = new Set();
for (const grp of THEME_GROUPS) {
  const og = document.createElement('optgroup');
  og.label = grp.label;
  for (const key of grp.keys) {
    if (!THEMES[key]) continue;
    groupedKeys.add(key);
    const opt = document.createElement('option');
    opt.value = key;
    opt.textContent = THEMES[key].label;
    og.appendChild(opt);
  }
  themeSelect.appendChild(og);
}
// Any theme not placed in a group (safety net) goes under "More".
const ungrouped = Object.keys(THEMES).filter((k) => !groupedKeys.has(k));
if (ungrouped.length) {
  const og = document.createElement('optgroup');
  og.label = 'More';
  for (const key of ungrouped) {
    const opt = document.createElement('option');
    opt.value = key; opt.textContent = THEMES[key].label;
    og.appendChild(opt);
  }
  themeSelect.appendChild(og);
}
themeSelect.addEventListener('change', () => applyTheme(themeSelect.value));

let initialTheme = new URLSearchParams(location.search).get('theme');
if (!initialTheme) {
  try { initialTheme = localStorage.getItem('signalro-theme'); } catch (_) { /* private mode */ }
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

// ---------------------------------------------------------------------------
// Customization (persisted in localStorage): custom port→protocol rules,
// protocol→vehicle slot remap, colour-blind palette, reduced motion.
// ---------------------------------------------------------------------------
const LS = { rules: 'signalro-rules', slots: 'signalro-slots', cb: 'signalro-cb', motion: 'signalro-motion' };
function lsGet(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (_) { return d; } }
function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) { /* private mode */ } }

let customRules = lsGet(LS.rules, []);       // [{ port, proto }]
const protoOverride = lsGet(LS.slots, {});   // proto family -> vehicle slot key
let cbPalette = lsGet(LS.cb, false);
let reduceMotion = lsGet(LS.motion, false) || (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);

function slotFor(proto) { return protoOverride[proto] || PROTO_TO_TYPE[proto] || 'bus'; }
function applyCustomRules(pkt) {
  for (const r of customRules) {
    if (pkt.sport === r.port || pkt.dport === r.port) { pkt.proto = r.proto; return; }
  }
}
// Okabe–Ito colour-blind-safe palette for the protocol slot identity colours.
const CB_SLOT = { truck: '#009E73', sports: '#D55E00', van: '#56B4E9', car: '#0072B2', moto: '#F0E442', buggy: '#E69F00', suv: '#9aa0a6', ambulance: '#eaeaea', bus: '#CC79A7' };
function slotColor(slot) {
  if (cbPalette && CB_SLOT[slot]) return CB_SLOT[slot];
  const c = FLEET && FLEET[slot] && FLEET[slot].color;
  return c != null ? `#${c.toString(16).padStart(6, '0')}` : '#8899aa';
}

function enqueuePacket(pkt) {
  applyCustomRules(pkt);
  // stats
  if (pkt.dir === 'out') stats.out++; else stats.in++;
  stats.bytes += pkt.len || 60;
  const remote = pkt.dir === 'out' ? pkt.dst : pkt.src;
  if (remote) destBytes.set(remote, (destBytes.get(remote) || 0) + (pkt.len || 60));
  enrichPacket(pkt, remote); // risk, blocklist flag, flow/host/app aggregation
  if (muted.has(slotFor(pkt.proto))) return;
  if (spawnQueue.length >= MAX_QUEUE) spawnQueue.shift();
  spawnQueue.push(pkt);
}

// ---------------------------------------------------------------------------
// Time scrubber: a rolling buffer of recent packets that can be replayed. All
// ingestion (live + demo) flows through ingest(): it records to the buffer and,
// unless we're replaying, spawns the packet live.
// ---------------------------------------------------------------------------
const REPLAY_WINDOW = 120e3; // keep ~2 minutes
const replayBuffer = [];     // { t, pkt }
const replay = { active: false, playing: false, cursor: 0, idx: 0, frames: null };

function ingest(pkt) {
  const t = Date.now();
  replayBuffer.push({ t, pkt });
  while (replayBuffer.length && t - replayBuffer[0].t > REPLAY_WINDOW) replayBuffer.shift();
  if (!replay.active) enqueuePacket(pkt);
}

function enterReplay(t) {
  replay.frames = replayBuffer.slice();       // snapshot so live recording can't shift it
  replay.active = true; replay.playing = true; replay.cursor = t;
  replay.idx = replay.frames.findIndex((e) => e.t > t);
  if (replay.idx < 0) replay.idx = replay.frames.length;
  active.length = 0; spawnQueue.length = 0; clearHighlight(); clearSelection();
}
function seekReplay(t) {
  if (!replay.active) return enterReplay(t);
  replay.cursor = t;
  replay.idx = replay.frames.findIndex((e) => e.t > t);
  if (replay.idx < 0) replay.idx = replay.frames.length;
  active.length = 0; spawnQueue.length = 0;
}
function exitReplay() {
  replay.active = false; replay.playing = false; replay.frames = null;
  active.length = 0; spawnQueue.length = 0;
}
function replayTick(dtSec) {
  if (!replay.active || !replay.playing) return;
  const frames = replay.frames;
  const end = frames.length ? frames[frames.length - 1].t : replay.cursor;
  replay.cursor = Math.min(replay.cursor + dtSec * 1000, end);
  while (replay.idx < frames.length && frames[replay.idx].t <= replay.cursor) {
    enqueuePacket({ ...frames[replay.idx].pkt });
    replay.idx++;
  }
  if (replay.cursor >= end) replay.playing = false; // caught up to the snapshot end
}

// ---------------------------------------------------------------------------
// Insights: per-packet risk classification, offline blocklist matching, and
// live flow / host / app aggregation. Powers the top-talkers panel, the
// connections table, search, and the security counts — all client-side, so it
// works identically for live capture and the simulated demo.
// ---------------------------------------------------------------------------
const nowMs = () => performance.now();

// Plaintext (unencrypted) and risky service ports → a human label.
const PLAINTEXT_PORTS = { 80: 'HTTP', 21: 'FTP', 20: 'FTP', 23: 'Telnet', 25: 'SMTP', 110: 'POP3', 143: 'IMAP', 161: 'SNMP', 389: 'LDAP', 1883: 'MQTT' };
const RISKY_PORTS = { 23: 'Telnet', 135: 'RPC', 139: 'NetBIOS', 445: 'SMB', 3389: 'RDP', 5900: 'VNC', 3306: 'MySQL', 5432: 'Postgres', 6379: 'Redis', 27017: 'MongoDB', 11211: 'Memcached' };

function classifyRisk(pkt) {
  for (const port of [pkt.sport, pkt.dport]) {
    if (RISKY_PORTS[port]) return { level: 'risky', label: RISKY_PORTS[port] };
  }
  for (const port of [pkt.sport, pkt.dport]) {
    if (PLAINTEXT_PORTS[port]) return { level: 'plaintext', label: PLAINTEXT_PORTS[port] };
  }
  return null;
}

// Offline blocklist (public/blocklist.json): CIDR ranges + domain suffixes.
let blocklist = null;
fetch('blocklist.json')
  .then((r) => r.json())
  .then((d) => {
    blocklist = {
      lists: d.lists,
      v4: d.v4.map(({ cidr, list }) => {
        const [ip, b] = cidr.split('/');
        const bits = Number(b);
        const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
        return { base: (ipToInt(ip) & mask) >>> 0, mask, list };
      }),
      domains: d.domains,
    };
  })
  .catch(() => { /* highlighting just stays off without the list */ });

function matchBlock(ip, name) {
  if (!blocklist) return null;
  if (name) {
    for (const e of blocklist.domains) {
      if (name === e.suffix || name.endsWith('.' + e.suffix)) return e.list;
    }
  }
  if (ip && /^\d+\.\d+\.\d+\.\d+$/.test(ip)) {
    const n = ipToInt(ip);
    for (const e of blocklist.v4) if (((n & e.mask) >>> 0) === e.base) return e.list;
  }
  return null;
}

const flowStats = new Map(); // flowId -> aggregate
const hostStats = new Map(); // remote ip -> aggregate
const appStats = new Map();  // app name -> aggregate
const recentFlows = [];      // {t, src, dst, dport} for newly-seen flows (~3s window)

function enrichPacket(pkt, remote) {
  pkt.risk = classifyRisk(pkt);
  const name = remote ? hostNames.get(remote) : null;
  pkt.flag = matchBlock(remote, name);
  const bytes = pkt.len || 60;
  const t = nowMs();

  if (pkt.flow != null) {
    let f = flowStats.get(pkt.flow);
    if (!f) {
      f = { id: pkt.flow, proto: pkt.proto, remote, sport: pkt.sport, dport: pkt.dport,
            bytesIn: 0, bytesOut: 0, packets: 0, first: t, last: t, app: null, risk: null, flag: null };
      flowStats.set(pkt.flow, f);
      recentFlows.push({ t, src: pkt.src, dst: pkt.dst, dport: pkt.dport });
    }
    f.proto = pkt.proto; f.remote = remote; f.last = t; f.packets++;
    if (pkt.dir === 'out') f.bytesOut += bytes; else f.bytesIn += bytes;
    if (pkt.app) f.app = pkt.app;
    if (pkt.risk) f.risk = pkt.risk;
    if (pkt.flag) f.flag = pkt.flag;
    pkt.app = pkt.app || f.app; // later packets of a flow inherit the app
  }
  if (remote) {
    let h = hostStats.get(remote);
    if (!h) { h = { ip: remote, bytes: 0, packets: 0, app: null, proto: pkt.proto, last: t, flag: null }; hostStats.set(remote, h); }
    h.bytes += bytes; h.packets++; h.last = t; h.proto = pkt.proto;
    if (pkt.app) h.app = pkt.app;
    if (pkt.flag) h.flag = pkt.flag;
  }
  if (pkt.app) {
    let a = appStats.get(pkt.app);
    if (!a) { a = { app: pkt.app, bytes: 0, packets: 0, last: t }; appStats.set(pkt.app, a); }
    a.bytes += bytes; a.packets++; a.last = t;
  }
}

function pruneStats(t) {
  for (const [k, f] of flowStats) if (t - f.last > 60e3) flowStats.delete(k);
  for (const [k, h] of hostStats) if (t - h.last > 60e3) hostStats.delete(k);
  for (const [k, a] of appStats) if (t - a.last > 60e3) appStats.delete(k);
}

function securityCounts() {
  let plaintext = 0, risky = 0, flagged = 0;
  for (const f of flowStats.values()) {
    if (f.risk?.level === 'plaintext') plaintext++;
    else if (f.risk?.level === 'risky') risky++;
    if (f.flag) flagged++;
  }
  return { plaintext, risky, flagged };
}

// Highlight: a predicate over a vehicle's packet. When active, non-matching
// vehicles are dimmed via per-instance colour (see updateVehicles).
const highlight = { active: false, test: () => true, label: '' };
function setHighlight(testFn, label) {
  highlight.active = true; highlight.test = testFn; highlight.label = label || '';
  if (typeof onHighlightChange === 'function') onHighlightChange();
}
function clearHighlight() {
  highlight.active = false; highlight.label = '';
  if (typeof onHighlightChange === 'function') onHighlightChange();
}
let onHighlightChange = null;

// Once highlight is used we keep per-instance colours maintained every frame
// (white when inactive) so freshly-spawned instances never render un-coloured.
let colorsActive = false;
const tmpColor = new THREE.Color();

// Persistent threat beacons: a small spinning marker over any vehicle whose
// packet is plaintext/risky or matches the blocklist.
const beaconDummy = new THREE.Object3D();
const beaconMesh = new THREE.InstancedMesh(
  new THREE.OctahedronGeometry(0.55),
  new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.95, fog: false }),
  MAX_VEHICLES
);
beaconMesh.frustumCulled = false;
beaconMesh.count = 0;
scene.add(beaconMesh);
let showBeacons = true; // toggled with the security HUD row

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
  const typeKey = slotFor(pkt.proto);
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
  const hi = highlight.active;
  if (hi) colorsActive = true;
  const counters = {};
  for (const key of Object.keys(vehicleMeshes)) counters[key] = 0;
  let bIdx = 0;
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
    if (colorsActive) {
      const on = !hi || highlight.test(v.pkt || {});
      tmpColor.setScalar(on ? 1 : 0.1);
      body.setColorAt(idx, tmpColor);
      glow.setColorAt(idx, tmpColor);
    }
    const pk = v.pkt;
    if (showBeacons && pk && (pk.flag || pk.risk)) {
      const col = pk.flag ? (blocklist?.lists?.[pk.flag]?.color || '#ef4444')
        : (pk.risk.level === 'risky' ? '#ff3b3b' : '#fbbf24');
      beaconDummy.position.set(v.x, y + 2.8 * v.scale + (reduceMotion ? 0 : Math.sin(tSec * 4 + v.phase) * 0.18), v.z);
      beaconDummy.rotation.set(0.5, reduceMotion ? 0.6 : tSec * 2.2, 0);
      beaconDummy.scale.setScalar(0.6 * v.scale);
      beaconDummy.updateMatrix();
      beaconMesh.setMatrixAt(bIdx, beaconDummy.matrix);
      beaconMesh.setColorAt(bIdx, tmpColor.set(col));
      bIdx++;
    }
  }
  beaconMesh.count = bIdx;
  beaconMesh.instanceMatrix.needsUpdate = true;
  if (beaconMesh.instanceColor) beaconMesh.instanceColor.needsUpdate = true;
  for (const key of Object.keys(vehicleMeshes)) {
    const { body, glow } = vehicleMeshes[key];
    body.count = counters[key];
    glow.count = counters[key];
    body.instanceMatrix.needsUpdate = true;
    glow.instanceMatrix.needsUpdate = true;
    if (colorsActive) {
      if (body.instanceColor) body.instanceColor.needsUpdate = true;
      if (glow.instanceColor) glow.instanceColor.needsUpdate = true;
    }
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

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function fmtEndpoint(host, port) {
  if (!host) return '?';
  const name = hostNames.get(host) || host;
  return `${escapeHtml(name)}${port ? ':' + port : ''}`;
}

function showTooltip(v) {
  const def = FLEET[v.typeKey];
  const p = v.pkt || {};
  const arrow = p.dir === 'out' ? '▲ outbound' : '▼ inbound';
  let html =
    `<span class="proto" style="color:#${def.color.toString(16).padStart(6, '0')}">${def.proto}</span>` +
    ` <span class="dim">· ${def.label} · ${arrow}</span><br>` +
    `${fmtEndpoint(p.src, p.sport)} <span class="dim">→</span> ${fmtEndpoint(p.dst, p.dport)}<br>` +
    `<span class="dim">size</span> ${Math.round(p.len || 0)} bytes`;
  if (p.app) html += `<br><span class="dim">app</span> ${escapeHtml(p.app)}`;
  if (p.risk) html += `<br><span class="tbadge ${p.risk.level}">⚠ ${p.risk.level} · ${escapeHtml(p.risk.label)}</span>`;
  if (p.flag) {
    const meta = blocklist?.lists?.[p.flag];
    html += `<br><span class="tbadge flag" style="--bc:${meta?.color || '#ef4444'}">⚑ ${escapeHtml(meta?.label || p.flag)}</span>`;
  }
  elTooltip.innerHTML = html;
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
  flowStats, hostStats, appStats, securityCounts, setHighlight, clearHighlight, highlight,
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
  const pulse = reduceMotion ? 1 : 1 + Math.sin(performance.now() / 180) * 0.08;
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
  '34.117.59.81': 'stats.g.doubleclick.net',  // tracker (blocklist)
  '171.25.193.77': 'tor-exit-de.relayon.org', // Tor exit range (blocklist)
  '45.66.33.12': null,                          // flagged by IP range (malware)
};
for (const [ip, name] of Object.entries(DEMO_NAMES)) {
  if (name && !hostNames.has(ip)) hostNames.set(ip, name);
}

// Plausible owning apps for demo flows, so process attribution shows in the
// hosted demo. Deterministic per (host,proto) so a flow keeps one app.
const DEMO_APPS = ['Google Chrome', 'Safari', 'Spotify', 'Slack', 'Dropbox', 'Mail', 'Music', 'zoom.us', 'Signalro', 'curl'];
function demoApp(proto, host) {
  if (proto === 'dns') return 'mDNSResponder';
  if (proto === 'ssh') return 'ssh';
  return DEMO_APPS[hashString((host || '') + proto) % DEMO_APPS.length];
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
    const burstHost = DEMO_HOSTS[hashString(demoBurstProto + demoBurstFlow) % DEMO_HOSTS.length];
    ingest({
      proto: demoBurstProto, dir: demoBurstDir,
      len: lo + Math.random() * (hi - lo),
      src: demoBurstDir === 'in' ? burstHost : '192.168.1.10',
      dst: demoBurstDir === 'in' ? '192.168.1.10' : burstHost,
      flow: demoBurstFlow,
      app: demoApp(demoBurstProto, burstHost),
      ...demoPorts(demoBurstProto, demoBurstDir),
    });
  }
  for (let i = 0; i < n; i++) {
    const proto = pickWeighted();
    const [lo, hi] = DEMO_SIZES[proto];
    const dir = Math.random() < 0.58 ? 'in' : 'out';
    const host = DEMO_HOSTS[Math.floor(Math.random() * DEMO_HOSTS.length)];
    ingest({
      proto, dir, len: lo + Math.random() * (hi - lo),
      src: dir === 'in' ? host : '192.168.1.10',
      dst: dir === 'in' ? '192.168.1.10' : host,
      flow: hashString(host + proto) % 100000,
      app: demoApp(proto, host),
      ...demoPorts(proto, dir),
    });
  }
  // Occasional "interesting" traffic so security/blocklist features show in demo
  if (Math.random() < 0.5 * dt) {
    const roll = Math.random();
    if (roll < 0.45) { // risky service port (+ malware IP range)
      const [port, app] = [[3389, 'mstsc'], [445, 'smbd'], [23, 'telnet'], [5900, 'screensharingd']][Math.floor(Math.random() * 4)];
      ingest({ proto: 'tcp', dir: 'out', len: 120 + Math.random() * 400,
        src: '192.168.1.10', dst: '45.66.33.12', flow: nextDemoFlow++,
        sport: 49000 + Math.floor(Math.random() * 9000), dport: port, app });
    } else if (roll < 0.8) { // ad/tracker beacon
      const host = '34.117.59.81';
      ingest({ proto: 'https', dir: 'out', len: 200 + Math.random() * 300,
        src: '192.168.1.10', dst: host, flow: hashString(host) % 100000,
        app: 'Google Chrome', ...demoPorts('https', 'out') });
    } else { // Tor relay
      const host = '171.25.193.77';
      ingest({ proto: 'tcp', dir: 'out', len: 300 + Math.random() * 600,
        src: '192.168.1.10', dst: host, flow: hashString(host) % 100000,
        app: 'tor', sport: 49000 + Math.floor(Math.random() * 9000), dport: 9001 });
    }
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
  const tok = params.get('token');
  let ws;
  try {
    ws = new WebSocket(`${scheme}${location.host}/${tok ? '?token=' + encodeURIComponent(tok) : ''}`);
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
      for (const pkt of msg.packets) ingest(pkt);
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
        ? 'live, simulated demo · run Signalro locally to watch your real traffic'
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
  pruneStats(performance.now());
  if (typeof detectAnomalies === 'function') detectAnomalies(pps);
  if (typeof updateInsightsUI === 'function') updateInsightsUI();
  if (typeof drawTimeline === 'function') { drawTimeline(); updateTlButtons(); }
  if (globeMode) updateGlobeArcs();
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
    sw.style.background = slotColor(key);
    const label = document.createElement('span');
    label.textContent = def.proto;
    chip.tabIndex = 0;
    chip.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleMute(key, e.altKey); } });
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
    if (muted.has(slotFor(pkt.proto))) spawnQueue.splice(i, 1);
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
// Insights UI: top-talkers panel, security summary, search, connections table,
// and CSV/PCAP export. All driven from the client-side flow/host/app stats.
// ---------------------------------------------------------------------------
const elTalkers = document.getElementById('talkers');
const elSecGrid = document.getElementById('sec-grid');
const searchInput = document.getElementById('search-input');
const searchBox = document.getElementById('search');
let talkMode = 'host';
let talkSel = null;     // `${kind}:${key}` currently highlighted
let secFilter = null;   // 'plaintext' | 'risky' | 'flagged'

function fmtBytes(b) {
  if (b >= 1e6) return (b / 1e6).toFixed(1) + ' MB';
  if (b >= 1e3) return (b / 1e3).toFixed(1) + ' KB';
  return Math.round(b) + ' B';
}

document.querySelectorAll('#talk-seg button').forEach((btn) => {
  btn.addEventListener('click', () => {
    talkMode = btn.dataset.mode;
    document.querySelectorAll('#talk-seg button').forEach((b) => b.classList.toggle('on', b === btn));
    renderTalkers();
  });
});

function topTalkers() {
  if (talkMode === 'app') {
    return [...appStats.values()].sort((a, b) => b.bytes - a.bytes).slice(0, 7)
      .map((a) => ({ kind: 'app', key: a.app, label: a.app, bytes: a.bytes, color: '#7dd3fc' }));
  }
  if (talkMode === 'org') {
    const orgs = new Map();
    for (const h of hostStats.values()) {
      const g = geoLookup(h.ip);
      const org = g ? g.org : 'unknown network';
      if (LOCAL_ORGS.has(org)) continue;
      const e = orgs.get(org) || { kind: 'org', key: org, label: org, bytes: 0, color: '#a8e6ff' };
      e.bytes += h.bytes; orgs.set(org, e);
    }
    return [...orgs.values()].sort((a, b) => b.bytes - a.bytes).slice(0, 7);
  }
  return [...hostStats.values()].sort((a, b) => b.bytes - a.bytes).slice(0, 7).map((h) => ({
    kind: 'host', key: h.ip, label: hostNames.get(h.ip) || h.ip, bytes: h.bytes,
    color: h.flag ? (blocklist?.lists?.[h.flag]?.color || '#ef4444') : '#7dd3fc',
  }));
}

let talkerKeys = '';
function renderTalkers() {
  const rows = topTalkers();
  if (!rows.length) { elTalkers.innerHTML = '<div class="empty">no traffic yet…</div>'; talkerKeys = ''; return; }
  const max = Math.max(...rows.map((r) => r.bytes), 1);
  const keys = rows.map((r) => r.kind + ':' + r.key).join('|');
  // Update in place when the ranking set is unchanged so rows aren't detached
  // mid-interaction (only rebuild when the top set or its order changes).
  if (keys === talkerKeys && elTalkers.children.length === rows.length) {
    rows.forEach((r, i) => {
      const row = elTalkers.children[i];
      row.querySelector('.by').textContent = fmtBytes(r.bytes);
      const bar = row.querySelector('.bar');
      bar.style.width = Math.round(r.bytes / max * 100) + '%'; bar.style.background = r.color;
      row.querySelector('.sw').style.background = r.color;
      row.classList.toggle('sel', talkSel === r.kind + ':' + r.key);
    });
    return;
  }
  talkerKeys = keys;
  elTalkers.innerHTML = rows.map((r) => `
    <div class="trow" data-kind="${r.kind}" data-key="${escapeHtml(r.key)}">
      <span class="sw" style="background:${r.color}"></span>
      <div style="flex:1;min-width:0">
        <div style="display:flex;gap:6px"><span class="nm">${escapeHtml(r.label)}</span><span class="by">${fmtBytes(r.bytes)}</span></div>
        <div class="bar" style="width:${Math.round(r.bytes / max * 100)}%;background:${r.color}"></div>
      </div></div>`).join('');
  elTalkers.querySelectorAll('.trow').forEach((row) => {
    if (talkSel === row.dataset.kind + ':' + row.dataset.key) row.classList.add('sel');
    row.addEventListener('click', () => highlightTalker(row.dataset.kind, row.dataset.key));
  });
}

function highlightTalker(kind, key) {
  if (talkSel === kind + ':' + key) { talkSel = null; clearHighlight(); renderTalkers(); return; }
  talkSel = kind + ':' + key;
  let test;
  if (kind === 'app') test = (p) => p.app === key;
  else if (kind === 'host') test = (p) => p.dst === key || p.src === key;
  else test = (p) => { const r = p.dir === 'out' ? p.dst : p.src; const g = geoLookup(r); return !!(g && g.org === key); };
  setHighlight(test, 'talker');
  renderTalkers();
}

elSecGrid.querySelectorAll('.sec-cell').forEach((cell) => {
  cell.addEventListener('click', () => toggleSec(cell.dataset.sec));
});
function toggleSec(kind) {
  const cells = elSecGrid.querySelectorAll('.sec-cell');
  if (secFilter === kind) { secFilter = null; cells.forEach((c) => c.classList.remove('on')); clearHighlight(); return; }
  secFilter = kind;
  cells.forEach((c) => c.classList.toggle('on', c.dataset.sec === kind));
  let test;
  if (kind === 'plaintext') test = (p) => p.risk?.level === 'plaintext';
  else if (kind === 'risky') test = (p) => p.risk?.level === 'risky';
  else test = (p) => !!p.flag;
  setHighlight(test, 'security');
}

// search
function applySearch() {
  const q = searchInput.value.trim().toLowerCase();
  searchBox.classList.toggle('has', q.length > 0);
  if (!q) { if (highlight.label === 'search') clearHighlight(); return; }
  setHighlight((p) => {
    if (!p) return false;
    const name = (p.dir === 'out' ? hostNames.get(p.dst) : hostNames.get(p.src)) || '';
    return `${p.src} ${p.dst} ${p.sport} ${p.dport} ${p.proto} ${p.app || ''} ${name}`.toLowerCase().includes(q);
  }, 'search');
}
searchInput.addEventListener('input', applySearch);
document.getElementById('search-clear').addEventListener('click', () => { searchInput.value = ''; applySearch(); searchInput.focus(); });

// keep panel selection visuals in sync if highlight is cleared elsewhere
onHighlightChange = () => {
  if (!highlight.active) {
    talkSel = null; secFilter = null;
    elSecGrid.querySelectorAll('.sec-cell.on').forEach((c) => c.classList.remove('on'));
    elTalkers.querySelectorAll('.trow.sel').forEach((r) => r.classList.remove('sel'));
    if (searchBox.classList.contains('has') && highlight.label !== 'search') { /* keep search box text */ }
  }
};

// connections overlay
const connOverlay = document.getElementById('conn-overlay');
const connTable = document.getElementById('conn-table');
let connOpen = false;
let connSort = { key: 'bytes', dir: -1 };
const CONN_COLS = [
  { key: 'proto', label: 'Proto' }, { key: 'host', label: 'Host / IP' }, { key: 'app', label: 'App' },
  { key: 'dport', label: 'Port' }, { key: 'bytes', label: 'Bytes' }, { key: 'packets', label: 'Pkts' },
  { key: 'dur', label: 'Age' }, { key: 'flag', label: 'Flag' },
];
document.getElementById('open-conn').addEventListener('click', () => { connOpen = true; connOverlay.classList.add('open'); renderConn(); });
document.getElementById('conn-close').addEventListener('click', closeConn);
connOverlay.addEventListener('click', (e) => { if (e.target === connOverlay) closeConn(); });
window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && connOpen) closeConn(); });
function closeConn() { connOpen = false; connOverlay.classList.remove('open'); }

function connRows() {
  const t = nowMs();
  return [...flowStats.values()].map((f) => ({
    f, proto: f.proto, host: hostNames.get(f.remote) || f.remote || '?', app: f.app || '',
    dport: f.dport || f.sport || 0, bytes: f.bytesIn + f.bytesOut, packets: f.packets,
    dur: (t - f.first) / 1000, flag: f.flag || '', risk: f.risk,
  }));
}
function renderConn() {
  if (!connOpen) return;
  const rows = connRows();
  const { key, dir } = connSort;
  rows.sort((a, b) => { const x = a[key], y = b[key]; return (typeof x === 'number' ? x - y : String(x).localeCompare(String(y))) * dir; });
  let html = '<thead><tr>' + CONN_COLS.map((c) => `<th data-k="${c.key}">${c.label}${connSort.key === c.key ? (dir < 0 ? ' ▾' : ' ▴') : ''}</th>`).join('') + '</tr></thead><tbody>';
  html += rows.slice(0, 200).map((r) => {
    const col = slotColor(slotFor(r.proto));
    const flag = r.flag ? `<span style="color:${blocklist?.lists?.[r.flag]?.color || '#ef4444'}">⚑ ${escapeHtml(blocklist?.lists?.[r.flag]?.label || r.flag)}</span>`
      : (r.risk ? `<span style="color:${r.risk.level === 'risky' ? '#ff6b6b' : '#fbbf24'}">⚠ ${escapeHtml(r.risk.label)}</span>` : '');
    return `<tr class="body" data-fid="${r.f.id}"><td><span class="pdot" style="background:${col}"></span>${escapeHtml(r.proto.toUpperCase())}</td>
      <td class="nm">${escapeHtml(r.host)}</td><td>${escapeHtml(r.app)}</td><td>${r.dport || ''}</td>
      <td>${fmtBytes(r.bytes)}</td><td>${r.packets}</td><td>${r.dur.toFixed(0)}s</td><td>${flag}</td></tr>`;
  }).join('') + '</tbody>';
  connTable.innerHTML = html;
  document.getElementById('conn-count').textContent = `${rows.length} active flows`;
  connTable.querySelectorAll('th').forEach((th) => th.addEventListener('click', () => {
    const k = th.dataset.k; if (connSort.key === k) connSort.dir *= -1; else connSort = { key: k, dir: -1 }; renderConn();
  }));
  connTable.querySelectorAll('tr.body').forEach((tr) => tr.addEventListener('click', () => {
    setHighlight((p) => p && p.flow === Number(tr.dataset.fid), 'flow'); closeConn();
  }));
}

// export
function csvCell(v) { const s = String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
function downloadBlob(data, name, type) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement('a'); a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
document.getElementById('export-csv').addEventListener('click', () => {
  const t = nowMs();
  const head = ['proto', 'remote_ip', 'host', 'app', 'sport', 'dport', 'bytes_in', 'bytes_out', 'packets', 'age_s', 'risk', 'flag'];
  const lines = [head.join(',')];
  for (const f of flowStats.values()) {
    lines.push([f.proto, f.remote || '', hostNames.get(f.remote) || '', f.app || '', f.sport || '', f.dport || '',
      f.bytesIn, f.bytesOut, f.packets, ((t - f.first) / 1000).toFixed(0), f.risk ? f.risk.level : '', f.flag || ''].map(csvCell).join(','));
  }
  downloadBlob(lines.join('\n'), 'signalro-flows.csv', 'text/csv');
});
document.getElementById('export-pcap').addEventListener('click', () => {
  if (state.hosted || state.demo) {
    alert('PCAP export needs the local capture server.\nRun Signalro locally (sudo npm start) — then this downloads a Wireshark-openable capture.');
    return;
  }
  window.open('/export/signalro.pcap', '_blank');
});

// ---------------------------------------------------------------------------
// Anomaly alerts: traffic spikes and port-scan / sweep fan-out → a dismissible
// banner. Detection is over the client packet stream, so it works in demo too.
// ---------------------------------------------------------------------------
const alertEl = document.createElement('div');
alertEl.id = 'pr-alert';
alertEl.style.cssText = 'position:fixed;top:60px;left:50%;transform:translateX(-50%);z-index:25;display:none;' +
  'align-items:center;gap:9px;padding:8px 14px;font-size:12px;border-radius:9px;cursor:pointer;' +
  'background:rgba(20,12,12,.86);border:1px solid rgba(239,68,68,.5);color:#ffd9d9;backdrop-filter:blur(8px);' +
  'box-shadow:0 8px 30px rgba(0,0,0,.5)';
document.body.appendChild(alertEl);
let lastAlert = { msg: '', at: 0 };
let alertTimer = null;
function raiseAlert(msg, color) {
  const t = nowMs();
  if (msg === lastAlert.msg && t - lastAlert.at < 8000) return; // de-dupe bursts
  lastAlert = { msg, at: t };
  alertEl.innerHTML = `<span style="color:${color};font-size:14px">⚠</span> ${escapeHtml(msg)} <span style="color:var(--dim);margin-left:4px">✕</span>`;
  alertEl.style.display = 'flex';
  clearTimeout(alertTimer);
  alertTimer = setTimeout(() => { alertEl.style.display = 'none'; }, 6000);
}
alertEl.addEventListener('click', () => { alertEl.style.display = 'none'; });

function detectAnomalies(pps) {
  const t = nowMs();
  while (recentFlows.length && t - recentFlows[0].t > 3000) recentFlows.shift();
  const hist = sparkHistory.map((s) => s.pps).slice(-30).sort((a, b) => a - b);
  const med = hist.length ? hist[Math.floor(hist.length / 2)] : 0;
  if (med > 0 && pps > 80 && pps > med * 3.5) {
    raiseAlert(`Traffic spike — ${pps} pkt/s (~${Math.round(pps / Math.max(med, 1))}× baseline)`, '#fbbf24');
  }
  const bySrc = new Map();
  for (const r of recentFlows) {
    const e = bySrc.get(r.src) || { ports: new Set(), hosts: new Set() };
    if (r.dport != null) e.ports.add(r.dport);
    if (r.dst) e.hosts.add(r.dst);
    bySrc.set(r.src, e);
  }
  for (const [src, e] of bySrc) {
    if (e.ports.size >= 15) { raiseAlert(`Possible port scan from ${src} — ${e.ports.size} ports probed`, '#ff6b6b'); break; }
    if (e.hosts.size >= 30) { raiseAlert(`Address sweep from ${src} — ${e.hosts.size} hosts`, '#ff6b6b'); break; }
  }
}
Object.assign(window.__pr, { raiseAlert, _injectScan: () => {
  for (let i = 20; i < 45; i++) ingest({ proto: 'tcp', dir: 'out', len: 60, src: '192.168.1.10', dst: '203.0.113.9', flow: nextDemoFlow++, sport: 50000 + i, dport: i });
} });

// ---------------------------------------------------------------------------
// Settings overlay: accessibility, custom port rules, protocol→vehicle remap.
// ---------------------------------------------------------------------------
const settingsOverlay = document.getElementById('settings-overlay');
const PROTO_KEYS = Object.keys(PROTO_TO_TYPE);
const SLOT_KEYS = [...new Set(Object.values(PROTO_TO_TYPE))];
const ruleProto = document.getElementById('rule-proto');
ruleProto.innerHTML = PROTO_KEYS.map((p) => `<option value="${p}">${p}</option>`).join('');

function openSettings() {
  settingsOverlay.classList.add('open');
  renderRules(); renderSlots();
  document.getElementById('opt-cb').checked = cbPalette;
  document.getElementById('opt-motion').checked = reduceMotion;
}
function closeSettings() { settingsOverlay.classList.remove('open'); }
document.getElementById('btn-settings').addEventListener('click', openSettings);
document.getElementById('settings-close').addEventListener('click', closeSettings);
settingsOverlay.addEventListener('click', (e) => { if (e.target === settingsOverlay) closeSettings(); });

function renderRules() {
  const list = document.getElementById('rules-list');
  if (!customRules.length) { list.innerHTML = '<div class="hint">no custom rules yet</div>'; return; }
  list.innerHTML = customRules.map((r, i) =>
    `<div class="rule-row">port <b>${r.port}</b> <span class="hint">→</span> <b>${escapeHtml(r.proto)}</b><span class="rm" data-i="${i}">remove</span></div>`).join('');
  list.querySelectorAll('.rm').forEach((x) => x.addEventListener('click', () => {
    customRules.splice(Number(x.dataset.i), 1); lsSet(LS.rules, customRules); renderRules();
  }));
}
document.getElementById('rule-add-btn').addEventListener('click', () => {
  const port = parseInt(document.getElementById('rule-port').value, 10);
  if (!port || port < 1 || port > 65535) return;
  customRules = customRules.filter((r) => r.port !== port);
  customRules.push({ port, proto: ruleProto.value });
  lsSet(LS.rules, customRules);
  document.getElementById('rule-port').value = '';
  renderRules();
});

function renderSlots() {
  const grid = document.getElementById('slot-grid');
  grid.innerHTML = PROTO_KEYS.map((p) => {
    const cur = protoOverride[p] || PROTO_TO_TYPE[p];
    return `<div class="slot-row"><span class="pl">${p}</span><select data-p="${p}">` +
      SLOT_KEYS.map((s) => `<option value="${s}" ${s === cur ? 'selected' : ''}>${escapeHtml(FLEET[s]?.label || s)}</option>`).join('') +
      '</select></div>';
  }).join('');
  grid.querySelectorAll('select').forEach((sel) => sel.addEventListener('change', () => {
    const p = sel.dataset.p;
    if (sel.value === PROTO_TO_TYPE[p]) delete protoOverride[p]; else protoOverride[p] = sel.value;
    lsSet(LS.slots, protoOverride);
  }));
}
document.getElementById('slot-reset').addEventListener('click', () => {
  for (const k of Object.keys(protoOverride)) delete protoOverride[k];
  lsSet(LS.slots, protoOverride); renderSlots();
});
document.getElementById('opt-cb').addEventListener('change', (e) => { cbPalette = e.target.checked; lsSet(LS.cb, cbPalette); buildLegend(); });
document.getElementById('opt-motion').addEventListener('change', (e) => { reduceMotion = e.target.checked; lsSet(LS.motion, reduceMotion); });

// Global keyboard shortcuts
window.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') { if (e.key === 'Escape') e.target.blur(); return; }
  if (e.key === '/') { e.preventDefault(); searchInput.focus(); }
  else if (e.key === 'p') { btnPause.click(); }
  else if (e.key === 'd') { btnDemo.click(); }
  else if (e.key === 's') { settingsOverlay.classList.contains('open') ? closeSettings() : openSettings(); }
  else if (e.key === 't') { toggleTimeline(); }
  else if (e.key === 'g') { toggleGlobe(); }
  else if (e.key === 'Escape') {
    if (settingsOverlay.classList.contains('open')) closeSettings();
    else if (connOpen) closeConn();
    else if (highlight.active) clearHighlight();
  }
});

// ---------------------------------------------------------------------------
// Time scrubber UI: a histogram of the rolling buffer with a draggable
// playhead; drag to seek into a replay, play/pause, or return to LIVE.
// ---------------------------------------------------------------------------
const tlPanel = document.getElementById('timeline');
const tlCanvas = document.getElementById('tl-canvas');
const tlCtx = tlCanvas.getContext('2d');
const tlPlay = document.getElementById('tl-play');
const tlLive = document.getElementById('tl-live');
const tlTime = document.getElementById('tl-time');
let tlOpen = false;

function toggleTimeline() {
  tlOpen = !tlOpen;
  tlPanel.classList.toggle('open', tlOpen);
  document.getElementById('btn-timeline').classList.toggle('active', tlOpen);
  if (!tlOpen && replay.active) exitReplay();
  updateTlButtons(); drawTimeline();
}
document.getElementById('btn-timeline').addEventListener('click', toggleTimeline);

function bufEnds(buf) { return buf.length ? [buf[0].t, Math.max(buf[buf.length - 1].t, buf[0].t + 1000)] : [0, 0]; }

tlPlay.addEventListener('click', () => {
  if (!replay.active) { if (replayBuffer.length) enterReplay(replayBuffer[0].t); }
  else {
    const end = replay.frames.length ? replay.frames[replay.frames.length - 1].t : 0;
    if (replay.cursor >= end) enterReplay(replay.frames[0].t); // restart
    else replay.playing = !replay.playing;
  }
  updateTlButtons();
});
tlLive.addEventListener('click', () => { if (replay.active) exitReplay(); updateTlButtons(); });

function updateTlButtons() {
  tlPlay.textContent = (replay.active && replay.playing) ? '⏸' : '⏵';
  tlLive.classList.toggle('on', !replay.active);
  tlPanel.classList.toggle('replaying', replay.active);
}

let tlDragging = false;
function tlSeekFromEvent(e) {
  const rect = tlCanvas.getBoundingClientRect();
  const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
  const buf = replay.active ? replay.frames : replayBuffer;
  if (!buf.length) return;
  const [t0, t1] = bufEnds(buf);
  const t = t0 + x * (t1 - t0);
  if (!replay.active) enterReplay(t); else seekReplay(t);
  replay.playing = false; updateTlButtons();
}
tlCanvas.addEventListener('pointerdown', (e) => { tlDragging = true; tlCanvas.setPointerCapture(e.pointerId); tlSeekFromEvent(e); });
tlCanvas.addEventListener('pointermove', (e) => { if (tlDragging) tlSeekFromEvent(e); });
tlCanvas.addEventListener('pointerup', () => { tlDragging = false; });

function drawTimeline() {
  if (!tlOpen) return;
  const W = tlCanvas.width, H = tlCanvas.height;
  tlCtx.clearRect(0, 0, W, H);
  const buf = replay.active ? replay.frames : replayBuffer;
  if (!buf.length) { tlTime.textContent = replay.active ? '' : 'live'; return; }
  const [t0, t1] = bufEnds(buf);
  const span = t1 - t0;
  const N = 120, buckets = new Float32Array(N);
  for (const e of buf) buckets[Math.min(N - 1, Math.floor((e.t - t0) / span * N))]++;
  const max = Math.max(1, ...buckets);
  const bw = W / N;
  tlCtx.fillStyle = 'rgba(125,211,252,.5)';
  for (let i = 0; i < N; i++) { const h = (buckets[i] / max) * (H - 6); tlCtx.fillRect(i * bw, H - h, bw - 0.5, h); }
  const px = replay.active ? ((replay.cursor - t0) / span) * W : W;
  tlCtx.fillStyle = replay.active ? '#7dd3fc' : '#4ade80';
  tlCtx.fillRect(px - 1, 0, 2, H);
  tlTime.textContent = replay.active ? (t1 - replay.cursor < 500 ? 'now' : `-${Math.round((t1 - replay.cursor) / 1000)}s`) : 'live';
}

// ---------------------------------------------------------------------------
// Globe view: GeoIP traffic arcs. Toggles between Highway and Globe, sharing
// the same live host/flow data.
// ---------------------------------------------------------------------------
let globe = null, globeMode = false;
function toggleGlobe() {
  globeMode = !globeMode;
  if (globeMode && !globe) { globe = createGlobe(renderer); globe.resize(); }
  controls.enabled = !globeMode;
  if (globe) globe.setEnabled(globeMode);
  document.getElementById('btn-globe').classList.toggle('active', globeMode);
  if (globeMode) updateGlobeArcs();
}
document.getElementById('btn-globe').addEventListener('click', toggleGlobe);

function ccColor(cc) {
  let h = 0; for (let i = 0; i < cc.length; i++) h = (h * 31 + cc.charCodeAt(i)) % 360;
  return new THREE.Color(`hsl(${h}, 75%, 62%)`).getHex();
}
function updateGlobeArcs() {
  if (!globe) return;
  const byCC = new Map();
  for (const h of hostStats.values()) {
    const g = geoLookup(h.ip);
    if (!g || !g.cc || !CC_LATLNG[g.cc]) continue;
    const e = byCC.get(g.cc) || { bytes: 0 };
    e.bytes += h.bytes; byCC.set(g.cc, e);
  }
  const countries = [...byCC.entries()].sort((a, b) => b[1].bytes - a[1].bytes).slice(0, 14)
    .map(([cc, e]) => ({ lat: CC_LATLNG[cc][0], lng: CC_LATLNG[cc][1], bytes: e.bytes, color: ccColor(cc) }));
  globe.setArcs(countries);
}

let connTick = 0;
function updateInsightsUI() {
  renderTalkers();
  const s = securityCounts();
  const cells = elSecGrid.children;
  cells[0].querySelector('.n').textContent = s.plaintext;
  cells[1].querySelector('.n').textContent = s.risky;
  cells[2].querySelector('.n').textContent = s.flagged;
  if (connOpen && ++connTick % 3 === 0) renderConn(); // refresh table ~every 1.5s
}

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------
applyTheme(initialTheme || 'night'); // builds environment, fleet, and legend

const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  if (globeMode && globe) { globe.update(dt); renderer.render(globe.scene, globe.camera); return; }
  if (!state.paused) {
    if (state.demo) generateDemoTraffic(dt);
    if (replay.active) replayTick(dt);     // feed replayed packets into the scene
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
