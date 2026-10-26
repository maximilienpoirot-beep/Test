import * as THREE from 'three';
import { makeSkeleton, makeWerewolf, makeGargoyle, compactModel, addRim } from './models.js';
import { ELEMENT_MULT, COL } from './spells.js';
import { angleLerp, clamp } from './utils.js';

const TYPES = {
  skeleton: { name: 'Squelette', hp: 45, speed: 2.8, radius: 0.45, height: 1.8, kind: 'undead', dmg: 12, range: 2.0, windup: 0.55, cd: 1.3, aggro: 24 },
  archer: { name: 'Squelette archer', hp: 34, speed: 2.6, radius: 0.45, height: 1.8, kind: 'undead', dmg: 10, range: 17, windup: 0.9, cd: 2.0, aggro: 28, ranged: true },
  wolf: { name: 'Loup-garou', hp: 80, speed: 6.4, radius: 0.6, height: 2.0, kind: 'beast', dmg: 15, range: 2.4, windup: 0.42, cd: 1.15, aggro: 28, leap: true },
  alpha: { name: 'La Bête de Malbrume', hp: 560, speed: 7.0, radius: 1.0, height: 3.4, kind: 'beast', dmg: 24, range: 3.8, windup: 0.5, cd: 0.95, aggro: 45, leap: true, scale: 1.75 },
  gargoyle: { name: 'Gargouille', hp: 110, speed: 5.2, radius: 0.6, height: 1.6, kind: 'stone', dmg: 18, range: 2.2, windup: 0.6, cd: 1.7, aggro: 14, flying: true },
};

const tmpV = new THREE.Vector3();

export class Enemy {
  constructor(game, type, x, z, opts = {}) {
    this.game = game;
    this.type = type;
    const T = this.T = TYPES[type];
    this.kind = T.kind;
    this.name = T.name;
    this.maxHp = this.hp = T.hp * (opts.hpMult ?? 1);
    this.radius = T.radius;
    this.height = T.height;
    this.pos = new THREE.Vector3(x, game.world.getHeight(x, z), z);
    this.home = this.pos.clone();
    this.facing = opts.facing ?? Math.PI;
    this.alive = true;
    this.state = opts.state || 'idle';
    this.timer = 0;
    this.cd = 0.5 + Math.random();
    this.leapCd = 2 + Math.random() * 2;
    this.stunT = 0;
    this.flashT = 0;
    this.knock = new THREE.Vector2();
    this.phase = Math.random() * 10;
    this.fly = 0;
    this.strafe = Math.random() < 0.5 ? 1 : -1;
    this.aggro = !!opts.aggro;
    this.dieT = 0;
    this.yOff = 0;
    this.hpShown = 0;

    if (type === 'skeleton' || type === 'archer') this.m = makeSkeleton(type === 'archer');
    else if (type === 'wolf' || type === 'alpha') this.m = makeWerewolf(type === 'alpha');
    else this.m = makeGargoyle();
    compactModel(this.m.root);
    const rim = { skeleton: [0x8aa0d0, 0.5], archer: [0x8aa0d0, 0.5], wolf: [0x7a88b0, 0.45], alpha: [0xb0a0c0, 0.5], gargoyle: [0x8a90b0, 0.4] }[type];
    addRim(this.m.root, rim[0], rim[1]);
    if (T.scale) this.m.root.scale.setScalar(T.scale);
    if (type === 'wolf' || type === 'alpha') {
      this.eyeTrail = game.trails.create({ color: type === 'alpha' ? 0xff2020 : 0xffb21a, width: type === 'alpha' ? 0.12 : 0.07, length: 12, intensity: 3 });
      this.eyePos = new THREE.Vector3();
    }
    game.scene.add(this.m.root);
    this.mats = [];
    // Seules les grandes pièces projettent une ombre (moins d'appels de dessin).
    this.m.root.traverse((o) => {
      if (!o.isMesh) return;
      if (!o.geometry.boundingSphere) o.geometry.computeBoundingSphere();
      o.castShadow = o.geometry.boundingSphere.radius > 0.25;
    });
    this.m.root.traverse((o) => {
      if (o.isMesh && o.material.emissive && o.material.emissive.getHex() === 0 && !this.mats.includes(o.material)) this.mats.push(o.material);
    });

    if (this.state === 'rise') { this.yOff = -1.9; this.timer = opts.delay ?? 0; }
    if (this.state === 'dormant') {
      this.pos.y = opts.y ?? this.pos.y;
      this.perch = this.pos.y;
      this.radius = 0.8;
    }
    this.sync();
  }

