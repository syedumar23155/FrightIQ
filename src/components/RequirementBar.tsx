import { Link } from "@tanstack/react-router";
import { EAST_COAST_PORTS, ORIGINS } from "@/config/geography";
import { useRequirement } from "@/lib/requirement";

export function RequirementBar() {
  const r = useRequirement();
  const source = ORIGINS.find((x) => x.code === r.origin);
  const o = source
    ? `${source.exampleLoadPorts[0]} (${source.name === "United States" ? "USA" : source.name})`
    : "Overseas source";
  const p = EAST_COAST_PORTS.find((x) => x.code === r.port)?.name;
  const dateLabel = `${new Date(`${r.startDate}T00:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" })} → ${new Date(`${r.endDate}T00:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`;
  return (
    <div className="freightiq-requirement-bar flex min-h-8 shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-b border-border px-3 py-1 text-[11px] text-muted-foreground">
      <span className="shrink-0 font-semibold uppercase tracking-[0.14em]">Active requirement</span>
      <span className="min-w-0 text-foreground">
        {r.cargo} · {r.volumeMt.toLocaleString()} MT · {o} → {p} · {dateLabel} · {r.strategy}
      </span>
      <Link to="/voyage" className="ml-auto shrink-0 text-primary hover:underline">
        Edit
      </Link>
    </div>
  );
}
