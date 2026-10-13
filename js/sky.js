// Ciel animé : un <canvas> plein écran qui dessine la météo courante.
// Scènes : clear, partly, overcast, fog, drizzle, rain, snow, storm — de jour ou de nuit.

const rand = (a, b) => a + Math.random() * (b - a);
const TAU = Math.PI * 2;

export function createSky(canvas) {
  const ctx = canvas.getContext("2d");
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let w = 0, h = 0, dpr = 1;
  let scene = { kind: "clear", isDay: true, intensity: 0.5, wind: 0.2 };
  let stars = [], clouds = [], drops = [], flakes = [], fogBands = [], splashes = [];
  let shooting = null, flash = 0, bolt = null, nextBolt = 0;
  let last = performance.now(), raf = 0, t = 0;

  function resize() {
    dpr = Math.min(2, devicePixelRatio || 1);
    w = innerWidth; h = innerHeight;
    canvas.width = w * dpr; canvas.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    build();
  }

  // Nuage pré-rendu dans un canvas hors écran (beaucoup plus rapide à redessiner)
  function makeCloud(scale, tone, alpha) {
    const cw = 420 * scale, ch = 200 * scale;
    const c = document.createElement("canvas");
    c.width = cw; c.height = ch;
    const g = c.getContext("2d");
    const puffs = 9 + Math.floor(Math.random() * 6);
    for (let i = 0; i < puffs; i++) {
      const px = rand(0.18, 0.82) * cw;
      const py = (0.62 - Math.sin((px / cw) * Math.PI) * rand(0.15, 0.3)) * ch;
      const r = rand(0.12, 0.24) * cw * (0.6 + Math.sin((px / cw) * Math.PI) * 0.5);
      const grd = g.createRadialGradient(px, py, 0, px, py, r);
      grd.addColorStop(0, `rgba(${tone},${alpha})`);
      grd.addColorStop(0.6, `rgba(${tone},${alpha * 0.6})`);
      grd.addColorStop(1, `rgba(${tone},0)`);
      g.fillStyle = grd;
      g.beginPath(); g.arc(px, py, r, 0, TAU); g.fill();
    }
    return c;
  }

  function build() {
    const { kind, isDay, intensity } = scene;
    const area = (w * h) / (1280 * 800);

    stars = [];
    if (!isDay && (kind === "clear" || kind === "partly")) {
      const n = Math.round(260 * area);
      for (let i = 0; i < n; i++) stars.push({
        x: Math.random() * w, y: Math.random() * h * 0.8,
        r: Math.random() < 0.08 ? rand(1.2, 1.8) : rand(0.3, 1.1),
        p: Math.random() * TAU, s: rand(0.5, 2),
      });
    }

    clouds = [];
    const cloudCount = { clear: 0, partly: 5, overcast: 11, fog: 4, drizzle: 9, rain: 11, snow: 9, storm: 12 }[kind] || 0;
    const dark = kind === "storm" || kind === "rain";
    const tone = isDay ? (dark ? "150,160,175" : kind === "overcast" ? "215,222,230" : "255,255,255")
                       : (dark ? "45,50,62" : "95,105,125");
    const alpha = isDay ? (kind === "partly" ? 0.85 : 0.7) : 0.55;
    for (let i = 0; i < cloudCount; i++) {
      const scale = rand(0.7, 1.5) * Math.max(0.6, Math.min(1.2, w / 1100));
      clouds.push({
        img: makeCloud(scale, tone, alpha),
        x: rand(-0.3, 1.1) * w,
        y: kind === "partly" ? rand(0.02, 0.4) * h : rand(-0.08, 0.45) * h,
        v: rand(6, 16) * (0.6 + scene.wind),
      });
    }

    drops = [];
    if (kind === "rain" || kind === "drizzle" || kind === "storm") {
      const n = Math.round((kind === "drizzle" ? 140 : 380) * (0.5 + intensity) * area);
      for (let i = 0; i < n; i++) drops.push(newDrop(true));
    }

    flakes = [];
    if (kind === "snow") {
      const n = Math.round(260 * (0.5 + intensity) * area);
      for (let i = 0; i < n; i++) flakes.push({
        x: Math.random() * w, y: Math.random() * h, r: rand(1, 3.6),
        v: rand(25, 70), sway: rand(0.5, 1.6), p: Math.random() * TAU, o: rand(0.5, 1),
      });
    }

    fogBands = [];
    if (kind === "fog") {
      for (let i = 0; i < 7; i++) fogBands.push({
        y: rand(0.15, 1) * h, hgt: rand(0.12, 0.3) * h, x: Math.random() * w, v: rand(8, 22), o: rand(0.12, 0.28),
      });
    }
  }

  function newDrop(anywhere) {
    const heavy = scene.kind !== "drizzle";
    return {
      x: rand(-0.2, 1.1) * w,
      y: anywhere ? Math.random() * h : rand(-80, -10),
      len: heavy ? rand(14, 28) : rand(6, 12),
      v: heavy ? rand(900, 1300) : rand(450, 650),
      o: rand(0.25, 0.6),
    };
  }

  function makeBolt() {
    const pts = [[rand(0.15, 0.85) * w, 0]];
    let [x, y] = pts[0];
    while (y < h * rand(0.45, 0.8)) {
      x += rand(-40, 40); y += rand(18, 45);
      pts.push([x, y]);
    }
    return { pts, life: 1 };
  }

  // ---- dessin ----
  function drawSun(dt) {
    const x = w * 0.82, y = h * 0.13, R = Math.min(w, h) * 0.09;
    const glow = ctx.createRadialGradient(x, y, 0, x, y, R * 6);
    glow.addColorStop(0, "rgba(255,248,220,0.9)");
    glow.addColorStop(0.12, "rgba(255,236,170,0.55)");
    glow.addColorStop(0.4, "rgba(255,220,140,0.12)");
    glow.addColorStop(1, "rgba(255,220,140,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, w, h);
    // rayons qui tournent lentement
    ctx.save();
    ctx.translate(x, y); ctx.rotate(t * 0.03);
    for (let i = 0; i < 12; i++) {
      ctx.rotate(TAU / 12);
      const g = ctx.createLinearGradient(0, 0, R * 7, 0);
      g.addColorStop(0, "rgba(255,245,210,0.16)");
      g.addColorStop(1, "rgba(255,245,210,0)");
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(R * 7, -R * 0.35); ctx.lineTo(R * 7, R * 0.35); ctx.fill();
    }
    ctx.restore();
    ctx.fillStyle = "rgba(255,253,240,0.95)";
    ctx.beginPath(); ctx.arc(x, y, R * 0.55, 0, TAU); ctx.fill();
  }

  function drawMoon() {
    const x = w * 0.8, y = h * 0.15, R = Math.min(w, h) * 0.045;
    const glow = ctx.createRadialGradient(x, y, 0, x, y, R * 7);
    glow.addColorStop(0, "rgba(220,230,255,0.35)");
    glow.addColorStop(1, "rgba(220,230,255,0)");
    ctx.fillStyle = glow; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "#f4f1e6";
    ctx.beginPath(); ctx.arc(x, y, R, 0, TAU); ctx.fill();
    ctx.fillStyle = "rgba(180,175,160,0.35)";
    for (const [dx, dy, r] of [[-0.3, -0.2, 0.22], [0.25, 0.3, 0.16], [0.1, -0.4, 0.1], [-0.15, 0.4, 0.12]]) {
      ctx.beginPath(); ctx.arc(x + dx * R, y + dy * R, r * R, 0, TAU); ctx.fill();
    }
  }

  function drawStars(dt) {
    for (const s of stars) {
      const a = 0.45 + 0.55 * Math.sin(s.p + t * s.s);
      ctx.fillStyle = `rgba(255,255,255,${a})`;
      ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, TAU); ctx.fill();
    }
    // étoile filante occasionnelle
    if (!shooting && Math.random() < dt * 0.12) {
      shooting = { x: rand(0.1, 0.7) * w, y: rand(0.05, 0.35) * h, vx: rand(500, 800), vy: rand(180, 300), life: 1 };
    }
    if (shooting) {
      const s = shooting;
      s.x += s.vx * dt; s.y += s.vy * dt; s.life -= dt * 1.3;
      const g = ctx.createLinearGradient(s.x, s.y, s.x - s.vx * 0.18, s.y - s.vy * 0.18);
      g.addColorStop(0, `rgba(255,255,255,${Math.max(0, s.life)})`);
      g.addColorStop(1, "rgba(255,255,255,0)");
      ctx.strokeStyle = g; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(s.x - s.vx * 0.18, s.y - s.vy * 0.18); ctx.stroke();
      if (s.life <= 0) shooting = null;
    }
  }

  function drawClouds(dt) {
    for (const c of clouds) {
      c.x += c.v * dt;
      if (c.x > w + 50) c.x = -c.img.width - rand(0, 200);
      ctx.drawImage(c.img, c.x, c.y);
    }
  }

  function drawRain(dt) {
    const slant = 0.12 + scene.wind * 0.35;
    ctx.lineCap = "round";
    ctx.lineWidth = scene.kind === "drizzle" ? 1 : 1.3;
    for (let i = 0; i < drops.length; i++) {
      const d = drops[i];
      d.y += d.v * dt; d.x += d.v * slant * dt;
      if (d.y > h) {
        if (scene.kind !== "drizzle" && Math.random() < 0.3) splashes.push({ x: d.x, y: h - rand(0, 30), r: 0, life: 1 });
        drops[i] = newDrop(false);
        continue;
      }
      ctx.strokeStyle = `rgba(200,220,255,${d.o})`;
      ctx.beginPath(); ctx.moveTo(d.x, d.y); ctx.lineTo(d.x - d.len * slant, d.y - d.len); ctx.stroke();
    }
    ctx.lineWidth = 1;
    splashes = splashes.filter(s => {
      s.r += dt * 40; s.life -= dt * 3;
      ctx.strokeStyle = `rgba(200,220,255,${Math.max(0, s.life) * 0.4})`;
      ctx.beginPath(); ctx.ellipse(s.x, s.y, s.r, s.r * 0.3, 0, 0, TAU); ctx.stroke();
      return s.life > 0;
    });
  }

  function drawSnow(dt) {
    for (const f of flakes) {
      f.y += f.v * dt; f.p += dt * f.sway;
      f.x += (Math.sin(f.p) * 20 + scene.wind * 40) * dt;
      if (f.y > h + 5) { f.y = -5; f.x = Math.random() * w; }
      if (f.x > w + 5) f.x = -5;
      ctx.fillStyle = `rgba(255,255,255,${f.o})`;
      ctx.beginPath(); ctx.arc(f.x, f.y, f.r, 0, TAU); ctx.fill();
    }
  }

  function drawFog(dt) {
    for (const b of fogBands) {
      b.x = (b.x + b.v * dt) % w;
      for (const ox of [b.x - w, b.x]) {
        const g = ctx.createLinearGradient(0, b.y - b.hgt, 0, b.y + b.hgt);
        const tone = scene.isDay ? "235,238,242" : "120,128,140";
        g.addColorStop(0, `rgba(${tone},0)`);
        g.addColorStop(0.5, `rgba(${tone},${b.o})`);
        g.addColorStop(1, `rgba(${tone},0)`);
        ctx.fillStyle = g;
        ctx.fillRect(ox, b.y - b.hgt, w, b.hgt * 2);
      }
    }
  }

  function drawStorm(dt) {
    if (t > nextBolt) {
      bolt = makeBolt(); flash = 1;
      nextBolt = t + rand(2.5, 7);
    }
    if (flash > 0) {
      ctx.fillStyle = `rgba(230,235,255,${flash * 0.35})`;
      ctx.fillRect(0, 0, w, h);
      flash -= dt * 2.5;
    }
    if (bolt) {
      ctx.strokeStyle = `rgba(240,245,255,${bolt.life})`;
      ctx.lineWidth = 2.5; ctx.shadowColor = "#cfe0ff"; ctx.shadowBlur = 18;
      ctx.beginPath();
      bolt.pts.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
      ctx.stroke();
      ctx.shadowBlur = 0;
      bolt.life -= dt * 3;
      if (bolt.life <= 0) bolt = null;
    }
  }

  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now; t += dt;
    ctx.clearRect(0, 0, w, h);
    const { kind, isDay } = scene;
    if (isDay && (kind === "clear" || kind === "partly")) drawSun(dt);
    if (!isDay && (kind === "clear" || kind === "partly")) { drawStars(dt); drawMoon(); }
    drawClouds(dt);
    if (kind === "fog") drawFog(dt);
    if (kind === "storm") drawStorm(dt);
    if (drops.length) drawRain(dt);
    if (flakes.length) drawSnow(dt);
    if (!reduceMotion) raf = requestAnimationFrame(frame);
  }

  function start() {
    cancelAnimationFrame(raf);
    last = performance.now();
    raf = requestAnimationFrame(frame);
  }

  addEventListener("resize", resize);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) cancelAnimationFrame(raf); else start();
  });
  resize();
  start();

  return {
    setScene(next) {
      scene = { ...scene, ...next };
      flash = 0; bolt = null; nextBolt = t + 1.5; splashes = [];
      build();
      if (reduceMotion) start();
    },
  };
}
