import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { World, POI, ZONES } from './world.js';
import { Player, ThirdPersonCamera, SPELLS } from './player.js';
import { Particles } from './particles.js';
import { LightManager } from './lights.js';
import { Combat, COL } from './spells.js';
import { EnemyManager } from './enemies.js';
import { Boss } from './boss.js';
import { HUD, ICONS } from './hud.js';
import { makeOrb } from './models.js';
import { CircleFX, circleDataURL } from './circles.js';
import { Trails } from './trails.js';
import { Debris } from './debris.js';
import { Ambience, addWind } from './ambience.js';
import { damp, mulberry32 } from './utils.js';

const DEBUG = new URLSearchParams(location.search).has('debug');
const $ = (s) => document.querySelector(s);

// ------------------------------------------------------------------ Entrées
const input = {
  keys: new Set(), pressed: new Set(), mouseDX: 0, mouseDY: 0, clicked: false, mouseDown: false, wheel: 0,
  sens: 1, invert: false,
  // Souris libre : si le navigateur refuse la capture du pointeur.
  free: false, mx: 0.5, my: 0.5,
};
addEventListener('keydown', (e) => {
  if (e.code === 'Tab' || e.code === 'Space') e.preventDefault();
  if (!e.repeat) input.pressed.add(e.code);
  input.keys.add(e.code);
});
addEventListener('keyup', (e) => input.keys.delete(e.code));
addEventListener('blur', () => input.keys.clear());
addEventListener('mousemove', (e) => {
  input.mx = e.clientX / innerWidth;
  input.my = e.clientY / innerHeight;
  if (document.pointerLockElement || (input.free && game?.state === 'playing')) {
    input.mouseDX += e.movementX * input.sens;
    input.mouseDY += e.movementY * input.sens * (input.invert ? -1 : 1);
  }
});
addEventListener('mousedown', (e) => { if (e.button === 0) { input.mouseDown = true; input.clicked = true; } });
addEventListener('mouseup', (e) => { if (e.button === 0) input.mouseDown = false; });
addEventListener('wheel', (e) => { input.wheel += Math.sign(e.deltaY); }, { passive: true });
addEventListener('contextmenu', (e) => e.preventDefault());

// ------------------------------------------------------------------ Rendu
const canvas = $('#c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.25;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.info.autoReset = false;

const scene = new THREE.Scene();
const FOG = { forest: [0x0c1018, 0.024], village: [0x0e0f16, 0.019], cathedral: [0x0d0a12, 0.014], dawn: [0x6a5560, 0.008] };
scene.fog = new THREE.FogExp2(FOG.forest[0], FOG.forest[1]);
const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.1, 1200);

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.85, 0.55, 0.8);
composer.addPass(bloom);
composer.addPass(new OutputPass());

