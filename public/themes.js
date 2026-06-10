// Scene themes: each theme builds the surroundings (lighting, ground, road
// dressing, props, sky) around the fixed highway layout. Movie-inspired
// themes are original low-poly evocations, not copies of film assets.
//
// A theme is { label, bg, fog: [color, near, far], build(ctx) } where build
// may return an animate(dt) hook for moving props (rain, snow, turbines...).
// ctx = { g: THREE.Group, rng, C: layout constants }.

import * as THREE from 'three';

export function mulberry32(seed) {
  let a = seed;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Small builders (all add into ctx.g)
// ---------------------------------------------------------------------------
const mat = (c) => new THREE.MeshLambertMaterial({ color: c });
const bmat = (c) => new THREE.MeshBasicMaterial({ color: c });

function box(ctx, w, h, l, color, x, y, z, ry = 0, basic = false) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, l), basic ? bmat(color) : mat(color));
  m.position.set(x, y, z);
  if (ry) m.rotation.y = ry;
  ctx.g.add(m);
  return m;
}

function addLights(ctx, { sky, ground, hemi = 1.5, sun = 0x9fb4ff, sunInt = 1.0, sunPos = [40, 60, 20] }) {
  ctx.g.add(new THREE.HemisphereLight(sky, ground, hemi));
  const dir = new THREE.DirectionalLight(sun, sunInt);
  dir.position.set(...sunPos);
  ctx.g.add(dir);
}

function addGround(ctx, color, size = 600) {
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(size, size), mat(color));
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(0, -0.05, -70);
  ctx.g.add(ground);
}

function addRoad(ctx, { asphalt, dash, edge, median, rail = null, dashLen = 3, dashEvery = 9 }) {
  const { ROAD_HALF_W, Z_NEAR, Z_FAR, MEDIAN_HALF } = ctx.C;
  const L = Z_NEAR - Z_FAR + 30;
  const zMid = (Z_NEAR + Z_FAR) / 2;

  if (asphalt != null) {
    const road = new THREE.Mesh(new THREE.PlaneGeometry(ROAD_HALF_W * 2, L), mat(asphalt));
    road.rotation.x = -Math.PI / 2;
    road.position.set(0, 0, zMid);
    ctx.g.add(road);
  }

  const dashMat = bmat(dash);
  const dashGeo = new THREE.BoxGeometry(0.16, 0.02, dashLen);
  for (const bx of [4.25, 7.75, 11.25, 14.75]) {
    for (const side of [-1, 1]) {
      for (let z = Z_FAR; z < Z_NEAR; z += dashEvery) {
        const d = new THREE.Mesh(dashGeo, dashMat);
        d.position.set(side * bx, 0.01, z);
        ctx.g.add(d);
      }
    }
  }
  const edgeMat = bmat(edge);
  for (const ex of [MEDIAN_HALF + 0.35, ROAD_HALF_W - 0.6]) {
    for (const side of [-1, 1]) {
      const line = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.02, L), edgeMat);
      line.position.set(side * ex, 0.01, zMid);
      ctx.g.add(line);
    }
  }
  if (median) box(ctx, MEDIAN_HALF * 2 * 0.6, 0.9, L, median, 0, 0.45, zMid);
  if (rail) {
    for (const side of [-1, 1]) {
      box(ctx, 0.25, 0.55, L, rail, side * (ROAD_HALF_W + 0.4), 0.75, zMid);
    }
  }
}

function addLamps(ctx, { pole = 0x2a3450, head = 0xffd98a, pool = 0x33405e, poolOpacity = 0.28 }) {
  const { ROAD_HALF_W, Z_NEAR, Z_FAR } = ctx.C;
  const poleMat = mat(pole);
  const headMat = bmat(head);
  const poolMat = new THREE.MeshBasicMaterial({
    color: pool, transparent: true, opacity: poolOpacity,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const poolGeo = new THREE.CircleGeometry(7, 24);
  const addPool = (x, z) => {
    const p = new THREE.Mesh(poolGeo, poolMat);
    p.rotation.x = -Math.PI / 2;
    p.position.set(x, 0.02, z);
    ctx.g.add(p);
  };
  for (let z = Z_FAR + 10; z < Z_NEAR; z += 32) {
    const c = new THREE.Mesh(new THREE.BoxGeometry(0.28, 7.5, 0.28), poleMat);
    c.position.set(0, 3.75, z);
    ctx.g.add(c);
    for (const side of [-1, 1]) {
      const arm = new THREE.Mesh(new THREE.BoxGeometry(5.4, 0.16, 0.16), poleMat);
      arm.position.set(side * 2.7, 7.3, z);
      ctx.g.add(arm);
      const head1 = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.18, 0.45), headMat);
      head1.position.set(side * 5.2, 7.18, z);
      ctx.g.add(head1);
      addPool(side * 6, z);
      const c2 = new THREE.Mesh(new THREE.BoxGeometry(0.26, 7.0, 0.26), poleMat);
      c2.position.set(side * (ROAD_HALF_W + 0.9), 3.5, z + 16);
      ctx.g.add(c2);
      const arm2 = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.16, 0.16), poleMat);
      arm2.position.set(side * (ROAD_HALF_W - 0.9), 6.85, z + 16);
      ctx.g.add(arm2);
      const head2 = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.18, 0.45), headMat);
      head2.position.set(side * (ROAD_HALF_W - 2.5), 6.74, z + 16);
      ctx.g.add(head2);
      addPool(side * (ROAD_HALF_W - 4), z + 16);
    }
  }
}

function addStars(ctx, { count = 700, color = 0xaebbe8, size = 1.4, full = false } = {}) {
  const pos = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const theta = ctx.rng() * Math.PI * 2;
    const phi = ctx.rng() * Math.PI * (full ? 1 : 0.45);
    const r = 480;
    pos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    pos[i * 3 + 1] = full ? r * Math.cos(phi) : r * Math.cos(phi) * 0.6 + 30;
    pos[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta) - 70;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  ctx.g.add(new THREE.Points(geo, new THREE.PointsMaterial({
    color, size, sizeAttenuation: false, fog: false,
  })));
}

function addSkyDisc(ctx, { color, r, x, y, z, glowColor = null }) {
  const s = new THREE.Mesh(new THREE.SphereGeometry(r, 20, 14),
    new THREE.MeshBasicMaterial({ color, fog: false }));
  s.position.set(x, y, z);
  ctx.g.add(s);
  if (glowColor) {
    const halo = new THREE.Mesh(new THREE.SphereGeometry(r * 1.6, 20, 14),
      new THREE.MeshBasicMaterial({
        color: glowColor, fog: false, transparent: true, opacity: 0.3,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }));
    halo.position.set(x, y, z);
    ctx.g.add(halo);
  }
}

function addCloud(ctx, x, y, z, scale, color = 0xffffff) {
  const m = new THREE.MeshBasicMaterial({ color, fog: false, transparent: true, opacity: 0.85 });
  for (let i = 0; i < 4; i++) {
    const s = new THREE.Mesh(new THREE.SphereGeometry(3 + ctx.rng() * 3, 8, 6), m);
    s.position.set(x + (ctx.rng() - 0.5) * 14, y + (ctx.rng() - 0.5) * 2, z + (ctx.rng() - 0.5) * 8);
    s.scale.y = 0.45;
    s.scale.multiplyScalar(scale);
    ctx.g.add(s);
  }
}

function addBoxCity(ctx, { count, near, spread, color, zSpread = 240, litColor = null, litDensity = 0.3, hMin = 6, hMax = 32, edgeGlow = null }) {
  const { Z_FAR } = ctx.C;
  const cityMat = mat(color);
  for (let i = 0; i < count; i++) {
    const side = ctx.rng() < 0.5 ? -1 : 1;
    const w = 6 + ctx.rng() * 14;
    const h = hMin + ctx.rng() * (hMax - hMin);
    const d = 6 + ctx.rng() * 14;
    const x = side * (near + ctx.rng() * spread);
    const z = Z_FAR + ctx.rng() * zSpread;
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), cityMat);
    b.position.set(x, h / 2, z);
    ctx.g.add(b);
    if (litColor && ctx.rng() < litDensity) {
      const strip = new THREE.Mesh(new THREE.BoxGeometry(w * 0.15, h * (0.4 + ctx.rng() * 0.5), 0.3),
        bmat(litColor));
      strip.position.set(x + (ctx.rng() - 0.5) * w * 0.6, h * 0.5, z + d / 2 + 0.2);
      ctx.g.add(strip);
    }
    if (edgeGlow) {
      const e = new THREE.Mesh(new THREE.BoxGeometry(w + 0.4, 0.35, d + 0.4), bmat(edgeGlow));
      e.position.set(x, h, z);
      ctx.g.add(e);
    }
  }
}

function addPalm(ctx, x, z, h = 7) {
  const lean = (ctx.rng() - 0.5) * 0.25;
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.3, h, 6), mat(0x7a5b3a));
  trunk.position.set(x, h / 2, z);
  trunk.rotation.z = lean;
  ctx.g.add(trunk);
  const top = new THREE.Vector3(x - Math.sin(lean) * h * 0.5, h - 0.2, z);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + ctx.rng();
    const frond = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.08, 3.4), mat(0x2f9e44));
    frond.position.set(top.x + Math.cos(a) * 1.4, top.y, top.z + Math.sin(a) * 1.4);
    frond.rotation.y = -a + Math.PI / 2;
    frond.rotation.x = 0.35;
    ctx.g.add(frond);
  }
}

function addPine(ctx, x, z, h = 8, color = 0x1d4d2b, snow = false) {
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.25, h * 0.3, 5), mat(0x4a3526));
  trunk.position.set(x, h * 0.15, z);
  ctx.g.add(trunk);
  for (let i = 0; i < 3; i++) {
    const r = (1.9 - i * 0.5) * (h / 8);
    const cone = new THREE.Mesh(new THREE.ConeGeometry(r, h * 0.34, 7), mat(color));
    cone.position.set(x, h * (0.32 + i * 0.24), z);
    ctx.g.add(cone);
    if (snow) {
      const cap = new THREE.Mesh(new THREE.ConeGeometry(r * 0.7, h * 0.12, 7), mat(0xe8eef5));
      cap.position.set(x, h * (0.40 + i * 0.24), z);
      ctx.g.add(cap);
    }
  }
}

function addUmbrellaPine(ctx, x, z, h = 9) {
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.32, h, 6), mat(0x5d4630));
  trunk.position.set(x, h / 2, z);
  ctx.g.add(trunk);
  const canopy = new THREE.Mesh(new THREE.SphereGeometry(h * 0.42, 8, 6), mat(0x2c5f34));
  canopy.scale.y = 0.4;
  canopy.position.set(x, h, z);
  ctx.g.add(canopy);
}

function addMesa(ctx, x, z, s = 1, color = 0xa0522d) {
  const h = (8 + ctx.rng() * 18) * s;
  const w = (10 + ctx.rng() * 22) * s;
  const m = new THREE.Mesh(new THREE.CylinderGeometry(w * 0.42, w * 0.62, h, 7), mat(color));
  m.position.set(x, h / 2 - 0.5, z);
  m.rotation.y = ctx.rng() * Math.PI;
  ctx.g.add(m);
}

function addCactus(ctx, x, z) {
  const h = 2.2 + ctx.rng() * 2;
  box(ctx, 0.5, h, 0.5, 0x2e7d32, x, h / 2, z);
  if (ctx.rng() < 0.8) {
    const side = ctx.rng() < 0.5 ? -1 : 1;
    box(ctx, 0.9, 0.4, 0.4, 0x2e7d32, x + side * 0.65, h * 0.55, z);
    box(ctx, 0.4, h * 0.4, 0.4, 0x2e7d32, x + side * 0.95, h * 0.72, z);
  }
}

function addColumn(ctx, x, z, h = 7, broken = false) {
  const ch = broken ? h * (0.3 + ctx.rng() * 0.4) : h;
  const c = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.55, ch, 8), mat(0xd9cba8));
  c.position.set(x, ch / 2, z);
  ctx.g.add(c);
  if (!broken) {
    box(ctx, 1.5, 0.35, 1.5, 0xd9cba8, x, ch + 0.18, z);
    box(ctx, 1.3, 0.3, 1.3, 0xcdbd96, x, 0.15, z);
  }
}

function addColosseum(ctx, x, z) {
  const tiers = [[26, 9], [22, 7], [18, 5]];
  for (const [r, h] of tiers) {
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(r, r + 1, h, 24, 1, true),
      new THREE.MeshLambertMaterial({ color: 0xcdb88f, side: THREE.DoubleSide }));
    ring.position.set(x, h / 2 + (26 - r), z);
    ctx.g.add(ring);
  }
  // warm arch glow dots around the lowest tier
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * Math.PI * 2;
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.6, 0.3), bmat(0xffc66b));
    lamp.position.set(x + Math.cos(a) * 26.6, 4, z + Math.sin(a) * 26.6);
    lamp.rotation.y = -a + Math.PI / 2;
    ctx.g.add(lamp);
  }
}

function addGantry(ctx, z, panelColor = 0x1b4fa0) {
  const { ROAD_HALF_W } = ctx.C;
  for (const side of [-1, 1]) {
    box(ctx, 0.5, 8.5, 0.5, 0x8a93a6, side * (ROAD_HALF_W + 1.5), 4.25, z);
  }
  box(ctx, ROAD_HALF_W * 2 + 4, 0.5, 0.5, 0x8a93a6, 0, 8.2, z);
  for (const side of [-1, 1]) {
    const panel = box(ctx, 6.5, 3.2, 0.25, panelColor, side * 9, 6.2, z, 0, true);
    const stripe = box(ctx, 5.5, 0.4, 0.05, 0xffffff, side * 9, 7.0, z - 0.16, 0, true);
    panel.renderOrder = 1; stripe.renderOrder = 2;
  }
}

function addTurbine(ctx, x, z, h = 22) {
  const tower = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.7, h, 7), mat(0xdfe5ee));
  tower.position.set(x, h / 2, z);
  ctx.g.add(tower);
  const hub = new THREE.Group();
  hub.position.set(x, h, z + 0.6);
  for (let i = 0; i < 3; i++) {
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.5, 9, 0.12), mat(0xf2f5fa));
    blade.position.y = 4.5;
    const arm = new THREE.Group();
    arm.rotation.z = (i / 3) * Math.PI * 2;
    arm.add(blade);
    hub.add(arm);
  }
  ctx.g.add(hub);
  return hub;
}

