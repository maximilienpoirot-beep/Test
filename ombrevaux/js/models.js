import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Modèles procéduraux low-poly, ombrés à plat.

export function mat(color, o = {}) {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: o.roughness ?? 0.85,
    metalness: o.metalness ?? 0.05,
    flatShading: o.flat ?? true,
    emissive: o.emissive ?? 0x000000,
    emissiveIntensity: o.emissiveIntensity ?? 1,
    side: o.side ?? THREE.FrontSide,
    transparent: o.transparent ?? false,
    opacity: o.opacity ?? 1,
  });
}

function add(parent, geo, material, x = 0, y = 0, z = 0, shadow = true) {
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z);
  m.castShadow = shadow;
  m.receiveShadow = false;
  parent.add(m);
  return m;
}

const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const cyl = (rt, rb, h, s = 7, open = false) => new THREE.CylinderGeometry(rt, rb, h, s, 1, open);

function pivot(parent, x, y, z) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  parent.add(g);
  return g;
}

// ---------------------------------------------------------------- Chasseur
export function makeHunter() {
  const root = new THREE.Group();
  const coat = mat(0x1e1b22), trim = mat(0x4a2e1f), skin = mat(0xcbb8a4);
  const hatM = mat(0x151318), scarf = mat(0x6e1420), leather = mat(0x2e2219), trousers = mat(0x24222a);
  const buckle = mat(0xb59a5a, { metalness: 0.7, roughness: 0.35 });

  const hips = pivot(root, 0, 0.95, 0);
  const legs = [];
  for (const s of [-1, 1]) {
    const leg = pivot(hips, 0.12 * s, 0, 0);
    add(leg, box(0.17, 0.82, 0.19), trousers, 0, -0.42, 0);
    add(leg, box(0.2, 0.22, 0.32), leather, 0, -0.84, 0.05);
    legs.push(leg);
  }
  const torso = pivot(hips, 0, 0.05, 0);
  add(torso, box(0.48, 0.62, 0.3), coat, 0, 0.32, 0);
  const skirt = add(torso, cyl(0.27, 0.46, 0.8, 8, true), coat, 0, -0.22, 0);
  skirt.material = coat.clone();
  skirt.material.side = THREE.DoubleSide;
  add(torso, box(0.5, 0.08, 0.32), leather, 0, 0.02, 0);
  add(torso, box(0.1, 0.09, 0.05), buckle, 0, 0.02, 0.17);
  // Bandoulière
  const strap = add(torso, box(0.06, 0.75, 0.32), trim, 0, 0.32, 0);
  strap.rotation.z = 0.6;
  // Mantelet
  add(torso, cyl(0.2, 0.4, 0.32, 8), coat, 0, 0.6, 0);
  // Cape en trois segments articulés, bord inférieur effiloché
  const capeM = mat(0x17111a, { side: THREE.DoubleSide });
  const capeLining = mat(0x4a0f18, { side: THREE.DoubleSide });
  const capeP = pivot(torso, 0, 0.66, -0.17);
  const capeSegs = [];
  let parent = capeP;
  for (let i = 0; i < 3; i++) {
    const seg = i === 0 ? capeP : pivot(parent, 0, -0.42, 0);
    const w = 0.6 + i * 0.06;
    add(seg, box(w, 0.44, 0.035), capeM, 0, -0.21, 0);
    add(seg, box(w - 0.04, 0.42, 0.01), capeLining, 0, -0.21, 0.025, false);
    if (i === 2) {
      for (let k = 0; k < 4; k++) {
        const tip = add(seg, new THREE.ConeGeometry(0.09, 0.22, 3), capeM, -w / 2 + 0.09 + k * (w - 0.18) / 3, -0.52, 0);
        tip.rotation.x = Math.PI;
        tip.scale.z = 0.2;
      }
    }
    capeSegs.push(seg);
    parent = seg;
  }
  // Pans du manteau à l'arrière
  const tails = [];
  for (const s of [-1, 1]) {
    const t = pivot(torso, 0.12 * s, -0.1, -0.14);
    add(t, box(0.22, 0.78, 0.035), coat, 0, -0.38, 0);
    tails.push(t);
  }
  // Épaulière, sacoches et fioles
  const iron = mat(0x2a2a30, { metalness: 0.75, roughness: 0.4 });
  const pauldron = add(torso, new THREE.SphereGeometry(0.2, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2), iron, -0.32, 0.6, 0);
  pauldron.scale.set(1, 0.7, 1.05);
  add(torso, new THREE.TorusGeometry(0.19, 0.018, 4, 12), buckle, -0.32, 0.6, 0).rotation.x = Math.PI / 2;
  add(torso, box(0.12, 0.14, 0.08), leather, 0.2, -0.04, 0.12);
  add(torso, box(0.12, 0.14, 0.08), leather, -0.22, -0.04, 0.1);
  for (const [i, c] of [[0, 0xff2040], [1, 0x3a70ff], [2, 0xff2040]]) {
    add(torso, cyl(0.03, 0.035, 0.12, 6), mat(0x000000, { emissive: c, emissiveIntensity: 1.6 }), -0.06 + i * 0.07, 0.11, 0.16, false);
  }

  const arms = [];
  for (const s of [-1, 1]) {
    const arm = pivot(torso, 0.31 * s, 0.6, 0);
    add(arm, box(0.15, 0.6, 0.16), coat, 0, -0.29, 0);
    add(arm, box(0.17, 0.1, 0.18), trim, 0, -0.52, 0);
    const hand = add(arm, box(0.12, 0.14, 0.12), leather, 0, -0.65, 0);
    arm.userData.hand = hand;
    arms.push(arm);
  }

  const head = pivot(torso, 0, 0.72, 0);
  add(head, box(0.24, 0.27, 0.25), skin, 0, 0.15, 0);
  add(head, cyl(0.17, 0.2, 0.16, 8), scarf, 0, 0.0, 0);
  add(head, box(0.25, 0.12, 0.08), scarf, 0, 0.07, 0.11);
  // Yeux luisants
  const eyeM = mat(0x000000, { emissive: 0x9fd8ff, emissiveIntensity: 2.2 });
  add(head, box(0.05, 0.025, 0.02), eyeM, -0.06, 0.18, 0.125, false);
  add(head, box(0.05, 0.025, 0.02), eyeM, 0.06, 0.18, 0.125, false);
  add(head, cyl(0.46, 0.46, 0.03, 12), hatM, 0, 0.3, 0);
  add(head, cyl(0.17, 0.22, 0.28, 8), hatM, 0, 0.45, 0);
  add(head, cyl(0.225, 0.225, 0.06, 8), mat(0x5a1a1a), 0, 0.34, 0);
  add(head, box(0.06, 0.06, 0.02), buckle, 0, 0.34, 0.225, false);
  // Plume de corbeau
  const feather = add(head, new THREE.ConeGeometry(0.05, 0.55, 4), mat(0x0c0c12, { roughness: 0.5 }), 0.2, 0.5, -0.06);
  feather.rotation.set(-0.5, 0, -0.55);
  feather.scale.z = 0.25;

  // Grimoire flottant
  const book = new THREE.Group();
  root.add(book);
  add(book, box(0.3, 0.08, 0.38), mat(0x3b1712), 0, 0, 0);
  const pagesMat = mat(0xf1e2b8, { emissive: 0x8a5cff, emissiveIntensity: 0.55 });
  add(book, box(0.27, 0.06, 0.34), pagesMat, 0.01, 0.015, 0, false);
  add(book, box(0.04, 0.09, 0.4), buckle, -0.15, 0, 0);

  root.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return { root, hips, legs, arms, torso, head, cape: capeP, capeSegs, tails, book, pagesMat };
}

