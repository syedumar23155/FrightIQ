import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Panel({
  title,
  badge,
  children,
  className,
}: {
  title: string;
  badge?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "freightiq-panel rounded-2xl border border-border bg-panel/95 p-4 md:p-5",
        className,
      )}
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="section-label">{title}</h2>
        {badge}
      </div>
      {children}
    </section>
  );
}

export function DashboardHeader({
  eyebrow,
  title,
  description,
  badge,
}: {
  eyebrow: string;
  title: string;
  description: string;
  badge?: ReactNode;
}) {
  return (
    <header className="freightiq-page-header col-span-full mb-0 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-border px-5 py-4 md:px-6 md:py-5">
      <div className="min-w-0">
        <div className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.2em] text-primary">
          {eyebrow}
        </div>
        <h1 className="text-xl font-bold tracking-tight text-foreground md:text-2xl">{title}</h1>
        <p className="mt-1 max-w-3xl text-xs leading-relaxed text-muted-foreground md:text-sm">
          {description}
        </p>
      </div>
      {badge && <div className="shrink-0">{badge}</div>}
    </header>
  );
}

export type DataKind = "live" | "historical" | "configured" | "simulated";
const KIND: Record<DataKind, { label: string; cls: string }> = {
  live: {
    label: "Live",
    cls: "border-pressure-normal/50 bg-pressure-normal/10 text-pressure-normal",
  },
  historical: { label: "Real · Historical", cls: "border-primary/50 bg-primary/10 text-primary" },
  configured: {
    label: "Configured",
    cls: "border-pressure-rising/50 bg-pressure-rising/10 text-pressure-rising",
  },
  simulated: { label: "Simulated", cls: "border-border bg-muted text-muted-foreground" },
};

/** The only data badge. A badge must never claim more than the data deserves. */
export function DataBadge({ kind, detail }: { kind: DataKind; detail?: string | undefined }) {
  const k = KIND[kind];
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.14em]",
        k.cls,
      )}
    >
      {kind === "live" && <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />}
      {k.label}
      {detail && (
        <span className="font-medium normal-case tracking-normal opacity-80">· {detail}</span>
      )}
    </span>
  );
}

export const DemoBadge = () => <DataBadge kind="simulated" />;
export const LiveBadge = ({
  label,
  updated,
}: {
  label?: string | undefined;
  updated?: Date | undefined;
}) => (
  <DataBadge
    kind="live"
    detail={
      [
        label,
        updated &&
          `updated ${updated.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`,
      ]
        .filter(Boolean)
        .join(" · ") || undefined
    }
  />
);

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </span>
      {children}
    </label>
  );
}

export const inputCls =
  "h-9 w-full rounded-md border border-border bg-background px-2.5 text-sm text-foreground outline-none focus:border-primary";

export const usd = (n: number) =>
  n >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : `$${Math.round(n).toLocaleString()}`;