  center() {
    return tmpV.set(this.pos.x, this.pos.y + this.yOff + this.height * 0.55 * (this.T.scale ?? 1) + this.fly, this.pos.z).clone();
  }

  takeDamage(amount, element) {
    if (!this.alive || this.state === 'dying') return 0;
    const mult = ELEMENT_MULT[this.kind][element] ?? 1;
    const dmg = Math.round(amount * mult);
    this.hp -= dmg;
    this.flashT = 0.15;
    this.aggro = true;
    if (this.state === 'dormant') this.wake();
    const col = element === 'holy' ? '#ffd27a' : element === 'lightning' ? '#9fd8ff' : '#c9a8ff';
    this.game.hud.damageNumber(this.center(), dmg, col, mult > 1.3 ? 'weak' : mult < 0.7 ? 'resist' : '');
    const c = this.center();
    if (this.kind === 'undead') this.game.particles.burst(c, 6, COL.bone, { speed: 3, size: 0.2, life: 0.4, gravity: 9 });
    else if (this.kind === 'beast') this.game.smoke.burst(c, 6, COL.blood, { speed: 3, size: 0.25, life: 0.5, gravity: 9, alpha: 0.9 });
    else this.game.smoke.burst(c, 8, new THREE.Color(0x77756f), { speed: 3, size: 0.25, life: 0.6, gravity: 9, alpha: 0.9 });
    if (this.hp <= 0) this.die();
    return dmg;
  }

  stun(t) {
    if (this.type === 'alpha') t *= 0.3;
    if (this.state === 'dormant' || this.state === 'rise') return;
    this.stunT = Math.max(this.stunT, t);
    if (this.state === 'windup' || this.state === 'leap') { this.state = 'chase'; this.cd = 0.6; }
  }

  knockback(dx, dz, f) {
    if (this.type === 'alpha') f *= 0.25;
    const l = Math.hypot(dx, dz) || 1;
    this.knock.set((dx / l) * f, (dz / l) * f);
  }

  wake() {
    if (this.state !== 'dormant') return;
    this.state = 'waking';
    this.timer = 1.1;
    this.radius = this.T.radius;
  }

  die() {
    this.state = 'dying';
    this.dieT = 0;
    this.eyeTrail?.detach();
    const c = this.center();
    const g = this.game;
    // Les squelettes éclatent en os, les gargouilles s'effritent.
    if (this.kind === 'undead') {
      g.debris.burst(c, [['skull', 'bone'], ['bone', 'bone'], ['rib', 'bone'], ['bone', 'bone']], 9, { speed: 5 });
      this.m.root.visible = false;
      g.particles.burst(c, 12, new THREE.Color(0xff3b1f), { speed: 2, size: 0.25, life: 0.6, intensity: 2.5 });
    } else if (this.kind === 'stone') {
      g.debris.burst(c, [['stone', 'stone'], ['shard', 'stone']], 12, { speed: 6 });
      this.m.root.visible = false;
    }
    this.game.onEnemyKilled(this);
  }

  sync() {
    const r = this.m.root;
    r.position.set(this.pos.x, this.pos.y + this.yOff + this.fly, this.pos.z);
    r.rotation.y = this.facing;
  }

  faceTo(x, z, dt, k = 10) {
    this.facing = angleLerp(this.facing, Math.atan2(x - this.pos.x, z - this.pos.z), 1 - Math.exp(-k * dt));
  }

