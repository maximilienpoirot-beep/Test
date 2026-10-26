import * as THREE from 'three';
import { mulberry32 } from './utils.js';

// Cercles magiques runiques : trois couches (anneau de runes, géométrie sacrée,
// sceau central) dessinées en blanc puis teintées et animées séparément.

const TAU = Math.PI * 2;

// Rune pseudo-futhark : un fût vertical et quelques branches sur une grille 3x4.
function drawRune(ctx, rnd, w, h) {
  const px = (i) => (i / 2) * w - w / 2;
  const py = (j) => (j / 3) * h - h / 2;
  ctx.beginPath();
  const stem = rnd() < 0.7 ? 1 : (rnd() < 0.5 ? 0 : 2);
  ctx.moveTo(px(stem), py(0));
  ctx.lineTo(px(stem), py(3));
  const n = 1 + Math.floor(rnd() * 3);
  for (let k = 0; k < n; k++) {
    const j0 = Math.floor(rnd() * 4);
    const i1 = Math.floor(rnd() * 3), j1 = Math.max(0, Math.min(3, j0 + Math.floor(rnd() * 3) - 1));
    ctx.moveTo(px(stem), py(j0));
    ctx.lineTo(px(i1 === stem ? (stem + 1) % 3 : i1), py(j1));
  }
  if (rnd() < 0.25) { ctx.moveTo(px(0), py(1.5)); ctx.lineTo(px(2), py(1.5)); }
  ctx.stroke();
}

// Texte runique le long d'un arc.
function runeArc(ctx, rnd, cx, cy, r, a0, a1, size) {
  const len = (a1 - a0) * r;
  const count = Math.max(1, Math.floor(len / (size * 0.95)));
  for (let i = 0; i < count; i++) {
    const a = a0 + ((i + 0.5) / count) * (a1 - a0);
    ctx.save();
    ctx.translate(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    ctx.rotate(a + Math.PI / 2);
    drawRune(ctx, rnd, size * 0.42, size * 0.75);
    ctx.restore();
  }
}

function circle(ctx, cx, cy, r) { ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.stroke(); }

function polygon(ctx, cx, cy, r, n, rot) {
  ctx.beginPath();
  for (let i = 0; i <= n; i++) {
    const a = rot + (i / n) * TAU;
    const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
    i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
  }
  ctx.stroke();
}

export function drawSymbol(ctx, kind, cx, cy, r) {
  ctx.beginPath();
  if (kind === 'sun' || kind === 'holy') {
    circle(ctx, cx, cy, r * 0.42);
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * TAU, a2 = a + TAU / 24;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a - 0.12) * r * 0.55, cy + Math.sin(a - 0.12) * r * 0.55);
      ctx.lineTo(cx + Math.cos(a) * r * (i % 2 ? 0.8 : 0.98), cy + Math.sin(a) * r * (i % 2 ? 0.8 : 0.98));
      ctx.lineTo(cx + Math.cos(a + 0.12) * r * 0.55, cy + Math.sin(a + 0.12) * r * 0.55);
      ctx.stroke();
      void a2;
    }
  } else if (kind === 'moon' || kind === 'shadow') {
    // Croissant : grand cercle moins un cercle décalé vers la droite.
    const R1 = r * 0.8, R2 = r * 0.7, d = r * 0.35;
    const x = (d * d + R1 * R1 - R2 * R2) / (2 * d);
    const a1 = Math.acos(x / R1), y = Math.sqrt(R1 * R1 - x * x), b1 = Math.atan2(y, x - d);
    ctx.beginPath();
    ctx.arc(cx, cy, R1, a1, TAU - a1, false);
    ctx.arc(cx + d, cy, R2, -b1, b1, true);
    ctx.closePath();
    ctx.stroke();
  } else if (kind === 'star' || kind === 'arcane') {
    const n = 8;
    ctx.beginPath();
    for (let i = 0; i <= n * 2; i++) {
      const a = (i / (n * 2)) * TAU - Math.PI / 2;
      const rr = i % 2 ? r * 0.38 : r * 0.92;
      const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr;
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.stroke();
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU - Math.PI / 2;
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(a) * r * 0.92, cy + Math.sin(a) * r * 0.92); ctx.stroke();
    }
  } else if (kind === 'lightning') {
    ctx.beginPath();
    const pts = [[0.15, -0.95], [-0.35, 0.05], [0.05, 0.05], [-0.2, 0.95], [0.4, -0.15], [0.0, -0.15], [0.3, -0.95]];
    pts.forEach(([x, y], i) => (i ? ctx.lineTo(cx + x * r, cy + y * r) : ctx.moveTo(cx + x * r, cy + y * r)));
    ctx.closePath();
    ctx.stroke();
    circle(ctx, cx, cy, r);
  } else if (kind === 'eye') {
    ctx.beginPath();
    ctx.moveTo(cx - r, cy);
    ctx.quadraticCurveTo(cx, cy - r * 0.9, cx + r, cy);
    ctx.quadraticCurveTo(cx, cy + r * 0.9, cx - r, cy);
    ctx.stroke();
    circle(ctx, cx, cy, r * 0.32);
    circle(ctx, cx, cy, r * 0.1);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU;
      ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * r * 1.1, cy + Math.sin(a) * r * 1.1); ctx.lineTo(cx + Math.cos(a) * r * 1.35, cy + Math.sin(a) * r * 1.35); ctx.stroke();
    }
  } else if (kind === 'flame') {
    ctx.beginPath();
    ctx.moveTo(cx, cy - r);
    ctx.bezierCurveTo(cx + r * 0.7, cy - r * 0.2, cx + r * 0.6, cy + r * 0.8, cx, cy + r * 0.85);
    ctx.bezierCurveTo(cx - r * 0.6, cy + r * 0.8, cx - r * 0.7, cy - r * 0.2, cx, cy - r);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx, cy - r * 0.2);
    ctx.bezierCurveTo(cx + r * 0.3, cy + r * 0.2, cx + r * 0.25, cy + r * 0.6, cx, cy + r * 0.6);
    ctx.bezierCurveTo(cx - r * 0.25, cy + r * 0.6, cx - r * 0.3, cy + r * 0.2, cx, cy - r * 0.2);
    ctx.stroke();
  }
}

