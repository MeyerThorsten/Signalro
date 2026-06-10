// Procedural low-poly vehicles. Each type is defined as a list of colored
// boxes (merged into one geometry, lit with vertex colors) plus "glow" boxes
// (headlights, taillights, light bars) rendered unlit so they shine at night.
//
// Vehicles face +Z. Dimensions in world units; lanes are 3.5 wide.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const WHEEL = 0x0c1322;
const GLASS = 0x101c33;
const HEAD = 0xfff3c4; // headlights
const TAIL = 0xff4438; // taillights

// box: [cx, cy, cz, w, h, l, color]
function wheels(positions, w = 0.28, d = 0.62) {
  return positions.map(([x, z]) => [x, d / 2, z, w, d, d, WHEEL]);
}

export const VEHICLE_TYPES = {
  car: { // generic TCP — blue sedan
    label: 'sedan', proto: 'TCP', color: 0x3b82f6, speed: 30,
    boxes: [
      [0, 0.62, 0, 1.8, 0.55, 4.2, 0x3b82f6],
      [0, 1.08, -0.15, 1.6, 0.5, 2.1, GLASS],
      ...wheels([[-0.85, 1.35], [0.85, 1.35], [-0.85, -1.35], [0.85, -1.35]]),
    ],
    glow: [
      [-0.55, 0.62, 2.12, 0.4, 0.18, 0.06, HEAD], [0.55, 0.62, 2.12, 0.4, 0.18, 0.06, HEAD],
      [-0.6, 0.62, -2.12, 0.45, 0.16, 0.06, TAIL], [0.6, 0.62, -2.12, 0.45, 0.16, 0.06, TAIL],
    ],
  },
  sports: { // QUIC — red sports car
    label: 'sports car', proto: 'QUIC', color: 0xef4444, speed: 44,
    boxes: [
      [0, 0.48, -0.3, 1.9, 0.42, 3.2, 0xef4444],
      [0, 0.42, 1.6, 1.8, 0.3, 1.4, 0xef4444],
      [0, 0.82, -0.5, 1.5, 0.36, 1.5, GLASS],
      [0, 0.78, -1.85, 1.7, 0.12, 0.35, 0xb91c1c], // spoiler
      ...wheels([[-0.88, 1.25], [0.88, 1.25], [-0.88, -1.2], [0.88, -1.2]], 0.3, 0.58),
    ],
    glow: [
      [-0.6, 0.45, 2.28, 0.35, 0.12, 0.06, HEAD], [0.6, 0.45, 2.28, 0.35, 0.12, 0.06, HEAD],
      [0, 0.52, -1.95, 1.5, 0.1, 0.06, TAIL],
    ],
  },
  van: { // HTTP — pale delivery van
    label: 'delivery van', proto: 'HTTP', color: 0xd7dde9, speed: 26,
    boxes: [
      [0, 1.05, -0.45, 2.0, 1.55, 3.4, 0xd7dde9],
      [0, 0.85, 1.85, 2.0, 1.15, 1.2, 0xb9c2d4],
      [0, 1.35, 1.6, 1.8, 0.55, 0.7, GLASS],
      ...wheels([[-0.92, 1.5], [0.92, 1.5], [-0.92, -1.4], [0.92, -1.4]]),
    ],
    glow: [
      [-0.62, 0.6, 2.46, 0.38, 0.16, 0.06, HEAD], [0.62, 0.6, 2.46, 0.38, 0.16, 0.06, HEAD],
      [-0.7, 0.7, -2.16, 0.4, 0.18, 0.06, TAIL], [0.7, 0.7, -2.16, 0.4, 0.18, 0.06, TAIL],
    ],
  },
  truck: { // HTTPS — semi with container trailer
    label: 'semi truck', proto: 'HTTPS', color: 0x10b981, speed: 21,
    boxes: [
      [0, 1.15, 3.5, 2.2, 1.9, 2.0, 0x047857],            // cab
      [0, 1.7, 2.95, 2.0, 0.8, 0.8, GLASS],               // windshield
      [0, 1.62, -0.9, 2.4, 2.5, 6.4, 0x10b981],           // container
      [0, 0.5, 1.3, 0.9, 0.5, 2.2, 0x1f2937],             // chassis link
      ...wheels([[-1.0, 3.9], [1.0, 3.9], [-1.0, 1.0], [1.0, 1.0],
                 [-1.0, -2.6], [1.0, -2.6], [-1.0, -3.5], [1.0, -3.5]], 0.3, 0.72),
    ],
    glow: [
      [-0.7, 0.7, 4.52, 0.42, 0.18, 0.06, HEAD], [0.7, 0.7, 4.52, 0.42, 0.18, 0.06, HEAD],
      [-0.85, 0.7, -4.12, 0.45, 0.2, 0.06, TAIL], [0.85, 0.7, -4.12, 0.45, 0.2, 0.06, TAIL],
      [0, 2.95, 3.5, 1.6, 0.1, 0.1, 0xffb347],            // cab marker lights
    ],
  },
  moto: { // DNS — amber motorcycle
    label: 'motorcycle', proto: 'DNS', color: 0xfbbf24, speed: 48,
    boxes: [
      [0, 0.62, 0, 0.42, 0.4, 1.9, 0xfbbf24],
      [0, 1.05, -0.25, 0.42, 0.55, 0.6, 0x1f2937], // rider
      [0, 1.45, -0.25, 0.34, 0.3, 0.34, 0x111827], // helmet
      [0, 0.36, 0.95, 0.16, 0.72, 0.72, WHEEL],
      [0, 0.36, -0.85, 0.16, 0.72, 0.72, WHEEL],
    ],
    glow: [
      [0, 0.72, 1.0, 0.18, 0.18, 0.08, HEAD],
      [0, 0.6, -1.0, 0.16, 0.14, 0.06, TAIL],
    ],
  },
  buggy: { // generic UDP — orange hatchback
    label: 'hatchback', proto: 'UDP', color: 0xf97316, speed: 34,
    boxes: [
      [0, 0.55, 0.1, 1.65, 0.5, 3.0, 0xf97316],
      [0, 1.0, -0.25, 1.5, 0.5, 1.7, GLASS],
      ...wheels([[-0.78, 1.0], [0.78, 1.0], [-0.78, -1.0], [0.78, -1.0]], 0.26, 0.56),
    ],
    glow: [
      [-0.5, 0.55, 1.62, 0.34, 0.16, 0.06, HEAD], [0.5, 0.55, 1.62, 0.34, 0.16, 0.06, HEAD],
      [-0.52, 0.62, -1.42, 0.36, 0.16, 0.06, TAIL], [0.52, 0.62, -1.42, 0.36, 0.16, 0.06, TAIL],
    ],
  },
  suv: { // SSH — black SUV
    label: 'black SUV', proto: 'SSH', color: 0x232c3d, speed: 32,
    boxes: [
      [0, 0.78, 0, 1.9, 0.85, 4.4, 0x232c3d],
      [0, 1.42, -0.3, 1.7, 0.6, 2.6, GLASS],
      ...wheels([[-0.9, 1.45], [0.9, 1.45], [-0.9, -1.45], [0.9, -1.45]], 0.3, 0.7),
    ],
    glow: [
      [-0.58, 0.78, 2.22, 0.4, 0.16, 0.06, HEAD], [0.58, 0.78, 2.22, 0.4, 0.16, 0.06, HEAD],
      [-0.62, 0.85, -2.22, 0.42, 0.18, 0.06, TAIL], [0.62, 0.85, -2.22, 0.42, 0.18, 0.06, TAIL],
    ],
  },
  ambulance: { // ICMP — ambulance with light bar
    label: 'ambulance', proto: 'ICMP', color: 0xf8fafc, speed: 38,
    boxes: [
      [0, 1.1, -0.4, 2.0, 1.6, 3.4, 0xf8fafc],
      [0, 0.85, 1.8, 2.0, 1.1, 1.1, 0xe2e8f0],
      [0, 1.32, 1.55, 1.8, 0.5, 0.6, GLASS],
      [0, 1.1, -0.4, 2.04, 0.34, 3.42, 0xdc2626],  // red stripe
      ...wheels([[-0.92, 1.45], [0.92, 1.45], [-0.92, -1.35], [0.92, -1.35]]),
    ],
    glow: [
      [-0.62, 0.58, 2.36, 0.38, 0.16, 0.06, HEAD], [0.62, 0.58, 2.36, 0.38, 0.16, 0.06, HEAD],
      [-0.35, 2.0, 0.4, 0.5, 0.18, 0.35, 0xff3344],  // light bar red
      [0.35, 2.0, 0.4, 0.5, 0.18, 0.35, 0x3b82f6],   // light bar blue
      [-0.7, 0.7, -2.12, 0.4, 0.18, 0.06, TAIL], [0.7, 0.7, -2.12, 0.4, 0.18, 0.06, TAIL],
    ],
  },
  bus: { // other/unknown — purple bus
    label: 'bus', proto: 'OTHER', color: 0x8b5cf6, speed: 22,
    boxes: [
      [0, 1.3, 0, 2.2, 2.1, 8.5, 0x8b5cf6],
      ...wheels([[-1.0, 2.9], [1.0, 2.9], [-1.0, -2.9], [1.0, -2.9]], 0.3, 0.72),
    ],
    glow: [
      [-1.11, 1.55, 0, 0.06, 0.5, 7.0, 0x7c6aa8],   // window strips (soft)
      [1.11, 1.55, 0, 0.06, 0.5, 7.0, 0x7c6aa8],
      [-0.7, 0.7, 4.28, 0.42, 0.18, 0.06, HEAD], [0.7, 0.7, 4.28, 0.42, 0.18, 0.06, HEAD],
      [-0.8, 0.7, -4.28, 0.45, 0.2, 0.06, TAIL], [0.8, 0.7, -4.28, 0.45, 0.2, 0.06, TAIL],
    ],
  },
};