// ---------------------------------------------------------------- Squelette
export function makeSkeleton(archer = false) {
  const root = new THREE.Group();
  const bone = mat(0xd8d0bc), rust = mat(0x5c3a26, { metalness: 0.4 }), cloth = mat(0x2b2620);
  const eye = mat(0x000000, { emissive: 0xff3b1f, emissiveIntensity: 3 });
  const hips = pivot(root, 0, 0.92, 0);
  add(hips, box(0.32, 0.1, 0.16), bone, 0, 0, 0);
  add(hips, cyl(0.2, 0.28, 0.35, 6, true), mat(0x2b2620, { side: THREE.DoubleSide }), 0, -0.12, 0);
  const legs = [];
  for (const s of [-1, 1]) {
    const leg = pivot(hips, 0.11 * s, 0, 0);
    add(leg, box(0.06, 0.45, 0.06), bone, 0, -0.23, 0);
    add(leg, box(0.05, 0.42, 0.05), bone, 0, -0.66, 0);
    add(leg, box(0.1, 0.05, 0.18), bone, 0, -0.88, 0.04);
    legs.push(leg);
  }
  const torso = pivot(hips, 0, 0.05, 0);
  add(torso, box(0.05, 0.6, 0.05), bone, 0, 0.3, -0.05);
  for (let i = 0; i < 4; i++) {
    const w = 0.36 - i * 0.04;
    add(torso, box(w, 0.04, 0.22), bone, 0, 0.55 - i * 0.09, 0.02);
  }
  add(torso, box(0.48, 0.06, 0.12), bone, 0, 0.62, -0.02);
  const arms = [];
  for (const s of [-1, 1]) {
    const arm = pivot(torso, 0.24 * s, 0.62, 0);
    add(arm, box(0.05, 0.36, 0.05), bone, 0, -0.18, 0);
    add(arm, box(0.045, 0.34, 0.045), bone, 0, -0.52, 0);
    arms.push(arm);
  }
  const head = pivot(torso, 0, 0.72, 0);
  add(head, box(0.22, 0.22, 0.24), bone, 0, 0.1, 0);
  add(head, box(0.16, 0.06, 0.16), bone, 0, -0.04, 0.03);
  add(head, box(0.05, 0.04, 0.02), eye, -0.05, 0.11, 0.12, false);
  add(head, box(0.05, 0.04, 0.02), eye, 0.05, 0.11, 0.12, false);
  if (archer) {
    add(head, cyl(0.17, 0.2, 0.16, 6, true), mat(0x3a3328, { side: THREE.DoubleSide }), 0, 0.2, -0.02);
    const bow = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.025, 4, 12, Math.PI), mat(0x3d2a1c));
    bow.rotation.set(0, Math.PI / 2, Math.PI / 2);
    bow.position.set(0, -0.62, 0.05);
    arms[0].add(bow);
  } else {
    const sword = pivot(arms[1], 0, -0.68, 0);
    add(sword, box(0.05, 0.05, 0.25), rust, 0, 0, 0.05);
    add(sword, box(0.06, 0.04, 0.9), rust, 0, 0, 0.55);
    arms[1].userData.weapon = sword;
    add(arms[0], box(0.06, 0.45, 0.4), mat(0x3e3226), 0.06, -0.5, 0.05);
  }
  root.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return { root, hips, legs, arms, torso, head, eyeMat: eye };
}

