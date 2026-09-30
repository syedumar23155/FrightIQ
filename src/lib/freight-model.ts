// Demo freight model. All outputs are synthetic and must be labeled "Demo data" in the UI.
import {
  EAST_COAST_PORTS,
  ORIGINS,
  routeNm,
  routeTo,
  type OriginCode,
  type PortCode,
} from "@/config/geography";

export type VesselClass = "Handysize" | "Supramax" | "Panamax" | "Capesize";
export type CharterStrategy = "Spot" | "Short-term" | "Multi-voyage";

export const VESSEL_CLASSES: Record<
  VesselClass,
  {
    dwt: number;
    draftM: number;
    loaM: number;
    beamM: number;
    rateFactor: number;
    speedKn: number;
    intakeMt: number;
    dwtRange: string;
    gear: string;
    typicalCargo: string;
  }
> = {
  Handysize: {
    dwt: 34000,
    draftM: 10.0,
    loaM: 180,
    beamM: 28,
    rateFactor: 1.2,
    speedKn: 13,
    intakeMt: 32300,
    dwtRange: "28,000–40,000",
    gear: "Usually geared",
    typicalCargo: "Small parcels, coal, limestone, grain, fertiliser and steel",
  },
  Supramax: {
    dwt: 57000,
    draftM: 12.8,
    loaM: 190,
    beamM: 32,
    rateFactor: 1.08,
    speedKn: 13,
    intakeMt: 54150,
    dwtRange: "50,000–64,000",
    gear: "Usually geared",
    typicalCargo: "Coal, grain, bauxite, fertiliser and limestone",
  },
  Panamax: {
    dwt: 79000,
    draftM: 14.2,
    loaM: 229,
    beamM: 32.2,
    rateFactor: 1,
    speedKn: 13,
    intakeMt: 75050,
    dwtRange: "75,000–82,000",
    gear: "Usually gearless",
    typicalCargo: "Coal, grain and iron ore",
  },
  Capesize: {
    dwt: 180000,
    draftM: 18.2,
    loaM: 292,
    beamM: 45,
    rateFactor: 0.9,
    speedKn: 13,
    intakeMt: 171000,
    dwtRange: "170,000–210,000",
    gear: "Gearless",
    typicalCargo: "Iron ore and coal in large parcels",
  },
};

export const BASE_RATE: Record<OriginCode, number> = {
  AU: 13.8,
  US: 31.1,
  MZ: 17.2,
  RU: 24.6,
  ID: 9.4,
};
const STRATEGY_FACTOR: Record<CharterStrategy, number> = {
  Spot: 1.0,
  "Short-term": 0.95,
  "Multi-voyage": 0.9,
};
const CONGESTION_DAYS: Record<PortCode, number> = {
  PPT: 2.4,
  VZG: 1.6,
  GNV: 2.1,
  GPL: 0.8,
  DHM: 1.9,
  SGS: 1.2,
  HLD: 3.1,
};
export const CONGESTION_DEMO = CONGESTION_DAYS;

export type VoyageInput = {
  cargo: string;
  volumeMt: number;
  origin: OriginCode;
  port: PortCode;
  windowDays: number;
  strategy: CharterStrategy;
  alternate: boolean;
  weatherLoadDelayDays?: number;
  weatherDischargeDelayDays?: number;
  poorWeatherAtArrival?: boolean;
  intakeFactor?: number;
  rateFactors?: Partial<Record<VesselClass, number>>;
  scoreWeights?: { cost: number; schedule: number; utilization: number; risk: number };
};

