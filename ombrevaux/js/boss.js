import * as THREE from 'three';
import { makeSeraphine, compactModel } from './models.js';
import { ELEMENT_MULT } from './spells.js';
import { angleLerp } from './utils.js';

// Séraphine, l'Ange de la Rosace : ange de vitrail corrompu, trois phases.
const GLASS = [0xff3050, 0x3a6aff, 0xffb030, 0x9a50ff, 0x30d0a0];
const ARENA = new THREE.Vector3(0, 0, -494);

export class Boss {
  constructor(game) {
    this.game = game;
    this.m = makeSeraphine();
    compactModel(this.m.root);
    this.m.root.scale.setScalar(1.35);
    game.scene.add(this.m.root);
    this.name = 'Séraphine, l\'Ange de la Rosace';
    this.kind = 'boss';
    this.radius = 2.0;
    this.height = 7;
    this.maxHp = 1600;
    this.reset();
  }

  reset() {
    this.hp = this.maxHp;
    this.pos = new THREE.Vector3(0, 0, -508);
    this.alive = true;
    this.active = false;
    this.dying = false;
    this.facing = 0;
    this.phase = 1;
    this.t = 0;
    this.actionT = 2.5;
    this.action = null;
    this.hover = 1.2;
    this.flashT = 0;
    this.stunT = 0;
    this.deathT = 0;
    this.summoned = [];
    this.phaseShown = 1;
    this.m.root.visible = true;
    this.m.root.scale.setScalar(1.35);
    this.m.haloMat.emissive.setHex(0xffd27a);
    this.m.coreMat.emissiveIntensity = 0;
    this.sync();
  }

  center() {
    return new THREE.Vector3(this.pos.x, this.pos.y + this.hover + 5, this.pos.z);
  }

  start() {
    this.active = true;
    this.actionT = 2.0;
  }

  takeDamage(amount, element) {
    if (!this.active || this.dying) return 0;
    const mult = ELEMENT_MULT.boss[element] ?? 1;
    const dmg = Math.round(amount * mult);
    this.hp = Math.max(0, this.hp - dmg);
    this.flashT = 0.12;
    const col = element === 'holy' ? '#ffd27a' : element === 'lightning' ? '#9fd8ff' : '#c9a8ff';
    this.game.hud.damageNumber(this.center(), dmg, col, mult < 0.7 ? 'resist' : '');
    if (this.hp <= 0) this.startDeath();
    return dmg;
  }

  stun() {}
  knockback() {}

  sync() {
    const r = this.m.root;
    r.position.set(this.pos.x, this.pos.y + this.hover, this.pos.z);
    r.rotation.y = this.facing;
  }

  startDeath() {
    this.dying = true;
    this.deathT = 0;
    this.action = null;
    this.game.combat.clearHostile();
    for (const e of this.summoned) if (e.alive && e.state !== 'dying') e.takeDamage(9999, 'lightning');
  }

