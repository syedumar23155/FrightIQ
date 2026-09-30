import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { DataBadge } from "@/components/Panel";
import { SatelliteFallbackMap } from "@/components/SatelliteFallbackMap";
import { CountryFlag } from "@/components/CountryFlag";
import {
  AlertTriangle,
  ArrowUpRight,
  Anchor,
  BarChart3,
  ChevronDown,
  CloudSun,
  Crosshair,
  Fullscreen,
  Layers3,
  LocateFixed,
  Menu,
  Minus,
  Plus,
  Radio,
  Search,
  Ship,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { GOOGLE_MAPS_AUTH_FAILURE, loadGoogleMaps } from "@/lib/google-maps";
import type { GoogleOverlay } from "@/lib/google-maps";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { fetchAisPorts, fetchAisVessels } from "@/lib/ais";
import type { AisPortSummary, AisVessel } from "@/lib/ais";
import {
  EAST_COAST_PORTS,
  ORIGINS,
  routeNm,
  routeTo,
  type OriginCode,
  type PortCode,
} from "@/config/geography";
import { setRequirement, useRequirement } from "@/lib/requirement";
import { CONGESTION_DEMO } from "@/lib/freight-model";
import {
  expectedDelayForWindow,
  fetchDailyWeather,
  fetchSeasonalWeather,
  seasonalCondition,
  weatherCondition,
  type DailyWeather,
} from "@/lib/weather";

declare global {
  interface Window {
    initFreightIqMap?: () => void;
    google?: { maps: Record<string, unknown> };
  }
}

type Pressure = "normal" | "rising" | "high";
type SignalLevel = "low" | "medium" | "high";
type MapMode = "hybrid" | "satellite" | "roadmap";

type GoogleMapInstance = {
  getZoom: () => number | undefined;
  panTo: (position: { lat: number; lng: number }) => void;
  setCenter: (position: { lat: number; lng: number }) => void;
  setMapTypeId: (mode: MapMode) => void;
  setZoom: (zoom: number) => void;
};

type Location = {
  id: string;
  name: string;
  country: string;
  type: "origin" | "port";
  position: { lat: number; lng: number };
  detail: string;
};

type Corridor = {
  id: string;
  short: string;
  from: string;
  to: string;
  pressure: Pressure;
  rate: string;
  delta: string;
  eta: string;
  vessels: number;
  path: Array<{ lat: number; lng: number }>;
};

const locations: Location[] = [
  ...ORIGINS.map((o) => ({
    id: o.code,
    name: o.exampleLoadPorts[0],
    country: o.name,
    type: "origin" as const,
    position: o.position,
    detail: `Load ports: ${o.exampleLoadPorts.join(", ")}`,
  })),
  ...EAST_COAST_PORTS.map((p) => ({
    id: p.code,
    name: p.name,
    country: "India",
    type: "port" as const,
    position: p.position,
    detail: `${p.state} · max draft ${p.maxDraftM} m`,
  })),
];

const corridorDemo: Record<
  OriginCode,
  { to: PortCode; pressure: Pressure; rate: string; delta: string; eta: string; vessels: number }
> = {
  AU: { to: "GNV", pressure: "rising", rate: "$13.8/t", delta: "+4.2%", eta: "18d", vessels: 11 },
  MZ: { to: "DHM", pressure: "normal", rate: "$17.2/t", delta: "−1.1%", eta: "14d", vessels: 7 },
  RU: { to: "PPT", pressure: "high", rate: "$24.6/t", delta: "+12.4%", eta: "26d", vessels: 4 },
  ID: { to: "HLD", pressure: "normal", rate: "$9.4/t", delta: "+0.8%", eta: "9d", vessels: 18 },
  US: { to: "VZG", pressure: "rising", rate: "$31.1/t", delta: "+6.7%", eta: "41d", vessels: 6 },
};

const corridors: Corridor[] = ORIGINS.map((o) => {
  const d = corridorDemo[o.code];
  return {
    id: o.code,
    short: `${o.code} → ${EAST_COAST_PORTS.find((p) => p.code === d.to)!.name}`,
    from: o.exampleLoadPorts[0],
    to: d.to,
    pressure: d.pressure,
    rate: d.rate,
    delta: d.delta,
    eta: d.eta,
    vessels: d.vessels,
    path: routeTo(o.code, d.to),
  };
});

const pressureLabel: Record<Pressure, string> = {
  normal: "Normal",
  rising: "Rising",
  high: "High",
};
const EMPTY_AIS_VESSELS: AisVessel[] = [];

function addDaysToDate(value: string, days: number) {
  const date = new Date(`${value}T00:00:00`);
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function weatherWindowConditions(
  start: string,
  forecast: DailyWeather[],
  history: Array<{ monthDay: string; gust: number | null; rain: number | null }>,
) {
  return Array.from({ length: 7 }, (_, index) => {
    const date = addDaysToDate(start, index);
    const daily = forecast.find((item) => item.date === date);
    return daily ? weatherCondition(daily) : (seasonalCondition(date, history)?.condition ?? null);
  }).filter((condition): condition is "Good" | "Caution" | "Poor" => condition !== null);
}

function portWaitLevel(days: number): SignalLevel {
  return days > 2.5 ? "high" : days > 1.5 ? "medium" : "low";
}

function findAisPort(ports: AisPortSummary[], name: string) {
  const key = name.toLowerCase();
  const aliases = key === "vizag" ? ["vizag", "visakhapatnam"] : [key];
  return ports.find((port) => aliases.includes(port.name.toLowerCase()));
}

function cssToken(name: string) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

export function SatelliteMap() {
  const requirement = useRequirement();
  const aisPortsQuery = useQuery({
    queryKey: ["ais-ports"],
    queryFn: () => fetchAisPorts().catch(() => ({ source: "unavailable" as const, ports: [] })),
    refetchInterval: 15_000,
    retry: false,
  });
  const aisQuery = useQuery({
    queryKey: ["ais-vessels"],
    queryFn: () => fetchAisVessels().catch(() => ({ source: "unavailable" as const, vessels: [] })),
    refetchInterval: 15_000,
    retry: false,
  });
  const liveVessels: AisVessel[] =
    aisQuery.data?.source !== "unavailable"
      ? (aisQuery.data?.vessels ?? EMPTY_AIS_VESSELS)
      : EMPTY_AIS_VESSELS;
  const vesselSource =
    aisQuery.data?.source === "live"
      ? "live"
      : aisQuery.data?.source === "simulated"
        ? "simulated"
        : "unavailable";
  const weatherQuery = useQuery({
    queryKey: ["voyage-weather", requirement.origin, requirement.port, requirement.startDate],
    queryFn: async () => {
      const load = ORIGINS.find((origin) => origin.code === requirement.origin)!;
      const discharge = EAST_COAST_PORTS.find((port) => port.code === requirement.port)!;
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
  const mapNodeRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<GoogleMapInstance | null>(null);
  const overlaysRef = useRef<GoogleOverlay[]>([]);
  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState(false);
  const [mapErrorMessage, setMapErrorMessage] = useState("Google Maps authorization failed");
  const [fallbackZoom, setFallbackZoom] = useState(1);
  const [fallbackPan, setFallbackPan] = useState({ x: 0, y: 0 });
  const [mapMode, setMapMode] = useState<MapMode>("hybrid");
  const [filter, setFilter] = useState<"all" | Pressure>("all");
  const [selected, setSelected] = useState<Location>(
    () =>
      locations.find((location) => location.id === requirement.port) ??
      locations.find((location) => location.id === "GNV") ??
      (locations[0] as Location),
  );
  const [activeCorridor, setActiveCorridor] = useState<OriginCode>(() => requirement.origin);
  const [selectedVesselMmsi, setSelectedVesselMmsi] = useState<string | null>(null);
  const [railOpen, setRailOpen] = useState(false);
  const [layersOpen, setLayersOpen] = useState(false);
  const layersButtonRef = useRef<HTMLButtonElement>(null);
  const [layersPosition, setLayersPosition] = useState<{ top: number; right: number } | null>(null);

  useEffect(() => setActiveCorridor(requirement.origin), [requirement.origin]);

  useEffect(() => {
    const requiredPort = locations.find((location) => location.id === requirement.port);
    if (requiredPort) setSelected(requiredPort);
  }, [requirement.port]);

  useEffect(() => {
    if (!layersOpen) return;
    const update = () => {
      const rect = layersButtonRef.current?.getBoundingClientRect();
      if (rect)
        setLayersPosition({
          top: rect.bottom + 8,
          right: Math.max(8, window.innerWidth - rect.right),
        });
    };
    const outside = (event: PointerEvent) => {
      if (
        !(event.target instanceof Element) ||
        (!event.target.closest("[data-map-layers]") &&
          !event.target.closest("[data-map-layers-menu]"))
      )
        setLayersOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setLayersOpen(false);
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [layersOpen]);

  const origin = ORIGINS.find((item) => item.code === requirement.origin)!;
  const destination = EAST_COAST_PORTS.find((item) => item.code === requirement.port)!;
  const activeRoute = useMemo(
    () => routeTo(requirement.origin, requirement.port),
    [requirement.origin, requirement.port],
  );
  const routeDistanceNm = routeNm(activeRoute);
  const estimatedSailingDays = routeDistanceNm / (13 * 24);
  const arrivalWindowStart = addDaysToDate(
    requirement.startDate,
    Math.max(0, Math.floor(estimatedSailingDays) - 3),
  );
  const loadingConditions = useMemo(
    () =>
      weatherWindowConditions(
        requirement.startDate,
        weatherQuery.data?.loading ?? [],
        weatherQuery.data?.loadingHistory ?? [],
      ),
    [requirement.startDate, weatherQuery.data],
  );
  const dischargeConditions = useMemo(
    () =>
      weatherWindowConditions(
        arrivalWindowStart,
        weatherQuery.data?.destination ?? [],
        weatherQuery.data?.destinationHistory ?? [],
      ),
    [arrivalWindowStart, weatherQuery.data],
  );
  const allWeatherConditions = useMemo(
    () => [...loadingConditions, ...dischargeConditions],
    [loadingConditions, dischargeConditions],
  );
  const weatherLevel: SignalLevel | null = allWeatherConditions.includes("Poor")
    ? "high"
    : allWeatherConditions.includes("Caution")
      ? "medium"
      : allWeatherConditions.length
        ? "low"
        : null;
  const loadingDelayDays = weatherQuery.data
    ? expectedDelayForWindow(
        requirement.startDate,
        weatherQuery.data.loading,
        weatherQuery.data.loadingHistory,
      )
    : null;
  const dischargeDelayDays = weatherQuery.data
    ? expectedDelayForWindow(
        arrivalWindowStart,
        weatherQuery.data.destination,
        weatherQuery.data.destinationHistory,
      )
    : null;
  const portWaitDays = CONGESTION_DEMO[requirement.port] ?? 0;
  const aisPort = findAisPort(aisPortsQuery.data?.ports ?? [], destination.name);
  const hasLiveAisPort = aisPortsQuery.data?.source === "live" && aisPort?.source === "live";
  const congestionLevel = portWaitLevel(portWaitDays);
  const selectedVessel = liveVessels.find((vessel) => vessel.mmsi === selectedVesselMmsi) ?? null;
  const portLevelByCode = useMemo(
    () =>
      Object.fromEntries(
        EAST_COAST_PORTS.map((port) => {
          return [port.code, portWaitLevel(CONGESTION_DEMO[port.code as PortCode] ?? 0)];
        }),
      ) as Record<string, SignalLevel>,
    [],
  );
  const weatherLevelByLocation = useMemo(
    () =>
      ({
        [requirement.origin]: loadingConditions.includes("Poor")
          ? "high"
          : loadingConditions.includes("Caution")
            ? "medium"
            : "low",
        [requirement.port]: dischargeConditions.includes("Poor")
          ? "high"
          : dischargeConditions.includes("Caution")
            ? "medium"
            : "low",
      }) as Record<string, SignalLevel>,
    [requirement.origin, requirement.port, loadingConditions, dischargeConditions],
  );
  const visibleCorridors = useMemo(
    () =>
      corridors
        .map((corridor) =>
          corridor.id === requirement.origin
            ? {
                ...corridor,
                to: requirement.port,
                eta: `${Math.ceil(estimatedSailingDays)}d`,
                path: activeRoute,
              }
            : corridor,
        )
        .filter((corridor) => filter === "all" || corridor.pressure === filter),
    [filter, requirement.origin, requirement.port, estimatedSailingDays, activeRoute],
  );

  const initializeMap = useCallback(() => {
    // Google Maps is loaded dynamically from its browser SDK; its constructor types are not bundled here.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const google = window.google as unknown as { maps: any } | undefined;
    if (!google || !mapNodeRef.current || mapRef.current) return;
    const map = new google.maps.Map(mapNodeRef.current, {
      center: { lat: 5, lng: 90 },
      zoom: 3,
      minZoom: 2,
      maxZoom: 13,
      mapTypeId: "hybrid",
      disableDefaultUI: true,
      clickableIcons: false,
      gestureHandling: "greedy",
      tilt: 0,
      restriction: {
        latLngBounds: { north: 70, south: -55, west: -180, east: 180 },
        strictBounds: false,
      },
    });
    mapRef.current = map as GoogleMapInstance;
    setMapReady(true);
  }, []);

  useEffect(() => {
    let alive = true;
    const onAuthFailure = (event: Event) => {
      if (!alive) return;
      setMapError(true);
      const detail = (event as CustomEvent<string>).detail;
      if (detail) setMapErrorMessage(detail);
    };
    window.addEventListener(GOOGLE_MAPS_AUTH_FAILURE, onAuthFailure);
    loadGoogleMaps()
      .then(() => {
        if (alive) initializeMap();
      })
      .catch((error: unknown) => {
        if (alive) {
          setMapError(true);
          setMapErrorMessage(
            error instanceof Error ? error.message : "Google Maps could not be loaded",
          );
        }
      });
    return () => {
      alive = false;
      window.removeEventListener(GOOGLE_MAPS_AUTH_FAILURE, onAuthFailure);
    };
  }, [initializeMap]);

  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const google = window.google as unknown as { maps: any } | undefined;
    const map = mapRef.current;
    if (!google || !map || !mapReady) return;
    overlaysRef.current.forEach((overlay) => overlay.setMap(null));
    overlaysRef.current = [];

    const colors: Record<Pressure, string> = {
      normal: cssToken("--pressure-normal"),
      rising: cssToken("--pressure-rising"),
      high: cssToken("--pressure-high"),
    };

    visibleCorridors.forEach((corridor) => {
      const line = new google.maps.Polyline({
        map,
        path: corridor.path,
        geodesic: true,
        strokeColor: colors[corridor.pressure],
        strokeOpacity: activeCorridor === corridor.id ? 1 : 0.68,
        strokeWeight: activeCorridor === corridor.id ? 4 : 2,
        icons: [
          {
            icon: {
              path: google.maps.SymbolPath.FORWARD_CLOSED_ARROW,
              scale: 2.5,
              fillColor: colors[corridor.pressure],
              fillOpacity: 1,
              strokeOpacity: 0,
            },
            offset: "58%",
          },
        ],
        zIndex: activeCorridor === corridor.id ? 5 : 2,
      });
      line.addListener("click", () => {
        setActiveCorridor(corridor.id);
        setRequirement({ origin: corridor.id, port: corridorDemo[corridor.id].to });
      });
      overlaysRef.current.push(line);
    });

    locations.forEach((location) => {
      const portLevel = portLevelByCode[location.id];
      const weatherLevel = weatherLevelByLocation[location.id];
      const portPressure: Pressure =
        portLevel === "high" ? "high" : portLevel === "medium" ? "rising" : "normal";
      const weatherPressure: Pressure | null =
        weatherLevel === "high" ? "high" : weatherLevel === "medium" ? "rising" : null;
      const marker = new google.maps.Marker({
        map,
        position: location.position,
        title: `${location.name}, ${location.country}`,
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale:
            location.type === "port"
              ? portLevel === "high"
                ? 8
                : portLevel === "medium"
                  ? 7
                  : 6
              : 5,
          fillColor: location.type === "port" ? colors[portPressure] : cssToken("--marker-origin"),
          fillOpacity: 1,
          strokeColor: weatherPressure ? colors[weatherPressure] : cssToken("--marker-stroke"),
          strokeWeight: weatherPressure ? 3 : 2,
        },
        zIndex: location.type === "port" ? 10 : 8,
      });
      marker.addListener("click", () => {
        setSelected(location);
        map.panTo(location.position);
        if (location.type === "port" && Number(map.getZoom()) < 6) map.setZoom(6);
      });
      overlaysRef.current.push(marker);
    });
    liveVessels.forEach((vessel) => {
      const marker = new google.maps.Marker({
        map,
        position: { lat: vessel.latitude, lng: vessel.longitude },
        title: `${vesselSource === "live" ? "LIVE AIS" : "SIMULATED AIS"} · ${vessel.shipName ?? vessel.mmsi} · ${vessel.stationaryOverThreshold ? "potentially stationary" : `${vessel.speedKnots ?? "speed unavailable"} knots`}`,
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: vessel.stationaryOverThreshold ? 7 : 5,
          fillColor: vessel.stationaryOverThreshold
            ? cssToken("--pressure-rising")
            : vesselSource === "live"
              ? cssToken("--marker-port")
              : "#6fa3e8",
          fillOpacity: 1,
          strokeColor: cssToken("--marker-stroke"),
          strokeWeight: 1.5,
        },
        zIndex: 20,
      });
      marker.addListener("click", () => {
        setSelectedVesselMmsi(vessel.mmsi);
        map.panTo({ lat: vessel.latitude, lng: vessel.longitude });
      });
      overlaysRef.current.push(marker);
    });
  }, [
    activeCorridor,
    liveVessels,
    mapReady,
    portLevelByCode,
    vesselSource,
    visibleCorridors,
    weatherLevelByLocation,
  ]);

  useEffect(() => {
    mapRef.current?.setMapTypeId(mapMode);
  }, [mapMode]);

  const changeZoom = (amount: number) => {
    const map = mapRef.current;
    if (!map) {
      setFallbackZoom((current) => Math.max(0.65, Math.min(2.4, current + amount * 0.15)));
      return;
    }
    map.setZoom(Math.max(2, Math.min(13, Number(map.getZoom()) + amount)));
  };

  const recenter = () => {
    setFallbackZoom(1);
    setFallbackPan({ x: 0, y: 0 });
    mapRef.current?.setCenter({ lat: 5, lng: 90 });
    mapRef.current?.setZoom(3);
  };

  const activeDemo =
    corridors.find((corridor) => corridor.id === activeCorridor) ??
    corridors.find((corridor) => corridor.id === "RU");
  const active = activeDemo
    ? activeDemo.id === requirement.origin
      ? {
          ...activeDemo,
          to: requirement.port,
          eta: `${Math.ceil(estimatedSailingDays)}d`,
          path: activeRoute,
        }
      : activeDemo
    : null;
  if (!active) return null;

  return (
    <main className="relative flex h-[calc(100dvh-3rem)] min-h-[560px] overflow-hidden bg-background font-sans text-foreground">
      <aside
        className={cn(
          "absolute inset-y-0 left-0 z-30 flex w-[324px] flex-col border-r border-border bg-panel/96 shadow-2xl backdrop-blur-xl transition-transform lg:relative lg:translate-x-0",
          railOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <header className="flex h-16 shrink-0 items-center justify-between border-b border-border px-5">
          <div className="flex items-center gap-3">
            <div className="grid size-9 place-items-center rounded-md border border-primary/40 bg-primary/10 text-primary">
              <Crosshair size={19} strokeWidth={2.3} />
            </div>
            <div>
              <div className="text-[15px] font-bold tracking-[0.16em]">FREIGHTIQ</div>
              <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                Satellite Map
              </div>
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden"
            aria-label="Close operations panel"
            onClick={() => setRailOpen(false)}
          >
            <X size={18} />
          </Button>
        </header>

        <div className="border-b border-border p-4">
          <div className="flex items-center gap-2 rounded-md border border-border bg-background/60 px-3 py-2.5 text-muted-foreground">
            <Search size={15} />
            <input
              aria-label="Search ports or vessels"
              className="min-w-0 flex-1 bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground"
              placeholder="Search ports, vessels, corridors"
            />
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <section className="border-b border-border p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="section-label">Network pulse</h2>
              <DataBadge kind="simulated" />
            </div>
            <div className="grid grid-cols-3 gap-px overflow-hidden rounded-md border border-border bg-border">
              <Metric value="46" label="Vessels" />
              <Metric value="5" label="Corridors" />
              <Metric value="2" label="Alerts" tone="alert" />
            </div>
          </section>

          <section className="p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="section-label">Active corridors</h2>
              <span className="text-[10px] text-muted-foreground">5 lanes</span>
            </div>
            <div className="space-y-2">
              {corridors.map((corridor) => (
                <button
                  key={corridor.id}
                  type="button"
                  onClick={() => {
                    setActiveCorridor(corridor.id);
                    setFilter("all");
                    setRequirement({ origin: corridor.id, port: corridorDemo[corridor.id].to });
                  }}
                  className={cn(
                    "w-full rounded-md border px-3 py-3 text-left transition-colors",
                    activeCorridor === corridor.id
                      ? "border-primary/60 bg-primary/10"
                      : "border-border bg-card/40 hover:bg-accent/70",
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-1.5 truncate text-xs font-semibold">
                      <CountryFlag code={corridor.id} />
                      <span className="truncate">{corridor.from}</span>
                      <span className="shrink-0 text-primary">→</span>
                      <CountryFlag code="IN" />
                      <span className="truncate">
                        {corridor.id === requirement.origin
                          ? destination.name
                          : portName(corridor.to)}
                      </span>
                    </span>
                    <PressureDot pressure={corridor.pressure} />
                  </div>
                  <div className="mt-2 flex items-end justify-between">
                    <div>
                      <span className="text-lg font-semibold tabular-nums">{corridor.rate}</span>
                      <span
                        className={cn(
                          "ml-2 text-[10px] font-bold",
                          corridor.pressure === "high"
                            ? "text-pressure-high"
                            : corridor.pressure === "rising"
                              ? "text-pressure-rising"
                              : "text-pressure-normal",
                        )}
                      >
                        {corridor.delta}
                      </span>
                    </div>
                    <span className="text-[10px] text-muted-foreground">
                      {corridor.vessels} vessels
                    </span>
                  </div>
                </button>
              ))}
            </div>
          </section>
        </div>

        <footer className="border-t border-border p-4">
          <div className="flex items-center justify-between text-[10px] text-muted-foreground">
            <span>Last model refresh</span>
            <span className="tabular-nums">13:42 IST</span>
          </div>
        </footer>
      </aside>

      {railOpen && (
        <button
          type="button"
          aria-label="Close operations panel"
          className="absolute inset-0 z-20 bg-overlay lg:hidden"
          onClick={() => setRailOpen(false)}
        />
      )}

      <section className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
        <div className="relative min-h-[300px] flex-1 overflow-hidden">
          <div
            ref={mapNodeRef}
            className={`absolute inset-0${mapError ? " google-map-failed" : ""}`}
            aria-label="Interactive satellite map of global freight corridors"
          />
          {!mapReady && !mapError && (
            <div className="absolute inset-0 grid place-items-center bg-background">
              <div className="text-center">
                <div className="mx-auto mb-4 size-8 animate-spin rounded-full border-2 border-muted border-t-primary" />
                <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                  Acquiring satellite view
                </p>
              </div>
            </div>
          )}
          {mapError && (
            <SatelliteFallbackMap
              mode={mapMode}
              locations={locations}
              corridors={corridors}
              vessels={liveVessels}
              vesselSource={vesselSource}
              portLevelByCode={portLevelByCode}
              weatherLevelByLocation={weatherLevelByLocation}
              selectedId={selected.id}
              activeCorridor={activeCorridor}
              zoom={fallbackZoom}
              pan={fallbackPan}
              onPan={setFallbackPan}
              onZoom={setFallbackZoom}
              onSelect={setSelected}
              onSelectCorridor={(id) => {
                const originCode = id as OriginCode;
                setActiveCorridor(originCode);
                setRequirement({ origin: originCode, port: corridorDemo[originCode].to });
              }}
              onSelectVessel={(vessel) => setSelectedVesselMmsi(vessel.mmsi)}
            />
          )}
          {mapError && (
            <div className="pointer-events-none absolute left-1/2 top-20 z-10 w-[min(520px,calc(100%-24px))] -translate-x-1/2 rounded-xl border border-pressure-rising/40 bg-panel/92 px-4 py-3 text-center text-xs text-foreground shadow-xl backdrop-blur-md">
              <strong className="text-pressure-rising">Google Maps authorization failed.</strong>{" "}
              The interactive Esri satellite backup is active. {mapErrorMessage} Check the Google
              Cloud project, Maps JavaScript API, billing, and allowed website referrers.
            </div>
          )}

          <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start justify-between gap-3 p-3 lg:p-5">
            <div className="pointer-events-auto flex items-center gap-2">
              <Button
                variant="secondary"
                size="icon"
                className="shadow-lg lg:hidden"
                aria-label="Open operations panel"
                onClick={() => setRailOpen(true)}
              >
                <Menu size={18} />
              </Button>
              <div className="hidden items-center gap-2 rounded-md border border-border bg-panel/90 px-3 py-2 shadow-lg backdrop-blur-md sm:flex">
                <Radio size={13} className="text-pressure-normal" />
                <span className="text-[10px] font-bold uppercase tracking-[0.16em]">
                  Operational overview
                </span>
                <DataBadge kind="simulated" />
              </div>
            </div>
            <div className="pointer-events-auto flex items-start gap-2">
              <div className="relative">
                <Button
                  ref={layersButtonRef}
                  data-map-layers="true"
                  variant="secondary"
                  className="gap-2 shadow-lg"
                  aria-expanded={layersOpen}
                  onClick={() => setLayersOpen((open) => !open)}
                >
                  <Layers3 size={16} />
                  <span className="hidden sm:inline">Map layers</span>
                  <ChevronDown size={14} />
                </Button>
                {layersOpen &&
                  layersPosition &&
                  createPortal(
                    <div
                      data-map-layers-menu="true"
                      style={{
                        position: "fixed",
                        top: layersPosition.top,
                        right: layersPosition.right,
                        zIndex: 60,
                      }}
                      className="w-44 rounded-md border border-border bg-panel p-1.5 shadow-2xl"
                    >
                      {(["hybrid", "satellite", "roadmap"] as MapMode[]).map((mode) => (
                        <button
                          type="button"
                          key={mode}
                          onClick={() => {
                            setMapMode(mode);
                            setLayersOpen(false);
                          }}
                          className={cn(
                            "flex w-full items-center justify-between rounded px-3 py-2 text-xs capitalize hover:bg-accent",
                            mapMode === mode && "bg-accent text-primary",
                          )}
                        >
                          <span>{mode === "hybrid" ? "Satellite + labels" : mode}</span>
                          {mapMode === mode && (
                            <span className="size-1.5 rounded-full bg-primary" />
                          )}
                        </button>
                      ))}
                    </div>,
                    document.body,
                  )}
              </div>
              <Button
                variant="secondary"
                size="icon"
                className="shadow-lg"
                aria-label="Fullscreen map"
                onClick={() => document.documentElement.requestFullscreen?.()}
              >
                <Fullscreen size={17} />
              </Button>
            </div>
          </div>

          <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 p-3 lg:p-5">
            <div className="flex items-end justify-between gap-3">
              <div className="pointer-events-auto max-w-[calc(100%-54px)] overflow-x-auto rounded-md border border-border bg-panel/92 p-1.5 shadow-2xl backdrop-blur-md">
                <div className="flex min-w-max items-center gap-1">
                  <span className="px-2 text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
                    Pressure
                  </span>
                  {(["all", "normal", "rising", "high"] as const).map((option) => (
                    <Button
                      key={option}
                      variant={filter === option ? "default" : "ghost"}
                      size="sm"
                      onClick={() => setFilter(option)}
                    >
                      {option === "all" ? "All lanes" : pressureLabel[option]}
                    </Button>
                  ))}
                </div>
              </div>
              <div className="pointer-events-auto flex flex-col overflow-hidden rounded-md border border-border bg-panel/92 shadow-2xl backdrop-blur-md">
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Zoom in"
                  onClick={() => changeZoom(1)}
                >
                  <Plus size={17} />
                </Button>
                <div className="mx-2 h-px bg-border" />
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Zoom out"
                  onClick={() => changeZoom(-1)}
                >
                  <Minus size={17} />
                </Button>
                <div className="mx-2 h-px bg-border" />
                <Button variant="ghost" size="icon" aria-label="Recenter map" onClick={recenter}>
                  <LocateFixed size={17} />
                </Button>
              </div>
            </div>
          </div>

          <div className="absolute right-3 top-20 z-30 w-[min(310px,calc(100%-24px))] rounded-md border border-border bg-panel/92 p-4 shadow-2xl backdrop-blur-md lg:right-5 lg:top-24">
            <div className="flex items-start justify-between gap-3">
              <div className="flex gap-3">
                <div className="grid size-9 shrink-0 place-items-center rounded-md bg-primary/15 text-primary">
                  {selected.type === "port" ? <Anchor size={18} /> : <Ship size={18} />}
                </div>
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
                    {selected.type === "port" ? "Destination port" : "Origin terminal"}
                  </div>
                  <h2 className="mt-0.5 text-base font-semibold">{selected.name}</h2>
                  <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <CountryFlag
                      code={selected.type === "port" ? "IN" : (selected.id as OriginCode)}
                    />
                    {selected.country}
                  </p>
                </div>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="-mr-2 -mt-2 size-8"
                aria-label="Focus selected location"
                onClick={() => {
                  mapRef.current?.panTo(selected.position);
                  mapRef.current?.setZoom(7);
                  if (!mapRef.current) {
                    const x = ((selected.position.lng + 180) / 360) * 2048;
                    const lat = Math.max(-85.0511, Math.min(85.0511, selected.position.lat));
                    const sin = Math.sin((lat * Math.PI) / 180);
                    const y = (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * 2048;
                    setFallbackZoom(1.6);
                    const centerLat = (5 * Math.PI) / 180;
                    const centerY =
                      (0.5 -
                        Math.log((1 + Math.sin(centerLat)) / (1 - Math.sin(centerLat))) /
                          (4 * Math.PI)) *
                      2048;
                    setFallbackPan({ x: 1536 - x * 1.6, y: centerY - y * 1.6 });
                  }
                }}
              >
                <Crosshair size={15} />
              </Button>
            </div>
            <div className="mt-4 border-t border-border pt-3">
              <p className="text-xs text-muted-foreground">{selected.detail}</p>
              <div className="mt-3 flex items-center justify-between">
                <span className="text-[10px] uppercase tracking-[0.13em] text-muted-foreground">
                  Selected corridor
                </span>
                <span className="text-xs font-semibold">
                  <CountryFlag code={active.id} /> {active.from} → <CountryFlag code="IN" />{" "}
                  {portName(active.to)}
                </span>
              </div>
              <div className="mt-2 flex items-center justify-between">
                <span className="text-[10px] uppercase tracking-[0.13em] text-muted-foreground">
                  Indicative ETA
                </span>
                <span className="text-xs font-semibold">{active.eta}</span>
              </div>
            </div>
          </div>

          <section
            aria-label="Decision radar"
            className="absolute bottom-20 right-3 top-[18rem] z-30 flex w-[min(390px,calc(100%-24px))] flex-col overflow-hidden rounded-xl border border-primary/45 bg-panel/95 shadow-2xl backdrop-blur-xl lg:right-5"
          >
            <header className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-3.5 py-3">
              <div className="flex min-w-0 items-center gap-2.5">
                <span className="grid size-8 shrink-0 place-items-center rounded-lg border border-primary/40 bg-primary/10 text-primary">
                  <Crosshair size={17} />
                </span>
                <div>
                  <h2 className="text-xs font-bold uppercase tracking-[0.14em] text-primary">
                    Decision Radar
                  </h2>
                  <p className="text-[10px] text-muted-foreground">
                    {origin.exampleLoadPorts[0]} → {destination.name}
                  </p>
                </div>
                <span className="grid size-7 shrink-0 place-items-center rounded-full border border-pressure-high/60 bg-pressure-high/15 text-xs font-bold text-pressure-high">
                  {
                    [
                      congestionLevel,
                      weatherLevel,
                      active.pressure === "high"
                        ? "high"
                        : active.pressure === "rising"
                          ? "medium"
                          : "low",
                    ].filter((level) => level != null && level !== "low").length
                  }
                </span>
              </div>
              <Link
                to="/risk"
                className="inline-flex shrink-0 items-center gap-1 text-[10px] font-semibold text-primary hover:underline"
              >
                View all <ArrowUpRight size={13} />
              </Link>
            </header>
            <div className="min-h-0 space-y-2 overflow-y-auto p-2.5">
              <DecisionSignalCard
                icon={AlertTriangle}
                title={`${destination.name} port congestion`}
                level={congestionLevel}
                summary={
                  hasLiveAisPort && aisPort
                    ? `${aisPort.vessels} AIS vessel(s) observed within ${aisPort.radiusKm} km; ${aisPort.stationaryOverThreshold} potential stationary flag(s). Not confirmed berth congestion. Configured wait scenario: ${portWaitDays.toFixed(1)} d.`
                    : `Configured congestion scenario: ${congestionLevel} · ${portWaitDays.toFixed(1)} d indicative wait. Live vessel counts are unavailable.`
                }
                source={
                  hasLiveAisPort ? (
                    <>
                      <DataBadge kind="live" detail="AIS positions" />
                      <DataBadge kind="configured" detail="wait scenario" />
                    </>
                  ) : (
                    <DataBadge kind="configured" detail="scenario estimate" />
                  )
                }
                to="/risk"
                action="Review port risk"
              />
              <DecisionSignalCard
                icon={CloudSun}
                title={`Weather risk · ${origin.exampleLoadPorts[0]} → ${destination.name}`}
                level={weatherLevel ?? "low"}
                summary={
                  weatherQuery.isLoading
                    ? "Loading forecast and seasonal observations for the selected loading and arrival windows."
                    : weatherQuery.isError
                      ? "Weather data is unavailable. No route-weather alert can be calculated right now."
                      : allWeatherConditions.length
                        ? `${loadingConditions.filter((condition) => condition === "Poor").length} poor / ${loadingConditions.filter((condition) => condition === "Caution").length} caution loading days; ${dischargeConditions.filter((condition) => condition === "Poor").length} poor / ${dischargeConditions.filter((condition) => condition === "Caution").length} caution arrival days. Derived delay: ${(loadingDelayDays! + dischargeDelayDays!).toFixed(1)} d. Port-window conditions only; no en-route weather grid is available.`
                        : "No forecast or historical observations were available for these dates."
                }
                source={
                  weatherQuery.data ? (
                    <>
                      <DataBadge kind="live" detail="Open-Meteo forecast" />
                      <DataBadge kind="historical" detail="seasonal fallback" />
                    </>
                  ) : (
                    <DataBadge kind="configured" detail="awaiting weather data" />
                  )
                }
                to="/voyage"
                action="Monitor voyage"
              />
              <DecisionSignalCard
                icon={BarChart3}
                title="Freight market pressure"
                level={
                  active.pressure === "high"
                    ? "high"
                    : active.pressure === "rising"
                      ? "medium"
                      : "low"
                }
                summary={`${origin.exampleLoadPorts[0]} → ${destination.name} corridor sample: ${active.rate}, ${active.delta} vs. reference. This is configured demo market data, not a live quote.`}
                source={<DataBadge kind="simulated" detail="corridor sample" />}
                to="/voyage"
                action="Open charter optimizer"
              />
            </div>
          </section>

          {selectedVessel && (
            <section
              aria-label="Selected vessel estimated arrival"
              className="absolute bottom-20 left-1/2 z-40 w-[min(340px,calc(100%-24px))] -translate-x-1/2 rounded-xl border border-primary/55 bg-panel/96 p-3.5 shadow-2xl backdrop-blur-xl"
            >
              {(() => {
                const speed = selectedVessel.speedKnots;
                const distanceNm = routeNm([
                  { lat: selectedVessel.latitude, lng: selectedVessel.longitude },
                  destination.position,
                ]);
                const estimatedDate =
                  speed != null && speed > 0
                    ? new Date(Date.now() + (distanceNm / speed) * 60 * 60 * 1000)
                    : null;
                return (
                  <>
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex min-w-0 items-start gap-2.5">
                        <span className="grid size-9 shrink-0 place-items-center rounded-lg border border-primary/40 bg-primary/10 text-primary">
                          <Ship size={19} />
                        </span>
                        <div className="min-w-0">
                          <h2 className="truncate text-sm font-bold">
                            {selectedVessel.shipName || `MMSI ${selectedVessel.mmsi}`}
                          </h2>
                          <p className="text-[10px] text-muted-foreground">
                            Planning destination · {destination.name}
                          </p>
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="-mr-2 -mt-2 size-8 shrink-0"
                        aria-label="Close vessel estimate"
                        onClick={() => setSelectedVesselMmsi(null)}
                      >
                        <X size={15} />
                      </Button>
                    </div>
                    <div className="mt-2 flex items-center justify-between gap-2">
                      <DataBadge
                        kind={vesselSource === "live" ? "live" : "simulated"}
                        detail="AIS position"
                      />
                      <span className="text-[10px] tabular-nums text-muted-foreground">
                        {speed == null ? "Speed unavailable" : `${speed.toFixed(1)} kn`} ·{" "}
                        {distanceNm.toLocaleString()} nm direct
                      </span>
                    </div>
                    <div className="mt-3 rounded-lg border border-border bg-background/55 px-3 py-2.5">
                      <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                        <Clock3 size={13} className="text-primary" /> Indicative straight-line ETA
                      </div>
                      <p className="mt-1 text-lg font-bold tabular-nums">
                        {estimatedDate
                          ? estimatedDate.toLocaleString([], {
                              month: "short",
                              day: "numeric",
                              year: "numeric",
                              hour: "2-digit",
                              minute: "2-digit",
                            })
                          : "Unavailable · no positive AIS speed"}
                      </p>
                      <p className="mt-1 text-[9px] leading-relaxed text-muted-foreground">
                        Derived from reported AIS speed and direct distance. Assumes constant speed;
                        excludes sea routing, weather and port delay. Not a ship-reported ETA.
                      </p>
                    </div>
                    <Link
                      to="/risk"
                      className="mt-2 inline-flex items-center gap-1 text-[10px] font-semibold text-primary hover:underline"
                    >
                      Open AIS &amp; port risk <ArrowUpRight size={12} />
                    </Link>
                  </>
                );
              })()}
            </section>
          )}

          <div className="absolute bottom-24 left-3 z-20 hidden rounded-md border border-border bg-panel/86 px-3 py-2 shadow-lg backdrop-blur-md md:block lg:left-5">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <i className="size-2 rounded-full bg-marker-origin" />
                Origin
              </span>
              <span className="flex items-center gap-1.5">
                <i className="size-2 rounded-full bg-marker-port" />
                Indian port
              </span>
              <span className="flex items-center gap-1.5">
                <i className="flex items-center gap-0.5">
                  <b className="size-1.5 rounded-full bg-pressure-normal" />
                  <b className="size-1.5 rounded-full bg-pressure-rising" />
                  <b className="size-1.5 rounded-full bg-pressure-high" />
                </i>
                Configured port wait
              </span>
              <span className="flex items-center gap-1.5">
                <i className="size-2 rounded-full border border-pressure-rising ring-1 ring-pressure-rising/50" />
                Weather caution / poor
              </span>
              <span className="flex items-center gap-1.5">
                <SlidersHorizontal size={11} />
                Click a lane to inspect
              </span>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}

function portName(code: PortCode) {
  return EAST_COAST_PORTS.find((port) => port.code === code)?.name ?? code;
}

function DecisionSignalCard({
  icon: Icon,
  title,
  level,
  summary,
  source,
  to,
  action,
}: {
  icon: typeof AlertTriangle;
  title: string;
  level: SignalLevel;
  summary: string;
  source: ReactNode;
  to: "/risk" | "/voyage";
  action: string;
}) {
  const tone = {
    low: "border-pressure-normal/40 bg-pressure-normal/10 text-pressure-normal",
    medium: "border-pressure-rising/45 bg-pressure-rising/10 text-pressure-rising",
    high: "border-pressure-high/45 bg-pressure-high/10 text-pressure-high",
  }[level];
  return (
    <article className={cn("rounded-xl border bg-background/60 p-3", tone)}>
      <div className="flex items-start gap-2.5">
        <span className={cn("grid size-8 shrink-0 place-items-center rounded-full border", tone)}>
          <Icon size={16} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <h3 className="text-xs font-bold leading-snug text-foreground">{title}</h3>
            <span className="shrink-0 rounded border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider">
              {level}
            </span>
          </div>
          <p className="mt-1.5 text-[10px] leading-relaxed text-muted-foreground">{summary}</p>
          <div className="mt-2 flex flex-wrap gap-1.5">{source}</div>
          <Link
            to={to}
            className="mt-2.5 inline-flex min-h-8 items-center justify-center gap-1.5 rounded-md border border-primary/50 bg-primary/5 px-2.5 text-[10px] font-semibold text-primary transition-colors hover:bg-primary/15"
          >
            {action} <ArrowUpRight size={12} />
          </Link>
        </div>
      </div>
    </article>
  );
}

function Metric({ value, label, tone }: { value: string; label: string; tone?: "alert" }) {
  return (
    <div className="bg-card px-2 py-3 text-center">
      <div
        className={cn(
          "text-xl font-semibold tabular-nums",
          tone === "alert" && "text-pressure-high",
        )}
      >
        {value}
      </div>
      <div className="mt-0.5 text-[9px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </div>
    </div>
  );
}

function PressureDot({ pressure }: { pressure: Pressure }) {
  return (
    <span className="flex shrink-0 items-center gap-1.5 text-[9px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
      <i
        className={cn(
          "size-1.5 rounded-full",
          pressure === "normal" && "bg-pressure-normal",
          pressure === "rising" && "bg-pressure-rising",
          pressure === "high" && "bg-pressure-high",
        )}
      />
      {pressureLabel[pressure]}
    </span>
  );
}
