import * as THREE from 'three';
import { mulberry32 } from './utils.js';

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')];
}

function finish(c, repeat = true, srgb = true) {
  const t = new THREE.CanvasTexture(c);
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function speckle(ctx, w, h, n, rnd, alpha = 0.08) {
  for (let i = 0; i < n; i++) {
    const v = rnd() < 0.5 ? 0 : 255;
    ctx.fillStyle = `rgba(${v},${v},${v},${rnd() * alpha})`;
    const s = 1 + rnd() * 3;
    ctx.fillRect(rnd() * w, rnd() * h, s, s);
  }
}

// Détail de sol en niveaux de gris (multiplié par les couleurs de sommets).
export function groundDetail() {
  const [c, ctx] = canvas(256, 256);
  const rnd = mulberry32(7);
  ctx.fillStyle = '#bdbdbd';
  ctx.fillRect(0, 0, 256, 256);
  speckle(ctx, 256, 256, 5000, rnd, 0.25);
  for (let i = 0; i < 60; i++) {
    ctx.strokeStyle = `rgba(40,40,40,${0.1 + rnd() * 0.15})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    let x = rnd() * 256, y = rnd() * 256;
    ctx.moveTo(x, y);
    for (let k = 0; k < 4; k++) { x += (rnd() - 0.5) * 20; y += (rnd() - 0.5) * 20; ctx.lineTo(x, y); }
    ctx.stroke();
  }
  return finish(c);
}

export function stoneBlocks(base = '#5d5a55', mortar = '#2b2926', bw = 64, bh = 32) {
  const [c, ctx] = canvas(256, 256);
  const rnd = mulberry32(11);
  ctx.fillStyle = mortar;
  ctx.fillRect(0, 0, 256, 256);
  for (let row = 0; row < 256 / bh; row++) {
    const off = (row % 2) * bw / 2;
    for (let col = -1; col < 256 / bw + 1; col++) {
      const shade = 0.75 + rnd() * 0.35;
      const col0 = new THREE.Color(base).multiplyScalar(shade);
      ctx.fillStyle = `#${col0.getHexString()}`;
      ctx.fillRect(col * bw + off + 2, row * bh + 2, bw - 4, bh - 4);
    }
  }
  speckle(ctx, 256, 256, 4000, rnd, 0.18);
  return finish(c);
}

export function floorTiles() {
  const [c, ctx] = canvas(256, 256);
  const rnd = mulberry32(3);
  const s = 64;
  for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
    const dark = (x + y) % 2 === 0;
    const v = dark ? 38 + rnd() * 10 : 92 + rnd() * 14;
    ctx.fillStyle = `rgb(${v},${v * 0.96},${v * 0.92})`;
    ctx.fillRect(x * s, y * s, s, s);
  }
  ctx.strokeStyle = 'rgba(0,0,0,0.6)';
  ctx.lineWidth = 3;
  for (let i = 0; i <= 4; i++) {
    ctx.beginPath(); ctx.moveTo(i * s, 0); ctx.lineTo(i * s, 256); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, i * s); ctx.lineTo(256, i * s); ctx.stroke();
  }
  for (let i = 0; i < 25; i++) {
    ctx.strokeStyle = `rgba(0,0,0,${0.2 + rnd() * 0.3})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    let x = rnd() * 256, y = rnd() * 256;
    ctx.moveTo(x, y);
    for (let k = 0; k < 5; k++) { x += (rnd() - 0.5) * 30; y += (rnd() - 0.5) * 30; ctx.lineTo(x, y); }
    ctx.stroke();
  }
  speckle(ctx, 256, 256, 3000, rnd, 0.15);
  return finish(c);
}

export function planks(base = '#4a3426') {
  const [c, ctx] = canvas(128, 128);
  const rnd = mulberry32(5);
  for (let i = 0; i < 8; i++) {
    const col = new THREE.Color(base).multiplyScalar(0.7 + rnd() * 0.5);
    ctx.fillStyle = `#${col.getHexString()}`;
    ctx.fillRect(i * 16, 0, 16, 128);
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(i * 16, 0, 1.5, 128);
  }
  for (let i = 0; i < 80; i++) {
    ctx.fillStyle = `rgba(0,0,0,${rnd() * 0.25})`;
    ctx.fillRect(rnd() * 128, rnd() * 128, 1, 6 + rnd() * 20);
  }
  return finish(c);
}

export function shingles() {
  const [c, ctx] = canvas(128, 128);
  const rnd = mulberry32(9);
  ctx.fillStyle = '#121214';
  ctx.fillRect(0, 0, 128, 128);
  for (let row = 0; row < 8; row++) {
    const off = (row % 2) * 8;
    for (let col = -1; col < 9; col++) {
      const v = 30 + rnd() * 22;
      ctx.fillStyle = `rgb(${v},${v},${v + 6})`;
      ctx.fillRect(col * 16 + off + 1, row * 16 + 1, 14, 15);
    }
  }
  return finish(c);
}

