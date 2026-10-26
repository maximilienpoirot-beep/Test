import * as THREE from 'three';
import { makeHunter, compactModel, addRim } from './models.js';
import { damp, angleLerp, clamp } from './utils.js';

export const SPELLS = {
  arcane: {
    key: 'arcane', name: 'Trait arcanique', slot: 1, mana: 4, cd: 0.3, color: 0xa070ff,
    desc: 'Un éclat de force pure tiré du grimoire. Faible, rapide, presque gratuit. Les pierres y résistent.',
  },
  holy: {
    key: 'holy', name: 'Lumière sacrée', slot: 2, mana: 26, cd: 1.1, color: 0xffd27a,
    desc: 'Un orbe de lumière qui explose en brûlant tout autour de lui. Dévastateur contre les morts-vivants, qu\'il étourdit. Dissipe les voiles d\'ombre.',
  },
  lightning: {
    key: 'lightning', name: 'Chaîne de foudre', slot: 3, mana: 20, cd: 0.85, color: 0x7ac8ff,
    desc: 'La foudre frappe la cible visée puis rebondit sur quatre ennemis proches. Brise la pierre. Peut charger les mécanismes de cuivre.',
  },
  shadow: {
    key: 'shadow', name: 'Pas de l\'ombre', slot: 4, mana: 16, cd: 0.7, color: 0x6a3cff,
    desc: 'Vous vous dissolvez dans l\'ombre et réapparaissez quelques mètres plus loin, invulnérable pendant le trajet. Traverse les grilles et les herses. [Espace]',
  },
};

export class Player {
  constructor(scene) {
    this.model = makeHunter();
    compactModel(this.model.root);
    addRim(this.model.root, 0x7a9ad8, 0.5, 2.6);
    this.aimPitch = 0;
    this.prevFacing = 0;
    this.turn = 0;
    scene.add(this.model.root);
    this.pos = new THREE.Vector3();
    this.radius = 0.45;
    this.facing = 0;
    this.vel = new THREE.Vector2();
    this.maxHp = 100; this.hp = 100;
    this.maxMana = 100; this.mana = 100;
    this.unlocked = { arcane: true, holy: false, lightning: false, shadow: false };
    this.selected = 'arcane';
    this.cooldowns = { arcane: 0, holy: 0, lightning: 0, shadow: 0 };
    this.castAnim = 0;
    this.aimTimer = 0;
    this.invuln = 0;
    this.dash = null;
    this.walkPhase = 0;
    this.speedNow = 0;
    this.knock = new THREE.Vector2();
    this.dead = false;
    this.hidden = false;
    this.relics = { fiole: 0, encre: 0 };
    this.handPos = new THREE.Vector3();
  }

  place(p) {
    this.pos.copy(p);
    this.dash = null;
    this.knock.set(0, 0);
  }

  // Direction de déplacement à partir des touches et du lacet caméra.
  update(dt, input, camYaw, world) {
    for (const k in this.cooldowns) this.cooldowns[k] = Math.max(0, this.cooldowns[k] - dt);
    this.invuln = Math.max(0, this.invuln - dt);
    this.mana = Math.min(this.maxMana, this.mana + dt * 7);
    this.castAnim = Math.max(0, this.castAnim - dt * 3.2);
    this.aimTimer = Math.max(0, this.aimTimer - dt);

    let moving = false;
    if (this.dash) {
      const d = this.dash;
      d.t += dt;
      const k = Math.min(1, d.t / d.dur);
      this.pos.x = d.from.x + (d.to.x - d.from.x) * k;
      this.pos.z = d.from.z + (d.to.z - d.from.z) * k;
      if (k >= 1) { this.dash = null; this.hidden = false; }
    } else if (!this.dead) {
      let ix = 0, iz = 0;
      if (input.keys.has('KeyW') || input.keys.has('ArrowUp')) iz -= 1;
      if (input.keys.has('KeyS') || input.keys.has('ArrowDown')) iz += 1;
      if (input.keys.has('KeyA') || input.keys.has('ArrowLeft')) ix -= 1;
      if (input.keys.has('KeyD') || input.keys.has('ArrowRight')) ix += 1;
      const len = Math.hypot(ix, iz);
      const sprint = input.keys.has('ShiftLeft') || input.keys.has('ShiftRight');
      const speed = sprint ? 8.5 : 5.2;
      let tx = 0, tz = 0;
      if (len > 0) {
        ix /= len; iz /= len;
        // avant = (-sin yaw, -cos yaw), droite = (cos yaw, -sin yaw)
        const fx = -Math.sin(camYaw), fz = -Math.cos(camYaw);
        const rx = Math.cos(camYaw), rz = -Math.sin(camYaw);
        tx = (fx * -iz + rx * ix) * speed;
        tz = (fz * -iz + rz * ix) * speed;
        moving = true;
      }
      this.vel.x = damp(this.vel.x, tx, 12, dt);
      this.vel.y = damp(this.vel.y, tz, 12, dt);
      this.knock.multiplyScalar(Math.exp(-6 * dt));
      world.col.move(this.pos, (this.vel.x + this.knock.x) * dt, (this.vel.y + this.knock.y) * dt, this.radius);
      if (moving && this.aimTimer <= 0) {
        this.facing = angleLerp(this.facing, Math.atan2(this.vel.x, this.vel.y), 1 - Math.exp(-12 * dt));
      }
    }
    if (this.aimTimer > 0) this.facing = angleLerp(this.facing, Math.atan2(-Math.sin(camYaw), -Math.cos(camYaw)), 1 - Math.exp(-20 * dt));
    this.pos.y = world.getHeight(this.pos.x, this.pos.z);
    this.speedNow = Math.hypot(this.vel.x, this.vel.y);
    this.animate(dt);
  }

