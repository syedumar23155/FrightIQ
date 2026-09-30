import { useRef } from "react";
import type { AisVessel } from "@/lib/ais";

type LatLng = { lat: number; lng: number };
type FallbackLocation = {
  id: string;
  name: string;
  country: string;
  type: "origin" | "port";
  position: LatLng;
  detail: string;
};
type FallbackCorridor = {
  id: string;
  path: LatLng[];
  pressure: "normal" | "rising" | "high";
};

const ZOOM = 3;
const TILE = 256;
const WORLD = TILE * 2 ** ZOOM;
const FOCUS = project({ lat: 5, lng: 90 });

function project({ lat, lng }: LatLng) {
  const safeLat = Math.max(-85.0511, Math.min(85.0511, lat));
  const sin = Math.sin((safeLat * Math.PI) / 180);
  return {
    x: ((lng + 180) / 360) * WORLD,
    y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * WORLD,
  };
}

export function SatelliteFallbackMap({
  mode,
  locations,
  corridors,
  selectedId,
  activeCorridor,
  vessels,
  vesselSource,
  portLevelByCode,
  weatherLevelByLocation,
  zoom,
  pan,
  onPan,
  onZoom,
  onSelect,
  onSelectCorridor,
  onSelectVessel,
}: {
  mode: "hybrid" | "satellite" | "roadmap";
  locations: FallbackLocation[];
  corridors: FallbackCorridor[];
  selectedId: string;
  activeCorridor: string;
  vessels: AisVessel[];
  vesselSource: "live" | "simulated" | "unavailable";
  portLevelByCode: Record<string, "low" | "medium" | "high">;
  weatherLevelByLocation: Record<string, "low" | "medium" | "high">;
  zoom: number;
  pan: { x: number; y: number };
  onPan: (pan: { x: number; y: number }) => void;
  onZoom: (zoom: number) => void;
  onSelect: (location: FallbackLocation) => void;
  onSelectCorridor: (id: string) => void;
  onSelectVessel: (vessel: AisVessel) => void;
}) {
  const drag = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);
  const streetLayer = mode === "roadmap";
  const tileLayer = streetLayer ? "World_Street_Map" : "World_Imagery";
  const attribution = streetLayer
    ? "© Esri, HERE, Garmin, OpenStreetMap contributors"
    : "© Esri, Maxar, Earthstar Geographics";

  return (
    <div
      className="absolute inset-0 touch-none overflow-hidden bg-[#e3ecf7] cursor-grab active:cursor-grabbing"
      role="application"
      aria-label="Interactive satellite map fallback showing overseas origins, Indian ports, and freight corridors"
      onPointerDown={(event) => {
        if (!(event.target as HTMLElement).closest("button")) {
          drag.current = { x: event.clientX, y: event.clientY, panX: pan.x, panY: pan.y };
          event.currentTarget.setPointerCapture(event.pointerId);
        }
      }}
      onPointerMove={(event) => {
        if (drag.current) {
          onPan({
            x: drag.current.panX + event.clientX - drag.current.x,
            y: drag.current.panY + event.clientY - drag.current.y,
          });
        }
      }}
      onPointerUp={() => {
        drag.current = null;
      }}
      onPointerCancel={() => {
        drag.current = null;
      }}
      onWheel={(event) => {
        if (event.deltaY !== 0)
          onZoom(Math.max(0.65, Math.min(2.4, zoom + (event.deltaY < 0 ? 0.1 : -0.1))));
      }}
    >
      <div
        className="absolute left-1/2 top-1/2 origin-top-left will-change-transform"
        style={{
          width: WORLD,
          height: WORLD,
          transform: `translate(${pan.x - FOCUS.x}px, ${pan.y - FOCUS.y}px) scale(${zoom})`,
        }}
      >
        <div className="absolute inset-0 grid grid-cols-8 grid-rows-8">
          {Array.from({ length: 64 }, (_, index) => {
            const x = index % 8;
            const y = Math.floor(index / 8);
            return (
              <img
                key={`${x}-${y}`}
                src={`https://server.arcgisonline.com/ArcGIS/rest/services/${tileLayer}/MapServer/tile/${ZOOM}/${y}/${x}`}
                alt=""
                draggable={false}
                className="h-64 w-64 select-none"
                loading="lazy"
              />
            );
          })}
        </div>
        {mode === "hybrid" && (
          <div className="absolute inset-0 grid grid-cols-8 grid-rows-8">
            {Array.from({ length: 64 }, (_, index) => (
              <img
                key={index}
                src={`https://server.arcgisonline.com/ArcGIS/rest/services/World_Boundaries_and_Places/MapServer/tile/${ZOOM}/${Math.floor(index / 8)}/${index % 8}`}
                alt=""
                draggable={false}
                className="h-64 w-64 select-none"
                loading="lazy"
              />
            ))}
          </div>
        )}
        <svg
          className="pointer-events-none absolute inset-0 overflow-visible"
          width={WORLD}
          height={WORLD}
          viewBox={`0 0 ${WORLD} ${WORLD}`}
        >
          {corridors.map((corridor) => {
            const points = corridor.path
              .map(project)
              .map(({ x, y }) => `${x},${y}`)
              .join(" ");
            const color =
              corridor.pressure === "high"
                ? "#10285a"
                : corridor.pressure === "rising"
                  ? "#3b7ddd"
                  : "#1a5fb4";
            return (
              <polyline
                key={corridor.id}
                points={points}
                fill="none"
                stroke={color}
                strokeWidth={activeCorridor === corridor.id ? 3.5 : 2}
                strokeOpacity={activeCorridor === corridor.id ? 1 : 0.72}
                strokeDasharray={activeCorridor === corridor.id ? undefined : "8 5"}
                strokeLinejoin="round"
              />
            );
          })}
        </svg>
        {locations.map((location) => {
          const point = project(location.position);
          const portLevel = portLevelByCode[location.id] ?? "low";
          const weatherLevel = weatherLevelByLocation[location.id] ?? "low";
          const markerColor =
            location.type === "origin"
              ? "bg-primary"
              : portLevel === "high"
                ? "bg-pressure-high"
                : portLevel === "medium"
                  ? "bg-pressure-rising"
                  : "bg-pressure-normal";
          const weatherRing =
            weatherLevel === "high"
              ? "ring-4 ring-pressure-high/55"
              : weatherLevel === "medium"
                ? "ring-4 ring-pressure-rising/55"
                : "";
          return (
            <button
              key={location.id}
              type="button"
              aria-label={`Select ${location.name}, ${location.country}`}
              title={`${location.name}, ${location.country}`}
              onClick={() => {
                onSelect(location);
                const nearCorridor = corridors.find((corridor) => corridor.id === location.id);
                if (nearCorridor) onSelectCorridor(nearCorridor.id);
              }}
              className={`absolute z-10 grid size-5 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border-2 border-white shadow-lg transition-transform hover:scale-125 ${markerColor} ${weatherRing} ${selectedId === location.id ? "ring-4 ring-white/30" : ""}`}
              style={{ left: point.x, top: point.y }}
            >
              <span className="sr-only">{location.name}</span>
            </button>
          );
        })}
        {vessels.map((vessel) => {
          const point = project({ lat: vessel.latitude, lng: vessel.longitude });
          const label = vessel.shipName ?? `MMSI ${vessel.mmsi}`;
          return (
            <button
              type="button"
              key={vessel.mmsi}
              aria-label={`${vesselSource === "live" ? "Live" : "Simulated"} AIS vessel ${label}${vessel.stationaryOverThreshold ? ", potential stationary flag" : ", moving or speed unavailable"}`}
              title={`${vesselSource === "live" ? "LIVE AIS" : "SIMULATED AIS"} · ${label} · ${vessel.stationaryOverThreshold ? "potential stationary flag" : `${vessel.speedKnots ?? "speed unavailable"} kn`}`}
              onClick={() => onSelectVessel(vessel)}
              className={`absolute z-20 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_4px_rgba(26,95,180,0.22)] ${vessel.stationaryOverThreshold ? "bg-primary shadow-[0_0_0_4px_rgba(242,185,75,0.25)]" : vesselSource === "live" ? "bg-teal-300" : "bg-violet-400 shadow-[0_0_0_4px_rgba(167,139,250,0.25)]"}`}
              style={{ left: point.x, top: point.y }}
            />
          );
        })}
      </div>
      <div className="absolute bottom-2 right-2 rounded-full border border-border bg-white/95 px-2.5 py-1 text-[9px] text-foreground backdrop-blur">
        Satellite fallback · {attribution}
      </div>
      <div className="absolute left-2 top-2 rounded-full border border-border bg-white/95 px-2.5 py-1 text-[9px] font-semibold uppercase tracking-wider text-foreground backdrop-blur">
        Google Maps unavailable · interactive satellite backup
      </div>
    </div>
  );
}