// ---------------------------------------------------------------- Loup-garou
export function makeWerewolf(alpha = false) {
  const root = new THREE.Group();
  const furC = alpha ? 0x8c8a86 : 0x3a2f28;
  const fur = mat(furC), dark = mat(alpha ? 0x5a5752 : 0x231b17), claw = mat(0xd6cdb8);
  const eye = mat(0x000000, { emissive: alpha ? 0xff2020 : 0xffb21a, emissiveIntensity: 3.5 });
  const hips = pivot(root, 0, 1.0, 0);
  add(hips, box(0.5, 0.35, 0.4), fur, 0, 0, 0);
  const tail = pivot(hips, 0, 0.05, -0.2);
  const tm = add(tail, box(0.12, 0.12, 0.6), fur, 0, 0, -0.3);
  tm.rotation.x = 0.4;
  const legs = [];
  for (const s of [-1, 1]) {
    const leg = pivot(hips, 0.2 * s, -0.05, 0);
    const th = add(leg, box(0.2, 0.5, 0.25), fur, 0, -0.2, 0.08);
    th.rotation.x = -0.4;
    const sh = add(leg, box(0.13, 0.45, 0.14), dark, 0, -0.6, -0.04);
    sh.rotation.x = 0.35;
    add(leg, box(0.18, 0.08, 0.3), dark, 0, -0.9, 0.06);
    legs.push(leg);
  }
  const torso = pivot(hips, 0, 0.1, 0.05);
  torso.rotation.x = 0.55;
  add(torso, box(0.7, 0.75, 0.5), fur, 0, 0.4, 0);
  add(torso, box(0.5, 0.3, 0.35), fur, 0, 0.85, -0.12);
  // Crinière
  for (let i = 0; i < 5; i++) {
    const sp = add(torso, new THREE.ConeGeometry(0.08, 0.35, 4), dark, (i - 2) * 0.12, 0.85, -0.25);
    sp.rotation.x = -0.9;
  }
  const arms = [];
  for (const s of [-1, 1]) {
    const arm = pivot(torso, 0.42 * s, 0.7, 0.05);
    add(arm, box(0.2, 0.55, 0.22), fur, 0, -0.27, 0);
    add(arm, box(0.15, 0.55, 0.15), dark, 0, -0.75, 0.05);
    for (let k = -1; k <= 1; k++) {
      const c = add(arm, new THREE.ConeGeometry(0.03, 0.2, 4), claw, k * 0.05, -1.08, 0.1);
      c.rotation.x = Math.PI;
    }
    arms.push(arm);
  }
  const head = pivot(torso, 0, 0.95, 0.15);
  head.rotation.x = -0.45;
  add(head, box(0.34, 0.3, 0.34), fur, 0, 0.1, 0);
  add(head, box(0.18, 0.15, 0.32), dark, 0, 0.02, 0.3);
  add(head, box(0.08, 0.06, 0.06), mat(0x0a0a0a), 0, 0.08, 0.46);
  const jaw = pivot(head, 0, -0.05, 0.15);
  add(jaw, box(0.16, 0.06, 0.28), dark, 0, -0.03, 0.12);
  for (const s of [-1, 1]) {
    const ear = add(head, new THREE.ConeGeometry(0.07, 0.25, 4), fur, 0.12 * s, 0.33, -0.05);
    ear.rotation.z = -0.2 * s;
    add(head, box(0.07, 0.04, 0.03), eye, 0.09 * s, 0.15, 0.17, false);
  }
  root.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return { root, hips, legs, arms, torso, head, jaw, tail, eyeMat: eye };
}