// Étalonnage final : ombres bleu-vert, hautes lumières chaudes, vignettage,
// grain de film et légère aberration chromatique sur les bords.
const grade = new ShaderPass({
  uniforms: {
    tDiffuse: { value: null }, uTime: { value: 0 }, uRes: { value: new THREE.Vector2(1, 1) },
    uCA: { value: 0.003 }, uGrain: { value: 0.04 }, uVig: { value: 0.6 }, uSat: { value: 1.06 }, uContrast: { value: 1.07 },
    uShadow: { value: new THREE.Vector3(0.0, 0.05, 0.075) }, uHigh: { value: new THREE.Vector3(0.06, 0.03, -0.015) }, uHurt: { value: 0 },
  },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uTime; uniform vec2 uRes;
    uniform float uCA, uGrain, uVig, uSat, uContrast, uHurt; uniform vec3 uShadow, uHigh;
    varying vec2 vUv;
    void main() {
      vec2 d = vUv - 0.5;
      float r = length(d);
      vec2 off = d * (uCA + uHurt * 0.012) * r * 2.0;
      vec3 c = vec3(texture2D(tDiffuse, vUv - off).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv + off).b);
      float l = dot(c, vec3(0.299, 0.587, 0.114));
      c += uShadow * pow(1.0 - l, 3.0) + uHigh * l * l;
      c = mix(vec3(l), c, uSat);
      c = (c - 0.5) * uContrast + 0.5;
      float vig = smoothstep(0.95, 0.3, r);
      c *= mix(1.0, vig, uVig);
      c = mix(c, c * vec3(1.0, 0.25, 0.25), uHurt * smoothstep(0.25, 0.75, r));
      float n = fract(sin(dot(vUv * uRes + fract(uTime) * 91.7, vec2(12.9898, 78.233))) * 43758.5453);
      c += (n - 0.5) * uGrain;
      gl_FragColor = vec4(c, 1.0);
    }`,
});
composer.addPass(grade);

const hemi = new THREE.HemisphereLight(0x42507a, 0x18130f, 0.75);
scene.add(hemi);
const ambient = new THREE.AmbientLight(0x1c1c2a, 0.6);
scene.add(ambient);
const moon = new THREE.DirectionalLight(0x9fb2e0, 1.25);
moon.castShadow = true;
moon.shadow.mapSize.set(2048, 2048);
Object.assign(moon.shadow.camera, { left: -45, right: 45, top: 45, bottom: -45, near: 1, far: 220 });
moon.shadow.bias = -0.0004;
moon.shadow.normalBias = 0.04;
scene.add(moon, moon.target);
const moonDir = new THREE.Vector3(-0.25, 0.38, -0.9).normalize();

let quality = 'medium';
function applyQuality() {
  const dpr = devicePixelRatio || 1;
  const pr = quality === 'high' ? Math.min(dpr, 1.5) : quality === 'medium' ? Math.min(dpr, 1) : 0.7;
  renderer.setPixelRatio(pr);
  composer.setPixelRatio(pr);
  const ms = quality === 'low' ? 1024 : 2048;
  if (moon.shadow.mapSize.x !== ms) {
    moon.shadow.mapSize.set(ms, ms);
    moon.shadow.map?.dispose();
    moon.shadow.map = null;
  }
  resize();
}
function resize() {
  renderer.setSize(innerWidth, innerHeight, false);
  composer.setSize(innerWidth, innerHeight);
  grade.uniforms.uRes.value.set(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  const h = innerHeight * renderer.getPixelRatio();
  game?.particles.setScale(h, camera.fov);
  game?.smoke.setScale(h, camera.fov);
}
addEventListener('resize', resize);

// ------------------------------------------------------------------ Jeu
let game;

const CHRONICLE = [
  'Retrouver la page perdue dans les ruines du bois',
  'Dissiper le voile d\'ombre de la gorge',
  'Fouiller la chapelle du cimetière',
  'Franchir la herse de Malbrume',
  'Faire taire les hurlements du village',
  'Charger les trois paratonnerres',
  'Entrer dans la cathédrale Sainte-Vesper',
  'Libérer l\'Ange de la Rosace',
];

class Game {
  constructor() {
    this.scene = scene;
    this.camera = camera;
    this.world = new World(scene);
    this.particles = new Particles(scene, 5000, true);
    this.smoke = new Particles(scene, 1500, false);
    this.lights = new LightManager(scene, 6, 5);
    this.player = new Player(scene);
    this.camCtl = new ThirdPersonCamera(camera);
    this.hud = new HUD(this);
    this.combat = new Combat(this);
    this.enemies = new EnemyManager(this);
    this.circles = new CircleFX(scene, this.world);
    this.trails = new Trails(scene);
    this.debris = new Debris(scene, this.world);
    this.world.attachFx(this.circles);
    this.ambience = new Ambience(scene, this.world, moonDir);
    addWind(this.world.barkMat, this.ambience.time, 0.004);
    this.boss = new Boss(this);
    this.extraUpdates = [];
    this.orbs = [];
    this.rnd = mulberry32(77);
    this.playerLight = new THREE.PointLight(0xa070ff, 3, 7, 2);
    scene.add(this.playerLight);
    this.state = 'title';
    this.t = 0;
    this.flags = {
      hasHoly: false, veilGone: false, hasShadow: false, passedGate: false,
      alphaDead: false, hasLightning: false, doorOpen: false, bossStarted: false, bossDead: false,
      gateHint: false, doorHint: false,
    };
    this.stats = { kills: 0, deaths: 0, casts: 0, time: 0 };
    this.zone = '';
    this.respawnLantern = this.world.lanterns[0];
    this.world.lightLantern(this.respawnLantern);
    this.player.place(POI.start);
    this.player.facing = Math.PI;
    this.camCtl.yaw = 0;

    // Pages du grimoire
    const sh = POI.shrine;
    this.world.addPickup('page', sh.x, sh.z - 2, this.world.getHeight(sh.x, sh.z) + 0.4).spell = 'holy';
    const ch = POI.chapel;
    this.world.addPickup('page', ch.x, ch.z - 2.6, this.world.getHeight(ch.x, ch.z) + 0.3).spell = 'shadow';
    for (const pk of this.world.pickups) this.world.decoratePickup(pk);

    this.setupSpawns();
    if (DEBUG) for (const k in this.player.unlocked) this.player.unlocked[k] = true;
  }

  targets() {
    const list = this.enemies.targets();
    if (this.boss.active && this.boss.alive && !this.boss.dying) list.push(this.boss);
    return list;
  }

  // ---------------------------------------------------------------- Apparitions
  setupSpawns() {
    const pl = () => this.player.pos;
    const near = (p, r) => () => pl().distanceTo(new THREE.Vector3(p[0], pl().y, p[1])) < r;
    const nearestGraves = (x, z, n) => this.world.graves
      .map((g) => ({ g, d: Math.hypot(g.x - x, g.z - z) }))
      .sort((a, b) => a.d - b.d).slice(0, n).map((e) => e.g);
    this.groups = [
      { when: () => pl().z < -12, spawn: [['wolf', 14, -42], ['wolf', -10, -46]] },
      { when: near([POI.shrine.x, POI.shrine.z], 24), spawn: [['skeleton', -24, -50, 'rise', 0], ['skeleton', -36, -54, 'rise', 0.5], ['skeleton', -28, -68, 'rise', 1.0]] },
      { when: () => this.flags.hasHoly, spawn: [['wolf', 14, -82], ['wolf', -14, -88], ['skeleton', 22, -66], ['skeleton', 24, -70], ['wolf', 30, -50]] },
      { when: () => pl().z < -60, spawn: [['skeleton', -6, -93], ['skeleton', 6, -91], ['archer', 0, -97]] },
      {
        when: () => pl().z < -132,
        spawn: () => {
          const gs = [...nearestGraves(-14, -150, 4), ...nearestGraves(14, -158, 4)];
          gs.forEach((g, i) => this.enemies.spawn('skeleton', g.x, g.z, { state: 'rise', delay: i * 0.35 }));
          this.enemies.spawn('archer', -24, -176);
          this.enemies.spawn('archer', 20, -150);
          this.hud.toast('La terre remue sous les tombes…');
        },
      },
      {
        when: () => this.flags.hasShadow,
        spawn: () => {
          nearestGraves(POI.chapel.x - 6, POI.chapel.z + 12, 6).forEach((g, i) => this.enemies.spawn('skeleton', g.x, g.z, { state: 'rise', delay: 0.3 + i * 0.3 }));
          this.enemies.spawn('wolf', -20, -185, { aggro: true });
          this.enemies.spawn('wolf', 0, -135, { aggro: true });
        },
      },
      {
        when: () => pl().z < -201,
        spawn: [['wolf', -26, -226], ['wolf', 30, -242], ['archer', -10, -236], ['archer', 12, -282], ['skeleton', 2, -226], ['skeleton', -3, -229], ['skeleton', 5, -231],
          ['archer', 30, -268], ['wolf', -30, -300], ['wolf', 25, -306], ['archer', -22, -318], ['skeleton', -6, -305], ['skeleton', 6, -308]],
      },
      {
        when: () => pl().distanceTo(new THREE.Vector3(POI.square.x, pl().y, POI.square.z)) < 24 && !this.flags.alphaDead,
        spawn: () => {
          this.alpha = this.enemies.spawn('alpha', -16, -276, { aggro: true });
          this.enemies.spawn('wolf', 18, -255, { aggro: true });
          this.enemies.spawn('wolf', 16, -272, { aggro: true });
          this.alphaHowl = false;
          this.hud.toast('Un hurlement glace le sang…');
          this.camCtl.shake = 0.6;
        },
      },
      {
        when: () => this.world.conduits.some((c) => c.powered),
        spawn: () => {
          for (const [x, z] of [[-10, -346], [10, -346], [-22, -336], [22, -336]]) this.enemies.spawn('skeleton', x, z, { state: 'rise', delay: this.rnd() });
          this.enemies.spawn('archer', -26, -350, { aggro: true });
          this.enemies.spawn('archer', 26, -350, { aggro: true });
          this.enemies.spawn('wolf', 0, -320, { aggro: true });
          this.hud.toast('La foudre réveille les gardiens du parvis !');
        },
      },
      {
        when: () => pl().z < -340,
        spawn: () => {
          for (const s of this.world.gargoyleSpots) {
            this.enemies.spawn('gargoyle', s.x, s.z, { state: 'dormant', y: s.y, facing: s.x < 0 ? Math.PI / 2 : -Math.PI / 2 });
          }
        },
      },
      { when: () => pl().z < -398, spawn: [['skeleton', -4, -418, 'rise', 0], ['skeleton', 4, -420, 'rise', 0.4], ['skeleton', -3, -440, 'rise', 0.8], ['skeleton', 3, -442, 'rise', 1.2], ['archer', 0, -462]] },
    ];
    for (const g of this.groups) g.done = false;
  }

  updateSpawns() {
    for (const g of this.groups) {
      if (g.done || !g.when()) continue;
      g.done = true;
      if (typeof g.spawn === 'function') g.spawn();
      else for (const [type, x, z, state, delay] of g.spawn) this.enemies.spawn(type, x, z, { state, delay });
    }
  }

  // ---------------------------------------------------------------- Évènements
  onPlayerHurt(n) {
    this.hud.hurt(n);
    this.camCtl.shake = Math.max(this.camCtl.shake, 0.35 + n / 60);
    const p = this.player.pos;
    this.smoke.burst(new THREE.Vector3(p.x, p.y + 1.2, p.z), 10, COL.blood, { speed: 3, size: 0.25, life: 0.5, gravity: 9, alpha: 0.9 });
    if (this.player.dead) this.onDeath();
  }

  onEnemyKilled(e) {
    this.stats.kills++;
    const c = e.center();
    const r = this.rnd();
    if (e.type === 'alpha') {
      this.flags.alphaDead = true;
      this.hud.setBoss(null);
      const pk = this.world.addPickup('page', e.pos.x, e.pos.z);
      pk.spell = 'lightning';
      this.world.decoratePickup(pk);
      this.hud.toast('La Bête s\'effondre. Une page brille dans sa fourrure.');
      this.spawnOrb(c, 'hp'); this.spawnOrb(c, 'hp'); this.spawnOrb(c, 'mana');
      return;
    }
    if (r < 0.32) this.spawnOrb(c, 'hp');
    else if (r < 0.75) this.spawnOrb(c, 'mana');
  }

  onVeilDispelled() {
    this.flags.veilGone = true;
    this.hud.toast('Le voile se déchire dans un cri silencieux.');
  }

  onConduitPowered(c) {
    if (c.powered) return;
    c.powered = true;
    this.circles.spawn({ pos: new THREE.Vector3(c.pos.x, 0, c.pos.z), radius: 2.2, color: 0x8fd0ff, symbol: 'lightning', life: Infinity, spin: 0.8, alpha: 0.7, pulse: 0.3, intensity: 1.8 });
    const n = this.world.conduits.filter((x) => x.powered).length;
    this.hud.toast(`Paratonnerre chargé (${n}/3)`);
    if (n === 3) {
      setTimeout(() => {
        this.world.doorOpen = true;
        this.world.door.enabled = false;
        this.flags.doorOpen = true;
        this.camCtl.shake = 0.8;
        this.hud.toast('Les portes de Sainte-Vesper s\'ouvrent dans un grondement.');
        for (const k of this.world.conduits) this.combat.bolt(k.pos, new THREE.Vector3(0, 9, POI.door.z + 1), 0.8, 0x9fe0ff, 0.08);
      }, 900);
    }
  }

  onBossPhase(phase) {
    this.hud.toast(phase === 2 ? 'Séraphine déploie ses ailes de verre !' : 'La Rosace saigne… Séraphine entre en fureur !');
  }

  onBossDefeated() {
    this.flags.bossDead = true;
    this.hud.setBoss(null);
    this.world.setSeal(false);
    for (const e of this.enemies.list) if (e.alive && e.state !== 'dying') e.takeDamage(9999, 'holy');
    this.dawn = 0;
    setTimeout(() => { $('#whiteout').style.opacity = 0.85; }, 200);
    setTimeout(() => { $('#whiteout').style.opacity = 0; }, 1600);
    setTimeout(() => this.showVictory(), 6500);
  }

  onDeath() {
    this.stats.deaths++;
    this.state = 'dead';
    document.exitPointerLock?.();
    setTimeout(() => $('#death').classList.remove('hidden'), 1200);
  }

  respawn() {
    const p = this.player;
    const l = this.respawnLantern;
    p.dead = false;
    p.hp = p.maxHp;
    p.mana = p.maxMana;
    p.invuln = 2;
    p.place(new THREE.Vector3(l.pos.x - 1.5, 0, l.pos.z - 1.2));
    this.world.col.unstick(p.pos, p.radius);
    this.combat.clearHostile();
    if (this.flags.bossStarted && !this.flags.bossDead) {
      this.flags.bossStarted = false;
      this.boss.reset();
      this.world.setSeal(false);
      for (const e of this.boss.summoned) if (e.alive) e.remove();
      this.boss.summoned = [];
      this.hud.setBoss(null);
    }
    if (this.alpha && this.alpha.alive && this.alpha.state !== 'dying') {
      // La Bête retourne au centre du village et récupère.
      this.alpha.hp = this.alpha.maxHp;
      this.alpha.pos.set(-16, 0, -276);
      this.alpha.state = 'idle';
      this.alpha.aggro = false;
      this.alphaHowl = false;
      this.hud.setBoss(null);
    }
    for (const e of this.enemies.list) if (e.state !== 'dormant' && e.state !== 'dying') { e.state = 'idle'; e.aggro = false; }
    $('#death').classList.add('hidden');
    this.state = 'playing';
    lock();
  }

  spawnOrb(pos, kind) {
    const mesh = makeOrb(kind === 'hp' ? 0xff3050 : 0x4a7dff);
    mesh.position.copy(pos);
    this.scene.add(mesh);
    this.orbs.push({ mesh, pos: pos.clone(), vel: new THREE.Vector3((this.rnd() - 0.5) * 4, 4, (this.rnd() - 0.5) * 4), kind, t: 0 });
  }

  pickupPage(pk) {
    const p = this.player, k = pk.spell;
    p.unlocked[k] = true;
    if (k !== 'shadow') p.selected = k;
    const sp = SPELLS[k];
    const hint = k === 'shadow' ? 'Appuyez sur <kbd>Espace</kbd> pour traverser l\'ombre' : `Appuyez sur <kbd>${sp.slot}</kbd> pour le préparer, <kbd>Clic gauche</kbd> pour le lancer`;
    this.hud.showPage(sp.name, hint);
    if (k === 'holy') this.flags.hasHoly = true;
    if (k === 'shadow') this.flags.hasShadow = true;
    if (k === 'lightning') this.flags.hasLightning = true;
    p.mana = p.maxMana;
    this.particles.burst(pk.mesh.position, 80, new THREE.Color(0xffd27a), { speed: 6, size: 0.4, life: 1, intensity: 2.5 });
    this.lights.flash(pk.mesh.position, 0xffd27a, 40, 15, 1);
  }

  // ---------------------------------------------------------------- Objectifs
  objective() {
    const f = this.flags, w = this.world;
    if (f.bossDead) return ['La malédiction est levée.', null];
    if (f.bossStarted) return ['Vainquez Séraphine, l\'Ange de la Rosace', null];
    if (f.doorOpen) return ['Entrez dans la cathédrale et rejoignez le chœur', POI.choir];
    if (f.hasLightning) {
      const left = w.conduits.filter((c) => !c.powered);
      const pp = this.player.pos;
      const t = left.sort((a, b) => a.pos.distanceTo(pp) - b.pos.distanceTo(pp))[0];
      return [`Chargez les paratonnerres du parvis avec la Chaîne de foudre (${3 - left.length}/3)`, t ? t.pos : POI.door];
    }
    if (f.alphaDead) return ['Ramassez la page tombée de la Bête', this.world.pickups.find((p) => p.alive && p.spell === 'lightning')?.pos];
    if (f.passedGate) return ['Des hurlements montent de la place du village. Trouvez-en la source.', POI.square];
    if (f.hasShadow) return ['Franchissez la herse de Malbrume grâce au Pas de l\'ombre', POI.gate];
    if (f.veilGone) return ['Traversez le cimetière et fouillez la chapelle funéraire', POI.chapel];
    if (f.hasHoly) return ['Dissipez le voile d\'ombre qui scelle la gorge avec la Lumière sacrée', POI.veil];
    return ['Retrouvez la page du grimoire perdue dans les ruines du bois', POI.shrine];
  }

  chronicleStep() {
    const f = this.flags;
    return [f.hasHoly, f.veilGone, f.hasShadow, f.passedGate, f.alphaDead && f.hasLightning, f.doorOpen, f.bossStarted, f.bossDead].findIndex((x) => !x);
  }

  // ---------------------------------------------------------------- Boucle
  update(dt) {
    const p = this.player, w = this.world;
    this.t += dt;
    this.stats.time += dt;

    // Choix des sorts
    for (const k of ['arcane', 'holy', 'lightning']) {
      if (input.pressed.has('Digit' + SPELLS[k].slot) && p.unlocked[k]) p.selected = k;
    }
    if (input.wheel) {
      const avail = ['arcane', 'holy', 'lightning'].filter((k) => p.unlocked[k]);
      const i = avail.indexOf(p.selected);
      p.selected = avail[(i + Math.sign(input.wheel) + avail.length) % avail.length];
    }
    p.setSpellColor(SPELLS[p.selected].color);
    this.playerLight.color.setHex(SPELLS[p.selected].color);

    this.camCtl.update(dt, input, p, w);
    p.aimPitch = this.camCtl.pitch;
    p.update(dt, input, this.camCtl.yaw, w);
    // Le boss est solide
    if (this.boss.alive && this.boss.m.root.visible) {
      const dx = p.pos.x - this.boss.pos.x, dz = p.pos.z - this.boss.pos.z, d = Math.hypot(dx, dz);
      if (d < 2.2 && d > 0.01) w.col.move(p.pos, (dx / d) * (2.2 - d), (dz / d) * (2.2 - d), p.radius);
    }

    const aim = this.computeAim();
    if (input.mouseDown && (document.pointerLockElement || input.free || DEBUG_NOLOCK) && !p.dead) this.combat.tryCast(p.selected, aim);
    if (input.pressed.has('Space')) {
      let dx = 0, dz = 0;
      const k = input.keys;
      const iz = (k.has('KeyW') || k.has('ArrowUp') ? -1 : 0) + (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
      const ix = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) + (k.has('KeyA') || k.has('ArrowLeft') ? -1 : 0);
      const yaw = this.camCtl.yaw;
      if (ix || iz) {
        dx = -Math.sin(yaw) * -iz + Math.cos(yaw) * ix;
        dz = -Math.cos(yaw) * -iz - Math.sin(yaw) * ix;
      } else { dx = -Math.sin(yaw); dz = -Math.cos(yaw); }
      if (!p.unlocked.shadow) this.hud.toast('Il vous manque une page du grimoire…');
      else this.combat.shadowStep(dx, dz);
    }

    this.updateSpawns();
    this.enemies.update(dt);
    this.boss.update(dt);
    this.combat.update(dt);
    this.extraUpdates = this.extraUpdates.filter((f) => f(dt));
    w.update(this.t, dt);
    this.updatePickups(dt);
    this.updateTriggers(dt);
    this.updateAmbient(dt);

    // Alpha : barre de boss et renforts
    if (this.alpha && this.alpha.alive && this.alpha.state !== 'dying' && this.alpha.aggro) {
      this.hud.setBoss(this.alpha.name, this.alpha.hp / this.alpha.maxHp);
      if (!this.alphaHowl && this.alpha.hp < this.alpha.maxHp * 0.5) {
        this.alphaHowl = true;
        this.enemies.spawn('wolf', -30, -250, { aggro: true });
        this.enemies.spawn('wolf', 30, -280, { aggro: true });
        this.hud.toast('La Bête hurle ! La meute accourt.');
        this.camCtl.shake = 0.7;
      }
    }
    if (this.flags.bossStarted && this.boss.alive && !this.boss.dying) this.hud.setBoss(this.boss.name, this.boss.hp / this.boss.maxHp);

    // Objectif et zone
    const [text, target] = this.objective();
    this.hud.setObjective(text);
    this.objectiveTarget = target;
    const zone = ZONES.find((zz) => zz.test(p.pos.z)).name;
    if (zone !== this.zone) { this.zone = zone; this.hud.showZone(zone); }
    this.hud.relics(p, Object.values(p.unlocked).filter(Boolean).length);

    // Lumières, brouillard, lune
    this.playerLight.position.set(p.pos.x - Math.cos(p.facing) * 0.9, p.pos.y + 2.4, p.pos.z + Math.sin(p.facing) * 0.9);
    this.playerLight.intensity = p.hidden ? 0 : 6 + p.castAnim * 8;
    this.lights.update(dt, this.t, p.pos, w.lightSpots);
    moon.position.copy(p.pos).addScaledVector(moonDir, 100);
    moon.target.position.copy(p.pos);
    this.updateFog(dt);
    w.updateFog(p.pos, this.t);
    w.followCamera(camera);
    this.particles.update(dt);
    this.smoke.update(dt);
    this.circles.update(dt);
    this.ambience.update(dt, camera.position);
    this.trails.update(dt, camera.position);
    this.debris.update(dt);
    this.hud.update(dt);
  }

  computeAim() {
    const cam = camera.position;
    const L = this.camCtl.dir(new THREE.Vector3());
    const minT = this.camCtl.curDist + 0.5;
    let bestT = 70, hitTarget = null;
    for (const t of this.targets()) {
      const c = t.center();
      const oc = c.clone().sub(cam);
      const tc = oc.dot(L);
      if (tc < minT) continue;
      const d2 = oc.lengthSq() - tc * tc;
      const r = t.radius + 0.35;
      if (d2 < r * r && tc < bestT) { bestT = tc - Math.sqrt(r * r - d2); hitTarget = t; }
    }
    // Sol et obstacles
    const w = this.world;
    for (let t = minT; t < bestT; t += 0.4) {
      const x = cam.x + L.x * t, y = cam.y + L.y * t, z = cam.z + L.z * t;
      if (y < w.getHeight(x, z) || w.col.solidAt(x, y, z, 0.05)) { bestT = t; hitTarget = null; break; }
    }
    this.aimTarget = hitTarget;
    return cam.clone().addScaledVector(L, bestT);
  }

  updatePickups(dt) {
    const p = this.player, w = this.world;
    const pp = new THREE.Vector3(p.pos.x, p.pos.y + 1, p.pos.z);
    for (const pk of w.pickups) {
      if (!pk.alive) continue;
      const d = Math.hypot(pk.pos.x - p.pos.x, pk.pos.z - p.pos.z);
      if (d < 1.6 && !p.dead) {
        w.removePickup(pk);
        if (pk.kind === 'page') this.pickupPage(pk);
        else if (pk.kind === 'fiole') {
          p.relics.fiole++; p.maxHp += 20; p.hp = p.maxHp;
          this.hud.toast('Fiole écarlate : vie maximale augmentée (+20)');
        } else if (pk.kind === 'encre') {
          p.relics.encre++; p.maxMana += 20; p.mana = p.maxMana;
          this.hud.toast('Encre d\'étoile : mana maximal augmenté (+20)');
        }
        if (pk.kind !== 'page') this.particles.burst(pk.mesh.position, 40, new THREE.Color(pk.kind === 'fiole' ? 0xff3050 : 0x4a7dff), { speed: 4, size: 0.35, life: 0.8, intensity: 2.5 });
      }
    }
    for (const o of this.orbs) {
      o.t += dt;
      const d = o.pos.distanceTo(pp);
      if (o.t > 0.5 && d < 6) {
        o.vel.lerp(pp.clone().sub(o.pos).normalize().multiplyScalar(14), Math.min(1, dt * 6));
      } else {
        o.vel.y -= 12 * dt;
        o.vel.multiplyScalar(Math.exp(-1.5 * dt));
      }
      o.pos.addScaledVector(o.vel, dt);
      const gy = w.getHeight(o.pos.x, o.pos.z) + 0.4;
      if (o.pos.y < gy) { o.pos.y = gy; o.vel.y = Math.abs(o.vel.y) * 0.3; }
      o.mesh.position.copy(o.pos);
      o.mesh.rotation.y += dt * 3;
      if (Math.random() < 0.3) this.particles.emit(o.pos.x, o.pos.y, o.pos.z, 0, 0.6, 0, o.kind === 'hp' ? new THREE.Color(0xff3050) : new THREE.Color(0x4a7dff), 0.25, 0.4, { intensity: 2 });
      if ((o.t > 0.5 && d < 0.9) || o.t > 25) {
        o.dead = true;
        this.scene.remove(o.mesh);
        if (o.t <= 25) {
          if (o.kind === 'hp') p.hp = Math.min(p.maxHp, p.hp + 15);
          else p.mana = Math.min(p.maxMana, p.mana + 30);
        }
      }
    }
    this.orbs = this.orbs.filter((o) => !o.dead);
  }

  updateTriggers() {
    const p = this.player, f = this.flags, w = this.world;
    // Lanternes
    let prompt = null;
    for (const l of w.lanterns) {
      if (Math.hypot(l.pos.x - p.pos.x, l.pos.z - p.pos.z) < 2.6 && !p.dead) {
        prompt = l.lit ? '<kbd>E</kbd> Se recueillir (restaure vie et mana)' : '<kbd>E</kbd> Allumer la lanterne de veille';
        if (input.pressed.has('KeyE')) {
          if (!l.lit) {
            w.lightLantern(l);
            this.hud.toast(`Lanterne allumée : ${l.name}`);
          } else this.hud.toast('Vous reprenez des forces.');
          this.respawnLantern = l;
          p.hp = p.maxHp;
          p.mana = p.maxMana;
          this.particles.burst(new THREE.Vector3(l.pos.x + 0.42, l.pos.y + 1.85, l.pos.z), 40, new THREE.Color(0x7ab8ff), { speed: 3, size: 0.35, life: 1, intensity: 2.5 });
        }
      }
    }
    this.hud.prompt(prompt);

    if (!f.passedGate && p.pos.z < -197.5) { f.passedGate = true; }
    if (!f.gateHint && !p.unlocked.shadow && Math.hypot(p.pos.x, p.pos.z - POI.gate.z) < 6) {
      f.gateHint = true;
      this.hud.toast('Une herse rouillée barre la route. Seule une ombre pourrait s\'y faufiler…');
    }
    if (!f.doorHint && !f.doorOpen && Math.hypot(p.pos.x, p.pos.z - POI.door.z) < 7) {
      f.doorHint = true;
      this.hud.toast('Les portes sont scellées. Des câbles de cuivre courent vers les paratonnerres.');
    }
    if (!f.bossStarted && !f.bossDead && p.pos.z < -476 && !p.dead) {
      f.bossStarted = true;
      w.setSeal(true);
      this.boss.start();
      this.hud.showZone('Séraphine, l\'Ange de la Rosace');
      this.camCtl.shake = 0.8;
    }
  }

  updateAmbient(dt) {
    const p = this.player.pos;
    const z = p.z;
    const kind = z > -124 ? 'fireflies' : z > -197 ? 'wisps' : z > -353 ? 'embers' : 'dust';
    const rate = kind === 'dust' ? 18 : 10;
    const n = Math.random() < rate * dt ? 1 : 0;
    for (let i = 0; i < n + (Math.random() < rate * dt ? 1 : 0); i++) {
      const x = p.x + (Math.random() - 0.5) * 40, zz = p.z + (Math.random() - 0.5) * 40;
      const y = this.world.getHeight(x, zz) + 0.5 + Math.random() * 4;
      if (kind === 'fireflies' && Math.random() < 0.5) {
        // Feuilles mortes qui tombent en tournoyant
        this.smoke.emit(x, y + 4, zz, (Math.random() - 0.5) * 1.2, -0.6 - Math.random() * 0.4, (Math.random() - 0.5) * 1.2, new THREE.Color(0x4a3420), 0.16, 7, { sizeEnd: 0.14, drag: 0.8, alpha: 0.9 });
      }
      if (kind === 'fireflies') this.particles.emit(x, y, zz, (Math.random() - 0.5) * 0.6, (Math.random() - 0.5) * 0.3, (Math.random() - 0.5) * 0.6, new THREE.Color(0xc8ff6a), 0.18, 5, { intensity: 2.2, sizeEnd: 0.1 });
      else if (kind === 'wisps') this.particles.emit(x, y * 0.5, zz, (Math.random() - 0.5) * 0.4, 0.15, (Math.random() - 0.5) * 0.4, new THREE.Color(0x6ab8ff), 0.35, 5, { intensity: 1.6, sizeEnd: 0.1 });
      else if (kind === 'embers') this.particles.emit(x, y * 0.4, zz, (Math.random() - 0.5) * 0.5, 0.6 + Math.random() * 0.6, (Math.random() - 0.5) * 0.5, new THREE.Color(0xff7a2a), 0.12, 4, { intensity: 2.5, sizeEnd: 0.02 });
      else this.particles.emit(x, 1 + Math.random() * 10, zz, (Math.random() - 0.5) * 0.15, -0.05, (Math.random() - 0.5) * 0.15, new THREE.Color(0xd8d0ff), 0.08, 6, { intensity: 1, sizeEnd: 0.08, alpha: 0.6 });
    }
  }

  updateFog(dt) {
    const z = this.player.pos.z;
    let f = this.dawn !== undefined ? FOG.dawn : z > -197 ? FOG.forest : z > -353 ? FOG.village : FOG.cathedral;
    if (this.dawn !== undefined) {
      this.dawn = Math.min(1, this.dawn + dt * 0.15);
      const k = this.dawn;
      const sky = this.world.skyMat.uniforms;
      sky.uHorizon.value.lerpColors(new THREE.Color(0x0d121c), new THREE.Color(0x8a6060), k);
      sky.uTop.value.lerpColors(new THREE.Color(0x03040a), new THREE.Color(0x2a3a60), k);
      this.ambience.setDawn(k);
      grade.uniforms.uShadow.value.set(0.03 * k, 0.05 * (1 - k), 0.075 * (1 - k));
      grade.uniforms.uHigh.value.set(0.06 + 0.04 * k, 0.03 + 0.02 * k, -0.015);
      hemi.intensity = 0.75 + k * 0.8;
      moon.color.lerpColors(new THREE.Color(0x9fb2e0), new THREE.Color(0xffc8a0), k);
      this.world.roseMat.color.setScalar(1.1 + k * 0.8);
      this.world.stars.material.opacity = 0.8 * (1 - k);
    }
    const fog = scene.fog;
    const target = new THREE.Color(f[0]);
    fog.color.lerp(target, 1 - Math.exp(-dt * 1.5));
    fog.density = damp(fog.density, f[1], 1.5, dt);
    if (this.dawn === undefined) this.world.skyMat.uniforms.uHorizon.value.copy(fog.color);
  }

  showVictory() {
    this.state = 'victory';
    document.exitPointerLock?.();
    const s = this.stats, p = this.player;
    const mm = Math.floor(s.time / 60), ss = Math.floor(s.time % 60).toString().padStart(2, '0');
    $('#stats').innerHTML = `
      <div><span>${mm}:${ss}</span>Durée</div>
      <div><span>${s.kills}</span>Créatures vaincues</div>
      <div><span>${s.deaths}</span>Morts</div>
      <div><span>${s.casts}</span>Sorts lancés</div>
      <div><span>${p.relics.fiole}/3</span>Fioles écarlates</div>
      <div><span>${p.relics.encre}/3</span>Encres d'étoile</div>`;
    $('#victory').classList.remove('hidden');
    this.hud.show(false);
  }

  renderGrimoire() {
    const p = this.player;
    this.sigils = this.sigils || {};
    $('#spell-pages').innerHTML = ['arcane', 'holy', 'lightning', 'shadow'].map((k) => {
      const s = SPELLS[k], ok = p.unlocked[k];
      const sig = this.sigils[k + ok] || (this.sigils[k + ok] = circleDataURL(ok ? '#5a1a0c' : '#9a8a6a', k, 200));
      const key = k === 'shadow' ? 'Espace' : s.slot;
      return `<div class="spage ${ok ? '' : 'locked'}"><div class="ico"><img class="sig" src="${sig}" alt="">${ok ? ICONS[k] : ''}</div><div>
        <div class="t">${ok ? s.name : 'Page manquante'}</div>
        ${ok ? `<div class="meta">Touche ${key} · ${s.mana} mana</div><p>${s.desc}</p>` : '<p>Une page arrachée. Elle doit se trouver quelque part dans la vallée…</p>'}
      </div></div>`;
    }).join('');
    const step = this.chronicleStep();
    $('#chronicle').innerHTML = CHRONICLE.map((c, i) => (i < step || step === -1 ? `<p class="done">${c}</p>` : i === step ? `<p><b>${c}</b></p>` : '')).join('');
    $('#relic-list').innerHTML = `<p>Fioles écarlates : ${p.relics.fiole}/3 (vie max ${p.maxHp})<br>Encres d'étoile : ${p.relics.encre}/3 (mana max ${p.maxMana})</p>`;
  }
}

