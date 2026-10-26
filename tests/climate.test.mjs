import { test } from "node:test";
import assert from "node:assert/strict";
import { yearlyAnomalies, trendPerDecade, last12MonthsAnomaly, stripeColor, aqiBand, weatherLabel } from "../js/climate.js";

// Synthetic daily series: a constant 20 °C plus 0.02 °C of warming per year.
function series(from, to) {
  const times = [], temps = [];
  for (let d = new Date(`${from}-01-01T00:00Z`); d.getUTCFullYear() <= to; d.setUTCDate(d.getUTCDate() + 1)) {
    times.push(d.toISOString().slice(0, 10));
    temps.push(20 + (d.getUTCFullYear() - from) * 0.02);
  }
  return { times, temps };
}

test("yearly anomalies are measured against the 1991–2020 mean", () => {
  const { times, temps } = series(1950, 2024);
  const res = yearlyAnomalies(times, temps);
  assert.equal(res.years.length, 75);
  // Baseline = mean of 1991..2020 = 20 + 55.5 * 0.02
  assert.ok(Math.abs(res.baseline - 21.11) < 1e-9);
  assert.ok(Math.abs(res.years.at(-1).anomaly - (20 + 74 * 0.02 - 21.11)) < 1e-9);
});

test("partial years are left out", () => {
  const { times, temps } = series(1950, 2024);
  const res = yearlyAnomalies([...times, "2025-01-01", "2025-01-02"], [...temps, 99, 99]);
  assert.equal(res.years.at(-1).year, 2024);
});

test("too little baseline data returns null", () => {
  const { times, temps } = series(2010, 2024);
  assert.equal(yearlyAnomalies(times, temps), null);
});

test("trend per decade recovers the warming rate", () => {
  const { times, temps } = series(1950, 2024);
  assert.ok(Math.abs(trendPerDecade(yearlyAnomalies(times, temps).years) - 0.2) < 1e-6);
});

test("past-12-months anomaly compares with the same calendar days", () => {
  const { times, temps } = series(1950, 2024);
  const v = last12MonthsAnomaly(times, temps);
  assert.ok(Math.abs(v - (74 * 0.02 - 55.5 * 0.02)) < 0.01);
});

test("stripe colours diverge around zero and saturate", () => {
  assert.equal(stripeColor(0), "#fff5f0"); // neutral year: palest tint
  assert.equal(stripeColor(5), "#67000d");
  assert.equal(stripeColor(-5), "#08306b");
});

test("AQI bands and weather codes", () => {
  assert.equal(aqiBand(42).label, "Good");
  assert.equal(aqiBand(133).label, "Unhealthy for sensitive groups");
  assert.equal(aqiBand(null).label, "No data");
  assert.equal(weatherLabel(95)[0], "Thunderstorm");
  assert.equal(weatherLabel(1234)[0], "Unknown");
});