// Vitrail en ogive : cellules colorées serties de plomb.
export function stainedGlass(seed, palette) {
  const [c, ctx] = canvas(128, 320);
  const rnd = mulberry32(seed);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, 128, 320);
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(8, 320);
  ctx.lineTo(8, 90);
  ctx.quadraticCurveTo(10, 10, 64, 4);
  ctx.quadraticCurveTo(118, 10, 120, 90);
  ctx.lineTo(120, 320);
  ctx.closePath();
  ctx.clip();
  const cw = 20, ch = 24;
  for (let y = 0; y < 320; y += ch) {
    for (let x = 0; x < 128; x += cw) {
      const col = palette[Math.floor(rnd() * palette.length)];
      ctx.fillStyle = col;
      ctx.globalAlpha = 0.55 + rnd() * 0.45;
      const j = () => (rnd() - 0.5) * 6;
      ctx.beginPath();
      ctx.moveTo(x + j(), y + j());
      ctx.lineTo(x + cw + j(), y + j());
      ctx.lineTo(x + cw + j(), y + ch + j());
      ctx.lineTo(x + j(), y + ch + j());
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
  // Figure centrale stylisée (auréole).
  ctx.fillStyle = '#ffe9a8';
  ctx.beginPath(); ctx.arc(64, 110, 18, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = palette[0];
  ctx.beginPath(); ctx.arc(64, 110, 11, 0, Math.PI * 2); ctx.fill();
  ctx.fillRect(52, 128, 24, 90);
  ctx.strokeStyle = '#050505';
  ctx.lineWidth = 3;
  for (let y = 0; y < 320; y += ch) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(128, y); ctx.stroke(); }
  for (let x = 0; x < 128; x += cw) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 320); ctx.stroke(); }
  ctx.lineWidth = 4;
  ctx.beginPath(); ctx.arc(64, 110, 18, 0, Math.PI * 2); ctx.stroke();
  ctx.restore();
  ctx.strokeStyle = '#0a0a0a';
  ctx.lineWidth = 8;
  ctx.beginPath();
  ctx.moveTo(8, 320); ctx.lineTo(8, 90);
  ctx.quadraticCurveTo(10, 10, 64, 4);
  ctx.quadraticCurveTo(118, 10, 120, 90);
  ctx.lineTo(120, 320);
  ctx.stroke();
  return finish(c, false);
}

export function roseWindow() {
  const [c, ctx] = canvas(512, 512);
  const rnd = mulberry32(42);
  const cx = 256, cy = 256;
  ctx.clearRect(0, 0, 512, 512);
  const cols = ['#b3123a', '#1d3fbf', '#d9a21b', '#5b1fa6', '#14806a', '#c2471a'];
  const rings = [250, 200, 150, 100, 55];
  const segs = [24, 24, 12, 12, 6];
  for (let r = 0; r < rings.length; r++) {
    const n = segs[r];
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2;
      ctx.fillStyle = cols[(i + r * 2 + Math.floor(rnd() * 2)) % cols.length];
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, rings[r], a0, a1);
      ctx.closePath();
      ctx.fill();
    }
  }
  ctx.fillStyle = '#ffe9b0';
  ctx.beginPath(); ctx.arc(cx, cy, 30, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#080808';
  for (let r = 0; r < rings.length; r++) {
    ctx.lineWidth = r === 0 ? 14 : 7;
    ctx.beginPath(); ctx.arc(cx, cy, rings[r], 0, Math.PI * 2); ctx.stroke();
    const n = segs[r];
    ctx.lineWidth = 5;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const r0 = rings[r + 1] || 30;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
      ctx.lineTo(cx + Math.cos(a) * rings[r], cy + Math.sin(a) * rings[r]);
      ctx.stroke();
    }
  }
  // Pétales
  ctx.lineWidth = 5;
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    ctx.beginPath();
    ctx.arc(cx + Math.cos(a) * 175, cy + Math.sin(a) * 175, 22, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.beginPath(); ctx.arc(cx, cy, 30, 0, Math.PI * 2); ctx.stroke();
  return finish(c, false);
}

// Brume au sol (alpha).
export function fogTexture() {
  const [c, ctx] = canvas(256, 256);
  const rnd = mulberry32(21);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 70; i++) {
    const x = rnd() * 256, y = rnd() * 256, r = 20 + rnd() * 60;
    for (const [ox, oy] of [[0, 0], [256, 0], [-256, 0], [0, 256], [0, -256]]) {
      const g = ctx.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, r);
      g.addColorStop(0, `rgba(255,255,255,${0.12 + rnd() * 0.1})`);
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x + ox - r, y + oy - r, r * 2, r * 2);
    }
  }
  return finish(c, true, false);
}

export function parchment(glyph = '✶', color = '#7a1020') {
  const [c, ctx] = canvas(128, 160);
  const rnd = mulberry32(13);
  ctx.fillStyle = '#e8d6a8';
  ctx.fillRect(0, 0, 128, 160);
  speckle(ctx, 128, 160, 900, rnd, 0.2);
  ctx.strokeStyle = 'rgba(80,50,20,0.5)';
  for (let y = 30; y < 150; y += 9) {
    ctx.beginPath(); ctx.moveTo(14, y); ctx.lineTo(114 - rnd() * 30, y); ctx.stroke();
  }
  ctx.fillStyle = color;
  ctx.font = 'bold 64px serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(glyph, 64, 70);
  return finish(c, false);
}

export function glowSprite(inner = 'rgba(255,255,255,1)', outer = 'rgba(255,255,255,0)') {
  const [c, ctx] = canvas(128, 128);
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, inner);
  g.addColorStop(0.25, inner.replace(/[\d.]+\)$/, '0.5)'));
  g.addColorStop(1, outer);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  return finish(c, false);
}

export function moonTexture() {
  const [c, ctx] = canvas(256, 256);
  const rnd = mulberry32(99);
  const g = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
  g.addColorStop(0, '#fffbe8');
  g.addColorStop(0.92, '#e6e0cc');
  g.addColorStop(1, 'rgba(230,224,204,0)');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(128, 128, 120, 0, Math.PI * 2); ctx.fill();
  for (let i = 0; i < 26; i++) {
    const a = rnd() * Math.PI * 2, d = rnd() * 95;
    const x = 128 + Math.cos(a) * d, y = 128 + Math.sin(a) * d, r = 5 + rnd() * 22;
    ctx.fillStyle = `rgba(150,140,120,${0.15 + rnd() * 0.25})`;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
  return finish(c, false);
}
