export type AisPort = {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  radiusKm: number;
};

export const AIS_PORTS: AisPort[] = [
  { id: "paradip", name: "Paradip", latitude: 20.26, longitude: 86.68, radiusKm: 18 },
  { id: "vizag", name: "Visakhapatnam", latitude: 17.68, longitude: 83.29, radiusKm: 18 },
  { id: "gangavaram", name: "Gangavaram", latitude: 17.62, longitude: 83.23, radiusKm: 14 },
  { id: "gopalpur", name: "Gopalpur", latitude: 19.3, longitude: 84.97, radiusKm: 18 },
  { id: "haldia", name: "Haldia", latitude: 22.03, longitude: 88.07, radiusKm: 20 },
  { id: "kakinada", name: "Kakinada", latitude: 16.95, longitude: 82.25, radiusKm: 18 },
  { id: "chennai", name: "Chennai", latitude: 13.08, longitude: 80.3, radiusKm: 18 },
  { id: "ennore", name: "Ennore / Kamarajar", latitude: 13.25, longitude: 80.34, radiusKm: 18 },
  { id: "kolkata", name: "Kolkata", latitude: 22.57, longitude: 88.36, radiusKm: 24 },
  { id: "sagar", name: "Sagar-Sandheads", latitude: 21.1, longitude: 88.2, radiusKm: 24 },
  { id: "dhamra", name: "Dhamra", latitude: 20.78, longitude: 86.97, radiusKm: 18 },
];

export const AIS_BOUNDS = [
  [
    [20.1, 85.8],
    [23.1, 89.1],
  ],
  [
    [15.8, 81.5],
    [18.4, 84.4],
  ],
  [
    [12, 79.4],
    [14.1, 81.4],
  ],
];

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

export type ParsedAisMessage =
  | {
      kind: "position";
      vessel: Omit<AisVessel, "lastSeen" | "stationarySince" | "stationaryOverThreshold">;
    }
  | {
      kind: "static";
      mmsi: string;
      shipName: string | null;
      vesselType: number | null;
      destination: string | null;
    }
  | { kind: "other" };

type Obj = Record<string, unknown>;
const isObj = (value: unknown): value is Obj => typeof value === "object" && value !== null;
const finite = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;
const cleanText = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const text = value.trim().replace(/@+$/g, "");
  return text.length ? text : null;
};

export function parseAisMessage(raw: unknown): ParsedAisMessage {
  if (!isObj(raw)) return { kind: "other" };
  const metadata = isObj(raw["MetaData"]) ? raw["MetaData"] : {};
  const message = isObj(raw["Message"]) ? raw["Message"] : {};
  const messageType = typeof raw["MessageType"] === "string" ? raw["MessageType"] : "";
  const mmsiValue = metadata["MMSI"] ?? metadata["Mmsi"];
  const body = isObj(message["PositionReport"])
    ? message["PositionReport"]
    : isObj(message["ExtendedClassBPositionReport"])
      ? message["ExtendedClassBPositionReport"]
      : isObj(message["StandardClassBPositionReport"])
        ? message["StandardClassBPositionReport"]
        : null;

  if (
    body &&
    ["PositionReport", "ExtendedClassBPositionReport", "StandardClassBPositionReport"].includes(
      messageType,
    )
  ) {
    const mmsi = String(body["UserID"] ?? mmsiValue ?? "");
    const latitude = finite(metadata["Latitude"] ?? body["Latitude"]);
    const longitude = finite(metadata["Longitude"] ?? body["Longitude"]);
    if (!/^\d{9}$/.test(mmsi) || latitude === null || longitude === null || body["Valid"] === false)
      return { kind: "other" };
    if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180)
      return { kind: "other" };
    const seconds = finite(body["Timestamp"]);
    return {
      kind: "position",
      vessel: {
        mmsi,
        shipName: cleanText(metadata["ShipName"]),
        latitude,
        longitude,
        speedKnots: finite(body["Sog"]),
        courseDegrees: finite(body["Cog"]),
        headingDegrees: finite(body["TrueHeading"]),
        timestamp: seconds === null ? null : new Date(seconds * 1000).toISOString(),
        navigationStatus: finite(body["NavigationalStatus"]),
        vesselType: null,
        destination: null,
      },
    };
  }

  if (messageType === "ShipStaticData" || messageType === "StaticDataReport") {
    const mmsi = String(mmsiValue ?? "");
    if (!/^\d{9}$/.test(mmsi)) return { kind: "other" };
    const ship = isObj(message["ShipStaticData"]) ? message["ShipStaticData"] : {};
    const report = isObj(message["StaticDataReport"]) ? message["StaticDataReport"] : {};
    const partA = isObj(report["ReportA"]) ? report["ReportA"] : {};
    const partB = isObj(report["ReportB"]) ? report["ReportB"] : {};
    return {
      kind: "static",
      mmsi,
      shipName: cleanText(ship["Name"] ?? partA["Name"] ?? metadata["ShipName"]),
      vesselType: finite(ship["Type"] ?? partB["ShipType"]),
      destination: cleanText(ship["Destination"]),
    };
  }
  return { kind: "other" };
}

