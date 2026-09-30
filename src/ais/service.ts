import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import WebSocket from "ws";
import {
  AIS_BOUNDS,
  AIS_PORTS,
  AisEngine,
  DEFAULT_ENGINE_SETTINGS,
  parseAisMessage,
  reconnectDelayMs,
  summarizePorts,
  type AisVessel,
} from "@/server/ais-core";

type FeedState = "connecting" | "connected" | "disconnected";
type Runtime = {
  state: FeedState;
  connectedAt: string | null;
  lastMessageAt: string | null;
  reason: string | null;
  configured: boolean;
};

const globalEnv =
  (globalThis as typeof globalThis & { Bun?: { env: Record<string, string | undefined> } }).Bun
    ?.env ?? {};
const env = (name: string, fallback?: string) => globalEnv[name] ?? process.env[name] ?? fallback;
const numberEnv = (name: string, fallback: number) => {
  const value = Number(env(name));
  return Number.isFinite(value) && value > 0 ? value : fallback;
};
const apiKey = env("AISSTREAM_API_KEY", "")?.trim() ?? "";
const mockMode = env("AIS_MODE")?.toLowerCase() === "mock";
const stationaryHours = numberEnv("STATIONARY_HOURS", 48);
const engine = new AisEngine({
  ...DEFAULT_ENGINE_SETTINGS,
  activeWindowMs: numberEnv("AIS_ACTIVE_WINDOW_MINUTES", 120) * 60_000,
  stationaryMs: stationaryHours * 60 * 60_000,
  speedKnots: Number(env("STATIONARY_SPEED_KNOTS", "1")) || 1,
  radiusKm: Number(env("STATIONARY_RADIUS_KM", "1")) || 1,
});

const runtime: Runtime = {
  state: "disconnected",
  connectedAt: null,
  lastMessageAt: null,
  reason: mockMode
    ? "Mock AIS mode is enabled; these values are simulated."
    : apiKey
      ? null
      : "AISSTREAM_API_KEY is not configured on the AIS service.",
  configured: Boolean(apiKey) && !mockMode,
};
let socket: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let keepaliveTimer: ReturnType<typeof setInterval> | null = null;
let stopped = false;
let reconnectAttempt = 0;
let lastPongAt = 0;

function mockVessels(): AisVessel[] {
  const now = new Date().toISOString();
  return [
    {
      mmsi: "000000001",
      shipName: "MOCK VESSEL A",
      latitude: 20.26,
      longitude: 86.68,
      speedKnots: 0,
      courseDegrees: null,
      headingDegrees: null,
      timestamp: now,
      navigationStatus: null,
      lastSeen: now,
      vesselType: 70,
      destination: null,
      stationarySince: null,
      stationaryOverThreshold: false,
    },
    {
      mmsi: "000000002",
      shipName: "MOCK VESSEL B",
      latitude: 17.68,
      longitude: 83.29,
      speedKnots: 9,
      courseDegrees: 125,
      headingDegrees: 124,
      timestamp: now,
      navigationStatus: 0,
      lastSeen: now,
      vesselType: 70,
      destination: null,
      stationarySince: null,
      stationaryOverThreshold: false,
    },
    {
      mmsi: "000000003",
      shipName: "MOCK VESSEL C",
      latitude: 13.08,
      longitude: 80.3,
      speedKnots: 0.4,
      courseDegrees: 70,
      headingDegrees: 72,
      timestamp: now,
      navigationStatus: 1,
      lastSeen: now,
      vesselType: 70,
      destination: null,
      stationarySince: null,
      stationaryOverThreshold: false,
    },
  ];
}

function snapshot() {
  if (mockMode) {
    const vessels = mockVessels();
    return {
      status: {
        ...runtime,
        source: "simulated" as const,
        state: "disconnected" as const,
        reason: "Mock AIS mode is enabled; these values are simulated.",
      },
      vessels,
      summary: {
        activeVessels: vessels.length,
        stationaryOverThreshold: 0,
        portsMonitored: AIS_PORTS.length,
        lastUpdate: vessels[0]?.lastSeen ?? null,
        stationaryHours,
        source: "simulated" as const,
      },
      ports: summarizePorts(vessels).map((port) => ({ ...port, source: "simulated" as const })),
    };
  }
  const vessels = engine.activeVessels();
  return {
    status: {
      ...runtime,
      source: runtime.state === "connected" ? ("live" as const) : ("unavailable" as const),
    },
    vessels,
    summary: {
      ...engine.summary(),
      stationaryHours,
      source: runtime.state === "connected" ? ("live" as const) : ("unavailable" as const),
    },
    ports: engine.portSummary().map((port) => ({
      ...port,
      source: runtime.state === "connected" ? ("live" as const) : ("unavailable" as const),
    })),
  };
}

function clearTimers() {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  if (keepaliveTimer) clearInterval(keepaliveTimer);
  reconnectTimer = null;
  keepaliveTimer = null;
}

