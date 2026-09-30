import { describe, expect, test } from "bun:test";
import {
  AisEngine,
  AIS_PORTS,
  DEFAULT_ENGINE_SETTINGS,
  distanceKm,
  parseAisMessage,
  reconnectDelayMs,
} from "../src/server/ais-core";

function position(mmsi: number, latitude = 20.26, longitude = 86.68, speed = 0) {
  return parseAisMessage({
    MessageType: "PositionReport",
    MetaData: { MMSI: mmsi, ShipName: " TEST VESSEL " },
    Message: {
      PositionReport: {
        UserID: mmsi,
        Latitude: latitude,
        Longitude: longitude,
        Sog: speed,
        Cog: 90,
        TrueHeading: 89,
        Valid: true,
        Timestamp: 1_800_000_000,
      },
    },
  });
}

describe("AIS normalization and state", () => {
  test("normalizes supported position fields without inventing missing values", () => {
    const parsed = position(123456789);
    expect(parsed.kind).toBe("position");
    if (parsed.kind === "position") {
      expect(parsed.vessel.mmsi).toBe("123456789");
      expect(parsed.vessel.shipName).toBe("TEST VESSEL");
      expect(parsed.vessel.speedKnots).toBe(0);
      expect(parsed.vessel.destination).toBeNull();
    }
  });

  test("ignores malformed positions", () => {
    expect(
      parseAisMessage({
        MessageType: "PositionReport",
        Message: { PositionReport: { UserID: 1 } },
      }),
    ).toEqual({ kind: "other" });
  });

  test("keeps static vessel details when they arrive before the first position", () => {
    const engine = new AisEngine();
    engine.ingest(
      parseAisMessage({
        MessageType: "ShipStaticData",
        MetaData: { MMSI: 123456789 },
        Message: { ShipStaticData: { Name: "STATIC SHIP", Type: 70, Destination: "PARADIP" } },
      }),
    );
    engine.ingest(position(123456789), Date.now());
    const vessel = engine.activeVessels()[0];
    expect(vessel?.shipName).toBe("STATIC SHIP");
    expect(vessel?.vesselType).toBe(70);
    expect(vessel?.destination).toBe("PARADIP");
  });

  test("deduplicates repeated MMSIs into one active vessel", () => {
    const engine = new AisEngine();
    const now = Date.now();
    engine.ingest(position(123456789), now);
    engine.ingest(position(123456789), now + 60_000);
    expect(engine.summary(now + 60_000).activeVessels).toBe(1);
  });

  test("requires repeated low-speed positions and more than the 48-hour threshold", () => {
    const engine = new AisEngine();
    const now = Date.now();
    engine.ingest(position(123456789), now);
    engine.ingest(position(123456789, 20.2601, 86.6801), now + 1_000);
    expect(engine.summary(now + 47 * 60 * 60_000).stationaryOverThreshold).toBe(0);
    engine.ingest(position(123456789, 20.2601, 86.6801), now + 49 * 60 * 60_000);
    expect(engine.summary(now + 49 * 60 * 60_000).stationaryOverThreshold).toBe(0); // long observation gap resets the heuristic
    engine.ingest(position(123456789, 20.2601, 86.6801), now + 49 * 60 * 60_000 + 60_000);
    expect(engine.summary(now + 49 * 60 * 60_000 + 60_000).stationaryOverThreshold).toBe(0);
  });

  test("detects stationary vessel only after continuous observations exceed 48 hours", () => {
    const settings = {
      ...DEFAULT_ENGINE_SETTINGS,
      activeWindowMs: 60 * 60_000,
      maxObservationGapMs: 60 * 60_000,
    };
    const engine = new AisEngine(settings);
    const now = Date.now();
    for (let halfHours = 0; halfHours <= 98; halfHours++) {
      engine.ingest(position(123456789), now + halfHours * 30 * 60_000);
    }
    expect(engine.summary(now + 49 * 60 * 60_000).stationaryOverThreshold).toBe(1);
  });

  test("resets the stationary anchor after movement beyond the configured radius", () => {
    const engine = new AisEngine();
    const now = Date.now();
    engine.ingest(position(123456789), now);
    engine.ingest(position(123456789), now + 1_000);
    engine.ingest(position(123456789, 20.28, 86.68), now + 2_000);
    expect(engine.summary(now + 2_000).stationaryOverThreshold).toBe(0);
  });

  test("calculates port proximity and distance", () => {
    const engine = new AisEngine();
    engine.ingest(position(123456789), Date.now());
    expect(engine.portSummary().find((port) => port.name === "Paradip")?.vessels).toBe(1);
    expect(engine.portSummary().reduce((count, port) => count + port.vessels, 0)).toBe(1);
    expect(AIS_PORTS).toHaveLength(11);
    expect(
      distanceKm({ latitude: 0, longitude: 0 }, { latitude: 0, longitude: 1 }),
    ).toBeGreaterThan(100);
  });

  test("uses bounded exponential backoff with jitter for reconnects", () => {
    expect(reconnectDelayMs(0, () => 0)).toBe(1125);
    expect(reconnectDelayMs(0, () => 1)).toBe(1875);
    expect(reconnectDelayMs(99, () => 1)).toBe(60_000);
  });
});
