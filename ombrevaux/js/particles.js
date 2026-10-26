import * as THREE from 'three';

const VERT = `
attribute float size;
attribute float alpha;
attribute vec3 pcolor;
varying float vA;
varying vec3 vC;
uniform float uScale;
void main() {
  vA = alpha;
  vC = pcolor;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = size * uScale / max(0.1, -mv.z);
  gl_Position = projectionMatrix * mv;
}`;

const FRAG_ADD = `
varying float vA;
varying vec3 vC;
void main() {
  vec2 p = gl_PointCoord - 0.5;
  float a = smoothstep(0.5, 0.0, length(p));
  a *= a;
  gl_FragColor = vec4(vC * a * vA, a * vA);
}`;

const FRAG_NORMAL = `
varying float vA;
varying vec3 vC;
void main() {
  vec2 p = gl_PointCoord - 0.5;
  float a = smoothstep(0.5, 0.1, length(p));
  gl_FragColor = vec4(vC, a * vA);
}`;

export class Particles {
  constructor(scene, max = 4000, additive = true) {
    this.max = max;
    this.next = 0;
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.alpha = new Float32Array(max);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.size0 = new Float32Array(max);
    this.size1 = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.alpha0 = new Float32Array(max);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('pcolor', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.uniforms = { uScale: { value: 400 } };
    const m = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: VERT,
      fragmentShader: additive ? FRAG_ADD : FRAG_NORMAL,
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(g, m);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 10 : 9;
    scene.add(this.points);
    this.geo = g;
  }

  setScale(height, fov) {
    this.uniforms.uScale.value = height / (2 * Math.tan((fov * Math.PI) / 360));
  }

  emit(x, y, z, vx, vy, vz, color, size, life, opts = {}) {
    const i = this.next;
    this.next = (this.next + 1) % this.max;
    const i3 = i * 3;
    this.pos[i3] = x; this.pos[i3 + 1] = y; this.pos[i3 + 2] = z;
    this.vel[i3] = vx; this.vel[i3 + 1] = vy; this.vel[i3 + 2] = vz;
    const k = opts.intensity ?? 1;
    this.col[i3] = color.r * k; this.col[i3 + 1] = color.g * k; this.col[i3 + 2] = color.b * k;
    this.size0[i] = size;
    this.size1[i] = opts.sizeEnd ?? size * 0.2;
    this.life[i] = life;
    this.maxLife[i] = life;
    this.grav[i] = opts.gravity ?? 0;
    this.drag[i] = opts.drag ?? 1;
    this.alpha0[i] = opts.alpha ?? 1;
  }

  burst(p, count, color, opts = {}) {
    const speed = opts.speed ?? 4, size = opts.size ?? 0.3, life = opts.life ?? 0.8;
    const spread = opts.spread ?? 0.2;
    for (let n = 0; n < count; n++) {
      let dx = Math.random() * 2 - 1, dy = Math.random() * 2 - 1, dz = Math.random() * 2 - 1;
      const l = Math.hypot(dx, dy, dz) || 1;
      const s = speed * (0.3 + Math.random() * 0.7);
      dx /= l; dy /= l; dz /= l;
      if (opts.up) dy = Math.abs(dy) * opts.up;
      this.emit(
        p.x + (Math.random() - 0.5) * spread, p.y + (Math.random() - 0.5) * spread, p.z + (Math.random() - 0.5) * spread,
        dx * s, dy * s, dz * s, color, size * (0.6 + Math.random() * 0.8), life * (0.6 + Math.random() * 0.6), opts,
      );
    }
  }

  // Anneau horizontal (ondes de choc).
  ring(p, count, radius, color, opts = {}) {
    for (let n = 0; n < count; n++) {
      const a = (n / count) * Math.PI * 2;
      const s = opts.speed ?? 6;
      this.emit(p.x + Math.cos(a) * radius, p.y, p.z + Math.sin(a) * radius,
        Math.cos(a) * s, opts.vy ?? 0.5, Math.sin(a) * s, color, opts.size ?? 0.4, opts.life ?? 0.6, opts);
    }
  }

  update(dt) {
    const { pos, vel, life, maxLife, size, alpha } = this;
    for (let i = 0; i < this.max; i++) {
      if (life[i] <= 0) { if (alpha[i] !== 0) { alpha[i] = 0; size[i] = 0; } continue; }
      life[i] -= dt;
      const i3 = i * 3;
      const d = Math.pow(this.drag[i], dt);
      vel[i3] *= d; vel[i3 + 1] = vel[i3 + 1] * d - this.grav[i] * dt; vel[i3 + 2] *= d;
      pos[i3] += vel[i3] * dt; pos[i3 + 1] += vel[i3 + 1] * dt; pos[i3 + 2] += vel[i3 + 2] * dt;
      const t = Math.max(0, life[i] / maxLife[i]);
      const fadeIn = Math.min(1, (1 - t) * 8);
      alpha[i] = this.alpha0[i] * Math.min(t * 2.5, 1) * fadeIn;
      size[i] = this.size1[i] + (this.size0[i] - this.size1[i]) * t;
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.pcolor.needsUpdate = true;
    this.geo.attributes.size.needsUpdate = true;
    this.geo.attributes.alpha.needsUpdate = true;
  }

  clear() {
    this.life.fill(0);
  }
}