export function distanceKm(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
) {
  const rad = Math.PI / 180;
  const dLat = (b.latitude - a.latitude) * rad;
  const dLon = (b.longitude - a.longitude) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.latitude * rad) * Math.cos(b.latitude * rad) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}

export type EngineSettings = {
  activeWindowMs: number;
  stationaryMs: number;
  speedKnots: number;
  radiusKm: number;
  maxObservationGapMs: number;
  vesselRetentionMs: number;
};

export const DEFAULT_ENGINE_SETTINGS: EngineSettings = {
  activeWindowMs: 2 * 60 * 60 * 1000,
  stationaryMs: 48 * 60 * 60 * 1000,
  speedKnots: 1,
  radiusKm: 1,
  maxObservationGapMs: 6 * 60 * 60 * 1000,
  vesselRetentionMs: 72 * 60 * 60 * 1000,
};

export function reconnectDelayMs(attempt: number, random = Math.random) {
  const backoff = Math.min(60_000, 1_500 * 2 ** Math.min(Math.max(0, attempt), 6));
  return Math.round(Math.min(60_000, backoff * (0.75 + random() * 0.5)));
}

export function summarizePorts(vessels: AisVessel[]) {
  const assigned = new Map<string, AisVessel[]>();
  for (const vessel of vessels) {
    const nearest = AIS_PORTS.map((port) => ({
      port,
      distance: distanceKm(vessel, { latitude: port.latitude, longitude: port.longitude }),
    }))
      .filter(({ port, distance }) => distance <= port.radiusKm)
      .sort((a, b) => a.distance - b.distance)[0]?.port;
    if (nearest) assigned.set(nearest.id, [...(assigned.get(nearest.id) ?? []), vessel]);
  }
  return AIS_PORTS.map((port) => {
    const near = assigned.get(port.id) ?? [];
    return {
      ...port,
      vessels: near.length,
      stationaryOverThreshold: near.filter((vessel) => vessel.stationaryOverThreshold).length,
      lastObserved: near.reduce<string | null>(
        (latest, vessel) => (!latest || vessel.lastSeen > latest ? vessel.lastSeen : latest),
        null,
      ),
    };
  });
}

type VesselState = AisVessel & {
  stationaryAnchor: { latitude: number; longitude: number } | null;
  stationarySamples: number;
  stationaryStartAt: string | null;
};

export class AisEngine {
  private readonly vessels = new Map<string, VesselState>();
  private readonly staticData = new Map<
    string,
    { shipName: string | null; vesselType: number | null; destination: string | null }
  >();
  constructor(private readonly settings: EngineSettings = DEFAULT_ENGINE_SETTINGS) {}

