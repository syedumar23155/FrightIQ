import { EAST_COAST_PORTS, ORIGINS, routeNm, routeTo } from "@/config/geography";
import type { OpenRequirement, FleetVessel, IdleModelSettings } from "@/config/idle-scenarios";
import { ALT_EMPLOYMENT_SAMPLES, IDLE_MODEL_SETTINGS } from "@/config/idle-scenarios";
import { VESSEL_CLASSES } from "@/lib/freight-model";

export type IdleOption = {
  id: string;
  title: string;
  description: string;
  feasible: boolean;
  reason?: string | undefined;
  requirementName: string;
  idleDays: number;
  ballastDays: number;
  ladenDays: number;
  deadheadRatio: number;
  hireCostUsd: number;
  ballastFuelUsd: number;
  totalCostUsd: number;
  speedKn: number;
  fuelFactor: number;
  score: number;
};

const daysBetween = (date: string) => {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  return Math.max(
    0,
    Math.ceil((new Date(`${date}T00:00:00`).getTime() - start.getTime()) / 86400000),
  );
};

const nmBetween = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) =>
  routeNm([a, b]);

function requirementFit(vessel: FleetVessel, requirement: OpenRequirement) {
  const port = EAST_COAST_PORTS.find((item) => item.code === requirement.port)!;
  const reasons = [
    vessel.draftM > port.maxDraftM && `draft ${vessel.draftM} m > ${port.maxDraftM} m`,
    vessel.loaM > port.maxLoaM && `LOA ${vessel.loaM} m > ${port.maxLoaM} m`,
    vessel.beamM > port.maxBeamM && `beam ${vessel.beamM} m > ${port.maxBeamM} m`,
    VESSEL_CLASSES[vessel.cls].intakeMt < requirement.quantityMt * 0.5 &&
      "capacity below half the cargo quantity",
  ].filter(Boolean);
  return { fits: reasons.length === 0, reason: reasons.join("; ") };
}

function estimateCost(
  vessel: FleetVessel,
  idleDays: number,
  ballastDays: number,
  fuelFactor: number,
  settings: IdleModelSettings,
) {
  const hireCostUsd = idleDays * settings.hireUsdPerDayByClass[vessel.cls];
  const ballastFuelUsd =
    ballastDays *
    settings.fuelTonnesPerDayByClass[vessel.cls] *
    settings.bunkerUsdPerTonne *
    fuelFactor;
  return { hireCostUsd, ballastFuelUsd, totalCostUsd: hireCostUsd + ballastFuelUsd };
}

function assembleOption(
  vessel: FleetVessel,
  requirement: OpenRequirement,
  settings: IdleModelSettings,
  fields: Omit<
    IdleOption,
    | "id"
    | "title"
    | "description"
    | "requirementName"
    | "hireCostUsd"
    | "ballastFuelUsd"
    | "totalCostUsd"
    | "deadheadRatio"
    | "score"
  >,
  id: string,
  title: string,
  description: string,
): IdleOption {
  const costs = estimateCost(
    vessel,
    fields.idleDays,
    fields.ballastDays,
    fields.fuelFactor,
    settings,
  );
  const deadheadRatio = fields.ballastDays / Math.max(0.01, fields.ballastDays + fields.ladenDays);
  return {
    id,
    title,
    description,
    requirementName: requirement.name,
    ...fields,
    ...costs,
    deadheadRatio,
    score: 0,
  };
}

export function rankRequirements(
  vessel: FleetVessel,
  requirements: OpenRequirement[],
  settings: IdleModelSettings = IDLE_MODEL_SETTINGS,
) {
  return requirements
    .map((requirement) => {
      const fit = requirementFit(vessel, requirement);
      const ballastNm = nmBetween(vessel.position, requirement.loadPosition);
      const ballastDays = ballastNm / (settings.speedKn * 24);
      const readyDays = daysBetween(requirement.readyDate);
      return {
        requirement,
        feasible: fit.fits && readyDays <= 30,
        reason: fit.reason || (readyDays > 30 ? "ready date is more than 30 days away" : undefined),
        ballastNm,
        ballastDays,
        readyDays,
        idleDays: Math.max(0, vessel.currentIdleH / 24) + Math.max(0, readyDays - ballastDays),
      };
    })
    .sort((a, b) => a.ballastDays - b.ballastDays);
}

