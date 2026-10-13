import { createSky } from "./sky.js";
import { charts } from "./charts.js";

// ===================================================================
// Utilitaires
// ===================================================================
const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const store = {
  get(k, d) { try { const v = localStorage.getItem("meteo:" + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem("meteo:" + k, JSON.stringify(v)); } catch {} },
};
const nf = (n, d = 0) => Number(n).toLocaleString("fr-FR", { maximumFractionDigits: d, minimumFractionDigits: d });

// Les heures de l'API sont en heure locale de la ville ("2026-10-13T14:00").
// On les manipule comme des millisecondes « pseudo-UTC » pour pouvoir les comparer simplement.
const toMs = s => Date.parse(s.length === 16 ? s + ":00Z" : s.length === 10 ? s + "T00:00:00Z" : s + "Z");
const hhmm = ms => new Date(ms).toISOString().slice(11, 16);
const hh = ms => new Date(ms).toISOString().slice(11, 13) + "h";

const state = {
  unit: store.get("unit", "C"),
  favs: store.get("favs", []),
  place: null,
  wx: null,
  aq: null,
  demo: "",
};

const T = c => (state.unit === "F" ? c * 9 / 5 + 32 : c);
const deg = c => `${Math.round(T(c))}°`;
const speed = kmh => state.unit === "F" ? `${Math.round(kmh / 1.609)} mph` : `${Math.round(kmh)} km/h`;

// ===================================================================
// Codes météo WMO
// ===================================================================
const WMO = {
  0: "Ciel dégagé", 1: "Plutôt dégagé", 2: "Partiellement nuageux", 3: "Couvert",
  45: "Brouillard", 48: "Brouillard givrant",
  51: "Bruine légère", 53: "Bruine", 55: "Bruine dense", 56: "Bruine verglaçante", 57: "Bruine verglaçante dense",
  61: "Pluie faible", 63: "Pluie modérée", 65: "Pluie forte", 66: "Pluie verglaçante", 67: "Pluie verglaçante forte",
  71: "Neige faible", 73: "Neige modérée", 75: "Neige forte", 77: "Grains de neige",
  80: "Averses faibles", 81: "Averses", 82: "Averses violentes", 85: "Averses de neige", 86: "Fortes averses de neige",
  95: "Orage", 96: "Orage avec grêle", 99: "Orage violent avec grêle",
};
const label = code => WMO[code] ?? "Conditions inconnues";

function icon(code, day = true) {
  if (code <= 1) return day ? (code ? "🌤️" : "☀️") : "🌙";
  if (code === 2) return day ? "⛅" : "☁️";
  if (code === 3) return "☁️";
  if (code === 45 || code === 48) return "🌫️";
  if (code >= 51 && code <= 57) return "🌦️";
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return code === 80 && day ? "🌦️" : "🌧️";
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return code === 75 || code === 86 ? "❄️" : "🌨️";
  if (code >= 95) return "⛈️";
  return "❔";
}

function sceneOf(code, windKmh = 0) {
  const s = { wind: Math.min(1, windKmh / 50), intensity: 0.5 };
  if (code <= 1) s.kind = "clear";
  else if (code === 2) s.kind = "partly";
  else if (code === 3) s.kind = "overcast";
  else if (code === 45 || code === 48) s.kind = "fog";
  else if (code >= 51 && code <= 57) s.kind = "drizzle";
  else if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) {
    s.kind = "rain"; s.intensity = { 61: 0.25, 80: 0.25, 63: 0.6, 81: 0.6, 66: 0.4 }[code] ?? 1;
  } else if ((code >= 71 && code <= 77) || code === 85 || code === 86) {
    s.kind = "snow"; s.intensity = { 71: 0.3, 85: 0.3, 73: 0.6, 77: 0.3 }[code] ?? 1;
  } else if (code >= 95) { s.kind = "storm"; s.intensity = 1; }
  else s.kind = "overcast";
  return s;
}

// Dégradés du ciel : [haut, milieu, bas]
const SKY = {
  clear:    { day: ["#1f6fd1", "#4fa8ea", "#a9dcff"], night: ["#050a1c", "#111c42", "#28366b"] },
  partly:   { day: ["#3b7fc8", "#79b2e2", "#c3def2"], night: ["#0b1229", "#1c2748", "#34405f"] },
  overcast: { day: ["#5d6b7e", "#8795a6", "#b3bdc8"], night: ["#14181f", "#232a35", "#373f4c"] },
  fog:      { day: ["#7d8994", "#a3adb5", "#cdd3d8"], night: ["#1e2328", "#30363d", "#454c54"] },
  drizzle:  { day: ["#4d5f73", "#71849a", "#9caebf"], night: ["#0f161f", "#1e2935", "#2f3c4a"] },
  rain:     { day: ["#33465a", "#556b80", "#7b8fa3"], night: ["#0a1018", "#162230", "#253343"] },
  snow:     { day: ["#7c93ad", "#a9bed3", "#dbe6f0"], night: ["#161e2c", "#2a3649", "#435268"] },
  storm:    { day: ["#232733", "#3a3f50", "#575d70"], night: ["#060709", "#12141c", "#22252f"] },
  golden:   { day: ["#3b5ba5", "#e0846a", "#ffcf8a"], night: ["#3b5ba5", "#e0846a", "#ffcf8a"] },
};

let currentSkyKey = "";
function setSkyGradient(key, isDay) {
  const k = key + (isDay ? "d" : "n");
  if (k === currentSkyKey) return;
  currentSkyKey = k;
  const [a, b, c] = SKY[key][isDay ? "day" : "night"];
  const bg = $("sky-bg");
  const layer = document.createElement("div");
  layer.className = "layer";
  layer.style.background = `linear-gradient(180deg, ${a} 0%, ${b} 55%, ${c} 100%)`;
  layer.style.opacity = "0";
  bg.appendChild(layer);
  requestAnimationFrame(() => requestAnimationFrame(() => { layer.style.opacity = "1"; }));
  setTimeout(() => { while (bg.children.length > 1) bg.firstChild.remove(); }, 1800);
  document.querySelector('meta[name="theme-color"]').content = a;
}

// Couleur associée à une température (°C)
const TEMP_STOPS = [[-10, [109, 140, 255]], [0, [94, 200, 255]], [10, [95, 224, 176]], [18, [200, 230, 106]], [25, [255, 201, 77]], [32, [255, 123, 74]], [40, [232, 65, 79]]];
function tempColor(c) {
  if (c <= TEMP_STOPS[0][0]) return `rgb(${TEMP_STOPS[0][1]})`;
  for (let i = 1; i < TEMP_STOPS.length; i++) {
    const [t1, c1] = TEMP_STOPS[i];
    if (c <= t1) {
      const [t0, c0] = TEMP_STOPS[i - 1];
      const f = (c - t0) / (t1 - t0);
      return `rgb(${c0.map((v, j) => Math.round(v + (c1[j] - v) * f))})`;
    }
  }
  return `rgb(${TEMP_STOPS.at(-1)[1]})`;
}