  startDash(world, dirX, dirZ, dist = 9) {
    const len = Math.hypot(dirX, dirZ) || 1;
    dirX /= len; dirZ /= len;
    const ignore = ['grate'];
    // On avance jusqu'au premier obstacle non franchissable.
    let best = 0;
    for (let s = 0.25; s <= dist; s += 0.25) {
      const x = this.pos.x + dirX * s, z = this.pos.z + dirZ * s;
      if (world.col.blocked(x, z, this.radius, ignore)) break;
      if (!world.col.blocked(x, z, this.radius)) best = s;
    }
    if (best < 0.5) return false;
    this.dash = {
      from: this.pos.clone(),
      to: new THREE.Vector3(this.pos.x + dirX * best, 0, this.pos.z + dirZ * best),
      t: 0, dur: 0.16 + best * 0.012,
    };
    this.invuln = Math.max(this.invuln, this.dash.dur + 0.2);
    this.hidden = true;
    this.facing = Math.atan2(dirX, dirZ);
    return true;
  }

  damage(n, fromX, fromZ) {
    if (this.invuln > 0 || this.dead) return false;
    this.hp = Math.max(0, this.hp - n);
    this.invuln = 0.35;
    if (fromX !== undefined) {
      const dx = this.pos.x - fromX, dz = this.pos.z - fromZ, l = Math.hypot(dx, dz) || 1;
      this.knock.set((dx / l) * 7, (dz / l) * 7);
    }
    if (this.hp <= 0) this.dead = true;
    return true;
  }

