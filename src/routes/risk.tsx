import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import { AlertTriangle, Anchor, Clock, Globe2, TrendingUp } from "lucide-react";
import {
  EAST_COAST_PORTS,
  ORIGINS,
  SPEC_LABEL_CONFIGURED,
  SEA_LANES,
  type PortCode,
} from "@/config/geography";
import { CONGESTION_DEMO, evaluateVoyage } from "@/lib/freight-model";
import { DashboardHeader, DataBadge, DemoBadge, Panel } from "@/components/Panel";
import { cn } from "@/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { fetchDailyWeather, weatherCondition, weatherDelayDays } from "@/lib/weather";
import { useRequirement } from "@/lib/requirement";
import { useWeatherAdjustment } from "@/lib/weather-adjustment";
import { fetchAisPorts, fetchAisSummary, localAisUnavailable } from "@/lib/ais";

export const Route = createFileRoute("/risk")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Risk & Port Constraints | FreightIQ" },
      {
        name: "description",
        content:
          "Draft, LOA, beam and handling limits for seven East Coast India ports, with congestion signals and risk alerts.",
      },
      { property: "og:title", content: "Risk & Port Constraints | FreightIQ" },
      {
        property: "og:description",
        content:
          "Port constraint reference and risk alerts for Paradip, Vizag, Gangavaram, Gopalpur, Dhamra, Sagar-Sandheads and Haldia.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: RiskPage,
});

function seeded(seed: number) {
  let s = seed;
  return () => (s = (s * 9301 + 49297) % 233280) / 233280;
}

type Level = "low" | "medium" | "high";

const levelCls: Record<Level, string> = {
  low: "border-pressure-normal/40 bg-pressure-normal/10 text-pressure-normal",
  medium: "border-pressure-rising/40 bg-pressure-rising/10 text-pressure-rising",
  high: "border-pressure-high/40 bg-pressure-high/10 text-pressure-high",
};