// ===================================================================
// API
// ===================================================================
async function getJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function forecastURL(lat, lon) {
  const p = new URLSearchParams({
    latitude: lat, longitude: lon, timezone: "auto", forecast_days: 10,
    current: "temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,weather_code,cloud_cover,pressure_msl,wind_speed_10m,wind_direction_10m,wind_gusts_10m",
    hourly: "temperature_2m,apparent_temperature,precipitation_probability,precipitation,weather_code,is_day,uv_index,visibility,dew_point_2m,relative_humidity_2m,pressure_msl,wind_speed_10m",
    daily: "weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset,daylight_duration,uv_index_max,precipitation_sum,precipitation_probability_max,wind_speed_10m_max,wind_gusts_10m_max,wind_direction_10m_dominant",
    minutely_15: "precipitation",
  });
  return `https://api.open-meteo.com/v1/forecast?${p}`;
}

function airURL(lat, lon) {
  const p = new URLSearchParams({
    latitude: lat, longitude: lon, timezone: "auto", forecast_days: 1,
    current: "european_aqi,pm2_5,pm10,nitrogen_dioxide,ozone",
    hourly: "alder_pollen,birch_pollen,grass_pollen,mugwort_pollen,olive_pollen,ragweed_pollen",
  });
  return `https://air-quality-api.open-meteo.com/v1/air-quality?${p}`;
}

async function searchCities(q) {
  const p = new URLSearchParams({ name: q, count: 6, language: "fr", format: "json" });
  const data = await getJSON(`https://geocoding-api.open-meteo.com/v1/search?${p}`);
  return (data.results || []).map(r => ({
    name: r.name,
    sub: [r.admin1, r.country].filter(Boolean).join(", "),
    cc: r.country_code,
    lat: r.latitude, lon: r.longitude,
  }));
}

async function reverseGeocode(lat, lon) {
  try {
    const p = new URLSearchParams({ latitude: lat, longitude: lon, localityLanguage: "fr" });
    const d = await getJSON(`https://api.bigdatacloud.net/data/reverse-geocode-client?${p}`);
    const name = d.city || d.locality || d.principalSubdivision;
    if (name) return { name, sub: [d.principalSubdivision, d.countryName].filter(x => x && x !== name).join(", ") };
  } catch {}
  return { name: "Ma position", sub: "" };
}

const flag = cc => cc ? String.fromCodePoint(...[...cc.toUpperCase()].map(c => 127397 + c.charCodeAt(0))) : "📍";

// ===================================================================
// Chargement d'une ville
// ===================================================================
const sky = createSky($("sky"));
let loadToken = 0;

async function loadPlace(place, { quiet = false } = {}) {
  const token = ++loadToken;
  state.place = place;
  if (!quiet) {
    setStatus("Chargement de la météo…");
    if (!state.wx) $("status").insertAdjacentHTML("beforeend", '<div class="skeleton"></div><div class="skeleton"></div>');
  }
  const [wx, aq] = await Promise.allSettled([getJSON(forecastURL(place.lat, place.lon)), getJSON(airURL(place.lat, place.lon))]);
  if (token !== loadToken) return; // une autre ville a été demandée entre-temps
  if (wx.status === "rejected") {
    setStatus("Impossible de récupérer la météo. Vérifie ta connexion puis réessaie.", true);
    return;
  }
  state.wx = wx.value;
  state.aq = aq.status === "fulfilled" ? aq.value : null;
  store.set("last", place);
  const url = new URL(location.href);
  url.search = new URLSearchParams({ lat: place.lat.toFixed(4), lon: place.lon.toFixed(4), name: place.name, sub: place.sub || "" });
  history.replaceState(null, "", url);
  document.title = `${deg(state.wx.current.temperature_2m)} ${place.name} — Météo vivante`;
  setStatus("");
  render();
  updateMap();
}

function setStatus(msg, isError = false) {
  const s = $("status");
  s.textContent = msg;
  s.classList.toggle("error", isError);
}

// ===================================================================
// Rendu
// ===================================================================
function ctx() {
  const wx = state.wx;
  const c = wx.current;
  const nowMs = toMs(c.time);
  const hourStart = Math.floor(nowMs / 3600e3) * 3600e3;
  const H = wx.hourly;
  let idx = H.time.findIndex(t => toMs(t) >= hourStart);
  if (idx < 0) idx = 0;
  const D = wx.daily;
  const sunrise = D.sunrise.map(toMs), sunset = D.sunset.map(toMs);
  return { wx, c, H, D, idx, nowMs, sunrise, sunset };
}

function render() {
  if (!state.wx) return;
  const x = ctx();
  $("content").classList.remove("hidden");
  renderHero(x);
  renderHourly(x);
  renderWind(x);
  renderSun(x);
  renderUV(x);
  renderAir();
  renderHumidity(x);
  renderPressure(x);
  renderVisibility(x);
  renderMoon();
  renderPollen();
  charts.temperature($("chart-temp"), x, { T, deg, hh, icon, label });
  charts.rain($("chart-rain"), x, { hh, nf });
  renderDaily(x);
  renderTips(x);
  renderFavs();
  updateSky(x);
  $("unit").textContent = state.unit === "F" ? "°F" : "°C";
}

function updateSky(x = state.wx && ctx()) {
  if (state.demo) {
    const [kind, day] = state.demo.split("|");
    const isDay = day === "1";
    if (kind === "golden") { setSkyGradient("golden", true); sky.setScene({ kind: "partly", isDay: true, intensity: 0.5, wind: 0.2 }); }
    else { setSkyGradient(kind, isDay); sky.setScene({ ...sceneOf({ clear: 0, partly: 2, overcast: 3, fog: 45, drizzle: 53, rain: 63, snow: 73, storm: 95 }[kind], 15), isDay }); }
    return;
  }
  if (!x) return;
  const isDay = !!x.c.is_day;
  const scene = { ...sceneOf(x.c.weather_code, x.c.wind_speed_10m), isDay };
  const nearSun = [...x.sunrise.slice(0, 1), ...x.sunset.slice(0, 1)].some(t => Math.abs(x.nowMs - t) < 50 * 60e3);
  const golden = nearSun && (scene.kind === "clear" || scene.kind === "partly");
  setSkyGradient(golden ? "golden" : scene.kind, isDay);
  sky.setScene(golden ? { ...scene, isDay: true } : scene);
}

