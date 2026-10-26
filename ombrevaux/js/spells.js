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
    this.aimDir = new THREE.Vector3(0, 0, -1);
    this.handFront = new THREE.Vector3();
    this.handCircle = null;
    this.ghosts = [];
  }

  // Cercle runique devant la main (et au sol pour les grands sorts).
  castCircles(key, aim) {
    const g = this.game, p = g.player, col = SPELLS[key].color;
    this.aimDir.copy(aim).sub(p.handPos).normalize();
    this.handFront.copy(p.handPos).addScaledVector(this.aimDir, 0.45);
    const hc = this.handCircle;
    if (hc && !hc.closing && !hc.dead && hc.key === key) hc.life = hc.t + 0.4;
    else {
      hc?.kill();
      this.handCircle = g.circles.spawn({ follow: this.handFront, vertical: true, normal: this.aimDir, radius: 0.55, color: col, symbol: key, life: 0.4, open: 0.12, spin: 3, intensity: 2.6 });
      this.handCircle.key = key;
    }
    if (key !== 'arcane') g.circles.spawn({ follow: p.pos, radius: 1.8, color: col, symbol: key, life: 0.55, open: 0.18, spin: 2, intensity: 1.8 });
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
      this.castCircles(key, aim);
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
      color: COL.arcane, size: 0.14, life: 1.4, light: 6, shape: 'bolt',
      trailFx: { color: 0xa070ff, width: 0.16, length: 14, intensity: 3 },
      trail: (p) => { if (Math.random() < 0.6) this.game.particles.emit(p.x, p.y, p.z, (Math.random() - 0.5), (Math.random() - 0.5), (Math.random() - 0.5), COL.arcane, 0.3, 0.3, { intensity: 2.5 }); },
      onHit: (p) => {
        this.game.particles.burst(p, 16, COL.arcane, { speed: 5, size: 0.3, life: 0.35, intensity: 2.5 });
        this.flare(p, 0xa070ff, 0.9, 0.18);
      },
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
      trailFx: { color: 0xffc860, width: 0.42, length: 22, intensity: 2.6 },
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
    const ground = new THREE.Vector3(p.x, 0, p.z);
    g.circles.spawn({ pos: ground, radius: R, color: 0xffd27a, symbol: 'holy', life: 0.75, open: 0.12, spin: 1.6, intensity: 2.4 });
    g.circles.spawn({ pos: ground, radius: 2.4, color: 0xffa040, symbol: 'holy', life: 7, alpha: 0.35, spin: 0.15, layers: 2, intensity: 1.6 });
    this.dome(p, R, 0xffe0a0, 0.45);
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
      g.circles.spawn({ pos: best.pos, vertical: true, normal: new THREE.Vector3(0, 0, 1), radius: 1.4, color: 0x8fd0ff, symbol: 'lightning', life: 0.9, open: 0.15, spin: 2.5 });
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
      g.circles.spawn({ pos: cur.pos, radius: 1.1 + cur.radius, color: 0x8fd0ff, symbol: 'lightning', life: 0.45, open: 0.1, spin: 3, intensity: 2.2 });
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
    g.circles.spawn({ pos: from, radius: 1.5, color: 0x9a76ff, symbol: 'shadow', life: 0.7, open: 0.12, spin: 2.5, intensity: 2 });
    setTimeout(() => g.circles.spawn({ pos: to, radius: 1.5, color: 0x9a76ff, symbol: 'shadow', life: 0.6, open: 0.1, spin: -2.5, intensity: 2 }), p.dash.dur * 1000);
    this.afterimages(from, to);
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

  // Silhouettes fantômes laissées le long du Pas de l'ombre.
  afterimages(from, to) {
    const g = this.game, p = g.player;
    for (let i = 0; i < 4; i++) {
      const k = i / 4;
      const ghost = p.model.root.clone();
      const m = new THREE.MeshBasicMaterial({ color: new THREE.Color(0x6a3cff).multiplyScalar(1.6), transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false });
      ghost.traverse((o) => { if (o.isMesh) { o.material = m; o.castShadow = false; } });
      ghost.visible = true;
      const x = from.x + (to.x - from.x) * k, z = from.z + (to.z - from.z) * k;
      ghost.position.set(x, g.world.getHeight(x, z), z);
      this.scene.add(ghost);
      this.ghosts.push({ obj: ghost, mat: m, t: -k * 0.12, life: 0.55 });
    }
  }

  // Éclat sphérique bref (impacts).
  flare(pos, color, size, life) {
    this.dome(pos, size, color, life, true);
  }

  dome(pos, radius, color, life, solid = false) {
    const m = new THREE.Mesh(sphereGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(solid ? 3 : 1.6), transparent: true, opacity: solid ? 1 : 0.5, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    m.position.copy(pos);
    m.scale.setScalar(0.1);
    this.scene.add(m);
    this.ghosts.push({ obj: m, mat: m.material, t: 0, life, grow: radius, dome: true });
  }

  updateGhosts(dt) {
    for (const gh of this.ghosts) {
      gh.t += dt;
      if (gh.t < 0) { gh.obj.visible = false; continue; }
      gh.obj.visible = true;
      const k = Math.min(1, gh.t / gh.life);
      if (gh.dome) {
        gh.obj.scale.setScalar(0.1 + gh.grow * (1 - Math.pow(1 - k, 3)));
        gh.mat.opacity = (1 - k) * (1 - k) * 0.6;
      } else {
        gh.mat.opacity = 0.55 * (1 - k);
        gh.obj.position.y += dt * 0.6;
      }
      if (k >= 1) { this.scene.remove(gh.obj); gh.mat.dispose(); gh.dead = true; }
    }
    this.ghosts = this.ghosts.filter((gh) => !gh.dead);
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
    } else if (o.shape === 'bolt') {
      mesh.geometry = shardGeo;
      mesh.scale.set(o.size, o.size, o.size * 3.5);
    }
    this.scene.add(mesh);
    const p = { ...o, mesh, age: 0, dead: false };
    if (o.trailFx) p.ribbon = this.game.trails.create(o.trailFx);
    this.projectiles.push(p);
    return p;
  }

  explode(p) {
    if (p.dead) return;
    p.dead = true;
    this.scene.remove(p.mesh);
    p.ribbon?.detach();
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
      p.ribbon?.push(p.pos);
      if (p.light) g.lights.request(p.pos, p.color, p.light, 8);

      if (p.age > p.life) {
        if (p.explodeOnExpire) this.explode(p);
        else { p.dead = true; this.scene.remove(p.mesh); p.ribbon?.detach(); }
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

  boltPath(a, b, jitter) {
    const pts = [];
    const n = Math.max(3, Math.floor(a.distanceTo(b) / 1.0));
    for (let i = 0; i <= n; i++) {
      const p = a.clone().lerp(b, i / n);
      if (i > 0 && i < n) p.add(new THREE.Vector3((Math.random() - 0.5) * jitter, (Math.random() - 0.5) * jitter, (Math.random() - 0.5) * jitter));
      pts.push(p);
    }
    return pts;
  }

  tube(pts, width) {
    const path = new THREE.CurvePath();
    for (let i = 0; i < pts.length - 1; i++) path.add(new THREE.LineCurve3(pts[i], pts[i + 1]));
    return new THREE.TubeGeometry(path, (pts.length - 1) * 2, width, 4, false);
  }

  // Éclair : cœur blanc, halo coloré et petites ramifications.
  buildBolt(bolt) {
    if (bolt.mesh) {
      this.scene.remove(bolt.mesh);
      bolt.mesh.traverse((o) => { if (o.isMesh) o.geometry.dispose(); });
    }
    const group = new THREE.Group();
    const pts = this.boltPath(bolt.a, bolt.b, 1.0);
    if (!bolt.mats) {
      bolt.mats = [
        new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffffff).multiplyScalar(4), transparent: true }),
        new THREE.MeshBasicMaterial({ color: new THREE.Color(bolt.color).multiplyScalar(2.2), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }),
      ];
    }
    group.add(new THREE.Mesh(this.tube(pts, bolt.width * 0.5), bolt.mats[0]));
    group.add(new THREE.Mesh(this.tube(pts, bolt.width * 2.6), bolt.mats[1]));
    for (let f = 0; f < 3; f++) {
      const i = 1 + Math.floor(Math.random() * (pts.length - 2));
      const start = pts[i];
      const dir = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
      const end = start.clone().addScaledVector(dir, 0.8 + Math.random() * 1.8);
      group.add(new THREE.Mesh(this.tube(this.boltPath(start, end, 0.4), bolt.width * 0.9), bolt.mats[1]));
    }
    bolt.mesh = group;
    this.scene.add(group);
  }

  updateBolts(dt) {
    for (const b of this.bolts) {
      b.t += dt; b.regen -= dt;
      if (b.t < b.life && b.regen <= 0) { b.regen = 0.05; this.buildBolt(b); }
      const op = Math.max(0, 1 - b.t / b.life);
      b.mats[0].opacity = op;
      b.mats[1].opacity = op * 0.6;
      this.game.lights.request(b.b, b.color, 20 * op, 12);
      if (b.t >= b.life) {
        this.scene.remove(b.mesh);
        b.mesh.traverse((o) => { if (o.isMesh) o.geometry.dispose(); });
        b.mats.forEach((m) => m.dispose());
        b.dead = true;
      }
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
    const circle = g.circles.spawn({ pos: new THREE.Vector3(pos.x, 0, pos.z), radius, color, symbol: 'eye', life: delay, open: 0.25, spin: 2, intensity: 2 });
    this.telegraphs.push({ ring, fill, circle, t: 0, delay, onFire, pos: new THREE.Vector3(pos.x, y, pos.z), radius });
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
    const p = this.game.player;
    this.handFront.copy(p.handPos).addScaledVector(this.aimDir, 0.45);
    this.updateGhosts(dt);
    this.updateProjectiles(dt);
    this.updateBolts(dt);
    this.updateTelegraphs(dt);
  }

  clearHostile() {
    for (const p of this.projectiles) if (p.owner !== 'player') { p.dead = true; this.scene.remove(p.mesh); p.ribbon?.detach(); }
    this.projectiles = this.projectiles.filter((p) => !p.dead);
    for (const t of this.telegraphs) { this.scene.remove(t.ring, t.fill); t.circle?.kill(); }
    this.telegraphs = [];
    for (const w of this.waves) this.scene.remove(w.mesh);
    this.waves = [];
  }
}

export { COL };