  update(dt) {
    if (!this.alive) return;
    const g = this.game, m = this.m, pl = g.player;
    this.t += dt;
    // Animation de base
    m.halo.rotation.z += dt * (this.phase === 3 ? 2.5 : 0.6);
    const flap = Math.sin(this.t * 1.6) * 0.15;
    m.wings[0].rotation.z = flap; m.wings[1].rotation.z = -flap;
    m.body.position.y = Math.sin(this.t * 1.2) * 0.25;
    this.flashT = Math.max(0, this.flashT - dt);
    m.coreMat.emissiveIntensity = (this.phase - 1) * 2 + Math.sin(this.t * 6) * 0.5 + this.flashT * 30;

    if (this.dying) { this.updateDeath(dt); return; }
    if (!this.active) {
      this.facing = angleLerp(this.facing, 0, dt);
      this.sync();
      return;
    }

    // Phases
    const r = this.hp / this.maxHp;
    const newPhase = r > 0.66 ? 1 : r > 0.33 ? 2 : 3;
    if (newPhase !== this.phase) {
      this.phase = newPhase;
      this.action = { type: 'roar', t: 0, dur: 2.2 };
      g.onBossPhase(newPhase);
      if (newPhase === 3) m.haloMat.emissive.setHex(0xff2040);
    }

    if (!pl.dead) this.facing = angleLerp(this.facing, Math.atan2(pl.pos.x - this.pos.x, pl.pos.z - this.pos.z), 1 - Math.exp(-3 * dt));
    g.lights.request(this.center(), this.phase === 3 ? 0xff3050 : 0xffd0a0, 18, 18);

    // Lent déplacement dans l'arène
    if (!this.action || this.action.type === 'barrage') {
      const want = this.phase === 1 ? -506 : -498;
      const ang = this.t * (this.phase === 3 ? 0.5 : 0.25);
      const tx = ARENA.x + Math.sin(ang) * (this.phase === 1 ? 4 : 10);
      const tz = want + Math.cos(ang * 1.3) * 4;
      this.pos.x += (tx - this.pos.x) * Math.min(1, dt * 0.6);
      this.pos.z += (tz - this.pos.z) * Math.min(1, dt * 0.6);
    }
    this.hover += ((this.phase >= 2 ? 2.6 : 1.2) - this.hover) * Math.min(1, dt);

    if (this.action) this.runAction(dt);
    else if (!pl.dead) {
      this.actionT -= dt;
      if (this.actionT <= 0) this.pickAction();
    }
    // Pose des bras
    const a = this.action;
    const raise = a && (a.type === 'shards' || a.type === 'barrage' || a.type === 'roar') ? -2.4 : a && a.type === 'pillars' ? -3.0 : a && a.type === 'slam' ? (a.t < a.wind ? -3.0 : 0.2) : -0.2;
    m.arms[0].rotation.x += (raise - m.arms[0].rotation.x) * Math.min(1, dt * 6);
    m.arms[1].rotation.x += ((a && a.type === 'slam' ? raise : -0.4) - m.arms[1].rotation.x) * Math.min(1, dt * 8);
    this.sync();
  }

  pickAction() {
    const pl = this.game.player;
    const d = Math.hypot(pl.pos.x - this.pos.x, pl.pos.z - this.pos.z);
    const opts = ['shards', 'pillars'];
    if (d < 9) opts.push('slam', 'slam');
    if (this.phase >= 2) opts.push('barrage', 'summon');
    if (this.phase === 3) opts.push('rings', 'pillars');
    let type = opts[Math.floor(Math.random() * opts.length)];
    if (type === 'summon' && this.summoned.filter((e) => e.alive).length >= 2) type = 'shards';
    const speed = this.phase === 3 ? 0.7 : this.phase === 2 ? 0.85 : 1;
    const durs = { shards: 1.6, pillars: 2.4, slam: 1.8, barrage: 3.2, summon: 1.6, rings: 3.0 };
    this.action = { type, t: 0, dur: durs[type] * speed, wind: 0.9 * speed, fired: 0, speed };
  }

