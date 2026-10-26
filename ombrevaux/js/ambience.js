import * as THREE from 'three';
import { mulberry32, distToPolyline } from './utils.js';
import { PATH } from './world.js';

// Ambiance : rayons de lune, faisceaux des vitraux, végétation au vent.

const SHAFT_VERT = `
varying vec2 vUv;
varying vec3 vWorld;
void main() {
  vUv = uv;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
const SHAFT_FRAG = `
uniform float uTime;
uniform vec3 uColor;
uniform vec3 uCam;
uniform float uNear;
uniform float uFar;
varying vec2 vUv;
varying vec3 vWorld;
float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float n(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }
void main() {
  float across = 1.0 - abs(vUv.x * 2.0 - 1.0);
  float a = pow(across, 1.6) * smoothstep(0.0, 0.12, vUv.y) * smoothstep(1.0, 0.35, vUv.y);
  float dust = n(vec2(vUv.x * 5.0, vUv.y * 2.0 - uTime * 0.08)) * 0.6 + n(vec2(vUv.x * 13.0 + uTime * 0.05, vUv.y * 6.0)) * 0.4;
  a *= 0.55 + dust * 0.7;
  float d = distance(vWorld, uCam);
  a *= smoothstep(uNear, uNear * 3.0, d) * smoothstep(uFar, uFar * 0.4, d);
  gl_FragColor = vec4(uColor * a, a);
}`;

function shaftMaterial(color, intensity, near = 3, far = 110) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 }, uColor: { value: new THREE.Color(color).multiplyScalar(intensity) },
      uCam: { value: new THREE.Vector3() }, uNear: { value: near }, uFar: { value: far },
    },
    vertexShader: SHAFT_VERT, fragmentShader: SHAFT_FRAG,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
}

// Balancement au vent injecté dans un matériau standard instancié.
export function addWind(material, time, amp) {
  material.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = time;
    sh.vertexShader = 'uniform float uTime;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      float hh = max(position.y, 0.0);
      #ifdef USE_INSTANCING
        vec4 wp0 = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
      #else
        vec4 wp0 = modelMatrix * vec4(0.0, 0.0, 0.0, 1.0);
      #endif
      float wv = sin(uTime * 1.6 + wp0.x * 0.35 + wp0.z * 0.25) + 0.5 * sin(uTime * 2.7 + wp0.z * 0.6 + wp0.x * 0.1);
      transformed.x += wv * hh * hh * ${amp.toFixed(4)};
      transformed.z += cos(uTime * 1.3 + wp0.x * 0.3) * hh * hh * ${(amp * 0.6).toFixed(4)};`);
  };
  material.customProgramCacheKey = () => 'wind' + amp;
}

