import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { ChartNoAxesCombined, Clock3, Cloud, CloudRain, CloudSun, Ship, Sun } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import {
  EAST_COAST_PORTS,
  ORIGINS,
  SEA_LANES,
  routeNm,
  routeTo,
  type OriginCode,
  type PortCode,
} from "@/config/geography";
import {
  evaluateVoyage,
  VESSEL_CLASSES,
  type CharterStrategy,
  type VesselClass,
} from "@/lib/freight-model";
import { RouteMap } from "@/components/RouteMap";
import { FinalCharterRecommendationCard } from "@/components/FinalCharterRecommendationCard";
import { CountryFlag } from "@/components/CountryFlag";
import { VesselIllustration } from "@/components/VesselIllustration";
import { cssToken } from "@/lib/google-maps";
import {
  DashboardHeader,
  DataBadge,
  DemoBadge,
  Field,
  inputCls,
  Panel,
  usd,
} from "@/components/Panel";
import { cn } from "@/lib/utils";
import { setRequirement, useRequirement } from "@/lib/requirement";
import {
  fetchDailyWeather,
  fetchSeasonalWeather,
  expectedDelayForWindow,
  seasonalCondition,
  weatherCondition,
  type DailyWeather,
} from "@/lib/weather";
import { buildRateSeries } from "@/lib/forecast-data";

const formatInputDate = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const addDays = (value: string, days: number) => {
  const date = new Date(`${value}T00:00:00`);
  date.setDate(date.getDate() + days);
  return formatInputDate(date);
};

export const Route = createFileRoute("/voyage")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Voyage & Charter Optimizer | FreightIQ" },
      {
        name: "description",
        content:
          "Plan coal voyages from five origins to seven East Coast India ports with charter, vessel, schedule and draft checks.",
      },
      { property: "og:title", content: "Voyage & Charter Optimizer | FreightIQ" },
      {
        property: "og:description",
        content:
          "Charter recommendations, sea-lane routing and idle-vessel flags for East Coast India.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: VoyagePage,
});

