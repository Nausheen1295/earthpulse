/* ==========================================================================
   EarthPulse — app wiring: map, layers, place panel, lists.
   ========================================================================== */
import { initTheme, currentTheme, esc } from "./theme.js";
import { fetchQuakes, fetchEvents, searchPlaces, reverseGeocode, fetchWeather, fetchAir, fetchClimate } from "./api.js";
import {
  yearlyAnomalies, trendPerDecade, last12MonthsAnomaly, stripeColor,
  weatherLabel, aqiBand, depthColor, eventColor, eventShortLabel, BASELINE,
} from "./climate.js";

const $ = (id) => document.getElementById(id);
const REFRESH_MS = 5 * 60 * 1000;
const fmtTime = (t) => new Date(t).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
const ago = (t) => {
  const m = Math.round((Date.now() - new Date(t)) / 60000);
  if (m < 60) return `${m} min ago`;
  if (m < 48 * 60) return `${Math.round(m / 60)} h ago`;
  return `${Math.round(m / 1440)} days ago`;
};
const signed = (v, d = 1) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(d)}`;

/* ------------------------------------------------------------------ map */
const map = L.map("map", { worldCopyJump: true, zoomControl: true }).setView([20, 10], 2);
// OpenStreetMap tiles; dark mode inverts them with a CSS filter (see app.css).
const ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution: ATTR, maxZoom: 18 }).addTo(map);
// Keep the browser's address-bar colour in step with the theme.
const paintThemeColor = (t) => { document.querySelector('meta[name="theme-color"]').content = t === "light" ? "#eef6ff" : "#07080d"; };
initTheme($("themeToggle"), paintThemeColor);
paintThemeColor(currentTheme());

const quakeLayer = L.layerGroup().addTo(map);
const eventLayer = L.layerGroup().addTo(map);
let pickMarker = null;
const quakeMarkers = new Map();
const eventMarkers = new Map();

// Remember which quake/event popup is open so a background refresh can reopen it.
let openPopup = null;
map.on("popupopen", (e) => { openPopup = e.popup._source?.options.popupKey ?? null; });
map.on("popupclose", () => { openPopup = null; });

document.querySelectorAll("[data-layer]").forEach((chip) => {
  chip.addEventListener("click", () => {
    const on = chip.getAttribute("aria-pressed") !== "true";
    chip.setAttribute("aria-pressed", String(on));
    const layer = chip.dataset.layer === "quakes" ? quakeLayer : eventLayer;
    on ? layer.addTo(map) : layer.remove();
  });
});

map.on("click", (e) => selectPlace(e.latlng.lat, wrapLon(e.latlng.lng)));
const wrapLon = (lon) => ((((lon + 180) % 360) + 360) % 360) - 180;

/* ---------------------------------------------------------------- tabs */
const tabs = [...document.querySelectorAll('[role="tab"]')];
function showTab(tab) {
  tabs.forEach((t) => {
    const on = t === tab;
    t.setAttribute("aria-selected", String(on));
    t.tabIndex = on ? 0 : -1;
    $(t.getAttribute("aria-controls")).hidden = !on;
  });
}
tabs.forEach((t, i) => {
  t.addEventListener("click", () => showTab(t));
  t.addEventListener("keydown", (e) => {
    const d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!d) return;
    const next = tabs[(i + d + tabs.length) % tabs.length];
    showTab(next); next.focus();
  });
});

/* ---------------------------------------------------------- earthquakes */
let quakes = [];
let quakeToken = 0;
/** `quiet` is for background refreshes: keep the current list on screen until new data arrives. */
async function loadQuakes({ quiet = false } = {}) {
  const token = ++quakeToken;
  const list = $("quakeList");
  if (!quiet) list.innerHTML = '<li class="empty"><span class="spinner"></span> Loading earthquakes…</li>';
  try {
    const data = await fetchQuakes($("quakePeriod").value);
    if (token !== quakeToken) return; // a newer period was picked meanwhile
    quakes = data;
    drawQuakes();
  } catch (err) {
    if (token !== quakeToken || quiet) return;
    list.innerHTML = `<li class="note error">Couldn't load earthquakes: ${esc(err.message)}</li>`;
  }
}
function drawQuakes() {
  const min = Number($("minMag").value);
  const shown = quakes.filter((q) => q.mag >= min);
  const reopen = openPopup;
  quakeLayer.clearLayers();
  quakeMarkers.clear();
  // Draw small quakes first so big ones sit on top.
  [...shown].sort((a, b) => a.mag - b.mag).forEach((q) => {
    const m = L.circleMarker([q.lat, q.lon], {
      radius: Math.max(3, (q.mag - 1.5) * 2.6),
      color: "#0b0d14", weight: 1, fillColor: depthColor(q.depth), fillOpacity: .85,
      popupKey: `q:${q.id}`,
    }).bindPopup(
      `<b>M ${q.mag.toFixed(1)}</b> — ${esc(q.place)}<br>` +
      `${fmtTime(q.time)} · depth ${q.depth.toFixed(0)} km` +
      (q.tsunami ? "<br><b>Tsunami flag raised by USGS</b>" : "") +
      `<br><a href="${esc(q.url)}" target="_blank" rel="noopener">USGS event page ↗</a>`,
    );
    m.addTo(quakeLayer);
    quakeMarkers.set(q.id, m);
  });
  if (reopen?.startsWith("q:")) quakeMarkers.get(reopen.slice(2))?.openPopup();
  const list = $("quakeList");
  if (!shown.length) { list.innerHTML = '<li class="empty">No earthquakes at this magnitude in this period.</li>'; return; }
  list.innerHTML = shown.slice(0, 150).map((q) => `
    <li><button type="button" data-quake="${esc(q.id)}">
      <span class="mag" style="box-shadow: inset 3px 0 ${depthColor(q.depth)}">${q.mag.toFixed(1)}</span>
      <span><span class="ttl">${esc(q.place)}</span><span class="sub">${ago(q.time)} · ${q.depth.toFixed(0)} km deep${q.tsunami ? " · tsunami flag" : ""}</span></span>
    </button></li>`).join("") +
    (shown.length > 150 ? `<li class="small muted" style="padding:10px 4px">Showing the latest 150 of ${shown.length}. All are on the map.</li>` : "");
}
$("quakeList").addEventListener("click", (e) => {
  const b = e.target.closest("[data-quake]");
  const m = b && quakeMarkers.get(b.dataset.quake);
  if (m) { map.flyTo(m.getLatLng(), 6, { duration: .8 }); m.openPopup(); }
});
$("quakePeriod").addEventListener("change", () => loadQuakes());
$("minMag").addEventListener("input", () => { $("minMagOut").value = $("minMag").value; drawQuakes(); });