function scheduleReconnect() {
  if (stopped || mockMode || !apiKey || reconnectTimer) return;
  runtime.state = "disconnected";
  const delay = reconnectDelayMs(reconnectAttempt);
  reconnectAttempt += 1;
  console.info(`[AIS] reconnect scheduled in ${delay} ms`);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, delay);
}

function connect() {
  if (stopped || mockMode || !apiKey || socket) return;
  runtime.state = "connecting";
  runtime.reason = null;
  console.info("[AIS] connecting to AISStream East Coast subscription");
  const current = new WebSocket("wss://stream.aisstream.io/v0/stream", {
    perMessageDeflate: true,
    handshakeTimeout: 15_000,
    maxPayload: 2 * 1024 * 1024,
  });
  socket = current;
  let subscribed = false;
  let subscriptionConfirmed = false;
  let confirmationTimeout: ReturnType<typeof setTimeout> | null = null;
  const subscriptionTimeout = setTimeout(() => {
    if (!subscribed && current.readyState === WebSocket.OPEN) current.terminate();
  }, 2_500);
  current.on("open", () => {
    current.send(
      JSON.stringify({
        APIKey: apiKey,
        BoundingBoxes: AIS_BOUNDS,
        FilterMessageTypes: [
          "PositionReport",
          "ExtendedClassBPositionReport",
          "StandardClassBPositionReport",
          "ShipStaticData",
          "StaticDataReport",
        ],
      }),
    );
    subscribed = true;
    clearTimeout(subscriptionTimeout);
    lastPongAt = Date.now();
    confirmationTimeout = setTimeout(() => {
      if (!subscriptionConfirmed && current.readyState === WebSocket.OPEN) current.terminate();
    }, 10_000);
  });
  current.on("pong", () => {
    lastPongAt = Date.now();
  });
  current.on("message", (data) => {
    try {
      const payload: unknown = JSON.parse(data.toString());
      if (
        typeof payload === "object" &&
        payload !== null &&
        "MessageType" in payload &&
        payload.MessageType === "SubscriptionConfirmation"
      ) {
        subscriptionConfirmed = true;
        if (confirmationTimeout) clearTimeout(confirmationTimeout);
        runtime.state = "connected";
        runtime.connectedAt = new Date().toISOString();
        runtime.reason = null;
        reconnectAttempt = 0;
        console.info("[AIS] subscription confirmed for focused East Coast boxes");
        keepaliveTimer = setInterval(() => {
          if (current.readyState !== WebSocket.OPEN) return;
          if (Date.now() - lastPongAt > 90_000) {
            current.terminate();
            return;
          }
          current.ping();
        }, 30_000);
      }
      const parsed = parseAisMessage(payload);
      engine.ingest(parsed);
      if (parsed.kind !== "other") runtime.lastMessageAt = new Date().toISOString();
    } catch {
      console.warn("[AIS] ignored malformed stream message");
    }
  });
  current.on("error", (error) => {
    console.warn(`[AIS] WebSocket error: ${error.message.slice(0, 180)}`);
  });
  current.on("close", (code) => {
    clearTimeout(subscriptionTimeout);
    if (confirmationTimeout) clearTimeout(confirmationTimeout);
    if (socket === current) socket = null;
    clearTimers();
    runtime.state = "disconnected";
    runtime.reason =
      code === 1000
        ? "AISStream connection closed."
        : "AISStream is unavailable or rejected the connection; retrying.";
    console.warn(`[AIS] connection closed (${code})`);
    scheduleReconnect();
  });
}

function json(response: ServerResponse, statusCode: number, body: unknown) {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(body));
}

const port = Math.round(numberEnv("AIS_HTTP_PORT", 8790));
const host = env("AIS_HTTP_HOST", "127.0.0.1")!;
const httpServer = createServer((request: IncomingMessage, response: ServerResponse) => {
  const path = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`)
    .pathname;
  if (request.method !== "GET") return json(response, 405, { error: "Method not allowed" });
  const data = snapshot();
  switch (path) {
    case "/api/ais/status":
      return json(response, 200, data.status);
    case "/api/ais/summary":
      return json(response, 200, { ...data.status, ...data.summary });
    case "/api/ais/vessels":
      return json(response, 200, { source: data.status.source, vessels: data.vessels });
    case "/api/ais/ports":
      return json(response, 200, { source: data.status.source, ports: data.ports });
    case "/api/ais/congestion":
      return json(response, 200, {
        source: data.status.source,
        ports: data.ports.filter((item) => item.stationaryOverThreshold > 0),
      });
    default:
      return json(response, 404, { error: "Not found" });
  }
});

httpServer.listen(port, host, () => {
  console.info(
    `[AIS] API listening at http://${host}:${port}; mode=${mockMode ? "mock" : apiKey ? "live" : "disconnected"}`,
  );
  if (apiKey && !mockMode) connect();
});

function shutdown() {
  if (stopped) return;
  stopped = true;
  clearTimers();
  if (socket) {
    const active = socket;
    socket = null;
    active.close(1000, "Service shutting down");
  }
  httpServer.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3_000).unref();
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