function addBillboard(ctx, x, z, ry, text, fg, bg) {
  const canvas = document.createElement('canvas');
  canvas.width = 384; canvas.height = 160;
  const c = canvas.getContext('2d');
  c.fillStyle = bg; c.fillRect(0, 0, 384, 160);
  c.strokeStyle = fg; c.lineWidth = 8; c.strokeRect(8, 8, 368, 144);
  c.fillStyle = fg;
  c.font = 'bold 56px ui-monospace, Menlo, monospace';
  c.textAlign = 'center'; c.textBaseline = 'middle';
  c.fillText(text, 192, 84);
  const tex = new THREE.CanvasTexture(canvas);
  const board = new THREE.Mesh(new THREE.PlaneGeometry(10, 4.2),
    new THREE.MeshBasicMaterial({ map: tex }));
  board.position.set(x, 8.5, z);
  board.rotation.y = ry;
  ctx.g.add(board);
  box(ctx, 0.45, 6.5, 0.45, 0x2a3450, x, 3.2, z);
}

function addBuoy(ctx, x, z, color) {
  box(ctx, 0.7, 1.1, 0.7, 0x46505e, x, 0.4, z);
  const lampM = new THREE.Mesh(new THREE.SphereGeometry(0.32, 8, 6), bmat(color));
  lampM.position.set(x, 1.25, z);
  ctx.g.add(lampM);
}

function addShip(ctx, x, z, s = 1, ry = 0.3) {
  const grp = new THREE.Group();
  const hull = new THREE.Mesh(new THREE.BoxGeometry(8, 2.4, 28), mat(0x37425a));
  hull.position.y = 1.0;
  grp.add(hull);
  const palette = [0xc2543a, 0x3f7fb8, 0x4f9e63, 0xc7a44a];
  for (let i = 0; i < 8; i++) {
    const c = new THREE.Mesh(new THREE.BoxGeometry(6.5, 1.6, 2.6),
      mat(palette[Math.floor(ctx.rng() * palette.length)]));
    c.position.set(0, 2.9 + (i % 2) * 1.6, -10 + Math.floor(i / 2) * 5.4);
    grp.add(c);
  }
  const bridge = new THREE.Mesh(new THREE.BoxGeometry(6, 4.5, 3), mat(0xdde3ec));
  bridge.position.set(0, 4.4, 11);
  grp.add(bridge);
  const lightsM = new THREE.Mesh(new THREE.BoxGeometry(5.4, 0.3, 0.1), bmat(0xfff3c4));
  lightsM.position.set(0, 5.2, 12.5);
  grp.add(lightsM);
  grp.position.set(x, 0, z);
  grp.rotation.y = ry;
  grp.scale.setScalar(s);
  ctx.g.add(grp);
}

function addLighthouse(ctx, x, z) {
  const tower = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 2.0, 16, 8), mat(0xe8e2d4));
  tower.position.set(x, 8, z);
  ctx.g.add(tower);
  box(ctx, 2.2, 1.4, 2.2, 0xb6452c, x, 16.6, z);
  const lampM = new THREE.Mesh(new THREE.SphereGeometry(0.8, 8, 6), bmat(0xfff3c4));
  lampM.position.set(x, 17.6, z);
  ctx.g.add(lampM);
}

function addVolcano(ctx, x, z, s = 1, glow = false) {
  const cone = new THREE.Mesh(new THREE.ConeGeometry(34 * s, 30 * s, 9), mat(0x2f3b33));
  cone.position.set(x, 15 * s - 0.5, z);
  ctx.g.add(cone);
  if (glow) {
    const top = new THREE.Mesh(new THREE.ConeGeometry(7 * s, 3 * s, 9),
      new THREE.MeshBasicMaterial({ color: 0xff5a2d, fog: false }));
    top.position.set(x, 30 * s - 1.5, z);
    ctx.g.add(top);
  }
}

function addDome(ctx, x, z, r, color = 0xd8d2c4) {
  const dome = new THREE.Mesh(new THREE.SphereGeometry(r, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2),
    new THREE.MeshLambertMaterial({ color, transparent: true, opacity: 0.9 }));
  dome.position.set(x, 0, z);
  ctx.g.add(dome);
  const lightM = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), bmat(0xbfe3ff));
  lightM.position.set(x, r * 0.5, z);
  ctx.g.add(lightM);
}

function addGothicTower(ctx, x, z, h) {
  const w = 7 + ctx.rng() * 7;
  box(ctx, w, h, w, 0x14171f, x, h / 2, z);
  const spire = new THREE.Mesh(new THREE.ConeGeometry(w * 0.4, h * 0.3, 4), mat(0x10131a));
  spire.position.set(x, h + h * 0.15, z);
  ctx.g.add(spire);
  for (let i = 0; i < 6; i++) {
    if (ctx.rng() < 0.6) {
      const win = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.2, 0.1), bmat(0xd9b44a));
      win.position.set(x + (ctx.rng() - 0.5) * w * 0.7, 3 + ctx.rng() * (h - 6), z + w / 2 + 0.1);
      ctx.g.add(win);
    }
  }
}

function addHill(ctx, x, z, r, doorColor) {
  const hill = new THREE.Mesh(new THREE.SphereGeometry(r, 12, 8), mat(0x4e9b47));
  hill.scale.y = 0.5;
  hill.position.set(x, -r * 0.1, z);
  ctx.g.add(hill);
  if (doorColor) {
    const door = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, 0.3, 12), bmat(doorColor));
    door.rotation.z = Math.PI / 2;
    door.rotation.y = x > 0 ? -Math.PI / 2 : Math.PI / 2;
    door.position.set(x + (x > 0 ? -r * 0.93 : r * 0.93), r * 0.22, z);
    ctx.g.add(door);
  }
}

function addBigTree(ctx, x, z, h = 16) {
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 1.4, h * 0.55, 7), mat(0x5d4630));
  trunk.position.set(x, h * 0.27, z);
  ctx.g.add(trunk);
  for (let i = 0; i < 4; i++) {
    const c = new THREE.Mesh(new THREE.SphereGeometry(h * (0.32 - i * 0.03), 9, 7), mat(0x3f8c3a));
    c.position.set(x + (ctx.rng() - 0.5) * h * 0.3, h * (0.6 + i * 0.13), z + (ctx.rng() - 0.5) * h * 0.3);
    ctx.g.add(c);
  }
}

function addFoliageWall(ctx, side, color = 0x16381f) {
  const { ROAD_HALF_W, Z_NEAR, Z_FAR } = ctx.C;
  for (let z = Z_FAR; z < Z_NEAR; z += 7) {
    const r = 4 + ctx.rng() * 5;
    const blob = new THREE.Mesh(new THREE.SphereGeometry(r, 7, 5), mat(color));
    blob.position.set(side * (ROAD_HALF_W + 4 + ctx.rng() * 6), r * 0.5, z);
    blob.scale.y = 0.75;
    ctx.g.add(blob);
  }
}

function addGrid(ctx, { color = 0x18e0ff, size = 600, div = 60 } = {}) {
  const grid = new THREE.GridHelper(size, div, color, color);
  grid.position.set(0, -0.04, -70);
  grid.material.transparent = true;
  grid.material.opacity = 0.5;
  ctx.g.add(grid);
}

function addRingStation(ctx, x, y, z, r) {
  const ring = new THREE.Mesh(new THREE.TorusGeometry(r, r * 0.07, 8, 40), mat(0xc9d2e0));
  ring.position.set(x, y, z);
  ring.rotation.x = 0.8;
  ctx.g.add(ring);
  box(ctx, r * 0.1, r * 1.9, r * 0.1, 0x9aa6b8, x, y, z);
  return ring;
}

function makeParticles(ctx, { count, color, size, area, opacity = 0.8 }) {
  const pos = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    pos[i * 3] = (ctx.rng() - 0.5) * area[0];
    pos[i * 3 + 1] = ctx.rng() * area[1];
    pos[i * 3 + 2] = (ctx.rng() - 0.5) * area[2] - 70;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const pts = new THREE.Points(geo, new THREE.PointsMaterial({
    color, size, sizeAttenuation: true, transparent: true, opacity,
  }));
  ctx.g.add(pts);
  return { pts, pos, geo, area };
}

function rainAnimator(ctx, count = 1400) {
  const p = makeParticles(ctx, { count, color: 0x8fb8d8, size: 0.5, area: [260, 80, 320], opacity: 0.55 });
  return (dt) => {
    for (let i = 0; i < count; i++) {
      p.pos[i * 3 + 1] -= 60 * dt;
      if (p.pos[i * 3 + 1] < 0) p.pos[i * 3 + 1] = p.area[1];
    }
    p.geo.attributes.position.needsUpdate = true;
  };
}

function snowAnimator(ctx, count = 1200) {
  const p = makeParticles(ctx, { count, color: 0xffffff, size: 0.7, area: [260, 60, 320], opacity: 0.9 });
  let t = 0;
  return (dt) => {
    t += dt;
    for (let i = 0; i < count; i++) {
      p.pos[i * 3 + 1] -= 6 * dt;
      p.pos[i * 3] += Math.sin(t * 1.3 + i) * dt * 1.5;
      if (p.pos[i * 3 + 1] < 0) p.pos[i * 3 + 1] = p.area[1];
    }
    p.geo.attributes.position.needsUpdate = true;
  };
}

function addCoral(ctx, x, z) {
  const palette = [0xe85d75, 0xf2a03e, 0x9a5cd9, 0x38b6a8, 0xe8c84a];
  const color = palette[Math.floor(ctx.rng() * palette.length)];
  const n = 2 + Math.floor(ctx.rng() * 3);
  for (let i = 0; i < n; i++) {
    const h = 1.2 + ctx.rng() * 2.8;
    box(ctx, 0.4 + ctx.rng() * 0.4, h, 0.4 + ctx.rng() * 0.4, color,
      x + (ctx.rng() - 0.5) * 2.4, h / 2, z + (ctx.rng() - 0.5) * 2.4, ctx.rng());
  }
}

function addKelp(ctx, x, z) {
  const h = 5 + ctx.rng() * 7;
  for (let i = 0; i < 3; i++) {
    box(ctx, 0.18, h, 0.18, 0x2a6e44, x + (ctx.rng() - 0.5) * 1.4, h / 2, z + (ctx.rng() - 0.5) * 1.4, ctx.rng());
  }
}

function bubblesAnimator(ctx, count = 500) {
  const p = makeParticles(ctx, { count, color: 0xbfe3ef, size: 0.5, area: [200, 40, 300], opacity: 0.5 });
  return (dt) => {
    for (let i = 0; i < count; i++) {
      p.pos[i * 3 + 1] += 3.5 * dt;
      if (p.pos[i * 3 + 1] > p.area[1]) p.pos[i * 3 + 1] = 0;
    }
    p.geo.attributes.position.needsUpdate = true;
  };
}

function addRails(ctx, { gravel = 0x3a3f4a, rail = 0x9aa3b0 }) {
  const { Z_NEAR, Z_FAR } = ctx.C;
  const L = Z_NEAR - Z_FAR + 30;
  const zMid = (Z_NEAR + Z_FAR) / 2;
  const LANE_CENTERS = [2.5, 6.0, 9.5, 13.0, 16.5];
  for (const lane of LANE_CENTERS) {
    for (const side of [-1, 1]) {
      box(ctx, 2.6, 0.12, L, gravel, side * lane, 0.0, zMid);
      for (const rx of [-0.75, 0.75]) {
        const r = box(ctx, 0.14, 0.14, L, rail, side * lane + rx, 0.12, zMid, 0, true);
        r.material = bmat(rail);
      }
    }
  }
}

function addAcacia(ctx, x, z, h = 8) {
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.35, h, 6), mat(0x6e573e));
  trunk.position.set(x, h / 2, z);
  trunk.rotation.z = (ctx.rng() - 0.5) * 0.2;
  ctx.g.add(trunk);
  const canopy = new THREE.Mesh(new THREE.SphereGeometry(h * 0.55, 8, 5), mat(0x5e7a36));
  canopy.scale.y = 0.22;
  canopy.position.set(x, h, z);
  ctx.g.add(canopy);
}

function addIceberg(ctx, x, z, s = 1) {
  const h = (5 + ctx.rng() * 12) * s;
  const berg = new THREE.Mesh(new THREE.ConeGeometry((4 + ctx.rng() * 6) * s, h, 5), mat(0xdce8f2));
  berg.position.set(x, h / 2 - 0.5, z);
  berg.rotation.y = ctx.rng() * Math.PI;
  ctx.g.add(berg);
}

function auroraAnimator(ctx) {
  const ribbons = [];
  for (let i = 0; i < 3; i++) {
    const ribbon = new THREE.Mesh(
      new THREE.PlaneGeometry(220 + i * 40, 26),
      new THREE.MeshBasicMaterial({
        color: i === 1 ? 0x52e8a8 : 0x38d9c8, fog: false, transparent: true,
        opacity: 0.14, blending: THREE.AdditiveBlending, depthWrite: false,
        side: THREE.DoubleSide,
      }));
    ribbon.position.set((i - 1) * 50, 70 + i * 12, -240 - i * 20);
    ribbon.rotation.x = 0.4;
    ctx.g.add(ribbon);
    ribbons.push(ribbon);
  }
  let t = 0;
  return (dt) => {
    t += dt;
    ribbons.forEach((r, i) => {
      r.material.opacity = 0.1 + 0.07 * (1 + Math.sin(t * 0.5 + i * 1.8)) * 0.5;
      r.rotation.z = Math.sin(t * 0.18 + i) * 0.12;
    });
  };
}

function addCandyPole(ctx, x, z) {
  for (let i = 0; i < 6; i++) {
    box(ctx, 0.3, 0.55, 0.3, i % 2 ? 0xe8ecf4 : 0xc2543a, x, 0.3 + i * 0.55, z, 0, true);
  }
  const lampM = new THREE.Mesh(new THREE.SphereGeometry(0.3, 8, 6), bmat(0xffe3a8));
  lampM.position.set(x, 3.6, z);
  ctx.g.add(lampM);
}

function addVent(ctx, x, z) {
  const h = 4 + ctx.rng() * 6;
  const cone = new THREE.Mesh(new THREE.ConeGeometry(1.6, h, 7), mat(0x26323e));
  cone.position.set(x, h / 2, z);
  ctx.g.add(cone);
  const glow = new THREE.Mesh(new THREE.SphereGeometry(0.5, 7, 5),
    new THREE.MeshBasicMaterial({ color: 0xff7a30, fog: false }));
  glow.position.set(x, h + 0.2, z);
  ctx.g.add(glow);
}

function addHouse(ctx, x, z, ry = 0) {
  const w = 4 + ctx.rng() * 3;
  box(ctx, w, 3, w * 0.9, 0x6e4a36, x, 1.5, z, ry);
  const roof = new THREE.Mesh(new THREE.ConeGeometry(w * 0.8, 2.2, 4), mat(0xe8ecf4));
  roof.position.set(x, 4.1, z);
  roof.rotation.y = ry + Math.PI / 4;
  ctx.g.add(roof);
  box(ctx, 0.7, 0.9, 0.1, 0xffd98a, x + w * 0.2, 1.4, z + w * 0.46, ry, true);
  box(ctx, 0.7, 0.9, 0.1, 0xffd98a, x - w * 0.2, 1.4, z + w * 0.46, ry, true);
}

