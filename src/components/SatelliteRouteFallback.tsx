import type { LatLng } from "@/config/geography";

type RouteLine = { path: LatLng[]; color: string; dashed?: boolean };

const ZOOM = 3;
const TILE = 256;
const WORLD = TILE * 2 ** ZOOM;

function project({ lat, lng }: LatLng) {
  const safeLat = Math.max(-85.0511, Math.min(85.0511, lat));
  const sin = Math.sin((safeLat * Math.PI) / 180);
  return {
    x: ((lng + 180) / 360) * WORLD,
    y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * WORLD,
  };
}

export function SatelliteRouteFallback({ segments }: { segments: RouteLine[] }) {
  const points = segments.flatMap((segment) => segment.path);
  const center = points.length
    ? project({
        lat: points.reduce((sum, point) => sum + point.lat, 0) / points.length,
        lng: points.reduce((sum, point) => sum + point.lng, 0) / points.length,
      })
    : project({ lat: 8, lng: 95 });
  const firstX = Math.floor(center.x / TILE) - 4;
  const firstY = Math.max(0, Math.floor(center.y / TILE) - 2);

  return (
    <div
      className="absolute inset-0 overflow-hidden rounded-md bg-[#e3ecf7]"
      role="img"
      aria-label="Satellite route map fallback with freight route overlays"
    >
      <div
        className="absolute left-1/2 top-1/2 h-[2048px] w-[2048px]"
        style={{ transform: `translate(${-center.x}px, ${-center.y}px)` }}
      >
        {Array.from({ length: 9 * 5 }, (_, index) => {
          const col = firstX + (index % 9);
          const row = firstY + Math.floor(index / 9);
          const tileX = ((col % 8) + 8) % 8;
          if (row > 7) return null;
          return (
            <img
              key={`${col}-${row}`}
              src={`https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${ZOOM}/${row}/${tileX}`}
              alt=""
              draggable={false}
              loading="lazy"
              className="absolute h-64 w-64 max-w-none select-none"
              style={{ left: col * TILE, top: row * TILE }}
            />
          );
        })}
        <svg
          className="pointer-events-none absolute inset-0 overflow-visible"
          width={WORLD}
          height={WORLD}
          viewBox={`0 0 ${WORLD} ${WORLD}`}
        >
          {segments.map((segment, index) => {
            const path = segment.path
              .map(project)
              .map(({ x, y }) => `${x},${y}`)
              .join(" ");
            const start = segment.path[0] && project(segment.path[0]);
            const endPoint = segment.path.at(-1);
            const end = endPoint && project(endPoint);
            return (
              <g key={`${index}-${path}`}>
                <polyline
                  points={path}
                  fill="none"
                  stroke={segment.color}
                  strokeWidth={3}
                  strokeOpacity={0.95}
                  strokeDasharray={segment.dashed ? "8 6" : undefined}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
                {start && (
                  <circle
                    cx={start.x}
                    cy={start.y}
                    r={5}
                    fill="#10285a"
                    stroke="white"
                    strokeWidth={2}
                  />
                )}
                {end && (
                  <circle
                    cx={end.x}
                    cy={end.y}
                    r={5}
                    fill="#1a5fb4"
                    stroke="white"
                    strokeWidth={2}
                  />
                )}
              </g>
            );
          })}
        </svg>
      </div>
      <div className="absolute bottom-2 right-2 rounded-full border border-border bg-white/95 px-2.5 py-1 text-[9px] text-foreground backdrop-blur">
        Satellite fallback · © Esri
      </div>
    </div>
  );
}