// ---- Bloc principal ----
function renderHero(x) {
  const { c, D, H, idx } = x;
  $("place").innerHTML = `${esc(state.place.name)}${state.place.sub ? `<span class="sub" style="font-weight:400"> · ${esc(state.place.sub)}</span>` : ""}`;
  updateClock();
  $("hero-icon").textContent = icon(c.weather_code, c.is_day);
  $("temp").textContent = deg(c.temperature_2m);
  $("desc").textContent = label(c.weather_code);
  $("hilo").textContent = `Max ${deg(D.temperature_2m_max[0])} · Min ${deg(D.temperature_2m_min[0])} · Ressenti ${deg(c.apparent_temperature)}`;
  $("summary").innerHTML = buildSummary(x);
  renderNowcast(x);
}

function updateClock() {
  if (!state.wx) return;
  try {
    $("clock").textContent = new Date().toLocaleString("fr-FR", {
      timeZone: state.wx.timezone, weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit",
    });
  } catch { $("clock").textContent = ""; }
}
setInterval(updateClock, 30e3);

function buildSummary({ c, H, D, idx, nowMs }) {
  const parts = [];
  // Pluie dans les prochaines heures
  const next = [];
  for (let i = idx; i < Math.min(idx + 12, H.time.length); i++) next.push(i);
  const raining = c.precipitation > 0.05 || (c.weather_code >= 51 && c.weather_code < 95 && c.weather_code !== 77 && !(c.weather_code >= 71 && c.weather_code <= 77));
  const firstRain = next.find(i => (H.precipitation_probability[i] ?? 0) >= 50 && H.precipitation[i] > 0.05);
  const firstDry = next.find(i => H.precipitation[i] < 0.05 && (H.precipitation_probability[i] ?? 0) < 40);
  if (raining && firstDry != null && firstDry > idx) parts.push(`🌂 La pluie devrait se calmer vers <b>${hh(toMs(H.time[firstDry]))}</b>.`);
  else if (raining) parts.push("🌧️ Temps humide une bonne partie de la journée.");
  else if (firstRain != null) parts.push(`☔ Pluie probable vers <b>${hh(toMs(H.time[firstRain]))}</b> (${H.precipitation_probability[firstRain]} %).`);
  else parts.push("✨ Pas de pluie prévue dans les 12 prochaines heures.");

  // Températures à venir
  const endOfDay = toMs(D.time[0]) + 24 * 3600e3;
  const restToday = next.filter(i => toMs(H.time[i]) < endOfDay);
  if (restToday.length > 2) {
    const iMax = restToday.reduce((a, b) => H.temperature_2m[b] > H.temperature_2m[a] ? b : a);
    if (H.temperature_2m[iMax] > c.temperature_2m + 0.8) parts.push(`Jusqu'à <b>${deg(H.temperature_2m[iMax])}</b> vers ${hh(toMs(H.time[iMax]))}.`);
    else {
      const iMin = restToday.reduce((a, b) => H.temperature_2m[b] < H.temperature_2m[a] ? b : a);
      if (H.temperature_2m[iMin] < c.temperature_2m - 0.8) parts.push(`Baisse jusqu'à <b>${deg(H.temperature_2m[iMin])}</b> vers ${hh(toMs(H.time[iMin]))}.`);
    }
  }
  // Demain
  if (D.time.length > 1) {
    const diff = D.temperature_2m_max[1] - D.temperature_2m_max[0];
    const trend = diff > 2 ? "plus doux" : diff < -2 ? "plus frais" : "similaire";
    parts.push(`Demain : ${label(D.weather_code[1]).toLowerCase()}, ${deg(D.temperature_2m_min[1])} / ${deg(D.temperature_2m_max[1])} — ${trend}.`);
  }
  return parts.join(" ");
}

function renderNowcast({ wx, nowMs }) {
  const el = $("nowcast");
  const m = wx.minutely_15;
  if (!m?.time?.length) { el.innerHTML = ""; return; }
  const slot = Math.floor(nowMs / 900e3) * 900e3;
  let i0 = m.time.findIndex(t => toMs(t) >= slot);
  if (i0 < 0) { el.innerHTML = ""; return; }
  const vals = m.precipitation.slice(i0, i0 + 8).map(v => v ?? 0);
  const max = Math.max(0.4, ...vals);
  const dry = vals.every(v => v < 0.05);
  el.style.display = "block";
  el.style.height = "auto";
  el.innerHTML = `
    <div class="nowcast-title">Pluie — 2 prochaines heures</div>
    <div style="display:flex;align-items:flex-end;gap:3px;height:46px">
      ${vals.map((v, k) => `<div class="bar ${v < 0.05 ? "dry" : ""}" style="height:${v < 0.05 ? 3 : Math.max(10, (v / max) * 100)}%" title="${hhmm(toMs(m.time[i0 + k]))} : ${nf(v, 1)} mm"></div>`).join("")}
    </div>
    <div class="nowcast-axis"><span>Maint.</span><span>+1 h</span><span>+2 h</span></div>
    ${dry ? '<div class="sub" style="margin-top:4px">Aucune pluie attendue ☀️</div>' : ""}`;
  el.querySelectorAll(".bar").forEach(b => { b.style.flex = "1"; });
}

// ---- Heure par heure ----
function renderHourly({ H, idx, sunrise, sunset }) {
  const items = [];
  const end = Math.min(H.time.length, idx + 25);
  const startMs = toMs(H.time[idx]), endMs = toMs(H.time[end - 1]);
  for (let i = idx; i < end; i++) {
    const t = toMs(H.time[i]);
    items.push({ t, html: `<div class="hour ${i === idx ? "now" : ""}">
      <div class="h">${i === idx ? "Maint." : hh(t)}</div>
      <div class="i">${icon(H.weather_code[i], H.is_day[i])}</div>
      <div class="v">${deg(H.temperature_2m[i])}</div>
      <div class="p">${(H.precipitation_probability[i] ?? 0) >= 20 ? H.precipitation_probability[i] + " %" : ""}</div>
    </div>` });
  }
  for (const [list, emoji, name] of [[sunrise, "🌅", "Lever"], [sunset, "🌇", "Coucher"]]) {
    for (const t of list) if (t > startMs && t < endMs) items.push({
      t, html: `<div class="hour sun"><div class="h">${hhmm(t)}</div><div class="i">${emoji}</div><div class="v" style="font-weight:500;font-size:13px">${name}</div><div class="p"></div></div>`,
    });
  }
  items.sort((a, b) => a.t - b.t);
  $("hourly").innerHTML = items.map(i => i.html).join("");
  $("hourly").scrollLeft = 0;
}

