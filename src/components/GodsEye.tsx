import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DataBadge } from "@/components/Panel";
import {
  Anchor,
  ChevronDown,
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
import { EAST_COAST_PORTS, ORIGINS, routeTo, type OriginCode, type PortCode } from "@/config/geography";

declare global {
  interface Window {
    initFreightIqMap?: () => void;
    google?: { maps: Record<string, unknown> };
  }
}

type Pressure = "normal" | "rising" | "high";
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
  ...ORIGINS.map((o) => ({ id: o.code, name: o.exampleLoadPorts[0], country: o.name, type: "origin" as const, position: o.position, detail: `Load ports: ${o.exampleLoadPorts.join(", ")}` })),
  ...EAST_COAST_PORTS.map((p) => ({ id: p.code, name: p.name, country: "India", type: "port" as const, position: p.position, detail: `${p.state} · max draft ${p.maxDraftM} m` })),
];

const corridorDemo: Record<OriginCode, { to: PortCode; pressure: Pressure; rate: string; delta: string; eta: string; vessels: number }> = {
  AU: { to: "GNV", pressure: "rising", rate: "$13.8/t", delta: "+4.2%", eta: "18d", vessels: 11 },
  MZ: { to: "DHM", pressure: "normal", rate: "$17.2/t", delta: "−1.1%", eta: "14d", vessels: 7 },
  RU: { to: "PPT", pressure: "high", rate: "$24.6/t", delta: "+12.4%", eta: "26d", vessels: 4 },
  ID: { to: "HLD", pressure: "normal", rate: "$9.4/t", delta: "+0.8%", eta: "9d", vessels: 18 },
  US: { to: "VZG", pressure: "rising", rate: "$31.1/t", delta: "+6.7%", eta: "41d", vessels: 6 },
};

const corridors: Corridor[] = ORIGINS.map((o) => {
  const d = corridorDemo[o.code];
  return { id: o.code, short: `${o.code} → ${EAST_COAST_PORTS.find((p) => p.code === d.to)!.name}`, from: o.exampleLoadPorts[0], to: d.to, pressure: d.pressure, rate: d.rate, delta: d.delta, eta: d.eta, vessels: d.vessels, path: routeTo(o.code, d.to) };
});

const pressureLabel: Record<Pressure, string> = { normal: "Normal", rising: "Rising", high: "High" };

function cssToken(name: string) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