  moveToward(x, z, speed, dt, ignore) {
    const dx = x - this.pos.x, dz = z - this.pos.z;
    const l = Math.hypot(dx, dz);
    if (l < 0.01) return;
    const mx = (dx / l) * speed * dt, mz = (dz / l) * speed * dt;
    const before = this.pos.x + this.pos.z;
    const y = this.T.flying ? this.fly : 0;
    const moved = this.game.world.col.move(this.pos, mx, mz, this.radius, ignore, y);
    // Contournement simple si bloqué.
    if (!moved || Math.abs(this.pos.x + this.pos.z - before) < speed * dt * 0.2) {
      this.game.world.col.move(this.pos, -mz * this.strafe, mx * this.strafe, this.radius, ignore, y);
      this.stuckT = (this.stuckT || 0) + dt;
      if (this.stuckT > 1.5) { this.strafe *= -1; this.stuckT = 0; }
    }
    this.moving = true;
  }

  update(dt) {
    const g = this.game, pl = g.player, m = this.m;
    this.phase += dt;
    this.flashT = Math.max(0, this.flashT - dt);
    const f = this.flashT > 0 ? this.flashT / 0.15 : 0;
    for (const mt of this.mats) mt.emissive.setScalar(f * 0.8);
    this.moving = false;

    if (this.state === 'dying') { this.animateDeath(dt); return; }

    const dx = pl.pos.x - this.pos.x, dz = pl.pos.z - this.pos.z;
    const d = Math.hypot(dx, dz);
    const T = this.T;
    const playerOk = !pl.dead;

    if (this.state === 'dormant') {
      if (playerOk && d < T.aggro) this.wake();
      this.sync();
      return;
    }
    if (this.state === 'waking') {
      this.timer -= dt;
      m.eyeMat.emissiveIntensity = (1 - this.timer / 1.1) * 4;
      m.root.position.x = this.pos.x + (Math.random() - 0.5) * 0.08;
      if (Math.random() < 0.4) g.smoke.burst(this.center(), 1, new THREE.Color(0x6b6a66), { speed: 2, size: 0.25, life: 0.5, gravity: 6, alpha: 0.8 });
      if (this.timer <= 0) { this.state = 'chase'; this.aggro = true; this.pos.y = g.world.getHeight(this.pos.x, this.pos.z); this.fly = this.perch - this.pos.y; }
      return;
    }
    if (this.state === 'rise') {
      this.timer -= dt;
      if (this.timer > 0) { m.root.visible = false; return; }
      m.root.visible = true;
      this.yOff = Math.min(0, this.yOff + dt * 1.4);
      if (Math.random() < 0.5) g.smoke.burst(new THREE.Vector3(this.pos.x, this.pos.y + 0.1, this.pos.z), 2, new THREE.Color(0x2a2118), { speed: 2.5, size: 0.35, life: 0.7, gravity: 5, up: 1, alpha: 0.9 });
      this.faceTo(pl.pos.x, pl.pos.z, dt, 3);
      if (this.yOff >= 0) { this.state = 'chase'; this.aggro = true; }
      this.animate(dt);
      this.sync();
      return;
    }

    // Recul
    if (this.knock.lengthSq() > 0.01) {
      g.world.col.move(this.pos, this.knock.x * dt, this.knock.y * dt, this.radius, null, T.flying ? this.fly : 0);
      this.knock.multiplyScalar(Math.exp(-7 * dt));
    }
    if (this.stunT > 0) {
      this.stunT -= dt;
      this.pos.y = g.world.getHeight(this.pos.x, this.pos.z);
      if (T.flying) this.fly = Math.max(0.3, this.fly - dt * 3);
      m.root.rotation.z = Math.sin(this.phase * 30) * 0.05;
      this.sync();
      return;
    }
    m.root.rotation.z = 0;
    this.cd -= dt;
    this.leapCd -= dt;

    if (this.state === 'idle') {
      if (playerOk && (d < T.aggro || this.aggro)) this.state = 'chase';
      else {
        // Errance légère autour du point d'origine.
        const wx = this.home.x + Math.sin(this.phase * 0.3 + this.home.z) * 3;
        const wz = this.home.z + Math.cos(this.phase * 0.25 + this.home.x) * 3;
        if (Math.hypot(wx - this.pos.x, wz - this.pos.z) > 0.5) {
          this.moveToward(wx, wz, T.speed * 0.3, dt);
          this.faceTo(wx, wz, dt, 4);
        }
      }
    } else if (!playerOk) {
      this.state = 'idle';
      this.aggro = false;
    } else if (this.state === 'chase') {
      this.aggro = true;
      if (d > 70) { this.state = 'idle'; this.aggro = false; }
      if (T.flying) this.fly = Math.min(2.6, this.fly + dt * 2);
      if (T.ranged) {
        if (d > T.range * 0.85) this.moveToward(pl.pos.x, pl.pos.z, T.speed, dt);
        else if (d < 7) this.moveToward(this.pos.x - dx, this.pos.z - dz, T.speed * 0.8, dt);
        this.faceTo(pl.pos.x, pl.pos.z, dt);
        if (d < T.range && this.cd <= 0) { this.state = 'windup'; this.timer = T.windup; }
      } else if (T.flying) {
        // Tourne autour du joueur puis plonge.
        const ang = Math.atan2(this.pos.x - pl.pos.x, this.pos.z - pl.pos.z) + dt * 0.8 * this.strafe;
        const ox = pl.pos.x + Math.sin(ang) * 6, oz = pl.pos.z + Math.cos(ang) * 6;
        this.moveToward(ox, oz, T.speed, dt);
        this.faceTo(pl.pos.x, pl.pos.z, dt);
        if (this.cd <= 0 && d < 12) { this.state = 'windup'; this.timer = T.windup; }
      } else {
        const close = d < T.range * 0.85;
        if (T.leap && this.leapCd <= 0 && d > 5 && d < 11) {
          this.state = 'leapWind'; this.timer = 0.45;
        } else if (!close) {
          if (this.cd > 0.3 && d < 6 && this.type === 'wolf') {
            // Tourne autour en attendant.
            this.moveToward(this.pos.x - dz * this.strafe, this.pos.z + dx * this.strafe, T.speed * 0.6, dt);
          } else this.moveToward(pl.pos.x, pl.pos.z, T.speed, dt);
        }
        this.faceTo(pl.pos.x, pl.pos.z, dt);
        if (d < T.range && this.cd <= 0) { this.state = 'windup'; this.timer = T.windup; }
      }
    } else if (this.state === 'windup') {
      this.timer -= dt;
      this.faceTo(pl.pos.x, pl.pos.z, dt, 6);
      if (T.flying) this.fly = Math.min(3.6, this.fly + dt * 2);
      if (this.timer <= 0) this.strike(d);
    } else if (this.state === 'dive') {
      this.timer -= dt;
      const t = this.target;
      const ddx = t.x - this.pos.x, ddz = t.z - this.pos.z, l = Math.hypot(ddx, ddz);
      const sp = 17;
      if (l > 0.4) this.game.world.col.move(this.pos, (ddx / l) * sp * dt, (ddz / l) * sp * dt, this.radius, null, this.fly);
      this.fly = Math.max(0.6, this.fly - dt * 8);
      const hd = Math.hypot(pl.pos.x - this.pos.x, pl.pos.z - this.pos.z);
      if (!this.hitDone && hd < 1.6 && this.fly < 1.8) {
        this.hitDone = true;
        if (pl.damage(T.dmg, this.pos.x, this.pos.z)) g.onPlayerHurt(T.dmg);
      }
      if (this.timer <= 0 || l < 0.5) { this.state = 'chase'; this.cd = T.cd; }
    } else if (this.state === 'leapWind') {
      this.timer -= dt;
      this.faceTo(pl.pos.x, pl.pos.z, dt, 8);
      if (this.timer <= 0) {
        this.state = 'leap'; this.timer = 0.5; this.hitDone = false;
        this.target = new THREE.Vector3(pl.pos.x, 0, pl.pos.z);
      }
    } else if (this.state === 'leap') {
      this.timer -= dt;
      const t = this.target;
      const ddx = t.x - this.pos.x, ddz = t.z - this.pos.z, l = Math.hypot(ddx, ddz);
      const sp = this.type === 'alpha' ? 20 : 16;
      if (l > 0.8) this.game.world.col.move(this.pos, (ddx / l) * sp * dt, (ddz / l) * sp * dt, this.radius);
      this.yOff = Math.sin((1 - this.timer / 0.5) * Math.PI) * 1.4;
      const hd = Math.hypot(pl.pos.x - this.pos.x, pl.pos.z - this.pos.z);
      if (!this.hitDone && hd < T.range * 0.9) {
        this.hitDone = true;
        const dm = Math.round(T.dmg * 1.25);
        if (pl.damage(dm, this.pos.x, this.pos.z)) g.onPlayerHurt(dm);
      }
      if (this.timer <= 0) {
        this.yOff = 0;
        this.state = 'chase';
        this.leapCd = 4 + Math.random() * 3;
        this.cd = 0.6;
        if (this.type === 'alpha') {
          g.combat.shockwave(this.pos, { color: 0xff5030, speed: 12, max: 9, dmg: 14 });
          g.camCtl.shake = Math.max(g.camCtl.shake, 0.6);
        }
      }
    } else if (this.state === 'recover') {
      this.timer -= dt;
      if (this.timer <= 0) this.state = 'chase';
    }

    if (this.state !== 'leap') this.yOff = Math.min(0, this.yOff);
    this.pos.y = g.world.getHeight(this.pos.x, this.pos.z);
    this.animate(dt);
    this.sync();
    if (this.eyeTrail) {
      this.m.root.updateMatrixWorld(true);
      this.eyeTrail.push(this.m.head.localToWorld(this.eyePos.set(0, 0.15, 0.2)));
    }
  }