function tuftGeometry(rnd, blades, hMin, hMax, colBase, colTip) {
  const pos = [], nor = [], uv = [], col = [];
  const cb = new THREE.Color(colBase), ct = new THREE.Color(colTip);
  for (let i = 0; i < blades; i++) {
    const a = rnd() * Math.PI * 2, r = rnd() * 0.12;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    const h = hMin + rnd() * (hMax - hMin);
    const w = 0.025 + rnd() * 0.03;
    const ra = rnd() * Math.PI;
    const dx = Math.cos(ra) * w, dz = Math.sin(ra) * w;
    const lean = 0.15 + rnd() * 0.25;
    const tx = x + Math.cos(a) * lean * h, tz = z + Math.sin(a) * lean * h;
    pos.push(x - dx, 0, z - dz, x + dx, 0, z + dz, tx, h, tz);
    for (let k = 0; k < 3; k++) nor.push(0, 1, 0);
    uv.push(0, 0, 1, 0, 0.5, 1);
    col.push(cb.r, cb.g, cb.b, cb.r, cb.g, cb.b, ct.r, ct.g, ct.b);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return g;
}

function chunked(scene, geo, mat, list, size, opts = {}) {
  const chunks = new Map();
  for (const it of list) {
    const key = `${Math.floor(it[0] / size)},${Math.floor(it[2] / size)}`;
    if (!chunks.has(key)) chunks.set(key, []);
    chunks.get(key).push(it);
  }
  const dummy = new THREE.Object3D();
  for (const items of chunks.values()) {
    const im = new THREE.InstancedMesh(geo, mat, items.length);
    items.forEach(([x, y, z, ry, s, sy], i) => {
      dummy.position.set(x, y, z);
      dummy.rotation.set(0, ry, 0);
      dummy.scale.set(s, s * (sy ?? 1), s);
      dummy.updateMatrix();
      im.setMatrixAt(i, dummy.matrix);
    });
    im.receiveShadow = opts.receive ?? true;
    im.castShadow = opts.cast ?? false;
    scene.add(im);
  }
}

export class Ambience {
  constructor(scene, world, moonDir) {
    this.scene = scene;
    this.world = world;
    this.time = { value: 0 };
    this.rnd = mulberry32(4242);
    this.moonShafts = [];
    this.shaftMats = [];
    this.buildVegetation();
    this.buildMoonShafts(moonDir);
    this.buildWindowBeams();
  }

  buildVegetation() {
    const w = this.world, rnd = this.rnd;
    const grassMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, side: THREE.DoubleSide });
    addWind(grassMat, this.time, 0.35);
    const variants = [
      tuftGeometry(rnd, 9, 0.25, 0.6, 0x23271a, 0x6e6a42),
      tuftGeometry(rnd, 7, 0.4, 0.9, 0x1e2318, 0x5d6a3c),
      tuftGeometry(rnd, 12, 0.15, 0.35, 0x272418, 0x7a6a44),
    ];
    const lists = variants.map(() => []);
    const tryAdd = (x, z, s) => {
      if (!w.col.inAreas(x, z, 0.2) || w.col.hitsObstacle(x, z, 0.35)) return;
      if (w.inCathedral(x, z)) return;
      const dp = distToPolyline(x, z, PATH);
      if (dp < 1.6 && rnd() < 0.85) return;
      lists[Math.floor(rnd() * variants.length)].push([x, w.getHeight(x, z) - 0.02, z, rnd() * 6.28, s * (0.7 + rnd() * 0.7)]);
    };
    for (let i = 0; i < 5200; i++) tryAdd(-45 + rnd() * 90, -100 + rnd() * 124, 1.1);
    for (let i = 0; i < 2200; i++) tryAdd(-40 + rnd() * 80, -194 + rnd() * 70, 0.9);
    for (let i = 0; i < 1400; i++) {
      const x = (rnd() < 0.5 ? -1 : 1) * (30 + rnd() * 25), z = -200 - rnd() * 130;
      tryAdd(x, z, 0.8);
    }
    variants.forEach((g, i) => chunked(this.scene, g, grassMat, lists[i], 40));

    // Ronces sèches (branches épineuses) en bordure
    const brambleMat = new THREE.MeshStandardMaterial({ color: 0x2b2018, roughness: 1, flatShading: true });
    addWind(brambleMat, this.time, 0.06);
    const bParts = [];
    for (let i = 0; i < 9; i++) {
      const g = new THREE.CylinderGeometry(0.012, 0.03, 0.9 + rnd() * 0.6, 4, 1, true);
      g.translate(0, 0.5, 0);
      g.rotateZ((rnd() - 0.5) * 1.6);
      g.rotateY(rnd() * 6.28);
      bParts.push(g);
    }
    const bramble = mergeSimple(bParts);
    const brambles = [];
    for (let i = 0; i < 900; i++) {
      const x = -45 + rnd() * 90, z = -194 + rnd() * 218;
      const out = w.col.outsideDistance(x, z);
      if (out > 0 && out < 2.5) brambles.push([x, w.getHeight(x, z), z, rnd() * 6.28, 0.8 + rnd() * 0.8, 0.8 + rnd() * 0.6]);
    }
    chunked(this.scene, bramble, brambleMat, brambles, 50);

    // Champignons luminescents au pied des arbres
    const capGeo = new THREE.SphereGeometry(0.08, 6, 4, 0, Math.PI * 2, 0, Math.PI / 2);
    capGeo.scale(1, 0.7, 1);
    capGeo.translate(0, 0.1, 0);
    const stemGeo = new THREE.CylinderGeometry(0.018, 0.025, 0.1, 5).translate(0, 0.05, 0);
    const shroomGeo = mergeSimple([capGeo, stemGeo, capGeo.clone().scale(0.7, 0.7, 0.7).translate(0.09, -0.02, 0.05), stemGeo.clone().scale(0.8, 0.7, 0.8).translate(0.09, 0, 0.05)]);
    const shroomMat = new THREE.MeshStandardMaterial({ color: 0x0a1a18, emissive: 0x2affd0, emissiveIntensity: 1.4, roughness: 0.6 });
    const shrooms = [];
    for (const c of w.col.circles) {
      if (c.r < 0.35 || c.r > 0.8 || c.z < -196 || rnd() > 0.35) continue;
      const a = rnd() * 6.28;
      const x = c.x + Math.cos(a) * (c.r + 0.15), z = c.z + Math.sin(a) * (c.r + 0.15);
      shrooms.push([x, w.getHeight(x, z), z, rnd() * 6.28, 0.8 + rnd() * 0.8]);
    }
    chunked(this.scene, shroomGeo, shroomMat, shrooms, 60, { receive: false });
  }

  buildMoonShafts(moonDir) {
    const rnd = this.rnd;
    const spots = [];
    for (let i = 0; i < 9; i++) spots.push([-38 + rnd() * 76, -95 + rnd() * 110]);
    for (let i = 0; i < 6; i++) spots.push([-35 + rnd() * 70, -190 + rnd() * 60]);
    for (let i = 0; i < 4; i++) spots.push([(rnd() < 0.5 ? -1 : 1) * (15 + rnd() * 30), -210 - rnd() * 110]);
    const mat = shaftMaterial(0x9fb8ff, 0.3);
    this.shaftMats.push(mat);
    for (const [x, z] of spots) {
      const L = 45, wdt = 2.5 + rnd() * 3.5;
      const geo = new THREE.PlaneGeometry(wdt, L);
      geo.translate(0, L / 2, 0);
      const m = new THREE.Mesh(geo, mat);
      m.renderOrder = 7;
      m.frustumCulled = false;
      m.matrixAutoUpdate = false;
      const base = new THREE.Vector3(x, this.world.getHeight(x, z) - 0.5, z);
      this.scene.add(m);
      this.moonShafts.push({ mesh: m, base, axis: moonDir.clone().normalize() });
    }
  }

  // Faisceaux colorés qui tombent des vitraux sur le dallage.
  buildWindowBeams() {
    const cols = [0xff3050, 0x3060ff, 0xffb030, 0x40c090];
    const poolTex = (() => {
      const c = document.createElement('canvas');
      c.width = c.height = 128;
      const ctx = c.getContext('2d');
      const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 128, 128);
      return new THREE.CanvasTexture(c);
    })();
    let wi = 0;
    for (let z = -367; z > -466; z -= 10) {
      for (const s of [-1, 1]) {
        const col = cols[wi++ % 4];
        const top = new THREE.Vector3(s * 12.9, 9.5, z);
        const bottom = new THREE.Vector3(s * 4.5, 0, z + 2.5);
        const axis = bottom.clone().sub(top);
        const L = axis.length();
        const mat = shaftMaterial(col, 0.32, 1.5, 70);
        this.shaftMats.push(mat);
        for (let k = 0; k < 2; k++) {
          const geo = new THREE.PlaneGeometry(2.6, L);
          geo.translate(0, L / 2, 0);
          const m = new THREE.Mesh(geo, mat);
          m.position.copy(bottom);
          m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis.clone().negate().normalize());
          m.rotateY(k * Math.PI / 2);
          m.renderOrder = 7;
          this.scene.add(m);
        }
        const pool = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 5), new THREE.MeshBasicMaterial({ map: poolTex, color: new THREE.Color(col).multiplyScalar(0.7), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
        pool.rotation.x = -Math.PI / 2;
        pool.position.set(bottom.x, 0.07, bottom.z);
        pool.renderOrder = 4;
        this.scene.add(pool);
      }
    }
    // Rosace : grand faisceau rose et or vers l'autel
    const top = new THREE.Vector3(0, 17, -519), bottom = new THREE.Vector3(0, 0, -497);
    const axis = bottom.clone().sub(top), L = axis.length();
    const mat = shaftMaterial(0xff7090, 0.3, 2, 90);
    this.shaftMats.push(mat);
    for (let k = 0; k < 2; k++) {
      const geo = new THREE.PlaneGeometry(9, L);
      geo.translate(0, L / 2, 0);
      const m = new THREE.Mesh(geo, mat);
      m.position.copy(bottom);
      m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis.clone().negate().normalize());
      m.rotateY(k * Math.PI / 2);
      m.renderOrder = 7;
      this.scene.add(m);
    }
    this.roseShaft = mat;
  }

  update(dt, camPos) {
    this.time.value += dt;
    for (const m of this.shaftMats) {
      m.uniforms.uTime.value = this.time.value;
      m.uniforms.uCam.value.copy(camPos);
    }
    // Rayons de lune : panneaux tournés vers la caméra autour de leur axe.
    const up = new THREE.Vector3(), right = new THREE.Vector3(), fwd = new THREE.Vector3(), toCam = new THREE.Vector3();
    for (const s of this.moonShafts) {
      up.copy(s.axis);
      toCam.subVectors(camPos, s.base);
      right.crossVectors(up, toCam).normalize();
      fwd.crossVectors(right, up).normalize();
      s.mesh.matrix.makeBasis(right, up, fwd).setPosition(s.base);
      s.mesh.matrixWorldNeedsUpdate = true;
    }
  }

  setDawn(k) {
    this.shaftMats[0].uniforms.uColor.value.set(0x9fb8ff).lerp(new THREE.Color(0xffc890), k).multiplyScalar(0.3 + k * 0.2);
  }
}

// Fusion minimale de géométries indexées ou non (position, normal, uv).
function mergeSimple(geos) {
  const pos = [], nor = [], uv = [];
  for (const g0 of geos) {
    const g = g0.index ? g0.toNonIndexed() : g0;
    pos.push(...g.attributes.position.array);
    nor.push(...g.attributes.normal.array);
    uv.push(...(g.attributes.uv ? g.attributes.uv.array : new Float32Array(g.attributes.position.count * 2)));
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return out;
}