/* ------------------------------------------------------- natural events */
let events = [];
let eventCat = "all";
async function loadEvents({ quiet = false } = {}) {
  if (!quiet) $("eventList").innerHTML = '<li class="empty"><span class="spinner"></span> Loading events…</li>';
  try {
    events = await fetchEvents();
    if (eventCat !== "all" && !events.some((e) => e.category === eventCat)) eventCat = "all";
    $("statEvents").textContent = events.length;
    const cats = [...new Map(events.map((e) => [e.category, e.categoryTitle]))];
    $("eventFilter").innerHTML = [["all", "All"], ...cats].map(([id, t]) =>
      `<button class="chip" type="button" data-cat="${esc(id)}" aria-pressed="${id === eventCat}">${esc(t)} ${id === "all" ? "" : `<span class="muted">${events.filter((e) => e.category === id).length}</span>`}</button>`).join("");
    drawEvents();
  } catch (err) {
    if (quiet) return;
    $("statEvents").textContent = "—";
    $("eventList").innerHTML = `<li class="note error">Couldn't load NASA EONET events: ${esc(err.message)}</li>`;
  }
}
function drawEvents() {
  const reopen = openPopup;
  eventLayer.clearLayers();
  eventMarkers.clear();
  const shown = events.filter((e) => eventCat === "all" || e.category === eventCat);
  shown.forEach((ev) => {
    const icon = L.divIcon({
      className: "",
      html: `<span style="display:block;width:11px;height:11px;transform:rotate(45deg);background:${eventColor(ev.category)};border:1.5px solid #0b0d14;border-radius:2px"></span>`,
      iconSize: [11, 11],
    });
    const m = L.marker([ev.lat, ev.lon], { icon, title: ev.title, popupKey: `e:${ev.id}` }).bindPopup(
      `<b>${esc(ev.title)}</b><br>${esc(ev.categoryTitle)} · last update ${fmtTime(ev.date)}` +
      (ev.source ? `<br><a href="${esc(ev.source)}" target="_blank" rel="noopener">Source ↗</a>` : ""),
    );
    m.addTo(eventLayer);
    eventMarkers.set(ev.id, m);
  });
  if (reopen?.startsWith("e:")) eventMarkers.get(reopen.slice(2))?.openPopup();
  $("eventList").innerHTML = shown.length
    ? shown.slice(0, 150).map((ev) => `
      <li><button type="button" data-event="${esc(ev.id)}">
        <span class="mag" style="box-shadow: inset 3px 0 ${eventColor(ev.category)}; font-size:.7rem" title="${esc(ev.categoryTitle)}">${esc(eventShortLabel(ev.category, ev.categoryTitle))}</span>
        <span><span class="ttl">${esc(ev.title)}</span><span class="sub">${ago(ev.date)}</span></span>
      </button></li>`).join("")
    : '<li class="empty">No open events in this category.</li>';
}
$("eventFilter").addEventListener("click", (e) => {
  const b = e.target.closest("[data-cat]");
  if (!b) return;
  eventCat = b.dataset.cat;
  $("eventFilter").querySelectorAll("[data-cat]").forEach((c) => c.setAttribute("aria-pressed", String(c === b)));
  drawEvents();
});
$("eventList").addEventListener("click", (e) => {
  const b = e.target.closest("[data-event]");
  const m = b && eventMarkers.get(b.dataset.event);
  if (m) { map.flyTo(m.getLatLng(), 6, { duration: .8 }); m.openPopup(); }
});

