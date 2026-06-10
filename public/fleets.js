// Theme fleets: alternative vehicle sets sharing the car fleet's 9 protocol
// slots (truck=HTTPS, sports=QUIC, van=HTTP, car=TCP, moto=DNS, buggy=UDP,
// suv=SSH, ambulance=ICMP, bus=OTHER), so legend, filters, picking, and
// convoys work unchanged. Box format: [cx, cy, cz, w, h, l, color].
//
// Extra per-type fields: y (hover height), bob (bob amplitude), bobF (bob
// frequency). Movers face +Z like the cars.

import { VEHICLE_TYPES } from './vehicles.js';

const DARK = 0x10141f;
const GLASS = 0x101c33;
const EYE = 0xfff3c4;
const TAIL = 0xff4438;

// Slot identity colors (match the car fleet / legend)
const C = {
  truck: 0x10b981, sports: 0xef4444, van: 0xd7dde9, car: 0x3b82f6,
  moto: 0xfbbf24, buggy: 0xf97316, suv: 0x232c3d, ambulance: 0xf8fafc,
  bus: 0x8b5cf6,
};

// ---------------------------------------------------------------------------
// Part generators
// ---------------------------------------------------------------------------
function legs4(w, l, legH, color, lw = 0.32) {
  const x = w / 2 - lw / 2, z = l / 2 - lw / 2;
  return [
    [-x, legH / 2, z, lw, legH, lw, color], [x, legH / 2, z, lw, legH, lw, color],
    [-x, legH / 2, -z, lw, legH, lw, color], [x, legH / 2, -z, lw, legH, lw, color],
  ];
}

function eyes(y, z, spread = 0.3, color = EYE, s = 0.14) {
  return [[-spread, y, z, s, s, 0.06, color], [spread, y, z, s, s, 0.06, color]];
}

// Quadruped: body + legs + (optional neck) + head + tail. Sizes in lanes.
function animal({ color, dark = 0x3a2e22, bw, bh, bl, legH, neckUp = 0, headW, headH, headL, tailL = 0.7, extra = [] }) {
  const bodyY = legH + bh / 2;
  const headBaseY = legH + bh + neckUp;
  const headY = neckUp > 0 ? headBaseY + headH / 2 - 0.1 : bodyY + bh * 0.25;
  const headZ = bl / 2 + headL / 2 - (neckUp > 0 ? 0.3 : 0);
  const boxes = [
    [0, bodyY, 0, bw, bh, bl, color],
    ...legs4(bw, bl, legH, dark),
    [0, bodyY + bh * 0.1, -bl / 2 - tailL / 2, bw * 0.2, bh * 0.25, tailL, color],
    [0, headY, headZ, headW, headH, headL, color],
    ...extra,
  ];
  if (neckUp > 0) boxes.push([0, legH + bh + neckUp / 2 - 0.1, bl / 2 - 0.3, bw * 0.4, neckUp, bw * 0.45, color]);
  return { boxes, eyeY: headY + headH * 0.18, eyeZ: headZ + headL / 2 + 0.02, eyeSpread: headW * 0.28 };
}

function fish({ color, len, h, w, finH = 0.5, y = 1.4 }) {
  return {
    boxes: [
      [0, y, 0, w, h, len, color],
      [0, y + h * 0.15, len * 0.32, w * 0.8, h * 0.7, len * 0.25, color],
      [0, y + h / 2 + finH / 2, -len * 0.1, 0.1, finH, len * 0.3, color],   // dorsal
      [0, y, -len / 2 - 0.35, 0.1, h * 1.2, 0.7, color],                    // tail fin
      [-w / 2 - 0.25, y, 0.1, 0.5, 0.08, h, color], [w / 2 + 0.25, y, 0.1, 0.5, 0.08, h, color], // side fins
    ],
    eyeY: y + h * 0.2, eyeZ: len * 0.45, eyeSpread: w * 0.42,
  };
}

function hull(color, len, beam, h = 0.9) {
  return [
    [0, h / 2 + 0.15, 0, beam, h, len, color],
    [0, 0.25, len / 2 + 0.4, beam * 0.55, h * 0.6, 0.9, color], // bow
  ];
}

function navLights(y, len) {
  return [
    [-0.4, y, len / 2 + 0.1, 0.2, 0.12, 0.06, 0xff4438],
    [0.4, y, len / 2 + 0.1, 0.2, 0.12, 0.06, 0x39d98a],
    [0, y + 0.15, -len / 2 - 0.05, 0.3, 0.12, 0.06, EYE],
  ];
}

function plane({ color, len, wing, fusH = 0.7, fusW = 0.9, y = 0 }) {
  return [
    [0, y, 0, fusW, fusH, len, color],
    [0, y + fusH * 0.2, len * 0.42, fusW * 0.8, fusH * 0.6, len * 0.16, GLASS], // canopy
    [0, y, 0.2, wing, 0.12, 1.3, color],                       // main wing
    [0, y + 0.45, -len / 2 + 0.4, 0.1, 0.9, 0.8, color],       // tail fin
    [0, y + 0.1, -len / 2 + 0.4, wing * 0.4, 0.1, 0.7, color], // tail plane
  ];
}

function loco(color, len, h, cab = true) {
  const boxes = [
    [0, 0.5, 0, 1.9, 0.5, len, DARK],                  // frame
    [0, 0.9 + h / 2, cab ? 0.4 : 0, 2.0, h, len * (cab ? 0.7 : 0.96), color],
  ];
  if (cab) boxes.push([0, 0.9 + h * 0.75, -len / 2 + 1.1, 2.1, h * 1.1, 1.8, color]);
  for (const z of [len / 2 - 0.7, 0, -len / 2 + 0.7]) {
    boxes.push([-0.85, 0.42, z, 0.25, 0.8, 0.8, DARK], [0.85, 0.42, z, 0.25, 0.8, 0.8, DARK]);
  }
  return boxes;
}

function ship({ color, len, beam, deckH }) {
  return {
    boxes: [...hull(color, len, beam, deckH)],
    eye: navLights(deckH + 0.3, len),
  };
}

function balloon(color, r, basketColor = 0x6e4a2e) {
  return [
    [0, 4.2, 0, r * 1.5, r * 1.7, r * 1.5, color],
    [0, 5.4, 0, r * 1.0, r * 0.7, r * 1.0, color],
    [0, 2.9, 0, r * 0.9, r * 0.7, r * 0.9, color],
    [0, 1.6, 0, 0.08, 1.4, 0.08, 0x3a2e22], // lines
    [0, 0.8, 0, 0.9, 0.7, 0.9, basketColor],
  ];
}

// ---------------------------------------------------------------------------
// Fleets
// ---------------------------------------------------------------------------
function T(label, proto, slot, speed, boxes, glow, opts = {}) {
  return { label, proto, color: C[slot], speed, boxes, glow, ...opts };
}

const BOB = { bob: 0.14, bobF: 1.6 }; // gentle water bob

// ---- Generators for the new themed fleets ----
function wheels4(w, l, r = 0.55, color = DARK) {
  const x = w / 2 - r * 0.3, z = l / 2 - r;
  return [
    [-x, r / 2, z, r * 0.5, r, r, color], [x, r / 2, z, r * 0.5, r, r, color],
    [-x, r / 2, -z, r * 0.5, r, r, color], [x, r / 2, -z, r * 0.5, r, r, color],
  ];
}
// TRON-style light cycle: dark slim body with the slot colour as glowing strips.
function cycle(slot, len, speed, label, proto) {
  const c = C[slot];
  return T(label, proto, slot, speed, [
    [0, 0.5, 0, 0.55, 0.4, len, DARK],
    [0, 0.85, -len * 0.1, 0.46, 0.45, len * 0.34, 0x1a1f2e],
  ], [
    [0, 0.5, len / 2 - 0.2, 0.34, 0.22, 0.1, c],
    [0, 0.5, -len / 2 + 0.2, 0.44, 0.3, 0.12, c],
    [0, 0.16, len * 0.22, 0.5, 0.1, len * 0.3, c],
    [0, 0.16, -len * 0.22, 0.5, 0.1, len * 0.3, c],
    [0, 0.5, -len / 2 - 0.7, 0.3, 0.08, 1.3, c],
  ], { y: 0.18, bob: 0.05, bobF: 2.4 });
}
// Mario-style go-kart: chunky body, big wheels, a driver.
function kart(slot, len, speed, label, proto) {
  const c = C[slot];
  return T(label, proto, slot, speed, [
    [0, 0.5, 0, 1.5, 0.5, len, c],
    ...wheels4(1.8, len + 0.2, 0.6, DARK),
    [0, 1.05, -len * 0.18, 0.6, 0.7, 0.6, 0xf0c9a0],
    [0, 1.5, -len * 0.18, 0.55, 0.35, 0.6, c],
    [0, 0.72, len * 0.4, 1.3, 0.3, 0.3, 0x1a1a1a],
  ], [
    [-0.45, 0.55, len / 2 - 0.05, 0.34, 0.18, 0.06, EYE], [0.45, 0.55, len / 2 - 0.05, 0.34, 0.18, 0.06, EYE],
    [0, 0.6, -len / 2 + 0.05, 0.5, 0.2, 0.06, TAIL],
  ]);
}
// Military unit: slot-coloured hull on dark tracks, optional turret.
function armorUnit(slot, w, len, speed, label, proto, turret) {
  const c = C[slot];
  const boxes = [
    [0, 0.9, 0, w, 0.9, len, c],
    [-(w / 2 - 0.15), 0.4, 0, 0.4, 0.6, len + 0.4, DARK],
    [(w / 2 - 0.15), 0.4, 0, 0.4, 0.6, len + 0.4, DARK],
  ];
  if (turret) {
    boxes.push([0, 1.55, -len * 0.1, w * 0.6, 0.7, len * 0.45, c]);
    boxes.push([0, 1.62, len * 0.32, 0.28, 0.28, len * 0.6, 0x2a2a2a]);
  } else {
    boxes.push([0, 1.5, -len * 0.12, w * 0.7, 0.7, len * 0.42, GLASS]);
  }
  return T(label, proto, slot, speed, boxes, [
    [-w * 0.28, 0.95, len / 2 + 0.05, 0.4, 0.2, 0.06, EYE], [w * 0.28, 0.95, len / 2 + 0.05, 0.4, 0.2, 0.06, EYE],
  ]);
}