  strike(d) {
    const g = this.game, pl = g.player, T = this.T;
    this.cd = T.cd * (0.85 + Math.random() * 0.3);
    if (T.ranged) {
      const from = this.center();
      from.y += 0.2;
      const lead = pl.vel ? new THREE.Vector3(pl.vel.x, 0, pl.vel.y).multiplyScalar(d / 22 * 0.6) : new THREE.Vector3();
      const to = new THREE.Vector3(pl.pos.x, pl.pos.y + 1.1, pl.pos.z).add(lead);
      const dir = to.sub(from).normalize();
      g.combat.spawn({
        owner: 'enemy', pos: from, vel: dir.multiplyScalar(22), radius: 0.25, dmg: T.dmg, color: new THREE.Color(0xff7050),
        size: 0.15, life: 2.2, shape: 'arrow', bright: 2, trailFx: { color: 0xff6040, width: 0.05, length: 10, intensity: 2.5 },
        trail: (p) => g.particles.emit(p.x, p.y, p.z, 0, 0, 0, new THREE.Color(0xff5030), 0.25, 0.2, { intensity: 1.5 }),
      });
      this.state = 'recover'; this.timer = 0.4;
    } else if (T.flying) {
      this.state = 'dive'; this.timer = 0.9; this.hitDone = false;
      this.target = new THREE.Vector3(pl.pos.x, 0, pl.pos.z);
    } else {
      const ang = Math.atan2(pl.pos.x - this.pos.x, pl.pos.z - this.pos.z);
      let diff = Math.abs(((ang - this.facing + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI);
      if (d < T.range + 0.5 && diff < 1.3) {
        if (pl.damage(T.dmg, this.pos.x, this.pos.z)) g.onPlayerHurt(T.dmg);
      }
      this.state = 'recover'; this.timer = 0.35;
      this.swingT = 0.3;
      if (this.type === 'alpha') {
        const p = new THREE.Vector3(this.pos.x + Math.sin(this.facing) * 2.5, this.pos.y + 0.3, this.pos.z + Math.cos(this.facing) * 2.5);
        g.particles.burst(p, 20, new THREE.Color(0xff6040), { speed: 5, size: 0.3, life: 0.4, intensity: 2 });
      }
    }
  }

  animate(dt) {
    const m = this.m, T = this.T;
    const moving = this.moving || this.state === 'dive' || this.state === 'leap';
    const runSpeed = T.speed > 4 ? 12 : 7;
    this.walk = (this.walk || 0) + (moving ? dt * runSpeed : 0);
    const sw = moving ? Math.sin(this.walk) : 0;
    this.swingT = Math.max(0, (this.swingT || 0) - dt);

    if (this.type === 'skeleton' || this.type === 'archer') {
      m.legs[0].rotation.x = sw * 0.6;
      m.legs[1].rotation.x = -sw * 0.6;
      m.arms[0].rotation.x = -sw * 0.4;
      m.head.rotation.z = Math.sin(this.phase * 2) * 0.08;
      if (this.state === 'windup') {
        if (this.type === 'archer') { m.arms[0].rotation.x = -1.5; m.arms[1].rotation.x = -1.4; m.arms[1].rotation.y = 0.4; }
        else m.arms[1].rotation.x = -2.6;
      } else if (this.swingT > 0) {
        m.arms[1].rotation.x = -0.2 + this.swingT * 2;
      } else {
        m.arms[1].rotation.x = sw * 0.4 - 0.3;
        m.arms[1].rotation.y = 0;
      }
      m.torso.rotation.x = this.state === 'windup' ? -0.15 : 0.08;
    } else if (this.type === 'wolf' || this.type === 'alpha') {
      m.legs[0].rotation.x = sw * 0.9;
      m.legs[1].rotation.x = -sw * 0.9;
      m.arms[0].rotation.x = -sw * 0.9 - 0.2;
      m.arms[1].rotation.x = sw * 0.9 - 0.2;
      m.tail.rotation.y = Math.sin(this.phase * 4) * 0.4;
      let lean = 0.55, jaw = 0.1;
      if (this.state === 'windup' || this.state === 'leapWind') { lean = 0.1; jaw = 0.6; m.arms[0].rotation.x = -2.2; m.arms[1].rotation.x = -2.2; }
      if (this.state === 'leap') { lean = 0.9; m.arms[0].rotation.x = -1.6; m.arms[1].rotation.x = -1.6; }
      if (this.swingT > 0) { m.arms[0].rotation.x = -0.4; m.arms[1].rotation.x = -1.0 + this.swingT; jaw = 0.4; }
      m.torso.rotation.x = angleLerp(m.torso.rotation.x, lean + (moving ? 0.2 : 0), 1 - Math.exp(-10 * dt));
      m.jaw.rotation.x = jaw;
      m.hips.position.y = 1.0 + Math.abs(sw) * 0.08;
    } else {
      const flap = this.state === 'dormant' ? 0 : Math.sin(this.phase * 12) * 0.6;
      m.wings[0].rotation.z = flap; m.wings[1].rotation.z = -flap;
      m.wings[0].rotation.y = -0.5 + (this.state === 'dive' ? 0.6 : 0);
      m.wings[1].rotation.y = 0.5 - (this.state === 'dive' ? 0.6 : 0);
      m.torso.rotation.x = this.state === 'dive' ? 1.0 : this.state === 'windup' ? -0.2 : 0.4;
      const legs = this.state === 'dormant' ? 0 : 0.8;
      m.legs[0].rotation.x = legs; m.legs[1].rotation.x = legs;
      if (this.state !== 'dormant') this.fly += Math.sin(this.phase * 3) * 0.004;
    }
  }

  animateDeath(dt) {
    const m = this.m;
    this.dieT += dt;
    const k = Math.min(1, this.dieT / 0.6);
    if (this.kind === 'undead') {
      if (this.dieT < 0.05) this.game.particles.burst(this.center(), 30, COL.bone, { speed: 4, size: 0.25, life: 0.8, gravity: 9 });
      if (this.dieT > 0.3) { this.alive = false; this.game.scene.remove(m.root); }
      return;
    } else if (this.kind === 'beast') {
      m.root.rotation.z = k * 1.5;
      m.root.position.y = this.pos.y + this.fly * (1 - k);
      // Le corps se consume en cendres et en braises.
      if (this.dieT > 0.8) {
        const c = this.center();
        const s = this.T.scale ?? 1;
        for (let i = 0; i < 3; i++) {
          this.game.smoke.emit(c.x + (Math.random() - 0.5) * s, c.y - 0.6 + Math.random() * 0.4, c.z + (Math.random() - 0.5) * s, (Math.random() - 0.5) * 0.6, 0.8 + Math.random(), (Math.random() - 0.5) * 0.6, new THREE.Color(0x1a1614), 0.5 * s, 1.4, { sizeEnd: 1.2 * s, drag: 0.5, alpha: 0.8 });
          if (Math.random() < 0.5) this.game.particles.emit(c.x + (Math.random() - 0.5) * s, c.y - 0.5, c.z + (Math.random() - 0.5) * s, (Math.random() - 0.5), 1.5 + Math.random(), (Math.random() - 0.5), new THREE.Color(0xff6a20), 0.12, 1.2, { intensity: 3 });
        }
      }
    } else {
      if (this.dieT > 0.3) { this.alive = false; this.game.scene.remove(m.root); }
      return;
      this.fly = Math.max(0, this.fly - dt * 6);
      m.root.position.y = this.pos.y + this.fly;
      if (this.dieT < 0.6 && Math.random() < 0.6) this.game.smoke.burst(this.center(), 3, new THREE.Color(0x6b6a66), { speed: 4, size: 0.4, life: 0.8, gravity: 9, alpha: 0.9 });
      m.root.scale.setScalar(Math.max(0.01, 1 - Math.max(0, this.dieT - 0.4) * 1.5));
    }
    if (this.dieT > 0.9) m.root.position.y -= (this.dieT - 0.9) * 1.5;
    if (this.dieT > 1.8) {
      this.alive = false;
      this.game.scene.remove(m.root);
    }
  }

  remove() {
    this.eyeTrail?.detach();
    this.alive = false;
    this.game.scene.remove(this.m.root);
  }
}

export class EnemyManager {
  constructor(game) {
    this.game = game;
    this.list = [];
  }

  spawn(type, x, z, opts) {
    const e = new Enemy(this.game, type, x, z, opts);
    this.list.push(e);
    return e;
  }

  targets() {
    return this.list.filter((e) => e.alive && e.state !== 'dying' && e.state !== 'rise' && e.state !== 'waking');
  }

  update(dt) {
    const pl = this.game.player.pos;
    for (const e of this.list) {
      if (!e.alive) continue;
      const far = Math.hypot(e.pos.x - pl.x, e.pos.z - pl.z) > 70;
      e.m.root.visible = !far || e.state === 'rise';
      if (far && e.state !== 'dying') continue;
      e.update(dt);
    }
    // Séparation
    const act = this.list.filter((e) => e.alive && e.state !== 'dying' && e.state !== 'dormant');
    for (let i = 0; i < act.length; i++) {
      for (let j = i + 1; j < act.length; j++) {
        const a = act[i], b = act[j];
        const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z;
        const r = a.radius + b.radius;
        const d2 = dx * dx + dz * dz;
        if (d2 < r * r && d2 > 0.0001) {
          const d = Math.sqrt(d2), push = (r - d) * 0.5;
          const col = this.game.world.col;
          col.move(a.pos, (-dx / d) * push, (-dz / d) * push, a.radius);
          col.move(b.pos, (dx / d) * push, (dz / d) * push, b.radius);
        }
      }
    }
    // Les ennemis ne traversent pas le joueur.
    const p = this.game.player;
    if (!p.hidden) {
      for (const e of act) {
        const dx = p.pos.x - e.pos.x, dz = p.pos.z - e.pos.z;
        const r = e.radius + p.radius, d = Math.hypot(dx, dz);
        if (d < r && d > 0.001 && e.fly < 1) this.game.world.col.move(e.pos, (-dx / d) * (r - d), (-dz / d) * (r - d), e.radius);
      }
    }
    this.list = this.list.filter((e) => e.alive);
  }

  aliveCount(filter) {
    return this.list.filter((e) => e.alive && e.state !== 'dying' && (!filter || filter(e))).length;
  }
}

export { TYPES, clamp };