/* ---------------------------------------------------------- global stats */
async function loadStats() {
  try {
    const day = await fetchQuakes("2.5_day");
    $("statQuakes").textContent = day.length;
    const top = day.reduce((a, b) => (b.mag > (a?.mag ?? -1) ? b : a), null);
    $("statStrongest").textContent = top ? `M ${top.mag.toFixed(1)}` : "—";
    $("statStrongest").title = top ? top.place : "";
  } catch {
    $("statQuakes").textContent = "—";
  }
  $("statUpdated").textContent = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/* ---------------------------------------------------------------- place */
let placeToken = 0;
async function selectPlace(lat, lon, name = null, { fly = false } = {}) {
  const token = ++placeToken;
  lat = Number(lat.toFixed(4)); lon = Number(lon.toFixed(4));
  showTab($("tab-place"));
  $("placeEmpty").hidden = true;
  $("place").hidden = false;
  $("placeName").textContent = name || "Selected point";
  $("placeCoords").textContent = `${Math.abs(lat).toFixed(2)}° ${lat >= 0 ? "N" : "S"}, ${Math.abs(lon).toFixed(2)}° ${lon >= 0 ? "E" : "W"}`;
  $("now").innerHTML = '<span class="spinner"></span>';
  $("forecast").innerHTML = "";
  $("air").innerHTML = '<p class="small muted">Loading…</p>';
  $("climate").innerHTML = '<p class="small muted"><span class="spinner"></span> Crunching 75 years of daily data…</p>';

  if (pickMarker) pickMarker.setLatLng([lat, lon]);
  else pickMarker = L.marker([lat, lon], { icon: L.divIcon({ className: "", html: '<div class="pick-marker"></div>', iconSize: [18, 18] }), keyboard: false, zIndexOffset: 1000 }).addTo(map);
  if (fly) map.flyTo([lat, lon], Math.max(map.getZoom(), 6), { duration: .8 });

  const params = new URLSearchParams({ lat, lon });
  if (name) params.set("name", name);
  history.replaceState(null, "", `?${params}`);

  if (!name) reverseGeocode(lat, lon).then((n) => {
    if (token !== placeToken || !n) return;
    $("placeName").textContent = n;
    params.set("name", n);
    history.replaceState(null, "", `?${params}`);
  });

  fetchWeather(lat, lon).then((w) => token === placeToken && renderWeather(w))
    .catch((err) => token === placeToken && ($("now").innerHTML = `<p class="note error">Weather unavailable: ${esc(err.message)}</p>`));
  fetchAir(lat, lon).then((a) => token === placeToken && renderAir(a))
    .catch(() => token === placeToken && ($("air").innerHTML = '<p class="small muted">No air-quality data for this point.</p>'));
  fetchClimate(lat, lon).then((c) => token === placeToken && renderClimate(c))
    .catch((err) => token === placeToken && ($("climate").innerHTML = `<p class="note error">Climate archive unavailable: ${esc(err.message)}</p>`));
}

function renderWeather(w) {
  const c = w.current;
  const [label, icon] = weatherLabel(c.weather_code, c.is_day);
  $("now").innerHTML = `
    <span class="temp">${Math.round(c.temperature_2m)}°</span>
    <span><span class="cond">${icon} ${esc(label)}</span><br><span class="small muted">Feels like ${Math.round(c.apparent_temperature)}° · local time ${esc(c.time.slice(11, 16))}</span></span>
    <div class="meta">
      <div><b>${c.relative_humidity_2m}%</b>humidity</div>
      <div><b>${Math.round(c.wind_speed_10m)} km/h</b>wind</div>
      <div><b>${c.precipitation} mm</b>precipitation</div>
    </div>`;
  const d = w.daily;
  $("forecast").innerHTML = d.time.map((t, i) => {
    const [lab, ic] = weatherLabel(d.weather_code[i]);
    const day = new Date(`${t}T12:00`).toLocaleDateString([], { weekday: "short" });
    return `<div title="${esc(lab)} · ${d.precipitation_sum[i]} mm">${day}<span class="ic" aria-hidden="true">${ic}</span><b>${Math.round(d.temperature_2m_max[i])}°</b>${Math.round(d.temperature_2m_min[i])}°<span class="sr-only">, ${esc(lab)}</span></div>`;
  }).join("");
}

function renderAir(a) {
  const c = a.current || {};
  const band = aqiBand(c.us_aqi);
  if (c.us_aqi == null) { $("air").innerHTML = '<p class="small muted">No air-quality data for this point.</p>'; return; }
  $("air").innerHTML = `
    <div class="aqi">
      <span class="aqi-badge" style="--c:${band.color}" aria-label="US AQI ${c.us_aqi}">${c.us_aqi}</span>
      <div class="aqi-detail"><b>${esc(band.label)}</b> (US AQI)<br>
        PM2.5 ${c.pm2_5 ?? "—"} µg/m³ · PM10 ${c.pm10 ?? "—"} · O₃ ${c.ozone ?? "—"} · NO₂ ${c.nitrogen_dioxide ?? "—"}</div>
    </div>`;
}

function renderClimate(c) {
  const times = c.daily?.time || [];
  const temps = c.daily?.temperature_2m_mean || [];
  const res = yearlyAnomalies(times, temps);
  if (!res) { $("climate").innerHTML = '<p class="small muted">Not enough archive data for this point.</p>'; return; }
  const ys = res.years;
  const trend = trendPerDecade(ys);
  const recent = last12MonthsAnomaly(times, temps);
  const warmest = ys.reduce((a, b) => (b.anomaly > a.anomaly ? b : a));
  const first = ys[0].year, last = ys[ys.length - 1].year;

  // Bar chart of anomalies with a least-squares trend line.
  const W = 360, H = 150, P = { l: 30, r: 6, t: 8, b: 18 };
  const max = Math.max(1, ...ys.map((y) => Math.abs(y.anomaly)));
  const x = (i) => P.l + (i / ys.length) * (W - P.l - P.r);
  const y = (v) => P.t + ((max - v) / (2 * max)) * (H - P.t - P.b);
  const bw = (W - P.l - P.r) / ys.length;
  const mid = (ys.length - 1) / 2;
  const meanA = ys.reduce((s, p) => s + p.anomaly, 0) / ys.length;
  const slopeYr = trend / 10;
  const meanYear = ys.reduce((s, p) => s + p.year, 0) / ys.length;
  const tAt = (yr) => meanA + slopeYr * (yr - meanYear);
  const ticks = [-max, 0, max].map((v) => Number(v.toFixed(1)));

  $("climate").innerHTML = `
    <div class="stripes" role="img" aria-label="Warming stripes ${first} to ${last}: each stripe is one year, blue cooler and red warmer than ${BASELINE[0]}–${BASELINE[1]}">
      ${ys.map((p) => `<span style="background:${stripeColor(p.anomaly)}" title="${p.year}: ${signed(p.anomaly, 2)} °C"></span>`).join("")}
    </div>
    <svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Yearly temperature anomaly chart, trend ${signed(trend, 2)} °C per decade">
      ${ticks.map((t) => `<line class="axis" x1="${P.l}" x2="${W - P.r}" y1="${y(t)}" y2="${y(t)}" stroke-opacity="${t === 0 ? 1 : .4}"/><text x="${P.l - 4}" y="${y(t) + 3}" text-anchor="end">${t > 0 ? "+" : ""}${t}</text>`).join("")}
      ${ys.map((p, i) => `<rect x="${x(i) + .3}" width="${Math.max(bw - .6, .6)}" y="${Math.min(y(0), y(p.anomaly))}" height="${Math.abs(y(p.anomaly) - y(0))}" fill="${stripeColor(p.anomaly)}"><title>${p.year}: ${signed(p.anomaly, 2)} °C</title></rect>`).join("")}
      <line class="trend" x1="${x(0)}" x2="${x(ys.length)}" y1="${y(tAt(first))}" y2="${y(tAt(last))}"/>
      <text x="${P.l}" y="${H - 4}">${first}</text><text x="${x(mid)}" y="${H - 4}" text-anchor="middle">${ys[Math.round(mid)].year}</text><text x="${W - P.r}" y="${H - 4}" text-anchor="end">${last}</text>
    </svg>
    <div class="climate-facts">
      <div class="stat"><b>${signed(trend, 2)} °C</b><span>trend per decade</span></div>
      <div class="stat"><b>${recent == null ? "—" : `${signed(recent)} °C`}</b><span>past 12 months vs baseline</span></div>
      <div class="stat"><b>${warmest.year}</b><span>warmest year (${signed(warmest.anomaly)} °C)</span></div>
      <div class="stat"><b>${res.baseline.toFixed(1)} °C</b><span>${BASELINE[0]}–${BASELINE[1]} mean</span></div>
    </div>`;
}

/* --------------------------------------------------------------- search */
let results = [];
let active = -1;
const resBox = $("searchResults");
function closeResults() { resBox.hidden = true; active = -1; }
function choose(i) {
  const r = results[i];
  if (!r) return;
  closeResults();
  $("searchInput").value = r.name;
  selectPlace(r.lat, r.lon, [r.name, r.region.split(", ").pop()].filter(Boolean).join(", "), { fly: true });
}
$("searchForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const q = $("searchInput").value.trim();
  if (q.length < 2) return;
  resBox.hidden = false;
  resBox.innerHTML = '<li><span class="spinner"></span> Searching…</li>';
  try {
    results = await searchPlaces(q);
  } catch (err) {
    resBox.innerHTML = `<li>Search failed: ${esc(err.message)}</li>`; return;
  }
  if (!results.length) { resBox.innerHTML = `<li>No places found for “${esc(q)}”.</li>`; return; }
  if (results.length === 1) { choose(0); return; }
  resBox.innerHTML = results.map((r, i) => `<li role="option" id="res-${i}" data-i="${i}" aria-selected="false">${esc(r.name)} <small>${esc(r.region)}</small></li>`).join("");
});
resBox.addEventListener("click", (e) => { const li = e.target.closest("[data-i]"); if (li) choose(Number(li.dataset.i)); });
$("searchInput").addEventListener("keydown", (e) => {
  if (resBox.hidden || !results.length) return;
  if (e.key === "Escape") { closeResults(); return; }
  if (e.key !== "ArrowDown" && e.key !== "ArrowUp" && !(e.key === "Enter" && active >= 0)) return;
  e.preventDefault();
  if (e.key === "Enter") { choose(active); return; }
  active = (active + (e.key === "ArrowDown" ? 1 : -1) + results.length) % results.length;
  resBox.querySelectorAll("[data-i]").forEach((li, i) => li.setAttribute("aria-selected", String(i === active)));
});
document.addEventListener("click", (e) => { if (!$("searchForm").contains(e.target)) closeResults(); });

