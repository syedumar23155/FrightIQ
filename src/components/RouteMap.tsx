import { useEffect, useRef } from "react";
import type { LatLng } from "@/config/geography";
import { EAST_COAST_PORTS } from "@/config/geography";
import { cssToken, useSatelliteMap } from "@/lib/google-maps";
import type { GoogleOverlay } from "@/lib/google-maps";
import { SatelliteRouteFallback } from "@/components/SatelliteRouteFallback";

export type Segment = { path: LatLng[]; color: string; dashed?: boolean };

export function RouteMap({ segments, className }: { segments: Segment[]; className?: string }) {
  const { nodeRef, map, google, error } = useSatelliteMap({ lat: 8, lng: 95 }, 3);
  const overlays = useRef<GoogleOverlay[]>([]);

  useEffect(() => {
    if (!map || !google) return;
    overlays.current.forEach((o) => o.setMap(null));
    overlays.current = [];
    const bounds = new google.maps.LatLngBounds();
    segments.forEach((s) => {
      s.path.forEach((p) => bounds.extend(p));
      overlays.current.push(
        new google.maps.Polyline({
          map,
          path: s.path,
          geodesic: true,
          strokeColor: s.color,
          strokeOpacity: s.dashed ? 0 : 0.95,
          strokeWeight: 3,
          icons: s.dashed
            ? [
                {
                  icon: { path: "M 0,-1 0,1", strokeOpacity: 0.9, strokeColor: s.color, scale: 3 },
                  offset: "0",
                  repeat: "14px",
                },
              ]
            : undefined,
        }),
      );
    });
    EAST_COAST_PORTS.forEach((p) => {
      overlays.current.push(
        new google.maps.Marker({
          map,
          position: p.position,
          title: p.name,
          icon: {
            path: google.maps.SymbolPath.CIRCLE,
            scale: 5,
            fillColor: cssToken("--marker-port"),
            fillOpacity: 1,
            strokeColor: cssToken("--marker-stroke"),
            strokeWeight: 2,
          },
        }),
      );
    });
    if (segments.length) map.fitBounds(bounds, 40);
  }, [map, google, segments]);

  return (
    <div className={className} style={{ position: "relative" }}>
      <div
        ref={nodeRef}
        className={`absolute inset-0 rounded-md bg-muted${error ? " google-map-failed" : ""}`}
      />
      {error && <SatelliteRouteFallback segments={segments} />}
    </div>
  );
}