// ---- Vent ----
const DIRS = ["Nord", "Nord-Nord-Est", "Nord-Est", "Est-Nord-Est", "Est", "Est-Sud-Est", "Sud-Est", "Sud-Sud-Est", "Sud", "Sud-Sud-Ouest", "Sud-Ouest", "Ouest-Sud-Ouest", "Ouest", "Ouest-Nord-Ouest", "Nord-Ouest", "Nord-Nord-Ouest"];
const BEAUFORT = [[1, "Calme"], [6, "Très légère brise"], [12, "Légère brise"], [20, "Petite brise"], [29, "Jolie brise"], [39, "Bonne brise"], [50, "Vent frais"], [62, "Grand frais"], [75, "Coup de vent"], [89, "Fort coup de vent"], [103, "Tempête"], [118, "Violente tempête"], [Infinity, "Ouragan"]];

function renderWind({ c, D }) {
  const dir = c.wind_direction_10m;
  const dirName = DIRS[Math.round(dir / 22.5) % 16];
  const bf = BEAUFORT.findIndex(([max]) => c.wind_speed_10m < max);
  const ticks = Array.from({ length: 36 }, (_, i) => {
    const a = (i * 10) * Math.PI / 180, long = i % 9 === 0;
    const r1 = long ? 40 : 44, r2 = 48;
    return `<line x1="${55 + Math.sin(a) * r1}" y1="${55 - Math.cos(a) * r1}" x2="${55 + Math.sin(a) * r2}" y2="${55 - Math.cos(a) * r2}" stroke="rgba(255,255,255,${long ? 0.7 : 0.25})" stroke-width="${long ? 2 : 1}"/>`;
  }).join("");
  $("tile-wind").innerHTML = `
    <h2>💨 Vent</h2>
    <div class="row">
      <svg class="compass" viewBox="0 0 110 110" aria-hidden="true">
        ${ticks}
        <text x="55" y="27" text-anchor="middle">N</text><text x="85" y="59" text-anchor="middle">E</text>
        <text x="55" y="91" text-anchor="middle">S</text><text x="25" y="59" text-anchor="middle">O</text>
        <g class="arrow" style="transform: rotate(${dir + 180}deg)">
          <path d="M55 14 L61 30 L55 26 L49 30 Z" fill="#fff"/>
          <line x1="55" y1="26" x2="55" y2="88" stroke="#fff" stroke-width="2" stroke-linecap="round"/>
          <circle cx="55" cy="88" r="3" fill="none" stroke="#fff" stroke-width="2"/>
        </g>
      </svg>
      <div>
        <div class="big">${speed(c.wind_speed_10m).replace(/ (.+)$/, "<small>$1</small>")}</div>
        <div class="sub">Rafales ${speed(c.wind_gusts_10m)}</div>
        <div class="sub">Venant du ${dirName.toLowerCase()}</div>
      </div>
    </div>
    <div class="foot">Force ${bf} Beaufort — ${BEAUFORT[bf][1]}. Rafales max. aujourd'hui : ${speed(D.wind_gusts_10m_max?.[0] ?? D.wind_speed_10m_max[0])}.</div>`;
}

// ---- Soleil ----
function renderSun({ D, nowMs, sunrise, sunset }) {
  const rise = sunrise[0], set = sunset[0];
  const W = 240, Hh = 100, r = 90, cx = 120, cy = 96;
  const f = (nowMs - rise) / (set - rise);
  const isDayNow = f >= 0 && f <= 1;
  const a = Math.PI * (1 - Math.min(1, Math.max(0, f)));
  const sx = cx + r * Math.cos(a), sy = cy - r * Math.sin(a);
  const dayLen = D.daylight_duration[0];
  const delta = D.daylight_duration[1] != null ? Math.round((D.daylight_duration[1] - dayLen) / 60) : null;
  const fmtDur = s => `${Math.floor(s / 3600)} h ${String(Math.round((s % 3600) / 60)).padStart(2, "0")}`;
  const progress = `M${cx - r},${cy} A${r},${r} 0 0 1 ${sx.toFixed(1)},${sy.toFixed(1)}`;
  const nextRise = nowMs > set ? sunrise[1] : rise;
  $("tile-sun").innerHTML = `
    <h2>🌅 Soleil</h2>
    <svg class="sun-arc" viewBox="0 0 ${W} ${Hh + 6}" aria-hidden="true">
      <defs><linearGradient id="sunGrad" x1="0" x2="1"><stop offset="0" stop-color="#ffb35c"/><stop offset="1" stop-color="#ffe08a"/></linearGradient></defs>
      <line x1="10" x2="${W - 10}" y1="${cy}" y2="${cy}" stroke="rgba(255,255,255,.25)"/>
      <path d="M${cx - r},${cy} A${r},${r} 0 0 1 ${cx + r},${cy}" fill="none" stroke="rgba(255,255,255,.25)" stroke-width="2" stroke-dasharray="4 5"/>
      ${isDayNow ? `<path d="${progress}" fill="none" stroke="url(#sunGrad)" stroke-width="3" stroke-linecap="round"/>
      <circle cx="${sx}" cy="${sy}" r="14" fill="rgba(255,220,120,.25)"/><circle cx="${sx}" cy="${sy}" r="8" fill="#ffd66b"/>` : ""}
    </svg>
    <div class="sun-times"><span>↑ ${hhmm(rise)}</span><span>${isDayNow ? "" : "🌙 Nuit"}</span><span>↓ ${hhmm(set)}</span></div>
    <div class="foot">Durée du jour : ${fmtDur(dayLen)}${delta != null ? ` (${delta >= 0 ? "+" : "−"}${Math.abs(delta)} min demain)` : ""}.
      ${!isDayNow ? `Prochain lever à ${hhmm(nextRise)}.` : `Encore ${fmtDur((set - nowMs) / 1000)} de jour.`}</div>`;
}

// ---- UV ----
function uvLevel(u) {
  if (u < 3) return ["Faible", "Aucune protection nécessaire."];
  if (u < 6) return ["Modéré", "Lunettes de soleil conseillées."];
  if (u < 8) return ["Élevé", "Crème solaire et chapeau recommandés."];
  if (u < 11) return ["Très élevé", "Évite le soleil entre 12h et 16h."];
  return ["Extrême", "Exposition fortement déconseillée."];
}
function renderUV({ H, D, idx }) {
  const uv = H.uv_index[idx] ?? 0;
  const max = D.uv_index_max[0] ?? 0;
  let iMax = idx;
  for (let i = idx; i < Math.min(H.time.length, idx + 24); i++) if ((H.uv_index[i] ?? 0) > (H.uv_index[iMax] ?? 0)) iMax = i;
  const [lvl, advice] = uvLevel(uv);
  $("tile-uv").innerHTML = `
    <h2>🔆 Indice UV</h2>
    <div class="big">${nf(uv)}<small>${lvl}</small></div>
    <div class="gauge gauge-uv"><span class="dot" style="left:${Math.min(100, uv / 11 * 100)}%"></span></div>
    <div class="foot">${advice} Max. aujourd'hui : ${nf(max)}${(H.uv_index[iMax] ?? 0) > uv ? ` vers ${hh(toMs(H.time[iMax]))}` : ""}.</div>`;
}

