export type AisStatus = {
  state: "connecting" | "connected" | "disconnected";
  source: "live" | "unavailable" | "simulated";
  configured: boolean;
  connectedAt: string | null;
  lastMessageAt: string | null;
  reason: string | null;
};

export type AisSummary = AisStatus & {
  activeVessels: number;
  stationaryOverThreshold: number;
  portsMonitored: number;
  lastUpdate: string | null;
  stationaryHours: number;
};

export type AisVessel = {
  mmsi: string;
  shipName: string | null;
  latitude: number;
  longitude: number;
  speedKnots: number | null;
  courseDegrees: number | null;
  headingDegrees: number | null;
  timestamp: string | null;
  navigationStatus: number | null;
  lastSeen: string;
  vesselType: number | null;
  destination: string | null;
  stationarySince: string | null;
  stationaryOverThreshold: boolean;
};

export type AisPortSummary = {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  radiusKm: number;
  vessels: number;
  stationaryOverThreshold: number;
  lastObserved: string | null;
  source: "live" | "unavailable" | "simulated";
};

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(path, {
    headers: { accept: "application/json" },
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`AIS service returned ${response.status}`);
  return (await response.json()) as T;
}

export const fetchAisSummary = () => getJson<AisSummary>("/api/ais/summary");
export const fetchAisPorts = () =>
  getJson<{ source: AisSummary["source"]; ports: AisPortSummary[] }>("/api/ais/ports");
export const fetchAisVessels = () =>
  getJson<{ source: AisSummary["source"]; vessels: AisVessel[] }>("/api/ais/vessels");

export function localAisUnavailable(): AisSummary {
  return {
    state: "disconnected",
    source: "unavailable",
    configured: false,
    connectedAt: null,
    lastMessageAt: null,
    reason: "AIS service is not running. Start it with bun run ais:service.",
    activeVessels: 0,
    stationaryOverThreshold: 0,
    portsMonitored: 0,
    lastUpdate: null,
    stationaryHours: 48,
  };
}
