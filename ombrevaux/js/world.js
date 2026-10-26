import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CollisionWorld } from './collision.js';
import { mat, makeLantern, makePage, makeRelic, compactModel } from './models.js';
import * as TX from './textures.js';
import { mulberry32, fbm, noise2, clamp, distToPolyline, smooth } from './utils.js';

// Tracé du chemin principal (du sud au nord, vers -Z).
export const PATH = [
  [0, 22], [3, 0], [5, -25], [-4, -55], [2, -85], [0, -100], [0, -126],
  [-5, -150], [-2, -175], [0, -196], [0, -230], [0, -262], [0, -300], [0, -352],
];

export const ZONES = [
  { name: 'Bois des Pendus', test: (z) => z > -97 },
  { name: 'La Gorge Voilée', test: (z) => z > -126 },
  { name: 'Cimetière des Veilleurs', test: (z) => z > -197 },
  { name: 'Malbrume', test: (z) => z > -329 },
  { name: 'Parvis de Sainte-Vesper', test: (z) => z > -355 },
  { name: 'Cathédrale Sainte-Vesper', test: (z) => z > -471 },
  { name: 'Le Chœur de la Rosace', test: () => true },
];

export const POI = {
  start: new THREE.Vector3(0, 0, 14),
  shrine: new THREE.Vector3(-30, 0, -58),
  veil: new THREE.Vector3(0, 0, -112),
  chapel: new THREE.Vector3(24, 0, -168),
  gate: new THREE.Vector3(0, 0, -196),
  square: new THREE.Vector3(0, 0, -262),
  door: new THREE.Vector3(0, 0, -354.5),
  choir: new THREE.Vector3(0, 0, -494),
};

export class World {
  constructor(scene) {
    this.scene = scene;
    this.col = new CollisionWorld();
    this.lightSpots = [];     // lumières statiques (attribuées dynamiquement)
    this.lanterns = [];
    this.pickups = [];
    this.conduits = [];
    this.animated = [];       // fonctions (t, dt) => void
    this.minimapBoxes = [];
    this.graves = [];
    this.rnd = mulberry32(1337);

    this.defineAreas();
    this.buildSky();
    this.buildTerrain();
    this.buildForest();
    this.buildGorge();
    this.buildCemetery();
    this.buildVillage();
    this.buildCathedral();
    this.buildGroundFog();
    this.buildPOIs();
    this.bakeStatic();
  }

  shared(key, make) {
    this.mats = this.mats || {};
    return this.mats[key] || (this.mats[key] = make());
  }

  // Fusionne toute la géométrie statique par matériau et par bloc de 40 m :
  // des centaines d'objets deviennent quelques dizaines d'appels de dessin.
  bakeStatic() {
    this.scene.updateMatrixWorld(true);
    const buckets = new Map();
    const victims = [];
    const center = new THREE.Vector3();
    const visit = (o) => {
      if (o.userData.dynamic) return;
      if (o.isMesh && !o.isInstancedMesh && o !== this.terrain && !o.material.isShaderMaterial && !Array.isArray(o.material)) {
        const geo = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
        for (const name of Object.keys(geo.attributes)) if (!['position', 'normal', 'uv'].includes(name)) geo.deleteAttribute(name);
        if (!geo.attributes.uv) return;
        geo.applyMatrix4(o.matrixWorld);
        geo.computeBoundingBox();
        geo.boundingBox.getCenter(center);
        const key = `${o.material.uuid}|${Math.floor(center.x / 40)},${Math.floor(center.z / 40)}|${o.castShadow}|${o.receiveShadow}|${o.renderOrder}`;
        if (!buckets.has(key)) buckets.set(key, { mat: o.material, geos: [], cast: o.castShadow, recv: o.receiveShadow, order: o.renderOrder });
        buckets.get(key).geos.push(geo);
        victims.push(o);
      }
      for (const c of [...o.children]) visit(c);
    };
    for (const c of [...this.scene.children]) visit(c);
    for (const o of victims) o.parent.remove(o);
    for (const b of buckets.values()) {
      const merged = mergeGeometries(b.geos, false);
      b.geos.forEach((g) => g.dispose());
      if (!merged) continue;
      const m = new THREE.Mesh(merged, b.mat);
      m.castShadow = b.cast;
      m.receiveShadow = b.recv;
      m.renderOrder = b.order;
      m.matrixAutoUpdate = false;
      this.scene.add(m);
    }
    this.bakeStats = { objects: victims.length, meshes: buckets.size };
  }

  defineAreas() {
    const c = this.col;
    c.addArea(-45, -100, 45, 24, 'forest');
    c.addArea(-5, -128, 5, -96, 'gorge');
    c.addArea(-40, -194, 40, -124, 'cemetery');
    c.addArea(-3, -200, 3, -190, 'gate');
    c.addArea(-55, -332, 55, -198, 'village');
    c.addArea(-32, -354, 32, -328, 'parvis');
    c.addArea(-3.5, -358, 3.5, -350, 'door');
    c.addArea(-12.5, -472, 12.5, -355, 'nave');
    c.addArea(-24, -518, 24, -468, 'choir');
  }

  inCathedral(x, z) {
    return z < -353 && Math.abs(x) < 26;
  }

  getHeight(x, z) {
    if (this.inCathedral(x, z)) return 0;
    const out = this.col.outsideDistance(x, z);
    let h;
    if (z < -196) h = fbm(x * 0.05, z * 0.05, 2) * 0.25;
    else h = fbm(x * 0.04, z * 0.04, 3) * 0.9 + noise2(x * 0.3, z * 0.3) * 0.05;
    // Le chemin est légèrement creusé.
    if (out > 0) {
      const rise = z < -340 ? Math.min(3, out * 0.25) : Math.min(16, out * 0.7 + out * out * 0.02);
      h += rise * (0.75 + fbm(x * 0.08, z * 0.08, 2) * 0.5);
    }
    return h;
  }