function VoyagePage() {
  const [intakePercent, setIntakePercent] = useState(95);
  const [scoreWeights, setScoreWeights] = useState({
    cost: 40,
    schedule: 25,
    utilization: 15,
    risk: 20,
  });
  const [rateFactors, setRateFactors] = useState<Partial<Record<VesselClass, number>>>(
    () =>
      Object.fromEntries(
        Object.entries(VESSEL_CLASSES).map(([name, value]) => [name, value.rateFactor]),
      ) as Partial<Record<VesselClass, number>>,
  );
  const req = useRequirement();
  const {
    cargo,
    volumeMt,
    origin,
    port,
    windowDays,
    strategy,
    alternate,
    startDate,
    endDate,
    vesselSize,
  } = req;
  const setCargo = (v: string) => setRequirement({ cargo: v });
  const setVolume = (v: number) => setRequirement({ volumeMt: v });
  const setOrigin = (v: OriginCode) => setRequirement({ origin: v });
  const setPort = (v: PortCode) => setRequirement({ port: v });
  const setDate = (key: "startDate" | "endDate", value: string) => {
    let start = key === "startDate" ? value : startDate;
    let end = key === "endDate" ? value : endDate;
    if (new Date(`${end}T00:00:00`) <= new Date(`${start}T00:00:00`)) {
      if (key === "startDate") {
        const corrected = new Date(`${start}T00:00:00`);
        corrected.setDate(corrected.getDate() + 30);
        end = formatInputDate(corrected);
      } else {
        const corrected = new Date(`${end}T00:00:00`);
        corrected.setDate(corrected.getDate() - 1);
        start = formatInputDate(corrected);
      }
    }
    const days = Math.max(
      1,
      Math.ceil(
        (new Date(`${end}T00:00:00`).getTime() - new Date(`${start}T00:00:00`).getTime()) /
          86400000,
      ),
    );
    setRequirement({ startDate: start, endDate: end, windowDays: days });
  };
  const setStrategy = (v: CharterStrategy) => setRequirement({ strategy: v });
  const setAlternate = (v: boolean) => setRequirement({ alternate: v });

  const lane = SEA_LANES[origin];
  const weather = useQuery({
    queryKey: ["voyage-weather", origin, port, startDate],
    queryFn: async () => {
      const load = ORIGINS.find((o) => o.code === origin)!;
      const discharge = EAST_COAST_PORTS.find((p) => p.code === port)!;
      const [loading, destination, loadingHistory, destinationHistory] = await Promise.all([
        fetchDailyWeather(load.position, 16),
        fetchDailyWeather(discharge.position, 16),
        fetchSeasonalWeather(load.position).catch(() => []),
        fetchSeasonalWeather(discharge.position).catch(() => []),
      ]);
      return { loading, destination, loadingHistory, destinationHistory };
    },
    staleTime: 30 * 60_000,
  });
  const estimatedTransitDays =
    routeNm(routeTo(origin, port, alternate && !!lane.alternate)) / (13 * 24);
  const dischargeWeatherStart = addDays(startDate, Math.floor(estimatedTransitDays) - 3);
  const dischargeWeather = selectDays(weather.data?.destination ?? [], dischargeWeatherStart);
  const loadingDelay = expectedDelayForWindow(
    startDate,
    weather.data?.loading ?? [],
    weather.data?.loadingHistory ?? [],
  );
  const dischargeDelay = expectedDelayForWindow(
    dischargeWeatherStart,
    weather.data?.destination ?? [],
    weather.data?.destinationHistory ?? [],
  );
  const r = useMemo(
    () =>
      evaluateVoyage({
        cargo,
        volumeMt,
        origin,
        port,
        windowDays,
        strategy,
        alternate: alternate && !!lane.alternate,
        weatherLoadDelayDays: loadingDelay,
        weatherDischargeDelayDays: dischargeDelay,
        poorWeatherAtArrival: dischargeWeather.some((day) => weatherCondition(day) === "Poor"),
        intakeFactor: intakePercent / 100,
        scoreWeights,
        rateFactors,
      }),
    [
      cargo,
      volumeMt,
      origin,
      port,
      windowDays,
      strategy,
      alternate,
      lane,
      loadingDelay,
      dischargeDelay,
      dischargeWeather,
      intakePercent,
      scoreWeights,
      rateFactors,
    ],
  );
  const best = r.best;
  const selectedClass =
    vesselSize === "Auto" ? best : (r.classes.find((v) => v.name === vesselSize) ?? best);
  const recommendationDiffers = !!best && !!selectedClass && selectedClass.name !== best.name;
  const marketTiming = best
    ? calculateMarketTiming(
        origin,
        endDate,
        best.sailDays,
        best.berthDays,
        volumeMt,
        best.rateFactor,
      )
    : null;

  return (
    <main className="freightiq-dashboard grid min-h-0 flex-1 gap-4 overflow-y-auto p-4 font-sans lg:grid-cols-[300px_1fr_360px]">
      <DashboardHeader
        eyebrow="Charter planning studio"
        title="Voyage & Charter"
        description="Shape the cargo movement, compare feasible vessel classes, and review route and schedule constraints."
        badge={<DemoBadge />}
      />
      {best && marketTiming && (
        <FinalCharterRecommendationCard
          action={marketTiming.action}
          vesselClass={best.name}
          strategy={strategy}
          routeLabel={`${ORIGINS.find((o) => o.code === origin)?.name ?? origin} → ${r.port.name} · ${cargo} · ${volumeMt.toLocaleString()} MT`}
          ratePerTonne={best.rate}
          landedUsd={best.landedUsd}
          voyages={best.voyages}
          transitDays={best.sailDays}
          score={best.score}
          latestFix={marketTiming.latest.toLocaleDateString()}
          entryLabel={marketTiming.entryLabel}
          confidence={marketTiming.confidence as "High" | "Medium" | "Low"}
          reasons={[
            marketTiming.reason,
            `${best.name} is the highest-scoring feasible class for ${r.port.name} on cost, schedule, utilisation and risk.`,
            `Book within ${r.bookingLeadDays} days; demurrage risk is ${r.demurrageRisk}.`,
          ]}
        />
      )}
      <Panel title="Cargo & voyage profile">
        <div className="space-y-3">
          <Field label="Cargo type">
            <select className={inputCls} value={cargo} onChange={(e) => setCargo(e.target.value)}>
              {["Coking coal", "Thermal coal", "PCI coal"].map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </Field>
          <Field label="Cargo volume (MT)">
            <input
              type="number"
              min={10000}
              step={5000}
              className={inputCls}
              value={volumeMt}
              onChange={(e) => setVolume(Math.max(1000, Number(e.target.value) || 0))}
            />
          </Field>
          <Field label="Origin">
            <div className="relative">
              <CountryFlag
                code={origin}
                className="pointer-events-none absolute left-3 top-1/2 z-10 h-5 w-[30px] -translate-y-1/2"
              />
              <select
                className={cn(inputCls, "h-10 pl-12")}
                value={origin}
                onChange={(e) => {
                  setOrigin(e.target.value as OriginCode);
                  setAlternate(false);
                }}
              >
                {ORIGINS.map((o) => (
                  <option key={o.code} value={o.code}>
                    {o.name === "United States" ? "USA" : o.name}: {o.exampleLoadPorts.join(" / ")}
                  </option>
                ))}
              </select>
            </div>
          </Field>
          <Field label="Destination port">
            <div className="relative">
              <CountryFlag
                className="pointer-events-none absolute left-3 top-1/2 z-10 h-5 w-[30px] -translate-y-1/2"
                code="IN"
              />
              <select
                className={cn(inputCls, "h-10 pl-12")}
                value={port}
                onChange={(e) => setPort(e.target.value as PortCode)}
              >
                {EAST_COAST_PORTS.map((p) => (
                  <option key={p.code} value={p.code}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Start date · earliest loading">
              <input
                type="date"
                className={inputCls}
                value={startDate}
                onChange={(e) => setDate("startDate", e.target.value)}
              />
            </Field>
            <Field label="End date · latest delivery">
              <input
                type="date"
                min={startDate}
                className={inputCls}
                value={endDate}
                onChange={(e) => setDate("endDate", e.target.value)}
              />
            </Field>
          </div>
          <div className="text-[10px] text-muted-foreground">
            {windowDays}-day window
            {strategy !== "Spot" ? ` · ${(windowDays / 30).toFixed(1)} months` : ""}
          </div>

          <details className="rounded-md border border-border bg-background/40 p-2">
            <summary className="cursor-pointer text-[10px] font-bold uppercase tracking-wider">
              Model settings <span className="ml-1 text-primary">Configured assumptions</span>
            </summary>
            <div className="mt-3 space-y-3 text-[10px]">
              <Field label={`Cargo intake · ${intakePercent}% of DWT`}>
                <input
                  type="range"
                  min="85"
                  max="100"
                  value={intakePercent}
                  onChange={(e) => setIntakePercent(Number(e.target.value))}
                  className="w-full accent-primary"
                />
              </Field>
              <p className="text-muted-foreground">
                Score weights · normalized to 100% for display
              </p>
              <div className="grid grid-cols-2 gap-2">
                {(Object.keys(scoreWeights) as Array<keyof typeof scoreWeights>).map((key) => (
                  <label key={key} className="flex items-center justify-between gap-1 capitalize">
                    {key}
                    <input
                      type="number"
                      min="0"
                      max="100"
                      value={scoreWeights[key]}
                      onChange={(e) =>
                        setScoreWeights((current) => ({
                          ...current,
                          [key]: Number(e.target.value),
                        }))
                      }
                      className="h-7 w-14 rounded border border-border bg-panel px-1"
                    />
                  </label>
                ))}
              </div>
              <p className="text-muted-foreground">
                Class rate multipliers · illustrative, not market quotes
              </p>
              <div className="grid grid-cols-2 gap-2">
                {(Object.keys(VESSEL_CLASSES) as VesselClass[]).map((name) => (
                  <label key={name} className="flex items-center justify-between gap-1">
                    {name}
                    <input
                      type="number"
                      min="0.5"
                      max="2"
                      step="0.01"
                      value={rateFactors[name] ?? 1}
                      onChange={(e) =>
                        setRateFactors((current) => ({
                          ...current,
                          [name]: Number(e.target.value),
                        }))
                      }
                      className="h-7 w-14 rounded border border-border bg-panel px-1"
                    />
                  </label>
                ))}
              </div>
              <DataBadge kind="configured" detail="editable in this session" />
            </div>
          </details>
          <Field label="Charter strategy">
            <div className="grid grid-cols-3 gap-1">
              {(["Spot", "Short-term", "Multi-voyage"] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setStrategy(s)}
                  className={cn(
                    "h-9 rounded-md border text-[11px] font-semibold",
                    strategy === s
                      ? "border-primary bg-primary/15 text-primary"
                      : "border-border text-muted-foreground hover:bg-accent",
                  )}
                >
                  {s}
                </button>
              ))}
            </div>
          </Field>
        </div>
      </Panel>

      <Panel
        title="Sea-lane route"
        badge={
          <span className="text-[10px] text-muted-foreground">
            {alternate && lane.alternate ? lane.alternate.via : lane.via} · {r.nm.toLocaleString()}{" "}
            nm
          </span>
        }
      >
        {lane.alternate && (
          <div className="mb-3 flex gap-1">
            {[false, true].map((alt) => (
              <button
                key={String(alt)}
                type="button"
                onClick={() => setAlternate(alt)}
                className={cn(
                  "rounded-md border px-3 py-1.5 text-[11px] font-semibold",
                  alternate === alt
                    ? "border-primary bg-primary/15 text-primary"
                    : "border-border text-muted-foreground hover:bg-accent",
                )}
              >
                {alt ? lane.alternate!.via : lane.via}
              </button>
            ))}
          </div>
        )}
        <RouteMap
          className="h-[min(36vh,380px)] min-h-[280px] w-full"
          segments={[{ path: r.path, color: cssToken("--marker-origin") }]}
        />
        <section
          className="mt-4 space-y-3 rounded-xl border border-border/80 bg-background/35 p-3 md:p-4"
          aria-label="Port weather outlook"
        >
          <div>
            <h3 className="text-xs font-bold uppercase tracking-[0.14em] text-foreground">
              Port weather outlook
            </h3>
            <p className="mt-1 text-[10px] text-muted-foreground">
              Forecasts for the loading and discharge ports
            </p>
          </div>
          <div className="grid gap-3 2xl:grid-cols-2">
            <WeatherOutlook
              title={`Loading port · ${ORIGINS.find((o) => o.code === origin)?.exampleLoadPorts[0]}`}
              days={weather.data?.loading ?? []}
              history={weather.data?.loadingHistory ?? []}
              start={startDate}
              loading={weather.isLoading}
              live={!!weather.data}
              updatedAt={weather.dataUpdatedAt}
            />
            {r.best && (
              <WeatherOutlook
                title={`Discharge port · ${r.port.name}`}
                days={weather.data?.destination ?? []}
                history={weather.data?.destinationHistory ?? []}
                start={addDays(startDate, Math.floor(r.best.sailDays) - 3)}
                loading={weather.isLoading}
                live={!!weather.data}
                updatedAt={weather.dataUpdatedAt}
              />
            )}
          </div>
          {weather.data && (
            <p className="text-[10px] leading-relaxed text-muted-foreground">
              Expected weather delay: loading {loadingDelay.toFixed(1)} d · discharge{" "}
              {dischargeDelay.toFixed(1)} d. Forecast values are used where available; otherwise
              this is a five-year seasonal estimate from wind/rain history. Delay weights are
              configured assumptions.
            </p>
          )}
          <p className="text-[10px] leading-relaxed text-muted-foreground">
            Wave data is from an ocean model at the port position. It indicates the approach, not
            conditions measured inside the harbour.
          </p>
        </section>
        <Panel title="Vessel size">
          <div className="flex flex-wrap gap-2.5" role="group" aria-label="Select vessel size">
            <button
              type="button"
              aria-pressed={vesselSize === "Auto"}
              onClick={() => setRequirement({ vesselSize: "Auto" })}
              className={cn(
                "flex min-h-[112px] min-w-[145px] flex-1 basis-[145px] flex-col items-start justify-center gap-2 rounded-xl border px-4 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                vesselSize === "Auto"
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border bg-background/45 text-muted-foreground hover:border-primary/50 hover:bg-accent/60",
              )}
            >
              <ChartNoAxesCombined size={24} aria-hidden />
              <span className="text-sm font-semibold">Auto · recommend</span>
              <span className="text-[10px] text-muted-foreground">Best fit for this voyage</span>
            </button>
            {(Object.keys(VESSEL_CLASSES) as VesselClass[]).map((size, index) => {
              const spec = VESSEL_CLASSES[size];
              const selected = vesselSize === size;
              return (
                <button
                  type="button"
                  key={size}
                  aria-pressed={selected}
                  onClick={() => setRequirement({ vesselSize: size })}
                  className={cn(
                    "min-w-[145px] flex-1 basis-[145px] overflow-hidden rounded-xl border text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                    selected
                      ? "border-primary bg-primary/10"
                      : "border-border bg-background/45 hover:border-primary/50 hover:bg-accent/60",
                  )}
                >
                  <VesselIllustration
                    length={spec.loaM}
                    geared={spec.gear.toLowerCase().includes("geared")}
                    index={index}
                  />
                  <span className="block px-3 py-2">
                    <span className="block text-sm font-semibold leading-tight">{size}</span>
                    <span className="mt-1 block text-[10px] leading-tight text-muted-foreground">
                      {spec.dwtRange} DWT
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </Panel>
      </Panel>

      <div className="space-y-4">
        <Panel title="Vessel comparison & recommendation" badge={<DemoBadge />}>
          {best ? (
            <div className="space-y-3 text-sm">
              {(() => {
                const selected =
                  vesselSize === "Auto" ? best : r.classes.find((v) => v.name === vesselSize)!;
                const chosen = selected;
                const spec = VESSEL_CLASSES[chosen.name as VesselClass];
                return (
                  <div className="rounded-md border border-border bg-background/50 p-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="flex items-center gap-2 text-lg font-semibold">
                          <Ship
                            size={
                              chosen.name === "Handysize"
                                ? 16
                                : chosen.name === "Supramax"
                                  ? 18
                                  : chosen.name === "Panamax"
                                    ? 20
                                    : 22
                            }
                            className="shrink-0 text-primary"
                            aria-hidden
                          />
                          {chosen.name}
                        </div>
                        <div className="text-[10px] text-muted-foreground">
                          {spec.dwtRange} DWT · typical {spec.dwt.toLocaleString()} DWT · intake{" "}
                          {Math.round((spec.dwt * intakePercent) / 100).toLocaleString()} MT ·{" "}
                          {spec.gear}
                        </div>
                      </div>
                      <DataBadge kind="configured" detail="typical class values" />
                    </div>
                    <div className="mt-2 grid grid-cols-3 gap-2 text-[10px] text-muted-foreground">
                      <span>LOA {spec.loaM} m</span>
                      <span>Beam {spec.beamM} m</span>
                      <span>Draft {spec.draftM.toFixed(1)} m</span>
                    </div>
                    <p className="mt-2 text-[10px]">
                      {chosen.fits
                        ? `Draft margin at ${r.port.name}: ${(r.port.maxDraftM - spec.draftM).toFixed(1)} m — berth checks OK`
                        : `Not feasible at ${r.port.name}: ${classConstraintReason(chosen, r.port)}.`}
                    </p>
                    <p className="mt-2 text-[10px] text-muted-foreground">
                      Typically carries: {spec.typicalCargo}
                    </p>
                  </div>
                );
              })()}
              <div>
                <div className="flex items-center gap-2 text-xl font-semibold">
                  <Ship size={20} className="shrink-0 text-primary" aria-hidden />
                  <span>
                    FreightIQ recommends: {best.name} · score {best.score}/100
                  </span>
                </div>
                <div className="text-xs text-muted-foreground">
                  {best.voyages} voyages · {strategy} charter · ${best.rate.toFixed(2)}/t
                </div>
                {vesselSize !== "Auto" && (
                  <p className="mt-1 text-xs">
                    Your choice: {vesselSize} · {selectedClass?.fits ? "Feasible" : "Not feasible"}·
                    score {selectedClass?.score}/100. Recommendation reflects feasibility, cost,
                    schedule, utilisation and configured risk weights.
                  </p>
                )}
              </div>
              {recommendationDiffers && selectedClass && (
                <div className="rounded-md border border-primary/30 bg-primary/5 p-2.5">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-primary">
                    Why {best.name} over your {selectedClass.name} selection
                  </div>
                  {selectedClass.fits ? (
                    <>
                      <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                        {selectedClass.landedUsd > 0 &&
                          best.landedUsd !== selectedClass.landedUsd && (
                            <div className="rounded border border-border bg-background/45 p-2">
                              <div className="text-[9px] text-muted-foreground">
                                Estimated landed cost
                              </div>
                              <div className="mt-0.5 font-semibold tabular-nums">
                                {(
                                  (Math.abs(best.landedUsd - selectedClass.landedUsd) /
                                    selectedClass.landedUsd) *
                                  100
                                ).toFixed(1)}
                                % {best.landedUsd < selectedClass.landedUsd ? "lower" : "higher"}
                              </div>
                            </div>
                          )}
                        {Number.isFinite(selectedClass.utilization) &&
                          Number.isFinite(best.utilization) && (
                            <div className="rounded border border-border bg-background/45 p-2">
                              <div className="text-[9px] text-muted-foreground">
                                Cargo utilization change
                              </div>
                              <div className="mt-0.5 font-semibold tabular-nums">
                                {best.utilization - selectedClass.utilization >= 0 ? "+" : ""}
                                {((best.utilization - selectedClass.utilization) * 100).toFixed(
                                  1,
                                )}{" "}
                                pp
                              </div>
                            </div>
                          )}
                        {Number.isFinite(selectedClass.voyages) &&
                          Number.isFinite(best.voyages) && (
                            <div className="rounded border border-border bg-background/45 p-2">
                              <div className="text-[9px] text-muted-foreground">
                                Voyages required
                              </div>
                              <div className="mt-0.5 font-semibold tabular-nums">
                                {best.voyages === selectedClass.voyages
                                  ? "Same count"
                                  : Math.abs(best.voyages - selectedClass.voyages) +
                                    (best.voyages < selectedClass.voyages ? " fewer" : " more")}
                              </div>
                            </div>
                          )}
                        {Number.isFinite(selectedClass.score) && Number.isFinite(best.score) && (
                          <div className="rounded border border-border bg-background/45 p-2">
                            <div className="text-[9px] text-muted-foreground">Configured score</div>
                            <div className="mt-0.5 font-semibold tabular-nums">
                              {best.score - selectedClass.score >= 0 ? "+" : ""}
                              {best.score - selectedClass.score} points
                            </div>
                          </div>
                        )}
                      </div>
                      <p className="mt-2 text-[9px] text-muted-foreground">
                        Derived from the current voyage model and selected route. Costs use
                        configured class-rate assumptions; the score uses the displayed model
                        weights. No transit days saved are claimed because both classes use the same
                        modeled speed.
                      </p>
                    </>
                  ) : (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {selectedClass.name} does not meet this port’s vessel constraints:{" "}
                      {classConstraintReason(selectedClass, r.port)}. The recommended {best.name}{" "}
                      class is feasible for the selected port.
                    </p>
                  )}
                </div>
              )}
              <div className="grid grid-cols-3 gap-1 rounded-md border border-border bg-background/40 p-2 text-[10px]">
                <div>
                  <span className="text-muted-foreground">Estimated departure</span>
                  <div className="mt-0.5 font-semibold">
                    {new Date(`${startDate}T00:00:00`).toLocaleDateString()}
                  </div>
                </div>
                <div>
                  <span className="text-muted-foreground">Estimated sailing</span>
                  <div className="mt-0.5 font-semibold">{best.sailDays.toFixed(1)} days</div>
                </div>
                <div>
                  <span className="text-muted-foreground">Estimated arrival</span>
                  <div className="mt-0.5 font-semibold">
                    {new Date(
                      new Date(`${startDate}T00:00:00`).getTime() + best.sailDays * 86400000,
                    ).toLocaleDateString()}
                  </div>
                </div>
              </div>
              {windowDays < best.sailDays + 2 && (
                <p className="rounded border border-pressure-rising/40 bg-pressure-rising/10 p-2 text-xs text-pressure-rising">
                  This window is shorter than the sailing time ({best.sailDays.toFixed(1)} days)
                  plus a two-day operating buffer.
                </p>
              )}
              <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-border bg-border text-xs">
                {[
                  ["Landed freight cost", usd(best.landedUsd)],
                  ["Review charter within", `${r.bookingLeadDays} days`],
                  ["Transit", `${best.sailDays.toFixed(1)} d`],
                  ["Demurrage risk", r.demurrageRisk],
                  ["Draft check", `${best.draftM} m ≤ ${r.port.maxDraftM} m`],
                  ["Berth time", `${best.berthDays.toFixed(1)} d`],
                ].map(([k, v]) => (
                  <div key={k} className="bg-panel p-2.5">
                    <dt className="text-[10px] text-muted-foreground">{k}</dt>
                    <dd className="mt-0.5 font-semibold tabular-nums">{v}</dd>
                  </div>
                ))}
              </dl>
              {!best.onTime && (
                <p className="text-xs text-pressure-rising">
                  No class meets the {windowDays}-day window; showing the cheapest feasible option.
                </p>
              )}
              <div className="overflow-x-auto">
                <table className="w-full min-w-[620px] text-[10px]">
                  <thead className="text-muted-foreground">
                    <tr>
                      <th className="py-1 text-left">Class</th>
                      <th>Fit</th>
                      <th>Voyages</th>
                      <th>Vessels</th>
                      <th>Fill</th>
                      <th>Total / t</th>
                      <th>Transit</th>
                      <th>Demurrage</th>
                      <th>Score</th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.classes.map((c) => (
                      <tr
                        key={c.name}
                        className={cn(
                          "border-t border-border",
                          c.name === best.name && "bg-primary/10 text-primary",
                          vesselSize === c.name && "outline outline-1 outline-primary/40",
                          !c.fits && "text-muted-foreground",
                        )}
                      >
                        <td className="py-1">{c.name}</td>
                        <td className="text-center">
                          {c.fits ? "Feasible" : classConstraintReason(c, r.port)}
                        </td>
                        <td className="text-center">{c.voyages}</td>
                        <td className="text-center">
                          {c.scheduleFits ? c.vesselsNeeded : "Cannot meet"}
                        </td>
                        <td className="text-center">{(c.utilization * 100).toFixed(0)}%</td>
                        <td className="text-center">
                          {usd(c.landedUsd)} / ${c.rate.toFixed(2)}
                        </td>
                        <td className="text-center">{c.sailDays.toFixed(1)}d</td>
                        <td className="text-center">
                          {c.berthDays > 5 ? "High" : c.berthDays > 3 ? "Medium" : "Low"}
                        </td>
                        <td className="text-center">{c.fits ? c.score : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="rounded-md border border-border bg-background/50 p-2.5 text-[10px]">
                <div className="font-bold uppercase tracking-wider text-primary">
                  Why this recommendation
                </div>
                {(() => {
                  const selected =
                    vesselSize === "Auto" ? best : r.classes.find((c) => c.name === vesselSize)!;
                  const second = r.ranked.find((c) => c.name !== best.name);
                  return (
                    <ul className="mt-1 list-disc space-y-1 pl-4 text-muted-foreground">
                      <li>
                        {!selected.fits
                          ? `${selected.name} is not feasible: ${classConstraintReason(selected, r.port)} at ${r.port.name}.`
                          : selected.name === best.name
                            ? `Your ${selected.name} choice is the highest-scoring feasible class at ${selected.score}/100.`
                            : `${best.name} scores ${best.score}/100 versus ${selected.name} at ${selected.score}/100.`}
                      </li>
                      {second && (
                        <li>
                          {best.name} costs ${usd(Math.abs(second.landedUsd - best.landedUsd))}{" "}
                          {best.landedUsd <= second.landedUsd ? "less" : "more"} in total than{" "}
                          {second.name}; class rates are configured assumptions.
                        </li>
                      )}
                      <li>
                        {best.name} requires {best.voyages} voyage(s),{" "}
                        {best.scheduleFits
                          ? `${best.vesselsNeeded} vessel(s) inside this window`
                          : "and this window cannot be met"}
                        , at {(best.utilization * 100).toFixed(0)}% average fill; demurrage risk is{" "}
                        {best.berthDays > 5 ? "High" : best.berthDays > 3 ? "Medium" : "Low"}.
                      </li>
                    </ul>
                  );
                })()}
              </div>
              {marketTiming && (
                <div className="rounded-md border border-primary/30 bg-primary/5 p-2.5">
                  <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-primary">
                    <Clock3 size={13} aria-hidden />
                    Optimal market entry timing
                  </div>
                  <p className="mt-1 text-sm font-bold">{marketTiming.state}</p>
                  <p className="text-xs">{marketTiming.reason}</p>
                  <div
                    className="mt-2 flex h-16 items-end gap-px rounded bg-background/50 px-1 pt-2"
                    aria-label="Simulated daily rate outlook with recommended entry window highlighted"
                  >
                    {marketTiming.chartDays.map((point) => {
                      const values = marketTiming.chartDays.map((item) => item.rate);
                      const low = Math.min(...values),
                        high = Math.max(...values);
                      const height =
                        high === low ? 45 : 12 + ((point.rate - low) / (high - low)) * 78;
                      return (
                        <div
                          key={point.date}
                          title={`${point.date} · $${point.rate.toFixed(2)}/t${point.selected ? " · recommended entry window" : ""}${point.latest ? " · latest fix" : ""}`}
                          className={cn(
                            "relative min-w-0 flex-1 rounded-t",
                            point.selected ? "bg-primary" : "bg-slate-500/70",
                            point.latest && "border-r-2 border-primary",
                          )}
                          style={{ height: `${height}%` }}
                        />
                      );
                    })}
                  </div>
                  <div className="mt-1 flex justify-between text-[9px] text-muted-foreground">
                    <span>
                      Selected-entry band · ${marketTiming.low.toFixed(2)}–$
                      {marketTiming.high.toFixed(2)}/t
                    </span>
                    <span>Red marker: latest fix · blue: entry window</span>
                  </div>
                  <ul className="mt-2 list-disc space-y-1 pl-4 text-[10px] text-muted-foreground">
                    <li>
                      Rates are modelled to {marketTiming.delta >= 0 ? "rise" : "fall"}{" "}
                      {Math.abs(marketTiming.delta * 100).toFixed(1)}% over 14 days.
                    </li>
                    <li>
                      Latest date to fix for delivery by{" "}
                      {new Date(`${endDate}T00:00:00`).toLocaleDateString()}:{" "}
                      {marketTiming.latest.toLocaleDateString()}.
                    </li>
                    <li>
                      Entering {marketTiming.entryLabel} is modelled{" "}
                      {marketTiming.saving >= 0 ? "cheaper" : "more expensive"} by{" "}
                      {usd(Math.abs(marketTiming.saving))} versus fixing today.
                    </li>
                  </ul>
                  <p className="mt-1 text-[10px] text-muted-foreground">
                    {marketTiming.confidence} confidence · forecast range $
                    {marketTiming.low.toFixed(2)}–${marketTiming.high.toFixed(2)}/t. SIMULATED — not
                    a guarantee. Decision support — human approval required.
                  </p>
                </div>
              )}
            </div>
          ) : (
            <p className="text-sm text-pressure-high">
              No vessel class fits {r.port.name}'s draft/LOA/beam limits.
            </p>
          )}
        </Panel>
      </div>
    </main>
  );
}

function calculateMarketTiming(
  origin: OriginCode,
  endDate: string,
  transitDays: number,
  berthDays: number,
  cargoMt: number,
  classRateFactor: number,
) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const latest = new Date(`${endDate}T00:00:00`);
  latest.setDate(latest.getDate() - (2 + transitDays + berthDays + 3));
  const points = buildRateSeries(origin).filter(
    (point) => point.week === "Now" || point.week.startsWith("W+"),
  );
  const current = points.find((point) => point.week === "Now")!.forecast! * classRateFactor;
  const rateAt = (day: number) => {
    const week = Math.min(8, Math.max(0, day / 7));
    const lower = Math.floor(week),
      upper = Math.ceil(week);
    const a = points.find(
      (point) => point.week === (lower === 0 ? "Now" : `W+${lower}`),
    )!.forecast!;
    const b = points.find(
      (point) => point.week === (upper === 0 ? "Now" : `W+${upper}`),
    )!.forecast!;
    return (a + (b - a) * (week - lower)) * classRateFactor;
  };
  const maxDay =
    latest < today ? -1 : Math.min(56, Math.floor((latest.getTime() - today.getTime()) / 86400000));
  const horizonDay = maxDay < 0 ? 0 : Math.min(14, maxDay);
  const delta = (rateAt(horizonDay) - current) / current;
  let minimum = { day: 0, rate: current };
  for (let day = 1; day <= Math.max(0, maxDay); day++) {
    const rate = rateAt(day);
    if (rate < minimum.rate) minimum = { day, rate };
  }
  const action =
    maxDay < 0
      ? "late"
      : delta >= 0.02
        ? "enter"
        : delta <= -0.02 && minimum.day > 0
          ? "wait"
          : "monitor";
  const entryDay = action === "wait" ? minimum.day : 0;
  const entryDate = new Date(today);
  entryDate.setDate(today.getDate() + entryDay);
  const state =
    action === "late"
      ? "TOO LATE for standard timing"
      : action === "enter"
        ? "ENTER NOW"
        : action === "wait"
          ? `WAIT — enter around ${entryDate.toLocaleDateString()}`
          : `MONITOR — re-check ${addDays(formatInputDate(today), 7)}`;
  const reason =
    maxDay < 0
      ? "The latest date to fix has already passed based on estimated transit, berth and buffer days."
      : delta >= 0.02
        ? "The simulated 14-day outlook rises beyond the configured 2% threshold."
        : delta <= -0.02 && entryDay > 0
          ? "The lowest modeled rate within the deliverable search window occurs later."
          : "The outlook does not cross the configured change threshold; review again in seven days.";
  let windowEnd = entryDay;
  while (
    action === "wait" &&
    windowEnd < Math.max(0, maxDay) &&
    rateAt(windowEnd + 1) <= minimum.rate * 1.01
  )
    windowEnd++;
  const rangePoint = points.find(
    (point) => point.week === (entryDay < 7 ? "W+1" : `W+${Math.min(8, Math.ceil(entryDay / 7))}`),
  );
  const entryRate = rateAt(entryDay);
  const range: [number, number] = rangePoint?.band
    ? [rangePoint.band[0] * classRateFactor, rangePoint.band[1] * classRateFactor]
    : [entryRate, entryRate];
  const confidenceRatio = (range[1] - range[0]) / Math.max(0.01, entryRate);
  const chartDays = Array.from({ length: Math.max(1, Math.min(56, maxDay) + 1) }, (_, day) => {
    const date = new Date(today);
    date.setDate(date.getDate() + day);
    return {
      date: formatInputDate(date),
      rate: rateAt(day),
      selected: action === "wait" && day >= entryDay && day <= windowEnd,
      latest: day === maxDay,
    };
  });
  return {
    action,
    state,
    reason,
    delta,
    latest,
    entryLabel:
      entryDay === 0
        ? "today"
        : `${entryDate.toLocaleDateString()}${windowEnd > entryDay ? `–${addDays(formatInputDate(today), windowEnd)}` : ""}`,
    saving: (current - entryRate) * cargoMt,
    chartDays,
    confidence: confidenceRatio <= 0.08 ? "High" : confidenceRatio <= 0.15 ? "Medium" : "Low",
    low: range[0],
    high: range[1],
  };
}

function classConstraintReason(
  candidate: { draftM: number; loaM: number; beamM: number },
  port: { maxDraftM: number; maxLoaM: number; maxBeamM: number },
) {
  if (candidate.draftM > port.maxDraftM)
    return `draft ${candidate.draftM.toFixed(1)} m exceeds ${port.maxDraftM.toFixed(1)} m`;
  if (candidate.loaM > port.maxLoaM) return `LOA ${candidate.loaM} m exceeds ${port.maxLoaM} m`;
  if (candidate.beamM > port.maxBeamM)
    return `beam ${candidate.beamM.toFixed(1)} m exceeds ${port.maxBeamM.toFixed(1)} m`;
  return "berth limits not met";
}

function selectDays(days: DailyWeather[], start: string) {
  const end = addDays(start, 6);
  return days.filter((day) => day.date >= start && day.date <= end);
}

function WeatherOutlook({
  title,
  days,
  history,
  start,
  loading,
  live,
  updatedAt,
}: {
  title: string;
  days: DailyWeather[];
  history: Awaited<ReturnType<typeof fetchSeasonalWeather>>;
  start: string;
  loading: boolean;
  live: boolean;
  updatedAt: number;
}) {
  const selected = Array.from({ length: 7 }, (_, index) => {
    const date = addDays(start, index);
    const day = days.find((item) => item.date === date) ?? null;
    return { date, day, seasonal: day ? null : seasonalCondition(date, history) };
  });
  return (
    <section className="min-w-0 rounded border border-border bg-background/40 p-2">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className="min-w-0 text-xs font-bold leading-snug tracking-wide">{title}</h3>
        {live ? (
          <span className="shrink-0 whitespace-nowrap">
            <DataBadge
              kind="live"
              detail={`Open-Meteo · ${new Date(updatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`}
            />
          </span>
        ) : (
          <span className="shrink-0 text-[10px] text-muted-foreground">
            {loading ? "Loading" : "Feed unavailable"}
          </span>
        )}
      </div>
      {loading ? (
        <p className="text-[9px] text-muted-foreground">Loading…</p>
      ) : (
        <div className="-mx-1 overflow-x-auto px-1 pb-1">
          <div className="grid w-max grid-flow-col auto-cols-[3.5rem] gap-1">
            {selected.map(({ date, day, seasonal }) => {
              const condition = day
                ? weatherCondition(day)
                : (seasonal?.condition ?? "Not available");
              const WeatherIcon =
                condition === "Poor"
                  ? CloudRain
                  : condition === "Caution"
                    ? CloudSun
                    : condition === "Good"
                      ? Sun
                      : Cloud;
              return (
                <div
                  key={date}
                  title={
                    day
                      ? `${condition}; wave ${day.wave ?? "Not available"} m, gust ${day.gust ?? "Not available"} kn, rain ${day.rain ?? "Not available"} mm`
                      : seasonal
                        ? `SEASONAL · ${Math.round((seasonal.cautionShare + seasonal.poorShare) * 100)}% caution/poor in the five-year archive. Wave history not available.`
                        : "Forecast and seasonal history unavailable"
                  }
                  className={cn(
                    "min-w-0 rounded-md border px-1 py-1.5 text-center text-[10px] leading-tight",
                    condition === "Poor"
                      ? "border-pressure-high/40 text-pressure-high"
                      : condition === "Caution"
                        ? "border-pressure-rising/40 text-pressure-rising"
                        : condition === "Good"
                          ? "border-pressure-normal/40 text-pressure-normal"
                          : "border-border text-muted-foreground",
                  )}
                >
                  <div>
                    {new Date(`${date}T00:00:00`).toLocaleDateString(undefined, {
                      weekday: "short",
                    })}
                  </div>
                  <div className="my-0.5 text-[8px] font-semibold leading-tight text-muted-foreground">
                    {day ? "Live" : seasonal ? "History" : "No data"}
                  </div>
                  <div className="mb-1 flex items-center justify-center gap-0.5 font-semibold">
                    <WeatherIcon size={12} className="shrink-0" aria-hidden />
                    {condition === "Not available" ? "N/A" : condition}
                  </div>
                  <div className="text-left text-[9px] text-muted-foreground">
                    Wave{" "}
                    <span className="font-medium text-foreground">
                      {day?.wave == null ? "—" : `${day.wave.toFixed(1)} m`}
                    </span>
                  </div>
                  <div className="text-left text-[9px] text-muted-foreground">
                    Gust{" "}
                    <span className="font-medium text-foreground">
                      {day?.gust == null ? "—" : `${day.gust.toFixed(0)} kn`}
                    </span>
                  </div>
                  <div className="text-left text-[9px] text-muted-foreground">
                    Rain{" "}
                    <span className="font-medium text-foreground">
                      {day?.rain == null ? "—" : `${day.rain.toFixed(0)} mm`}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}