// ---- Qualité de l'air ----
function aqiLevel(v) {
  if (v <= 20) return ["Bonne", "Idéal pour les activités en extérieur."];
  if (v <= 40) return ["Correcte", "Aucune précaution particulière."];
  if (v <= 60) return ["Moyenne", "Les personnes sensibles peuvent ressentir une gêne."];
  if (v <= 80) return ["Médiocre", "Limite les efforts intenses en extérieur."];
  if (v <= 100) return ["Très médiocre", "Évite le sport en extérieur."];
  return ["Extrêmement médiocre", "Reste à l'intérieur si possible."];
}
function renderAir() {
  const a = state.aq?.current;
  if (!a || a.european_aqi == null) {
    $("tile-air").innerHTML = `<h2>🍃 Qualité de l'air</h2><div class="sub">Données indisponibles pour ce lieu.</div>`;
    return;
  }
  const v = a.european_aqi;
  const [lvl, advice] = aqiLevel(v);
  const p = (k, n) => `<div><b>${a[k] != null ? nf(a[k]) : "–"}</b>${n}</div>`;
  $("tile-air").innerHTML = `
    <h2>🍃 Qualité de l'air</h2>
    <div class="big">${Math.round(v)}<small>${lvl}</small></div>
    <div class="gauge gauge-aqi"><span class="dot" style="left:${Math.min(100, v)}%"></span></div>
    <div class="pollutants">${p("pm2_5", "PM2.5")}${p("pm10", "PM10")}${p("nitrogen_dioxide", "NO₂")}${p("ozone", "O₃")}</div>
    <div class="foot">${advice} <span style="color:var(--faint)">(indice européen, µg/m³)</span></div>`;
}

// ---- Humidité ----
function renderHumidity({ c, H, idx }) {
  const dp = H.dew_point_2m[idx];
  const comfort = dp < 10 ? "Air plutôt sec" : dp < 16 ? "Confortable" : dp < 20 ? "Un peu lourd" : "Étouffant";
  $("tile-humidity").innerHTML = `
    <h2>💧 Humidité</h2>
    <div class="big">${c.relative_humidity_2m}<small>%</small></div>
    <div class="gauge" style="background:rgba(255,255,255,.14)"><span class="dot" style="left:${c.relative_humidity_2m}%"></span></div>
    <div class="foot">Point de rosée : ${deg(dp)} — ${comfort}.</div>`;
}

// ---- Pression ----
function renderPressure({ c, H, idx }) {
  const p = c.pressure_msl;
  const P = H.pressure_msl;
  const [a, b, when] = idx >= 3 ? [P[idx - 3], P[idx], "sur les 3 dernières heures"] : [P[idx], P[idx + 3], "dans les 3 prochaines heures"];
  const diff = b - a;
  const trend = diff > 1 ? ["↗", "en hausse"] : diff < -1 ? ["↘", "en baisse"] : ["→", "stable"];
  const kind = p < 1000 ? "Basse pression : temps souvent instable." : p > 1020 ? "Haute pression : temps plutôt stable." : "Pression normale.";
  // Petit cadran 960 → 1050 hPa
  const f = Math.min(1, Math.max(0, (p - 960) / 90));
  const ang = Math.PI * (1.25 - 1.5 * f);
  $("tile-pressure").innerHTML = `
    <h2>🧭 Pression</h2>
    <div class="row">
      <svg viewBox="0 0 100 80" width="96" height="77" aria-hidden="true">
        <path d="M ${50 + 38 * Math.cos(Math.PI * 1.25)} ${50 - 38 * Math.sin(Math.PI * 1.25)} A 38 38 0 1 1 ${50 + 38 * Math.cos(-Math.PI * 0.25)} ${50 - 38 * Math.sin(-Math.PI * 0.25)}" fill="none" stroke="rgba(255,255,255,.2)" stroke-width="6" stroke-linecap="round"/>
        <line x1="50" y1="50" x2="${50 + 30 * Math.cos(ang)}" y2="${50 - 30 * Math.sin(ang)}" stroke="#fff" stroke-width="3" stroke-linecap="round"/>
        <circle cx="50" cy="50" r="4" fill="#fff"/>
      </svg>
      <div><div class="big">${nf(p)}<small>hPa</small></div><div class="sub">${trend[0]} ${trend[1]}</div></div>
    </div>
    <div class="foot">${kind} ${diff ? `${diff > 0 ? "+" : "−"}${nf(Math.abs(diff), 1)} hPa ${when}.` : ""}</div>`;
}

// ---- Visibilité ----
function renderVisibility({ H, idx }) {
  const v = (H.visibility[idx] ?? 0) / 1000;
  const lvl = v < 1 ? "Brouillard" : v < 4 ? "Brume" : v < 10 ? "Moyenne" : v < 20 ? "Bonne" : "Excellente";
  $("tile-visibility").innerHTML = `
    <h2>👁️ Visibilité</h2>
    <div class="big">${v >= 10 ? nf(v) : nf(v, 1)}<small>km</small></div>
    <div class="sub">${lvl}</div>
    <div class="foot">${v < 1 ? "Prudence sur la route : allume tes feux." : v < 4 ? "Visibilité réduite par l'humidité ou la pollution." : "Bonne visibilité pour la route et les balades."}</div>`;
}

// ---- Lune ----
const SYNODIC = 29.530588853;
function moonPhase(date = new Date()) {
  const ref = Date.UTC(2000, 0, 6, 18, 14);
  const days = (date.getTime() - ref) / 86400e3;
  return ((days / SYNODIC) % 1 + 1) % 1;
}
function moonSVG(p) {
  const r = 34, cx = 38, cy = 38;
  const k = Math.cos(2 * Math.PI * p);
  const waxing = p < 0.5;
  const rx = Math.abs(k) * r;
  const outer = waxing ? 1 : 0;
  const inner = waxing ? (k > 0 ? 0 : 1) : (k > 0 ? 1 : 0);
  const lit = `M${cx},${cy - r} A${r},${r} 0 0 ${outer} ${cx},${cy + r} A${rx},${r} 0 0 ${inner} ${cx},${cy - r} Z`;
  return `<svg class="moon-svg" viewBox="0 0 76 76" aria-hidden="true">
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="#2b3046"/>
    <path d="${lit}" fill="#f1ecd9"/>
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="rgba(255,255,255,.18)"/>
  </svg>`;
}
function renderMoon() {
  const p = moonPhase();
  const names = ["Nouvelle lune", "Premier croissant", "Premier quartier", "Gibbeuse croissante", "Pleine lune", "Gibbeuse décroissante", "Dernier quartier", "Dernier croissant"];
  const name = names[Math.round(p * 8) % 8];
  const illum = Math.round((1 - Math.cos(2 * Math.PI * p)) / 2 * 100);
  const toFull = Math.round((((0.5 - p) + 1) % 1) * SYNODIC);
  const toNew = Math.round(((1 - p) % 1) * SYNODIC);
  $("tile-moon").innerHTML = `
    <h2>🌙 Lune</h2>
    <div class="row">${moonSVG(p)}<div><div class="big" style="font-size:22px">${name}</div><div class="sub">Éclairée à ${illum} %</div></div></div>
    <div class="foot">${toFull === 0 ? "C'est la pleine lune !" : `Pleine lune dans ${toFull} jour${toFull > 1 ? "s" : ""}`} · nouvelle lune dans ${toNew || SYNODIC.toFixed(0)} jours.</div>`;
}