export function buildIdleOptions(
  vessel: FleetVessel,
  requirement: OpenRequirement,
  settings: IdleModelSettings = IDLE_MODEL_SETTINGS,
): IdleOption[] {
  const fit = requirementFit(vessel, requirement);
  const idleDaysNow = vessel.currentIdleH / 24;
  const readyDays = daysBetween(requirement.readyDate);
  const loadDistanceNm = nmBetween(vessel.position, requirement.loadPosition);
  const ballastDays = loadDistanceNm / (settings.speedKn * 24);
  const destination = EAST_COAST_PORTS.find((item) => item.code === requirement.port)!;
  const ladenDays =
    routeNm(routeTo(requirement.origin, requirement.port)) / (settings.speedKn * 24);
  const waitAtLoad = Math.max(0, readyDays - ballastDays);
  const baseFit = fit.fits && readyDays <= 30;

  const hold = assembleOption(
    vessel,
    requirement,
    settings,
    {
      feasible: baseFit,
      reason: fit.reason || (readyDays > 30 ? "No matching requirement within 30 days" : undefined),
      idleDays: idleDaysNow + readyDays,
      ballastDays,
      ladenDays,
      speedKn: settings.speedKn,
      fuelFactor: 1,
    },
    "hold",
    "Hold position and wait",
    "Wait here for the load window; keep the later ballast leg in the plan.",
  );

  const reposition = assembleOption(
    vessel,
    requirement,
    settings,
    {
      feasible: baseFit,
      reason: fit.reason || (readyDays > 30 ? "No matching requirement within 30 days" : undefined),
      idleDays: idleDaysNow + waitAtLoad,
      ballastDays,
      ladenDays,
      speedKn: settings.speedKn,
      fuelFactor: 1,
    },
    "reposition",
    "Reposition to the load port",
    "Sail empty to the selected load port, then wait only if arrival is early.",
  );

  const slowSpeed = waitAtLoad > 0 ? loadDistanceNm / (readyDays * 24) : settings.speedKn;
  const canSlowSteam =
    baseFit &&
    waitAtLoad > 0 &&
    slowSpeed >= settings.minSlowSpeedKn &&
    slowSpeed < settings.speedKn;
  const slowSteam = assembleOption(
    vessel,
    requirement,
    settings,
    {
      feasible: canSlowSteam,
      reason: !fit.fits
        ? fit.reason
        : waitAtLoad <= 0
          ? "No arrival wait to avoid"
          : slowSpeed < settings.minSlowSpeedKn
            ? `Required speed ${slowSpeed.toFixed(1)} kn is below the configured ${settings.minSlowSpeedKn} kn minimum`
            : "Required speed does not reduce waiting",
      idleDays: idleDaysNow,
      ballastDays,
      ladenDays,
      speedKn: canSlowSteam ? slowSpeed : settings.speedKn,
      fuelFactor: canSlowSteam ? (slowSpeed / settings.speedKn) ** 2 : 1,
    },
    "slow-steam",
    "Slow-steam to reduce waiting",
    "Reduce speed on the empty leg to target the load-ready date; fuel change is an approximation.",
  );

  const alternatives = ALT_EMPLOYMENT_SAMPLES.map((opportunity) => {
    const arrivalToOpportunity =
      nmBetween(vessel.position, opportunity.loadPosition) / (settings.speedKn * 24);
    const opportunityLadenDays =
      routeNm(routeTo(opportunity.origin, opportunity.port)) / (settings.speedKn * 24);
    const postCargoDistance = nmBetween(destination.position, requirement.loadPosition);
    const postCargoBallastDays = postCargoDistance / (settings.speedKn * 24);
    const opportunityWait = Math.max(0, daysBetween(opportunity.readyDate) - arrivalToOpportunity);
    const reachesNextLoad =
      arrivalToOpportunity + opportunityWait + opportunityLadenDays + postCargoBallastDays <=
      readyDays + 2;
    const opportunityPort = EAST_COAST_PORTS.find((item) => item.code === opportunity.port)!;
    const opportunityFit =
      vessel.draftM <= opportunityPort.maxDraftM &&
      vessel.loaM <= opportunityPort.maxLoaM &&
      vessel.beamM <= opportunityPort.maxBeamM &&
      VESSEL_CLASSES[vessel.cls].intakeMt >= opportunity.quantityMt * 0.5;
    const optionBallastDays = arrivalToOpportunity + postCargoBallastDays;
    const optionIdleDays = idleDaysNow + opportunityWait;
    return assembleOption(
      vessel,
      requirement,
      settings,
      {
        feasible: fit.fits && opportunityFit && reachesNextLoad,
        reason: !fit.fits
          ? fit.reason
          : !opportunityFit
            ? "Vessel class or capacity does not fit this sample cargo/berth"
            : !reachesNextLoad
              ? "Cannot reach the selected next load by its ready date + 2 days"
              : undefined,
        idleDays: optionIdleDays,
        ballastDays: optionBallastDays,
        ladenDays: ladenDays + opportunityLadenDays,
        speedKn: settings.speedKn,
        fuelFactor: 1,
      },
      opportunity.id,
      "Take a sample backhaul on the way",
      `Configured opportunity ${opportunity.loadPort} → ${opportunity.port}; no cargo income is estimated.`,
    );
  });

  const options = [hold, reposition, slowSteam, ...alternatives];
  const feasible = options.filter((option) => option.feasible);
  const maxIdle = Math.max(1, ...feasible.map((option) => option.idleDays));
  const maxBallast = Math.max(1, ...feasible.map((option) => option.ballastDays));
  const maxCost = Math.max(1, ...feasible.map((option) => option.totalCostUsd));
  const weightTotal = Math.max(
    0.0001,
    settings.weights.idleDays + settings.weights.ballastDays + settings.weights.cost,
  );
  feasible.forEach((option) => {
    option.score =
      (settings.weights.idleDays * (option.idleDays / maxIdle) +
        settings.weights.ballastDays * (option.ballastDays / maxBallast) +
        settings.weights.cost * (option.totalCostUsd / maxCost)) /
      weightTotal;
  });
  return options.sort((a, b) => {
    if (a.feasible !== b.feasible) return a.feasible ? -1 : 1;
    if (!a.feasible) return a.title.localeCompare(b.title);
    const diff = a.score - b.score;
    if (Math.abs(diff) < 0.05) return a.deadheadRatio - b.deadheadRatio;
    return diff;
  });
}
