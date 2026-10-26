/* ==========================================================================
   EarthPulse — data sources. Every source is free, keyless and CORS-enabled.
   ========================================================================== */

const TIMEOUT_MS = 25000;

async function getJSON(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`${new URL(url).host} answered ${res.status}`);
    return await res.json();
  } catch (err) {
    if (err.name === "AbortError") throw new Error(`${new URL(url).host} took too long to answer`);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/** USGS earthquake feed, e.g. "2.5_week". */
export async function fetchQuakes(feed) {
  const data = await getJSON(`https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/${feed}.geojson`);
  return data.features
    .filter((f) => f.geometry && f.properties.mag != null)
    .map((f) => ({
      id: f.id,
      mag: f.properties.mag,
      place: f.properties.place || "Unknown location",
      time: f.properties.time,
      url: f.properties.url,
      tsunami: f.properties.tsunami === 1,
      lon: f.geometry.coordinates[0],
      lat: f.geometry.coordinates[1],
      depth: f.geometry.coordinates[2],
    }))
    .sort((a, b) => b.time - a.time);
}

/** NASA EONET open natural events from the last 60 days. */
export async function fetchEvents() {
  const data = await getJSON("https://eonet.gsfc.nasa.gov/api/v3/events?status=open&days=60");
  return data.events
    .map((e) => {
      const g = e.geometry?.[e.geometry.length - 1];
      if (!g || g.type !== "Point") return null;
      return {
        id: e.id,
        title: e.title,
        category: e.categories?.[0]?.id || "other",
        categoryTitle: e.categories?.[0]?.title || "Other",
        date: g.date,
        lon: g.coordinates[0],
        lat: g.coordinates[1],
        source: e.sources?.[0]?.url || e.link,
      };
    })
    .filter(Boolean)
    .sort((a, b) => new Date(b.date) - new Date(a.date));
}

export async function searchPlaces(query) {
  const data = await getJSON(`https://geocoding-api.open-meteo.com/v1/search?count=6&language=en&name=${encodeURIComponent(query)}`);
  return (data.results || []).map((r) => ({
    name: r.name,
    region: [r.admin1, r.country].filter(Boolean).join(", "),
    lat: r.latitude,
    lon: r.longitude,
  }));
}

/** Best-effort place name for a clicked point; falls back to null. */
export async function reverseGeocode(lat, lon) {
  try {
    const d = await getJSON(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=10&lat=${lat}&lon=${lon}`);
    const a = d.address || {};
    const local = a.city || a.town || a.village || a.county || a.state_district || a.state;
    return [local, a.country].filter(Boolean).join(", ") || null;
  } catch {
    return null;
  }
}

export function fetchWeather(lat, lon) {
  return getJSON(
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&timezone=auto&forecast_days=7` +
      "&current=temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,weather_code,wind_speed_10m,is_day" +
      "&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum",
  );
}

export function fetchAir(lat, lon) {
  return getJSON(
    `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lon}&timezone=auto` +
      "&current=us_aqi,pm2_5,pm10,ozone,nitrogen_dioxide",
  );
}

/** Daily mean temperature from 1950 to about a week ago (ERA5 lags a few days). */
export function fetchClimate(lat, lon) {
  const end = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10);
  return getJSON(
    `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lon}` +
      `&start_date=1950-01-01&end_date=${end}&daily=temperature_2m_mean&timezone=auto`,
  );
}