// ---- Pollens ----
const POLLENS = [["grass_pollen", "Graminées", "🌾"], ["birch_pollen", "Bouleau", "🌳"], ["alder_pollen", "Aulne", "🌲"], ["olive_pollen", "Olivier", "🫒"], ["mugwort_pollen", "Armoise", "🌿"], ["ragweed_pollen", "Ambroisie", "🌱"]];
function pollenLevel(v) {
  if (v < 1) return [0, "Aucun"];
  if (v < 10) return [1, "Faible"];
  if (v < 50) return [2, "Modéré"];
  if (v < 200) return [3, "Élevé"];
  return [4, "Très élevé"];
}
const LEVEL_COLORS = ["#5fd38d", "#c8e66a", "#ffc94d", "#ff7b4a", "#e8414f"];
function renderPollen() {
  const h = state.aq?.hourly;
  const items = h ? POLLENS.map(([k, n, e]) => {
    const vals = (h[k] || []).filter(v => v != null);
    return vals.length ? { n, e, v: Math.max(...vals) } : null;
  }).filter(Boolean) : [];
  if (!items.length) { $("tile-pollen").innerHTML = ""; return; }
  $("tile-pollen").innerHTML = `
    <h2>🤧 Pollens aujourd'hui</h2>
    <div class="pollen-list">${items.map(({ n, e, v }) => {
      const [lvl, txt] = pollenLevel(v);
      return `<div class="pollen"><div class="n">${e} ${n}</div><div class="lvl sub">${txt} · ${nf(v)} grains/m³</div>
        <div class="lvl-dots">${[1, 2, 3, 4].map(i => `<i style="${i <= lvl ? `background:${LEVEL_COLORS[lvl]}` : ""}"></i>`).join("")}</div></div>`;
    }).join("")}</div>`;
}

// ---- 10 jours ----
function renderDaily({ D, c }) {
  const lo = Math.min(...D.temperature_2m_min), hi = Math.max(...D.temperature_2m_max);
  const pos = v => ((v - lo) / (hi - lo || 1)) * 100;
  $("daily").innerHTML = D.time.map((d, i) => {
    const min = D.temperature_2m_min[i], max = D.temperature_2m_max[i];
    const name = i === 0 ? "Aujourd'hui" : i === 1 ? "Demain" : new Date(toMs(d)).toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", timeZone: "UTC" });
    const pr = D.precipitation_probability_max[i];
    return `<div class="day" title="${esc(label(D.weather_code[i]))}">
      <div class="name">${name}</div>
      <div class="i" aria-label="${esc(label(D.weather_code[i]))}">${icon(D.weather_code[i])}</div>
      <div class="p">${pr >= 10 ? `<span class="drop">💧</span>${pr}%` : ""}</div>
      <div class="min">${deg(min)}</div>
      <div class="range">
        <div class="fill" style="left:${pos(min)}%;right:${100 - pos(max)}%;background:linear-gradient(90deg,${tempColor(min)},${tempColor(max)})"></div>
        ${i === 0 ? `<span class="cur" style="left:${pos(Math.min(max, Math.max(min, c.temperature_2m)))}%"></span>` : ""}
      </div>
      <div class="max">${deg(max)}</div>
    </div>`;
  }).join("");
}

// ---- Conseils ----
function renderTips({ c, H, D, idx, nowMs, sunset }) {
  const tips = [];
  const win = [];
  for (let i = idx; i < Math.min(H.time.length, idx + 14); i++) win.push(i);
  const code = c.weather_code;

  const rainI = win.reduce((a, b) => (H.precipitation_probability[b] ?? 0) > (H.precipitation_probability[a] ?? 0) ? b : a, idx);
  const rainP = H.precipitation_probability[rainI] ?? 0;
  if (rainP >= 50) tips.push(["☂️", `Prends un parapluie : ${rainP} % de risque de pluie vers ${hh(toMs(H.time[rainI]))}.`]);
  else if (rainP >= 25) tips.push(["🌂", `Petit risque d'averse (${rainP} %) vers ${hh(toMs(H.time[rainI]))} : un parapluie pliable peut servir.`]);

  if (code >= 95) tips.push(["⚡", "Orages : évite les zones dégagées, les arbres isolés et la baignade."]);
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) tips.push(["⛄", "Neige : chaussures antidérapantes et prudence sur la route."]);

  const feels = c.apparent_temperature;
  if (feels <= 0) tips.push(["🧣", `Couvre-toi bien : ressenti ${deg(feels)}. Bonnet et gants de rigueur.`]);
  else if (feels <= 10) tips.push(["🧥", `Ressenti ${deg(feels)} : une bonne veste sera utile.`]);
  else if (feels >= 30) tips.push(["🥤", `Forte chaleur (ressenti ${deg(feels)}) : bois régulièrement et reste à l'ombre.`]);
  else if (feels >= 18 && feels < 26 && rainP < 30) tips.push(["👕", `Températures agréables (ressenti ${deg(feels)}) : tenue légère.`]);

  const uvMax = D.uv_index_max[0] ?? 0;
  if (uvMax >= 6) tips.push(["🧴", `UV élevés aujourd'hui (jusqu'à ${nf(uvMax)}) : crème solaire indispensable.`]);
  else if (uvMax >= 3 && c.is_day) tips.push(["🕶️", `UV modérés (max ${nf(uvMax)}) : pense aux lunettes de soleil.`]);

  if (c.wind_gusts_10m >= 50) tips.push(["🌬️", `Rafales jusqu'à ${speed(c.wind_gusts_10m)} : attention aux objets sur les balcons.`]);

  const aqi = state.aq?.current?.european_aqi;
  if (aqi > 60) tips.push(["😷", "Air de qualité médiocre : évite les efforts intenses à l'extérieur."]);

  const pol = state.aq?.hourly;
  if (pol) {
    const high = POLLENS.filter(([k]) => Math.max(0, ...(pol[k] || []).filter(v => v != null)) >= 50).map(([, n]) => n.toLowerCase());
    if (high.length) tips.push(["🤧", `Pollens élevés (${high.join(", ")}) : pense à ton traitement si tu es allergique.`]);
  }

  if ((H.visibility[idx] ?? 99999) < 1000) tips.push(["🚗", "Brouillard : réduis ta vitesse et allume tes feux de croisement."]);

  if (!c.is_day && (code <= 1) && (H.precipitation_probability[idx] ?? 0) < 20) {
    const p = moonPhase(); const bright = (1 - Math.cos(2 * Math.PI * p)) / 2 > 0.6;
    tips.push(["🔭", bright ? "Nuit dégagée : belle occasion d'observer la Lune." : "Nuit dégagée et peu de lune : idéal pour observer les étoiles."]);
  }

  // Meilleur moment pour sortir : heure de jour avec le moins de pluie et une température proche de 21 °C
  const daylight = win.filter(i => H.is_day[i]);
  if (daylight.length) {
    const score = i => (H.precipitation_probability[i] ?? 0) * 1.5 + Math.abs(H.apparent_temperature[i] - 21) * 2 + (H.wind_speed_10m[i] ?? 0) * 0.3;
    const best = daylight.reduce((a, b) => score(b) < score(a) ? b : a);
    tips.push(["🚶", `Meilleur moment pour sortir : vers <b>${hh(toMs(H.time[best]))}</b> (${deg(H.temperature_2m[best])}, ${H.precipitation_probability[best] ?? 0} % de pluie).`]);
  }

  if (c.is_day && sunset[0] > nowMs && sunset[0] - nowMs < 3 * 3600e3 && (D.weather_code[0] <= 2)) {
    tips.push(["📸", `Coucher de soleil à ${hhmm(sunset[0])} : ciel favorable pour de belles photos.`]);
  }

  $("tips").innerHTML = tips.slice(0, 8).map(([e, t]) => `<li><span class="e">${e}</span><span>${t}</span></li>`).join("");
}