// ---------------------------------------------------------------- Gargouille
function wingGeometry(span = 1.4) {
  const s = new THREE.Shape();
  s.moveTo(0, 0);
  s.lineTo(span * 0.35, 0.45);
  s.lineTo(span, 0.35);
  s.lineTo(span * 0.85, 0.05);
  s.lineTo(span * 0.9, -0.25);
  s.lineTo(span * 0.6, -0.1);
  s.lineTo(span * 0.55, -0.4);
  s.lineTo(span * 0.3, -0.15);
  s.lineTo(span * 0.2, -0.45);
  s.lineTo(0, -0.1);
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.04, bevelEnabled: false });
  g.translate(0, 0, -0.02);
  return g;
}

export function makeGargoyle() {
  const root = new THREE.Group();
  const stone = mat(0x6b6a66, { roughness: 1 }), dstone = mat(0x4b4a47, { roughness: 1 });
  const eye = mat(0x000000, { emissive: 0xff7a1a, emissiveIntensity: 0 });
  const body = pivot(root, 0, 0, 0);
  const hips = pivot(body, 0, 0.6, 0);
  add(hips, box(0.5, 0.35, 0.45), stone, 0, 0, 0);
  const legs = [];
  for (const s of [-1, 1]) {
    const leg = pivot(hips, 0.2 * s, -0.05, 0.05);
    const t = add(leg, box(0.18, 0.4, 0.3), stone, 0, -0.1, 0.12);
    t.rotation.x = -0.9;
    add(leg, box(0.14, 0.35, 0.15), dstone, 0, -0.38, -0.02);
    add(leg, box(0.2, 0.08, 0.3), dstone, 0, -0.55, 0.06);
    legs.push(leg);
  }
  const torso = pivot(hips, 0, 0.1, 0);
  torso.rotation.x = 0.4;
  add(torso, box(0.6, 0.6, 0.45), stone, 0, 0.3, 0);
  const arms = [];
  for (const s of [-1, 1]) {
    const arm = pivot(torso, 0.36 * s, 0.5, 0.05);
    add(arm, box(0.15, 0.5, 0.15), stone, 0, -0.25, 0.08);
    add(arm, new THREE.ConeGeometry(0.06, 0.2, 4), dstone, 0, -0.55, 0.12).rotation.x = Math.PI;
    arms.push(arm);
  }
  const head = pivot(torso, 0, 0.7, 0.12);
  add(head, box(0.32, 0.3, 0.32), stone, 0, 0.08, 0);
  add(head, box(0.22, 0.14, 0.2), dstone, 0, 0.0, 0.2);
  for (const s of [-1, 1]) {
    const horn = add(head, new THREE.ConeGeometry(0.05, 0.3, 4), dstone, 0.12 * s, 0.3, -0.05);
    horn.rotation.set(-0.5, 0, -0.4 * s);
    add(head, box(0.07, 0.04, 0.03), eye, 0.08 * s, 0.13, 0.17, false);
  }
  const wings = [];
  const wg = wingGeometry(1.5);
  for (const s of [-1, 1]) {
    const w = pivot(torso, 0.2 * s, 0.55, -0.2);
    const m = add(w, wg, dstone, 0, 0, 0);
    if (s < 0) m.scale.x = -1;
    w.rotation.y = 0.5 * s;
    wings.push(w);
  }
  root.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return { root, body, hips, legs, arms, torso, head, wings, eyeMat: eye, stoneMat: stone };
}

