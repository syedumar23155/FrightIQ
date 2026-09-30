import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { Anchor, Clock3, CloudSun, Ship, TrendingUp, Waves } from "lucide-react";
import { useRequirement } from "@/lib/requirement";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  EAST_COAST_PORTS,
  routeTo,
  type LatLng,
  type OriginCode,
  type PortCode,
} from "@/config/geography";
import { BASE_RATE, evaluateVoyage } from "@/lib/freight-model";
import { RouteMap, type Segment } from "@/components/RouteMap";
import { DashboardHeader, DataBadge, DemoBadge, LiveBadge, Panel, usd } from "@/components/Panel";
import { cssToken } from "@/lib/google-maps";
import { buildRateSeries } from "@/lib/forecast-data";
import { setWeatherAdjustment, useWeatherAdjustment } from "@/lib/weather-adjustment";

export const Route = createFileRoute("/forecast")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Freight Forecast & Scenarios | FreightIQ" },
      {
        name: "description",
        content:
          "Freight rate forecast, live marine weather along the route, and charter timing scenarios.",
      },
      { property: "og:title", content: "Freight Forecast & Scenarios | FreightIQ" },
      {
        property: "og:description",
        content:
          "Compare charter-now vs wait, vessel class and port switches with route wave conditions.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ForecastPage,
});

function sample(path: LatLng[]): LatLng[] {
  const pts: LatLng[] = [];
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i]!,
      b = path[i + 1]!;
    for (let t = 0; t < 3; t++)
      pts.push({ lat: a.lat + ((b.lat - a.lat) * t) / 3, lng: a.lng + ((b.lng - a.lng) * t) / 3 });
  }
  pts.push(path[path.length - 1]!);
  return pts;
}

async function fetchWaves(pts: LatLng[]): Promise<Array<number | null>> {
  const url = `https://marine-api.open-meteo.com/v1/marine?latitude=${pts.map((p) => p.lat.toFixed(2)).join(",")}&longitude=${pts.map((p) => p.lng.toFixed(2)).join(",")}&current=wave_height`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("Marine weather unavailable");
  const json = await res.json();
  const arr = Array.isArray(json) ? json : [json];
  return arr.map((r: { current?: { wave_height?: number } }) =>
    typeof r?.current?.wave_height === "number" ? r.current.wave_height : null,
  );
}