// Maps server-side protocol classification to a vehicle type key.
export const PROTO_TO_TYPE = {
  https: 'truck',
  http: 'van',
  quic: 'sports',
  tcp: 'car',
  dns: 'moto',
  udp: 'buggy',
  ssh: 'suv',
  icmp: 'ambulance',
  other: 'bus',
};

function buildMerged(boxes) {
  const geos = boxes.map(([x, y, z, w, h, l, color]) => {
    const g = new THREE.BoxGeometry(w, h, l);
    g.translate(x, y, z);
    const c = new THREE.Color(color);
    const count = g.attributes.position.count;
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    return g;
  });
  const merged = mergeGeometries(geos);
  geos.forEach((g) => g.dispose());
  return merged;
}

// Builds { body: InstancedMesh, glow: InstancedMesh } per type, for any
// fleet's type table (defaults to the car fleet).
export function buildVehicleMeshes(types = VEHICLE_TYPES, capacity = 256) {
  const bodyMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const glowMat = new THREE.MeshBasicMaterial({ vertexColors: true });
  const meshes = {};
  for (const [key, def] of Object.entries(types)) {
    const body = new THREE.InstancedMesh(buildMerged(def.boxes), bodyMat, capacity);
    const glow = new THREE.InstancedMesh(buildMerged(def.glow), glowMat, capacity);
    body.frustumCulled = false;
    glow.frustumCulled = false;
    body.count = 0;
    glow.count = 0;
    meshes[key] = { body, glow };
  }
  return meshes;
}
