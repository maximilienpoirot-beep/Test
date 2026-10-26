import * as THREE from 'three';
import { SPELLS } from './player.js';

const C = (hex) => new THREE.Color(hex);
const COL = {
  arcane: C(0xa070ff), holy: C(0xffd27a), holyHot: C(0xfff4d0), lightning: C(0x8fd0ff),
  shadow: C(0x6a3cff), smoke: C(0x120c1c), bone: C(0xe6dcc0), blood: C(0x8a0a14),
};

export const ELEMENT_MULT = {
  undead: { arcane: 1, holy: 2.2, lightning: 1 },
  beast: { arcane: 1, holy: 1, lightning: 1.15 },
  stone: { arcane: 0.4, holy: 0.8, lightning: 1.8 },
  boss: { arcane: 1, holy: 0.6, lightning: 1.1 },
};

const sphereGeo = new THREE.IcosahedronGeometry(1, 1);
const shardGeo = new THREE.OctahedronGeometry(1, 0);
const arrowGeo = new THREE.BoxGeometry(1, 1, 1);
const tmp = new THREE.Vector3();

export class Combat {
  constructor(game) {
    this.game = game;
    this.projectiles = [];
    this.bolts = [];
    this.telegraphs = [];
    this.waves = [];
    this.scene = game.scene;
  }

  // ------------------------------------------------------------ Sorts du joueur
  tryCast(key, aim) {
    const g = this.game, p = g.player, sp = SPELLS[key];
    if (!p.unlocked[key] || p.cooldowns[key] > 0 || p.dead) return false;
    if (p.mana < sp.mana) { g.hud.flashMana(); return false; }
    let ok = false;
    if (key === 'arcane') ok = this.castArcane(aim);
    else if (key === 'holy') ok = this.castHoly(aim);
    else if (key === 'lightning') ok = this.castLightning(aim);
    if (ok) {
      p.mana -= sp.mana;
      p.cooldowns[key] = sp.cd;
      p.castAnim = 1;
      p.aimTimer = 0.6;
      g.stats.casts++;
    }
    return ok;
  }

  origin() {
    const p = this.game.player;
    return p.handPos.clone().add(new THREE.Vector3(0, 0.1, 0));
  }

  castArcane(aim) {
    const o = this.origin();
    const dir = aim.clone().sub(o).normalize();
    this.spawn({
      owner: 'player', pos: o, vel: dir.multiplyScalar(42), radius: 0.25, dmg: 14, element: 'arcane',
      color: COL.arcane, size: 0.16, life: 1.4, light: 6,
      trail: (p) => this.game.particles.emit(p.x, p.y, p.z, (Math.random() - 0.5), (Math.random() - 0.5), (Math.random() - 0.5), COL.arcane, 0.35, 0.25, { intensity: 2.5 }),
      onHit: (p) => this.game.particles.burst(p, 14, COL.arcane, { speed: 5, size: 0.3, life: 0.35, intensity: 2.5 }),
    });
    this.game.particles.burst(o, 6, COL.arcane, { speed: 2, size: 0.25, life: 0.2, intensity: 3 });
    return true;
  }

  castHoly(aim) {
    const o = this.origin();
    const dir = aim.clone().sub(o).normalize();
    const maxDist = Math.min(40, aim.distanceTo(o));
    this.spawn({
      owner: 'player', pos: o, vel: dir.multiplyScalar(24), radius: 0.4, dmg: 0, element: 'holy',
      color: COL.holy, size: 0.32, life: maxDist / 24 + 0.02, light: 14, explodeOnExpire: true,
      hitsVeil: true,
      trail: (p) => {
        for (let i = 0; i < 2; i++) this.game.particles.emit(p.x, p.y, p.z, (Math.random() - 0.5) * 1.5, (Math.random() - 0.2) * 1.5, (Math.random() - 0.5) * 1.5, COL.holy, 0.55, 0.45, { intensity: 2.2 });
      },
      onHit: (p) => this.holyExplosion(p),
    });
    return true;
  }