// ------------------------------------------------------------------ Écrans et boucle
function setScreen(id) {
  for (const s of ['#title', '#pause', '#grimoire', '#death', '#victory']) $(s).classList.add('hidden');
  if (id) $(id).classList.remove('hidden');
}

function lock() {
  if (input.free) return;
  try {
    const r = canvas.requestPointerLock?.();
    r?.catch?.(() => enableFreeMouse());
    if (!canvas.requestPointerLock) enableFreeMouse();
  } catch (_) { enableFreeMouse(); }
}

function enableFreeMouse() {
  if (input.free) return;
  input.free = true;
  document.body.classList.add('free-mouse');
  game?.hud.toast('Souris non capturée : approchez le curseur des bords de l\'écran pour tourner la caméra.');
}
document.addEventListener('pointerlockerror', enableFreeMouse);

// En souris libre, le curseur près d'un bord fait pivoter la caméra.
function edgeTurn(dt) {
  if (!input.free || game.state !== 'playing') return;
  const e = 0.08;
  const fx = input.mx < e ? (input.mx - e) / e : input.mx > 1 - e ? (input.mx - (1 - e)) / e : 0;
  const fy = input.my < e ? (input.my - e) / e : input.my > 1 - e ? (input.my - (1 - e)) / e : 0;
  input.mouseDX += fx * 900 * dt * input.sens;
  input.mouseDY += fy * 500 * dt * input.sens * (input.invert ? -1 : 1);
  if (input.pressed.has('Escape')) { game.state = 'paused'; setScreen('#pause'); }
}