// ---------------------------------------------------------------------------
// Extra prop builders for the game / art-style scenes
// ---------------------------------------------------------------------------
function addVoxelTree(ctx, x, z) {
  const h = 4 + Math.floor(ctx.rng() * 3);
  box(ctx, 1, h, 1, 0x6b4a2b, x, h / 2, z);
  const lc = ctx.rng() < 0.5 ? 0x3aa14a : 0x2e8b3e;
  for (let i = 0; i < 3; i++) box(ctx, 3 - i, 1, 3 - i, lc, x, h + 0.5 + i, z);
}
function addPipe(ctx, x, z) {
  const h = 3 + ctx.rng() * 3;
  box(ctx, 2.2, h, 2.2, 0x2ea043, x, h / 2, z);
  box(ctx, 2.7, 0.8, 2.7, 0x3fb955, x, h, z);
}
function addRadarGround(ctx, color) {
  addGround(ctx, 0x04190c);
  for (let r = 14; r < 250; r += 28) {
    const ring = new THREE.Mesh(new THREE.RingGeometry(r, r + 0.35, 64),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.28, side: THREE.DoubleSide, fog: false }));
    ring.rotation.x = -Math.PI / 2; ring.position.set(0, 0.02, -70);
    ctx.g.add(ring);
  }
  for (let i = 0; i < 30; i++) {
    const a = ctx.rng() * Math.PI * 2, r = 30 + ctx.rng() * 210;
    const blip = new THREE.Mesh(new THREE.SphereGeometry(0.6, 6, 6), bmat(ctx.rng() < 0.3 ? 0xff4438 : color));
    blip.position.set(Math.cos(a) * r, 0.5, -70 + Math.sin(a) * r);
    ctx.g.add(blip);
  }
}
function addTrenchWall(ctx, side, color) {
  const { ROAD_HALF_W, Z_NEAR, Z_FAR } = ctx.C;
  const L = Z_NEAR - Z_FAR + 30, zMid = (Z_NEAR + Z_FAR) / 2;
  box(ctx, 4, 64, L, color, side * (ROAD_HALF_W + 3), 32, zMid);
  for (let z = Z_FAR; z < Z_NEAR; z += 5) {
    box(ctx, 1.6, 1 + ctx.rng() * 4, 2, ctx.rng() < 0.5 ? 0x3a4250 : 0x2a313c, side * (ROAD_HALF_W + 0.9), 2 + ctx.rng() * 44, z);
    if (ctx.rng() < 0.18) box(ctx, 0.5, 0.5, 0.5, 0xffb35e, side * (ROAD_HALF_W + 0.7), 2 + ctx.rng() * 44, z, 0, true);
  }
}
function addSilhouetteTree(ctx, x, z, h = 10) {
  box(ctx, 0.5, h, 0.5, 0x000000, x, h / 2, z);
  for (let i = 0; i < 5; i++) {
    const a = ctx.rng() * Math.PI * 2;
    box(ctx, 0.25, 3 + ctx.rng() * 3, 0.25, 0x000000, x + Math.cos(a) * 1.5, h * 0.7 + ctx.rng() * 2, z + Math.sin(a), a);
  }
}
function addInkTree(ctx, x, z) {
  const h = 5 + ctx.rng() * 4;
  box(ctx, 0.35, h, 0.35, 0x1a1410, x, h / 2, z);
  const m = mat(0x2a2018);
  for (let i = 0; i < 4; i++) {
    const blob = new THREE.Mesh(new THREE.SphereGeometry(1.2 + ctx.rng(), 6, 5), m);
    blob.position.set(x + (ctx.rng() - 0.5) * 3, h + ctx.rng() * 2, z + (ctx.rng() - 0.5) * 2);
    blob.scale.y = 0.5; ctx.g.add(blob);
  }
}
function addDune(ctx, x, z, s, color = 0xd9a45e) {
  const d = new THREE.Mesh(new THREE.SphereGeometry(20 * s, 12, 8), mat(color));
  d.scale.y = 0.18; d.position.set(x, -2, z); ctx.g.add(d);
}
function addMonument(ctx, x, z, color) {
  const h = 6 + ctx.rng() * 10;
  box(ctx, 5, h, 5, color, x, h / 2, z);
  box(ctx, 3, 2, 3, color, x, h + 1, z);
  box(ctx, 2.4, 0.6, 2.4, 0xf0e6d2, x, h + 4, z); // floating slab
}
function addNeonArch(ctx, z, color) {
  const { ROAD_HALF_W } = ctx.C;
  for (const side of [-1, 1]) box(ctx, 0.4, 13, 0.4, color, side * (ROAD_HALF_W + 1), 6.5, z, 0, true);
  box(ctx, ROAD_HALF_W * 2 + 2, 0.4, 0.4, color, 0, 13, z, 0, true);
}
function addHexPillar(ctx, x, z, h) {
  const p = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.4, h, 6), mat(0x14110a));
  p.position.set(x, h / 2, z); ctx.g.add(p);
  const ring = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.5, 0.3, 6), bmat(0xd9a521));
  ring.position.set(x, h - 1.2, z); ctx.g.add(ring);
}
function addCrystal(ctx, x, z, s, color) {
  const c = new THREE.Mesh(new THREE.OctahedronGeometry(2.4 * s),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.7, fog: false }));
  c.position.set(x, 3 * s, z); c.scale.y = 2; ctx.g.add(c);
}
function smokeAnimator(ctx, count = 280, color = 0x3a3a3a) {
  const p = makeParticles(ctx, { count, color, size: 3.2, area: [260, 55, 320], opacity: 0.16 });
  return (dt) => {
    for (let i = 0; i < count; i++) { p.pos[i * 3 + 1] += 4 * dt; if (p.pos[i * 3 + 1] > p.area[1]) p.pos[i * 3 + 1] = 0; }
    p.geo.attributes.position.needsUpdate = true;
  };
}

