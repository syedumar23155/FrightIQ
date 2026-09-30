import { createFileRoute, Link } from "@tanstack/react-router";
import { Activity, ChartNoAxesCombined, Satellite, Ship, ShieldAlert } from "lucide-react";
import { EAST_COAST_PORTS, ORIGINS } from "@/config/geography";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "FreightIQ | Freight Forecasting Model for Vessel Chartering" },
      {
        name: "description",
        content:
          "Freight forecasting for vessel chartering and bulk cargo procurement to India's East Coast ports (SIH26006).",
      },
    ],
  }),
  component: Landing,
});

const solutions = [
  {
    key: "a",
    to: "/forecast",
    icon: ChartNoAxesCombined,
    title: "Optimal Market Entry Timing",
    text: "Forecast freight rates and identify the best window to secure short-term or mid-term charter contracts for a given cargo requirement.",
    action: "Open forecast",
  },
  {
    key: "b",
    to: "/voyage",
    icon: Ship,
    title: "Vessel Type Optimization",
    text: "Recommend Handysize, Supramax, Panamax or Capesize for the cargo volume and route, within draft, LOA and handling limits at both ports.",
    action: "Open voyage & charter",
  },
  {
    key: "c",
    to: "/idle",
    icon: Activity,
    title: "Idle Scenario Management",
    text: "Compare positioning and employment options that reduce waiting time and avoid empty ballast legs.",
    action: "Open idle scenarios",
  },
  {
    key: "d",
    to: "/risk",
    icon: ShieldAlert,
    title: "Risk Mitigation",
    text: "Early warnings on market volatility, port congestion and other disruptions, with the port constraints for the active lane.",
    action: "Open risk assessment",
  },
] as const;

function Landing() {
  const stats = [
    { value: "4", label: "Decision modules" },
    { value: `${EAST_COAST_PORTS.length}`, label: "East Coast ports covered" },
    { value: `${ORIGINS.length}`, label: "Overseas origins" },
    { value: "4", label: "Vessel classes compared" },
  ];

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8 md:py-10">
      <section className="border-b border-border pb-8">
        <p className="section-label">SIH26006 · Ministry of Steel / SAIL</p>
        <h1 className="mt-2 max-w-4xl text-3xl font-bold leading-tight text-foreground md:text-5xl">
          Freight Forecasting Model for Vessel Chartering and Bulk Cargo Procurement
        </h1>
        <p className="mt-4 max-w-3xl text-base leading-relaxed text-muted-foreground">
          Move from repeated single spot contracts to planned short-term and medium-term
          multi-voyage contracts for bulk cargo arriving at India's East Coast ports.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link
            to="/voyage"
            className="rounded bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-sm hover:bg-primary/90"
          >
            Start a charter plan
          </Link>
          <Link
            to="/satellite-map"
            className="inline-flex items-center gap-2 rounded border border-primary px-5 py-2.5 text-sm font-semibold text-primary hover:bg-accent"
          >
            <Satellite size={15} aria-hidden /> View corridor map
          </Link>
        </div>
      </section>

      <section className="grid grid-cols-2 gap-3 py-6 md:grid-cols-4" aria-label="Coverage">
        {stats.map((s) => (
          <div key={s.label} className="bg-primary px-4 py-4 text-primary-foreground">
            <div className="font-heading text-3xl font-bold">{s.value}</div>
            <div className="text-sm opacity-90">{s.label}</div>
          </div>
        ))}
      </section>

      <section aria-label="Solutions">
        <h2 className="section-label mb-3">What this system delivers</h2>
        <div className="grid gap-4 md:grid-cols-2">
          {solutions.map((s) => (
            <Link key={s.to} to={s.to} className="solution-card group flex flex-col rounded p-5">
              <div className="flex items-center gap-3">
                <span className="grid size-10 shrink-0 place-items-center bg-primary font-heading text-lg font-bold uppercase text-primary-foreground">
                  {s.key}
                </span>
                <h3 className="text-xl font-bold text-foreground md:text-2xl">{s.title}</h3>
                <s.icon size={20} className="ml-auto shrink-0 text-primary" aria-hidden />
              </div>
              <p className="mt-3 flex-1 text-sm leading-relaxed text-muted-foreground">
                {s.text}
              </p>
              <span className="mt-4 text-sm font-semibold text-primary group-hover:underline">
                {s.action} →
              </span>
            </Link>
          ))}
        </div>
      </section>

      <p className="mt-8 border-t border-border pt-4 text-xs text-muted-foreground">
        Freight rates, congestion, vessel counts and ETAs are labelled as live, historical,
        configured or simulated wherever they appear.
      </p>
    </main>
  );
}
