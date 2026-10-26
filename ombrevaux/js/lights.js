import * as THREE from 'three';

// Nombre fixe de lumières ponctuelles (évite les recompilations de shaders) :
// les plus proches du joueur parmi les lumières statiques, plus quelques
// lumières dynamiques pour les sorts et explosions.
export class LightManager {
  constructor(scene, staticCount = 6, dynamicCount = 5) {
    this.static = [];
    this.dynamic = [];
    for (let i = 0; i < staticCount; i++) {
      const l = new THREE.PointLight(0xffffff, 0, 10, 2);
      scene.add(l);
      this.static.push(l);
    }
    for (let i = 0; i < dynamicCount; i++) {
      const l = new THREE.PointLight(0xffffff, 0, 10, 2);
      scene.add(l);
      this.dynamic.push(l);
    }
    this.requests = [];
    this.flashes = [];
    this.timer = 0;
    this.chosen = [];
  }

  request(pos, color, intensity, distance = 10) {
    this.requests.push({ pos, color, intensity, distance });
  }

  flash(pos, color, intensity, distance, dur) {
    this.flashes.push({ pos: pos.clone(), color: new THREE.Color(color), intensity, distance, t: 0, dur });
  }

  update(dt, t, center, spots) {
    // Sélection des lumières statiques (rafraîchie régulièrement).
    this.timer -= dt;
    if (this.timer <= 0) {
      this.timer = 0.2;
      this.chosen = spots
        .filter((s) => s.intensity > 0)
        .map((s) => ({ s, d: s.pos.distanceToSquared(center) }))
        .sort((a, b) => a.d - b.d)
        .slice(0, this.static.length)
        .map((e) => e.s);
    }
    this.static.forEach((l, i) => {
      const s = this.chosen[i];
      if (!s) { l.intensity = 0; return; }
      l.position.copy(s.pos);
      l.color.copy(s.color);
      l.distance = s.distance;
      const fl = s.flicker ? 1 + (Math.sin(t * 11 + i * 3.1) * 0.5 + Math.sin(t * 23.7 + i) * 0.5) * 0.18 * s.flicker : 1;
      // Fondu doux à la limite de portée pour éviter les sauts visibles.
      const d = Math.sqrt(s.pos.distanceToSquared(center));
      const fade = Math.min(1, Math.max(0, (40 - d) / 12));
      l.intensity = s.intensity * fl * fade;
    });

    for (const f of this.flashes) {
      f.t += dt;
      const k = 1 - f.t / f.dur;
      if (k > 0) this.requests.push({ pos: f.pos, color: f.color, intensity: f.intensity * k * k, distance: f.distance });
    }
    this.flashes = this.flashes.filter((f) => f.t < f.dur);
    this.requests.sort((a, b) => b.intensity - a.intensity);
    this.dynamic.forEach((l, i) => {
      const r = this.requests[i];
      if (!r) { l.intensity = 0; return; }
      l.position.copy(r.pos);
      l.color.set(r.color);
      l.intensity = r.intensity;
      l.distance = r.distance;
    });
    this.requests.length = 0;
  }
}