export function evaluateVoyage(input: VoyageInput) {
  const port = EAST_COAST_PORTS.find((p) => p.code === input.port)!;
  const path = routeTo(input.origin, input.port, input.alternate);
  const nm = routeNm(path);
  const classes = (Object.keys(VESSEL_CLASSES) as VesselClass[]).map((name) => {
    const v = VESSEL_CLASSES[name];
    const fitsDraft = v.draftM <= port.maxDraftM;
    const fitsLoa = v.loaM <= port.maxLoaM;
    const fitsBeam = v.beamM <= port.maxBeamM;
    const sailingDays = nm / (v.speedKn * 24);
    const sailDays = sailingDays + (input.weatherLoadDelayDays ?? 0);
    const intakeMt = v.dwt * (input.intakeFactor ?? 0.95);
    const voyages = Math.ceil(input.volumeMt / intakeMt);
    const rate =
      BASE_RATE[input.origin] *
      (input.rateFactors?.[name] ?? v.rateFactor) *
      STRATEGY_FACTOR[input.strategy] *
      (input.alternate ? 1.18 : 1);
    const berthDays =
      v.dwt / port.handlingTpd +
      (CONGESTION_DAYS[input.port] ?? 0) +
      (input.weatherDischargeDelayDays ?? 0);
    const demurrageUsd = Math.max(0, berthDays - 3) * 18000 * voyages;
    const freightUsd = rate * input.volumeMt;
    const fits = fitsDraft && fitsLoa && fitsBeam;
    const oneWayDays = 2 + sailingDays + (input.weatherLoadDelayDays ?? 0) + berthDays;
    const cycleDays = oneWayDays + sailingDays;
    let vesselsNeeded = voyages;
    for (let count = 1; count <= voyages; count++) {
      if ((Math.ceil(voyages / count) - 1) * cycleDays + oneWayDays <= input.windowDays) {
        vesselsNeeded = count;
        break;
      }
    }
    const utilization = input.volumeMt / (voyages * intakeMt);
    const demurrageRisk = berthDays > 5 ? "High" : berthDays > 3 ? "Medium" : "Low";
    const riskScore = Math.max(
      0,
      (demurrageRisk === "Low" ? 90 : demurrageRisk === "Medium" ? 60 : 30) -
        (input.poorWeatherAtArrival ? 10 : 0),
    );
    return {
      name,
      ...v,
      fitsDraft,
      fitsLoa,
      fitsBeam,
      fits,
      sailDays,
      voyages,
      intakeMt,
      vesselsNeeded,
      scheduleFits:
        (Math.ceil(voyages / vesselsNeeded) - 1) * cycleDays + oneWayDays <= input.windowDays,
      utilization,
      riskScore,
      oneWayDays,
      cycleDays,
      rate,
      berthDays,
      demurrageUsd,
      landedUsd: freightUsd + demurrageUsd,
      onTime: (Math.ceil(voyages / vesselsNeeded) - 1) * cycleDays + oneWayDays <= input.windowDays,
    };
  });
  const cheapest = Math.min(...classes.filter((c) => c.fits).map((c) => c.landedUsd));
  const weights = input.scoreWeights ?? { cost: 40, schedule: 25, utilization: 15, risk: 20 };
  const weightSum = Math.max(
    1,
    weights.cost + weights.schedule + weights.utilization + weights.risk,
  );
  const scoredClasses = classes.map((c) => {
    const costScore = c.fits && cheapest > 0 ? (100 * cheapest) / c.landedUsd : 0;
    const scheduleScore = 100 * (1 - (c.vesselsNeeded - 1) / c.voyages);
    const utilizationScore = 100 * Math.min(1, c.utilization / 0.85);
    const score = c.fits
      ? (weights.cost * costScore +
          weights.schedule * scheduleScore +
          weights.utilization * utilizationScore +
          weights.risk * c.riskScore) /
        weightSum
      : 0;
    return { ...c, costScore, scheduleScore, utilizationScore, score: Math.round(score) };
  });
  const scoredFeasible = scoredClasses.filter((c) => c.fits);
  const best = [...scoredFeasible].sort((a, b) => b.score - a.score)[0] ?? null;
  const ranked = [...scoredFeasible].sort((a, b) => b.score - a.score);
  const demurrageRisk = best
    ? best.berthDays > 5
      ? "High"
      : best.berthDays > 3
        ? "Medium"
        : "Low"
    : "—";
  const bookingLeadDays =
    input.strategy === "Spot" ? 10 : input.strategy === "Short-term" ? 21 : 45;
  return {
    path,
    nm,
    port,
    classes: scoredClasses,
    feasible: scoredFeasible,
    timely: scoredFeasible.filter((c) => c.onTime),
    best,
    ranked,
    demurrageRisk,
    bookingLeadDays,
    funnel: [
      { label: "Vessel classes", n: classes.length },
      { label: "Pass draft", n: classes.filter((c) => c.fitsDraft).length },
      { label: "Pass LOA & beam", n: scoredFeasible.length },
      { label: "Meet window", n: scoredFeasible.filter((c) => c.onTime).length },
    ],
  };
}

// VesselAI-lite: candidate pool with hourly status history (demo).
type Status = "laden" | "ballast" | "idle" | "berthed";
export type Vessel = { name: string; cls: VesselClass; near: string; history: Status[] };

function hist(pattern: Array<[Status, number]>): Status[] {
  return pattern.flatMap(([s, n]) => Array<Status>(n).fill(s));
}

export const VESSEL_POOL: Vessel[] = [
  {
    name: "MV Kalinga Star",
    cls: "Panamax",
    near: "Colombo anchorage",
    history: hist([
      ["laden", 200],
      ["berthed", 40],
      ["idle", 10],
      ["ballast", 30],
      ["idle", 52],
    ]),
  },
  {
    name: "MV Bay Pioneer",
    cls: "Supramax",
    near: "Singapore OPL",
    history: hist([
      ["ballast", 90],
      ["laden", 240],
      ["berthed", 30],
    ]),
  },
  {
    name: "MV Coral Ridge",
    cls: "Capesize",
    near: "Port Hedland",
    history: hist([
      ["laden", 300],
      ["idle", 20],
      ["ballast", 40],
      ["idle", 71],
    ]),
  },
  {
    name: "MV Odisha Dawn",
    cls: "Handysize",
    near: "Chittagong roads",
    history: hist([
      ["laden", 120],
      ["berthed", 24],
      ["ballast", 60],
    ]),
  },
  {
    name: "MV Nordic Ember",
    cls: "Panamax",
    near: "Port Louis",
    history: hist([
      ["idle", 30],
      ["laden", 260],
      ["berthed", 36],
      ["idle", 18],
    ]),
  },
  {
    name: "MV Sagar Breeze",
    cls: "Handysize",
    near: "Paradip approaches",
    history: hist([
      ["laden", 168],
      ["berthed", 30],
      ["idle", 80],
    ]),
  },
];

/** Gaps-and-islands: collapse consecutive identical statuses into runs; return the current trailing idle run length (h). */
export function idleRuns(history: Status[]) {
  const runs: Array<{ status: Status; start: number; hours: number }> = [];
  history.forEach((s, i) => {
    const last = runs[runs.length - 1];
    if (last && last.status === s) last.hours++;
    else runs.push({ status: s, start: i, hours: 1 });
  });
  const tail = runs[runs.length - 1];
  return {
    runs,
    currentIdleH: tail?.status === "idle" ? tail.hours : 0,
    longestIdleH: Math.max(0, ...runs.filter((r) => r.status === "idle").map((r) => r.hours)),
  };
}

export const IDLE_THRESHOLD_H = 48;

export const originName = (c: OriginCode) => ORIGINS.find((o) => o.code === c)!.name;
