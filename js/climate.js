/* ==========================================================================
   EarthPulse — climate maths. Pure functions, no DOM (tested in tests/).
   ========================================================================== */

export const BASELINE = [1991, 2020];

/**
 * Turns daily means into yearly anomalies against the 1991–2020 baseline.
 * Only years with at least 360 days of data count, so a partial year never
 * looks artificially warm or cold.
 */
export function yearlyAnomalies(times, temps) {
  const byYear = new Map();
  times.forEach((t, i) => {
    const v = temps[i];
    if (v == null) return;
    const y = Number(t.slice(0, 4));
    const e = byYear.get(y) || { sum: 0, n: 0 };
    e.sum += v; e.n += 1;
    byYear.set(y, e);
  });
  const years = [...byYear].filter(([, e]) => e.n >= 360).map(([year, e]) => ({ year, mean: e.sum / e.n }));
  const base = years.filter((y) => y.year >= BASELINE[0] && y.year <= BASELINE[1]);
  if (base.length < 20) return null;
  const baseline = base.reduce((s, y) => s + y.mean, 0) / base.length;
  return { baseline, years: years.map((y) => ({ ...y, anomaly: y.mean - baseline })) };
}

/** Least-squares slope, in °C per decade. */
export function trendPerDecade(points) {
  const n = points.length;
  if (n < 2) return 0;
  const mx = points.reduce((s, p) => s + p.year, 0) / n;
  const my = points.reduce((s, p) => s + p.anomaly, 0) / n;
  let num = 0, den = 0;
  for (const p of points) { num += (p.year - mx) * (p.anomaly - my); den += (p.year - mx) ** 2; }
  return den ? (num / den) * 10 : 0;
}

/**
 * The most recent 365 days compared with the same calendar days in the
 * baseline years — a "how unusual is this past year" number.
 */
export function last12MonthsAnomaly(times, temps) {
  const baseByDay = new Map();
  times.forEach((t, i) => {
    const y = Number(t.slice(0, 4));
    if (y < BASELINE[0] || y > BASELINE[1] || temps[i] == null) return;
    const md = t.slice(5, 10);
    const e = baseByDay.get(md) || { sum: 0, n: 0 };
    e.sum += temps[i]; e.n += 1;
    baseByDay.set(md, e);
  });
  let diff = 0, n = 0;
  for (let i = Math.max(0, times.length - 365); i < times.length; i++) {
    const b = baseByDay.get(times[i].slice(5, 10));
    if (temps[i] == null || !b) continue;
    diff += temps[i] - b.sum / b.n; n += 1;
  }
  return n >= 300 ? diff / n : null;
}

/** Diverging blue→white→red colour for an anomaly, saturating at ±range. */
export function stripeColor(anomaly, range = 1.5) {
  const BLUES = ["#f7fbff", "#deebf7", "#c6dbef", "#9ecae1", "#6baed6", "#4292c6", "#2171b5", "#08519c", "#08306b"];
  const REDS = ["#fff5f0", "#fee0d2", "#fcbba1", "#fc9272", "#fb6a4a", "#ef3b2c", "#cb181d", "#a50f15", "#67000d"];
  const t = Math.max(-1, Math.min(1, anomaly / range));
  const ramp = t < 0 ? BLUES : REDS;
  return ramp[Math.round(Math.abs(t) * (ramp.length - 1))];
}

/** WMO weather code → short label + emoji. */
export function weatherLabel(code, isDay = 1) {
  const map = {
    0: ["Clear sky", isDay ? "☀️" : "🌙"], 1: ["Mainly clear", isDay ? "🌤️" : "🌙"], 2: ["Partly cloudy", "⛅"], 3: ["Overcast", "☁️"],
    45: ["Fog", "🌫️"], 48: ["Rime fog", "🌫️"],
    51: ["Light drizzle", "🌦️"], 53: ["Drizzle", "🌦️"], 55: ["Heavy drizzle", "🌧️"], 56: ["Freezing drizzle", "🌧️"], 57: ["Freezing drizzle", "🌧️"],
    61: ["Light rain", "🌦️"], 63: ["Rain", "🌧️"], 65: ["Heavy rain", "🌧️"], 66: ["Freezing rain", "🌧️"], 67: ["Freezing rain", "🌧️"],
    71: ["Light snow", "🌨️"], 73: ["Snow", "🌨️"], 75: ["Heavy snow", "❄️"], 77: ["Snow grains", "🌨️"],
    80: ["Rain showers", "🌦️"], 81: ["Rain showers", "🌧️"], 82: ["Violent showers", "⛈️"], 85: ["Snow showers", "🌨️"], 86: ["Snow showers", "❄️"],
    95: ["Thunderstorm", "⛈️"], 96: ["Thunderstorm, hail", "⛈️"], 99: ["Thunderstorm, hail", "⛈️"],
  };
  return map[code] || ["Unknown", "❔"];
}

/** US AQI band → label + colour. */
export function aqiBand(aqi) {
  if (aqi == null) return { label: "No data", color: "#94a3b8" };
  if (aqi <= 50) return { label: "Good", color: "#4ade80" };
  if (aqi <= 100) return { label: "Moderate", color: "#facc15" };
  if (aqi <= 150) return { label: "Unhealthy for sensitive groups", color: "#fb923c" };
  if (aqi <= 200) return { label: "Unhealthy", color: "#f87171" };
  if (aqi <= 300) return { label: "Very unhealthy", color: "#c084fc" };
  return { label: "Hazardous", color: "#e11d48" };
}

export function depthColor(km) {
  if (km < 70) return "#fde047";
  if (km < 300) return "#fb923c";
  return "#ef4444";
}

export function eventColor(category) {
  return { wildfires: "#f97316", severeStorms: "#38bdf8", volcanoes: "#e11d48" }[category] || "#a5b4fc";
}
