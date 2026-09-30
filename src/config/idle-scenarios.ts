import { EAST_COAST_PORTS, ORIGINS, type OriginCode, type PortCode } from "@/config/geography";
import { idleRuns, VESSEL_CLASSES, VESSEL_POOL, type VesselClass } from "@/lib/freight-model";
import type { Requirement } from "@/lib/requirement";

export type FleetVessel = {
  id: string;
  name: string;
  cls: VesselClass;
  dwt: number;
  loaM: number;
  beamM: number;
  draftM: number;
  typicalCargo: string;
  position: { lat: number; lng: number };
  near: string;
  currentIdleH: number;
  status: "Idle" | "Ballast" | "Laden" | "Loading";
  nextOpenDate: string;
};

const vesselPositions: Record<string, { lat: number; lng: number }> = {
  "MV Kalinga Star": { lat: 6.93, lng: 79.84 },
  "MV Bay Pioneer": { lat: 1.27, lng: 103.84 },
  "MV Coral Ridge": { lat: -20.31, lng: 118.58 },
  "MV Odisha Dawn": { lat: 22.35, lng: 91.8 },
  "MV Nordic Ember": { lat: -20.16, lng: 57.5 },
  "MV Sagar Breeze": { lat: 20.26, lng: 86.68 },
};
const nextOpenInDays = [0, 2, 0, 3, 1, 0];

function dateAfter(days: number) {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export const FLEET: FleetVessel[] = VESSEL_POOL.map((vessel, index) => {
  const spec = VESSEL_CLASSES[vessel.cls];
  const currentIdleH = idleRuns(vessel.history).currentIdleH;
  const last = idleRuns(vessel.history).runs.at(-1)?.status;
  return {
    id: vessel.name.toLowerCase().replaceAll(" ", "-"),
    name: vessel.name,
    cls: vessel.cls,
    dwt: spec.dwt,
    loaM: spec.loaM,
    beamM: spec.beamM,
    draftM: spec.draftM,
    typicalCargo: spec.typicalCargo,
    position: vesselPositions[vessel.name] ?? { lat: 1.27, lng: 103.84 },
    near: vessel.near,
    currentIdleH,
    status:
      currentIdleH > 0
        ? "Idle"
        : last === "ballast"
          ? "Ballast"
          : last === "laden"
            ? "Laden"
            : "Loading",
    nextOpenDate: dateAfter(nextOpenInDays[index] ?? 1),
  };
});

export type OpenRequirement = {
  id: string;
  name: string;
  origin: OriginCode;
  loadPort: string;
  loadPosition: { lat: number; lng: number };
  port: PortCode;
  cargo: string;
  quantityMt: number;
  readyDate: string;
};

const loadPositionByOrigin: Record<OriginCode, { lat: number; lng: number }> = Object.fromEntries(
  ORIGINS.map((origin) => [origin.code, origin.position]),
) as Record<OriginCode, { lat: number; lng: number }>;
const loadPortByOrigin: Record<OriginCode, string> = Object.fromEntries(
  ORIGINS.map((origin) => [origin.code, origin.exampleLoadPorts[0]]),
) as Record<OriginCode, string>;

export const OPEN_REQUIREMENTS: Array<{
  origin: OriginCode;
  port: PortCode;
  quantityMt: number;
  days: number;
}> = [
  { origin: "AU", port: "PPT", quantityMt: 150000, days: 6 },
  { origin: "ID", port: "DHM", quantityMt: 80000, days: 9 },
  { origin: "MZ", port: "VZG", quantityMt: 100000, days: 14 },
  { origin: "RU", port: "GNV", quantityMt: 170000, days: 18 },
  { origin: "US", port: "HLD", quantityMt: 50000, days: 24 },
];

export function getOpenRequirements(active: Requirement): OpenRequirement[] {
  const samples = OPEN_REQUIREMENTS.map((sample, index) => ({
    id: `sample-${index + 1}`,
    name: `${loadPortByOrigin[sample.origin]} → ${EAST_COAST_PORTS.find((port) => port.code === sample.port)!.name}`,
    origin: sample.origin,
    loadPort: loadPortByOrigin[sample.origin],
    loadPosition: loadPositionByOrigin[sample.origin],
    port: sample.port,
    cargo: "Coking coal",
    quantityMt: sample.quantityMt,
    readyDate: dateAfter(sample.days),
  }));
  const origin = ORIGINS.find((item) => item.code === active.origin)!;
  const destination = EAST_COAST_PORTS.find((item) => item.code === active.port)!;
  return [
    ...samples,
    {
      id: "active-requirement",
      name: "Your current requirement",
      origin: active.origin,
      loadPort: origin.exampleLoadPorts[0],
      loadPosition: origin.position,
      port: active.port,
      cargo: active.cargo,
      quantityMt: active.volumeMt,
      readyDate: active.startDate,
    },
  ].map((requirement) => ({
    ...requirement,
    name:
      requirement.id === "active-requirement"
        ? `Your current requirement · ${requirement.loadPort} → ${destination.name}`
        : requirement.name,
  }));
}

export const ALT_EMPLOYMENT_SAMPLES = [
  { id: "opportunity-1", origin: "AU" as const, port: "VZG" as const, quantityMt: 45000, days: 5 },
  { id: "opportunity-2", origin: "ID" as const, port: "DHM" as const, quantityMt: 35000, days: 10 },
  { id: "opportunity-3", origin: "MZ" as const, port: "PPT" as const, quantityMt: 60000, days: 11 },
  { id: "opportunity-4", origin: "RU" as const, port: "SGS" as const, quantityMt: 50000, days: 18 },
].map((sample) => ({
  ...sample,
  loadPort: loadPortByOrigin[sample.origin],
  loadPosition: loadPositionByOrigin[sample.origin],
  readyDate: dateAfter(sample.days),
  cargo: "Configured bulk opportunity",
}));

export const IDLE_MODEL_SETTINGS = {
  speedKn: 13,
  minSlowSpeedKn: 6,
  hireUsdPerDayByClass: { Handysize: 4500, Supramax: 6500, Panamax: 8500, Capesize: 12000 },
  fuelTonnesPerDayByClass: { Handysize: 18, Supramax: 24, Panamax: 30, Capesize: 42 },
  bunkerUsdPerTonne: 650,
  weights: { idleDays: 0.4, ballastDays: 0.4, cost: 0.2 },
};

export type IdleModelSettings = typeof IDLE_MODEL_SETTINGS;
