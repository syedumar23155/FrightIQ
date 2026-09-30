import { CalendarClock, CheckCircle2, Clock3, Hourglass, Ship, TriangleAlert } from "lucide-react";
import { DemoBadge, usd } from "@/components/Panel";
import { cn } from "@/lib/utils";

export type CharterAction = "enter" | "wait" | "monitor" | "late";

export type FinalCharterProps = {
  action: CharterAction;
  vesselClass: string;
  strategy: string;
  routeLabel: string; // e.g. "Australia → Paradip"
  ratePerTonne: number;
  landedUsd: number;
  voyages: number;
  transitDays: number;
  score: number;
  latestFix: string; // formatted date
  entryLabel: string; // "today" or a date / date range
  confidence: "High" | "Medium" | "Low";
  reasons: string[];
};

const ACTION_UI: Record<
  CharterAction,
  { label: string; icon: typeof Ship; tone: string; bar: string }
> = {
  enter: {
    label: "Charter now",
    icon: CheckCircle2,
    tone: "border-pressure-normal/50 bg-pressure-normal/10 text-pressure-normal",
    bar: "bg-pressure-normal",
  },
  wait: {
    label: "Wait, then charter",
    icon: Hourglass,
    tone: "border-pressure-rising/50 bg-pressure-rising/10 text-pressure-rising",
    bar: "bg-pressure-rising",
  },
  monitor: {
    label: "Monitor the market",
    icon: Clock3,
    tone: "border-primary/50 bg-primary/10 text-primary",
    bar: "bg-primary",
  },
  late: {
    label: "Fix immediately",
    icon: TriangleAlert,
    tone: "border-pressure-high/50 bg-pressure-high/10 text-pressure-high",
    bar: "bg-pressure-high",
  },
};

export function FinalCharterRecommendationCard(p: FinalCharterProps) {
  const ui = ACTION_UI[p.action];
  const Icon = ui.icon;
  const when =
    p.action === "enter"
      ? "Enter the market today"
      : p.action === "wait"
        ? `Best entry: ${p.entryLabel}`
        : p.action === "late"
          ? "Standard timing window has passed"
          : "Re-check the outlook in 7 days";

  const stats: [string, string][] = [
    ["Rate", `$${p.ratePerTonne.toFixed(2)}/t`],
    ["Landed cost", usd(p.landedUsd)],
    ["Voyages", String(p.voyages)],
    ["Transit", `${p.transitDays.toFixed(1)} d`],
    ["Model score", `${p.score}/100`],
    ["Latest date to fix", p.latestFix],
  ];

  return (
    <section
      aria-label="Final charter recommendation"
      className="freightiq-panel col-span-full overflow-hidden rounded-2xl border border-border bg-panel/95"
    >
      <div className={cn("h-1.5 w-full", ui.bar)} />
      <div className="grid gap-5 p-4 md:p-5 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1.4fr)]">
        <div className="min-w-0">
          <div className="flex items-center justify-between gap-2">
            <h2 className="section-label">Final charter recommendation</h2>
            <DemoBadge />
          </div>
          <div
            className={cn(
              "mt-3 inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm font-bold",
              ui.tone,
            )}
          >
            <Icon size={16} aria-hidden />
            {ui.label}
          </div>
          <p className="mt-3 flex items-center gap-2 text-2xl font-bold tracking-tight text-foreground">
            <Ship size={24} className="shrink-0 text-primary" aria-hidden />
            {p.vesselClass}
            <span className="text-base font-medium text-muted-foreground">
              · {p.strategy} charter
            </span>
          </p>
          <p className="mt-1 text-sm text-muted-foreground">{p.routeLabel}</p>
          <p className="mt-3 flex items-center gap-1.5 text-sm font-semibold text-foreground">
            <CalendarClock size={15} className="text-primary" aria-hidden />
            {when}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {p.confidence} confidence in the timing forecast
          </p>
        </div>

        <div className="min-w-0">
          <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-border bg-border text-xs sm:grid-cols-3">
            {stats.map(([k, v]) => (
              <div key={k} className="bg-panel p-2.5">
                <dt className="text-[10px] text-muted-foreground">{k}</dt>
                <dd className="mt-0.5 font-semibold tabular-nums">{v}</dd>
              </div>
            ))}
          </dl>
          <ul className="mt-3 space-y-1.5">
            {p.reasons.map((r) => (
              <li key={r} className="flex gap-2 text-xs leading-relaxed text-muted-foreground">
                <span className={cn("mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full", ui.bar)} />
                {r}
              </li>
            ))}
          </ul>
          <p className="mt-3 text-[10px] text-muted-foreground">
            Simulated market data. Decision support only; human approval required.
          </p>
        </div>
      </div>
    </section>
  );
}