// Trace chaque forme deux fois : un halo large et doux, puis le trait net.
function glowStroke(ctx, width, draw) {
  ctx.save();
  ctx.lineWidth = width * 4;
  ctx.globalAlpha = 0.18;
  draw();
  ctx.lineWidth = width;
  ctx.globalAlpha = 1;
  draw();
  ctx.restore();
}

function makeCanvas(size) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  ctx.strokeStyle = '#fff';
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  return [c, ctx];
}

export function outerLayerCanvas(size = 1024, seed = 3) {
  const [c, ctx] = makeCanvas(size);
  const k = size / 1040, cx = size / 2;
  const rnd = mulberry32(seed);
  glowStroke(ctx, 5 * k, () => { circle(ctx, cx, cx, 510 * k); circle(ctx, cx, cx, 445 * k); });
  glowStroke(ctx, 2.5 * k, () => {
    circle(ctx, cx, cx, 500 * k);
    runeArc(ctx, rnd, cx, cx, 474 * k, 0, TAU, 40 * k);
    circle(ctx, cx, cx, 430 * k);
    circle(ctx, cx, cx, 398 * k);
    // Bande de graduations
    for (let i = 0; i < 120; i++) {
      const a = (i / 120) * TAU;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * 404 * k, cx + Math.sin(a) * 404 * k);
      ctx.lineTo(cx + Math.cos(a) * 424 * k, cx + Math.sin(a) * 424 * k);
      ctx.stroke();
    }
  });
  return c;
}

