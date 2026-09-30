import { Link } from "@tanstack/react-router";
import { cn } from "@/lib/utils";

const tabs = [
  { to: "/", label: "Home" },
  { to: "/forecast", label: "Market Entry Timing" },
  { to: "/voyage", label: "Vessel Type Optimization" },
  { to: "/idle", label: "Idle Scenario Management" },
  { to: "/risk", label: "Risk Mitigation" },
  { to: "/satellite-map", label: "Satellite Map" },
] as const;

export function AppNav() {
  return (
    <header className="sticky top-0 z-50 shrink-0">
      <div className="freightiq-topbar flex items-center gap-3 px-4 py-2">
        <span className="font-heading text-xl font-bold tracking-wider">FREIGHTIQ</span>
        <span className="hidden text-xs opacity-80 sm:inline">
          Freight forecasting for East Coast India bulk cargo · SIH26006
        </span>
      </div>
      <nav className="freightiq-nav flex flex-wrap items-center gap-x-1 border-b border-border px-3">
        {tabs.map((t) => (
          <Link
            key={t.to}
            to={t.to}
            activeOptions={{ exact: true }}
            className="shrink-0 border-b-[3px] border-transparent px-3 py-2.5 text-sm font-semibold text-muted-foreground hover:text-primary"
            activeProps={{ className: cn("border-primary text-primary") }}
          >
            {t.label}
          </Link>
        ))}
      </nav>
    </header>
  );
}
