// Graphiques SVG faits main : température (ligne + aire) et risque de pluie (barres).
const tip = () => document.getElementById("tooltip");
const H = 230, M = { t: 14, r: 10, b: 28, l: 34 };
const toMs = s => Date.parse(s + ":00Z");

function niceTicks(min, max, count = 4) {
  const step0 = (max - min) / count || 1;
  const mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 2.5, 5, 10].map(s => s * mag).find(s => s >= step0);
  const lo = Math.floor(min / step) * step, hi = Math.ceil(max / step) * step;
  const out = [];
  for (let v = lo; v <= hi + 1e-9; v += step) out.push(+v.toFixed(6));
  return out;
}

function window48(x) {
  const end = Math.min(x.H.time.length, x.idx + 48);
  const idx = [];
  for (let i = x.idx; i < end; i++) idx.push(i);
  return idx;
}

// Bandes sombres pour les heures de nuit
function nightBands(idx, H, xAt, step) {
  let s = "", start = null;
  idx.forEach((i, k) => {
    const night = !H.is_day[i];
    if (night && start == null) start = k;
    if ((!night || k === idx.length - 1) && start != null) {
      const endK = night ? k : k - 1;
      const x0 = Math.max(M.l, xAt(start) - step / 2), x1 = xAt(endK) + step / 2;
      s += `<rect class="night" x="${x0}" y="${M.t}" width="${Math.max(0, x1 - x0)}" height="${H_ - M.t - M.b}"/>`;
      start = null;
    }
  });
  return s;
}
let H_ = H;

function axisX(idx, Hh, xAt, W, hh) {
  const every = W < 520 ? 6 : 3;
  return idx.map((i, k) => {
    const t = toMs(Hh.time[i]);
    const hour = new Date(t).getUTCHours();
    if (hour % every !== 0) return "";
    const lbl = hour === 0 ? new Date(t).toLocaleDateString("fr-FR", { weekday: "short", timeZone: "UTC" }) : hh(t);
    return `<text x="${xAt(k)}" y="${H - 8}" text-anchor="middle" ${hour === 0 ? 'style="font-weight:700;fill:rgba(255,255,255,.85)"' : ""}>${lbl}</text>`;
  }).join("");
}

function axisY(ticks, yAt, W, fmt) {
  return ticks.map(v => `<line class="gridline" x1="${M.l}" x2="${W - M.r}" y1="${yAt(v)}" y2="${yAt(v)}"/>
    <text x="${M.l - 6}" y="${yAt(v) + 4}" text-anchor="end">${fmt(v)}</text>`).join("");
}

function hover(el, n, xAt, step, W, onIndex, html) {
  const svg = el.querySelector("svg");
  const hl = el.querySelector(".hl");
  const t = tip();
  const move = e => {
    const rect = svg.getBoundingClientRect();
    const px = (e.clientX - rect.left) * (W / rect.width);
    const k = Math.max(0, Math.min(n - 1, Math.round((px - xAt(0)) / step)));
    hl.innerHTML = onIndex(k);
    t.innerHTML = html(k);
    t.style.display = "block";
    const tw = t.offsetWidth, th = t.offsetHeight;
    let left = e.clientX + 14;
    if (left + tw > innerWidth - 8) left = e.clientX - tw - 14;
    t.style.left = Math.max(8, left) + "px";
    t.style.top = Math.max(8, e.clientY - th - 12) + "px";
  };
  const leave = () => { t.style.display = "none"; hl.innerHTML = ""; };
  svg.addEventListener("pointermove", move);
  svg.addEventListener("pointerdown", move);
  svg.addEventListener("pointerleave", leave);
  svg.addEventListener("pointercancel", leave);
}