function showSearchMessage(html) {
  results = [];
  resBox.hidden = false;
  resBox.innerHTML = `<li>${html}</li>`;
}
if (!navigator.geolocation) $("locateBtn").hidden = true;
$("locateBtn").addEventListener("click", (e) => {
  e.stopPropagation(); // keep the document click handler from closing the message straight away
  showSearchMessage('<span class="spinner"></span> Finding your location…');
  navigator.geolocation.getCurrentPosition(
    (p) => { closeResults(); selectPlace(p.coords.latitude, p.coords.longitude, null, { fly: true }); },
    (err) => showSearchMessage(err.code === err.PERMISSION_DENIED
      ? "Location permission was denied. Search a place or click the map instead."
      : "Couldn't find your location. Search a place or click the map instead."),
    { timeout: 10000 },
  );
});
document.querySelectorAll("[data-place]").forEach((b) => b.addEventListener("click", () => {
  const [n, la, lo] = b.dataset.place.split("|");
  selectPlace(Number(la), Number(lo), n, { fly: true });
}));
$("shareBtn").addEventListener("click", async () => {
  try { await navigator.clipboard.writeText(location.href); $("shareBtn").textContent = "Copied ✓"; }
  catch { $("shareBtn").textContent = "Copy failed"; }
  setTimeout(() => { $("shareBtn").textContent = "Copy link"; }, 1800);
});

/* ---------------------------------------------------------------- start */
loadStats();
loadQuakes();
loadEvents();
setInterval(() => { loadStats(); loadQuakes({ quiet: true }); loadEvents({ quiet: true }); }, REFRESH_MS);

const qs = new URLSearchParams(location.search);
if (qs.has("lat") && qs.has("lon")) {
  const la = Number(qs.get("lat")), lo = Number(qs.get("lon"));
  if (Number.isFinite(la) && Number.isFinite(lo) && Math.abs(la) <= 90 && Math.abs(lo) <= 180) selectPlace(la, lo, qs.get("name"), { fly: true });
}
