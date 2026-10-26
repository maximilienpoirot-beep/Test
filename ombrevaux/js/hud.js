import * as THREE from 'three';
import { SPELLS } from './player.js';
import { PATH } from './world.js';

export const ICONS = {
  arcane: `<svg viewBox="0 0 40 40"><g fill="none" stroke="#c9a8ff" stroke-width="2"><path d="M20 3 L23 17 L37 20 L23 23 L20 37 L17 23 L3 20 L17 17 Z" fill="rgba(160,112,255,.35)"/><circle cx="20" cy="20" r="5"/></g></svg>`,
  holy: `<svg viewBox="0 0 40 40"><g stroke="#ffd27a" stroke-width="2" fill="none"><circle cx="20" cy="20" r="7" fill="rgba(255,210,122,.4)"/>${[...Array(12)].map((_, i) => { const a = i / 12 * Math.PI * 2, r0 = i % 2 ? 11 : 10, r1 = i % 2 ? 15 : 18; return `<line x1="${20 + Math.cos(a) * r0}" y1="${20 + Math.sin(a) * r0}" x2="${20 + Math.cos(a) * r1}" y2="${20 + Math.sin(a) * r1}"/>`; }).join('')}</g></svg>`,
  lightning: `<svg viewBox="0 0 40 40"><path d="M23 3 L10 22 L19 22 L15 37 L30 16 L21 16 L26 3 Z" fill="rgba(143,208,255,.35)" stroke="#8fd0ff" stroke-width="2" stroke-linejoin="round"/></svg>`,
  shadow: `<svg viewBox="0 0 40 40"><g fill="none" stroke="#9a76ff" stroke-width="2"><path d="M27 6 A15 15 0 1 0 27 34 A11 11 0 1 1 27 6 Z" fill="rgba(106,60,255,.35)"/><path d="M30 14 l6 0 M31 20 l6 0 M30 26 l6 0"/></g></svg>`,
};

const ORDER = ['arcane', 'holy', 'lightning', 'shadow'];

export class HUD {
  constructor(game) {
    this.game = game;
    this.$ = (s) => document.querySelector(s);
    this.root = this.$('#hud');
    this.objText = this.$('#obj-text');
    this.hpFill = this.$('#bars .hp .fill');
    this.hpTrail = this.$('#bars .hp .trail');
    this.hpText = this.$('#bars .hp span');
    this.manaFill = this.$('#bars .mana .fill');
    this.manaText = this.$('#bars .mana span');
    this.manaBar = this.$('#bars .mana');
    this.hurtEl = this.$('#hurt');
    this.boss = this.$('#bossbar');
    this.bossFill = this.$('#bossbar .fill');
    this.bossTrail = this.$('#bossbar .trail');
    this.promptEl = this.$('#prompt');
    this.crosshair = this.$('#crosshair');
    this.zoneName = this.$('#zone-name');
    this.zoneBanner = this.$('#zone-banner');
    this.pageBanner = this.$('#pagebanner');
    this.mm = this.$('#minimap').getContext('2d');
    this.floaters = this.$('#floaters');
    this.ebars = this.$('#ebars');
    this.hpTrailV = 1;
    this.bossTrailV = 1;
    this.hurtV = 0;
    this.nums = [];
    this.ebarPool = [];

    const bar = this.$('#spellbar');
    this.slots = {};
    for (const k of ORDER) {
      const s = SPELLS[k];
      const el = document.createElement('div');
      el.className = 'slot' + (k === 'shadow' ? ' sep' : '');
      el.innerHTML = `${ICONS[k]}<span class="key">${k === 'shadow' ? '␣' : s.slot}</span><span class="cost">${s.mana}</span><div class="cd"></div>`;
      el.title = s.name;
      bar.appendChild(el);
      this.slots[k] = { el, cd: el.querySelector('.cd') };
    }
  }

  show(v) { this.root.classList.toggle('hidden', !v); }

  setObjective(text) {
    if (this.objText.textContent === text) return;
    this.objText.textContent = text;
    this.objText.classList.remove('pulse');
    void this.objText.offsetWidth;
    this.objText.classList.add('pulse');
  }

  showZone(name) {
    this.zoneName.textContent = name;
    this.zoneBanner.querySelector('span').textContent = name;
    this.zoneBanner.classList.add('show');
    clearTimeout(this.zoneTO);
    this.zoneTO = setTimeout(() => this.zoneBanner.classList.remove('show'), 3200);
  }

  showPage(name, hint) {
    this.pageBanner.querySelector('.big').textContent = name;
    this.pageBanner.querySelector('.hint').innerHTML = hint;
    this.pageBanner.classList.add('show');
    clearTimeout(this.pageTO);
    this.pageTO = setTimeout(() => this.pageBanner.classList.remove('show'), 5000);
  }

  toast(text) {
    const t = document.createElement('div');
    t.className = 'toast';
    t.textContent = text;
    this.$('#toasts').appendChild(t);
    setTimeout(() => t.remove(), 4300);
  }