  runAction(dt) {
    const g = this.game, a = this.action, pl = g.player;
    a.t += dt;
    const c = this.center();
    if (a.type === 'roar') {
      if (a.t < 0.05) {
        g.camCtl.shake = 1;
        g.particles.burst(c, 120, new THREE.Color(this.phase === 3 ? 0xff3050 : 0xffd27a), { speed: 14, size: 0.6, life: 1.0, intensity: 2.5, drag: 0.1 });
        g.combat.shockwave(new THREE.Vector3(this.pos.x, 0, this.pos.z), { color: 0xffc070, speed: 14, max: 26, dmg: 15 });
      }
    } else if (a.type === 'shards') {
      // Éventail d'éclats de vitrail
      const waves = this.phase === 1 ? 2 : 3;
      const times = [0.5, 0.9, 1.3].slice(0, waves).map((x) => x * a.speed);
      while (a.fired < waves && a.t >= times[a.fired]) {
        const n = this.phase === 3 ? 11 : 9;
        const base = Math.atan2(pl.pos.x - c.x, pl.pos.z - c.z) + (a.fired % 2 ? 0.08 : 0);
        for (let i = 0; i < n; i++) {
          const ang = base + (i - (n - 1) / 2) * 0.13;
          const dy = (pl.pos.y + 1 - c.y) / Math.max(4, Math.hypot(pl.pos.x - c.x, pl.pos.z - c.z));
          const v = new THREE.Vector3(Math.sin(ang), dy, Math.cos(ang)).normalize().multiplyScalar(17);
          this.shard(c.clone(), v, GLASS[(i + a.fired) % GLASS.length]);
        }
        a.fired++;
      }
    } else if (a.type === 'pillars') {
      // Colonnes de lumière télégraphiées sous le joueur
      const count = this.phase === 1 ? 3 : this.phase === 2 ? 5 : 7;
      const gap = 0.32 * a.speed;
      while (a.fired < count && a.t >= 0.4 + a.fired * gap) {
        const lead = a.fired === 0 ? 0 : 1.2;
        const p = new THREE.Vector3(pl.pos.x + pl.vel.x * lead * 0.5 + (Math.random() - 0.5) * 3 * (a.fired ? 1 : 0), 0, pl.pos.z + pl.vel.y * lead * 0.5 + (Math.random() - 0.5) * 3 * (a.fired ? 1 : 0));
        this.lightPillar(p);
        a.fired++;
      }
    } else if (a.type === 'slam') {
      if (a.t >= a.wind && !a.fired) {
        a.fired = 1;
        const f = new THREE.Vector3(this.pos.x + Math.sin(this.facing) * 4, 0, this.pos.z + Math.cos(this.facing) * 4);
        g.combat.shockwave(f, { color: 0xfff0c0, speed: 13, max: 16, dmg: 22 });
        g.particles.burst(new THREE.Vector3(f.x, 0.5, f.z), 60, new THREE.Color(0xffe0a0), { speed: 9, size: 0.5, life: 0.6, intensity: 2.5, up: 1 });
        g.lights.flash(new THREE.Vector3(f.x, 1, f.z), 0xffe0a0, 60, 20, 0.5);
        g.camCtl.shake = 0.8;
        const d = Math.hypot(pl.pos.x - f.x, pl.pos.z - f.z);
        if (d < 3.5 && pl.damage(28, f.x, f.z)) g.onPlayerHurt(28);
        if (this.phase >= 2) g.combat.shockwave(f, { color: 0xff6080, speed: 8, max: 14, dmg: 18 });
      }
    } else if (a.type === 'barrage') {
      // Spirale d'orbes
      const rate = this.phase === 3 ? 0.07 : 0.1;
      while (a.t > 0.5 && a.fired * rate < a.t - 0.5 && a.t < a.dur - 0.3) {
        const ang = a.fired * 0.55 + this.t;
        for (const off of this.phase === 3 ? [0, Math.PI * 2 / 3, Math.PI * 4 / 3] : [0, Math.PI]) {
          const v = new THREE.Vector3(Math.sin(ang + off), -0.05, Math.cos(ang + off)).multiplyScalar(9);
          this.orb(c.clone(), v, GLASS[a.fired % GLASS.length]);
        }
        a.fired++;
      }
    } else if (a.type === 'summon') {
      if (a.t > 0.8 && !a.fired) {
        a.fired = 1;
        for (const s of [-1, 1]) {
          const x = this.pos.x + s * 8, z = this.pos.z + 6;
          const e = g.enemies.spawn('gargoyle', x, z, { state: 'chase', aggro: true });
          e.fly = 3;
          this.summoned.push(e);
          g.particles.burst(new THREE.Vector3(x, 3, z), 40, new THREE.Color(0x9a50ff), { speed: 6, size: 0.5, life: 0.7, intensity: 2 });
        }
        g.hud.toast('Séraphine appelle ses gardiennes de pierre !');
      }
    } else if (a.type === 'rings') {
      // Rosace : anneaux concentriques
      const times = [0.6, 1.4, 2.2].map((x) => x * a.speed);
      while (a.fired < 3 && a.t >= times[a.fired]) {
        g.combat.shockwave(new THREE.Vector3(this.pos.x, 0, this.pos.z), { color: GLASS[a.fired], speed: 9 + a.fired * 2, max: 30, dmg: 16 });
        const n = 16;
        for (let i = 0; i < n; i++) {
          const ang = (i / n) * Math.PI * 2 + a.fired * 0.2;
          this.orb(c.clone(), new THREE.Vector3(Math.sin(ang), -0.12, Math.cos(ang)).multiplyScalar(8), GLASS[(i + a.fired) % GLASS.length]);
        }
        a.fired++;
      }
    }
    if (a.t >= a.dur) {
      this.action = null;
      this.actionT = (this.phase === 3 ? 0.6 : this.phase === 2 ? 0.9 : 1.3) + Math.random() * 0.6;
    }
  }

