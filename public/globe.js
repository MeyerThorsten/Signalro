// Globe view: an alternate visualization that plots traffic as glowing arcs on
// a 3D GeoIP globe, from a home point to active destination countries. Shares
// the live data with the highway; it's a different lens on the same flows.
//
// Self-contained: its own scene / camera / controls, rendered to the shared
// canvas when globe mode is active.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const R = 5;
const HOME = [48, 11]; // approximate home location (central Europe)

function llToVec(lat, lng, r = R) {
  const phi = (90 - lat) * Math.PI / 180;
  const th = (lng + 180) * Math.PI / 180;
  return new THREE.Vector3(
    -r * Math.sin(phi) * Math.cos(th),
    r * Math.cos(phi),
    r * Math.sin(phi) * Math.sin(th),
  );
}

function buildGraticule() {
  const g = new THREE.Group();
  const mat = new THREE.LineBasicMaterial({ color: 0x2a5f96, transparent: true, opacity: 0.28 });
  for (let lat = -60; lat <= 60; lat += 30) {
    const pts = [];
    for (let lng = -180; lng <= 180; lng += 6) pts.push(llToVec(lat, lng, R * 1.003));
    g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), mat));
  }
  for (let lng = -180; lng < 180; lng += 30) {
    const pts = [];
    for (let lat = -90; lat <= 90; lat += 6) pts.push(llToVec(lat, lng, R * 1.003));
    g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), mat));
  }
  return g;
}

function starfield() {
  const n = 800, pos = new Float32Array(n * 3);
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let i = 0; i < n; i++) {
    const th = rnd() * Math.PI * 2, ph = Math.acos(2 * rnd() - 1), r = 60 + rnd() * 30;
    pos[i * 3] = r * Math.sin(ph) * Math.cos(th);
    pos[i * 3 + 1] = r * Math.sin(ph) * Math.sin(th);
    pos[i * 3 + 2] = r * Math.cos(ph);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  return new THREE.Points(geo, new THREE.PointsMaterial({ color: 0x9fb4e8, size: 0.6, sizeAttenuation: true }));
}

export function createGlobe(renderer) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x05080f);

  const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 300);
  camera.position.set(2, 5, 16);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 8;
  controls.maxDistance = 44;
  controls.enablePan = false;
  controls.enabled = false; // toggled with globe mode

  scene.add(new THREE.AmbientLight(0x8aa6d8, 0.9));
  const dl = new THREE.DirectionalLight(0xffffff, 0.7);
  dl.position.set(8, 5, 6);
  scene.add(dl);
  scene.add(starfield());

  // Everything that should rotate together lives under `world`.
  const world = new THREE.Group();
  scene.add(world);

  const globe = new THREE.Mesh(
    new THREE.SphereGeometry(R, 48, 48),
    new THREE.MeshPhongMaterial({ color: 0x123a66, emissive: 0x06101f, shininess: 12 }),
  );
  world.add(globe);
  world.add(buildGraticule());

  const home = new THREE.Mesh(
    new THREE.SphereGeometry(0.13, 14, 14),
    new THREE.MeshBasicMaterial({ color: 0x7dd3fc }),
  );
  home.position.copy(llToVec(HOME[0], HOME[1], R * 1.01));
  world.add(home);

  const arcsGroup = new THREE.Group();
  world.add(arcsGroup);
  let pulses = [];

  function dispose(obj) {
    obj.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
  }

  // countries: [{ lat, lng, bytes, color }]
  function setArcs(countries) {
    dispose(arcsGroup);
    arcsGroup.clear();
    pulses = [];
    const homeV = llToVec(HOME[0], HOME[1], R);
    const maxBytes = Math.max(1, ...countries.map((c) => c.bytes));
    for (const c of countries) {
      const dest = llToVec(c.lat, c.lng, R);
      const lift = R + homeV.distanceTo(dest) * 0.45;
      const mid = homeV.clone().add(dest).normalize().multiplyScalar(lift);
      const curve = new THREE.QuadraticBezierCurve3(homeV, mid, dest);
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(curve.getPoints(44)),
        new THREE.LineBasicMaterial({ color: c.color, transparent: true, opacity: 0.45 }),
      );
      arcsGroup.add(line);
      const r = 0.07 + (c.bytes / maxBytes) * 0.16;
      const dot = new THREE.Mesh(new THREE.SphereGeometry(r, 12, 12), new THREE.MeshBasicMaterial({ color: c.color }));
      dot.position.copy(dest);
      arcsGroup.add(dot);
      const pulse = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 8), new THREE.MeshBasicMaterial({ color: c.color }));
      arcsGroup.add(pulse);
      pulses.push({ curve, mesh: pulse, t: Math.random(), speed: 0.25 + Math.random() * 0.35 });
    }
  }

  function update(dt) {
    controls.update();
    world.rotation.y += dt * 0.03;
    for (const p of pulses) {
      p.t = (p.t + dt * p.speed) % 1;
      p.mesh.position.copy(p.curve.getPoint(p.t));
    }
  }

  function resize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  }

  function setEnabled(on) { controls.enabled = on; }

  return { scene, camera, controls, setArcs, update, resize, setEnabled };
}

// Country centroids for the regions in geoip.json (cc -> [lat, lng]).
export const CC_LATLNG = {
  US: [38, -97], DE: [51, 10], FR: [46, 2], FI: [64, 26], GB: [54, -2],
  PL: [52, 19], NL: [52, 5], IE: [53, -8], SG: [1.3, 103.8], JP: [36, 138],
  CA: [56, -106], AU: [-25, 133], BR: [-14, -51], IN: [21, 78],
};