  holyExplosion(p) {
    const g = this.game, R = 6.5;
    g.particles.burst(p, 70, COL.holy, { speed: 11, size: 0.6, life: 0.7, intensity: 2.5, drag: 0.05 });
    g.particles.burst(p, 25, COL.holyHot, { speed: 4, size: 1.2, life: 0.5, intensity: 3 });
    g.particles.ring(new THREE.Vector3(p.x, g.world.getHeight(p.x, p.z) + 0.2, p.z), 40, 0.5, COL.holy, { speed: 12, size: 0.5, life: 0.5, intensity: 2, drag: 0.02 });
    g.lights.flash(p, 0xffe0a0, 60, 22, 0.6);
    g.camCtl.shake = Math.max(g.camCtl.shake, 0.5);
    for (const t of g.targets()) {
      const d = Math.hypot(t.pos.x - p.x, t.pos.z - p.z) - t.radius;
      if (d > R) continue;
      const fall = 1 - Math.max(0, d) / R * 0.45;
      t.takeDamage(42 * fall, 'holy');
      t.stun?.(t.kind === 'undead' ? 2.0 : 1.0);
      t.knockback?.(t.pos.x - p.x, t.pos.z - p.z, 9);
    }
    const v = g.world.veil;
    if (v.alive && Math.hypot(v.pos.x - p.x, v.pos.z - p.z) < R + 3) {
      g.world.dispelVeil();
      g.onVeilDispelled();
      const vp = v.mesh.position;
      for (let i = 0; i < 120; i++) {
        g.particles.emit(vp.x + (Math.random() - 0.5) * 10, vp.y + (Math.random() - 0.5) * 6, vp.z, (Math.random() - 0.5) * 2, 1 + Math.random() * 2, (Math.random() - 0.5) * 2, COL.shadow, 0.7, 1.5, { intensity: 1.5 });
      }
    }
  }

  castLightning(aim) {
    const g = this.game, cam = g.camera;
    const camPos = cam.position;
    const L = aim.clone().sub(camPos).normalize();
    const p0 = this.origin();
    // Cible la plus proche du rayon de visée.
    let best = null, bestScore = Infinity;
    const consider = (pos, obj, isConduit) => {
      tmp.copy(pos).sub(camPos);
      const t = tmp.dot(L);
      if (t < 1) return;
      if (pos.distanceTo(g.player.pos) > 34) return;
      const perp = tmp.addScaledVector(L, -t).length();
      const tol = 1.6 + t * 0.045 + (isConduit ? 1.5 : 0);
      if (perp < tol && perp < bestScore) { best = { pos, obj, isConduit }; bestScore = perp; }
    };
    for (const t of g.targets()) consider(t.center(), t, false);
    for (const c of g.world.conduits) if (!c.powered) consider(c.pos, c, true);

    if (!best) {
      const end = p0.clone().add(aim.clone().sub(p0).normalize().multiplyScalar(Math.min(18, aim.distanceTo(p0))));
      this.bolt(p0, end, 0.2);
      g.particles.burst(end, 12, COL.lightning, { speed: 5, size: 0.3, life: 0.3, intensity: 3 });
      g.lights.flash(end, 0x9fd8ff, 25, 12, 0.2);
      return true;
    }
    if (best.isConduit) {
      this.bolt(p0, best.pos, 0.35);
      g.particles.burst(best.pos, 40, COL.lightning, { speed: 8, size: 0.4, life: 0.5, intensity: 3 });
      g.lights.flash(best.pos, 0x9fd8ff, 50, 20, 0.5);
      g.onConduitPowered(best.obj);
      return true;
    }
    // Chaîne
    const hit = new Set();
    let from = p0, cur = best.obj, dmg = 34;
    for (let n = 0; n < 5 && cur; n++) {
      const cp = cur.center();
      this.bolt(from, cp, 0.25);
      g.particles.burst(cp, 18, COL.lightning, { speed: 6, size: 0.35, life: 0.35, intensity: 3 });
      g.lights.flash(cp, 0x9fd8ff, 30, 12, 0.25);
      cur.takeDamage(dmg, 'lightning');
      cur.stun?.(0.35);
      hit.add(cur);
      dmg *= 0.82;
      from = cp;
      let next = null, nd = 10;
      for (const t of g.targets()) {
        if (hit.has(t)) continue;
        const d = t.pos.distanceTo(cur.pos);
        if (d < nd) { nd = d; next = t; }
      }
      cur = next;
    }
    g.camCtl.shake = Math.max(g.camCtl.shake, 0.25);
    return true;
  }

