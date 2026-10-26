import * as THREE from 'three';

// Fragments physiques simples (os, éclats de pierre) qui rebondissent puis s'enfoncent.
const GEO = {
  bone: new THREE.BoxGeometry(0.06, 0.38, 0.06),
  rib: new THREE.BoxGeometry(0.3, 0.04, 0.12),
  skull: new THREE.BoxGeometry(0.22, 0.22, 0.24),
  stone: new THREE.DodecahedronGeometry(0.22, 0),
  shard: new THREE.OctahedronGeometry(0.18, 0),
};

export class Debris {
  constructor(scene, world) {
    this.scene = scene;
    this.world = world;
    this.list = [];
    this.mats = {
      bone: new THREE.MeshStandardMaterial({ color: 0xd8d0bc, roughness: 0.85, flatShading: true }),
      stone: new THREE.MeshStandardMaterial({ color: 0x6b6a66, roughness: 1, flatShading: true }),
    };
  }

  // kinds : liste de [géométrie, matériau]
  burst(center, kinds, count, opts = {}) {
    for (let i = 0; i < count; i++) {
      const [g, m] = kinds[i % kinds.length];
      const mesh = new THREE.Mesh(GEO[g], typeof m === 'string' ? this.mats[m] : m);
      mesh.castShadow = true;
      mesh.position.set(center.x + (Math.random() - 0.5) * 0.6, center.y + (Math.random() - 0.3) * (opts.spreadY ?? 1), center.z + (Math.random() - 0.5) * 0.6);
      const s = (opts.scale ?? 1) * (0.7 + Math.random() * 0.6);
      mesh.scale.setScalar(s);
      mesh.rotation.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
      this.scene.add(mesh);
      const sp = opts.speed ?? 4;
      this.list.push({
        mesh, t: 0, life: opts.life ?? 4 + Math.random() * 2, rest: false,
        vel: new THREE.Vector3((Math.random() - 0.5) * sp, 2 + Math.random() * sp * 0.8, (Math.random() - 0.5) * sp),
        spin: new THREE.Vector3((Math.random() - 0.5) * 12, (Math.random() - 0.5) * 12, (Math.random() - 0.5) * 12),
        r: 0.08 * s,
      });
    }
  }

  update(dt) {
    for (const d of this.list) {
      d.t += dt;
      const m = d.mesh;
      if (!d.rest) {
        d.vel.y -= 14 * dt;
        m.position.addScaledVector(d.vel, dt);
        m.rotation.x += d.spin.x * dt; m.rotation.y += d.spin.y * dt; m.rotation.z += d.spin.z * dt;
        const gy = this.world.getHeight(m.position.x, m.position.z) + d.r;
        if (m.position.y < gy) {
          m.position.y = gy;
          d.vel.y = -d.vel.y * 0.35;
          d.vel.x *= 0.6; d.vel.z *= 0.6;
          d.spin.multiplyScalar(0.5);
          if (Math.abs(d.vel.y) < 0.8) d.rest = true;
        }
      }
      if (d.t > d.life) m.position.y -= dt * 0.25;
      if (d.t > d.life + 2) { this.scene.remove(m); d.dead = true; }
    }
    this.list = this.list.filter((d) => !d.dead);
  }
}