  flashMana() {
    this.manaBar.classList.add('flash');
    setTimeout(() => this.manaBar.classList.remove('flash'), 180);
  }

  hurt(amount) {
    this.hurtV = Math.min(1, this.hurtV + 0.25 + amount / 40);
  }

  prompt(text) {
    if (!text) { this.promptEl.classList.add('hidden'); return; }
    this.promptEl.classList.remove('hidden');
    if (this.promptEl.innerHTML !== text) this.promptEl.innerHTML = text;
  }

  setBoss(name, ratio) {
    if (!name) { this.boss.classList.add('hidden'); this.bossTrailV = 1; return; }
    this.boss.classList.remove('hidden');
    this.boss.querySelector('.name').textContent = name;
    this.bossFill.style.transform = `scaleX(${Math.max(0, ratio)})`;
    this.bossTarget = ratio;
  }

  damageNumber(pos, n, color, tag = '') {
    const el = document.createElement('div');
    el.className = 'dmg ' + tag;
    el.textContent = n;
    el.style.color = color;
    this.floaters.appendChild(el);
    this.nums.push({ el, pos: pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.6, 0.3, (Math.random() - 0.5) * 0.6)), t: 0 });
  }

  relics(p, pages) {
    this.$('#r-fiole').textContent = p.relics.fiole;
    this.$('#r-encre').textContent = p.relics.encre;
    this.$('#r-pages').textContent = pages;
  }

  project(v, cam, out) {
    out.copy(v).project(cam);
    return out.z < 1 && out.z > -1;
  }

  update(dt) {
    const g = this.game, p = g.player, cam = g.camera;
    const W = innerWidth, H = innerHeight;
    // Barres
    const hpR = p.hp / p.maxHp;
    this.hpFill.style.transform = `scaleX(${hpR})`;
    this.hpTrailV = this.hpTrailV > hpR ? Math.max(hpR, this.hpTrailV - dt * 0.4) : hpR;
    this.hpTrail.style.transform = `scaleX(${this.hpTrailV})`;
    this.hpText.textContent = `${Math.ceil(p.hp)} / ${p.maxHp}`;
    this.manaFill.style.transform = `scaleX(${p.mana / p.maxMana})`;
    this.manaText.textContent = `${Math.floor(p.mana)}`;
    this.$('#bars').style.width = `${Math.min(560, 300 + p.maxHp * 1.2)}px`;
    if (!this.boss.classList.contains('hidden')) {
      const r = this.bossTarget ?? 1;
      this.bossTrailV = this.bossTrailV > r ? Math.max(r, this.bossTrailV - dt * 0.3) : r;
      this.bossTrail.style.transform = `scaleX(${this.bossTrailV})`;
    }
    // Sorts
    for (const k of ORDER) {
      const s = this.slots[k];
      s.el.classList.toggle('locked', !p.unlocked[k]);
      s.el.classList.toggle('sel', p.selected === k && k !== 'shadow');
      s.el.classList.toggle('nomana', p.mana < SPELLS[k].mana);
      s.cd.style.transform = `scaleY(${p.cooldowns[k] / SPELLS[k].cd})`;
    }
    // Douleur
    this.hurtV = Math.max(0, this.hurtV - dt * 1.6);
    const low = hpR < 0.3 && !p.dead ? 0.35 + Math.sin(performance.now() / 250) * 0.15 : 0;
    this.hurtEl.style.opacity = Math.max(this.hurtV, low);
    this.crosshair.classList.toggle('target', !!g.aimTarget);

    // Chiffres de dégâts
    const v = new THREE.Vector3();
    for (const n of this.nums) {
      n.t += dt;
      n.pos.y += dt * 1.2;
      if (this.project(n.pos, cam, v)) {
        n.el.style.left = `${(v.x * 0.5 + 0.5) * W}px`;
        n.el.style.top = `${(-v.y * 0.5 + 0.5) * H}px`;
        n.el.style.opacity = Math.max(0, 1 - Math.max(0, n.t - 0.5) * 2);
        n.el.style.display = '';
      } else n.el.style.display = 'none';
      if (n.t > 1) n.el.remove();
    }
    this.nums = this.nums.filter((n) => n.t <= 1);

    // Barres de vie des ennemis blessés
    let used = 0;
    for (const e of g.enemies.list) {
      if (!e.alive || e.state === 'dying' || e.hp >= e.maxHp || e.type === 'alpha') continue;
      const c = e.center();
      c.y += e.height * 0.6 * (e.T.scale ?? 1);
      if (c.distanceTo(cam.position) > 35 || !this.project(c, cam, v)) continue;
      let el = this.ebarPool[used];
      if (!el) {
        el = document.createElement('div');
        el.className = 'ebar';
        el.innerHTML = '<div></div>';
        this.ebars.appendChild(el);
        this.ebarPool.push(el);
      }
      el.style.display = '';
      el.style.left = `${(v.x * 0.5 + 0.5) * W}px`;
      el.style.top = `${(-v.y * 0.5 + 0.5) * H}px`;
      el.firstChild.style.transform = `scaleX(${Math.max(0, e.hp / e.maxHp)})`;
      used++;
    }
    for (let i = used; i < this.ebarPool.length; i++) this.ebarPool[i].style.display = 'none';

    this.drawMinimap();
  }

  drawMinimap() {
    const g = this.game, ctx = this.mm, p = g.player.pos;
    const S = 200, R = 100, scale = 1.35;
    const yaw = g.camCtl.yaw;
    ctx.clearRect(0, 0, S, S);
    ctx.save();
    ctx.beginPath();
    ctx.arc(R, R, R - 1, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = '#0d0e12';
    ctx.fillRect(0, 0, S, S);
    // Repère : le haut de la carte = direction de la caméra.
    ctx.translate(R, R);
    ctx.rotate(yaw);
    ctx.scale(scale, scale);
    ctx.translate(-p.x, -p.z);
    ctx.fillStyle = '#2b2720';
    for (const a of g.world.col.areas) ctx.fillRect(a.minX, a.minZ, a.maxX - a.minX, a.maxZ - a.minZ);
    ctx.strokeStyle = '#4a4134';
    ctx.lineWidth = 3;
    ctx.beginPath();
    PATH.forEach(([x, z], i) => (i ? ctx.lineTo(x, z) : ctx.moveTo(x, z)));
    ctx.stroke();
    ctx.fillStyle = '#555049';
    for (const b of g.world.minimapBoxes) {
      if (Math.abs(b[0] - p.x) > 120 || Math.abs(b[1] - p.z) > 120) continue;
      ctx.fillRect(b[0], b[1], b[2] - b[0], b[3] - b[1]);
    }
    if (g.world.veil.alive) { ctx.fillStyle = '#8a3cff'; ctx.fillRect(-5, -112.5, 10, 1); }
    if (!g.world.doorOpen) { ctx.fillStyle = '#7a5a30'; ctx.fillRect(-3.5, -355, 7, 1); }
    ctx.fillStyle = '#6a6a72';
    ctx.fillRect(-3, -196.4, 6, 0.8);
    const dot = (x, z, r, col) => { ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x, z, r, 0, Math.PI * 2); ctx.fill(); };
    for (const l of g.world.lanterns) dot(l.pos.x, l.pos.z, 1.6, l.lit ? '#7ab8ff' : '#555');
    for (const c of g.world.conduits) dot(c.pos.x, c.pos.z, 1.5, c.powered ? '#8fd0ff' : '#8a4a2a');
    for (const pk of g.world.pickups) {
      if (!pk.alive || pk.kind === 'orb') continue;
      dot(pk.pos.x, pk.pos.z, pk.kind === 'page' ? 2 : 1.3, pk.kind === 'page' ? '#ffd27a' : pk.kind === 'fiole' ? '#ff3050' : '#4a7dff');
    }
    for (const e of g.enemies.list) {
      if (!e.alive || e.state === 'dying' || e.state === 'dormant' || e.state === 'rise') continue;
      dot(e.pos.x, e.pos.z, e.type === 'alpha' ? 2.4 : 1.2, '#e03040');
    }
    if (g.boss.active && g.boss.alive) dot(g.boss.pos.x, g.boss.pos.z, 3, '#ff2040');
    ctx.restore();

    // Objectif (bord de la carte si hors de portée)
    const t = g.objectiveTarget;
    if (t) {
      let dx = t.x - p.x, dz = t.z - p.z;
      const c = Math.cos(yaw), s = Math.sin(yaw);
      let sx = (dx * c - dz * s) * scale, sy = (dx * s + dz * c) * scale;
      const d = Math.hypot(sx, sy);
      const edge = R - 10;
      if (d > edge) { sx *= edge / d; sy *= edge / d; }
      ctx.save();
      ctx.translate(R + sx, R + sy);
      ctx.rotate(Math.PI / 4);
      ctx.fillStyle = '#ffd27a';
      ctx.shadowColor = '#ffd27a';
      ctx.shadowBlur = 8;
      ctx.fillRect(-4, -4, 8, 8);
      ctx.restore();
    }
    // Joueur
    ctx.save();
    ctx.translate(R, R);
    ctx.rotate(yaw - g.player.facing + Math.PI);
    ctx.fillStyle = '#fff2d0';
    ctx.beginPath();
    ctx.moveTo(0, -7); ctx.lineTo(5, 5); ctx.lineTo(0, 2); ctx.lineTo(-5, 5); ctx.closePath();
    ctx.fill();
    ctx.restore();
    // Nord
    ctx.save();
    ctx.translate(R, R);
    ctx.rotate(yaw);
    ctx.fillStyle = '#d9b45a';
    ctx.font = '600 12px Cinzel, serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('N', 0, -R + 12);
    ctx.restore();
  }
}