// ===================================================================
// Favoris
// ===================================================================
const same = (a, b) => a && b && Math.abs(a.lat - b.lat) < 0.01 && Math.abs(a.lon - b.lon) < 0.01;
let favTemps = {};

async function refreshFavTemps() {
  if (!state.favs.length) return;
  try {
    const p = new URLSearchParams({
      latitude: state.favs.map(f => f.lat).join(","), longitude: state.favs.map(f => f.lon).join(","),
      current: "temperature_2m,weather_code,is_day", timezone: "auto",
    });
    let data = await getJSON(`https://api.open-meteo.com/v1/forecast?${p}`);
    if (!Array.isArray(data)) data = [data];
    favTemps = {};
    data.forEach((d, i) => { if (state.favs[i]) favTemps[state.favs[i].lat + "," + state.favs[i].lon] = d.current; });
    renderFavs();
  } catch {}
}

function renderFavs() {
  const isFav = state.favs.some(f => same(f, state.place));
  $("fav").textContent = isFav ? "★" : "☆";
  $("fav").setAttribute("aria-pressed", String(isFav));
  $("fav").title = isFav ? "Retirer des favoris" : "Ajouter aux favoris";
  $("favs").innerHTML = state.favs.map((f, i) => {
    const cur = favTemps[f.lat + "," + f.lon];
    return `<div class="chip ${same(f, state.place) ? "active" : ""}" data-i="${i}" role="button" tabindex="0">
      ${cur ? `<span>${icon(cur.weather_code, cur.is_day)}</span>` : ""}<span>${esc(f.name)}</span>
      ${cur ? `<span class="t">${deg(cur.temperature_2m)}</span>` : ""}
      <button class="x" data-rm="${i}" aria-label="Retirer ${esc(f.name)} des favoris">×</button>
    </div>`;
  }).join("");
}

$("favs").addEventListener("click", e => {
  const rm = e.target.closest("[data-rm]");
  if (rm) {
    state.favs.splice(+rm.dataset.rm, 1);
    store.set("favs", state.favs);
    renderFavs();
    return;
  }
  const chip = e.target.closest(".chip");
  if (chip) loadPlace(state.favs[+chip.dataset.i]);
});
$("favs").addEventListener("keydown", e => { if (e.key === "Enter" && e.target.classList.contains("chip")) e.target.click(); });

$("fav").addEventListener("click", () => {
  if (!state.place) return;
  const i = state.favs.findIndex(f => same(f, state.place));
  if (i >= 0) state.favs.splice(i, 1);
  else state.favs.push({ name: state.place.name, sub: state.place.sub, lat: state.place.lat, lon: state.place.lon });
  store.set("favs", state.favs);
  renderFavs();
  refreshFavTemps();
});

// ===================================================================
// Recherche avec suggestions
// ===================================================================
let suggestions = [], selected = -1, searchTimer, searchToken = 0;
const input = $("city"), list = $("suggestions");

function showSuggestions() {
  if (!suggestions.length) { list.hidden = true; return; }
  list.innerHTML = suggestions.map((s, i) => `<li role="option" id="sugg-${i}" aria-selected="${i === selected}" data-i="${i}">
    <span>${flag(s.cc)}</span><span><b>${esc(s.name)}</b></span><span class="sub">${esc(s.sub)}</span></li>`).join("");
  list.hidden = false;
  input.setAttribute("aria-activedescendant", selected >= 0 ? `sugg-${selected}` : "");
}

input.addEventListener("input", () => {
  clearTimeout(searchTimer);
  const q = input.value.trim();
  if (q.length < 2) { suggestions = []; showSuggestions(); return; }
  searchTimer = setTimeout(async () => {
    const tok = ++searchToken;
    try {
      const res = await searchCities(q);
      if (tok !== searchToken) return;
      suggestions = res; selected = res.length ? 0 : -1;
      if (!res.length) { list.innerHTML = `<li class="sub">Aucune ville trouvée</li>`; list.hidden = false; return; }
      showSuggestions();
    } catch { /* réseau : on ignore, l'utilisateur peut réessayer */ }
  }, 220);
});

function choose(i) {
  const s = suggestions[i];
  if (!s) return;
  input.value = ""; suggestions = []; list.hidden = true; input.blur();
  state.demo = ""; $("demo").value = "";
  loadPlace(s);
}

input.addEventListener("keydown", async e => {
  if (e.key === "ArrowDown" && suggestions.length) { selected = (selected + 1) % suggestions.length; showSuggestions(); e.preventDefault(); }
  else if (e.key === "ArrowUp" && suggestions.length) { selected = (selected - 1 + suggestions.length) % suggestions.length; showSuggestions(); e.preventDefault(); }
  else if (e.key === "Escape") { list.hidden = true; input.blur(); }
  else if (e.key === "Enter") {
    e.preventDefault();
    if (suggestions.length) return choose(Math.max(0, selected));
    const q = input.value.trim();
    if (!q) return;
    try {
      const res = await searchCities(q);
      if (res.length) { suggestions = res; choose(0); }
      else setStatus(`Aucune ville trouvée pour « ${q} ».`, true);
    } catch { setStatus("Recherche impossible pour le moment.", true); }
  }
});
list.addEventListener("pointerdown", e => { const li = e.target.closest("li[data-i]"); if (li) { e.preventDefault(); choose(+li.dataset.i); } });
input.addEventListener("blur", () => setTimeout(() => { list.hidden = true; }, 150));
document.addEventListener("keydown", e => {
  if (e.key === "/" && document.activeElement !== input && !/INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName)) { e.preventDefault(); input.focus(); }
});

