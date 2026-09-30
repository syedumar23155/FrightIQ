import { BASE_RATE } from "@/lib/freight-model";
import type { OriginCode } from "@/config/geography";

export type RatePoint = {
  week: string;
  actual?: number;
  forecast?: number;
  band?: [number, number];
};

function seeded(seed: number) {
  let value = seed;
  return () => (value = (value * 9301 + 49297) % 233280) / 233280;
}

/** Shared simulated rate series used by both the forecast chart and entry timing logic. */
export function buildRateSeries(origin: OriginCode): RatePoint[] {
  const random = seeded(origin.charCodeAt(0) * 31 + origin.charCodeAt(1));
  const base = BASE_RATE[origin];
  const points: RatePoint[] = [];
  let value = base * 0.88;
  for (let week = -26; week <= 8; week++) {
    value = value + (base - value) * 0.08 + (random() - 0.47) * base * 0.05;
    const label = week === 0 ? "Now" : week < 0 ? `W${week}` : `W+${week}`;
    if (week <= 0)
      points.push({
        week: label,
        actual: +value.toFixed(2),
        ...(week === 0
          ? {
              forecast: +value.toFixed(2),
              band: [+value.toFixed(2), +value.toFixed(2)] as [number, number],
            }
          : {}),
      });
    else {
      const spread = base * 0.025 * week;
      points.push({
        week: label,
        forecast: +value.toFixed(2),
        band: [+(value - spread).toFixed(2), +(value + spread).toFixed(2)],
      });
    }
  }
  return points;
}