// Blocky Minecraft-style minecart with ore in the slot colour.
function minecart(slot, len, speed, label, proto) {
  const c = C[slot];
  return T(label, proto, slot, speed, [
    [0, 0.75, 0, 1.7, 0.9, len, 0x5a4636],
    [0, 1.05, 0, 1.3, 0.6, len * 0.82, c],
    [0, 0.35, len / 2 + 0.1, 1.5, 0.3, 0.3, 0x3a2e22],
    ...wheels4(1.7, len, 0.45, 0x2a2018),
  ], [[0, 0.9, len / 2 + 0.12, 0.5, 0.3, 0.06, EYE], [0, 0.9, -len / 2 - 0.12, 0.5, 0.25, 0.06, TAIL]]);
}
// Roman chariot: basket + two big wheels + a horse.
function chariot(slot, len, speed, label, proto) {
  const c = C[slot];
  return T(label, proto, slot, speed, [
    [0, 0.95, -len * 0.3, 1.5, 0.9, 1.6, c],
    [0, 1.5, -len * 0.3, 1.4, 0.5, 0.2, 0xd9b46a],
    [0, 1.0, len * 0.25, 0.8, 1.1, 1.9, 0x6e4a30],
    [0, 1.7, len * 0.25 + 1.0, 0.5, 0.6, 0.7, 0x5a3a26],
    [-0.9, 0.55, -len * 0.3, 0.18, 1.1, 1.1, 0x3a2a18], [0.9, 0.55, -len * 0.3, 0.18, 1.1, 1.1, 0x3a2a18],
  ], [[0, 1.2, len * 0.25 + 1.35, 0.18, 0.12, 0.06, EYE]]);
}
// Medieval covered wagon pulled by a horse.
function wagon(slot, len, speed, label, proto) {
  const c = C[slot];
  return T(label, proto, slot, speed, [
    [0, 0.9, -len * 0.25, 1.8, 1.0, len * 0.5, 0x6e5436],
    [0, 1.7, -len * 0.25, 1.7, 0.8, len * 0.45, c],
    [0, 1.05, len * 0.35, 0.9, 1.2, 1.8, 0x5a3e26],
    [0, 1.8, len * 0.35 + 1.0, 0.5, 0.6, 0.7, 0x4a3220],
    ...wheels4(1.9, len * 0.5, 0.6, 0x3a2a18),
  ], [[0, 1.05, len / 2 + 0.4, 0.4, 0.3, 0.06, EYE]]);
}
// Wasteland war-rig: armed, rusty, smoke-belching.
function warrig(slot, len, speed, label, proto) {
  const c = C[slot];
  return T(label, proto, slot, speed, [
    [0, 0.85, 0, 2.0, 0.9, len, c],
    [0, 1.45, -len * 0.1, 1.6, 0.6, len * 0.5, 0x4a3a2a],
    [0, 1.0, len / 2 + 0.2, 0.3, 0.3, 1.0, 0x2a2018],
    [0, 2.05, -len * 0.2, 0.22, 1.2, 0.22, 0x1a1410],
    ...wheels4(2.2, len, 0.78, 0x1a1410),
  ], [
    [-0.5, 0.9, len / 2 + 0.6, 0.3, 0.18, 0.06, EYE], [0.5, 0.9, len / 2 + 0.6, 0.3, 0.18, 0.06, EYE],
    [0, 2.15, -len * 0.2, 0.26, 0.22, 0.26, 0xff5a2a],
  ]);
}
// Six-wheel space rover with a solar panel and antenna.
function rover(slot, len, speed, label, proto) {
  const c = C[slot];
  return T(label, proto, slot, speed, [
    [0, 0.95, 0, 1.6, 0.6, len, c],
    [0, 1.5, 0.2, 2.4, 0.08, len * 0.6, 0x1a3a6a],
    [0, 1.35, -len * 0.3, 0.7, 0.5, 0.7, GLASS],
    [0, 2.0, -len * 0.3, 0.06, 1.0, 0.06, 0xbfc8d4],
    [-0.95, 0.45, len * 0.32, 0.3, 0.7, 0.7, 0x2a2a2a], [0.95, 0.45, len * 0.32, 0.3, 0.7, 0.7, 0x2a2a2a],
    [-0.95, 0.45, 0, 0.3, 0.7, 0.7, 0x2a2a2a], [0.95, 0.45, 0, 0.3, 0.7, 0.7, 0x2a2a2a],
    [-0.95, 0.45, -len * 0.32, 0.3, 0.7, 0.7, 0x2a2a2a], [0.95, 0.45, -len * 0.32, 0.3, 0.7, 0.7, 0x2a2a2a],
  ], [[0, 2.06, -len * 0.3, 0.12, 0.12, 0.12, EYE], [-0.45, 0.95, len / 2, 0.3, 0.16, 0.06, EYE], [0.45, 0.95, len / 2, 0.3, 0.16, 0.06, EYE]]);
}
// Beetle/insect with a carapace, six legs and glowing eyes.
function bug(slot, len, speed, label, proto) {
  const c = C[slot]; const w = len * 0.7;
  return T(label, proto, slot, speed, [
    [0, 0.7, 0, w, 0.7, len, c],
    [0, 1.0, 0, w * 0.7, 0.5, len * 0.8, 0x14100a],
    [0, 0.6, len / 2 + 0.2, w * 0.5, 0.5, 0.5, 0x241a10],
    [-0.12, 0.95, len / 2 + 0.6, 0.05, 0.05, 0.5, 0x14100a], [0.12, 0.95, len / 2 + 0.6, 0.05, 0.05, 0.5, 0x14100a],
    [-(w / 2 + 0.1), 0.25, len * 0.3, 0.35, 0.45, 0.1, 0x14100a], [(w / 2 + 0.1), 0.25, len * 0.3, 0.35, 0.45, 0.1, 0x14100a],
    [-(w / 2 + 0.1), 0.25, 0, 0.35, 0.45, 0.1, 0x14100a], [(w / 2 + 0.1), 0.25, 0, 0.35, 0.45, 0.1, 0x14100a],
    [-(w / 2 + 0.1), 0.25, -len * 0.3, 0.35, 0.45, 0.1, 0x14100a], [(w / 2 + 0.1), 0.25, -len * 0.3, 0.35, 0.45, 0.1, 0x14100a],
  ], [[-0.18, 0.72, len / 2 + 0.45, 0.1, 0.1, 0.06, c], [0.18, 0.72, len / 2 + 0.45, 0.1, 0.1, 0.06, c]]);
}
// 1930s rubber-hose jalopy: round body, big wheels, round headlights.
function jalopy(slot, len, speed, label, proto) {
  const c = C[slot];
  return T(label, proto, slot, speed, [
    [0, 0.75, 0, 1.5, 0.7, len, c],
    [0, 1.25, -len * 0.1, 1.3, 0.6, len * 0.4, 0x2a2420],
    [0, 0.55, len * 0.42, 1.6, 0.4, 0.5, c],
    ...wheels4(1.7, len, 0.62, 0x1a1410),
    [0, 1.0, len * 0.5, 0.2, 0.5, 0.2, 0xc8b890],
  ], [[-0.5, 0.7, len / 2 + 0.05, 0.28, 0.28, 0.06, EYE], [0.5, 0.7, len / 2 + 0.05, 0.28, 0.28, 0.06, EYE]]);
}
// Floating crystal pod: dark base, glowing crystalline core (hovers).
function crystalPod(slot, len, speed, label, proto) {
  const c = C[slot];
  return T(label, proto, slot, speed, [
    [0, 1.0, 0, 0.9, 0.5, len, 0x2a3450],
  ], [
    [0, 1.55, 0, 0.7, 1.4, 0.7, c],
    [0, 1.5, len * 0.3, 0.4, 0.9, 0.4, c], [0, 1.5, -len * 0.3, 0.4, 0.9, 0.4, c],
    [0, 0.9, 0, 1.1, 0.12, len * 1.1, c],
  ], { y: 0.8, bob: 0.25, bobF: 1.6 });
}

const PROTOS = ['HTTPS', 'QUIC', 'HTTP', 'TCP', 'DNS', 'UDP', 'SSH', 'ICMP', 'OTHER'];
const SLOTS9 = ['truck', 'sports', 'van', 'car', 'moto', 'buggy', 'suv', 'ambulance', 'bus'];

// Parametric car variant: a slot-coloured body with configurable roof/height/
// spoiler/sign/underglow — powers supercars, convertibles, taxis, noir, etc.
function carVar(slot, len, speed, label, proto, o = {}) {
  const c = C[slot];
  const bodyH = o.bodyH || 0.55;
  const cy = bodyH / 2 + 0.32;
  const boxes = [[0, cy, 0, 1.7, bodyH, len, c]];
  if (o.roof === 'cabin') boxes.push([0, cy + bodyH / 2 + 0.25, -len * 0.05, 1.5, 0.5, len * 0.42, GLASS]);
  else if (o.roof === 'tall') boxes.push([0, cy + bodyH / 2 + 0.4, -len * 0.05, 1.55, 0.8, len * 0.52, GLASS]);
  else if (o.roof === 'open') boxes.push([0, cy + bodyH / 2 + 0.15, len * 0.12, 1.4, 0.35, len * 0.26, GLASS]);
  boxes.push(...wheels4(1.8, len, 0.5, 0x1a1410));
  if (o.spoiler) boxes.push([0, cy + bodyH / 2 + 0.2, -len / 2 + 0.15, 1.6, 0.1, 0.45, c]);
  if (o.sign) boxes.push([0, cy + bodyH / 2 + 0.55, 0, 0.8, 0.32, 0.4, o.sign]);
  const glow = [
    [-0.55, cy, len / 2 + 0.02, 0.4, 0.18, 0.06, EYE], [0.55, cy, len / 2 + 0.02, 0.4, 0.18, 0.06, EYE],
    [-0.55, cy, -len / 2 - 0.02, 0.4, 0.16, 0.06, TAIL], [0.55, cy, -len / 2 - 0.02, 0.4, 0.16, 0.06, TAIL],
  ];
  if (o.underglow) glow.push([0, 0.22, 0, 1.7, 0.06, len, o.underglow]);
  return T(label, proto, slot, speed, boxes, glow);
}
function carFleet(opts, names) {
  const sp = [22, 48, 28, 32, 46, 36, 30, 38, 22];
  const len = [5.2, 4.0, 4.4, 4.2, 2.6, 3.6, 4.6, 4.4, 7.0];
  const F = {};
  SLOTS9.forEach((s, i) => { F[s] = carVar(s, len[i] * (opts.lenK || 1), sp[i], names[i], PROTOS[i], opts); });
  return F;
}
// Blade-Runner spinner: a hovering car with thruster glow.
function spinner(slot, len, speed, label, proto) {
  const c = C[slot];
  return T(label, proto, slot, speed, [
    [0, 1.0, 0, 1.7, 0.6, len, c],
    [0, 1.45, -len * 0.05, 1.4, 0.5, len * 0.5, GLASS],
    [0, 0.7, 0, 1.9, 0.18, len * 0.9, 0x14141f],
  ], [
    [-0.7, 0.6, 0, 0.3, 0.2, len * 0.8, c], [0.7, 0.6, 0, 0.3, 0.2, len * 0.8, c],
    [-0.55, 1.0, len / 2 + 0.02, 0.4, 0.18, 0.06, EYE], [0.55, 1.0, len / 2 + 0.02, 0.4, 0.18, 0.06, EYE],
  ], { y: 1.4, bob: 0.18, bobF: 1.4 });
}
// Snowmobile: skis + track.
function snowmobile(slot, len, speed, label, proto) {
  const c = C[slot];
  return T(label, proto, slot, speed, [
    [0, 0.55, 0, 0.9, 0.45, len, c],
    [0, 0.95, -len * 0.1, 0.7, 0.45, len * 0.4, 0x1a1f2e],
    [-0.45, 0.12, len * 0.4, 0.18, 0.1, 1.2, 0xdfe5ee], [0.45, 0.12, len * 0.4, 0.18, 0.1, 1.2, 0xdfe5ee],
    [0, 0.35, -len * 0.25, 1.0, 0.4, len * 0.4, 0x14141f],
  ], [[0, 0.6, len / 2 + 0.05, 0.3, 0.18, 0.06, EYE]]);
}
// Open safari jeep with a roll cage.
function safari(slot, len, speed, label, proto) {
  const c = C[slot];
  return T(label, proto, slot, speed, [
    [0, 0.7, 0, 1.8, 0.6, len, c],
    [0, 1.5, 0, 1.7, 0.1, len * 0.7, 0x3a2e1a],
    [-0.8, 1.1, 0, 0.1, 0.8, len * 0.7, 0x3a2e1a], [0.8, 1.1, 0, 0.1, 0.8, len * 0.7, 0x3a2e1a],
    [0, 0.95, -len * 0.2, 0.6, 0.6, 0.6, 0x6e5a3a],
    ...wheels4(2.0, len, 0.62, 0x1a1410),
  ], [[-0.55, 0.7, len / 2 + 0.05, 0.4, 0.18, 0.06, EYE], [0.55, 0.7, len / 2 + 0.05, 0.4, 0.18, 0.06, EYE]]);
}
// Old-west stagecoach with a two-horse team.
function stagecoach(slot, len, speed, label, proto) {
  const c = C[slot];
  return T(label, proto, slot, speed, [
    [0, 1.1, -len * 0.2, 1.6, 1.3, len * 0.45, c],
    [0, 1.9, -len * 0.2, 1.5, 0.2, len * 0.4, 0x3a2a18],
    [0, 1.0, len * 0.35, 0.9, 1.1, 1.8, 0x6e4a30], [0, 1.0, len * 0.35 + 1.9, 0.9, 1.1, 1.8, 0x5a3e26],
    [-0.85, 0.5, -len * 0.2, 0.18, 1.0, 1.0, 0x2a1e10], [0.85, 0.5, -len * 0.2, 0.18, 1.0, 1.0, 0x2a1e10],
    [-0.8, 0.35, len * 0.05, 0.15, 0.7, 0.7, 0x2a1e10], [0.8, 0.35, len * 0.05, 0.15, 0.7, 0.7, 0x2a1e10],
  ], [[0, 1.0, len / 2 + 1.0, 0.18, 0.12, 0.06, EYE]]);
}
// Limbo silhouette: pure black body, slot colour only as a faint light.
function silhouetteCar(slot, len, speed, label, proto) {
  const c = C[slot];
  return T(label, proto, slot, speed, [
    [0, 0.55, 0, 1.6, 0.55, len, 0x000000],
    [0, 1.0, -len * 0.05, 1.4, 0.5, len * 0.45, 0x000000],
    ...wheels4(1.7, len, 0.5, 0x000000),
  ], [[-0.5, 0.55, len / 2 + 0.02, 0.34, 0.16, 0.06, c], [0.5, 0.55, len / 2 + 0.02, 0.34, 0.16, 0.06, c]]);
}
// Journey sand-skiff: a floating board with a cloaked rider and a scarf.
function skiff(slot, len, speed, label, proto) {
  const c = C[slot];
  return T(label, proto, slot, speed, [
    [0, 1.0, 0, 1.0, 0.18, len, c],
    [0, 1.5, -len * 0.15, 0.6, 0.8, 0.6, 0xb86a3a],
    [0, 2.0, -len * 0.15, 0.5, 0.3, 0.5, 0xd88a4a],
    [0.02, 1.7, -len * 0.4, 0.06, 1.0, 1.4, 0xe8c8a0],
  ], [[0, 0.9, 0, 1.0, 0.06, len, c]], { y: 1.2, bob: 0.3, bobF: 1.2 });
}
// Monument Valley floating abstract shape (glowing cap keeps glow non-empty).
function abstractShape(slot, len, speed, label, proto) {
  const c = C[slot];
  return T(label, proto, slot, speed, [
    [0, 1.2, 0, 1.0, 1.0, 1.0, c],
    [0, 1.9, 0, 0.6, 0.6, 0.6, 0xf0e6d2],
    [0, 0.6, 0, 1.3, 0.2, 1.3, c],
  ], [[0, 2.45, 0, 0.32, 0.32, 0.32, c]], { y: 0.6, bob: 0.3, bobF: 1.0 });
}
// Borderlands cel buggy: roll cage + big knobby wheels + ink outlines.
function celbuggy(slot, len, speed, label, proto) {
  const c = C[slot];
  return T(label, proto, slot, speed, [
    [0, 0.7, 0, 1.5, 0.5, len, c],
    [0, 1.3, 0, 0.12, 1.0, len * 0.5, 0x120a04], [0, 1.35, 0, 1.4, 0.12, len * 0.5, 0x120a04],
    [0, 1.0, -len * 0.2, 0.5, 0.5, 0.5, 0x2a2018],
    ...wheels4(2.0, len, 0.7, 0x120a04),
  ], [[-0.5, 0.7, len / 2 + 0.05, 0.35, 0.18, 0.06, EYE], [0.5, 0.7, len / 2 + 0.05, 0.35, 0.18, 0.06, EYE]]);
}
// Mini Motorways: ultra-minimal rounded blob with a small headlight.
function minimalCar(slot, len, speed, label, proto) {
  const c = C[slot];
  return T(label, proto, slot, speed, [
    [0, 0.5, 0, 1.2, 0.6, len, c],
    [0, 0.85, 0, 1.0, 0.3, len * 0.5, c],
  ], [[0, 0.5, len / 2 + 0.02, 0.32, 0.1, 0.05, EYE]]);
}

