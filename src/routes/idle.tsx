import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Clock3, Route as RouteIcon, Ship, TrendingDown } from "lucide-react";
import { DashboardHeader, DataBadge, DemoBadge, Panel, usd } from "@/components/Panel";
import { IDLE_THRESHOLD_H, VESSEL_CLASSES } from "@/lib/freight-model";
import { cn } from "@/lib/utils";
import { useRequirement } from "@/lib/requirement";
import { buildRateSeries } from "@/lib/forecast-data";
import { EAST_COAST_PORTS, ORIGINS, routeNm, routeTo } from "@/config/geography";
import {
  ALT_EMPLOYMENT_SAMPLES,
  FLEET,
  getOpenRequirements,
  IDLE_MODEL_SETTINGS,
} from "@/config/idle-scenarios";
import { buildIdleOptions, rankRequirements } from "@/lib/idle-planning";

export const Route = createFileRoute("/idle")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Idle Scenario Management | FreightIQ" },
      {
        name: "description",
        content: "Configured fleet scenarios to review idle time and ballast movement.",
      },
    ],
  }),
  component: IdlePage,
});

function IdlePage() {
  const [selectedVesselId, setSelectedVesselId] = useState(FLEET[0]?.id ?? "");
  const [selectedRequirementId, setSelectedRequirementId] = useState("active-requirement");
  const [planningSettings, setPlanningSettings] = useState(() => ({
    ...IDLE_MODEL_SETTINGS,
    hireUsdPerDayByClass: { ...IDLE_MODEL_SETTINGS.hireUsdPerDayByClass },
    fuelTonnesPerDayByClass: { ...IDLE_MODEL_SETTINGS.fuelTonnesPerDayByClass },
    weights: { ...IDLE_MODEL_SETTINGS.weights },
  }));
  const requirement = useRequirement();
  const requirements = useMemo(() => getOpenRequirements(requirement), [requirement]);
  const vessels = FLEET;
  const selectedVessel = vessels.find((vessel) => vessel.id === selectedVesselId) ?? vessels[0]!;
  const selectedRequirement =
    requirements.find((item) => item.id === selectedRequirementId) ?? requirements.at(-1)!;
  const rankedRequirements = useMemo(
    () => rankRequirements(selectedVessel, requirements, planningSettings),
    [selectedVessel, requirements, planningSettings],
  );
  const selectedRequirementMatch = rankedRequirements.find(
    (match) => match.requirement.id === selectedRequirement.id,
  );
  const planOptions = useMemo(
    () => buildIdleOptions(selectedVessel, selectedRequirement, planningSettings),
    [selectedVessel, selectedRequirement, planningSettings],
  );
  const recommendedPlan = planOptions.find((option) => option.feasible) ?? planOptions[0]!;
  const selectedRequirementLadenDays =
    routeNm(routeTo(selectedRequirement.origin, selectedRequirement.port)) /
    (planningSettings.speedKn * 24);
  const baselineDeadheadRatio = selectedRequirementMatch
    ? selectedRequirementMatch.ballastDays /
      Math.max(0.01, selectedRequirementMatch.ballastDays + selectedRequirementLadenDays)
    : 0;
  const strategyCards = [
    planOptions.find((option) => option.id === "hold")!,
    planOptions.find((option) => option.id === "reposition")!,
    planOptions.find((option) => option.id === "slow-steam")!,
    planOptions.find((option) => option.id.startsWith("opportunity-") && option.feasible) ??
      planOptions.find((option) => option.id.startsWith("opportunity-"))!,
  ];
  useEffect(() => {
    if (!requirements.some((item) => item.id === selectedRequirementId)) {
      setSelectedRequirementId("active-requirement");
    }
  }, [requirements, selectedRequirementId]);
  const outlook = useMemo(
    () =>
      buildRateSeries(requirement.origin).filter(
        (point) => point.week === "Now" || point.week.startsWith("W+"),
      ),
    [requirement.origin],
  );
  const currentRate = outlook.find((point) => point.week === "Now")?.forecast ?? 0;
  const vesselRateFactor = VESSEL_CLASSES[selectedVessel.cls].rateFactor;
  const historicRates = useMemo(
    () =>
      buildRateSeries(requirement.origin)
        .filter((point) => point.actual != null)
        .slice(-26)
        .map((point) => point.actual! * vesselRateFactor),
    [requirement.origin, vesselRateFactor],
  );
  const sortedHistory = [...historicRates].sort((a, b) => a - b);
  const softMarketThreshold = sortedHistory[Math.floor((sortedHistory.length - 1) * 0.25)] ?? 0;
  const upcomingSoft = outlook.filter(
    (point) =>
      point.week !== "Now" &&
      point.forecast != null &&
      point.forecast * vesselRateFactor < softMarketThreshold,
  );
  const idleVessels = vessels.filter((vessel) => vessel.currentIdleH >= IDLE_THRESHOLD_H);
  const averageIdleHours = idleVessels.length
    ? idleVessels.reduce((sum, vessel) => sum + vessel.currentIdleH, 0) / idleVessels.length
    : 0;
  const fleetDeadheadRatios = vessels.map((vessel) => {
    const match = rankRequirements(vessel, requirements, planningSettings).find(
      (candidate) => candidate.feasible,
    );
    if (!match) return 0;
    const selected = requirements.find((candidate) => candidate.id === match.requirement.id)!;
    const ladenDays =
      routeNm(routeTo(selected.origin, selected.port)) / (planningSettings.speedKn * 24);
    return match.ballastDays / Math.max(0.01, match.ballastDays + ladenDays);
  });
  const avgDeadhead = fleetDeadheadRatios.reduce((sum, ratio) => sum + ratio, 0) / vessels.length;
  const avoidableIdleDays = vessels.reduce((sum, vessel) => {
    const candidate = rankRequirements(vessel, requirements, planningSettings).find(
      (item) => item.feasible,
    );
    if (!candidate) return sum;
    const best = buildIdleOptions(vessel, candidate.requirement, planningSettings).find(
      (option) => option.feasible,
    );
    return (
      sum + Math.max(0, vessel.currentIdleH / 24 - (best?.idleDays ?? vessel.currentIdleH / 24))
    );
  }, 0);
  return (
    <main className="freightiq-dashboard flex-1 space-y-4 overflow-y-auto p-4 font-sans">
      <DashboardHeader
        eyebrow="Fleet utilization"
        title="Idle Scenario Management"
        description="Compare positioning and employment scenarios that can reduce waiting time and avoid unnecessary empty ballast legs."
        badge={<DemoBadge />}
      />
      <Panel title="Fleet pulse" badge={<DataBadge kind="configured" detail="sample fleet" />}>
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          {[
            ["Idle vessels", String(idleVessels.length)],
            ["Average idle", `${averageIdleHours.toFixed(0)} h`],
            ["Average ballast ratio", `${(avgDeadhead * 100).toFixed(0)}%`],
            ["Idle days avoidable", `${avoidableIdleDays.toFixed(1)} d`],
          ].map(([label, value]) => (
            <div key={label} className="rounded-xl border border-border bg-background/55 p-3">
              <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                {label === "Idle vessels" ? (
                  <Ship size={13} className="shrink-0 text-primary" aria-hidden />
                ) : label === "Average idle" ? (
                  <Clock3 size={13} className="shrink-0 text-primary" aria-hidden />
                ) : label === "Average ballast ratio" ? (
                  <RouteIcon size={13} className="shrink-0 text-primary" aria-hidden />
                ) : (
                  <TrendingDown size={13} className="shrink-0 text-primary" aria-hidden />
                )}
                {label}
              </div>
              <div className="mt-1 text-xl font-bold tabular-nums text-foreground">{value}</div>
            </div>
          ))}
        </div>
        <p className="mt-2 text-[10px] text-muted-foreground">
          Derived from the configured sample fleet and open requirements. Ratios use indicative
          great-circle leg lengths.
        </p>
      </Panel>
      <Panel title="Employment outlook proxy · selected origin" badge={<DemoBadge />}>
        <p className="mb-3 text-xs text-muted-foreground">
          Low-demand outlook for {selectedVessel.cls} uses the simulated freight-rate series. It is
          a proxy, not a cargo-demand forecast, and does not represent live cargo offers.
        </p>
        <p className="mb-2 text-[10px] text-muted-foreground">
          25th-percentile soft-market threshold: ${softMarketThreshold.toFixed(2)}/t · selected
          vessel class index
        </p>
        <div className="grid grid-cols-4 gap-2 sm:grid-cols-8">
          {outlook
            .filter((point) => point.week !== "Now")
            .map((point) => {
              const rate = (point.forecast ?? currentRate) * vesselRateFactor;
              const softer = rate < softMarketThreshold;
              return (
                <div
                  key={point.week}
                  title={`${point.week}: model rate $${rate.toFixed(2)}/t${softer ? " · below historical 25th percentile" : ""}`}
                  className={cn(
                    "rounded border p-2 text-center",
                    softer
                      ? "border-pressure-normal/40 bg-pressure-normal/10"
                      : "border-border bg-background/50",
                  )}
                >
                  <div className="text-[9px] text-muted-foreground">{point.week}</div>
                  <div className="mt-1 text-xs font-semibold">${rate.toFixed(1)}</div>
                  <div className="mt-1 text-[8px] uppercase">{softer ? "Softer" : "Review"}</div>
                </div>
              );
            })}
        </div>
        <p className="mt-2 text-[9px] text-muted-foreground">
          {upcomingSoft.length
            ? `Next soft-market period: ${upcomingSoft[0]!.week}${upcomingSoft.length > 1 ? ` onward for about ${upcomingSoft.length * 7} days` : " · about 7 days"}. `
            : "No future week in this outlook is below the historical 25th percentile. "}
          Confirm demand and available cargo before changing a vessel plan.
        </p>
      </Panel>
      <Panel
        title="Fleet positioning & employment plan"
        badge={<DataBadge kind="simulated" detail="6 sample vessels · 5 sample requirements" />}
      >
        <p className="mb-3 text-xs text-muted-foreground">
          Select a configured vessel and an open requirement to compare hold, reposition,
          slow-steam, and alternative-employment plans. Routes are indicative great-circle
          distances; all sample requirements, {ALT_EMPLOYMENT_SAMPLES.length} sample opportunities,
          and cost settings are configured, not live offers or market quotes.
        </p>
        <div className="grid gap-4 xl:grid-cols-[minmax(300px,0.8fr)_minmax(0,1.5fr)]">
          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full text-left text-xs">
              <thead className="bg-background/70 text-[9px] uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="p-2">Vessel</th>
                  <th>Class</th>
                  <th>Status</th>
                  <th className="text-right">Idle</th>
                </tr>
              </thead>
              <tbody>
                {vessels.map((vessel) => {
                  const selected = vessel.id === selectedVessel.id;
                  const idleTone =
                    vessel.currentIdleH > 72
                      ? "text-pressure-high"
                      : vessel.currentIdleH > 48
                        ? "text-pressure-rising"
                        : "text-muted-foreground";
                  return (
                    <tr
                      key={vessel.id}
                      className={cn("border-t border-border", selected && "bg-primary/10")}
                    >
                      <td colSpan={4} className="p-0">
                        <button
                          type="button"
                          onClick={() => setSelectedVesselId(vessel.id)}
                          className="grid w-full grid-cols-[1fr_90px_70px_55px] items-center gap-2 px-2 py-2 text-left hover:bg-accent/50"
                          aria-pressed={selected}
                        >
                          <span className="flex min-w-0 items-center gap-2 font-semibold">
                            <Ship size={14} className="shrink-0 text-primary" />
                            <span className="truncate">{vessel.name}</span>
                          </span>
                          <span>{vessel.cls}</span>
                          <span className="text-muted-foreground">{vessel.status}</span>
                          <span className={`text-right tabular-nums ${idleTone}`}>
                            {vessel.currentIdleH ? `${vessel.currentIdleH} h` : "—"}
                          </span>
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="border-t border-border p-2 text-[9px] text-muted-foreground">
              Idle &gt;48 h mid blue · &gt;72 h dark navy · positions and statuses are configured samples.
            </div>
          </div>

          <div className="min-w-0 space-y-3">
            <section className="rounded-xl border border-border bg-background/50 p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div className="flex items-center gap-2">
                    <Ship size={16} className="text-primary" />
                    <h3 className="text-sm font-bold">{selectedVessel.name}</h3>
                  </div>
                  <p className="mt-1 text-[10px] text-muted-foreground">
                    {selectedVessel.cls} · {selectedVessel.near} · open{" "}
                    {selectedVessel.nextOpenDate}
                  </p>
                </div>
                <DataBadge kind="configured" detail="typical class values" />
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 text-[10px] sm:grid-cols-4">
                {[
                  [
                    "DWT / intake",
                    `${selectedVessel.dwt.toLocaleString()} / ${VESSEL_CLASSES[selectedVessel.cls].intakeMt.toLocaleString()} MT`,
                  ],
                  ["LOA / beam", `${selectedVessel.loaM} / ${selectedVessel.beamM} m`],
                  ["Laden draft", `${selectedVessel.draftM.toFixed(1)} m`],
                  ["Typical cargo", selectedVessel.typicalCargo],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-lg border border-border p-2">
                    <div className="text-muted-foreground">{label}</div>
                    <div className="mt-1 font-semibold">{value}</div>
                  </div>
                ))}
              </div>
            </section>

            <label className="block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Open requirement
              <select
                value={selectedRequirement.id}
                onChange={(event) => setSelectedRequirementId(event.target.value)}
                className="mt-1 h-10 w-full rounded-lg border border-border bg-background px-3 text-sm normal-case text-foreground"
              >
                {requirements.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name} · {item.quantityMt.toLocaleString()} MT · ready {item.readyDate}
                  </option>
                ))}
              </select>
            </label>

            <div className="rounded-xl border border-primary/35 bg-primary/5 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="text-[9px] font-bold uppercase tracking-wider text-primary">
                    Recommended strategy
                  </div>
                  <h3 className="mt-1 text-base font-bold">{recommendedPlan.title}</h3>
                </div>
                <DataBadge kind="simulated" detail="decision support" />
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{recommendedPlan.description}</p>
              {!recommendedPlan.feasible && (
                <p className="mt-1 text-xs text-pressure-high">
                  No feasible option: {recommendedPlan.reason}
                </p>
              )}
              <div className="mt-3 grid grid-cols-2 gap-2 text-[10px] sm:grid-cols-4">
                <span>
                  Idle: <b>{recommendedPlan.idleDays.toFixed(1)} d</b>
                </span>
                <span>
                  Ballast: <b>{recommendedPlan.ballastDays.toFixed(1)} d</b>
                </span>
                <span>
                  Deadhead: <b>{(recommendedPlan.deadheadRatio * 100).toFixed(0)}%</b>
                </span>
                <span>
                  Cost proxy: <b>{usd(recommendedPlan.totalCostUsd)}</b>
                </span>
              </div>
              <p className="mt-2 text-[10px] font-semibold text-foreground">
                Deadhead ratio {(baselineDeadheadRatio * 100).toFixed(0)}% →{" "}
                {(recommendedPlan.deadheadRatio * 100).toFixed(0)}% · Idle days{" "}
                {Math.max(0, selectedVessel.currentIdleH / 24).toFixed(1)} →{" "}
                {recommendedPlan.idleDays.toFixed(1)}.
              </p>
            </div>

            <div className="grid gap-2 md:grid-cols-2">
              {strategyCards.map((option) => (
                <article
                  key={option.id}
                  className={cn(
                    "rounded-xl border p-3",
                    option.id === recommendedPlan.id
                      ? "border-primary/55 bg-primary/8"
                      : option.feasible
                        ? "border-border bg-panel/70"
                        : "border-border bg-background/30 opacity-65",
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <h4 className="text-xs font-bold">{option.title}</h4>
                    <span
                      className={option.feasible ? "text-pressure-normal" : "text-muted-foreground"}
                    >
                      {option.feasible ? "Feasible" : "Unavailable"}
                    </span>
                  </div>
                  <p className="mt-1 text-[10px] text-muted-foreground">{option.description}</p>
                  {!option.feasible && option.reason && (
                    <p className="mt-1 text-[10px] text-pressure-rising">{option.reason}</p>
                  )}
                  <div className="mt-2 grid grid-cols-2 gap-x-2 gap-y-1 text-[10px]">
                    <span>
                      Idle <b>{option.idleDays.toFixed(1)} d</b>
                    </span>
                    <span>
                      Ballast <b>{option.ballastDays.toFixed(1)} d</b>
                    </span>
                    <span>
                      Deadhead <b>{(option.deadheadRatio * 100).toFixed(0)}%</b>
                    </span>
                    <span>
                      Cost <b>{usd(option.totalCostUsd)}</b>
                    </span>
                  </div>
                  <div
                    className="mt-2 flex h-2 overflow-hidden rounded-full bg-muted"
                    title={`Deadhead ${(option.deadheadRatio * 100).toFixed(0)}% · laden ${(100 - option.deadheadRatio * 100).toFixed(0)}%`}
                  >
                    <div
                      className="bg-pressure-rising"
                      style={{ width: `${Math.min(100, option.deadheadRatio * 100)}%` }}
                    />
                    <div className="flex-1 bg-pressure-normal/70" />
                  </div>
                </article>
              ))}
            </div>
            <p className="text-[9px] text-muted-foreground">
              Cost proxy uses CONFIGURED hire/day and fuel/day placeholders plus a bunker-price
              assumption; not market rates. Slow-steam fuel factor is an approximation. Alternative
              cargo income is not estimated.
            </p>

            <div className="grid gap-3 lg:grid-cols-2">
              <section className="rounded-xl border border-border bg-background/45 p-3">
                <h4 className="text-[10px] font-bold uppercase tracking-wider">
                  Closest next load ports
                </h4>
                <div className="mt-2 space-y-1.5">
                  {ORIGINS.map((origin) => ({
                    origin,
                    distance: routeNm([selectedVessel.position, origin.position]),
                  }))
                    .sort((a, b) => a.distance - b.distance)
                    .slice(0, 4)
                    .map(({ origin, distance }) => (
                      <div key={origin.code} className="flex justify-between gap-2 text-[10px]">
                        <span>
                          {origin.exampleLoadPorts[0]} · {origin.name}
                        </span>
                        <span className="tabular-nums text-muted-foreground">
                          {distance.toLocaleString()} nm ·{" "}
                          {(distance / (planningSettings.speedKn * 24)).toFixed(1)} d
                        </span>
                      </div>
                    ))}
                </div>
                <p className="mt-2 text-[9px] text-muted-foreground">
                  Indicative great-circle distances. Verify safe sea routing before positioning.
                </p>
              </section>
              <section className="rounded-xl border border-border bg-background/45 p-3">
                <h4 className="text-[10px] font-bold uppercase tracking-wider">
                  Match vessel to requirement
                </h4>
                <div className="mt-2 space-y-1.5">
                  {rankedRequirements.slice(0, 4).map((match) => (
                    <button
                      key={match.requirement.id}
                      type="button"
                      onClick={() => setSelectedRequirementId(match.requirement.id)}
                      className="flex w-full items-center justify-between gap-2 rounded text-left text-[10px] hover:text-primary"
                    >
                      <span className="truncate">{match.requirement.name}</span>
                      <span className="shrink-0 tabular-nums text-muted-foreground">
                        {match.feasible
                          ? `${match.ballastDays.toFixed(1)} d ballast · ${match.idleDays.toFixed(1)} d idle`
                          : match.reason}
                      </span>
                    </button>
                  ))}
                </div>
              </section>
            </div>
          </div>
        </div>
        <details className="mt-4 rounded-xl border border-border bg-background/40 p-3">
          <summary className="cursor-pointer text-xs font-semibold">
            Idle model settings <span className="ml-1 text-pressure-rising">CONFIGURED</span>
          </summary>
          <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            <label className="text-[10px] text-muted-foreground">
              Speed (knots)
              <input
                type="number"
                min="6"
                max="15"
                step="0.1"
                value={planningSettings.speedKn}
                onChange={(event) =>
                  setPlanningSettings((current) => ({
                    ...current,
                    speedKn: Number(event.target.value),
                  }))
                }
                className="mt-1 h-8 w-full rounded border border-border bg-background px-2 text-foreground"
              />
            </label>
            <label className="text-[10px] text-muted-foreground">
              Slow-steam minimum (knots)
              <input
                type="number"
                min="3"
                max={planningSettings.speedKn}
                step="0.1"
                value={planningSettings.minSlowSpeedKn}
                onChange={(event) =>
                  setPlanningSettings((current) => ({
                    ...current,
                    minSlowSpeedKn: Number(event.target.value),
                  }))
                }
                className="mt-1 h-8 w-full rounded border border-border bg-background px-2 text-foreground"
              />
            </label>
            <label className="text-[10px] text-muted-foreground">
              Bunker price placeholder (USD/t)
              <input
                type="number"
                min="0"
                step="10"
                value={planningSettings.bunkerUsdPerTonne}
                onChange={(event) =>
                  setPlanningSettings((current) => ({
                    ...current,
                    bunkerUsdPerTonne: Number(event.target.value),
                  }))
                }
                className="mt-1 h-8 w-full rounded border border-border bg-background px-2 text-foreground"
              />
            </label>
            {Object.keys(VESSEL_CLASSES).map((className) => (
              <div key={className} className="rounded-lg border border-border p-2">
                <div className="mb-2 text-[10px] font-bold text-foreground">{className}</div>
                <label className="block text-[9px] text-muted-foreground">
                  Hire USD/day
                  <input
                    type="number"
                    min="0"
                    step="100"
                    value={
                      planningSettings.hireUsdPerDayByClass[
                        className as keyof typeof planningSettings.hireUsdPerDayByClass
                      ]
                    }
                    onChange={(event) =>
                      setPlanningSettings((current) => ({
                        ...current,
                        hireUsdPerDayByClass: {
                          ...current.hireUsdPerDayByClass,
                          [className]: Number(event.target.value),
                        },
                      }))
                    }
                    className="mt-1 h-7 w-full rounded border border-border bg-background px-2 text-foreground"
                  />
                </label>
                <label className="mt-2 block text-[9px] text-muted-foreground">
                  Fuel tonnes/day
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={
                      planningSettings.fuelTonnesPerDayByClass[
                        className as keyof typeof planningSettings.fuelTonnesPerDayByClass
                      ]
                    }
                    onChange={(event) =>
                      setPlanningSettings((current) => ({
                        ...current,
                        fuelTonnesPerDayByClass: {
                          ...current.fuelTonnesPerDayByClass,
                          [className]: Number(event.target.value),
                        },
                      }))
                    }
                    className="mt-1 h-7 w-full rounded border border-border bg-background px-2 text-foreground"
                  />
                </label>
              </div>
            ))}
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-3">
            {Object.entries(planningSettings.weights).map(([key, value]) => (
              <label key={key} className="text-[9px] capitalize text-muted-foreground">
                {key} weight
                <input
                  type="number"
                  min="0"
                  max="1"
                  step="0.05"
                  value={value}
                  onChange={(event) =>
                    setPlanningSettings((current) => ({
                      ...current,
                      weights: { ...current.weights, [key]: Number(event.target.value) },
                    }))
                  }
                  className="mt-1 h-7 w-full rounded border border-border bg-background px-2 text-foreground"
                />
              </label>
            ))}
          </div>
          <p className="mt-2 text-[9px] text-muted-foreground">
            Weights are normalized for ranking. Hire, fuel and bunker inputs are illustrative
            placeholders, not market rates.
          </p>
        </details>
      </Panel>
      <p className="px-1 text-[10px] text-muted-foreground">
        Decision support — human approval required. Fleet history and all scenario outcomes are
        SIMULATED; no cargo matching or live AIS connection is active.
      </p>
    </main>
  );
}