// ===================================================================
// Boutons
// ===================================================================
$("locate").addEventListener("click", () => {
  if (!navigator.geolocation) return setStatus("La géolocalisation n'est pas disponible sur cet appareil.", true);
  setStatus("Localisation en cours…");
  navigator.geolocation.getCurrentPosition(async pos => {
    const { latitude: lat, longitude: lon } = pos.coords;
    const g = await reverseGeocode(lat, lon);
    state.demo = ""; $("demo").value = "";
    loadPlace({ ...g, lat, lon });
  }, () => setStatus("Impossible d'obtenir ta position (autorisation refusée ?).", true), { timeout: 10000, maximumAge: 600000 });
});

$("unit").addEventListener("click", () => {
  state.unit = state.unit === "C" ? "F" : "C";
  store.set("unit", state.unit);
  render();
});

$("share").addEventListener("click", async () => {
  const url = location.href;
  const text = state.wx ? `${state.place.name} : ${deg(state.wx.current.temperature_2m)}, ${label(state.wx.current.weather_code).toLowerCase()}` : "Météo vivante";
  try {
    if (navigator.share) await navigator.share({ title: "Météo vivante", text, url });
    else { await navigator.clipboard.writeText(url); flashStatus("🔗 Lien copié !"); }
  } catch {}
});
function flashStatus(msg) { setStatus(msg); setTimeout(() => { if ($("status").textContent === msg) setStatus(""); }, 2000); }

$("demo").addEventListener("change", e => {
  state.demo = e.target.value;
  updateSky();
});

addEventListener("resize", (() => {
  let t; let lastW = innerWidth;
  return () => {
    clearTimeout(t);
    t = setTimeout(() => {
      if (innerWidth === lastW || !state.wx) return; // ignore les redimensionnements verticaux (barre d'adresse mobile)
      lastW = innerWidth;
      const x = ctx();
      charts.temperature($("chart-temp"), x, { T, deg, hh, icon, label });
      charts.rain($("chart-rain"), x, { hh, nf });
    }, 150);
  };
})());

// Rafraîchit les données toutes les 10 minutes quand la page est visible
setInterval(() => { if (!document.hidden && state.place) loadPlace(state.place, { quiet: true }); }, 10 * 60e3);

// ===================================================================
// Carte radar (Leaflet + RainViewer)
// ===================================================================
let map, marker, radarLayers = [], radarFrames = [], radarPos = 0, radarTimer, radarPlaying = true, radarHost = "";

function initMap() {
  if (map || !window.L) return;
  map = L.map("map", { zoomControl: true, attributionControl: true, scrollWheelZoom: false, maxZoom: 10, minZoom: 3 });
  L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
    subdomains: "abcd", maxZoom: 19,
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> © <a href="https://carto.com/attributions">CARTO</a>',
  }).addTo(map);
  marker = L.circleMarker([0, 0], { radius: 7, color: "#fff", weight: 3, fillColor: "#ffcf6e", fillOpacity: 1 }).addTo(map);
  loadRadar();
  setInterval(loadRadar, 10 * 60e3);
}

async function loadRadar() {
  try {
    const d = await getJSON("https://api.rainviewer.com/public/weather-maps.json");
    radarHost = d.host;
    const frames = [...(d.radar?.past || []), ...(d.radar?.nowcast || [])];
    if (!frames.length) throw new Error("aucune image");
    radarLayers.forEach(l => map.removeLayer(l));
    radarFrames = frames;
    radarLayers = frames.map(f => L.tileLayer(`${radarHost}${f.path}/256/{z}/{x}/{y}/2/1_1.png`, {
      opacity: 0, zIndex: 10, maxNativeZoom: 7, maxZoom: 10, tileSize: 256,
      attribution: '<a href="https://www.rainviewer.com/">RainViewer</a>',
    }).addTo(map));
    radarPos = d.radar.past.length - 1;
    showFrame(radarPos);
    $("radar-controls").hidden = false;
    $("map-note").textContent = "Animation des 2 dernières heures de précipitations. Zoome pour le détail.";
    if (radarPlaying) playRadar();
  } catch {
    $("radar-controls").hidden = true;
    $("map-note").textContent = "Le radar de pluie n'est pas disponible pour le moment.";
  }
}

function showFrame(i) {
  radarLayers.forEach((l, k) => l.setOpacity(k === i ? 0.75 : 0));
  const f = radarFrames[i];
  if (f) $("radar-time").textContent = new Date(f.time * 1000).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}
function playRadar() {
  clearInterval(radarTimer);
  radarTimer = setInterval(() => {
    radarPos = (radarPos + 1) % radarFrames.length;
    showFrame(radarPos);
  }, 700);
}
$("radar-play").addEventListener("click", () => {
  radarPlaying = !radarPlaying;
  $("radar-play").textContent = radarPlaying ? "⏸" : "▶";
  $("radar-play").setAttribute("aria-label", radarPlaying ? "Pause" : "Lecture");
  if (radarPlaying) playRadar(); else clearInterval(radarTimer);
});

function updateMap() {
  if (!window.L) return;
  const target = $("map");
  const go = () => {
    initMap();
    map.setView([state.place.lat, state.place.lon], 7);
    marker.setLatLng([state.place.lat, state.place.lon]);
    setTimeout(() => map.invalidateSize(), 50);
  };
  if (map) return go();
  // On ne charge la carte que lorsqu'elle approche de l'écran
  const io = new IntersectionObserver(entries => {
    if (entries.some(e => e.isIntersecting)) { io.disconnect(); go(); }
  }, { rootMargin: "300px" });
  io.observe(target);
}

// ===================================================================
// Démarrage
// ===================================================================
function initialPlace() {
  const q = new URLSearchParams(location.search);
  const lat = parseFloat(q.get("lat")), lon = parseFloat(q.get("lon"));
  if (Number.isFinite(lat) && Number.isFinite(lon)) return { lat, lon, name: q.get("name") || "Lieu partagé", sub: q.get("sub") || "" };
  return store.get("last", null) || { name: "Paris", sub: "Île-de-France, France", lat: 48.8566, lon: 2.3522 };
}

setSkyGradient("clear", true);
loadPlace(initialPlace());
refreshFavTemps();
renderFavs();

if ("serviceWorker" in navigator && location.protocol === "https:") {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
