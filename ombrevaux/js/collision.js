// Collisions 2D (plan XZ) : zones praticables, cercles et boîtes alignées.
// Chaque obstacle a une hauteur `h` pour les projectiles et la caméra.

export class CollisionWorld {
  constructor() {
    this.areas = [];
    this.circles = [];
    this.boxes = [];
  }

  addArea(minX, minZ, maxX, maxZ, name = '') {
    const a = { minX, minZ, maxX, maxZ, name };
    this.areas.push(a);
    return a;
  }

  addCircle(x, z, r, opts = {}) {
    const c = { x, z, r, h: opts.h ?? 4, tag: opts.tag || '', enabled: true, cam: opts.cam ?? false };
    this.circles.push(c);
    return c;
  }

  addBox(minX, minZ, maxX, maxZ, opts = {}) {
    const b = { minX, minZ, maxX, maxZ, h: opts.h ?? 4, tag: opts.tag || '', enabled: true, cam: opts.cam ?? true };
    this.boxes.push(b);
    return b;
  }

  // Boîte centrée, avec rotation de 0 ou 90°.
  addBoxCentered(x, z, w, d, rotated, opts) {
    const hw = (rotated ? d : w) / 2, hd = (rotated ? w : d) / 2;
    return this.addBox(x - hw, z - hd, x + hw, z + hd, opts);
  }

  inAreas(x, z, r = 0) {
    for (const a of this.areas) {
      if (x >= a.minX + r && x <= a.maxX - r && z >= a.minZ + r && z <= a.maxZ - r) return true;
    }
    return false;
  }

  // Distance signée hors des zones (0 à l'intérieur).
  outsideDistance(x, z) {
    let best = Infinity;
    for (const a of this.areas) {
      const dx = Math.max(a.minX - x, 0, x - a.maxX);
      const dz = Math.max(a.minZ - z, 0, z - a.maxZ);
      const d = Math.hypot(dx, dz);
      if (d < best) best = d;
      if (best === 0) return 0;
    }
    return best;
  }

  hitsObstacle(x, z, r, y = 0, ignore = null) {
    for (const c of this.circles) {
      if (!c.enabled || (y > 0 && y >= c.h)) continue;
      if (ignore && ignore.includes(c.tag)) continue;
      const dx = x - c.x, dz = z - c.z, rr = r + c.r;
      if (dx * dx + dz * dz < rr * rr) return c;
    }
    for (const b of this.boxes) {
      if (!b.enabled || (y > 0 && y >= b.h)) continue;
      if (ignore && ignore.includes(b.tag)) continue;
      const cx = Math.max(b.minX, Math.min(x, b.maxX));
      const cz = Math.max(b.minZ, Math.min(z, b.maxZ));
      const dx = x - cx, dz = z - cz;
      if (dx * dx + dz * dz < r * r) return b;
    }
    return null;
  }

  blocked(x, z, r, ignore = null, y = 0) {
    if (!this.inAreas(x, z, r)) return true;
    return !!this.hitsObstacle(x, z, r, y, ignore);
  }

  // Déplace pos (objet {x,z}) en glissant le long des obstacles.
  // `y` : hauteur de l'entité (les créatures volantes passent au-dessus des obstacles bas).
  move(pos, dx, dz, r, ignore = null, y = 0) {
    const dist = Math.hypot(dx, dz);
    const steps = Math.max(1, Math.ceil(dist / (r * 0.8)));
    const sx = dx / steps, sz = dz / steps;
    let moved = false;
    for (let i = 0; i < steps; i++) {
      if (!this.blocked(pos.x + sx, pos.z + sz, r, ignore, y)) {
        pos.x += sx; pos.z += sz; moved = true;
      } else if (sx !== 0 && !this.blocked(pos.x + sx, pos.z, r, ignore, y)) {
        pos.x += sx; moved = true;
      } else if (sz !== 0 && !this.blocked(pos.x, pos.z + sz, r, ignore, y)) {
        pos.z += sz; moved = true;
      } else {
        break;
      }
    }
    return moved;
  }

  // Si une entité se retrouve coincée (porte qui se ferme…), on la pousse dehors.
  unstick(pos, r) {
    if (!this.blocked(pos.x, pos.z, r)) return;
    for (let rad = 0.5; rad < 12; rad += 0.5) {
      for (let a = 0; a < Math.PI * 2; a += Math.PI / 8) {
        const x = pos.x + Math.cos(a) * rad, z = pos.z + Math.sin(a) * rad;
        if (!this.blocked(x, z, r)) { pos.x = x; pos.z = z; return; }
      }
    }
  }

  // Obstacle solide pour un point 3D (projectiles, caméra).
  solidAt(x, y, z, r = 0.1, camOnly = false) {
    for (const c of this.circles) {
      if (!c.enabled || y > c.h || (camOnly && !c.cam)) continue;
      const dx = x - c.x, dz = z - c.z, rr = r + c.r;
      if (dx * dx + dz * dz < rr * rr) return c;
    }
    for (const b of this.boxes) {
      if (!b.enabled || y > b.h || (camOnly && !b.cam)) continue;
      if (x > b.minX - r && x < b.maxX + r && z > b.minZ - r && z < b.maxZ + r) return b;
    }
    return null;
  }
}