function temperature(el, x, { T, deg, hh, icon, label }) {
  const Hh = x.H;
  const idx = window48(x);
  if (idx.length < 2) { el.innerHTML = ""; return; }
  const W = Math.max(300, el.clientWidth);
  H_ = H;
  const temps = idx.map(i => T(Hh.temperature_2m[i]));
  const feels = idx.map(i => T(Hh.apparent_temperature[i]));
  const ticks = niceTicks(Math.min(...temps, ...feels), Math.max(...temps, ...feels));
  const y0 = ticks[0], y1 = ticks.at(-1);
  const step = (W - M.l - M.r) / (idx.length - 1);
  const xAt = k => M.l + k * step;
  const yAt = v => M.t + (1 - (v - y0) / (y1 - y0 || 1)) * (H - M.t - M.b);
  const line = arr => arr.map((v, k) => `${k ? "L" : "M"}${xAt(k).toFixed(1)},${yAt(v).toFixed(1)}`).join("");
  const area = `${line(temps)}L${xAt(idx.length - 1)},${H - M.b}L${xAt(0)},${H - M.b}Z`;
  // Étiquettes directes : max et min de la période
  const kMax = temps.indexOf(Math.max(...temps)), kMin = temps.indexOf(Math.min(...temps));
  const lab = (k, above) => `<text x="${xAt(k)}" y="${yAt(temps[k]) + (above ? -10 : 18)}" text-anchor="middle" style="fill:#fff;font-size:12px;font-weight:600">${Math.round(temps[k])}°</text>`;

  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Température et ressenti heure par heure sur 48 heures">
    <defs><linearGradient id="tempFill" x1="0" x2="0" y1="0" y2="1">
      <stop offset="0" stop-color="var(--temp)" stop-opacity=".35"/><stop offset="1" stop-color="var(--temp)" stop-opacity="0"/>
    </linearGradient></defs>
    ${nightBands(idx, Hh, xAt, step)}
    <g class="axis">${axisY(ticks, yAt, W, v => `${v}°`)}${axisX(idx, Hh, xAt, W, hh)}</g>
    <path d="${area}" fill="url(#tempFill)"/>
    <path d="${line(feels)}" fill="none" stroke="var(--feels)" stroke-width="2" stroke-dasharray="5 4" stroke-linecap="round"/>
    <path d="${line(temps)}" fill="none" stroke="var(--temp)" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
    ${lab(kMax, true)}${kMin !== kMax ? lab(kMin, false) : ""}
    <g class="hl"></g>
  </svg>`;

  hover(el, idx.length, xAt, step, W,
    k => `<line x1="${xAt(k)}" x2="${xAt(k)}" y1="${M.t}" y2="${H - M.b}" stroke="rgba(255,255,255,.5)" stroke-dasharray="3 3"/>
      <circle cx="${xAt(k)}" cy="${yAt(feels[k])}" r="5" fill="var(--feels)" stroke="#16203a" stroke-width="2"/>
      <circle cx="${xAt(k)}" cy="${yAt(temps[k])}" r="6" fill="var(--temp)" stroke="#16203a" stroke-width="2"/>`,
    k => {
      const i = idx[k], t = toMs(Hh.time[i]);
      const day = new Date(t).toLocaleDateString("fr-FR", { weekday: "long", timeZone: "UTC" });
      return `<div class="t">${day} · ${hh(t)}</div>
        <div class="r"><b>${icon(Hh.weather_code[i], Hh.is_day[i])} ${label(Hh.weather_code[i])}</b></div>
        <div class="r"><span>Température</span><b>${deg(Hh.temperature_2m[i])}</b></div>
        <div class="r"><span>Ressenti</span><b>${deg(Hh.apparent_temperature[i])}</b></div>`;
    });
}

function rain(el, x, { hh, nf }) {
  const Hh = x.H;
  const idx = window48(x);
  if (!idx.length) { el.innerHTML = ""; return; }
  const W = Math.max(300, el.clientWidth);
  H_ = H;
  const ticks = [0, 25, 50, 75, 100];
  const band = (W - M.l - M.r) / idx.length;
  const xAt = k => M.l + band * (k + 0.5);
  const yAt = v => M.t + (1 - v / 100) * (H - M.t - M.b);
  const bw = Math.max(2, band - 2);
  const bars = idx.map((i, k) => {
    const p = Hh.precipitation_probability[i] ?? 0;
    if (p <= 0) return "";
    const top = yAt(p), h = H - M.b - top, r = Math.min(4, h, bw / 2), x0 = xAt(k) - bw / 2;
    const op = 0.35 + Math.min(1, (Hh.precipitation[i] ?? 0) / 2) * 0.65; // plus opaque quand il pleut beaucoup
    return `<path d="M${x0},${H - M.b}V${top + r}Q${x0},${top} ${x0 + r},${top}H${x0 + bw - r}Q${x0 + bw},${top} ${x0 + bw},${top + r}V${H - M.b}Z" fill="var(--rain)" fill-opacity="${op.toFixed(2)}"/>`;
  }).join("");
  const anyRain = idx.some(i => (Hh.precipitation_probability[i] ?? 0) > 0);

  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Probabilité de pluie heure par heure sur 48 heures">
    ${nightBands(idx, Hh, xAt, band)}
    <g class="axis">${axisY(ticks, yAt, W, v => `${v}%`)}${axisX(idx, Hh, xAt, W, hh)}</g>
    ${bars}
    ${anyRain ? "" : `<text x="${W / 2}" y="${H / 2}" text-anchor="middle" style="fill:rgba(255,255,255,.75);font-size:14px">☀️ Aucun risque de pluie sur 48 h</text>`}
    <g class="hl"></g>
  </svg>`;

  hover(el, idx.length, xAt, band, W,
    k => `<rect x="${xAt(k) - band / 2}" y="${M.t}" width="${band}" height="${H - M.t - M.b}" fill="#fff" opacity=".1"/>`,
    k => {
      const i = idx[k], t = toMs(Hh.time[i]);
      const day = new Date(t).toLocaleDateString("fr-FR", { weekday: "long", timeZone: "UTC" });
      return `<div class="t">${day} · ${hh(t)}</div>
        <div class="r"><span>Probabilité</span><b>${Hh.precipitation_probability[i] ?? 0} %</b></div>
        <div class="r"><span>Quantité</span><b>${nf(Hh.precipitation[i] ?? 0, 1)} mm</b></div>`;
    });
}

export const charts = { temperature, rain };