// ---------------------------------------------------------------------------
// Themes
// ---------------------------------------------------------------------------
export const THEMES = {
  night: {
    label: 'Night Highway',
    bg: 0x0b1020, fog: [0x0b1020, 90, 280],
    build(ctx) {
      addLights(ctx, { sky: 0x52679e, ground: 0x131b30, hemi: 1.5 });
      addGround(ctx, 0x0d1426);
      addRoad(ctx, { asphalt: 0x232e47, dash: 0x9aa7c4, edge: 0x7c8db3, median: 0x2b3650, rail: 0x39456a });
      addLamps(ctx, {});
      addBoxCity(ctx, { count: 90, near: 58, spread: 90, color: 0x1c2745 });
      addStars(ctx, {});
    },
  },

  hawaii: {
    label: 'Hawaii Coast',
    bg: 0xf2906c, fog: [0xf2906c, 120, 340],
    build(ctx) {
      const { ROAD_HALF_W, Z_FAR } = ctx.C;
      addLights(ctx, { sky: 0xffd2a8, ground: 0x4a5a4a, hemi: 1.7, sun: 0xffb05e, sunInt: 1.3, sunPos: [-60, 24, -120] });
      addGround(ctx, 0xe0c89a); // sand
      // ocean on both sides past the beach
      for (const side of [-1, 1]) {
        const sea = new THREE.Mesh(new THREE.PlaneGeometry(220, 600), mat(0x1d6e8c));
        sea.rotation.x = -Math.PI / 2;
        sea.position.set(side * (ROAD_HALF_W + 140), -0.02, -70);
        ctx.g.add(sea);
      }
      addRoad(ctx, { asphalt: 0x3a3f4a, dash: 0xe8e2d0, edge: 0xd8d2c0, median: 0x6e6250, rail: 0x8a7a5e });
      addSkyDisc(ctx, { color: 0xffd27d, r: 16, x: -120, y: 38, z: -260, glowColor: 0xff9a4d });
      for (let i = 0; i < 46; i++) {
        const side = ctx.rng() < 0.5 ? -1 : 1;
        addPalm(ctx, side * (ROAD_HALF_W + 4 + ctx.rng() * 28), Z_FAR + ctx.rng() * 300, 6 + ctx.rng() * 4);
      }
      addVolcano(ctx, 90, Z_FAR - 60, 1.6, false);
      addCloud(ctx, -60, 52, -220, 1.4, 0xffc9a3);
      addCloud(ctx, 80, 58, -260, 1.8, 0xffd9b8);
      addStars(ctx, { count: 120, color: 0xffe7c9 });
    },
  },

  autobahn: {
    label: 'German Autobahn',
    bg: 0xb9c4cf, fog: [0xb9c4cf, 130, 380],
    build(ctx) {
      const { ROAD_HALF_W, Z_FAR } = ctx.C;
      addLights(ctx, { sky: 0xdde4ea, ground: 0x55604f, hemi: 2.2, sun: 0xf4f7fa, sunInt: 0.8, sunPos: [30, 80, 40] });
      addGround(ctx, 0x57754a); // fields
      addRoad(ctx, { asphalt: 0x4a505c, dash: 0xe8ecf2, edge: 0xdfe4ec, median: 0x9aa3b0, rail: 0xaab3c0 });
      for (const z of [-30, -110, -190]) addGantry(ctx, z);
      for (let i = 0; i < 36; i++) {
        const side = ctx.rng() < 0.5 ? -1 : 1;
        addPine(ctx, side * (ROAD_HALF_W + 10 + ctx.rng() * 60), Z_FAR + ctx.rng() * 290, 7 + ctx.rng() * 5, 0x29543a);
      }
      const hubs = [];
      for (let i = 0; i < 6; i++) {
        const side = i % 2 ? -1 : 1;
        hubs.push(addTurbine(ctx, side * (70 + ctx.rng() * 60), Z_FAR + 20 + ctx.rng() * 220));
      }
      addCloud(ctx, -40, 60, -240, 2, 0xe9eef3);
      addCloud(ctx, 70, 66, -200, 1.6, 0xe2e8ee);
      return (dt) => { for (const h of hubs) h.rotation.z += dt * 1.6; };
    },
  },

  bigcity: {
    label: 'Vice City',
    bg: 0x2a1140, fog: [0x2a1140, 100, 300],
    build(ctx) {
      const { ROAD_HALF_W, Z_FAR } = ctx.C;
      addLights(ctx, { sky: 0xb05a9e, ground: 0x1a1030, hemi: 1.4, sun: 0xff8ac2, sunInt: 0.7, sunPos: [-40, 50, -60] });
      addGround(ctx, 0x171028);
      addRoad(ctx, { asphalt: 0x262338, dash: 0xc9b8e8, edge: 0xb8a8d8, median: 0x3a2f55, rail: 0x4a3f68 });
      addLamps(ctx, { head: 0xffb8e0, pool: 0x4a2a5e });
      addBoxCity(ctx, { count: 70, near: 28, spread: 60, color: 0x241b3e, hMin: 14, hMax: 46, litColor: 0xff5ec8, litDensity: 0.75 });
      addBoxCity(ctx, { count: 40, near: 90, spread: 80, color: 0x1c1533, hMin: 20, hMax: 60, litColor: 0x35d2e8, litDensity: 0.5 });
      addBillboard(ctx, -(ROAD_HALF_W + 8), -50, 0.5, 'VICE', '#ff5ec8', '#1a0f2e');
      addBillboard(ctx, ROAD_HALF_W + 8, -110, -0.5, 'MALIBU', '#35d2e8', '#160d28');
      addBillboard(ctx, -(ROAD_HALF_W + 8), -170, 0.5, 'SIGNALRO', '#ffd24a', '#1a0f2e');
      for (let i = 0; i < 14; i++) {
        const side = ctx.rng() < 0.5 ? -1 : 1;
        addPalm(ctx, side * (ROAD_HALF_W + 3 + ctx.rng() * 4), Z_FAR + 20 + ctx.rng() * 260, 6 + ctx.rng() * 3);
      }
      addSkyDisc(ctx, { color: 0xff9ad2, r: 13, x: -80, y: 30, z: -250, glowColor: 0xff5ec8 });
      addStars(ctx, { count: 200 });
    },
  },

  ocean: {
    label: 'Open Ocean',
    fleet: 'boats',
    bg: 0x081626, fog: [0x081626, 110, 330],
    build(ctx) {
      const { ROAD_HALF_W, Z_NEAR, Z_FAR } = ctx.C;
      addLights(ctx, { sky: 0x3d5a78, ground: 0x0a1828, hemi: 1.4, sun: 0xbcd2f0, sunInt: 0.9, sunPos: [50, 70, -30] });
      addGround(ctx, 0x0c2438); // open water
      addRoad(ctx, { asphalt: 0x103048, dash: 0xbfe3ef, edge: 0x77b8cc, median: null, rail: null, dashLen: 1.2, dashEvery: 14 });
      // nautical buoy lines: red left (port), green right (starboard)
      for (let z = Z_FAR; z < Z_NEAR; z += 24) {
        addBuoy(ctx, -(ROAD_HALF_W + 1.5), z, 0xff4438);
        addBuoy(ctx, ROAD_HALF_W + 1.5, z, 0x39d98a);
        addBuoy(ctx, 0, z + 12, 0xffd24a);
      }
      addShip(ctx, -70, -160, 1.4, 0.4);
      addShip(ctx, 85, -90, 1.1, -0.25);
      addShip(ctx, -110, -40, 0.9, 0.15);
      addLighthouse(ctx, 60, -230);
      addSkyDisc(ctx, { color: 0xe8eef9, r: 10, x: 70, y: 52, z: -240, glowColor: 0x9fb4d8 });
      addStars(ctx, { count: 500 });
    },
  },

  rome: {
    label: 'Roman Holiday',
    fleet: 'chariots',
    bg: 0xd9a05e, fog: [0xd9a05e, 110, 320],
    build(ctx) {
      const { ROAD_HALF_W, Z_FAR } = ctx.C;
      addLights(ctx, { sky: 0xffd9a0, ground: 0x5a4a38, hemi: 1.7, sun: 0xffc06a, sunInt: 1.2, sunPos: [-50, 30, -80] });
      addGround(ctx, 0xb09468);
      addRoad(ctx, { asphalt: 0x55504a, dash: 0xe0d6c2, edge: 0xd0c6b2, median: 0x7a6e58, rail: 0x8a7e68 });
      addColosseum(ctx, -75, -130);
      for (let i = 0; i < 16; i++) {
        const side = ctx.rng() < 0.5 ? -1 : 1;
        addColumn(ctx, side * (ROAD_HALF_W + 4 + ctx.rng() * 10), Z_FAR + 20 + ctx.rng() * 260, 6 + ctx.rng() * 3, ctx.rng() < 0.4);
      }
      for (let i = 0; i < 18; i++) {
        const side = ctx.rng() < 0.5 ? -1 : 1;
        addUmbrellaPine(ctx, side * (ROAD_HALF_W + 14 + ctx.rng() * 50), Z_FAR + ctx.rng() * 280, 8 + ctx.rng() * 4);
      }
      addBoxCity(ctx, { count: 30, near: 60, spread: 70, color: 0x9a7e5a, hMin: 5, hMax: 12 });
      addSkyDisc(ctx, { color: 0xffd27d, r: 14, x: -110, y: 30, z: -240, glowColor: 0xffa84d });
    },
  },

  fury: {
    label: 'Fury Road',
    fleet: 'warrigs',
    bg: 0xd97f3e, fog: [0xd97f3e, 80, 260],
    build(ctx) {
      const { ROAD_HALF_W, Z_FAR } = ctx.C;
      addLights(ctx, { sky: 0xffc890, ground: 0x6e4426, hemi: 1.8, sun: 0xffb060, sunInt: 1.5, sunPos: [20, 60, -40] });
      addGround(ctx, 0xc1772f);
      addRoad(ctx, { asphalt: 0x6e5238, dash: 0xc9a87a, edge: 0xb89868, median: null, rail: null });
      for (let i = 0; i < 16; i++) {
        const side = ctx.rng() < 0.5 ? -1 : 1;
        addMesa(ctx, side * (45 + ctx.rng() * 110), Z_FAR + ctx.rng() * 280, 1 + ctx.rng() * 1.4, 0x9e5a2a);
      }
      for (let i = 0; i < 10; i++) {
        const side = ctx.rng() < 0.5 ? -1 : 1;
        addMesa(ctx, side * (ROAD_HALF_W + 8 + ctx.rng() * 16), Z_FAR + ctx.rng() * 290, 0.18 + ctx.rng() * 0.2, 0x8a4e24);
      }
      addSkyDisc(ctx, { color: 0xfff0b8, r: 20, x: 30, y: 55, z: -270, glowColor: 0xffb05e });
    },
  },

  neon: {
    label: 'Neon Rain',
    bg: 0x05070f, fog: [0x05070f, 60, 230],
    build(ctx) {
      addLights(ctx, { sky: 0x2a4a6e, ground: 0x05070f, hemi: 1.1, sun: 0x4a7ab8, sunInt: 0.5, sunPos: [0, 80, 20] });
      addGround(ctx, 0x070a14);
      addRoad(ctx, { asphalt: 0x10141f, dash: 0x35d2e8, edge: 0xc238b8, median: 0x141a2a, rail: 0x1c2438 });
      addLamps(ctx, { head: 0x35d2e8, pool: 0x143246, poolOpacity: 0.4 });
      addBoxCity(ctx, { count: 80, near: 24, spread: 70, color: 0x0c101c, hMin: 26, hMax: 70, litColor: 0xc238b8, litDensity: 0.8 });
      addBoxCity(ctx, { count: 50, near: 70, spread: 90, color: 0x0a0e18, hMin: 30, hMax: 80, litColor: 0x35d2e8, litDensity: 0.7 });
      addBillboard(ctx, -25, -90, 0.45, 'ネオン', '#35d2e8', '#0a0716');
      addBillboard(ctx, 26, -150, -0.45, 'REPLICANT', '#c238b8', '#0a0716');
      return rainAnimator(ctx);
    },
  },

  grid: {
    label: 'The Grid',
    fleet: 'lightcycles',
    bg: 0x000308, fog: [0x000308, 120, 420],
    build(ctx) {
      addLights(ctx, { sky: 0x103048, ground: 0x000308, hemi: 1.2, sun: 0x18e0ff, sunInt: 0.4, sunPos: [0, 70, 30] });
      addGrid(ctx, { color: 0x0e7a94 });
      addRoad(ctx, { asphalt: 0x02060c, dash: 0x18e0ff, edge: 0x18e0ff, median: null, rail: null, dashLen: 5, dashEvery: 10 });
      addBoxCity(ctx, { count: 36, near: 50, spread: 90, color: 0x041018, hMin: 14, hMax: 50, edgeGlow: 0x18e0ff });
      // recognizer-ish floating gates
      for (const z of [-70, -170]) {
        box(ctx, 26, 2.2, 2.2, 0x18e0ff, 0, 22, z, 0, true);
        box(ctx, 2.2, 18, 2.2, 0x0a3a48, -12, 11, z);
        box(ctx, 2.2, 18, 2.2, 0x0a3a48, 12, 11, z);
      }
      addStars(ctx, { count: 250, color: 0x6ee8ff });
    },
  },

  snow: {
    label: 'Overlook Pass',
    bg: 0xc8d2dc, fog: [0xc8d2dc, 70, 240],
    build(ctx) {
      const { ROAD_HALF_W, Z_FAR } = ctx.C;
      addLights(ctx, { sky: 0xe8eef5, ground: 0x9aa8b8, hemi: 2.0, sun: 0xf0f4fa, sunInt: 0.6, sunPos: [30, 70, 30] });
      addGround(ctx, 0xe8eef5);
      addRoad(ctx, { asphalt: 0x5a626e, dash: 0xe8ecf2, edge: 0xd8dee8, median: 0xc8d2dc, rail: 0x8a94a2 });
      for (let i = 0; i < 60; i++) {
        const side = ctx.rng() < 0.5 ? -1 : 1;
        addPine(ctx, side * (ROAD_HALF_W + 5 + ctx.rng() * 70), Z_FAR + ctx.rng() * 290, 7 + ctx.rng() * 6, 0x1d3d2b, true);
      }
      // distant grand hotel silhouette
      box(ctx, 40, 18, 14, 0x4a3f38, -70, 9, -240);
      box(ctx, 12, 26, 12, 0x453a33, -70, 13, -248);
      for (let i = 0; i < 10; i++) {
        const win = box(ctx, 0.9, 1.3, 0.1, 0xd9b44a, -86 + i * 3.4, 7 + (i % 3) * 4, -232.9, 0, true);
        win.visible = ctx.rng() < 0.7;
      }
      return snowAnimator(ctx);
    },
  },

  jungle: {
    label: 'Isla Nublar',
    bg: 0x36502e, fog: [0x36502e, 50, 200],
    build(ctx) {
      addLights(ctx, { sky: 0x9ab88a, ground: 0x1a2a16, hemi: 1.6, sun: 0xd8e8b8, sunInt: 0.7, sunPos: [20, 60, 0] });
      addGround(ctx, 0x2a4022);
      addRoad(ctx, { asphalt: 0x3a4434, dash: 0xb8c4a0, edge: 0xa8b490, median: null, rail: 0x5a4a32 });
      addFoliageWall(ctx, -1);
      addFoliageWall(ctx, 1);
      addFoliageWall(ctx, -1, 0x1e4426);
      addFoliageWall(ctx, 1, 0x1e4426);
      // big wooden gate over the far end of the road
      box(ctx, 3.5, 22, 3.5, 0x4a3a26, -12, 11, -200);
      box(ctx, 3.5, 22, 3.5, 0x4a3a26, 12, 11, -200);
      box(ctx, 30, 3.5, 3, 0x553f2a, 0, 22, -200);
      box(ctx, 1.6, 1.0, 0.4, 0xffc66b, -6, 16, -198.2, 0, true);
      box(ctx, 1.6, 1.0, 0.4, 0xffc66b, 6, 16, -198.2, 0, true);
      addVolcano(ctx, -110, -240, 1.8, true);
    },
  },

  mars: {
    label: 'Red Planet',
    fleet: 'rovers',
    bg: 0xc97a4e, fog: [0xc97a4e, 90, 280],
    build(ctx) {
      const { Z_FAR } = ctx.C;
      addLights(ctx, { sky: 0xe8a878, ground: 0x6e3a22, hemi: 1.5, sun: 0xf0c0a0, sunInt: 0.9, sunPos: [-30, 50, -60] });
      addGround(ctx, 0xa8512e);
      addRoad(ctx, { asphalt: 0x6e4030, dash: 0xe0b898, edge: 0xd0a888, median: null, rail: 0x8a5a42 });
      for (let i = 0; i < 14; i++) {
        const side = ctx.rng() < 0.5 ? -1 : 1;
        addMesa(ctx, side * (50 + ctx.rng() * 100), Z_FAR + ctx.rng() * 280, 0.8 + ctx.rng(), 0x8a4226);
      }
      addDome(ctx, -45, -60, 9);
      addDome(ctx, -58, -52, 5);
      addDome(ctx, 50, -140, 11);
      box(ctx, 0.3, 14, 0.3, 0xb8c2cc, 52, 7, -128);
      addSkyDisc(ctx, { color: 0xd8e0ea, r: 5, x: 60, y: 48, z: -260 });   // Phobos
      addSkyDisc(ctx, { color: 0xb8c2cc, r: 3, x: -90, y: 56, z: -240 });  // Deimos
      addStars(ctx, { count: 180, color: 0xffe0c8 });
    },
  },

  gotham: {
    label: 'Gotham Night',
    bg: 0x05060c, fog: [0x05060c, 70, 250],
    build(ctx) {
      const { Z_FAR } = ctx.C;
      addLights(ctx, { sky: 0x2a3450, ground: 0x05060c, hemi: 1.1, sun: 0x6e80a8, sunInt: 0.5, sunPos: [40, 70, 20] });
      addGround(ctx, 0x080a12);
      addRoad(ctx, { asphalt: 0x14161e, dash: 0x6e7890, edge: 0x5a6478, median: 0x1c2030, rail: 0x262c3e });
      addLamps(ctx, { head: 0xd9b44a, pool: 0x3a3220 });
      for (let i = 0; i < 26; i++) {
        const side = ctx.rng() < 0.5 ? -1 : 1;
        addGothicTower(ctx, side * (30 + ctx.rng() * 90), Z_FAR + ctx.rng() * 260, 22 + ctx.rng() * 40);
      }
      addSkyDisc(ctx, { color: 0xe8eef9, r: 12, x: 90, y: 60, z: -260, glowColor: 0x9fb4d8 });
      // bat-signal: rotating beam + lit cloud disc
      const beamGroup = new THREE.Group();
      const beam = new THREE.Mesh(new THREE.ConeGeometry(7, 90, 16, 1, true),
        new THREE.MeshBasicMaterial({
          color: 0xfff2c0, transparent: true, opacity: 0.16, fog: false,
          blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
        }));
      beam.position.y = 45;
      beam.rotation.x = 0.5;
      beamGroup.add(beam);
      beamGroup.position.set(-60, 28, -150);
      ctx.g.add(beamGroup);
      return (dt) => { beamGroup.rotation.y += dt * 0.5; };
    },
  },

  west: {
    label: 'Once Upon a Sunset',
    bg: 0xe8743e, fog: [0xe8743e, 100, 300],
    build(ctx) {
      const { ROAD_HALF_W, Z_FAR } = ctx.C;
      addLights(ctx, { sky: 0xffb878, ground: 0x5e3a22, hemi: 1.6, sun: 0xff9040, sunInt: 1.3, sunPos: [0, 18, -120] });
      addGround(ctx, 0xb87840);
      addRoad(ctx, { asphalt: 0x7a5a3e, dash: 0xd0a878, edge: 0xc09868, median: null, rail: null });
      for (let i = 0; i < 12; i++) {
        const side = ctx.rng() < 0.5 ? -1 : 1;
        addMesa(ctx, side * (40 + ctx.rng() * 110), Z_FAR + ctx.rng() * 270, 1.1 + ctx.rng() * 1.2, 0xa05226);
      }
      for (let i = 0; i < 22; i++) {
        const side = ctx.rng() < 0.5 ? -1 : 1;
        addCactus(ctx, side * (ROAD_HALF_W + 3 + ctx.rng() * 40), Z_FAR + ctx.rng() * 290);
      }
      // little frontier town on the right
      for (let i = 0; i < 5; i++) {
        box(ctx, 7, 4.5 + ctx.rng() * 2, 6, 0x6e4a2e, ROAD_HALF_W + 16 + i * 9, 2.4, -40 - i * 4);
        box(ctx, 7.4, 1.2, 0.3, 0x553a22, ROAD_HALF_W + 16 + i * 9, 5.6, -36.8 - i * 4);
      }
      addSkyDisc(ctx, { color: 0xffd24a, r: 22, x: 0, y: 16, z: -290, glowColor: 0xff7a30 });
    },
  },

  space: {
    label: 'Star Gate',
    fleet: 'spacecraft',
    bg: 0x010208, fog: [0x010208, 200, 600],
    build(ctx) {
      const { ROAD_HALF_W, Z_NEAR, Z_FAR } = ctx.C;
      addLights(ctx, { sky: 0x3a4a78, ground: 0x010208, hemi: 1.0, sun: 0xeef2ff, sunInt: 1.1, sunPos: [60, 40, 60] });
      // floating causeway instead of ground
      const L = Z_NEAR - Z_FAR + 30;
      box(ctx, ROAD_HALF_W * 2 + 3, 2.5, L, 0x0a0e1c, 0, -1.3, (Z_NEAR + Z_FAR) / 2);
      addRoad(ctx, { asphalt: 0x0c1020, dash: 0xeef2ff, edge: 0x8fb8ff, median: null, rail: null });
      for (const side of [-1, 1]) {
        box(ctx, 0.3, 0.3, L, 0x8fb8ff, side * (ROAD_HALF_W + 1.2), 0.3, (Z_NEAR + Z_FAR) / 2, 0, true);
      }
      addStars(ctx, { count: 1600, full: true, size: 1.6 });
      const ring = addRingStation(ctx, -80, 45, -200, 22);
      addSkyDisc(ctx, { color: 0x6e8cc8, r: 30, x: 110, y: 35, z: -300, glowColor: 0x4a6aa8 }); // blue planet
      addSkyDisc(ctx, { color: 0xfff6d8, r: 8, x: 60, y: 70, z: -250, glowColor: 0xfff0b0 });   // distant sun
      return (dt) => { ring.rotation.z += dt * 0.15; };
    },
  },

  reef: {
    label: 'Under the Sea',
    fleet: 'fish',
    bg: 0x0a3a52, fog: [0x0a3a52, 50, 190],
    build(ctx) {
      const { ROAD_HALF_W, Z_FAR } = ctx.C;
      addLights(ctx, { sky: 0x4aa0c8, ground: 0x0a2838, hemi: 1.7, sun: 0x9fd8f0, sunInt: 0.8, sunPos: [20, 80, 0] });
      addGround(ctx, 0xc8b486); // sand
      addRoad(ctx, { asphalt: 0xb8a478, dash: 0xe8dfc2, edge: 0xd8cfae, median: null, rail: null, dashLen: 1.6, dashEvery: 12 });
      for (let i = 0; i < 40; i++) {
        const side = ctx.rng() < 0.5 ? -1 : 1;
        addCoral(ctx, side * (ROAD_HALF_W + 3 + ctx.rng() * 30), Z_FAR + ctx.rng() * 290);
      }
      for (let i = 0; i < 22; i++) {
        const side = ctx.rng() < 0.5 ? -1 : 1;
        addKelp(ctx, side * (ROAD_HALF_W + 8 + ctx.rng() * 40), Z_FAR + ctx.rng() * 280);
      }
      for (let i = 0; i < 8; i++) {
        const side = ctx.rng() < 0.5 ? -1 : 1;
        addMesa(ctx, side * (45 + ctx.rng() * 90), Z_FAR + ctx.rng() * 270, 0.7 + ctx.rng() * 0.8, 0x3e5a6a);
      }
      return bubblesAnimator(ctx);
    },
  },

  sky: {
    label: 'Above the Clouds',
    fleet: 'aircraft',
    bg: 0x9cc8ec, fog: [0x9cc8ec, 160, 460],
    build(ctx) {
      const { Z_FAR } = ctx.C;
      addLights(ctx, { sky: 0xeaf4fb, ground: 0xb8c8d8, hemi: 2.2, sun: 0xfff2cc, sunInt: 1.2, sunPos: [60, 80, 20] });
      addRoad(ctx, { asphalt: null, dash: 0xffffff, edge: 0xdfeaf5, median: null, rail: null, dashLen: 4, dashEvery: 12 });
      // cloud deck below the flight lanes
      for (let i = 0; i < 34; i++) {
        addCloud(ctx, (ctx.rng() - 0.5) * 320, -7 - ctx.rng() * 6, Z_FAR + ctx.rng() * 330, 1.6 + ctx.rng() * 2.4);
      }
      // mountain summits poking through
      for (const [x, z, s] of [[-90, -200, 1.4], [110, -120, 1.0], [-50, -60, 0.7]]) {
        const peak = new THREE.Mesh(new THREE.ConeGeometry(22 * s, 34 * s, 7), mat(0x5a6a7e));
        peak.position.set(x, -22 + 14 * s, z);
        ctx.g.add(peak);
        const cap = new THREE.Mesh(new THREE.ConeGeometry(9 * s, 12 * s, 7), mat(0xeef4fa));
        cap.position.set(x, -22 + 14 * s + 12 * s, z);
        ctx.g.add(cap);
      }
      addSkyDisc(ctx, { color: 0xfff6d8, r: 14, x: 100, y: 75, z: -280, glowColor: 0xfff0b0 });
      addCloud(ctx, -60, 50, -260, 2.2);
      addCloud(ctx, 40, 62, -220, 1.5);
    },
  },

  rails: {
    label: 'Midnight Express',
    fleet: 'trains',
    bg: 0x111a2e, fog: [0x111a2e, 90, 300],
    build(ctx) {
      const { ROAD_HALF_W, Z_FAR } = ctx.C;
      addLights(ctx, { sky: 0x3e527e, ground: 0x141c30, hemi: 1.4, sun: 0xaec4f0, sunInt: 0.8, sunPos: [40, 60, 20] });
      addGround(ctx, 0xdce6f0); // snowfield
      addRails(ctx, {});
      for (let i = 0; i < 44; i++) {
        const side = ctx.rng() < 0.5 ? -1 : 1;
        addPine(ctx, side * (ROAD_HALF_W + 6 + ctx.rng() * 60), Z_FAR + ctx.rng() * 290, 7 + ctx.rng() * 6, 0x1d3d2b, true);
      }
      // signals along the line
      for (let z = Z_FAR + 30; z < 60; z += 60) {
        for (const side of [-1, 1]) {
          box(ctx, 0.2, 5, 0.2, 0x4a5568, side * (ROAD_HALF_W + 1.6), 2.5, z);
          box(ctx, 0.35, 0.35, 0.2, ctx.rng() < 0.5 ? 0x39d98a : 0xff4438,
            side * (ROAD_HALF_W + 1.6), 5.0, z, 0, true);
        }
      }
      addHouse(ctx, ROAD_HALF_W + 12, -60, -0.3); // lonely station house
      addSkyDisc(ctx, { color: 0xe8eef9, r: 11, x: -80, y: 58, z: -250, glowColor: 0x9fb4d8 });
      addStars(ctx, { count: 450 });
      return snowAnimator(ctx, 700);
    },
  },

  savanna: {
    label: 'Pride Lands',
    fleet: 'savanna',
    bg: 0xe8b45e, fog: [0xe8b45e, 110, 330],
    build(ctx) {
      const { ROAD_HALF_W, Z_FAR } = ctx.C;
      addLights(ctx, { sky: 0xffd9a0, ground: 0x6e5a30, hemi: 1.8, sun: 0xffc06a, sunInt: 1.3, sunPos: [-40, 35, -90] });
      addGround(ctx, 0xc8a45a); // dry grass
      addRoad(ctx, { asphalt: 0xb08e48, dash: 0xe0cfa0, edge: 0xd0bf90, median: null, rail: null, dashLen: 2, dashEvery: 12 });
      for (let i = 0; i < 22; i++) {
        const side = ctx.rng() < 0.5 ? -1 : 1;
        addAcacia(ctx, side * (ROAD_HALF_W + 5 + ctx.rng() * 60), Z_FAR + ctx.rng() * 290, 7 + ctx.rng() * 4);
      }
      for (let i = 0; i < 7; i++) {
        const side = ctx.rng() < 0.5 ? -1 : 1;
        addMesa(ctx, side * (60 + ctx.rng() * 90), Z_FAR + ctx.rng() * 260, 0.8 + ctx.rng() * 0.7, 0x8a6a42);
      }
      // pride rock
      addMesa(ctx, -70, -150, 1.6, 0x9a7a4e);
      box(ctx, 16, 2.2, 7, 0x9a7a4e, -62, 16, -148, 0.3);
      addSkyDisc(ctx, { color: 0xffd27d, r: 18, x: -90, y: 34, z: -260, glowColor: 0xffa84d });
    },
  },

  arctic: {
    label: 'Penguin March',
    fleet: 'arctic',
    bg: 0x0e2236, fog: [0x0e2236, 100, 320],
    build(ctx) {
      const { ROAD_HALF_W, Z_FAR } = ctx.C;
      addLights(ctx, { sky: 0x52789e, ground: 0x12283c, hemi: 1.6, sun: 0xbcd8f0, sunInt: 0.7, sunPos: [30, 50, -40] });
      addGround(ctx, 0xcfe0ec); // pack ice
      addRoad(ctx, { asphalt: 0xb8d0e0, dash: 0x6e98b8, edge: 0x8eb4cc, median: null, rail: null, dashLen: 2, dashEvery: 14 });
      for (let i = 0; i < 16; i++) {
        const side = ctx.rng() < 0.5 ? -1 : 1;
        addIceberg(ctx, side * (ROAD_HALF_W + 10 + ctx.rng() * 80), Z_FAR + ctx.rng() * 280, 0.6 + ctx.rng() * 1.2);
      }
      // open-water leads in the ice
      for (let i = 0; i < 5; i++) {
        const side = ctx.rng() < 0.5 ? -1 : 1;
        const pool = new THREE.Mesh(new THREE.CircleGeometry(6 + ctx.rng() * 8, 10), mat(0x123a55));
        pool.rotation.x = -Math.PI / 2;
        pool.position.set(side * (ROAD_HALF_W + 14 + ctx.rng() * 50), 0.02, Z_FAR + 30 + ctx.rng() * 240);
        ctx.g.add(pool);
      }
      addStars(ctx, { count: 600 });
      return auroraAnimator(ctx);
    },
  },

  dino: {
    label: 'Valley of Giants',
    fleet: 'dinos',
    bg: 0x6e8a5e, fog: [0x6e8a5e, 70, 240],
    build(ctx) {
      const { ROAD_HALF_W, Z_FAR } = ctx.C;
      addLights(ctx, { sky: 0xc8d8a8, ground: 0x2a3a22, hemi: 1.8, sun: 0xf0e8b8, sunInt: 0.9, sunPos: [30, 60, -20] });
      addGround(ctx, 0x4e6a3e);
      addRoad(ctx, { asphalt: 0x5a6a48, dash: 0xb8c4a0, edge: 0xa8b490, median: null, rail: null, dashLen: 2, dashEvery: 14 });
      addFoliageWall(ctx, -1, 0x2e5a32);
      addFoliageWall(ctx, 1, 0x2e5a32);
      for (let i = 0; i < 14; i++) {
        const side = ctx.rng() < 0.5 ? -1 : 1;
        addPalm(ctx, side * (ROAD_HALF_W + 6 + ctx.rng() * 30), Z_FAR + ctx.rng() * 280, 8 + ctx.rng() * 5);
      }
      addVolcano(ctx, 100, -230, 1.7, true);
      for (let i = 0; i < 6; i++) {
        const side = ctx.rng() < 0.5 ? -1 : 1;
        addMesa(ctx, side * (60 + ctx.rng() * 80), Z_FAR + ctx.rng() * 200, 1.0 + ctx.rng(), 0x6a7a55);
      }
      addSkyDisc(ctx, { color: 0xfff0b8, r: 16, x: 60, y: 55, z: -270, glowColor: 0xf0d890 });
    },
  },

  magic: {
    label: "Wizard's Night",
    fleet: 'magic',
    bg: 0x121028, fog: [0x121028, 110, 360],
    build(ctx) {
      const { ROAD_HALF_W, Z_FAR } = ctx.C;
      addLights(ctx, { sky: 0x4a3e7e, ground: 0x0e0c20, hemi: 1.3, sun: 0x9a8ac8, sunInt: 0.6, sunPos: [-40, 60, -30] });
      addGround(ctx, 0x1c1a34);
      addRoad(ctx, { asphalt: null, dash: 0xc8b8ff, edge: 0x8a6ee8, median: null, rail: null, dashLen: 3, dashEvery: 11 });
      // castle on the far hill
      const hill = new THREE.Mesh(new THREE.SphereGeometry(60, 12, 8), mat(0x18162e));
      hill.scale.y = 0.35;
      hill.position.set(-60, -6, -220);
      ctx.g.add(hill);
      for (const [x, z, h] of [[-75, -215, 26], [-60, -225, 34], [-45, -210, 24], [-60, -200, 18]]) {
        box(ctx, 7, h, 7, 0x221e40, x, h / 2 + 12, z);
        const spire = new THREE.Mesh(new THREE.ConeGeometry(4.5, 10, 6), mat(0x2e2852));
        spire.position.set(x, h + 17, z);
        ctx.g.add(spire);
        for (let i = 0; i < 5; i++) {
          if (ctx.rng() < 0.7) box(ctx, 0.6, 0.9, 0.1, 0xffd98a, x + (ctx.rng() - 0.5) * 4, 14 + ctx.rng() * h * 0.8, z + 3.6, 0, true);
        }
      }
      // floating lanterns along the flight path
      for (let z = Z_FAR + 10; z < 60; z += 22) {
        for (const side of [-1, 1]) {
          const lantern = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.7, 0.5), bmat(0xffc66b));
          lantern.position.set(side * (ROAD_HALF_W + 2 + ctx.rng() * 3), 5 + ctx.rng() * 3, z);
          ctx.g.add(lantern);
        }
      }
      addSkyDisc(ctx, { color: 0xe8eef9, r: 16, x: 80, y: 64, z: -260, glowColor: 0x9a8ac8 });
      addStars(ctx, { count: 900 });
    },
  },

  christmas: {
    label: "Santa's Run",
    fleet: 'christmas',
    bg: 0x14223c, fog: [0x14223c, 90, 300],
    build(ctx) {
      const { ROAD_HALF_W, Z_FAR } = ctx.C;
      addLights(ctx, { sky: 0x52679e, ground: 0x18243c, hemi: 1.6, sun: 0xcfe0ff, sunInt: 0.8, sunPos: [40, 60, 20] });
      addGround(ctx, 0xe4ecf4); // snow
      addRoad(ctx, { asphalt: 0xc8d8e4, dash: 0x8aa8c0, edge: 0xa8c0d4, median: null, rail: null, dashLen: 2, dashEvery: 12 });
      for (let z = Z_FAR + 14; z < 60; z += 26) {
        addCandyPole(ctx, -(ROAD_HALF_W + 1.8), z);
        addCandyPole(ctx, ROAD_HALF_W + 1.8, z + 13);
      }
      for (let i = 0; i < 14; i++) {
        const side = ctx.rng() < 0.5 ? -1 : 1;
        addHouse(ctx, side * (ROAD_HALF_W + 10 + ctx.rng() * 40), Z_FAR + 20 + ctx.rng() * 260, side > 0 ? -0.4 : 0.4);
      }
      for (let i = 0; i < 20; i++) {
        const side = ctx.rng() < 0.5 ? -1 : 1;
        addPine(ctx, side * (ROAD_HALF_W + 7 + ctx.rng() * 55), Z_FAR + ctx.rng() * 280, 6 + ctx.rng() * 5, 0x1d3d2b, true);
      }
      // the big tree
      addPine(ctx, -(ROAD_HALF_W + 12), -70, 16, 0x1d4d2b, true);
      for (let i = 0; i < 14; i++) {
        const a = ctx.rng() * Math.PI * 2;
        const r = 1.5 + ctx.rng() * 2.5;
        const y = 3 + ctx.rng() * 10;
        const colors = [0xff4438, 0xffd24a, 0x39d98a, 0x3b82f6];
        const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.22, 6, 5),
          bmat(colors[Math.floor(ctx.rng() * colors.length)]));
        lamp.position.set(-(ROAD_HALF_W + 12) + Math.cos(a) * r * (1 - y / 18), y, -70 + Math.sin(a) * r * (1 - y / 18));
        ctx.g.add(lamp);
      }
      addSkyDisc(ctx, { color: 0xe8eef9, r: 12, x: 80, y: 60, z: -260, glowColor: 0x9fb4d8 });
      addStars(ctx, { count: 500 });
      return snowAnimator(ctx);
    },
  },

  depths: {
    label: 'Silent Depths',
    fleet: 'subs',
    bg: 0x020a14, fog: [0x020a14, 50, 200],
    build(ctx) {
      const { ROAD_HALF_W, Z_FAR } = ctx.C;
      addLights(ctx, { sky: 0x1a3a52, ground: 0x020a14, hemi: 1.1, sun: 0x3e6a88, sunInt: 0.5, sunPos: [0, 80, 0] });
      addGround(ctx, 0x0a1620);
      addRoad(ctx, { asphalt: 0x0e1c28, dash: 0x38d9c8, edge: 0x1e7a8c, median: null, rail: null, dashLen: 1.6, dashEvery: 14 });
      for (let i = 0; i < 12; i++) {
        const side = ctx.rng() < 0.5 ? -1 : 1;
        addVent(ctx, side * (ROAD_HALF_W + 6 + ctx.rng() * 40), Z_FAR + ctx.rng() * 280);
      }
      for (let i = 0; i < 10; i++) {
        const side = ctx.rng() < 0.5 ? -1 : 1;
        addMesa(ctx, side * (45 + ctx.rng() * 80), Z_FAR + ctx.rng() * 260, 0.9 + ctx.rng(), 0x16242e);
      }
      addDome(ctx, 55, -120, 10, 0x2e4a5a); // seafloor habitat
      box(ctx, 0.3, 12, 0.3, 0x3e5a6a, 57, 6, -108);
      // bioluminescent drift
      makeParticles(ctx, { count: 700, color: 0x38d9c8, size: 0.35, area: [240, 30, 320], opacity: 0.6 });
      return bubblesAnimator(ctx, 300);
    },
  },

  skyfair: {
    label: 'Up & Away',
    fleet: 'balloons',
    bg: 0xf2c8a8, fog: [0xf2c8a8, 150, 440],
    build(ctx) {
      const { Z_FAR } = ctx.C;
      addLights(ctx, { sky: 0xffe8cc, ground: 0xb89888, hemi: 2.0, sun: 0xffc890, sunInt: 1.1, sunPos: [-60, 40, -80] });
      addRoad(ctx, { asphalt: null, dash: 0xfff2dd, edge: 0xf0d8b8, median: null, rail: null, dashLen: 4, dashEvery: 12 });
      for (let i = 0; i < 30; i++) {
        addCloud(ctx, (ctx.rng() - 0.5) * 320, -8 - ctx.rng() * 6, Z_FAR + ctx.rng() * 330, 1.5 + ctx.rng() * 2.2, 0xffe0c8);
      }
      for (const [x, z, s] of [[-100, -180, 1.2], [90, -240, 1.5]]) {
        const peak = new THREE.Mesh(new THREE.ConeGeometry(24 * s, 38 * s, 7), mat(0x7e6a78));
        peak.position.set(x, -24 + 16 * s, z);
        ctx.g.add(peak);
      }
      // distant festival balloons
      const palette = [0xc2543a, 0x3f7fb8, 0x4f9e63, 0xc7a44a, 0x8b5cf6];
      for (let i = 0; i < 9; i++) {
        const color = palette[Math.floor(ctx.rng() * palette.length)];
        const x = (ctx.rng() - 0.5) * 280;
        const y = 14 + ctx.rng() * 40;
        const z = Z_FAR - 20 + ctx.rng() * 240;
        const envl = new THREE.Mesh(new THREE.SphereGeometry(4 + ctx.rng() * 3, 8, 6), mat(color));
        envl.position.set(x, y, z);
        ctx.g.add(envl);
        box(ctx, 1.2, 1.0, 1.2, 0x6e4a2e, x, y - 6.5, z);
      }
      addSkyDisc(ctx, { color: 0xffd9a0, r: 20, x: -110, y: 30, z: -280, glowColor: 0xff9a4d });
    },
  },

  shire: {
    label: 'The Shire',
    fleet: 'wagons',
    bg: 0x8ec8e8, fog: [0x8ec8e8, 140, 400],
    build(ctx) {
      const { ROAD_HALF_W, Z_FAR } = ctx.C;
      addLights(ctx, { sky: 0xeaf4fb, ground: 0x3e6e35, hemi: 2.1, sun: 0xfff2cc, sunInt: 1.2, sunPos: [50, 70, 30] });
      addGround(ctx, 0x4e9b47);
      addRoad(ctx, { asphalt: 0x8a7a5e, dash: 0xd8ccb0, edge: 0xc8bca0, median: null, rail: 0x6e5e42 });
      const doors = [0xc24a38, 0x3f7fb8, 0x4f9e63, 0xc7a44a, 0x8b5cf6];
      for (let i = 0; i < 14; i++) {
        const side = ctx.rng() < 0.5 ? -1 : 1;
        addHill(ctx, side * (ROAD_HALF_W + 14 + ctx.rng() * 60), Z_FAR + 10 + ctx.rng() * 280,
          7 + ctx.rng() * 8, doors[Math.floor(ctx.rng() * doors.length)]);
      }
      for (let i = 0; i < 8; i++) {
        const side = ctx.rng() < 0.5 ? -1 : 1;
        addBigTree(ctx, side * (ROAD_HALF_W + 8 + ctx.rng() * 50), Z_FAR + ctx.rng() * 280, 12 + ctx.rng() * 8);
      }
      addSkyDisc(ctx, { color: 0xfff6d8, r: 12, x: 80, y: 65, z: -260, glowColor: 0xfff0b0 });
      addCloud(ctx, -50, 55, -220, 1.8);
      addCloud(ctx, 60, 62, -250, 2.2);
      addCloud(ctx, 10, 58, -180, 1.3);
    },
  },

  // ===== Game worlds =====
  voxel: {
    label: 'Voxel World',
    fleet: 'minecarts',
    bg: 0x88c8ff, fog: [0x88c8ff, 150, 430],
    build(ctx) {
      const { ROAD_HALF_W, Z_FAR } = ctx.C;
      addLights(ctx, { sky: 0xeaf6ff, ground: 0x5a8a3a, hemi: 2.2, sun: 0xfff6d0, sunInt: 1.1, sunPos: [60, 70, 30] });
      addGround(ctx, 0x4e9b3e);
      addRoad(ctx, { asphalt: 0x8a8a8a, dash: 0xdedede, edge: 0xcfcfcf, median: null, rail: 0x5a4a32 });
      for (let i = 0; i < 40; i++) addVoxelTree(ctx, (ctx.rng() < 0.5 ? -1 : 1) * (ROAD_HALF_W + 6 + ctx.rng() * 60), Z_FAR + ctx.rng() * 300);
      for (let i = 0; i < 12; i++) { const s = ctx.rng() < 0.5 ? -1 : 1; box(ctx, 6, 4 + ctx.rng() * 8, 6, ctx.rng() < 0.5 ? 0x7a6a55 : 0x8a8076, s * (60 + ctx.rng() * 80), 4, Z_FAR + ctx.rng() * 240); }
      box(ctx, 14, 14, 14, 0xfff2a0, 70, 50, -270, 0, true);
      addCloud(ctx, -50, 56, -220, 2); addCloud(ctx, 60, 60, -250, 1.6);
    },
  },
  witcher: {
    label: 'Northern Path',
    fleet: 'wagons',
    bg: 0x2a2e34, fog: [0x2a2e34, 70, 250],
    build(ctx) {
      const { ROAD_HALF_W, Z_FAR } = ctx.C;
      addLights(ctx, { sky: 0x5a6470, ground: 0x1a2018, hemi: 1.3, sun: 0xc8b88a, sunInt: 0.7, sunPos: [-40, 30, -70] });
      addGround(ctx, 0x2a3322);
      addRoad(ctx, { asphalt: 0x4a4438, dash: 0x9a9080, edge: 0x8a8070, median: null, rail: 0x3a3226 });
      for (let i = 0; i < 50; i++) addPine(ctx, (ctx.rng() < 0.5 ? -1 : 1) * (ROAD_HALF_W + 5 + ctx.rng() * 70), Z_FAR + ctx.rng() * 290, 8 + ctx.rng() * 7, 0x1c2e1c);
      for (let i = 0; i < 8; i++) addHouse(ctx, (ctx.rng() < 0.5 ? -1 : 1) * (ROAD_HALF_W + 10 + ctx.rng() * 30), Z_FAR + 20 + ctx.rng() * 180, ctx.rng());
      addSkyDisc(ctx, { color: 0xe8e2cc, r: 12, x: -70, y: 50, z: -240, glowColor: 0xb8a878 });
      addStars(ctx, { count: 300 });
    },
  },
  halo: {
    label: 'Halo Ring',
    fleet: 'armor',
    bg: 0x6a8aa8, fog: [0x6a8aa8, 130, 400],
    build(ctx) {
      const { Z_FAR } = ctx.C;
      addLights(ctx, { sky: 0xcfe2f0, ground: 0x3a5a4a, hemi: 1.9, sun: 0xeaf2ff, sunInt: 1.0, sunPos: [40, 70, 10] });
      addGround(ctx, 0x4a7a5a);
      addRoad(ctx, { asphalt: 0x6a7280, dash: 0xc8d4e0, edge: 0xb0c0d0, median: 0x4a5666, rail: 0x5a6678 });
      const ring = new THREE.Mesh(new THREE.TorusGeometry(190, 12, 6, 50, Math.PI * 1.3), mat(0x9fb2c4));
      ring.position.set(0, 40, -300); ring.rotation.set(0.35, 0, 0.15); ctx.g.add(ring);
      const band = new THREE.Mesh(new THREE.TorusGeometry(190, 6, 6, 50, Math.PI * 1.3), mat(0x4a8a6a));
      band.position.set(0, 40, -298); band.rotation.set(0.35, 0, 0.15); ctx.g.add(band);
      for (let i = 0; i < 8; i++) { const s = ctx.rng() < 0.5 ? -1 : 1; box(ctx, 8, 10 + ctx.rng() * 14, 10, 0x8090a0, s * (55 + ctx.rng() * 70), 7, Z_FAR + ctx.rng() * 220); }
      addCloud(ctx, -40, 60, -260, 2); addCloud(ctx, 50, 64, -230, 1.6);
    },
  },
  fallout: {
    label: 'Atomic Wastes',
    fleet: 'armor',
    bg: 0x9a9a5e, fog: [0x9a9a5e, 90, 300],
    build(ctx) {
      const { ROAD_HALF_W, Z_FAR } = ctx.C;
      addLights(ctx, { sky: 0xc8c87a, ground: 0x5a5a32, hemi: 1.6, sun: 0xd8d88a, sunInt: 0.9, sunPos: [30, 50, -40] });
      addGround(ctx, 0x7a7a48);
      addRoad(ctx, { asphalt: 0x5a5a4a, dash: 0xa8a888, edge: 0x98987a, median: null, rail: 0x6a5a3a });
      for (let i = 0; i < 12; i++) addMesa(ctx, (ctx.rng() < 0.5 ? -1 : 1) * (50 + ctx.rng() * 100), Z_FAR + ctx.rng() * 270, 0.8 + ctx.rng(), 0x8a7a48);
      for (let i = 0; i < 14; i++) { const s = ctx.rng() < 0.5 ? -1 : 1; const h = 5 + ctx.rng() * 6; box(ctx, 0.4, h, 0.4, 0x3a2e22, s * (ROAD_HALF_W + 5 + ctx.rng() * 40), h / 2, Z_FAR + ctx.rng() * 290); }
      addDome(ctx, -50, -120, 9, 0x4a5a4a); box(ctx, 0.3, 12, 0.3, 0x6a6a4a, -48, 6, -108);
      addBillboard(ctx, ROAD_HALF_W + 8, -70, -0.4, 'NUKA', '#e8b84a', '#3a2a1a');
      addBillboard(ctx, -(ROAD_HALF_W + 8), -140, 0.4, 'VAULT 76', '#7adf8a', '#1a2a1a');
      addSkyDisc(ctx, { color: 0xd8d87a, r: 16, x: 40, y: 45, z: -270, glowColor: 0xb0b04a });
    },
  },
  battlefield: {
    label: 'Frontline',
    fleet: 'armor',
    bg: 0x4a3a2e, fog: [0x4a3a2e, 70, 240],
    build(ctx) {
      const { ROAD_HALF_W, Z_FAR } = ctx.C;
      addLights(ctx, { sky: 0x8a6a4a, ground: 0x2a2018, hemi: 1.4, sun: 0xe8945e, sunInt: 1.0, sunPos: [-30, 30, -60] });
      addGround(ctx, 0x4a3e2e);
      addRoad(ctx, { asphalt: 0x3a352e, dash: 0x8a7a5a, edge: 0x7a6a4a, median: null, rail: 0x4a3a26 });
      for (let i = 0; i < 18; i++) { const s = ctx.rng() < 0.5 ? -1 : 1; box(ctx, 2 + ctx.rng() * 3, 1 + ctx.rng() * 3, 2 + ctx.rng() * 3, 0x3a3228, s * (ROAD_HALF_W + 4 + ctx.rng() * 50), 1, Z_FAR + ctx.rng() * 290); }
      for (let i = 0; i < 6; i++) { const s = ctx.rng() < 0.5 ? -1 : 1; box(ctx, 8, 10 + ctx.rng() * 12, 8, 0x4a4238, s * (55 + ctx.rng() * 60), 8, Z_FAR + ctx.rng() * 220); }
      for (let i = 0; i < 6; i++) { const s = ctx.rng() < 0.5 ? -1 : 1; box(ctx, 1.5, 1.5, 1.5, 0xff6a2a, s * (ROAD_HALF_W + 8 + ctx.rng() * 40), 1, Z_FAR + ctx.rng() * 260, 0, true); }
      addSkyDisc(ctx, { color: 0xe8945e, r: 14, x: -40, y: 30, z: -250, glowColor: 0xc85a2a });
      return smokeAnimator(ctx, 280, 0x4a4038);
    },
  },
  nightcity: {
    label: 'Night City',
    fleet: 'lightcycles',
    bg: 0x140a1e, fog: [0x140a1e, 90, 290],
    build(ctx) {
      addLights(ctx, { sky: 0xc8a83e, ground: 0x0e0818, hemi: 1.3, sun: 0xffd23e, sunInt: 0.6, sunPos: [0, 60, -40] });
      addGround(ctx, 0x0e0a16);
      addRoad(ctx, { asphalt: 0x18141e, dash: 0xffd23e, edge: 0xf03ea8, median: 0x241a2e, rail: 0x2a1f38 });
      addLamps(ctx, { head: 0xffd23e, pool: 0x3a2a1e, poolOpacity: 0.35 });
      addBoxCity(ctx, { count: 90, near: 22, spread: 60, color: 0x140e1e, hMin: 28, hMax: 78, litColor: 0xffd23e, litDensity: 0.8 });
      addBoxCity(ctx, { count: 50, near: 70, spread: 90, color: 0x100a18, hMin: 34, hMax: 90, litColor: 0x35e0e8, litDensity: 0.7 });
      addBillboard(ctx, -25, -90, 0.45, 'SAMURAI', '#ffd23e', '#1a0e22');
      addBillboard(ctx, 26, -150, -0.45, '2·0·7·7', '#f03ea8', '#160a20');
      addStars(ctx, { count: 200 });
    },
  },
  crystal: {
    label: 'Crystal Expanse',
    fleet: 'crystalpods',
    bg: 0xc8d8f0, fog: [0xc8d8f0, 110, 360],
    build(ctx) {
      const { ROAD_HALF_W, Z_FAR } = ctx.C;
      addLights(ctx, { sky: 0xeef2ff, ground: 0x8a9ac0, hemi: 2.0, sun: 0xffe8f4, sunInt: 1.0, sunPos: [30, 60, 20] });
      addGround(ctx, 0xaeb8d8);
      addRoad(ctx, { asphalt: 0x8a94b8, dash: 0xeaf0ff, edge: 0xd8e0f4, median: 0x9aa4c8, rail: 0xaab4d8 });
      const cols = [0x9ad8e8, 0xe89ad8, 0xb0a0e8, 0xa0e8c0];
      for (let i = 0; i < 26; i++) addCrystal(ctx, (ctx.rng() < 0.5 ? -1 : 1) * (ROAD_HALF_W + 6 + ctx.rng() * 60), Z_FAR + ctx.rng() * 290, 0.7 + ctx.rng() * 1.6, cols[Math.floor(ctx.rng() * cols.length)]);
      for (let i = 0; i < 10; i++) { const c = new THREE.Mesh(new THREE.OctahedronGeometry(1.5 + ctx.rng() * 2), new THREE.MeshBasicMaterial({ color: cols[Math.floor(ctx.rng() * cols.length)], transparent: true, opacity: 0.6, fog: false })); c.position.set((ctx.rng() - 0.5) * 200, 25 + ctx.rng() * 40, Z_FAR + ctx.rng() * 240); ctx.g.add(c); }
      addSkyDisc(ctx, { color: 0xffeef8, r: 14, x: 60, y: 60, z: -260, glowColor: 0xf0c8e8 });
    },
  },
  velvet: {
    label: 'Velvet Heist',
    fleet: 'lightcycles',
    bg: 0x120308, fog: [0x120308, 90, 290],
    build(ctx) {
      const { ROAD_HALF_W, Z_FAR } = ctx.C;
      addLights(ctx, { sky: 0xc8203a, ground: 0x0a0205, hemi: 1.3, sun: 0xff3a5a, sunInt: 0.7, sunPos: [-30, 50, -40] });
      addGround(ctx, 0x0e0306);
      addRoad(ctx, { asphalt: 0x1a0509, dash: 0xff2a4a, edge: 0xffffff, median: 0x2a0810, rail: 0x3a0a14 });
      addBoxCity(ctx, { count: 70, near: 26, spread: 70, color: 0x180308, hMin: 18, hMax: 54, litColor: 0xff2a4a, litDensity: 0.7 });
      addBillboard(ctx, -25, -90, 0.45, 'TAKE YOUR HEART', '#ff2a4a', '#0a0204');
      addBillboard(ctx, 26, -150, -0.45, 'PHANTOM', '#ffffff', '#1a0308');
      for (let i = 0; i < 14; i++) { const s = ctx.rng() < 0.5 ? -1 : 1; box(ctx, 0.3, 8 + ctx.rng() * 6, 0.3, 0xff2a4a, s * (ROAD_HALF_W + 2 + ctx.rng() * 4), 5, Z_FAR + ctx.rng() * 280, 0, true); }
      addStars(ctx, { count: 150, color: 0xff6a7a });
    },
  },
  mirrorsedge: {
    label: 'Clean Rooftops',
    bg: 0xeef4fb, fog: [0xeef4fb, 160, 460],
    build(ctx) {
      const { ROAD_HALF_W, Z_FAR } = ctx.C;
      addLights(ctx, { sky: 0xffffff, ground: 0xc8d4e0, hemi: 2.6, sun: 0xffffff, sunInt: 0.9, sunPos: [40, 80, 30] });
      addGround(ctx, 0xeef2f6);
      addRoad(ctx, { asphalt: 0xf4f6f8, dash: 0xe04a4a, edge: 0xff3a3a, median: null, rail: 0xd8dee4 });
      addBoxCity(ctx, { count: 60, near: 26, spread: 70, color: 0xf2f4f6, hMin: 16, hMax: 48, litColor: 0xff3a3a, litDensity: 0.25, edgeGlow: 0xff3a3a });
      addBoxCity(ctx, { count: 40, near: 70, spread: 80, color: 0xe8edf2, hMin: 22, hMax: 60 });
      for (let i = 0; i < 6; i++) { const s = ctx.rng() < 0.5 ? -1 : 1; box(ctx, 5, 0.4, 5, 0xff3a3a, s * (ROAD_HALF_W + 10 + ctx.rng() * 30), 0.3, Z_FAR + 40 + ctx.rng() * 200, 0, true); }
    },
  },
  deusex: {
    label: 'Black & Gold',
    fleet: 'lightcycles',
    bg: 0x0e0c08, fog: [0x0e0c08, 90, 300],
    build(ctx) {
      const { ROAD_HALF_W, Z_FAR } = ctx.C;
      addLights(ctx, { sky: 0xd9a521, ground: 0x0a0805, hemi: 1.2, sun: 0xf0c24a, sunInt: 0.7, sunPos: [-30, 50, -40] });
      addGround(ctx, 0x0c0a06);
      addRoad(ctx, { asphalt: 0x14110a, dash: 0xd9a521, edge: 0xb08818, median: 0x1a160c, rail: 0x241d10 });
      for (let i = 0; i < 18; i++) addHexPillar(ctx, (ctx.rng() < 0.5 ? -1 : 1) * (ROAD_HALF_W + 5 + ctx.rng() * 40), Z_FAR + ctx.rng() * 290, 7 + ctx.rng() * 8);
      addBoxCity(ctx, { count: 40, near: 60, spread: 70, color: 0x141008, hMin: 16, hMax: 48, litColor: 0xd9a521, litDensity: 0.5, edgeGlow: 0xd9a521 });
      addBillboard(ctx, -25, -110, 0.45, 'AUGMENTED', '#d9a521', '#0a0804');
      addStars(ctx, { count: 120, color: 0xe8c86a });
    },
  },
  mario: {
    label: 'Power-Up Speedway',
    fleet: 'karts',
    bg: 0x6ec0ff, fog: [0x6ec0ff, 160, 460],
    build(ctx) {
      const { ROAD_HALF_W, Z_FAR } = ctx.C;
      addLights(ctx, { sky: 0xeaf6ff, ground: 0x6abf4a, hemi: 2.3, sun: 0xfff6c0, sunInt: 1.2, sunPos: [60, 70, 30] });
      addGround(ctx, 0x5ab83a);
      addRoad(ctx, { asphalt: 0x8a7a5a, dash: 0xfff0c0, edge: 0xe8d8a0, median: null, rail: 0xc83a3a });
      for (let i = 0; i < 14; i++) addPipe(ctx, (ctx.rng() < 0.5 ? -1 : 1) * (ROAD_HALF_W + 5 + ctx.rng() * 40), Z_FAR + ctx.rng() * 290);
      for (let i = 0; i < 10; i++) box(ctx, 2, 2, 2, 0xe8a83a, (ctx.rng() - 0.5) * 120, 8 + ctx.rng() * 10, Z_FAR + ctx.rng() * 240, 0, true);
      for (let i = 0; i < 8; i++) { const s = ctx.rng() < 0.5 ? -1 : 1; const h = 6 + ctx.rng() * 8; const hill = new THREE.Mesh(new THREE.SphereGeometry(h, 10, 8), mat(0x4aa82a)); hill.scale.y = 0.5; hill.position.set(s * (50 + ctx.rng() * 70), 0, Z_FAR + ctx.rng() * 240); ctx.g.add(hill); }
      addCloud(ctx, -50, 50, -220, 2); addCloud(ctx, 60, 56, -250, 1.8); addCloud(ctx, 10, 52, -180, 1.4);
    },
  },

  // ===== Sci-fi / racing & tactical =====
  antigrav: {
    label: 'Anti-Grav Circuit',
    fleet: 'spacecraft',
    bg: 0x05060f, fog: [0x05060f, 110, 400],
    build(ctx) {
      const { Z_NEAR, Z_FAR, ROAD_HALF_W } = ctx.C;
      addLights(ctx, { sky: 0x2a3a6e, ground: 0x05060f, hemi: 1.2, sun: 0x6a8aff, sunInt: 0.5, sunPos: [0, 70, 30] });
      const L = Z_NEAR - Z_FAR + 30;
      box(ctx, ROAD_HALF_W * 2 + 3, 1.6, L, 0x0a0e1c, 0, -0.8, (Z_NEAR + Z_FAR) / 2);
      addRoad(ctx, { asphalt: 0x0c1024, dash: 0x18e0ff, edge: 0xff6a2a, median: null, rail: null, dashLen: 6, dashEvery: 8 });
      for (const side of [-1, 1]) box(ctx, 0.3, 0.3, L, 0x18e0ff, side * (ROAD_HALF_W + 1), 0.4, (Z_NEAR + Z_FAR) / 2, 0, true);
      [-30, -90, -150, -210].forEach((z, i) => addNeonArch(ctx, z, i % 2 ? 0xff6a2a : 0x18e0ff));
      addBoxCity(ctx, { count: 30, near: 60, spread: 90, color: 0x0a1020, hMin: 14, hMax: 50, edgeGlow: 0x18e0ff });
      addStars(ctx, { count: 400, color: 0x8ad8ff });
    },
  },
  trench: {
    label: 'The Trench',
    fleet: 'spacecraft',
    bg: 0x10141a, fog: [0x10141a, 80, 300],
    build(ctx) {
      addLights(ctx, { sky: 0x6a7886, ground: 0x10141a, hemi: 1.5, sun: 0xc8d4e0, sunInt: 0.8, sunPos: [0, 60, 40] });
      addGround(ctx, 0x1a1f26);
      addRoad(ctx, { asphalt: 0x22272e, dash: 0x8a96a4, edge: 0x6a7684, median: null, rail: null, dashLen: 4, dashEvery: 10 });
      addTrenchWall(ctx, -1, 0x2e353e);
      addTrenchWall(ctx, 1, 0x2e353e);
      box(ctx, 3, 3, 3, 0xffd24a, 0, 8, -210, 0, true);
      addStars(ctx, { count: 300 });
    },
  },
  tron: {
    label: 'Neon Freeway',
    fleet: 'lightcycles',
    bg: 0x02030a, fog: [0x02030a, 130, 440],
    build(ctx) {
      addLights(ctx, { sky: 0x10406a, ground: 0x02030a, hemi: 1.2, sun: 0x18e0ff, sunInt: 0.4, sunPos: [0, 70, 30] });
      addGrid(ctx, { color: 0x0e6a8a });
      addRoad(ctx, { asphalt: 0x03060e, dash: 0x18e0ff, edge: 0x18e0ff, median: 0x081822, rail: null, dashLen: 6, dashEvery: 9 });
      [-40, -110, -180].forEach((z) => addNeonArch(ctx, z, 0x18e0ff));
      addBoxCity(ctx, { count: 40, near: 50, spread: 90, color: 0x041018, hMin: 14, hMax: 56, edgeGlow: 0x18e0ff });
      addStars(ctx, { count: 250, color: 0x6ee8ff });
    },
  },
  radar: {
    label: 'Tactical Radar',
    fleet: 'armor',
    bg: 0x021207, fog: [0x021207, 120, 380],
    build(ctx) {
      const { ROAD_HALF_W, Z_FAR } = ctx.C;
      addLights(ctx, { sky: 0x1a5a2a, ground: 0x021207, hemi: 1.3, sun: 0x4aff7a, sunInt: 0.4, sunPos: [0, 80, 0] });
      addRadarGround(ctx, 0x35e06a);
      addRoad(ctx, { asphalt: 0x06200e, dash: 0x35e06a, edge: 0x35e06a, median: null, rail: null, dashLen: 3, dashEvery: 10 });
      for (let i = 0; i < 10; i++) { const s = ctx.rng() < 0.5 ? -1 : 1; box(ctx, 3, 2, 3, 0x1a3a22, s * (ROAD_HALF_W + 6 + ctx.rng() * 40), 1, Z_FAR + ctx.rng() * 260); }
      addStars(ctx, { count: 150, color: 0x6affa0 });
    },
  },
  citymap: {
    label: 'City Traffic Map',
    bg: 0x1a2230, fog: [0x1a2230, 150, 470],
    build(ctx) {
      const { ROAD_HALF_W, Z_FAR } = ctx.C;
      addLights(ctx, { sky: 0xdde6f0, ground: 0x2a3340, hemi: 2.3, sun: 0xffffff, sunInt: 0.7, sunPos: [30, 90, 20] });
      addGround(ctx, 0x222b38);
      addRoad(ctx, { asphalt: 0x39424f, dash: 0xf0d24a, edge: 0xe8eef4, median: 0x4a5460, rail: 0x303a46 });
      // gridded district buildings in node colours, with lit rooftops
      const cols = [0x4a9ed8, 0x4ad88a, 0xe85a5a, 0xe8b84a, 0x9a6ad8];
      for (let i = 0; i < 64; i++) {
        const s = ctx.rng() < 0.5 ? -1 : 1;
        const x = s * (ROAD_HALF_W + 8 + Math.floor(ctx.rng() * 8) * 11);
        const z = Z_FAR + Math.floor(ctx.rng() * 30) * 11;
        const h = 4 + ctx.rng() * 11, col = cols[Math.floor(ctx.rng() * cols.length)];
        box(ctx, 5, h, 5, col, x, h / 2, z);
        box(ctx, 4.4, 0.3, 4.4, 0xffffff, x, h + 0.2, z, 0, true);
      }
      // street grid on the ground (cross + parallel)
      for (let z = Z_FAR; z < 60; z += 28) box(ctx, 240, 0.04, 1.4, 0x4a5460, 0, 0.03, z);
      for (let x = -110; x <= 110; x += 28) box(ctx, 1.4, 0.04, 320, 0x4a5460, x, 0.03, -70);
    },
  },
  motorways: {
    label: 'Motorways',
    bg: 0xeae4d8, fog: [0xeae4d8, 170, 480],
    build(ctx) {
      const { ROAD_HALF_W, Z_FAR } = ctx.C;
      addLights(ctx, { sky: 0xfbf7ee, ground: 0xd8d0c0, hemi: 2.6, sun: 0xffffff, sunInt: 0.6, sunPos: [30, 90, 30] });
      addGround(ctx, 0xe4ddcf);
      addRoad(ctx, { asphalt: 0xcfc7b6, dash: 0xfbf7ee, edge: 0xb8b0a0, median: null, rail: null, dashLen: 3, dashEvery: 12 });
      const cols = [0xe85a5a, 0x4a9ed8, 0x4ad88a, 0xe8b84a, 0x9a6ad8];
      for (let i = 0; i < 22; i++) { const s = ctx.rng() < 0.5 ? -1 : 1; const c = cols[Math.floor(ctx.rng() * cols.length)]; const x = s * (ROAD_HALF_W + 8 + ctx.rng() * 50), z = Z_FAR + ctx.rng() * 290; box(ctx, 2.4, 2.4, 2.4, c, x, 1.4, z); const disc = new THREE.Mesh(new THREE.CircleGeometry(4, 20), new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.18 })); disc.rotation.x = -Math.PI / 2; disc.position.set(x, 0.03, z); ctx.g.add(disc); }
    },
  },
  observatory: {
    label: 'Packet Observatory',
    fleet: 'lightcycles',
    bg: 0x04060c, fog: [0x04060c, 90, 300],
    build(ctx) {
      const { ROAD_HALF_W } = ctx.C;
      addLights(ctx, { sky: 0x1a3a5a, ground: 0x04060c, hemi: 1.2, sun: 0x35d2e8, sunInt: 0.5, sunPos: [0, 70, 30] });
      addGround(ctx, 0x05080f);
      addRoad(ctx, { asphalt: 0x0a1018, dash: 0x35d2e8, edge: 0x35d2e8, median: 0x0e1822, rail: 0x122430 });
      addGrid(ctx, { color: 0x0e4a5a, div: 80 });
      addBillboard(ctx, -(ROAD_HALF_W + 7), -50, 0.4, 'TCP 443', '#35d2e8', '#04080e');
      addBillboard(ctx, ROAD_HALF_W + 7, -100, -0.4, 'INGRESS', '#7adf8a', '#04080e');
      addBillboard(ctx, -(ROAD_HALF_W + 7), -160, 0.4, 'ALERT', '#ff5a5a', '#0e0406');
      addBoxCity(ctx, { count: 30, near: 60, spread: 80, color: 0x081018, hMin: 14, hMax: 50, edgeGlow: 0x35d2e8 });
      addStars(ctx, { count: 200, color: 0x6ae8ff });
    },
  },

  // ===== Indie art styles =====
  limbo: {
    label: 'Limbo',
    bg: 0x6e7378, fog: [0x6e7378, 50, 200],
    build(ctx) {
      const { ROAD_HALF_W, Z_FAR } = ctx.C;
      addLights(ctx, { sky: 0x9a9ea2, ground: 0x1a1c1e, hemi: 1.8, sun: 0xc8ccd0, sunInt: 0.5, sunPos: [0, 60, -40] });
      addGround(ctx, 0x14161a);
      addRoad(ctx, { asphalt: 0x1a1c20, dash: 0x3a3e44, edge: 0x4a4e54, median: null, rail: 0x000000 });
      for (let i = 0; i < 40; i++) addSilhouetteTree(ctx, (ctx.rng() < 0.5 ? -1 : 1) * (ROAD_HALF_W + 5 + ctx.rng() * 60), Z_FAR + ctx.rng() * 300, 8 + ctx.rng() * 8);
      for (let i = 0; i < 10; i++) { const s = ctx.rng() < 0.5 ? -1 : 1; box(ctx, 6, 10 + ctx.rng() * 16, 6, 0x000000, s * (50 + ctx.rng() * 60), 8, Z_FAR + ctx.rng() * 240); }
      addSkyDisc(ctx, { color: 0xb8bcc0, r: 18, x: 0, y: 40, z: -290 });
    },
  },
  cuphead: {
    label: 'Rubber Hose',
    fleet: 'vintage',
    bg: 0xe8d8b0, fog: [0xe8d8b0, 120, 380],
    build(ctx) {
      const { ROAD_HALF_W, Z_FAR } = ctx.C;
      addLights(ctx, { sky: 0xfaf0d8, ground: 0xb8a878, hemi: 2.2, sun: 0xfff0c8, sunInt: 1.0, sunPos: [30, 60, 20] });
      addGround(ctx, 0xc8b888);
      addRoad(ctx, { asphalt: 0x6a5a44, dash: 0xe8dcc0, edge: 0x3a2e20, median: null, rail: 0x3a2e20 });
      for (let i = 0; i < 36; i++) addInkTree(ctx, (ctx.rng() < 0.5 ? -1 : 1) * (ROAD_HALF_W + 6 + ctx.rng() * 60), Z_FAR + ctx.rng() * 300);
      for (let i = 0; i < 8; i++) addMesa(ctx, (ctx.rng() < 0.5 ? -1 : 1) * (55 + ctx.rng() * 70), Z_FAR + ctx.rng() * 240, 0.7 + ctx.rng(), 0x8a6a4a);
      addSkyDisc(ctx, { color: 0xf0d89a, r: 16, x: 50, y: 55, z: -260, glowColor: 0xe0b86a });
      addCloud(ctx, -50, 55, -220, 1.8, 0xfdf4e0); addCloud(ctx, 60, 60, -250, 1.5, 0xfdf4e0);
    },
  },
  okami: {
    label: 'Ink Wash',
    fleet: 'wagons',
    bg: 0xefe6d2, fog: [0xefe6d2, 130, 400],
    build(ctx) {
      const { ROAD_HALF_W, Z_FAR } = ctx.C;
      addLights(ctx, { sky: 0xfbf6ea, ground: 0xc8bca0, hemi: 2.3, sun: 0xfff0e0, sunInt: 0.9, sunPos: [-30, 60, -30] });
      addGround(ctx, 0xe4dcc8);
      addRoad(ctx, { asphalt: 0x8a8472, dash: 0xefe8d8, edge: 0x2a2418, median: null, rail: 0x2a2418 });
      for (let i = 0; i < 30; i++) addInkTree(ctx, (ctx.rng() < 0.5 ? -1 : 1) * (ROAD_HALF_W + 6 + ctx.rng() * 60), Z_FAR + ctx.rng() * 300);
      for (let i = 0; i < 8; i++) addMesa(ctx, (ctx.rng() < 0.5 ? -1 : 1) * (55 + ctx.rng() * 80), Z_FAR + ctx.rng() * 250, 0.8 + ctx.rng(), 0x6a6250);
      addSkyDisc(ctx, { color: 0xd84a3a, r: 13, x: -70, y: 48, z: -250, glowColor: 0xe87a5a });
    },
  },
  journey: {
    label: 'Dunes',
    bg: 0xe8a85e, fog: [0xe8a85e, 120, 400],
    build(ctx) {
      const { Z_FAR } = ctx.C;
      addLights(ctx, { sky: 0xffd9a0, ground: 0xc88a3a, hemi: 2.0, sun: 0xffe6b0, sunInt: 1.2, sunPos: [-40, 30, -80] });
      addGround(ctx, 0xe0a64e);
      addRoad(ctx, { asphalt: 0xc89a5a, dash: 0xf0d8a8, edge: 0xd8b878, median: null, rail: null, dashLen: 2, dashEvery: 14 });
      for (let i = 0; i < 22; i++) addDune(ctx, (ctx.rng() < 0.5 ? -1 : 1) * (40 + ctx.rng() * 120), Z_FAR + ctx.rng() * 290, 0.7 + ctx.rng() * 1.5, 0xd89a4a);
      addSkyDisc(ctx, { color: 0xfff0c8, r: 20, x: -60, y: 30, z: -280, glowColor: 0xffc878 });
    },
  },
  windwaker: {
    label: 'Toon Sea',
    fleet: 'boats',
    bg: 0x6ec8e8, fog: [0x6ec8e8, 140, 440],
    build(ctx) {
      const { Z_FAR } = ctx.C;
      addLights(ctx, { sky: 0xeaf8ff, ground: 0x2a8ab0, hemi: 2.3, sun: 0xfff6d0, sunInt: 1.2, sunPos: [50, 70, 20] });
      addGround(ctx, 0x2a9ec0);
      addRoad(ctx, { asphalt: 0x2e9ec8, dash: 0xeafaff, edge: 0xbfe8f4, median: null, rail: null, dashLen: 1.4, dashEvery: 14 });
      for (let i = 0; i < 10; i++) { const s = ctx.rng() < 0.5 ? -1 : 1; const h = 6 + ctx.rng() * 8; const x = s * (50 + ctx.rng() * 70), z = Z_FAR + ctx.rng() * 240; const isl = new THREE.Mesh(new THREE.ConeGeometry(10 + ctx.rng() * 8, h, 8), mat(0x4ab85a)); isl.position.set(x, h / 2 - 1, z); ctx.g.add(isl); box(ctx, 14, 2, 14, 0xe8d8a0, x, 0.5, z); }
      addSkyDisc(ctx, { color: 0xfff6d0, r: 14, x: 70, y: 60, z: -260, glowColor: 0xffe6a0 });
      addCloud(ctx, -50, 56, -220, 2.4); addCloud(ctx, 60, 60, -250, 2);
    },
  },
  borderlands: {
    label: 'Cel Wastes',
    bg: 0xe8943a, fog: [0xe8943a, 110, 340],
    build(ctx) {
      const { ROAD_HALF_W, Z_FAR } = ctx.C;
      addLights(ctx, { sky: 0xffd07a, ground: 0x5a3a1a, hemi: 1.9, sun: 0xffae40, sunInt: 1.3, sunPos: [20, 55, -50] });
      addGround(ctx, 0xc06a28);
      addRoad(ctx, { asphalt: 0x33241a, dash: 0xffd24a, edge: 0x120a04, median: null, rail: 0x120a04 });
      // chunky scrap towers framed in heavy black ink outlines (comic look),
      // with bold accent panels — distinct from the smooth desert mesas.
      const accents = [0xe8473a, 0x3a9ad8, 0xf0c020, 0x6ac04a];
      for (let i = 0; i < 18; i++) {
        const s = ctx.rng() < 0.5 ? -1 : 1;
        const x = s * (ROAD_HALF_W + 8 + ctx.rng() * 50), z = Z_FAR + ctx.rng() * 280;
        const h = 5 + ctx.rng() * 9, w = 4 + ctx.rng() * 3;
        box(ctx, w + 0.7, h + 0.7, w + 0.7, 0x120a04, x, h / 2, z);       // black outline shell
        box(ctx, w, h, w, ctx.rng() < 0.4 ? accents[Math.floor(ctx.rng() * 4)] : 0x8a5630, x, h / 2, z);
        box(ctx, w * 0.45, 1.6, w * 0.45, 0x120a04, x, h + 0.8, z);       // rooftop tank
      }
      for (let i = 0; i < 8; i++) {
        const s = ctx.rng() < 0.5 ? -1 : 1, x = s * (45 + ctx.rng() * 90), z = Z_FAR + ctx.rng() * 260, hh = 10 + ctx.rng() * 16;
        const cone = new THREE.Mesh(new THREE.ConeGeometry(6, hh, 5), mat(0x7a3a18));
        cone.position.set(x, hh / 2 - 1, z); ctx.g.add(cone);
      }
      addSkyDisc(ctx, { color: 0xfff0b0, r: 16, x: 40, y: 50, z: -270, glowColor: 0xffae40 });
    },
  },
  monument: {
    label: 'Monument',
    bg: 0xf0d8e0, fog: [0xf0d8e0, 140, 440],
    build(ctx) {
      const { ROAD_HALF_W, Z_FAR } = ctx.C;
      addLights(ctx, { sky: 0xfbeef2, ground: 0xc8a8c0, hemi: 2.4, sun: 0xfff0f6, sunInt: 0.8, sunPos: [30, 80, 20] });
      addGround(ctx, 0xd8b8d0);
      addRoad(ctx, { asphalt: 0xc89ac0, dash: 0xf6e6f0, edge: 0xe0c0d8, median: null, rail: null, dashLen: 3, dashEvery: 12 });
      const cols = [0xe89ab0, 0x9ab8e8, 0xe8c89a, 0xa0e0c0, 0xc0a0e8];
      for (let i = 0; i < 16; i++) addMonument(ctx, (ctx.rng() < 0.5 ? -1 : 1) * (ROAD_HALF_W + 10 + ctx.rng() * 60), Z_FAR + 10 + ctx.rng() * 280, cols[Math.floor(ctx.rng() * cols.length)]);
      addSkyDisc(ctx, { color: 0xfff0f6, r: 12, x: 70, y: 65, z: -260, glowColor: 0xf0c8e0 });
    },
  },
  hallownest: {
    label: 'Hallownest',
    fleet: 'bugs',
    bg: 0x06101a, fog: [0x06101a, 60, 220],
    build(ctx) {
      const { ROAD_HALF_W, Z_FAR } = ctx.C;
      addLights(ctx, { sky: 0x1a4a6a, ground: 0x040a12, hemi: 1.3, sun: 0x4ad8e8, sunInt: 0.5, sunPos: [0, 60, -30] });
      addGround(ctx, 0x06101a);
      addRoad(ctx, { asphalt: 0x0e1a26, dash: 0x4ad8e8, edge: 0x2a5a6a, median: null, rail: 0x16303e });
      for (let i = 0; i < 16; i++) addGothicTower(ctx, (ctx.rng() < 0.5 ? -1 : 1) * (30 + ctx.rng() * 80), Z_FAR + ctx.rng() * 260, 20 + ctx.rng() * 30);
      makeParticles(ctx, { count: 400, color: 0x6ae8f0, size: 0.6, area: [240, 40, 320], opacity: 0.7 });
      for (let i = 0; i < 6; i++) { const s = ctx.rng() < 0.5 ? -1 : 1; const pool = new THREE.Mesh(new THREE.CircleGeometry(5 + ctx.rng() * 4, 14), new THREE.MeshBasicMaterial({ color: 0x2a8a9a, transparent: true, opacity: 0.4 })); pool.rotation.x = -Math.PI / 2; pool.position.set(s * (ROAD_HALF_W + 10 + ctx.rng() * 40), 0.02, Z_FAR + ctx.rng() * 260); ctx.g.add(pool); }
      addStars(ctx, { count: 200, color: 0x6ae8f0 });
    },
  },
};

