// Single source of truth for origins and destination ports (SIH26006 problem statement).
// Every page, dropdown and map must import from here — never hardcode these lists elsewhere.

export type LatLng = { lat: number; lng: number };

export const ORIGINS = [
  { code: "AU", name: "Australia", exampleLoadPorts: ["Hay Point", "Dalrymple Bay", "Newcastle"], position: { lat: -21.27, lng: 149.3 } },
  { code: "US", name: "United States", exampleLoadPorts: ["Norfolk", "Baltimore"], position: { lat: 36.85, lng: -76.29 } },
  { code: "MZ", name: "Mozambique", exampleLoadPorts: ["Nacala", "Beira"], position: { lat: -14.54, lng: 40.67 } },
  { code: "RU", name: "Russia", exampleLoadPorts: ["Vostochny", "Vanino"], position: { lat: 42.74, lng: 133.06 } },
  { code: "ID", name: "Indonesia", exampleLoadPorts: ["Tanjung Bara", "Balikpapan"], position: { lat: 0.53, lng: 117.65 } },
] as const;

export type OriginCode = (typeof ORIGINS)[number]["code"];

export const SPEC_LABEL_CONFIGURED = "configured demo reference — not an official published figure";

export type PortSpec = {
  code: string;
  name: string;
  state: string;
  position: LatLng;
  maxDraftM: number;
  maxLoaM: number;
  maxBeamM: number;
  handlingTpd: number; // tonnes per day, coal/bulk
  specSource: "configured";
};

export const EAST_COAST_PORTS: PortSpec[] = [
  { code: "PPT", name: "Paradip", state: "Odisha", position: { lat: 20.26, lng: 86.68 }, maxDraftM: 17.1, maxLoaM: 280, maxBeamM: 47, handlingTpd: 60000, specSource: "configured" },
  { code: "VZG", name: "Vizag", state: "Andhra Pradesh", position: { lat: 17.68, lng: 83.29 }, maxDraftM: 17.0, maxLoaM: 300, maxBeamM: 50, handlingTpd: 55000, specSource: "configured" },
  { code: "GNV", name: "Gangavaram", state: "Andhra Pradesh", position: { lat: 17.62, lng: 83.23 }, maxDraftM: 18.0, maxLoaM: 300, maxBeamM: 50, handlingTpd: 50000, specSource: "configured" },
  { code: "GPL", name: "Gopalpur", state: "Odisha", position: { lat: 19.3, lng: 84.97 }, maxDraftM: 13.5, maxLoaM: 240, maxBeamM: 38, handlingTpd: 20000, specSource: "configured" },
  { code: "DHM", name: "Dhamra", state: "Odisha", position: { lat: 20.8, lng: 86.95 }, maxDraftM: 18.0, maxLoaM: 300, maxBeamM: 50, handlingTpd: 55000, specSource: "configured" },
  { code: "SGS", name: "Sagar-Sandheads", state: "West Bengal", position: { lat: 21.1, lng: 88.2 }, maxDraftM: 14.5, maxLoaM: 270, maxBeamM: 45, handlingTpd: 30000, specSource: "configured" },
  { code: "HLD", name: "Haldia", state: "West Bengal", position: { lat: 22.03, lng: 88.07 }, maxDraftM: 8.5, maxLoaM: 230, maxBeamM: 32.3, handlingTpd: 25000, specSource: "configured" },
];

export type PortCode = (typeof EAST_COAST_PORTS)[number]["code"];

// Auto-Sea-Way-lite: shipping-lane waypoints from each origin to the Bay of Bengal approach.
export const SEA_LANES: Record<OriginCode, { via: string; waypoints: LatLng[]; alternate?: { via: string; waypoints: LatLng[] } }> = {
  AU: { via: "Direct Indian Ocean crossing", waypoints: [{ lat: -21.27, lng: 149.3 }, { lat: -12, lng: 142.5 }, { lat: -9.8, lng: 130 }, { lat: -8.5, lng: 115.7 }, { lat: -3, lng: 100 }, { lat: 5.5, lng: 91 }, { lat: 14, lng: 87 }] },
  MZ: { via: "Direct Indian Ocean crossing", waypoints: [{ lat: -14.54, lng: 40.67 }, { lat: -11, lng: 50 }, { lat: -3, lng: 65 }, { lat: 4, lng: 78 }, { lat: 5.8, lng: 81 }, { lat: 10, lng: 84 }, { lat: 14, lng: 86 }] },
  RU: { via: "Via Malacca Strait", waypoints: [{ lat: 42.74, lng: 133.06 }, { lat: 34, lng: 129.5 }, { lat: 25, lng: 122 }, { lat: 12, lng: 111 }, { lat: 1.3, lng: 104.2 }, { lat: 3.5, lng: 100.3 }, { lat: 6, lng: 95 }, { lat: 14, lng: 88 }] },
  ID: { via: "Via Malacca Strait", waypoints: [{ lat: 0.53, lng: 117.65 }, { lat: -2, lng: 108 }, { lat: 1.3, lng: 104.2 }, { lat: 3.5, lng: 100.3 }, { lat: 6, lng: 95 }, { lat: 14, lng: 88 }] },
  US: {
    via: "Via Suez Canal",
    waypoints: [{ lat: 36.85, lng: -76.29 }, { lat: 37, lng: -40 }, { lat: 36, lng: -6 }, { lat: 37.5, lng: 10 }, { lat: 33, lng: 28 }, { lat: 31.2, lng: 32.3 }, { lat: 27, lng: 34 }, { lat: 12.6, lng: 43.4 }, { lat: 12, lng: 55 }, { lat: 6, lng: 76 }, { lat: 5.8, lng: 81 }, { lat: 14, lng: 86 }],
    alternate: { via: "Via Cape of Good Hope", waypoints: [{ lat: 36.85, lng: -76.29 }, { lat: 20, lng: -40 }, { lat: -5, lng: -15 }, { lat: -34.8, lng: 18.5 }, { lat: -30, lng: 40 }, { lat: -10, lng: 60 }, { lat: 5.8, lng: 81 }, { lat: 14, lng: 86 }] },
  },
};

export function routeTo(origin: OriginCode, port: PortCode, alternate = false): LatLng[] {
  const lane = SEA_LANES[origin];
  const pts = alternate && lane.alternate ? lane.alternate.waypoints : lane.waypoints;
  const dest = EAST_COAST_PORTS.find((p) => p.code === port)!;
  return [...pts, dest.position];
}

export function routeNm(path: LatLng[]): number {
  let d = 0;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1]!, b = path[i]!;
    const r = Math.PI / 180;
    const h = Math.sin(((b.lat - a.lat) * r) / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(((b.lng - a.lng) * r) / 2) ** 2;
    d += 2 * 3440 * Math.asin(Math.sqrt(h));
  }
  return Math.round(d);
}
