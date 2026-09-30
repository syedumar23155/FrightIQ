import { createFileRoute } from "@tanstack/react-router";
import { SatelliteMap } from "@/components/SatelliteMap";

export const Route = createFileRoute("/satellite-map")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Satellite Map | FreightIQ" },
      {
        name: "description",
        content:
          "Interactive satellite operations view for overseas bulk origins and Indian East Coast ports.",
      },
      { property: "og:title", content: "Satellite Map | FreightIQ" },
      {
        property: "og:description",
        content: "Monitor freight corridors between overseas origins and Indian East Coast ports.",
      },
    ],
  }),
  component: SatelliteMap,
});