export function GodsEye() {
  const mapNodeRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<GoogleMapInstance | null>(null);
  const overlaysRef = useRef<Array<{ setMap: (map: unknown) => void }>>([]);
  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState(false);
  const [mapMode, setMapMode] = useState<MapMode>("hybrid");
  const [filter, setFilter] = useState<"all" | Pressure>("all");
  const [selected, setSelected] = useState<Location>(() => locations.find((location) => location.id === "GNV") ?? locations[0] as Location);
  const [activeCorridor, setActiveCorridor] = useState("RU");
  const [railOpen, setRailOpen] = useState(false);
  const [layersOpen, setLayersOpen] = useState(false);

  const visibleCorridors = useMemo(
    () => corridors.filter((corridor) => filter === "all" || corridor.pressure === filter),
    [filter],
  );

  const initializeMap = useCallback(() => {
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
      restriction: { latLngBounds: { north: 70, south: -55, west: -180, east: 180 }, strictBounds: false },
    });
    mapRef.current = map as GoogleMapInstance;
    setMapReady(true);
  }, []);

  useEffect(() => {
    if ((window.google as unknown as { maps?: { Map?: unknown } } | undefined)?.maps?.Map) {
      initializeMap();
      return;
    }
    const key = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
    if (!key) {
      setMapError(true);
      return;
    }
    window.initFreightIqMap = initializeMap;
    const existingScript = document.querySelector<HTMLScriptElement>("script[data-freightiq-map]");
    if (existingScript) return;
    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&loading=async&callback=initFreightIqMap`;
    script.async = true;
    script.dataset["freightiqMap"] = "true";
    script.onerror = () => setMapError(true);
    document.head.appendChild(script);
  }, [initializeMap]);

  useEffect(() => {
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
        icons: [{ icon: { path: google.maps.SymbolPath.FORWARD_CLOSED_ARROW, scale: 2.5, fillColor: colors[corridor.pressure], fillOpacity: 1, strokeOpacity: 0 }, offset: "58%" }],
        zIndex: activeCorridor === corridor.id ? 5 : 2,
      });
      line.addListener("click", () => setActiveCorridor(corridor.id));
      overlaysRef.current.push(line);
    });

    locations.forEach((location) => {
      const marker = new google.maps.Marker({
        map,
        position: location.position,
        title: `${location.name}, ${location.country}`,
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: location.type === "port" ? 6 : 5,
          fillColor: location.type === "port" ? cssToken("--marker-port") : cssToken("--marker-origin"),
          fillOpacity: 1,
          strokeColor: cssToken("--marker-stroke"),
          strokeWeight: 2,
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
  }, [activeCorridor, mapReady, visibleCorridors]);

  useEffect(() => {
    mapRef.current?.setMapTypeId(mapMode);
  }, [mapMode]);

  const changeZoom = (amount: number) => {
    const map = mapRef.current;
    if (!map) return;
    map.setZoom(Math.max(2, Math.min(13, Number(map.getZoom()) + amount)));
  };

  const recenter = () => {
    mapRef.current?.setCenter({ lat: 5, lng: 90 });
    mapRef.current?.setZoom(3);
  };

  const active = corridors.find((corridor) => corridor.id === activeCorridor) ?? corridors.find((corridor) => corridor.id === "RU");
  if (!active) return null;

  return (
    <main className="relative flex h-[calc(100dvh-3rem)] min-h-[560px] overflow-hidden bg-background font-sans text-foreground">
      <aside className={cn("absolute inset-y-0 left-0 z-30 flex w-[324px] flex-col border-r border-border bg-panel/96 shadow-2xl backdrop-blur-xl transition-transform lg:relative lg:translate-x-0", railOpen ? "translate-x-0" : "-translate-x-full")}>
        <header className="flex h-16 shrink-0 items-center justify-between border-b border-border px-5">
          <div className="flex items-center gap-3">
            <div className="grid size-9 place-items-center rounded-md border border-primary/40 bg-primary/10 text-primary"><Crosshair size={19} strokeWidth={2.3} /></div>
            <div><div className="text-[15px] font-bold tracking-[0.16em]">FREIGHTIQ</div><div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">God’s Eye</div></div>
          </div>
          <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Close operations panel" onClick={() => setRailOpen(false)}><X size={18} /></Button>
        </header>

        <div className="border-b border-border p-4">
          <div className="flex items-center gap-2 rounded-md border border-border bg-background/60 px-3 py-2.5 text-muted-foreground">
            <Search size={15} /><input aria-label="Search ports or vessels" className="min-w-0 flex-1 bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground" placeholder="Search ports, vessels, corridors" />
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <section className="border-b border-border p-4">
            <div className="mb-3 flex items-center justify-between"><h2 className="section-label">Network pulse</h2><DataBadge kind="simulated" /></div>
            <div className="grid grid-cols-3 gap-px overflow-hidden rounded-md border border-border bg-border">
              <Metric value="46" label="Vessels" />
              <Metric value="5" label="Corridors" />
              <Metric value="2" label="Alerts" tone="alert" />
            </div>
          </section>

          <section className="p-4">
            <div className="mb-3 flex items-center justify-between"><h2 className="section-label">Active corridors</h2><span className="text-[10px] text-muted-foreground">5 lanes</span></div>
            <div className="space-y-2">
              {corridors.map((corridor) => (
                <button key={corridor.id} type="button" onClick={() => { setActiveCorridor(corridor.id); setFilter("all"); }} className={cn("w-full rounded-md border px-3 py-3 text-left transition-colors", activeCorridor === corridor.id ? "border-primary/60 bg-primary/10" : "border-border bg-card/40 hover:bg-accent/70")}>
                  <div className="flex items-center justify-between gap-2"><span className="truncate text-xs font-semibold">{corridor.short}</span><PressureDot pressure={corridor.pressure} /></div>
                  <div className="mt-2 flex items-end justify-between"><div><span className="text-lg font-semibold tabular-nums">{corridor.rate}</span><span className={cn("ml-2 text-[10px] font-bold", corridor.pressure === "high" ? "text-pressure-high" : corridor.pressure === "rising" ? "text-pressure-rising" : "text-pressure-normal")}>{corridor.delta}</span></div><span className="text-[10px] text-muted-foreground">{corridor.vessels} vessels</span></div>
                </button>
              ))}
            </div>
          </section>
        </div>

        <footer className="border-t border-border p-4">
          <div className="flex items-center justify-between text-[10px] text-muted-foreground"><span>Last model refresh</span><span className="tabular-nums">13:42 IST</span></div>
        </footer>
      </aside>

      {railOpen && <button type="button" aria-label="Close operations panel" className="absolute inset-0 z-20 bg-overlay lg:hidden" onClick={() => setRailOpen(false)} />}

      <section className="relative min-w-0 flex-1 overflow-hidden">
        <div ref={mapNodeRef} className="absolute inset-0" aria-label="Interactive satellite map of global freight corridors" />
        {!mapReady && !mapError && <div className="absolute inset-0 grid place-items-center bg-background"><div className="text-center"><div className="mx-auto mb-4 size-8 animate-spin rounded-full border-2 border-muted border-t-primary" /><p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Acquiring satellite view</p></div></div>}
        {mapError && <div className="absolute inset-0 grid place-items-center bg-background p-6 text-center"><div><Layers3 className="mx-auto mb-4 text-muted-foreground" /><h2 className="text-lg font-semibold">Satellite layer unavailable</h2><p className="mt-2 max-w-sm text-sm text-muted-foreground">Check the Google Maps connection, then reload this view.</p></div></div>}

        <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-start justify-between gap-3 p-3 lg:p-5">
          <div className="pointer-events-auto flex items-center gap-2">
            <Button variant="secondary" size="icon" className="shadow-lg lg:hidden" aria-label="Open operations panel" onClick={() => setRailOpen(true)}><Menu size={18} /></Button>
            <div className="hidden items-center gap-2 rounded-md border border-border bg-panel/90 px-3 py-2 shadow-lg backdrop-blur-md sm:flex"><Radio size={13} className="text-pressure-normal" /><span className="text-[10px] font-bold uppercase tracking-[0.16em]">Operational overview</span><DataBadge kind="simulated" /></div>
          </div>
          <div className="pointer-events-auto flex items-start gap-2">
            <div className="relative">
              <Button variant="secondary" className="gap-2 shadow-lg" aria-expanded={layersOpen} onClick={() => setLayersOpen((open) => !open)}><Layers3 size={16} /><span className="hidden sm:inline">Map layers</span><ChevronDown size={14} /></Button>
              {layersOpen && <div className="absolute right-0 mt-2 w-44 rounded-md border border-border bg-panel p-1.5 shadow-2xl">{(["hybrid", "satellite", "roadmap"] as MapMode[]).map((mode) => <button type="button" key={mode} onClick={() => { setMapMode(mode); setLayersOpen(false); }} className={cn("flex w-full items-center justify-between rounded px-3 py-2 text-xs capitalize hover:bg-accent", mapMode === mode && "bg-accent text-primary")}><span>{mode === "hybrid" ? "Satellite + labels" : mode}</span>{mapMode === mode && <span className="size-1.5 rounded-full bg-primary" />}</button>)}</div>}
            </div>
            <Button variant="secondary" size="icon" className="shadow-lg" aria-label="Fullscreen map" onClick={() => document.documentElement.requestFullscreen?.()}><Fullscreen size={17} /></Button>
          </div>
        </div>

        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 p-3 lg:p-5">
          <div className="flex items-end justify-between gap-3">
            <div className="pointer-events-auto max-w-[calc(100%-54px)] overflow-x-auto rounded-md border border-border bg-panel/92 p-1.5 shadow-2xl backdrop-blur-md">
              <div className="flex min-w-max items-center gap-1">
                <span className="px-2 text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Pressure</span>
                {(["all", "normal", "rising", "high"] as const).map((option) => <Button key={option} variant={filter === option ? "default" : "ghost"} size="sm" onClick={() => setFilter(option)}>{option === "all" ? "All lanes" : pressureLabel[option]}</Button>)}
              </div>
            </div>
            <div className="pointer-events-auto flex flex-col overflow-hidden rounded-md border border-border bg-panel/92 shadow-2xl backdrop-blur-md">
              <Button variant="ghost" size="icon" aria-label="Zoom in" onClick={() => changeZoom(1)}><Plus size={17} /></Button>
              <div className="mx-2 h-px bg-border" />
              <Button variant="ghost" size="icon" aria-label="Zoom out" onClick={() => changeZoom(-1)}><Minus size={17} /></Button>
              <div className="mx-2 h-px bg-border" />
              <Button variant="ghost" size="icon" aria-label="Recenter map" onClick={recenter}><LocateFixed size={17} /></Button>
            </div>
          </div>
        </div>

        <div className="absolute right-3 top-20 z-10 w-[min(310px,calc(100%-24px))] rounded-md border border-border bg-panel/92 p-4 shadow-2xl backdrop-blur-md lg:right-5 lg:top-24">
          <div className="flex items-start justify-between gap-3"><div className="flex gap-3"><div className="grid size-9 shrink-0 place-items-center rounded-md bg-primary/15 text-primary">{selected.type === "port" ? <Anchor size={18} /> : <Ship size={18} />}</div><div><div className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">{selected.type === "port" ? "Destination port" : "Origin terminal"}</div><h2 className="mt-0.5 text-base font-semibold">{selected.name}</h2><p className="text-xs text-muted-foreground">{selected.country}</p></div></div><Button variant="ghost" size="icon" className="-mr-2 -mt-2 size-8" aria-label="Focus selected location" onClick={() => { mapRef.current?.panTo(selected.position); mapRef.current?.setZoom(7); }}><Crosshair size={15} /></Button></div>
          <div className="mt-4 border-t border-border pt-3"><p className="text-xs text-muted-foreground">{selected.detail}</p><div className="mt-3 flex items-center justify-between"><span className="text-[10px] uppercase tracking-[0.13em] text-muted-foreground">Selected corridor</span><span className="text-xs font-semibold">{active.from} → {active.to}</span></div><div className="mt-2 flex items-center justify-between"><span className="text-[10px] uppercase tracking-[0.13em] text-muted-foreground">Indicative ETA</span><span className="text-xs font-semibold">{active.eta}</span></div></div>
        </div>

        <div className="absolute bottom-24 left-3 z-10 hidden rounded-md border border-border bg-panel/86 px-3 py-2 shadow-lg backdrop-blur-md md:block lg:left-5">
          <div className="flex items-center gap-4 text-[10px] text-muted-foreground"><span className="flex items-center gap-1.5"><i className="size-2 rounded-full bg-marker-origin" />Origin</span><span className="flex items-center gap-1.5"><i className="size-2 rounded-full bg-marker-port" />Indian port</span><span className="flex items-center gap-1.5"><SlidersHorizontal size={11} />Click a lane to inspect</span></div>
        </div>
      </section>
    </main>
  );
}

function Metric({ value, label, tone }: { value: string; label: string; tone?: "alert" }) {
  return <div className="bg-card px-2 py-3 text-center"><div className={cn("text-xl font-semibold tabular-nums", tone === "alert" && "text-pressure-high")}>{value}</div><div className="mt-0.5 text-[9px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{label}</div></div>;
}

function PressureDot({ pressure }: { pressure: Pressure }) {
  return <span className="flex shrink-0 items-center gap-1.5 text-[9px] font-bold uppercase tracking-[0.1em] text-muted-foreground"><i className={cn("size-1.5 rounded-full", pressure === "normal" && "bg-pressure-normal", pressure === "rising" && "bg-pressure-rising", pressure === "high" && "bg-pressure-high")} />{pressureLabel[pressure]}</span>;
}