  shard(pos, vel, color) {
    const g = this.game;
    const c = new THREE.Color(color);
    g.combat.spawn({
      owner: 'enemy', pos, vel, radius: 0.35, dmg: 12, color: c, size: 0.22, life: 3, shape: 'shard', bright: 2.5,
      trail: (p) => { if (Math.random() < 0.5) g.particles.emit(p.x, p.y, p.z, 0, 0, 0, c, 0.3, 0.25, { intensity: 2 }); },
      onHit: (p) => g.particles.burst(p, 8, c, { speed: 3, size: 0.25, life: 0.3, intensity: 2 }),
    });
  }

  orb(pos, vel, color) {
    const g = this.game;
    const c = new THREE.Color(color);
    g.combat.spawn({
      owner: 'enemy', pos, vel, radius: 0.4, dmg: 10, color: c, size: 0.3, life: 5, bright: 2.5,
      trail: (p) => { if (Math.random() < 0.4) g.particles.emit(p.x, p.y, p.z, 0, 0.3, 0, c, 0.4, 0.3, { intensity: 1.8 }); },
      onHit: (p) => g.particles.burst(p, 8, c, { speed: 3, size: 0.25, life: 0.3, intensity: 2 }),
    });
  }

  lightPillar(p) {
    const g = this.game;
    const r = this.phase === 3 ? 2.6 : 2.2;
    g.combat.telegraph(p, r, 1.0, 0xffd27a, (pos, radius) => {
      const pl = g.player;
      const beam = new THREE.Mesh(
        new THREE.CylinderGeometry(radius * 0.8, radius, 30, 16, 1, true),
        new THREE.MeshBasicMaterial({ color: new THREE.Color(0xfff0c0).multiplyScalar(1.6), transparent: true, opacity: 0.7, side: THREE.FrontSide, depthWrite: false, blending: THREE.AdditiveBlending }),
      );
      beam.position.set(pos.x, pos.y + 15, pos.z);
      g.scene.add(beam);
      let life = 0.45;
      g.extraUpdates.push((dt) => {
        life -= dt;
        beam.material.opacity = Math.max(0, life / 0.45) * 0.7;
        beam.scale.x = beam.scale.z = 1 + (0.45 - life);
        if (life <= 0) { g.scene.remove(beam); beam.geometry.dispose(); return false; }
        return true;
      });
      g.particles.burst(new THREE.Vector3(pos.x, pos.y + 0.5, pos.z), 40, new THREE.Color(0xffe0a0), { speed: 7, size: 0.5, life: 0.6, intensity: 2.5, up: 1 });
      g.lights.flash(new THREE.Vector3(pos.x, 2, pos.z), 0xffe0a0, 50, 16, 0.4);
      const d = Math.hypot(pl.pos.x - pos.x, pl.pos.z - pos.z);
      if (d < radius + 0.3 && pl.damage(24, pos.x, pos.z)) g.onPlayerHurt(24);
    });
  }

  updateDeath(dt) {
    const g = this.game, m = this.m;
    this.deathT += dt;
    const c = this.center();
    m.root.rotation.z = Math.sin(this.deathT * 40) * 0.03 * Math.min(1, this.deathT);
    if (Math.random() < 0.7) {
      g.particles.burst(c.clone().add(new THREE.Vector3((Math.random() - 0.5) * 3, (Math.random() - 0.5) * 5, (Math.random() - 0.5) * 2)), 6,
        new THREE.Color(GLASS[Math.floor(Math.random() * GLASS.length)]), { speed: 6, size: 0.4, life: 0.8, intensity: 2.5 });
    }
    g.lights.request(c, 0xfff0d0, 20 + this.deathT * 20, 30);
    g.camCtl.shake = Math.max(g.camCtl.shake, 0.3);
    if (this.deathT > 3.2) {
      g.particles.burst(c, 400, new THREE.Color(0xfff0c0), { speed: 22, size: 0.8, life: 1.6, intensity: 3, drag: 0.15 });
      for (const col of GLASS) g.particles.burst(c, 60, new THREE.Color(col), { speed: 16, size: 0.5, life: 1.8, intensity: 2.5, gravity: 4 });
      g.lights.flash(c, 0xffffff, 200, 60, 1.5);
      g.camCtl.shake = 1.2;
      m.root.visible = false;
      this.alive = false;
      g.onBossDefeated();
    }
  }
}
