import * as THREE from 'three';

// Rubans lumineux orientés vers la caméra (traînées de projectiles, d'yeux…).
const VERT = `
attribute float a;
attribute float s;
varying float vA;
varying float vS;
void main() {
  vA = a; vS = s;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const FRAG = `
uniform vec3 uColor;
uniform float uOpacity;
varying float vA;
varying float vS;
void main() {
  float e = 1.0 - vS * vS;
  float k = vA * e * uOpacity;
  gl_FragColor = vec4(uColor * k, k);
}`;

const tmpA = new THREE.Vector3(), tmpB = new THREE.Vector3(), tmpC = new THREE.Vector3();

export class Trails {
  constructor(scene) {
    this.scene = scene;
    this.list = [];
  }

  create({ color = 0xffffff, width = 0.3, length = 18, intensity = 2.5, minDist = 0.08 } = {}) {
    const max = length;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(max * 2 * 3);
    const a = new Float32Array(max * 2);
    const s = new Float32Array(max * 2);
    for (let i = 0; i < max; i++) { s[i * 2] = -1; s[i * 2 + 1] = 1; }
    const idx = [];
    for (let i = 0; i < max - 1; i++) {
      const v = i * 2;
      idx.push(v, v + 1, v + 2, v + 1, v + 3, v + 2);
    }
    geo.setIndex(idx);
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('a', new THREE.BufferAttribute(a, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('s', new THREE.BufferAttribute(s, 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(color).multiplyScalar(intensity) }, uOpacity: { value: 1 } },
      vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = 8;
    this.scene.add(mesh);
    const t = { mesh, geo, pts: [], max, width, minDist, attached: true, dead: false, fade: 1 };
    t.push = (p) => {
      const head = t.pts[0];
      if (head && head.distanceToSquared(p) < t.minDist * t.minDist) head.copy(p);
      else {
        t.pts.unshift(p.clone());
        if (t.pts.length > t.max) t.pts.pop();
      }
    };
    t.detach = () => { t.attached = false; };
    t.reset = () => { t.pts.length = 0; };
    this.list.push(t);
    return t;
  }

  update(dt, camPos) {
    for (const t of this.list) {
      if (!t.attached) {
        // Une fois détachée, la traînée se résorbe par la queue.
        t.pts.pop();
        if (t.pts.length) t.pts.pop();
        if (t.pts.length < 2) { t.dead = true; }
      }
      const n = t.pts.length;
      const pos = t.geo.attributes.position.array, a = t.geo.attributes.a.array;
      for (let i = 0; i < n; i++) {
        const p = t.pts[i];
        const prev = t.pts[Math.max(0, i - 1)], next = t.pts[Math.min(n - 1, i + 1)];
        tmpA.subVectors(prev, next);
        if (tmpA.lengthSq() < 1e-8) tmpA.set(0, 1, 0);
        tmpB.subVectors(camPos, p);
        tmpC.crossVectors(tmpA, tmpB).normalize();
        const k = 1 - i / Math.max(1, t.max - 1);
        const w = t.width * (0.15 + 0.85 * k);
        pos[i * 6] = p.x - tmpC.x * w; pos[i * 6 + 1] = p.y - tmpC.y * w; pos[i * 6 + 2] = p.z - tmpC.z * w;
        pos[i * 6 + 3] = p.x + tmpC.x * w; pos[i * 6 + 4] = p.y + tmpC.y * w; pos[i * 6 + 5] = p.z + tmpC.z * w;
        a[i * 2] = a[i * 2 + 1] = k * k;
      }
      t.geo.setDrawRange(0, Math.max(0, (n - 1) * 6));
      t.geo.attributes.position.needsUpdate = true;
      t.geo.attributes.a.needsUpdate = true;
      if (t.dead) {
        this.scene.remove(t.mesh);
        t.geo.dispose();
        t.mesh.material.dispose();
      }
    }
    this.list = this.list.filter((t) => !t.dead);
  }
}