document.addEventListener('pointerlockchange', () => {
  if (!game) return;
  if (!document.pointerLockElement && game.state === 'playing' && !DEBUG_NOLOCK) {
    game.state = 'paused';
    setScreen('#pause');
  }
});
let DEBUG_NOLOCK = false;

$('#btn-start').addEventListener('click', () => {
  game.camCtl.yaw = 0;
  game.camCtl.pitch = 0.22;
  game.state = 'playing';
  setScreen(null);
  game.hud.show(true);
  game.hud.showZone(game.zone || ZONES[0].name);
  lock();
});
$('#btn-resume').addEventListener('click', () => { game.state = 'playing'; setScreen(null); lock(); });
$('#btn-respawn').addEventListener('click', () => game.respawn());
$('#btn-again').addEventListener('click', () => location.reload());
canvas.addEventListener('click', () => { if (game?.state === 'playing' && !document.pointerLockElement) lock(); });
$('#opt-sens').addEventListener('input', (e) => { input.sens = +e.target.value; });
$('#opt-invert').addEventListener('change', (e) => { input.invert = e.target.checked; });
$('#opt-quality').addEventListener('change', (e) => { quality = e.target.value; applyQuality(); });

function toggleGrimoire() {
  if (game.state === 'playing') {
    game.state = 'grimoire';
    game.renderGrimoire();
    setScreen('#grimoire');
    document.exitPointerLock?.();
  } else if (game.state === 'grimoire') {
    game.state = 'playing';
    setScreen(null);
    lock();
  }
}

