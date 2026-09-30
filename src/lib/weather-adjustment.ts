import { useSyncExternalStore } from "react";

export type WeatherAdjustment = {
  includeWeather: boolean;
  medianUpliftPct: number;
  bandWideningPct: number;
};

const DEFAULT_SETTINGS: WeatherAdjustment = {
  includeWeather: true,
  medianUpliftPct: 0.5,
  bandWideningPct: 5,
};
let settings = DEFAULT_SETTINGS;
const listeners = new Set<() => void>();

export function setWeatherAdjustment(patch: Partial<WeatherAdjustment>) {
  settings = { ...settings, ...patch };
  listeners.forEach((listener) => listener());
}

export function useWeatherAdjustment() {
  return useSyncExternalStore(
    (listener) => (listeners.add(listener), () => listeners.delete(listener)),
    () => settings,
    () => settings,
  );
}