// ---------------------------------------------------------------- Boss : Séraphine
export function makeSeraphine() {
  const root = new THREE.Group();
  const robe = mat(0xd9d2c4, { roughness: 0.9, emissive: 0x2a2228 }), gold = mat(0xc9a14a, { metalness: 0.8, roughness: 0.35 });
  const dark = mat(0x1a1420), skin = mat(0xe8e0d6, { roughness: 0.5 });
  const haloMat = mat(0x000000, { emissive: 0xffd27a, emissiveIntensity: 3 });
  const coreMat = mat(0x000000, { emissive: 0xff4060, emissiveIntensity: 0 });
  const body = pivot(root, 0, 0, 0);
  // Robe flottante
  const robeM = add(body, cyl(0.6, 1.7, 3.6, 10, true), robe, 0, 1.8, 0);
  robeM.material = robe.clone();
  robeM.material.side = THREE.DoubleSide;
  add(body, cyl(1.72, 1.72, 0.12, 10), gold, 0, 0.05, 0);
  const torso = pivot(body, 0, 3.6, 0);
  add(torso, box(1.2, 1.3, 0.7), robe, 0, 0.6, 0);
  add(torso, box(1.25, 0.15, 0.75), gold, 0, 0.05, 0);
  add(torso, box(0.35, 0.35, 0.1), coreMat, 0, 0.7, 0.36, false);
  const arms = [];
  for (const s of [-1, 1]) {
    const arm = pivot(torso, 0.75 * s, 1.15, 0);
    add(arm, box(0.32, 1.3, 0.32), robe, 0, -0.6, 0);
    add(arm, box(0.36, 0.2, 0.36), gold, 0, -1.2, 0);
    add(arm, box(0.24, 0.35, 0.24), skin, 0, -1.45, 0);
    arms.push(arm);
  }
  // Épée brisée dans la main droite
  const sword = pivot(arms[1], 0, -1.55, 0.1);
  add(sword, box(0.15, 0.15, 0.6), gold, 0, 0, 0);
  add(sword, box(0.7, 0.12, 0.12), gold, 0, 0, 0.3);
  add(sword, box(0.12, 0.25, 2.4), mat(0xbfc6d4, { metalness: 0.9, roughness: 0.25 }), 0, 0, 1.5);
  const head = pivot(torso, 0, 1.4, 0);
  add(head, box(0.5, 0.6, 0.5), skin, 0, 0.3, 0);
  // Voile
  add(head, cyl(0.32, 0.5, 0.9, 8, true), mat(0x2a1830, { side: THREE.DoubleSide }), 0, 0.35, -0.04);
  add(head, box(0.42, 0.06, 0.04), mat(0x000000, { emissive: 0xffffff, emissiveIntensity: 3 }), 0, 0.33, 0.26, false);
  // Auréole épineuse
  const halo = pivot(head, 0, 0.6, -0.3);
  add(halo, new THREE.TorusGeometry(0.85, 0.06, 6, 28), haloMat, 0, 0, 0, false);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const sp = add(halo, new THREE.ConeGeometry(0.06, 0.45, 4), dark, Math.cos(a) * 1.05, Math.sin(a) * 1.05, 0, false);
    sp.rotation.z = a - Math.PI / 2;
  }
  // Ailes de vitrail
  const wings = [];
  const glassCols = [0xc21d45, 0x2347d9, 0xe0a51f, 0x6a2bc2, 0x1a9a7c];
  for (const s of [-1, 1]) {
    const w = pivot(torso, 0.4 * s, 1.0, -0.4);
    for (let i = 0; i < 7; i++) {
      const f = new THREE.Group();
      w.add(f);
      f.rotation.z = -s * (0.25 + i * 0.22);
      const len = 3.4 - Math.abs(i - 2) * 0.3;
      const fm = mat(0x000000, { emissive: glassCols[i % glassCols.length], emissiveIntensity: 1.6, transparent: true, opacity: 0.85, side: THREE.DoubleSide });
      const feather = add(f, new THREE.ConeGeometry(0.28, len, 4), fm, 0, len / 2, 0, false);
      feather.scale.z = 0.25;
      add(f, box(0.06, len * 0.95, 0.06), dark, 0, len / 2, 0.02, false);
    }
    w.rotation.y = -0.4 * s;
    wings.push(w);
  }
  return { root, body, torso, arms, head, halo, haloMat, wings, coreMat, sword };
}