const clock = new THREE.Clock();
function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(clock.getDelta(), 1 / 20);
  if (input.pressed.has('Tab') || (input.pressed.has('KeyG') && !DEBUG)) toggleGrimoire();
  if (input.pressed.has('Escape') && game.state === 'grimoire') toggleGrimoire();
  if (DEBUG) debugKeys();
  edgeTurn(dt);
  if (game.state === 'playing' || game.state === 'dead') {
    game.update(dt);
  } else if (game.state === 'title') {
    // Caméra d'introduction qui tourne lentement.
    game.camCtl.yaw += dt * 0.05;
    game.camCtl.update(dt, { mouseDX: 0, mouseDY: 0, wheel: 0 }, game.player, game.world);
    game.player.animate(dt);
    game.world.update(game.t += dt, dt);
    game.lights.update(dt, game.t, game.player.pos, game.world.lightSpots);
    game.world.followCamera(camera);
    game.world.updateFog(game.player.pos, game.t);
    game.updateAmbient(dt);
    game.particles.update(dt);
    game.circles.update(dt);
    game.ambience.update(dt, camera.position);
  } else if (game.state === 'victory') {
    game.update(dt * 0.5);
  }
  input.pressed.clear();
  input.mouseDX = input.mouseDY = 0;
  input.wheel = 0;
  input.clicked = false;
  grade.uniforms.uTime.value = performance.now() / 1000;
  grade.uniforms.uHurt.value = game.state === 'dead' ? 0.8 : Math.min(1, game.hud.hurtV * 0.8);
  renderer.info.reset();
  composer.render();
  game.rinfo = { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles };
}

function debugKeys() {
  const tp = { F2: 0, F3: 1, F4: 2, F5: 3, F6: 4 };
  for (const [k, i] of Object.entries(tp)) {
    if (input.pressed.has(k)) {
      const l = game.world.lanterns[i];
      game.player.place(new THREE.Vector3(l.pos.x - 1.5, 0, l.pos.z - 1.5));
      game.respawnLantern = l;
    }
  }
  if (input.pressed.has('KeyG')) { game.player.maxHp = game.player.hp = 9999; game.hud.toast('Mode dieu'); }
}

// Démarrage
game = new Game();
window.game = game;
game.hud.decorate();
window.__debug = { setNoLock: (v) => { DEBUG_NOLOCK = v; }, input, THREE };
applyQuality();
resize();
game.hud.showZone(ZONES[0].name);
$('#loading').classList.add('done');
if (matchMedia('(pointer: coarse)').matches && !matchMedia('(pointer: fine)').matches) {
  $('#touch-note').hidden = false;
}
const startBtn = $('#btn-start');
startBtn.disabled = false;
startBtn.textContent = 'Commencer la chasse';
frame();