// Ordered groups for the theme dropdown (keeps a 52-item list navigable).
export const THEME_GROUPS = [
  { label: 'Highway & Nature', keys: ['night', 'hawaii', 'autobahn', 'bigcity', 'rome', 'west', 'snow', 'jungle', 'mars', 'shire', 'gotham', 'neon', 'grid', 'fury'] },
  { label: 'Creatures & Fleets', keys: ['ocean', 'reef', 'sky', 'rails', 'savanna', 'arctic', 'dino', 'magic', 'christmas', 'depths', 'skyfair', 'space'] },
  { label: 'Game Worlds', keys: ['voxel', 'witcher', 'halo', 'fallout', 'battlefield', 'nightcity', 'crystal', 'velvet', 'mirrorsedge', 'deusex', 'mario'] },
  { label: 'Sci-Fi & Tactical', keys: ['antigrav', 'trench', 'tron', 'radar', 'citymap', 'motorways', 'observatory'] },
  { label: 'Art Styles', keys: ['limbo', 'cuphead', 'okami', 'journey', 'windwaker', 'borderlands', 'monument', 'hallownest'] },
];

// ---------------------------------------------------------------------------
export function buildThemeEnvironment(key, C) {
  const theme = THEMES[key] || THEMES.night;
  const group = new THREE.Group();
  const rng = mulberry32(1337);
  const animate = theme.build({ g: group, rng, C }) || null;
  return { group, animate, theme };
}

export function disposeGroup(group) {
  group.traverse((obj) => {
    if (obj.geometry) obj.geometry.dispose();
    if (obj.material) {
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      for (const m of mats) {
        if (m.map) m.map.dispose();
        m.dispose();
      }
    }
  });
}
