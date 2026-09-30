import type { LatLng } from "@/config/geography";

export type DailyWeather = {
  date: string;
  wave: number | null;
  gust: number | null;
  rain: number | null;
};
export type SeasonalWeather = {
  cautionShare: number;
  poorShare: number;
  condition: "Good" | "Caution" | "Poor";
};

/** Open-Meteo forecast values. Missing variables remain null; no weather values are synthesized. */
export async function fetchDailyWeather(
  position: LatLng,
  forecastDays = 7,
): Promise<DailyWeather[]> {
  const lat = position.lat.toFixed(3),
    lon = position.lng.toFixed(3);
  const days = Math.min(16, Math.max(1, forecastDays));
  const query = `latitude=${lat}&longitude=${lon}&daily=wind_gusts_10m_max,precipitation_sum&wind_speed_unit=kn&timezone=auto&forecast_days=${days}`;
  const [marineResponse, forecastResponse] = await Promise.all([
    fetch(
      `https://marine-api.open-meteo.com/v1/marine?latitude=${lat}&longitude=${lon}&daily=wave_height_max&timezone=auto&forecast_days=${days}`,
    ),
    fetch(`https://api.open-meteo.com/v1/forecast?${query}`),
  ]);
  if (!marineResponse.ok || !forecastResponse.ok)
    throw new Error("Open-Meteo daily forecast unavailable");
  const [marine, forecast] = await Promise.all([marineResponse.json(), forecastResponse.json()]);
  const dates: string[] = forecast.daily?.time ?? [];
  return dates.map((date, index) => ({
    date,
    wave:
      typeof marine.daily?.wave_height_max?.[index] === "number"
        ? marine.daily.wave_height_max[index]
        : null,
    gust:
      typeof forecast.daily?.wind_gusts_10m_max?.[index] === "number"
        ? forecast.daily.wind_gusts_10m_max[index]
        : null,
    rain:
      typeof forecast.daily?.precipitation_sum?.[index] === "number"
        ? forecast.daily.precipitation_sum[index]
        : null,
  }));
}

/** Five complete years of daily archive values; wave history is deliberately not inferred. */
export async function fetchSeasonalWeather(
  position: LatLng,
): Promise<Array<{ monthDay: string; gust: number | null; rain: number | null }>> {
  const year = new Date().getFullYear();
  const startYear = year - 5;
  const lat = position.lat.toFixed(3),
    lon = position.lng.toFixed(3);
  const params = new URLSearchParams({
    latitude: lat,
    longitude: lon,
    start_date: `${startYear}-01-01`,
    end_date: `${year - 1}-12-31`,
    daily: "wind_gusts_10m_max,precipitation_sum",
    wind_speed_unit: "kn",
    timezone: "auto",
  });
  const response = await fetch(`https://archive-api.open-meteo.com/v1/archive?${params}`);
  if (!response.ok) throw new Error("Open-Meteo historical weather unavailable");
  const json = await response.json();
  return (json.daily?.time ?? []).map((date: string, index: number) => ({
    monthDay: date.slice(5),
    gust:
      typeof json.daily?.wind_gusts_10m_max?.[index] === "number"
        ? json.daily.wind_gusts_10m_max[index]
        : null,
    rain:
      typeof json.daily?.precipitation_sum?.[index] === "number"
        ? json.daily.precipitation_sum[index]
        : null,
  }));
}

export function seasonalCondition(
  date: string,
  history: Array<{ monthDay: string; gust: number | null; rain: number | null }>,
): SeasonalWeather | null {
  const [month, day] = date.slice(5).split("-").map(Number);
  if (!month || !day || !history.length) return null;
  const ordinal = (month: number, day: number, leap = false) =>
    Math.round((Date.UTC(2020, month - 1, day) - Date.UTC(2020, 0, 1)) / 86400000) +
    (leap && month > 2 ? 1 : 0);
  const target = ordinal(month, day);
  const sample = history.filter((item) => {
    const [m, d] = item.monthDay.split("-").map(Number);
    const gap = Math.abs(ordinal(m!, d!) - target);
    return Math.min(gap, 365 - gap) <= 3;
  });
  if (!sample.length) return null;
  let caution = 0,
    poor = 0;
  sample.forEach((item) => {
    if ((item.gust ?? 0) >= 34 || (item.rain ?? 0) >= 50) poor++;
    else if ((item.gust ?? 0) >= 25 || (item.rain ?? 0) >= 20) caution++;
  });
  const denominator = sample.length;
  const poorShare = poor / denominator,
    cautionShare = caution / denominator;
  const disruptionShare = poorShare + cautionShare;
  return {
    cautionShare,
    poorShare,
    condition: disruptionShare > 0.5 ? "Poor" : disruptionShare >= 0.2 ? "Caution" : "Good",
  };
}

export function weatherCondition(day: DailyWeather) {
  if ((day.wave ?? 0) >= 3.5 || (day.gust ?? 0) >= 34 || (day.rain ?? 0) >= 50)
    return "Poor" as const;
  if ((day.wave ?? 0) >= 2 || (day.gust ?? 0) >= 25 || (day.rain ?? 0) >= 20)
    return "Caution" as const;
  return "Good" as const;
}
export const weatherDelayDays = (days: DailyWeather[]) =>
  days.reduce(
    (sum, day) =>
      sum + (weatherCondition(day) === "Poor" ? 1 : weatherCondition(day) === "Caution" ? 0.25 : 0),
    0,
  );

export function expectedDelayForWindow(
  start: string,
  forecast: DailyWeather[],
  history: Array<{ monthDay: string; gust: number | null; rain: number | null }>,
) {
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(`${start}T00:00:00`);
    date.setDate(date.getDate() + index);
    const iso = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    const actual = forecast.find((item) => item.date === iso);
    if (actual)
      return weatherCondition(actual) === "Poor"
        ? 1
        : weatherCondition(actual) === "Caution"
          ? 0.25
          : 0;
    const seasonal = seasonalCondition(iso, history);
    return seasonal ? seasonal.poorShare + 0.25 * seasonal.cautionShare : 0;
  }).reduce((sum, value) => sum + value, 0);
}