export const FLEETS = {
  cars: VEHICLE_TYPES,

  boats: {
    truck: T('container ship', 'HTTPS', 'truck', 21, [
      ...hull(0x0c6e54, 8.2, 2.3, 1.0),
      [0, 1.9, -0.6, 2.0, 1.5, 4.6, C.truck],
      [0, 2.2, 2.6, 1.8, 2.2, 1.4, 0xd7dde9],
    ], navLights(2.4, 8.2), BOB),
    sports: T('speedboat', 'QUIC', 'sports', 44, [
      ...hull(C.sports, 4.0, 1.5, 0.6),
      [0, 1.0, -0.6, 1.3, 0.5, 1.4, GLASS],
    ], navLights(1.1, 4.0), { bob: 0.1, bobF: 2.4 }),
    van: T('ferry', 'HTTP', 'van', 26, [
      ...hull(0x9aa3b0, 5.6, 2.2, 0.8),
      [0, 1.7, 0, 2.1, 1.3, 4.4, C.van],
      [0, 2.6, 0.8, 1.6, 0.6, 2.0, 0xb9c2d4],
    ], navLights(2.2, 5.6), BOB),
    car: T('sailboat', 'TCP', 'car', 30, [
      ...hull(C.car, 4.4, 1.4, 0.7),
      [0, 3.0, 0.2, 0.1, 4.4, 0.1, 0xd8d2c4],          // mast
      [0.02, 3.2, -0.9, 0.06, 3.2, 1.9, 0xeef2f8],     // sail
    ], navLights(1.0, 4.4), BOB),
    moto: T('jet ski', 'DNS', 'moto', 48, [
      [0, 0.5, 0, 0.8, 0.5, 2.0, C.moto],
      [0, 1.0, -0.3, 0.5, 0.5, 0.6, 0x1f2937],
    ], [[0, 0.7, 1.05, 0.2, 0.15, 0.06, EYE]], { bob: 0.12, bobF: 2.8 }),
    buggy: T('fishing boat', 'UDP', 'buggy', 28, [
      ...hull(C.buggy, 4.6, 1.8, 0.8),
      [0, 1.6, 1.2, 1.4, 1.0, 1.2, 0xd7dde9],
      [0, 2.6, -0.9, 0.08, 1.8, 0.08, 0x3a2e22],
    ], navLights(1.4, 4.6), BOB),
    suv: T('patrol boat', 'SSH', 'suv', 34, [
      ...hull(C.suv, 5.0, 1.9, 0.8),
      [0, 1.6, 0.4, 1.6, 0.9, 2.4, 0x2e3950],
    ], navLights(2.0, 5.0), BOB),
    ambulance: T('rescue boat', 'ICMP', 'ambulance', 38, [
      ...hull(C.ambulance, 4.8, 1.9, 0.8),
      [0, 1.6, 0.2, 1.6, 0.9, 2.2, C.ambulance],
      [0, 1.45, 0.2, 1.7, 0.32, 2.3, 0xdc2626],
    ], [
      [-0.3, 2.25, 0.4, 0.45, 0.16, 0.3, 0xff3344], [0.3, 2.25, 0.4, 0.45, 0.16, 0.3, 0x3b82f6],
      ...navLights(1.2, 4.8),
    ], BOB),
    bus: T('barge', 'OTHER', 'bus', 22, [
      ...hull(C.bus, 8.6, 2.4, 0.8),
      [0, 1.3, -3.0, 2.0, 1.1, 1.6, 0x7c6aa8],
      [0, 1.25, 0.8, 2.1, 0.7, 4.6, 0x6d28d9],
    ], navLights(1.6, 8.6), BOB),
  },

  spacecraft: {
    truck: T('cargo freighter', 'HTTPS', 'truck', 22, [
      [0, 1.4, 0, 2.4, 2.0, 7.6, C.truck],
      [0, 1.6, 4.2, 1.4, 1.2, 1.0, GLASS],
      [0, 2.6, -1.0, 1.6, 0.5, 3.6, 0x047857],
    ], [[-0.8, 1.4, -3.95, 0.6, 0.6, 0.1, 0x7dd3fc], [0.8, 1.4, -3.95, 0.6, 0.6, 0.1, 0x7dd3fc]],
      { y: 1.6, bob: 0.18, bobF: 0.9 }),
    sports: T('starfighter', 'QUIC', 'sports', 46, [
      [0, 1.0, 0, 1.0, 0.7, 3.6, C.sports],
      [0, 1.25, 0.9, 0.7, 0.5, 1.1, GLASS],
      [0, 1.0, -0.4, 4.2, 0.12, 1.4, 0xb91c1c],
    ], [[-1.9, 1.0, -1.0, 0.3, 0.2, 0.1, 0x7dd3fc], [1.9, 1.0, -1.0, 0.3, 0.2, 0.1, 0x7dd3fc],
        [0, 1.0, -1.85, 0.5, 0.4, 0.1, 0x7dd3fc]], { y: 2.2, bob: 0.2, bobF: 1.4 }),
    van: T('shuttle', 'HTTP', 'van', 28, [
      [0, 1.2, 0, 1.7, 1.3, 4.6, C.van],
      [0, 1.5, 2.4, 1.2, 0.8, 0.9, GLASS],
      [0, 1.0, -1.6, 3.4, 0.12, 1.6, 0xb9c2d4],
      [0, 2.1, -2.0, 0.12, 1.1, 0.9, C.van],
    ], [[0, 1.2, -2.4, 0.9, 0.7, 0.1, 0xffb35e]], { y: 1.8, bob: 0.15, bobF: 1.0 }),
    car: T('patrol craft', 'TCP', 'car', 32, [
      [0, 1.1, 0, 1.4, 0.9, 3.8, C.car],
      [0, 1.4, 1.3, 1.0, 0.6, 1.2, GLASS],
      [0, 1.1, -0.6, 3.0, 0.12, 1.0, 0x1e54b8],
    ], [[0, 1.1, -2.0, 0.7, 0.5, 0.1, 0x7dd3fc]], { y: 1.8, bob: 0.16, bobF: 1.2 }),
    moto: T('probe', 'DNS', 'moto', 48, [
      [0, 1.0, 0, 0.7, 0.7, 1.2, C.moto],
      [0, 1.0, 0.8, 0.4, 0.4, 0.5, GLASS],
      [0, 1.7, -0.3, 0.06, 0.8, 0.06, 0x9aa3b0],
    ], [[0, 1.0, -0.7, 0.4, 0.3, 0.1, 0x7dd3fc]], { y: 2.6, bob: 0.25, bobF: 2.0 }),
    buggy: T('cargo drone', 'UDP', 'buggy', 36, [
      [0, 1.0, 0, 1.2, 0.8, 2.4, C.buggy],
      [-0.9, 1.4, 0, 0.5, 0.1, 0.5, 0xc2410c], [0.9, 1.4, 0, 0.5, 0.1, 0.5, 0xc2410c],
    ], [[0, 1.0, -1.3, 0.6, 0.4, 0.1, 0xffb35e]], { y: 2.0, bob: 0.2, bobF: 1.8 }),
    suv: T('stealth craft', 'SSH', 'suv', 34, [
      [0, 1.0, 0, 1.8, 0.5, 4.0, C.suv],
      [0, 1.3, 0.8, 1.0, 0.4, 1.4, 0x10141f],
      [0, 1.0, -1.0, 3.6, 0.1, 1.2, 0x1a2030],
    ], [[0, 1.0, -2.1, 0.6, 0.25, 0.1, 0x6d8cff]], { y: 2.0, bob: 0.12, bobF: 0.8 }),
    ambulance: T('medic frigate', 'ICMP', 'ambulance', 38, [
      [0, 1.2, 0, 1.8, 1.2, 4.2, C.ambulance],
      [0, 1.2, 0, 1.85, 0.3, 4.25, 0xdc2626],
      [0, 1.7, 1.8, 1.2, 0.6, 0.9, GLASS],
    ], [[-0.4, 2.0, 0, 0.4, 0.16, 0.4, 0xff3344], [0.4, 2.0, 0, 0.4, 0.16, 0.4, 0x3b82f6],
        [0, 1.2, -2.2, 0.8, 0.6, 0.1, 0x7dd3fc]], { y: 2.0, bob: 0.15, bobF: 1.2 }),
    bus: T('mothership', 'OTHER', 'bus', 20, [
      [0, 1.5, 0, 2.6, 1.7, 8.8, C.bus],
      [0, 2.6, 1.6, 1.8, 0.7, 2.6, 0x6d28d9],
      [0, 1.5, 4.7, 1.4, 1.0, 0.8, GLASS],
    ], [[-1.31, 1.6, 0, 0.06, 0.5, 7.0, 0x9a8ac8], [1.31, 1.6, 0, 0.06, 0.5, 7.0, 0x9a8ac8],
        [-0.8, 1.5, -4.5, 0.6, 0.7, 0.1, 0x7dd3fc], [0.8, 1.5, -4.5, 0.6, 0.7, 0.1, 0x7dd3fc]],
      { y: 2.4, bob: 0.1, bobF: 0.6 }),
  },

  fish: (() => {
    const F = {};
    const mk = (slot, label, proto, speed, def, opts = {}) =>
      F[slot] = T(label, proto, slot, speed, def.boxes,
        eyes(def.eyeY, def.eyeZ, def.eyeSpread), { bob: 0.22, bobF: 1.8, ...opts });
    mk('truck', 'humpback whale', 'HTTPS', 20,
      fish({ color: C.truck, len: 8.4, h: 2.2, w: 2.4, finH: 0.4, y: 1.8 }), { bobF: 0.8 });
    mk('sports', 'marlin', 'QUIC', 46, fish({ color: C.sports, len: 4.6, h: 0.9, w: 0.7, y: 1.6 }));
    mk('van', 'pufferfish', 'HTTP', 24, fish({ color: C.van, len: 2.2, h: 1.6, w: 1.5, finH: 0.3, y: 1.5 }));
    mk('car', 'tuna', 'TCP', 32, fish({ color: C.car, len: 3.4, h: 1.1, w: 0.9, y: 1.5 }));
    mk('moto', 'clownfish', 'DNS', 40, fish({ color: C.moto, len: 1.4, h: 0.7, w: 0.45, finH: 0.25, y: 1.3 }));
    mk('buggy', 'parrotfish', 'UDP', 30, fish({ color: C.buggy, len: 2.4, h: 1.0, w: 0.7, y: 1.4 }));
    const shark = fish({ color: 0x2e3950, len: 5.6, h: 1.3, w: 1.1, finH: 0.9, y: 1.7 });
    mk('suv', 'reef shark', 'SSH', 36, shark);
    const orca = fish({ color: 0x10141f, len: 6.2, h: 1.7, w: 1.5, finH: 1.1, y: 1.8 });
    orca.boxes.push([0, 1.4, 1.6, 1.55, 0.7, 1.8, 0xf8fafc]); // white belly patch
    mk('ambulance', 'orca', 'ICMP', 38, orca);
    const manta = fish({ color: C.bus, len: 4.0, h: 0.7, w: 1.6, finH: 0.2, y: 1.8 });
    manta.boxes.push([-2.4, 1.8, 0, 3.2, 0.12, 2.6, C.bus], [2.4, 1.8, 0, 3.2, 0.12, 2.6, C.bus]);
    mk('bus', 'manta ray', 'OTHER', 24, manta, { bobF: 1.0 });
    return F;
  })(),

  aircraft: {
    truck: T('cargo jumbo', 'HTTPS', 'truck', 24,
      plane({ color: C.truck, len: 8.0, wing: 7.5, fusH: 1.4, fusW: 1.6 }),
      [[-2.6, -0.15, 0.6, 0.5, 0.4, 1.0, 0x047857], [2.6, -0.15, 0.6, 0.5, 0.4, 1.0, 0x047857],
       [-3.7, 0, 0.2, 0.18, 0.12, 0.12, TAIL], [3.7, 0, 0.2, 0.18, 0.12, 0.12, 0x39d98a]],
      { y: 5.5, bob: 0.2, bobF: 0.7 }),
    sports: T('fighter jet', 'QUIC', 'sports', 48,
      plane({ color: C.sports, len: 4.6, wing: 3.6, fusH: 0.7, fusW: 0.8 }),
      [[0, 0, -2.5, 0.5, 0.4, 0.1, 0x7dd3fc]], { y: 6.5, bob: 0.25, bobF: 1.6 }),
    van: T('commuter prop', 'HTTP', 'van', 28,
      [...plane({ color: C.van, len: 5.0, wing: 5.4, fusH: 1.0, fusW: 1.1 }),
       [0, 0, 2.62, 0.15, 1.5, 0.1, 0x4a5568]],
      [[-1.9, 0, 0.2, 0.18, 0.12, 0.12, TAIL], [1.9, 0, 0.2, 0.18, 0.12, 0.12, 0x39d98a]],
      { y: 5.0, bob: 0.2, bobF: 0.9 }),
    car: T('airliner', 'TCP', 'car', 32,
      plane({ color: C.car, len: 6.4, wing: 6.0, fusH: 1.2, fusW: 1.3 }),
      [[-2.1, -0.2, 0.5, 0.45, 0.35, 0.9, 0x1e54b8], [2.1, -0.2, 0.5, 0.45, 0.35, 0.9, 0x1e54b8]],
      { y: 5.8, bob: 0.18, bobF: 0.8 }),
    moto: T('aerobatic prop', 'DNS', 'moto', 44,
      [...plane({ color: C.moto, len: 2.8, wing: 3.0, fusH: 0.6, fusW: 0.6 }),
       [0, 0, 1.5, 0.12, 1.0, 0.08, 0x4a5568]],
      [[0, 0.1, 1.45, 0.2, 0.2, 0.06, EYE]], { y: 4.4, bob: 0.3, bobF: 2.2 }),
    buggy: T('bush plane', 'UDP', 'buggy', 30,
      [...plane({ color: C.buggy, len: 3.6, wing: 4.2, fusH: 0.8, fusW: 0.8 }),
       [-0.5, -0.6, 0.6, 0.2, 0.5, 0.2, DARK], [0.5, -0.6, 0.6, 0.2, 0.5, 0.2, DARK]],
      [[0, 0.1, 1.85, 0.25, 0.2, 0.06, EYE]], { y: 4.6, bob: 0.25, bobF: 1.4 }),
    suv: T('night recon jet', 'SSH', 'suv', 38,
      plane({ color: C.suv, len: 5.4, wing: 5.0, fusH: 0.7, fusW: 1.0 }),
      [[0, 0, -2.9, 0.6, 0.3, 0.1, 0x6d8cff]], { y: 6.8, bob: 0.15, bobF: 0.8 }),
    ambulance: T('rescue helicopter', 'ICMP', 'ambulance', 36, [
      [0, 0, 0.3, 1.4, 1.3, 3.0, C.ambulance],
      [0, 0.05, 0.3, 1.45, 0.3, 3.05, 0xdc2626],
      [0, 0.4, 1.6, 1.0, 0.7, 0.6, GLASS],
      [0, 0.2, -2.0, 0.3, 0.3, 2.2, C.ambulance],
      [0, 0.95, 0.2, 0.18, 0.18, 0.18, DARK],
      [0, 1.1, 0.2, 4.6, 0.06, 0.3, 0x4a5568],         // rotor
      [0, 0.45, -3.1, 0.08, 0.9, 0.5, C.ambulance],
      [-0.5, -0.75, 0.3, 0.12, 0.2, 2.2, DARK], [0.5, -0.75, 0.3, 0.12, 0.2, 2.2, DARK],
    ], [[-0.4, 0.9, 0.6, 0.3, 0.14, 0.3, 0xff3344], [0.4, 0.9, 0.6, 0.3, 0.14, 0.3, 0x3b82f6]],
      { y: 5.2, bob: 0.3, bobF: 1.8 }),
    bus: T('blimp', 'OTHER', 'bus', 18, [
      [0, 1.2, 0, 2.6, 2.4, 7.6, C.bus],
      [0, 1.6, 0, 2.0, 1.6, 8.6, C.bus],
      [0, -0.4, 0.6, 1.0, 0.8, 2.4, 0x6d28d9],
      [0, 2.2, -3.9, 0.1, 1.3, 1.0, 0x7c5ce0],
    ], [[-1.0, 1.2, 3.6, 0.2, 0.2, 0.1, TAIL], [1.0, 1.2, 3.6, 0.2, 0.2, 0.1, 0x39d98a],
        [0, -0.5, 1.85, 0.7, 0.3, 0.08, EYE]], { y: 6.4, bob: 0.12, bobF: 0.5 }),
  },

  trains: {
    truck: T('freight hauler', 'HTTPS', 'truck', 22,
      [...loco(C.truck, 8.4, 1.8), [0, 2.0, 2.8, 1.9, 1.4, 2.6, 0x047857]],
      [[0, 1.0, 4.25, 0.7, 0.4, 0.06, EYE]]),
    sports: T('bullet train', 'QUIC', 'sports', 48, [
      [0, 1.3, 0, 1.9, 1.5, 8.0, C.sports],
      [0, 1.0, 4.3, 1.6, 0.9, 1.2, C.sports],          // streamlined nose
      [0, 1.95, 0.4, 1.7, 0.35, 6.0, GLASS],
      [0, 0.4, 0, 1.7, 0.45, 7.6, DARK],
    ], [[0, 1.0, 4.9, 0.9, 0.3, 0.06, EYE]]),
    van: T('mail car', 'HTTP', 'van', 26,
      [...loco(C.van, 6.4, 1.9, false), [0, 1.9, 0, 2.05, 0.7, 5.0, 0xb9c2d4]],
      [[0, 1.6, 3.25, 0.6, 0.35, 0.06, EYE]]),
    car: T('passenger coach', 'TCP', 'car', 30,
      [...loco(C.car, 7.2, 1.9, false)],
      [[-1.01, 1.7, 0, 0.06, 0.5, 5.8, 0xcfe0ff], [1.01, 1.7, 0, 0.06, 0.5, 5.8, 0xcfe0ff],
       [0, 1.2, 3.65, 0.6, 0.3, 0.06, EYE]]),
    moto: T('handcar', 'DNS', 'moto', 36, [
      [0, 0.5, 0, 1.2, 0.25, 1.8, C.moto],
      [0, 1.0, 0, 0.15, 0.8, 0.15, 0x4a3526],
      [0, 1.35, 0, 1.4, 0.1, 0.25, 0x4a3526],
      [-0.45, 0.22, 0.6, 0.2, 0.45, 0.45, DARK], [0.45, 0.22, 0.6, 0.2, 0.45, 0.45, DARK],
      [-0.45, 0.22, -0.6, 0.2, 0.45, 0.45, DARK], [0.45, 0.22, -0.6, 0.2, 0.45, 0.45, DARK],
    ], [[0, 0.7, 1.0, 0.25, 0.2, 0.06, EYE]]),
    buggy: T('mine cart', 'UDP', 'buggy', 34, [
      [0, 0.8, 0, 1.5, 0.9, 2.2, C.buggy],
      [0, 1.35, 0, 1.3, 0.4, 1.9, 0x7a4a1e],           // ore pile
      [-0.6, 0.25, 0.7, 0.2, 0.5, 0.5, DARK], [0.6, 0.25, 0.7, 0.2, 0.5, 0.5, DARK],
      [-0.6, 0.25, -0.7, 0.2, 0.5, 0.5, DARK], [0.6, 0.25, -0.7, 0.2, 0.5, 0.5, DARK],
    ], [[0, 0.9, 1.15, 0.3, 0.2, 0.06, EYE]]),
    suv: T('armored car', 'SSH', 'suv', 30,
      [...loco(C.suv, 6.0, 1.7, false), [0, 2.45, 0, 1.0, 0.6, 1.6, 0x2e3950]],
      [[0, 1.3, 3.05, 0.5, 0.25, 0.06, 0x6d8cff]]),
    ambulance: T('hospital car', 'ICMP', 'ambulance', 32,
      [...loco(C.ambulance, 6.8, 1.9, false), [0, 1.9, 0, 2.06, 0.4, 5.4, 0xdc2626]],
      [[-0.4, 2.4, 0, 0.4, 0.16, 0.4, 0xff3344], [0.4, 2.4, 0, 0.4, 0.16, 0.4, 0x3b82f6],
       [0, 1.4, 3.45, 0.6, 0.3, 0.06, EYE]]),
    bus: T('steam locomotive', 'OTHER', 'bus', 24, [
      ...loco(C.bus, 8.8, 1.9),
      [0, 2.9, 2.6, 0.6, 1.3, 0.6, 0x6d28d9],          // funnel
      [0, 2.55, 0.6, 0.9, 0.5, 0.9, 0x7c5ce0],         // steam dome
    ], [[0, 1.4, 4.45, 0.8, 0.5, 0.06, EYE]]),
  },

  savanna: (() => {
    const F = {};
    const mk = (slot, label, proto, speed, a, opts = {}) =>
      F[slot] = T(label, proto, slot, speed, a.boxes,
        eyes(a.eyeY, a.eyeZ, a.eyeSpread), { bob: 0.1, bobF: 3.0, ...opts });
    const eleph = animal({ color: 0x4e8f72, bw: 2.6, bh: 2.4, bl: 4.4, legH: 1.6, headW: 1.6, headH: 1.5, headL: 1.4 });
    eleph.boxes.push([0, 2.6, 3.4, 0.45, 2.2, 0.45, 0x4e8f72],   // trunk
      [-1.1, 4.0, 2.6, 0.8, 1.0, 0.2, 0x447f64], [1.1, 4.0, 2.6, 0.8, 1.0, 0.2, 0x447f64]); // ears
    mk('truck', 'elephant', 'HTTPS', 20, eleph, { bobF: 1.4 });
    mk('sports', 'cheetah', 'QUIC', 48,
      animal({ color: 0xd9684a, bw: 0.9, bh: 0.8, bl: 2.6, legH: 1.0, headW: 0.6, headH: 0.55, headL: 0.7, tailL: 1.4 }), { bobF: 4.5, bob: 0.18 });
    mk('van', 'gazelle', 'HTTP', 40,
      animal({ color: 0xd8cfc0, bw: 0.8, bh: 0.8, bl: 1.9, legH: 1.2, neckUp: 0.6, headW: 0.45, headH: 0.5, headL: 0.6 }), { bob: 0.22, bobF: 4.0 });
    mk('car', 'wildebeest', 'TCP', 32,
      animal({ color: 0x4a6285, bw: 1.2, bh: 1.2, bl: 2.6, legH: 1.2, headW: 0.7, headH: 0.9, headL: 0.9 }));
    mk('moto', 'meerkat', 'DNS', 38,
      animal({ color: C.moto, bw: 0.5, bh: 0.5, bl: 0.9, legH: 0.5, neckUp: 0.4, headW: 0.4, headH: 0.4, headL: 0.45 }), { bob: 0.15, bobF: 5.0 });
    const giraffe = animal({ color: 0xe09a3e, bw: 1.3, bh: 1.5, bl: 2.6, legH: 2.4, neckUp: 2.6, headW: 0.55, headH: 0.6, headL: 0.9 });
    mk('buggy', 'giraffe', 'UDP', 28, giraffe, { bobF: 1.8 });
    const rhino = animal({ color: 0x39404f, bw: 1.7, bh: 1.5, bl: 3.2, legH: 1.0, headW: 1.0, headH: 1.1, headL: 1.2 });
    rhino.boxes.push([0, 2.4, 2.95, 0.25, 0.8, 0.25, 0xd8d2c4]); // horn
    mk('suv', 'rhino', 'SSH', 30, rhino, { bobF: 1.6 });
    const zebra = animal({ color: 0xe8e8ea, dark: 0x222, bw: 1.1, bh: 1.1, bl: 2.4, legH: 1.2, neckUp: 0.7, headW: 0.5, headH: 0.6, headL: 0.8 });
    zebra.boxes.push([0, 2.35, 0.5, 1.15, 1.0, 0.3, 0x26262e], [0, 2.35, -0.5, 1.15, 1.0, 0.3, 0x26262e]); // stripes
    mk('ambulance', 'zebra', 'ICMP', 36, zebra);
    const hippo = animal({ color: 0x7e6a9e, bw: 2.2, bh: 1.7, bl: 4.0, legH: 0.8, headW: 1.4, headH: 1.2, headL: 1.5 });
    mk('bus', 'hippo', 'OTHER', 22, hippo, { bobF: 1.2 });
    return F;
  })(),

  arctic: (() => {
    const F = {};
    const mk = (slot, label, proto, speed, a, opts = {}) =>
      F[slot] = T(label, proto, slot, speed, a.boxes,
        eyes(a.eyeY, a.eyeZ, a.eyeSpread, 0x10141f), { bob: 0.12, bobF: 3.0, ...opts });
    const walrus = animal({ color: 0x8a6f5e, bw: 2.0, bh: 1.4, bl: 3.6, legH: 0.4, headW: 1.1, headH: 1.0, headL: 1.0 });
    walrus.boxes.push([-0.25, 0.9, 2.5, 0.12, 0.7, 0.12, 0xf2ead8], [0.25, 0.9, 2.5, 0.12, 0.7, 0.12, 0xf2ead8]); // tusks
    mk('truck', 'walrus', 'HTTPS', 20, walrus, { bobF: 1.4 });
    mk('sports', 'sled dog', 'QUIC', 46,
      animal({ color: 0x9aa3b0, bw: 0.8, bh: 0.7, bl: 1.8, legH: 0.9, headW: 0.5, headH: 0.5, headL: 0.7, tailL: 0.9 }), { bob: 0.2, bobF: 4.5 });
    mk('van', 'arctic fox', 'HTTP', 38,
      animal({ color: 0xe8eef5, bw: 0.6, bh: 0.55, bl: 1.4, legH: 0.6, headW: 0.4, headH: 0.4, headL: 0.55, tailL: 1.1 }), { bob: 0.18, bobF: 4.0 });
    const penguin = { boxes: [
      [0, 1.0, 0, 1.0, 1.8, 1.0, 0x1c2940],
      [0, 0.9, 0.45, 0.8, 1.3, 0.25, 0xeef2f8],         // belly
      [0, 2.1, 0.1, 0.7, 0.6, 0.7, 0x1c2940],
      [0, 2.0, 0.5, 0.22, 0.18, 0.3, 0xe8a23e],         // beak
      [-0.6, 1.1, 0, 0.15, 1.0, 0.5, 0x1c2940], [0.6, 1.1, 0, 0.15, 1.0, 0.5, 0x1c2940],
      [-0.25, 0.1, 0.15, 0.4, 0.18, 0.7, 0xe8a23e], [0.25, 0.1, 0.15, 0.4, 0.18, 0.7, 0xe8a23e],
    ], eyeY: 2.2, eyeZ: 0.46, eyeSpread: 0.2 };
    mk('car', 'emperor penguin', 'TCP', 28, penguin, { bob: 0.2, bobF: 3.6 });
    const chick = { boxes: [
      [0, 0.55, 0, 0.8, 1.0, 0.8, 0xb8bec8],
      [0, 1.25, 0.05, 0.55, 0.5, 0.55, 0xd8dde4],
      [0, 1.18, 0.35, 0.16, 0.13, 0.2, 0xe8a23e],
    ], eyeY: 1.32, eyeZ: 0.34, eyeSpread: 0.16 };
    mk('moto', 'penguin chick', 'DNS', 36, chick, { bob: 0.22, bobF: 5.0 });
    const puffin = { boxes: [
      [0, 0.8, 0, 0.7, 0.9, 1.1, 0x1c2940],
      [0, 0.75, 0.45, 0.55, 0.65, 0.3, 0xeef2f8],
      [0, 1.1, 0.65, 0.3, 0.25, 0.35, C.buggy],
      [-0.45, 0.85, -0.1, 0.12, 0.5, 0.7, 0x1c2940], [0.45, 0.85, -0.1, 0.12, 0.5, 0.7, 0x1c2940],
    ], eyeY: 1.25, eyeZ: 0.5, eyeSpread: 0.18 };
    mk('buggy', 'puffin', 'UDP', 40, puffin, { y: 1.6, bob: 0.35, bobF: 3.0 });
    const ox = animal({ color: 0x2e2a26, bw: 1.6, bh: 1.4, bl: 2.8, legH: 0.9, headW: 1.0, headH: 0.9, headL: 0.9 });
    ox.boxes.push([-0.7, 2.5, 1.6, 0.5, 0.18, 0.18, 0xd8d2c4], [0.7, 2.5, 1.6, 0.5, 0.18, 0.18, 0xd8d2c4]);
    mk('suv', 'musk ox', 'SSH', 26, ox, { bobF: 1.8 });
    const seal = animal({ color: 0xc8ccd4, bw: 1.2, bh: 0.9, bl: 2.8, legH: 0.25, headW: 0.7, headH: 0.6, headL: 0.7, tailL: 1.0 });
    mk('ambulance', 'harp seal', 'ICMP', 30, seal, { bobF: 2.2 });
    const bear = animal({ color: 0xe2dccc, bw: 1.8, bh: 1.6, bl: 3.6, legH: 1.1, headW: 0.9, headH: 0.8, headL: 1.0, tailL: 0.3 });
    mk('bus', 'polar bear', 'OTHER', 24, bear, { bobF: 1.6 });
    return F;
  })(),

  dinos: (() => {
    const F = {};
    const mk = (slot, label, proto, speed, a, opts = {}) =>
      F[slot] = T(label, proto, slot, speed, a.boxes,
        eyes(a.eyeY, a.eyeZ, a.eyeSpread, 0xffe28a), { bob: 0.12, bobF: 2.6, ...opts });
    const trike = animal({ color: 0x5e8f52, bw: 2.2, bh: 1.8, bl: 4.2, legH: 1.2, headW: 1.5, headH: 1.4, headL: 1.4, tailL: 2.0 });
    trike.boxes.push([0, 3.3, 2.4, 2.0, 1.2, 0.3, 0x4e7a44],       // frill
      [-0.5, 3.0, 3.4, 0.18, 0.18, 0.9, 0xe2dccc], [0.5, 3.0, 3.4, 0.18, 0.18, 0.9, 0xe2dccc],
      [0, 2.4, 3.7, 0.16, 0.16, 0.6, 0xe2dccc]);                   // horns
    mk('truck', 'triceratops', 'HTTPS', 22, trike, { bobF: 1.6 });
    const raptor = animal({ color: 0xb8503e, bw: 0.8, bh: 0.9, bl: 2.2, legH: 1.2, neckUp: 0.5, headW: 0.5, headH: 0.5, headL: 1.0, tailL: 2.2 });
    mk('sports', 'raptor', 'QUIC', 48, raptor, { bob: 0.22, bobF: 4.5 });
    const galli = animal({ color: 0xc8c0a8, bw: 0.8, bh: 0.9, bl: 2.0, legH: 1.5, neckUp: 0.9, headW: 0.4, headH: 0.4, headL: 0.8, tailL: 2.0 });
    mk('van', 'gallimimus', 'HTTP', 42, galli, { bob: 0.25, bobF: 4.2 });
    const para = animal({ color: 0x4a6285, bw: 1.4, bh: 1.5, bl: 3.4, legH: 1.3, neckUp: 1.0, headW: 0.6, headH: 0.6, headL: 1.1, tailL: 2.6 });
    para.boxes.push([0, 3.9, 2.0, 0.25, 0.25, 1.2, 0x3a5070]);     // crest
    mk('car', 'parasaur', 'TCP', 30, para, { bobF: 2.0 });
    const compy = animal({ color: C.moto, bw: 0.35, bh: 0.4, bl: 0.8, legH: 0.5, neckUp: 0.3, headW: 0.25, headH: 0.25, headL: 0.45, tailL: 0.9 });
    mk('moto', 'compy', 'DNS', 44, compy, { bob: 0.18, bobF: 6.0 });
    const anky = animal({ color: 0xb86a28, bw: 2.0, bh: 1.2, bl: 3.6, legH: 0.7, headW: 0.9, headH: 0.7, headL: 0.8, tailL: 2.2 });
    anky.boxes.push([0, 2.1, 0, 1.6, 0.4, 3.0, 0x96541e],
      [0, 1.4, -3.0, 0.7, 0.7, 0.7, 0x96541e]);                    // tail club
    mk('buggy', 'ankylosaur', 'UDP', 26, anky, { bobF: 1.8 });
    const trex = animal({ color: 0x2e3640, bw: 1.6, bh: 1.8, bl: 3.4, legH: 1.8, neckUp: 0.9, headW: 1.0, headH: 1.1, headL: 1.8, tailL: 3.0 });
    mk('suv', 't-rex', 'SSH', 34, trex, { bob: 0.2, bobF: 2.4 });
    const ptero = { boxes: [
      [0, 1.4, 0, 0.6, 0.5, 1.8, 0xd8d2c4],
      [0, 1.5, 1.3, 0.35, 0.35, 1.3, 0xd8d2c4],          // beak-head
      [0, 1.8, 0.6, 0.2, 0.5, 0.6, 0xc2baa6],            // crest
      [-2.2, 1.6, -0.2, 3.8, 0.1, 1.3, 0xb8a890], [2.2, 1.6, -0.2, 3.8, 0.1, 1.3, 0xb8a890],
    ], eyeY: 1.6, eyeZ: 0.7, eyeSpread: 0.2 };
    mk('ambulance', 'pteranodon', 'ICMP', 38, ptero, { y: 4.6, bob: 0.4, bobF: 1.6 });
    const bronto = animal({ color: 0x6e5a9e, bw: 2.4, bh: 2.2, bl: 5.4, legH: 1.8, neckUp: 3.2, headW: 0.7, headH: 0.6, headL: 1.0, tailL: 4.0 });
    mk('bus', 'brontosaurus', 'OTHER', 18, bronto, { bobF: 1.0 });
    return F;
  })(),

  magic: {
    truck: T('dragon', 'HTTPS', 'truck', 26, [
      [0, 1.6, 0, 1.6, 1.4, 4.6, 0x1f7a52],
      [0, 2.4, 2.6, 0.7, 0.9, 1.1, 0x1f7a52],
      [0, 2.5, 3.5, 0.5, 0.5, 1.0, 0x18603f],            // snout
      [0, 1.8, -3.2, 0.5, 0.5, 2.4, 0x1f7a52],           // tail
      [-2.0, 2.4, -0.3, 3.2, 0.12, 2.2, 0x2a9966], [2.0, 2.4, -0.3, 3.2, 0.12, 2.2, 0x2a9966], // wings
      [0, 2.5, 0.6, 0.25, 0.6, 1.6, 0x18603f],           // back spikes
    ], [[-0.22, 2.7, 4.0, 0.14, 0.14, 0.06, 0xffb35e], [0.22, 2.7, 4.0, 0.14, 0.14, 0.06, 0xffb35e],
        [0, 2.2, 4.05, 0.3, 0.18, 0.06, 0xff7a30]],       // fiery breath glow
      { y: 3.4, bob: 0.35, bobF: 1.2 }),
    sports: T('racing broom', 'QUIC', 'sports', 48, [
      [0, 1.0, 0.3, 0.14, 0.14, 2.6, 0x8a5a2e],
      [0, 1.0, -1.5, 0.5, 0.4, 1.0, 0xb8742e],           // bristles
      [0, 1.45, 0.2, 0.45, 0.75, 0.45, C.sports],        // rider robe
      [0, 2.05, 0.2, 0.32, 0.32, 0.32, 0xe8c8a8],        // head
    ], [[0, 1.0, 1.65, 0.2, 0.2, 0.1, EYE]], { y: 4.6, bob: 0.4, bobF: 2.4 }),
    van: T('ghost', 'HTTP', 'van', 28, [
      [0, 1.4, 0, 1.2, 1.8, 1.2, 0xe8ecf4],
      [0, 0.5, 0, 1.0, 0.6, 1.0, 0xdfe4ee],
      [0, 2.5, 0.05, 0.9, 0.7, 0.9, 0xeef2f8],
    ], [[-0.2, 2.55, 0.5, 0.16, 0.2, 0.06, 0x10141f], [0.2, 2.55, 0.5, 0.16, 0.2, 0.06, 0x10141f]],
      { y: 2.6, bob: 0.45, bobF: 1.0 }),
    car: T('flying carpet', 'TCP', 'car', 34, [
      [0, 1.0, 0, 2.0, 0.12, 3.2, C.car],
      [0, 1.06, 0, 1.5, 0.12, 2.6, 0x1e54b8],
      [0, 1.5, -0.4, 0.6, 0.8, 0.6, 0x8a5a2e],           // passenger
    ], [[0, 1.0, 1.65, 1.9, 0.1, 0.08, 0xffd24a], [0, 1.0, -1.65, 1.9, 0.1, 0.08, 0xffd24a]],
      { y: 3.6, bob: 0.35, bobF: 1.6 }),
    moto: T('golden snitch', 'DNS', 'moto', 48, [
      [0, 1.2, 0, 0.55, 0.55, 0.55, C.moto],
      [-0.65, 1.35, 0, 0.9, 0.08, 0.35, 0xf2e3b8], [0.65, 1.35, 0, 0.9, 0.08, 0.35, 0xf2e3b8],
    ], [[0, 1.2, 0.3, 0.2, 0.2, 0.06, 0xfff3c4]], { y: 4.2, bob: 0.6, bobF: 4.0 }),
    buggy: T('owl', 'UDP', 'buggy', 38, [
      [0, 1.2, 0, 0.9, 1.1, 1.0, 0xb8742e],
      [0, 1.0, 0.4, 0.7, 0.7, 0.3, 0xe2cfa8],            // chest
      [0, 2.0, 0.1, 0.7, 0.6, 0.7, 0xb8742e],
      [-1.0, 1.5, -0.1, 1.4, 0.1, 0.9, 0x96541e], [1.0, 1.5, -0.1, 1.4, 0.1, 0.9, 0x96541e],
    ], [[-0.18, 2.1, 0.46, 0.18, 0.18, 0.06, 0xffd24a], [0.18, 2.1, 0.46, 0.18, 0.18, 0.06, 0xffd24a]],
      { y: 3.8, bob: 0.4, bobF: 2.2 }),
    suv: T('night raven', 'SSH', 'suv', 40, [
      [0, 1.2, 0, 0.7, 0.7, 1.4, 0x14171f],
      [0, 1.6, 0.7, 0.45, 0.45, 0.5, 0x14171f],
      [0, 1.55, 1.05, 0.16, 0.14, 0.4, 0x3a3f4a],        // beak
      [-0.9, 1.45, -0.2, 1.3, 0.08, 0.8, 0x10141f], [0.9, 1.45, -0.2, 1.3, 0.08, 0.8, 0x10141f],
      [0, 1.2, -1.0, 0.4, 0.1, 0.8, 0x10141f],
    ], [[-0.12, 1.65, 0.95, 0.1, 0.1, 0.05, 0x9a8aff], [0.12, 1.65, 0.95, 0.1, 0.1, 0.05, 0x9a8aff]],
      { y: 4.4, bob: 0.35, bobF: 2.6 }),
    ambulance: T('phoenix', 'ICMP', 'ambulance', 42, [
      [0, 1.3, 0, 0.8, 0.8, 1.6, 0xe85d2a],
      [0, 1.8, 0.8, 0.5, 0.5, 0.6, 0xf2a03e],
      [-1.2, 1.6, -0.2, 1.8, 0.08, 1.0, 0xf2a03e], [1.2, 1.6, -0.2, 1.8, 0.08, 1.0, 0xf2a03e],
      [0, 1.3, -1.3, 0.5, 0.1, 1.4, 0xe85d2a],
    ], [[0, 1.25, -2.0, 0.4, 0.25, 0.1, 0xffd24a], [-0.14, 1.9, 1.12, 0.1, 0.1, 0.05, 0xfff3c4],
        [0.14, 1.9, 1.12, 0.1, 0.1, 0.05, 0xfff3c4]], { y: 4.0, bob: 0.45, bobF: 1.8 }),
    bus: T('flying galleon', 'OTHER', 'bus', 20, [
      ...hull(C.bus, 7.6, 2.4, 1.2),
      [0, 3.4, 0.4, 0.12, 3.4, 0.12, 0x8a5a2e],
      [0.02, 3.7, -0.6, 0.06, 2.4, 1.7, 0xd8cfe8],       // sail
      [0, 1.9, -3.4, 1.0, 1.0, 0.9, 0x6d28d9],           // stern castle
    ], [[-1.0, 1.7, 2.0, 0.2, 0.2, 0.1, 0xffd24a], [1.0, 1.7, 2.0, 0.2, 0.2, 0.1, 0xffd24a],
        [0, 2.2, -3.85, 0.5, 0.3, 0.08, 0xffb35e]], { y: 3.2, bob: 0.3, bobF: 0.8 }),
  },

  christmas: {
    truck: T('gift sled', 'HTTPS', 'truck', 24, [
      [0, 0.5, 0, 2.0, 0.5, 4.6, 0x0c6e54],
      [-0.95, 0.25, 0, 0.18, 0.35, 4.8, 0x9a7a3e], [0.95, 0.25, 0, 0.18, 0.35, 4.8, 0x9a7a3e],
      [-0.4, 1.2, 0.6, 1.0, 1.0, 1.0, 0xc2543a], [0.5, 1.1, -0.8, 0.8, 0.8, 0.8, 0x3f7fb8],
      [0.1, 1.9, 0.4, 0.7, 0.7, 0.7, 0xc7a44a],
    ], [[0, 0.6, 2.4, 0.6, 0.25, 0.08, EYE]], { bob: 0.06, bobF: 2.0 }),
    sports: T("santa's sleigh", 'QUIC', 'sports', 46, [
      [0, 0.8, -0.8, 1.4, 0.8, 2.4, C.sports],
      [0, 1.3, -1.7, 1.3, 0.8, 0.5, 0xb91c1c],           // seat back
      [0, 1.5, -0.9, 0.6, 0.7, 0.6, 0xb91c1c],           // santa
      [0, 2.05, -0.9, 0.35, 0.4, 0.35, 0xe8c8a8],
      [-0.75, 0.35, -0.8, 0.15, 0.3, 2.8, 0xc7a44a], [0.75, 0.35, -0.8, 0.15, 0.3, 2.8, 0xc7a44a],
      [0, 0.9, 1.6, 0.9, 0.9, 1.6, 0x8a6f5e],            // reindeer
      [0, 1.7, 2.3, 0.5, 0.6, 0.6, 0x8a6f5e],
      [-0.3, 2.2, 2.3, 0.5, 0.4, 0.1, 0x6e573e], [0.3, 2.2, 2.3, 0.5, 0.4, 0.1, 0x6e573e],
    ], [[0, 1.55, 2.62, 0.18, 0.18, 0.08, 0xff3344]],     // glowing red nose
      { y: 1.8, bob: 0.3, bobF: 1.6 }),
    van: T('snowman', 'HTTP', 'van', 26, [
      [0, 0.7, 0, 1.4, 1.3, 1.4, 0xeef2f8],
      [0, 1.8, 0, 1.0, 1.0, 1.0, 0xe8ecf4],
      [0, 2.7, 0, 0.75, 0.75, 0.75, 0xeef2f8],
      [0, 3.25, 0, 0.55, 0.45, 0.55, 0x14171f],          // top hat
      [0, 2.65, 0.42, 0.14, 0.14, 0.4, C.buggy],          // carrot
    ], [[-0.16, 2.85, 0.4, 0.1, 0.1, 0.05, 0x10141f], [0.16, 2.85, 0.4, 0.1, 0.1, 0.05, 0x10141f]],
      { bob: 0.1, bobF: 2.4 }),
    car: T('skating elf', 'TCP', 'car', 36, [
      [0, 1.0, 0, 0.7, 1.0, 0.5, C.car],
      [0, 1.75, 0, 0.4, 0.4, 0.4, 0xe8c8a8],
      [0, 2.15, 0, 0.3, 0.45, 0.3, 0x1e54b8],            // pointy hat
      [-0.2, 0.25, 0.1, 0.15, 0.5, 0.9, 0x9aa3b0], [0.2, 0.25, 0.1, 0.15, 0.5, 0.9, 0x9aa3b0],
    ], [[0, 2.42, 0, 0.14, 0.14, 0.14, 0xffd24a]], { bob: 0.15, bobF: 3.2 }),
    moto: T('gingerbread man', 'DNS', 'moto', 40, [
      [0, 1.0, 0, 0.9, 1.0, 0.35, 0xb8742e],
      [0, 1.8, 0, 0.55, 0.55, 0.35, 0xb8742e],
      [-0.6, 1.25, 0, 0.5, 0.2, 0.3, 0xb8742e], [0.6, 1.25, 0, 0.5, 0.2, 0.3, 0xb8742e],
      [-0.25, 0.3, 0, 0.25, 0.6, 0.3, 0xb8742e], [0.25, 0.3, 0, 0.25, 0.6, 0.3, 0xb8742e],
    ], [[-0.12, 1.9, 0.2, 0.1, 0.1, 0.05, 0xfff3c4], [0.12, 1.9, 0.2, 0.1, 0.1, 0.05, 0xfff3c4],
        [0, 1.05, 0.2, 0.12, 0.12, 0.05, 0xff3344]], { bob: 0.18, bobF: 4.0 }),
    buggy: T('reindeer', 'UDP', 'buggy', 38, (() => {
      const r = animal({ color: 0x9a6e4a, bw: 1.0, bh: 1.0, bl: 2.2, legH: 1.2, neckUp: 0.7, headW: 0.5, headH: 0.55, headL: 0.8 });
      r.boxes.push([-0.4, 3.5, 1.3, 0.7, 0.55, 0.12, 0x6e573e], [0.4, 3.5, 1.3, 0.7, 0.55, 0.12, 0x6e573e]);
      return r.boxes;
    })(), [[0, 3.0, 1.85, 0.16, 0.16, 0.08, 0xff3344]], { bob: 0.2, bobF: 3.6 }),
    suv: T('nutcracker', 'SSH', 'suv', 28, [
      [0, 1.1, 0, 0.9, 1.3, 0.6, 0x232c3d],
      [0, 0.25, 0, 0.8, 0.5, 0.5, 0x14171f],
      [0, 2.1, 0, 0.6, 0.7, 0.55, 0xe8c8a8],
      [0, 2.75, 0, 0.65, 0.6, 0.6, 0x14171f],            // tall hat
      [0, 1.55, 0.31, 0.95, 0.18, 0.05, 0xc7a44a],       // gold belt
    ], [[-0.15, 2.2, 0.3, 0.1, 0.1, 0.05, 0x6d8cff], [0.15, 2.2, 0.3, 0.1, 0.1, 0.05, 0x6d8cff]],
      { bob: 0.08, bobF: 2.0 }),
    ambulance: T('angel', 'ICMP', 'ambulance', 40, [
      [0, 1.2, 0, 0.8, 1.4, 0.6, 0xeef2f8],
      [0, 2.2, 0, 0.4, 0.4, 0.4, 0xe8c8a8],
      [-0.8, 1.6, -0.2, 1.1, 0.7, 0.1, 0xdfe4ee], [0.8, 1.6, -0.2, 1.1, 0.7, 0.1, 0xdfe4ee],
    ], [[0, 2.62, 0, 0.5, 0.08, 0.5, 0xffd24a]],          // halo
      { y: 2.6, bob: 0.35, bobF: 1.4 }),
    bus: T('polar tram', 'OTHER', 'bus', 22,
      [...loco(C.bus, 8.0, 2.0, false), [0, 3.2, 0, 0.1, 0.5, 6.0, 0x6d28d9]],
      [[-1.01, 1.8, 0, 0.06, 0.6, 6.4, 0xffe3a8], [1.01, 1.8, 0, 0.06, 0.6, 6.4, 0xffe3a8],
       [0, 1.3, 4.05, 0.7, 0.35, 0.06, EYE]], { bob: 0.05, bobF: 1.6 }),
  },

  subs: {
    truck: T('cargo submarine', 'HTTPS', 'truck', 22, [
      [0, 1.4, 0, 2.2, 1.8, 7.8, 0x0c6e54],
      [0, 1.4, 4.2, 1.6, 1.3, 1.0, 0x0a5a44],
      [0, 2.8, 0.8, 0.9, 1.1, 1.8, C.truck],             // sail
      [0, 1.4, -4.2, 0.12, 1.6, 0.8, 0x0a5a44],
    ], [[-0.6, 1.4, 4.75, 0.25, 0.25, 0.06, EYE], [0.6, 1.4, 4.75, 0.25, 0.25, 0.06, EYE]],
      { y: 1.0, bob: 0.2, bobF: 0.9 }),
    sports: T('torpedo runner', 'QUIC', 'sports', 46, [
      [0, 1.2, 0, 0.9, 0.9, 4.0, C.sports],
      [0, 1.2, 2.2, 0.6, 0.6, 0.6, 0xb91c1c],
      [0, 1.9, -0.6, 0.4, 0.5, 0.9, 0xb91c1c],
      [0, 1.2, -2.2, 0.1, 1.1, 0.6, 0xb91c1c],
    ], [[0, 1.2, 2.55, 0.3, 0.3, 0.06, 0x7dd3fc]], { y: 1.4, bob: 0.25, bobF: 1.8 }),
    van: T('bathysphere', 'HTTP', 'van', 24, [
      [0, 1.3, 0, 1.8, 1.8, 1.8, C.van],
      [0, 2.4, 0, 0.7, 0.5, 0.7, 0xb9c2d4],
      [0, 0.25, 0, 1.2, 0.4, 1.2, 0x9aa3b0],
    ], [[-0.4, 1.4, 0.92, 0.4, 0.4, 0.06, 0x7dd3fc], [0.4, 1.4, 0.92, 0.4, 0.4, 0.06, 0x7dd3fc]],
      { y: 1.2, bob: 0.3, bobF: 1.2 }),
    car: T('attack sub', 'TCP', 'car', 32, [
      [0, 1.2, 0, 1.4, 1.3, 5.6, C.car],
      [0, 1.2, 3.0, 1.0, 0.9, 0.8, 0x1e54b8],
      [0, 2.3, 0.6, 0.6, 0.9, 1.3, 0x1e54b8],
      [0, 1.2, -3.0, 0.1, 1.3, 0.7, 0x1e54b8],
    ], [[0, 1.3, 3.45, 0.4, 0.25, 0.06, EYE]], { y: 1.2, bob: 0.2, bobF: 1.0 }),
    moto: T('ROV drone', 'DNS', 'moto', 42, [
      [0, 1.1, 0, 0.8, 0.6, 1.1, C.moto],
      [-0.5, 1.45, 0, 0.25, 0.15, 0.5, 0x4a5568], [0.5, 1.45, 0, 0.25, 0.15, 0.5, 0x4a5568],
    ], [[-0.2, 1.1, 0.6, 0.2, 0.2, 0.06, 0x7dd3fc], [0.2, 1.1, 0.6, 0.2, 0.2, 0.06, 0x7dd3fc]],
      { y: 1.8, bob: 0.35, bobF: 2.4 }),
    buggy: T('sea rover', 'UDP', 'buggy', 30, [
      [0, 1.0, 0, 1.4, 0.9, 2.4, C.buggy],
      [0, 1.7, 0.4, 0.9, 0.6, 1.0, GLASS],
      [-0.85, 0.5, 0, 0.3, 0.5, 2.0, DARK], [0.85, 0.5, 0, 0.3, 0.5, 2.0, DARK],
    ], [[-0.4, 1.1, 1.25, 0.25, 0.2, 0.06, EYE], [0.4, 1.1, 1.25, 0.25, 0.2, 0.06, EYE]],
      { y: 0.8, bob: 0.15, bobF: 1.4 }),
    suv: T('stealth sub', 'SSH', 'suv', 36, [
      [0, 1.2, 0, 1.5, 0.9, 5.0, C.suv],
      [0, 1.9, 0.4, 0.7, 0.7, 1.4, 0x2e3950],
      [0, 1.2, -2.7, 0.1, 1.1, 0.6, 0x2e3950],
    ], [[0, 1.2, 2.55, 0.4, 0.2, 0.06, 0x6d8cff]], { y: 1.4, bob: 0.15, bobF: 0.8 }),
    ambulance: T('rescue DSRV', 'ICMP', 'ambulance', 36, [
      [0, 1.3, 0, 1.5, 1.3, 4.0, C.ambulance],
      [0, 1.3, 0, 1.55, 0.35, 4.05, 0xdc2626],
      [0, 2.2, 0.4, 0.7, 0.6, 1.0, C.ambulance],
    ], [[-0.4, 2.5, 0.4, 0.35, 0.15, 0.35, 0xff3344], [0.4, 2.5, 0.4, 0.35, 0.15, 0.35, 0x3b82f6],
        [0, 1.3, 2.05, 0.5, 0.3, 0.06, 0x7dd3fc]], { y: 1.3, bob: 0.25, bobF: 1.3 }),
    bus: T('leviathan sub', 'OTHER', 'bus', 20, [
      [0, 1.5, 0, 2.4, 2.0, 9.0, C.bus],
      [0, 1.5, 4.9, 1.7, 1.5, 1.0, 0x6d28d9],
      [0, 3.1, 1.0, 1.0, 1.2, 2.2, 0x6d28d9],
      [0, 1.5, -4.9, 0.12, 2.0, 1.0, 0x6d28d9],
    ], [[-1.21, 1.6, 1.0, 0.06, 0.5, 6.0, 0x9a8ac8], [1.21, 1.6, 1.0, 0.06, 0.5, 6.0, 0x9a8ac8],
        [0, 1.6, 5.45, 0.6, 0.4, 0.06, 0x7dd3fc]], { y: 1.2, bob: 0.15, bobF: 0.7 }),
  },

  balloons: {
    truck: T('cargo zeppelin', 'HTTPS', 'truck', 20, [
      [0, 4.0, 0, 2.6, 2.4, 7.8, 0x0c6e54],
      [0, 4.4, 0, 2.0, 1.7, 8.8, C.truck],
      [0, 2.2, 0.4, 1.1, 1.0, 2.8, 0x0a5a44],
      [0, 4.9, -4.2, 0.1, 1.4, 1.0, 0x0a5a44],
    ], [[0, 2.1, 1.85, 0.7, 0.3, 0.08, EYE]], { y: 2.4, bob: 0.15, bobF: 0.6 }),
    sports: T('racing glider', 'QUIC', 'sports', 44, [
      [0, 1.0, 0, 0.6, 0.5, 3.2, C.sports],
      [0, 1.2, 0.8, 0.45, 0.4, 1.0, GLASS],
      [0, 1.0, 0, 7.0, 0.1, 1.0, 0xb91c1c],
      [0, 1.5, -1.5, 0.08, 0.9, 0.6, 0xb91c1c],
    ], [[0, 1.0, 1.65, 0.25, 0.2, 0.08, EYE]], { y: 5.4, bob: 0.35, bobF: 1.2 }),
    van: T('cloud balloon', 'HTTP', 'van', 22, balloon(C.van, 1.9),
      [[0, 0.85, 0.5, 0.5, 0.25, 0.08, EYE]], { y: 3.4, bob: 0.3, bobF: 0.8 }),
    car: T('sky balloon', 'TCP', 'car', 24, balloon(C.car, 1.7),
      [[0, 0.85, 0.5, 0.5, 0.25, 0.08, EYE]], { y: 3.0, bob: 0.32, bobF: 0.9 }),
    moto: T('box kite', 'DNS', 'moto', 40, [
      [0, 1.4, 0, 1.0, 0.9, 0.5, C.moto],
      [0, 1.4, -0.9, 1.0, 0.9, 0.4, 0xf2c94c],
      [0, 0.6, -1.6, 0.06, 1.4, 0.06, 0xd8d2c4],          // tail string
    ], [[0, 1.4, 0.3, 0.2, 0.2, 0.08, EYE]], { y: 5.0, bob: 0.55, bobF: 2.2 }),
    buggy: T('paraglider', 'UDP', 'buggy', 34, [
      [0, 2.4, 0, 3.6, 0.18, 1.2, C.buggy],
      [0, 1.0, 0, 0.5, 0.8, 0.5, 0x4a5568],
      [-0.8, 1.7, 0, 0.06, 1.4, 0.06, 0x9aa3b0], [0.8, 1.7, 0, 0.06, 1.4, 0.06, 0x9aa3b0],
    ], [[0, 1.0, 0.3, 0.2, 0.2, 0.08, EYE]], { y: 4.4, bob: 0.4, bobF: 1.5 }),
    suv: T('night dirigible', 'SSH', 'suv', 26, [
      [0, 3.6, 0, 2.0, 1.8, 6.0, C.suv],
      [0, 1.9, 0.2, 0.9, 0.8, 2.0, 0x14171f],
    ], [[0, 1.8, 1.25, 0.5, 0.25, 0.08, 0x6d8cff]], { y: 3.0, bob: 0.18, bobF: 0.7 }),
    ambulance: T('rescue balloon', 'ICMP', 'ambulance', 28, (() => {
      const b = balloon(C.ambulance, 1.8);
      b.push([0, 4.2, 1.45, 2.6, 0.5, 0.1, 0xdc2626]);   // red band
      return b;
    })(), [[-0.3, 0.95, 0.5, 0.3, 0.15, 0.3, 0xff3344], [0.3, 0.95, 0.5, 0.3, 0.15, 0.3, 0x3b82f6]],
      { y: 3.4, bob: 0.3, bobF: 1.0 }),
    bus: T('grand montgolfier', 'OTHER', 'bus', 18, (() => {
      const b = balloon(C.bus, 2.6, 0x553f2a);
      b.push([0, 4.4, 2.0, 3.4, 0.6, 0.12, 0x6d28d9]);
      return b;
    })(), [[0, 1.0, 0.65, 0.6, 0.3, 0.08, 0xffb35e]], { y: 3.8, bob: 0.25, bobF: 0.6 }),
  },

  lightcycles: {
    truck: cycle('truck', 5.4, 24, 'data hauler', 'HTTPS'),
    sports: cycle('sports', 3.4, 50, 'light cycle', 'QUIC'),
    van: cycle('van', 3.8, 28, 'transport pod', 'HTTP'),
    car: cycle('car', 3.2, 34, 'cycle', 'TCP'),
    moto: cycle('moto', 2.2, 48, 'mini cycle', 'DNS'),
    buggy: cycle('buggy', 2.8, 38, 'runner', 'UDP'),
    suv: cycle('suv', 3.6, 32, 'heavy cycle', 'SSH'),
    ambulance: cycle('ambulance', 3.4, 38, 'medic pod', 'ICMP'),
    bus: cycle('bus', 6.4, 22, 'transit pod', 'OTHER'),
  },

  karts: {
    truck: kart('truck', 3.0, 21, 'cargo kart', 'HTTPS'),
    sports: kart('sports', 2.2, 46, 'racing kart', 'QUIC'),
    van: kart('van', 2.6, 28, 'box kart', 'HTTP'),
    car: kart('car', 2.2, 32, 'go-kart', 'TCP'),
    moto: kart('moto', 1.6, 44, 'mini kart', 'DNS'),
    buggy: kart('buggy', 2.0, 36, 'buggy kart', 'UDP'),
    suv: kart('suv', 2.4, 30, 'heavy kart', 'SSH'),
    ambulance: kart('ambulance', 2.4, 38, 'medic kart', 'ICMP'),
    bus: kart('bus', 3.6, 22, 'party kart', 'OTHER'),
  },

  armor: {
    truck: armorUnit('truck', 2.6, 5.0, 20, 'battle tank', 'HTTPS', true),
    sports: armorUnit('sports', 1.8, 3.6, 46, 'attack buggy', 'QUIC', false),
    van: armorUnit('van', 2.2, 4.4, 26, 'APC', 'HTTP', false),
    car: armorUnit('car', 2.0, 4.0, 32, 'recon jeep', 'TCP', false),
    moto: armorUnit('moto', 1.2, 2.6, 48, 'scout bike', 'DNS', false),
    buggy: armorUnit('buggy', 1.8, 3.4, 34, 'light buggy', 'UDP', false),
    suv: armorUnit('suv', 2.2, 4.4, 30, 'armored SUV', 'SSH', false),
    ambulance: armorUnit('ambulance', 2.2, 4.2, 34, 'field ambulance', 'ICMP', false),
    bus: armorUnit('bus', 2.6, 6.0, 20, 'troop transport', 'OTHER', false),
  },

  minecarts: {
    truck: minecart('truck', 4.4, 22, 'cargo cart', 'HTTPS'), sports: minecart('sports', 2.6, 46, 'rail racer', 'QUIC'),
    van: minecart('van', 3.2, 28, 'supply cart', 'HTTP'), car: minecart('car', 2.8, 32, 'minecart', 'TCP'),
    moto: minecart('moto', 1.8, 46, 'rail trolley', 'DNS'), buggy: minecart('buggy', 2.6, 36, 'ore cart', 'UDP'),
    suv: minecart('suv', 3.0, 30, 'iron cart', 'SSH'), ambulance: minecart('ambulance', 3.0, 36, 'cleric cart', 'ICMP'),
    bus: minecart('bus', 5.2, 22, 'mine wagon', 'OTHER'),
  },
  chariots: {
    truck: chariot('truck', 4.4, 24, 'war chariot', 'HTTPS'), sports: chariot('sports', 3.4, 48, 'racing biga', 'QUIC'),
    van: chariot('van', 3.8, 28, 'cargo chariot', 'HTTP'), car: chariot('car', 3.6, 32, 'chariot', 'TCP'),
    moto: chariot('moto', 3.0, 46, 'light biga', 'DNS'), buggy: chariot('buggy', 3.4, 36, 'courier chariot', 'UDP'),
    suv: chariot('suv', 3.8, 30, 'heavy chariot', 'SSH'), ambulance: chariot('ambulance', 3.6, 38, 'medic chariot', 'ICMP'),
    bus: chariot('bus', 4.8, 22, 'quadriga', 'OTHER'),
  },
  wagons: {
    truck: wagon('truck', 4.8, 20, 'merchant wagon', 'HTTPS'), sports: wagon('sports', 3.4, 42, 'fast cart', 'QUIC'),
    van: wagon('van', 4.0, 26, 'covered cart', 'HTTP'), car: wagon('car', 3.6, 30, 'horse cart', 'TCP'),
    moto: wagon('moto', 2.8, 42, 'pony trap', 'DNS'), buggy: wagon('buggy', 3.4, 34, 'hay cart', 'UDP'),
    suv: wagon('suv', 3.8, 28, 'ox cart', 'SSH'), ambulance: wagon('ambulance', 3.8, 32, 'healer wagon', 'ICMP'),
    bus: wagon('bus', 5.6, 20, 'caravan', 'OTHER'),
  },
  warrigs: {
    truck: warrig('truck', 6.0, 22, 'war rig', 'HTTPS'), sports: warrig('sports', 3.6, 48, 'interceptor', 'QUIC'),
    van: warrig('van', 4.2, 28, 'scrap hauler', 'HTTP'), car: warrig('car', 3.8, 34, 'muscle car', 'TCP'),
    moto: warrig('moto', 2.6, 48, 'chopper', 'DNS'), buggy: warrig('buggy', 3.4, 38, 'dune buggy', 'UDP'),
    suv: warrig('suv', 4.4, 30, 'gunner', 'SSH'), ambulance: warrig('ambulance', 4.0, 36, 'medic rig', 'ICMP'),
    bus: warrig('bus', 6.6, 20, 'doof wagon', 'OTHER'),
  },
  rovers: {
    truck: rover('truck', 4.6, 20, 'cargo rover', 'HTTPS'), sports: rover('sports', 3.2, 42, 'scout rover', 'QUIC'),
    van: rover('van', 3.8, 26, 'hab rover', 'HTTP'), car: rover('car', 3.4, 30, 'rover', 'TCP'),
    moto: rover('moto', 2.4, 42, 'mini rover', 'DNS'), buggy: rover('buggy', 3.2, 34, 'survey buggy', 'UDP'),
    suv: rover('suv', 3.8, 28, 'presser rover', 'SSH'), ambulance: rover('ambulance', 3.6, 32, 'med rover', 'ICMP'),
    bus: rover('bus', 5.2, 20, 'crew transport', 'OTHER'),
  },
  bugs: {
    truck: bug('truck', 3.8, 22, 'stag beetle', 'HTTPS'), sports: bug('sports', 2.4, 48, 'firefly', 'QUIC'),
    van: bug('van', 3.0, 28, 'shell-back', 'HTTP'), car: bug('car', 2.6, 34, 'beetle', 'TCP'),
    moto: bug('moto', 1.8, 48, 'gnat', 'DNS'), buggy: bug('buggy', 2.4, 38, 'roach', 'UDP'),
    suv: bug('suv', 3.0, 30, 'weevil', 'SSH'), ambulance: bug('ambulance', 2.8, 36, 'glow-bug', 'ICMP'),
    bus: bug('bus', 4.4, 22, 'beetle-queen', 'OTHER'),
  },
  vintage: {
    truck: jalopy('truck', 4.0, 22, 'delivery truck', 'HTTPS'), sports: jalopy('sports', 3.0, 46, 'roadster', 'QUIC'),
    van: jalopy('van', 3.4, 28, 'panel van', 'HTTP'), car: jalopy('car', 3.0, 32, 'jalopy', 'TCP'),
    moto: jalopy('moto', 2.2, 44, 'putt-putt', 'DNS'), buggy: jalopy('buggy', 2.8, 36, 'runabout', 'UDP'),
    suv: jalopy('suv', 3.2, 30, 'sedan', 'SSH'), ambulance: jalopy('ambulance', 3.2, 38, 'ambulance', 'ICMP'),
    bus: jalopy('bus', 5.0, 22, 'omnibus', 'OTHER'),
  },
  crystalpods: {
    truck: crystalPod('truck', 4.2, 24, 'crystal barge', 'HTTPS'), sports: crystalPod('sports', 2.8, 48, 'shard racer', 'QUIC'),
    van: crystalPod('van', 3.2, 28, 'prism pod', 'HTTP'), car: crystalPod('car', 3.0, 34, 'crystal pod', 'TCP'),
    moto: crystalPod('moto', 2.0, 48, 'spark', 'DNS'), buggy: crystalPod('buggy', 2.6, 38, 'facet', 'UDP'),
    suv: crystalPod('suv', 3.2, 32, 'geode', 'SSH'), ambulance: crystalPod('ambulance', 3.0, 38, 'lumen pod', 'ICMP'),
    bus: crystalPod('bus', 5.0, 22, 'monolith', 'OTHER'),
  },

  supercars: carFleet({ roof: 'cabin', bodyH: 0.42, spoiler: true, lenK: 1.05 },
    ['transporter', 'hypercar', 'GT wagon', 'sport sedan', 'superbike', 'hot hatch', 'grand tourer', 'pace car', 'autocoach']),
  convertibles: carFleet({ roof: 'open', bodyH: 0.5 },
    ['woody wagon', 'speedster', 'beach van', 'convertible', 'scooter', 'dune cabrio', 'cruiser', 'lifeguard', 'open-top bus']),
  retro80s: carFleet({ roof: 'open', bodyH: 0.46, underglow: 0xff5ec8 },
    ['cargo cruiser', 'testa coupe', 'party van', 'vice coupe', 'neon bike', 'beach buggy', 'lowrider', 'medic cruiser', 'disco bus']),
  noir: carFleet({ roof: 'tall', bodyH: 0.6, lenK: 1.08 },
    ['armored hauler', 'muscle coupe', 'blackout van', 'noir sedan', 'night bike', 'prowler', 'heavy sedan', 'medic wagon', 'transit']),
  couriers: carFleet({ roof: 'cabin', bodyH: 0.5, lenK: 0.9 },
    ['parcel truck', 'courier', 'delivery van', 'runner', 'dispatch bike', 'quick buggy', 'service SUV', 'medic van', 'shuttle']),
  taxis: carFleet({ roof: 'cabin', bodyH: 0.55, sign: 0xf0c000 },
    ['cargo cab', 'express cab', 'shuttle cab', 'taxi', 'moto cab', 'tuk-tuk', 'SUV cab', 'medi-cab', 'city bus']),

  spinners: {
    truck: spinner('truck', 5.2, 24, 'cargo spinner', 'HTTPS'), sports: spinner('sports', 3.6, 50, 'pursuit spinner', 'QUIC'),
    van: spinner('van', 4.2, 28, 'transit spinner', 'HTTP'), car: spinner('car', 4.0, 34, 'spinner', 'TCP'),
    moto: spinner('moto', 2.8, 48, 'jet bike', 'DNS'), buggy: spinner('buggy', 3.6, 38, 'drone car', 'UDP'),
    suv: spinner('suv', 4.4, 30, 'enforcer', 'SSH'), ambulance: spinner('ambulance', 4.0, 38, 'medivac', 'ICMP'),
    bus: spinner('bus', 6.2, 22, 'sky bus', 'OTHER'),
  },
  snowmobiles: {
    truck: snowmobile('truck', 4.0, 22, 'snow hauler', 'HTTPS'), sports: snowmobile('sports', 2.6, 48, 'race sled', 'QUIC'),
    van: snowmobile('van', 3.2, 28, 'supply sled', 'HTTP'), car: snowmobile('car', 2.8, 34, 'snowmobile', 'TCP'),
    moto: snowmobile('moto', 2.0, 48, 'ski-doo', 'DNS'), buggy: snowmobile('buggy', 2.6, 38, 'trail sled', 'UDP'),
    suv: snowmobile('suv', 3.2, 30, 'piste tracker', 'SSH'), ambulance: snowmobile('ambulance', 3.0, 38, 'ski patrol', 'ICMP'),
    bus: snowmobile('bus', 4.6, 22, 'snowcat', 'OTHER'),
  },
  safari: {
    truck: safari('truck', 4.6, 22, 'safari truck', 'HTTPS'), sports: safari('sports', 3.4, 46, 'chase jeep', 'QUIC'),
    van: safari('van', 4.0, 28, 'tour van', 'HTTP'), car: safari('car', 3.6, 32, 'safari jeep', 'TCP'),
    moto: safari('moto', 2.6, 46, 'trail bike', 'DNS'), buggy: safari('buggy', 3.4, 36, 'bush buggy', 'UDP'),
    suv: safari('suv', 4.2, 30, 'ranger 4x4', 'SSH'), ambulance: safari('ambulance', 3.8, 36, 'vet jeep', 'ICMP'),
    bus: safari('bus', 5.6, 22, 'tour bus', 'OTHER'),
  },
  stagecoaches: {
    truck: stagecoach('truck', 5.0, 20, 'freight coach', 'HTTPS'), sports: stagecoach('sports', 3.6, 42, 'pony express', 'QUIC'),
    van: stagecoach('van', 4.2, 26, 'mail coach', 'HTTP'), car: stagecoach('car', 3.8, 30, 'stagecoach', 'TCP'),
    moto: stagecoach('moto', 3.0, 44, 'lone rider', 'DNS'), buggy: stagecoach('buggy', 3.6, 34, 'buckboard', 'UDP'),
    suv: stagecoach('suv', 4.2, 28, 'armored coach', 'SSH'), ambulance: stagecoach('ambulance', 4.0, 32, 'doc wagon', 'ICMP'),
    bus: stagecoach('bus', 5.6, 20, 'wagon train', 'OTHER'),
  },
  silhouette: {
    truck: silhouetteCar('truck', 5.2, 22, 'hauler', 'HTTPS'), sports: silhouetteCar('sports', 4.0, 48, 'coupe', 'QUIC'),
    van: silhouetteCar('van', 4.4, 28, 'van', 'HTTP'), car: silhouetteCar('car', 4.2, 32, 'car', 'TCP'),
    moto: silhouetteCar('moto', 2.6, 46, 'cycle', 'DNS'), buggy: silhouetteCar('buggy', 3.6, 36, 'buggy', 'UDP'),
    suv: silhouetteCar('suv', 4.6, 30, 'wagon', 'SSH'), ambulance: silhouetteCar('ambulance', 4.4, 38, 'ambulance', 'ICMP'),
    bus: silhouetteCar('bus', 7.0, 22, 'bus', 'OTHER'),
  },
  skiffs: {
    truck: skiff('truck', 4.4, 24, 'cargo skiff', 'HTTPS'), sports: skiff('sports', 3.0, 48, 'sand surfer', 'QUIC'),
    van: skiff('van', 3.6, 28, 'glider', 'HTTP'), car: skiff('car', 3.2, 34, 'skiff', 'TCP'),
    moto: skiff('moto', 2.2, 48, 'sand dart', 'DNS'), buggy: skiff('buggy', 3.0, 38, 'drifter', 'UDP'),
    suv: skiff('suv', 3.6, 32, 'barge skiff', 'SSH'), ambulance: skiff('ambulance', 3.4, 38, 'light skiff', 'ICMP'),
    bus: skiff('bus', 5.2, 22, 'pilgrim barge', 'OTHER'),
  },
  abstract: {
    truck: abstractShape('truck', 3.0, 24, 'monolith', 'HTTPS'), sports: abstractShape('sports', 2.2, 46, 'prism', 'QUIC'),
    van: abstractShape('van', 2.6, 28, 'cube', 'HTTP'), car: abstractShape('car', 2.4, 32, 'block', 'TCP'),
    moto: abstractShape('moto', 1.8, 46, 'shard', 'DNS'), buggy: abstractShape('buggy', 2.2, 36, 'wedge', 'UDP'),
    suv: abstractShape('suv', 2.6, 30, 'pillar', 'SSH'), ambulance: abstractShape('ambulance', 2.4, 38, 'beacon', 'ICMP'),
    bus: abstractShape('bus', 3.4, 22, 'totem', 'OTHER'),
  },
  celbuggies: {
    truck: celbuggy('truck', 5.0, 22, 'gun truck', 'HTTPS'), sports: celbuggy('sports', 3.4, 48, 'outrunner', 'QUIC'),
    van: celbuggy('van', 4.0, 28, 'tech van', 'HTTP'), car: celbuggy('car', 3.6, 34, 'cel buggy', 'TCP'),
    moto: celbuggy('moto', 2.6, 48, 'sand bike', 'DNS'), buggy: celbuggy('buggy', 3.4, 38, 'dune runner', 'UDP'),
    suv: celbuggy('suv', 4.2, 30, 'bandit 4x4', 'SSH'), ambulance: celbuggy('ambulance', 3.8, 36, 'medkit buggy', 'ICMP'),
    bus: celbuggy('bus', 6.0, 22, 'caravan', 'OTHER'),
  },
  minimal: {
    truck: minimalCar('truck', 3.6, 22, 'long', 'HTTPS'), sports: minimalCar('sports', 2.6, 48, 'fast', 'QUIC'),
    van: minimalCar('van', 3.0, 28, 'box', 'HTTP'), car: minimalCar('car', 2.8, 32, 'dot', 'TCP'),
    moto: minimalCar('moto', 1.8, 46, 'mini', 'DNS'), buggy: minimalCar('buggy', 2.6, 36, 'round', 'UDP'),
    suv: minimalCar('suv', 3.0, 30, 'chunk', 'SSH'), ambulance: minimalCar('ambulance', 2.8, 38, 'medic', 'ICMP'),
    bus: minimalCar('bus', 4.4, 22, 'wide', 'OTHER'),
  },
};