  shadowStep(dirX, dirZ) {
    const g = this.game, p = g.player, sp = SPELLS.shadow;
    if (!p.unlocked.shadow || p.cooldowns.shadow > 0 || p.dash || p.dead) return false;
    if (p.mana < sp.mana) { g.hud.flashMana(); return false; }
    const from = p.pos.clone();
    if (!p.startDash(g.world, dirX, dirZ)) return false;
    p.mana -= sp.mana;
    p.cooldowns.shadow = sp.cd;
    const to = p.dash.to;
    this.smokePuff(from);
    // Traînée d'ombre
    for (let i = 0; i <= 12; i++) {
      const k = i / 12;
      const x = from.x + (to.x - from.x) * k, z = from.z + (to.z - from.z) * k;
      const y = g.world.getHeight(x, z) + 1;
      g.particles.emit(x, y, z, 0, 0.5, 0, COL.shadow, 0.8, 0.5, { intensity: 1.6 });
    }
    setTimeout(() => this.smokePuff(new THREE.Vector3(to.x, g.world.getHeight(to.x, to.z), to.z)), p.dash.dur * 1000);
    return true;
  }

  smokePuff(p) {
    const g = this.game;
    for (let i = 0; i < 26; i++) {
      g.smoke.emit(p.x + (Math.random() - 0.5) * 0.8, p.y + 0.3 + Math.random() * 1.6, p.z + (Math.random() - 0.5) * 0.8,
        (Math.random() - 0.5) * 2.5, Math.random() * 1.5, (Math.random() - 0.5) * 2.5, COL.smoke, 1.1, 0.9, { sizeEnd: 1.8, drag: 0.2, alpha: 0.85 });
    }
    g.particles.burst(new THREE.Vector3(p.x, p.y + 1, p.z), 16, COL.shadow, { speed: 4, size: 0.35, life: 0.5, intensity: 2 });
  }

  // ------------------------------------------------------------ Projectiles
  spawn(o) {
    const mesh = new THREE.Mesh(sphereGeo, new THREE.MeshBasicMaterial({ color: o.color.clone().multiplyScalar(o.bright ?? 3) }));
    mesh.scale.setScalar(o.size);
    mesh.position.copy(o.pos);
    if (o.shape === 'shard') {
      mesh.geometry = shardGeo;
      mesh.scale.set(o.size * 0.6, o.size * 0.6, o.size * 2.2);
    } else if (o.shape === 'arrow') {
      mesh.geometry = arrowGeo;
      mesh.scale.set(0.05, 0.05, 0.8);
    }
    this.scene.add(mesh);
    const p = { ...o, mesh, age: 0, dead: false };
    this.projectiles.push(p);
    return p;
  }

  explode(p) {
    if (p.dead) return;
    p.dead = true;
    this.scene.remove(p.mesh);
    p.onHit?.(p.pos, p);
  }

