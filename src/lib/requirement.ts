// Shared "Active Requirement" — edited on Voyage & Charter, read everywhere else.
import { useSyncExternalStore } from "react";
import type { OriginCode, PortCode } from "@/config/geography";
import type { CharterStrategy } from "@/lib/freight-model";

export type Requirement = {
  cargo: string;
  volumeMt: number;
  origin: OriginCode;
  port: PortCode;
  strategy: CharterStrategy;
  contractMonths: number;
  windowDays: number;
  startDate: string;
  endDate: string;
  vesselSize: "Auto" | "Handysize" | "Supramax" | "Panamax" | "Capesize";
  alternate: boolean;
};

const start = new Date();
start.setDate(start.getDate() + 7);
const end = new Date(start);
end.setDate(end.getDate() + 30);
const isoDate = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
let state: Requirement = {
  cargo: "Coking coal",
  volumeMt: 150000,
  origin: "AU",
  port: "PPT",
  strategy: "Spot",
  contractMonths: 0,
  windowDays: 30,
  startDate: isoDate(start),
  endDate: isoDate(end),
  vesselSize: "Auto",
  alternate: false,
};
const listeners = new Set<() => void>();

export function setRequirement(patch: Partial<Requirement>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

export function useRequirement(): Requirement {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => state,
    () => state,
  );
}