  // ------------------------------------------------------------------ Ciel
  buildSky() {
    const geo = new THREE.SphereGeometry(900, 32, 16);
    const m = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        uTop: { value: new THREE.Color(0x03040a) },
        uHorizon: { value: new THREE.Color(0x0d121c) },
        uMoonDir: { value: new THREE.Vector3(-0.25, 0.38, -0.9).normalize() },
        uGlow: { value: new THREE.Color(0x3a4a70) },
      },
      vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position,1.); gl_Position = p.xyww; }`,
      fragmentShader: `
        uniform vec3 uTop; uniform vec3 uHorizon; uniform vec3 uMoonDir; uniform vec3 uGlow;
        varying vec3 vDir;
        void main(){
          float h = clamp(vDir.y, 0.0, 1.0);
          vec3 c = mix(uHorizon, uTop, pow(h, 0.45));
          float m = max(dot(normalize(vDir), uMoonDir), 0.0);
          c += uGlow * (pow(m, 12.0) * 0.6 + pow(m, 120.0) * 1.5);
          gl_FragColor = vec4(c, 1.0);
        }`,
    });
    this.skyMat = m;
    const sky = new THREE.Mesh(geo, m);
    sky.renderOrder = -10;
    sky.frustumCulled = false;
    this.sky = sky;
    this.scene.add(sky);

    // Étoiles
    const n = 1400, pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const u = this.rnd(), v = this.rnd() * 0.9 + 0.08;
      const th = u * Math.PI * 2, ph = Math.asin(v);
      pos[i * 3] = Math.cos(th) * Math.cos(ph) * 800;
      pos[i * 3 + 1] = Math.sin(ph) * 800;
      pos[i * 3 + 2] = Math.sin(th) * Math.cos(ph) * 800;
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xcfd8ff, size: 1.6, sizeAttenuation: false, fog: false, transparent: true, opacity: 0.8, depthWrite: false }));
    this.stars.frustumCulled = false;
    this.scene.add(this.stars);

    // Lune
    const moonDir = m.uniforms.uMoonDir.value;
    const moon = new THREE.Sprite(new THREE.SpriteMaterial({ map: TX.moonTexture(), fog: false, depthWrite: false, color: new THREE.Color(1.6, 1.55, 1.4) }));
    moon.scale.setScalar(70);
    moon.position.copy(moonDir).multiplyScalar(780);
    this.moon = moon;
    this.scene.add(moon);
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: TX.glowSprite('rgba(140,160,220,0.5)', 'rgba(60,70,120,0)'), fog: false, depthWrite: false, blending: THREE.AdditiveBlending }));
    halo.scale.setScalar(320);
    halo.position.copy(moonDir).multiplyScalar(790);
    this.moonHalo = halo;
    this.scene.add(halo);
  }

  followCamera(cam) {
    this.sky.position.copy(cam.position);
    this.stars.position.copy(cam.position);
    this.moon.position.copy(this.skyMat.uniforms.uMoonDir.value).multiplyScalar(780).add(cam.position);
    this.moonHalo.position.copy(this.skyMat.uniforms.uMoonDir.value).multiplyScalar(790).add(cam.position);
  }

  // ------------------------------------------------------------------ Terrain
  buildTerrain() {
    const W = 260, D = 620, seg = 2;
    const geo = new THREE.PlaneGeometry(W, D, W / seg, D / seg);
    geo.rotateX(-Math.PI / 2);
    geo.translate(0, 0, -250);
    const p = geo.attributes.position;
    const colors = new Float32Array(p.count * 3);
    const cMoss = new THREE.Color(0x2c3322), cDirt = new THREE.Color(0x4a3f33), cHill = new THREE.Color(0x1f2219);
    const cCobble = new THREE.Color(0x4b4945), cGrave = new THREE.Color(0x2a3027), cPlaza = new THREE.Color(0x5a5650);
    const tmp = new THREE.Color();
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i);
      const h = this.getHeight(x, z);
      p.setY(i, h);
      const out = this.col.outsideDistance(x, z);
      const dPath = distToPolyline(x, z, PATH);
      const n = fbm(x * 0.1, z * 0.1, 2) * 0.5 + 0.5;
      if (z < -328 && z > -360) tmp.copy(cPlaza);
      else if (z < -197) tmp.copy(cCobble).lerp(cDirt, n * 0.5);
      else if (z < -124 && z > -197) tmp.copy(cGrave).lerp(cDirt, n * 0.3);
      else tmp.copy(cMoss).lerp(cDirt, n * 0.35);
      const pathW = z < -197 ? 6 : 2.6;
      if (dPath < pathW) tmp.lerp(z < -197 ? cPlaza : cDirt, (1 - dPath / pathW) * 0.8);
      if (out > 0) tmp.lerp(cHill, clamp(out / 8, 0, 1));
      tmp.multiplyScalar(0.85 + n * 0.3);
      colors[i * 3] = tmp.r; colors[i * 3 + 1] = tmp.g; colors[i * 3 + 2] = tmp.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    const tex = TX.groundDetail();
    tex.repeat.set(W / 6, D / 6);
    const m = new THREE.MeshStandardMaterial({ vertexColors: true, map: tex, roughness: 1, metalness: 0 });
    const mesh = new THREE.Mesh(geo, m);
    mesh.receiveShadow = true;
    this.scene.add(mesh);
    this.terrain = mesh;
  }

  // ------------------------------------------------------------------ Arbres morts
  treeGeometry(seed) {
    const rnd = mulberry32(seed);
    const parts = [];
    const up = new THREE.Vector3(0, 1, 0);
    const branch = (start, dir, len, rad, depth) => {
      const g = new THREE.CylinderGeometry(rad * 0.6, rad, len, 5, 1, depth < 4);
      g.translate(0, len / 2, 0);
      const q = new THREE.Quaternion().setFromUnitVectors(up, dir.clone().normalize());
      g.applyQuaternion(q);
      g.translate(start.x, start.y, start.z);
      parts.push(g);
      if (depth <= 0 || rad < 0.04) return;
      const end = start.clone().add(dir.clone().normalize().multiplyScalar(len));
      const kids = depth > 2 ? 2 + Math.floor(rnd() * 2) : 2;
      for (let k = 0; k < kids; k++) {
        const nd = dir.clone().normalize();
        nd.x += (rnd() - 0.5) * 1.6; nd.z += (rnd() - 0.5) * 1.6; nd.y += 0.1 + rnd() * 0.3;
        const at = start.clone().lerp(end, 0.55 + rnd() * 0.45);
        branch(at, nd, len * (0.55 + rnd() * 0.2), rad * 0.55, depth - 1);
      }
    };
    const h = 4 + rnd() * 3;
    const lean = new THREE.Vector3((rnd() - 0.5) * 0.25, 1, (rnd() - 0.5) * 0.25);
    branch(new THREE.Vector3(0, -0.3, 0), lean, h, 0.32 + rnd() * 0.12, 4);
    const merged = mergeGeometries(parts);
    parts.forEach((p) => p.dispose());
    return merged;
  }

  buildForest() {
    const variants = [];
    for (let i = 0; i < 4; i++) variants.push(this.treeGeometry(100 + i * 17));
    const barkMat = new THREE.MeshStandardMaterial({ color: 0x2a2520, roughness: 1, flatShading: true });
    const placements = variants.map(() => []);
    const rnd = this.rnd;
    const keep = [POI.shrine, POI.start, POI.chapel, POI.veil];
    const tryPlace = (x, z, inside) => {
      for (const k of keep) if (Math.hypot(x - k.x, z - k.z) < 9) return;
      if (distToPolyline(x, z, PATH) < (inside ? 4 : 3)) return;
      const v = Math.floor(rnd() * variants.length);
      const s = inside ? 0.9 + rnd() * 0.5 : 1 + rnd() * 0.8;
      placements[v].push([x, this.getHeight(x, z), z, rnd() * Math.PI * 2, s]);
      if (inside) this.col.addCircle(x, z, 0.45 * s, { h: 6, cam: false });
    };
    // Dans la forêt praticable
    for (let i = 0; i < 160; i++) {
      const x = -44 + rnd() * 88, z = -98 + rnd() * 120;
      if (this.col.inAreas(x, z, 1)) tryPlace(x, z, true);
    }
    // Cimetière clairsemé
    for (let i = 0; i < 22; i++) {
      const x = -38 + rnd() * 76, z = -192 + rnd() * 66;
      if (Math.abs(x) > 12 && this.col.inAreas(x, z, 1)) tryPlace(x, z, true);
    }
    // Bordure dense hors zone
    for (let i = 0; i < 2600; i++) {
      const x = -125 + rnd() * 250, z = -335 + rnd() * 395;
      const out = this.col.outsideDistance(x, z);
      if (out > 0.8 && out < 34) tryPlace(x, z, false);
    }
    const dummy = new THREE.Object3D();
    variants.forEach((g, vi) => {
      // Regroupement par blocs pour que le culling (caméra et ombres) soit efficace.
      const chunks = new Map();
      for (const pl of placements[vi]) {
        const key = `${Math.floor(pl[0] / 70)},${Math.floor(pl[2] / 70)}`;
        if (!chunks.has(key)) chunks.set(key, []);
        chunks.get(key).push(pl);
      }
      for (const list of chunks.values()) {
        const im = new THREE.InstancedMesh(g, barkMat, list.length);
        list.forEach(([x, y, z, r, s], i) => {
          dummy.position.set(x, y, z);
          dummy.rotation.set((rnd() - 0.5) * 0.1, r, (rnd() - 0.5) * 0.1);
          dummy.scale.setScalar(s);
          dummy.updateMatrix();
          im.setMatrixAt(i, dummy.matrix);
        });
        im.castShadow = true;
        im.receiveShadow = true;
        this.scene.add(im);
      }
    });

    // Rochers
    const rockGeo = new THREE.IcosahedronGeometry(1, 0);
    const rockMat = new THREE.MeshStandardMaterial({ color: 0x4a4a48, roughness: 1, flatShading: true });
    const rocks = [];
    for (let i = 0; i < 220; i++) {
      const x = -60 + rnd() * 120, z = -195 + rnd() * 215;
      const out = this.col.outsideDistance(x, z);
      if (distToPolyline(x, z, PATH) < 4) continue;
      if (out === 0 && rnd() < 0.6) continue;
      if (out > 25) continue;
      const s = out > 0 ? 1 + rnd() * 2.5 : 0.4 + rnd() * 0.8;
      rocks.push([x, z, s]);
      if (out === 0 && s > 0.6) this.col.addCircle(x, z, s * 0.85, { h: s, cam: false });
    }
    const rim = new THREE.InstancedMesh(rockGeo, rockMat, rocks.length);
    rocks.forEach(([x, z, s], i) => {
      dummy.position.set(x, this.getHeight(x, z) + s * 0.2, z);
      dummy.rotation.set(rnd() * 3, rnd() * 3, rnd() * 3);
      dummy.scale.set(s, s * (0.6 + rnd() * 0.4), s * (0.8 + rnd() * 0.4));
      dummy.updateMatrix();
      rim.setMatrixAt(i, dummy.matrix);
    });
    rim.castShadow = true; rim.receiveShadow = true;
    this.scene.add(rim);

    // Pendus (cordes et cages) : décor macabre
    const ropeMat = mat(0x5a4a33);
    const cageMat = mat(0x1a1a1c, { metalness: 0.6 });
    for (const [x, z] of [[-12, -18], [16, -40], [-20, -80], [10, -70], [26, 2]]) {
      const y = this.getHeight(x, z);
      const g = new THREE.Group();
      g.position.set(x, y, z);
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.25, 5, 0.25), barkMat);
      post.position.y = 2.5; post.castShadow = true; g.add(post);
      const arm = new THREE.Mesh(new THREE.BoxGeometry(2, 0.2, 0.2), barkMat);
      arm.position.set(0.9, 4.8, 0); arm.castShadow = true; g.add(arm);
      const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.2, 4), ropeMat);
      rope.position.set(1.7, 4.2, 0); g.add(rope);
      const cage = new THREE.Group();
      cage.position.set(1.7, 3.0, 0);
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2;
        const bar = new THREE.Mesh(new THREE.BoxGeometry(0.04, 1.4, 0.04), cageMat);
        bar.position.set(Math.cos(a) * 0.4, 0, Math.sin(a) * 0.4);
        bar.castShadow = true;
        cage.add(bar);
      }
      const top = new THREE.Mesh(new THREE.ConeGeometry(0.45, 0.3, 6), cageMat);
      top.position.y = 0.8; cage.add(top);
      cage.userData.dynamic = true;
      g.add(cage);
      this.scene.add(g);
      this.col.addCircle(x, z, 0.3, { h: 5 });
      const ph = this.rnd() * 6;
      this.animated.push((t) => { cage.rotation.z = Math.sin(t * 0.8 + ph) * 0.06; cage.rotation.y = t * 0.2 + ph; });
    }

    // Ruines du sanctuaire (page 1)
    const stone = new THREE.MeshStandardMaterial({ map: TX.stoneBlocks('#6a665e'), roughness: 1 });
    const sh = POI.shrine;
    const wall = (x, z, w, h, d) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), stone);
      m.position.set(x, this.getHeight(x, z) + h / 2 - 0.2, z);
      m.castShadow = true; m.receiveShadow = true;
      this.scene.add(m);
      this.col.addBoxCentered(x, z, w, d, false, { h });
      this.minimapBoxes.push([x - w / 2, z - d / 2, x + w / 2, z + d / 2]);
    };
    wall(sh.x - 5, sh.z, 1, 4.5, 8);
    wall(sh.x + 5, sh.z + 1.5, 1, 2.2, 5);
    wall(sh.x, sh.z - 4.5, 10, 3.5, 1);
    wall(sh.x - 3, sh.z + 4, 4, 1.2, 1);
    // Arche brisée
    const arch = new THREE.Mesh(new THREE.TorusGeometry(2.5, 0.35, 5, 10, Math.PI * 0.75), stone);
    arch.position.set(sh.x, this.getHeight(sh.x, sh.z - 4) + 3.3, sh.z - 4.6);
    arch.castShadow = true;
    this.scene.add(arch);
    // Autel
    const altar = new THREE.Mesh(new THREE.BoxGeometry(1.8, 1, 1), stone);
    altar.position.set(sh.x, this.getHeight(sh.x, sh.z) + 0.4, sh.z - 2);
    altar.castShadow = true;
    this.scene.add(altar);
    this.col.addBoxCentered(sh.x, sh.z - 2, 1.8, 1, false, { h: 1 });
    this.addCandles(sh.x - 0.6, sh.z - 2, this.getHeight(sh.x, sh.z) + 0.9);
    this.addCandles(sh.x + 0.6, sh.z - 2, this.getHeight(sh.x, sh.z) + 0.9);

    // Pierres tombales / stèles éparses
    for (const [x, z] of [[8, -10], [-14, -35], [20, -60], [-36, -88]]) this.addBrokenColumn(x, z, stone);
    this.stoneMat = stone;
  }

  addBrokenColumn(x, z, stone) {
    const h = 1.5 + this.rnd() * 2.5;
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.55, h, 8), stone);
    m.position.set(x, this.getHeight(x, z) + h / 2, z);
    m.rotation.z = (this.rnd() - 0.5) * 0.15;
    m.castShadow = true;
    this.scene.add(m);
    this.col.addCircle(x, z, 0.55, { h });
  }

  addCandles(x, z, y, count = 3) {
    const wax = this.shared('wax', () => mat(0xe8e0c8));
    const flameM = this.shared('flame', () => mat(0x000000, { emissive: 0xffa040, emissiveIntensity: 4.5 }));
    for (let i = 0; i < count; i++) {
      const ox = (this.rnd() - 0.5) * 0.4, oz = (this.rnd() - 0.5) * 0.3;
      const h = 0.15 + this.rnd() * 0.25;
      const c = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.045, h, 6), wax);
      c.position.set(x + ox, y + h / 2, z + oz);
      this.scene.add(c);
      const f = new THREE.Mesh(new THREE.OctahedronGeometry(0.035, 0), flameM);
      f.position.set(x + ox, y + h + 0.05, z + oz);
      f.scale.y = 1.8;
      this.scene.add(f);
    }
    this.lightSpots.push({ pos: new THREE.Vector3(x, y + 0.6, z), color: new THREE.Color(0xff9a40), intensity: 6, distance: 9, flicker: 1 });
  }

  // ------------------------------------------------------------------ Gorge et voile
  buildGorge() {
    const rockMat = new THREE.MeshStandardMaterial({ color: 0x3e3d3a, roughness: 1, flatShading: true });
    for (let z = -94; z > -130; z -= 3) {
      for (const s of [-1, 1]) {
        const r = 2.5 + this.rnd() * 2;
        const m = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 0), rockMat);
        m.position.set(s * (5.2 + r * 0.7), this.getHeight(s * 6, z) + r * 0.6, z);
        m.scale.y = 1.6 + this.rnd();
        m.rotation.set(this.rnd(), this.rnd(), this.rnd());
        m.castShadow = true; m.receiveShadow = true;
        this.scene.add(m);
      }
    }
    // Voile d'ombre
    const veilMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      uniforms: { uTime: { value: 0 }, uFade: { value: 1 } },
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }`,
      fragmentShader: `
        uniform float uTime; uniform float uFade; varying vec2 vUv;
        float h(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
        float n(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
          return mix(mix(h(i),h(i+vec2(1,0)),f.x), mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x), f.y); }
        void main(){
          vec2 p = vUv * vec2(4., 3.);
          float v = n(p + vec2(0., uTime*0.4)) * 0.5 + n(p*2.3 - vec2(uTime*0.3, uTime*0.2)) * 0.3 + n(p*5. + uTime) * 0.2;
          float edge = smoothstep(0., 0.15, vUv.x) * smoothstep(1., 0.85, vUv.x) * smoothstep(1., 0.7, vUv.y);
          vec3 col = mix(vec3(0.02,0.0,0.05), vec3(0.45,0.1,0.8), pow(v, 3.0) * 1.5);
          float a = (0.75 + v * 0.25) * edge * uFade;
          gl_FragColor = vec4(col, a);
        }`,
    });
    const veil = new THREE.Mesh(new THREE.PlaneGeometry(11, 7), veilMat);
    veil.position.set(0, this.getHeight(0, POI.veil.z) + 3.2, POI.veil.z);
    this.scene.add(veil);
    this.veil = {
      mesh: veil, mat: veilMat, pos: POI.veil.clone(), alive: true, fade: 1,
      collider: this.col.addBox(-5, POI.veil.z - 0.4, 5, POI.veil.z + 0.4, { tag: 'veil', h: 7, cam: false }),
    };
    this.lightSpots.push({ pos: new THREE.Vector3(0, 2, POI.veil.z + 1), color: new THREE.Color(0x8a3cff), intensity: 8, distance: 12, flicker: 0.3, veil: true });
    this.animated.push((t, dt) => {
      veilMat.uniforms.uTime.value = t;
      if (!this.veil.alive && this.veil.fade > 0) {
        this.veil.fade = Math.max(0, this.veil.fade - dt * 0.8);
        veilMat.uniforms.uFade.value = this.veil.fade;
        if (this.veil.fade === 0) veil.visible = false;
      }
    });
  }

  dispelVeil() {
    if (!this.veil.alive) return false;
    this.veil.alive = false;
    this.veil.collider.enabled = false;
    this.lightSpots = this.lightSpots.filter((s) => !s.veil);
    return true;
  }

  // ------------------------------------------------------------------ Cimetière
  buildCemetery() {
    const stoneMat = new THREE.MeshStandardMaterial({ color: 0x6d6a63, roughness: 1, flatShading: true });
    const graveGeo = mergeGeometries([
      new THREE.BoxGeometry(0.7, 1.0, 0.18).translate(0, 0.5, 0),
      new THREE.CylinderGeometry(0.35, 0.35, 0.18, 8, 1, false, 0, Math.PI).rotateX(Math.PI / 2).rotateZ(Math.PI / 2).translate(0, 1.0, 0),
    ]);
    const crossGeo = mergeGeometries([
      new THREE.BoxGeometry(0.15, 1.4, 0.15).translate(0, 0.7, 0),
      new THREE.BoxGeometry(0.7, 0.15, 0.15).translate(0, 1.05, 0),
    ]);
    const graves = [], crosses = [];
    for (let row = 0; row < 7; row++) {
      for (let k = 0; k < 10; k++) {
        const side = k < 5 ? -1 : 1;
        const x = side * (8 + (k % 5) * 5.5) + (this.rnd() - 0.5) * 1.2;
        const z = -134 - row * 8 + (this.rnd() - 0.5) * 1.5;
        if (Math.hypot(x - POI.chapel.x, z - POI.chapel.z) < 9) continue;
        if (!this.col.inAreas(x, z, 1.5)) continue;
        if (this.rnd() < 0.18) continue;
        const list = this.rnd() < 0.3 ? crosses : graves;
        list.push([x, z, (this.rnd() - 0.5) * 0.35, (this.rnd() - 0.5) * 0.25]);
        this.col.addBoxCentered(x, z, 0.75, 0.3, false, { h: 1.1, cam: false });
        this.graves.push(new THREE.Vector3(x, 0, z + 1.2));
      }
    }
    const dummy = new THREE.Object3D();
    for (const [geo, list] of [[graveGeo, graves], [crossGeo, crosses]]) {
      const im = new THREE.InstancedMesh(geo, stoneMat, list.length);
      list.forEach(([x, z, ry, rz], i) => {
        dummy.position.set(x, this.getHeight(x, z) - 0.1, z);
        dummy.rotation.set(0, ry, rz);
        dummy.scale.setScalar(1);
        dummy.updateMatrix();
        im.setMatrixAt(i, dummy.matrix);
      });
      im.castShadow = true; im.receiveShadow = true;
      this.scene.add(im);
    }
    // Monticules de terre devant les tombes
    const dirt = new THREE.MeshStandardMaterial({ color: 0x2c251e, roughness: 1, flatShading: true });
    const moundGeo = new THREE.SphereGeometry(1, 6, 4, 0, Math.PI * 2, 0, Math.PI / 2);
    const mounds = new THREE.InstancedMesh(moundGeo, dirt, this.graves.length);
    this.graves.forEach((g, i) => {
      dummy.position.set(g.x, this.getHeight(g.x, g.z) - 0.05, g.z - 0.1);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(0.45, 0.15, 0.9);
      dummy.updateMatrix();
      mounds.setMatrixAt(i, dummy.matrix);
    });
    mounds.receiveShadow = true;
    this.scene.add(mounds);

    // Grille de fer autour du cimetière
    const iron = mat(0x18181b, { metalness: 0.7, roughness: 0.5 });
    const fenceSeg = mergeGeometries([
      new THREE.BoxGeometry(2, 0.06, 0.06).translate(0, 1.4, 0),
      new THREE.BoxGeometry(2, 0.06, 0.06).translate(0, 0.4, 0),
      ...[...Array(7)].map((_, i) => new THREE.BoxGeometry(0.04, 1.7, 0.04).translate(-0.9 + i * 0.3, 0.85, 0)),
      ...[...Array(7)].map((_, i) => new THREE.ConeGeometry(0.05, 0.18, 4).translate(-0.9 + i * 0.3, 1.78, 0)),
    ]);
    const fences = [];
    for (let z = -126; z > -194; z -= 2) { fences.push([-39.5, z, Math.PI / 2]); fences.push([39.5, z, Math.PI / 2]); }
    for (let x = -38.5; x < 39; x += 2) if (Math.abs(x) > 6) fences.push([x, -125, 0]);
    const fim = new THREE.InstancedMesh(fenceSeg, iron, fences.length);
    fences.forEach(([x, z, r], i) => {
      dummy.position.set(x, this.getHeight(x, z), z);
      dummy.rotation.set((this.rnd() - 0.5) * 0.15, r, (this.rnd() - 0.5) * 0.1);
      dummy.updateMatrix();
      fim.setMatrixAt(i, dummy.matrix);
    });
    fim.castShadow = true;
    this.scene.add(fim);

    // Chapelle funéraire (page 2)
    const c = POI.chapel;
    const stone = new THREE.MeshStandardMaterial({ map: TX.stoneBlocks('#5f5c56'), roughness: 1 });
    const g = new THREE.Group();
    g.position.set(c.x, this.getHeight(c.x, c.z), c.z);
    const addB = (w, h, d, x, y, z, m = stone) => {
      const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
      b.position.set(x, y, z);
      b.castShadow = true; b.receiveShadow = true;
      g.add(b);
      return b;
    };
    // Ouverte vers le sud (+Z)
    addB(0.8, 6, 9, -3.6, 3, 0);
    addB(0.8, 6, 9, 3.6, 3, 0);
    addB(8, 6, 0.8, 0, 3, -4.1);
    addB(2.6, 6, 0.8, -2.7, 3, 4.1);
    addB(2.6, 6, 0.8, 2.7, 3, 4.1);
    addB(2.8, 1.5, 0.8, 0, 5.25, 4.1);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(6.4, 4, 4), new THREE.MeshStandardMaterial({ map: TX.shingles(), roughness: 1, flatShading: true }));
    roof.position.y = 8; roof.rotation.y = Math.PI / 4; roof.scale.z = 1.25; roof.castShadow = true;
    g.add(roof);
    const cr = new THREE.Mesh(crossGeo, iron);
    cr.position.set(0, 9.8, 0); cr.scale.setScalar(1.3);
    g.add(cr);
    addB(1.6, 0.9, 0.9, 0, 0.45, -2.6);
    this.scene.add(g);
    const cz = c.z;
    this.col.addBox(c.x - 4, cz - 4.5, c.x - 3.2, cz + 4.5, { h: 6 });
    this.col.addBox(c.x + 3.2, cz - 4.5, c.x + 4, cz + 4.5, { h: 6 });
    this.col.addBox(c.x - 4, cz - 4.5, c.x + 4, cz - 3.7, { h: 6 });
    this.col.addBox(c.x - 4, cz + 3.7, c.x - 1.4, cz + 4.5, { h: 6 });
    this.col.addBox(c.x + 1.4, cz + 3.7, c.x + 4, cz + 4.5, { h: 6 });
    this.col.addBox(c.x - 0.8, cz - 3.05, c.x + 0.8, cz - 2.15, { h: 0.9 });
    this.minimapBoxes.push([c.x - 4, cz - 4.5, c.x + 4, cz + 4.5]);
    this.addCandles(c.x - 0.5, cz - 2.6, g.position.y + 0.9);
    this.addCandles(c.x + 0.5, cz - 2.6, g.position.y + 0.9);

    // Mur et herse du village
    const wallStone = new THREE.MeshStandardMaterial({ map: TX.stoneBlocks('#55524d'), roughness: 1 });
    wallStone.map.repeat.set(8, 1);
    for (const s of [-1, 1]) {
      const w = new THREE.Mesh(new THREE.BoxGeometry(57, 6, 1.4), wallStone);
      w.position.set(s * 31.5, 2.8, -196);
      w.castShadow = true; w.receiveShadow = true;
      this.scene.add(w);
      this.col.addBox(s > 0 ? 3 : -60, -196.7, s > 0 ? 60 : -3, -195.3, { h: 6 });
      this.minimapBoxes.push([s > 0 ? 3 : -60, -196.7, s > 0 ? 60 : -3, -195.3]);
      const tower = new THREE.Mesh(new THREE.BoxGeometry(2.6, 9, 2.6), wallStone);
      tower.position.set(s * 4.3, 4.3, -196);
      tower.castShadow = true;
      this.scene.add(tower);
      const tr = new THREE.Mesh(new THREE.ConeGeometry(2.2, 3, 4), new THREE.MeshStandardMaterial({ map: TX.shingles(), roughness: 1, flatShading: true }));
      tr.position.set(s * 4.3, 10.3, -196); tr.rotation.y = Math.PI / 4;
      this.scene.add(tr);
      this.addTorch(s * 3.2, 3.2, -194.9);
    }
    const lintel = new THREE.Mesh(new THREE.BoxGeometry(6.2, 1.6, 1.4), wallStone);
    lintel.position.set(0, 5.4, -196);
    this.scene.add(lintel);
    // Herse
    const grate = new THREE.Group();
    const bars = [];
    for (let i = 0; i < 9; i++) bars.push(new THREE.BoxGeometry(0.1, 4.6, 0.1).translate(-2.6 + i * 0.65, 2.3, 0));
    for (let j = 0; j < 5; j++) bars.push(new THREE.BoxGeometry(5.6, 0.1, 0.1).translate(0, 0.4 + j * 1.0, 0));
    for (let i = 0; i < 9; i++) bars.push(new THREE.ConeGeometry(0.08, 0.3, 4).rotateX(Math.PI).translate(-2.6 + i * 0.65, -0.1, 0));
    const gm = new THREE.Mesh(mergeGeometries(bars), iron);
    gm.castShadow = true;
    grate.add(gm);
    grate.position.set(0, 0, -196);
    this.scene.add(grate);
    this.grate = this.col.addBox(-3, -196.4, 3, -195.6, { tag: 'grate', h: 5, cam: false });
  }

  addTorch(x, y, z) {
    const g = new THREE.Group();
    const iron = mat(0x1a1a1a, { metalness: 0.6 });
    const b = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.05, 0.5, 6), iron);
    g.add(b);
    const fl = new THREE.Mesh(new THREE.OctahedronGeometry(0.14, 0), mat(0x000000, { emissive: 0xff8a2a, emissiveIntensity: 5 }));
    fl.position.y = 0.38; fl.scale.y = 1.7;
    g.add(fl);
    g.position.set(x, y, z);
    g.userData.dynamic = true;
    this.scene.add(g);
    this.lightSpots.push({ pos: new THREE.Vector3(x, y + 0.6, z), color: new THREE.Color(0xff8a3a), intensity: 14, distance: 14, flicker: 1, torch: true });
    const ph = this.rnd() * 10;
    this.animated.push((t) => { fl.scale.set(1 + Math.sin(t * 13 + ph) * 0.15, 1.7 + Math.sin(t * 17 + ph) * 0.3, 1); });
  }

  // ------------------------------------------------------------------ Village
  buildVillage() {
    const stoneMat = new THREE.MeshStandardMaterial({ map: TX.stoneBlocks('#6b665c', '#2e2b27', 48, 24), roughness: 1 });
    const plaster = new THREE.MeshStandardMaterial({ color: 0x8c7f6a, roughness: 1 });
    const beam = mat(0x24180f);
    const roofMat = new THREE.MeshStandardMaterial({ map: TX.shingles(), roughness: 1, flatShading: true });
    const winLit = mat(0x000000, { emissive: 0xff9d45, emissiveIntensity: 1.6 });
    const winDark = mat(0x0b0b0e);
    const doorMat = new THREE.MeshStandardMaterial({ map: TX.planks(), roughness: 1 });

    const house = (x, z, w, d, rot, ruined, lit) => {
      const g = new THREE.Group();
      g.position.set(x, this.getHeight(x, z) - 0.1, z);
      g.rotation.y = rot ? Math.PI / 2 : 0;
      const base = new THREE.Mesh(new THREE.BoxGeometry(w, 1.4, d), stoneMat);
      base.position.y = 0.7; base.castShadow = base.receiveShadow = true; g.add(base);
      const upH = 2.6;
      const up = new THREE.Mesh(new THREE.BoxGeometry(w + 0.3, upH, d + 0.3), plaster);
      up.position.y = 1.4 + upH / 2; up.castShadow = up.receiveShadow = true; g.add(up);
      // Colombages
      for (let i = 0; i <= Math.floor(w / 1.2); i++) {
        for (const s of [-1, 1]) {
          const bm = new THREE.Mesh(new THREE.BoxGeometry(0.14, upH, 0.08), beam);
          bm.position.set(-w / 2 + i * (w / Math.floor(w / 1.2)), 1.4 + upH / 2, s * (d / 2 + 0.17));
          g.add(bm);
        }
      }
      for (const s of [-1, 1]) {
        const diag = new THREE.Mesh(new THREE.BoxGeometry(0.12, upH * 1.2, 0.08), beam);
        diag.position.set(s * w * 0.25, 1.4 + upH / 2, d / 2 + 0.18);
        diag.rotation.z = 0.6 * s;
        g.add(diag);
        const hb = new THREE.Mesh(new THREE.BoxGeometry(w + 0.35, 0.16, 0.1), beam);
        hb.position.set(0, 1.45 + (s > 0 ? upH : 0), d / 2 + 0.18);
        g.add(hb);
      }
      // Fenêtres
      for (const s of [-1, 1]) {
        const win = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.9), lit && s > 0 ? winLit : winDark);
        win.position.set(s * w * 0.28, 2.8, d / 2 + 0.17);
        g.add(win);
      }
      const door = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 2.0), doorMat);
      door.position.set(0, 1.0, d / 2 + 0.01);
      g.add(door);
      // Toit
      if (!ruined) {
        const sh = new THREE.Shape();
        sh.moveTo(-w / 2 - 0.6, 0); sh.lineTo(0, 2.6); sh.lineTo(w / 2 + 0.6, 0); sh.lineTo(-w / 2 - 0.6, 0);
        const rg = new THREE.ExtrudeGeometry(sh, { depth: d + 1, bevelEnabled: false });
        rg.translate(0, 0, -(d + 1) / 2);
        const roof = new THREE.Mesh(rg, roofMat);
        roof.position.y = 1.4 + upH;
        roof.castShadow = true;
        g.add(roof);
        const ch = new THREE.Mesh(new THREE.BoxGeometry(0.6, 1.8, 0.6), stoneMat);
        ch.position.set(w * 0.25, 1.4 + upH + 1.8, -d * 0.15);
        ch.castShadow = true;
        g.add(ch);
      } else {
        // Charpente nue
        for (let i = 0; i < 4; i++) {
          const zz = -d / 2 + 0.3 + i * (d - 0.6) / 3;
          for (const s of [-1, 1]) {
            const r = new THREE.Mesh(new THREE.BoxGeometry(0.15, 3.2, 0.15), beam);
            r.position.set(s * w * 0.22, 1.4 + upH + 1.1, zz);
            r.rotation.z = s * 0.95;
            r.castShadow = true;
            g.add(r);
          }
        }
      }
      if (lit) {
        const wp = new THREE.Vector3(w * 0.28, 2.8, d / 2 + 1.0).applyAxisAngle(new THREE.Vector3(0, 1, 0), g.rotation.y).add(g.position);
        this.lightSpots.push({ pos: wp, color: new THREE.Color(0xff9a50), intensity: 5, distance: 8, flicker: 0.4 });
      }
      this.scene.add(g);
      const hw = (rot ? d : w) / 2 + 0.15, hd = (rot ? w : d) / 2 + 0.15;
      this.col.addBox(x - hw, z - hd, x + hw, z + hd, { h: 7 });
      this.minimapBoxes.push([x - hw, z - hd, x + hw, z + hd]);
    };

    // Rangées de maisons le long de la rue principale.
    const houses = [
      [-14, -212, 7, 6, false, false, true], [15, -214, 8, 6, false, true, false],
      [-16, -232, 6, 8, true, false, false], [17, -236, 7, 7, true, false, true],
      [-36, -220, 8, 6, false, true, false], [38, -222, 7, 6, false, false, false],
      [-40, -245, 6, 7, true, false, true], [42, -250, 7, 7, true, true, false],
      [-17, -290, 8, 6, false, false, true], [18, -292, 7, 6, false, false, false],
      [-15, -314, 7, 7, true, true, false], [16, -316, 6, 8, true, false, true],
      [-38, -298, 7, 6, false, false, false], [40, -305, 8, 6, false, true, false],
      [-44, -276, 6, 6, true, false, false], [44, -280, 6, 6, true, false, true],
    ];
    for (const h of houses) house(...h);

    // Remparts bas en bordure
    for (const s of [-1, 1]) {
      for (let z = -200; z > -332; z -= 6) {
        if (this.rnd() < 0.25) continue;
        const hgt = 1.2 + this.rnd() * 2.2;
        const w = new THREE.Mesh(new THREE.BoxGeometry(1.2, hgt, 6.1), stoneMat);
        w.position.set(s * 56.2, this.getHeight(s * 56, z) + hgt / 2 - 0.2, z - 3);
        w.castShadow = true; w.receiveShadow = true;
        this.scene.add(w);
      }
    }

    // Place centrale : puits et clocher
    const sq = POI.square;
    const well = new THREE.Group();
    well.position.set(sq.x, this.getHeight(sq.x, sq.z), sq.z);
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.5, 1, 10, 1, true), stoneMat);
    ring.position.y = 0.5; ring.material = stoneMat.clone(); ring.material.side = THREE.DoubleSide;
    well.add(ring);
    const water = new THREE.Mesh(new THREE.CircleGeometry(1.35, 10), mat(0x050810, { roughness: 0.1, metalness: 0.5 }));
    water.rotation.x = -Math.PI / 2; water.position.y = 0.3;
    well.add(water);
    for (const s of [-1, 1]) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(0.2, 2.6, 0.2), beam);
      p.position.set(s * 1.3, 1.3, 0); well.add(p);
    }
    const wr = new THREE.Mesh(new THREE.ConeGeometry(2, 1.2, 4), roofMat);
    wr.position.y = 3.0; wr.rotation.y = Math.PI / 4; well.add(wr);
    well.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    this.scene.add(well);
    this.col.addCircle(sq.x, sq.z, 1.6, { h: 3 });

    const tower = new THREE.Group();
    const tx = -26, tz = -262;
    tower.position.set(tx, this.getHeight(tx, tz), tz);
    const tb = new THREE.Mesh(new THREE.BoxGeometry(5, 18, 5), stoneMat);
    tb.position.y = 9; tower.add(tb);
    const belfry = new THREE.Mesh(new THREE.BoxGeometry(5.4, 0.5, 5.4), stoneMat);
    belfry.position.y = 18.2; tower.add(belfry);
    for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(0.6, 3.5, 0.6), stoneMat);
      p.position.set(x * 2.4, 20.2, z * 2.4); tower.add(p);
    }
    const spire = new THREE.Mesh(new THREE.ConeGeometry(4, 8, 4), roofMat);
    spire.position.y = 26; spire.rotation.y = Math.PI / 4; tower.add(spire);
    const bell = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 1.1, 1.5, 10, 1, true), mat(0x6b5a2a, { metalness: 0.8, roughness: 0.4, side: THREE.DoubleSide }));
    bell.position.y = 20.3; bell.userData.dynamic = true; tower.add(bell);
    tower.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    this.scene.add(tower);
    this.col.addBox(tx - 2.6, tz - 2.6, tx + 2.6, tz + 2.6, { h: 30 });
    this.minimapBoxes.push([tx - 2.6, tz - 2.6, tx + 2.6, tz + 2.6]);
    this.animated.push((t) => { bell.rotation.z = Math.sin(t * 0.7) * 0.08; });

    // Bric-à-brac : tonneaux, charrettes, lampadaires
    const barrelGeo = new THREE.CylinderGeometry(0.45, 0.45, 1.1, 8);
    const barrelMat = new THREE.MeshStandardMaterial({ map: TX.planks('#5a3d26'), roughness: 1 });
    for (const [x, z] of [[-9, -218], [-8.5, -219.3], [9, -240], [-9, -284], [10, -300], [8.8, -301.2], [-22, -255], [22, -268], [-30, -312], [30, -228]]) {
      const b = new THREE.Mesh(barrelGeo, barrelMat);
      b.position.set(x, this.getHeight(x, z) + 0.55, z);
      b.castShadow = true;
      this.scene.add(b);
      this.col.addCircle(x, z, 0.5, { h: 1.1, cam: false });
    }
    for (const [x, z, r] of [[-10, -250, 0.3], [11, -278, -0.5], [28, -315, 1.2]]) {
      const cart = new THREE.Group();
      const bed = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.5, 3), barrelMat);
      bed.position.y = 0.9; cart.add(bed);
      for (const s of [-1, 1]) {
        const wh = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 0.12, 10), beam);
        wh.rotation.z = Math.PI / 2; wh.position.set(s * 1.0, 0.6, 0.4); cart.add(wh);
      }
      cart.position.set(x, this.getHeight(x, z), z);
      cart.rotation.y = r;
      cart.rotation.z = 0.12;
      cart.traverse((o) => { if (o.isMesh) o.castShadow = true; });
      this.scene.add(cart);
      this.col.addCircle(x, z, 1.5, { h: 1.3, cam: false });
    }
    for (const z of [-205, -240, -284, -322]) {
      for (const s of [-1, 1]) this.addLampPost(s * 7, z);
    }
  }

  addLampPost(x, z) {
    const iron = this.shared('iron', () => mat(0x18181a, { metalness: 0.6, roughness: 0.5 }));
    const g = new THREE.Group();
    g.position.set(x, this.getHeight(x, z), z);
    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.1, 3.6, 6), iron);
    p.position.y = 1.8; p.castShadow = true; g.add(p);
    const lamp = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.25, 0.45, 6), this.shared('lamp', () => mat(0x000000, { emissive: 0xffb060, emissiveIntensity: 3 })));
    lamp.position.y = 3.75; g.add(lamp);
    const cap = new THREE.Mesh(new THREE.ConeGeometry(0.32, 0.3, 6), iron);
    cap.position.y = 4.1; g.add(cap);
    this.scene.add(g);
    this.col.addCircle(x, z, 0.15, { h: 4, cam: false });
    this.lightSpots.push({ pos: new THREE.Vector3(x, g.position.y + 3.6, z), color: new THREE.Color(0xffa860), intensity: 10, distance: 13, flicker: 0.15 });
  }

  // ------------------------------------------------------------------ Cathédrale
  buildCathedral() {
    const stone = new THREE.MeshStandardMaterial({ map: TX.stoneBlocks('#625e58', '#2a2826', 64, 32), roughness: 1 });
    stone.map.repeat.set(4, 4);
    const darkStone = new THREE.MeshStandardMaterial({ color: 0x3a3835, roughness: 1, flatShading: true });
    const B = (w, h, d, x, y, z, m = stone, col = true) => {
      const g = new THREE.BoxGeometry(w, h, d);
      const mesh = new THREE.Mesh(g, m);
      mesh.position.set(x, y, z);
      mesh.castShadow = true; mesh.receiveShadow = true;
      this.scene.add(mesh);
      if (col) {
        this.col.addBox(x - w / 2, z - d / 2, x + w / 2, z + d / 2, { h: y + h / 2 });
        this.minimapBoxes.push([x - w / 2, z - d / 2, x + w / 2, z + d / 2]);
      }
      return mesh;
    };
    const FZ = -354.5;
    // Façade
    B(10.5, 24, 1.5, -8.75, 12, FZ);
    B(10.5, 24, 1.5, 8.75, 12, FZ);
    B(7, 15, 1.5, 0, 16.5, FZ);
    for (const s of [-1, 1]) {
      B(8, 34, 8, s * 18, 17, FZ - 1);
      const spire = new THREE.Mesh(new THREE.ConeGeometry(5, 16, 4), darkStone);
      spire.position.set(s * 18, 42, FZ - 1); spire.rotation.y = Math.PI / 4; spire.castShadow = true;
      this.scene.add(spire);
      for (const [px, pz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        const pin = new THREE.Mesh(new THREE.ConeGeometry(0.6, 4, 4), darkStone);
        pin.position.set(s * 18 + px * 3.6, 36, FZ - 1 + pz * 3.6);
        this.scene.add(pin);
      }
    }
    // Pignon triangulaire
    const gable = new THREE.Shape();
    gable.moveTo(-14, 0); gable.lineTo(0, 12); gable.lineTo(14, 0); gable.lineTo(-14, 0);
    const gm = new THREE.Mesh(new THREE.ExtrudeGeometry(gable, { depth: 1.5, bevelEnabled: false }), stone);
    gm.position.set(0, 24, FZ - 0.75);
    gm.castShadow = true;
    this.scene.add(gm);
    // Portail en ogive
    const archM = new THREE.Mesh(new THREE.TorusGeometry(3.6, 0.45, 6, 16, Math.PI), darkStone);
    archM.position.set(0, 8.5, FZ + 0.8);
    this.scene.add(archM);
    const rose0 = new THREE.Mesh(new THREE.CircleGeometry(3, 24), new THREE.MeshBasicMaterial({ map: TX.roseWindow(), transparent: true, color: new THREE.Color(0.5, 0.5, 0.5) }));
    rose0.position.set(0, 18, FZ + 0.8);
    this.scene.add(rose0);

    // Portes
    const doorMat = new THREE.MeshStandardMaterial({ map: TX.planks('#3d2818'), roughness: 1 });
    const iron = mat(0x1c1c1f, { metalness: 0.6, roughness: 0.5 });
    this.doorLeaves = [];
    for (const s of [-1, 1]) {
      const hinge = new THREE.Group();
      hinge.userData.dynamic = true;
      hinge.position.set(s * 3.5, 0, FZ);
      const leaf = new THREE.Mesh(new THREE.BoxGeometry(3.5, 9, 0.4), doorMat);
      leaf.position.set(-s * 1.75, 4.5, 0);
      leaf.castShadow = true;
      hinge.add(leaf);
      for (let k = 0; k < 4; k++) {
        const band = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.15, 0.5), iron);
        band.position.set(-s * 1.75, 1 + k * 2.2, 0);
        hinge.add(band);
      }
      this.scene.add(hinge);
      this.doorLeaves.push({ hinge, side: s, open: 0 });
    }
    this.door = this.col.addBox(-3.5, FZ - 0.5, 3.5, FZ + 0.5, { tag: 'door', h: 9 });
    this.doorOpen = false;
    this.animated.push((t, dt) => {
      for (const d of this.doorLeaves) {
        if (this.doorOpen && d.open < 1) d.open = Math.min(1, d.open + dt * 0.35);
        d.hinge.rotation.y = -d.side * smooth(d.open) * 1.7;
      }
    });

    // Murs latéraux de la nef
    const NZ0 = -355.25, NZ1 = -470;
    const len = NZ0 - NZ1;
    for (const s of [-1, 1]) {
      B(1.5, 18, len, s * 13.75, 9, (NZ0 + NZ1) / 2);
      // Contreforts extérieurs
      for (let z = -360; z > -470; z -= 10) {
        const bf = new THREE.Mesh(new THREE.BoxGeometry(2.5, 14, 1.4), darkStone);
        bf.position.set(s * 15.7, 7, z); bf.castShadow = true;
        this.scene.add(bf);
        const pin = new THREE.Mesh(new THREE.ConeGeometry(0.7, 3, 4), darkStone);
        pin.position.set(s * 15.7, 15.5, z);
        this.scene.add(pin);
      }
    }
    // Transept et chœur
    for (const s of [-1, 1]) {
      B(11, 20, 1.5, s * 19.25, 10, -470);
      B(1.5, 22, 50, s * 24.75, 11, -495);
    }
    B(51, 30, 1.5, 0, 15, -520.75);

    // Sol
    const ft = TX.floorTiles();
    ft.repeat.set(7, 30);
    const floorM = new THREE.MeshStandardMaterial({ map: ft, roughness: 0.75, metalness: 0.1 });
    const nf = new THREE.Mesh(new THREE.PlaneGeometry(26, 116), floorM);
    nf.rotation.x = -Math.PI / 2; nf.position.set(0, 0.03, -413); nf.receiveShadow = true;
    this.scene.add(nf);
    const ft2 = ft.clone(); ft2.repeat.set(12, 13); ft2.needsUpdate = true;
    const cf = new THREE.Mesh(new THREE.PlaneGeometry(48, 52), new THREE.MeshStandardMaterial({ map: ft2, roughness: 0.75, metalness: 0.1 }));
    cf.rotation.x = -Math.PI / 2; cf.position.set(0, 0.035, -495); cf.receiveShadow = true;
    this.scene.add(cf);
    // Tapis central
    const rug = new THREE.Mesh(new THREE.PlaneGeometry(3, 108), mat(0x4a0d14, { roughness: 1 }));
    rug.rotation.x = -Math.PI / 2; rug.position.set(0, 0.05, -412); rug.receiveShadow = true;
    this.scene.add(rug);

    // Piliers et voûtes (toiture effondrée)
    const pillarGeo = mergeGeometries([
      new THREE.CylinderGeometry(0.8, 0.8, 16, 10).translate(0, 8, 0),
      new THREE.BoxGeometry(2.0, 0.8, 2.0).translate(0, 0.4, 0),
      new THREE.BoxGeometry(2.0, 0.6, 2.0).translate(0, 16.2, 0),
    ]);
    const pillars = [];
    for (let z = -362; z > -466; z -= 10) for (const s of [-1, 1]) pillars.push([s * 7, z]);
    const pim = new THREE.InstancedMesh(pillarGeo, stone, pillars.length);
    const dummy = new THREE.Object3D();
    pillars.forEach(([x, z], i) => {
      dummy.position.set(x, 0, z); dummy.rotation.set(0, 0, 0); dummy.scale.setScalar(1); dummy.updateMatrix();
      pim.setMatrixAt(i, dummy.matrix);
      this.col.addCircle(x, z, 1.0, { h: 17, cam: true });
    });
    pim.castShadow = true; pim.receiveShadow = true;
    this.scene.add(pim);
    let idx = 0;
    for (let z = -362; z > -466; z -= 10) {
      idx++;
      if (idx % 3 === 2) continue; // arcs effondrés
      const a = new THREE.Mesh(new THREE.TorusGeometry(7, 0.4, 5, 16, Math.PI), darkStone);
      a.position.set(0, 16.5, z); a.castShadow = true;
      this.scene.add(a);
    }
    for (const s of [-1, 1]) {
      for (let z = -362; z > -456; z -= 10) {
        const a = new THREE.Mesh(new THREE.TorusGeometry(5, 0.35, 5, 14, Math.PI), darkStone);
        a.rotation.y = Math.PI / 2;
        a.position.set(s * 7, 11.2, z - 5);
        a.scale.set(1, 1, 1);
        this.scene.add(a);
      }
    }
    // Débris de voûte
    for (let i = 0; i < 14; i++) {
      const x = (this.rnd() - 0.5) * 22, z = -365 - this.rnd() * 100;
      if (Math.abs(x) < 2.5) continue;
      const r = 0.5 + this.rnd() * 0.9;
      const d = new THREE.Mesh(new THREE.DodecahedronGeometry(r, 0), darkStone);
      d.position.set(x, r * 0.5, z); d.rotation.set(this.rnd() * 3, this.rnd() * 3, 0);
      d.castShadow = true;
      this.scene.add(d);
      if (Math.abs(Math.abs(x) - 7) > 1.5) this.col.addCircle(x, z, r * 0.9, { h: r, cam: false });
    }

    // Vitraux
    const palettes = [
      ['#b3123a', '#1d3fbf', '#d9a21b', '#5b1fa6'],
      ['#1d3fbf', '#14806a', '#d9a21b', '#2a1d6b'],
      ['#c2471a', '#b3123a', '#ffd27a', '#5b1fa6'],
      ['#14806a', '#1d3fbf', '#b3123a', '#d9a21b'],
    ];
    const glassTex = palettes.map((p, i) => TX.stainedGlass(50 + i * 3, p));
    const glassMat = (k, b, outside = false) => this.shared(`glass${k}-${b}`, () => new THREE.MeshBasicMaterial({ map: glassTex[k], color: new THREE.Color(b, b, b * (outside ? 1.1 : 1)), fog: outside }));
    const glassCols = [0xff3050, 0x3060ff, 0xffb030, 0x40c090];
    let wi = 0;
    for (let z = -367; z > -466; z -= 10) {
      for (const s of [-1, 1]) {
        const k = wi++ % 4;
        const gmat = glassMat(k, 1.3);
        const w = new THREE.Mesh(new THREE.PlaneGeometry(3, 7.5), gmat);
        w.position.set(s * 12.97, 8.5, z);
        w.rotation.y = -s * Math.PI / 2;
        this.scene.add(w);
        const back = new THREE.Mesh(new THREE.PlaneGeometry(3, 7.5), glassMat(k, 0.45, true));
        back.position.set(s * 14.53, 8.5, z);
        back.rotation.y = s * Math.PI / 2;
        this.scene.add(back);
        if ((z + 367) % 20 === 0) {
          this.lightSpots.push({ pos: new THREE.Vector3(s * 10.5, 5, z), color: new THREE.Color(glassCols[k]), intensity: 10, distance: 11, flicker: 0 });
        }
      }
    }
    // Grande rosace
    this.roseMat = new THREE.MeshBasicMaterial({ map: TX.roseWindow(), transparent: true, color: new THREE.Color(1.1, 1.1, 1.1), fog: false });
    const rose = new THREE.Mesh(new THREE.CircleGeometry(7, 48), this.roseMat);
    rose.position.set(0, 17, -519.9);
    this.scene.add(rose);
    const roseFrame = new THREE.Mesh(new THREE.TorusGeometry(7.2, 0.5, 6, 40), darkStone);
    roseFrame.position.set(0, 17, -519.8);
    this.scene.add(roseFrame);
    for (const s of [-1, 1]) {
      for (const k of [0, 1]) {
        const gmat = glassMat((k + (s > 0 ? 2 : 0)) % 4, 1.2);
        const lw = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 7), gmat);
        lw.position.set(s * (10 + k * 5), 6, -519.9);
        this.scene.add(lw);
      }
      for (const z of [-482, -496, -510]) {
        const gmat = glassMat((z / 2 + s) & 3, 1.2);
        const w = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 9), gmat);
        w.position.set(s * 23.97, 10, z);
        w.rotation.y = -s * Math.PI / 2;
        this.scene.add(w);
      }
    }
    this.lightSpots.push({ pos: new THREE.Vector3(0, 10, -510), color: new THREE.Color(0xff5070), intensity: 30, distance: 30, flicker: 0, rose: true });
    this.lightSpots.push({ pos: new THREE.Vector3(-14, 6, -496), color: new THREE.Color(0x4070ff), intensity: 14, distance: 16, flicker: 0 });
    this.lightSpots.push({ pos: new THREE.Vector3(14, 6, -496), color: new THREE.Color(0xffb040), intensity: 14, distance: 16, flicker: 0 });

    // Autel et marches
    for (let i = 0; i < 3; i++) {
      const st = new THREE.Mesh(new THREE.BoxGeometry(16 - i * 3, 0.3, 5 - i), stone);
      st.position.set(0, 0.15 + i * 0.3, -511 + i * 0.3);
      st.receiveShadow = true;
      this.scene.add(st);
    }
    B(4, 1.4, 1.6, 0, 1.6, -512, stone, true);
    this.addCandles(-1.5, -512, 2.3, 4);
    this.addCandles(1.5, -512, 2.3, 4);

    // Bancs (de part et d'autre de l'allée)
    const pew = mergeGeometries([
      new THREE.BoxGeometry(4.2, 0.12, 0.6).translate(0, 0.5, 0),
      new THREE.BoxGeometry(4.2, 0.8, 0.1).translate(0, 0.9, -0.3),
      new THREE.BoxGeometry(0.1, 0.5, 0.6).translate(-2, 0.25, 0),
      new THREE.BoxGeometry(0.1, 0.5, 0.6).translate(2, 0.25, 0),
    ]);
    const pewMat = new THREE.MeshStandardMaterial({ map: TX.planks('#3a2618'), roughness: 1 });
    const pews = [];
    for (let z = -366; z > -400; z -= 2.6) for (const s of [-1, 1]) if (this.rnd() > 0.15) pews.push([s * 4, z, (this.rnd() - 0.5) * 0.3]);
    const pewIm = new THREE.InstancedMesh(pew, pewMat, pews.length);
    pews.forEach(([x, z, r], i) => {
      dummy.position.set(x, 0, z); dummy.rotation.set(0, r, 0); dummy.updateMatrix();
      pewIm.setMatrixAt(i, dummy.matrix);
      this.col.addBox(x - 2.1, z - 0.4, x + 2.1, z + 0.4, { h: 1.3, cam: false });
    });
    pewIm.castShadow = true; pewIm.receiveShadow = true;
    this.scene.add(pewIm);

    // Candélabres
    for (let z = -372; z > -466; z -= 20) {
      for (const s of [-1, 1]) this.addCandelabra(s * 9.8, z);
    }
    for (const [x, z] of [[-18, -480], [18, -480], [-18, -508], [18, -508]]) this.addCandelabra(x, z);

    // Socles de gargouilles
    this.gargoyleSpots = [];
    for (const [x, z] of [[-10.6, -381], [10.6, -391], [-10.6, -411], [10.6, -421], [-10.6, -441], [10.6, -451]]) {
      const ped = new THREE.Mesh(new THREE.BoxGeometry(1.6, 2.2, 1.6), stone);
      ped.position.set(x, 1.1, z); ped.castShadow = true;
      this.scene.add(ped);
      this.col.addBox(x - 0.8, z - 0.8, x + 0.8, z + 0.8, { h: 2.2, cam: false });
      this.gargoyleSpots.push(new THREE.Vector3(x, 2.2, z));
    }

    // Sceau du chœur (activé pendant le combat)
    const sealMat = this.veil.mat.clone();
    sealMat.uniforms = { uTime: { value: 0 }, uFade: { value: 0 } };
    const seal = new THREE.Mesh(new THREE.PlaneGeometry(26, 14), sealMat);
    seal.position.set(0, 7, -469);
    seal.visible = false;
    this.scene.add(seal);
    this.seal = { mesh: seal, mat: sealMat, collider: this.col.addBox(-13, -470, 13, -468.5, { tag: 'seal', h: 14, cam: false }), on: false, fade: 0 };
    this.seal.collider.enabled = false;
    this.animated.push((t, dt) => {
      sealMat.uniforms.uTime.value = t;
      const target = this.seal.on ? 1 : 0;
      this.seal.fade += Math.sign(target - this.seal.fade) * Math.min(Math.abs(target - this.seal.fade), dt * 1.5);
      sealMat.uniforms.uFade.value = this.seal.fade;
      seal.visible = this.seal.fade > 0.01;
    });

    // Paratonnerres du parvis
    for (const [x, z] of [[-17, -340], [17, -340], [0, -333]]) this.addConduit(x, z);

    // Torches du portail
    for (const s of [-1, 1]) this.addTorch(s * 4.6, 5, FZ + 1.2);
  }

  setSeal(on) {
    this.seal.on = on;
    this.seal.collider.enabled = on;
  }

  addCandelabra(x, z) {
    const iron = this.shared('iron', () => mat(0x18181a, { metalness: 0.6, roughness: 0.5 }));
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.25, 2.2, 6), iron);
    p.position.y = 1.1; g.add(p);
    const bar = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.06, 0.06), iron);
    bar.position.y = 2.2; g.add(bar);
    const flameM = this.shared('flame', () => mat(0x000000, { emissive: 0xffa040, emissiveIntensity: 4.5 }));
    const wax = this.shared('wax', () => mat(0xe8e0c8));
    for (const ox of [-0.45, 0, 0.45]) {
      const c = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.3, 6), wax);
      c.position.set(ox, 2.38, 0); g.add(c);
      const f = new THREE.Mesh(new THREE.OctahedronGeometry(0.05, 0), flameM);
      f.position.set(ox, 2.6, 0); f.scale.y = 1.8; g.add(f);
    }
    g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    this.scene.add(g);
    this.col.addCircle(x, z, 0.3, { h: 2.4, cam: false });
    this.lightSpots.push({ pos: new THREE.Vector3(x, 2.9, z), color: new THREE.Color(0xffa050), intensity: 9, distance: 11, flicker: 1 });
  }

  addConduit(x, z) {
    const g = new THREE.Group();
    g.position.set(x, this.getHeight(x, z), z);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.3, 1.2, 8), this.stoneMat);
    base.position.y = 0.6; g.add(base);
    const copper = this.shared('copper', () => mat(0x8a4a2a, { metalness: 0.8, roughness: 0.35 }));
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.16, 6, 6), copper);
    pole.position.y = 4.2; g.add(pole);
    for (let i = 0; i < 3; i++) {
      const coil = new THREE.Mesh(new THREE.TorusGeometry(0.35 - i * 0.07, 0.05, 5, 12), copper);
      coil.rotation.x = Math.PI / 2; coil.position.y = 2.2 + i * 1.3; g.add(coil);
    }
    const orbMat = mat(0x111118, { emissive: 0x3aa0ff, emissiveIntensity: 0.0, metalness: 0.5 });
    const orb = new THREE.Mesh(new THREE.IcosahedronGeometry(0.45, 1), orbMat);
    orb.position.y = 7.4; g.add(orb);
    g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    this.scene.add(g);
    this.col.addCircle(x, z, 1.2, { h: 7 });
    const conduit = { pos: new THREE.Vector3(x, g.position.y + 7.4, z), orbMat, powered: false, group: g, glow: 0 };
    this.conduits.push(conduit);
    this.animated.push((t, dt) => {
      if (conduit.powered) {
        conduit.glow = Math.min(1, conduit.glow + dt * 2);
        orbMat.emissiveIntensity = conduit.glow * (3 + Math.sin(t * 9) * 0.8);
      }
    });
  }

  // ------------------------------------------------------------------ Brume
  buildGroundFog() {
    const tex = TX.fogTexture();
    this.fogLayers = [];
    for (let i = 0; i < 3; i++) {
      const t = tex.clone();
      t.needsUpdate = true;
      t.repeat.set(3, 3);
      const m = new THREE.MeshBasicMaterial({ color: 0x4a5670, alphaMap: t, transparent: true, opacity: 0.16 - i * 0.03, depthWrite: false, fog: true });
      const p = new THREE.Mesh(new THREE.PlaneGeometry(140, 140), m);
      p.rotation.x = -Math.PI / 2;
      p.position.y = 0.4 + i * 0.7;
      p.renderOrder = 5;
      p.userData.dynamic = true;
      this.scene.add(p);
      this.fogLayers.push({ mesh: p, tex: t, speed: 0.004 + i * 0.003 });
    }
  }

  updateFog(player, t) {
    for (const [i, l] of this.fogLayers.entries()) {
      l.mesh.position.x = Math.round(player.x / 10) * 10;
      l.mesh.position.z = Math.round(player.z / 10) * 10;
      l.mesh.position.y = this.getHeight(player.x, player.z) + 0.4 + i * 0.7;
      l.tex.offset.set(t * l.speed + l.mesh.position.x / 140 * 3, t * l.speed * 0.6 - l.mesh.position.z / 140 * 3);
    }
  }

  // ------------------------------------------------------------------ Lanternes et objets
  buildPOIs() {
    const lanternSpots = [
      [2.5, 12, 'Lisière du bois'], [2.5, -131, 'Entrée du cimetière'], [-3.5, -205, 'Porte de Malbrume'],
      [-6, -326, 'Parvis de Sainte-Vesper'], [3.2, -458, 'Nef de la cathédrale'],
    ];
    for (const [x, z, name] of lanternSpots) {
      const l = makeLantern();
      l.group.userData.dynamic = true;
      compactModel(l.group);
      l.group.position.set(x, this.getHeight(x, z), z);
      this.scene.add(l.group);
      this.col.addCircle(x, z, 0.35, { h: 2.4, cam: false });
      const spot = { pos: new THREE.Vector3(x + 0.42, l.group.position.y + 1.85, z), color: new THREE.Color(0x7ab8ff), intensity: 0, distance: 10, flicker: 0.5 };
      this.lightSpots.push(spot);
      this.lanterns.push({ ...l, pos: new THREE.Vector3(x, l.group.position.y, z), lit: false, name, spot });
    }
    // Reliques
    const relics = [
      ['fiole', -38, -28], ['encre', 40, -82], ['fiole', -33, -186],
      ['encre', 50, -230], ['fiole', -50, -318], ['encre', 11, -431],
    ];
    for (const [kind, x, z] of relics) this.addPickup(kind, x, z);
  }

  lightLantern(l) {
    if (l.lit) return;
    l.lit = true;
    l.flameMat.emissive.setHex(0x7ab8ff);
    l.flameMat.emissiveIntensity = 4;
    l.spot.intensity = 10;
  }

  addPickup(kind, x, z, y = null) {
    let mesh, extra = {};
    if (kind === 'page') {
      const p = makePage(0xffd27a);
      mesh = p.group;
      extra.ring = p.ring;
    } else {
      mesh = makeRelic(kind);
    }
    const baseY = (y ?? this.getHeight(x, z)) + 1.2;
    mesh.position.set(x, baseY, z);
    mesh.userData.dynamic = true;
    this.scene.add(mesh);
    const pk = { kind, mesh, pos: new THREE.Vector3(x, baseY, z), baseY, alive: true, ...extra };
    this.pickups.push(pk);
    if (kind === 'page') {
      pk.spot = { pos: new THREE.Vector3(x, baseY, z), color: new THREE.Color(0xffd27a), intensity: 12, distance: 10, flicker: 0.2 };
      this.lightSpots.push(pk.spot);
    }
    return pk;
  }

  removePickup(pk) {
    pk.alive = false;
    this.scene.remove(pk.mesh);
    if (pk.spot) this.lightSpots = this.lightSpots.filter((s) => s !== pk.spot);
  }

  update(t, dt) {
    for (const f of this.animated) f(t, dt);
    for (const pk of this.pickups) {
      if (!pk.alive) continue;
      pk.mesh.position.y = pk.baseY + Math.sin(t * 2 + pk.pos.x) * 0.15;
      pk.mesh.rotation.y = t * 1.2;
      if (pk.ring) pk.ring.rotation.z = t;
    }
    for (const l of this.lanterns) {
      l.flame.rotation.y = t * 2;
      if (l.lit) l.flame.scale.y = 1.6 + Math.sin(t * 11 + l.pos.x) * 0.2;
    }
  }
}