function RiskPage() {
  const requirement = useRequirement();
  const weatherAdjustment = useWeatherAdjustment();
  const aisSummaryQuery = useQuery({
    queryKey: ["ais-summary"],
    queryFn: () => fetchAisSummary().catch(() => localAisUnavailable()),
    refetchInterval: 15_000,
    retry: false,
  });
  const aisPortsQuery = useQuery({
    queryKey: ["ais-ports"],
    queryFn: () => fetchAisPorts().catch(() => ({ source: "unavailable" as const, ports: [] })),
    refetchInterval: 15_000,
    retry: false,
  });
  const aisSummary = aisSummaryQuery.data ?? localAisUnavailable();
  const aisLive = aisSummary.source === "live" && aisSummary.state === "connected";
  const activeOrigin = ORIGINS.find((o) => o.code === requirement.origin)!;
  const weatherQuery = useQuery({
    queryKey: ["port-weather-week", requirement.origin],
    queryFn: async () =>
      Promise.all([
        ...EAST_COAST_PORTS.map(async (p) => ({
          name: p.name,
          type: "Discharge" as const,
          days: await fetchDailyWeather(p.position),
        })),
        ...ORIGINS.filter((o) => o.code === requirement.origin).map(async (o) => ({
          name: `${o.exampleLoadPorts[0]} · ${o.name}`,
          type: "Loading" as const,
          days: await fetchDailyWeather(o.position),
        })),
      ]),
    staleTime: 30 * 60_000,
  });
  // Demo AIS proxy: congestion days + a deterministic vessel count per port. Labeled demo until a live AIS feed is connected.
  const demoPorts = useMemo(
    () =>
      EAST_COAST_PORTS.map((p) => {
        const rnd = seeded(p.code.charCodeAt(0) * 41 + p.code.charCodeAt(1));
        const congestion = CONGESTION_DEMO[p.code as PortCode] ?? 1;
        const vessels = Math.round(4 + rnd() * 14 + congestion * 2);
        const stationary = Math.round(vessels * (0.15 + rnd() * 0.25));
        const level: Level = congestion > 2.5 ? "high" : congestion > 1.5 ? "medium" : "low";
        return { ...p, vessels, stationary, congestion, level };
      }),
    [],
  );
  const aisPortByName = new Map(
    (aisPortsQuery.data?.ports ?? []).map((port) => [port.name.toLowerCase(), port]),
  );
  const ports = demoPorts.map((port) => {
    const aisName = port.name === "Vizag" ? "visakhapatnam" : port.name.toLowerCase();
    const livePort = aisPortByName.get(aisName);
    if (!aisLive || !livePort)
      return {
        ...port,
        live: false,
        liveVessels: null as number | null,
        liveStationary: null as number | null,
      };
    const level: Level = livePort.stationaryOverThreshold > 0 ? "medium" : "low";
    return {
      ...port,
      vessels: livePort.vessels,
      stationary: livePort.stationaryOverThreshold,
      congestion: 0,
      level,
      live: true,
      liveVessels: livePort.vessels,
      liveStationary: livePort.stationaryOverThreshold,
      lastObserved: livePort.lastObserved,
    };
  });

  const input = {
    cargo: requirement.cargo,
    volumeMt: requirement.volumeMt,
    origin: requirement.origin,
    port: requirement.port,
    windowDays: requirement.windowDays,
    strategy: requirement.strategy,
    alternate: requirement.alternate,
  };
  const benchmark = evaluateVoyage(input);
  const suezRisk = SEA_LANES.US.via === "Via Suez Canal";

  const alerts: Array<{
    kind: string;
    icon: typeof AlertTriangle;
    level: Level;
    title: string;
    body: string;
  }> = [
    {
      kind: "Market",
      icon: TrendingUp,
      level: "high",
      title: "Russia corridor rates up 12.4%",
      body: "RU → Paradip demo rate at $24.6/t and climbing; review before sending for approval.",
    },
    ...ports
      .filter((p) => p.level !== "low")
      .map((p) => ({
        kind: "Port",
        icon: Anchor,
        level: p.level,
        title: `${p.name} congestion ${p.level}`,
        body: p.live
          ? `${p.stationary} potential stationary flags over ${aisSummary.stationaryHours} h from observed AIS positions. This heuristic is not confirmed congestion.`
          : `${p.stationary} of ${p.vessels} vessels stationary near berth (demo AIS). Est. wait ${p.congestion.toFixed(1)} d.`,
      })),
    ...(weatherQuery.data ?? []).flatMap((row) => {
      const poor = row.days.filter((day) => weatherCondition(day) === "Poor").length;
      const caution = row.days.filter((day) => weatherCondition(day) === "Caution").length;
      if (poor > 0)
        return [
          {
            kind: "Weather",
            icon: AlertTriangle,
            level: "high" as Level,
            title: `Poor weather forecast at ${row.name}`,
            body: `${poor} Poor day(s) in the next 7 days. Review loading or arrival dates.`,
          },
        ];
      if (caution >= 3)
        return [
          {
            kind: "Weather",
            icon: AlertTriangle,
            level: "medium" as Level,
            title: `Weather cautions at ${row.name}`,
            body: `${caution} Caution day(s) in the next 7 days. Review loading or arrival dates.`,
          },
        ];
      return [];
    }),
    {
      kind: "Schedule",
      icon: Clock,
      level: benchmark.timely.length ? "low" : "high",
      title: benchmark.timely.length
        ? "Benchmark voyage on schedule"
        : "Benchmark voyage misses window",
      body: `AU → Paradip, 150,000 MT: ${benchmark.timely.length} of ${benchmark.feasible.length} feasible classes meet the 35-day window (demo).`,
    },
    {
      kind: "Geopolitical",
      icon: Globe2,
      level: suezRisk ? "medium" : "low",
      title: suezRisk ? "Suez transit exposure on US lane" : "No geopolitical flags",
      body: suezRisk
        ? "US East Coast lane routes via Suez; Cape of Good Hope alternate adds ~18% freight (demo)."
        : "All selected corridors on open routes.",
    },
  ];

  return (
    <main className="freightiq-dashboard grid min-h-0 flex-1 gap-4 overflow-y-auto p-4 font-sans lg:grid-cols-[1fr_360px]">
      <DashboardHeader
        eyebrow="Operations watch"
        title="Risk & Port Constraints"
        description="Scan configured port limits and clearly labelled operational risk indicators for the active Indian East Coast lane."
        badge={<DemoBadge />}
      />
      <div className="space-y-4">
        <Panel
          title="Port constraints — East Coast India"
          badge={<DataBadge kind="configured" detail="7 ports" />}
        >
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                <tr>
                  <th className="py-2">Port</th>
                  <th>State</th>
                  <th className="text-right">Max draft</th>
                  <th className="text-right">LOA</th>
                  <th className="text-right">Beam</th>
                  <th className="pr-6 text-right">Handling</th>
                  <th>{aisLive ? "Observed AIS · vessels / flags" : "Vessels (demo)"}</th>
                </tr>
              </thead>
              <tbody>
                {ports.map((p) => (
                  <tr key={p.code} className="border-t border-border">
                    <td className="py-2.5 font-semibold">{p.name}</td>
                    <td className="text-xs text-muted-foreground">{p.state}</td>
                    <td className="text-right tabular-nums">{p.maxDraftM.toFixed(1)} m</td>
                    <td className="text-right tabular-nums">{p.maxLoaM} m</td>
                    <td className="text-right tabular-nums">{p.maxBeamM} m</td>
                    <td className="pr-6 text-right tabular-nums">
                      {p.handlingTpd.toLocaleString()} t/d
                    </td>
                    <td>
                      <span
                        className={cn(
                          "inline-flex items-center gap-1.5 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide",
                          levelCls[p.level],
                        )}
                      >
                        {aisLive
                          ? `${p.liveVessels ?? 0} · ${p.liveStationary ?? 0} flags`
                          : `${p.vessels} · wait ${p.congestion.toFixed(1)} d`}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-[10px] text-muted-foreground">
            Draft, LOA, beam and handling values for all seven ports are {SPEC_LABEL_CONFIGURED}.
            {aisLive
              ? " Vessel counts are AIS observations near each monitored port; wait estimates and other risk indicators remain configured/demo values."
              : " Vessel counts and waits are demo estimates, not live AIS."}
          </p>
        </Panel>

        <Panel
          title="Weather outlook · next 7 days"
          badge={
            weatherQuery.data ? (
              <DataBadge
                kind="live"
                detail={`Open-Meteo · updated ${new Date(weatherQuery.dataUpdatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`}
              />
            ) : (
              <span className="rounded border border-border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-muted-foreground">
                {weatherQuery.isLoading ? "Loading feed" : "Feed unavailable"}
              </span>
            )
          }
        >
          {weatherQuery.isLoading && (
            <p className="text-xs text-muted-foreground">Loading forecast…</p>
          )}
          {weatherQuery.isError && (
            <p className="text-xs text-muted-foreground">
              Weather forecast not available. Retry when the feed is reachable.
            </p>
          )}
          {weatherQuery.data && (
            <div className="space-y-2">
              {weatherQuery.data.map((row) => (
                <div
                  key={row.name}
                  className="flex min-w-0 items-center gap-2 border-b border-border pb-2 last:border-0"
                >
                  <span
                    className="w-32 shrink-0 truncate text-[10px] font-semibold"
                    title={`${row.type}: ${row.name}`}
                  >
                    {row.name}
                  </span>
                  <div className="flex min-w-0 flex-1 gap-1 overflow-x-auto">
                    {row.days.map((day) => {
                      const condition = weatherCondition(day);
                      return (
                        <div
                          key={day.date}
                          title={`${condition} · wave ${day.wave == null ? "Not available" : `${day.wave.toFixed(1)} m`} · gust ${day.gust == null ? "Not available" : `${day.gust.toFixed(0)} kn`} · rain ${day.rain == null ? "Not available" : `${day.rain.toFixed(1)} mm`}`}
                          className={cn(
                            "min-w-[58px] rounded border px-1 py-1 text-center text-[9px]",
                            condition === "Poor"
                              ? "border-pressure-high/40 bg-pressure-high/10 text-pressure-high"
                              : condition === "Caution"
                                ? "border-pressure-rising/40 bg-pressure-rising/10 text-pressure-rising"
                                : "border-pressure-normal/40 bg-pressure-normal/10 text-pressure-normal",
                          )}
                        >
                          <div>
                            {new Date(`${day.date}T00:00:00`).toLocaleDateString(undefined, {
                              weekday: "short",
                            })}
                          </div>
                          <div className="font-bold">{condition}</div>
                          <div className="text-muted-foreground">
                            {day.wave == null ? "—" : `${day.wave.toFixed(1)}m`}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
          <p className="mt-2 text-[9px] text-muted-foreground">
            Wave from an ocean model at the port position; approach indicator, not an in-harbour
            measurement. Gust in knots · rain in mm/day.{" "}
            <Link to="/forecast" className="text-primary hover:underline">
              Open route weather
            </Link>
          </p>
        </Panel>

        <Panel
          title="How weather can move freight rates"
          badge={<DataBadge kind="configured" detail="scenario adjustment" />}
        >
          <p className="text-xs text-muted-foreground">
            Bad weather can delay ships, tighten vessel availability, increase berth waiting, or
            reduce cargo available to load. Weather is an operational risk input; it is not a
            learned causal freight-price model.
          </p>
          {weatherQuery.data &&
            (() => {
              const load = weatherQuery.data.find((x) => x.type === "Loading");
              const discharge = weatherQuery.data.find(
                (x) => x.name === EAST_COAST_PORTS.find((p) => p.code === input.port)?.name,
              );
              const ld = weatherDelayDays(load?.days ?? []),
                dd = weatherDelayDays(discharge?.days ?? []),
                total = ld + dd;
              const pressure = total < 1 ? "Low" : total <= 3 ? "Medium" : "High";
              const bandWidening = weatherAdjustment.includeWeather
                ? Math.min(30, total * weatherAdjustment.bandWideningPct)
                : 0;
              const medianUplift = weatherAdjustment.includeWeather
                ? Math.min(3, total * weatherAdjustment.medianUpliftPct)
                : 0;
              return (
                <div className="mt-3 grid grid-cols-2 gap-2 text-xs lg:grid-cols-3">
                  <div className="rounded border border-border p-2">
                    <span className="text-muted-foreground">Expected extra days</span>
                    <div className="mt-1 font-semibold">
                      Load {ld.toFixed(1)} d · discharge {dd.toFixed(1)} d
                    </div>
                  </div>
                  <div className="rounded border border-border p-2">
                    <span className="text-muted-foreground">Scenario pressure</span>
                    <div className="mt-1 font-semibold">{pressure}</div>
                  </div>
                  <div className="rounded border border-border p-2">
                    <span className="text-muted-foreground">Forecast adjustment</span>
                    <div className="mt-1 font-semibold">
                      +{medianUplift.toFixed(1)}% median · +{bandWidening.toFixed(0)}% band
                    </div>
                  </div>
                </div>
              );
            })()}
          <p className="mt-3 text-[10px] text-muted-foreground">
            If enabled in planning, weather adds a configured uplift to the scenario median and
            widens its uncertainty band. Illustrative assumption, not learned from data.
          </p>
        </Panel>
      </div>

      <div className="space-y-4">
        <Panel
          title="Risk alerts"
          badge={<DataBadge kind="simulated" detail={`${alerts.length} active`} />}
        >
          <div className="space-y-2">
            {alerts.map((a) => (
              <div key={a.title} className={cn("rounded-md border p-3", levelCls[a.level])}>
                <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.12em] opacity-80">
                  <a.icon size={12} />
                  {a.kind}
                </div>
                <div className="mt-1 text-sm font-semibold text-foreground">{a.title}</div>
                <div className="mt-0.5 text-xs text-muted-foreground">{a.body}</div>
              </div>
            ))}
          </div>
          <p className="mt-3 flex items-center gap-1.5 text-[10px] text-muted-foreground">
            <AlertTriangle size={11} />
            Origin reference: {ORIGINS.map((o) => o.name).join(", ")}.
          </p>
        </Panel>
      </div>
    </main>
  );
}