  ingest(parsed: ParsedAisMessage, receivedAt = Date.now()) {
    if (parsed.kind === "other") return;
    const seenAt = new Date(receivedAt).toISOString();
    if (parsed.kind === "static") {
      this.staticData.set(parsed.mmsi, {
        shipName: parsed.shipName,
        vesselType: parsed.vesselType,
        destination: parsed.destination,
      });
      const existing = this.vessels.get(parsed.mmsi);
      if (existing) {
        existing.shipName = parsed.shipName ?? existing.shipName;
        existing.vesselType = parsed.vesselType ?? existing.vesselType;
        existing.destination = parsed.destination ?? existing.destination;
      }
      return;
    }
    const prior = this.vessels.get(parsed.vessel.mmsi);
    const staticData = this.staticData.get(parsed.vessel.mmsi);
    const slow =
      parsed.vessel.speedKnots !== null && parsed.vessel.speedKnots <= this.settings.speedKnots;
    const gap = prior ? receivedAt - Date.parse(prior.lastSeen) : Infinity;
    let anchor = prior?.stationaryAnchor ?? null;
    let since = prior?.stationaryStartAt ?? null;
    let samples = prior?.stationarySamples ?? 0;
    if (!slow || gap > this.settings.maxObservationGapMs) {
      anchor = slow
        ? { latitude: parsed.vessel.latitude, longitude: parsed.vessel.longitude }
        : null;
      since = slow ? seenAt : null;
      samples = slow ? 1 : 0;
    } else if (anchor && distanceKm(anchor, parsed.vessel) <= this.settings.radiusKm) {
      samples += 1;
    } else {
      anchor = { latitude: parsed.vessel.latitude, longitude: parsed.vessel.longitude };
      since = seenAt;
      samples = 1;
    }
    const elapsed = since ? receivedAt - Date.parse(since) : 0;
    this.vessels.set(parsed.vessel.mmsi, {
      ...parsed.vessel,
      shipName: staticData?.shipName ?? parsed.vessel.shipName ?? prior?.shipName ?? null,
      vesselType: staticData?.vesselType ?? parsed.vessel.vesselType ?? prior?.vesselType ?? null,
      destination:
        staticData?.destination ?? parsed.vessel.destination ?? prior?.destination ?? null,
      lastSeen: seenAt,
      stationarySince: samples >= 2 ? since : null,
      stationaryOverThreshold: samples >= 2 && elapsed > this.settings.stationaryMs,
      stationaryAnchor: anchor,
      stationarySamples: samples,
      stationaryStartAt: since,
    });
    this.prune(receivedAt);
  }

  private prune(now: number) {
    for (const [mmsi, vessel] of this.vessels)
      if (now - Date.parse(vessel.lastSeen) > this.settings.vesselRetentionMs)
        this.vessels.delete(mmsi);
  }

  activeVessels(now = Date.now()): AisVessel[] {
    this.prune(now);
    return [...this.vessels.values()]
      .filter((vessel) => now - Date.parse(vessel.lastSeen) <= this.settings.activeWindowMs)
      .map(
        ({
          stationaryAnchor: _anchor,
          stationarySamples: _samples,
          stationaryStartAt: _start,
          ...vessel
        }) => vessel,
      );
  }

  portSummary(now = Date.now()) {
    const vessels = this.activeVessels(now);
    return summarizePorts(vessels);
  }

  summary(now = Date.now()) {
    const vessels = this.activeVessels(now);
    return {
      activeVessels: vessels.length,
      stationaryOverThreshold: vessels.filter((vessel) => vessel.stationaryOverThreshold).length,
      portsMonitored: AIS_PORTS.length,
      lastUpdate: vessels.reduce<string | null>(
        (latest, vessel) => (!latest || vessel.lastSeen > latest ? vessel.lastSeen : latest),
        null,
      ),
    };
  }
}