  updateProjectiles(dt) {
    const g = this.game, world = g.world;
    for (const p of this.projectiles) {
      if (p.dead) continue;
      p.age += dt;
      if (p.homing && g.player && !g.player.dead) {
        const target = tmp.copy(g.player.pos).add(new THREE.Vector3(0, 1.1, 0)).sub(p.pos).normalize();
        const sp = p.vel.length();
        p.vel.lerp(target.multiplyScalar(sp), Math.min(1, dt * p.homing)).setLength(sp);
      }
      if (p.gravity) p.vel.y -= p.gravity * dt;
      p.pos.addScaledVector(p.vel, dt);
      p.mesh.position.copy(p.pos);
      if (p.shape) p.mesh.lookAt(tmp.copy(p.pos).add(p.vel));
      p.trail?.(p.pos);
      if (p.light) g.lights.request(p.pos, p.color, p.light, 8);

      if (p.age > p.life) {
        if (p.explodeOnExpire) this.explode(p);
        else { p.dead = true; this.scene.remove(p.mesh); }
        continue;
      }
      // Sol et obstacles
      if (p.pos.y < world.getHeight(p.pos.x, p.pos.z) + 0.05) { this.explode(p); continue; }
      const solid = world.col.solidAt(p.pos.x, p.pos.y, p.pos.z, p.radius * 0.5);
      if (solid && solid.tag !== 'grate') { this.explode(p); continue; }

      if (p.owner === 'player') {
        for (const t of g.targets()) {
          const c = t.center();
          if (c.distanceTo(p.pos) < t.radius + p.radius + 0.25) {
            if (p.dmg) t.takeDamage(p.dmg, p.element);
            this.explode(p);
            break;
          }
        }
      } else {
        const pl = g.player;
        if (!pl.dead && !pl.hidden) {
          const dx = pl.pos.x - p.pos.x, dz = pl.pos.z - p.pos.z, dy = (pl.pos.y + 1) - p.pos.y;
          if (dx * dx + dz * dz < (p.radius + 0.45) ** 2 && Math.abs(dy) < 1.1) {
            if (pl.damage(p.dmg, p.pos.x - p.vel.x, p.pos.z - p.vel.z)) g.onPlayerHurt(p.dmg);
            this.explode(p);
          }
        }
      }
    }
    this.projectiles = this.projectiles.filter((p) => !p.dead);
  }

  // ------------------------------------------------------------ Éclairs
  bolt(a, b, life = 0.25, color = 0x9fe0ff, width = 0.05) {
    const bolt = { a: a.clone(), b: b.clone(), life, t: 0, mesh: null, regen: 0, color, width };
    this.buildBolt(bolt);
    this.bolts.push(bolt);
  }

