import type { OriginCode } from "@/config/geography";
import { cn } from "@/lib/utils";

export type FlagCode = OriginCode | "IN";

export function CountryFlag({ code, className }: { code: FlagCode; className?: string }) {
  return (
    <svg
      width="36"
      height="24"
      viewBox="0 0 36 24"
      className={cn(
        "inline-block h-4 w-6 shrink-0 rounded-[2px] border border-white/20 align-middle",
        className,
      )}
      aria-hidden="true"
    >
      {code === "US" && (
        <>
          <rect width="36" height="24" fill="#fff" />
          {[0, 4, 8, 12, 16, 20].map((y) => (
            <rect key={y} y={y} width="36" height="2" fill="#c83b48" />
          ))}
          <rect width="16" height="13" fill="#24446e" />
          {[3, 7, 11].map((x) => (
            <g key={x} fill="#fff">
              {[3, 7, 11].map((y) => (
                <circle key={y} cx={x} cy={y} r=".7" />
              ))}
            </g>
          ))}
        </>
      )}
      {code === "RU" && (
        <>
          <rect width="36" height="8" fill="#fff" />
          <rect y="8" width="36" height="8" fill="#3159a1" />
          <rect y="16" width="36" height="8" fill="#d4474d" />
        </>
      )}
      {code === "ID" && (
        <>
          <rect width="36" height="12" fill="#d9414b" />
          <rect y="12" width="36" height="12" fill="#fff" />
        </>
      )}
      {code === "IN" && (
        <>
          <rect width="36" height="8" fill="#f29c40" />
          <rect y="8" width="36" height="8" fill="#fff" />
          <rect y="16" width="36" height="8" fill="#27875b" />
          <circle cx="18" cy="12" r="3" fill="none" stroke="#315d9b" strokeWidth="1" />
          <circle cx="18" cy="12" r=".8" fill="#315d9b" />
        </>
      )}
      {code === "MZ" && (
        <>
          <rect width="36" height="8" fill="#238653" />
          <rect y="8" width="36" height="8" fill="#111d26" />
          <rect y="16" width="36" height="8" fill="#e2c53c" />
          <path d="M0 0 13 12 0 24Z" fill="#cf4048" />
          <path d="m4 8 1 2h2l-1.6 1.2.6 2L4 12l-2 1.2.6-2L1 10h2Z" fill="#f2d65a" />
        </>
      )}
      {code === "AU" && (
        <>
          <rect width="36" height="24" fill="#193c78" />
          <rect width="16" height="11" fill="#214d8a" />
          <path d="M0 0 16 11M16 0 0 11" stroke="#fff" strokeWidth="3" />
          <path d="M0 0 16 11M16 0 0 11" stroke="#d44952" strokeWidth="1" />
          <path d="M8 0v11M0 5.5h16" stroke="#fff" strokeWidth="2" />
          <path d="M8 0v11M0 5.5h16" stroke="#d44952" strokeWidth=".7" />
          <g fill="#fff">
            <circle cx="25" cy="6" r="1.2" />
            <circle cx="30" cy="11" r="1" />
            <circle cx="23" cy="15" r="1" />
            <circle cx="31" cy="19" r="1.2" />
          </g>
        </>
      )}
    </svg>
  );
}