// ---------------------------------------------------------------- Objets
export function makePage(color = 0xffd27a) {
  const g = new THREE.Group();
  const pm = mat(0xf3e4bd, { emissive: color, emissiveIntensity: 0.9, side: THREE.DoubleSide });
  const p1 = add(g, new THREE.PlaneGeometry(0.5, 0.65), pm, -0.24, 0, 0, false);
  p1.rotation.y = 0.35;
  const p2 = add(g, new THREE.PlaneGeometry(0.5, 0.65), pm, 0.24, 0, 0, false);
  p2.rotation.y = -0.35;
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.75, 0.025, 6, 40), mat(0x000000, { emissive: color, emissiveIntensity: 2.5 }));
  ring.rotation.x = Math.PI / 2;
  ring.position.y = -0.8;
  g.add(ring);
  return { group: g, ring };
}

export function makeOrb(color) {
  const m = new THREE.Mesh(new THREE.IcosahedronGeometry(0.16, 0), mat(0x000000, { emissive: color, emissiveIntensity: 3 }));
  return m;
}

export function makeRelic(kind) {
  const g = new THREE.Group();
  if (kind === 'fiole') {
    add(g, new THREE.SphereGeometry(0.16, 8, 6), mat(0x000000, { emissive: 0xff2040, emissiveIntensity: 2.2 }), 0, 0, 0, false);
    add(g, cyl(0.05, 0.06, 0.18, 6), mat(0xd6d0c0, { transparent: true, opacity: 0.6 }), 0, 0.2, 0, false);
    add(g, cyl(0.06, 0.06, 0.05, 6), mat(0x4a2e1f), 0, 0.31, 0, false);
  } else {
    add(g, cyl(0.12, 0.14, 0.2, 6), mat(0x1a1a24), 0, 0, 0, false);
    add(g, cyl(0.1, 0.1, 0.03, 6), mat(0x000000, { emissive: 0x4a7dff, emissiveIntensity: 2.5 }), 0, 0.1, 0, false);
    const q = add(g, box(0.02, 0.45, 0.02), mat(0xf0f0f0), 0.05, 0.25, 0, false);
    q.rotation.z = -0.3;
  }
  return g;
}