  buildBolt(bolt) {
    if (bolt.mesh) { this.scene.remove(bolt.mesh); bolt.mesh.geometry.dispose(); }
    const pts = [];
    const n = Math.max(4, Math.floor(bolt.a.distanceTo(bolt.b) / 1.2));
    for (let i = 0; i <= n; i++) {
      const k = i / n;
      const p = bolt.a.clone().lerp(bolt.b, k);
      if (i > 0 && i < n) p.add(new THREE.Vector3((Math.random() - 0.5) * 0.9, (Math.random() - 0.5) * 0.9, (Math.random() - 0.5) * 0.9));
      pts.push(p);
    }
    const path = new THREE.CurvePath();
    for (let i = 0; i < pts.length - 1; i++) path.add(new THREE.LineCurve3(pts[i], pts[i + 1]));
    const geo = new THREE.TubeGeometry(path, n * 2, bolt.width, 4, false);
    const col = new THREE.Color(bolt.color).multiplyScalar(4);
    bolt.mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: col, transparent: true }));
    this.scene.add(bolt.mesh);
  }

  updateBolts(dt) {
    for (const b of this.bolts) {
      b.t += dt; b.regen -= dt;
      if (b.t < b.life && b.regen <= 0) { b.regen = 0.05; this.buildBolt(b); }
      b.mesh.material.opacity = Math.max(0, 1 - b.t / b.life);
      this.game.lights.request(b.b, b.color, 20 * (1 - b.t / b.life), 12);
      if (b.t >= b.life) { this.scene.remove(b.mesh); b.mesh.geometry.dispose(); b.dead = true; }
    }
    this.bolts = this.bolts.filter((b) => !b.dead);
  }

  // ------------------------------------------------------------ Télégraphes et ondes
  telegraph(pos, radius, delay, color, onFire) {
    const g = this.game;
    const y = g.world.getHeight(pos.x, pos.z) + 0.08;
    const ringGeo = new THREE.RingGeometry(radius * 0.92, radius, 40);
    const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(2.5), transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(pos.x, y, pos.z);
    const fill = new THREE.Mesh(new THREE.CircleGeometry(radius, 40), new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(1.5), transparent: true, opacity: 0.25, depthWrite: false, side: THREE.DoubleSide }));
    fill.rotation.x = -Math.PI / 2;
    fill.position.set(pos.x, y + 0.01, pos.z);
    fill.scale.setScalar(0.01);
    this.scene.add(ring, fill);
    this.telegraphs.push({ ring, fill, t: 0, delay, onFire, pos: new THREE.Vector3(pos.x, y, pos.z), radius });
  }

  shockwave(pos, opts) {
    const g = this.game;
    const geo = new THREE.RingGeometry(0.85, 1, 64);
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: new THREE.Color(opts.color).multiplyScalar(3), transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }));
    m.rotation.x = -Math.PI / 2;
    m.position.set(pos.x, g.world.getHeight(pos.x, pos.z) + 0.15, pos.z);
    this.scene.add(m);
    this.waves.push({ mesh: m, pos: pos.clone(), r: 0.5, speed: opts.speed ?? 10, max: opts.max ?? 20, dmg: opts.dmg ?? 20, hit: false, color: new THREE.Color(opts.color) });
  }

  updateTelegraphs(dt) {
    const g = this.game;
    for (const t of this.telegraphs) {
      t.t += dt;
      const k = Math.min(1, t.t / t.delay);
      t.fill.scale.setScalar(Math.max(0.01, k));
      t.ring.material.opacity = 0.5 + Math.sin(t.t * 20) * 0.3;
      if (t.t >= t.delay) {
        this.scene.remove(t.ring, t.fill);
        t.ring.geometry.dispose(); t.fill.geometry.dispose();
        t.dead = true;
        t.onFire?.(t.pos, t.radius);
      }
    }
    this.telegraphs = this.telegraphs.filter((t) => !t.dead);

    const pl = g.player;
    for (const w of this.waves) {
      w.r += w.speed * dt;
      w.mesh.scale.setScalar(w.r);
      w.mesh.material.opacity = Math.max(0, 1 - w.r / w.max);
      for (let i = 0; i < 3; i++) {
        const a = Math.random() * Math.PI * 2;
        g.particles.emit(w.pos.x + Math.cos(a) * w.r, w.mesh.position.y + 0.2, w.pos.z + Math.sin(a) * w.r, 0, 1.5, 0, w.color, 0.5, 0.4, { intensity: 2 });
      }
      if (!w.hit && !pl.dead) {
        const d = Math.hypot(pl.pos.x - w.pos.x, pl.pos.z - w.pos.z);
        if (Math.abs(d - w.r) < 0.6) {
          if (pl.damage(w.dmg, w.pos.x, w.pos.z)) { g.onPlayerHurt(w.dmg); w.hit = true; }
        }
      }
      if (w.r >= w.max) { this.scene.remove(w.mesh); w.mesh.geometry.dispose(); w.dead = true; }
    }
    this.waves = this.waves.filter((w) => !w.dead);
  }

  update(dt) {
    this.updateProjectiles(dt);
    this.updateBolts(dt);
    this.updateTelegraphs(dt);
  }

  clearHostile() {
    for (const p of this.projectiles) if (p.owner !== 'player') { p.dead = true; this.scene.remove(p.mesh); }
    this.projectiles = this.projectiles.filter((p) => !p.dead);
    for (const t of this.telegraphs) { this.scene.remove(t.ring, t.fill); }
    this.telegraphs = [];
    for (const w of this.waves) this.scene.remove(w.mesh);
    this.waves = [];
  }
}

export { COL };