function ForecastPage() {
  const { includeWeather, medianUpliftPct, bandWideningPct } = useWeatherAdjustment();
  const { origin, port, volumeMt } = useRequirement();
  const data = useMemo(() => buildRateSeries(origin), [origin]);
  const path = useMemo(() => routeTo(origin, port), [origin, port]);
  const pts = useMemo(() => sample(path), [path]);
  const waves = useQuery({
    queryKey: ["waves", origin, port],
    queryFn: () => fetchWaves(pts),
    staleTime: 15 * 60_000,
  });

  const segments: Segment[] = useMemo(() => {
    const colorFor = (h: number | null) =>
      h == null
        ? cssToken("--muted-foreground")
        : h < 2
          ? cssToken("--pressure-normal")
          : h < 3.5
            ? cssToken("--pressure-rising")
            : cssToken("--pressure-high");
    const w = waves.data;
    return pts.slice(0, -1).map((p, i) => {
      const hs = [w?.[i] ?? null, w?.[i + 1] ?? null].filter((x): x is number => x != null);
      return { path: [p, pts[i + 1]!], color: colorFor(hs.length ? Math.max(...hs) : null) };
    });
  }, [pts, waves.data]);

  const maxWave = waves.data
    ? Math.max(0, ...waves.data.filter((x): x is number => x != null))
    : null;
  // Illustrative scenario adjustment only; weather is not a learned causal freight-price model.
  const configuredDelayDays = maxWave == null ? 0 : maxWave >= 3.5 ? 1 : maxWave >= 2 ? 0.25 : 0;
  const chartData = useMemo(
    () =>
      data.map((point) => {
        if (!includeWeather || point.forecast == null) return point;
        const uplift = Math.min(0.03, (configuredDelayDays * medianUpliftPct) / 100);
        const widening = Math.min(0.3, (configuredDelayDays * bandWideningPct) / 100);
        const center = point.forecast * (1 + uplift);
        const band = point.band ?? [point.forecast, point.forecast];
        const width = (band[1] - band[0]) * (1 + widening);
        return {
          ...point,
          forecast: +center.toFixed(2),
          band: [+(center - width / 2).toFixed(2), +(center + width / 2).toFixed(2)] as [
            number,
            number,
          ],
        };
      }),
    [data, includeWeather, configuredDelayDays, medianUpliftPct, bandWideningPct],
  );

  const scenarios = useMemo(() => {
    const vol = volumeMt;
    const input = {
      cargo: "Coking coal",
      volumeMt: vol,
      origin,
      port,
      windowDays: 35,
      strategy: "Spot" as const,
      alternate: false,
    };
    const now = evaluateVoyage(input);
    const future = data.find((d) => d.week === "W+1")?.forecast ?? BASE_RATE[origin];
    const current = data.find((d) => d.week === "Now")?.forecast ?? BASE_RATE[origin];
    const drift = future / current;
    const rows: Array<{ name: string; cost: number | null; note: string }> = [];
    rows.push({
      name: "Charter now",
      cost: now.best?.landedUsd ?? null,
      note: now.best ? `${now.best.name} at ${port}` : "No feasible class",
    });
    rows.push({
      name: "Wait 7 days",
      cost: now.best ? now.best.landedUsd * drift : null,
      note: `Forecast rate ${drift >= 1 ? "+" : ""}${((drift - 1) * 100).toFixed(1)}%`,
    });
    const alt = now.feasible
      .filter((c) => c.name !== now.best?.name)
      .sort((a, b) => a.landedUsd - b.landedUsd)[0];
    rows.push({
      name: "Switch vessel class",
      cost: alt?.landedUsd ?? null,
      note: alt ? alt.name : "No alternative class fits",
    });
    const portAlt = EAST_COAST_PORTS.filter((p) => p.code !== port)
      .map((p) => ({ p, r: evaluateVoyage({ ...input, port: p.code }) }))
      .filter((x) => x.r.best)
      .sort((a, b) => a.r.best!.landedUsd - b.r.best!.landedUsd)[0];
    rows.push({
      name: "Switch port",
      cost: portAlt?.r.best?.landedUsd ?? null,
      note: portAlt ? `${portAlt.p.name} · ${portAlt.r.best!.name}` : "—",
    });
    const baseline = rows[0]!.cost;
    return rows.map((r) => ({ ...r, delta: baseline && r.cost ? r.cost - baseline : null }));
  }, [origin, port, data, volumeMt]);

  return (
    <main className="freightiq-dashboard grid min-h-0 flex-1 gap-4 overflow-y-auto p-4 font-sans lg:grid-cols-2">
      <DashboardHeader
        eyebrow="Market outlook"
        title="Forecast & Scenarios"
        description="Compare freight-rate scenarios with the route’s current marine conditions before choosing when and where to charter."
        badge={<DemoBadge />}
      />
      <Panel title="Freight rate trend ($/t)" badge={<DemoBadge />}>
        <div className="mb-2 flex items-center justify-between gap-2 text-[10px]">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={includeWeather}
              onChange={(e) => setWeatherAdjustment({ includeWeather: e.target.checked })}
            />
            <CloudSun size={14} className="text-primary" aria-hidden />
            Include weather adjustment
          </label>
          <DataBadge kind="configured" detail="illustrative assumption" />
        </div>
        <details className="mb-2 rounded border border-border bg-background/40 px-2 py-1.5 text-[10px]">
          <summary className="cursor-pointer font-semibold">
            Weather adjustment settings · CONFIGURED
          </summary>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <label>
              Median uplift %/delay day
              <input
                aria-label="Median uplift percent per weather delay day"
                type="number"
                min="0"
                max="3"
                step="0.1"
                value={medianUpliftPct}
                onChange={(e) => setWeatherAdjustment({ medianUpliftPct: Number(e.target.value) })}
                className="mt-1 h-7 w-full rounded border border-border bg-panel px-2"
              />
            </label>
            <label>
              Band widening %/delay day
              <input
                aria-label="Band widening percent per weather delay day"
                type="number"
                min="0"
                max="30"
                step="0.5"
                value={bandWideningPct}
                onChange={(e) => setWeatherAdjustment({ bandWideningPct: Number(e.target.value) })}
                className="mt-1 h-7 w-full rounded border border-border bg-panel px-2"
              />
            </label>
          </div>
          <p className="mt-1 text-muted-foreground">
            Caps: +3% median and +30% band. Illustrative scenario only.
          </p>
        </details>
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData} margin={{ left: -16, right: 8, top: 8 }}>
              <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
              <XAxis
                dataKey="week"
                tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                interval={4}
              />
              <YAxis
                tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                domain={["auto", "auto"]}
              />
              <Tooltip
                contentStyle={{
                  background: "var(--popover)",
                  border: "1px solid var(--border)",
                  fontSize: 12,
                }}
              />
              <Area
                dataKey="band"
                stroke="none"
                fill="var(--primary)"
                fillOpacity={0.15}
                name="Confidence band"
              />
              <Line
                dataKey="actual"
                stroke="var(--foreground)"
                dot={false}
                strokeWidth={2}
                name="Historical"
              />
              <Line
                dataKey="forecast"
                stroke="var(--primary)"
                strokeDasharray="5 4"
                dot={false}
                strokeWidth={2}
                name="Forecast"
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <p className="mt-2 text-[10px] text-muted-foreground">
          Weather adjustment: +
          {(includeWeather
            ? Math.min(0.03, (configuredDelayDays * medianUpliftPct) / 100) * 100
            : 0
          ).toFixed(1)}
          % median, band widened{" "}
          {(includeWeather
            ? Math.min(0.3, (configuredDelayDays * bandWideningPct) / 100) * 100
            : 0
          ).toFixed(1)}
          %. Illustrative scenario adjustment, not a learned causal relationship.
        </p>
      </Panel>

      <Panel
        title="Route wave height"
        badge={
          waves.data ? (
            <LiveBadge
              label="Open-Meteo"
              updated={waves.dataUpdatedAt ? new Date(waves.dataUpdatedAt) : undefined}
            />
          ) : (
            <span className="rounded border border-border px-1.5 py-0.5 text-[9px] font-bold uppercase text-muted-foreground">
              {waves.isLoading ? "Loading feed" : "Feed unavailable"}
            </span>
          )
        }
      >
        <RouteMap className="h-72" segments={segments} />
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <Waves size={13} className="shrink-0 text-primary" aria-hidden />
            {waves.data
              ? "Marine weather via Open-Meteo · updated forecast"
              : waves.isLoading
                ? "Loading marine weather via Open-Meteo…"
                : "Marine weather unavailable · Open-Meteo"}
          </span>
          <span>
            {waves.isLoading
              ? "Loading…"
              : waves.isError
                ? "Weather feed unavailable"
                : `Max wave ${maxWave?.toFixed(1)} m`}{" "}
            · light blue &lt;2 m · mid blue &lt;3.5 m · dark navy ≥3.5 m
          </span>
        </div>
      </Panel>

      <Panel
        title={`Scenario comparison (${volumeMt.toLocaleString()} MT)`}
        badge={<DemoBadge />}
        className="lg:col-span-2"
      >
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
              <tr>
                <th className="py-2">Scenario</th>
                <th>Landed cost</th>
                <th>vs now</th>
                <th>Detail</th>
              </tr>
            </thead>
            <tbody>
              {scenarios.map((s) => (
                <tr key={s.name} className="border-t border-border">
                  <td className="py-2.5 font-semibold">
                    <span className="inline-flex items-center gap-2">
                      <span className="text-primary" aria-hidden>
                        {s.name === "Charter now" ? (
                          <TrendingUp size={14} />
                        ) : s.name === "Wait 7 days" ? (
                          <Clock3 size={14} />
                        ) : s.name === "Switch vessel class" ? (
                          <Ship size={14} />
                        ) : (
                          <Anchor size={14} />
                        )}
                      </span>
                      {s.name}
                    </span>
                  </td>
                  <td className="tabular-nums">{s.cost ? usd(s.cost) : "—"}</td>
                  <td
                    className={
                      s.delta == null || s.delta === 0
                        ? "text-muted-foreground"
                        : s.delta < 0
                          ? "text-pressure-normal"
                          : "text-pressure-high"
                    }
                  >
                    {s.delta == null
                      ? "—"
                      : s.delta === 0
                        ? "baseline"
                        : `${s.delta < 0 ? "−" : "+"}${usd(Math.abs(s.delta))}`}
                  </td>
                  <td className="text-xs text-muted-foreground">{s.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </main>
  );
}