export function makeLantern() {
  const g = new THREE.Group();
  const iron = mat(0x1c1c20, { metalness: 0.6, roughness: 0.5 });
  add(g, box(0.5, 0.25, 0.5), mat(0x55524c), 0, 0.12, 0);
  add(g, cyl(0.05, 0.06, 2.0, 6), iron, 0, 1.2, 0);
  add(g, box(0.5, 0.05, 0.05), iron, 0.2, 2.15, 0);
  const cage = pivot(g, 0.42, 1.85, 0);
  add(cage, box(0.28, 0.04, 0.28), iron, 0, 0.2, 0);
  add(cage, box(0.28, 0.04, 0.28), iron, 0, -0.18, 0);
  for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) add(cage, box(0.03, 0.38, 0.03), iron, x * 0.13, 0, z * 0.13);
  const flameMat = mat(0x000000, { emissive: 0x4a4a55, emissiveIntensity: 0.4 });
  const flame = add(cage, new THREE.OctahedronGeometry(0.09, 0), flameMat, 0, 0, 0, false);
  flame.scale.y = 1.6;
  return { group: g, flame, flameMat, flamePos: new THREE.Vector3(0.42, 1.85, 0) };
}

// Fusionne, dans chaque articulation, les pièces qui partagent un matériau
// (les articulations restent animables, mais il y a bien moins d'objets à dessiner).
export function compactModel(root) {
  const groups = [];
  root.traverse((o) => { if (!o.isMesh) groups.push(o); });
  for (const g of groups) {
    const byMat = new Map();
    for (const c of g.children) {
      if (!c.isMesh || c.children.length) continue;
      c.updateMatrix();
      if (c.matrix.determinant() < 0) continue;
      if (!byMat.has(c.material)) byMat.set(c.material, []);
      byMat.get(c.material).push(c);
    }
    for (const [material, list] of byMat) {
      if (list.length < 2) continue;
      const geos = list.map((c) => {
        const geo = c.geometry.index ? c.geometry.toNonIndexed() : c.geometry.clone();
        for (const name of Object.keys(geo.attributes)) if (!['position', 'normal', 'uv'].includes(name)) geo.deleteAttribute(name);
        return geo.applyMatrix4(c.matrix);
      });
      if (geos.some((x) => !x.attributes.uv)) continue;
      const mesh = new THREE.Mesh(mergeGeometries(geos, false), material);
      mesh.castShadow = list.some((c) => c.castShadow);
      for (const c of list) g.remove(c);
      g.add(mesh);
    }
  }
  return root;
}

// Liseré lumineux sur les contours (fresnel) : les silhouettes ressortent dans la nuit.
export function addRim(root, color, strength = 0.6, power = 2.5) {
  const c = new THREE.Color(color).multiplyScalar(strength);
  root.traverse((o) => {
    if (!o.isMesh || !o.material.isMeshStandardMaterial || o.material.userData.rim) return;
    const m = o.material;
    m.userData.rim = true;
    m.onBeforeCompile = (sh) => {
      sh.uniforms.uRim = { value: c };
      sh.fragmentShader = 'uniform vec3 uRim;\n' + sh.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        float rimF = 1.0 - clamp(dot(normalize(normal), normalize(vViewPosition)), 0.0, 1.0);
        totalEmissiveRadiance += uRim * pow(rimF, ${power.toFixed(2)});`);
    };
    m.customProgramCacheKey = () => 'rim' + power.toFixed(2);
    m.needsUpdate = true;
  });
}