  animate(dt) {
    const m = this.model;
    m.root.position.copy(this.pos);
    m.root.rotation.y = this.facing;
    m.root.visible = !this.hidden;
    const sp = clamp(this.speedNow / 5.2, 0, 1.7);
    this.walkPhase += dt * (4 + sp * 5) * (sp > 0.05 ? 1 : 0);
    const sw = Math.sin(this.walkPhase) * 0.75 * Math.min(sp, 1.2);
    m.legs[0].rotation.x = sw;
    m.legs[1].rotation.x = -sw;
    m.arms[0].rotation.x = -sw * 0.6;
    const cast = this.castAnim;
    m.arms[1].rotation.x = cast > 0 ? -1.5 * Math.min(1, cast * 2) : sw * 0.6;
    m.arms[1].rotation.z = cast > 0 ? -0.1 : 0;
    const t = performance.now() / 1000;
    const aiming = Math.min(1, this.aimTimer * 3);
    m.torso.rotation.x = sp * 0.12;
    m.torso.rotation.y = cast > 0 ? -0.25 * Math.min(1, cast * 2) : 0;
    // Respiration au repos
    m.torso.scale.y = 1 + Math.sin(t * 2.1) * 0.012 * (1 - Math.min(1, sp));
    m.head.rotation.x = -this.aimPitch * 0.5 * aiming;
    m.hips.position.y = 0.95 + Math.abs(Math.cos(this.walkPhase)) * 0.05 * sp;
    // Main gauche qui présente le grimoire pendant l'incantation
    if (aiming > 0) { m.arms[0].rotation.x = -0.9 * aiming - sw * 0.2; m.arms[0].rotation.z = 0.25 * aiming; } else m.arms[0].rotation.z = 0;
    // Cape et pans du manteau : ondulation qui suit la vitesse et les virages
    let df = this.facing - this.prevFacing;
    df = ((df + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
    this.prevFacing = this.facing;
    this.turn += ((dt > 0 ? df / dt : 0) - this.turn) * Math.min(1, dt * 6);
    m.capeSegs.forEach((seg, i) => {
      const base = i === 0 ? 0.12 + sp * 0.32 : 0.06 + sp * 0.18;
      seg.rotation.x = base + Math.sin(t * 2.3 - i * 0.9) * (0.04 + sp * 0.05) + Math.sin(this.walkPhase - i) * 0.04 * sp;
      seg.rotation.z = -this.turn * 0.04 * (i + 1);
    });
    m.tails.forEach((tl, i) => { tl.rotation.x = 0.08 + sp * 0.35 + Math.sin(this.walkPhase + i * Math.PI) * 0.15 * Math.min(sp, 1); });
    // Grimoire : orbite au repos, devant la main gauche pendant l'incantation
    const bx = -0.55 + aiming * 0.2, by = 1.25 + Math.sin(t * 2.2) * 0.07 * (1 - aiming), bz = 0.25 + aiming * 0.25;
    m.book.position.set(bx, by, bz);
    m.book.rotation.set(-0.6 + Math.sin(t * 1.3) * 0.1 - aiming * 0.5, 0.4 - aiming * 0.4, 0.15);
    this.model.pagesMat.emissiveIntensity = 0.55 + cast * 1.5;
    // Main droite (point de départ des sorts) en coordonnées monde
    m.arms[1].userData.hand.getWorldPosition(this.handPos);
  }

  setSpellColor(color) {
    this.model.pagesMat.emissive.setHex(color);
  }
}

// ---------------------------------------------------------------- Caméra 3e personne
export class ThirdPersonCamera {
  constructor(camera) {
    this.camera = camera;
    this.yaw = 0;
    this.pitch = 0.22;
    this.dist = 5.2;
    this.wantDist = 5.2;
    this.curDist = 5.2;
    this.shoulder = 0.75;
    this.pivot = new THREE.Vector3();
    this.look = new THREE.Vector3();
    this.shake = 0;
  }

  dir(out = new THREE.Vector3()) {
    const cp = Math.cos(this.pitch);
    return out.set(-Math.sin(this.yaw) * cp, -Math.sin(this.pitch), -Math.cos(this.yaw) * cp);
  }

  update(dt, input, player, world) {
    const sens = 0.0024;
    this.yaw -= input.mouseDX * sens;
    this.pitch = clamp(this.pitch + input.mouseDY * sens, -0.55, 1.05);
    const target = player.pos;
    this.pivot.x = damp(this.pivot.x, target.x, 18, dt);
    this.pivot.z = damp(this.pivot.z, target.z, 18, dt);
    this.pivot.y = damp(this.pivot.y, target.y + 1.65, 10, dt);
    if (player.dash) this.pivot.set(target.x, target.y + 1.65, target.z);

    const L = this.dir(this.look);
    const rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);
    const base = new THREE.Vector3(this.pivot.x + rx * this.shoulder, this.pivot.y, this.pivot.z + rz * this.shoulder);
    // Raccourcissement si un mur est derrière.
    let free = this.wantDist;
    for (let d = 0.4; d <= this.wantDist; d += 0.25) {
      const x = base.x - L.x * d, y = base.y - L.y * d, z = base.z - L.z * d;
      if (world.col.solidAt(x, y, z, 0.25, true) || y < world.getHeight(x, z) + 0.25) { free = Math.max(0.6, d - 0.35); break; }
    }
    this.curDist = free < this.curDist ? free : damp(this.curDist, free, 4, dt);
    const cam = this.camera;
    cam.position.set(base.x - L.x * this.curDist, base.y - L.y * this.curDist, base.z - L.z * this.curDist);
    const gy = world.getHeight(cam.position.x, cam.position.z) + 0.3;
    if (cam.position.y < gy) cam.position.y = gy;
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt * 2.5);
      const s = this.shake * this.shake * 0.35;
      cam.position.x += (Math.random() - 0.5) * s;
      cam.position.y += (Math.random() - 0.5) * s;
      cam.position.z += (Math.random() - 0.5) * s;
    }
    cam.lookAt(cam.position.x + L.x, cam.position.y + L.y, cam.position.z + L.z);
  }
}