export function midLayerCanvas(size = 1024, seed = 7) {
  const [c, ctx] = makeCanvas(size);
  const k = size / 1040, cx = size / 2;
  const rnd = mulberry32(seed);
  const R = 360 * k, mr = 82 * k;
  const meds = [[-2.35, 'sun'], [0, 'moon'], [2.1, 'star']];
  glowStroke(ctx, 4 * k, () => {
    // Arcs du cercle intérieur, interrompus par les médaillons
    for (let i = 0; i < 3; i++) {
      const a0 = meds[i][0] + 0.26, a1 = (i < 2 ? meds[i + 1][0] : meds[0][0] + TAU) - 0.26;
      ctx.beginPath(); ctx.arc(cx, cx, R, a0, a1); ctx.stroke();
    }
    for (const [a] of meds) circle(ctx, cx + Math.cos(a) * R, cx + Math.sin(a) * R, mr);
  });
  glowStroke(ctx, 2.5 * k, () => {
    for (let i = 0; i < 3; i++) {
      const a0 = meds[i][0] + 0.36, a1 = (i < 2 ? meds[i + 1][0] : meds[0][0] + TAU) - 0.36;
      runeArc(ctx, rnd, cx, cx, 300 * k, a0, a1, 44 * k);
      ctx.beginPath(); ctx.arc(cx, cx, 330 * k, a0, a1); ctx.stroke();
    }
    for (const [a, sym] of meds) drawSymbol(ctx, sym, cx + Math.cos(a) * R, cx + Math.sin(a) * R, mr * 0.75);
    // Triangle reliant les médaillons + triangle inversé (hexagramme)
    ctx.beginPath();
    meds.forEach(([a], i) => { const x = cx + Math.cos(a) * (R - mr), y = cx + Math.sin(a) * (R - mr); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
    ctx.closePath(); ctx.stroke();
    ctx.beginPath();
    meds.forEach(([a], i) => { const aa = a + Math.PI; const x = cx + Math.cos(aa) * 250 * k, y = cx + Math.sin(aa) * 250 * k; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
    ctx.closePath(); ctx.stroke();
    circle(ctx, cx, cx, 250 * k);
  });
  return c;
}

export function centerLayerCanvas(symbol, size = 512, seed = 11) {
  const [c, ctx] = makeCanvas(size);
  const k = size / 520, cx = size / 2;
  const rnd = mulberry32(seed);
  glowStroke(ctx, 3 * k, () => {
    polygon(ctx, cx, cx, 235 * k, 4, Math.PI / 4 + 0.12);
    polygon(ctx, cx, cx, 200 * k, 4, Math.PI / 4 + 0.12);
  });
  glowStroke(ctx, 2 * k, () => {
    // Runes dans le cadre carré
    for (let s = 0; s < 4; s++) {
      ctx.save();
      ctx.translate(cx, cx);
      ctx.rotate(0.12 + s * Math.PI / 2);
      for (let i = 0; i < 7; i++) {
        ctx.save();
        ctx.translate(-120 * k + i * 40 * k, -152 * k);
        drawRune(ctx, rnd, 12 * k, 20 * k);
        ctx.restore();
      }
      ctx.restore();
    }
    // Croix en X
    for (const a of [Math.PI / 4, -Math.PI / 4]) {
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * 190 * k, cx + Math.sin(a) * 190 * k);
      ctx.lineTo(cx - Math.cos(a) * 190 * k, cx - Math.sin(a) * 190 * k);
      ctx.stroke();
    }
    circle(ctx, cx, cx, 120 * k);
  });
  ctx.fillStyle = '#000';
  ctx.beginPath(); ctx.arc(cx, cx, 116 * k, 0, TAU); ctx.globalCompositeOperation = 'destination-out'; ctx.fill();
  ctx.globalCompositeOperation = 'source-over';
  glowStroke(ctx, 4 * k, () => drawSymbol(ctx, symbol, cx, cx, 95 * k));
  return c;
}

function tex(canvas) {
  const t = new THREE.CanvasTexture(canvas);
  t.anisotropy = 8;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

const easeOutBack = (t) => 1 + 2.4 * Math.pow(t - 1, 3) + 1.4 * Math.pow(t - 1, 2);

export class CircleFX {
  constructor(scene, world) {
    this.scene = scene;
    this.world = world;
    this.outer = tex(outerLayerCanvas());
    this.mid = tex(midLayerCanvas());
    this.centers = {};
    this.list = [];
    this.geo = new THREE.PlaneGeometry(2, 2);
  }

  centerTex(symbol) {
    return this.centers[symbol] || (this.centers[symbol] = tex(centerLayerCanvas(symbol)));
  }

  // o : { pos, radius, color, symbol, life, vertical, normal, spin, intensity, follow, yOffset, layers }
  spawn(o) {
    const group = new THREE.Group();
    const color = new THREE.Color(o.color).multiplyScalar(o.intensity ?? 2.2);
    const layers = [];
    const defs = [[this.outer, 1, 0.25], [this.mid, 0.78, -0.4], [this.centerTex(o.symbol || 'star'), 0.5, 0.7]];
    for (const [map, scale, spin] of defs.slice(0, o.layers ?? 3)) {
      const m = new THREE.MeshBasicMaterial({
        map, color, transparent: true, opacity: 0, blending: THREE.AdditiveBlending,
        depthWrite: false, side: THREE.DoubleSide, fog: false,
        polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
      });
      const mesh = new THREE.Mesh(this.geo, m);
      mesh.scale.setScalar(scale);
      mesh.renderOrder = 6;
      group.add(mesh);
      layers.push({ mesh, spin });
    }
    const c = {
      group, layers, t: 0, life: o.life ?? 1, radius: o.radius ?? 1, spin: o.spin ?? 1,
      open: o.open ?? 0.28, vertical: !!o.vertical, follow: o.follow, yOffset: o.yOffset ?? 0,
      pos: (o.pos || new THREE.Vector3()).clone(), normal: o.normal ? o.normal.clone() : null, dead: false,
      alpha: o.alpha ?? 1, pulse: o.pulse ?? 0, closing: false, closeT: 0,
    };
    if (!c.vertical) group.rotation.x = -Math.PI / 2;
    this.place(c);
    this.scene.add(group);
    this.list.push(c);
    c.kill = () => { if (!c.closing) { c.closing = true; c.closeT = 0; } };
    c.setColor = (hex, k = o.intensity ?? 2.2) => { for (const l of layers) l.mesh.material.color.set(hex).multiplyScalar(k); };
    return c;
  }

  // Hauteur la plus haute du terrain sous le cercle, pour qu'il ne s'enfonce pas.
  groundY(x, z, r) {
    let y = this.world.getHeight(x, z);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU;
      y = Math.max(y, this.world.getHeight(x + Math.cos(a) * r * 0.8, z + Math.sin(a) * r * 0.8));
    }
    return y + 0.06;
  }

  place(c) {
    const p = c.follow ? c.follow : c.pos;
    if (c.vertical) {
      c.group.position.set(p.x, p.y + c.yOffset, p.z);
      if (c.normal) c.group.lookAt(c.group.position.clone().add(c.normal));
    } else {
      c.group.position.set(p.x, this.groundY(p.x, p.z, c.radius) + c.yOffset, p.z);
    }
  }

  update(dt) {
    for (const c of this.list) {
      c.t += dt;
      if (c.t >= c.life && !c.closing) c.kill();
      let a, s;
      const o = Math.min(1, c.t / c.open);
      s = 0.25 + 0.75 * easeOutBack(o);
      a = o;
      if (c.closing) {
        c.closeT += dt;
        const k = Math.min(1, c.closeT / 0.35);
        a *= 1 - k;
        s *= 1 + k * 0.15;
        if (k >= 1) c.dead = true;
      }
      if (c.pulse) a *= 1 - c.pulse * 0.5 + Math.sin(c.t * 3) * c.pulse * 0.5;
      c.group.scale.setScalar(c.radius * s);
      for (const l of c.layers) {
        l.mesh.rotation.z += l.spin * c.spin * dt;
        l.mesh.material.opacity = a * c.alpha;
      }
      if (c.follow) this.place(c);
      if (c.dead) {
        this.scene.remove(c.group);
        for (const l of c.layers) l.mesh.material.dispose();
      }
    }
    this.list = this.list.filter((c) => !c.dead);
  }
}

// Version image (data URL) d'un cercle ou d'une couche, teintée, pour l'interface.
export function circleDataURL(color, symbol = 'star', size = 256, which = 'all') {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  if (which === 'all' || which === 'outer') ctx.drawImage(outerLayerCanvas(Math.max(512, size * 2)), 0, 0, size, size);
  if (which === 'all' || which === 'mid') ctx.drawImage(midLayerCanvas(Math.max(512, size * 2)), size * 0.11, size * 0.11, size * 0.78, size * 0.78);
  if (which === 'all' || which === 'center') {
    const s = which === 'center' ? size : size * 0.5;
    ctx.drawImage(centerLayerCanvas(symbol, Math.max(256, s * 2)), (size - s) / 2, (size - s) / 2, s, s);
  }
  ctx.globalCompositeOperation = 'source-in';
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, size, size);
  return c.toDataURL();
}
